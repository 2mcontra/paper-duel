import {
  EngineError,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RulesError,
  applyAction,
  createGame,
  redactEvent,
  resolveRules,
  slotForPage,
  suggestTargets,
  viewFor,
  type Action,
  type GameEvent,
  type GameState,
  type PlayerIndex,
  type RulesConfig,
  type RulesOverrides,
} from "@paper-duel/engine";
import {
  ClientMessage,
  EMOTE_COOLDOWN_MS,
  PROTOCOL_VERSION,
  type Emote,
  type ErrorCode,
  type RoomPhase,
  type RoomView,
  type ServerMessage,
} from "@paper-duel/protocol";
import type { ServerOptions } from "./config.js";
import { RateLimiter } from "./rateLimit.js";
import { newId, newRoomCode, newSessionToken } from "./session.js";

type Timer = ReturnType<typeof setTimeout>;

/** One WebSocket connection, as the room manager sees it. */
export interface Connection {
  readonly id: string;
  send(msg: ServerMessage): void;
  seat: Seat | null;
  failedJoins: number;
  limiter: RateLimiter;
  /** Set once we've told this connection it is rate limited, to avoid an error per dropped message. */
  limitedNotified: boolean;
}

interface Seat {
  playerId: string;
  name: string;
  token: string;
  room: Room;
  conn: Connection | null;
  ready: boolean;
  wantsRematch: boolean;
  /** Left during a game; the seat stays until the game ends so player indices don't move. */
  left: boolean;
  graceTimer: Timer | null;
  graceDeadline: number | null;
  lastEmoteAt: number;
}

interface Room {
  code: string;
  isPublic: boolean;
  maxPlayers: number;
  phase: RoomPhase;
  /** Seat 0 is the host. During a game, seat index = player index in the game. */
  seats: Seat[];
  rules: RulesConfig;
  game: GameState | null;
  roundTimer: Timer | null;
  roundDeadline: number | null;
}

class ClientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Seat>();
  private connectionCount = 0;

  constructor(private readonly opts: ServerOptions) {}

  get stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.phase === "playing") playing++;
    return { rooms: this.rooms.size, playing, connections: this.connectionCount };
  }

  // ---------- connection lifecycle ----------

  connect(send: (msg: ServerMessage) => void): Connection {
    this.connectionCount++;
    return {
      id: newId(),
      send,
      seat: null,
      failedJoins: 0,
      limiter: new RateLimiter(this.opts.messagesPerSecond, this.opts.messageBurst, this.opts.now),
      limitedNotified: false,
    };
  }

  /** The socket closed. The player keeps their seat for the grace period. */
  disconnect(conn: Connection): void {
    this.connectionCount--;
    const seat = conn.seat;
    conn.seat = null;
    if (!seat || seat.conn !== conn) return;
    seat.conn = null;
    seat.graceDeadline = this.opts.now() + this.opts.graceMs;
    seat.graceTimer = setTimeout(() => this.onGraceExpired(seat), this.opts.graceMs);
    this.broadcastRoom(seat.room);
  }

  handle(conn: Connection, raw: string): void {
    if (!conn.limiter.take()) {
      if (!conn.limitedNotified) {
        conn.limitedNotified = true;
        this.sendError(conn, "rate_limited", "Too many messages; slow down");
      }
      return;
    }
    conn.limitedNotified = false;

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return this.sendError(conn, "bad_message", "Message is not valid JSON");
    }
    const parsed = ClientMessage.safeParse(data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
      return this.sendError(conn, "bad_message", `${issue?.message ?? "Invalid message"}${where}`);
    }

    try {
      this.dispatch(conn, parsed.data);
    } catch (err) {
      if (err instanceof ClientError) return this.sendError(conn, err.code, err.message);
      if (err instanceof RulesError) return this.sendError(conn, "bad_rules", err.message);
      if (err instanceof EngineError) return this.sendError(conn, "illegal_action", err.message);
      throw err;
    }
  }

  /** Clears every timer. Call on server shutdown. */
  shutdown(): void {
    for (const room of this.rooms.values()) {
      this.clearRoundTimer(room);
      for (const seat of room.seats) if (seat.graceTimer) clearTimeout(seat.graceTimer);
    }
    this.rooms.clear();
    this.sessions.clear();
  }

  // ---------- message handlers ----------

  private dispatch(conn: Connection, msg: ClientMessage): void {
    switch (msg.type) {
      case "ping":
        return conn.send({ type: "pong", serverTime: this.opts.now() });
      case "create_room": {
        this.requireNoSeat(conn);
        const room = this.createRoom(
          resolveRules(msg.rules ?? {}),
          msg.maxPlayers ?? MAX_PLAYERS,
          false,
        );
        return this.seatIn(conn, room, msg.name);
      }
      case "join_room":
        return this.joinRoom(conn, msg.code, msg.name);
      case "quick_match":
        return this.quickMatch(conn, msg.name);
      case "resume":
        return this.resume(conn, msg.sessionToken);
      case "configure":
        return this.configure(conn, msg.rules, msg.maxPlayers);
      case "ready":
        return this.setReady(conn, msg.ready);
      case "start":
        return this.start(conn);
      case "play_card":
        return this.gameAction(conn, (player) => ({ type: "play_card", player, play: msg.play }));
      case "open_book":
        return this.gameAction(conn, (player, room) => this.openBookAction(room, player));
      case "set_target":
        return this.gameAction(conn, (player) => ({
          type: "set_target",
          player,
          targets: msg.targets,
        }));
      case "emote":
        return this.emote(conn, msg.emote);
      case "rematch":
        return this.rematch(conn);
      case "leave": {
        const seat = this.requireSeat(conn);
        conn.send({ type: "left", reason: "you_left" });
        return this.removeSeat(seat);
      }
    }
  }

  private joinRoom(conn: Connection, code: string, name: string): void {
    this.requireNoSeat(conn);
    if (conn.failedJoins >= this.opts.maxFailedJoins) {
      throw new ClientError("too_many_attempts", "Too many failed join attempts");
    }
    const room = this.rooms.get(code);
    if (!room) {
      conn.failedJoins++;
      throw new ClientError("room_not_found", `No room with code ${code}`);
    }
    if (room.phase !== "lobby") throw new ClientError("room_full", "That game has already started");
    if (room.seats.length >= room.maxPlayers)
      throw new ClientError("room_full", "That room is full");
    this.seatIn(conn, room, name);
  }

  private quickMatch(conn: Connection, name: string): void {
    this.requireNoSeat(conn);
    let room: Room | undefined;
    for (const r of this.rooms.values()) {
      if (r.isPublic && r.phase === "lobby" && r.seats.length < r.maxPlayers && r.seats[0]?.conn) {
        room = r;
        break;
      }
    }
    this.seatIn(conn, room ?? this.createRoom(resolveRules(), MAX_PLAYERS, true), name);
  }

  private resume(conn: Connection, token: string): void {
    const seat = this.sessions.get(token);
    if (!seat) throw new ClientError("session_not_found", "That session has expired");
    if (conn.seat && conn.seat !== seat) {
      throw new ClientError("already_in_room", "Leave your current room first");
    }
    if (seat.conn && seat.conn !== conn) {
      // The same player opened a new connection: the newest one wins.
      seat.conn.seat = null;
      seat.conn.send({ type: "left", reason: "replaced" });
    }
    const wasDisconnected = seat.conn === null;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    seat.graceDeadline = null;
    seat.conn = conn;
    conn.seat = seat;

    const room = seat.room;
    const you = this.indexOf(seat);
    this.sendJoined(seat);
    conn.send({ type: "room_state", room: this.view(room) });
    if (room.game) conn.send({ type: "game_state", game: viewFor(room.game, you) });
    if (room.phase === "playing" && room.game) {
      conn.send({ type: "round_timer", round: room.game.round, deadline: room.roundDeadline });
    }
    if (wasDisconnected) {
      this.broadcastRoom(room, seat);
      this.maybeStart(room);
    }
  }

  private configure(
    conn: Connection,
    overrides: RulesOverrides | undefined,
    maxPlayers: number | undefined,
  ): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    if (this.indexOf(seat) !== 0)
      throw new ClientError("not_host", "Only the host can change the setup");
    this.requirePhase(room, "lobby");
    if (maxPlayers !== undefined) {
      if (maxPlayers < room.seats.length) {
        throw new ClientError("bad_rules", `${room.seats.length} players are already here`);
      }
      room.maxPlayers = maxPlayers;
    }
    if (overrides) room.rules = resolveRules({ ...room.rules, ...overrides });
    for (const s of room.seats) s.ready = false;
    this.broadcastRoom(room);
  }

  private setReady(conn: Connection, ready: boolean): void {
    const seat = this.requireSeat(conn);
    this.requirePhase(seat.room, "lobby");
    seat.ready = ready;
    this.broadcastRoom(seat.room);
    this.maybeStart(seat.room);
  }

  /** Host starts the game: 2+ players, everyone connected and ready. */
  private start(conn: Connection): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    if (this.indexOf(seat) !== 0) throw new ClientError("not_host", "Only the host can start");
    this.requirePhase(room, "lobby");
    if (room.seats.length < MIN_PLAYERS) {
      throw new ClientError("not_ready", `Need at least ${MIN_PLAYERS} players`);
    }
    if (!room.seats.every((s) => s.ready && s.conn)) {
      throw new ClientError("not_ready", "Everyone must be ready");
    }
    this.startGame(room);
  }

  private rematch(conn: Connection): void {
    const seat = this.requireSeat(conn);
    this.requirePhase(seat.room, "finished");
    seat.wantsRematch = true;
    this.broadcastRoom(seat.room);
    this.maybeStart(seat.room);
  }

  /**
   * Starts without the host pressing Start when it's unambiguous: a full lobby where everyone
   * is ready, or a finished game where everyone still here wants a rematch.
   */
  private maybeStart(room: Room): void {
    const all = (f: (s: Seat) => boolean) =>
      room.seats.length >= MIN_PLAYERS && room.seats.every((s) => s.conn && f(s));
    if (room.phase === "lobby" && room.seats.length === room.maxPlayers && all((s) => s.ready)) {
      this.startGame(room);
    } else if (room.phase === "finished" && all((s) => s.wantsRematch)) {
      this.startGame(room);
    }
  }

  private emote(conn: Connection, emote: Emote): void {
    const seat = this.requireSeat(conn);
    const now = this.opts.now();
    if (now - seat.lastEmoteAt < EMOTE_COOLDOWN_MS) return; // silently drop spam
    seat.lastEmoteAt = now;
    this.broadcast(seat.room, { type: "emote", from: this.indexOf(seat), emote });
  }

  // ---------- game flow ----------

  private gameAction(conn: Connection, build: (player: PlayerIndex, room: Room) => Action): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    this.requirePhase(room, "playing");
    this.apply(room, [build(this.indexOf(seat), room)], []);
  }

  private openBookAction(room: Room, player: PlayerIndex): Action {
    // Check first, so a refused request doesn't draw a page from the book.
    const sub = room.game!.pending[player];
    if (!sub || sub.done || sub.needsTarget) {
      throw new ClientError("illegal_action", "You already opened the book this round");
    }
    return {
      type: "open_book",
      player,
      page: this.opts.randomPage(room.game!.rules.totalPages),
      luck: this.opts.randomInt(1_000_000),
    };
  }

  private startGame(room: Room): void {
    const seats = room.seats;
    const firstSeat = room.rules.firstPlayer === "host" ? 0 : this.opts.randomInt(seats.length);
    room.game = createGame({
      id: newId(),
      players: seats.map((s) => ({ id: s.playerId, name: s.name })),
      firstSeat,
      rules: room.rules,
    });
    room.phase = "playing";
    for (const s of seats) {
      s.ready = false;
      s.wantsRematch = false;
    }
    for (const [i, s] of seats.entries()) {
      s.conn?.send({ type: "game_started", game: viewFor(room.game, i) });
    }
    this.broadcastRoom(room);
    this.startRoundTimer(room);
  }

  /**
   * Applies actions in order and sends one update with all their events.
   * The first action may throw (a player's illegal move); nothing is applied then.
   */
  private apply(room: Room, actions: Action[], auto: PlayerIndex[]): void {
    let game = room.game!;
    const events: GameEvent[] = [];
    const roundBefore = game.round;
    for (const action of actions) {
      if (game.phase !== "playing") break;
      const r = applyAction(game, action);
      game = r.state;
      events.push(...r.events);
    }
    room.game = game;
    room.seats.forEach((s, i) => {
      s.conn?.send({
        type: "game_update",
        events: events.map((e) => redactEvent(e, i)),
        game: viewFor(game, i),
        auto,
      });
    });
    if (game.phase === "finished") this.endGame(room);
    else if (game.round !== roundBefore) this.startRoundTimer(room);
  }

  private endGame(room: Room): void {
    this.clearRoundTimer(room);
    const game = room.game!;
    room.phase = "finished";
    room.seats.forEach((s, i) => {
      s.conn?.send({
        type: "game_over",
        winner: game.winner,
        reason: game.endReason,
        game: viewFor(game, i),
      });
    });
    // Seats of players who left mid-game can go now; indices no longer matter.
    if (room.seats.some((s) => s.left)) {
      room.seats = room.seats.filter((s) => !s.left);
      for (const s of room.seats) this.sendJoined(s);
      room.game = null;
    }
    if (room.seats.length === 0) return this.deleteRoom(room);
    if (room.seats.length < MIN_PLAYERS) this.backToLobby(room);
    this.broadcastRoom(room);
  }

  private startRoundTimer(room: Room): void {
    this.clearRoundTimer(room);
    const game = room.game!;
    const seconds = game.rules.roundTimerSeconds;
    if (seconds !== null) {
      const ms = seconds * this.opts.secondMs;
      room.roundDeadline = this.opts.now() + ms;
      room.roundTimer = setTimeout(() => this.onRoundTimeout(room), ms);
    }
    this.broadcast(room, { type: "round_timer", round: game.round, deadline: room.roundDeadline });
  }

  private clearRoundTimer(room: Room): void {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    room.roundTimer = null;
    room.roundDeadline = null;
  }

  /** Time ran out: finish every unfinished go (open the book, aim at the best target). */
  private onRoundTimeout(room: Room): void {
    room.roundTimer = null;
    if (room.phase !== "playing" || !room.game) return;
    const round = room.game.round;
    const auto: PlayerIndex[] = [];
    let game = room.game;
    const actions: Action[] = [];
    // Plan each player's remaining steps one at a time against the evolving state.
    for (let p = 0; p < game.players.length; p++) {
      let guard = 0;
      while (
        game.round === round &&
        game.phase === "playing" &&
        game.pending[p] &&
        !game.pending[p]!.done
      ) {
        if (guard++ > 50) break; // R6 rerolls: a book with all-dead slots can't loop forever
        const sub = game.pending[p]!;
        let action: Action;
        if (sub.needsTarget) {
          const n = slotForPage(sub.pages.at(-1)!)!;
          const want = sub.card?.card === "double_shot" ? 2 : 1;
          action = { type: "set_target", player: p, targets: suggestTargets(game, p, n, want) };
        } else {
          action = this.openBookAction(room, p);
        }
        if (!auto.includes(p)) auto.push(p);
        actions.push(action);
        game = applyAction(game, action).state;
      }
    }
    if (actions.length) this.apply(room, actions, auto);
  }

  private onGraceExpired(seat: Seat): void {
    seat.graceTimer = null;
    if (seat.conn) return;
    this.removeSeat(seat);
  }

  // ---------- rooms and seats ----------

  private createRoom(rules: RulesConfig, maxPlayers: number, isPublic: boolean): Room {
    if (this.rooms.size >= this.opts.maxRooms) {
      throw new ClientError("server_full", "The server is full; try again soon");
    }
    let code: string;
    do code = newRoomCode(this.opts.randomInt);
    while (this.rooms.has(code));
    const room: Room = {
      code,
      isPublic,
      maxPlayers,
      phase: "lobby",
      seats: [],
      rules,
      game: null,
      roundTimer: null,
      roundDeadline: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  private deleteRoom(room: Room): void {
    this.clearRoundTimer(room);
    this.rooms.delete(room.code);
  }

  private backToLobby(room: Room): void {
    this.clearRoundTimer(room);
    room.phase = "lobby";
    room.game = null;
    for (const s of room.seats) {
      s.ready = false;
      s.wantsRematch = false;
    }
  }

  private seatIn(conn: Connection, room: Room, name: string): void {
    const seat: Seat = {
      playerId: newId(),
      name,
      token: newSessionToken(),
      room,
      conn,
      ready: false,
      wantsRematch: false,
      left: false,
      graceTimer: null,
      graceDeadline: null,
      lastEmoteAt: 0,
    };
    room.seats.push(seat);
    conn.seat = seat;
    this.sessions.set(seat.token, seat);
    this.sendJoined(seat);
    this.broadcastRoom(room);
  }

  /**
   * A player leaves for good (left, or reconnect time ran out). In a game they are knocked out
   * and their seat stays until it ends; otherwise the seat goes and later seats move up.
   */
  private removeSeat(seat: Seat): void {
    const room = seat.room;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    seat.graceDeadline = null;
    this.sessions.delete(seat.token);
    // Detach first so the leaver gets nothing after "left".
    if (seat.conn) seat.conn.seat = null;
    seat.conn = null;

    if (room.phase === "playing" && room.game) {
      seat.left = true;
      const p = this.indexOf(seat);
      if (!room.game.players[p]!.out) this.apply(room, [{ type: "leave", player: p }], []);
      if (room.phase === "playing") this.broadcastRoom(room);
      return;
    }

    const index = room.seats.indexOf(seat);
    room.seats.splice(index, 1);
    if (room.seats.length === 0) return this.deleteRoom(room);
    for (const s of room.seats.slice(index)) this.sendJoined(s); // their index moved up
    if (room.phase === "finished") {
      room.game = null;
      if (room.seats.length < MIN_PLAYERS) this.backToLobby(room);
    } else {
      for (const s of room.seats) s.ready = false;
    }
    this.broadcastRoom(room);
    this.maybeStart(room);
  }

  // ---------- helpers ----------

  private indexOf(seat: Seat): PlayerIndex {
    return seat.room.seats.indexOf(seat);
  }

  private sendJoined(seat: Seat): void {
    seat.conn?.send({
      type: "joined",
      protocol: PROTOCOL_VERSION,
      sessionToken: seat.token,
      you: this.indexOf(seat),
      code: seat.room.code,
    });
  }

  private requireSeat(conn: Connection): Seat {
    if (!conn.seat) throw new ClientError("not_in_room", "You are not in a room");
    return conn.seat;
  }

  private requireNoSeat(conn: Connection): void {
    if (conn.seat) throw new ClientError("already_in_room", "Leave your current room first");
  }

  private requirePhase(room: Room, phase: RoomPhase): void {
    if (room.phase !== phase) {
      throw new ClientError("wrong_phase", `Not allowed while the room is ${room.phase}`);
    }
  }

  private view(room: Room): RoomView {
    return {
      code: room.code,
      phase: room.phase,
      maxPlayers: room.maxPlayers,
      seats: room.seats.map((s) => ({
        name: s.name,
        ready: s.ready,
        connected: s.conn !== null,
        wantsRematch: s.wantsRematch,
        left: s.left,
        graceDeadline: s.graceDeadline,
      })),
      rules: room.rules,
      isPublic: room.isPublic,
    };
  }

  private broadcast(room: Room, msg: ServerMessage, except?: Seat): void {
    for (const s of room.seats) if (s.conn && s !== except) s.conn.send(msg);
  }

  private broadcastRoom(room: Room, except?: Seat): void {
    this.broadcast(room, { type: "room_state", room: this.view(room) }, except);
  }

  private sendError(conn: Connection, code: ErrorCode, message: string): void {
    conn.send({ type: "error", code, message });
  }
}

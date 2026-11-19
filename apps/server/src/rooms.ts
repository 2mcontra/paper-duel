import {
  EngineError,
  RulesError,
  applyAction,
  createGame,
  forfeit,
  other,
  resolveRules,
  type Action,
  type GameState,
  type PlayerIndex,
  type RulesConfig,
  type RulesOverrides,
  type TurnResult,
} from "@paper-duel/engine";
import {
  ClientMessage,
  PROTOCOL_VERSION,
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
  graceTimer: Timer | null;
  graceDeadline: number | null;
}

interface Room {
  code: string;
  isPublic: boolean;
  phase: RoomPhase;
  /** Seat 0 is the host and is always filled while the room exists. */
  seats: [Seat | null, Seat | null];
  rules: RulesConfig;
  game: GameState | null;
  turnTimer: Timer | null;
  turnDeadline: number | null;
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
    this.notifyOpponentStatus(seat);
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
      this.clearTurnTimer(room);
      for (const seat of room.seats) if (seat?.graceTimer) clearTimeout(seat.graceTimer);
    }
    this.rooms.clear();
    this.sessions.clear();
  }

  // ---------- message handlers ----------

  private dispatch(conn: Connection, msg: ClientMessage): void {
    switch (msg.type) {
      case "ping":
        return conn.send({ type: "pong", serverTime: this.opts.now() });
      case "create_room":
        this.requireNoSeat(conn);
        return this.seatIn(conn, this.createRoom(resolveRules(msg.rules ?? {}), false), msg.name);
      case "join_room":
        return this.joinRoom(conn, msg.code, msg.name);
      case "quick_match":
        return this.quickMatch(conn, msg.name);
      case "resume":
        return this.resume(conn, msg.sessionToken);
      case "set_rules":
        return this.setRules(conn, msg.rules);
      case "ready":
        return this.setReady(conn, msg.ready);
      case "open_book":
        return this.playerAction(conn, "open_book");
      case "choose":
        return this.playerAction(conn, "choose", msg.attack);
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
    if (room.phase !== "lobby" || room.seats[1]) {
      throw new ClientError("room_full", "That room is full");
    }
    this.seatIn(conn, room, name);
  }

  private quickMatch(conn: Connection, name: string): void {
    this.requireNoSeat(conn);
    let room: Room | undefined;
    for (const r of this.rooms.values()) {
      if (r.isPublic && r.phase === "lobby" && !r.seats[1] && r.seats[0]?.conn) {
        room = r;
        break;
      }
    }
    this.seatIn(conn, room ?? this.createRoom(resolveRules(), true), name);
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
    conn.send({
      type: "joined",
      protocol: PROTOCOL_VERSION,
      sessionToken: seat.token,
      you,
      code: room.code,
    });
    conn.send({ type: "room_state", room: this.view(room) });
    if (room.game) conn.send({ type: "game_state", game: room.game });
    if (room.phase === "playing" && room.game) {
      conn.send({ type: "turn_timer", player: room.game.turn, deadline: room.turnDeadline });
    }
    const opp = room.seats[other(you)];
    if (opp) {
      conn.send({
        type: "opponent_status",
        connected: opp.conn !== null,
        graceDeadline: opp.graceDeadline,
      });
    }
    if (wasDisconnected) {
      this.notifyOpponentStatus(seat);
      this.broadcastRoom(room, seat);
      this.maybeStart(room);
    }
  }

  private setRules(conn: Connection, overrides: RulesOverrides): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    if (this.indexOf(seat) !== 0)
      throw new ClientError("not_host", "Only the host can change rules");
    this.requirePhase(room, "lobby");
    room.rules = resolveRules({ ...room.rules, ...overrides });
    for (const s of room.seats) if (s) s.ready = false;
    this.broadcastRoom(room);
  }

  private setReady(conn: Connection, ready: boolean): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    this.requirePhase(room, "lobby");
    seat.ready = ready;
    this.broadcastRoom(room);
    this.maybeStart(room);
  }

  private rematch(conn: Connection): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    this.requirePhase(room, "finished");
    seat.wantsRematch = true;
    this.broadcastRoom(room);
    this.maybeStart(room);
  }

  /** Starts a game once both seats are connected and agree (ready in the lobby, rematch after). */
  private maybeStart(room: Room): void {
    const agreed = (s: Seat | null) =>
      s?.conn && (room.phase === "lobby" ? s.ready : room.phase === "finished" && s.wantsRematch);
    if (agreed(room.seats[0]) && agreed(room.seats[1])) this.startGame(room);
  }

  private playerAction(conn: Connection, type: "open_book" | "choose", attack = false): void {
    const seat = this.requireSeat(conn);
    const room = seat.room;
    this.requirePhase(room, "playing");
    const game = room.game!;
    if (game.turn !== this.indexOf(seat))
      throw new ClientError("not_your_turn", "Wait for your turn");
    if (type === "open_book" && game.pendingChoice !== null) {
      throw new ClientError("illegal_action", "Choose whether to attack first");
    }
    if (type === "choose" && game.pendingChoice === null) {
      throw new ClientError("illegal_action", "There is no attack to choose");
    }
    this.act(
      room,
      type === "open_book" ? this.rollAction(room) : { type: "choose", attack },
      false,
    );
  }

  // ---------- game flow ----------

  private rollAction(room: Room): Action {
    return { type: "open_book", page: this.opts.randomPage(room.game!.rules.totalPages) };
  }

  private startGame(room: Room): void {
    const [a, b] = room.seats as [Seat, Seat];
    const firstTurn: PlayerIndex =
      room.rules.firstPlayer === "host" ? 0 : this.opts.randomInt(2) === 0 ? 0 : 1;
    room.game = createGame({
      id: newId(),
      players: [
        { id: a.playerId, name: a.name },
        { id: b.playerId, name: b.name },
      ],
      firstTurn,
      rules: room.rules,
    });
    room.phase = "playing";
    for (const s of [a, b]) {
      s.ready = false;
      s.wantsRematch = false;
    }
    this.broadcast(room, { type: "game_started", game: room.game });
    this.broadcastRoom(room);
    this.startTurnTimer(room);
  }

  private act(room: Room, action: Action, auto: boolean): void {
    this.apply(room, applyAction(room.game!, action), auto);
  }

  private apply(room: Room, result: TurnResult, auto: boolean): void {
    room.game = result.state;
    this.broadcast(room, { type: "turn_result", events: result.events, game: result.state, auto });
    if (result.state.phase === "finished") this.endGame(room);
    else this.startTurnTimer(room);
  }

  private endGame(room: Room): void {
    this.clearTurnTimer(room);
    const game = room.game!;
    room.phase = "finished";
    this.broadcast(room, { type: "game_over", winner: game.winner, reason: game.endReason, game });
    this.broadcastRoom(room);
  }

  /** Restarts the timer after every action, so each decision gets the full time. */
  private startTurnTimer(room: Room): void {
    this.clearTurnTimer(room);
    const game = room.game!;
    const seconds = game.rules.turnTimerSeconds;
    if (seconds !== null) {
      const ms = seconds * this.opts.secondMs;
      room.turnDeadline = this.opts.now() + ms;
      room.turnTimer = setTimeout(() => this.onTurnTimeout(room), ms);
    }
    this.broadcast(room, { type: "turn_timer", player: game.turn, deadline: room.turnDeadline });
  }

  private clearTurnTimer(room: Room): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = null;
  }

  /** Time ran out: act for the player. A pending R3 choice defaults to attacking. */
  private onTurnTimeout(room: Room): void {
    room.turnTimer = null;
    const game = room.game;
    if (room.phase !== "playing" || !game) return;
    const action: Action =
      game.pendingChoice !== null ? { type: "choose", attack: true } : this.rollAction(room);
    this.act(room, action, true);
  }

  private onGraceExpired(seat: Seat): void {
    seat.graceTimer = null;
    if (seat.conn) return;
    this.removeSeat(seat);
  }

  // ---------- rooms and seats ----------

  private createRoom(rules: RulesConfig, isPublic: boolean): Room {
    if (this.rooms.size >= this.opts.maxRooms) {
      throw new ClientError("server_full", "The server is full; try again soon");
    }
    let code: string;
    do code = newRoomCode(this.opts.randomInt);
    while (this.rooms.has(code));
    const room: Room = {
      code,
      isPublic,
      phase: "lobby",
      seats: [null, null],
      rules,
      game: null,
      turnTimer: null,
      turnDeadline: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  private seatIn(conn: Connection, room: Room, name: string): void {
    const index: PlayerIndex = room.seats[0] ? 1 : 0;
    const seat: Seat = {
      playerId: newId(),
      name,
      token: newSessionToken(),
      room,
      conn,
      ready: false,
      wantsRematch: false,
      graceTimer: null,
      graceDeadline: null,
    };
    room.seats[index] = seat;
    conn.seat = seat;
    this.sessions.set(seat.token, seat);
    conn.send({
      type: "joined",
      protocol: PROTOCOL_VERSION,
      sessionToken: seat.token,
      you: index,
      code: room.code,
    });
    this.broadcastRoom(room);
    if (index === 1) this.notifyOpponentStatus(seat);
  }

  /**
   * A player leaves for good (left, or grace ran out). A game in progress is forfeited.
   * The other player, if any, becomes host of a fresh lobby in the same room.
   */
  private removeSeat(seat: Seat): void {
    const room = seat.room;
    const index = this.indexOf(seat);
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = null;
    this.sessions.delete(seat.token);
    // Detach first so the leaver gets nothing after "left".
    if (seat.conn) seat.conn.seat = null;
    seat.conn = null;
    if (room.phase === "playing" && room.game) {
      this.apply(room, forfeit(room.game, index), false);
    }

    const remaining = room.seats[other(index)];
    if (!remaining) {
      this.clearTurnTimer(room);
      this.rooms.delete(room.code);
      return;
    }
    room.seats = [remaining, null];
    room.phase = "lobby";
    room.game = null;
    remaining.ready = false;
    remaining.wantsRematch = false;
    if (remaining.conn) {
      // Their index may have changed from 1 to 0.
      remaining.conn.send({
        type: "joined",
        protocol: PROTOCOL_VERSION,
        sessionToken: remaining.token,
        you: 0,
        code: room.code,
      });
    }
    this.broadcastRoom(room);
  }

  // ---------- helpers ----------

  private indexOf(seat: Seat): PlayerIndex {
    return seat.room.seats[0] === seat ? 0 : 1;
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
    const seatView = (s: Seat | null) =>
      s && {
        name: s.name,
        ready: s.ready,
        connected: s.conn !== null,
        wantsRematch: s.wantsRematch,
      };
    return {
      code: room.code,
      phase: room.phase,
      seats: [seatView(room.seats[0]), seatView(room.seats[1])],
      rules: room.rules,
      isPublic: room.isPublic,
    };
  }

  private broadcast(room: Room, msg: ServerMessage, except?: Seat): void {
    for (const s of room.seats) if (s?.conn && s !== except) s.conn.send(msg);
  }

  private broadcastRoom(room: Room, except?: Seat): void {
    this.broadcast(room, { type: "room_state", room: this.view(room) }, except);
  }

  private notifyOpponentStatus(seat: Seat): void {
    const opp = seat.room.seats[other(this.indexOf(seat))];
    opp?.conn?.send({
      type: "opponent_status",
      connected: seat.conn !== null,
      graceDeadline: seat.graceDeadline,
    });
  }

  private sendError(conn: Connection, code: ErrorCode, message: string): void {
    conn.send({ type: "error", code, message });
  }
}

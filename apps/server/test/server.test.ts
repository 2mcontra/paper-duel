import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionsFromLog, createGame, replay, type GameEvent } from "@paper-duel/engine";
import { autoplay, pair, startGame, startServer, type TestServer } from "./client.js";

let server: TestServer;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.close();
});

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe("http", () => {
  it("serves a health check", async () => {
    const res = await fetch(`${server.baseUrl}/health`);
    expect(await res.json()).toMatchObject({ ok: true, rooms: 0 });
  });
});

describe("rooms", () => {
  it("create and join: both players get seats and a shared room state", async () => {
    const { host, guest, code } = await pair(server);
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    const room = await guest.next("room_state");
    expect(room.room.seats.map((s) => s?.name)).toEqual(["Host", "Guest"]);
    expect(room.room.phase).toBe("lobby");
    await host.next("opponent_status", (m) => m.connected);
  });

  it("starts when both are ready, and both see the same game", async () => {
    const { host, guest } = await pair(server, { firstPlayer: "host" });
    host.send({ type: "ready", ready: true });
    await host.next("room_state", (m) => m.room.seats[0]?.ready === true);
    expect(host.has("game_started")).toBe(false);
    guest.send({ type: "ready", ready: true });
    const a = await host.next("game_started");
    const b = await guest.next("game_started");
    expect(a.game).toEqual(b.game);
    expect(a.game.turn).toBe(0);
    expect(a.game.players.map((p) => p.name)).toEqual(["Host", "Guest"]);
  });

  it("rejects unknown codes, full rooms, and brute force", async () => {
    const { code } = await pair(server);
    const third = await server.connect();
    third.send({ type: "join_room", code, name: "Third" });
    expect((await third.next("error")).code).toBe("room_full");
    for (let i = 0; i < 10; i++) {
      third.send({ type: "join_room", code: "ZZZZZ", name: "X" });
      expect((await third.next("error")).code).toBe("room_not_found");
    }
    third.send({ type: "join_room", code: "ZZZZZ", name: "X" });
    expect((await third.next("error")).code).toBe("too_many_attempts");
  });

  it("quick match pairs two waiting players", async () => {
    const a = await server.connect();
    const b = await server.connect();
    a.send({ type: "quick_match", name: "A" });
    const ja = await a.next("joined");
    b.send({ type: "quick_match", name: "B" });
    const jb = await b.next("joined");
    expect(jb.code).toBe(ja.code);
    expect([ja.you, jb.you]).toEqual([0, 1]);
    expect((await b.next("room_state")).room.isPublic).toBe(true);
  });

  it("only the host can change rules, and rules are validated", async () => {
    const { host, guest } = await pair(server);
    guest.send({ type: "set_rules", rules: { winTarget: 5 } });
    expect((await guest.next("error")).code).toBe("not_host");
    host.send({ type: "set_rules", rules: { winTarget: 9 } });
    expect((await host.next("error")).code).toBe("bad_rules");
    host.send({ type: "set_rules", rules: { winTarget: 5 } });
    const s = await guest.next("room_state", (m) => m.room.rules.winTarget === 5);
    expect(s.room.seats.every((x) => !x?.ready)).toBe(true);
  });

  it("refuses a second room on the same connection", async () => {
    const { host } = await pair(server);
    host.send({ type: "create_room", name: "Again" });
    expect((await host.next("error")).code).toBe("already_in_room");
  });
});

describe("message validation", () => {
  it("rejects malformed input without dropping the connection", async () => {
    const c = await server.connect();
    c.sendRaw("not json");
    expect((await c.next("error")).code).toBe("bad_message");
    c.sendUnchecked({ type: "launch_missiles" });
    expect((await c.next("error")).code).toBe("bad_message");
    c.sendUnchecked({ type: "create_room", name: "A", extra: 1 });
    expect((await c.next("error")).code).toBe("bad_message");
    c.send({ type: "create_room", name: "x".repeat(21) });
    expect((await c.next("error")).code).toBe("bad_message");
    c.send({ type: "create_room", name: "\u0000​  " });
    expect((await c.next("error")).code).toBe("bad_message");
    c.send({ type: "ping" });
    await c.next("pong");
  });

  it("strips control characters from names", async () => {
    const c = await server.connect();
    c.send({ type: "create_room", name: "  Al\u0007ice \n Bob " });
    const s = await c.next("room_state");
    expect(s.room.seats[0]?.name).toBe("Alice Bob");
  });

  it("rate limits a flooding connection", async () => {
    const c = await server.connect();
    for (let i = 0; i < 40; i++) c.send({ type: "ping" });
    expect((await c.next("error")).code).toBe("rate_limited");
    const pongs = c.inbox.filter((m) => m.type === "pong").length;
    expect(pongs).toBeLessThanOrEqual(21);
    expect(c.inbox.filter((m) => m.type === "error")).toHaveLength(0); // only one error was sent
  });
});

describe("turns", () => {
  it("only the current player can open the book, and only while playing", async () => {
    const { host, guest } = await pair(server);
    host.send({ type: "open_book" });
    expect((await host.next("error")).code).toBe("wrong_phase");
    host.send({ type: "ready", ready: true });
    guest.send({ type: "ready", ready: true });
    await host.next("game_started");
    // firstPlayer defaults to random; find out who moves first.
    const timer = await host.next("turn_timer");
    const [mover, waiter] = timer.player === 0 ? [host, guest] : [guest, host];
    waiter.send({ type: "open_book" });
    expect((await waiter.next("error")).code).toBe("not_your_turn");
    server.pages.push(137);
    mover.send({ type: "open_book" });
    const r = await waiter.next("turn_result");
    expect(r.events[0]).toEqual({ type: "BookOpened", player: timer.player, page: 137, digit: 7 });
    expect(types(r.events)).toEqual(["BookOpened", "PartDrawn", "TurnPassed"]);
    expect(r.auto).toBe(false);
    // The same player can't act twice in a row.
    mover.send({ type: "open_book" });
    expect((await mover.next("error")).code).toBe("not_your_turn");
  });

  it("plays a full game to a winner, and the log replays to the same result", async () => {
    // Bots answer instantly, faster than the 10 msg/s limit allows; lift it for this game.
    await server.close();
    server = await startServer({ messagesPerSecond: 10_000, messageBurst: 10_000 });
    const { host, guest, game } = await startGame(server);
    autoplay(host, 0);
    autoplay(guest, 1);
    // Kick off: the host's first turn_timer was already delivered before autoplay attached.
    host.send({ type: "open_book" });
    const a = await host.next("game_over", undefined, 10_000);
    const b = await guest.next("game_over", undefined, 10_000);
    expect(a).toEqual(b);
    expect(a.reason).toBe("fights_won");
    expect([0, 1]).toContain(a.winner);
    const loser = a.game.players[1 - a.winner!]!;
    expect(loser.slots.filter((s) => s.status === "eliminated")).toHaveLength(3);

    const initial = createGame({
      id: game.id,
      players: [game.players[0], game.players[1]],
      firstTurn: game.turn,
      rules: game.rules,
    });
    expect(replay(initial, actionsFromLog(a.game.log))).toEqual(a.game);

    const room = await host.next("room_state", (m) => m.room.phase === "finished");
    expect(room.room.seats.every((s) => s && !s.wantsRematch)).toBe(true);
  }, 15_000);

  it("auto-rolls when the turn timer runs out", async () => {
    const { host } = await startGame(server, { turnTimerSeconds: 5 }); // 5 * 10 ms in tests
    const t = await host.next("turn_timer");
    expect(t.deadline).toBeTypeOf("number");
    const r = await host.next("turn_result");
    expect(r.auto).toBe(true);
    expect(r.events[0]).toMatchObject({ type: "BookOpened", player: 0 });
  });

  it("R3 choose: asks the armed player, who can skip", async () => {
    // Host builds slot 1 to armed while the guest wastes turns on even pages.
    server.pages.push(1, 2, 11, 2, 21, 2, 31, 2, 41, 2, 51);
    const { host, guest } = await startGame(server, { armedRoll: "choose" });
    for (let i = 0; i < 5; i++) {
      host.send({ type: "open_book" });
      await guest.next("turn_result");
      guest.send({ type: "open_book" });
      await host.next(
        "turn_result",
        (m) => m.events[0]?.type === "BookOpened" && m.events[0].player === 1,
      );
    }
    host.send({ type: "open_book" });
    const ask = await guest.next("turn_result", (m) =>
      m.events.some((e) => e.type === "AttackChoiceRequired"),
    );
    expect(ask.events.at(-1)).toEqual({ type: "AttackChoiceRequired", player: 0, slot: 1 });
    host.send({ type: "open_book" });
    expect((await host.next("error")).code).toBe("illegal_action");
    guest.send({ type: "choose", attack: true });
    expect((await guest.next("error")).code).toBe("not_your_turn");
    host.send({ type: "choose", attack: false });
    const skip = await guest.next("turn_result", (m) => m.events[0]?.type === "AttackSkipped");
    expect(skip.game.turn).toBe(1);
  });

  it("rematch starts a new game once both players vote", async () => {
    // winTarget 1: host arms slot 1, guest builds slot 1 to a gun, host fires and wins.
    server.pages.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1);
    const { host, guest, game } = await startGame(server, { winTarget: 1 });
    autoplay(host, 0);
    autoplay(guest, 1);
    host.send({ type: "open_book" });
    const over = await guest.next("game_over");
    expect(over.winner).toBe(0);
    host.send({ type: "rematch" });
    await guest.next("room_state", (m) => m.room.seats[0]?.wantsRematch === true);
    guest.send({ type: "rematch" });
    const next = await host.next("game_started");
    expect(next.game.id).not.toBe(game.id);
    expect(next.game.rules.winTarget).toBe(1);
  });
});

describe("leaving and reconnecting", () => {
  it("leaving mid-game forfeits; the leaver hears nothing more", async () => {
    const { host, guest } = await startGame(server);
    guest.send({ type: "leave" });
    expect((await guest.next("left")).reason).toBe("you_left");
    const over = await host.next("game_over");
    expect(over).toMatchObject({ winner: 0, reason: "forfeit" });
    const lobby = await host.next("room_state", (m) => m.room.phase === "lobby");
    expect(lobby.room.seats[1]).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(guest.inbox.some((m) => m.type === "game_over")).toBe(false);
  });

  it("when the host leaves, the guest becomes host of a fresh lobby", async () => {
    const { host, guest } = await pair(server);
    host.send({ type: "leave" });
    const j = await guest.next("joined", (m) => m.you === 0);
    expect(j.you).toBe(0);
    const s = await guest.next("room_state", (m) => m.room.seats[1] === null);
    expect(s.room.seats[0]?.name).toBe("Guest");
    guest.send({ type: "set_rules", rules: { winTarget: 2 } });
    await guest.next("room_state", (m) => m.room.rules.winTarget === 2);
  });

  it("resumes within the grace period with full state", async () => {
    const { host, guest, guestToken } = await startGame(server);
    server.pages.push(5);
    host.send({ type: "open_book" });
    await guest.next("turn_result");
    await guest.close();
    const down = await host.next("opponent_status", (m) => !m.connected);
    expect(down.graceDeadline).toBeTypeOf("number");

    const back = await server.connect();
    back.send({ type: "resume", sessionToken: guestToken });
    expect((await back.next("joined")).you).toBe(1);
    const snap = await back.next("game_state");
    expect(snap.game.players[0].slots[2]?.stage).toBe(1); // host's slot 5 has a head
    expect(snap.game.turn).toBe(1);
    await host.next("opponent_status", (m) => m.connected);

    // The game carries on, and the grace timer was cancelled.
    back.send({ type: "open_book" });
    await host.next("turn_result");
    await new Promise((r) => setTimeout(r, 300));
    expect(host.has("game_over")).toBe(false);
  });

  it("forfeits when the grace period runs out", async () => {
    const { host, guest, guestToken } = await startGame(server);
    await guest.close();
    const over = await host.next("game_over", undefined, 2000);
    expect(over).toMatchObject({ winner: 0, reason: "forfeit" });
    const late = await server.connect();
    late.send({ type: "resume", sessionToken: guestToken });
    expect((await late.next("error")).code).toBe("session_not_found");
  });

  it("a second connection with the same token replaces the first", async () => {
    const { guest, guestToken } = await pair(server);
    const tab2 = await server.connect();
    tab2.send({ type: "resume", sessionToken: guestToken });
    await tab2.next("joined");
    expect((await guest.next("left")).reason).toBe("replaced");
    guest.send({ type: "ready", ready: true });
    expect((await guest.next("error")).code).toBe("not_in_room");
  });

  it("a game starts when a ready player reconnects to a ready opponent", async () => {
    const { host, guest, guestToken } = await pair(server);
    guest.send({ type: "ready", ready: true });
    await host.next("room_state", (m) => m.room.seats[1]?.ready === true);
    await guest.close();
    await host.next("opponent_status", (m) => !m.connected);
    host.send({ type: "ready", ready: true });
    await host.next("room_state", (m) => m.room.seats[0]?.ready === true);
    expect(host.has("game_started")).toBe(false);
    const back = await server.connect();
    back.send({ type: "resume", sessionToken: guestToken });
    await back.next("game_started");
    await host.next("game_started");
  });

  it("an empty room is deleted", async () => {
    const c = await server.connect();
    c.send({ type: "create_room", name: "Solo" });
    await c.next("joined");
    expect(
      ((await (await fetch(`${server.baseUrl}/health`)).json()) as { rooms: number }).rooms,
    ).toBe(1);
    c.send({ type: "leave" });
    await c.next("left");
    expect(
      ((await (await fetch(`${server.baseUrl}/health`)).json()) as { rooms: number }).rooms,
    ).toBe(0);
  });
});

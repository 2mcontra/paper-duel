import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHidden, type GameEvent } from "@paper-duel/engine";
import { autoplay, room, startGame, startServer, type TestServer } from "./client.js";

let server: TestServer;
beforeEach(async () => {
  server = await startServer();
});
afterEach(async () => {
  await server.close();
});

const types = (events: GameEvent[]) => events.map((e) => e.type);
const health = async () =>
  (await (await fetch(`${server.baseUrl}/health`)).json()) as { ok: boolean; rooms: number };

describe("http", () => {
  it("serves a health check", async () => {
    expect(await health()).toMatchObject({ ok: true, rooms: 0 });
  });
});

describe("lobby", () => {
  it("seats players in join order; seat 0 is the host", async () => {
    const { clients, code } = await room(server, 3);
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    const s = await clients[2]!.next("room_state", (m) => m.room.seats.length === 3);
    expect(s.room.seats.map((x) => x.name)).toEqual(["P0", "P1", "P2"]);
    expect(s.room.maxPlayers).toBe(6);
    expect(s.room.phase).toBe("lobby");
  });

  it("enforces the room size, and only the host configures it", async () => {
    const { clients, code } = await room(server, 2, {}, 2);
    const third = await server.connect();
    third.send({ type: "join_room", code, name: "P2" });
    expect((await third.next("error")).code).toBe("room_full");

    clients[1]!.send({ type: "configure", maxPlayers: 4 });
    expect((await clients[1]!.next("error")).code).toBe("not_host");
    clients[0]!.send({ type: "configure", rules: { lives: 9 } });
    expect((await clients[0]!.next("error")).code).toBe("bad_rules");
    clients[0]!.send({ type: "configure", maxPlayers: 4, rules: { lives: 2 } });
    const s = await clients[1]!.next("room_state", (m) => m.room.maxPlayers === 4);
    expect(s.room.rules.lives).toBe(2);

    third.send({ type: "join_room", code, name: "P2" });
    await third.next("joined", (m) => m.you === 2);
    clients[0]!.send({ type: "configure", maxPlayers: 2 });
    expect((await clients[0]!.next("error")).message).toMatch(/3 players/);
  });

  it("rejects unknown codes and brute force", async () => {
    const c = await server.connect();
    for (let i = 0; i < 10; i++) {
      c.send({ type: "join_room", code: "ZZZZZ", name: "X" });
      expect((await c.next("error")).code).toBe("room_not_found");
    }
    c.send({ type: "join_room", code: "ZZZZZ", name: "X" });
    expect((await c.next("error")).code).toBe("too_many_attempts");
  });

  it("only the host starts, with 2+ players who are all ready", async () => {
    const solo = await server.connect();
    solo.send({ type: "create_room", name: "Solo" });
    await solo.next("joined");
    solo.send({ type: "ready", ready: true });
    solo.send({ type: "start" });
    expect((await solo.next("error")).code).toBe("not_ready");

    const { clients } = await room(server, 3);
    clients[0]!.send({ type: "ready", ready: true });
    clients[1]!.send({ type: "ready", ready: true });
    await clients[0]!.next("room_state", (m) => m.room.seats.filter((s) => s.ready).length === 2);
    clients[0]!.send({ type: "start" });
    expect((await clients[0]!.next("error")).code).toBe("not_ready");
    clients[2]!.send({ type: "ready", ready: true });
    clients[1]!.send({ type: "start" });
    expect((await clients[1]!.next("error")).code).toBe("not_host");
    await clients[0]!.next("room_state", (m) => m.room.seats.every((s) => s.ready));
    clients[0]!.send({ type: "start" });
    for (const c of clients) await c.next("game_started");
  });

  it("a full room where everyone is ready starts by itself", async () => {
    const { clients } = await room(server, 2, {}, 2);
    for (const c of clients) c.send({ type: "ready", ready: true });
    for (const c of clients) await c.next("game_started");
  });

  it("quick match fills a public room", async () => {
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

  it("when the host leaves, everyone moves up a seat", async () => {
    const { clients } = await room(server, 3);
    clients[0]!.send({ type: "leave" });
    await clients[0]!.next("left");
    expect((await clients[1]!.next("joined", (m) => m.you === 0)).you).toBe(0);
    expect((await clients[2]!.next("joined", (m) => m.you === 1)).you).toBe(1);
    const s = await clients[1]!.next("room_state", (m) => m.room.seats[0]?.name === "P1");
    expect(s.room.seats.map((x) => x.name)).toEqual(["P1", "P2"]);
  });

  it("an empty room is deleted", async () => {
    const c = await server.connect();
    c.send({ type: "create_room", name: "Solo" });
    await c.next("joined");
    expect((await health()).rooms).toBe(1);
    c.send({ type: "leave" });
    await c.next("left");
    expect((await health()).rooms).toBe(0);
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
    c.sendUnchecked({ type: "create_room", name: "A", maxPlayers: 7 });
    expect((await c.next("error")).code).toBe("bad_message");
    c.sendUnchecked({ type: "play_card", play: { card: "nuke" } });
    expect((await c.next("error")).code).toBe("bad_message");
    c.send({ type: "create_room", name: "x".repeat(21) });
    expect((await c.next("error")).code).toBe("bad_message");
    c.send({ type: "ping" });
    await c.next("pong");
  });

  it("strips control characters from names", async () => {
    const c = await server.connect();
    c.send({ type: "create_room", name: "  Al\u0007ice \n Bob " });
    expect((await c.next("room_state")).room.seats[0]?.name).toBe("Alice Bob");
  });

  it("rate limits a flooding connection, with a single error", async () => {
    const c = await server.connect();
    for (let i = 0; i < 40; i++) c.send({ type: "ping" });
    expect((await c.next("error")).code).toBe("rate_limited");
    expect(c.inbox.filter((m) => m.type === "pong").length).toBeLessThanOrEqual(21);
    expect(c.inbox.filter((m) => m.type === "error")).toHaveLength(0);
  });
});

describe("rounds", () => {
  it("everyone acts; goes stay hidden until the round resolves", async () => {
    server.pages.push(137, 23, 42);
    const { clients } = await startGame(server, 3);
    const [a, b, c] = clients as [
      NonNullable<(typeof clients)[0]>,
      NonNullable<(typeof clients)[0]>,
      NonNullable<(typeof clients)[0]>,
    ];
    a.send({ type: "open_book" });
    const mine = await a.next("game_update");
    expect(mine.game.pending[0]).toMatchObject({ pages: [137], done: true });
    const theirs = await b.next("game_update");
    expect(theirs.events).toEqual([{ type: "PlayerReady", player: 0 }]);
    expect(isHidden(theirs.game.pending[0]!)).toBe(true);
    expect(theirs.game.players[0]!.slots[3]!.stage).toBe(0); // nothing resolved yet

    a.send({ type: "open_book" });
    expect((await a.next("error")).code).toBe("illegal_action");

    b.send({ type: "open_book" });
    await b.next("game_update", (m) =>
      m.events.some((e) => e.type === "PlayerReady" && e.player === 1),
    );
    c.send({ type: "open_book" });
    const resolved = await c.next("game_update", (m) => m.game.round === 2);
    expect(types(resolved.events)).toEqual([
      "PlayerReady",
      "BookOpened",
      "PartDrawn",
      "BookOpened",
      "PartDrawn",
      "BookOpened",
      "TurnWasted",
      "RoundStarted",
    ]);
    expect(resolved.game.players[0]!.slots[3]!.stage).toBe(1); // slot 7
    expect(resolved.game.players[1]!.slots[1]!.stage).toBe(1); // slot 3
    await a.next("round_timer", (m) => m.round === 2);
  });

  it("refuses game actions in the lobby", async () => {
    const { clients } = await room(server, 2);
    clients[0]!.send({ type: "open_book" });
    expect((await clients[0]!.next("error")).code).toBe("wrong_phase");
  });

  it("an armed roll asks for a target when there are several opponents", async () => {
    // P0 builds slot 1 over five rounds while P1 and P2 roll even pages.
    for (let i = 0; i < 5; i++) server.pages.push(10 * (i + 2) + 1, 2, 4);
    server.pages.push(81, 6, 8);
    const { clients } = await startGame(server, 3);
    for (let round = 1; round <= 6; round++) {
      for (const c of clients) c.send({ type: "open_book" });
      if (round < 6) await clients[0]!.next("round_timer", (m) => m.round === round + 1);
    }
    const ask = await clients[0]!.next("game_update", (m) => {
      const sub = m.game.pending[0];
      return !!sub && !isHidden(sub) && sub.needsTarget;
    });
    expect(ask.game.round).toBe(6);
    clients[0]!.send({ type: "set_target", targets: [0] });
    expect((await clients[0]!.next("error")).code).toBe("illegal_action");
    clients[0]!.send({ type: "set_target", targets: [2] });
    const shot = await clients[1]!.next("game_update", (m) =>
      m.events.some((e) => e.type === "ShotFired"),
    );
    expect(shot.events).toContainEqual({ type: "ShotFired", attacker: 0, targets: [2], slot: 1 });
    expect(shot.events).toContainEqual({
      type: "AttackMissed",
      attacker: 0,
      target: 2,
      slot: 1,
      reason: "target_unarmed",
    });
  });

  it("playing a card you don't hold is refused", async () => {
    const { clients } = await startGame(server, 2);
    clients[0]!.send({ type: "play_card", play: { card: "shield", slot: 1 } });
    expect((await clients[0]!.next("error")).code).toBe("illegal_action");
  });

  it("when the round timer runs out, the server acts for everyone not done", async () => {
    const { clients } = await startGame(server, 3, { roundTimerSeconds: 5 }); // 5 * 10 ms in tests
    const t = await clients[0]!.next("round_timer", (m) => m.round === 1);
    expect(t.deadline).toBeTypeOf("number");
    clients[1]!.send({ type: "open_book" });
    const u = await clients[0]!.next("game_update", (m) => m.auto.length > 0);
    expect(u.auto.sort()).toEqual([0, 2]);
    expect(u.game.round).toBe(2);
  });

  it("plays complete 3- and 6-player games to a single winner", async () => {
    await server.close();
    server = await startServer({ messagesPerSecond: 10_000, messageBurst: 10_000 });
    for (const count of [3, 6]) {
      const { clients, views } = await startGame(server, count, { lives: 2 });
      clients.forEach((c, i) => autoplay(c, i, views[i]));
      const overs = await Promise.all(clients.map((c) => c.next("game_over", undefined, 20_000)));
      const winner = overs[0]!.winner;
      expect(overs.every((o) => o.winner === winner)).toBe(true);
      expect(overs[0]!.reason).toBe("last_standing");
      const final = overs[0]!.game;
      expect(final.players.filter((p) => !p.out)).toHaveLength(1);
      expect(final.players[winner!]!.out).toBe(false);
      const errors = clients.flatMap((c) => c.inbox.filter((m) => m.type === "error"));
      expect(errors).toEqual([]);
      for (const c of clients) {
        c.send({ type: "leave" });
        await c.next("left");
      }
    }
  }, 30_000);

  it("rematch starts a new game once everyone votes", async () => {
    await server.close();
    server = await startServer({ messagesPerSecond: 10_000, messageBurst: 10_000 });
    const { clients, game, views } = await startGame(server, 2, { lives: 1 });
    clients.forEach((c, i) => autoplay(c, i, views[i]));
    for (const c of clients) await c.next("game_over", undefined, 10_000);
    clients[0]!.send({ type: "rematch" });
    await clients[1]!.next("room_state", (m) => m.room.seats[0]?.wantsRematch === true);
    clients[1]!.send({ type: "rematch" });
    const next = await clients[0]!.next("game_started", (m) => m.game.id !== game.id);
    expect(next.game.rules.lives).toBe(1);
  }, 15_000);
});

describe("emotes", () => {
  it("are shown to the whole room, with a cooldown", async () => {
    const { clients } = await room(server, 3);
    clients[1]!.send({ type: "emote", emote: "laugh" });
    for (const c of clients)
      expect(await c.next("emote")).toEqual({ type: "emote", from: 1, emote: "laugh" });
    clients[1]!.send({ type: "emote", emote: "fire" });
    await new Promise((r) => setTimeout(r, 100));
    expect(clients[0]!.has("emote")).toBe(false);
  });
});

describe("leaving and reconnecting", () => {
  it("leaving a 3-player game knocks you out; the rest play on", async () => {
    const { clients } = await startGame(server, 3);
    clients[2]!.send({ type: "leave" });
    expect((await clients[2]!.next("left")).reason).toBe("you_left");
    const u = await clients[0]!.next("game_update");
    expect(u.events).toContainEqual({ type: "PlayerOut", player: 2, reason: "left", by: null });
    expect(u.game.phase).toBe("playing");
    const s = await clients[0]!.next("room_state", (m) => m.room.seats[2]?.left === true);
    expect(s.room.seats).toHaveLength(3);
    // The round no longer waits for the player who left.
    clients[0]!.send({ type: "open_book" });
    clients[1]!.send({ type: "open_book" });
    await clients[0]!.next("round_timer", (m) => m.round === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(clients[2]!.has("game_update")).toBe(false);
  });

  it("leaving a 2-player game ends it; the seat goes once the game is over", async () => {
    const { clients } = await startGame(server, 2);
    clients[1]!.send({ type: "leave" });
    const over = await clients[0]!.next("game_over");
    expect(over).toMatchObject({ winner: 0, reason: "last_standing" });
    const s = await clients[0]!.next("room_state", (m) => m.room.seats.length === 1);
    expect(s.room.phase).toBe("lobby");
  });

  it("resumes within the grace period with your own view", async () => {
    server.pages.push(5);
    const { clients, tokens } = await startGame(server, 2);
    clients[1]!.send({ type: "open_book" });
    await clients[1]!.next("game_update");
    await clients[1]!.close();
    const down = await clients[0]!.next("room_state", (m) => m.room.seats[1]?.connected === false);
    expect(down.room.seats[1]!.graceDeadline).toBeTypeOf("number");

    const back = await server.connect();
    back.send({ type: "resume", sessionToken: tokens[1]! });
    expect((await back.next("joined")).you).toBe(1);
    const snap = await back.next("game_state");
    expect(snap.game.pending[1]).toMatchObject({ pages: [5], done: true });
    expect(isHidden(snap.game.pending[0]!)).toBe(true);
    await clients[0]!.next("room_state", (m) => m.room.seats[1]?.connected === true);
    await new Promise((r) => setTimeout(r, 300)); // past the grace period: not knocked out
    expect(clients[0]!.has("game_over")).toBe(false);
  });

  it("running out of reconnect time knocks you out", async () => {
    const { clients, tokens } = await startGame(server, 3);
    await clients[2]!.close();
    const u = await clients[0]!.next(
      "game_update",
      (m) => m.events.some((e) => e.type === "PlayerOut"),
      2000,
    );
    expect(u.events).toContainEqual({ type: "PlayerOut", player: 2, reason: "left", by: null });
    const late = await server.connect();
    late.send({ type: "resume", sessionToken: tokens[2]! });
    expect((await late.next("error")).code).toBe("session_not_found");
  });

  it("a ready player reconnecting to a full, ready room starts the game", async () => {
    const { clients, tokens } = await room(server, 2, {}, 2);
    clients[1]!.send({ type: "ready", ready: true });
    await clients[0]!.next("room_state", (m) => m.room.seats[1]?.ready === true);
    await clients[1]!.close();
    await clients[0]!.next("room_state", (m) => m.room.seats[1]?.connected === false);
    clients[0]!.send({ type: "ready", ready: true });
    await clients[0]!.next("room_state", (m) => m.room.seats[0]?.ready === true);
    expect(clients[0]!.has("game_started")).toBe(false);
    const back = await server.connect();
    back.send({ type: "resume", sessionToken: tokens[1]! });
    await back.next("game_started");
  });

  it("a second connection with the same token replaces the first", async () => {
    const { clients, tokens } = await room(server, 2);
    const tab2 = await server.connect();
    tab2.send({ type: "resume", sessionToken: tokens[1]! });
    await tab2.next("joined");
    expect((await clients[1]!.next("left")).reason).toBe("replaced");
    clients[1]!.send({ type: "ready", ready: true });
    expect((await clients[1]!.next("error")).code).toBe("not_in_room");
  });
});

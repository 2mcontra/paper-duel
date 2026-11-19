import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { TestClient, autoplay, room, startGame, startServer, type TestServer } from "./client.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Resolves with the HTTP status if the upgrade is refused, or "open" if it succeeds. */
function tryConnect(url: string, options: WebSocket.ClientOptions = {}): Promise<number | "open"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.once("open", () => {
      resolve("open");
      ws.close();
    });
    ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.once("error", () => {});
  });
}

describe("connection limits", () => {
  it("only accepts allowed origins when configured", async () => {
    server = await startServer({ allowedOrigins: ["https://duel.example"] });
    expect(await tryConnect(server.url, { origin: "https://duel.example" })).toBe("open");
    expect(await tryConnect(server.url, { origin: "https://evil.example" })).toBe(403);
    expect(await tryConnect(server.url)).toBe(403);
  });

  it("caps connections per IP, and frees the slot on close", async () => {
    server = await startServer({ maxConnectionsPerIp: 2 });
    const a = await server.connect();
    await server.connect();
    expect(await tryConnect(server.url)).toBe(429);
    await a.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(await tryConnect(server.url)).toBe("open");
  });

  it("limits failed room-code guesses per IP across connections", async () => {
    server = await startServer({ maxFailedJoins: 100, maxFailedJoinsPerIp: 3 });
    const a = await server.connect();
    const b = await server.connect();
    for (const c of [a, a, b]) {
      c.send({ type: "join_room", code: "ZZZZZ", name: "X" });
      expect((await c.next("error")).code).toBe("room_not_found");
    }
    b.send({ type: "join_room", code: "ZZZZZ", name: "X" });
    expect((await b.next("error")).code).toBe("too_many_attempts");
    // The window passes.
    server.clock.offset += 11 * 60_000;
    b.send({ type: "join_room", code: "ZZZZZ", name: "X" });
    expect((await b.next("error")).code).toBe("room_not_found");
  });

  it("drops a connection that stops answering pings; the player gets the grace period", async () => {
    server = await startServer({ heartbeatMs: 40 });
    const { clients } = await room(server, 2);
    const ghost = await TestClient.connect(server.url, { autoPong: false });
    server.clients.push(ghost);
    ghost.send({ type: "ping" });
    await ghost.next("pong");
    const closed = new Promise<void>((r) => ghost.ws.once("close", () => r()));
    await closed; // terminated by the server's heartbeat
    // A healthy client (auto-pong) is still connected.
    clients[0]!.send({ type: "ping" });
    await clients[0]!.next("pong");
  });
});

describe("idle rooms", () => {
  it("closes a lobby nobody has touched in 30 minutes", async () => {
    server = await startServer();
    const { clients } = await room(server, 2);
    server.manager.sweep();
    expect(server.manager.stats.rooms).toBe(1);
    server.clock.offset += 31 * 60_000;
    server.manager.sweep();
    for (const c of clients) expect((await c.next("left")).reason).toBe("idle");
    expect(server.manager.stats.rooms).toBe(0);
  });

  it("activity keeps a room open", async () => {
    server = await startServer();
    const { clients } = await room(server, 2);
    server.clock.offset += 20 * 60_000;
    clients[1]!.send({ type: "ready", ready: true });
    await clients[0]!.next("room_state", (m) => m.room.seats[1]?.ready === true);
    server.clock.offset += 20 * 60_000;
    server.manager.sweep();
    expect(server.manager.stats.rooms).toBe(1);
  });

  it("closes a finished game after 10 minutes without a rematch", async () => {
    server = await startServer({ messagesPerSecond: 10_000, messageBurst: 10_000 });
    const { clients, views } = await startGame(server, 2, { lives: 1 });
    clients.forEach((c, i) => autoplay(c, i, views[i]));
    for (const c of clients) await c.next("game_over", undefined, 10_000);
    server.clock.offset += 9 * 60_000;
    server.manager.sweep();
    expect(server.manager.stats.rooms).toBe(1);
    server.clock.offset += 2 * 60_000;
    server.manager.sweep();
    for (const c of clients) expect((await c.next("left")).reason).toBe("idle");
    expect(server.manager.stats.rooms).toBe(0);
  });
});

describe("errors in timers", () => {
  it("are logged instead of crashing the server", async () => {
    const errors: string[] = [];
    let explode = true;
    server = await startServer({
      onError: (_err, where) => errors.push(where),
      randomPage: () => {
        if (explode) {
          explode = false;
          throw new Error("book on fire");
        }
        return 2;
      },
    });
    const { clients } = await startGame(server, 2, { roundTimerSeconds: 5 });
    await new Promise((r) => setTimeout(r, 150));
    expect(errors).toContain("round timer");
    // The server is still up and the game can continue.
    clients[0]!.send({ type: "open_book" });
    await clients[0]!.next("game_update");
    clients[0]!.send({ type: "ping" });
    await clients[0]!.next("pong");
  });
});

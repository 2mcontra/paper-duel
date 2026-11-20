import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@paper-duel/protocol";
import { createRng, legalMoves, randomPage, type GameView, type Move } from "@paper-duel/engine";
import { buildApp, type AppOptions } from "../src/app.js";
import type { RoomManager } from "../src/rooms.js";

type Msg<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

/** A WebSocket client that records every message and lets tests await specific ones. */
export class TestClient {
  readonly inbox: ServerMessage[] = [];
  private waiters: (() => void)[] = [];
  private listeners: ((m: ServerMessage) => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage;
      this.inbox.push(msg);
      for (const l of this.listeners) l(msg);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static connect(url: string, options: WebSocket.ClientOptions = {}): Promise<TestClient> {
    const ws = new WebSocket(url, options);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(new TestClient(ws)));
      ws.once("error", reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Sends anything, for testing how the server handles bad input. */
  sendUnchecked(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(data: string): void {
    this.ws.send(data);
  }

  onMessage(fn: (m: ServerMessage) => void): void {
    this.listeners.push(fn);
  }

  /** Removes and returns the first message of `type` (matching `pred`), waiting if needed. */
  async next<T extends ServerMessage["type"]>(
    type: T,
    pred: (m: Msg<T>) => boolean = () => true,
    timeoutMs = 2000,
  ): Promise<Msg<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && pred(m as Msg<T>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Msg<T>;
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(
          `Timed out waiting for ${type}; inbox: ${this.inbox.map((m) => m.type).join(", ")}`,
        );
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  has(type: ServerMessage["type"]): boolean {
    return this.inbox.some((m) => m.type === type);
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close();
    });
  }
}

export interface TestServer {
  url: string;
  baseUrl: string;
  /** Pages the book returns next, in order; after that, seeded random pages. */
  pages: number[];
  clients: TestClient[];
  manager: RoomManager;
  /** Added to the server's clock; move it forward to make time pass. */
  clock: { offset: number };
  connect(options?: WebSocket.ClientOptions): Promise<TestClient>;
  close(): Promise<void>;
}

export async function startServer(opts: AppOptions = {}): Promise<TestServer> {
  const pages: number[] = [];
  const rng = createRng(99);
  const clock = { offset: 0 };
  const { app, manager } = await buildApp({
    now: () => Date.now() + clock.offset,
    onError: (err) => {
      throw err;
    },
    graceMs: 200,
    secondMs: 10,
    randomPage: (total) => pages.shift() ?? randomPage(total, rng),
    randomInt: (n) => Math.floor(rng() * n),
    ...opts,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const clients: TestClient[] = [];
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    baseUrl: `http://127.0.0.1:${port}`,
    pages,
    clients,
    manager,
    clock,
    async connect(options) {
      const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`, options);
      clients.push(c);
      return c;
    },
    async close() {
      await Promise.all(clients.map((c) => c.close()));
      await app.close();
    },
  };
}

/** Host creates a room and `count - 1` guests join. Returns clients in seat order. */
export async function room(
  server: TestServer,
  count = 2,
  rules: Record<string, unknown> = {},
  maxPlayers = 6,
) {
  const host = await server.connect();
  host.send({ type: "create_room", name: "P0", rules, maxPlayers } as ClientMessage);
  const joined = await host.next("joined");
  const clients = [host];
  const tokens = [joined.sessionToken];
  for (let i = 1; i < count; i++) {
    const c = await server.connect();
    c.send({ type: "join_room", code: joined.code.toLowerCase(), name: `P${i}` });
    tokens.push((await c.next("joined")).sessionToken);
    clients.push(c);
  }
  return { clients, tokens, code: joined.code };
}

/** Seats `count` players, readies everyone, and has the host start. Timer off unless given. */
export async function startGame(
  server: TestServer,
  count = 2,
  rules: Record<string, unknown> = {},
) {
  const r = await room(server, count, { turnTimerSeconds: null, firstPlayer: "host", ...rules });
  for (const c of r.clients) c.send({ type: "ready", ready: true });
  // A full room (6) starts by itself once everyone is ready; otherwise the host starts it.
  if (count < 6) {
    await r.clients[0]!.next("room_state", (m) => m.room.seats.every((s) => s.ready));
    r.clients[0]!.send({ type: "start" });
  }
  const starts = await Promise.all(r.clients.map((c) => c.next("game_started")));
  return { ...r, game: starts[0]!.game, views: starts.map((m) => m.game) };
}

/** An aggressive simple player: shoot if possible, else draw, else walk, else pass. */
export function simpleMove(game: GameView, you: number): Move {
  const moves = legalMoves(game, you);
  return (
    moves.find((m) => m.kind === "shoot") ??
    moves.find((m) => m.kind === "draw") ??
    moves.find((m) => m.kind === "move") ?? { kind: "pass" }
  );
}

/** Plays automatically: on this player's turn, opens the book, then makes a simple move. */
export function autoplay(client: TestClient, you: number, current?: GameView): void {
  let lastKey = "";
  const act = (game: GameView) => {
    if (game.phase !== "playing" || game.turn.player !== you) return;
    // Other players' updates also land here; don't resend for a step already sent.
    const key = `${game.id}:${game.turnNumber}:${game.turn.roll}`;
    if (key === lastKey) return;
    lastKey = key;
    if (game.turn.roll === null) client.send({ type: "open_book" });
    else client.send({ type: "act", move: simpleMove(game, you) });
  };
  client.onMessage((m) => {
    if (m.type === "game_started" || m.type === "game_update" || m.type === "game_state")
      act(m.game);
  });
  if (current) act(current);
}

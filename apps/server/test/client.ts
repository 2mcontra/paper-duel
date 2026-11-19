import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@paper-duel/protocol";
import { createRng, isHidden, randomPage, type GameView } from "@paper-duel/engine";
import { buildApp, type AppOptions } from "../src/app.js";

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

  static connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
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
  connect(): Promise<TestClient>;
  close(): Promise<void>;
}

export async function startServer(opts: AppOptions = {}): Promise<TestServer> {
  const pages: number[] = [];
  const rng = createRng(99);
  const { app } = await buildApp({
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
    async connect() {
      const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
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
  const r = await room(server, count, { roundTimerSeconds: null, firstPlayer: "host", ...rules });
  for (const c of r.clients) c.send({ type: "ready", ready: true });
  // A full room (6) starts by itself once everyone is ready; otherwise the host starts it.
  if (count < 6) {
    await r.clients[0]!.next("room_state", (m) => m.room.seats.every((s) => s.ready));
    r.clients[0]!.send({ type: "start" });
  }
  const starts = await Promise.all(r.clients.map((c) => c.next("game_started")));
  return { ...r, game: starts[0]!.game, views: starts.map((m) => m.game) };
}

/**
 * Plays automatically: whenever this player's go is unfinished, opens the book, or aims at
 * the first opponent still in.
 */
export function autoplay(client: TestClient, you: number, current?: GameView): void {
  let lastKey = "";
  const act = (game: GameView) => {
    if (game.phase !== "playing") return;
    const sub = game.pending[you];
    if (!sub || isHidden(sub) || sub.done) return;
    // Other players' updates also land here; don't resend for a step already sent.
    const key = `${game.id}:${game.round}:${sub.pages.length}:${sub.needsTarget}`;
    if (key === lastKey) return;
    lastKey = key;
    if (sub.needsTarget) {
      const want = sub.card?.card === "double_shot" ? 2 : 1;
      const targets = game.players
        .flatMap((p, i) => (i !== you && !p.out ? [i] : []))
        .slice(0, want);
      client.send({ type: "set_target", targets });
    } else {
      client.send({ type: "open_book" });
    }
  };
  client.onMessage((m) => {
    if (m.type === "game_started" || m.type === "game_update" || m.type === "game_state")
      act(m.game);
  });
  if (current) act(current);
}

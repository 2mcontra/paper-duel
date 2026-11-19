import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "@paper-duel/protocol";
import { createRng, randomPage, type GameState } from "@paper-duel/engine";
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

/** Host creates a room, guest joins. Returns both clients after "joined". */
export async function pair(server: TestServer, rules: Record<string, unknown> = {}) {
  const host = await server.connect();
  const guest = await server.connect();
  host.send({ type: "create_room", name: "Host", rules });
  const { code, sessionToken: hostToken } = await host.next("joined");
  guest.send({ type: "join_room", code: code.toLowerCase(), name: "Guest" });
  const { sessionToken: guestToken } = await guest.next("joined");
  return { host, guest, code, hostToken, guestToken };
}

export async function startGame(server: TestServer, rules: Record<string, unknown> = {}) {
  const p = await pair(server, { turnTimerSeconds: null, firstPlayer: "host", ...rules });
  p.host.send({ type: "ready", ready: true });
  p.guest.send({ type: "ready", ready: true });
  const { game } = await p.host.next("game_started");
  await p.guest.next("game_started");
  return { ...p, game };
}

/** Plays automatically: opens the book (or attacks) whenever it is this client's turn. */
export function autoplay(client: TestClient, you: 0 | 1): void {
  let game: GameState | null = null;
  client.onMessage((m) => {
    if (m.type === "game_started" || m.type === "turn_result" || m.type === "game_state") {
      game = m.game;
    } else if (m.type === "turn_timer" && m.player === you && game?.phase === "playing") {
      client.send(
        game.pendingChoice !== null ? { type: "choose", attack: true } : { type: "open_book" },
      );
    }
  });
}

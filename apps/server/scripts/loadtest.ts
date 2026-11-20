/**
 * Load test: fills many rooms with bot players who play real games against a running server.
 *
 *   pnpm --filter @paper-duel/server loadtest --rooms 200 --players 3 --seconds 60
 *
 * The server must allow many connections from one IP, e.g.
 *   MAX_CONNECTIONS_PER_IP=100000 LOG_LEVEL=warn pnpm --filter @paper-duel/server start
 *
 * Bots "think" for a random 0.3-2 s before each action (use --think 0 for a pure stress test).
 * Reported: action round-trip latency (send -> own update), bandwidth, and the server's
 * memory and event-loop delay from /health.
 */
import { parseArgs } from "node:util";
import WebSocket from "ws";
import { legalMoves, type GameView } from "@paper-duel/engine";
import type { ClientMessage, ServerMessage } from "@paper-duel/protocol";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "ws://127.0.0.1:8787/ws" },
    rooms: { type: "string", default: "200" },
    players: { type: "string", default: "3" },
    seconds: { type: "string", default: "60" },
    think: { type: "string", default: "300-2000" },
  },
});
const ROOMS = Number(values.rooms);
const PLAYERS = Number(values.players);
const SECONDS = Number(values.seconds);
const [thinkMin, thinkMax] = values.think.split("-").map(Number) as [number, number?];
const think = () => thinkMin + Math.random() * ((thinkMax ?? thinkMin) - thinkMin);
const healthUrl = values.url.replace(/^ws/, "http").replace(/\/ws$/, "/health");

const latencies: number[] = [];
let bytesIn = 0;
let messagesIn = 0;
let gamesFinished = 0;
let errors = 0;
const errorSamples = new Set<string>();

class Bot {
  ws!: WebSocket;
  you = -1;
  code = "";
  private game: GameView | null = null;
  private sentAt = 0;
  private stepKey = "";
  private waiters: ((m: ServerMessage) => boolean)[] = [];

  async open(): Promise<void> {
    this.ws = new WebSocket(values.url);
    await new Promise<void>((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
    });
    this.ws.on("message", (data) => {
      const text = String(data);
      bytesIn += text.length;
      messagesIn++;
      this.onMessage(JSON.parse(text) as ServerMessage);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  wait(pred: (m: ServerMessage) => boolean): Promise<void> {
    return new Promise((res) => this.waiters.push((m) => (pred(m) ? (res(), true) : false)));
  }

  private onMessage(m: ServerMessage): void {
    this.waiters = this.waiters.filter((w) => !w(m));
    switch (m.type) {
      case "joined":
        this.you = m.you;
        this.code = m.code;
        return;
      case "error":
        errors++;
        if (errorSamples.size < 5) errorSamples.add(`${m.code}: ${m.message}`);
        return;
      case "game_started":
      case "game_state":
        this.game = m.game;
        return this.plan();
      case "game_update":
        if (this.sentAt && m.events.some((e) => "player" in e && e.player === this.you)) {
          latencies.push(performance.now() - this.sentAt);
          this.sentAt = 0;
        }
        this.game = m.game;
        return this.plan();
      case "game_over":
        if (this.you === 0) gamesFinished++;
        this.game = m.game;
        // Play again after a short pause.
        setTimeout(() => this.send({ type: "rematch" }), 500 + Math.random() * 1500);
        return;
      default:
        return;
    }
  }

  /** Schedules this bot's next step on its turn, once. */
  private plan(): void {
    const g = this.game;
    if (!g || g.phase !== "playing" || g.turn.player !== this.you) return;
    const key = `${g.id}:${g.turnNumber}:${g.turn.roll}`;
    if (key === this.stepKey) return;
    this.stepKey = key;
    setTimeout(() => {
      const cur = this.game;
      if (!cur || `${cur.id}:${cur.turnNumber}:${cur.turn.roll}` !== key) return;
      this.sentAt = performance.now();
      if (cur.turn.roll === null) {
        this.send({ type: "open_book" });
      } else {
        const moves = legalMoves(cur, this.you);
        const move = moves.find((m) => m.kind === "shoot") ??
          moves.find((m) => m.kind === "draw") ??
          moves.find((m) => m.kind === "move") ?? { kind: "pass" as const };
        this.send({ type: "act", move });
      }
    }, think());
  }
}

async function fillRoom(): Promise<Bot[]> {
  const host = new Bot();
  await host.open();
  const joined = host.wait((m) => m.type === "joined");
  host.send({ type: "create_room", name: "Host", maxPlayers: PLAYERS });
  await joined;
  const bots = [host];
  for (let i = 1; i < PLAYERS; i++) {
    const b = new Bot();
    await b.open();
    const j = b.wait((m) => m.type === "joined");
    b.send({ type: "join_room", code: host.code, name: `Bot ${i}` });
    await j;
    bots.push(b);
  }
  // A full room starts by itself once everyone is ready.
  for (const b of bots) b.send({ type: "ready", ready: true });
  return bots;
}

async function health() {
  return (await (await fetch(healthUrl)).json()) as {
    rooms: number;
    playing: number;
    connections: number;
    memoryMb: number;
    eventLoopMs: { p50: number; p99: number; max: number };
  };
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0;
};

console.log(
  `Load test: ${ROOMS} rooms x ${PLAYERS} players, ${SECONDS}s, think ${values.think} ms`,
);
const before = await health();
const t0 = performance.now();
const all: Bot[] = [];
for (let i = 0; i < ROOMS; i += 20) {
  const batch = await Promise.all(Array.from({ length: Math.min(20, ROOMS - i) }, fillRoom));
  all.push(...batch.flat());
}
console.log(`  ${all.length} bots connected in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
await health(); // reset the server's event-loop histogram

const samples: Awaited<ReturnType<typeof health>>[] = [];
const runStart = performance.now();
const bytesStart = bytesIn;
const msgsStart = messagesIn;
for (let s = 0; s < SECONDS; s += 10) {
  await new Promise((r) => setTimeout(r, Math.min(10, SECONDS - s) * 1000));
  const h = await health();
  samples.push(h);
  console.log(
    `  t=${Math.min(s + 10, SECONDS)}s rooms=${h.rooms} playing=${h.playing} conns=${h.connections} ` +
      `mem=${h.memoryMb}MB loop p50/p99/max=${h.eventLoopMs.p50}/${h.eventLoopMs.p99}/${h.eventLoopMs.max}ms ` +
      `actions=${latencies.length} games=${gamesFinished}`,
  );
}
const secs = (performance.now() - runStart) / 1000;
console.log(`
Result
  actions           ${latencies.length} (${(latencies.length / secs).toFixed(0)}/s)
  action latency    p50 ${pct(latencies, 0.5).toFixed(1)} ms, p95 ${pct(latencies, 0.95).toFixed(1)} ms, p99 ${pct(latencies, 0.99).toFixed(1)} ms, max ${pct(latencies, 1).toFixed(1)} ms
  games finished    ${gamesFinished}
  server -> clients ${((bytesIn - bytesStart) / secs / 1e6).toFixed(2)} MB/s, ${((messagesIn - msgsStart) / secs).toFixed(0)} msgs/s, avg ${((bytesIn - bytesStart) / Math.max(1, messagesIn - msgsStart) / 1000).toFixed(1)} KB/msg
  server memory     ${before.memoryMb} MB idle -> ${Math.max(...samples.map((s) => s.memoryMb))} MB peak
  event-loop p99    worst ${Math.max(...samples.map((s) => s.eventLoopMs.p99))} ms, max ${Math.max(...samples.map((s) => s.eventLoopMs.max))} ms
  errors            ${errors}${errorSamples.size ? ` e.g. ${[...errorSamples].join("; ")}` : ""}`);
for (const b of all) b.ws.close();
process.exit(0);

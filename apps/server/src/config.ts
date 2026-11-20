import { randomInt } from "node:crypto";

export interface ServerOptions {
  /** How long a dropped player keeps their seat before forfeiting. */
  graceMs: number;
  /** Length of one "second" for turn timers. Tests shrink this. */
  secondMs: number;
  maxRooms: number;
  /** Failed join attempts allowed per connection (brute-force guard). */
  maxFailedJoins: number;
  /** Per-connection message rate limit: sustained rate and burst size. */
  messagesPerSecond: number;
  messageBurst: number;
  /** Largest accepted WebSocket frame in bytes. */
  maxPayloadBytes: number;
  /** Book RNG: a uniform page in 1..totalPages. Must be cryptographically secure in production. */
  randomPage: (totalPages: number) => number;
  /** Uniform integer in [0, n). Used for coin flips and room codes. */
  randomInt: (n: number) => number;
  now: () => number;

  /** Origins allowed to open a WebSocket (exact match, e.g. "https://duel.example"). null = any. */
  allowedOrigins: string[] | null;
  /** Open WebSocket connections allowed per client IP. */
  maxConnectionsPerIp: number;
  /** Failed room-code guesses allowed per IP within `joinWindowMs` (on top of the per-connection limit). */
  maxFailedJoinsPerIp: number;
  joinWindowMs: number;
  /** WebSocket ping interval; a connection that misses a pong by the next ping is dropped. */
  heartbeatMs: number;
  /** A lobby or game with no player activity for this long is closed. */
  idleRoomMs: number;
  /** A finished game nobody rematches is closed after this long. */
  idleFinishedMs: number;
  /** How often idle rooms are swept. */
  sweepMs: number;
  /** Errors from timers and other places with no caller to report to. */
  onError: (err: unknown, where: string) => void;
  /** Notable game events for the server log (room codes and counts only, never names). */
  onLog: (msg: string, fields: Record<string, unknown>) => void;
}

export const DEFAULT_OPTIONS: ServerOptions = {
  graceMs: 60_000,
  secondMs: 1000,
  maxRooms: 1000,
  maxFailedJoins: 10,
  messagesPerSecond: 10,
  messageBurst: 20,
  maxPayloadBytes: 4096,
  randomPage: (totalPages) => 1 + randomInt(0, totalPages),
  randomInt: (n) => randomInt(0, n),
  now: () => Date.now(),
  allowedOrigins: null,
  maxConnectionsPerIp: 20,
  maxFailedJoinsPerIp: 30,
  joinWindowMs: 10 * 60_000,
  heartbeatMs: 30_000,
  idleRoomMs: 30 * 60_000,
  idleFinishedMs: 10 * 60_000,
  sweepMs: 60_000,
  onError: (err, where) => console.error(`[paper-duel] error in ${where}:`, err),
  onLog: () => {},
};

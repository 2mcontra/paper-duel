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
};

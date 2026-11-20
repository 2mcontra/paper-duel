import { z } from "zod";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type GameEvent,
  type GameView,
  type PlayerIndex,
  type RulesConfig,
} from "@paper-duel/engine";

/** Bump when a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 3;

export const MAX_NAME_LENGTH = 20;
export const ROOM_CODE_LENGTH = 5;
/** No 0/O, 1/I/L: easy to read aloud and type. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const EMOTES = ["laugh", "fire", "angry", "lucky", "gg", "shock"] as const;
export type Emote = (typeof EMOTES)[number];
/** Minimum gap between one player's emotes. */
export const EMOTE_COOLDOWN_MS = 1500;

// ---------- client -> server ----------

/** Strips control characters, collapses whitespace, and checks length. */
export const PlayerName = z
  .string()
  .max(100)
  .transform((s) =>
    s
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
  .pipe(z.string().min(1, "Name is required").max(MAX_NAME_LENGTH));

export const RoomCode = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(
    z
      .string()
      .length(ROOM_CODE_LENGTH)
      .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`)),
  );

/** Rule overrides a host may send. Values are re-validated by the engine's resolveRules. */
export const RulesOverrides = z
  .object({
    firstPlayer: z.enum(["random", "host"]),
    bullets: z.enum(["consumed", "reusable"]),
    totalPages: z.number().int(),
    turnTimerSeconds: z.number().int().nullable(),
    figures: z.number().int(),
    luckyCards: z.boolean(),
    maxRounds: z.number().int().nullable(),
  })
  .partial()
  .strict();

const Seat = z
  .number()
  .int()
  .min(0)
  .max(MAX_PLAYERS - 1);
const Fig = z.number().int().min(0).max(4);
const Ref = z.object({ player: Seat, figure: Fig }).strict();
export const MaxPlayers = z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS);

export const CardPlaySchema = z.discriminatedUnion("card", [
  z.object({ card: z.literal("shield"), figure: Fig }).strict(),
  z.object({ card: z.literal("double_shot") }).strict(),
  z.object({ card: z.literal("eraser"), target: Seat, targetFigure: Fig }).strict(),
  z.object({ card: z.literal("swap"), figure: Fig, target: Seat, targetFigure: Fig }).strict(),
  z.object({ card: z.literal("steal"), figure: Fig, target: Seat, targetFigure: Fig }).strict(),
  z.object({ card: z.literal("reroll") }).strict(),
]);

export const MoveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draw"), figure: Fig }).strict(),
  z.object({ kind: z.literal("move"), figure: Fig }).strict(),
  z.object({ kind: z.literal("shoot"), figure: Fig, targets: z.array(Ref).min(1).max(2) }).strict(),
  z.object({ kind: z.literal("pass") }).strict(),
]);

const msg = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape }).strict();

export const ClientMessage = z.discriminatedUnion("type", [
  msg("create_room", {
    name: PlayerName,
    rules: RulesOverrides.optional(),
    maxPlayers: MaxPlayers.optional(),
  }),
  msg("join_room", { code: RoomCode, name: PlayerName }),
  msg("quick_match", { name: PlayerName }),
  /** Host only, lobby only. */
  msg("configure", { rules: RulesOverrides.optional(), maxPlayers: MaxPlayers.optional() }),
  msg("ready", { ready: z.boolean() }),
  /** Host only: start once 2+ players are seated and all are ready. */
  msg("start", {}),
  /** Your turn: open the book (your roll is the page's last digit, 0 = 10). */
  msg("open_book", {}),
  /** After opening the book and before acting, one per turn. */
  msg("play_card", { play: CardPlaySchema }),
  /** What you do with your roll; ends your turn. */
  msg("act", { move: MoveSchema }),
  msg("emote", { emote: z.enum(EMOTES) }),
  msg("rematch", {}),
  msg("leave", {}),
  msg("resume", { sessionToken: z.string().regex(/^[0-9a-f]{32}$/) }),
  msg("ping", {}),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage["type"];

// ---------- server -> client ----------
// Built by our own server, so these are plain types rather than schemas.

export type RoomPhase = "lobby" | "playing" | "finished";

export interface SeatView {
  name: string;
  ready: boolean;
  connected: boolean;
  wantsRematch: boolean;
  /** Left during the current game (the seat is kept until it ends, so indices stay put). */
  left: boolean;
  /** Reconnect deadline (epoch ms) while disconnected. */
  graceDeadline: number | null;
  /** Series score in this room: points (3/2/1 by place) and wins, over every game played here. */
  points: number;
  wins: number;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  maxPlayers: number;
  /** Seated players in seat order; seat 0 is the host. In a game, seat index = player index. */
  seats: SeatView[];
  rules: RulesConfig;
  /** true for rooms created by quick match. */
  isPublic: boolean;
}

export type ErrorCode =
  | "bad_message"
  | "rate_limited"
  | "room_not_found"
  | "room_full"
  | "too_many_attempts"
  | "already_in_room"
  | "not_in_room"
  | "not_host"
  | "bad_rules"
  | "wrong_phase"
  | "not_ready"
  | "illegal_action"
  | "session_not_found"
  | "server_full";

export type ServerMessage =
  /** You hold a seat (create, join, quick match, resume). Re-sent if your seat index changes. */
  | { type: "joined"; protocol: number; sessionToken: string; you: PlayerIndex; code: string }
  | { type: "room_state"; room: RoomView }
  /** A new game began. The game is your view of it: other players' cards and goes are hidden. */
  | { type: "game_started"; game: GameView }
  /** Snapshot of the current game, sent when you resume. Not a new game. */
  | { type: "game_state"; game: GameView }
  /**
   * Something happened: new events (redacted for you) and the updated game. To save bandwidth
   * `game.log` is empty here: append `events` to the log you already have. `auto` lists
   * players the server played for because their turn timer ran out.
   */
  | { type: "game_update"; events: GameEvent[]; game: GameView; auto: PlayerIndex[] }
  /** Deadline for the current turn (server epoch ms), or null when there is no timer. */
  | { type: "turn_timer"; turn: number; deadline: number | null }
  | { type: "game_over"; winner: PlayerIndex | null; reason: GameView["endReason"]; game: GameView }
  | { type: "emote"; from: PlayerIndex; emote: Emote }
  /** You no longer hold a seat: you left, your session was resumed on another connection, or
   * the room was closed after a long time with no activity. */
  | { type: "left"; reason: "you_left" | "replaced" | "idle" }
  | { type: "pong"; serverTime: number }
  | { type: "error"; code: ErrorCode; message: string };

export type ServerMessageType = ServerMessage["type"];

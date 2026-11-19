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
export const PROTOCOL_VERSION = 2;

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
    unarmedTarget: z.enum(["miss", "destroy_partial"]),
    bullets: z.enum(["consumed", "reusable"]),
    ownDeadSlot: z.enum(["waste", "reroll"]),
    totalPages: z.number().int(),
    roundTimerSeconds: z.number().int().nullable(),
    lives: z.number().int(),
    luckyCards: z.boolean(),
    stalemate: z.enum(["most_alive", "draw"]),
  })
  .partial()
  .strict();

const Seat = z
  .number()
  .int()
  .min(0)
  .max(MAX_PLAYERS - 1);
const SlotNum = z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(9)]);
export const MaxPlayers = z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS);

export const CardPlaySchema = z.discriminatedUnion("card", [
  z.object({ card: z.literal("shield"), slot: SlotNum }).strict(),
  z.object({ card: z.literal("double_shot") }).strict(),
  z.object({ card: z.literal("eraser"), target: Seat, slot: SlotNum }).strict(),
  z.object({ card: z.literal("swap"), slots: z.tuple([SlotNum, SlotNum]) }).strict(),
  z.object({ card: z.literal("steal"), target: Seat, slot: SlotNum }).strict(),
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
  /** Queue (or with null, cancel) a card for this round. Before opening the book. */
  msg("play_card", { play: CardPlaySchema.nullable() }),
  msg("open_book", {}),
  msg("set_target", { targets: z.array(Seat).min(1).max(2) }),
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
   * players the server acted for because the round timer ran out.
   */
  | { type: "game_update"; events: GameEvent[]; game: GameView; auto: PlayerIndex[] }
  /** Deadline for the current round (server epoch ms), or null when there is no timer. */
  | { type: "round_timer"; round: number; deadline: number | null }
  | { type: "game_over"; winner: PlayerIndex | null; reason: GameView["endReason"]; game: GameView }
  | { type: "emote"; from: PlayerIndex; emote: Emote }
  /** You no longer hold a seat: you left, your session was resumed on another connection, or
   * the room was closed after a long time with no activity. */
  | { type: "left"; reason: "you_left" | "replaced" | "idle" }
  | { type: "pong"; serverTime: number }
  | { type: "error"; code: ErrorCode; message: string };

export type ServerMessageType = ServerMessage["type"];

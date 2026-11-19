import { z } from "zod";
import type { GameEvent, GameState, PlayerIndex, RulesConfig } from "@paper-duel/engine";

/** Bump when a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export const MAX_NAME_LENGTH = 20;
export const ROOM_CODE_LENGTH = 5;
/** No 0/O, 1/I/L: easy to read aloud and type. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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
    armedRoll: z.enum(["auto_attack", "choose"]),
    unarmedTarget: z.enum(["miss", "destroy_partial"]),
    bullets: z.enum(["consumed", "reusable"]),
    ownDeadSlot: z.enum(["waste", "reroll"]),
    totalPages: z.number().int(),
    turnTimerSeconds: z.number().int().nullable(),
    winTarget: z.number().int(),
    stalemate: z.enum(["most_alive", "draw"]),
  })
  .partial()
  .strict();

const msg = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape }).strict();

export const ClientMessage = z.discriminatedUnion("type", [
  msg("create_room", { name: PlayerName, rules: RulesOverrides.optional() }),
  msg("join_room", { code: RoomCode, name: PlayerName }),
  msg("quick_match", { name: PlayerName }),
  msg("set_rules", { rules: RulesOverrides }),
  msg("ready", { ready: z.boolean() }),
  msg("open_book", {}),
  msg("choose", { attack: z.boolean() }),
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
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  /** Seat 0 is always the host. null = empty seat. */
  seats: [SeatView | null, SeatView | null];
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
  | "not_your_turn"
  | "illegal_action"
  | "session_not_found"
  | "server_full";

export type ServerMessage =
  /** Sent once you hold a seat (create, join, quick match, resume). Keep sessionToken to resume. */
  | { type: "joined"; protocol: number; sessionToken: string; you: PlayerIndex; code: string }
  | { type: "room_state"; room: RoomView }
  | { type: "game_started"; game: GameState }
  /** Full snapshot of a game in progress, sent when you resume. Not a new game. */
  | { type: "game_state"; game: GameState }
  /** One player action (or a timeout auto-action) and its full result. */
  | { type: "turn_result"; events: GameEvent[]; game: GameState; auto: boolean }
  /** Deadline is a server epoch-ms time; null means no timer is running. */
  | { type: "turn_timer"; player: PlayerIndex; deadline: number | null }
  /** Your opponent dropped (graceDeadline is when they forfeit) or came back. */
  | { type: "opponent_status"; connected: boolean; graceDeadline: number | null }
  | {
      type: "game_over";
      winner: PlayerIndex | null;
      reason: GameState["endReason"];
      game: GameState;
    }
  /**
   * You no longer hold a seat: you left, or your session was resumed on another connection. The client should return to the landing screen.
   */
  | { type: "left"; reason: "you_left" | "replaced" }
  | { type: "pong"; serverTime: number }
  | { type: "error"; code: ErrorCode; message: string };

export type ServerMessageType = ServerMessage["type"];

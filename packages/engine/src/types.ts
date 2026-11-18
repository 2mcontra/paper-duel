/** Slot numbers are fixed to the odd digits (rule R1, decided). */
export const SLOT_NUMBERS = [1, 3, 5, 7, 9] as const;
export type SlotNumber = (typeof SLOT_NUMBERS)[number];

/** 0 empty, 1 head, 2 body, 3 face, 4 gun, 5 loaded (armed). */
export type Stage = 0 | 1 | 2 | 3 | 4 | 5;
export const ARMED: Stage = 5;
export const HAS_GUN: Stage = 4;

export type Part = "head" | "body" | "face" | "gun" | "bullets";
/** The part added when a slot moves *to* a stage; index = stage - 1. */
export const PARTS: readonly Part[] = ["head", "body", "face", "gun", "bullets"];

export type SlotStatus = "alive" | "eliminated";
export type PlayerIndex = 0 | 1;

export interface Slot {
  number: SlotNumber;
  stage: Stage;
  status: SlotStatus;
}

export interface PlayerState {
  id: string;
  name: string;
  slots: Slot[];
}

export interface Roll {
  page: number;
  digit: number;
  player: PlayerIndex;
}

export type Phase = "playing" | "finished";
export type EndReason = "all_eliminated" | "stalemate";

export interface RulesConfig {
  /** R2: who takes the first turn. The engine is told the result; the server applies this. */
  firstPlayer: "random" | "host";
  /** R3: rolling an armed slot attacks automatically, or the player chooses attack or skip. */
  armedRoll: "auto_attack" | "choose";
  /** R4: attacking a slot without a gun misses, or resets that partial figure to empty. */
  unarmedTarget: "miss" | "destroy_partial";
  /** R5: firing drops the figure back to "gun, 0 bullets", or the bullets are reusable. */
  bullets: "consumed" | "reusable";
  /** R6: rolling your own eliminated slot wastes the turn, or you roll again. */
  ownDeadSlot: "waste" | "reroll";
  /** R9: pages in the book. Must be a positive multiple of 10 so every digit is equally likely. */
  totalPages: number;
  /** R10: seconds per turn before the server auto-rolls; null disables. Enforced by the server. */
  turnTimerSeconds: number | null;
  /**
   * When no slot number is alive on both sides, nobody can ever be eliminated again.
   * "most_alive": the player with more living slots wins (equal counts draw). "draw": always a draw.
   */
  stalemate: "most_alive" | "draw";
}

export interface GameState {
  id: string;
  phase: Phase;
  players: [PlayerState, PlayerState];
  /** Index of the player whose turn it is. */
  turn: PlayerIndex;
  /** Increments on every book opening (rerolls included). Used for seeding and replays. */
  turnIndex: number;
  lastRoll: Roll | null;
  /** Set under R3 "choose" when the current player rolled an armed slot and must decide. */
  pendingChoice: SlotNumber | null;
  /** Append-only event log. */
  log: GameEvent[];
  /** null while playing, or when the game ended in a draw. */
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  rules: RulesConfig;
}

export type MissReason = "target_eliminated" | "target_unarmed";
export type WasteReason = "even_digit" | "slot_eliminated";

export type GameEvent =
  | { type: "BookOpened"; player: PlayerIndex; page: number; digit: number }
  | { type: "TurnWasted"; player: PlayerIndex; reason: WasteReason }
  | { type: "RerollGranted"; player: PlayerIndex; slot: SlotNumber }
  | { type: "PartDrawn"; player: PlayerIndex; slot: SlotNumber; part: Part; stage: Stage }
  | { type: "AttackChoiceRequired"; player: PlayerIndex; slot: SlotNumber }
  | { type: "AttackSkipped"; player: PlayerIndex; slot: SlotNumber }
  | { type: "SlotEliminated"; attacker: PlayerIndex; slot: SlotNumber }
  | { type: "FigureDestroyed"; attacker: PlayerIndex; slot: SlotNumber }
  | { type: "AttackMissed"; attacker: PlayerIndex; slot: SlotNumber; reason: MissReason }
  | { type: "BulletsSpent"; player: PlayerIndex; slot: SlotNumber }
  | { type: "TurnPassed"; to: PlayerIndex }
  | { type: "GameOver"; winner: PlayerIndex | null; reason: EndReason };

export type Action = { type: "open_book"; page: number } | { type: "choose"; attack: boolean };

export interface TurnResult {
  state: GameState;
  events: GameEvent[];
}

/** Slot numbers are fixed to the odd digits (rule R1, decided). */
export const SLOT_NUMBERS = [1, 3, 5, 7, 9] as const;
export type SlotNumber = (typeof SLOT_NUMBERS)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** 0 empty, 1 head, 2 body, 3 face, 4 gun, 5 loaded (armed). */
export type Stage = 0 | 1 | 2 | 3 | 4 | 5;
export const ARMED: Stage = 5;
export const HAS_GUN: Stage = 4;

export type Part = "head" | "body" | "face" | "gun" | "bullets";
/** The part added when a slot moves *to* a stage; index = stage - 1. */
export const PARTS: readonly Part[] = ["head", "body", "face", "gun", "bullets"];

export const CARDS = ["shield", "double_shot", "eraser", "swap", "steal"] as const;
export type Card = (typeof CARDS)[number];
export const HAND_LIMIT = 3;

export type SlotStatus = "alive" | "eliminated";
/** Seat index in the game, 0 .. players.length - 1. */
export type PlayerIndex = number;

export interface Slot {
  number: SlotNumber;
  stage: Stage;
  status: SlotStatus;
  shielded: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  slots: Slot[];
  /** Knocked out (lost `lives` slots) or left the game. */
  out: boolean;
  hand: Card[];
}

export type CardPlay =
  | { card: "shield"; slot: SlotNumber }
  | { card: "double_shot" }
  | { card: "eraser"; target: PlayerIndex; slot: SlotNumber }
  | { card: "swap"; slots: [SlotNumber, SlotNumber] }
  | { card: "steal"; target: PlayerIndex; slot: SlotNumber };

/** What one player has done so far this round. Hidden from other players until it resolves. */
export interface Submission {
  /** Every page opened this round. More than one only after R6 rerolls; the last one counts. */
  pages: number[];
  /** Card drawn from each page (lucky pages only), aligned with `pages`. Joins the hand on resolve. */
  draws: (Card | null)[];
  /** Who an armed slot fires at (two with a queued double shot). */
  targets: PlayerIndex[];
  /** Waiting for the player to pick a target. */
  needsTarget: boolean;
  card: CardPlay | null;
  done: boolean;
}

export type Phase = "playing" | "finished";
export type EndReason = "last_standing" | "stalemate";

export interface RulesConfig {
  /** R2: who is first in the round order in round 1. The server applies this. */
  firstPlayer: "random" | "host";
  /** R4: shooting a slot without a gun misses, or resets that partial figure to empty. */
  unarmedTarget: "miss" | "destroy_partial";
  /** R5: firing drops the figure back to "gun, 0 bullets", or the bullets are reusable. */
  bullets: "consumed" | "reusable";
  /** R6: opening the book on your own dead slot wastes your go, or you open it again. */
  ownDeadSlot: "waste" | "reroll";
  /** R9: pages in the book. A positive multiple of 10 so every digit is equally likely. */
  totalPages: number;
  /** Seconds per round before the server acts for anyone not done; null disables. */
  roundTimerSeconds: number | null;
  /** Slots a player can lose before they are out, 1..5. */
  lives: number;
  /** Lucky pages give cards. */
  luckyCards: boolean;
  /** R11: nobody can be hit any more. Most living slots wins, or always a draw. */
  stalemate: "most_alive" | "draw";
}

export interface GameState {
  id: string;
  phase: Phase;
  players: PlayerState[];
  /** 1-based round number. */
  round: number;
  /** Seat that starts the round order in round 1; the order rotates by one seat each round. */
  firstSeat: PlayerIndex;
  /** This round's submissions, by seat. null for players who are out. */
  pending: (Submission | null)[];
  /** Append-only event log. */
  log: GameEvent[];
  /** Every action applied, in order. Server-side only: replaying it rebuilds the game. */
  history: Action[];
  /** null while playing, or when the game ended in a draw. */
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  rules: RulesConfig;
}

export type MissReason = "target_eliminated" | "target_unarmed" | "target_out";
export type WasteReason = "even_digit" | "slot_eliminated";
export type OutReason = "shot" | "left";

export type GameEvent =
  | { type: "RoundStarted"; round: number; order: PlayerIndex[] }
  /** Emitted while flipping: this player has finished their go (details come at resolve). */
  | { type: "PlayerReady"; player: PlayerIndex }
  | { type: "CardPlayed"; player: PlayerIndex; play: CardPlay }
  | { type: "CardFizzled"; player: PlayerIndex; card: Card }
  | { type: "ShieldRaised"; player: PlayerIndex; slot: SlotNumber }
  | { type: "PartErased"; player: PlayerIndex; target: PlayerIndex; slot: SlotNumber; stage: Stage }
  | { type: "SlotsSwapped"; player: PlayerIndex; slots: [SlotNumber, SlotNumber] }
  | {
      type: "BulletsStolen";
      player: PlayerIndex;
      target: PlayerIndex;
      slot: SlotNumber;
      loaded: boolean;
    }
  | { type: "BookOpened"; player: PlayerIndex; page: number; digit: number }
  /** card is null in views for other players: they only learn that a card was drawn. */
  | { type: "CardDrawn"; player: PlayerIndex; card: Card | null }
  | { type: "HandFull"; player: PlayerIndex }
  | { type: "TurnWasted"; player: PlayerIndex; reason: WasteReason }
  | { type: "RerollGranted"; player: PlayerIndex; slot: SlotNumber }
  | { type: "PartDrawn"; player: PlayerIndex; slot: SlotNumber; part: Part; stage: Stage }
  | { type: "ShotFired"; attacker: PlayerIndex; targets: PlayerIndex[]; slot: SlotNumber }
  | { type: "SlotEliminated"; attacker: PlayerIndex; target: PlayerIndex; slot: SlotNumber }
  | { type: "ShotBlocked"; attacker: PlayerIndex; target: PlayerIndex; slot: SlotNumber }
  | { type: "FigureDestroyed"; attacker: PlayerIndex; target: PlayerIndex; slot: SlotNumber }
  | {
      type: "AttackMissed";
      attacker: PlayerIndex;
      target: PlayerIndex;
      slot: SlotNumber;
      reason: MissReason;
    }
  | { type: "BulletsSpent"; player: PlayerIndex; slot: SlotNumber }
  /** Knocked out earlier in this round's order, so their go is lost. */
  | { type: "GoLost"; player: PlayerIndex }
  | { type: "PlayerOut"; player: PlayerIndex; reason: OutReason; by: PlayerIndex | null }
  | { type: "GameOver"; winner: PlayerIndex | null; reason: EndReason };

export type Action =
  /** `luck` is a server random integer >= 0; it picks the card if the page is lucky. */
  | { type: "open_book"; player: PlayerIndex; page: number; luck: number }
  | { type: "set_target"; player: PlayerIndex; targets: PlayerIndex[] }
  /** null cancels a queued card. Only before opening the book. */
  | { type: "play_card"; player: PlayerIndex; play: CardPlay | null }
  /** The player left or ran out of reconnect time. */
  | { type: "leave"; player: PlayerIndex };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

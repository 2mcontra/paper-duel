export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Squares of track between one player's start square and the next player's. */
export const SQUARES_PER_SEAT = 10;
/** Every 5th square is a star: start squares and the halfway points between them. */
export const STAR_EVERY = 5;

/** 0 empty, 1 head, 2 body, 3 face, 4 gun, 5 loaded. */
export type Stage = 0 | 1 | 2 | 3 | 4 | 5;
/** A figure with a face can see where it's going: it may walk onto the track. */
export const CAN_WALK: Stage = 3;
export const HAS_GUN: Stage = 4;
export const LOADED: Stage = 5;
/** Figures start with a head and body already drawn. */
export const START_STAGE: Stage = 2;

export type Part = "head" | "body" | "face" | "gun" | "bullets";
/** The part added when a figure moves *to* a stage; index = stage - 1. */
export const PARTS: readonly Part[] = ["head", "body", "face", "gun", "bullets"];

export const CARDS = ["shield", "double_shot", "eraser", "swap", "steal", "reroll"] as const;
export type Card = (typeof CARDS)[number];
export const HAND_LIMIT = 3;

/** Seat index in the game, 0 .. players.length - 1. */
export type PlayerIndex = number;
/** Index of a figure in its player's `figures`, 0 .. figures - 1. */
export type FigureIndex = number;

export interface Figure {
  stage: Stage;
  /** Square on the track, or null while at home. */
  pos: number | null;
  dead: boolean;
  /** Blocks the next shot or stomp. */
  shielded: boolean;
}

export interface PlayerStats {
  kills: number;
  stomps: number;
  /** Parts drawn on figures. */
  parts: number;
  shots: number;
  cardsPlayed: number;
  /** Figures lost. */
  deaths: number;
  /** Sum of every roll, and how many there were (for the average). */
  rollTotal: number;
  rolls: number;
  /** Squares walked. */
  squares: number;
}

export interface PlayerState {
  id: string;
  name: string;
  figures: Figure[];
  hand: Card[];
  /** All figures dead, or left the game. */
  out: boolean;
  /** Finishing position (1 = winner), set when the player is out or the game ends. */
  place: number | null;
  stats: PlayerStats;
}

/** One target of a shot. */
export interface FigureRef {
  player: PlayerIndex;
  figure: FigureIndex;
}

export type CardPlay =
  | { card: "shield"; figure: FigureIndex }
  | { card: "double_shot" }
  | { card: "eraser"; target: PlayerIndex; targetFigure: FigureIndex }
  | { card: "swap"; figure: FigureIndex; target: PlayerIndex; targetFigure: FigureIndex }
  | { card: "steal"; figure: FigureIndex; target: PlayerIndex; targetFigure: FigureIndex }
  | { card: "reroll" };

/** What the current player does with their roll. One per turn. */
export type Move =
  /** Add the next part to a figure (anywhere). */
  | { kind: "draw"; figure: FigureIndex }
  /** Walk a figure exactly `roll` squares (from home: enter at your start square). */
  | { kind: "move"; figure: FigureIndex }
  /** A loaded figure on the track shoots up to `roll` squares away (2 targets with a double shot). */
  | { kind: "shoot"; figure: FigureIndex; targets: FigureRef[] }
  | { kind: "pass" };

export type Phase = "playing" | "finished";
export type EndReason = "last_standing" | "time_up";

export interface RulesConfig {
  /** Who takes the first turn. The server applies this. */
  firstPlayer: "random" | "host";
  /** Shooting uses up the bullets (reload by drawing them again), or they stay loaded. */
  bullets: "consumed" | "reusable";
  /** Pages in the book. A multiple of 10 so every last digit is equally likely. */
  totalPages: number;
  /** Seconds per turn before the server plays it for you; null disables. */
  turnTimerSeconds: number | null;
  /** Stick figures per player, 1..5. Lose them all and you're out. */
  figures: number;
  /** Lucky pages give cards. */
  luckyCards: boolean;
  /** The game ends after this many rounds (most figures left wins); null = play to the end. */
  maxRounds: number | null;
}

export interface TurnState {
  player: PlayerIndex;
  /** The page opened this turn, and the roll it gives; null before the book is opened. */
  page: number | null;
  roll: number | null;
  /** A card has been played this turn (one per turn). */
  cardPlayed: boolean;
  /** A double shot is active: the next shot may hit two targets. */
  doubleShot: boolean;
}

export interface GameState {
  id: string;
  phase: Phase;
  players: PlayerState[];
  /** Squares on the shared track (SQUARES_PER_SEAT per player). */
  trackLength: number;
  /** 1-based round number; a round is one turn for each player still in. */
  round: number;
  /** 1-based turn number over the whole game. */
  turnNumber: number;
  /** Seat that took the first turn; rounds start with it (or the next player still in). */
  firstSeat: PlayerIndex;
  turn: TurnState;
  /** Append-only event log. */
  log: GameEvent[];
  /** Every action applied, in order. Server-side only: replaying it rebuilds the game. */
  history: Action[];
  /** null while playing, or when the game ended in a draw. */
  winner: PlayerIndex | null;
  endReason: EndReason | null;
  rules: RulesConfig;
}

export type OutReason = "shot" | "left";

export type GameEvent =
  | { type: "TurnStarted"; player: PlayerIndex; round: number; turn: number }
  | { type: "BookOpened"; player: PlayerIndex; page: number; roll: number }
  /** card is null in views for other players: they only learn that a card was drawn. */
  | { type: "CardDrawn"; player: PlayerIndex; card: Card | null }
  | { type: "HandFull"; player: PlayerIndex }
  | { type: "CardPlayed"; player: PlayerIndex; play: CardPlay }
  | { type: "ShieldRaised"; player: PlayerIndex; figure: FigureIndex }
  | {
      type: "PartErased";
      player: PlayerIndex;
      target: PlayerIndex;
      figure: FigureIndex;
      stage: Stage;
    }
  | {
      type: "Swapped";
      player: PlayerIndex;
      figure: FigureIndex;
      target: PlayerIndex;
      targetFigure: FigureIndex;
    }
  | {
      type: "BulletsStolen";
      player: PlayerIndex;
      figure: FigureIndex;
      target: PlayerIndex;
      targetFigure: FigureIndex;
    }
  | { type: "PartDrawn"; player: PlayerIndex; figure: FigureIndex; part: Part; stage: Stage }
  | {
      type: "FigureMoved";
      player: PlayerIndex;
      figure: FigureIndex;
      /** null = came out of home. */
      from: number | null;
      to: number;
    }
  /** Landed on an enemy: it is knocked back home and drops its gun. */
  | {
      type: "Stomped";
      player: PlayerIndex;
      figure: FigureIndex;
      target: PlayerIndex;
      targetFigure: FigureIndex;
      stage: Stage;
    }
  | {
      type: "ShotFired";
      player: PlayerIndex;
      figure: FigureIndex;
      targets: FigureRef[];
    }
  | {
      type: "FigureKilled";
      player: PlayerIndex;
      figure: FigureIndex;
      target: PlayerIndex;
      targetFigure: FigureIndex;
    }
  /** A shield took the hit (shot or stomp) and is used up. */
  | {
      type: "ShieldBroken";
      player: PlayerIndex;
      target: PlayerIndex;
      targetFigure: FigureIndex;
    }
  | { type: "BulletsSpent"; player: PlayerIndex; figure: FigureIndex }
  | { type: "Passed"; player: PlayerIndex }
  | {
      type: "PlayerOut";
      player: PlayerIndex;
      reason: OutReason;
      by: PlayerIndex | null;
      place: number;
    }
  | {
      type: "GameOver";
      winner: PlayerIndex | null;
      reason: EndReason;
      /** Finishing place per seat (1 = first; ties share a place). */
      places: number[];
    };

export type Action =
  /** `luck` is a server random integer >= 0; it picks the card if the page is lucky. */
  | { type: "open_book"; player: PlayerIndex; page: number; luck: number }
  /** After opening the book, before acting; one per turn. A reroll needs a new page and luck. */
  | { type: "play_card"; player: PlayerIndex; play: CardPlay; page?: number; luck?: number }
  | { type: "act"; player: PlayerIndex; move: Move }
  /** The player left or ran out of reconnect time. */
  | { type: "leave"; player: PlayerIndex };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

import type { Card, GameEvent, GameState, PlayerIndex, PlayerState, Submission } from "./types.js";

/** Another player's go in progress: only whether they are done. */
export interface HiddenSubmission {
  hidden: true;
  done: boolean;
}

export interface PlayerView extends Omit<PlayerState, "hand"> {
  /** Your own cards; null for other players. */
  hand: Card[] | null;
  handSize: number;
}

/** What one player (or a spectator, viewer null) may see of a game. */
export interface GameView extends Omit<GameState, "players" | "pending" | "history" | "log"> {
  players: PlayerView[];
  pending: (Submission | HiddenSubmission | null)[];
  /** The most recent events only (see LOG_TAIL); new events arrive with each update. */
  log: GameEvent[];
}

export const LOG_TAIL = 200;

export function redactEvent(e: GameEvent, viewer: PlayerIndex | null): GameEvent {
  if (e.type === "CardDrawn" && e.player !== viewer) return { ...e, card: null };
  return e;
}

export function viewFor(state: GameState, viewer: PlayerIndex | null): GameView {
  const { history: _history, log, players, pending, ...rest } = state;
  return {
    ...rest,
    players: players.map((p, i) => ({
      ...p,
      hand: i === viewer ? p.hand.slice() : null,
      handSize: p.hand.length,
    })),
    pending: pending.map((sub, i) =>
      sub === null ? null : i === viewer ? sub : { hidden: true as const, done: sub.done },
    ),
    log: log.slice(-LOG_TAIL).map((e) => redactEvent(e, viewer)),
  };
}

export function isHidden(sub: Submission | HiddenSubmission | null): sub is HiddenSubmission {
  return sub !== null && "hidden" in sub;
}

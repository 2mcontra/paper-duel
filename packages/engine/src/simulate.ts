import { applyAction, createGame } from "./engine.js";
import { randomPage } from "./rng.js";
import type { GameState, PlayerIndex, RulesConfig } from "./types.js";

export interface SimOptions {
  random: () => number;
  rules?: Partial<RulesConfig>;
  firstTurn?: PlayerIndex;
  /** Book openings before the game is declared non-terminating. */
  maxRolls?: number;
  /** Under R3 "choose": the probability a bot attacks. Default 1. */
  attackChance?: number;
}

export interface SimResult {
  state: GameState;
  rolls: number;
  terminated: boolean;
}

/** Plays one game between two random bots. */
export function simulateGame(opts: SimOptions): SimResult {
  const { random, maxRolls = 100_000, attackChance = 1 } = opts;
  let state = createGame({
    id: "sim",
    players: [
      { id: "a", name: "Bot A" },
      { id: "b", name: "Bot B" },
    ],
    firstTurn: opts.firstTurn ?? (random() < 0.5 ? 0 : 1),
    ...(opts.rules ? { rules: opts.rules } : {}),
  });
  while (state.phase === "playing" && state.turnIndex < maxRolls) {
    state =
      state.pendingChoice !== null
        ? applyAction(state, { type: "choose", attack: random() < attackChance }).state
        : applyAction(state, {
            type: "open_book",
            page: randomPage(state.rules.totalPages, random),
          }).state;
  }
  return { state, rolls: state.turnIndex, terminated: state.phase === "finished" };
}

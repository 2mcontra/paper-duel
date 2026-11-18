import {
  createGame,
  getSlot,
  type GameState,
  type RulesConfig,
  type SlotNumber,
  type Stage,
} from "../src/index.js";

export function newGame(rules: Partial<RulesConfig> = {}, firstTurn: 0 | 1 = 0): GameState {
  return createGame({
    id: "g1",
    players: [
      { id: "p0", name: "Alice" },
      { id: "p1", name: "Bob" },
    ],
    firstTurn,
    rules,
  });
}

type SlotSpec = Partial<Record<SlotNumber, Stage | "dead">>;

/** Returns a copy of `state` with the given slots set, for arranging test positions. */
export function arrange(state: GameState, p0: SlotSpec, p1: SlotSpec = {}): GameState {
  const s = structuredClone(state);
  ([p0, p1] as const).forEach((spec, i) => {
    for (const [k, v] of Object.entries(spec)) {
      const slot = getSlot(s.players[i as 0 | 1], Number(k) as SlotNumber);
      if (v === "dead") slot.status = "eliminated";
      else slot.stage = v as Stage;
    }
  });
  return s;
}

/** A page whose last digit selects slot `n`. */
export const pageFor = (n: SlotNumber, tens = 10): number => tens + n;
export const EVEN_PAGE = 42;

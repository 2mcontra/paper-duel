import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  RulesError,
  applyAction,
  createGame,
  createRng,
  lostCount,
  replay,
  resolveRules,
  simulateGame,
  type RulesConfig,
} from "../src/index.js";
import { EVEN_PAGE, arrange, newGame, open, pageFor } from "./helpers.js";

describe("rules config", () => {
  it("defaults", () => {
    expect(resolveRules()).toEqual({
      firstPlayer: "random",
      unarmedTarget: "miss",
      bullets: "consumed",
      ownDeadSlot: "waste",
      totalPages: 300,
      roundTimerSeconds: 20,
      lives: 3,
      luckyCards: true,
      stalemate: "most_alive",
    });
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
  });

  it("rejects bad or unknown values", () => {
    const bad = [
      { totalPages: 305 },
      { lives: 0 },
      { lives: 6 },
      { roundTimerSeconds: 2 },
      { luckyCards: "yes" },
      { bullets: "infinite" },
      { winTarget: 3 },
    ] as Partial<RulesConfig>[];
    for (const r of bad) expect(() => resolveRules(r)).toThrow(RulesError);
    expect(
      resolveRules({ roundTimerSeconds: null, lives: undefined }).roundTimerSeconds,
    ).toBeNull();
  });
});

describe("purity and replay", () => {
  it("never mutates the input state", () => {
    const g = arrange(newGame(2), { 5: 5 }, { 5: 4 });
    const snapshot = structuredClone(g);
    applyAction(applyAction(g, open(0, pageFor(5))).state, open(1, EVEN_PAGE));
    applyAction(g, open(0, pageFor(5)));
    expect(g).toEqual(snapshot);
  });

  it("replaying the history rebuilds the final state", () => {
    for (const players of [2, 4, 6]) {
      const { state } = simulateGame({ random: createRng(7 + players), players, firstSeat: 1 });
      const initial = createGame({
        id: state.id,
        players: state.players.map((p) => ({ id: p.id, name: p.name })),
        firstSeat: 1,
        rules: state.rules,
      });
      expect(replay(initial, state.history)).toEqual(state);
    }
  });
});

describe("random games (property test)", () => {
  const variants: Partial<RulesConfig>[] = [
    {},
    { unarmedTarget: "destroy_partial" },
    { bullets: "reusable" },
    { ownDeadSlot: "reroll" },
    { luckyCards: false },
    { lives: 1 },
    { lives: 5 },
    { lives: 5, stalemate: "draw" },
    { totalPages: 50 },
  ];

  it.each(variants.flatMap((v) => [2, 3, 6].map((n) => [n, JSON.stringify(v), v] as const)))(
    "%i players %s: every game ends in a valid state",
    (players, _label, rules) => {
      const random = createRng(1000 + players);
      for (let i = 0; i < 60; i++) {
        const { state, terminated } = simulateGame({ random, players, rules });
        expect(terminated).toBe(true);
        expect(state.log.filter((e) => e.type === "GameOver")).toHaveLength(1);
        const active = state.players.filter((p) => !p.out);
        if (state.endReason === "last_standing") {
          expect(active).toHaveLength(1);
          expect(state.players[state.winner!]!.out).toBe(false);
        } else {
          expect(state.endReason).toBe("stalemate");
          if (state.winner !== null) expect(state.players[state.winner]!.out).toBe(false);
        }
        for (const p of state.players) {
          expect(p.hand.length).toBeLessThanOrEqual(3);
          if (p.out) expect(lostCount(p) >= state.rules.lives).toBe(true);
          else expect(lostCount(p)).toBeLessThan(state.rules.lives);
          for (const s of p.slots) expect(s.stage >= 0 && s.stage <= 5).toBe(true);
        }
      }
    },
  );
});

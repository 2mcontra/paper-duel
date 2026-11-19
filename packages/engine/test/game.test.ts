import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  EngineError,
  RulesError,
  actionsFromLog,
  createRng,
  replay,
  resolveRules,
  resolveTurn,
  simulateGame,
  type RulesConfig,
} from "../src/index.js";
import { EVEN_PAGE, arrange, newGame, pageFor } from "./helpers.js";

describe("turn order", () => {
  it("alternates after every non-reroll turn, starting with firstTurn", () => {
    for (const first of [0, 1] as const) {
      let s = newGame({}, first);
      const seen: number[] = [];
      for (const page of [EVEN_PAGE, pageFor(1), pageFor(3), EVEN_PAGE, pageFor(1)]) {
        seen.push(s.turn);
        s = resolveTurn(s, page).state;
      }
      expect(seen).toEqual(first === 0 ? [0, 1, 0, 1, 0] : [1, 0, 1, 0, 1]);
      expect(s.turnIndex).toBe(5);
    }
  });

  it("records the last roll", () => {
    const { state } = resolveTurn(newGame(), 137);
    expect(state.lastRoll).toEqual({ page: 137, digit: 7, player: 0 });
  });
});

describe("stalemate", () => {
  // After this shot, player 0 has {3} alive and player 1 has {5}: no number is shared.
  const position = (rules: Partial<RulesConfig> = {}) =>
    arrange(
      newGame({ winTarget: 5, ...rules }),
      { 1: "dead", 5: "dead", 7: "dead", 9: "dead", 3: 5 },
      { 1: "dead", 7: "dead", 9: "dead", 3: 4, 5: 2 },
    );

  it("ends the game when no slot number is alive on both sides", () => {
    const { state, events } = resolveTurn(position(), pageFor(3));
    expect(events.at(-1)).toEqual({ type: "GameOver", winner: null, reason: "stalemate" });
    expect(state.phase).toBe("finished");
  });

  it("most_alive gives the win to the player with more living slots", () => {
    const s0 = arrange(
      newGame({ winTarget: 5 }),
      { 1: "dead", 5: "dead", 7: "dead", 3: 5, 9: 1 },
      { 1: "dead", 7: "dead", 9: "dead", 3: 4, 5: 2 },
    );
    const { state } = resolveTurn(s0, pageFor(3));
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe("stalemate");
  });

  it("draw mode always draws", () => {
    const s0 = arrange(
      newGame({ winTarget: 5, stalemate: "draw" }),
      { 1: "dead", 5: "dead", 7: "dead", 3: 5, 9: 1 },
      { 1: "dead", 7: "dead", 9: "dead", 3: 4, 5: 2 },
    );
    expect(resolveTurn(s0, pageFor(3)).state.winner).toBeNull();
  });
});

describe("input validation", () => {
  it("rejects pages outside the book", () => {
    for (const page of [0, -1, 301, 1.5, Number.NaN]) {
      expect(() => resolveTurn(newGame(), page)).toThrow(EngineError);
    }
  });

  it("accepts the first and last pages", () => {
    expect(() => resolveTurn(newGame(), 1)).not.toThrow();
    expect(() => resolveTurn(newGame(), 300)).not.toThrow();
  });
});

describe("rules config", () => {
  it("defaults match the plan", () => {
    expect(resolveRules()).toEqual({
      firstPlayer: "random",
      armedRoll: "auto_attack",
      unarmedTarget: "miss",
      bullets: "consumed",
      ownDeadSlot: "waste",
      totalPages: 300,
      turnTimerSeconds: 30,
      winTarget: 3,
      stalemate: "most_alive",
    });
  });

  it("rejects bad values", () => {
    const bad: Partial<RulesConfig>[] = [
      { totalPages: 305 },
      { totalPages: 0 },
      { turnTimerSeconds: 2 },
      { bullets: "infinite" as never },
      { winTarget: 0 },
      { winTarget: 6 },
    ];
    for (const r of bad) expect(() => resolveRules(r)).toThrow(RulesError);
  });

  it("allows turning the timer off", () => {
    expect(resolveRules({ turnTimerSeconds: null }).turnTimerSeconds).toBeNull();
  });

  it("DEFAULT_RULES is frozen", () => {
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
  });
});

describe("purity and replay", () => {
  it("never mutates the input state", () => {
    const s0 = arrange(newGame(), { 5: 5 }, { 5: 4 });
    const snapshot = structuredClone(s0);
    resolveTurn(s0, pageFor(5));
    expect(s0).toEqual(snapshot);
  });

  it("is deterministic: replaying the log reproduces the final state", () => {
    for (const armedRoll of ["auto_attack", "choose"] as const) {
      const { state } = simulateGame({
        random: createRng(7),
        rules: { armedRoll },
        firstTurn: 1,
        attackChance: 0.7,
      });
      const replayed = replay(newGame({ armedRoll }, 1), actionsFromLog(state.log));
      expect(replayed.log).toEqual(state.log);
      expect(replayed.players.map((p) => p.slots)).toEqual(state.players.map((p) => p.slots));
      expect([replayed.winner, replayed.endReason, replayed.turnIndex]).toEqual([
        state.winner,
        state.endReason,
        state.turnIndex,
      ]);
    }
  });
});

describe("random games (property test)", () => {
  const variants: Partial<RulesConfig>[] = [
    {},
    { armedRoll: "choose" },
    { unarmedTarget: "destroy_partial" },
    { bullets: "reusable" },
    { ownDeadSlot: "reroll" },
    { winTarget: 5 },
    { winTarget: 5, stalemate: "draw" },
    { winTarget: 1 },
    { totalPages: 50 },
    {
      armedRoll: "choose",
      unarmedTarget: "destroy_partial",
      bullets: "reusable",
      ownDeadSlot: "reroll",
    },
  ];

  it.each(variants.map((v) => [JSON.stringify(v), v] as const))(
    "%s: games terminate with a valid end state",
    (_label, rules) => {
      const random = createRng(12345);
      for (let i = 0; i < 300; i++) {
        const { state, terminated } = simulateGame({ random, rules, attackChance: 0.8 });
        expect(terminated).toBe(true);
        expect(state.phase).toBe("finished");
        const alive = state.players.map((p) => p.slots.filter((s) => s.status === "alive").length);
        const target = state.rules.winTarget;
        if (state.endReason === "fights_won") {
          expect(state.winner).not.toBeNull();
          expect(5 - alive[1 - state.winner!]!).toBe(target);
          expect(5 - alive[state.winner!]!).toBeLessThan(target);
        } else {
          expect(target).toBeGreaterThan(3); // first to 3 or less can never stall
          expect(state.endReason).toBe("stalemate");
        }
        for (const p of state.players) {
          for (const s of p.slots) {
            expect(s.stage).toBeGreaterThanOrEqual(0);
            expect(s.stage).toBeLessThanOrEqual(5);
          }
        }
        expect(state.log.filter((e) => e.type === "GameOver")).toHaveLength(1);
      }
    },
  );
});

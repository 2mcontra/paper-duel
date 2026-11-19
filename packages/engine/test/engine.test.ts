import { describe, expect, it } from "vitest";
import {
  EngineError,
  forfeit,
  PARTS,
  SLOT_NUMBERS,
  getSlot,
  resolveChoice,
  resolveTurn,
  slotForPage,
  type GameState,
} from "../src/index.js";
import { EVEN_PAGE, arrange, newGame, pageFor } from "./helpers.js";

const slot = (s: GameState, p: 0 | 1, n: 1 | 3 | 5 | 7 | 9) => getSlot(s.players[p], n);

describe("page to slot", () => {
  it("uses only the last digit", () => {
    expect(slotForPage(137)).toBe(7);
    expect(slotForPage(1)).toBe(1);
    expect(slotForPage(299)).toBe(9);
  });
  it("returns null for even digits, including 0", () => {
    for (const p of [10, 42, 124, 296, 300]) expect(slotForPage(p)).toBeNull();
  });
});

describe("drawing parts", () => {
  it("draws head, body, face, gun, bullets in order; 5 actions arm a slot", () => {
    let s = newGame();
    const drawn: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = resolveTurn(s, pageFor(5));
      const e = r.events.find((x) => x.type === "PartDrawn");
      if (e?.type === "PartDrawn") drawn.push(e.part);
      s = resolveTurn(r.state, EVEN_PAGE).state; // opponent wastes, back to player 0
    }
    expect(drawn).toEqual([...PARTS]);
    expect(slot(s, 0, 5).stage).toBe(5);
  });

  it("only touches the rolled slot of the current player", () => {
    const { state } = resolveTurn(newGame(), pageFor(3));
    for (const n of SLOT_NUMBERS) {
      expect(slot(state, 0, n).stage).toBe(n === 3 ? 1 : 0);
      expect(slot(state, 1, n).stage).toBe(0);
    }
  });
});

describe("wasted turns", () => {
  it("even digit wastes the turn and changes nothing", () => {
    const s0 = newGame();
    const { state, events } = resolveTurn(s0, EVEN_PAGE);
    expect(events.map((e) => e.type)).toEqual(["BookOpened", "TurnWasted", "TurnPassed"]);
    expect(state.players).toEqual(s0.players);
    expect(state.turn).toBe(1);
  });

  it("a dead slot cannot be rebuilt; rolling it wastes the turn (R6 default)", () => {
    const s0 = arrange(newGame(), { 7: "dead" });
    const { state, events } = resolveTurn(s0, pageFor(7));
    expect(events).toContainEqual({ type: "TurnWasted", player: 0, reason: "slot_eliminated" });
    expect(slot(state, 0, 7)).toEqual({ number: 7, stage: 0, status: "eliminated" });
    expect(state.turn).toBe(1);
  });

  it("R6 reroll: rolling your dead slot keeps the turn", () => {
    const s0 = arrange(newGame({ ownDeadSlot: "reroll" }), { 7: "dead" });
    const { state, events } = resolveTurn(s0, pageFor(7));
    expect(events.map((e) => e.type)).toEqual(["BookOpened", "RerollGranted"]);
    expect(state.turn).toBe(0);
    expect(state.turnIndex).toBe(1);
  });
});

describe("attacks", () => {
  it("an armed slot eliminates the opponent's same slot if it has a gun", () => {
    for (const targetStage of [4, 5] as const) {
      const s0 = arrange(newGame(), { 9: 5 }, { 9: targetStage });
      const { state, events } = resolveTurn(s0, pageFor(9));
      expect(events).toContainEqual({ type: "SlotEliminated", attacker: 0, slot: 9 });
      expect(slot(state, 1, 9).status).toBe("eliminated");
    }
  });

  it("only the same-numbered slot is affected", () => {
    const s0 = arrange(newGame(), { 9: 5 }, { 1: 5, 3: 5, 5: 5, 7: 5, 9: 5 });
    const { state } = resolveTurn(s0, pageFor(9));
    for (const n of [1, 3, 5, 7] as const) expect(slot(state, 1, n).status).toBe("alive");
  });

  it("misses an empty or partial slot (R4 default)", () => {
    for (const targetStage of [0, 1, 2, 3] as const) {
      const s0 = arrange(newGame(), { 1: 5 }, { 1: targetStage });
      const { state, events } = resolveTurn(s0, pageFor(1));
      expect(events).toContainEqual({
        type: "AttackMissed",
        attacker: 0,
        slot: 1,
        reason: "target_unarmed",
      });
      expect(slot(state, 1, 1)).toMatchObject({ stage: targetStage, status: "alive" });
    }
  });

  it("misses an already eliminated slot (R7)", () => {
    const s0 = arrange(newGame(), { 1: 5, 3: 1 }, { 1: "dead", 3: 1 });
    const { events } = resolveTurn(s0, pageFor(1));
    expect(events).toContainEqual({
      type: "AttackMissed",
      attacker: 0,
      slot: 1,
      reason: "target_eliminated",
    });
  });

  it("R4 destroy_partial resets a partial figure to empty without eliminating it", () => {
    const s0 = arrange(newGame({ unarmedTarget: "destroy_partial" }), { 1: 5 }, { 1: 3 });
    const { state, events } = resolveTurn(s0, pageFor(1));
    expect(events).toContainEqual({ type: "FigureDestroyed", attacker: 0, slot: 1 });
    expect(slot(state, 1, 1)).toMatchObject({ stage: 0, status: "alive" });
  });

  it("R4 destroy_partial still misses an empty slot", () => {
    const s0 = arrange(newGame({ unarmedTarget: "destroy_partial" }), { 1: 5 });
    const { events } = resolveTurn(s0, pageFor(1));
    expect(events.some((e) => e.type === "AttackMissed")).toBe(true);
  });

  it("R5 consumed: firing drops back to gun with 0 bullets, hit or miss", () => {
    for (const target of [0, 4] as const) {
      const s0 = arrange(newGame(), { 5: 5, 3: 1 }, { 5: target, 3: 1 });
      const { state, events } = resolveTurn(s0, pageFor(5));
      expect(slot(state, 0, 5).stage).toBe(4);
      expect(events).toContainEqual({ type: "BulletsSpent", player: 0, slot: 5 });
    }
  });

  it("R5 consumed: the next roll on that slot reloads it", () => {
    let s = arrange(newGame(), { 5: 5 });
    s = resolveTurn(s, pageFor(5)).state; // fire (miss)
    s = resolveTurn(s, EVEN_PAGE).state; // opponent wastes
    const { state, events } = resolveTurn(s, pageFor(5));
    expect(events).toContainEqual({
      type: "PartDrawn",
      player: 0,
      slot: 5,
      part: "bullets",
      stage: 5,
    });
    expect(slot(state, 0, 5).stage).toBe(5);
  });

  it("R5 reusable: the figure stays armed after firing", () => {
    const s0 = arrange(newGame({ bullets: "reusable" }), { 5: 5 });
    const { state, events } = resolveTurn(s0, pageFor(5));
    expect(slot(state, 0, 5).stage).toBe(5);
    expect(events.some((e) => e.type === "BulletsSpent")).toBe(false);
  });

  it("an attack uses the whole turn (R8)", () => {
    const s0 = arrange(newGame(), { 5: 5 }, { 5: 4 });
    const { state } = resolveTurn(s0, pageFor(5));
    expect(state.turn).toBe(1);
  });
});

describe("R3 choose", () => {
  const armed = () => arrange(newGame({ armedRoll: "choose" }), { 3: 5 }, { 3: 4 });

  it("rolling an armed slot asks the player and keeps the turn", () => {
    const { state, events } = resolveTurn(armed(), pageFor(3));
    expect(events.at(-1)).toEqual({ type: "AttackChoiceRequired", player: 0, slot: 3 });
    expect(state.pendingChoice).toBe(3);
    expect(state.turn).toBe(0);
  });

  it("attack resolves the shot", () => {
    const pending = resolveTurn(armed(), pageFor(3)).state;
    const { state } = resolveChoice(pending, true);
    expect(slot(state, 1, 3).status).toBe("eliminated");
    expect(state.pendingChoice).toBeNull();
    expect(state.turn).toBe(1);
  });

  it("skip keeps bullets and passes the turn", () => {
    const pending = resolveTurn(armed(), pageFor(3)).state;
    const { state, events } = resolveChoice(pending, false);
    expect(events[0]).toEqual({ type: "AttackSkipped", player: 0, slot: 3 });
    expect(slot(state, 0, 3).stage).toBe(5);
    expect(slot(state, 1, 3).status).toBe("alive");
    expect(state.turn).toBe(1);
  });

  it("rejects opening the book while a choice is pending, and choosing when none is", () => {
    const pending = resolveTurn(armed(), pageFor(3)).state;
    expect(() => resolveTurn(pending, EVEN_PAGE)).toThrow(EngineError);
    expect(() => resolveChoice(armed(), true)).toThrow(EngineError);
  });
});

describe("winning (first to 3 by default)", () => {
  it("the 3rd fight won ends the game", () => {
    const s0 = arrange(newGame(), { 9: 5, 1: 2 }, { 1: "dead", 3: "dead", 9: 4 });
    const { state, events } = resolveTurn(s0, pageFor(9));
    expect(events.at(-1)).toEqual({ type: "GameOver", winner: 0, reason: "fights_won" });
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe(0);
    expect(state.endReason).toBe("fights_won");
    expect(events.some((e) => e.type === "TurnPassed")).toBe(false);
  });

  it("2 fights won is not a win", () => {
    const s0 = arrange(newGame(), { 7: 5 }, { 1: "dead", 7: 4 });
    const { state } = resolveTurn(s0, pageFor(7));
    expect(slot(state, 1, 7).status).toBe("eliminated");
    expect(state.phase).toBe("playing");
    expect(state.turn).toBe(1);
  });

  it("the second player can win too", () => {
    const s0 = arrange(newGame({}, 1), { 3: 4, 5: "dead", 7: "dead" }, { 3: 5 });
    const { state } = resolveTurn(s0, pageFor(3));
    expect(state.winner).toBe(1);
  });

  it("winTarget 5: only a full wipe-out wins outright", () => {
    const four = arrange(
      newGame({ winTarget: 5 }),
      { 9: 5 },
      { 1: "dead", 3: "dead", 5: "dead", 7: 2, 9: 4 },
    );
    expect(resolveTurn(four, pageFor(9)).state.phase).toBe("playing");
    const five = arrange(
      newGame({ winTarget: 5 }),
      { 9: 5 },
      { 1: "dead", 3: "dead", 5: "dead", 7: "dead", 9: 4 },
    );
    expect(resolveTurn(five, pageFor(9)).state.winner).toBe(0);
  });

  it("rejects actions after the game is over", () => {
    const s0 = arrange(newGame(), { 9: 5 }, { 1: "dead", 3: "dead", 9: 4 });
    const { state } = resolveTurn(s0, pageFor(9));
    expect(() => resolveTurn(state, EVEN_PAGE)).toThrow(EngineError);
  });
});

describe("forfeit", () => {
  it("ends the game for the other player and logs it", () => {
    const { state, events } = forfeit(newGame(), 0);
    expect(events).toEqual([{ type: "GameOver", winner: 1, reason: "forfeit" }]);
    expect(state).toMatchObject({ phase: "finished", winner: 1, endReason: "forfeit" });
    expect(() => forfeit(state, 1)).toThrow(EngineError);
  });
});

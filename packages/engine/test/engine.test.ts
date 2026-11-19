import { describe, expect, it } from "vitest";
import {
  CARDS,
  EngineError,
  PARTS,
  applyAction,
  cardForLuck,
  createGame,
  isLuckyPage,
  roundOrder,
  slotForPage,
  suggestTargets,
  viewFor,
  type GameEvent,
} from "../src/index.js";
import {
  EVEN_PAGE,
  LUCKY_EVEN,
  LUCKY_ODD,
  aim,
  arrange,
  card,
  giveCards,
  newGame,
  open,
  pageFor,
  run,
  slotOf,
} from "./helpers.js";

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe("pages", () => {
  it("uses only the last digit; even digits are no game", () => {
    expect(slotForPage(137)).toBe(7);
    expect(slotForPage(299)).toBe(9);
    for (const p of [10, 42, 124, 300]) expect(slotForPage(p)).toBeNull();
  });

  it("knows lucky pages", () => {
    for (const p of [11, 22, 99, 100, 111, 200, 222, 300]) expect(isLuckyPage(p)).toBe(true);
    for (const p of [1, 9, 10, 12, 101, 121, 212, 299]) expect(isLuckyPage(p)).toBe(false);
  });

  it("maps luck onto every card", () => {
    expect(CARDS.map((_, i) => cardForLuck(i))).toEqual([...CARDS]);
    expect(cardForLuck(5)).toBe(CARDS[0]);
  });
});

describe("setup", () => {
  it("takes 2 to 6 players", () => {
    expect(() => newGame(1)).toThrow(EngineError);
    expect(() => newGame(7)).toThrow(EngineError);
    for (const n of [2, 6]) expect(newGame(n).players).toHaveLength(n);
  });

  it("starts round 1 with everyone pending", () => {
    const g = newGame(3, {}, 1);
    expect(g.round).toBe(1);
    expect(g.pending.every((s) => s && !s.done)).toBe(true);
    expect(g.log).toEqual([{ type: "RoundStarted", round: 1, order: [1, 2, 0] }]);
  });

  it("rejects a bad first seat", () => {
    expect(() =>
      createGame({
        id: "x",
        players: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        firstSeat: 2,
      }),
    ).toThrow(EngineError);
  });
});

describe("rounds", () => {
  it("waits for everyone, then resolves all goes at once", () => {
    const g = newGame(3);
    const first = run(g, open(0, pageFor(5)), open(1, pageFor(3)));
    expect(types(first.events)).toEqual(["PlayerReady", "PlayerReady"]);
    expect(slotOf(first.state, 0, 5).stage).toBe(0); // nothing happens until the round resolves
    const { state, events } = run(first.state, open(2, EVEN_PAGE));
    expect(slotOf(state, 0, 5).stage).toBe(1);
    expect(slotOf(state, 1, 3).stage).toBe(1);
    expect(events).toContainEqual({ type: "TurnWasted", player: 2, reason: "even_digit" });
    expect(state.round).toBe(2);
    expect(events.at(-1)).toEqual({ type: "RoundStarted", round: 2, order: [1, 2, 0] });
  });

  it("resolves in the round order, which rotates each round", () => {
    const g = newGame(3, {}, 2);
    expect(roundOrder(g)).toEqual([2, 0, 1]);
    const { state, events } = run(g, open(0, EVEN_PAGE), open(1, EVEN_PAGE), open(2, EVEN_PAGE));
    const opened = events.flatMap((e) => (e.type === "BookOpened" ? [e.player] : []));
    expect(opened).toEqual([2, 0, 1]);
    expect(roundOrder(state)).toEqual([0, 1, 2]);
  });

  it("draws parts in order: head, body, face, gun, bullets", () => {
    let s = newGame(2);
    const drawn: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = run(s, open(0, pageFor(7, i + 1)), open(1, EVEN_PAGE));
      for (const e of r.events) if (e.type === "PartDrawn") drawn.push(e.part);
      s = r.state;
    }
    expect(drawn).toEqual([...PARTS]);
    expect(slotOf(s, 0, 7).stage).toBe(5);
  });

  it("allows one go per round", () => {
    const s = run(newGame(2), open(0, EVEN_PAGE)).state;
    expect(() => applyAction(s, open(0, EVEN_PAGE))).toThrow(EngineError);
  });

  it("validates pages and players", () => {
    for (const page of [0, 301, 1.5])
      expect(() => applyAction(newGame(), open(0, page))).toThrow(EngineError);
    expect(() => applyAction(newGame(), open(5, 1))).toThrow(EngineError);
    expect(() => applyAction(newGame(), open(0, 1, -1))).toThrow(EngineError);
  });

  it("rolling your dead slot wastes the go (R6 default)", () => {
    const g = arrange(newGame(2), { 7: "dead" });
    const { events } = run(g, open(0, pageFor(7)), open(1, EVEN_PAGE));
    expect(events).toContainEqual({ type: "TurnWasted", player: 0, reason: "slot_eliminated" });
  });

  it("R6 reroll: open again until a live slot or even page", () => {
    const g = arrange(newGame(2, { ownDeadSlot: "reroll" }), { 7: "dead", 9: "dead" });
    const a = run(g, open(0, pageFor(7)), open(0, pageFor(9)));
    expect(a.state.pending[0]?.done).toBe(false);
    const { state, events } = run(a.state, open(0, pageFor(3)), open(1, EVEN_PAGE));
    expect(events.filter((e) => e.type === "RerollGranted")).toHaveLength(2);
    expect(slotOf(state, 0, 3).stage).toBe(1);
  });
});

describe("shooting", () => {
  it("with one opponent, an armed slot fires at them automatically", () => {
    const g = arrange(newGame(2), { 9: 5 }, { 9: 4 });
    const r1 = run(g, open(0, pageFor(9)));
    expect(r1.state.pending[0]).toMatchObject({ done: true, needsTarget: false, targets: [1] });
    const { state, events } = run(r1.state, open(1, EVEN_PAGE));
    expect(events).toContainEqual({ type: "SlotEliminated", attacker: 0, target: 1, slot: 9 });
    expect(slotOf(state, 1, 9).status).toBe("eliminated");
    expect(slotOf(state, 0, 9).stage).toBe(4); // R5: bullets consumed
  });

  it("with several opponents, the player picks a target", () => {
    const g = arrange(newGame(3), { 5: 5 }, { 5: 4 }, { 5: 4 });
    const r1 = run(g, open(0, pageFor(5)));
    expect(r1.state.pending[0]).toMatchObject({ done: false, needsTarget: true });
    expect(() => applyAction(r1.state, aim(0, 0))).toThrow(EngineError);
    expect(() => applyAction(r1.state, aim(0, 1, 2))).toThrow(EngineError);
    expect(() => applyAction(r1.state, open(0, 1))).toThrow(EngineError);
    const { state } = run(r1.state, aim(0, 2), open(1, EVEN_PAGE), open(2, EVEN_PAGE));
    expect(slotOf(state, 2, 5).status).toBe("eliminated");
    expect(slotOf(state, 1, 5).status).toBe("alive");
  });

  it("can't aim without an armed roll", () => {
    expect(() => applyAction(newGame(3), aim(0, 1))).toThrow(EngineError);
  });

  it("misses an empty or partial slot, and an already dead one", () => {
    const g = arrange(newGame(2), { 1: 5, 3: 5 }, { 1: 3, 3: "dead" });
    const a = run(g, open(0, pageFor(1)), open(1, EVEN_PAGE));
    expect(a.events).toContainEqual({
      type: "AttackMissed",
      attacker: 0,
      target: 1,
      slot: 1,
      reason: "target_unarmed",
    });
    const b = run(a.state, open(0, pageFor(3)), open(1, EVEN_PAGE));
    expect(b.events).toContainEqual({
      type: "AttackMissed",
      attacker: 0,
      target: 1,
      slot: 3,
      reason: "target_eliminated",
    });
  });

  it("R4 destroy_partial wipes a partial figure", () => {
    const g = arrange(newGame(2, { unarmedTarget: "destroy_partial" }), { 1: 5 }, { 1: 3 });
    const { state } = run(g, open(0, pageFor(1)), open(1, EVEN_PAGE));
    expect(slotOf(state, 1, 1)).toMatchObject({ stage: 0, status: "alive" });
  });

  it("R5 reusable keeps the figure armed", () => {
    const g = arrange(newGame(2, { bullets: "reusable" }), { 1: 5 });
    const { state } = run(g, open(0, pageFor(1)), open(1, EVEN_PAGE));
    expect(slotOf(state, 0, 1).stage).toBe(5);
  });

  it("a shield blocks one shot, then is gone", () => {
    const g = arrange(newGame(2), { 1: 5 }, { 1: "shield" });
    const a = run(g, open(0, pageFor(1)), open(1, EVEN_PAGE));
    expect(a.events).toContainEqual({ type: "ShotBlocked", attacker: 0, target: 1, slot: 1 });
    expect(slotOf(a.state, 1, 1)).toMatchObject({ status: "alive", shielded: false });
    const b = run(a.state, open(0, EVEN_PAGE), open(1, EVEN_PAGE));
    const c = run(b.state, open(0, pageFor(1)), open(1, EVEN_PAGE)); // reload
    const d = run(c.state, open(0, pageFor(1, 2)), open(1, EVEN_PAGE));
    expect(slotOf(d.state, 1, 1).status).toBe("eliminated");
  });

  it("suggests the most valuable target", () => {
    const g = arrange(newGame(4), {}, { 5: 2 }, { 5: "shield" }, { 5: 4 });
    expect(suggestTargets(g, 0, 5)).toEqual([3]);
    expect(suggestTargets(g, 0, 5, 3)).toEqual([3, 2, 1]);
  });
});

describe("lives and winning", () => {
  it("losing your 3rd slot knocks you out; the last player standing wins", () => {
    const g = arrange(newGame(2), { 9: 5 }, { 1: "dead", 3: "dead", 9: 4 });
    const { state, events } = run(g, open(0, pageFor(9)), open(1, EVEN_PAGE));
    expect(events).toContainEqual({ type: "PlayerOut", player: 1, reason: "shot", by: 0 });
    expect(events.at(-1)).toEqual({ type: "GameOver", winner: 0, reason: "last_standing" });
    expect(state).toMatchObject({ phase: "finished", winner: 0, endReason: "last_standing" });
    expect(() => applyAction(state, open(0, 1))).toThrow(EngineError);
  });

  it("with 3 players the game goes on after the first knock-out", () => {
    const g = arrange(newGame(3), { 9: 5 }, { 1: "dead", 3: "dead", 9: 4 });
    const a = run(g, open(0, pageFor(9)), aim(0, 1), open(1, EVEN_PAGE), open(2, EVEN_PAGE));
    expect(a.state.phase).toBe("playing");
    expect(a.state.players[1]!.out).toBe(true);
    expect(a.state.pending[1]).toBeNull();
    expect(() => applyAction(a.state, open(1, 1))).toThrow(EngineError);
    // Two players left: the round only waits for them.
    const b = run(a.state, open(0, EVEN_PAGE), open(2, EVEN_PAGE));
    expect(b.state.round).toBe(3);
  });

  it("someone knocked out earlier in the order loses their go; shots at them miss", () => {
    // Order is 0, 1, 2. P0 knocks out P2; P1 had aimed at P2.
    const g = arrange(newGame(3), { 9: 5 }, { 9: 5 }, { 1: "dead", 3: "dead", 9: 4 });
    const { events } = run(
      g,
      open(0, pageFor(9)),
      aim(0, 2),
      open(1, pageFor(9)),
      aim(1, 2),
      open(2, pageFor(9)),
    );
    expect(events).toContainEqual({ type: "PlayerOut", player: 2, reason: "shot", by: 0 });
    expect(events).toContainEqual({
      type: "AttackMissed",
      attacker: 1,
      target: 2,
      slot: 9,
      reason: "target_out",
    });
    expect(events).toContainEqual({ type: "GoLost", player: 2 });
  });

  it("lives is configurable", () => {
    const g = arrange(newGame(2, { lives: 1 }), { 9: 5 }, { 9: 4 });
    expect(run(g, open(0, pageFor(9)), open(1, EVEN_PAGE)).state.winner).toBe(0);
  });

  it("leaving knocks you out, and can end the game", () => {
    const g = newGame(3);
    const a = run(g, open(0, EVEN_PAGE), open(1, EVEN_PAGE), { type: "leave", player: 2 });
    expect(a.events).toContainEqual({ type: "PlayerOut", player: 2, reason: "left", by: null });
    expect(a.state.round).toBe(2); // everyone else was done, so the round resolved
    const b = run(a.state, { type: "leave", player: 0 });
    expect(b.state).toMatchObject({ phase: "finished", winner: 1, endReason: "last_standing" });
  });

  it("stalemate: most living slots wins, a tie draws", () => {
    const dead = (...keep: number[]) =>
      Object.fromEntries([1, 3, 5, 7, 9].filter((n) => !keep.includes(n)).map((n) => [n, "dead"]));
    const lone = arrange(newGame(3, { lives: 5 }), dead(1, 7), dead(3), dead(5));
    const a = run(lone, open(0, EVEN_PAGE), open(1, EVEN_PAGE), open(2, EVEN_PAGE));
    expect(a.state).toMatchObject({ phase: "finished", winner: 0, endReason: "stalemate" });
    const tie = arrange(newGame(2, { lives: 5 }), dead(1), dead(3));
    expect(run(tie, open(0, EVEN_PAGE), open(1, EVEN_PAGE)).state.winner).toBeNull();
    const drawMode = arrange(
      newGame(3, { lives: 5, stalemate: "draw" }),
      dead(1, 7),
      dead(3),
      dead(5),
    );
    expect(
      run(drawMode, open(0, EVEN_PAGE), open(1, EVEN_PAGE), open(2, EVEN_PAGE)).state.winner,
    ).toBeNull();
  });
});

describe("lucky cards", () => {
  it("a lucky page gives a card when the round resolves, on top of its normal effect", () => {
    const a = run(newGame(2), open(0, LUCKY_ODD, 2));
    expect(a.state.players[0]!.hand).toEqual([]);
    const { state, events } = run(a.state, open(1, EVEN_PAGE));
    expect(events).toContainEqual({ type: "CardDrawn", player: 0, card: CARDS[2] });
    expect(state.players[0]!.hand).toEqual([CARDS[2]]);
    expect(slotOf(state, 0, 1).stage).toBe(1);
  });

  it("an even lucky page still gives a card", () => {
    const { state } = run(newGame(2), open(0, LUCKY_EVEN, 0), open(1, EVEN_PAGE));
    expect(state.players[0]!.hand).toEqual(["shield"]);
  });

  it("holds at most 3 cards", () => {
    const g = giveCards(newGame(2), 0, "shield", "shield", "steal");
    const { state, events } = run(g, open(0, LUCKY_ODD), open(1, EVEN_PAGE));
    expect(events).toContainEqual({ type: "HandFull", player: 0 });
    expect(state.players[0]!.hand).toHaveLength(3);
  });

  it("no cards when luckyCards is off", () => {
    const { state } = run(
      newGame(2, { luckyCards: false }),
      open(0, LUCKY_ODD),
      open(1, EVEN_PAGE),
    );
    expect(state.players[0]!.hand).toEqual([]);
  });

  it("cards are played before opening the book, and must be held", () => {
    const g = giveCards(newGame(2), 0, "shield");
    expect(() => applyAction(g, card(0, { card: "eraser", target: 1, slot: 1 }))).toThrow(
      EngineError,
    );
    const opened = run(g, open(0, EVEN_PAGE)).state;
    expect(() => applyAction(opened, card(0, { card: "shield", slot: 1 }))).toThrow(EngineError);
    const queued = run(g, card(0, { card: "shield", slot: 1 })).state;
    expect(queued.pending[0]?.card).toEqual({ card: "shield", slot: 1 });
    expect(run(queued, card(0, null)).state.pending[0]?.card).toBeNull();
  });

  it("shield", () => {
    const g = giveCards(arrange(newGame(2), {}, { 3: 5 }), 0, "shield");
    const { state, events } = run(
      g,
      card(0, { card: "shield", slot: 3 }),
      open(0, EVEN_PAGE),
      open(1, pageFor(3)),
    );
    expect(events).toContainEqual({ type: "ShieldRaised", player: 0, slot: 3 });
    // P0 resolves first (order 0, 1), so the shield is up before P1's shot and soaks it up.
    expect(events).toContainEqual({ type: "ShotBlocked", attacker: 1, target: 0, slot: 3 });
    expect(slotOf(state, 0, 3).shielded).toBe(false);
    expect(state.players[0]!.hand).toEqual([]);
  });

  it("eraser removes the top part; on an armed figure, its bullets", () => {
    const g = giveCards(arrange(newGame(2), {}, { 5: 5 }), 0, "eraser");
    const { state, events } = run(
      g,
      card(0, { card: "eraser", target: 1, slot: 5 }),
      open(0, EVEN_PAGE),
      open(1, EVEN_PAGE),
    );
    expect(events).toContainEqual({ type: "PartErased", player: 0, target: 1, slot: 5, stage: 4 });
    expect(slotOf(state, 1, 5).stage).toBe(4);
    expect(() =>
      applyAction(
        giveCards(newGame(2), 0, "eraser"),
        card(0, { card: "eraser", target: 1, slot: 5 }),
      ),
    ).toThrow(EngineError);
  });

  it("swap exchanges two living figures and their shields", () => {
    const g = giveCards(arrange(newGame(2), { 1: "shield", 9: 1 }), 0, "swap");
    const { state } = run(
      g,
      card(0, { card: "swap", slots: [1, 9] }),
      open(0, EVEN_PAGE),
      open(1, EVEN_PAGE),
    );
    expect(slotOf(state, 0, 9)).toMatchObject({ stage: 5, shielded: true });
    expect(slotOf(state, 0, 1)).toMatchObject({ stage: 1, shielded: false });
  });

  it("steal unloads their gun and loads yours if it has a gun", () => {
    const g = giveCards(arrange(newGame(2), { 7: 4 }, { 7: 5 }), 0, "steal");
    const { state, events } = run(
      g,
      card(0, { card: "steal", target: 1, slot: 7 }),
      open(0, EVEN_PAGE),
      open(1, EVEN_PAGE),
    );
    expect(events).toContainEqual({
      type: "BulletsStolen",
      player: 0,
      target: 1,
      slot: 7,
      loaded: true,
    });
    expect([slotOf(state, 0, 7).stage, slotOf(state, 1, 7).stage]).toEqual([5, 4]);
  });

  it("a stolen load can fire the same round, aimed automatically", () => {
    const g = giveCards(arrange(newGame(3), { 7: 4 }, { 7: 5 }, { 7: 4 }), 0, "steal");
    const { events } = run(
      g,
      card(0, { card: "steal", target: 1, slot: 7 }),
      open(0, pageFor(7)), // slot 7 is only a gun now, so no target is asked for
      open(1, EVEN_PAGE),
      open(2, EVEN_PAGE),
    );
    expect(events.find((e) => e.type === "ShotFired")).toMatchObject({ attacker: 0, slot: 7 });
  });

  it("double shot hits two players, and is kept if you don't fire", () => {
    const g = giveCards(
      arrange(newGame(3), { 1: 5 }, { 1: 4 }, { 1: 4 }),
      0,
      "double_shot",
      "double_shot",
    );
    const a = run(g, card(0, { card: "double_shot" }), open(0, pageFor(1)));
    expect(a.state.pending[0]?.done).toBe(true); // two opponents: both are the targets
    const b = run(a.state, open(1, EVEN_PAGE), open(2, EVEN_PAGE));
    expect(b.events).toContainEqual({ type: "ShotFired", attacker: 0, targets: [1, 2], slot: 1 });
    expect([slotOf(b.state, 1, 1).status, slotOf(b.state, 2, 1).status]).toEqual([
      "eliminated",
      "eliminated",
    ]);
    expect(b.state.players[0]!.hand).toEqual(["double_shot"]);
    const c = run(
      b.state,
      card(0, { card: "double_shot" }),
      open(0, EVEN_PAGE),
      open(1, EVEN_PAGE),
      open(2, EVEN_PAGE),
    );
    expect(c.state.players[0]!.hand).toEqual(["double_shot"]);
  });

  it("double shot with 4 players asks for two different targets", () => {
    const g = giveCards(arrange(newGame(4), { 1: 5 }), 0, "double_shot");
    const a = run(g, card(0, { card: "double_shot" }), open(0, pageFor(1)));
    expect(a.state.pending[0]?.needsTarget).toBe(true);
    expect(() => applyAction(a.state, aim(0, 1))).toThrow(EngineError);
    expect(() => applyAction(a.state, aim(0, 1, 1))).toThrow(EngineError);
    expect(run(a.state, aim(0, 1, 3)).state.pending[0]?.targets).toEqual([1, 3]);
  });

  it("double shot needs two opponents", () => {
    const g = giveCards(newGame(2), 0, "double_shot");
    expect(() => applyAction(g, card(0, { card: "double_shot" }))).toThrow(EngineError);
  });

  it("a card whose target is gone fizzles and returns to the hand", () => {
    // Order 0, 1, 2: P0 knocks out P2 before P1's eraser on P2 resolves.
    const g = giveCards(
      arrange(newGame(3), { 9: 5 }, {}, { 1: "dead", 3: "dead", 9: 5 }),
      1,
      "eraser",
    );
    const { state, events } = run(
      g,
      open(0, pageFor(9)),
      aim(0, 2),
      card(1, { card: "eraser", target: 2, slot: 9 }),
      open(1, EVEN_PAGE),
      open(2, EVEN_PAGE),
    );
    expect(events).toContainEqual({ type: "CardFizzled", player: 1, card: "eraser" });
    expect(state.players[1]!.hand).toEqual(["eraser"]);
  });
});

describe("views", () => {
  it("hide other players' hands and unfinished goes", () => {
    const g = giveCards(newGame(3), 1, "shield");
    const s = run(g, open(1, pageFor(3))).state;
    const v = viewFor(s, 0);
    expect(v.players[1]).toMatchObject({ hand: null, handSize: 1 });
    expect(v.pending[1]).toEqual({ hidden: true, done: true });
    expect(v.pending[0]).toMatchObject({ pages: [] });
    expect("history" in v).toBe(false);
    const own = viewFor(s, 1);
    expect(own.players[1]!.hand).toEqual(["shield"]);
    expect(own.pending[1]).toMatchObject({ pages: [pageFor(3)] });
  });

  it("hide which card someone else drew", () => {
    const s = run(newGame(2), open(0, LUCKY_ODD, 1), open(1, EVEN_PAGE)).state;
    const drawn = (v: ReturnType<typeof viewFor>) => v.log.find((e) => e.type === "CardDrawn");
    expect(drawn(viewFor(s, 0))).toEqual({ type: "CardDrawn", player: 0, card: CARDS[1] });
    expect(drawn(viewFor(s, 1))).toEqual({ type: "CardDrawn", player: 0, card: null });
  });
});

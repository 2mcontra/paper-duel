import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  EngineError,
  RulesError,
  applyAction,
  cardForLuck,
  computeAwards,
  createRng,
  destination,
  distance,
  isLuckyPage,
  legalCardPlays,
  legalMoves,
  replay,
  resolveRules,
  rollForPage,
  seriesPoints,
  simulateGame,
  viewFor,
  type GameState,
  type Move,
  type RulesConfig,
} from "../src/index.js";
import { act, arrange, card, giveCards, newGame, open, pageFor, run, turn } from "./helpers.js";

// Two players: track of 20 squares; P0 starts on 0, P1 on 10; stars on 0, 5, 10, 15.

describe("rules config", () => {
  it("defaults", () => {
    expect(resolveRules()).toEqual({
      firstPlayer: "random",
      bullets: "consumed",
      totalPages: 300,
      turnTimerSeconds: 20,
      figures: 3,
      luckyCards: true,
      maxRounds: 40,
    });
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
  });

  it("rejects bad or unknown values", () => {
    const bad = [
      { totalPages: 305 },
      { figures: 0 },
      { figures: 6 },
      { turnTimerSeconds: 2 },
      { maxRounds: 0 },
      { luckyCards: "yes" },
      { bullets: "infinite" },
      { lives: 3 },
    ] as Partial<RulesConfig>[];
    for (const r of bad) expect(() => resolveRules(r)).toThrow(RulesError);
    expect(
      resolveRules({ turnTimerSeconds: null, maxRounds: null, figures: undefined }),
    ).toMatchObject({
      turnTimerSeconds: null,
      maxRounds: null,
      figures: 3,
    });
  });
});

describe("book and board helpers", () => {
  it("rolls the last digit, 0 counting as 10", () => {
    expect([47, 30, 1, 299].map(rollForPage)).toEqual([7, 10, 1, 9]);
  });

  it("lucky pages", () => {
    expect([11, 99, 111, 222, 100, 300].every(isLuckyPage)).toBe(true);
    expect([10, 12, 101, 121, 7].some(isLuckyPage)).toBe(false);
    expect(cardForLuck(0)).toBe("shield");
    expect(cardForLuck(5)).toBe("reroll");
    expect(cardForLuck(6)).toBe("shield");
  });

  it("distance goes the short way round", () => {
    expect(distance(20, 2, 18)).toBe(4);
    expect(distance(20, 18, 2)).toBe(4);
    expect(distance(20, 3, 9)).toBe(6);
  });
});

describe("setup and turns", () => {
  it("starts everyone with head-and-body figures at home", () => {
    const g = newGame(3, { figures: 2 }, 1);
    expect(g.trackLength).toBe(30);
    expect(g.players[0]!.figures).toEqual([
      { stage: 2, pos: null, dead: false, shielded: false },
      { stage: 2, pos: null, dead: false, shielded: false },
    ]);
    expect(g.turn).toMatchObject({ player: 1, roll: null });
    expect(g.log).toEqual([{ type: "TurnStarted", player: 1, round: 1, turn: 1 }]);
  });

  it("only the current player acts, and only after opening the book", () => {
    const g = newGame(2);
    expect(() => applyAction(g, open(1, 41))).toThrow(/not your turn/);
    expect(() => applyAction(g, act(0, { kind: "pass" }))).toThrow(/Open the book/);
    const opened = applyAction(g, open(0, 47)).state;
    expect(opened.turn.roll).toBe(7);
    expect(() => applyAction(opened, open(0, 41))).toThrow(/already opened/);
    expect(() => applyAction(g, open(0, 301))).toThrow(EngineError);
  });

  it("turns go round the table and the round counts up", () => {
    let g = newGame(3, {}, 1);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(g.turn.player);
      g = turn(g, 3, { kind: "pass" }).state;
    }
    expect(seen).toEqual([1, 2, 0, 1]);
    expect(g.round).toBe(2);
    expect(g.turnNumber).toBe(5);
  });

  it("players who are out are skipped", () => {
    let g = newGame(3);
    g = run(g, { type: "leave", player: 1 }).state;
    g = turn(g, 3, { kind: "pass" }).state;
    expect(g.turn.player).toBe(2);
  });
});

describe("moves", () => {
  it("drawing adds the next part, up to loaded", () => {
    let g = newGame(2);
    const r = turn(g, 3, { kind: "draw", figure: 1 });
    expect(r.events).toContainEqual({
      type: "PartDrawn",
      player: 0,
      figure: 1,
      part: "face",
      stage: 3,
    });
    g = arrange(newGame(2), { 0: { 0: { stage: 5 } } });
    expect(() => turn(g, 3, { kind: "draw", figure: 0 })).toThrow(/complete/);
  });

  it("a figure needs a face to walk; from home it enters on the start square", () => {
    expect(() => turn(newGame(2), 3, { kind: "move", figure: 0 })).toThrow(/face/);
    const g = arrange(newGame(2), { 0: { 0: { stage: 3 } } });
    const r = turn(g, 1, { kind: "move", figure: 0 });
    expect(r.events).toContainEqual({
      type: "FigureMoved",
      player: 0,
      figure: 0,
      from: null,
      to: 0,
    });
    // P1 starts on square 10: a roll of 4 from home lands on 13.
    const g2 = arrange(newGame(2, {}, 1), { 1: { 0: { stage: 3 } } });
    expect(turn(g2, 4, { kind: "move", figure: 0 }).state.players[1]!.figures[0]!.pos).toBe(13);
  });

  it("walking wraps round the loop", () => {
    const g = arrange(newGame(2), { 0: { 0: { stage: 3, pos: 17 } } });
    expect(destination(g, 0, 0, 6)).toBe(3);
    expect(turn(g, 6, { kind: "move", figure: 0 }).state.players[0]!.figures[0]!.pos).toBe(3);
  });

  it("landing on an enemy stomps it home and it drops its gun", () => {
    const g = arrange(newGame(2), {
      0: { 0: { stage: 3, pos: 2 } },
      1: { 0: { stage: 5, pos: 8 } },
    });
    const r = turn(g, 6, { kind: "move", figure: 0 });
    expect(r.events).toContainEqual({
      type: "Stomped",
      player: 0,
      figure: 0,
      target: 1,
      targetFigure: 0,
      stage: 3,
    });
    expect(r.state.players[1]!.figures[0]).toMatchObject({ pos: null, stage: 3, dead: false });
    expect(r.state.players[0]!.stats.stomps).toBe(1);
  });

  it("stars are safe from stomps, and a shield takes the stomp", () => {
    const onStar = arrange(newGame(2), {
      0: { 0: { stage: 3, pos: 2 } },
      1: { 0: { stage: 4, pos: 5 } },
    });
    expect(turn(onStar, 3, { kind: "move", figure: 0 }).state.players[1]!.figures[0]!.pos).toBe(5);
    const shielded = arrange(newGame(2), {
      0: { 0: { stage: 3, pos: 2 } },
      1: { 0: { stage: 4, pos: 6, shielded: true } },
    });
    const r = turn(shielded, 4, { kind: "move", figure: 0 });
    expect(r.events.map((e) => e.type)).toContain("ShieldBroken");
    expect(r.state.players[1]!.figures[0]).toMatchObject({ pos: 6, shielded: false });
  });
});

describe("shooting", () => {
  const duel = () =>
    arrange(newGame(2, { figures: 2 }), {
      0: { 0: { stage: 5, pos: 7 } },
      1: { 0: { stage: 4, pos: 11 }, 1: { stage: 3, pos: 3 } },
    });

  it("a loaded figure shoots anything exposed within the roll", () => {
    const g = applyAction(duel(), open(0, pageFor(4))).state;
    const shots = legalMoves(g, 0).filter((m) => m.kind === "shoot");
    expect(shots).toEqual([
      { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 0 }] },
      { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 1 }] },
    ]);
    const r = applyAction(g, act(0, shots[0]!));
    expect(r.events.map((e) => e.type)).toEqual([
      "ShotFired",
      "FigureKilled",
      "BulletsSpent",
      "TurnStarted",
    ]);
    expect(r.state.players[1]!.figures[0]).toMatchObject({ dead: true, pos: null });
    expect(r.state.players[0]!.figures[0]!.stage).toBe(4);
    expect(r.state.players[0]!.stats).toMatchObject({ kills: 1, shots: 1 });
    expect(r.state.players[1]!.stats.deaths).toBe(1);
  });

  it("refuses shots out of range, from a star, or at a star", () => {
    const shoot: Move = { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 0 }] };
    expect(() => turn(duel(), 3, shoot)).toThrow(/range/);
    const fromStar = arrange(duel(), { 0: { 0: { pos: 10 - 0 + 5 } } });
    expect(() => turn(fromStar, 9, shoot)).toThrow(/can't shoot/);
    const atStar = arrange(duel(), { 1: { 0: { pos: 10 } } });
    expect(() => turn(atStar, 9, shoot)).toThrow(/range/);
  });

  it("figures at home can be shot, measured to their start square", () => {
    const g = arrange(newGame(2), { 0: { 0: { stage: 5, pos: 7 } } });
    // P1's home is at square 10, 3 away.
    expect(() =>
      turn(g, 2, { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 2 }] }),
    ).toThrow();
    const r = turn(g, 3, { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 2 }] });
    expect(r.state.players[1]!.figures[2]!.dead).toBe(true);
  });

  it("reusable bullets stay loaded", () => {
    const g = arrange(newGame(2, { bullets: "reusable" }), { 0: { 0: { stage: 5, pos: 7 } } });
    const r = turn(g, 3, { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 0 }] });
    expect(r.state.players[0]!.figures[0]!.stage).toBe(5);
  });

  it("losing your last figure knocks you out, and the last one standing wins", () => {
    let g = newGame(3, { figures: 1 });
    g = arrange(g, { 0: { 0: { stage: 5, pos: 8 } } });
    // P1's home (square 10) is 2 away.
    const r = turn(g, 2, { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 0 }] });
    expect(r.events).toContainEqual({
      type: "PlayerOut",
      player: 1,
      reason: "shot",
      by: 0,
      place: 3,
    });
    expect(r.state.turn.player).toBe(2);
    g = run(r.state, { type: "leave", player: 2 }).state;
    expect(g.phase).toBe("finished");
    expect(g.winner).toBe(0);
    expect(g.endReason).toBe("last_standing");
    expect(g.players.map((p) => p.place)).toEqual([1, 3, 2]);
    expect(g.log.at(-1)).toEqual({
      type: "GameOver",
      winner: 0,
      reason: "last_standing",
      places: [1, 3, 2],
    });
    expect(() => applyAction(g, open(0, 41))).toThrow(/over/);
  });
});

describe("cards", () => {
  it("a lucky page draws a card; a full hand doesn't", () => {
    const r = run(newGame(2), open(0, 111, 4));
    expect(r.events).toContainEqual({ type: "CardDrawn", player: 0, card: "steal" });
    const full = giveCards(newGame(2), 0, "shield", "shield", "shield");
    expect(run(full, open(0, 222)).events).toContainEqual({ type: "HandFull", player: 0 });
    expect(run(newGame(2, { luckyCards: false }), open(0, 111)).state.players[0]!.hand).toEqual([]);
  });

  it("cards are played after opening the book, one per turn", () => {
    const g = giveCards(newGame(2), 0, "shield", "shield");
    expect(() => run(g, card(0, { card: "shield", figure: 0 }))).toThrow(/Open the book/);
    const r = run(g, open(0, 41), card(0, { card: "shield", figure: 0 }));
    expect(r.state.players[0]!.figures[0]!.shielded).toBe(true);
    expect(r.state.players[0]!.hand).toEqual(["shield"]);
    expect(() => run(r.state, card(0, { card: "shield", figure: 1 }))).toThrow(/one card/);
    expect(() => run(newGame(2), open(0, 41), card(0, { card: "shield", figure: 0 }))).toThrow(
      /don't hold/,
    );
  });

  it("a shield takes a shot", () => {
    const g = arrange(newGame(2), {
      0: { 0: { stage: 5, pos: 7 } },
      1: { 0: { stage: 4, pos: 9, shielded: true } },
    });
    const r = turn(g, 3, { kind: "shoot", figure: 0, targets: [{ player: 1, figure: 0 }] });
    expect(r.events.map((e) => e.type)).toContain("ShieldBroken");
    expect(r.state.players[1]!.figures[0]).toMatchObject({ dead: false, shielded: false });
  });

  it("double shot hits two targets in range", () => {
    let g = arrange(newGame(2), {
      0: { 0: { stage: 5, pos: 7 } },
      1: { 0: { stage: 4, pos: 9 }, 1: { stage: 3, pos: 4 } },
    });
    g = giveCards(g, 0, "double_shot");
    g = run(g, open(0, pageFor(3))).state;
    expect(legalCardPlays(g, 0)).toContainEqual({ card: "double_shot" });
    const r = run(
      g,
      card(0, { card: "double_shot" }),
      act(0, {
        kind: "shoot",
        figure: 0,
        targets: [
          { player: 1, figure: 0 },
          { player: 1, figure: 1 },
        ],
      }),
    );
    expect(r.state.players[1]!.figures.filter((f) => f.dead)).toHaveLength(2);
    // Without the card, two targets are refused.
    expect(() =>
      turn(
        arrange(newGame(2), {
          0: { 0: { stage: 5, pos: 7 } },
          1: { 0: { stage: 4, pos: 9 }, 1: { stage: 3, pos: 4 } },
        }),
        3,
        {
          kind: "shoot",
          figure: 0,
          targets: [
            { player: 1, figure: 0 },
            { player: 1, figure: 1 },
          ],
        },
      ),
    ).toThrow(/one target/);
  });

  it("eraser, steal and swap", () => {
    let g = arrange(newGame(2), {
      0: { 0: { stage: 4, pos: 2 } },
      1: { 0: { stage: 5, pos: 12 }, 1: { stage: 1, pos: 16 } },
    });
    g = giveCards(g, 0, "eraser", "steal", "swap");
    g = run(g, open(0, 41)).state;
    const erased = run(g, card(0, { card: "eraser", target: 1, targetFigure: 0 })).state;
    expect(erased.players[1]!.figures[0]!.stage).toBe(4);
    const erasedToNothing = run(g, card(0, { card: "eraser", target: 1, targetFigure: 1 })).state;
    expect(erasedToNothing.players[1]!.figures[1]).toMatchObject({ stage: 0, pos: null });
    const stolen = run(g, card(0, { card: "steal", figure: 0, target: 1, targetFigure: 0 })).state;
    expect(stolen.players[0]!.figures[0]!.stage).toBe(5);
    expect(stolen.players[1]!.figures[0]!.stage).toBe(4);
    const swapped = run(g, card(0, { card: "swap", figure: 0, target: 1, targetFigure: 0 })).state;
    expect(swapped.players[0]!.figures[0]!.pos).toBe(12);
    expect(swapped.players[1]!.figures[0]!.pos).toBe(2);
    // A home figure can't swap; steal needs your own unloaded gun.
    expect(() =>
      run(g, card(0, { card: "swap", figure: 1, target: 1, targetFigure: 0 })),
    ).toThrow();
    expect(() =>
      run(g, card(0, { card: "steal", figure: 1, target: 1, targetFigure: 0 })),
    ).toThrow();
  });

  it("reroll opens the book again", () => {
    const g = giveCards(newGame(2), 0, "reroll");
    const r = run(g, open(0, 42), card(0, { card: "reroll" }, 49));
    expect(r.state.turn.roll).toBe(9);
    expect(r.events.filter((e) => e.type === "BookOpened")).toHaveLength(2);
    expect(() => run(g, open(0, 42), card(0, { card: "reroll" }))).toThrow(/new page/);
  });
});

describe("leaving and the round limit", () => {
  it("leaving on your turn passes the turn on", () => {
    const g = run(newGame(3), open(0, 41), { type: "leave", player: 0 });
    expect(g.state.turn.player).toBe(1);
    expect(g.state.players[0]).toMatchObject({ out: true, place: 3 });
    expect(g.state.players[0]!.figures.every((f) => f.dead)).toBe(true);
  });

  it("after the last round, most figures left wins, then most kills; ties share a place", () => {
    let g = newGame(3, { maxRounds: 1 });
    g = arrange(g, { 1: { 0: { dead: true } }, 2: { 0: { dead: true } } });
    g.players[2]!.stats.kills = 2;
    for (let i = 0; i < 3; i++) g = turn(g, 3, { kind: "pass" }).state;
    expect(g.phase).toBe("finished");
    expect(g.endReason).toBe("time_up");
    expect(g.round).toBe(1);
    expect(g.winner).toBe(0);
    expect(g.players.map((p) => p.place)).toEqual([1, 3, 2]);

    let tie = newGame(2, { maxRounds: 1 });
    for (let i = 0; i < 2; i++) tie = turn(tie, 3, { kind: "pass" }).state;
    expect(tie.winner).toBeNull();
    expect(tie.players.map((p) => p.place)).toEqual([1, 1]);
  });
});

describe("views, purity and replay", () => {
  it("hides other players' cards", () => {
    let g = giveCards(newGame(2), 1, "shield");
    g = run(g, open(0, 111)).state;
    const v = viewFor(g, 1);
    expect(v.players[1]!.hand).toEqual(["shield"]);
    expect(v.players[0]).toMatchObject({ hand: null, handSize: 1 });
    expect(v.log.find((e) => e.type === "CardDrawn")).toEqual({
      type: "CardDrawn",
      player: 0,
      card: null,
    });
    expect("history" in v).toBe(false);
    expect(viewFor(g, 1, 0).log).toEqual([]);
  });

  it("never mutates the input and replays to the same state", () => {
    for (const players of [2, 4, 6]) {
      const { state } = simulateGame({ random: createRng(players), players });
      const initial = newGame(players, {}, state.firstSeat);
      initial.id = "sim";
      initial.players.forEach((p, i) => {
        p.id = `b${i}`;
        p.name = `Bot ${i}`;
      });
      initial.rules = state.rules;
      const snapshot = structuredClone(initial);
      expect(replay(initial, state.history)).toEqual(state);
      expect(initial).toEqual(snapshot);
    }
  });
});

describe("bot games", () => {
  it("always finish with a full, consistent podium", () => {
    const random = createRng(2024);
    for (let i = 0; i < 150; i++) {
      const players = 2 + (i % 5);
      const { state, terminated } = simulateGame({ random, players });
      expect(terminated).toBe(true);
      check(state);
    }
  });
});

function check(g: GameState) {
  const places = g.players.map((p) => p.place!);
  expect(places.every((p) => p >= 1 && p <= g.players.length)).toBe(true);
  if (g.winner !== null) {
    expect(places[g.winner]).toBe(1);
    expect(places.filter((p) => p === 1)).toHaveLength(1);
  }
  if (g.endReason === "last_standing")
    expect(g.players.filter((p) => !p.out)).toHaveLength(g.winner === null ? 0 : 1);
  // Competition ranking: a place k means exactly k-1 players finished ahead.
  for (const p of places) expect(places.filter((q) => q < p)).toHaveLength(p - 1);
  for (const p of g.players) for (const f of p.figures) if (f.dead) expect(f.pos).toBeNull();
}

describe("awards and series points", () => {
  const stats = (s: Partial<GameState["players"][0]["stats"]>, alive = 1) => ({
    stats: {
      kills: 0,
      stomps: 0,
      parts: 0,
      shots: 0,
      cardsPlayed: 0,
      deaths: 0,
      rollTotal: 0,
      rolls: 0,
      squares: 0,
      ...s,
    },
    figures: [{ dead: alive < 1 }, { dead: alive < 2 }],
  });

  it("go to a single best player", () => {
    const awards = computeAwards([
      stats({ kills: 3, rolls: 4, rollTotal: 32 }, 2),
      stats({ kills: 1, stomps: 2, rolls: 4, rollTotal: 8 }, 0),
      stats({ kills: 1, rolls: 2, rollTotal: 20 }, 0),
    ]);
    expect(awards).toEqual([
      { id: "sharpshooter", player: 0, value: 3 },
      { id: "stomper", player: 1, value: 2 },
      { id: "survivor", player: 0, value: 2 },
      { id: "lucky", player: 0, value: 8 },
      { id: "unlucky", player: 1, value: 2 },
    ]);
    // A tie gives nobody the award.
    expect(
      computeAwards([stats({ kills: 1 }), stats({ kills: 1 })]).some(
        (a) => a.id === "sharpshooter",
      ),
    ).toBe(false);
  });

  it("series points: 3, 2, 1, and last place never scores", () => {
    expect([1, 2, 3, 4].map((p) => seriesPoints(p, 4))).toEqual([3, 2, 1, 0]);
    expect([1, 2].map((p) => seriesPoints(p, 2))).toEqual([3, 0]);
    expect(seriesPoints(1, 1)).toBe(0);
  });
});

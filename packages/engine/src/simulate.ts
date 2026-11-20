import {
  applyAction,
  canShoot,
  createGame,
  destination,
  distance,
  figuresLeft,
  isStar,
  legalCardPlays,
  legalMoves,
  rangeSquare,
  shootTargets,
  startSquare,
  stompVictims,
} from "./engine.js";
import { randomPage } from "./rng.js";
import {
  CAN_WALK,
  HAS_GUN,
  LOADED,
  type Action,
  type CardPlay,
  type FigureRef,
  type GameState,
  type Move,
  type PlayerIndex,
  type RulesConfig,
} from "./types.js";

/** How far a bot worries about enemy guns (an average roll is 5.5). */
const DANGER_RANGE = 6;

/** Loaded enemy figures that could plausibly shoot a figure standing on `square`. */
function danger(game: GameState, p: PlayerIndex, square: number | null): number {
  if (square !== null && isStar(square)) return 0;
  const at = square ?? startSquare(p);
  let n = 0;
  game.players.forEach((pl, t) => {
    if (t === p || pl.out) return;
    for (const f of pl.figures) {
      if (canShoot(f) && distance(game.trackLength, f.pos!, at) <= DANGER_RANGE) n++;
    }
  });
  return n;
}

function targetValue(game: GameState, t: FigureRef): number {
  const owner = game.players[t.player]!;
  const f = owner.figures[t.figure]!;
  let v = 100;
  if (f.stage === LOADED) v += 30;
  else if (f.stage >= HAS_GUN) v += 15;
  if (f.shielded) v -= 70;
  if (figuresLeft(owner) === 1) v += 40; // finishing someone off
  return v;
}

function scoreMove(game: GameState, p: PlayerIndex, m: Move): number {
  const me = game.players[p]!;
  const roll = game.turn.roll!;
  switch (m.kind) {
    case "pass":
      return -50;
    case "shoot":
      return m.targets.reduce((s, t) => s + targetValue(game, t), 0);
    case "draw": {
      const f = me.figures[m.figure]!;
      let s = 18 + f.stage * 2;
      if (f.pos !== null && f.stage === HAS_GUN) s += 30; // reload on the track
      if (f.pos !== null && f.stage < HAS_GUN) s += 12;
      if (f.stage === LOADED - 1 && f.pos === null) s += 4;
      if (danger(game, p, f.pos) > 0 && f.stage < HAS_GUN) s -= 4;
      return s;
    }
    case "move": {
      const f = me.figures[m.figure]!;
      const to = destination(game, p, m.figure, roll);
      let s = 10;
      if (f.pos === null) s += 8;
      for (const v of stompVictims(game, p, to)) {
        const vf = game.players[v.player]!.figures[v.figure]!;
        s += vf.shielded ? 5 : 50 + (vf.stage >= HAS_GUN ? 15 : 0);
      }
      if (isStar(to)) s += 6;
      s += 12 * danger(game, p, f.pos) - 12 * danger(game, p, to);
      if (f.stage === LOADED) {
        // Moving into range of someone for next turn.
        const near = game.players.some(
          (pl, t) =>
            t !== p &&
            !pl.out &&
            pl.figures.some(
              (_, i) =>
                distance(game.trackLength, to, rangeSquare(game, { player: t, figure: i })) <= 5,
            ),
        );
        if (near && !isStar(to)) s += 14;
      } else if (f.stage < HAS_GUN) {
        s -= 6; // unarmed walkers are easy prey
      }
      return s;
    }
  }
}

/** A simple bot's move: the best-scoring legal move, with a little noise. */
export function botMove(game: GameState, p: PlayerIndex, random: () => number): Move {
  const moves = legalMoves(game, p);
  let best: Move = { kind: "pass" };
  let bestScore = -Infinity;
  const roll = game.turn.roll!;
  // With a double shot active, try pairing the two best targets.
  if (game.turn.doubleShot) {
    game.players[p]!.figures.forEach((_, i) => {
      const ts = shootTargets(game, p, i, roll)
        .map((t) => ({ t, v: targetValue(game, t) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      if (ts.length === 2) moves.push({ kind: "shoot", figure: i, targets: ts.map((x) => x.t) });
    });
  }
  for (const m of moves) {
    const s = scoreMove(game, p, m) + random() * 8;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

/** A simple bot's card choice after rolling: something useful it can play now, or null. */
export function botCard(game: GameState, p: PlayerIndex, random: () => number): CardPlay | null {
  const plays = legalCardPlays(game, p);
  if (!plays.length) return null;
  const me = game.players[p]!;
  const roll = game.turn.roll!;
  const canShootNow = me.figures.some((_, i) => shootTargets(game, p, i, roll).length > 0);
  const scored = plays.map((play) => {
    let s = 0;
    switch (play.card) {
      case "double_shot":
        s = 90;
        break;
      case "steal":
        s = 70;
        break;
      case "shield": {
        const f = me.figures[play.figure]!;
        s = danger(game, p, f.pos) > 0 ? 40 + f.stage * 5 : 0;
        break;
      }
      case "eraser": {
        const f = game.players[play.target]!.figures[play.targetFigure]!;
        s = f.stage === LOADED ? 45 : f.stage === CAN_WALK ? 10 : 0;
        if (f.stage === LOADED && danger(game, p, null) === 0) s -= 15;
        break;
      }
      case "swap": {
        const mine = me.figures[play.figure]!;
        const theirs = game.players[play.target]!.figures[play.targetFigure]!;
        s = danger(game, p, mine.pos) - danger(game, p, theirs.pos) > 0 ? 30 : 0;
        break;
      }
      case "reroll":
        s = roll <= 2 && !canShootNow ? 50 : 0;
        break;
    }
    return { play, s: s + random() * 10 };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]!.s >= 35 ? scored[0]!.play : null;
}

/** The actions a bot takes for the rest of its turn, applied one by one. */
export function botTurn(
  game: GameState,
  p: PlayerIndex,
  random: () => number,
  page: () => number,
): Action[] {
  const actions: Action[] = [];
  let s = game;
  const act = (a: Action) => {
    actions.push(a);
    s = applyAction(s, a).state;
  };
  if (s.turn.roll === null) {
    act({ type: "open_book", player: p, page: page(), luck: Math.floor(random() * 1e6) });
  }
  if (s.phase !== "playing") return actions;
  const card = botCard(s, p, random);
  if (card) {
    act(
      card.card === "reroll"
        ? {
            type: "play_card",
            player: p,
            play: card,
            page: page(),
            luck: Math.floor(random() * 1e6),
          }
        : { type: "play_card", player: p, play: card },
    );
  }
  if (s.phase === "playing") act({ type: "act", player: p, move: botMove(s, p, random) });
  return actions;
}

export interface SimOptions {
  random: () => number;
  players?: number;
  rules?: Partial<RulesConfig>;
  firstSeat?: PlayerIndex;
  /** Turns before giving up (a safety net; the round limit normally ends games). */
  maxTurns?: number;
}

export interface SimResult {
  state: GameState;
  turns: number;
  terminated: boolean;
}

/** Plays one game between bots. */
export function simulateGame(opts: SimOptions): SimResult {
  const { random, maxTurns = 20_000 } = opts;
  const count = opts.players ?? 2;
  let state = createGame({
    id: "sim",
    players: Array.from({ length: count }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` })),
    firstSeat: opts.firstSeat ?? Math.floor(random() * count),
    ...(opts.rules ? { rules: opts.rules } : {}),
  });
  let turns = 0;
  const page = () => randomPage(state.rules.totalPages, random);
  while (state.phase === "playing" && turns < maxTurns) {
    for (const a of botTurn(state, state.turn.player, random, page)) {
      state = applyAction(state, a).state;
    }
    turns++;
  }
  return { state, turns, terminated: state.phase === "finished" };
}

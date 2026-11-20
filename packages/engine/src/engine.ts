import { DEFAULT_RULES, resolveRules, type RulesOverrides } from "./rules.js";
import {
  CAN_WALK,
  START_STAGE,
  CARDS,
  HAND_LIMIT,
  HAS_GUN,
  LOADED,
  PARTS,
  SQUARES_PER_SEAT,
  STAR_EVERY,
  type Action,
  type ActionResult,
  type Card,
  type CardPlay,
  type Figure,
  type FigureIndex,
  type FigureRef,
  type GameEvent,
  type GameState,
  type Move,
  type PlayerIndex,
  type PlayerState,
  type PlayerStats,
  type Stage,
} from "./types.js";

export class EngineError extends Error {
  override name = "EngineError";
}

// ---------- pure helpers (shared with the client) ----------

/** The roll a page gives: its last digit, with 0 counting as 10. */
export function rollForPage(page: number): number {
  const d = page % 10;
  return d === 0 ? 10 : d;
}

/** 100, 200, 300... and repeated-digit pages (11, 22, ..., 111, 222) give a card. */
export function isLuckyPage(page: number): boolean {
  if (page % 100 === 0) return true;
  const s = String(page);
  return s.length >= 2 && [...s].every((c) => c === s[0]);
}

export function cardForLuck(luck: number): Card {
  return CARDS[Math.abs(Math.trunc(luck)) % CARDS.length]!;
}

export function startSquare(p: PlayerIndex): number {
  return p * SQUARES_PER_SEAT;
}

export function isStar(square: number): boolean {
  return square % STAR_EVERY === 0;
}

/** Steps between two squares on the loop, the short way round. */
export function distance(trackLength: number, a: number, b: number): number {
  const d = Math.abs(a - b) % trackLength;
  return Math.min(d, trackLength - d);
}

/** Minimal shape the helpers below read, so the client can pass its views too. */
interface BoardLike {
  trackLength: number;
  players: readonly { figures: readonly Figure[]; out: boolean }[];
}

export const figuresLeft = (p: { figures: readonly { dead: boolean }[] }) =>
  p.figures.filter((f) => !f.dead).length;

/** Where a figure stands for range purposes: its square, or its home's start square. */
export function rangeSquare(game: BoardLike, ref: FigureRef): number {
  return game.players[ref.player]!.figures[ref.figure]!.pos ?? startSquare(ref.player);
}

/** Can this figure be shot or stomped right now? Stars protect figures standing on them. */
export function isExposed(game: BoardLike, ref: FigureRef): boolean {
  const owner = game.players[ref.player];
  const f = owner?.figures[ref.figure];
  if (!owner || !f || owner.out || f.dead || f.stage === 0) return false;
  return f.pos === null || !isStar(f.pos);
}

/** Square a figure would land on after walking `roll` squares. */
export function destination(
  game: BoardLike,
  player: PlayerIndex,
  figure: FigureIndex,
  roll: number,
): number {
  const f = game.players[player]!.figures[figure]!;
  const from = f.pos ?? startSquare(player) - 1;
  return (((from + roll) % game.trackLength) + game.trackLength) % game.trackLength;
}

/** Can this figure shoot (loaded, on the track, not on a star)? */
export function canShoot(f: Figure): boolean {
  return !f.dead && f.stage === LOADED && f.pos !== null && !isStar(f.pos);
}

/** Enemy figures this figure could shoot with this roll. */
export function shootTargets(
  game: BoardLike,
  player: PlayerIndex,
  figure: FigureIndex,
  roll: number,
): FigureRef[] {
  const f = game.players[player]?.figures[figure];
  if (!f || !canShoot(f)) return [];
  const out: FigureRef[] = [];
  game.players.forEach((p, t) => {
    if (t === player || p.out) return;
    p.figures.forEach((_, i) => {
      const ref = { player: t, figure: i };
      if (!isExposed(game, ref)) return;
      if (distance(game.trackLength, f.pos!, rangeSquare(game, ref)) <= roll) out.push(ref);
    });
  });
  return out;
}

/** Enemy figures standing on a square (that a figure landing there would stomp). */
export function stompVictims(game: BoardLike, player: PlayerIndex, square: number): FigureRef[] {
  if (isStar(square)) return [];
  const out: FigureRef[] = [];
  game.players.forEach((p, t) => {
    if (t === player || p.out) return;
    p.figures.forEach((f, i) => {
      if (!f.dead && f.pos === square) out.push({ player: t, figure: i });
    });
  });
  return out;
}

/** A game or a player's view of one: what the move helpers read. */
export interface TurnBoard extends BoardLike {
  phase: GameState["phase"];
  turn: GameState["turn"];
  players: readonly { figures: readonly Figure[]; out: boolean; hand: readonly Card[] | null }[];
}

/** Every legal move for the current player (shots with one target each). */
export function legalMoves(game: TurnBoard, player: PlayerIndex): Move[] {
  const roll = game.turn.roll;
  if (game.phase !== "playing" || game.turn.player !== player || roll === null) return [];
  const me = game.players[player]!;
  const moves: Move[] = [];
  me.figures.forEach((f, i) => {
    if (f.dead) return;
    for (const t of shootTargets(game, player, i, roll)) {
      moves.push({ kind: "shoot", figure: i, targets: [t] });
    }
    if (f.stage >= CAN_WALK) moves.push({ kind: "move", figure: i });
    if (f.stage < LOADED) moves.push({ kind: "draw", figure: i });
  });
  moves.push({ kind: "pass" });
  return moves;
}

/** Every card play the current player may make now (reroll included). */
export function legalCardPlays(game: TurnBoard, player: PlayerIndex): CardPlay[] {
  const { turn } = game;
  const roll = turn.roll;
  if (game.phase !== "playing" || turn.player !== player || roll === null || turn.cardPlayed) {
    return [];
  }
  const me = game.players[player]!;
  const plays: CardPlay[] = [];
  const enemies: (FigureRef & { f: Figure })[] = [];
  game.players.forEach((p, t) => {
    if (t === player || p.out) return;
    p.figures.forEach((f, i) => {
      if (!f.dead) enemies.push({ player: t, figure: i, f });
    });
  });
  for (const card of new Set(me.hand ?? [])) {
    switch (card) {
      case "shield":
        me.figures.forEach((f, i) => {
          if (!f.dead && f.stage > 0 && !f.shielded) plays.push({ card, figure: i });
        });
        break;
      case "double_shot":
        if (me.figures.some((_, i) => shootTargets(game, player, i, roll).length >= 2)) {
          plays.push({ card });
        }
        break;
      case "eraser":
        for (const e of enemies) {
          if (e.f.stage > 0) plays.push({ card, target: e.player, targetFigure: e.figure });
        }
        break;
      case "swap":
        me.figures.forEach((f, i) => {
          if (f.dead || f.pos === null) return;
          for (const e of enemies) {
            if (e.f.pos !== null) {
              plays.push({ card, figure: i, target: e.player, targetFigure: e.figure });
            }
          }
        });
        break;
      case "steal":
        me.figures.forEach((f, i) => {
          if (f.dead || f.stage !== HAS_GUN) return;
          for (const e of enemies) {
            if (e.f.stage === LOADED) {
              plays.push({ card, figure: i, target: e.player, targetFigure: e.figure });
            }
          }
        });
        break;
      case "reroll":
        plays.push({ card });
        break;
    }
  }
  return plays;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- game setup ----------

const emptyStats = (): PlayerStats => ({
  kills: 0,
  stomps: 0,
  parts: 0,
  shots: 0,
  cardsPlayed: 0,
  deaths: 0,
  rollTotal: 0,
  rolls: 0,
  squares: 0,
});

export interface NewGame {
  id: string;
  players: { id: string; name: string }[];
  firstSeat: PlayerIndex;
  rules?: RulesOverrides;
}

export function createGame({ id, players, firstSeat, rules }: NewGame): GameState {
  if (players.length < 2 || players.length > 6) {
    throw new EngineError(`A game needs 2 to 6 players, got ${players.length}`);
  }
  if (!Number.isInteger(firstSeat) || firstSeat < 0 || firstSeat >= players.length) {
    throw new EngineError(`Bad first seat ${firstSeat}`);
  }
  const resolved = resolveRules({ ...DEFAULT_RULES, ...rules });
  const state: GameState = {
    id,
    phase: "playing",
    players: players.map((p): PlayerState => ({
      id: p.id,
      name: p.name,
      figures: Array.from({ length: resolved.figures }, () => ({
        stage: START_STAGE,
        pos: null,
        dead: false,
        shielded: false,
      })),
      hand: [],
      out: false,
      place: null,
      stats: emptyStats(),
    })),
    trackLength: players.length * SQUARES_PER_SEAT,
    round: 1,
    turnNumber: 1,
    firstSeat,
    turn: { player: firstSeat, page: null, roll: null, cardPlayed: false, doubleShot: false },
    log: [],
    history: [],
    winner: null,
    endReason: null,
    rules: resolved,
  };
  state.log.push({ type: "TurnStarted", player: firstSeat, round: 1, turn: 1 });
  return state;
}

// ---------- actions ----------

export function applyAction(prev: GameState, action: Action): ActionResult {
  if (prev.phase !== "playing") throw new EngineError("The game is over");
  // Events and actions are never mutated, so the (long) log and history are copied shallowly.
  const { log, history, ...rest } = prev;
  const state: GameState = { ...structuredClone(rest), log: log.slice(), history: history.slice() };
  const events: GameEvent[] = [];
  const emit = (e: GameEvent) => {
    events.push(e);
    state.log.push(e);
  };
  const player = state.players[action.player];
  if (!player) throw new EngineError(`No player ${action.player}`);

  if (action.type === "leave") {
    if (player.out) throw new EngineError("That player is already out");
    knockOut(state, action.player, "left", null, emit);
    if (state.phase === "playing" && state.turn.player === action.player) endTurn(state, emit);
    state.history.push(action);
    return { state, events };
  }

  if (player.out) throw new EngineError("You are out of the game");
  if (state.turn.player !== action.player) throw new EngineError("It's not your turn");
  const turn = state.turn;

  switch (action.type) {
    case "open_book": {
      if (turn.roll !== null) throw new EngineError("You already opened the book this turn");
      openBook(state, action.player, action.page, action.luck, emit);
      break;
    }
    case "play_card": {
      if (turn.roll === null) throw new EngineError("Open the book before playing a card");
      if (turn.cardPlayed) throw new EngineError("Only one card per turn");
      if (!player.hand.includes(action.play.card))
        throw new EngineError("You don't hold that card");
      if (!legalCardPlays(state, action.player).some((p) => sameJson(p, action.play))) {
        throw new EngineError("That card can't be played like that now");
      }
      if (action.play.card === "reroll" && action.page === undefined) {
        throw new EngineError("A reroll needs a new page");
      }
      player.hand.splice(player.hand.indexOf(action.play.card), 1);
      turn.cardPlayed = true;
      player.stats.cardsPlayed++;
      emit({ type: "CardPlayed", player: action.player, play: action.play });
      playCard(state, action.player, action.play, action, emit);
      break;
    }
    case "act": {
      if (turn.roll === null) throw new EngineError("Open the book first");
      doMove(state, action.player, action.move, emit);
      if (state.phase === "playing") endTurn(state, emit);
      break;
    }
  }
  state.history.push(action);
  return { state, events };
}

type Emit = (e: GameEvent) => void;

function openBook(state: GameState, p: PlayerIndex, page: number, luck: number, emit: Emit) {
  const { totalPages, luckyCards } = state.rules;
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new EngineError(`Page ${page} is not in the book`);
  }
  const roll = rollForPage(page);
  const player = state.players[p]!;
  state.turn.page = page;
  state.turn.roll = roll;
  player.stats.rolls++;
  player.stats.rollTotal += roll;
  emit({ type: "BookOpened", player: p, page, roll });
  if (luckyCards && isLuckyPage(page)) {
    if (player.hand.length >= HAND_LIMIT) {
      emit({ type: "HandFull", player: p });
    } else {
      const card = cardForLuck(luck);
      player.hand.push(card);
      emit({ type: "CardDrawn", player: p, card });
    }
  }
}

function playCard(
  state: GameState,
  p: PlayerIndex,
  play: CardPlay,
  action: Extract<Action, { type: "play_card" }>,
  emit: Emit,
) {
  const me = state.players[p]!;
  switch (play.card) {
    case "shield":
      me.figures[play.figure]!.shielded = true;
      emit({ type: "ShieldRaised", player: p, figure: play.figure });
      return;
    case "double_shot":
      state.turn.doubleShot = true;
      return;
    case "eraser": {
      const f = state.players[play.target]!.figures[play.targetFigure]!;
      f.stage = (f.stage - 1) as Stage;
      if (f.stage === 0) f.pos = null; // nothing left on the track: back home
      emit({
        type: "PartErased",
        player: p,
        target: play.target,
        figure: play.targetFigure,
        stage: f.stage,
      });
      return;
    }
    case "swap": {
      const mine = me.figures[play.figure]!;
      const theirs = state.players[play.target]!.figures[play.targetFigure]!;
      [mine.pos, theirs.pos] = [theirs.pos, mine.pos];
      emit({ type: "Swapped", player: p, ...pick(play) });
      return;
    }
    case "steal": {
      state.players[play.target]!.figures[play.targetFigure]!.stage = HAS_GUN;
      me.figures[play.figure]!.stage = LOADED;
      emit({ type: "BulletsStolen", player: p, ...pick(play) });
      return;
    }
    case "reroll":
      openBook(state, p, action.page!, action.luck ?? 0, emit);
      return;
  }
}

const pick = (play: { figure: number; target: number; targetFigure: number }) => ({
  figure: play.figure,
  target: play.target,
  targetFigure: play.targetFigure,
});

function doMove(state: GameState, p: PlayerIndex, move: Move, emit: Emit) {
  const me = state.players[p]!;
  const roll = state.turn.roll!;
  if (move.kind === "pass") {
    emit({ type: "Passed", player: p });
    return;
  }
  const f = me.figures[move.figure];
  if (!f || f.dead) throw new EngineError("No such figure");

  if (move.kind === "draw") {
    if (f.stage >= LOADED) throw new EngineError("That figure is complete");
    f.stage = (f.stage + 1) as Stage;
    me.stats.parts++;
    emit({
      type: "PartDrawn",
      player: p,
      figure: move.figure,
      part: PARTS[f.stage - 1]!,
      stage: f.stage,
    });
    return;
  }

  if (move.kind === "move") {
    if (f.stage < CAN_WALK) throw new EngineError("A figure needs a face before it can walk");
    const to = destination(state, p, move.figure, roll);
    const from = f.pos;
    const victims = stompVictims(state, p, to);
    f.pos = to;
    me.stats.squares += roll;
    emit({ type: "FigureMoved", player: p, figure: move.figure, from, to });
    for (const v of victims) {
      const target = state.players[v.player]!.figures[v.figure]!;
      if (target.shielded) {
        target.shielded = false;
        emit({ type: "ShieldBroken", player: p, target: v.player, targetFigure: v.figure });
        continue;
      }
      target.pos = null;
      target.stage = Math.min(target.stage, CAN_WALK) as Stage;
      me.stats.stomps++;
      emit({
        type: "Stomped",
        player: p,
        figure: move.figure,
        target: v.player,
        targetFigure: v.figure,
        stage: target.stage,
      });
    }
    return;
  }

  // shoot
  const allowed = shootTargets(state, p, move.figure, roll);
  if (!canShoot(f)) throw new EngineError("That figure can't shoot");
  const max = state.turn.doubleShot ? 2 : 1;
  const keys = new Set(move.targets.map((t) => `${t.player}:${t.figure}`));
  if (move.targets.length < 1 || move.targets.length > max || keys.size !== move.targets.length) {
    throw new EngineError(max === 2 ? "Pick one or two targets" : "Pick one target");
  }
  for (const t of move.targets) {
    if (!allowed.some((a) => a.player === t.player && a.figure === t.figure)) {
      throw new EngineError("That target is out of range");
    }
  }
  me.stats.shots++;
  emit({ type: "ShotFired", player: p, figure: move.figure, targets: move.targets });
  const hit = new Set<PlayerIndex>();
  for (const t of move.targets) {
    const target = state.players[t.player]!.figures[t.figure]!;
    if (target.shielded) {
      target.shielded = false;
      emit({ type: "ShieldBroken", player: p, target: t.player, targetFigure: t.figure });
      continue;
    }
    target.dead = true;
    target.pos = null;
    me.stats.kills++;
    state.players[t.player]!.stats.deaths++;
    hit.add(t.player);
    emit({
      type: "FigureKilled",
      player: p,
      figure: move.figure,
      target: t.player,
      targetFigure: t.figure,
    });
  }
  if (state.rules.bullets === "consumed") {
    f.stage = HAS_GUN;
    emit({ type: "BulletsSpent", player: p, figure: move.figure });
  }
  // Everyone wiped out by the same shot shares a place.
  const wiped = [...hit].filter((t) => figuresLeft(state.players[t]!) === 0);
  const place = state.players.filter((x) => !x.out).length - wiped.length + 1;
  for (const t of wiped) knockOut(state, t, "shot", p, emit, place);
}

function knockOut(
  state: GameState,
  p: PlayerIndex,
  reason: "shot" | "left",
  by: PlayerIndex | null,
  emit: Emit,
  place = state.players.filter((x) => !x.out).length,
) {
  const player = state.players[p]!;
  player.out = true;
  player.place = place;
  player.hand = [];
  for (const f of player.figures) {
    f.pos = null;
    f.shielded = false;
    if (reason === "left") f.dead = true;
  }
  emit({ type: "PlayerOut", player: p, reason, by, place });
  const left = state.players.flatMap((x, i) => (x.out ? [] : [i]));
  if (left.length <= 1) {
    const winner = left[0] ?? null;
    if (winner !== null) state.players[winner]!.place = 1;
    finish(state, winner, "last_standing", emit);
  }
}

function finish(
  state: GameState,
  winner: PlayerIndex | null,
  reason: "last_standing" | "time_up",
  emit: Emit,
) {
  state.phase = "finished";
  state.winner = winner;
  state.endReason = reason;
  for (const pl of state.players) {
    for (const f of pl.figures) f.shielded = false;
  }
  emit({
    type: "GameOver",
    winner,
    reason,
    places: state.players.map((x) => x.place ?? state.players.length),
  });
}

/** Ends the turn: next player still in, a new round when it wraps past the first seat. */
function endTurn(state: GameState, emit: Emit) {
  const n = state.players.length;
  const cur = state.turn.player;
  const rel = (i: number) => (i - state.firstSeat + n) % n;
  let next = cur;
  for (let k = 1; k <= n; k++) {
    const i = (cur + k) % n;
    if (!state.players[i]!.out) {
      next = i;
      break;
    }
  }
  if (rel(next) <= rel(cur)) {
    state.round++;
    const max = state.rules.maxRounds;
    if (max !== null && state.round > max) {
      state.round = max;
      return timeUp(state, emit);
    }
  }
  state.turnNumber++;
  state.turn = { player: next, page: null, roll: null, cardPlayed: false, doubleShot: false };
  emit({ type: "TurnStarted", player: next, round: state.round, turn: state.turnNumber });
}

/** The round limit was reached: rank who's left by figures, then kills. Ties share a place. */
function timeUp(state: GameState, emit: Emit) {
  const left = state.players.flatMap((x, i) => (x.out ? [] : [i]));
  const score = (i: number) => {
    const pl = state.players[i]!;
    return [figuresLeft(pl), pl.stats.kills] as const;
  };
  const better = (a: number, b: number) => {
    const [fa, ka] = score(a);
    const [fb, kb] = score(b);
    return fa !== fb ? fb - fa : kb - ka;
  };
  left.sort(better);
  left.forEach((i, k) => {
    const prev = left[k - 1];
    state.players[i]!.place =
      prev !== undefined && better(prev, i) === 0 ? state.players[prev]!.place : k + 1;
  });
  const firsts = left.filter((i) => state.players[i]!.place === 1);
  finish(state, firsts.length === 1 ? firsts[0]! : null, "time_up", emit);
}

/** Rebuilds a game from its starting state and action history (both from the server). */
export function replay(initial: GameState, history: Action[]): GameState {
  let s = initial;
  for (const a of history) s = applyAction(s, a).state;
  return s;
}

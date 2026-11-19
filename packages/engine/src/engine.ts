import { resolveRules, type RulesOverrides } from "./rules.js";
import {
  ARMED,
  CARDS,
  HAND_LIMIT,
  HAS_GUN,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PARTS,
  SLOT_NUMBERS,
  type Action,
  type ActionResult,
  type Card,
  type CardPlay,
  type EndReason,
  type GameEvent,
  type GameState,
  type PlayerIndex,
  type PlayerState,
  type Slot,
  type SlotNumber,
  type Stage,
  type Submission,
} from "./types.js";

export class EngineError extends Error {
  override name = "EngineError";
}

// ---------- small helpers ----------

export function isSlotNumber(n: number): n is SlotNumber {
  return (SLOT_NUMBERS as readonly number[]).includes(n);
}

/** The slot a page selects, or null when its last digit is even. */
export function slotForPage(page: number): SlotNumber | null {
  const digit = page % 10;
  return isSlotNumber(digit) ? digit : null;
}

/** 100, 200, 300 ... and repeated-digit pages (11, 22, ..., 99, 111, 222, ...). */
export function isLuckyPage(page: number): boolean {
  if (page % 100 === 0) return true;
  const s = String(page);
  return s.length >= 2 && [...s].every((c) => c === s[0]);
}

export function cardForLuck(luck: number): Card {
  return CARDS[Math.abs(Math.trunc(luck)) % CARDS.length]!;
}

export function getSlot(player: PlayerState, n: SlotNumber): Slot {
  const slot = player.slots[(n - 1) / 2];
  if (!slot || slot.number !== n) throw new EngineError(`Slot ${n} missing`);
  return slot;
}

export function aliveCount(player: PlayerState): number {
  return player.slots.filter((s) => s.status === "alive").length;
}

export function lostCount(player: PlayerState): number {
  return player.slots.length - aliveCount(player);
}

export function activePlayers(state: GameState): PlayerIndex[] {
  return state.players.flatMap((p, i) => (p.out ? [] : [i]));
}

/** Opponents still in the game. */
export function opponentsOf(state: GameState, p: PlayerIndex): PlayerIndex[] {
  return activePlayers(state).filter((i) => i !== p);
}

/** This round's resolve order: active players, starting one seat later each round. */
export function roundOrder(state: GameState): PlayerIndex[] {
  const n = state.players.length;
  const start = (state.firstSeat + state.round - 1) % n;
  const order: PlayerIndex[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!state.players[i]!.out) order.push(i);
  }
  return order;
}

/**
 * Best targets for player `p` firing slot `n`: opponents whose slot n has an unshielded gun
 * first, then any living figure there, then the rest; ties go to the next seat round the table.
 * Used for automatic targets (timeouts, bots) and as the UI's suggestion.
 */
export function suggestTargets(
  state: GameState,
  p: PlayerIndex,
  n: SlotNumber,
  count = 1,
): PlayerIndex[] {
  const seats = state.players.length;
  const score = (t: PlayerIndex) => {
    const s = getSlot(state.players[t]!, n);
    if (s.status !== "alive") return 3;
    if (s.stage >= HAS_GUN && !s.shielded) return 0;
    if (s.stage >= HAS_GUN) return 1;
    return 2;
  };
  return opponentsOf(state, p)
    .sort((a, b) => score(a) - score(b) || ((a - p + seats) % seats) - ((b - p + seats) % seats))
    .slice(0, count);
}

function emptySubmission(): Submission {
  return { pages: [], draws: [], targets: [], needsTarget: false, card: null, done: false };
}

// ---------- game setup ----------

export interface NewGameOptions {
  id: string;
  players: { id: string; name: string }[];
  /** Seat first in the round-1 order. The caller (server) resolves R2 and passes the result. */
  firstSeat: PlayerIndex;
  rules?: RulesOverrides;
}

export function createGame(opts: NewGameOptions): GameState {
  const count = opts.players.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
    throw new EngineError(`A game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players, got ${count}`);
  }
  if (!Number.isInteger(opts.firstSeat) || opts.firstSeat < 0 || opts.firstSeat >= count) {
    throw new EngineError(`firstSeat ${opts.firstSeat} is not a seat`);
  }
  const players: PlayerState[] = opts.players.map((p) => ({
    id: p.id,
    name: p.name,
    out: false,
    hand: [],
    slots: SLOT_NUMBERS.map((number) => ({
      number,
      stage: 0 as Stage,
      status: "alive" as const,
      shielded: false,
    })),
  }));
  const state: GameState = {
    id: opts.id,
    phase: "playing",
    players,
    round: 1,
    firstSeat: opts.firstSeat,
    pending: players.map(() => emptySubmission()),
    log: [],
    history: [],
    winner: null,
    endReason: null,
    rules: resolveRules(opts.rules),
  };
  state.log.push({ type: "RoundStarted", round: 1, order: roundOrder(state) });
  return state;
}

// ---------- drafts (copy-on-write) ----------

interface Draft {
  s: GameState;
  events: GameEvent[];
}

function begin(state: GameState, action: Action): Draft {
  return {
    s: {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        hand: p.hand.slice(),
        slots: p.slots.map((sl) => ({ ...sl })),
      })),
      pending: state.pending.map((sub) =>
        sub
          ? {
              ...sub,
              pages: sub.pages.slice(),
              draws: sub.draws.slice(),
              targets: sub.targets.slice(),
            }
          : null,
      ),
      log: state.log.slice(),
      history: [...state.history, action],
    },
    events: [],
  };
}

function emit(d: Draft, e: GameEvent): void {
  d.events.push(e);
  d.s.log.push(e);
}

// ---------- the reducer ----------

/** Validates and applies one action. Never mutates `state`. Throws EngineError if illegal. */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.phase !== "playing") throw new EngineError("The game is over");
  const p = action.player;
  const player = state.players[p];
  if (!player) throw new EngineError(`No player ${p}`);
  if (player.out) throw new EngineError("You are out of this game");

  const d = begin(state, action);
  switch (action.type) {
    case "leave":
      leave(d, p);
      break;
    case "play_card":
      playCard(d, p, action.play);
      break;
    case "open_book":
      openBook(d, p, action.page, action.luck);
      break;
    case "set_target":
      setTarget(d, p, action.targets);
      break;
  }
  if (d.s.phase === "playing" && roundComplete(d.s)) resolveRound(d);
  return { state: d.s, events: d.events };
}

function mySubmission(d: Draft, p: PlayerIndex): Submission {
  const sub = d.s.pending[p];
  if (!sub) throw new EngineError("You are out of this game");
  return sub;
}

function playCard(d: Draft, p: PlayerIndex, play: CardPlay | null): void {
  const sub = mySubmission(d, p);
  if (sub.pages.length > 0) throw new EngineError("Play cards before opening the book");
  if (play === null) {
    sub.card = null;
    return;
  }
  if (!d.s.players[p]!.hand.includes(play.card))
    throw new EngineError(`You have no ${play.card} card`);
  validateCardTargets(d.s, p, play);
  sub.card = play;
}

/** Throws if a card play can't make sense right now (wrong slot, target out, ...). */
function validateCardTargets(s: GameState, p: PlayerIndex, play: CardPlay): void {
  const me = s.players[p]!;
  const opponent = (t: PlayerIndex) => {
    if (t === p || !s.players[t] || s.players[t]!.out)
      throw new EngineError("Pick an opponent who is still in");
    return s.players[t]!;
  };
  switch (play.card) {
    case "shield":
      if (getSlot(me, play.slot).status !== "alive") throw new EngineError("That slot is dead");
      return;
    case "double_shot":
      if (opponentsOf(s, p).length < 2) throw new EngineError("Double shot needs two opponents");
      return;
    case "eraser": {
      const sl = getSlot(opponent(play.target), play.slot);
      if (sl.status !== "alive" || sl.stage === 0) throw new EngineError("Nothing to erase there");
      return;
    }
    case "swap": {
      const [a, b] = play.slots;
      if (a === b) throw new EngineError("Pick two different slots");
      if (getSlot(me, a).status !== "alive" || getSlot(me, b).status !== "alive") {
        throw new EngineError("Both slots must be alive");
      }
      return;
    }
    case "steal": {
      const sl = getSlot(opponent(play.target), play.slot);
      if (sl.status !== "alive" || sl.stage !== ARMED)
        throw new EngineError("That figure has no bullets");
      return;
    }
  }
}

function openBook(d: Draft, p: PlayerIndex, page: number, luck: number): void {
  const s = d.s;
  if (!Number.isInteger(page) || page < 1 || page > s.rules.totalPages) {
    throw new EngineError(`Page ${page} is outside 1..${s.rules.totalPages}`);
  }
  if (!Number.isInteger(luck) || luck < 0)
    throw new EngineError("luck must be a non-negative integer");
  const sub = mySubmission(d, p);
  if (sub.done || sub.needsTarget) throw new EngineError("You already opened the book this round");

  sub.pages.push(page);
  sub.draws.push(s.rules.luckyCards && isLuckyPage(page) ? cardForLuck(luck) : null);

  const n = slotForPage(page);
  if (n === null) return finishGo(d, p);
  const slot = getSlot(s.players[p]!, n);
  if (slot.status === "eliminated") {
    // R6 reroll: leave the go open so the player can open the book again.
    if (s.rules.ownDeadSlot === "reroll") return;
    return finishGo(d, p);
  }
  if (slot.stage < ARMED) return finishGo(d, p);

  const opponents = opponentsOf(s, p);
  const wanted = sub.card?.card === "double_shot" ? Math.min(2, opponents.length) : 1;
  if (opponents.length <= wanted) {
    sub.targets = opponents.slice(0, wanted);
    return finishGo(d, p);
  }
  sub.needsTarget = true;
}

function setTarget(d: Draft, p: PlayerIndex, targets: PlayerIndex[]): void {
  const sub = mySubmission(d, p);
  if (!sub.needsTarget) throw new EngineError("You have nothing to aim right now");
  const opponents = opponentsOf(d.s, p);
  const wanted = sub.card?.card === "double_shot" ? Math.min(2, opponents.length) : 1;
  if (targets.length !== wanted)
    throw new EngineError(`Pick ${wanted} target${wanted > 1 ? "s" : ""}`);
  if (new Set(targets).size !== targets.length) throw new EngineError("Pick different targets");
  if (!targets.every((t) => opponents.includes(t)))
    throw new EngineError("Pick opponents who are still in");
  sub.targets = targets.slice();
  sub.needsTarget = false;
  finishGo(d, p);
}

function finishGo(d: Draft, p: PlayerIndex): void {
  mySubmission(d, p).done = true;
  emit(d, { type: "PlayerReady", player: p });
}

function leave(d: Draft, p: PlayerIndex): void {
  knockOut(d, p, "left", null);
  checkLastStanding(d);
}

function roundComplete(s: GameState): boolean {
  return s.pending.every((sub, i) => s.players[i]!.out || sub?.done === true);
}

// ---------- resolving a round ----------

function resolveRound(d: Draft): void {
  const s = d.s;
  for (const p of roundOrder(s)) {
    if (s.phase !== "playing") return;
    if (s.players[p]!.out) {
      emit(d, { type: "GoLost", player: p });
      continue;
    }
    const sub = s.pending[p]!;
    if (sub.card) resolveCard(d, p, sub.card);
    resolvePages(d, p, sub);
  }
  if (s.phase !== "playing") return;
  if (checkStalemate(d)) return;

  s.round += 1;
  s.pending = s.players.map((pl) => (pl.out ? null : emptySubmission()));
  emit(d, { type: "RoundStarted", round: s.round, order: roundOrder(s) });
}

function resolveCard(d: Draft, p: PlayerIndex, play: CardPlay): void {
  if (play.card === "double_shot") return; // used (or kept) when the shot is fired
  const s = d.s;
  const me = s.players[p]!;
  try {
    validateCardTargets(s, p, play);
  } catch {
    emit(d, { type: "CardFizzled", player: p, card: play.card });
    return;
  }
  me.hand.splice(me.hand.indexOf(play.card), 1);
  emit(d, { type: "CardPlayed", player: p, play });
  switch (play.card) {
    case "shield":
      getSlot(me, play.slot).shielded = true;
      emit(d, { type: "ShieldRaised", player: p, slot: play.slot });
      return;
    case "eraser": {
      const sl = getSlot(s.players[play.target]!, play.slot);
      sl.stage = (sl.stage - 1) as Stage;
      emit(d, {
        type: "PartErased",
        player: p,
        target: play.target,
        slot: play.slot,
        stage: sl.stage,
      });
      return;
    }
    case "swap": {
      const a = getSlot(me, play.slots[0]);
      const b = getSlot(me, play.slots[1]);
      [a.stage, b.stage] = [b.stage, a.stage];
      [a.shielded, b.shielded] = [b.shielded, a.shielded];
      emit(d, { type: "SlotsSwapped", player: p, slots: play.slots });
      return;
    }
    case "steal": {
      getSlot(s.players[play.target]!, play.slot).stage = HAS_GUN;
      const mine = getSlot(me, play.slot);
      const loaded = mine.status === "alive" && mine.stage === HAS_GUN;
      if (loaded) mine.stage = ARMED;
      emit(d, { type: "BulletsStolen", player: p, target: play.target, slot: play.slot, loaded });
      return;
    }
  }
}

function resolvePages(d: Draft, p: PlayerIndex, sub: Submission): void {
  const s = d.s;
  const me = s.players[p]!;
  sub.pages.forEach((page, i) => {
    emit(d, { type: "BookOpened", player: p, page, digit: page % 10 });
    const card = sub.draws[i];
    if (card) {
      if (me.hand.length < HAND_LIMIT) {
        me.hand.push(card);
        emit(d, { type: "CardDrawn", player: p, card });
      } else {
        emit(d, { type: "HandFull", player: p });
      }
    }
    if (i < sub.pages.length - 1)
      emit(d, { type: "RerollGranted", player: p, slot: slotForPage(page)! });
  });

  const page = sub.pages.at(-1);
  if (page === undefined) return; // left without opening (cannot normally happen)
  const n = slotForPage(page);
  if (n === null) return emit(d, { type: "TurnWasted", player: p, reason: "even_digit" });
  const slot = getSlot(me, n);
  if (slot.status === "eliminated") {
    return emit(d, { type: "TurnWasted", player: p, reason: "slot_eliminated" });
  }
  if (slot.stage < ARMED) {
    slot.stage = (slot.stage + 1) as Stage;
    emit(d, {
      type: "PartDrawn",
      player: p,
      slot: n,
      part: PARTS[slot.stage - 1]!,
      stage: slot.stage,
    });
    return;
  }
  fire(d, p, n, sub);
}

function fire(d: Draft, p: PlayerIndex, n: SlotNumber, sub: Submission): void {
  const s = d.s;
  const me = s.players[p]!;
  const doubleQueued = sub.card?.card === "double_shot";
  // Targets chosen while flipping may be gone; if none were chosen (the slot only became
  // armed during resolve, e.g. by a steal), aim automatically.
  let targets = sub.targets.length ? sub.targets : suggestTargets(s, p, n, doubleQueued ? 2 : 1);
  const usesDouble = doubleQueued && targets.length === 2;
  if (usesDouble) {
    me.hand.splice(me.hand.indexOf("double_shot"), 1);
    emit(d, { type: "CardPlayed", player: p, play: { card: "double_shot" } });
  } else if (doubleQueued) {
    targets = targets.slice(0, 1);
  }
  emit(d, { type: "ShotFired", attacker: p, targets, slot: n });

  for (const t of targets) {
    const victim = s.players[t]!;
    const sl = getSlot(victim, n);
    if (victim.out) {
      emit(d, { type: "AttackMissed", attacker: p, target: t, slot: n, reason: "target_out" });
    } else if (sl.status === "eliminated") {
      emit(d, {
        type: "AttackMissed",
        attacker: p,
        target: t,
        slot: n,
        reason: "target_eliminated",
      });
    } else if (sl.shielded) {
      sl.shielded = false;
      emit(d, { type: "ShotBlocked", attacker: p, target: t, slot: n });
    } else if (sl.stage >= HAS_GUN) {
      sl.status = "eliminated";
      emit(d, { type: "SlotEliminated", attacker: p, target: t, slot: n });
      if (lostCount(victim) >= s.rules.lives) knockOut(d, t, "shot", p);
    } else if (s.rules.unarmedTarget === "destroy_partial" && sl.stage > 0) {
      sl.stage = 0;
      emit(d, { type: "FigureDestroyed", attacker: p, target: t, slot: n });
    } else {
      emit(d, { type: "AttackMissed", attacker: p, target: t, slot: n, reason: "target_unarmed" });
    }
  }

  if (s.rules.bullets === "consumed") {
    getSlot(me, n).stage = HAS_GUN;
    emit(d, { type: "BulletsSpent", player: p, slot: n });
  }
  checkLastStanding(d);
}

function knockOut(d: Draft, p: PlayerIndex, reason: "shot" | "left", by: PlayerIndex | null): void {
  const pl = d.s.players[p]!;
  if (pl.out) return;
  pl.out = true;
  for (const sl of pl.slots) sl.shielded = false;
  d.s.pending[p] = null;
  emit(d, { type: "PlayerOut", player: p, reason, by });
}

function end(d: Draft, winner: PlayerIndex | null, reason: EndReason): void {
  d.s.phase = "finished";
  d.s.winner = winner;
  d.s.endReason = reason;
  emit(d, { type: "GameOver", winner, reason });
}

function checkLastStanding(d: Draft): boolean {
  const active = activePlayers(d.s);
  if (active.length > 1) return false;
  end(d, active[0] ?? null, "last_standing");
  return true;
}

/** Ends the game if no slot number is alive for two players still in (nobody can be hit). */
function checkStalemate(d: Draft): boolean {
  const s = d.s;
  const active = activePlayers(s);
  const contested = SLOT_NUMBERS.some(
    (n) => active.filter((i) => getSlot(s.players[i]!, n).status === "alive").length >= 2,
  );
  if (contested) return false;
  if (s.rules.stalemate === "draw") {
    end(d, null, "stalemate");
    return true;
  }
  const best = Math.max(...active.map((i) => aliveCount(s.players[i]!)));
  const leaders = active.filter((i) => aliveCount(s.players[i]!) === best);
  end(d, leaders.length === 1 ? leaders[0]! : null, "stalemate");
  return true;
}

/** Replays a history of actions from a fresh game. */
export function replay(initial: GameState, actions: readonly Action[]): GameState {
  return actions.reduce((s, a) => applyAction(s, a).state, initial);
}

import { resolveRules } from "./rules.js";
import {
  ARMED,
  HAS_GUN,
  PARTS,
  SLOT_NUMBERS,
  type Action,
  type EndReason,
  type GameEvent,
  type GameState,
  type PlayerIndex,
  type PlayerState,
  type RulesConfig,
  type Slot,
  type SlotNumber,
  type Stage,
  type TurnResult,
} from "./types.js";

export class EngineError extends Error {
  override name = "EngineError";
}

export function isSlotNumber(n: number): n is SlotNumber {
  return (SLOT_NUMBERS as readonly number[]).includes(n);
}

/** The slot a page selects, or null when its last digit is even. */
export function slotForPage(page: number): SlotNumber | null {
  const digit = page % 10;
  return isSlotNumber(digit) ? digit : null;
}

export function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

export function getSlot(player: PlayerState, n: SlotNumber): Slot {
  const slot = player.slots[(n - 1) / 2];
  if (!slot || slot.number !== n) throw new EngineError(`Slot ${n} missing`);
  return slot;
}

export function aliveCount(player: PlayerState): number {
  return player.slots.filter((s) => s.status === "alive").length;
}

export interface NewGameOptions {
  id: string;
  players: [{ id: string; name: string }, { id: string; name: string }];
  /** Who moves first. The caller (server) resolves R2 and passes the result. */
  firstTurn: PlayerIndex;
  rules?: Partial<RulesConfig>;
}

export function createGame(opts: NewGameOptions): GameState {
  const mkPlayer = (p: { id: string; name: string }): PlayerState => ({
    id: p.id,
    name: p.name,
    slots: SLOT_NUMBERS.map((number) => ({ number, stage: 0 as Stage, status: "alive" as const })),
  });
  return {
    id: opts.id,
    phase: "playing",
    players: [mkPlayer(opts.players[0]), mkPlayer(opts.players[1])],
    turn: opts.firstTurn,
    turnIndex: 0,
    lastRoll: null,
    pendingChoice: null,
    log: [],
    winner: null,
    endReason: null,
    rules: resolveRules(opts.rules),
  };
}

/**
 * Mutable working copy for one action. The input state is never touched;
 * players are cloned up front so helpers below can mutate freely.
 */
interface Draft {
  s: GameState;
  events: GameEvent[];
}

function begin(state: GameState): Draft {
  return {
    s: {
      ...state,
      players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])],
      log: state.log.slice(),
    },
    events: [],
  };
}

function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, slots: p.slots.map((s) => ({ ...s })) };
}

function emit(d: Draft, e: GameEvent): void {
  d.events.push(e);
  d.s.log.push(e);
}

function finish(d: Draft): TurnResult {
  return { state: d.s, events: d.events };
}

function passTurn(d: Draft): void {
  d.s.turn = other(d.s.turn);
  emit(d, { type: "TurnPassed", to: d.s.turn });
}

/** Ends the game if someone reached the win target, or no elimination is possible any more. */
function checkGameOver(d: Draft): boolean {
  const [a, b] = d.s.players;
  const end = (winner: PlayerIndex | null, reason: EndReason) => {
    d.s.phase = "finished";
    d.s.winner = winner;
    d.s.endReason = reason;
    d.s.pendingChoice = null;
    emit(d, { type: "GameOver", winner, reason });
    return true;
  };
  const aliveA = aliveCount(a);
  const aliveB = aliveCount(b);
  const target = d.s.rules.winTarget;
  const slots = SLOT_NUMBERS.length;
  if (slots - aliveB >= target) return end(0, "fights_won");
  if (slots - aliveA >= target) return end(1, "fights_won");

  // An elimination needs the same number alive on both sides. Without one, the game can't progress.
  const contested = SLOT_NUMBERS.some(
    (n) => getSlot(a, n).status === "alive" && getSlot(b, n).status === "alive",
  );
  if (contested) return false;
  if (d.s.rules.stalemate === "draw" || aliveA === aliveB) return end(null, "stalemate");
  return end(aliveA > aliveB ? 0 : 1, "stalemate");
}

function attack(d: Draft, n: SlotNumber): void {
  const attacker = d.s.turn;
  const own = getSlot(d.s.players[attacker], n);
  const target = getSlot(d.s.players[other(attacker)], n);

  if (target.status === "eliminated") {
    emit(d, { type: "AttackMissed", attacker, slot: n, reason: "target_eliminated" });
  } else if (target.stage >= HAS_GUN) {
    target.status = "eliminated";
    emit(d, { type: "SlotEliminated", attacker, slot: n });
  } else if (d.s.rules.unarmedTarget === "destroy_partial" && target.stage > 0) {
    target.stage = 0;
    emit(d, { type: "FigureDestroyed", attacker, slot: n });
  } else {
    emit(d, { type: "AttackMissed", attacker, slot: n, reason: "target_unarmed" });
  }

  if (d.s.rules.bullets === "consumed") {
    own.stage = HAS_GUN;
    emit(d, { type: "BulletsSpent", player: attacker, slot: n });
  }
  if (!checkGameOver(d)) passTurn(d);
}

function openBook(state: GameState, page: number): TurnResult {
  if (!Number.isInteger(page) || page < 1 || page > state.rules.totalPages) {
    throw new EngineError(`Page ${page} is outside 1..${state.rules.totalPages}`);
  }
  const d = begin(state);
  const player = d.s.turn;
  const digit = page % 10;
  d.s.turnIndex += 1;
  d.s.lastRoll = { page, digit, player };
  emit(d, { type: "BookOpened", player, page, digit });

  const n = slotForPage(page);
  if (n === null) {
    emit(d, { type: "TurnWasted", player, reason: "even_digit" });
    passTurn(d);
    return finish(d);
  }

  const slot = getSlot(d.s.players[player], n);
  if (slot.status === "eliminated") {
    if (d.s.rules.ownDeadSlot === "reroll") {
      emit(d, { type: "RerollGranted", player, slot: n });
    } else {
      emit(d, { type: "TurnWasted", player, reason: "slot_eliminated" });
      passTurn(d);
    }
    return finish(d);
  }

  if (slot.stage < ARMED) {
    slot.stage = (slot.stage + 1) as Stage;
    emit(d, {
      type: "PartDrawn",
      player,
      slot: n,
      part: PARTS[slot.stage - 1]!,
      stage: slot.stage,
    });
    passTurn(d);
    return finish(d);
  }

  if (d.s.rules.armedRoll === "choose") {
    d.s.pendingChoice = n;
    emit(d, { type: "AttackChoiceRequired", player, slot: n });
    return finish(d);
  }
  attack(d, n);
  return finish(d);
}

function choose(state: GameState, doAttack: boolean): TurnResult {
  const n = state.pendingChoice;
  if (n === null) throw new EngineError("No attack choice is pending");
  const d = begin(state);
  d.s.pendingChoice = null;
  if (doAttack) {
    attack(d, n);
  } else {
    emit(d, { type: "AttackSkipped", player: d.s.turn, slot: n });
    passTurn(d);
  }
  return finish(d);
}

/** The single reducer: validates and applies one action. Never mutates `state`. */
export function applyAction(state: GameState, action: Action): TurnResult {
  if (state.phase !== "playing") throw new EngineError("The game is over");
  switch (action.type) {
    case "open_book":
      if (state.pendingChoice !== null) {
        throw new EngineError("An attack choice is pending; send a choose action");
      }
      return openBook(state, action.page);
    case "choose":
      return choose(state, action.attack);
  }
}

/** Resolves a book opening for the current player. `page` comes from the server's RNG. */
export function resolveTurn(state: GameState, page: number): TurnResult {
  return applyAction(state, { type: "open_book", page });
}

/** Under R3 "choose": the current player decides whether to fire the armed slot. */
export function resolveChoice(state: GameState, attack: boolean): TurnResult {
  return applyAction(state, { type: "choose", attack });
}

/**
 * Ends the game because `loser` left or timed out (decided by the server, outside the rules).
 * Logged like any other event so replays stay complete.
 */
export function forfeit(state: GameState, loser: PlayerIndex): TurnResult {
  if (state.phase !== "playing") throw new EngineError("The game is over");
  const d = begin(state);
  const winner = other(loser);
  d.s.phase = "finished";
  d.s.winner = winner;
  d.s.endReason = "forfeit";
  d.s.pendingChoice = null;
  emit(d, { type: "GameOver", winner, reason: "forfeit" });
  return finish(d);
}

/** The actions that produced a log, in order. Used to replay a game. */
export function actionsFromLog(log: readonly GameEvent[]): Action[] {
  const actions: Action[] = [];
  log.forEach((e, i) => {
    if (e.type === "BookOpened") {
      actions.push({ type: "open_book", page: e.page });
    } else if (e.type === "AttackChoiceRequired" && i + 1 < log.length) {
      // The event after the prompt tells us how the player answered.
      actions.push({ type: "choose", attack: log[i + 1]?.type !== "AttackSkipped" });
    }
  });
  return actions;
}

export function replay(initial: GameState, actions: readonly Action[]): GameState {
  return actions.reduce((s, a) => applyAction(s, a).state, initial);
}

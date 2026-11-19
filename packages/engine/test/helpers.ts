import {
  applyAction,
  createGame,
  getSlot,
  isLuckyPage,
  type Action,
  type ActionResult,
  type CardPlay,
  type GameState,
  type PlayerIndex,
  type RulesConfig,
  type SlotNumber,
  type Stage,
} from "../src/index.js";

export function newGame(
  players = 2,
  rules: Partial<RulesConfig> = {},
  firstSeat: PlayerIndex = 0,
): GameState {
  return createGame({
    id: "g1",
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    firstSeat,
    rules: { roundTimerSeconds: null, ...rules },
  });
}

type SlotSpec = Partial<Record<SlotNumber, Stage | "dead" | "shield">>;

/** A copy of `state` with slots set per player, for arranging positions. "shield" = armed + shielded. */
export function arrange(state: GameState, ...specs: SlotSpec[]): GameState {
  const s = structuredClone(state);
  specs.forEach((spec, i) => {
    for (const [k, v] of Object.entries(spec)) {
      const slot = getSlot(s.players[i]!, Number(k) as SlotNumber);
      if (v === "dead") slot.status = "eliminated";
      else if (v === "shield") {
        slot.stage = 5;
        slot.shielded = true;
      } else slot.stage = v as Stage;
    }
  });
  return s;
}

export function giveCards(
  state: GameState,
  p: PlayerIndex,
  ...cards: GameState["players"][0]["hand"]
): GameState {
  const s = structuredClone(state);
  s.players[p]!.hand.push(...cards);
  return s;
}

/** A page whose last digit selects slot `n` (never a lucky page). */
export function pageFor(n: SlotNumber, tens = 1): number {
  let page = tens * 10 + n;
  while (isLuckyPage(page)) page += 10;
  return page;
}
export const EVEN_PAGE = 42;
export const LUCKY_ODD = 111;
export const LUCKY_EVEN = 200;

export const open = (player: PlayerIndex, page: number, luck = 0): Action => ({
  type: "open_book",
  player,
  page,
  luck,
});
export const aim = (player: PlayerIndex, ...targets: PlayerIndex[]): Action => ({
  type: "set_target",
  player,
  targets,
});
export const card = (player: PlayerIndex, play: CardPlay | null): Action => ({
  type: "play_card",
  player,
  play,
});

/** Applies actions in order; returns the final result with all events concatenated. */
export function run(state: GameState, ...actions: Action[]): ActionResult {
  let s = state;
  const events: ActionResult["events"] = [];
  for (const a of actions) {
    const r = applyAction(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export const slotOf = (s: GameState, p: PlayerIndex, n: SlotNumber) => getSlot(s.players[p]!, n);

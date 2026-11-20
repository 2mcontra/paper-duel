import {
  applyAction,
  createGame,
  type Action,
  type ActionResult,
  type CardPlay,
  type Figure,
  type GameState,
  type Move,
  type PlayerIndex,
  type RulesConfig,
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
    rules: { turnTimerSeconds: null, ...rules },
  });
}

/** A copy of `state` with some figures changed: figs[player][figure] = partial figure. */
export function arrange(
  state: GameState,
  figs: Record<number, Record<number, Partial<Figure>>>,
): GameState {
  const s = structuredClone(state);
  for (const [p, byFig] of Object.entries(figs)) {
    for (const [f, patch] of Object.entries(byFig)) {
      Object.assign(s.players[Number(p)]!.figures[Number(f)]!, patch);
    }
  }
  return s;
}

export function giveCards(
  state: GameState,
  p: PlayerIndex,
  ...cards: GameState["players"][0]["hand"]
) {
  const s = structuredClone(state);
  s.players[p]!.hand.push(...cards);
  return s;
}

/** A page with this roll that is never lucky (10 means a page ending in 0). */
export function pageFor(roll: number): number {
  return roll === 10 ? 30 : roll === 4 ? 34 : 40 + roll;
}

export const open = (player: PlayerIndex, page: number, luck = 0): Action => ({
  type: "open_book",
  player,
  page,
  luck,
});
export const act = (player: PlayerIndex, move: Move): Action => ({ type: "act", player, move });
export const card = (player: PlayerIndex, play: CardPlay, page?: number): Action =>
  page === undefined
    ? { type: "play_card", player, play }
    : { type: "play_card", player, play, page, luck: 0 };

/** Applies actions in order, returning the final state and all events. */
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

/** Opens the book with `roll` and makes `move`, for the player whose turn it is. */
export function turn(state: GameState, roll: number, move: Move): ActionResult {
  const p = state.turn.player;
  return run(state, open(p, pageFor(roll)), act(p, move));
}

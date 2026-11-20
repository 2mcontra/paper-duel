import { describe, expect, it } from "vitest";
import {
  applyAction,
  botTurn,
  createGame,
  createRng,
  randomPage,
  redactEvent,
  viewFor,
  type GameState,
  type GameView,
} from "@paper-duel/engine";
import { applyEvent, needsReveal } from "./playback.js";

/** What the board shows: everything the playback is responsible for. */
const board = (v: GameView) => ({
  round: v.round,
  turnNumber: v.turnNumber,
  turn: v.turn,
  phase: v.phase,
  winner: v.winner,
  players: v.players.map((p) => ({
    figures: p.figures,
    out: p.out,
    place: p.place,
    handSize: p.handSize,
    hand: p.hand,
  })),
});

describe("turn playback", () => {
  it("replaying each update's events lands exactly on the server's state", () => {
    for (const players of [2, 3, 6]) {
      const random = createRng(40 + players);
      let state: GameState = createGame({
        id: "g",
        players: Array.from({ length: players }, (_, i) => ({ id: `${i}`, name: `P${i}` })),
        firstSeat: 0,
      });
      let checked = 0;
      while (state.phase === "playing") {
        const actions = botTurn(state, state.turn.player, random, () =>
          randomPage(state.rules.totalPages, random),
        );
        for (const a of actions) {
          const before = state;
          const r = applyAction(state, a);
          state = r.state;
          // Check from every seat's point of view (hidden cards differ).
          for (let viewer = 0; viewer < players; viewer++) {
            let shown = viewFor(before, viewer);
            for (const e of r.events) shown = applyEvent(shown, redactEvent(e, viewer));
            expect(board(shown)).toEqual(board(viewFor(state, viewer)));
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(20);
    }
  });

  it("only plays back updates with something to show", () => {
    expect(needsReveal([{ type: "TurnStarted", player: 1, round: 1, turn: 2 }])).toBe(false);
    expect(needsReveal([{ type: "BookOpened", player: 0, page: 41, roll: 1 }])).toBe(true);
  });
});

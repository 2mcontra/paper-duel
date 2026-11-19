import { describe, expect, it } from "vitest";
import {
  applyAction,
  botCard,
  createGame,
  createRng,
  randomPage,
  redactEvent,
  suggestTargets,
  viewFor,
  type GameState,
  type GameView,
  type SlotNumber,
} from "@paper-duel/engine";
import { applyEvent, needsReveal } from "./playback.js";

/** What the board shows: everything the reveal is responsible for. */
const board = (v: GameView) => ({
  round: v.round,
  players: v.players.map((p) => ({
    slots: p.slots,
    out: p.out,
    handSize: p.handSize,
    hand: p.hand,
  })),
});

describe("round reveal", () => {
  it("replaying each update's events lands exactly on the server's state", () => {
    for (const players of [2, 3, 6]) {
      const random = createRng(40 + players);
      let state: GameState = createGame({
        id: "g",
        players: Array.from({ length: players }, (_, i) => ({ id: `${i}`, name: `P${i}` })),
        firstSeat: 0,
      });
      let checked = 0;
      while (state.phase === "playing" && state.round < 400) {
        // One player's next step, as a bot would play it.
        const p = state.pending.findIndex((sub) => sub && !sub.done);
        const sub = state.pending[p]!;
        const action = sub.needsTarget
          ? {
              type: "set_target" as const,
              player: p,
              targets: suggestTargets(
                state,
                p,
                (sub.pages.at(-1)! % 10) as SlotNumber,
                sub.card?.card === "double_shot" ? 2 : 1,
              ),
            }
          : sub.pages.length === 0 && !sub.card && random() < 0.5 && botCard(state, p, random)
            ? { type: "play_card" as const, player: p, play: botCard(state, p, random) }
            : {
                type: "open_book" as const,
                player: p,
                page: randomPage(300, random),
                luck: Math.floor(random() * 1e6),
              };
        const before = state;
        const r = applyAction(state, action);
        state = r.state;
        // Check from every seat's point of view (hands are redacted differently).
        for (let viewer = 0; viewer < players; viewer++) {
          const events = r.events.map((e) => redactEvent(e, viewer));
          if (!needsReveal(events)) continue;
          const replayed = events.reduce(applyEvent, viewFor(before, viewer));
          expect(board(replayed)).toEqual(board(viewFor(state, viewer)));
          checked++;
        }
      }
      expect(state.phase).toBe("finished");
      expect(checked).toBeGreaterThan(50);
    }
  });

  it("does not reveal choices made while flipping", () => {
    expect(needsReveal([{ type: "PlayerReady", player: 1 }])).toBe(false);
    expect(
      needsReveal([
        { type: "PlayerReady", player: 1 },
        { type: "BookOpened", player: 0, page: 3, digit: 3 },
      ]),
    ).toBe(true);
  });
});

import { applyAction, createGame, getSlot, opponentsOf, suggestTargets } from "./engine.js";
import { randomPage } from "./rng.js";
import {
  ARMED,
  HAS_GUN,
  SLOT_NUMBERS,
  type CardPlay,
  type GameState,
  type PlayerIndex,
  type RulesConfig,
  type SlotNumber,
} from "./types.js";

export interface SimOptions {
  random: () => number;
  players?: number;
  rules?: Partial<RulesConfig>;
  firstSeat?: PlayerIndex;
  /** Rounds before the game is declared non-terminating. */
  maxRounds?: number;
  /** Chance a bot plays a card it can play this round. Default 0.6. */
  cardChance?: number;
}

export interface SimResult {
  state: GameState;
  rounds: number;
  terminated: boolean;
}

const pick = <T>(xs: readonly T[], random: () => number): T | undefined =>
  xs[Math.floor(random() * xs.length)];

/** A simple bot's card choice: something sensible it is allowed to play, or null. */
export function botCard(state: GameState, p: PlayerIndex, random: () => number): CardPlay | null {
  const me = state.players[p]!;
  const opps = opponentsOf(state, p);
  const options: CardPlay[] = [];
  for (const card of new Set(me.hand)) {
    if (card === "shield") {
      const best = SLOT_NUMBERS.filter((n) => {
        const s = getSlot(me, n);
        return s.status === "alive" && s.stage >= HAS_GUN && !s.shielded;
      });
      const n = pick(best, random);
      if (n) options.push({ card, slot: n });
    } else if (card === "double_shot") {
      if (opps.length >= 2 && SLOT_NUMBERS.some((n) => getSlot(me, n).stage === ARMED)) {
        options.push({ card });
      }
    } else if (card === "eraser" || card === "steal") {
      const spots: { target: PlayerIndex; slot: SlotNumber }[] = [];
      for (const t of opps) {
        for (const n of SLOT_NUMBERS) {
          const s = getSlot(state.players[t]!, n);
          if (s.status === "alive" && s.stage === ARMED) spots.push({ target: t, slot: n });
        }
      }
      const spot = pick(spots, random);
      if (spot) options.push({ card, ...spot });
    } else if (card === "swap") {
      const alive = SLOT_NUMBERS.filter((n) => getSlot(me, n).status === "alive");
      const armed = alive.filter((n) => getSlot(me, n).stage >= HAS_GUN);
      const weak = alive.filter((n) => getSlot(me, n).stage < HAS_GUN);
      const a = pick(armed, random);
      const b = pick(weak, random);
      if (a && b && random() < 0.3) options.push({ card, slots: [a, b] });
    }
  }
  return pick(options, random) ?? null;
}

/** Plays one game between random bots. */
export function simulateGame(opts: SimOptions): SimResult {
  const { random, maxRounds = 5000, cardChance = 0.6 } = opts;
  const count = opts.players ?? 2;
  let state = createGame({
    id: "sim",
    players: Array.from({ length: count }, (_, i) => ({ id: `b${i}`, name: `Bot ${i}` })),
    firstSeat: opts.firstSeat ?? Math.floor(random() * count),
    ...(opts.rules ? { rules: opts.rules } : {}),
  });
  const act = (a: Parameters<typeof applyAction>[1]) => {
    state = applyAction(state, a).state;
  };

  while (state.phase === "playing" && state.round <= maxRounds) {
    const round = state.round;
    for (let p = 0; p < count && state.phase === "playing" && state.round === round; p++) {
      if (state.players[p]!.out) continue;
      if (random() < cardChance) {
        const play = botCard(state, p, random);
        if (play) act({ type: "play_card", player: p, play });
      }
      while (state.round === round && state.phase === "playing" && !state.pending[p]?.done) {
        const sub = state.pending[p]!;
        if (sub.needsTarget) {
          const n = (sub.pages.at(-1)! % 10) as SlotNumber;
          const want = sub.card?.card === "double_shot" ? 2 : 1;
          // Bots mostly take the best shot, sometimes a random opponent (grudges!).
          const targets =
            random() < 0.8
              ? suggestTargets(state, p, n, want)
              : opponentsOf(state, p)
                  .sort(() => random() - 0.5)
                  .slice(0, want);
          act({ type: "set_target", player: p, targets });
        } else {
          const page = randomPage(state.rules.totalPages, random);
          act({ type: "open_book", player: p, page, luck: Math.floor(random() * 1e6) });
        }
      }
    }
  }
  return { state, rounds: state.round, terminated: state.phase === "finished" };
}

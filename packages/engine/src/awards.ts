import { figuresLeft } from "./engine.js";
import type { PlayerIndex, PlayerStats } from "./types.js";

export type AwardId =
  | "sharpshooter"
  | "stomper"
  | "artist"
  | "card_shark"
  | "survivor"
  | "lucky"
  | "unlucky"
  | "explorer";

export interface Award {
  id: AwardId;
  player: PlayerIndex;
  /** The number behind it (kills, stomps, average roll...). */
  value: number;
}

interface StatsLike {
  stats: PlayerStats;
  figures: readonly { dead: boolean }[];
}

/**
 * Fun end-of-game titles from the players' stats. Each award goes to the single best player;
 * a tie or a zero means nobody gets it.
 */
export function computeAwards(players: readonly StatsLike[]): Award[] {
  const awards: Award[] = [];
  const best = (id: AwardId, value: (p: StatsLike) => number, lowest = false, min = 1) => {
    const vals = players.map(value);
    const valid = vals.filter((v) => Number.isFinite(v));
    if (!valid.length) return;
    const top = lowest ? Math.min(...valid) : Math.max(...valid);
    if (!lowest && top < min) return;
    const who = vals.flatMap((v, i) => (v === top ? [i] : []));
    if (who.length === 1) awards.push({ id, player: who[0]!, value: top });
  };
  const avg = (p: StatsLike) =>
    p.stats.rolls >= 3 ? Math.round((p.stats.rollTotal / p.stats.rolls) * 10) / 10 : NaN;
  best("sharpshooter", (p) => p.stats.kills);
  best("stomper", (p) => p.stats.stomps);
  best("survivor", (p) => figuresLeft(p));
  best("artist", (p) => p.stats.parts, false, 5);
  best("card_shark", (p) => p.stats.cardsPlayed, false, 2);
  best("explorer", (p) => p.stats.squares, false, 20);
  best("lucky", avg);
  best("unlucky", avg, true);
  return awards;
}

/** Series points for a finishing place: 3, 2, 1 for the top three; last place never scores. */
export function seriesPoints(place: number, players: number): number {
  if (place >= players) return 0;
  return [3, 2, 1][place - 1] ?? 0;
}

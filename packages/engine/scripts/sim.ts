/**
 * Plays random bot games and prints balance stats.
 *
 *   pnpm sim                          2,000 games each for 2..6 players
 *   pnpm sim --players 4 --games 500 --seed 42
 *   pnpm sim --rule lives=2 --rule luckyCards=false
 *   pnpm sim --players 3 --games 1 --verbose     print one game's event log
 */
import { parseArgs } from "node:util";
import {
  createRng,
  resolveRules,
  simulateGame,
  type GameEvent,
  type RulesConfig,
} from "../src/index.js";

const { values } = parseArgs({
  options: {
    games: { type: "string", default: "2000" },
    players: { type: "string", multiple: true, default: [] },
    seed: { type: "string", default: String(Date.now() % 2 ** 32) },
    rule: { type: "string", multiple: true, default: [] },
    "max-rounds": { type: "string", default: "5000" },
    "secs-per-round": { type: "string", default: "6" },
    verbose: { type: "boolean", default: false },
  },
});

const games = Number(values.games);
const seed = Number(values.seed);
const maxRounds = Number(values["max-rounds"]);
const secsPerRound = Number(values["secs-per-round"]);
const playerCounts = values.players.length ? values.players.map(Number) : [2, 3, 4, 5, 6];
const overrides: Record<string, unknown> = {};
for (const r of values.rule) {
  const [k, v] = r.split("=");
  if (!k || v === undefined) throw new Error(`Bad --rule ${r}, expected key=value`);
  overrides[k] =
    v === "null"
      ? null
      : v === "true"
        ? true
        : v === "false"
          ? false
          : /^\d+$/.test(v)
            ? Number(v)
            : v;
}
const rules = resolveRules(overrides as Partial<RulesConfig>);

const line = (e: GameEvent): string | null => {
  const P = (i: number) => `P${i}`;
  switch (e.type) {
    case "RoundStarted":
      return `-- round ${e.round} (order ${e.order.map(P).join(" ")})`;
    case "PlayerReady":
      return null;
    case "CardPlayed":
      return `${P(e.player)} plays ${e.play.card}`;
    case "CardFizzled":
      return `${P(e.player)}'s ${e.card} fizzles`;
    case "ShieldRaised":
      return `  shield on slot ${e.slot}`;
    case "PartErased":
      return `  erases ${P(e.target)} slot ${e.slot} -> stage ${e.stage}`;
    case "SlotsSwapped":
      return `  swaps slots ${e.slots.join(" & ")}`;
    case "BulletsStolen":
      return `  steals ${P(e.target)} slot ${e.slot} bullets${e.loaded ? " and loads" : ""}`;
    case "BookOpened":
      return `${P(e.player)} page ${e.page}`;
    case "CardDrawn":
      return `  lucky page! draws ${e.card}`;
    case "HandFull":
      return `  lucky page, but hand is full`;
    case "TurnWasted":
      return `  wasted (${e.reason})`;
    case "RerollGranted":
      return `  dead slot ${e.slot}, rolls again`;
    case "PartDrawn":
      return `  draws ${e.part} on ${e.slot}`;
    case "ShotFired":
      return `  fires slot ${e.slot} at ${e.targets.map(P).join(" & ")}`;
    case "SlotEliminated":
      return `  BANG: ${P(e.target)} slot ${e.slot} eliminated`;
    case "ShotBlocked":
      return `  ${P(e.target)}'s shield blocks it`;
    case "FigureDestroyed":
      return `  ${P(e.target)} slot ${e.slot} wiped`;
    case "AttackMissed":
      return `  miss (${e.reason})`;
    case "BulletsSpent":
      return null;
    case "GoLost":
      return `${P(e.player)} is out before their go`;
    case "PlayerOut":
      return `** ${P(e.player)} is OUT (${e.reason}${e.by !== null ? ` by ${P(e.by)}` : ""})`;
    case "GameOver":
      return `GAME OVER: ${e.winner === null ? "draw" : `${P(e.winner)} wins`} (${e.reason})`;
  }
};

const random = createRng(seed);
console.log(`Rules ${JSON.stringify(rules)}\nSeed ${seed}\n`);
console.log(
  "players  games  ended  rounds(mean/med/p95/max)  ~minutes  stalemate  draws  first-seat-wins  cards/game  hits/game",
);
let failed = 0;
for (const players of playerCounts) {
  const lengths: number[] = [];
  let nonTerminated = 0,
    stalemates = 0,
    draws = 0,
    firstWins = 0,
    cards = 0,
    hits = 0;
  for (let i = 0; i < games; i++) {
    const { state, terminated } = simulateGame({ random, players, rules, maxRounds });
    if (values.verbose)
      for (const e of state.log) {
        const l = line(e);
        if (l) console.log(l);
      }
    if (!terminated) {
      nonTerminated++;
      continue;
    }
    lengths.push(state.round);
    if (state.endReason === "stalemate") stalemates++;
    if (state.winner === null) draws++;
    if (state.winner === state.firstSeat) firstWins++;
    cards += state.log.filter((e) => e.type === "CardDrawn").length;
    hits += state.log.filter((e) => e.type === "SlotEliminated").length;
  }
  failed += nonTerminated;
  lengths.sort((a, b) => a - b);
  const pct = (q: number) =>
    lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))] ?? 0;
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const pc = (n: number) => `${((100 * n) / games).toFixed(1)}%`;
  console.log(
    [
      String(players).padStart(7),
      String(games).padStart(6),
      String(lengths.length).padStart(6),
      `${mean.toFixed(0)}/${pct(0.5)}/${pct(0.95)}/${pct(1)}`.padStart(25),
      ((mean * secsPerRound) / 60).toFixed(1).padStart(9),
      pc(stalemates).padStart(10),
      pc(draws).padStart(6),
      `${pc(firstWins)} (fair ${(100 / players).toFixed(0)}%)`.padStart(16),
      (cards / Math.max(1, lengths.length)).toFixed(1).padStart(11),
      (hits / Math.max(1, lengths.length)).toFixed(1).padStart(10),
    ].join(" "),
  );
}
if (failed) console.log(`\n${failed} games hit ${maxRounds} rounds without finishing!`);
process.exitCode = failed > 0 ? 1 : 0;

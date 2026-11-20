/**
 * Plays bot games and prints balance stats.
 *
 *   pnpm sim                          1,000 games each for 2..6 players
 *   pnpm sim --players 4 --games 500 --seed 42
 *   pnpm sim --rule figures=2 --rule maxRounds=null
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
    games: { type: "string", default: "1000" },
    players: { type: "string", multiple: true, default: [] },
    seed: { type: "string", default: String(Date.now() % 2 ** 32) },
    rule: { type: "string", multiple: true, default: [] },
    "secs-per-turn": { type: "string", default: "7" },
    verbose: { type: "boolean", default: false },
  },
});

const games = Number(values.games);
const seed = Number(values.seed);
const secsPerTurn = Number(values["secs-per-turn"]);
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
  const F = (p: number, f: number) => `${P(p)}.${"ABCDE"[f]}`;
  switch (e.type) {
    case "TurnStarted":
      return `-- r${e.round} t${e.turn} ${P(e.player)}`;
    case "BookOpened":
      return `  page ${e.page} (roll ${e.roll})`;
    case "CardDrawn":
      return `  lucky! draws ${e.card}`;
    case "HandFull":
      return `  lucky, hand full`;
    case "CardPlayed":
      return `  plays ${JSON.stringify(e.play)}`;
    case "PartDrawn":
      return `  draws ${e.part} on ${F(e.player, e.figure)}`;
    case "FigureMoved":
      return `  ${F(e.player, e.figure)} ${e.from ?? "home"} -> ${e.to}`;
    case "Stomped":
      return `  STOMPS ${F(e.target, e.targetFigure)}`;
    case "ShotFired":
      return `  ${F(e.player, e.figure)} fires at ${e.targets.map((t) => F(t.player, t.figure)).join(", ")}`;
    case "FigureKilled":
      return `  KILLS ${F(e.target, e.targetFigure)}`;
    case "ShieldBroken":
      return `  shield breaks on ${F(e.target, e.targetFigure)}`;
    case "PlayerOut":
      return `** ${P(e.player)} out (${e.reason}), place ${e.place}`;
    case "GameOver":
      return `== game over: ${e.winner === null ? "draw" : P(e.winner)} (${e.reason}) places ${e.places.join(",")}`;
    default:
      return `  ${e.type}`;
  }
};

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
const q = (xs: number[], f: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))]!;

console.log(`seed ${seed}, ${games} games per size, rules ${JSON.stringify(overrides)}`);
for (const players of playerCounts) {
  const random = createRng(seed + players);
  const turns: number[] = [];
  const rounds: number[] = [];
  let timeUp = 0;
  let draws = 0;
  let unfinished = 0;
  let kills = 0;
  let stomps = 0;
  const wins = new Array<number>(players).fill(0);
  for (let g = 0; g < games; g++) {
    const r = simulateGame({ random, players, rules, firstSeat: 0 });
    if (values.verbose)
      for (const e of r.state.log) {
        const l = line(e);
        if (l) console.log(l);
      }
    if (!r.terminated) unfinished++;
    turns.push(r.turns);
    rounds.push(r.state.round);
    if (r.state.endReason === "time_up") timeUp++;
    if (r.state.winner === null) draws++;
    else wins[r.state.winner]!++;
    for (const p of r.state.players) {
      kills += p.stats.kills;
      stomps += p.stats.stomps;
    }
  }
  const mins = turns.map((t) => (t * secsPerTurn) / 60);
  console.log(
    `${players}p: rounds median ${q(rounds, 0.5)} p90 ${q(rounds, 0.9)} | turns median ${q(turns, 0.5)} ` +
      `(~${q(mins, 0.5).toFixed(1)} min, p90 ${q(mins, 0.9).toFixed(1)}) | time-up ${pct(timeUp, games)} ` +
      `draws ${pct(draws, games)} unfinished ${unfinished} | kills/game ${(kills / games).toFixed(1)} ` +
      `stomps/game ${(stomps / games).toFixed(1)} | wins by seat ${wins.map((w) => pct(w, games)).join(" ")}`,
  );
}

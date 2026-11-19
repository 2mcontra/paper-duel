/**
 * Plays random bot games and prints balance stats.
 *
 *   pnpm sim                         10,000 games with default rules
 *   pnpm sim --games 500 --seed 42
 *   pnpm sim --rule bullets=reusable --rule armedRoll=choose
 *   pnpm sim --verbose --games 1     print one game's event log
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
    games: { type: "string", default: "10000" },
    seed: { type: "string", default: String(Date.now() % 2 ** 32) },
    rule: { type: "string", multiple: true, default: [] },
    "max-rolls": { type: "string", default: "100000" },
    verbose: { type: "boolean", default: false },
  },
});

const games = Number(values.games);
const seed = Number(values.seed);
const maxRolls = Number(values["max-rolls"]);
const overrides: Record<string, unknown> = {};
for (const r of values.rule) {
  const [k, v] = r.split("=");
  if (!k || v === undefined) throw new Error(`Bad --rule ${r}, expected key=value`);
  overrides[k] = v === "null" ? null : /^\d+$/.test(v) ? Number(v) : v;
}
const rules = resolveRules(overrides as Partial<RulesConfig>);

const describe = (e: GameEvent): string => {
  switch (e.type) {
    case "BookOpened":
      return `P${e.player} opens page ${e.page} (digit ${e.digit})`;
    case "TurnWasted":
      return `  wasted: ${e.reason}`;
    case "RerollGranted":
      return `  slot ${e.slot} is dead, roll again`;
    case "PartDrawn":
      return `  draws ${e.part} on slot ${e.slot}`;
    case "AttackChoiceRequired":
      return `  slot ${e.slot} armed, choosing...`;
    case "AttackSkipped":
      return `  holds fire on slot ${e.slot}`;
    case "SlotEliminated":
      return `  BANG: eliminates P${1 - e.attacker} slot ${e.slot}`;
    case "FigureDestroyed":
      return `  shoots P${1 - e.attacker}'s partial figure on slot ${e.slot}`;
    case "AttackMissed":
      return `  misses slot ${e.slot} (${e.reason})`;
    case "BulletsSpent":
      return `  slot ${e.slot} is out of bullets`;
    case "TurnPassed":
      return "";
    case "GameOver":
      return `GAME OVER: ${e.winner === null ? "draw" : `P${e.winner} wins`} (${e.reason})`;
  }
};

const random = createRng(seed);
const lengths: number[] = [];
let nonTerminated = 0;
const wins = { first: 0, second: 0, draw: 0 };
const reasons = { fights_won: 0, stalemate: 0, forfeit: 0 };
const start = performance.now();

for (let i = 0; i < games; i++) {
  const { state, rolls, terminated } = simulateGame({ random, rules, maxRolls, attackChance: 0.8 });
  if (values.verbose) {
    for (const e of state.log) {
      const line = describe(e);
      if (line) console.log(line);
    }
  }
  if (!terminated) {
    nonTerminated++;
    continue;
  }
  lengths.push(rolls);
  reasons[state.endReason!]++;
  const firstMover = state.log.find((e) => e.type === "BookOpened")?.player;
  if (state.winner === null) wins.draw++;
  else if (state.winner === firstMover) wins.first++;
  else wins.second++;
}

lengths.sort((a, b) => a - b);
const pct = (q: number) =>
  lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))] ?? 0;
const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
const share = (n: number) => `${n} (${((100 * n) / games).toFixed(1)}%)`;

console.log(`
Rules         ${JSON.stringify(rules)}
Seed          ${seed}
Games         ${games} in ${((performance.now() - start) / 1000).toFixed(2)} s
Terminated    ${lengths.length}/${games}${nonTerminated ? `  (${nonTerminated} hit ${maxRolls} rolls!)` : ""}
Book opens    mean ${mean.toFixed(1)}, median ${pct(0.5)}, p95 ${pct(0.95)}, max ${pct(1)}
              (one player's turns is about half of this)
First mover   ${share(wins.first)} wins
Second mover  ${share(wins.second)} wins
Draws         ${share(wins.draw)}
End reason    win target ${share(reasons.fights_won)}, stalemate ${share(reasons.stalemate)}`);

process.exitCode = nonTerminated > 0 ? 1 : 0;

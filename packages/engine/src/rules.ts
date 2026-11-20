import type { RulesConfig } from "./types.js";

export const DEFAULT_RULES: Readonly<RulesConfig> = Object.freeze({
  firstPlayer: "random",
  bullets: "consumed",
  totalPages: 300,
  turnTimerSeconds: 20,
  figures: 3,
  luckyCards: true,
  maxRounds: 40,
});

export class RulesError extends Error {
  override name = "RulesError";
}

const ENUMS: { [K in keyof RulesConfig]?: readonly RulesConfig[K][] } = {
  firstPlayer: ["random", "host"],
  bullets: ["consumed", "reusable"],
  luckyCards: [true, false],
};

/** Partial rules; undefined values are ignored (so parsed JSON can be passed straight in). */
export type RulesOverrides = { [K in keyof RulesConfig]?: RulesConfig[K] | undefined };

const intIn = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Merges overrides onto the defaults and validates the result. Throws RulesError. */
export function resolveRules(overrides: RulesOverrides = {}): RulesConfig {
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  const unknown = Object.keys(defined).filter((k) => !(k in DEFAULT_RULES));
  if (unknown.length) throw new RulesError(`Unknown rule: ${unknown.join(", ")}`);
  const rules: RulesConfig = { ...DEFAULT_RULES, ...defined };
  for (const [key, allowed] of Object.entries(ENUMS) as [keyof RulesConfig, unknown[]][]) {
    if (!allowed.includes(rules[key])) {
      throw new RulesError(`Invalid ${key}: ${String(rules[key])}`);
    }
  }
  const { totalPages, turnTimerSeconds, figures, maxRounds } = rules;
  if (!intIn(totalPages, 10, 10_000) || totalPages % 10 !== 0) {
    throw new RulesError(`totalPages must be a multiple of 10 from 10 to 10000, got ${totalPages}`);
  }
  if (!intIn(figures, 1, 5)) throw new RulesError(`figures must be 1..5, got ${figures}`);
  if (turnTimerSeconds !== null && !intIn(turnTimerSeconds, 5, 600)) {
    throw new RulesError(`turnTimerSeconds must be null or 5..600, got ${turnTimerSeconds}`);
  }
  if (maxRounds !== null && !intIn(maxRounds, 1, 1000)) {
    throw new RulesError(`maxRounds must be null or 1..1000, got ${maxRounds}`);
  }
  return rules;
}

import type { RulesConfig } from "./types.js";

export const DEFAULT_RULES: Readonly<RulesConfig> = Object.freeze({
  firstPlayer: "random",
  unarmedTarget: "miss",
  bullets: "consumed",
  ownDeadSlot: "waste",
  totalPages: 300,
  roundTimerSeconds: 20,
  lives: 3,
  luckyCards: true,
  stalemate: "most_alive",
});

export class RulesError extends Error {
  override name = "RulesError";
}

const ENUMS: { [K in keyof RulesConfig]?: readonly RulesConfig[K][] } = {
  firstPlayer: ["random", "host"],
  unarmedTarget: ["miss", "destroy_partial"],
  bullets: ["consumed", "reusable"],
  ownDeadSlot: ["waste", "reroll"],
  luckyCards: [true, false],
  stalemate: ["most_alive", "draw"],
};

/** Partial rules; undefined values are ignored (so parsed JSON can be passed straight in). */
export type RulesOverrides = { [K in keyof RulesConfig]?: RulesConfig[K] | undefined };

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
  const { totalPages, roundTimerSeconds, lives } = rules;
  if (!Number.isInteger(totalPages) || totalPages < 10 || totalPages % 10 !== 0) {
    throw new RulesError(`totalPages must be a positive multiple of 10, got ${totalPages}`);
  }
  if (!Number.isInteger(lives) || lives < 1 || lives > 5) {
    throw new RulesError(`lives must be 1..5, got ${lives}`);
  }
  if (
    roundTimerSeconds !== null &&
    (!Number.isInteger(roundTimerSeconds) || roundTimerSeconds < 5 || roundTimerSeconds > 600)
  ) {
    throw new RulesError(`roundTimerSeconds must be null or 5..600, got ${roundTimerSeconds}`);
  }
  return rules;
}

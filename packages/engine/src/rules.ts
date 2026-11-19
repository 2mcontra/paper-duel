import type { RulesConfig } from "./types.js";

export const DEFAULT_RULES: Readonly<RulesConfig> = Object.freeze({
  firstPlayer: "random",
  armedRoll: "auto_attack",
  unarmedTarget: "miss",
  bullets: "consumed",
  ownDeadSlot: "waste",
  totalPages: 300,
  turnTimerSeconds: 30,
  winTarget: 3,
  stalemate: "most_alive",
});

export class RulesError extends Error {
  override name = "RulesError";
}

const ENUMS: { [K in keyof RulesConfig]?: readonly RulesConfig[K][] } = {
  firstPlayer: ["random", "host"],
  armedRoll: ["auto_attack", "choose"],
  unarmedTarget: ["miss", "destroy_partial"],
  bullets: ["consumed", "reusable"],
  ownDeadSlot: ["waste", "reroll"],
  stalemate: ["most_alive", "draw"],
};

/** Merges overrides onto the defaults and validates the result. Throws RulesError. */
export function resolveRules(overrides: Partial<RulesConfig> = {}): RulesConfig {
  const rules: RulesConfig = { ...DEFAULT_RULES, ...overrides };
  for (const [key, allowed] of Object.entries(ENUMS) as [keyof RulesConfig, unknown[]][]) {
    if (!allowed.includes(rules[key])) {
      throw new RulesError(`Invalid ${key}: ${String(rules[key])}`);
    }
  }
  const { totalPages, turnTimerSeconds, winTarget } = rules;
  if (!Number.isInteger(winTarget) || winTarget < 1 || winTarget > 5) {
    throw new RulesError(`winTarget must be 1..5, got ${winTarget}`);
  }
  if (!Number.isInteger(totalPages) || totalPages < 10 || totalPages % 10 !== 0) {
    throw new RulesError(`totalPages must be a positive multiple of 10, got ${totalPages}`);
  }
  if (
    turnTimerSeconds !== null &&
    (!Number.isInteger(turnTimerSeconds) || turnTimerSeconds < 5 || turnTimerSeconds > 600)
  ) {
    throw new RulesError(`turnTimerSeconds must be null or 5..600, got ${turnTimerSeconds}`);
  }
  return rules;
}

import type { GameEvent, PlayerIndex, RulesConfig } from "@paper-duel/engine";

/**
 * All player-facing strings for game events and rules, in one place so a Tamil
 * translation (plan 6.4) can be added later.
 */

interface Ctx {
  you: PlayerIndex;
  names: [string, string];
}

const who = (p: PlayerIndex, c: Ctx) => (p === c.you ? "You" : c.names[p]);
const whose = (p: PlayerIndex, c: Ctx) => (p === c.you ? "your" : `${c.names[p]}'s`);

/** One line per event for the log, or null for events not worth showing. */
export function describeEvent(e: GameEvent, c: Ctx): string | null {
  switch (e.type) {
    case "BookOpened":
      return `${who(e.player, c)} opened page ${e.page}.`;
    case "TurnWasted":
      return e.reason === "even_digit"
        ? `Even digit: no game.`
        : `Slot ${e.player === c.you ? "is" : "was"} already dead: turn wasted.`;
    case "RerollGranted":
      return `Slot ${e.slot} is dead: ${who(e.player, c)} ${e.player === c.you ? "roll" : "rolls"} again.`;
    case "PartDrawn":
      return `${who(e.player, c)} drew ${e.part === "bullets" ? "3 bullets" : `a ${e.part}`} on slot ${e.slot}.`;
    case "AttackChoiceRequired":
      return `Slot ${e.slot} is armed: fire or hold?`;
    case "AttackSkipped":
      return `${who(e.player, c)} held fire on slot ${e.slot}.`;
    case "SlotEliminated":
      return `BANG! ${who(e.attacker, c)} eliminated ${whose((1 - e.attacker) as PlayerIndex, c)} slot ${e.slot}.`;
    case "FigureDestroyed":
      return `${who(e.attacker, c)} shot down ${whose((1 - e.attacker) as PlayerIndex, c)} unfinished figure on slot ${e.slot}.`;
    case "AttackMissed":
      return e.reason === "target_eliminated"
        ? `${who(e.attacker, c)} fired at slot ${e.slot}, but it was already dead.`
        : `${who(e.attacker, c)} fired at slot ${e.slot}, but there was no gun to hit. Miss!`;
    case "BulletsSpent":
      return null;
    case "TurnPassed":
      return null;
    case "GameOver":
      if (e.winner === null) return "Game over: a draw.";
      return e.reason === "forfeit"
        ? `${who(e.winner, c)} ${e.winner === c.you ? "win" : "wins"}: the other player left.`
        : `${who(e.winner, c)} ${e.winner === c.you ? "win" : "wins"}!`;
  }
}

export const STAGE_NAMES = ["Empty", "Head", "Body", "Face", "Gun", "Armed"] as const;

export const RULE_LABELS: {
  [K in keyof RulesConfig]?: { label: string; options?: Record<string, string> };
} = {
  winTarget: { label: "Fights to win" },
  firstPlayer: { label: "Who starts", options: { random: "Coin flip", host: "Host" } },
  armedRoll: {
    label: "Rolling an armed slot",
    options: { auto_attack: "Fires automatically", choose: "Player chooses" },
  },
  unarmedTarget: {
    label: "Shooting a slot with no gun",
    options: { miss: "Misses", destroy_partial: "Erases the figure" },
  },
  bullets: {
    label: "After firing",
    options: { consumed: "Reload needed", reusable: "Stays loaded" },
  },
  ownDeadSlot: {
    label: "Rolling your dead slot",
    options: { waste: "Turn wasted", reroll: "Roll again" },
  },
  turnTimerSeconds: { label: "Turn timer" },
};

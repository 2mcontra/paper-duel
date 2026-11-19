import type { Card, CardPlay, GameEvent, PlayerIndex, RulesConfig } from "@paper-duel/engine";
import type { Emote } from "@paper-duel/protocol";

/**
 * All player-facing strings for game events, cards and rules, in one place so a Tamil
 * translation (plan 6.4) can be added later.
 */

export interface TextCtx {
  you: PlayerIndex;
  names: string[];
}

const who = (p: PlayerIndex, c: TextCtx) =>
  p === c.you ? "You" : (c.names[p] ?? `Player ${p + 1}`);
const whose = (p: PlayerIndex, c: TextCtx) => (p === c.you ? "your" : `${c.names[p]}'s`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Verb agreement: "You draw" vs "Asha draws". */
const v = (p: PlayerIndex, c: TextCtx, verb: string, s = `${verb}s`) => (p === c.you ? verb : s);

export const CARD_INFO: Record<Card, { icon: string; name: string; help: string }> = {
  shield: { icon: "🛡️", name: "Shield", help: "Blocks the next shot at one of your slots." },
  double_shot: {
    icon: "💥",
    name: "Double shot",
    help: "If you fire this round, hit two players. Kept if you don't fire.",
  },
  eraser: { icon: "🧽", name: "Eraser", help: "Rub out the top part of an opponent's figure." },
  swap: { icon: "🔄", name: "Swap", help: "Swap two of your living figures." },
  steal: {
    icon: "🫳",
    name: "Steal",
    help: "Take an armed figure's bullets; yours loads if it has a gun.",
  },
};

export const EMOTE_ICONS: Record<Emote, { icon: string; label: string }> = {
  laugh: { icon: "😂", label: "Ha!" },
  fire: { icon: "🔥", label: "On fire" },
  angry: { icon: "😤", label: "Revenge!" },
  lucky: { icon: "🍀", label: "Lucky..." },
  gg: { icon: "🤝", label: "Good game" },
  shock: { icon: "😱", label: "Nooo" },
};

export function describePlay(play: CardPlay, c: TextCtx): string {
  switch (play.card) {
    case "shield":
      return `shield on slot ${play.slot}`;
    case "double_shot":
      return "double shot";
    case "eraser":
      return `eraser on ${whose(play.target, c)} slot ${play.slot}`;
    case "swap":
      return `swap slots ${play.slots[0]} and ${play.slots[1]}`;
    case "steal":
      return `steal from ${whose(play.target, c)} slot ${play.slot}`;
  }
}

/** One line per event for the log, or null for events not worth a line. */
export function describeEvent(e: GameEvent, c: TextCtx): string | null {
  switch (e.type) {
    case "RoundStarted":
    case "PlayerReady":
    case "BulletsSpent":
      return null;
    case "CardPlayed":
      return `${who(e.player, c)} ${v(e.player, c, "play")} ${CARD_INFO[e.play.card].icon} ${describePlay(e.play, c)}.`;
    case "CardFizzled":
      return cap(`${whose(e.player, c)} ${CARD_INFO[e.card].name} fizzled (back to hand).`);
    case "ShieldRaised":
    case "SlotsSwapped":
      return null; // covered by CardPlayed
    case "PartErased":
      return cap(`${whose(e.target, c)} slot ${e.slot} lost a part.`);
    case "BulletsStolen":
      return e.loaded ? `Bullets stolen and loaded!` : `Bullets stolen.`;
    case "BookOpened":
      return `${who(e.player, c)} ${v(e.player, c, "open")} page ${e.page}.`;
    case "CardDrawn":
      return e.card
        ? `🍀 Lucky page! You get ${CARD_INFO[e.card].icon} ${CARD_INFO[e.card].name}.`
        : `🍀 Lucky page! ${who(e.player, c)} ${v(e.player, c, "get")} a card.`;
    case "HandFull":
      return `🍀 Lucky page, but ${e.player === c.you ? "your" : "their"} hand is full.`;
    case "TurnWasted":
      return e.reason === "even_digit" ? "Even digit: no game." : "That slot is dead: wasted.";
    case "RerollGranted":
      return `Slot ${e.slot} is dead: open again.`;
    case "PartDrawn":
      return `${who(e.player, c)} ${v(e.player, c, "draw")} ${e.part === "bullets" ? "3 bullets" : `a ${e.part}`} on slot ${e.slot}.`;
    case "ShotFired":
      return `${who(e.attacker, c)} ${v(e.attacker, c, "fire")} slot ${e.slot} at ${e.targets.map((t) => (t === c.you ? "you" : c.names[t])).join(" and ")}!`;
    case "SlotEliminated":
      return `BANG! ${cap(whose(e.target, c))} slot ${e.slot} is gone.`;
    case "ShotBlocked":
      return `🛡️ ${cap(whose(e.target, c))} shield blocked it.`;
    case "FigureDestroyed":
      return cap(`${whose(e.target, c)} unfinished figure on slot ${e.slot} was wiped out.`);
    case "AttackMissed":
      return e.reason === "target_unarmed"
        ? "No gun there to hit. Miss!"
        : e.reason === "target_out"
          ? "They were already out. Miss!"
          : "That slot was already dead. Miss!";
    case "GoLost":
      return `${who(e.player, c)} ${e.player === c.you ? "were" : "was"} knocked out before ${e.player === c.you ? "your" : "their"} go.`;
    case "PlayerOut":
      return e.reason === "left"
        ? `${who(e.player, c)} left the game.`
        : `💀 ${who(e.player, c)} ${e.player === c.you ? "are" : "is"} out!`;
    case "GameOver":
      if (e.winner === null) return "Game over: a draw.";
      return `🏆 ${who(e.winner, c)} ${v(e.winner, c, "win")}!`;
  }
}

export const STAGE_NAMES = ["Empty", "Head", "Body", "Face", "Gun", "Armed"] as const;

type RuleMeta = { label: string; options?: Record<string, string> };

export const RULE_LABELS: { [K in keyof RulesConfig]?: RuleMeta } = {
  lives: { label: "Lives" },
  luckyCards: { label: "Lucky cards", options: { true: "On", false: "Off" } },
  roundTimerSeconds: { label: "Round timer" },
  firstPlayer: { label: "Who goes first in round 1", options: { random: "Random", host: "Host" } },
  unarmedTarget: {
    label: "Shooting a slot with no gun",
    options: { miss: "Misses", destroy_partial: "Wipes the figure" },
  },
  bullets: {
    label: "After firing",
    options: { consumed: "Reload needed", reusable: "Stays loaded" },
  },
  ownDeadSlot: {
    label: "Rolling your dead slot",
    options: { waste: "Go wasted", reroll: "Open again" },
  },
};

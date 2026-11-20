import type {
  AwardId,
  Card,
  CardPlay,
  GameEvent,
  Move,
  PlayerIndex,
  RulesConfig,
} from "@paper-duel/engine";
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

/** Figures are lettered A, B, C... within each player. */
export const figName = (f: number) => "ABCDE"[f] ?? String(f + 1);
/** "your A", "Bala's B" */
export const figOf = (p: PlayerIndex, f: number, c: TextCtx) => `${whose(p, c)} ${figName(f)}`;

export const CARD_INFO: Record<Card, { icon: string; name: string; help: string }> = {
  shield: {
    icon: "🛡️",
    name: "Shield",
    help: "One of your figures blocks the next shot or stomp.",
  },
  double_shot: {
    icon: "💥",
    name: "Double shot",
    help: "Your shot this turn can hit two figures in range.",
  },
  eraser: { icon: "🧽", name: "Eraser", help: "Rub out the top part of any enemy figure." },
  swap: { icon: "🔄", name: "Swap", help: "Swap places with an enemy figure on the track." },
  steal: {
    icon: "🫳",
    name: "Steal",
    help: "Take a loaded enemy's bullets into one of your empty guns.",
  },
  reroll: { icon: "🎲", name: "Reroll", help: "Open the book again and use the new page." },
};

export const EMOTE_ICONS: Record<Emote, { icon: string; label: string }> = {
  laugh: { icon: "😂", label: "Ha!" },
  fire: { icon: "🔥", label: "On fire" },
  angry: { icon: "😤", label: "Revenge!" },
  lucky: { icon: "🍀", label: "Lucky..." },
  gg: { icon: "🤝", label: "Good game" },
  shock: { icon: "😱", label: "Nooo" },
};

export const AWARD_INFO: Record<
  AwardId,
  { icon: string; title: string; unit: (n: number) => string }
> = {
  sharpshooter: {
    icon: "🎯",
    title: "Sharpshooter",
    unit: (n) => `${n} kill${n === 1 ? "" : "s"}`,
  },
  stomper: { icon: "🦶", title: "Stomper", unit: (n) => `${n} stomp${n === 1 ? "" : "s"}` },
  survivor: { icon: "🫀", title: "Survivor", unit: (n) => `${n} figure${n === 1 ? "" : "s"} left` },
  artist: { icon: "✏️", title: "Artist", unit: (n) => `${n} parts drawn` },
  card_shark: { icon: "🃏", title: "Card shark", unit: (n) => `${n} cards played` },
  explorer: { icon: "🧭", title: "Explorer", unit: (n) => `${n} squares walked` },
  lucky: { icon: "🍀", title: "Lucky book", unit: (n) => `average roll ${n}` },
  unlucky: { icon: "🌧️", title: "Unlucky book", unit: (n) => `average roll ${n}` },
};

export const STAGE_NAMES = ["Empty", "Head", "Body", "Face", "Gun", "Loaded"] as const;
/** What drawing the next part adds, by current stage. */
export const NEXT_PART = ["head", "body", "face", "gun", "bullets", null] as const;

export function placeName(place: number): string {
  return place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`;
}

export function describePlay(play: CardPlay, c: TextCtx): string {
  switch (play.card) {
    case "shield":
      return `shield on ${figName(play.figure)}`;
    case "double_shot":
      return "double shot";
    case "eraser":
      return `eraser on ${figOf(play.target, play.targetFigure, c)}`;
    case "swap":
      return `swap ${figName(play.figure)} with ${figOf(play.target, play.targetFigure, c)}`;
    case "steal":
      return `steal ${figOf(play.target, play.targetFigure, c)}'s bullets into ${figName(play.figure)}`;
    case "reroll":
      return "reroll";
  }
}

/** Card plays described from the point of view of whoever played them. */
function describePlayBy(p: PlayerIndex, play: CardPlay, c: TextCtx): string {
  if (play.card === "shield") return `a shield on ${figOf(p, play.figure, c)}`;
  if (play.card === "swap" || play.card === "steal") {
    const mine = figOf(p, play.figure, c);
    const theirs = figOf(play.target, play.targetFigure, c);
    return play.card === "swap"
      ? `a swap: ${mine} ↔ ${theirs}`
      : `a steal: ${theirs}'s bullets → ${mine}`;
  }
  return describePlay(play, c);
}

export function describeMove(m: Move, c: TextCtx, roll: number): string {
  switch (m.kind) {
    case "pass":
      return "Pass";
    case "draw":
      return `Draw on ${figName(m.figure)}`;
    case "move":
      return `Walk ${figName(m.figure)} ${roll}`;
    case "shoot":
      return `${figName(m.figure)} shoots ${m.targets.map((t) => figOf(t.player, t.figure, c)).join(" and ")}`;
  }
}

/** One line per event for the log, or null for events not worth a line. */
export function describeEvent(e: GameEvent, c: TextCtx): string | null {
  switch (e.type) {
    case "TurnStarted":
    case "BulletsSpent":
    case "ShieldRaised":
    case "Swapped":
    case "BulletsStolen":
      return null;
    case "BookOpened":
      return `${who(e.player, c)} ${v(e.player, c, "open")} page ${e.page}: roll ${e.roll}.`;
    case "CardDrawn":
      return e.card
        ? `🍀 Lucky page! You get ${CARD_INFO[e.card].icon} ${CARD_INFO[e.card].name}.`
        : `🍀 Lucky page! ${who(e.player, c)} ${v(e.player, c, "get")} a card.`;
    case "HandFull":
      return `🍀 Lucky page, but ${e.player === c.you ? "your" : "their"} hand is full.`;
    case "CardPlayed":
      return `${who(e.player, c)} ${v(e.player, c, "play")} ${CARD_INFO[e.play.card].icon} ${describePlayBy(e.player, e.play, c)}.`;
    case "PartErased":
      return cap(`${figOf(e.target, e.figure, c)} lost a part.`);
    case "PartDrawn":
      return `${who(e.player, c)} ${v(e.player, c, "draw")} ${e.part === "bullets" ? "bullets" : `a ${e.part}`} on ${figName(e.figure)}.`;
    case "FigureMoved":
      return `${who(e.player, c)} ${v(e.player, c, "walk")} ${figName(e.figure)} ${e.from === null ? "out of home" : ""} to square ${e.to + 1}.`.replace(
        "  ",
        " ",
      );
    case "Stomped":
      return `🦶 STOMP! ${cap(figOf(e.target, e.targetFigure, c))} is sent home.`;
    case "ShotFired":
      return `🔫 ${cap(figOf(e.player, e.figure, c))} ${v(e.player, c, "fire", "fires")} at ${e.targets.map((t) => figOf(t.player, t.figure, c)).join(" and ")}!`;
    case "FigureKilled":
      return `BANG! ${cap(figOf(e.target, e.targetFigure, c))} is gone.`;
    case "ShieldBroken":
      return `🛡️ ${cap(figOf(e.target, e.targetFigure, c))}'s shield took the hit.`;
    case "Passed":
      return `${who(e.player, c)} ${v(e.player, c, "pass", "passes")}.`;
    case "PlayerOut":
      return e.reason === "left"
        ? `${who(e.player, c)} left the game.`
        : `💀 ${who(e.player, c)} ${e.player === c.you ? "are" : "is"} out (${placeName(e.place)})!`;
    case "GameOver":
      if (e.winner === null)
        return e.reason === "time_up" ? "Time's up: a draw!" : "Game over: a draw.";
      return `🏆 ${who(e.winner, c)} ${v(e.winner, c, "win")}!${e.reason === "time_up" ? " (time's up)" : ""}`;
  }
}

type RuleMeta = { label: string; options?: Record<string, string> };

export const RULE_LABELS: { [K in keyof RulesConfig]?: RuleMeta } = {
  figures: { label: "Figures each" },
  luckyCards: { label: "Lucky cards", options: { true: "On", false: "Off" } },
  turnTimerSeconds: { label: "Turn timer" },
  maxRounds: { label: "Round limit" },
  firstPlayer: { label: "Who goes first", options: { random: "Random", host: "Host" } },
  bullets: {
    label: "After shooting",
    options: { consumed: "Reload needed", reusable: "Stays loaded" },
  },
};

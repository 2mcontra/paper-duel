import type { GameEvent, GameView, Stage } from "@paper-duel/engine";

/**
 * Round reveal: the server resolves a whole round at once and sends every event in one
 * update. To show it step by step, the client replays those events onto the board it was
 * showing before. At the end it switches to the server's state, so any gap here is
 * corrected rather than drifting.
 */

/** How long each event holds the stage before the next one, in ms. 0 = no pause. */
export const STEP_MS: Partial<Record<GameEvent["type"], number>> = {
  CardPlayed: 550,
  CardFizzled: 400,
  PartErased: 450,
  BulletsStolen: 450,
  SlotsSwapped: 400,
  BookOpened: 520,
  CardDrawn: 500,
  HandFull: 300,
  TurnWasted: 160,
  RerollGranted: 250,
  PartDrawn: 380,
  ShotFired: 650,
  SlotEliminated: 800,
  ShotBlocked: 600,
  FigureDestroyed: 600,
  AttackMissed: 400,
  GoLost: 400,
  PlayerOut: 1000,
  GameOver: 400,
};

/** Events that only exist while players are choosing; they never need a reveal. */
const QUIET = new Set<GameEvent["type"]>(["PlayerReady"]);

/** Does this update contain anything worth revealing step by step? */
export function needsReveal(events: GameEvent[]): boolean {
  return events.some((e) => !QUIET.has(e.type) && (STEP_MS[e.type] ?? 0) > 0);
}

/** Applies one event to a displayed game. Returns a new object; never mutates `view`. */
export function applyEvent(view: GameView, e: GameEvent): GameView {
  const v: GameView = {
    ...view,
    players: view.players.map((p) => ({
      ...p,
      hand: p.hand ? p.hand.slice() : null,
      slots: p.slots.map((s) => ({ ...s })),
    })),
    log: [...view.log, e],
  };
  const slot = (player: number, n: number) => v.players[player]?.slots[(n - 1) / 2];
  const setStage = (player: number, n: number, stage: Stage) => {
    const s = slot(player, n);
    if (s) s.stage = stage;
  };

  switch (e.type) {
    case "PartDrawn":
      setStage(e.player, e.slot, e.stage);
      break;
    case "PartErased":
      setStage(e.target, e.slot, e.stage);
      break;
    case "ShieldRaised": {
      const s = slot(e.player, e.slot);
      if (s) s.shielded = true;
      break;
    }
    case "SlotsSwapped": {
      const a = slot(e.player, e.slots[0]);
      const b = slot(e.player, e.slots[1]);
      if (a && b) {
        [a.stage, b.stage] = [b.stage, a.stage];
        [a.shielded, b.shielded] = [b.shielded, a.shielded];
      }
      break;
    }
    case "BulletsStolen":
      setStage(e.target, e.slot, 4);
      if (e.loaded) setStage(e.player, e.slot, 5);
      break;
    case "BulletsSpent":
      setStage(e.player, e.slot, 4);
      break;
    case "SlotEliminated": {
      const s = slot(e.target, e.slot);
      if (s) {
        s.status = "eliminated";
        s.shielded = false;
      }
      break;
    }
    case "ShotBlocked": {
      const s = slot(e.target, e.slot);
      if (s) s.shielded = false;
      break;
    }
    case "FigureDestroyed":
      setStage(e.target, e.slot, 0);
      break;
    case "PlayerOut": {
      const p = v.players[e.player];
      if (p) {
        p.out = true;
        for (const s of p.slots) s.shielded = false;
      }
      break;
    }
    case "CardDrawn": {
      const p = v.players[e.player];
      if (p) {
        p.handSize += 1;
        if (p.hand && e.card) p.hand.push(e.card);
      }
      break;
    }
    case "CardPlayed": {
      const p = v.players[e.player];
      if (p) {
        p.handSize = Math.max(0, p.handSize - 1);
        const i = p.hand?.indexOf(e.play.card) ?? -1;
        if (p.hand && i >= 0) p.hand.splice(i, 1);
      }
      break;
    }
    case "RoundStarted":
      v.round = e.round;
      break;
    default:
      break;
  }
  return v;
}

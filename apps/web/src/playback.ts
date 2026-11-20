import type { GameEvent, GameView, Stage } from "@paper-duel/engine";

/**
 * Turn playback: the server sends each action's events in one update. To show them step by
 * step, the client replays those events onto the board it was showing before. At the end it
 * switches to the server's state, so any gap here is corrected rather than drifting.
 */

/** How long each event holds the stage before the next one, in ms. 0 = no pause. */
export const STEP_MS: Partial<Record<GameEvent["type"], number>> = {
  BookOpened: 650,
  CardDrawn: 500,
  HandFull: 300,
  CardPlayed: 500,
  ShieldRaised: 300,
  PartErased: 450,
  Swapped: 550,
  BulletsStolen: 450,
  PartDrawn: 420,
  FigureMoved: 560,
  Stomped: 750,
  ShotFired: 600,
  FigureKilled: 800,
  ShieldBroken: 600,
  Passed: 200,
  PlayerOut: 1000,
  GameOver: 400,
};

/** Does this update contain anything worth playing back step by step? */
export function needsReveal(events: GameEvent[]): boolean {
  return events.some((e) => (STEP_MS[e.type] ?? 0) > 0);
}

/** Applies one event to a displayed game. Returns a new object; never mutates `view`. */
export function applyEvent(view: GameView, e: GameEvent): GameView {
  const v: GameView = {
    ...view,
    turn: { ...view.turn },
    players: view.players.map((p) => ({
      ...p,
      hand: p.hand ? p.hand.slice() : null,
      figures: p.figures.map((f) => ({ ...f })),
    })),
    log: [...view.log, e],
  };
  const fig = (p: number, f: number) => v.players[p]?.figures[f];
  const set = (p: number, f: number, patch: Partial<GameView["players"][0]["figures"][0]>) => {
    const x = fig(p, f);
    if (x) Object.assign(x, patch);
  };

  switch (e.type) {
    case "TurnStarted":
      v.round = e.round;
      v.turnNumber = e.turn;
      v.turn = { player: e.player, page: null, roll: null, cardPlayed: false, doubleShot: false };
      break;
    case "BookOpened":
      v.turn.page = e.page;
      v.turn.roll = e.roll;
      break;
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
      v.turn.cardPlayed = true;
      if (e.play.card === "double_shot") v.turn.doubleShot = true;
      break;
    }
    case "ShieldRaised":
      set(e.player, e.figure, { shielded: true });
      break;
    case "PartErased":
      set(e.target, e.figure, e.stage === 0 ? { stage: 0, pos: null } : { stage: e.stage });
      break;
    case "Swapped": {
      const a = fig(e.player, e.figure);
      const b = fig(e.target, e.targetFigure);
      if (a && b) [a.pos, b.pos] = [b.pos, a.pos];
      break;
    }
    case "BulletsStolen":
      set(e.target, e.targetFigure, { stage: 4 });
      set(e.player, e.figure, { stage: 5 });
      break;
    case "PartDrawn":
      set(e.player, e.figure, { stage: e.stage });
      break;
    case "FigureMoved":
      set(e.player, e.figure, { pos: e.to });
      break;
    case "Stomped":
      set(e.target, e.targetFigure, { pos: null, stage: e.stage as Stage });
      break;
    case "FigureKilled":
      set(e.target, e.targetFigure, { dead: true, pos: null, shielded: false });
      break;
    case "ShieldBroken":
      set(e.target, e.targetFigure, { shielded: false });
      break;
    case "BulletsSpent":
      set(e.player, e.figure, { stage: 4 });
      break;
    case "PlayerOut": {
      const p = v.players[e.player];
      if (p) {
        p.out = true;
        p.place = e.place;
        p.handSize = 0;
        if (p.hand) p.hand = [];
        for (const f of p.figures) {
          f.pos = null;
          f.shielded = false;
          if (e.reason === "left") f.dead = true;
        }
      }
      break;
    }
    case "GameOver":
      v.phase = "finished";
      v.winner = e.winner;
      v.endReason = e.reason;
      e.places.forEach((place, i) => {
        const p = v.players[i];
        if (p) p.place = place;
      });
      break;
    default:
      break;
  }
  return v;
}

import { useEffect } from "react";
import { SLOT_NUMBERS, getSlot, type PlayerIndex, type PlayerState } from "@paper-duel/engine";
import { BookPage } from "../components/Book.js";
import { Countdown } from "../components/Countdown.js";
import { EventLog } from "../components/EventLog.js";
import { StickFigure } from "../components/StickFigure.js";
import { useGame } from "../store/game.js";
import { STAGE_NAMES, describeEvent } from "../text.js";

const eliminatedCount = (p: PlayerState) => p.slots.filter((s) => s.status === "eliminated").length;

export function Board() {
  const s = useGame();
  const { game, you, room } = s;
  const myTurn = game?.phase === "playing" && game.turn === you;
  const canOpen = myTurn && game.pendingChoice === null && !s.busy;

  // Space opens the book (plan 6.4), unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "Space" || el?.closest("input, textarea, select, button")) return;
      e.preventDefault();
      if (canOpen) s.openBook();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canOpen, s]);

  if (!game || you === null || !room) return null;
  const them = (1 - you) as PlayerIndex;
  const me = game.players[you];
  const opp = game.players[them];
  const names: [string, string] = [game.players[0].name, game.players[1].name];
  const target = game.rules.winTarget;
  const rolled = game.lastRoll && game.lastRoll.digit % 2 === 1 ? game.lastRoll.digit : null;
  const hitSlots = new Set(
    s.lastEvents.flatMap((e) => (e.type === "SlotEliminated" ? [e.slot] : [])),
  );
  const opponentAway = s.opponent && !s.opponent.connected;

  return (
    <main className="page board-page">
      <header className="scorebar">
        <div className={`score${game.turn === you ? " score--turn" : ""}`}>
          <span className="score__name">{me.name} (you)</span>
          <span className="score__value" data-testid="my-score">
            {eliminatedCount(opp)}
          </span>
        </div>
        <div className="score__target">first to {target}</div>
        <div className={`score score--right${game.turn === them ? " score--turn" : ""}`}>
          <span className="score__value" data-testid="their-score">
            {eliminatedCount(me)}
          </span>
          <span className="score__name">{opp.name}</span>
        </div>
      </header>

      {opponentAway && (
        <p className="notice" role="status">
          {opp.name} disconnected. Waiting for them to come back...
        </p>
      )}

      <section className="notebook" aria-label="Board">
        <div className="notebook__head">
          <span />
          <span>You</span>
          <span>{opp.name}</span>
        </div>
        {SLOT_NUMBERS.map((n) => {
          const mine = getSlot(me, n);
          const theirs = getSlot(opp, n);
          return (
            <div
              key={n}
              className={`row${rolled === n ? " row--rolled" : ""}${hitSlots.has(n) ? " row--hit" : ""}`}
              data-testid={`row-${n}`}
            >
              <span className="row__num">{n}</span>
              <div className="cell">
                <StickFigure
                  stage={mine.stage}
                  eliminated={mine.status === "eliminated"}
                  label={`Your slot ${n}: ${mine.status === "eliminated" ? "eliminated" : STAGE_NAMES[mine.stage]}`}
                />
              </div>
              <div className="cell cell--them">
                <StickFigure
                  stage={theirs.stage}
                  eliminated={theirs.status === "eliminated"}
                  mirrored
                  label={`${opp.name}'s slot ${n}: ${theirs.status === "eliminated" ? "eliminated" : STAGE_NAMES[theirs.stage]}`}
                />
              </div>
            </div>
          );
        })}
      </section>

      <section className="controls">
        <BookPage roll={game.lastRoll} youRolled={game.lastRoll?.player === you} />
        <div className="turn">
          {game.phase === "playing" ? (
            <>
              <p className="turn__label" data-testid="turn-label">
                {myTurn ? "Your turn" : `${opp.name}'s turn`}{" "}
                {s.timer && (
                  <Countdown
                    key={s.timer.deadline ?? "none"}
                    deadline={s.timer.deadline}
                    offset={s.clockOffset}
                  />
                )}
              </p>
              {myTurn && game.pendingChoice !== null ? (
                <div className="actions">
                  <button
                    className="btn btn--primary"
                    onClick={() => s.choose(true)}
                    disabled={s.busy}
                  >
                    Fire slot {game.pendingChoice}!
                  </button>
                  <button className="btn" onClick={() => s.choose(false)} disabled={s.busy}>
                    Hold fire
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn--primary btn--big"
                  onClick={s.openBook}
                  disabled={!canOpen}
                  data-testid="open-book"
                >
                  Open the book
                </button>
              )}
              {s.lastAuto && (
                <p className="hint">Time ran out, so the book was opened automatically.</p>
              )}
            </>
          ) : (
            <GameOver />
          )}
        </div>
      </section>

      <EventLog log={game.log} you={you} names={names} />
    </main>
  );
}

function GameOver() {
  const { game, you, room, rematch, leave } = useGame();
  if (!game || you === null || !room) return null;
  const over = game.log.at(-1);
  const text = over
    ? describeEvent(over, { you, names: [game.players[0].name, game.players[1].name] })
    : null;
  const won = game.winner === you;
  const mine = room.seats[you];
  const theirs = room.seats[1 - you];
  return (
    <div className={`gameover${won ? " gameover--won" : ""}`} role="status" data-testid="game-over">
      <p className="gameover__title">
        {game.winner === null ? "Draw" : won ? "You win!" : "You lose"}
      </p>
      {text && <p>{text}</p>}
      <div className="actions">
        <button
          className="btn btn--primary"
          onClick={rematch}
          disabled={mine?.wantsRematch || !theirs}
        >
          {mine?.wantsRematch ? "Waiting for them..." : "Rematch"}
        </button>
        <button className="btn btn--quiet" onClick={leave}>
          Leave
        </button>
      </div>
      {theirs?.wantsRematch && !mine?.wantsRematch && <p className="hint">They want a rematch.</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  destination,
  distance,
  figuresLeft,
  isStar,
  legalCardPlays,
  legalMoves,
  rangeSquare,
  shootTargets,
  stompVictims,
  type Card,
  type CardPlay,
  type FigureRef,
  type GameView,
  type Move,
  type PlayerIndex,
} from "@paper-duel/engine";
import { EMOTES } from "@paper-duel/protocol";
import { BookPage } from "../components/Book.js";
import { Countdown } from "../components/Countdown.js";
import { EventLog } from "../components/EventLog.js";
import { Podium } from "../components/Podium.js";
import { ShotOverlay } from "../components/ShotOverlay.js";
import { MiniFigure, Track, colorOf, type Highlights } from "../components/Track.js";
import { useGame, type EmoteBubble } from "../store/game.js";
import {
  CARD_INFO,
  EMOTE_ICONS,
  NEXT_PART,
  describePlay,
  figName,
  figOf,
  type TextCtx,
} from "../text.js";

const refKey = (r: FigureRef) => `${r.player}-${r.figure}`;

export function Board() {
  const s = useGame();
  const { game, you, room } = s;
  const [hover, setHover] = useState<Highlights>({});
  const [cardPick, setCardPick] = useState<Card | null>(null);
  /** Targets picked so far for a double shot: shooter and targets. */
  const [multi, setMulti] = useState<{ figure: number; targets: FigureRef[] } | null>(null);

  const playing = game?.phase === "playing";
  const myTurn = playing && you !== null && game.turn.player === you;
  const revealing = !!s.reveal;
  const canOpen = myTurn && game.turn.roll === null && !s.busy && !revealing;

  // Space opens the book (plan 6.4), unless you're typing or on a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "Space" || el?.closest("input, textarea, select, button, [role=button]"))
        return;
      e.preventDefault();
      if (canOpen) s.openBook();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canOpen, s]);

  // A new turn or roll clears half-made choices. Adjusting state while rendering is React's
  // recommended way to reset on a prop change.
  const resetKey = `${game?.id}:${game?.turnNumber}:${game?.turn.roll}:${game?.turn.cardPlayed}`;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setHover({});
    setCardPick(null);
    setMulti(null);
  }

  if (!game || you === null || !room) return null;
  // The board shows events as they play back; controls follow the server's state.
  const display = s.shown ?? game;
  const names = game.players.map((p) => p.name);
  const ctx: TextCtx = { you, names };
  const turnPlayer = display.turn.player;
  const roll = game.turn.roll;
  const choosing = myTurn && roll !== null && !revealing;
  const moves = choosing ? legalMoves(game, you) : [];
  const plays = choosing ? legalCardPlays(game, you) : [];
  const bubbles = new Map(s.emotes.map((e) => [e.from, e]));
  const myHand = game.players[you]!.hand ?? [];

  const act = (move: Move) => {
    setHover({});
    s.act(move);
  };

  /** Clicking a target on the board: shoot it with the first figure that can. */
  const pickTarget = (ref: FigureRef) => {
    if (!choosing || roll === null) return;
    if (multi) {
      const has = multi.targets.some((t) => refKey(t) === refKey(ref));
      const targets = has
        ? multi.targets.filter((t) => refKey(t) !== refKey(ref))
        : [...multi.targets, ref].slice(-2);
      setMulti({ ...multi, targets });
      return;
    }
    const shooter = moves.find((m) => m.kind === "shoot" && refKey(m.targets[0]!) === refKey(ref));
    if (shooter) act(shooter);
  };

  const boardTargets = multi
    ? new Set(shootTargets(game, you, multi.figure, roll ?? 0).map(refKey))
    : (hover.targets ??
      (choosing
        ? new Set(moves.flatMap((m) => (m.kind === "shoot" ? [refKey(m.targets[0]!)] : [])))
        : undefined));
  const highlights: Highlights = {
    ...hover,
    ...(boardTargets ? { targets: boardTargets } : {}),
    ...(multi
      ? { selected: new Set([`${you}-${multi.figure}`, ...multi.targets.map(refKey)]) }
      : {}),
  };

  const opened = display.turn.page;
  const bookCaption = turnPlayer === you ? "Your page" : `${names[turnPlayer]}'s page`;

  return (
    <main className="page board-page">
      <header className="roundbar">
        <span className="roundbar__round">Round {display.round}</span>
        {playing && s.timer?.turn === game.turnNumber && (
          <Countdown
            key={s.timer.deadline ?? "none"}
            deadline={s.timer.deadline}
            offset={s.clockOffset}
          />
        )}
        <span
          className="roundbar__wait"
          data-testid="whose-turn"
          style={{ color: colorOf(turnPlayer) }}
        >
          {!playing ? "" : turnPlayer === you ? "Your turn!" : `${names[turnPlayer]}'s turn`}
        </span>
      </header>

      <div className="board-grid">
        <section className="board-main" aria-label="Track">
          <Track
            game={display}
            you={you}
            highlights={highlights}
            onPickTarget={choosing ? pickTarget : undefined}
          />
        </section>

        <section className="controls" aria-label="Your turn">
          {display.phase !== "playing" ? (
            <Podium />
          ) : (
            <>
              <BookPage
                page={opened}
                roll={display.turn.roll}
                caption={
                  opened !== null
                    ? bookCaption
                    : turnPlayer === you
                      ? "Your turn: open the book"
                      : `${names[turnPlayer]} is about to open the book`
                }
                flipKey={
                  opened !== null
                    ? `${display.turnNumber}-${display.log.length}-${opened}`
                    : undefined
                }
                flipMs={600}
              />
              <div className="turn">
                {revealing ? (
                  <div className="revealing">
                    <p className="turn__label" data-testid="revealing">
                      {turnPlayer === you ? "Your turn..." : `${names[turnPlayer]}'s turn...`}
                    </p>
                    {(s.reveal?.total ?? 0) > 3 && (
                      <button className="btn btn--small" onClick={s.skipReveal} data-testid="skip">
                        Skip
                      </button>
                    )}
                  </div>
                ) : game.players[you]!.out ? (
                  <p className="turn__label">You're out. Watch the rest play it out!</p>
                ) : !myTurn ? (
                  <p className="turn__label" data-testid="turn-label">
                    Waiting for {names[turnPlayer]}...
                  </p>
                ) : roll === null ? (
                  <>
                    <p className="turn__label" data-testid="turn-label">
                      Your turn!
                    </p>
                    <button
                      className="btn btn--primary btn--big"
                      onClick={s.openBook}
                      disabled={!canOpen}
                      data-testid="open-book"
                    >
                      Open the book
                    </button>
                    <p className="hint">The last digit is your roll (0 counts as 10).</p>
                  </>
                ) : cardPick ? (
                  <CardOptions
                    card={cardPick}
                    plays={plays.filter((p) => p.card === cardPick)}
                    ctx={ctx}
                    onHover={setHover}
                    onPlay={(p) => {
                      setCardPick(null);
                      s.playCard(p);
                    }}
                    onCancel={() => setCardPick(null)}
                  />
                ) : multi ? (
                  <div className="choices" data-testid="double-shot">
                    <p className="turn__label">
                      💥 Double shot: pick up to two targets on the board.
                    </p>
                    <p className="hint">
                      {multi.targets.length
                        ? multi.targets.map((t) => figOf(t.player, t.figure, ctx)).join(" and ")
                        : "None picked yet"}
                    </p>
                    <div className="actions">
                      <button
                        className="btn btn--primary"
                        disabled={!multi.targets.length || s.busy}
                        onClick={() =>
                          act({ kind: "shoot", figure: multi.figure, targets: multi.targets })
                        }
                      >
                        Fire!
                      </button>
                      <button className="btn btn--quiet" onClick={() => setMulti(null)}>
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  <Choices
                    game={game}
                    you={you}
                    roll={roll}
                    moves={moves}
                    ctx={ctx}
                    busy={s.busy}
                    onHover={setHover}
                    onAct={act}
                    onDouble={(figure) => setMulti({ figure, targets: [] })}
                  />
                )}
                {s.lastAuto.includes(you) && playing && turnPlayer !== you && (
                  <p className="hint">Time ran out, so your turn was played for you.</p>
                )}
              </div>
              {!game.players[you]!.out && (
                <Hand
                  hand={myHand}
                  playable={new Set(plays.map((p) => p.card))}
                  canPlay={choosing && !game.turn.cardPlayed && !s.busy}
                  rolled={roll !== null && myTurn}
                  onPick={(card) => {
                    const options = plays.filter((p) => p.card === card);
                    if (options.length === 1 && (card === "double_shot" || card === "reroll")) {
                      s.playCard(options[0]!);
                    } else setCardPick(card);
                  }}
                />
              )}
            </>
          )}
        </section>

        <section className="board-players" aria-label="Players">
          <Players game={display} you={you} bubbles={bubbles} />
        </section>
      </div>

      <EmoteBar />
      {playing && !game.players[you]!.out && (
        <button
          className="btn btn--quiet btn--small leave-game"
          onClick={() => {
            if (confirm("Leave this game? You'll be knocked out.")) s.leave();
          }}
          data-testid="leave-game"
        >
          Leave game
        </button>
      )}
      <EventLog log={display.log} you={you} names={names} />
      <ShotOverlay current={s.current} />
    </main>
  );
}

interface ChoicesProps {
  game: GameView;
  you: PlayerIndex;
  roll: number;
  moves: Move[];
  ctx: TextCtx;
  busy: boolean;
  onHover: (h: Highlights) => void;
  onAct: (m: Move) => void;
  onDouble: (figure: number) => void;
}

/** Your options this turn, grouped by figure. Hovering one shows it on the board. */
function Choices({ game, you, roll, moves, ctx, busy, onHover, onAct, onDouble }: ChoicesProps) {
  const me = game.players[you]!;
  const clear = () => onHover({});
  const hoverProps = (h: Highlights) => ({
    onMouseEnter: () => onHover(h),
    onFocus: () => onHover(h),
    onMouseLeave: clear,
    onBlur: clear,
  });
  return (
    <div className="choices" data-testid="choices">
      <p className="turn__label" data-testid="turn-label">
        You rolled <strong className="roll">{roll}</strong>. Pick one:
      </p>
      {me.figures.map((f, i) => {
        if (f.dead) return null;
        const mine = moves.filter((m) => m.kind !== "pass" && m.figure === i);
        if (!mine.length) return null;
        const key = `${you}-${i}`;
        return (
          <div key={i} className="choice-row">
            <span className="choice-row__fig" title={figName(i)}>
              <svg viewBox="-20 -22 40 50" width="34" height="42" aria-hidden="true">
                <MiniFigure
                  stage={f.stage}
                  dead={false}
                  color={colorOf(you)}
                  shielded={f.shielded}
                  letter={figName(i)}
                />
              </svg>
              <span className="choice-row__where">
                {f.pos === null ? "home" : `sq ${f.pos + 1}${isStar(f.pos) ? " ★" : ""}`}
              </span>
            </span>
            <span className="choice-row__opts">
              {mine.map((m, k) => {
                if (m.kind === "draw") {
                  return (
                    <button
                      key={k}
                      className="btn btn--small opt"
                      disabled={busy}
                      onClick={() => onAct(m)}
                      data-testid={`draw-${i}`}
                      {...hoverProps({ selected: new Set([key]) })}
                    >
                      ✏️ Draw {NEXT_PART[f.stage]}
                    </button>
                  );
                }
                if (m.kind === "move") {
                  const to = destination(game, you, i, roll);
                  const victims = stompVictims(game, you, to);
                  return (
                    <button
                      key={k}
                      className={`btn btn--small opt${victims.length ? " opt--hot" : ""}`}
                      disabled={busy}
                      onClick={() => onAct(m)}
                      data-testid={`move-${i}`}
                      {...hoverProps({
                        squares: new Set([to]),
                        selected: new Set([key]),
                        targets: new Set(victims.map(refKey)),
                      })}
                    >
                      🚶 Walk to {to + 1}
                      {isStar(to) ? " ★" : ""}
                      {victims.length
                        ? ` — stomp ${victims.map((v) => figOf(v.player, v.figure, ctx)).join(", ")}!`
                        : ""}
                    </button>
                  );
                }
                if (m.kind === "shoot") {
                  const t = m.targets[0]!;
                  const d = distance(game.trackLength, f.pos!, rangeSquare(game, t));
                  const tf = game.players[t.player]!.figures[t.figure]!;
                  return (
                    <button
                      key={k}
                      className="btn btn--small opt opt--hot"
                      disabled={busy}
                      onClick={() => onAct(m)}
                      data-testid={`shoot-${i}-${refKey(t)}`}
                      {...hoverProps({ selected: new Set([key]), targets: new Set([refKey(t)]) })}
                    >
                      🔫 Shoot {figOf(t.player, t.figure, ctx)}
                      {tf.pos === null ? " (home)" : ""} · {d} away{tf.shielded ? " 🛡️" : ""}
                    </button>
                  );
                }
                return null;
              })}
              {game.turn.doubleShot && mine.filter((m) => m.kind === "shoot").length >= 2 && (
                <button
                  className="btn btn--small opt opt--hot"
                  onClick={() => onDouble(i)}
                  disabled={busy}
                >
                  💥 Double shot...
                </button>
              )}
            </span>
          </div>
        );
      })}
      <button
        className="btn btn--quiet btn--small"
        onClick={() => onAct({ kind: "pass" })}
        disabled={busy}
        data-testid="pass"
      >
        Pass
      </button>
    </div>
  );
}

function CardOptions({
  card,
  plays,
  ctx,
  onHover,
  onPlay,
  onCancel,
}: {
  card: Card;
  plays: CardPlay[];
  ctx: TextCtx;
  onHover: (h: Highlights) => void;
  onPlay: (p: CardPlay) => void;
  onCancel: () => void;
}) {
  const info = CARD_INFO[card];
  const refsOf = (p: CardPlay): FigureRef[] => {
    const out: FigureRef[] = [];
    if ("figure" in p) out.push({ player: ctx.you, figure: p.figure });
    if ("target" in p) out.push({ player: p.target, figure: p.targetFigure });
    return out;
  };
  return (
    <div className="choices">
      <p className="turn__label">
        {info.icon} {info.name}: {info.help}
      </p>
      <div className="card-opts">
        {plays.map((p, i) => (
          <button
            key={i}
            className="btn btn--small opt"
            onClick={() => onPlay(p)}
            onMouseEnter={() => onHover({ targets: new Set(refsOf(p).map(refKey)) })}
            onMouseLeave={() => onHover({})}
          >
            {describePlay(p, ctx)}
          </button>
        ))}
      </div>
      <button className="btn btn--quiet btn--small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Players({
  game,
  you,
  bubbles,
}: {
  game: GameView;
  you: PlayerIndex;
  bubbles: Map<number, EmoteBubble>;
}) {
  const room = useGame((s) => s.room);
  return (
    <ul className="players" aria-label="Players">
      {game.players.map((p, i) => {
        const seat = room?.seats[i];
        const status = seat?.left
          ? "left"
          : p.out
            ? "out"
            : seat && !seat.connected
              ? "offline"
              : game.phase === "playing" && game.turn.player === i
                ? "their turn"
                : "";
        return (
          <li
            key={i}
            className={`pl${p.out ? " pl--out" : ""}${game.phase === "playing" && game.turn.player === i ? " pl--turn" : ""}`}
            data-testid={`player-${i}`}
            style={{ borderColor: colorOf(i) }}
          >
            <span className="pl__dot" style={{ background: colorOf(i) }} />
            <span className="pl__name">
              {p.name}
              {i === you && " (you)"}
              {bubbles.get(i) && <Bubble bubble={bubbles.get(i)!} />}
            </span>
            <span
              className="pl__figs"
              aria-label={`${figuresLeft(p)} of ${p.figures.length} figures left`}
            >
              {p.figures.map((f, k) => (
                <span
                  key={k}
                  className={f.dead ? "pl__fig pl__fig--dead" : "pl__fig"}
                  style={{ color: colorOf(i) }}
                >
                  {f.dead ? "✕" : "♟"}
                </span>
              ))}
            </span>
            {p.handSize > 0 && (
              <span className="pl__cards" aria-label={`${p.handSize} cards`}>
                🂠×{p.handSize}
              </span>
            )}
            {seat && seat.points > 0 && <span className="pl__pts">{seat.points} pts</span>}
            <span className="pl__status" data-testid={`status-${i}`}>
              {status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Bubble({ bubble }: { bubble: EmoteBubble }) {
  const info = EMOTE_ICONS[bubble.emote];
  return (
    <span className="bubble" role="status" aria-label={info.label}>
      {info.icon}
    </span>
  );
}

interface HandProps {
  hand: Card[];
  playable: Set<Card>;
  canPlay: boolean;
  rolled: boolean;
  onPick: (card: Card) => void;
}

function Hand({ hand, playable, canPlay, rolled, onPick }: HandProps) {
  if (hand.length === 0) {
    return <p className="hint">Lucky pages (100, 200, 11, 22, 111...) give cards.</p>;
  }
  return (
    <div className="hand" aria-label="Your cards">
      <p className="hand__title">
        Your cards {rolled ? "(one per turn, before you act)" : "(play after opening the book)"}
      </p>
      <div className="hand__cards">
        {hand.map((card, i) => {
          const info = CARD_INFO[card];
          return (
            <button
              key={i}
              className="playcard"
              onClick={() => onPick(card)}
              disabled={!canPlay || !playable.has(card)}
              title={info.help}
            >
              <span className="playcard__icon">{info.icon}</span>
              <span className="playcard__name">{info.name}</span>
              <span className="playcard__help">{info.help}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmoteBar() {
  const emote = useGame((s) => s.emote);
  const [cooling, setCooling] = useState(false);
  const send = (e: (typeof EMOTES)[number]) => {
    if (cooling) return;
    emote(e);
    setCooling(true);
    setTimeout(() => setCooling(false), 1500);
  };
  return (
    <div className="emotes" role="group" aria-label="Emotes">
      {EMOTES.map((e) => (
        <button
          key={e}
          className="emote"
          onClick={() => send(e)}
          disabled={cooling}
          aria-label={EMOTE_ICONS[e].label}
          title={EMOTE_ICONS[e].label}
        >
          {EMOTE_ICONS[e].icon}
        </button>
      ))}
    </div>
  );
}

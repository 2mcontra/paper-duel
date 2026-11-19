import { useEffect, useState } from "react";
import {
  SLOT_NUMBERS,
  getSlot,
  isHidden,
  lostCount,
  type Card,
  type CardPlay,
  type GameEvent,
  type GameView,
  type PlayerIndex,
  type PlayerView,
  type SlotNumber,
  type Submission,
} from "@paper-duel/engine";
import { EMOTES } from "@paper-duel/protocol";
import { BookPage } from "../components/Book.js";
import { Countdown } from "../components/Countdown.js";
import { EventLog } from "../components/EventLog.js";
import { ShotOverlay } from "../components/ShotOverlay.js";
import { StickFigure } from "../components/StickFigure.js";
import { useGame, type EmoteBubble } from "../store/game.js";
import { CARD_INFO, EMOTE_ICONS, STAGE_NAMES, describeEvent, describePlay } from "../text.js";

/** A card waiting for the player to pick where it goes. */
type Picking = { card: Exclude<Card, "double_shot">; first?: SlotNumber } | null;

// PlayerView has the same slot shape as PlayerState, which is all getSlot reads.
const slotOf = (p: PlayerView, n: SlotNumber) => getSlot(p as never, n);
const livesLeft = (p: PlayerView, lives: number) => Math.max(0, lives - lostCount(p as never));

export function Board() {
  const s = useGame();
  const { game, you, room } = s;
  const [picking, setPicking] = useState<Picking>(null);
  const [aimed, setAimed] = useState<PlayerIndex[]>([]);

  const mine = game && you !== null ? game.pending[you] : null;
  const myGo: Submission | null = mine && !isHidden(mine) ? mine : null;
  const revealing = !!s.reveal;
  const canOpen =
    game?.phase === "playing" && !!myGo && !myGo.done && !myGo.needsTarget && !s.busy && !revealing;

  // Space opens the book (plan 6.4), unless you're typing or on a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.code !== "Space" || el?.closest("input, textarea, select, button")) return;
      e.preventDefault();
      if (canOpen && !picking) s.openBook();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canOpen, picking, s]);

  // A new round (or a finished aim) clears any half-made choices. Adjusting state while
  // rendering is React's recommended way to reset on a prop change.
  const resetKey = `${game?.id}:${game?.round}:${myGo?.needsTarget}`;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setPicking(null);
    setAimed([]);
  }

  if (!game || you === null || !room) return null;
  // Boards show the round as it is being revealed; controls follow the server's state.
  const display = s.shown ?? game;
  const me = display.players[you]!;
  const myHand = game.players[you]!.hand ?? [];
  const names = game.players.map((p) => p.name);
  const lives = game.rules.lives;
  const opponents = game.players.flatMap((p, i) => (i === you ? [] : [i]));
  const activeOpps = opponents.filter((i) => !game.players[i]!.out);
  const opened = revealing ? lastOpened(display) : null;
  const waitingFor = game.pending.flatMap((sub, i) =>
    sub && !sub.done && i !== you ? [names[i]!] : [],
  );
  const bubbles = new Map(s.emotes.map((e) => [e.from, e]));
  const cur = s.current?.event;
  const hits = new Set(cur?.type === "SlotEliminated" ? [`${cur.target}:${cur.slot}`] : []);
  const armedSlot = myGo?.needsTarget ? ((myGo.pages.at(-1)! % 10) as SlotNumber) : null;
  const wantTargets = myGo?.card?.card === "double_shot" ? Math.min(2, activeOpps.length) : 1;
  const lastPage = myGo?.pages.at(-1) ?? lastPageOf(display, you);
  // While revealing, the book follows each player's page; otherwise it shows yours.
  const book = opened
    ? {
        page: opened.event.page,
        caption: opened.event.player === you ? "Your page" : `${names[opened.event.player]}'s page`,
        flipKey: `r${opened.index}`,
        flipMs: 420,
      }
    : myGo?.pages.length
      ? {
          page: lastPage,
          caption: "Your page this round",
          flipKey: `${game.round}-${myGo.pages.length}`,
          flipMs: 800,
        }
      : { page: lastPage, caption: "Your last page", flipKey: undefined, flipMs: 0 };
  const rolledSlot = (p: PlayerIndex): number | null =>
    opened
      ? opened.event.player === p
        ? opened.event.digit
        : null
      : p === you && lastPage !== null
        ? lastPage % 10
        : null;

  // ----- picking handlers -----
  const startCard = (card: Card) => {
    if (card === "double_shot") return s.playCard({ card });
    setPicking({ card });
  };
  const pickMySlot = (n: SlotNumber) => {
    if (!picking) return;
    if (picking.card === "shield") {
      s.playCard({ card: "shield", slot: n });
      setPicking(null);
    } else if (picking.card === "swap") {
      if (!picking.first) return setPicking({ ...picking, first: n });
      if (picking.first !== n) s.playCard({ card: "swap", slots: [picking.first, n] });
      setPicking(null);
    }
  };
  const pickTheirSlot = (target: PlayerIndex, n: SlotNumber) => {
    if (picking?.card === "eraser" || picking?.card === "steal") {
      s.playCard({ card: picking.card, target, slot: n } as CardPlay);
      setPicking(null);
    }
  };
  const toggleAim = (t: PlayerIndex) => {
    if (wantTargets === 1) return s.setTarget([t]);
    const next = aimed.includes(t)
      ? aimed.filter((x) => x !== t)
      : [...aimed, t].slice(-wantTargets);
    setAimed(next);
    if (next.length === wantTargets) s.setTarget(next);
  };

  const mySlotPickable = (n: SlotNumber) =>
    (picking?.card === "shield" || picking?.card === "swap") && slotOf(me, n).status === "alive";
  const theirSlotPickable = (p: PlayerView, n: SlotNumber) => {
    if (p.out || !(picking?.card === "eraser" || picking?.card === "steal")) return false;
    const sl = slotOf(p, n);
    return sl.status === "alive" && (picking.card === "eraser" ? sl.stage > 0 : sl.stage === 5);
  };

  return (
    <main className="page board-page">
      <header className="roundbar">
        <span className="roundbar__round">Round {display.round}</span>
        {game.phase === "playing" && s.timer?.round === game.round && (
          <Countdown
            key={s.timer.deadline ?? "none"}
            deadline={s.timer.deadline}
            offset={s.clockOffset}
          />
        )}
        <span className="roundbar__wait" data-testid="waiting">
          {game.phase !== "playing" || revealing
            ? ""
            : waitingFor.length
              ? `Waiting for ${waitingFor.join(", ")}`
              : myGo?.done
                ? "Revealing..."
                : "Everyone else is ready"}
        </span>
      </header>

      <section className={`opponents opponents--${opponents.length}`} aria-label="Opponents">
        {opponents.map((i) => (
          <OpponentCard
            key={i}
            player={display.players[i]!}
            index={i}
            lives={livesLeft(display.players[i]!, lives)}
            active={opened?.event.player === i}
            rolled={rolledSlot(i)}
            done={!!game.pending[i]?.done}
            left={!!room.seats[i]?.left}
            connected={room.seats[i]?.connected ?? true}
            bubble={bubbles.get(i)}
            aimSlot={armedSlot}
            aimed={aimed.includes(i)}
            onAim={
              armedSlot !== null && !revealing && !game.players[i]!.out
                ? () => toggleAim(i)
                : undefined
            }
            hits={hits}
            slotPickable={(n) => theirSlotPickable(display.players[i]!, n)}
            onPickSlot={(n) => pickTheirSlot(i, n)}
          />
        ))}
      </section>

      <section className={`myboard${me.out ? " myboard--out" : ""}`} aria-label="Your board">
        <div className="myboard__head">
          <span className="myboard__name">
            {me.name} (you)
            {bubbles.get(you) && <Bubble bubble={bubbles.get(you)!} />}
          </span>
          <Hearts left={livesLeft(me, lives)} total={lives} />
        </div>
        {SLOT_NUMBERS.map((n) => {
          const sl = slotOf(me, n);
          const pickable = mySlotPickable(n);
          const rolled = rolledSlot(you) === n;
          const label = `Your slot ${n}: ${sl.status === "eliminated" ? "eliminated" : STAGE_NAMES[sl.stage]}${sl.shielded ? ", shielded" : ""}`;
          return (
            <div
              key={n}
              className={`row${rolled ? " row--rolled" : ""}${hits.has(`${you}:${n}`) ? " row--hit" : ""}${picking?.first === n ? " row--picked" : ""}`}
              data-testid={`row-${n}`}
            >
              <span className="row__num">{n}</span>
              {pickable ? (
                <button
                  className="cell cell--pick"
                  onClick={() => pickMySlot(n)}
                  aria-label={`Pick ${label}`}
                  data-slot={`${you}-${n}`}
                >
                  <StickFigure stage={sl.stage} eliminated={false} label={label} />
                  {sl.shielded && <span className="shield-badge">🛡️</span>}
                </button>
              ) : (
                <div className="cell" data-slot={`${you}-${n}`}>
                  <StickFigure
                    stage={sl.stage}
                    eliminated={sl.status === "eliminated"}
                    label={label}
                  />
                  {sl.shielded && <span className="shield-badge">🛡️</span>}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="controls">
        <BookPage
          page={book.page}
          caption={book.caption}
          flipKey={book.flipKey}
          flipMs={book.flipMs}
        />
        <div className="turn">
          {revealing ? (
            <div className="revealing">
              <p className="turn__label" data-testid="revealing">
                Round {display.round} reveal...
              </p>
              <button className="btn btn--small" onClick={s.skipReveal} data-testid="skip">
                Skip
              </button>
            </div>
          ) : game.phase !== "playing" ? (
            <GameOver />
          ) : game.players[you]!.out ? (
            <p className="turn__label">You're out. Watch the rest play it out!</p>
          ) : armedSlot !== null ? (
            <div className="aim" data-testid="aim">
              <p className="turn__label">
                Slot {armedSlot} is armed! Tap {wantTargets === 2 ? "two players" : "who to shoot"}{" "}
                above.
              </p>
              {wantTargets === 2 && <p className="hint">{aimed.length}/2 picked</p>}
            </div>
          ) : picking ? (
            <div>
              <p className="turn__label">
                {CARD_INFO[picking.card].icon}{" "}
                {picking.card === "shield"
                  ? "Tap one of your slots to shield."
                  : picking.card === "swap"
                    ? picking.first
                      ? `Swap slot ${picking.first} with...?`
                      : "Tap the first of your slots to swap."
                    : picking.card === "eraser"
                      ? "Tap an opponent's figure to erase a part."
                      : "Tap an opponent's armed figure to steal from."}
              </p>
              <button className="btn btn--quiet" onClick={() => setPicking(null)}>
                Cancel
              </button>
            </div>
          ) : myGo && !myGo.done ? (
            <>
              <p className="turn__label" data-testid="turn-label">
                Your go
              </p>
              <button
                className="btn btn--primary btn--big"
                onClick={s.openBook}
                disabled={!canOpen}
                data-testid="open-book"
              >
                Open the book
              </button>
            </>
          ) : (
            <p className="turn__label" data-testid="turn-label">
              Done. Waiting for the others...
            </p>
          )}
          {s.lastAuto.includes(you) && game.phase === "playing" && (
            <p className="hint">Time ran out, so your go was played for you.</p>
          )}

          {game.phase === "playing" && !game.players[you]!.out && !revealing && (
            <Hand
              hand={myHand}
              queued={myGo?.card ?? null}
              canPlay={!!myGo && myGo.pages.length === 0 && !myGo.done}
              doubleOk={activeOpps.length >= 2}
              names={names}
              you={you}
              onPlay={startCard}
              onCancel={() => s.playCard(null)}
            />
          )}
        </div>
      </section>

      <EmoteBar />
      {game.phase === "playing" && !game.players[you]!.out && (
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

/** The latest BookOpened in the displayed log, with its position (for replaying the flip). */
function lastOpened(
  view: GameView,
): { event: Extract<GameEvent, { type: "BookOpened" }>; index: number } | null {
  for (let i = view.log.length - 1; i >= 0; i--) {
    const e = view.log[i]!;
    if (e.type === "RoundStarted") return null;
    if (e.type === "BookOpened") return { event: e, index: i };
  }
  return null;
}

/** Your page in the most recent resolved round (shown until you open the book again). */
function lastPageOf(game: GameView, you: PlayerIndex): number | null {
  for (let i = game.log.length - 1; i >= 0; i--) {
    const e = game.log[i]!;
    if (e.type === "BookOpened" && e.player === you) return e.page;
  }
  return null;
}

function Hearts({ left, total }: { left: number; total: number }) {
  return (
    <span className="hearts" aria-label={`${left} of ${total} lives left`}>
      {"♥".repeat(left)}
      <span className="hearts__lost">{"♥".repeat(total - left)}</span>
    </span>
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

interface OpponentProps {
  player: PlayerView;
  index: PlayerIndex;
  /** Their go is being revealed right now. */
  active: boolean;
  rolled: number | null;
  lives: number;
  done: boolean;
  left: boolean;
  connected: boolean;
  bubble: EmoteBubble | undefined;
  aimSlot: SlotNumber | null;
  aimed: boolean;
  onAim: (() => void) | undefined;
  hits: Set<string>;
  slotPickable: (n: SlotNumber) => boolean;
  onPickSlot: (n: SlotNumber) => void;
}

function OpponentCard(p: OpponentProps) {
  const { player } = p;
  const status = p.left
    ? "left"
    : player.out
      ? "OUT"
      : !p.connected
        ? "offline"
        : p.done
          ? "ready ✓"
          : "thinking...";
  const target = p.aimSlot !== null ? slotOf(player, p.aimSlot) : null;
  const body = (
    <>
      <div className="opp__head">
        <span className="opp__name">
          {player.name}
          {p.bubble && <Bubble bubble={p.bubble} />}
        </span>
        <span className={`opp__status${p.done ? " is-ready" : ""}`}>{status}</span>
      </div>
      <div className="opp__meta">
        <Hearts left={p.lives} total={p.lives + lostCount(player as never)} />
        {player.handSize > 0 && (
          <span className="opp__cards" aria-label={`${player.handSize} cards`}>
            🂠×{player.handSize}
          </span>
        )}
      </div>
      <div className="opp__slots">
        {SLOT_NUMBERS.map((n) => {
          const sl = slotOf(player, n);
          const pickable = p.slotPickable(n);
          const label = `${player.name}'s slot ${n}: ${sl.status === "eliminated" ? "eliminated" : STAGE_NAMES[sl.stage]}${sl.shielded ? ", shielded" : ""}`;
          const figure = (
            <>
              <span className="mini__num">{n}</span>
              <StickFigure
                stage={sl.stage}
                eliminated={sl.status === "eliminated"}
                mirrored
                label={label}
              />
              {sl.shielded && <span className="shield-badge shield-badge--mini">🛡️</span>}
            </>
          );
          const cls = `mini${p.aimSlot === n ? " mini--aim" : ""}${p.rolled === n ? " mini--rolled" : ""}${p.hits.has(`${p.index}:${n}`) ? " mini--hit" : ""}`;
          return pickable ? (
            <button
              key={n}
              className={`${cls} mini--pick`}
              onClick={() => p.onPickSlot(n)}
              aria-label={`Pick ${label}`}
              data-slot={`${p.index}-${n}`}
            >
              {figure}
            </button>
          ) : (
            <div key={n} className={cls} data-slot={`${p.index}-${n}`}>
              {figure}
            </div>
          );
        })}
      </div>
      {target && p.onAim && (
        <span className="opp__aimhint">
          slot {p.aimSlot}:{" "}
          {target.status === "eliminated"
            ? "dead"
            : target.shielded
              ? "shielded"
              : STAGE_NAMES[target.stage]}
        </span>
      )}
    </>
  );
  const cls = `opp${player.out ? " opp--out" : ""}${p.active ? " opp--active" : ""}${p.onAim ? " opp--aimable" : ""}${p.aimed ? " opp--aimed" : ""}`;
  return p.onAim ? (
    <button
      className={cls}
      onClick={p.onAim}
      data-testid={`opp-${p.index}`}
      aria-label={`Shoot ${player.name}`}
    >
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={`opp-${p.index}`}>
      {body}
    </div>
  );
}

interface HandProps {
  hand: Card[];
  queued: CardPlay | null;
  canPlay: boolean;
  doubleOk: boolean;
  names: string[];
  you: PlayerIndex;
  onPlay: (card: Card) => void;
  onCancel: () => void;
}

function Hand({ hand, queued, canPlay, doubleOk, names, you, onPlay, onCancel }: HandProps) {
  if (hand.length === 0) {
    return <p className="hint">Lucky pages (100, 111, 222, 11, 22...) give cards.</p>;
  }
  return (
    <div className="hand" aria-label="Your cards">
      <p className="hand__title">Your cards {canPlay ? "(play one, then open the book)" : ""}</p>
      {queued && (
        <p className="hand__queued">
          Queued: {CARD_INFO[queued.card].icon} {describePlay(queued, { you, names })}
          {canPlay && (
            <button className="btn btn--small btn--quiet" onClick={onCancel}>
              cancel
            </button>
          )}
        </p>
      )}
      <div className="hand__cards">
        {hand.map((card, i) => {
          const info = CARD_INFO[card];
          const disabled = !canPlay || !!queued || (card === "double_shot" && !doubleOk);
          return (
            <button
              key={i}
              className="playcard"
              onClick={() => onPlay(card)}
              disabled={disabled}
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

function GameOver() {
  const { game, you, room, rematch, leave } = useGame();
  if (!game || you === null || !room) return null;
  const over = [...game.log].reverse().find((e) => e.type === "GameOver");
  const names = game.players.map((p) => p.name);
  const text = over ? describeEvent(over, { you, names }) : null;
  const won = game.winner === you;
  const mine = room.seats[you];
  const others = room.seats.filter((_, i) => i !== you);
  const wanting = others.filter((s) => s.wantsRematch).length;
  return (
    <div className={`gameover${won ? " gameover--won" : ""}`} role="status" data-testid="game-over">
      <p className="gameover__title">
        {game.winner === null ? "Draw" : won ? "You win!" : "Game over"}
      </p>
      {text && <p>{text}</p>}
      <div className="actions">
        <button
          className="btn btn--primary"
          onClick={rematch}
          disabled={mine?.wantsRematch || room.seats.length < 2}
          data-testid="rematch"
        >
          {mine?.wantsRematch ? "Waiting for the others..." : "Rematch"}
        </button>
        <button className="btn btn--quiet" onClick={leave}>
          Leave
        </button>
      </div>
      {wanting > 0 && !mine?.wantsRematch && (
        <p className="hint">
          {wanting} of {others.length} want a rematch.
        </p>
      )}
    </div>
  );
}

import {
  isStar,
  startSquare,
  type FigureRef,
  type GameView,
  type PlayerIndex,
} from "@paper-duel/engine";
import { STAGE_NAMES, figName } from "../text.js";

/** Ink colours per seat; readable on paper in light and dark mode. */
export const PLAYER_COLORS = ["#2f6fd6", "#d0402f", "#2c9a5a", "#9b4fc9", "#e07b12", "#139c9c"];
export const colorOf = (p: PlayerIndex) => PLAYER_COLORS[p % PLAYER_COLORS.length]!;

const VIEW = 400;
const C = VIEW / 2;
const R = 168;
const HOME_R = 104;

export interface Highlights {
  /** Squares to mark (e.g. where a walk would land). */
  squares?: ReadonlySet<number>;
  /** Figures to mark as targets, by "player-figure". */
  targets?: ReadonlySet<string>;
  /** Your figure being considered, by "player-figure". */
  selected?: ReadonlySet<string>;
}

interface Props {
  game: GameView;
  you: PlayerIndex;
  highlights?: Highlights;
  /** Clicking a highlighted target. */
  onPickTarget?: ((ref: FigureRef) => void) | undefined;
}

const polar = (r: number, angle: number) => ({
  x: C + r * Math.cos(angle),
  y: C + r * Math.sin(angle),
});

/**
 * The shared loop track. Squares run clockwise from the top; each player's start square is
 * in their colour, and stars (every 5th square) are safe. Homes sit inside the ring next to
 * their start square. Figures are positioned with CSS transforms so moves animate.
 */
export function Track({ game, you, highlights = {}, onPickTarget }: Props) {
  const L = game.trackLength;
  const angleOf = (sq: number) => -Math.PI / 2 + (2 * Math.PI * sq) / L;
  const size = Math.min(26, ((2 * Math.PI * R) / L) * 0.82);
  const fig = Math.max(18, Math.min(30, size * 1.5));
  const n = game.players.length;
  const homeW = n > 4 ? 70 : 92;

  // Where every figure is drawn: on its square, or in its home.
  const spots: { p: number; f: number; x: number; y: number; scale: number }[] = [];
  const stacks = new Map<number, number>();
  game.players.forEach((pl, p) => {
    const home = polar(HOME_R, angleOf(startSquare(p)));
    let homeK = 0;
    pl.figures.forEach((f, i) => {
      if (f.pos !== null && !f.dead) {
        const k = stacks.get(f.pos) ?? 0;
        stacks.set(f.pos, k + 1);
        const a = angleOf(f.pos);
        // Stack figures sharing a square outward from the ring.
        const at = polar(R + k * fig * 0.55, a);
        spots.push({ p, f: i, x: at.x, y: at.y - fig * 0.15, scale: fig / 30 });
      } else {
        const slots = pl.figures.length;
        const step = Math.min(18, (homeW - 14) / Math.max(1, slots - 1));
        const x = home.x - ((slots - 1) * step) / 2 + homeK * step;
        homeK++;
        spots.push({ p, f: i, x, y: home.y + 4, scale: 0.62 });
      }
    });
  });

  const current = game.phase === "playing" ? game.turn.player : null;

  return (
    <svg
      className="track"
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="img"
      aria-label={`Track of ${L} squares`}
      data-testid="track"
    >
      <circle cx={C} cy={C} r={R} className="track__ring" />
      {Array.from({ length: L }, (_, sq) => {
        const a = angleOf(sq);
        const at = polar(R, a);
        const owner = sq % 10 === 0 ? sq / 10 : null;
        const star = isStar(sq);
        const marked = highlights.squares?.has(sq);
        return (
          <g key={sq} transform={`translate(${at.x} ${at.y}) rotate(${(a * 180) / Math.PI + 90})`}>
            <rect
              x={-size / 2}
              y={-size / 2}
              width={size}
              height={size}
              rx={size * 0.18}
              className={`sq${star ? " sq--star" : ""}${marked ? " sq--marked" : ""}`}
              style={
                owner !== null
                  ? { fill: colorOf(owner), fillOpacity: 0.22, stroke: colorOf(owner) }
                  : undefined
              }
            >
              <title>{`Square ${sq + 1}${star ? " ★ safe" : ""}${owner !== null ? ` (${game.players[owner]?.name}'s start)` : ""}`}</title>
            </rect>
            {star && (
              <text className="sq__star" y={size * 0.28} fontSize={size * 0.7}>
                ★
              </text>
            )}
          </g>
        );
      })}

      {game.players.map((pl, p) => {
        const a = angleOf(startSquare(p));
        const home = polar(HOME_R, a);
        return (
          <g
            key={p}
            className={`home${pl.out ? " home--out" : ""}${current === p ? " home--turn" : ""}`}
          >
            <rect
              x={home.x - homeW / 2}
              y={home.y - 22}
              width={homeW}
              height={44}
              rx={8}
              className="home__box"
              style={{ stroke: colorOf(p) }}
            />
            <text x={home.x} y={home.y - 26} className="home__name" style={{ fill: colorOf(p) }}>
              {pl.name.length > 9 ? `${pl.name.slice(0, 8)}…` : pl.name}
              {p === you ? " (you)" : ""}
            </text>
          </g>
        );
      })}

      {spots.map(({ p, f, x, y, scale }) => {
        const figure = game.players[p]!.figures[f]!;
        const key = `${p}-${f}`;
        const target = highlights.targets?.has(key);
        const selected = highlights.selected?.has(key);
        const label = `${game.players[p]!.name}'s ${figName(f)}: ${figure.dead ? "dead" : STAGE_NAMES[figure.stage]}${figure.pos === null ? " at home" : ` on square ${figure.pos + 1}`}${figure.shielded ? ", shielded" : ""}`;
        const clickable = target && onPickTarget;
        return (
          <g
            key={key}
            className={`tfig${figure.dead ? " tfig--dead" : ""}${target ? " tfig--target" : ""}${selected ? " tfig--selected" : ""}${p === you ? " tfig--mine" : ""}${clickable ? " tfig--click" : ""}`}
            style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
            data-fig={key}
            role={clickable ? "button" : "img"}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? `Target ${label}` : label}
            onClick={clickable ? () => onPickTarget({ player: p, figure: f }) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPickTarget({ player: p, figure: f });
                    }
                  }
                : undefined
            }
          >
            <MiniFigure
              stage={figure.stage}
              dead={figure.dead}
              color={colorOf(p)}
              shielded={figure.shielded}
              letter={figName(f)}
            />
          </g>
        );
      })}

      <text x={C} y={C - 6} className="track__center">
        {game.phase === "playing" ? `Round ${game.round}` : "Game over"}
      </text>
      {game.rules.maxRounds !== null && game.phase === "playing" && (
        <text x={C} y={C + 14} className="track__center track__center--small">
          of {game.rules.maxRounds}
        </text>
      )}
    </svg>
  );
}

/**
 * A small stick figure centred on (0, 0), about 30 units tall, drawn part by part like the
 * paper version: head, body, face, gun, bullets.
 */
export function MiniFigure({
  stage,
  dead,
  color,
  shielded,
  letter,
}: {
  stage: number;
  dead: boolean;
  color: string;
  shielded: boolean;
  letter?: string;
}) {
  return (
    <g className="mfig" stroke={color} filter="url(#sketch)">
      <circle r={18} className="tfig__hit" />
      {shielded && <circle r={17} className="mfig__shield" />}
      {stage === 0 && <circle cx={0} cy={-8} r={5} className="mfig__ghost" />}
      {stage >= 1 && <circle cx={0} cy={-8} r={5} className="mfig__line" />}
      {stage >= 2 && <path d="M0 -3 V7 M0 7 L-5 15 M0 7 L5 15 M0 0 L-6 5" className="mfig__line" />}
      {stage >= 3 && (
        <g fill={color} stroke="none">
          <circle cx={-1.8} cy={-9} r={0.9} />
          <circle cx={1.8} cy={-9} r={0.9} />
        </g>
      )}
      {stage >= 2 && stage < 4 && <path d="M0 0 L6 5" className="mfig__line" />}
      {stage >= 4 && <path d="M0 0 L8 -1 M7 -3 H15 V0 H9 L8 3" className="mfig__line" />}
      {stage >= 5 && <circle cx={18} cy={-1.5} r={1.6} fill={color} stroke="none" />}
      {letter && (
        <text y={25} className="mfig__letter" fill={color} stroke="none">
          {letter}
        </text>
      )}
      {dead && <path d="M-9 -14 L9 14 M9 -14 L-9 14" className="mfig__x" />}
    </g>
  );
}

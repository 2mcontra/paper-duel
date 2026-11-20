import { computeAwards, figuresLeft } from "@paper-duel/engine";
import { useGame } from "../store/game.js";
import { AWARD_INFO, placeName } from "../text.js";
import { MiniFigure, colorOf } from "./Track.js";

/** Pedestal heights for 1st, 2nd and 3rd place. */
const STEP = { 1: 96, 2: 66, 3: 44 } as Record<number, number>;

/**
 * End of game: a podium for the top three, everyone's place, fun awards from the game's
 * stats, and the series score for everyone who has played in this room.
 */
export function Podium() {
  const { game, you, room, rematch, leave } = useGame();
  if (!game || you === null || !room) return null;
  const players = game.players.map((p, i) => ({ ...p, i, place: p.place ?? game.players.length }));
  const byPlace = [...players].sort((a, b) => a.place - b.place);
  const top = byPlace.filter((p) => p.place <= 3);
  // Classic podium order: 2nd, 1st, 3rd (ties stand side by side).
  const podium = [
    ...top.filter((p) => p.place === 2),
    ...top.filter((p) => p.place === 1),
    ...top.filter((p) => p.place === 3),
  ];
  const awards = computeAwards(game.players);
  const me = players[you]!;
  const won = game.winner === you;
  const mine = room.seats[you];
  const others = room.seats.filter((_, i) => i !== you);
  const wanting = others.filter((s) => s.wantsRematch).length;
  const series = room.seats
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !s.left)
    .sort((a, b) => b.points - a.points || b.wins - a.wins);
  const games = room.seats.reduce((n, s) => n + s.wins, 0);

  return (
    <div className={`gameover${won ? " gameover--won" : ""}`} role="status" data-testid="game-over">
      <p className="gameover__title">
        {won
          ? "You win!"
          : game.winner === null && me.place === 1
            ? "Draw!"
            : `You came ${placeName(me.place)}`}
      </p>
      {game.endReason === "time_up" && (
        <p className="hint">Round limit reached: most figures left wins.</p>
      )}

      <div className="podium" aria-label="Podium">
        {podium.map((p) => (
          <div key={p.i} className={`podium__spot podium__spot--${p.place}`}>
            <svg viewBox="-22 -26 44 56" className="podium__fig" aria-hidden="true">
              <MiniFigure stage={5} dead={false} color={colorOf(p.i)} shielded={false} />
              {p.place === 1 && (
                <text y={-17} className="podium__crown">
                  👑
                </text>
              )}
            </svg>
            <span className="podium__name" style={{ color: colorOf(p.i) }}>
              {p.name}
              {p.i === you ? " (you)" : ""}
            </span>
            <span
              className="podium__block"
              style={{ height: STEP[p.place], borderColor: colorOf(p.i) }}
            >
              {p.place}
            </span>
          </div>
        ))}
      </div>

      <ol className="standings" aria-label="Final standings">
        {byPlace.map((p) => (
          <li key={p.i} data-testid={`place-${p.i}`}>
            <strong>{placeName(p.place)}</strong>{" "}
            <span style={{ color: colorOf(p.i) }}>{p.name}</span>
            {p.i === you && " (you)"} · {figuresLeft(p)} left · {p.stats.kills} kills ·{" "}
            {p.stats.stomps} stomps
          </li>
        ))}
      </ol>

      {awards.length > 0 && (
        <ul className="awards" aria-label="Awards">
          {awards.map((a) => {
            const info = AWARD_INFO[a.id];
            return (
              <li key={a.id} className="award">
                <span className="award__icon">{info.icon}</span>
                <span className="award__title">{info.title}</span>
                <span className="award__who" style={{ color: colorOf(a.player) }}>
                  {game.players[a.player]!.name}
                </span>
                <span className="award__value">{info.unit(a.value)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <table className="series" aria-label="Series score">
        <caption>
          Series in room {room.code} ({games} game{games === 1 ? "" : "s"} won so far)
        </caption>
        <thead>
          <tr>
            <th>Player</th>
            <th>Points</th>
            <th>Wins</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.i} className={s.i === you ? "series--you" : ""}>
              <td style={{ color: colorOf(s.i) }}>{s.name}</td>
              <td>{s.points}</td>
              <td>{s.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Points per game: 1st 3, 2nd 2, 3rd 1 (last place scores nothing).</p>

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

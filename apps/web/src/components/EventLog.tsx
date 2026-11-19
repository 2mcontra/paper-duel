import type { GameEvent, PlayerIndex } from "@paper-duel/engine";
import { describeEvent } from "../text.js";

interface Props {
  log: GameEvent[];
  you: PlayerIndex;
  names: string[];
}

/** Newest round first; within a round, one line per player's go in resolve order. */
export function EventLog({ log, you, names }: Props) {
  const rounds: { round: number; goes: { player: PlayerIndex | null; lines: string[] }[] }[] = [];
  let current: (typeof rounds)[number] | undefined;
  for (const e of log) {
    if (e.type === "RoundStarted") {
      current = { round: e.round, goes: [] };
      rounds.push(current);
      continue;
    }
    if (!current) {
      current = { round: 0, goes: [] };
      rounds.push(current);
    }
    const line = describeEvent(e, { you, names });
    if (!line) continue;
    const actor = "player" in e ? e.player : "attacker" in e ? e.attacker : null;
    const startsGo = e.type === "BookOpened" || e.type === "CardPlayed" || e.type === "GoLost";
    const last = current.goes.at(-1);
    if (!last || (startsGo && last.player !== actor) || e.type === "GameOver") {
      current.goes.push({ player: actor, lines: [line] });
    } else {
      last.lines.push(line);
    }
  }
  const shown = rounds
    .filter((r) => r.goes.length > 0)
    .slice(-25)
    .reverse();
  return (
    <section className="log" aria-label="Game log">
      <h2>Log</h2>
      <ol>
        {shown.map((r) => (
          <li key={r.round} className="log__round">
            <span className="log__round-num">Round {r.round}</span>
            <ul>
              {r.goes.map((g, i) => (
                <li key={i} className={g.player === you ? "log--you" : "log--them"}>
                  {g.lines.join(" ")}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

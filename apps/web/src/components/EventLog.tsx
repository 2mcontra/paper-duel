import type { GameEvent, PlayerIndex } from "@paper-duel/engine";
import { describeEvent } from "../text.js";
import { colorOf } from "./Track.js";

interface Props {
  log: GameEvent[];
  you: PlayerIndex;
  names: string[];
}

/** Newest turn first; one line per turn. */
export function EventLog({ log, you, names }: Props) {
  const turns: { turn: number; player: PlayerIndex | null; round: number; lines: string[] }[] = [];
  let current: (typeof turns)[number] | undefined;
  for (const e of log) {
    if (e.type === "TurnStarted") {
      current = { turn: e.turn, player: e.player, round: e.round, lines: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { turn: 0, player: null, round: 0, lines: [] };
      turns.push(current);
    }
    const line = describeEvent(e, { you, names });
    if (line) current.lines.push(line);
  }
  const shown = turns
    .filter((t) => t.lines.length > 0)
    .slice(-40)
    .reverse();
  return (
    <section className="log" aria-label="Game log">
      <h2>Log</h2>
      <ol>
        {shown.map((t) => (
          <li
            key={t.turn}
            className={t.player === you ? "log--you" : "log--them"}
            style={t.player !== null ? { borderLeftColor: colorOf(t.player) } : undefined}
          >
            <span className="log__round-num">R{t.round}</span> {t.lines.join(" ")}
          </li>
        ))}
      </ol>
    </section>
  );
}

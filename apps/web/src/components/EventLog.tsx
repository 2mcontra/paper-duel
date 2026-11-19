import type { GameEvent, PlayerIndex } from "@paper-duel/engine";
import { describeEvent } from "../text.js";

interface Props {
  log: GameEvent[];
  you: PlayerIndex;
  names: [string, string];
}

/** Newest first. Each BookOpened starts a new turn entry. */
export function EventLog({ log, you, names }: Props) {
  const turns: { key: number; player: PlayerIndex; lines: string[] }[] = [];
  log.forEach((e, i) => {
    if (e.type === "BookOpened") turns.push({ key: i, player: e.player, lines: [] });
    const line = describeEvent(e, { you, names });
    if (!line) return;
    const current = turns.at(-1);
    if (current) current.lines.push(line);
    else turns.push({ key: i, player: you, lines: [line] });
  });
  const recent = turns.slice(-40).reverse();
  return (
    <section className="log" aria-label="Game log">
      <h2>Log</h2>
      <ol>
        {recent.map((t) => (
          <li key={t.key} className={t.player === you ? "log--you" : "log--them"}>
            {t.lines.join(" ")}
          </li>
        ))}
      </ol>
    </section>
  );
}

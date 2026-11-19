import { useState, type ReactNode } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type RulesConfig,
  type RulesOverrides,
} from "@paper-duel/engine";
import { useGame } from "../store/game.js";
import { RULE_LABELS } from "../text.js";

export function Lobby() {
  const { room, you, setReady, start, leave, configure } = useGame();
  if (!room || you === null) return null;
  const me = room.seats[you];
  const isHost = you === 0;
  const enough = room.seats.length >= MIN_PLAYERS;
  const allReady = enough && room.seats.every((s) => s.ready && s.connected);
  const empty = room.maxPlayers - room.seats.length;

  return (
    <main className="page lobby">
      <h1 className="title">Lobby</h1>
      <RoomCode code={room.code} isPublic={room.isPublic} />

      <ul className="seats" aria-label="Players">
        {room.seats.map((s, i) => (
          <li key={i} className="seat">
            <span className="seat__name">
              {s.name}
              {i === you && " (you)"}
              {i === 0 && <span className="badge">host</span>}
            </span>
            <span className={`seat__status${s.ready ? " is-ready" : ""}`}>
              {!s.connected ? "reconnecting..." : s.ready ? "Ready ✓" : "Not ready"}
            </span>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} className="seat seat--empty">
            <span>Open seat</span>
          </li>
        ))}
      </ul>

      <div className="actions">
        <button
          className={`btn${me?.ready ? "" : " btn--primary"}`}
          onClick={() => setReady(!me?.ready)}
          data-testid="ready"
        >
          {me?.ready ? "Not ready" : "I'm ready"}
        </button>
        {isHost && (
          <button
            className="btn btn--primary"
            onClick={start}
            disabled={!allReady}
            data-testid="start"
          >
            Start game
          </button>
        )}
        <button className="btn btn--quiet" onClick={leave}>
          Leave
        </button>
      </div>
      <p className="hint">
        {!enough
          ? "Share the code: you need at least 2 players."
          : !allReady
            ? "Waiting for everyone to be ready."
            : isHost
              ? "Everyone's ready. Start when you like."
              : "Everyone's ready. Waiting for the host to start."}
      </p>

      <section className="rules">
        <h2>Setup {isHost ? "" : "(set by the host)"}</h2>
        <dl>
          <div className="rule">
            <dt>Room size</dt>
            <dd>
              {isHost ? (
                <select
                  value={room.maxPlayers}
                  onChange={(e) => configure({ maxPlayers: Number(e.target.value) })}
                >
                  {Array.from(
                    { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
                    (_, i) => i + MIN_PLAYERS,
                  ).map((n) => (
                    <option key={n} value={n} disabled={n < room.seats.length}>
                      {n} players
                    </option>
                  ))}
                </select>
              ) : (
                `${room.maxPlayers} players`
              )}
            </dd>
          </div>
          <Rules rules={room.rules} editable={isHost} onChange={(rules) => configure({ rules })} />
        </dl>
      </section>
    </main>
  );
}

function RoomCode({ code, isPublic }: { code: string; isPublic: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the code is on screen anyway.
    }
  };
  return (
    <div className="room-code">
      <span className="room-code__label">{isPublic ? "Public room" : "Room code"}</span>
      <span className="room-code__value" data-testid="room-code">
        {code}
      </span>
      <button className="btn btn--small" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Rules({
  rules,
  editable,
  onChange,
}: {
  rules: RulesConfig;
  editable: boolean;
  onChange: (r: RulesOverrides) => void;
}) {
  const keys = Object.keys(RULE_LABELS) as (keyof RulesConfig)[];
  return (
    <>
      {keys.map((key) => {
        const meta = RULE_LABELS[key]!;
        let options: [string, string][];
        let parse: (v: string) => RulesConfig[typeof key];
        if (key === "lives") {
          options = [1, 2, 3, 4, 5].map((n) => [
            String(n),
            n === 2 ? "2 (quick game)" : n === 3 ? "3 (standard)" : String(n),
          ]);
          parse = Number;
        } else if (key === "roundTimerSeconds") {
          options = [10, 15, 20, 30, 60].map((n) => [String(n), `${n} s`]);
          options.push(["null", "Off"]);
          parse = (v) => (v === "null" ? null : Number(v));
        } else if (key === "luckyCards") {
          options = Object.entries(meta.options ?? {});
          parse = (v) => v === "true";
        } else {
          options = Object.entries(meta.options ?? {});
          parse = (v) => v as RulesConfig[typeof key];
        }
        const current = String(rules[key]);
        let control: ReactNode;
        if (editable) {
          control = (
            <select value={current} onChange={(e) => onChange({ [key]: parse(e.target.value) })}>
              {options.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          );
        } else {
          control = options.find(([v]) => v === current)?.[1] ?? current;
        }
        return (
          <div key={key} className="rule">
            <dt>{meta.label}</dt>
            <dd>{control}</dd>
          </div>
        );
      })}
    </>
  );
}

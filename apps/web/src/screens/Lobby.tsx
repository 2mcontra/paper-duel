import { useState, type ReactNode } from "react";
import type { RulesConfig } from "@paper-duel/engine";
import { useGame } from "../store/game.js";
import { RULE_LABELS } from "../text.js";

export function Lobby() {
  const { room, you, setReady, leave } = useGame();
  if (!room || you === null) return null;
  const me = room.seats[you];
  const isHost = you === 0;
  const opponent = room.seats[you === 0 ? 1 : 0];

  return (
    <main className="page lobby">
      <h1 className="title">Lobby</h1>
      <RoomCode code={room.code} isPublic={room.isPublic} />

      <ul className="seats">
        {room.seats.map((s, i) => (
          <li key={i} className={`seat${s ? "" : " seat--empty"}`}>
            {s ? (
              <>
                <span className="seat__name">
                  {s.name}
                  {i === you && " (you)"}
                  {i === 0 && <span className="badge">host</span>}
                </span>
                <span className={`seat__status${s.ready ? " is-ready" : ""}`}>
                  {!s.connected ? "reconnecting..." : s.ready ? "Ready" : "Not ready"}
                </span>
              </>
            ) : (
              <span>Waiting for an opponent...</span>
            )}
          </li>
        ))}
      </ul>

      <div className="actions">
        <button
          className={`btn${me?.ready ? "" : " btn--primary"}`}
          onClick={() => setReady(!me?.ready)}
          disabled={!opponent}
        >
          {me?.ready ? "Not ready" : "I'm ready"}
        </button>
        <button className="btn btn--quiet" onClick={leave}>
          Leave
        </button>
      </div>

      <Rules rules={room.rules} editable={isHost} />
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

function Rules({ rules, editable }: { rules: RulesConfig; editable: boolean }) {
  const setRules = useGame((s) => s.setRules);
  const keys = Object.keys(RULE_LABELS) as (keyof RulesConfig)[];
  return (
    <section className="rules">
      <h2>Rules {editable ? "" : "(set by the host)"}</h2>
      <dl>
        {keys.map((key) => {
          const meta = RULE_LABELS[key]!;
          const value = rules[key];
          let control: ReactNode;
          if (key === "winTarget") {
            control = editable ? (
              <select
                value={rules.winTarget}
                onChange={(e) => setRules({ winTarget: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 3 ? "3 (best of 5)" : n === 5 ? "5 (wipe out)" : n}
                  </option>
                ))}
              </select>
            ) : (
              String(value)
            );
          } else if (key === "turnTimerSeconds") {
            const label = (v: number | null) => (v === null ? "Off" : `${v} s`);
            control = editable ? (
              <select
                value={String(rules.turnTimerSeconds)}
                onChange={(e) =>
                  setRules({
                    turnTimerSeconds: e.target.value === "null" ? null : Number(e.target.value),
                  })
                }
              >
                {[10, 20, 30, 60, null].map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {label(v)}
                  </option>
                ))}
              </select>
            ) : (
              label(rules.turnTimerSeconds)
            );
          } else {
            const options = meta.options ?? {};
            control = editable ? (
              <select
                value={String(value)}
                onChange={(e) => setRules({ [key]: e.target.value } as Partial<RulesConfig>)}
              >
                {Object.entries(options).map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            ) : (
              (options[String(value)] ?? String(value))
            );
          }
          return (
            <div key={key} className="rule">
              <dt>{meta.label}</dt>
              <dd>{control}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

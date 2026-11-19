import { useState, type FormEvent } from "react";
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from "@paper-duel/protocol";
import { useGame } from "../store/game.js";

export function Landing() {
  const { name, setName, createRoom, joinRoom, quickMatch, busy, connection } = useGame();
  const [code, setCode] = useState("");
  const nameOk = name.trim().length > 0;
  const disabled = !nameOk || busy || connection !== "open";

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && code.length === ROOM_CODE_LENGTH) joinRoom(code);
  };

  return (
    <main className="page landing">
      <h1 className="title">Paper Duel</h1>
      <p className="tagline">Open the book. Odd page, draw. Armed? Pick who to shoot.</p>

      <label className="field">
        <span>Your name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          placeholder="Who's duelling?"
          autoComplete="nickname"
          autoFocus
        />
      </label>

      <div className="actions">
        <button className="btn btn--primary" disabled={disabled} onClick={() => createRoom()}>
          Create room
        </button>
        <button className="btn" disabled={disabled} onClick={quickMatch}>
          Quick match
        </button>
      </div>

      <form className="join" onSubmit={onJoin}>
        <label className="field">
          <span>Have a code?</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABCDE"
            className="code-input"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <button className="btn" disabled={disabled || code.length !== ROOM_CODE_LENGTH}>
          Join
        </button>
      </form>

      <details className="howto">
        <summary>How to play</summary>
        <ol>
          <li>2 to 6 players. Everyone has 5 slots: 1, 3, 5, 7 and 9.</li>
          <li>
            Every round, everyone opens the book at the same time. The last digit of your page picks
            your slot. Even digits mean no game.
          </li>
          <li>
            Each time a slot is picked you draw one more part: head, body, face, gun, bullets.
          </li>
          <li>
            Pick an armed slot and you choose who to shoot. You hit their figure with the same
            number if it has a gun.
          </li>
          <li>Lose 3 slots and you're out. The last player standing wins.</li>
          <li>
            Lucky pages (11, 22, 100, 111...) give cards: 🛡️ Shield, 💥 Double shot, 🧽 Eraser, 🔄
            Swap and 🫳 Steal.
          </li>
        </ol>
      </details>
    </main>
  );
}

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
      <p className="tagline">Open the book. Odd page, draw. Armed? Fire.</p>

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
          <li>Each player has 5 slots: 1, 3, 5, 7 and 9.</li>
          <li>
            On your turn, open the book. The last digit of the page picks your slot. Even digits
            mean no game.
          </li>
          <li>
            Each time a slot is picked you draw one more part: head, body, face, gun, bullets.
          </li>
          <li>Pick an armed slot and it fires at the same slot on your opponent's side.</li>
          <li>If their figure there has a gun, it is eliminated for good.</li>
          <li>First to win 3 slot fights wins the duel.</li>
        </ol>
      </details>
    </main>
  );
}

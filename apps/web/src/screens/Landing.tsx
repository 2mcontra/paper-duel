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
          <li>
            2 to 6 players around one loop track. Everyone has 3 stick figures at home, each with a
            head and body already drawn.
          </li>
          <li>
            On your turn, open the book. The last digit of the page is your roll (0 counts as 10).
          </li>
          <li>
            Then do one thing: ✏️ draw the next part on a figure (face, gun, bullets), 🚶 walk a
            figure with a face exactly that many squares, or 🔫 shoot with a loaded figure at anyone
            up to that many squares away. Shooting uses up the bullets.
          </li>
          <li>
            Land exactly on an enemy to 🦶 stomp it back home (it drops its gun). ★ squares are
            safe: nobody there can be shot or stomped, and nobody can shoot from one.
          </li>
          <li>
            Figures at home can be shot from near their start square, so don't hide forever. Lose
            all your figures and you're out. Last one standing wins, and everyone gets a place on
            the podium.
          </li>
          <li>
            Lucky pages (11, 22, 100, 111...) give cards: 🛡️ Shield, 💥 Double shot, 🧽 Eraser, 🔄
            Swap, 🫳 Steal and 🎲 Reroll.
          </li>
        </ol>
      </details>
    </main>
  );
}

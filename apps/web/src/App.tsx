import { useEffect } from "react";
import { Board } from "./screens/Board.js";
import { Landing } from "./screens/Landing.js";
import { Lobby } from "./screens/Lobby.js";
import { SketchFilter } from "./components/StickFigure.js";
import { connectGame, useGame } from "./store/game.js";

export function App() {
  useEffect(() => connectGame(), []);
  return (
    <>
      <SketchFilter />
      <ConnectionBanner />
      <MuteButton />
      <Screen />
      <Toasts />
    </>
  );
}

function Screen() {
  const room = useGame((s) => s.room);
  const game = useGame((s) => s.game);
  if (!room) return <Landing />;
  if (room.phase === "lobby" || !game) return <Lobby />;
  return <Board />;
}

function MuteButton() {
  const muted = useGame((s) => s.muted);
  const toggle = useGame((s) => s.toggleMute);
  return (
    <button
      className="mute"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? "Sound off" : "Sound on"}
      title={muted ? "Sound off" : "Sound on"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

function ConnectionBanner() {
  const connection = useGame((s) => s.connection);
  if (connection === "open") return null;
  return (
    <div className="conn-banner" role="status">
      {connection === "connecting" ? "Connecting..." : "Connection lost. Reconnecting..."}
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}

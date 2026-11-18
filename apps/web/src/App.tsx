import { SLOT_NUMBERS } from "@paper-duel/engine";

// Placeholder screen. Landing, lobby and board arrive in M3.
export function App() {
  return (
    <main>
      <h1>Paper Duel</h1>
      <p>Slots: {SLOT_NUMBERS.join(", ")}</p>
    </main>
  );
}

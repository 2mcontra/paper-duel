import { useEffect, useState } from "react";

interface Props {
  deadline: number | null;
  /** Server clock minus local clock. */
  offset: number;
}

/**
 * Seconds left until a server-clock deadline. Callers pass key={deadline}, so a new
 * deadline remounts this and the clock is read fresh instead of using a stale tick.
 */
export function Countdown({ deadline, offset }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  const left = Math.max(0, Math.ceil((deadline - (now + offset)) / 1000));
  return (
    <span className={`countdown${left <= 5 ? " countdown--low" : ""}`} aria-live="off">
      {left}s
    </span>
  );
}

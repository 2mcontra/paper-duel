import type { Roll } from "@paper-duel/engine";

/** The page the book landed on, with the deciding last digit picked out. M4 adds the flip. */
export function BookPage({ roll, youRolled }: { roll: Roll | null; youRolled: boolean }) {
  if (!roll) {
    return (
      <div className="book book--closed" aria-label="The book is closed">
        <span className="book__hint">The book is closed</span>
      </div>
    );
  }
  const text = String(roll.page);
  const odd = roll.digit % 2 === 1;
  return (
    <div className="book" aria-live="polite" data-testid="book">
      <span className="book__who">{youRolled ? "Your page" : "Their page"}</span>
      <span className="book__page" aria-label={`Page ${roll.page}`}>
        {text.slice(0, -1)}
        <mark className={odd ? "digit--odd" : "digit--even"}>{text.slice(-1)}</mark>
      </span>
      <span className="book__banner">
        {odd ? `Digit ${roll.digit} → slot ${roll.digit}` : `Digit ${roll.digit} → even, no game`}
      </span>
    </div>
  );
}

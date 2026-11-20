interface Props {
  page: number | null;
  /** The roll the page gives (last digit, 0 = 10). */
  roll?: number | null;
  caption: string;
  /** Changing this replays the flip. Keep it stable to show the page without a flip. */
  flipKey?: string | number | undefined;
  /** Total flip time before the page lands. */
  flipMs?: number;
}

/** Decorative page numbers for the leaves flipping past, derived from the real page. */
function passingPages(page: number): number[] {
  return [0, 1, 2, 3].map((i) => ((page * 37 + i * 71) % 299) + 1);
}

/**
 * The virtual book. A few leaves flip past (fast, then slowing down) before the real page
 * lands with its last digit picked out. The page number is decided by the server before any
 * of this starts; the flip is only the reveal.
 */
export function BookPage({ page, roll, caption, flipKey, flipMs = 800 }: Props) {
  if (page === null) {
    return (
      <div className="book book--closed" aria-label="The book is closed" data-testid="book">
        <span className="book__hint">{caption}</span>
      </div>
    );
  }
  const text = String(page);
  const digit = page % 10;
  const value = roll ?? (digit === 0 ? 10 : digit);
  const big = value >= 7;
  // Leaves start at growing intervals so the flipping visibly slows towards the end.
  const starts = [0, 0.18, 0.4, 0.66].map((f) => Math.round(f * flipMs));
  const leafMs = Math.round(flipMs * 0.34);
  return (
    <div
      key={flipKey}
      className={`book${flipKey !== undefined ? " book--flipping" : ""}`}
      aria-live="polite"
      data-testid="book"
      style={{ ["--leaf-ms" as string]: `${leafMs}ms`, ["--land-ms" as string]: `${flipMs}ms` }}
    >
      {flipKey !== undefined && (
        <div className="book__leaves" aria-hidden="true">
          {passingPages(page).map((n, i) => (
            <span key={i} className="leaf" style={{ animationDelay: `${starts[i]}ms` }}>
              {n}
            </span>
          ))}
        </div>
      )}
      <div className="book__content">
        <span className="book__who">{caption}</span>
        <span className="book__page" aria-label={`Page ${page}`}>
          {text.slice(0, -1)}
          <mark className={big ? "digit--odd" : "digit--even"}>{text.slice(-1)}</mark>
        </span>
        <span className="book__banner">
          {digit === 0 ? `Last digit 0: roll 10!` : `Last digit ${digit}: roll ${value}`}
        </span>
      </div>
    </div>
  );
}

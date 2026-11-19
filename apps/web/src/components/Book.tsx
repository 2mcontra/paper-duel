/** The page the book landed on, with the deciding last digit picked out. M4 adds the flip. */
export function BookPage({ page, caption }: { page: number | null; caption: string }) {
  if (page === null) {
    return (
      <div className="book book--closed" aria-label="The book is closed">
        <span className="book__hint">The book is closed</span>
      </div>
    );
  }
  const text = String(page);
  const digit = page % 10;
  const odd = digit % 2 === 1;
  return (
    <div className="book" aria-live="polite" data-testid="book">
      <span className="book__who">{caption}</span>
      <span className="book__page" aria-label={`Page ${page}`}>
        {text.slice(0, -1)}
        <mark className={odd ? "digit--odd" : "digit--even"}>{text.slice(-1)}</mark>
      </span>
      <span className="book__banner">
        {odd ? `Last digit ${digit}: slot ${digit}` : `Last digit ${digit}: even, no game`}
      </span>
    </div>
  );
}

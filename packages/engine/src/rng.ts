/**
 * Small seeded PRNG (mulberry32) for simulations, bots and tests.
 * NOT for real games: the server must use crypto.randomInt for book pages.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniform page in 1..totalPages from a [0, 1) random source. */
export function randomPage(totalPages: number, random: () => number): number {
  return 1 + Math.floor(random() * totalPages);
}

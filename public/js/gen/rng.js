// Seeded random numbers: same seed -> same puzzles, on any machine.
// xmur3 string hash + mulberry32 generator (both public domain, integer-only maths).

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function makeRng(seed) {
  let a = xmur3(String(seed));
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    float: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * next()), // inclusive
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(weights) {
      const entries = Object.entries(weights).filter(([, w]) => w > 0);
      let r = next() * entries.reduce((s, [, w]) => s + w, 0);
      for (const [k, w] of entries) if ((r -= w) < 0) return k;
      return entries.at(-1)[0];
    },
  };
  return rng;
}

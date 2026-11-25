export const START = 1000;
const K_MAX = 64;
const K_MIN = 24;
const K_HALF = 4; // games for K to fall to half of K_MAX
const CLOSEST = 3;

export const kFor = (games) => Math.max(K_MIN, K_MAX / (1 + games / K_HALF));
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
export const targetMatches = (n) => 3 * n;

export function computeRatings(items, matches) {
  const r = new Map(items.map((i) => [i.id, { rating: START, games: 0 }]));
  for (const { winner, loser } of matches) {
    const w = r.get(winner), l = r.get(loser);
    if (!w || !l) continue;
    const e = expected(w.rating, l.rating); // both deltas use pre-match ratings
    const dw = kFor(w.games) * (1 - e);
    const dl = kFor(l.games) * e;
    w.rating += dw; l.rating -= dl;
    w.games++; l.games++;
  }
  return r;
}

const same = (p, a, b) => p && ((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export function nextPair(items, ratings, lastPair = null, rng = Math.random) {
  if (items.length < 2) return null;
  const g = (i) => ratings.get(i.id).games;
  const fewest = Math.min(...items.map(g));
  const a = pick(items.filter((i) => g(i) === fewest), rng);
  const ra = ratings.get(a.id).rating;
  let others = items
    .filter((i) => i !== a)
    .sort((x, y) => Math.abs(ratings.get(x.id).rating - ra) - Math.abs(ratings.get(y.id).rating - ra));
  const fresh = others.filter((i) => !same(lastPair, a.id, i.id));
  if (fresh.length) others = fresh;
  const b = pick(others.slice(0, CLOSEST), rng);
  return rng() < 0.5 ? [a.id, b.id] : [b.id, a.id];
}

export function tiers(ratings) {
  const v = [...ratings.values()].map((x) => x.rating);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  const out = new Map();
  for (const [id, { rating }] of ratings) {
    const z = sd > 1e-9 ? (rating - mean) / sd : 0;
    out.set(id, z >= 1 ? 'S' : z >= 0.33 ? 'A' : z >= -0.33 ? 'B' : z >= -1 ? 'C' : 'D');
  }
  return out;
}

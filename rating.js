export const START = 1000;
const PASSES = 100;
const TOL = 1e-6;
const CLOSEST = 3;
const FOCUS_POOL = 5;
const PLACING_GAP = 3; // games below the median that count as "still placing"

export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
export const targetMatches = (n) => 3 * n;

// Bradley-Terry fit over the whole log, so vote order does not matter.
// Prior: one win and one loss against a phantom player of strength 1.
export function computeRatings(items, matches) {
  const n = items.length;
  const idx = new Map(items.map((it, i) => [it.id, i]));
  const games = new Array(n).fill(0), wins = new Array(n).fill(1);
  const pairs = new Map(); // "lo|hi" -> count
  for (const { winner, loser } of matches) {
    const w = idx.get(winner), l = idx.get(loser);
    if (w === undefined || l === undefined) continue;
    wins[w]++; games[w]++; games[l]++;
    const k = w < l ? w + '|' + l : l + '|' + w;
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }
  const opp = Array.from({ length: n }, () => []); // [j, count]
  for (const [k, c] of pairs) {
    const [a, b] = k.split('|').map(Number);
    opp[a].push([b, c]); opp[b].push([a, c]);
  }
  let p = new Array(n).fill(1);
  for (let it = 0; it < PASSES; it++) {
    let delta = 0;
    const q = p.map((pi, i) => {
      let d = 2 / (pi + 1);
      for (const [j, c] of opp[i]) d += c / (pi + p[j]);
      const v = wins[i] / d;
      delta = Math.max(delta, Math.abs(v - pi) / pi);
      return v;
    });
    p = q;
    if (delta < TOL) break;
  }
  const raw = p.map((x) => 400 * Math.log10(x));
  const mean = n ? raw.reduce((s, x) => s + x, 0) / n : 0;
  return new Map(items.map((it, i) => [it.id, { rating: START + raw[i] - mean, games: games[i] }]));
}

const same = (p, a, b) => p && ((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export function nextPair(items, ratings, matches, opts = {}, rng = Math.random) {
  if (items.length < 2) return null;
  const { lastPair = null, focusId = null } = opts;
  const rt = (i) => ratings.get(i.id).rating;
  const g = (i) => ratings.get(i.id).games;

  const inSet = new Set(items.map((i) => i.id));
  const heads = new Map();
  let valid = 0;
  for (const { winner, loser } of matches) {
    if (!inSet.has(winner) || !inSet.has(loser)) continue;
    valid++;
    const k = winner + '|' + loser, k2 = loser + '|' + winner;
    heads.set(k, (heads.get(k) || 0) + 1); heads.set(k2, (heads.get(k2) || 0) + 1);
  }
  const h = (x, y) => heads.get(x.id + '|' + y.id) || 0;

  // k nearest to a (lastPair dropped first), then lowest h, random tie-break
  const opponent = (a, k, byHead) => {
    let others = items.filter((i) => i !== a);
    const fresh = others.filter((i) => !same(lastPair, a.id, i.id));
    if (fresh.length) others = fresh;
    others.sort((x, y) => Math.abs(rt(x) - rt(a)) - Math.abs(rt(y) - rt(a)));
    const near = others.slice(0, k);
    if (!byHead) return pick(near, rng);
    const low = Math.min(...near.map((i) => h(a, i)));
    return pick(near.filter((i) => h(a, i) === low), rng);
  };
  const out = (a, b, mode) => ({ pair: rng() < 0.5 ? [a.id, b.id] : [b.id, a.id], mode });

  const focus = focusId === null ? null : items.find((i) => i.id === focusId);
  if (focus) return out(focus, opponent(focus, FOCUS_POOL, true), 'focus');

  const gs = items.map(g).sort((x, y) => x - y);
  const med = gs.length % 2 ? gs[(gs.length - 1) / 2] : (gs[gs.length / 2 - 1] + gs[gs.length / 2]) / 2;
  const fewest = gs[0];
  if (fewest <= med - PLACING_GAP) {
    const a = pick(items.filter((i) => g(i) === fewest), rng);
    return out(a, opponent(a, CLOSEST, true), 'placing');
  }

  if (valid < targetMatches(items.length)) {
    const a = pick(items.filter((i) => g(i) === fewest), rng);
    return out(a, opponent(a, CLOSEST, false), 'main');
  }

  const sorted = [...items].sort((x, y) => rt(y) - rt(x));
  let cands = [];
  for (let i = 0; i + 1 < sorted.length; i++) cands.push([sorted[i], sorted[i + 1]]);
  const fresh = cands.filter(([x, y]) => !same(lastPair, x.id, y.id));
  if (fresh.length) cands = fresh;
  const key = ([x, y]) => [h(x, y), rt(x) - rt(y)];
  const best = Math.min(...cands.map((c) => key(c)[0]));
  cands = cands.filter((c) => key(c)[0] === best);
  const gap = Math.min(...cands.map((c) => key(c)[1]));
  const [x, y] = pick(cands.filter((c) => key(c)[1] === gap), rng);
  return out(x, y, 'neighbor');
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

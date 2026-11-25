import test from 'node:test';
import assert from 'node:assert/strict';
import { START, expected, kFor, computeRatings, nextPair, tiers, targetMatches } from './rating.js';

const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: 'i' + i }));

test('expected is symmetric', () => {
  assert.ok(Math.abs(expected(1200, 1000) + expected(1000, 1200) - 1) < 1e-12);
  assert.equal(expected(1000, 1000), 0.5);
});

test('winner gains, loser loses, K decays', () => {
  const r = computeRatings(ids(2), [{ winner: 'i0', loser: 'i1' }]);
  assert.ok(r.get('i0').rating > START && r.get('i1').rating < START);
  assert.ok(kFor(0) > kFor(20));
});

test('computeRatings skips unknown ids, keeps unplayed items', () => {
  const r = computeRatings(ids(3), [{ winner: 'i0', loser: 'gone' }, { winner: 'i0', loser: 'i1' }]);
  assert.equal(r.size, 3);
  assert.deepEqual(r.get('i2'), { rating: START, games: 0 });
  assert.equal(r.get('i0').games, 1);
});

test('nextPair', () => {
  const rng = mulberry32(1);
  assert.equal(nextPair(ids(1), computeRatings(ids(1), []), null, rng), null);
  const items = ids(3), r = computeRatings(items, []);
  const [a, b] = nextPair(items, r, null, rng);
  assert.notEqual(a, b);
  for (let k = 0; k < 50; k++) {
    const p = nextPair(items, r, [a, b], rng);
    assert.notDeepEqual([...p].sort(), [a, b].sort());
  }
});

test('tiers', () => {
  const eq = computeRatings(ids(4), []);
  assert.ok([...tiers(eq).values()].every((t) => t === 'B'));
  const m = new Map(ids(10).map((x, i) => [x.id, { rating: i === 0 ? 2000 : 1000, games: 5 }]));
  assert.equal(tiers(m).get('i0'), 'S');
});

// ---- simulation: Elo at 3N matches vs single-elimination bracket ----
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const beats = (sa, sb, rng) => rng() < 1 / (1 + 10 ** ((sb - sa) / 400));

// average ranks (1 = highest value), ties share the mean rank
function ranks(vals) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[b] - vals[a]);
  const out = new Array(vals.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && vals[idx[j + 1]] === vals[idx[i]]) j++;
    for (let k = i; k <= j; k++) out[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = (n + 1) / 2;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - ma); va += (ra[i] - ma) ** 2; vb += (rb[i] - ma) ** 2; }
  return c / Math.sqrt(va * vb);
}
const top = (vals, k) => new Set(vals.map((_, i) => i).sort((a, b) => vals[b] - vals[a]).slice(0, k));
const overlap = (truth, score) => { const t = top(truth, 4); return [...top(score, 4)].filter((i) => t.has(i)).length; };

function elo(truth, matches, rng) {
  const items = truth.map((_, i) => ({ id: i }));
  const log = [];
  let r = computeRatings(items, log), last = null;
  for (let m = 0; m < matches; m++) {
    last = nextPair(items, r, last, rng);
    const [a, b] = last;
    log.push(beats(truth[a], truth[b], rng) ? { winner: a, loser: b } : { winner: b, loser: a });
    r = computeRatings(items, log);
  }
  return truth.map((_, i) => r.get(i).rating);
}

function bracket(truth, rng) {
  let alive = truth.map((_, i) => i);
  for (let i = alive.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [alive[i], alive[j]] = [alive[j], alive[i]]; }
  const score = new Array(truth.length).fill(0); // rounds survived
  while (alive.length > 1) {
    const next = [];
    for (let i = 0; i < alive.length; i += 2) next.push(beats(truth[alive[i]], truth[alive[i + 1]], rng) ? alive[i] : alive[i + 1]);
    for (const w of next) score[w]++;
    alive = next;
  }
  return score;
}

test('Elo at 3N beats single-elimination bracket', () => {
  const N = 32, T = 300, rng = mulberry32(12345);
  const s = { elo: 0, br: 0, e2: 0, e5: 0 }, o = { elo: 0, br: 0 };
  for (let t = 0; t < T; t++) {
    const truth = Array.from({ length: N }, () => 200 * normal(rng));
    const e = elo(truth, targetMatches(N), rng), b = bracket(truth, rng);
    s.elo += spearman(truth, e); s.br += spearman(truth, b);
    o.elo += overlap(truth, e); o.br += overlap(truth, b);
    s.e2 += spearman(truth, elo(truth, 2 * N, rng));
    s.e5 += spearman(truth, elo(truth, 5 * N, rng));
  }
  for (const k in s) s[k] /= T;
  for (const k in o) o[k] /= T;
  console.log(`Spearman elo3N=${s.elo.toFixed(3)} bracket=${s.br.toFixed(3)} elo2N=${s.e2.toFixed(3)} elo5N=${s.e5.toFixed(3)}`);
  console.log(`Top4 overlap elo3N=${o.elo.toFixed(3)} bracket=${o.br.toFixed(3)}`);
  assert.ok(s.elo > s.br);
  assert.ok(o.elo >= o.br);
});

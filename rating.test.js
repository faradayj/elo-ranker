import test from 'node:test';
import assert from 'node:assert/strict';
import { START, expected, computeRatings, nextPair, tiers, targetMatches } from './rating.js';

const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: 'i' + i }));
const W = (winner, loser) => ({ winner, loser });

test('expected is symmetric', () => {
  assert.ok(Math.abs(expected(1200, 1000) + expected(1000, 1200) - 1) < 1e-12);
  assert.equal(expected(1000, 1000), 0.5);
});

test('winner rates above loser', () => {
  const r = computeRatings(ids(2), [W('i0', 'i1')]);
  assert.ok(r.get('i0').rating > START && r.get('i1').rating < START);
});

test('computeRatings skips unknown ids, keeps unplayed items', () => {
  const r = computeRatings(ids(3), [W('i0', 'gone'), W('i0', 'i1')]);
  assert.equal(r.size, 3);
  assert.equal(r.get('i2').games, 0);
  assert.equal(r.get('i0').games, 1);
});

test('empty log gives START for everyone', () => {
  for (const { rating } of computeRatings(ids(4), []).values()) assert.equal(rating, START);
});

test('unplayed items stay at START when others play', () => {
  const r = computeRatings(ids(4), [W('i0', 'i1')]);
  assert.ok(Math.abs(r.get('i2').rating - r.get('i3').rating) < 1e-9);
});

test('unbeaten item is finite and on top', () => {
  const log = [W('i0', 'i1'), W('i0', 'i2'), W('i0', 'i3'), W('i1', 'i2'), W('i2', 'i3'), W('i1', 'i3')];
  const r = computeRatings(ids(4), log);
  const best = r.get('i0').rating;
  assert.ok(Number.isFinite(best));
  for (const k of ['i1', 'i2', 'i3']) assert.ok(best > r.get(k).rating);
});

test('match order does not matter, mean is START', () => {
  const rng = mulberry32(7), items = ids(8), log = [];
  for (let k = 0; k < 60; k++) {
    const a = Math.floor(rng() * 8), b = (a + 1 + Math.floor(rng() * 7)) % 8;
    const [w, l] = rng() < 0.6 ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
    log.push(W('i' + w, 'i' + l));
  }
  const shuffled = [...log];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const r1 = computeRatings(items, log), r2 = computeRatings(items, shuffled);
  let sum = 0;
  for (const it of items) {
    assert.ok(Math.abs(r1.get(it.id).rating - r2.get(it.id).rating) < 1e-6);
    sum += r1.get(it.id).rating;
  }
  assert.ok(Math.abs(sum / 8 - START) < 1e-6);
});

// ---- pairing ----
const mk = (items, games, rating = () => START) =>
  new Map(items.map((it, i) => [it.id, { rating: rating(i), games: games(i) }]));

test('nextPair: fewer than 2 items gives null', () => {
  assert.equal(nextPair(ids(1), computeRatings(ids(1), []), []), null);
});

test('focus mode always includes the focus item', () => {
  const rng = mulberry32(2), items = ids(10), r = computeRatings(items, []);
  for (let k = 0; k < 40; k++) {
    const { pair, mode } = nextPair(items, r, [], { focusId: 'i4' }, rng);
    assert.equal(mode, 'focus');
    assert.ok(pair.includes('i4'));
  }
});

test('placing mode when an item is far behind on games', () => {
  const items = ids(8), r = mk(items, (i) => (i === 3 ? 0 : 5), (i) => START + i);
  const { pair, mode } = nextPair(items, r, [], {}, mulberry32(3));
  assert.equal(mode, 'placing');
  assert.ok(pair.includes('i3'));
});

test('main mode while under target', () => {
  const items = ids(6);
  const { mode } = nextPair(items, computeRatings(items, []), [], {}, mulberry32(4));
  assert.equal(mode, 'main');
});

test('neighbor mode is adjacent by rating', () => {
  const rng = mulberry32(5), items = ids(6);
  const r = mk(items, () => 6, (i) => START + i * 10);
  const log = Array.from({ length: targetMatches(6) }, () => W('i0', 'i1'));
  for (let k = 0; k < 30; k++) {
    const { pair, mode } = nextPair(items, r, log, {}, rng);
    assert.equal(mode, 'neighbor');
    const [x, y] = pair.map((id) => Number(id.slice(1)));
    assert.equal(Math.abs(x - y), 1);
  }
});

test('lastPair is not repeated with 3+ items', () => {
  const rng = mulberry32(6), items = ids(3), r = computeRatings(items, []);
  const full = Array.from({ length: targetMatches(3) }, () => W('i0', 'i1'));
  for (const [opts, log] of [[{}, []], [{ focusId: 'i0' }, []], [{}, full]]) {
    for (let k = 0; k < 50; k++) {
      const p = nextPair(items, r, log, { ...opts, lastPair: ['i0', 'i1'] }, rng).pair;
      assert.notDeepEqual([...p].sort(), ['i0', 'i1']);
    }
  }
});

test('tiers', () => {
  const eq = computeRatings(ids(4), []);
  assert.ok([...tiers(eq).values()].every((t) => t === 'B'));
  const m = new Map(ids(10).map((x, i) => [x.id, { rating: i === 0 ? 2000 : 1000, games: 5 }]));
  assert.equal(tiers(m).get('i0'), 'S');
});

// ---- simulation ----
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

// baseline: old per-vote Elo and old pairing
function oldElo(items, matches) {
  const r = new Map(items.map((i) => [i.id, { rating: 1000, games: 0 }]));
  const K = (g) => Math.max(24, 64 / (1 + g / 4));
  for (const { winner, loser } of matches) {
    const w = r.get(winner), l = r.get(loser);
    const e = expected(w.rating, l.rating);
    const dw = K(w.games) * (1 - e), dl = K(l.games) * e;
    w.rating += dw; l.rating -= dl; w.games++; l.games++;
  }
  return r;
}
function oldPair(items, ratings, lastPair, rng) {
  const same = (p, a, b) => p && ((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const g = (i) => ratings.get(i.id).games;
  const fewest = Math.min(...items.map(g));
  const a = pick(items.filter((i) => g(i) === fewest));
  const ra = ratings.get(a.id).rating;
  let others = items.filter((i) => i !== a)
    .sort((x, y) => Math.abs(ratings.get(x.id).rating - ra) - Math.abs(ratings.get(y.id).rating - ra));
  const fresh = others.filter((i) => !same(lastPair, a.id, i.id));
  if (fresh.length) others = fresh;
  const b = pick(others.slice(0, 3));
  return rng() < 0.5 ? [a.id, b.id] : [b.id, a.id];
}
const vote = (truth, [a, b], rng) => (beats(truth[a], truth[b], rng) ? W(a, b) : W(b, a));
const scores = (truth, r) => truth.map((_, i) => r.get(i).rating);

// old arm: returns its vote log after n votes
function oldLog(truth, n, rng) {
  const items = truth.map((_, i) => ({ id: i })), log = [];
  let last = null;
  for (let m = 0; m < n; m++) {
    last = oldPair(items, oldElo(items, log), last, rng);
    log.push(vote(truth, last, rng));
  }
  return log;
}

// new arm: ratings snapshot after each vote count in `at`
function newArm(truth, at, rng) {
  const items = truth.map((_, i) => ({ id: i })), log = [], snaps = {};
  let r = computeRatings(items, log), last = null;
  for (let m = 1; m <= Math.max(...at); m++) {
    last = nextPair(items, r, log, { lastPair: last }, rng).pair;
    log.push(vote(truth, last, rng));
    r = computeRatings(items, log);
    if (at.includes(m)) snaps[m] = r;
  }
  return snaps;
}

const asMap = (vals) => new Map(vals.map((v, i) => [i, { rating: v, games: 0 }]));
// share of the true top 4 that land in tier S or A
function tierHit(truth, ratings) {
  const t = tiers(ratings);
  return [...top(truth, 4)].filter((i) => t.get(i) === 'S' || t.get(i) === 'A').length / 4;
}

test('new fit + pairing beats old Elo and the bracket at 3N', () => {
  const N = 32, T = 300, rng = mulberry32(12345);
  const marks = [2 * N, 2.5 * N, 3 * N, 4 * N];
  const arms = ['old', 'refit', 'bracket', ...marks.map((m) => 'new' + m / N)];
  const sp = {}, ov = {}, th = {};
  for (const a of arms) sp[a] = ov[a] = th[a] = 0;
  const add = (arm, truth, ratings) => {
    const v = scores(truth, ratings);
    sp[arm] += spearman(truth, v); ov[arm] += overlap(truth, v); th[arm] += tierHit(truth, ratings);
  };
  const t0 = Date.now();
  for (let t = 0; t < T; t++) {
    const truth = Array.from({ length: N }, () => 200 * normal(rng));
    const items = truth.map((_, i) => ({ id: i }));
    const log = oldLog(truth, 3 * N, rng);
    add('old', truth, oldElo(items, log));
    add('refit', truth, computeRatings(items, log));
    add('bracket', truth, asMap(bracket(truth, rng)));
    const snaps = newArm(truth, marks, rng);
    for (const m of marks) add('new' + m / N, truth, snaps[m]);
  }
  const f = (o) => arms.map((a) => `${a}=${(o[a] / T).toFixed(3)}`).join(' ');
  console.log(`N=${N} trials=${T} time=${Date.now() - t0}ms\n` +
    `Spearman     ${f(sp)}\nTop4 overlap ${f(ov)}\nTier S/A hit ${f(th)}`);
  assert.ok(sp.new3 > sp.old);
  assert.ok(sp.new3 > sp.bracket);
  assert.ok(ov.new3 >= ov.bracket);
});

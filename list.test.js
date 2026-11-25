import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImageUrl, parsePlaylistId, parseVideoId, validateList, validateStore } from './list.js';

const ID = 'dQw4w9WgXcQ';

test('parseVideoId accepts url forms', () => {
  for (const u of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?feature=share&v=${ID}&t=5`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?t=3`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `youtube.com/watch?v=${ID}`,
    ID,
  ]) assert.equal(parseVideoId(u), ID, u);
});

test('parseVideoId rejects junk', () => {
  for (const u of [
    '', 'hello', `https://evil.com/watch?v=${ID}`, 'https://www.youtube.com/watch?v=short',
    `https://youtu.be/${ID}x`, 'https://www.youtube.com/', `https://notyoutube.com/embed/${ID}`,
  ]) assert.equal(parseVideoId(u), null, u);
});

test('parsePlaylistId', () => {
  const L = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
  for (const h of ['www.youtube.com', 'youtube.com', 'music.youtube.com']) assert.equal(parsePlaylistId(`https://${h}/playlist?list=${L}`), L, h);
  for (const u of [
    `https://www.youtube.com/watch?v=${ID}&list=${L}`, `https://evil.com/playlist?list=${L}`,
    'https://www.youtube.com/playlist', 'https://www.youtube.com/playlist?list=short', 'garbage', '',
  ]) assert.equal(parsePlaylistId(u), null, u);
});

const good = () => ({
  name: 'x',
  items: [{ id: 'a', videoId: ID, title: 't' }, { id: 'b', videoId: ID, title: 'u', blocked: true }],
  matches: [{ winner: 'a', loser: 'b', t: 1 }],
});

test('validateList happy path + default name', () => {
  assert.deepEqual(validateList(good()), good());
  const g = good(); delete g.name;
  assert.equal(validateList(g).name, 'UNTITLED');
});

test('validateList strips unknown fields', () => {
  const g = good(); g.evil = 1; g.items[0].html = '<b>'; g.matches[0].x = 1;
  assert.deepEqual(validateList(g), good());
});

test('validateList carries id only when a non-empty string', () => {
  assert.equal(validateList({ ...good(), id: 'L1' }).id, 'L1');
  for (const id of ['', 5, null]) assert.equal('id' in validateList({ ...good(), id }), false);
});

test('validateStore drops bad lists, keeps valid open id', () => {
  const s = validateStore({ lists: [{ ...good(), id: 'L1' }, { bad: 1 }, { ...good(), id: 'L2' }], open: 'L2' });
  assert.deepEqual(s.lists.map((l) => l.id), ['L1', 'L2']);
  assert.equal(s.open, 'L2');
  assert.equal(validateStore({ lists: [{ ...good(), id: 'L1' }], open: 'nope' }).open, null);
  assert.equal(validateStore({ lists: [good()], open: undefined }).open, null);
  for (const v of [null, 5, {}, { lists: 'x' }]) assert.deepEqual(validateStore(v), { lists: [], open: null });
});

test('validateList throws', () => {
  let g = good(); g.items[0].videoId = 'bad'; assert.throws(() => validateList(g));
  g = good(); g.items[1].id = 'a'; assert.throws(() => validateList(g));
  g = good(); g.items = {}; assert.throws(() => validateList(g));
  g = good(); g.matches[0].loser = 'a'; assert.throws(() => validateList(g));
});

test('parseImageUrl accepts http(s) only', () => {
  assert.equal(parseImageUrl(' https://a.com/x.png '), 'https://a.com/x.png');
  assert.equal(parseImageUrl('http://a.com/x.jpg'), 'http://a.com/x.jpg');
  for (const u of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///x.png', 'cheddar', '']) assert.equal(parseImageUrl(u), null, u);
});

test('validateList image items', () => {
  const img = { id: 'c', image: 'https://a.com/c.png', title: 'cheddar' };
  const g = good(); g.items.push({ ...img, junk: 1 });
  assert.deepEqual(validateList(g).items[2], img);
  g.items[2] = { ...img, videoId: ID }; assert.throws(() => validateList(g));
  g.items[2] = { id: 'c', title: 't' }; assert.throws(() => validateList(g));
  g.items[2] = { ...img, image: 'javascript:alert(1)' }; assert.throws(() => validateList(g));
});

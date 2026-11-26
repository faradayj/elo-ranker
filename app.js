import { computeRatings, nextPair, targetMatches, tiers } from './rating.js';
import { parseImageUrl, parsePlaylistId, parseVideoId, validateList, validateStore } from './list.js';

const KEY = 'elo-lists';
const OLD_KEY = 'elo-list';
const TIER_COLOR = { S: 'var(--color-highlight)', A: 'var(--metric-1)', B: 'var(--metric-4)', C: 'var(--metric-7)', D: 'var(--metric-9)' };
const $ = (s) => document.querySelector(s);
// Only ever assign textContent/properties here; never HTML (titles are untrusted).
const el = (tag, cls, props) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, props);

let store = load();
let tab = 'match';
let started = false;
let current = [null, null];
let lastPair = null;
let mode = null;
// Page state only, never saved.
let focusId = null;
let focusLeft = 0;
const players = [];
const ready = [false, false];
const pauseAll = () => players.forEach((p, i) => ready[i] && p.pauseVideo());
const sides = [...document.querySelectorAll('.side')];

function load() {
  let s = { lists: [], open: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) s = validateStore(JSON.parse(raw));
    else {
      // one-time migration of the single-list key; the old key is left in place
      const old = validateList(JSON.parse(localStorage.getItem(OLD_KEY)));
      if (old.items.length) { old.id = crypto.randomUUID(); s = { lists: [old], open: old.id }; }
    }
  } catch { /* no usable data */ }
  const seen = new Set();
  for (const l of s.lists) { if (!l.id || seen.has(l.id)) l.id = crypto.randomUUID(); seen.add(l.id); }
  return s;
}
function save() {
  let failed = false;
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { failed = true; }
  $('#save-error').hidden = !failed;
}

const cur = () => store.lists.find((l) => l.id === store.open);
const items = () => cur()?.items ?? [];
const byId = (id) => items().find((i) => i.id === id);
const thumb = (it, big) => it.image ?? `https://i.ytimg.com/vi/${it.videoId}/${big ? 'mqdefault' : 'default'}.jpg`;
// Image items self-heal: a failed load marks the item broken, a later success clears it. Acts only on a state flip.
function flagBroken(img, it) {
  img.addEventListener('error', () => { if (!it.blocked) { it.blocked = true; changed(); } });
  img.addEventListener('load', () => { if (it.blocked) { it.blocked = false; changed(); } });
}
function itemImg(it, big, cls, props) {
  const img = el('img', cls, { src: thumb(it, big), referrerPolicy: 'no-referrer', ...props });
  if (it.image) flagBroken(img, it);
  return img;
}
const eligible = (l = cur()) => (l?.items ?? []).filter((i) => !i.blocked);
function validCount(l = cur()) {
  const ids = new Set(l.items.map((i) => i.id));
  return l.matches.filter((m) => ids.has(m.winner) && ids.has(m.loser)).length;
}
const isDone = (l) => { const eli = eligible(l).length; return eli >= 2 && validCount(l) >= targetMatches(eli); };

// ---------- render ----------
function renderSidebar() {
  $('#lists').replaceChildren(...store.lists.map((l) => {
    const row = el('div', 'sidebar-item' + (l.id === store.open ? ' active' : ''), { tabIndex: 0 });
    row.setAttribute('role', 'button');
    row.append(el('span', 'list-name', { textContent: l.name }), el('span', 'item-badge', { textContent: String(l.items.length) }));
    if (isDone(l)) {
      const ok = el('span', 'list-done', { textContent: '✓' });
      ok.setAttribute('aria-label', 'done'); ok.title = 'done';
      row.append(ok);
    }
    row.addEventListener('click', () => openList(l.id));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(l.id); } });
    return row;
  }));
}

function tableCard(heads, rows, cls = 'table-card') {
  const table = el('table', 'data-table');
  const head = el('tr');
  head.append(...heads.map((h) => el('th', '', { textContent: h })));
  table.append(head, ...rows);
  const card = el('div', cls);
  card.append(table);
  return card;
}

function focusBtn(it) {
  const b = el('button', 'btn-wireframe', { textContent: 'FOCUS' });
  b.setAttribute('aria-label', `focus ${it.title}`);
  b.addEventListener('click', () => startFocus(it.id));
  return b;
}

function renderItems() {
  const r = computeRatings(items(), cur().matches);
  const rows = items().map((it) => {
    const title = el('input', 'item-title', { value: it.title });
    // 'change' (not 'input') so the table is not rebuilt mid-typing.
    title.addEventListener('change', () => { it.title = title.value; save(); updateSideTitles(); });
    const rate = el('td', '', { textContent: it.blocked ? (it.image ? 'BROKEN' : 'NO EMBED') : String(Math.round(r.get(it.id).rating)) });
    if (it.blocked) rate.style.color = 'var(--metric-2)';
    const x = el('button', 'btn-wireframe', { textContent: 'X' });
    x.setAttribute('aria-label', 'remove');
    x.addEventListener('click', () => { cur().items = items().filter((i) => i !== it); changed(); });
    const cells = [el('td'), el('td'), rate, el('td', '', { textContent: String(r.get(it.id).games) }), el('td')];
    cells[0].append(itemImg(it, false, 'thumb', { alt: '', loading: 'lazy' }));
    cells[1].append(title);
    if (!it.blocked) cells[4].append(focusBtn(it), ' ');
    cells[4].append(x);
    const row = el('tr');
    row.append(...cells);
    return row;
  });
  $('#item-rows').replaceChildren(tableCard(['', 'TITLE', 'ELO', 'GAMES', ''], rows));
}

function renderProgress() {
  const n = validCount(), eli = eligible().length, target = targetMatches(eli);
  const done = isDone(cur());
  const p = $('#progress');
  p.textContent = `${n} / ${target}` + (done ? '. DONE, KEEP GOING OR SEE RESULTS' : '');
  p.style.color = p.style.borderColor = done ? 'var(--metric-1)' : '';
}

function updateSideTitles() {
  sides.forEach((s, i) => { s.querySelector('.side-title').textContent = byId(current[i])?.title ?? ''; });
}

function renderMatchState() {
  const ok = eligible().length >= 2;
  $('#empty-msg').hidden = ok;
  const needStart = !started && eligible().some((i) => i.videoId);
  $('#start-btn').hidden = !ok || !needStart;
  $('#match').hidden = !ok || needStart;
}

function renderStatus() {
  const box = $('#match-status');
  box.replaceChildren();
  box.hidden = $('#match').hidden || !current[0] || !['focus', 'placing', 'neighbor'].includes(mode);
  if (box.hidden) return;
  if (mode === 'neighbor') { box.textContent = 'NEIGHBOR CHECK'; return; }
  if (mode === 'placing') {
    const r = computeRatings(items(), cur().matches);
    const id = r.get(current[0]).games <= r.get(current[1]).games ? current[0] : current[1];
    box.textContent = `PLACING: ${byId(id).title}`;
    return;
  }
  const stop = el('button', 'btn-wireframe', { textContent: 'STOP' });
  stop.setAttribute('aria-label', 'stop focus');
  stop.addEventListener('click', stopFocus);
  box.append(`FOCUS: ${byId(focusId)?.title ?? ''} (${5 - focusLeft}/5) `, stop);
}

function renderResults() {
  const view = $('#view-results');
  const its = eligible();
  if (its.length < 2 || !validCount()) { view.replaceChildren(el('p', '', { textContent: 'NO VOTES YET' })); return; }
  const all = computeRatings(items(), cur().matches);
  const ids = new Set(its.map((i) => i.id));
  const r = new Map([...all].filter(([id]) => ids.has(id)));
  const tier = tiers(r);
  const sorted = [...its].sort((a, b) => r.get(b.id).rating - r.get(a.id).rating);

  const list = el('div');
  for (const t of 'SABCD') {
    const label = el('div', 'tier-label', { textContent: t });
    label.style.background = TIER_COLOR[t];
    const strip = el('div', 'tier-strip');
    strip.append(...sorted.filter((i) => tier.get(i.id) === t).map((i) =>
      itemImg(i, true, '', { alt: i.title, title: `${i.title} ${Math.round(r.get(i.id).rating)}` })));
    const row = el('div', 'tier-row');
    row.append(label, strip);
    list.append(row);
  }

  const rows = sorted.map((i, n) => {
    const row = el('tr');
    const cells = [n + 1, i.title, tier.get(i.id), Math.round(r.get(i.id).rating), r.get(i.id).games].map((v) => el('td', '', { textContent: String(v) }));
    cells[2].style.color = TIER_COLOR[tier.get(i.id)];
    const last = el('td');
    last.append(focusBtn(i));
    row.append(...cells, last);
    return row;
  });
  view.replaceChildren(list, tableCard(['#', 'TITLE', 'TIER', 'ELO', 'GAMES', ''], rows, 'table-card results-table'));
}

function renderAll() {
  const none = !cur();
  renderSidebar();
  $('#hero-title').hidden = !none;
  $('#list-name').hidden = none;
  $('#progress').hidden = none;
  $('.tabs-bar').hidden = none;
  $('#empty-lists').hidden = !none;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const t of ['items', 'match', 'results']) $(`#view-${t}`).hidden = none || tab !== t;
  if (none) return;
  renderProgress(); renderMatchState(); renderStatus(); updateSideTitles();
  if (tab === 'items') renderItems();
  if (tab === 'results') renderResults();
}

// Every state mutation goes through here.
function changed(forceNewPair) {
  save();
  if (focusId && (!byId(focusId) || byId(focusId).blocked)) { focusId = null; focusLeft = 0; }
  const pairOk = current[0] && current.every((id) => byId(id) && !byId(id).blocked);
  if (forceNewPair || !pairOk) loadPair();
  renderAll();
}

// Open a list (null only when there are none). Players are shared across lists, so stop and clear them first.
function openList(id, firstTab) {
  current = [null, null]; lastPair = null; mode = null;
  focusId = null; focusLeft = 0;
  pauseAll();
  sides.forEach((s) => s.classList.remove('playing'));
  store.open = id;
  if (cur()) $('#list-name').value = cur().name;
  tab = firstTab ?? (eligible().length >= 2 ? 'match' : 'items');
  save();
  loadPair();
  renderAll();
}

// ---------- match ----------
function loadPair() {
  sides.forEach((s) => s.classList.remove('playing'));
  const its = eligible();
  const res = its.length < 2 ? null : nextPair(its, computeRatings(items(), cur().matches), cur().matches, { lastPair, focusId });
  if (!res) {
    current = [null, null]; lastPair = null; mode = null;
    pauseAll();
    return;
  }
  current = lastPair = res.pair;
  mode = res.mode;
  sides.forEach((s, i) => {
    const it = byId(current[i]), img = s.querySelector('.side-img');
    if (it.videoId) {
      img.hidden = true; img.removeAttribute('src'); img.dataset.id = '';
      if (ready[i]) players[i].cueVideoById(it.videoId);
    } else {
      img.dataset.id = it.id; img.alt = it.title; img.referrerPolicy = 'no-referrer'; img.src = it.image; img.hidden = false;
      if (ready[i]) players[i].pauseVideo(); // the player still holds the previous video
    }
  });
}

function activate(i) {
  sides.forEach((s, j) => s.classList.toggle('playing', i === j));
  if (ready[1 - i]) players[1 - i].pauseVideo();
  if (ready[i] && byId(current[i])?.videoId) players[i].playVideo();
}

function pick(i) {
  if (!current[0] || $('#match').hidden) return;
  cur().matches.push({ winner: current[i], loser: current[1 - i], t: Date.now() });
  if (focusId && current.includes(focusId) && --focusLeft <= 0) { focusId = null; focusLeft = 0; }
  changed(true);
}

function startFocus(id) {
  if (eligible().length < 2) return;
  focusId = id; focusLeft = 5;
  tab = 'match';
  loadPair();
  renderAll();
}

function stopFocus() {
  focusId = null; focusLeft = 0;
  loadPair();
  renderAll();
}

function syncTitle(i) {
  const it = byId(current[i]);
  const d = players[i].getVideoData?.();
  if (it?.videoId && d && d.title && d.video_id === it.videoId && it.title === it.videoId) {
    it.title = d.title; save(); updateSideTitles();
  }
}

function createPlayer(i) {
  players[i] = new YT.Player(`player-${i}`, {
    videoId: byId(current[i])?.videoId, // undefined when the side shows an image
    playerVars: { playsinline: 1, rel: 0 },
    events: {
      onReady: (e) => {
        ready[i] = true;
        // The API normally sets this; enforce it so unmuted playback is allowed.
        const frame = e.target.getIframe();
        if (!(frame.getAttribute('allow') || '').includes('autoplay')) frame.setAttribute('allow', 'autoplay; encrypted-media');
        // The pair may have changed while the player was loading.
        if (byId(current[i])?.videoId) e.target.cueVideoById(byId(current[i]).videoId);
      },
      onStateChange: (e) => {
        if (!byId(current[i])?.videoId) return;
        syncTitle(i);
        // cue finished: start the side under a stationary mouse
        if (e.data === 5 && sides[i].matches(':hover')) activate(i);
      },
      onError: (e) => {
        if (![100, 101, 150].includes(e.data)) return;
        const it = byId(current[i]);
        const vid = e.target.getVideoData?.().video_id;
        if (!it?.videoId || (vid && vid !== it.videoId)) return; // stale error from the previous pair
        it.blocked = true;
        changed();
      },
    },
  });
}

function loadApi() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    document.head.append(el('script', '', { src: 'https://www.youtube.com/iframe_api' }));
  });
}

sides.forEach((s, i) => {
  s.addEventListener('mouseenter', () => activate(i));
  s.addEventListener('click', (e) => { if (!e.target.closest('.pick-btn')) activate(i); });
  s.querySelector('.pick-btn').addEventListener('click', () => pick(i));
  const img = s.querySelector('.side-img');
  img.addEventListener('error', () => { const it = byId(img.dataset.id); if (it?.image && !it.blocked) { it.blocked = true; changed(); } });
  img.addEventListener('load', () => { const it = byId(img.dataset.id); if (it?.image && it.blocked) { it.blocked = false; changed(); } });
});

$('#start-btn').addEventListener('click', async () => {
  started = true;
  renderMatchState();
  await loadApi();
  createPlayer(0); createPlayer(1);
});

document.addEventListener('keydown', (e) => {
  if (e.repeat || !cur() || tab !== 'match' || $('#match').hidden || e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowLeft') pick(0);
  else if (e.key === 'ArrowRight') pick(1);
});

document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  if (tab !== 'match') pauseAll();
  renderAll();
}));

// ---------- list actions ----------
$('#new-list-btn').addEventListener('click', () => {
  const l = { id: crypto.randomUUID(), name: 'UNTITLED', items: [], matches: [] };
  store.lists.push(l);
  openList(l.id, 'items');
});

$('#list-name').addEventListener('input', (e) => { cur().name = e.target.value; save(); renderSidebar(); });

function urlError(msg) { const e = $('#url-error'); e.textContent = msg; e.hidden = !msg; }
function addItem() {
  const url = $('#url-input').value.trim(), name = $('#name-input').value.trim();
  const playlistId = parsePlaylistId(url);
  if (playlistId) return importPlaylist(playlistId);
  const list = cur(), videoId = parseVideoId(url), image = videoId ? null : parseImageUrl(url);
  let it;
  if (videoId) {
    if (items().some((i) => i.videoId === videoId)) return urlError('already in list');
    it = { id: crypto.randomUUID(), videoId, title: name || videoId };
  } else if (image) {
    if (!name) return urlError('images need a name');
    if (items().some((i) => i.image === image)) return urlError('already in list');
    it = { id: crypto.randomUUID(), image, title: name };
  } else return urlError('not a youtube or image link');
  urlError('');
  $('#url-input').value = $('#name-input').value = '';
  $('#url-input').focus();
  list.items.push(it);
  changed();
  if (!it.videoId || name) return;
  fetchTitle(it, list).then((ok) => { if (ok && cur() === list) renderAll(); });
}

// CORS may block this; the title then comes from the player instead. Resolves true when the title was set.
async function fetchTitle(it, list) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + it.videoId));
    const d = await r.json();
    if (d.title && it.title === it.videoId && list.items.includes(it)) { it.title = String(d.title); save(); return true; }
  } catch { /* skipped */ }
  return false;
}

let importing = false;
async function importPlaylist(listId) {
  if (importing) return;
  importing = true;
  const list = cur(), btn = $('#add-btn'), status = $('#add-status');
  const setStatus = (msg) => { status.textContent = msg; status.hidden = !msg; };
  urlError('');
  setStatus('READING PLAYLIST…');
  btn.disabled = true;
  let ids;
  try {
    ids = await readPlaylist(listId);
  } catch {
    setStatus('');
    urlError('could not read playlist (private, empty or unavailable)');
    btn.disabled = importing = false;
    return;
  }
  const have = new Set(list.items.map((i) => i.videoId));
  const added = [];
  for (const videoId of ids) {
    if (parseVideoId(videoId) !== videoId || have.has(videoId)) continue; // bad ids would make validateList drop the whole list
    have.add(videoId);
    added.push({ id: crypto.randomUUID(), videoId, title: videoId });
  }
  list.items.push(...added);
  if (cur() === list) changed(); else save();
  const dupes = ids.length - added.length;
  // shortcut: the embedded player returns at most 200 videos per playlist, use the YouTube Data API (needs a key) for longer ones
  setStatus(`ADDED ${added.length} VIDEOS` + (dupes ? `, ${dupes} ALREADY IN LIST` : '') + (ids.length === 200 ? '. PLAYLISTS ARE CUT AT 200' : ''));
  $('#url-input').value = '';
  btn.disabled = importing = false;
  const refresh = () => { if (cur() === list && tab === 'items') { renderItems(); updateSideTitles(); } };
  let n = 0;
  for (const it of added) {
    if (await fetchTitle(it, list) && ++n % 10 === 0) refresh();
  }
  refresh();
}

function readPlaylist(listId) {
  const box = el('div');
  box.style.cssText = 'position:absolute;left:-9999px;width:320px;height:180px';
  box.append(el('div'));
  document.body.append(box);
  let player, timer;
  return loadApi().then(() => new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), 12000);
    player = new YT.Player(box.firstChild, {
      playerVars: { listType: 'playlist', list: listId },
      events: {
        onReady: (e) => { const ids = e.target.getPlaylist(); if (ids?.length) resolve(ids); else reject(new Error('empty')); },
        onError: () => reject(new Error('player error')),
      },
    });
  })).finally(() => { clearTimeout(timer); try { player?.destroy(); } catch { /* already gone */ } box.remove(); });
}
$('#add-btn').addEventListener('click', addItem);
for (const id of ['#url-input', '#name-input']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });

$('#export-btn').addEventListener('click', () => {
  const l = cur();
  const a = el('a', '', { href: URL.createObjectURL(new Blob([JSON.stringify(l, null, 2)], { type: 'application/json' })), download: `${l.name || 'list'}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const l = validateList(JSON.parse(await file.text()));
    l.id = crypto.randomUUID();
    store.lists.push(l);
    openList(l.id);
  } catch (err) { alert(err.message); }
});

$('#reset-btn').addEventListener('click', () => {
  if (!confirm('Reset all votes?')) return;
  cur().matches = [];
  focusId = null; focusLeft = 0;
  changed(true);
});

$('#delete-btn').addEventListener('click', () => {
  const l = cur();
  if (!confirm(`Delete "${l.name}" and all its votes?`)) return;
  store.lists = store.lists.filter((x) => x !== l);
  openList(store.lists[0]?.id ?? null);
});

openList(cur() ? store.open : store.lists[0]?.id ?? null);

// ---------- sidebar toggle ----------
const sbBtn = $('#sidebar-toggle');
function syncSidebar() {
    const c = document.body.classList.contains('sidebar-collapsed');
    sbBtn.textContent = c ? '>' : '<';
    sbBtn.setAttribute('aria-expanded', String(!c));
    sbBtn.setAttribute('aria-label', c ? 'show sidebar' : 'hide sidebar');
}
sbBtn.addEventListener('click', () => {
    const c = document.body.classList.toggle('sidebar-collapsed');
    try { if (c) localStorage.setItem('sidebar-collapsed', '1'); else localStorage.removeItem('sidebar-collapsed'); } catch (e) {}
    syncSidebar();
});
syncSidebar();

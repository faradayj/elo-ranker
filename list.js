const ID_RE = /^[\w-]{11}$/;
const HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'];

const toUrl = (s) => new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);

export function parseVideoId(text) {
  const s = String(text).trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = toUrl(s); } catch { return null; }
  let id = null;
  if (u.hostname === 'youtu.be') id = u.pathname.split('/')[1];
  else if (HOSTS.includes(u.hostname)) {
    const [, kind, rest] = u.pathname.split('/');
    if (kind === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live'].includes(kind)) id = rest;
  }
  return ID_RE.test(id || '') ? id : null;
}

export function parsePlaylistId(text) {
  const s = String(text).trim();
  let u;
  try { u = toUrl(s); } catch { return null; }
  const id = u.searchParams.get('list') || '';
  return HOSTS.includes(u.hostname) && u.pathname === '/playlist' && /^[\w-]{13,64}$/.test(id) ? id : null;
}

export function parseImageUrl(text) {
  const s = String(text).trim();
  try { return ['http:', 'https:'].includes(new URL(s).protocol) ? s : null; } catch { return null; }
}

const fail = (m) => { throw new Error(m); };

export function validateList(obj) {
  if (!obj || typeof obj !== 'object') fail('not a list');
  if (obj.name !== undefined && typeof obj.name !== 'string') fail('bad name');
  if (!Array.isArray(obj.items)) fail('items must be an array');
  if (!Array.isArray(obj.matches)) fail('matches must be an array');
  const seen = new Set();
  const items = obj.items.map((it) => {
    if (!it || typeof it.id !== 'string' || !it.id) fail('bad item id');
    if (seen.has(it.id)) fail('duplicate item id');
    seen.add(it.id);
    const isVideo = it.videoId !== undefined;
    if (isVideo === (it.image !== undefined)) fail('item needs exactly one of videoId or image');
    if (isVideo && (typeof it.videoId !== 'string' || !ID_RE.test(it.videoId))) fail('bad videoId');
    if (!isVideo && (typeof it.image !== 'string' || !parseImageUrl(it.image))) fail('bad image');
    if (typeof it.title !== 'string') fail('bad title');
    if (it.blocked !== undefined && typeof it.blocked !== 'boolean') fail('bad blocked');
    const out = isVideo ? { id: it.id, videoId: it.videoId, title: it.title } : { id: it.id, image: it.image, title: it.title };
    if (it.blocked !== undefined) out.blocked = it.blocked;
    return out;
  });
  const matches = obj.matches.map((m) => {
    if (!m || typeof m.winner !== 'string' || typeof m.loser !== 'string') fail('bad match');
    if (m.winner === m.loser) fail('winner equals loser');
    if (typeof m.t !== 'number') fail('bad match time');
    return { winner: m.winner, loser: m.loser, t: m.t };
  });
  const out = { name: obj.name ?? 'UNTITLED', items, matches };
  if (typeof obj.id === 'string' && obj.id) out.id = obj.id;
  return out;
}

// Ids are assigned by the caller; `open` survives only if it names a surviving list.
export function validateStore(obj) {
  const lists = [];
  if (obj && typeof obj === 'object' && Array.isArray(obj.lists)) {
    for (const l of obj.lists) { try { lists.push(validateList(l)); } catch { /* drop bad list */ } }
  }
  const open = lists.some((l) => l.id && l.id === obj.open) ? obj.open : null;
  return { lists, open };
}

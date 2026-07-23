// store.js — seed data + user layer (favourites / deleted / notes / added), merge & queries.
// The user layer is persisted to localStorage (works fully offline) and, when a Google
// Sheet is connected, mirrored to it via sync.js. Highlight identity is a numeric id.

import * as sync from './sync.js';

const LS_STATE = 'kh_state_v1';
const LS_OUTBOX = 'kh_outbox_v1';

const emptyUser = () => ({
  favourites: [],   // [id,...]
  deleted: [],      // [id,...] tombstones
  notes: {},        // { id: "text" }
  added: [],        // [{id,b,loc,t,th,p,addedAt}]
  addedBooks: [],   // [{id,title,author,blurb,authorBlurb}]
});

export const state = {
  seed: { books: [], themes: [], highlights: [], meta: {} },
  user: emptyUser(),
  booksById: new Map(),
  themesById: new Map(),
  favSet: new Set(),
  delSet: new Set(),
  allHighlights: [],   // seed + added, minus deleted
  allBooks: [],        // seed + addedBooks
  ready: false,
};

let outbox = [];
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { listeners.forEach(fn => fn(kind)); }

// ---------- persistence ----------
function persist() {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify(state.user));
    localStorage.setItem(LS_OUTBOX, JSON.stringify(outbox));
  } catch (e) { console.warn('persist failed', e); }
}
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
    if (s) state.user = Object.assign(emptyUser(), s);
    outbox = JSON.parse(localStorage.getItem(LS_OUTBOX) || '[]');
  } catch (e) { /* ignore */ }
}

// ---------- derive ----------
function rebuild() {
  state.favSet = new Set(state.user.favourites);
  state.delSet = new Set(state.user.deleted);
  state.booksById = new Map();
  for (const b of state.seed.books) state.booksById.set(b.id, b);
  for (const b of state.user.addedBooks) state.booksById.set(b.id, b);
  state.allBooks = [...state.booksById.values()];

  const merged = state.seed.highlights.concat(state.user.added);
  state.allHighlights = merged.filter(h => !state.delSet.has(h.id));
  // recompute per-book highlight counts including added, excluding deleted
  const counts = new Map();
  for (const h of state.allHighlights) counts.set(h.b, (counts.get(h.b) || 0) + 1);
  for (const b of state.allBooks) b._count = counts.get(b.id) || 0;
}

// ---------- init ----------
export async function init() {
  loadLocal();
  const [books, themes, highlights, meta] = await Promise.all([
    fetch('./data/books.json').then(r => r.json()),
    fetch('./data/themes.json').then(r => r.json()),
    fetch('./data/highlights.json').then(r => r.json()),
    fetch('./data/meta.json').then(r => r.json()),
  ]);
  state.seed = { books, themes, highlights, meta };
  for (const t of themes) state.themesById.set(t.id, t);
  rebuild();
  state.ready = true;
  emit('ready');

  // background sync if configured
  if (sync.isConfigured()) pullAndFlush().catch(() => {});
  return state;
}

// ---------- queries ----------
export function book(id) { return state.booksById.get(id); }
export function theme(id) { return state.themesById.get(id); }
export function isFav(id) { return state.favSet.has(id); }
export function note(id) { return state.user.notes[id] || ''; }

export function query({ books, themes, search, favOnly, sort } = {}) {
  const bookSet = books && books.size ? books : null;
  const themeSet = themes && themes.size ? themes : null;
  const q = (search || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : null;

  let res = state.allHighlights.filter(h => {
    if (bookSet && !bookSet.has(h.b)) return false;
    if (themeSet && !h.th.some(t => themeSet.has(t))) return false;
    if (favOnly && !state.favSet.has(h.id)) return false;
    if (terms) {
      const txt = h.t.toLowerCase();
      for (const t of terms) if (!txt.includes(t)) return false;
    }
    return true;
  });

  switch (sort) {
    case 'loc': res.sort((a, b) => a.b - b.b || a.loc - b.loc); break;
    case 'theme': res.sort((a, b) => (a.p || 99) - (b.p || 99) || a.b - b.b); break;
    case 'len': res.sort((a, b) => b.t.length - a.t.length); break;
    case 'added': res.sort((a, b) => (b._added || 0) - (a._added || 0) || b.id - a.id); break;
    case 'random': { const s = randomSeed; res.sort((a, b) => rnd(a.id, s) - rnd(b.id, s)); break; }
    default: res.sort((a, b) => a.b - b.b || a.loc - b.loc); // by book
  }
  return res;
}

// seeded, stable pseudo-random order — same seed => same order (survives re-renders)
let randomSeed = 1;
export function reshuffle() { randomSeed = (Math.floor(Math.random() * 2147483646) + 1) | 0; return randomSeed; }
function rnd(id, seed) {
  let x = (Math.imul(id, 2654435761) ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = (x ^ (x >>> 13)) >>> 0;
  return x;
}

// counts of themes / books given the current (partial) filter — for sidebar badges.
// book counts reflect the theme/search/fav filter (but NOT the book selection, so you can
// still add more books); theme counts reflect the book/search/fav filter (but NOT the
// theme selection, so you can still add more themes).
export function facetCounts({ books, themes, search, favOnly } = {}) {
  const bookSet = books && books.size ? books : null;
  const themeSet = themes && themes.size ? themes : null;
  const q = (search || '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : null;
  const themeCounts = new Map();
  const bookCounts = new Map();
  for (const h of state.allHighlights) {
    if (favOnly && !state.favSet.has(h.id)) continue;
    if (terms) { const txt = h.t.toLowerCase(); let ok = true; for (const t of terms) if (!txt.includes(t)) { ok = false; break; } if (!ok) continue; }
    if (!themeSet || h.th.some(t => themeSet.has(t))) bookCounts.set(h.b, (bookCounts.get(h.b) || 0) + 1);
    if (!bookSet || bookSet.has(h.b)) { for (const t of h.th) themeCounts.set(t, (themeCounts.get(t) || 0) + 1); }
  }
  return { themeCounts, bookCounts };
}

// ---------- mutations ----------
function enqueue(op) {
  if (!sync.isConfigured()) return;
  outbox.push(op);
  persist();
  flush().catch(() => emit('syncerror'));
}

export function toggleFav(id) {
  const on = !state.favSet.has(id);
  if (on) { state.favSet.add(id); state.user.favourites.push(id); }
  else { state.favSet.delete(id); state.user.favourites = state.user.favourites.filter(x => x !== id); }
  persist(); emit('user');
  enqueue({ t: 'fav', id, on: on ? 1 : 0 });
  return on;
}

export function toggleDelete(id) {
  const on = !state.delSet.has(id);
  if (on) { state.delSet.add(id); state.user.deleted.push(id); }
  else { state.delSet.delete(id); state.user.deleted = state.user.deleted.filter(x => x !== id); }
  rebuild(); persist(); emit('data');
  enqueue({ t: 'del', id, on: on ? 1 : 0 });
  return on;
}

export function setNote(id, text) {
  text = (text || '').trim();
  if (text) state.user.notes[id] = text; else delete state.user.notes[id];
  persist(); emit('user');
  enqueue({ t: 'note', id, text });
}

export function addHighlight({ bookTitle, author, text, themes }) {
  bookTitle = (bookTitle || '').trim();
  text = (text || '').trim();
  if (!text) throw new Error('Highlight text is required');
  if (!bookTitle) throw new Error('Book is required');
  // find or create book
  let b = state.allBooks.find(x => x.title.toLowerCase() === bookTitle.toLowerCase());
  let newBook = null;
  if (!b) {
    const bid = nextId('book');
    newBook = { id: bid, title: bookTitle, author: (author || '').trim(), blurb: '', authorBlurb: '', topWords: [], topThemes: [] };
    state.user.addedBooks.push(newBook);
    b = newBook;
  }
  const id = nextId('hl');
  const hl = { id, b: b.id, loc: 0, t: text, th: themes || [], p: (themes && themes[0]) || null, addedAt: Date.now(), _added: Date.now() };
  state.user.added.push(hl);
  rebuild(); persist(); emit('data');
  enqueue({ t: 'addHl', hl: { id, b: b.id, title: b.title, author: b.author, text, themes: themes || [] }, newBook });
  return hl;
}

function nextId(kind) {
  const seedMax = kind === 'hl' ? (state.seed.meta.maxSeedHighlightId || 15412) : (state.seed.meta.maxSeedBookId || 416);
  const base = 2000000; // keep well clear of seed ids
  const arr = kind === 'hl' ? state.user.added : state.user.addedBooks;
  let max = base;
  for (const x of arr) if (x.id > max) max = x.id;
  return Math.max(max + 1, base, seedMax + 1);
}

// ---------- sheet sync ----------
export async function pullAndFlush() {
  emit('syncing');
  try {
    const remote = await sync.pull();
    mergeRemote(remote);
    await flush(); // send any queued local ops
    emit('synced');
  } catch (e) {
    console.warn('sync failed', e);
    emit('syncerror');
    throw e; // let callers (Test & sync / Push) report the real reason
  }
}

function parseThemes(v) {
  if (Array.isArray(v)) return v.map(Number).filter(n => !isNaN(n));
  if (typeof v === 'string') return v.split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
  return [];
}

function mergeRemote(remote) {
  // Sheet is source of truth for favourites/deleted/notes/added; union with anything
  // still sitting in the outbox (unsent local changes) so nothing is lost.
  const fav = new Set((remote.favourites || []).map(Number));
  const del = new Set((remote.deleted || []).map(Number));
  const notes = Object.assign({}, remote.notes || {});

  // explicit added books (optional metadata rows)
  const addedBooks = (remote.addedBooks || []).map(b => ({ id: Number(b.id), title: b.title || '', author: b.author || '', blurb: b.blurb || '', authorBlurb: '', topWords: [], topThemes: [] }));
  // index titles -> book id (seed + explicit added) so hand-typed sheet rows resolve
  const byTitle = new Map();
  for (const b of state.seed.books) byTitle.set(b.title.toLowerCase(), b.id);
  for (const b of addedBooks) if (b.title) byTitle.set(b.title.toLowerCase(), b.id);

  let autoBookId = 2500000;
  const added = [];
  for (const h of (remote.addedHighlights || [])) {
    const title = (h.title || '').trim();
    let bid;
    if (h.b) bid = Number(h.b);
    else if (title && byTitle.has(title.toLowerCase())) bid = byTitle.get(title.toLowerCase());
    else {
      bid = autoBookId++;
      byTitle.set(title.toLowerCase(), bid);
      addedBooks.push({ id: bid, title: title || 'Untitled', author: (h.author || '').trim(), blurb: '', authorBlurb: '', topWords: [], topThemes: [] });
    }
    added.push({ id: Number(h.id), b: bid, loc: Number(h.loc) || 0, t: h.text || h.t || '', th: parseThemes(h.themes || h.th), p: null, _added: Number(h.addedAt) || 0 });
  }
  for (const op of outbox) {
    if (op.t === 'fav') { op.on ? fav.add(op.id) : fav.delete(op.id); }
    else if (op.t === 'del') { op.on ? del.add(op.id) : del.delete(op.id); }
    else if (op.t === 'note') { if (op.text) notes[op.id] = op.text; else delete notes[op.id]; }
  }
  state.user.favourites = [...fav];
  state.user.deleted = [...del];
  state.user.notes = notes;
  state.user.added = added;
  state.user.addedBooks = addedBooks;
  rebuild(); persist(); emit('data');
}

let flushing = false;
export async function flush() {
  if (flushing || !sync.isConfigured() || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const op = outbox[0];
      const res = await sync.send(op); // throws on a non-ok response — do NOT swallow
      if (op.t === 'addHl' && res && res.id) {
        // reconcile server-assigned id if different
        const local = state.user.added.find(h => h.id === op.hl.id);
        if (local && Number(res.id) !== local.id) { local.id = Number(res.id); rebuild(); }
      }
      outbox.shift();
      persist();
    }
    emit('synced');
  } finally { flushing = false; } // errors propagate to the caller; failed op stays queued for retry
}

export function pendingCount() { return outbox.length; }
export function resetForFullPush() {
  // queue every local item for a fresh sheet
  outbox = [];
  for (const id of state.user.favourites) outbox.push({ t: 'fav', id, on: 1 });
  for (const id of state.user.deleted) outbox.push({ t: 'del', id, on: 1 });
  for (const [id, text] of Object.entries(state.user.notes)) outbox.push({ t: 'note', id: Number(id), text });
  for (const hl of state.user.added) outbox.push({ t: 'addHl', hl: { id: hl.id, b: hl.b, title: (book(hl.b) || {}).title || '', author: (book(hl.b) || {}).author || '', text: hl.t, themes: hl.th }, newBook: state.user.addedBooks.find(b => b.id === hl.b) || null });
  persist();
  return flush();
}

// app.js — UI controller
import * as store from './store.js';
import * as sync from './sync.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = new Intl.NumberFormat();
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// escape + wrap current search terms in <mark> for yellow highlighting
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function searchTerms() {
  const q = (F.search || '').trim();
  return q ? q.split(/\s+/).filter(Boolean) : [];
}
function markHtml(text) {
  const esc = escapeHtml(text);
  const terms = searchTerms();
  if (!terms.length) return esc;
  const pat = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!pat.length) return esc;
  return esc.replace(new RegExp('(' + pat.join('|') + ')', 'gi'), '<mark>$1</mark>');
}
function countMatches(...texts) {
  const terms = searchTerms();
  if (!terms.length) return 0;
  let n = 0;
  for (const text of texts) {
    const low = (text || '').toLowerCase();
    for (const t of terms) { const tl = t.toLowerCase(); if (!tl) continue; let i = 0; while ((i = low.indexOf(tl, i)) !== -1) { n++; i += tl.length; } }
  }
  return n;
}
function matchBadge(n) { return n ? `<span class="match-badge">${n} match${n > 1 ? 'es' : ''}</span>` : ''; }

// ---------- filter + view state ----------
const F = { books: new Set(), themes: new Set(), search: '', favOnly: false, sort: 'book' };
let tab = 'browse';          // browse | books | favourites
let mode = 'list';           // list | flick   (browse)
let bookMode = 'grid';       // grid | flick   (books)
let results = [];            // current highlight result set
let page = 0;
const PAGE = 60;
let flickIdx = 0;
let bookList = [];           // current books-view list
let bookFlickIdx = 0;

// ---------- boot ----------
init();
async function init() {
  bindStatic();
  applySavedTheme();
  registerSW();
  await store.init();
  store.onChange(onStoreChange);
  hydrateConfigUI();
  renderStats();
  renderSidebar();
  renderThemesForAdd();
  refresh();
  updateSyncBadge(sync.isConfigured() ? 'ok' : 'local');
}

function onStoreChange(kind) {
  if (kind === 'syncing') updateSyncBadge('syncing');
  else if (kind === 'synced') updateSyncBadge('ok');
  else if (kind === 'syncerror') updateSyncBadge('err');
  if (kind === 'data' || kind === 'synced') { renderStats(); renderSidebar(); refresh(); }
  else if (kind === 'user') { renderStats(); refresh(); }
}

// ---------- stats + sync badge ----------
function renderStats() {
  const nB = store.state.allBooks.length;
  const nH = store.state.allHighlights.length;
  const nF = store.state.favSet.size;
  $('#subStats').textContent = `${fmt.format(nB)} books · ${fmt.format(nH)} highlights · ${fmt.format(nF)} ★`;
}
function updateSyncBadge(kind) {
  const dot = $('#syncDot');
  dot.className = 'sync-dot ' + kind;
  const p = store.pendingCount();
  $('#syncBtn').title = kind === 'ok' ? (p ? `Synced (${p} pending)` : 'Synced with Google Sheets')
    : kind === 'syncing' ? 'Syncing…' : kind === 'err' ? 'Sync error — tap to retry' : 'Local only — tap to connect a Sheet';
}

// ---------- sidebar ----------
function renderSidebar() {
  renderBookList();
  renderThemeChips();
  $('#bookSelCount').textContent = F.books.size || '';
  $('#themeSelCount').textContent = F.themes.size || '';
}

function renderBookList() {
  const { bookCounts } = store.facetCounts({ books: F.books, themes: F.themes, search: F.search, favOnly: effectiveFavOnly() });
  const filterActive = F.themes.size || F.search || effectiveFavOnly();
  const q = $('#bookFilter').value.trim().toLowerCase();
  let books = store.state.allBooks.map(b => ({ b, c: bookCounts.get(b.id) || 0 }));
  if (filterActive) books = books.filter(x => x.c > 0);
  if (q) books = books.filter(x => x.b.title.toLowerCase().includes(q) || (x.b.author || '').toLowerCase().includes(q));
  books.sort((a, z) => z.c - a.c || a.b.title.localeCompare(z.b.title));
  const box = $('#bookList');
  box.innerHTML = '';
  for (const { b, c } of books.slice(0, 400)) {
    const item = el('label', 'check-item');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = F.books.has(b.id);
    cb.addEventListener('change', () => { cb.checked ? F.books.add(b.id) : F.books.delete(b.id); renderSidebar(); refresh(); });
    const title = el('span', 'ci-title', b.title); title.title = `${b.title} — ${b.author || ''}`;
    const cnt = el('span', 'ci-count', String(c));
    item.append(cb, title, cnt);
    box.append(item);
  }
  if (!books.length) box.append(el('p', 'hint', 'No books match.'));
}

function renderThemeChips() {
  const { themeCounts } = store.facetCounts({ books: F.books, themes: F.themes, search: F.search, favOnly: effectiveFavOnly() });
  const box = $('#themeChips'); box.innerHTML = '';
  const themes = [...store.state.themesById.values()]
    .map(t => ({ t, c: themeCounts.get(t.id) || 0 }))
    .sort((a, z) => z.c - a.c || a.t.name.localeCompare(z.t.name));
  for (const { t, c } of themes) {
    const chip = el('button', 'chip' + (F.themes.has(t.id) ? ' active' : ''));
    chip.append(el('span', null, t.name), el('span', 'chip-count', String(c)));
    chip.addEventListener('click', () => { F.themes.has(t.id) ? F.themes.delete(t.id) : F.themes.add(t.id); renderSidebar(); refresh(); });
    box.append(chip);
  }
}

// ---------- refresh (recompute results + render active view) ----------
function effectiveFavOnly() { return F.favOnly || tab === 'favourites'; }

function refresh() {
  results = store.query({ books: F.books, themes: F.themes, search: F.search, favOnly: effectiveFavOnly(), sort: F.sort });
  page = 0;
  flickIdx = Math.min(flickIdx, Math.max(0, results.length - 1));
  $('#resultCount').textContent = `${fmt.format(results.length)} highlight${results.length === 1 ? '' : 's'}`;
  $('#filterSummary').textContent = summaryText();
  if (tab === 'books') renderBooksView();
  else if (mode === 'list') renderList(); else renderFlick();
}

function summaryText() {
  const parts = [];
  if (tab === 'favourites') parts.push('Favourites');
  if (F.books.size) parts.push(`${F.books.size} book${F.books.size > 1 ? 's' : ''}`);
  if (F.themes.size) parts.push([...F.themes].map(id => (store.theme(id) || {}).name).join(', '));
  if (F.search) parts.push(`“${F.search}”`);
  if (F.favOnly && tab !== 'favourites') parts.push('★ only');
  return parts.length ? '· ' + parts.join(' · ') : '';
}

// ---------- LIST mode ----------
function renderList() {
  $('#listMode').classList.remove('hidden');
  $('#flickMode').classList.add('hidden');
  const wrap = $('#cards');
  if (page === 0) wrap.innerHTML = '';
  const empty = $('#emptyState');
  if (!results.length) {
    empty.classList.remove('hidden');
    empty.textContent = tab === 'favourites' ? 'No favourites yet. Tap ☆ on any highlight to save it here.' : 'No highlights match these filters.';
    $('#loadMore').classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  const slice = results.slice(page * PAGE, (page + 1) * PAGE);
  for (const h of slice) wrap.append(hlCard(h));
  const more = (page + 1) * PAGE < results.length;
  $('#loadMore').classList.toggle('hidden', !more);
}

function hlCard(h) {
  const b = store.book(h.b) || { title: 'Unknown', author: '' };
  const card = el('div', 'hl-card' + (store.isFav(h.id) ? ' fav' : ''));
  const top = el('div', 'hl-top');
  const left = el('div', 'hl-top-left');
  const bk = el('span', 'hl-book');
  bk.innerHTML = markHtml(b.title);
  bk.addEventListener('click', () => focusBook(h.b));
  left.append(bk);
  if (searchTerms().length) {
    const n = countMatches(h.t, b.title);
    if (n) { const badge = el('span'); badge.innerHTML = matchBadge(n); left.append(badge.firstChild); }
  }
  const acts = el('div', 'hl-actions');
  acts.append(
    actionBtn(store.isFav(h.id) ? '★' : '☆', 'Favourite', store.isFav(h.id), e => { const on = store.toggleFav(h.id); e.target.textContent = on ? '★' : '☆'; e.target.classList.toggle('on', on); card.classList.toggle('fav', on); }),
    actionBtn('✎', 'Note', !!store.note(h.id), () => openNote(h.id)),
    actionBtn('⧉', 'Copy', false, () => copyHl(h, b)),
    actionBtn('🗑', 'Delete', false, () => { if (confirm('Delete this highlight? It will be hidden on all your devices (reversible from the Sheet).')) store.toggleDelete(h.id); }, 'danger'),
  );
  top.append(left, acts);
  const txt = el('div', 'hl-text');
  txt.innerHTML = markHtml(h.t);
  card.append(top, txt);
  const nt = store.note(h.id);
  if (nt) card.append(el('div', 'hl-note', '✎ ' + nt));
  if (h.th && h.th.length) {
    const tw = el('div', 'hl-themes');
    for (const tid of h.th) { const t = store.theme(tid); if (t) tw.append(el('span', 'tag', t.name)); }
    card.append(tw);
  }
  return card;
}
function actionBtn(txt, title, on, fn, extra = '') {
  const b = el('button', 'action-btn' + (on ? ' on' : '') + (extra ? ' ' + extra : ''), txt);
  b.title = title; b.addEventListener('click', fn); return b;
}

// ---------- FLICK mode ----------
function renderFlick() {
  $('#listMode').classList.add('hidden');
  $('#flickMode').classList.remove('hidden');
  if (!results.length) {
    $('#flickText').textContent = tab === 'favourites' ? 'No favourites yet.' : 'No highlights match these filters.';
    $('#flickBook').textContent = ''; $('#flickThemes').textContent = '';
    $('#flickNote').classList.add('hidden');
    $('#flickProgress').textContent = '0 / 0';
    $('#flickPrev').disabled = $('#flickNext').disabled = true;
    return;
  }
  flickIdx = Math.max(0, Math.min(flickIdx, results.length - 1));
  const h = results[flickIdx];
  const b = store.book(h.b) || { title: 'Unknown' };
  const card = $('#flickCard');
  card.classList.toggle('fav', store.isFav(h.id));
  $('#flickBook').innerHTML = markHtml(b.title);
  $('#flickBook').onclick = () => focusBook(h.b);
  const themesTxt = (h.th || []).map(t => (store.theme(t) || {}).name).filter(Boolean).join(' · ');
  let metaHtml = escapeHtml(themesTxt);
  if (searchTerms().length) {
    const n = countMatches(h.t, b.title);
    if (n) metaHtml = (themesTxt ? metaHtml + ' · ' : '') + matchBadge(n);
  }
  $('#flickThemes').innerHTML = metaHtml;
  $('#flickText').innerHTML = markHtml(h.t);
  const nt = store.note(h.id);
  const nEl = $('#flickNote');
  if (nt) { nEl.textContent = '✎ ' + nt; nEl.classList.remove('hidden'); } else nEl.classList.add('hidden');
  $('#flickFav').textContent = store.isFav(h.id) ? '★' : '☆';
  $('#flickFav').classList.toggle('on', store.isFav(h.id));
  $('#flickProgress').textContent = `${flickIdx + 1} / ${results.length}`;
  $('#flickPrev').disabled = flickIdx === 0;
  $('#flickNext').disabled = flickIdx === results.length - 1;
}
function flickGo(d) { if (!results.length) return; flickIdx = Math.max(0, Math.min(results.length - 1, flickIdx + d)); renderFlick(); }
function curFlick() { return results[flickIdx]; }

// ---------- BOOKS view ----------
function renderBooksView() {
  const q = $('#bookExploreFilter').value.trim().toLowerCase();
  const sortBy = $('#bookSort').value;
  let list = store.state.allBooks.slice();
  if (q) list = list.filter(b => b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q));
  list.sort((a, z) => sortBy === 'title' ? a.title.localeCompare(z.title)
    : sortBy === 'author' ? (a.author || '').localeCompare(z.author || '')
      : (z._count || 0) - (a._count || 0));
  bookList = list;
  if (bookMode === 'grid') {
    $('#bookGrid').classList.remove('hidden'); $('#bookFlick').classList.add('hidden');
    const g = $('#bookGrid'); g.innerHTML = '';
    for (const b of list.slice(0, 300)) g.append(bookCard(b));
    if (!list.length) g.append(el('p', 'hint', 'No books match.'));
  } else {
    $('#bookGrid').classList.add('hidden'); $('#bookFlick').classList.remove('hidden');
    bookFlickIdx = Math.min(bookFlickIdx, Math.max(0, list.length - 1));
    renderBookFlick();
  }
}
function bookCard(b) {
  const c = el('div', 'book-card');
  c.append(el('h3', null, b.title), el('div', 'bc-author', b.author || '—'));
  const counts = el('div', 'bc-counts');
  counts.append(el('span', null, `${fmt.format(b._count || 0)} highlights`));
  if (b.wordCount) counts.append(el('span', null, `${fmt.format(b.wordCount)} words`));
  c.append(counts);
  if (b.blurb) c.append(el('div', 'bc-blurb', b.blurb));
  c.addEventListener('click', () => focusBook(b.id));
  return c;
}
function renderBookFlick() {
  const card = $('#bookFlickCard');
  if (!bookList.length) { card.innerHTML = '<p class="hint">No books.</p>'; return; }
  const b = bookList[bookFlickIdx];
  card.innerHTML = '';
  card.append(el('h2', null, b.title), el('div', 'bf-author', b.author || '—'));
  const counts = el('div', 'bf-counts');
  counts.append(el('span', null, `${fmt.format(b._count || 0)} highlights`));
  if (b.wordCount) counts.append(el('span', null, `${fmt.format(b.wordCount)} words`));
  card.append(counts);
  if (b.blurb) card.append(el('div', 'bf-blurb', b.blurb));
  if (b.topThemes && b.topThemes.length) {
    const tw = el('div', 'hl-themes');
    for (const t of b.topThemes) { const th = store.theme(t.id); if (th) tw.append(el('span', 'tag', `${th.name} (${t.count})`)); }
    card.append(tw);
  }
  const btn = el('button', 'btn', 'View highlights →');
  btn.addEventListener('click', () => focusBook(b.id));
  const row = el('div', 'row'); row.append(btn); card.append(row);
  $('#bookFlickProgress').textContent = `${bookFlickIdx + 1} / ${bookList.length}`;
  $('#bookFlickPrev').disabled = bookFlickIdx === 0;
  $('#bookFlickNext').disabled = bookFlickIdx === bookList.length - 1;
}

// jump to a single book's highlights in Browse
function focusBook(id) {
  F.books = new Set([id]); F.themes.clear(); F.search = ''; $('#searchBox').value = '';
  switchTab('browse'); renderSidebar(); refresh();
  closeSidebar();
}

// ---------- tabs ----------
function switchTab(t) {
  tab = t;
  $$('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.view === t));
  $('#view-browse').classList.toggle('active', t !== 'books');
  $('#view-books').classList.toggle('active', t === 'books');
  refresh();
}

// ---------- copy ----------
async function copyHl(h, b) {
  const text = `“${h.t}”\n— ${b.title}${b.author ? ', ' + b.author : ''}`;
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Copy failed'); }
}

// ---------- modals ----------
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
let noteTargetId = null;
function openNote(id) { noteTargetId = id; $('#noteText').value = store.note(id); openModal('#noteModal'); $('#noteText').focus(); }

function renderThemesForAdd() {
  const box = $('#addThemes'); box.innerHTML = '';
  for (const t of store.state.themesById.values()) {
    const chip = el('button', 'chip', t.name); chip.type = 'button'; chip.dataset.tid = t.id;
    chip.addEventListener('click', () => chip.classList.toggle('active'));
    box.append(chip);
  }
  const dl = $('#bookDatalist'); dl.innerHTML = '';
  for (const b of store.state.allBooks) { const o = el('option'); o.value = b.title; dl.append(o); }
}

// ---------- toast ----------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 1800); }

// ---------- theme ----------
function applySavedTheme() {
  const saved = localStorage.getItem('kh_theme') || 'dark';
  document.body.dataset.theme = saved;
  $('#themeBtn').textContent = saved === 'dark' ? '🌙' : '☀️';
}
function toggleTheme() {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  localStorage.setItem('kh_theme', next);
  $('#themeBtn').textContent = next === 'dark' ? '🌙' : '☀️';
  $('meta[name=theme-color]').setAttribute('content', next === 'dark' ? '#0f1115' : '#f6f7fb');
}

// ---------- sidebar (mobile) ----------
function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

// ---------- config UI ----------
function hydrateConfigUI() {
  const c = sync.getConfig();
  $('#cfgUrl').value = c.url; $('#cfgToken').value = c.token;
}

// ---------- static bindings ----------
let searchT;
function bindStatic() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) switchTab(b.dataset.view); });
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#menuBtn').addEventListener('click', openSidebar);
  $('#scrim').addEventListener('click', closeSidebar);
  $('#settingsBtn').addEventListener('click', () => openModal('#settingsModal'));
  $('#syncBtn').addEventListener('click', () => { if (sync.isConfigured()) store.pullAndFlush(); else openModal('#settingsModal'); });

  $('#searchBox').addEventListener('input', e => { clearTimeout(searchT); searchT = setTimeout(() => { F.search = e.target.value; renderSidebar(); refresh(); }, 160); });
  $('#favOnly').addEventListener('change', e => { F.favOnly = e.target.checked; renderSidebar(); refresh(); });
  $('#bookFilter').addEventListener('input', () => renderBookList());
  $('#clearBooks').addEventListener('click', () => { F.books.clear(); renderSidebar(); refresh(); });
  $('#clearThemes').addEventListener('click', () => { F.themes.clear(); renderSidebar(); refresh(); });
  $('#selectVisibleBooks').addEventListener('click', selectVisibleBooks);
  $('#clearAll').addEventListener('click', () => { F.books.clear(); F.themes.clear(); F.search = ''; F.favOnly = false; $('#searchBox').value = ''; $('#favOnly').checked = false; renderSidebar(); refresh(); });

  $('#sortSel').addEventListener('change', e => { F.sort = e.target.value; refresh(); });
  $('#modeList').addEventListener('click', () => { mode = 'list'; $('#modeList').classList.add('active'); $('#modeFlick').classList.remove('active'); refresh(); });
  $('#modeFlick').addEventListener('click', () => { mode = 'flick'; $('#modeFlick').classList.add('active'); $('#modeList').classList.remove('active'); refresh(); });
  $('#loadMore').addEventListener('click', () => { page++; renderList(); });

  // flick nav
  $('#flickPrev').addEventListener('click', () => flickGo(-1));
  $('#flickNext').addEventListener('click', () => flickGo(1));
  $('#flickFav').addEventListener('click', () => { const h = curFlick(); if (h) { store.toggleFav(h.id); renderFlick(); } });
  $('#flickNoteBtn').addEventListener('click', () => { const h = curFlick(); if (h) openNote(h.id); });
  $('#flickCopy').addEventListener('click', () => { const h = curFlick(); if (h) copyHl(h, store.book(h.b) || {}); });
  $('#flickDelete').addEventListener('click', () => { const h = curFlick(); if (h && confirm('Delete this highlight? Hidden on all devices (reversible from the Sheet).')) { store.toggleDelete(h.id); renderFlick(); } });
  bindSwipe($('#flickCard'), () => flickGo(1), () => flickGo(-1));

  // books view
  $('#bookExploreFilter').addEventListener('input', () => renderBooksView());
  $('#bookSort').addEventListener('change', () => renderBooksView());
  $('#bookModeGrid').addEventListener('click', () => { bookMode = 'grid'; $('#bookModeGrid').classList.add('active'); $('#bookModeFlick').classList.remove('active'); renderBooksView(); });
  $('#bookModeFlick').addEventListener('click', () => { bookMode = 'flick'; $('#bookModeFlick').classList.add('active'); $('#bookModeGrid').classList.remove('active'); renderBooksView(); });
  $('#bookFlickPrev').addEventListener('click', () => { bookFlickIdx = Math.max(0, bookFlickIdx - 1); renderBookFlick(); });
  $('#bookFlickNext').addEventListener('click', () => { bookFlickIdx = Math.min(bookList.length - 1, bookFlickIdx + 1); renderBookFlick(); });
  bindSwipe($('#bookFlickCard'), () => { bookFlickIdx = Math.min(bookList.length - 1, bookFlickIdx + 1); renderBookFlick(); }, () => { bookFlickIdx = Math.max(0, bookFlickIdx - 1); renderBookFlick(); });

  // modals close
  $$('[data-close]').forEach(b => b.addEventListener('click', e => e.target.closest('.modal').classList.add('hidden')));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));

  // add highlight
  $('#addHlBtn').addEventListener('click', () => { $('#addMsg').textContent = ''; openModal('#addModal'); });
  $('#addSave').addEventListener('click', saveAdd);
  $('#noteSave').addEventListener('click', () => { store.setNote(noteTargetId, $('#noteText').value); closeModal('#noteModal'); toast('Note saved'); if (mode === 'flick') renderFlick(); });

  // settings / sync
  $('#testConn').addEventListener('click', testConn);
  $('#disconnect').addEventListener('click', () => { sync.disconnect(); hydrateConfigUI(); updateSyncBadge('local'); $('#connMsg').textContent = 'Disconnected. Still saving locally.'; $('#connMsg').className = 'conn-msg'; });
  $('#pushAll').addEventListener('click', async () => { if (!sync.isConfigured()) return setConn('Connect a Sheet first.', false); setConn('Pushing…'); try { await store.resetForFullPush(); setConn('Pushed all local data to the Sheet.', true); } catch (e) { setConn(e.message, false); } });
  $('#exportJson').addEventListener('click', exportJson);

  // keyboard
  document.addEventListener('keydown', onKey);
}

function selectVisibleBooks() {
  $$('#bookList .check-item').forEach(item => {
    const cb = item.querySelector('input');
    const title = item.querySelector('.ci-title').textContent;
    const b = store.state.allBooks.find(x => x.title === title);
    if (b) F.books.add(b.id);
  });
  renderSidebar(); refresh();
}

function onKey(e) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (!$('#settingsModal').classList.contains('hidden') || !$('#addModal').classList.contains('hidden') || !$('#noteModal').classList.contains('hidden')) return;
  if (tab !== 'books' && mode === 'flick') {
    if (e.key === 'ArrowRight') { flickGo(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { flickGo(-1); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'f') { const h = curFlick(); if (h) { store.toggleFav(h.id); renderFlick(); } }
    else if (e.key === 'Delete' || e.key === 'Backspace') { const h = curFlick(); if (h && confirm('Delete this highlight?')) { store.toggleDelete(h.id); renderFlick(); } }
  } else if (tab === 'books' && bookMode === 'flick') {
    if (e.key === 'ArrowRight') { bookFlickIdx = Math.min(bookList.length - 1, bookFlickIdx + 1); renderBookFlick(); }
    else if (e.key === 'ArrowLeft') { bookFlickIdx = Math.max(0, bookFlickIdx - 1); renderBookFlick(); }
  }
}

function bindSwipe(node, onLeft, onRight) {
  let x0 = null, y0 = null;
  node.addEventListener('touchstart', e => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  node.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches[0]; const dx = t.clientX - x0; const dy = t.clientY - y0;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) { dx < 0 ? onLeft() : onRight(); }
    x0 = y0 = null;
  }, { passive: true });
}

function saveAdd() {
  const themes = $$('#addThemes .chip.active').map(c => Number(c.dataset.tid));
  try {
    store.addHighlight({ bookTitle: $('#addBook').value, author: $('#addAuthor').value, text: $('#addText').value, themes });
    $('#addText').value = ''; $$('#addThemes .chip.active').forEach(c => c.classList.remove('active'));
    closeModal('#addModal'); toast('Highlight added'); renderThemesForAdd();
  } catch (e) { $('#addMsg').textContent = e.message; $('#addMsg').className = 'conn-msg err'; }
}

function setConn(msg, ok) { const m = $('#connMsg'); m.textContent = msg; m.className = 'conn-msg' + (ok === true ? ' ok' : ok === false ? ' err' : ''); }
async function testConn() {
  sync.configure($('#cfgUrl').value, $('#cfgToken').value);
  hydrateConfigUI();
  if (!sync.isConfigured()) return setConn('Enter the Web App URL.', false);
  setConn('Connecting…'); updateSyncBadge('syncing');
  try {
    await sync.ping();
    await store.pullAndFlush();
    setConn('Connected & synced ✓', true); updateSyncBadge('ok');
  } catch (e) { setConn('Failed: ' + e.message, false); updateSyncBadge('err'); }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(store.state.user, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'kindle-highlights-userdata.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- service worker ----------
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

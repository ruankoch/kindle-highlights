// sync.js — transport to the Google Apps Script Web App.
// Uses POST with Content-Type: text/plain so the browser treats it as a "simple
// request" and skips the CORS preflight (Apps Script can't answer OPTIONS).

const LS_CFG = 'kh_config_v1';

let cfg = load();

function load() {
  try { return JSON.parse(localStorage.getItem(LS_CFG) || 'null') || { url: '', token: '' }; }
  catch { return { url: '', token: '' }; }
}
function save() { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); }

export function isConfigured() { return !!(cfg.url && cfg.url.startsWith('http')); }
export function getConfig() { return { ...cfg }; }
export function configure(url, token) {
  cfg = { url: (url || '').trim(), token: (token || '').trim() };
  save();
}
export function disconnect() { cfg = { url: '', token: '' }; save(); }

async function call(payload, { timeout = 20000 } = {}) {
  if (!isConfigured()) throw new Error('not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      // text/plain avoids the CORS preflight; body is still JSON we parse server-side
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: cfg.token, ...payload }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Bad response from script (is the URL the /exec deployment?)'); }
    if (!data.ok) throw new Error(data.error || 'script error');
    return data;
  } finally { clearTimeout(timer); }
}

export async function ping() {
  const d = await call({ action: 'ping' });
  return d;
}

export async function pull() {
  const d = await call({ action: 'state' });
  return {
    favourites: (d.favourites || []).map(Number),
    deleted: (d.deleted || []).map(Number),
    notes: d.notes || {},
    addedHighlights: d.addedHighlights || [],
    addedBooks: d.addedBooks || [],
    updatedAt: d.updatedAt || '',
  };
}

// send a single mutation op
export async function send(op) {
  if (op.t === 'fav') return call({ action: 'fav', id: op.id, on: op.on });
  if (op.t === 'del') return call({ action: 'del', id: op.id, on: op.on });
  if (op.t === 'note') return call({ action: 'note', id: op.id, text: op.text });
  if (op.t === 'addHl') return call({ action: 'addHl', hl: op.hl, newBook: op.newBook || null });
  throw new Error('unknown op ' + op.t);
}

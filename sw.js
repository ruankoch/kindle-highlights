// sw.js — offline cache with fresh-first app shell.
// App shell (HTML/CSS/JS) uses NETWORK-FIRST so an online launch always shows the
// latest version (no more "refresh twice" on iOS); falls back to cache when offline.
// Big data files + icons use cache-first (they rarely change). Sheet sync is never cached.
const VERSION = 'kh-v2';
const SHELL = [
  './', './index.html', './app.css',
  './js/app.js', './js/store.js', './js/sync.js',
  './data/books.json', './data/themes.json', './data/highlights.json', './data/meta.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShell(url) {
  return /\.(html|css|js|webmanifest)(\?|$)/.test(url.pathname) || url.pathname.endsWith('/');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                     // never cache sync POSTs
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // let Apps Script calls pass through

  if (req.mode === 'navigate' || isShell(url)) {
    // network-first: freshest shell when online, cache when offline
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await cache.match(req) || await cache.match('./index.html') || await cache.match('./');
        if (cached) return cached;
        throw new Error('offline and not cached');
      }
    })());
    return;
  }

  // data + icons: cache-first with background refresh
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});

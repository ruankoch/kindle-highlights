// sw.js — offline cache. App shell + seed data are cached on install; the app then
// works fully offline. Sheet sync always hits the network (never cached).
const VERSION = 'kh-v1';
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

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never cache sync POSTs
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // let Apps Script calls pass through
  // stale-while-revalidate for same-origin GETs
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});

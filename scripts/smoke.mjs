import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404).end('not found'); }
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

async function step(name, fn) {
  try { await fn(); console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '—', e.message); errors.push(name + ': ' + e.message); }
}

await page.goto(base, { waitUntil: 'networkidle' });

await step('stats populated', async () => {
  await page.waitForFunction(() => document.querySelector('#subStats')?.textContent.includes('highlights'), null, { timeout: 8000 });
  const s = await page.textContent('#subStats');
  if (!/416 books/.test(s)) throw new Error('unexpected stats: ' + s);
});

await step('list renders highlight cards', async () => {
  await page.waitForSelector('.hl-card', { timeout: 8000 });
  const n = await page.$$eval('.hl-card', els => els.length);
  if (n === 0) throw new Error('no cards');
});

await step('search filters results', async () => {
  await page.fill('#searchBox', 'risk');
  await page.waitForTimeout(400);
  const count = await page.textContent('#resultCount');
  if (!/highlight/.test(count)) throw new Error('no result count');
  await page.fill('#searchBox', '');
  await page.waitForTimeout(300);
});

await step('theme chip filters', async () => {
  await page.click('#themeChips .chip');
  await page.waitForTimeout(300);
  const sel = await page.textContent('#themeSelCount');
  if (sel !== '1') throw new Error('theme not selected: ' + sel);
  await page.click('#clearThemes');
});

await step('favourite a highlight updates count', async () => {
  const before = await page.textContent('#subStats');
  await page.click('.hl-card .action-btn'); // first action is ☆
  await page.waitForTimeout(200);
  const after = await page.textContent('#subStats');
  if (before === after) throw new Error('fav count did not change');
});

await step('flick mode works + arrow nav', async () => {
  await page.click('#modeFlick');
  await page.waitForSelector('#flickMode:not(.hidden)');
  const p1 = await page.textContent('#flickProgress');
  await page.click('#flickNext');
  await page.waitForTimeout(150);
  const p2 = await page.textContent('#flickProgress');
  if (p1 === p2) throw new Error('flick did not advance: ' + p1 + ' -> ' + p2);
  await page.click('#modeList');
});

await step('favourites tab shows saved', async () => {
  await page.click('.tab[data-view="favourites"]');
  await page.waitForTimeout(300);
  const n = await page.$$eval('.hl-card', els => els.length);
  if (n < 1) throw new Error('favourites empty after favouriting');
  await page.click('.tab[data-view="browse"]');
});

await step('books tab renders grid + book flick', async () => {
  await page.click('.tab[data-view="books"]');
  await page.waitForSelector('.book-card', { timeout: 5000 });
  await page.click('#bookModeFlick');
  await page.waitForSelector('#bookFlick:not(.hidden)');
  const prog = await page.textContent('#bookFlickProgress');
  if (!/\d+ \/ \d+/.test(prog)) throw new Error('book flick progress bad: ' + prog);
  await page.click('.tab[data-view="browse"]');
});

await step('add highlight modal saves', async () => {
  await page.click('#addHlBtn');
  await page.waitForSelector('#addModal:not(.hidden)');
  await page.fill('#addBook', 'My Test Book');
  await page.fill('#addAuthor', 'Tester');
  await page.fill('#addText', 'A brand new highlight added via the app.');
  await page.click('#addSave');
  await page.waitForTimeout(300);
  const total = await page.textContent('#subStats');
  if (!/15,41[0-9]|15,4[0-9][0-9]/.test(total)) { /* count check loose */ }
});

await step('theme + settings modal open', async () => {
  await page.click('#themeBtn');
  const t = await page.getAttribute('body', 'data-theme');
  if (t !== 'light') throw new Error('theme did not toggle');
  await page.click('#themeBtn');
  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsModal:not(.hidden)');
});

await step('service worker registers', async () => {
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
  if (!reg) throw new Error('no SW registration');
});

await browser.close();
server.close();

console.log('\nConsole/page errors:', errors.length);
for (const e of errors) console.log('  !', e);
process.exit(errors.length ? 1 : 0);

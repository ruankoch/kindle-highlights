import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p)); const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

// desktop dark - browse list
let page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.hl-card');
await page.click('#themeChips .chip'); await page.waitForTimeout(300);
await page.screenshot({ path: 'assets/shot-desktop-browse.png' });

// desktop flick
await page.click('#modeFlick'); await page.waitForTimeout(300);
await page.screenshot({ path: 'assets/shot-desktop-flick.png' });

// desktop light books
await page.click('#modeList');
await page.click('#themeBtn');
await page.click('.tab[data-view="books"]'); await page.waitForSelector('.book-card');
await page.screenshot({ path: 'assets/shot-desktop-books.png' });
await page.close();

// mobile
page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.hl-card');
await page.click('#modeFlick'); await page.waitForTimeout(300);
await page.screenshot({ path: 'assets/shot-mobile-flick.png' });
await page.click('#menuBtn'); await page.waitForTimeout(300);
await page.screenshot({ path: 'assets/shot-mobile-filters.png' });

await browser.close(); server.close();
console.log('screenshots written');

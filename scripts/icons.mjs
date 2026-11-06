// Draws the app's icons (client/public) from the קק״ס of the opening screen in client/index.html: the word in
// white on the blue of the course's mark at the top of every screen - the home screen's icon (iPhone and
// Android), the browser tab's, and the small one an Android phone shows in its status bar.
// Needs Playwright with its Chromium: NODE_PATH=<where playwright is> node scripts/icons.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${root}client/index.html`, 'utf8');
const logo = /<svg class="kks-logo"[\s\S]*?<\/svg>/.exec(html)[0];
const viewBox = /viewBox="([^"]+)"/.exec(logo)[1];
const [, , boxW, boxH] = viewBox.split(/\s+/).map(Number);
const paths = [...logo.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

// the mark's blue (apple.css .brand-mark): lighter at the top, as light falls on it
const FROM = '#496595'; // color-mix(in srgb, #1c3f7a 80%, #fff)
const TO = '#1c3f7a';
const BLUE = `linear-gradient(160deg, ${FROM} 0%, ${TO} 100%)`;

/** the word, white, as wide as asked */
const word = (width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${(width * boxH) / boxW}">${paths.map((d) => `<path d="${d}" fill="#fff"/>`).join('')}</svg>`;

// [file, size, the word's width as a share of it, on the blue (or clear, for the status bar's)]
// The home screen's icons fill their square - the phone rounds the corners, and Android cuts its own shape
// out of the middle: the word stays inside the circle that every shape keeps (80% across).
const PNGS = [
  ['apple-touch-icon.png', 180, 0.74, true],
  ['icon-192.png', 192, 0.74, true],
  ['icon-512.png', 512, 0.74, true],
  ['badge-96.png', 96, 0.9, false],
];

const browser = await chromium.launch();
for (const [name, size, share, blue] of PNGS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${blue ? BLUE : 'transparent'}">${word(Math.round(size * share))}</body></html>`,
  );
  await page.screenshot({ path: `${root}client/public/${name}`, omitBackground: !blue });
  await page.close();
  console.log('drawn', name);
}
await browser.close();

// the browser tab's: drawn as it is, its corners rounded as the mark's - the same 160° light as the CSS
// (on a square, the gradient's line runs from (0.28, -0.10) to (0.72, 1.10))
const share = 0.84;
const w = 64 * share;
const h = (w * boxH) / boxW;
writeFileSync(
  `${root}client/public/favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0.281" y1="-0.102" x2="0.719" y2="1.102"><stop offset="0" stop-color="${FROM}"/><stop offset="1" stop-color="${TO}"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <svg x="${((64 - w) / 2).toFixed(2)}" y="${((64 - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${viewBox}">${paths.map((d) => `<path d="${d}" fill="#fff"/>`).join('')}</svg>
</svg>
`,
);
console.log('drawn favicon.svg');

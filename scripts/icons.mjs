// Draws the app's icons (client/public) from the קק״ס of the opening screen in client/index.html, in the look of
// the course's mark at the top of every screen (look.css .brand-mark): a warm near-black, קק״ in white and the
// ס in a warm grey - the home screen's icon (iPhone and Android), the browser tab's,
// the small one an Android phone shows in its status bar, and the shortcuts' (a long press on the icon), whose
// symbols are the app's own (client/src/components/Icon.tsx).
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
// the word in its pieces (the opening screen moves them one by one): קק״, then the ס
const pieces = [...logo.matchAll(/<path class="([^"]+)" d="([^"]+)"/g)];
const paths = [pieces.filter((m) => !m[1].includes('kks-s')).map((m) => m[2]).join(''), pieces.find((m) => m[1].includes('kks-s'))[2]];

// the mark's ground (look.css .brand-mark): a little lighter at the top, at 150°
const FROM = '#2a2824';
const TO = '#121110';
const GROUND = `linear-gradient(150deg, ${FROM} 0%, ${TO} 100%)`;
const WHITE = '#fff';
const GREY = '#b3afa7';

/** the word as wide as asked: קק״ white and the ס grey - or all of it white (the status bar's reads only shape) */
const word = (width, plain = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${(width * boxH) / boxW}">${paths
    .map((d, i) => `<path d="${d}" fill="${plain || i === 0 ? WHITE : GREY}"/>`)
    .join('')}</svg>`;

// [file, size, the word's width as a share of it, on the ground (or clear, for the status bar's)]
// The home screen's icons fill their square - the phone rounds the corners, and Android cuts its own shape
// out of the middle: the word stays inside the circle that every shape keeps (80% across).
const PNGS = [
  ['apple-touch-icon.png', 180, 0.74, true],
  ['icon-192.png', 192, 0.74, true],
  ['icon-512.png', 512, 0.74, true],
  ['badge-96.png', 96, 0.9, false],
];

// the shortcuts (manifest.webmanifest): a symbol of the app's, white on the same ground
const icons = readFileSync(`${root}client/src/components/Icon.tsx`, 'utf8');
const glyph = (name) => {
  const m = new RegExp(`\\n  ${name}: '([^']+)'`).exec(icons);
  if (!m) throw new Error(`no icon named ${name} in Icon.tsx`);
  return m[1];
};
const SHORTCUTS = [
  ['task', 'plus'],
  ['weeknote', 'lightbulb'],
  ['my', 'my'],
  ['schedule', 'calendar'],
];
const symbol = (name, width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${width}" height="${width}" fill="none" stroke="${WHITE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${glyph(name)}"/></svg>`;

const browser = await chromium.launch();
const draw = async (file, size, inner, ground) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${ground ? GROUND : 'transparent'}">${inner}</body></html>`,
  );
  await page.screenshot({ path: `${root}client/public/${file}`, omitBackground: !ground });
  await page.close();
  console.log('drawn', file);
};
for (const [name, size, share, ground] of PNGS) await draw(name, size, word(Math.round(size * share), !ground), ground);
for (const [file, name] of SHORTCUTS) await draw(`shortcuts/${file}.png`, 96, symbol(name, 48), true);
await browser.close();

// the browser tab's: drawn as it is, its corners rounded as the mark's - the same 150° light as the CSS
// (on a square, the gradient's line runs from (0.158, -0.092) to (0.842, 1.092))
const share = 0.84;
const w = 64 * share;
const h = (w * boxH) / boxW;
writeFileSync(
  `${root}client/public/favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0.158" y1="-0.092" x2="0.842" y2="1.092"><stop offset="0" stop-color="${FROM}"/><stop offset="1" stop-color="${TO}"/></linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <svg x="${((64 - w) / 2).toFixed(2)}" y="${((64 - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${viewBox}">${paths
    .map((d, i) => `<path d="${d}" fill="${i === 0 ? WHITE : GREY}"/>`)
    .join('')}</svg>
</svg>
`,
);
console.log('drawn favicon.svg');

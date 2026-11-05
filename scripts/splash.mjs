// Draws the iPhone's launch images (client/public/splash) from the opening screen in client/index.html: the
// same קק״ס in the same place, its ס still - so as the app's page takes over, only the ס starts turning.
// With the default status bar the page begins under it, so each image draws the word as far down.
// Needs Playwright with its Chromium: NODE_PATH=<where playwright is> node scripts/splash.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${root}client/index.html`, 'utf8');
const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const boot = /<div id="boot"[\s\S]*?<\/svg>\s*<\/div>/.exec(html)[0];

// [the image's name, the screen in points, its scale, the status bar's height in points]
const SCREENS = [
  ['1320x2868', 440, 956, 3, 62],
  ['1260x2736', 420, 912, 3, 62],
  ['1206x2622', 402, 874, 3, 62],
  ['1290x2796', 430, 932, 3, 59],
  ['1179x2556', 393, 852, 3, 59],
  ['1284x2778', 428, 926, 3, 47],
  ['1170x2532', 390, 844, 3, 47],
  ['1125x2436', 375, 812, 3, 44],
  ['1242x2688', 414, 896, 3, 48],
  ['828x1792', 414, 896, 2, 48],
  ['750x1334', 375, 667, 2, 20],
];

const browser = await chromium.launch();
for (const [name, w, h, scale, bar] of SCREENS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: 'light' });
  await page.setContent(
    `<!doctype html><html lang="he" dir="rtl"><head><style>${style}
      #boot { top: ${bar}px; } #boot .kks-s { animation: none; }</style></head><body style="margin:0;background:#f2f2f7">${boot}</body></html>`,
  );
  await page.screenshot({ path: `${root}client/public/splash/${name}.png` });
  await page.close();
  console.log('drawn', name);
}
await browser.close();

// Builds the in-browser demo: the real app and the real server in one HTML page.
//   node demo/build.mjs  ->  dist/demo/kks-demo.html   (page content, for publishing)
//                            dist/demo/preview.html    (full document with a strict CSP, for testing)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const shim = (f) => `${root}demo/shims/${f}`;
const SQLJS = JSON.parse(readFileSync(`${root}node_modules/sql.js/package.json`, 'utf8')).version;
const SQLJS_PRIMARY = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS}/dist/sql-asm.js`;
const SQLJS_FALLBACK = `https://unpkg.com/sql.js@${SQLJS}/dist/sql-asm.js`;
const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&family=Karantina:wght@700&display=swap';

const out = await build({
  entryPoints: [`${root}demo/main.tsx`],
  bundle: true,
  write: false,
  outdir: 'out',
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  jsx: 'automatic',
  legalComments: 'none',
  charset: 'utf8',
  alias: {
    'node:sqlite': shim('sqlite.ts'),
    'node:crypto': shim('crypto.ts'),
    'node:fs': shim('fs.ts'),
    'node:path': shim('path.ts'),
    'node:url': shim('url.ts'),
    'node:zlib': shim('zlib.ts'),
    express: shim('express.ts'),
    'web-push': shim('web-push.ts'),
    '@shared': `${root}shared`,
  },
  inject: [shim('globals.ts')],
  plugins: [
    {
      // the page's frame cannot download by itself: saving goes through the viewer
      name: 'demo-download',
      setup(b) {
        b.onResolve({ filter: /\/lib\/download$/ }, (args) => (args.importer.includes('/client/src/') ? { path: `${root}demo/download.ts` } : undefined));
      },
    },
  ],
  define: {
    __KKS_DEMO__: 'true',
    __SQLJS_FALLBACK__: JSON.stringify(SQLJS_FALLBACK),
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
});

const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = out.outputFiles.find((f) => f.path.endsWith('.css')).text.replace(/<\/style/gi, '<\\/style');

const page = `<title>ניהול קורס קק"ס</title>
<meta name="description" content="מערכת ניהול קורס קק״ס - משימות, אחריות, דד-ליינים ותמונת מצב">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${css}</style>
<div id="root" dir="rtl"></div>
<script src="${SQLJS_PRIMARY}"></script>
<script>${js}</script>
`;

// the publishing host's rules, so a local test fails the same way the live page would
const csp = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  'img-src data: blob:',
  "connect-src 'none'",
  'worker-src blob:',
].join('; ');
const preview = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
</head>
<body>
${page}</body>
</html>
`;

mkdirSync(`${root}dist/demo`, { recursive: true });
writeFileSync(`${root}dist/demo/kks-demo.html`, page);
writeFileSync(`${root}dist/demo/preview.html`, preview);
console.log(`demo built: ${(page.length / 1024).toFixed(0)} KB (sql.js ${SQLJS} from CDN)`);

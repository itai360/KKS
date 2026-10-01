// Writes the Vercel deployment in Vercel's Build Output format (.vercel/output):
// the built app as static files, and the server as one bundled function.
// Run after `npm run build` (see the build:vercel script).

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api/index.func`;

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

// the server with all its packages in one file; node:sqlite and other built-ins stay external
await build({
  entryPoints: [`${root}server/src/vercel.ts`],
  outfile: `${fn}/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: false,
  legalComments: 'none',
  footer: { js: 'module.exports = module.exports.default;' },
});
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'commonjs' }));
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 30,
      memory: 1024,
      regions: ['fra1'],
    },
    null,
    2,
  ),
);

cpSync(`${root}dist/client`, `${out}/static`, { recursive: true });

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '/(.*)',
          headers: {
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'same-origin',
            'X-Frame-Options': 'DENY',
            'Strict-Transport-Security': 'max-age=31536000',
            'Content-Security-Policy': csp,
          },
          continue: true,
        },
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        // the path also travels as a parameter, in case the platform hands the function the rewritten URL
        { src: '^/api/(.*)$', dest: '/api/index?__path=$1' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
      ],
    },
    null,
    2,
  ),
);

console.log('vercel output written to .vercel/output');

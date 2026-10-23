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
      // a big Google calendar is read in the background after the request (calendar.ts), and a talk's
      // recording is written out and summed up by outside services (talkAi.ts) - up to a few minutes
      maxDuration: 300,
      memory: 1024,
      regions: ['fra1'],
    },
    null,
    2,
  ),
);

cpSync(`${root}dist/client`, `${out}/static`, { recursive: true });

// Google's sign-in button needs its script, style and frame - only where signing in with Google is on
// (server/src/google.ts); the same client set up for saving to Drive alone needs none of them
const signIn = !!process.env.GOOGLE_CLIENT_ID && /^(1|on|true|yes)$/i.test(process.env.GOOGLE_SIGN_IN ?? '');
const g = signIn ? ' https://accounts.google.com' : '';
const csp = [
  "default-src 'self'",
  `script-src 'self'${signIn ? ' https://accounts.google.com/gsi/client' : ''}`,
  "img-src 'self' data: blob:",
  `style-src 'self' 'unsafe-inline'${signIn ? ' https://accounts.google.com/gsi/style' : ''}`,
  "font-src 'self' data:",
  `connect-src 'self'${g}`,
  `frame-src${g || " 'none'"}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
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
            'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
            'Content-Security-Policy': csp,
            // no camera, microphone, location or payment for this site - nor for anything it shows
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()',
            // another site cannot hold a window of this one, nor read its files
            'Cross-Origin-Opener-Policy': signIn ? 'same-origin-allow-popups' : 'same-origin',
            'Cross-Origin-Resource-Policy': 'same-origin',
          },
          continue: true,
        },
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        // the app page and the service worker are checked on every load, so a new release is picked up at once
        { src: '^/(index\\.html|sw\\.js)?$', headers: { 'Cache-Control': 'no-cache' }, continue: true },
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

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { apiRouter } from './api';
import { csrfGuard, loadUser } from './auth';
import { courseScope } from './courses';
import { HttpError } from './core';
import { zodMessage } from './validation';

/**
 * Large answers (a long course's task list) go compressed: about a tenth of
 * the size on a phone's connection, and well inside the platform's response
 * limit. Small ones are not worth the work.
 */
function compressJson(req: Request, res: Response, next: NextFunction) {
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return next();
  const send = res.send.bind(res);
  res.send = (body?: unknown) => {
    if (typeof body === 'string' && body.length > 4096 && !res.getHeader('Content-Encoding') && /json/.test(String(res.getHeader('Content-Type') ?? ''))) {
      try {
        const zipped = gzipSync(body, { level: 6 });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        return send(zipped);
      } catch {
        /* sent as is */
      }
    }
    return send(body);
  };
  next();
}

export function createApp(opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // course data is always live: browsers must never answer from a stored copy (no ETag, no 304)
  app.set('etag', false);
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // Google's sign-in opens a window of its own
    res.setHeader('Cross-Origin-Opener-Policy', process.env.GOOGLE_CLIENT_ID ? 'same-origin-allow-popups' : 'same-origin');
    next();
  });

  app.use(
    '/api',
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    // Bulk grade previews include several workbooks, but remain below the cloud request cap.
    (req, res, next) => express.json({ limit: /^\/evaluations\/import\/(preview|apply)$/.test(req.path) ? '3mb' : '1mb' })(req, res, next),
    compressJson,
    loadUser,
    csrfGuard,
    courseScope,
    apiRouter(),
  );

  const staticDir = opts.staticDir;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(
      express.static(staticDir, {
        index: false,
        setHeaders(res, path) {
          if (path.includes(`${join('assets', '')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // Google's sign-in button needs its script and frame only when Google login is enabled
    const g = process.env.GOOGLE_CLIENT_ID ? ' https://accounts.google.com' : '';
    const csp = [
      "default-src 'self'",
      `script-src 'self'${g ? ' https://accounts.google.com/gsi/client' : ''}`,
      "img-src 'self' data: blob: https://*.googleusercontent.com",
      `style-src 'self' 'unsafe-inline'${g ? ' https://accounts.google.com/gsi/style' : ''}`,
      "font-src 'self' data:",
      `connect-src 'self'${g}`,
      `frame-src${g || " 'none'"}`,
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Content-Security-Policy', csp);
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(staticDir, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: zodMessage(err) });
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'הקובץ גדול מדי' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'בקשה לא תקינה' });
    console.error(err);
    res.status(500).json({ error: 'שגיאת שרת' });
  });

  return app;
}

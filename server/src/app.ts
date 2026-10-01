import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { apiRouter } from './api';
import { csrfGuard, loadUser } from './auth';
import { HttpError } from './core';

function zodMessage(e: ZodError): string {
  const issue = e.issues[0];
  if (!issue) return 'נתונים לא תקינים';
  const hebrew = /[֐-׿]/.test(issue.message);
  return hebrew ? issue.message : `שדה לא תקין: ${issue.path.join('.') || 'קלט'}`;
}

export function createApp(opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }), loadUser, csrfGuard, apiRouter());

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
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
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

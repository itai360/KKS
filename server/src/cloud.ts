// Serverless deployment (Vercel). Every instance keeps a copy of the SQLite
// database in /tmp; the shared copy lives in Supabase (Postgres). A request
// that changes data is saved with a version check; if another instance saved
// first, the request is replayed on the newer data, so concurrent edits are
// never lost.
//
// Storage is reached one of two ways:
// - KKS_STORE_URL: the kks-store Supabase function, which trusts the identity
//   token Vercel gives this function (OIDC). No secret to configure.
// - SUPABASE_URL + SUPABASE_KEY + KKS_SECRET: the database functions directly,
//   with a shared secret (supabase/migrations/0001_kks_storage.sql).
// Also: DATA_DIR, ADMIN_USERNAME / ADMIN_PASSWORD (first start only).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { inject, type Response as Injected } from 'light-my-request';
import type { Notification } from '../../shared/types';
import { createApp } from './app';
import { createUser, sessionToken, userForToken } from './auth';
import { runAutomation } from './automation';
import { config } from './core';
import { db, openDb } from './db';
import { setFileStore } from './files';
import { toNotification } from './journal';
import { pushesSettled } from './push';

const env = (k: string) => process.env[k] ?? '';
process.env.KKS_REALTIME = 'poll';
const dbPath = () => join(config.dataDir, 'kks.db');

let identityToken = ''; // Vercel's OIDC token for the request being served

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  if (env('KKS_SECRET')) {
    const missing = ['SUPABASE_URL', 'SUPABASE_KEY'].filter((k) => !env(k));
    if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);
    const key = env('SUPABASE_KEY');
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`; // legacy anon JWT
    res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify({ p_secret: env('KKS_SECRET'), ...args }) });
  } else if (env('KKS_STORE_URL')) {
    const token = identityToken || env('VERCEL_OIDC_TOKEN');
    if (!token) throw new Error('no Vercel identity token: enable OIDC for the project, or set KKS_SECRET');
    res = await fetch(env('KKS_STORE_URL'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fn, args }),
    });
  } else throw new Error('storage is not configured: set KKS_STORE_URL, or SUPABASE_URL, SUPABASE_KEY and KKS_SECRET');
  const text = await res.text();
  if (!res.ok) throw new Error(`storage ${fn} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

// ---------------- the database copy ----------------

let version = 0; // shared version this instance's copy matches (0: none loaded)
let stale = true; // the local copy may hold unsaved changes or be missing
let lastAutomation = 0;

const changes = () => db().get<{ n: number }>('SELECT total_changes() AS n')!.n;

function closeLocal(): void {
  try {
    db().close();
  } catch {
    /* nothing open yet */
  }
  for (const f of [dbPath(), `${dbPath()}-journal`, `${dbPath()}-wal`, `${dbPath()}-shm`]) if (existsSync(f)) rmSync(f);
}

async function reload(): Promise<void> {
  const rows = await rpc<{ version: number; data: string }[]>('kks_load');
  const row = rows[0];
  if (!row) return bootstrap();
  closeLocal();
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(dbPath(), Buffer.from(row.data, 'base64'));
  openDb(dbPath(), { wal: false }); // also applies schema migrations of a newer release
  version = Number(row.version);
  stale = false;
}

/** First start: an empty course (with the commander account, when configured). */
async function bootstrap(): Promise<void> {
  closeLocal();
  openDb(dbPath(), { wal: false });
  if (env('ADMIN_USERNAME') && env('ADMIN_PASSWORD')) {
    createUser({ username: env('ADMIN_USERNAME'), password: env('ADMIN_PASSWORD'), displayName: env('ADMIN_NAME') || 'מפקד הקורס', title: 'מפקד הקורס', role: 'commander' });
  }
  version = 0;
  if (!(await save())) await reload(); // another instance started it first
}

/** Saves the local copy if nobody saved since it was loaded. */
async function save(): Promise<boolean> {
  const data = readFileSync(dbPath()).toString('base64');
  try {
    const ok = await rpc<boolean>('kks_save', { p_expected: version, p_data: data });
    if (ok) {
      version += 1;
      stale = false;
    } else stale = true;
    return ok;
  } catch (e) {
    stale = true;
    throw e;
  }
}

async function ensureFresh(): Promise<void> {
  const shared = await rpc<number | null>('kks_version');
  if (shared === null) return bootstrap();
  if (stale || Number(shared) !== version) await reload();
}

// ---------------- requests ----------------

let app: ReturnType<typeof createApp> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** One request at a time per instance: a reload must never swap the database under a running request. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function prepare(): Promise<void> {
  if (!app) {
    setFileStore({
      put: (name, data) => rpc('kks_put_file', { p_name: name, p_data: data.toString('base64') }),
      get: async (name) => {
        const d = await rpc<string | null>('kks_get_file', { p_name: name });
        return d ? Buffer.from(d, 'base64') : null;
      },
      remove: (name) => rpc('kks_delete_file', { p_name: name }),
    });
    app = createApp();
  }
  await ensureFresh();
  // deadlines, reminders and recurring tasks: there is no always-on scheduler here
  if (Date.now() - lastAutomation > 60_000) {
    lastAutomation = Date.now();
    const before = changes();
    runAutomation();
    if (changes() !== before && !(await save())) await reload();
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, headers: Record<string, unknown>, body: Buffer | string): void {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || ['content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(k.toLowerCase())) continue;
    res.setHeader(k, v as string | string[]);
  }
  res.end(body);
}

const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, JSON.stringify(body));

/**
 * Live updates without a long-lived connection: the app asks every few
 * seconds whether anything changed and for its new notifications.
 */
function sync(req: IncomingMessage, res: ServerResponse): void {
  const user = userForToken(sessionToken(req as never));
  if (!user) return json(res, 401, { error: 'נדרשת התחברות' });
  const url = new URL(req.url ?? '/', 'http://x');
  const since = Number(url.searchParams.get('n'));
  const latest = db().get<{ n: number | null }>('SELECT max(id) AS n FROM notifications WHERE user_id = ?', user.id)!.n ?? 0;
  const notifications: Notification[] =
    Number.isFinite(since) && url.searchParams.has('n')
      ? db()
          .all<Parameters<typeof toNotification>[0]>('SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id LIMIT 20', user.id, since)
          .map(toNotification)
      : [];
  json(res, 200, { v: version, n: latest, notifications });
}

/** The request's own URL, whether the platform passes it as is or as the rewrite's __path. */
function originalUrl(raw: string): string {
  const u = new URL(raw, 'http://x');
  const path = u.searchParams.get('__path');
  if (path === null) return raw;
  u.searchParams.delete('__path');
  const pathname = u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/index') ? u.pathname : `/api/${path}`;
  const q = u.searchParams.toString();
  return pathname + (q ? `?${q}` : '');
}

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  req.url = originalUrl(req.url ?? '/');
  const token = req.headers['x-vercel-oidc-token'];
  if (typeof token === 'string' && token) identityToken = token;
  delete req.headers['x-vercel-oidc-token']; // never passed on to the app
  const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : await readBody(req);
  try {
    await serialized(async () => {
      await prepare();
      if ((req.url ?? '').startsWith('/api/sync')) return sync(req, res);
      const headers = { ...req.headers };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      let out: Injected | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const before = changes();
        out = await inject(app!, { method: req.method as 'GET', url: req.url ?? '/', headers, payload: body });
        if (changes() === before || (await save())) break;
        out = null;
        // someone saved first: wait a moment (spreads out simultaneous savers), then run the request again on their data
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
        await reload();
      }
      if (!out) return json(res, 409, { error: 'מישהו עדכן את אותם נתונים באותו רגע. נסו שוב.' });
      send(res, out.statusCode, out.headers, out.rawPayload);
    });
  } catch (e) {
    console.error('[cloud]', e);
    if (!res.headersSent) json(res, 503, { error: 'השרת לא זמין כרגע. נסו שוב בעוד רגע.' });
  }
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(pushesSettled());
  } catch {
    /* not on Vercel */
  }
}

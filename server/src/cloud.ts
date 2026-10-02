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
import { clock, config } from './core';
import { db, openDb } from './db';
import { setFileStore } from './files';
import { toNotification } from './journal';
import { pushesSettled } from './push';
import { setSnapshotProvider, storedSnapshots } from './snapshots';

const env = (k: string) => process.env[k] ?? '';
process.env.KKS_REALTIME = 'poll';
const dbPath = () => join(config.dataDir, 'kks.db');

let identityToken = ''; // Vercel's OIDC token for the request being served
let storageMs = 0; // time the request being served spent waiting on storage

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const t0 = Date.now();
  try {
    return await rpcOnce<T>(fn, args);
  } finally {
    storageMs += Date.now() - t0;
  }
}

async function rpcOnce<T>(fn: string, args: Record<string, unknown>): Promise<T> {
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
let checkedAt = 0; // when the copy was last known to match the shared one

// Reads use the local copy if it was checked in the last half minute, unless
// the browser has already seen a newer version (x-kks-v): everyone sees their
// own changes at once, and other people's changes arrive with the next poll,
// which checks more often. Writes stay safe regardless: every save is checked
// against the version.
const FRESH_MS = 30_000;
const SYNC_FRESH_MS = 4_000;

const changes = () => db().get<{ n: number }>('SELECT total_changes() AS n')!.n;

function closeLocal(): void {
  try {
    db().close();
  } catch {
    /* nothing open yet */
  }
  for (const f of [dbPath(), `${dbPath()}-journal`, `${dbPath()}-wal`, `${dbPath()}-shm`]) if (existsSync(f)) rmSync(f);
}

function install(v: number, data: string): void {
  closeLocal();
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(dbPath(), Buffer.from(data, 'base64'));
  openDb(dbPath(), { wal: false }); // also applies schema migrations of a newer release
  version = v;
  stale = false;
  checkedAt = Date.now();
}

let fetchOp = !env('KKS_SECRET'); // the kks-store function checks and loads in one call

/** The shared version, with the data when this copy does not match it. */
async function fetchShared(): Promise<{ version: number | null; data?: string }> {
  if (fetchOp) {
    try {
      return await rpc<{ version: number | null; data?: string }>('kks_fetch', { p_have: stale ? -1 : version });
    } catch (e) {
      if (!String(e).includes('(404)')) throw e;
      fetchOp = false; // an older kks-store function
    }
  }
  const shared = await rpc<number | null>('kks_version');
  if (shared === null || (!stale && Number(shared) === version)) return { version: shared === null ? null : Number(shared) };
  const row = (await rpc<{ version: number; data: string }[]>('kks_load'))[0];
  return row ? { version: Number(row.version), data: row.data } : { version: null };
}

/** First start: an empty course (with the commander account, when configured). */
async function bootstrap(): Promise<void> {
  closeLocal();
  openDb(dbPath(), { wal: false });
  if (env('ADMIN_USERNAME') && env('ADMIN_PASSWORD')) {
    createUser({ username: env('ADMIN_USERNAME'), password: env('ADMIN_PASSWORD'), displayName: env('ADMIN_NAME') || 'מפקד הקורס', title: 'מפקד הקורס', role: 'commander' });
  }
  version = 0;
  if (!(await save())) await ensureFresh(0); // another instance started it first
}

/** Saves the local copy if nobody saved since it was loaded. */
async function save(): Promise<boolean> {
  const data = readFileSync(dbPath()).toString('base64');
  try {
    const ok = await rpc<boolean>('kks_save', { p_expected: version, p_data: data });
    if (ok) {
      version += 1;
      stale = false;
      checkedAt = Date.now();
    } else stale = true;
    return ok;
  } catch (e) {
    stale = true;
    throw e;
  }
}

/** Returns true when it relied on a recent check instead of asking storage. */
async function ensureFresh(maxAge = FRESH_MS): Promise<boolean> {
  if (!stale && Date.now() - checkedAt < maxAge) return true;
  const shared = await fetchShared();
  if (shared.version === null) await bootstrap();
  else if (shared.data !== undefined) install(shared.version, shared.data);
  else checkedAt = Date.now();
  return false;
}

// ---------------- requests ----------------

let app: ReturnType<typeof createApp> | null = null;
let snapshots: ReturnType<typeof storedSnapshots> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** One request at a time per instance: a reload must never swap the database under a running request. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function prepare(maxAge: number): Promise<boolean> {
  if (!app) {
    setFileStore({
      put: (name, data) => rpc('kks_put_file', { p_name: name, p_data: data.toString('base64') }),
      get: async (name) => {
        const d = await rpc<string | null>('kks_get_file', { p_name: name });
        return d ? Buffer.from(d, 'base64') : null;
      },
      remove: (name) => rpc('kks_delete_file', { p_name: name }),
    });
    // snapshots of the shared copy, in the same file storage as uploads
    snapshots = storedSnapshots(
      {
        put: (name, data) => rpc('kks_put_file', { p_name: name, p_data: data }),
        get: (name) => rpc<string | null>('kks_get_file', { p_name: name }),
        remove: (name) => rpc('kks_delete_file', { p_name: name }),
      },
      () => ({ data: readFileSync(dbPath()), version }),
    );
    setSnapshotProvider(snapshots);
    app = createApp();
  }
  const recent = await ensureFresh(maxAge);
  // deadlines, reminders and recurring tasks: there is no always-on scheduler here
  if (Date.now() - lastAutomation > 60_000) {
    lastAutomation = Date.now();
    const before = changes();
    runAutomation();
    // a snapshot of the database every half hour while people work (settings -> backups)
    if (snapshots?.autoDue(clock.now().getTime(), version)) await snapshots.take('auto').catch((e) => console.error('[snapshots]', e));
    if (changes() !== before && !(await save())) await ensureFresh(0);
  }
  return recent;
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
  res.setHeader('x-kks-v', String(version)); // the browser sends back the newest version it has seen
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

/** A request that never finishes must not hold up the ones queued behind it. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`request did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  req.url = originalUrl(req.url ?? '/');
  // no long-lived connections here; 204 tells a browser's EventSource not to reconnect
  if (req.url.startsWith('/api/stream')) return send(res, 204, { 'cache-control': 'no-store' }, '');
  const seen = Number(req.headers['x-kks-v']);
  const token = req.headers['x-vercel-oidc-token'];
  if (typeof token === 'string' && token) identityToken = token;
  delete req.headers['x-vercel-oidc-token']; // never passed on to the app
  const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : await readBody(req);
  const arrived = Date.now();
  let started = 0;
  try {
    await serialized(async () => {
      started = Date.now();
      storageMs = 0;
      const isSync = (req.url ?? '').startsWith('/api/sync');
      // the browser has seen a newer version than this copy: it must not get older data
      let recent = await prepare(Number.isFinite(seen) && seen > version ? 0 : isSync ? SYNC_FRESH_MS : FRESH_MS);
      if (isSync) return sync(req, res);
      const headers = { ...req.headers };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      let out: Injected | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const before = changes();
        out = await withTimeout(inject(app!, { method: req.method as 'GET', url: req.url ?? '/', headers, payload: body }), 20_000);
        if (changes() === before) {
          // a session or record created a moment ago on another instance: check storage and try again
          if (recent && (out.statusCode === 401 || out.statusCode === 404)) {
            recent = false;
            await ensureFresh(0);
            continue;
          }
          break;
        }
        if (await save()) break;
        out = null;
        // someone saved first: wait a moment (spreads out simultaneous savers), then run the request again on their data
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
        await ensureFresh(0);
      }
      if (!out) return json(res, 409, { error: 'מישהו עדכן את אותם נתונים באותו רגע. נסו שוב.' });
      send(res, out.statusCode, out.headers, out.rawPayload);
    });
  } catch (e) {
    console.error('[cloud]', e);
    if (!res.headersSent) json(res, 503, { error: 'השרת לא זמין כרגע. נסו שוב בעוד רגע.' });
  }
  const total = Date.now() - arrived;
  if (total > 1500) console.warn(`[slow] ${req.method} ${req.url} ${res.statusCode} ${total}ms (queued ${started ? started - arrived : total}ms, storage ${storageMs}ms)`);
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(pushesSettled());
  } catch {
    /* not on Vercel */
  }
}

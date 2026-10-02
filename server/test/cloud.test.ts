// The serverless storage layer (cloud.ts): first start, saving, and replaying a
// request when another instance saved first. Supabase is replaced by an
// in-memory implementation of its database functions.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'light-my-request';
import { beforeAll, describe, expect, it } from 'vitest';

const store: { state: { version: number; data: string } | null; files: Map<string, string> } = { state: null, files: new Map() };
const rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {
  kks_version: () => store.state?.version ?? null,
  kks_load: () => (store.state ? [store.state] : []),
  kks_save: ({ p_expected, p_data }) => {
    if (p_expected === 0) return store.state ? false : ((store.state = { version: 1, data: String(p_data) }), true);
    const cur = store.state;
    if (!cur || cur.version !== p_expected) return false;
    store.state = { version: cur.version + 1, data: String(p_data) };
    return true;
  },
  kks_put_file: ({ p_name, p_data }) => void store.files.set(String(p_name), String(p_data)),
  kks_get_file: ({ p_name }) => store.files.get(String(p_name)) ?? null,
  kks_delete_file: ({ p_name }) => void store.files.delete(String(p_name)),
};

let handler: (req: never, res: never) => Promise<void>;
const calls: string[] = [];

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'kks-cloud-'));
  process.env.SUPABASE_URL = 'http://storage.test';
  process.env.SUPABASE_KEY = 'anon';
  process.env.KKS_SECRET = 'secret';
  process.env.ADMIN_USERNAME = 'boss';
  process.env.ADMIN_PASSWORD = 'secret123';
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const fn = String(url).split('/rpc/')[1];
    calls.push(fn);
    const args = JSON.parse(String(init.body));
    if (args.p_secret !== 'secret') return new Response('{"message":"unauthorized"}', { status: 403 });
    const out = rpcs[fn](args);
    return new Response(out === undefined ? '' : JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  ({ handler } = (await import('../src/cloud')) as unknown as { handler: typeof handler });
});

const call = (method: string, url: string, body?: unknown, cookie = '') =>
  inject(handler as never, { method: method as 'GET', url, headers: { 'x-kks': '1', 'content-type': 'application/json', cookie }, payload: body === undefined ? undefined : JSON.stringify(body) });

describe('serverless storage', () => {
  it('creates the course with the commander account on first start and saves every change', async () => {
    const info = await call('GET', '/api/public/info');
    expect(info.json()).toMatchObject({ needsSetup: false, realtime: 'poll' });
    expect(store.state?.version).toBe(1);

    const login = await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' });
    expect(login.statusCode).toBe(200);
    expect(store.state?.version).toBe(2); // the new session is shared by every instance
    const cookie = String(login.headers['set-cookie']).split(';')[0];

    const reads = await call('GET', '/api/tasks', undefined, cookie);
    expect(reads.statusCode).toBe(200);
    expect(store.state?.version).toBe(2); // reading saves nothing
  });

  it('replays a request on newer data when another instance saved first', async () => {
    const cookie = String((await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' })).headers['set-cookie']).split(';')[0];
    const staff = await call('POST', '/api/users', { username: 's1', password: 'secret123', displayName: 'מפק"צ 1', role: 'staff' }, cookie);
    const s1 = staff.json().id;

    // another instance adds a task: same database file, one version ahead
    const { DatabaseSync } = await import('node:sqlite');
    const { writeFileSync, readFileSync } = await import('node:fs');
    const other = join(process.env.DATA_DIR!, 'other.db');
    writeFileSync(other, Buffer.from(store.state!.data, 'base64'));
    const odb = new DatabaseSync(other);
    odb.exec(`INSERT INTO meta(key, value) VALUES ('other_instance', 'was here')`);
    odb.close();
    store.state = { version: store.state!.version + 1, data: readFileSync(other).toString('base64') };

    // this instance still holds the older copy until the next request reloads it
    const res = await call('POST', '/api/tasks', { title: 'בדיקה', ownerIds: [s1], deadline: new Date(Date.now() + 86_400_000).toISOString() }, cookie);
    expect(res.statusCode).toBe(200);
    const check = join(process.env.DATA_DIR!, 'check.db');
    writeFileSync(check, Buffer.from(store.state!.data, 'base64'));
    const cdb = new DatabaseSync(check);
    expect(cdb.prepare("SELECT value FROM meta WHERE key = 'other_instance'").get()).toEqual({ value: 'was here' });
    expect(cdb.prepare("SELECT title FROM tasks WHERE title = 'בדיקה'").get()).toEqual({ title: 'בדיקה' });
    cdb.close();
  });

  it('keeps uploaded files in the shared store', async () => {
    const cookie = String((await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' })).headers['set-cookie']).split(';')[0];
    const up = await inject(handler as never, {
      method: 'POST',
      url: `/api/documents/file?title=${encodeURIComponent('נוהל')}&category=${encodeURIComponent('נהלים')}`,
      headers: { 'x-kks': '1', 'content-type': 'text/plain', 'x-filename': 'a.txt', cookie },
      payload: 'תוכן',
    });
    expect(up.statusCode).toBe(200);
    expect(store.files.size).toBe(1);
    const doc = up.json().find((d: { title: string }) => d.title === 'נוהל');
    const dl = await call('GET', doc.url, undefined, cookie);
    expect(dl.body).toBe('תוכן');
  });

  it('answers the live-update poll with the shared version', async () => {
    const cookie = String((await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' })).headers['set-cookie']).split(';')[0];
    const r = await call('GET', '/api/sync', undefined, cookie);
    expect(r.json()).toMatchObject({ v: store.state!.version, notifications: [] });
    expect((await call('GET', '/api/sync')).statusCode).toBe(401);
  });

  it('one storage check covers the requests of a screen, and a fresh session from another instance still works', async () => {
    const cookie = String((await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' })).headers['set-cookie']).split(';')[0];
    calls.length = 0;
    for (const url of ['/api/tasks', '/api/weeks', '/api/dashboard']) expect((await call('GET', url, undefined, cookie)).statusCode).toBe(200);
    expect(calls.filter((c) => c === 'kks_version').length).toBe(0); // all within the moment after the login was saved

    // another instance signs someone in: a session this instance's copy does not have yet
    const { createHash } = await import('node:crypto');
    const { DatabaseSync } = await import('node:sqlite');
    const { writeFileSync, readFileSync } = await import('node:fs');
    const other = join(process.env.DATA_DIR!, 'other-session.db');
    writeFileSync(other, Buffer.from(store.state!.data, 'base64'));
    const odb = new DatabaseSync(other);
    const hash = createHash('sha256').update('token-from-elsewhere').digest('hex');
    odb.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)').run(hash, new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    odb.close();
    store.state = { version: store.state!.version + 1, data: readFileSync(other).toString('base64') };

    const me = await call('GET', '/api/auth/me', undefined, 'kks_session=token-from-elsewhere');
    expect(me.statusCode).toBe(200); // the 401 from the older copy triggered a check and a second try
  });

  it('a browser that has seen a newer version never gets the older copy, even right after a check', async () => {
    const cookie = String((await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' })).headers['set-cookie']).split(';')[0];
    expect((await call('GET', '/api/public/info')).json().courseName).not.toBe('שם מהמופע השני');

    // another instance renames the course
    const { DatabaseSync } = await import('node:sqlite');
    const { writeFileSync, readFileSync } = await import('node:fs');
    const other = join(process.env.DATA_DIR!, 'other-settings.db');
    writeFileSync(other, Buffer.from(store.state!.data, 'base64'));
    const odb = new DatabaseSync(other);
    odb.prepare("INSERT INTO settings(key, value) VALUES ('courseName', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify('שם מהמופע השני'));
    odb.close();
    const newer = store.state!.version + 1;
    store.state = { version: newer, data: readFileSync(other).toString('base64') };

    // within the half minute this copy answers on its own...
    const stale = await call('GET', '/api/settings', undefined, cookie);
    expect(stale.json().courseName).not.toBe('שם מהמופע השני');
    expect(Number(stale.headers['x-kks-v'])).toBe(newer - 1);

    // ...but not to a browser that already saw the newer version (from a poll or its own save)
    const fresh = await inject(handler as never, { method: 'GET', url: '/api/settings', headers: { cookie, 'x-kks-v': String(newer) } });
    expect(fresh.json().courseName).toBe('שם מהמופע השני'); // read again from the new copy, not from a cache
    expect(Number(fresh.headers['x-kks-v'])).toBe(newer);
  });

  it('never lets the browser keep a stored copy of course data', async () => {
    const r = await call('GET', '/api/public/info');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers.etag).toBeUndefined();
    const again = await inject(handler as never, { method: 'GET', url: '/api/public/info', headers: { 'if-none-match': 'W/"anything"' } });
    expect(again.statusCode).toBe(200);
  });

  it('answers a live-update stream at once instead of holding the instance', async () => {
    const r = await call('GET', '/api/stream');
    expect(r.statusCode).toBe(204);
    expect((await call('GET', '/api/public/info')).statusCode).toBe(200); // nothing is stuck behind it
  });
  it('takes a snapshot in storage and restores it as a new saved version', async () => {
    const cookie = String((await call('POST', '/api/auth/login', { username: 'boss', password: 'secret123' })).headers['set-cookie']).split(';')[0];
    const make = (title: string) => call('POST', '/api/tasks', { title, ownerIds: [1], deadline: '2026-12-01T16:00:00.000Z' }, cookie);
    await make('נשמרה בגיבוי');
    expect((await call('POST', '/api/admin/snapshots', {}, cookie)).statusCode).toBe(200);
    const [snap] = (await call('GET', '/api/admin/snapshots', undefined, cookie)).json();
    expect(snap).toMatchObject({ label: 'manual' });
    const ids = (await call('GET', '/api/tasks', undefined, cookie)).json().map((t: { id: number }) => t.id);
    await call('POST', '/api/bulk', { entity: 'tasks', action: 'delete', ids }, cookie);
    expect((await call('GET', '/api/tasks', undefined, cookie)).json()).toHaveLength(0);

    const before = store.state!.version;
    expect((await call('POST', `/api/admin/snapshots/${snap.id}/restore`, {}, cookie)).statusCode).toBe(200);
    expect(store.state!.version).toBe(before + 1); // saved for every instance
    const titles = (await call('GET', '/api/tasks', undefined, cookie)).json().map((t: { title: string }) => t.title);
    expect(titles).toContain('נשמרה בגיבוי');
    const labels = (await call('GET', '/api/admin/snapshots', undefined, cookie)).json().map((x: { label: string }) => x.label);
    expect(labels).toEqual(expect.arrayContaining(['manual', 'before_restore']));
    expect([...store.files.keys()].filter((k) => k.startsWith('snapshots/')).length).toBeGreaterThanOrEqual(2); // kept in file storage
    expect((await call('POST', '/api/admin/snapshots/999/restore', {}, cookie)).statusCode).toBe(404);
  });
});

// The Vercel deployment's storage path without a shared secret: requests to
// the kks-store function carry the identity token Vercel gave the function.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'light-my-request';
import { beforeAll, describe, expect, it } from 'vitest';

const STORE = 'https://store.test/functions/v1/kks-store';
let state: { version: number; data: string } | null = null;
const seen: { auth: string | null; fn: string }[] = [];
let oldStore = false; // a kks-store function from before kks_fetch
let handler: (req: never, res: never) => Promise<void>;

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'kks-oidc-'));
  process.env.KKS_STORE_URL = STORE;
  delete process.env.KKS_SECRET;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    expect(url).toBe(STORE);
    const auth = new Headers(init.headers).get('authorization');
    const { fn, args } = JSON.parse(String(init.body));
    seen.push({ auth, fn });
    if (auth !== 'Bearer vercel-token') return new Response('{"message":"unauthorized"}', { status: 401 });
    if (fn === 'kks_fetch' && oldStore) return new Response('{"message":"unknown operation"}', { status: 404 });
    const out =
      fn === 'kks_fetch'
        ? !state
          ? { version: null }
          : state.version === args.p_have
            ? { version: state.version }
            : state
        : fn === 'kks_version'
        ? (state?.version ?? null)
        : fn === 'kks_load'
          ? state
            ? [state]
            : []
          : fn === 'kks_save'
            ? args.p_expected === (state?.version ?? 0) && ((state = { version: (state?.version ?? 0) + 1, data: args.p_data }), true)
            : null;
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  ({ handler } = (await import('../src/cloud')) as unknown as { handler: typeof handler });
});

describe('storage through the kks-store function', () => {
  it('passes the Vercel identity token and keeps it away from the app', async () => {
    const r = await inject(handler as never, { method: 'GET', url: '/api/public/info', headers: { 'x-vercel-oidc-token': 'vercel-token' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ needsSetup: true, realtime: 'poll' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.auth === 'Bearer vercel-token')).toBe(true);
    expect(state?.version).toBe(1); // the empty course was saved on first start
  });

  it('first-time setup works end to end', async () => {
    const r = await inject(handler as never, {
      method: 'POST',
      url: '/api/setup',
      headers: { 'x-kks': '1', 'content-type': 'application/json', 'x-vercel-oidc-token': 'vercel-token' },
      payload: JSON.stringify({ courseName: 'קורס בדיקה', courseSymbol: 'קק"ס', username: 'boss', password: 'secret123', displayName: 'מפקד' }),
    });
    expect(r.statusCode).toBe(200);
    expect(state!.version).toBeGreaterThan(1);
  });

  it('checks and loads in one call', async () => {
    seen.length = 0;
    state = { ...state!, version: state!.version + 1 }; // another instance saved
    const r = await inject(handler as never, { method: 'GET', url: '/api/public/info', headers: { 'x-vercel-oidc-token': 'vercel-token', 'x-kks-v': String(state!.version) } });
    expect(r.statusCode).toBe(200);
    expect(seen.map((s) => s.fn)).toEqual(['kks_fetch']);
  });

  it('still works with an older kks-store function', async () => {
    oldStore = true;
    seen.length = 0;
    state = { ...state!, version: state!.version + 1 };
    const r = await inject(handler as never, { method: 'GET', url: '/api/public/info', headers: { 'x-vercel-oidc-token': 'vercel-token', 'x-kks-v': String(state!.version) } });
    expect(r.statusCode).toBe(200);
    expect(seen.map((s) => s.fn)).toEqual(['kks_fetch', 'kks_version', 'kks_load']);
  });
});

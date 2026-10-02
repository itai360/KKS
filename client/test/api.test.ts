// The browser's request layer when a session ends mid-work: it asks to sign in
// again (once, however many requests were refused) and then sends them again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, changedFields, setReauthHandler, setUnauthorizedHandler } from '../src/lib/api';

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let signedIn: boolean;

beforeEach(() => {
  calls = [];
  signedIn = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    const ok = signedIn || url.startsWith('/api/auth/login');
    return new Response(JSON.stringify(ok ? { ok: true, url } : { error: 'נדרשת התחברות' }), { status: ok ? 200 : 401 });
  });
});
afterEach(() => {
  setReauthHandler(null);
  vi.unstubAllGlobals();
});

describe('a session that ends while the app is open', () => {
  it('asks to sign in again, then sends the refused change again', async () => {
    let asked = 0;
    setReauthHandler(async () => {
      asked++;
      signedIn = true;
      return true;
    });
    const out = await api.post<{ ok: boolean }>('/api/cadets/3/records', { title: 'מה שהוקלד' });
    expect(out.ok).toBe(true);
    expect(asked).toBe(1);
    expect(calls.map((c) => c.url)).toEqual(['/api/cadets/3/records', '/api/cadets/3/records']);
    expect(calls[1].body).toEqual({ title: 'מה שהוקלד' });
  });

  it('asks once for many refused requests', async () => {
    let asked = 0;
    let release!: () => void;
    setReauthHandler(() => {
      asked++;
      return new Promise((resolve) => {
        release = () => {
          signedIn = true;
          resolve(true);
        };
      });
    });
    const all = Promise.all([api.get('/api/tasks'), api.get('/api/weeks'), api.post('/api/tasks', { title: 'x' })]);
    await vi.waitFor(() => expect(asked).toBe(1));
    expect(calls).toHaveLength(3);
    release();
    await all;
    expect(asked).toBe(1);
    expect(calls).toHaveLength(6);
  });

  it('gives up when the person chooses to leave, and never asks about a failed sign-in', async () => {
    setReauthHandler(async () => false);
    await expect(api.post('/api/tasks', { title: 'x' })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);

    let asked = 0;
    setReauthHandler(async () => {
      asked++;
      return true;
    });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'שם משתמש או סיסמה שגויים' }), { status: 401 }));
    await expect(api.post('/api/auth/login', { username: 'a', password: 'b' })).rejects.toBeInstanceOf(ApiError);
    expect(asked).toBe(0);
  });

  it('with no open session to save, falls back to the sign-in screen', async () => {
    let shown = false;
    setUnauthorizedHandler(() => {
      shown = true;
    });
    await expect(api.get('/api/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(shown).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('a double click', () => {
  it('sends the same change once while the first is on its way; a different one goes through', async () => {
    signedIn = true;
    const [a, b] = await Promise.all([api.post('/api/debriefs', { title: 'תחקיר' }), api.post('/api/debriefs', { title: 'תחקיר' })]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
    await Promise.all([api.post('/api/debriefs', { title: 'תחקיר' }), api.post('/api/debriefs', { title: 'תחקיר אחר' })]);
    expect(calls).toHaveLength(3);
    // once answered, the same change may be sent again on purpose
    await api.post('/api/debriefs', { title: 'תחקיר' });
    expect(calls).toHaveLength(4);
  });
});

describe('saving an edit', () => {
  it('sends only what the form changed, so a change made meanwhile by someone else stays', () => {
    const before = { firstName: 'דנה', phone: '050', status: 'active', teamId: null, notes: '' };
    expect(changedFields(before, { ...before, phone: '052' })).toEqual({ phone: '052' });
    expect(changedFields(before, { ...before })).toEqual({});
    // missing and empty-null count as the same
    expect(changedFields({ teamId: undefined }, { teamId: null })).toEqual({});
    expect(changedFields<{ leadId: number | null }>({ leadId: 3 }, { leadId: null })).toEqual({ leadId: null });
  });
});

// Snapshots of the database (local server): taking, listing, keeping, restoring.

import { mkdtempSync, readdirSync } from 'node:fs';
import request from 'supertest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SnapshotInfo } from '../../shared/types';
import { clock, config } from '../src/core';
import { db } from '../src/db';
import { autoSnapshot, storedSnapshots, toPrune } from '../src/snapshots';
import { base32Decode, totp } from '../src/twofactor';
import { newTask, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-snap-'));
  c = await setup();
});

const titles = () => db().all<{ title: string }>('SELECT title FROM tasks ORDER BY id').map((t) => t.title);

describe('snapshots', () => {
  it('only the commander takes, lists and restores them', async () => {
    expect((await c.s1.get('/api/admin/snapshots')).status).toBe(403);
    expect((await c.s1.post('/api/admin/snapshots', {})).status).toBe(403);
    expect((await c.cmd.post('/api/admin/snapshots', {})).status).toBe(200);
    const list = (await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: 'manual' });
    expect(list[0].bytes).toBeGreaterThan(0);
    expect((await c.s1.post(`/api/admin/snapshots/${list[0].id}/restore`, {})).status).toBe(403);
  });

  it('a restore brings back what was deleted and keeps everyone logged in', async () => {
    await newTask(c.cmd, { title: 'לפני הגיבוי', ownerIds: [c.ids.s1] });
    await c.cmd.post('/api/admin/snapshots', {});
    const [snap] = (await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[];
    const ids = db().all<{ id: number }>('SELECT id FROM tasks').map((t) => t.id);
    await c.cmd.post('/api/bulk', { entity: 'tasks', action: 'delete', ids });
    await newTask(c.cmd, { title: 'אחרי הגיבוי', ownerIds: [c.ids.s1] });
    expect(titles()).toEqual(['אחרי הגיבוי']);

    const res = await c.cmd.post(`/api/admin/snapshots/${snap.id}/restore`, {});
    expect(res.status).toBe(200);
    expect(titles()).toEqual(['לפני הגיבוי']);
    // the sessions are the current ones: both still work
    expect((await c.cmd.get('/api/auth/me')).status).toBe(200);
    expect((await c.s1.get('/api/my')).status).toBe(200);
    // and the state before the restore is kept, in case it was the wrong one
    const labels = ((await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[]).map((s) => s.label);
    expect(labels).toContain('before_restore');
    expect((await c.cmd.post('/api/admin/snapshots/nope~manual/restore', {})).status).toBe(404);
  });

  it('never takes back account safety: a newer password, two-step sign-in, a closed account', async () => {
    await c.cmd.post('/api/admin/snapshots', {});
    const [snap] = (await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[];
    // since the snapshot: a new password (the old one leaked), two-step sign-in, an account closed
    expect((await c.s1.post('/api/auth/password', { current: 'secret123', next: 'NewPass-2026' })).status).toBe(200);
    const { secret } = (await c.cmd.post('/api/auth/2fa/setup', { password: 'secret123' })).body;
    const step = Math.floor(clock.now().getTime() / 30_000);
    expect((await c.cmd.post('/api/auth/2fa/enable', { code: totp(base32Decode(secret), step) })).status).toBe(200);
    await c.cmd.patch(`/api/users/${c.ids.s2}`, { active: false });

    expect((await c.cmd.post(`/api/admin/snapshots/${snap.id}/restore`, {})).status).toBe(200);
    const login = (username: string, password: string) => request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username, password });
    expect((await login('s1', 'secret123')).status).toBe(401);
    expect((await login('s1', 'NewPass-2026')).body.user).toBeTruthy();
    expect((await login('cmd', 'secret123')).body).toMatchObject({ twoFactor: true });
    expect((await c.cmd.get('/api/auth/me')).body.recoveryLeft).toBe(10);
    expect((await login('s2', 'secret123')).status).toBe(401);
  });

  it('brings back the course settings too, not a remembered copy of them', async () => {
    const before = (await c.cmd.get('/api/settings')).body.courseName;
    await c.cmd.post('/api/admin/snapshots', {});
    const [snap] = (await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[];
    await c.cmd.patch('/api/settings', { courseName: 'שם אחר לגמרי' });
    expect((await c.cmd.get('/api/settings')).body.courseName).toBe('שם אחר לגמרי');
    await c.cmd.post(`/api/admin/snapshots/${snap.id}/restore`, {});
    expect((await c.cmd.get('/api/settings')).body.courseName).toBe(before);
    expect((await c.cmd.post('/api/admin/snapshots/..%2F..%2Fkks~manual/restore', {})).status).toBe(404);
  });

  it('deleting many items at once takes a snapshot first', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await newTask(c.cmd, { title: `משימה ${i}`, ownerIds: [c.ids.s1] }));
    await c.cmd.post('/api/bulk', { entity: 'tasks', action: 'delete', ids: ids.slice(0, 2) });
    expect((await c.cmd.get('/api/admin/snapshots')).body).toHaveLength(0); // two: not worth one
    await c.cmd.post('/api/bulk', { entity: 'tasks', action: 'delete', ids: ids.slice(2).concat(ids.slice(0, 2)) });
    const list = (await c.cmd.get('/api/admin/snapshots')).body as SnapshotInfo[];
    expect(list.map((s) => s.label)).toEqual(['before_delete']);
  });

  it('takes an automatic one every half hour, only when something changed', async () => {
    const t0 = Date.now() + 3_600_000;
    expect(await autoSnapshot(t0)).toBe(true);
    expect(await autoSnapshot(t0 + 31 * 60_000)).toBe(false); // nothing changed since
    await newTask(c.cmd, { title: 'שינוי', ownerIds: [c.ids.s1] });
    expect(await autoSnapshot(t0 + 10 * 60_000)).toBe(false); // too soon
    expect(await autoSnapshot(t0 + 31 * 60_000)).toBe(true);
    expect(readdirSync(join(config.dataDir, 'snapshots')).filter((f) => f.includes('~auto'))).toHaveLength(2);
  });

  it('keeps the latest automatic ones, the last of each day for a month, the others for a month', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const at = (iso: string, label: SnapshotInfo['label'] = 'auto', id = iso): SnapshotInfo => ({ id, savedAt: iso, label, bytes: 1 });
    const recent = Array.from({ length: 50 }, (_, i) => at(new Date(now.getTime() - i * 30 * 60_000).toISOString()));
    const old = [at('2026-10-01T08:00:00.000Z'), at('2026-10-01T20:00:00.000Z'), at('2026-09-01T10:00:00.000Z')];
    const others = [at('2026-10-10T10:00:00.000Z', 'manual'), at('2026-09-10T10:00:00.000Z', 'before_delete')];
    const gone = toPrune([...recent, ...old, ...others], now);
    // the two oldest of the 50 recent ones fall on a day that still has a later one kept
    expect(gone).toEqual(expect.arrayContaining([recent[48].id, recent[49].id, old[0].id, old[2].id, others[1].id]));
    expect(gone).not.toContain(old[1].id); // the last one of 1.10
    expect(gone).not.toContain(others[0].id);
    expect(gone).not.toContain(recent[47].id);
  });
  it('in file storage (the serverless deployment): listed in the database, due every half hour of changes', async () => {
    const files = new Map<string, string>();
    let version = 1;
    const stored = storedSnapshots(
      { put: async (n, d) => files.set(n, d), get: async (n) => files.get(n) ?? null, remove: async (n) => files.delete(n) },
      () => ({ data: Buffer.from('sqlite file'), version }),
    );
    const t0 = clock.now().getTime();
    expect(stored.autoDue(t0, version)).toBe(false); // nothing saved since the course was created
    version = 5;
    expect(stored.autoDue(t0, version)).toBe(true);
    await stored.take('auto');
    expect(stored.autoDue(t0 + 31 * 60_000, version)).toBe(false); // nothing saved since
    expect(stored.autoDue(t0 + 10 * 60_000, version + 1)).toBe(false); // too soon
    expect(stored.autoDue(t0 + 31 * 60_000, version + 1)).toBe(true);
    const [snap] = await stored.list();
    expect(snap).toMatchObject({ label: 'auto', bytes: 11 });
    expect([...files.keys()]).toEqual([`snapshots/${snap.id}.db`]);
    await expect(stored.fetch('20260101T000000000Z~auto', join(config.dataDir, 'x.db'))).rejects.toThrow('לא נמצא');
  });
});

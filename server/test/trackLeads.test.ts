// Tracks that lost their lead: who led each is found in the automatic backups, with when it was last there,
// and put back by the commander.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TrackLeadHistory } from '../../shared/types';
import { config } from '../src/core';
import { setSnapshotProvider } from '../src/snapshots';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-leads-'));
  setSnapshotProvider(null);
  c = await setup();
});

describe('tracks that lost their lead', () => {
  it('finds each lead in the backups, and the commander puts it back', async () => {
    const a = (await c.cmd.post('/api/tracks', { name: 'ציר שטח', leadId: c.ids.s1 })).body.id as number;
    const b = (await c.cmd.post('/api/tracks', { name: 'ציר מנהיגות', leadId: c.ids.s2 })).body.id as number;
    await c.cmd.post('/api/tracks', { name: 'ציר חדש' });
    expect((await c.cmd.post('/api/admin/snapshots')).status).toBe(200);
    // the leads are gone
    await c.cmd.patch(`/api/tracks/${a}`, { leadId: null });
    await c.cmd.patch(`/api/tracks/${b}`, { leadId: null });
    expect((await c.cmd.post('/api/admin/snapshots')).status).toBe(200);

    expect((await c.s3.get('/api/tracks/lead-history')).status).toBe(200);
    const r = await c.cmd.get('/api/tracks/lead-history');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const h = r.body as TrackLeadHistory;
    const byName = Object.fromEntries(h.missing.map((m) => [m.name, m.lead]));
    expect(byName['ציר שטח']).toMatchObject({ id: c.ids.s1, active: true });
    expect(byName['ציר מנהיגות']).toMatchObject({ id: c.ids.s2, active: true });
    expect(byName['ציר שטח']?.goneBy).toBeTruthy();
    expect(byName['ציר חדש']).toBeNull();
    expect(h.checked).toBe(2);
    expect(h.activity.some((x) => x.text.includes('ציר שטח'))).toBe(true);
  });

  it('no backups: every track without a lead is listed, none found', async () => {
    await c.cmd.post('/api/tracks', { name: 'ציר שטח', leadId: c.ids.s1 });
    const h = (await c.cmd.get('/api/tracks/lead-history')).body as TrackLeadHistory;
    expect(h.checked).toBe(0);
    expect(h.missing.map((m) => m.name)).not.toContain('ציר שטח');
    expect(h.missing.every((m) => m.lead === null)).toBe(true);
  });
});

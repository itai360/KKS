// The reservists (מילואים) in the contacts: everyone on the staff sees them and adds to the list; the commander
// and whoever added someone removes them. One list, the same in a course opened beside the current one.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ParallelCourse, Reservist } from '../../shared/types';
import { config } from '../src/core';
import { closeSlots } from '../src/parallel';
import { setSnapshotProvider } from '../src/snapshots';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-reservists-'));
  setSnapshotProvider(null);
  closeSlots();
  c = await setup();
});
afterEach(() => {
  closeSlots();
  setSnapshotProvider(null);
});

const list = async (a: Ctx['cmd']) => (await a.get('/api/reservists')).body as Reservist[];

describe('the reservists in the contacts', () => {
  it('anyone on the staff adds one; the commander and whoever added removes', async () => {
    const r = await c.s1.post('/api/reservists', { fullName: 'רונן מילואים', phone: '050-1234567', role: 'מדריך ירי', notes: 'מגיע בשבועות שטח' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a = r.body as Reservist;
    expect(a).toMatchObject({ fullName: 'רונן מילואים', phone: '050-1234567', role: 'מדריך ירי', createdByName: 'מפק"צ 1', canDelete: true });
    expect((await c.s2.post('/api/reservists', { fullName: '' })).status).toBe(400);
    expect((await c.s2.post('/api/reservists', { fullName: 'גלית', email: 'not-mail' })).status).toBe(400);
    await c.s2.post('/api/reservists', { fullName: 'אבי נהג', phone: '052-7654321', role: 'נהג' });

    // everyone sees them, in the order of the names; someone else may fix a number, not remove
    expect((await list(c.s3)).map((x) => [x.fullName, x.canDelete])).toEqual([
      ['אבי נהג', false],
      ['רונן מילואים', false],
    ]);
    expect((await c.s3.patch(`/api/reservists/${a.id}`, { fullName: 'רונן מילואים', phone: '050-1111111', role: 'מדריך ירי' })).body).toMatchObject({ phone: '050-1111111' });
    expect((await c.s3.del(`/api/reservists/${a.id}`)).status).toBe(403);
    expect((await list(c.cmd)).every((x) => x.canDelete)).toBe(true);
    expect((await c.s1.del(`/api/reservists/${a.id}`)).status).toBe(200);
    expect((await list(c.cmd)).map((x) => x.fullName)).toEqual(['אבי נהג']);
  });

  it('are the same in a course opened beside the current one', async () => {
    await c.cmd.post('/api/reservists', { fullName: 'דנה רפואה', phone: '054-0000000', role: 'חובשת' });
    const course = (await c.cmd.post('/api/courses/parallel', { name: 'מחזור הבא', startDate: '2027-03-07' })).body as ParallelCourse;
    expect((await c.cmd.post('/api/courses/switch', { id: course.id })).status).toBe(200);
    expect((await list(c.cmd)).map((x) => x.fullName)).toEqual(['דנה רפואה']);
    // added there: it is in the one list
    await c.cmd.post('/api/reservists', { fullName: 'עומר קשר', role: 'קשר' });
    expect((await c.cmd.post('/api/courses/switch', { id: null })).status).toBe(200);
    expect((await list(c.cmd)).map((x) => x.fullName)).toEqual(['דנה רפואה', 'עומר קשר']);
  });
});

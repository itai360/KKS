// The staff's preparation weeks: the three weeks right after the closing week show every lesson the
// debriefs kept for the next cycle, decided once for all three - also when the course was ended and
// the next one opened in between.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BankLesson, Week } from '../../shared/types';
import { runAutomation } from '../src/automation';
import { config } from '../src/core';
import { db } from '../src/db';
import { setSnapshotProvider } from '../src/snapshots';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-prep-'));
  setSnapshotProvider(null);
  c = await setup();
});
afterEach(() => setSnapshotProvider(null));

async function week(name: string, start: string, end: string, leadId: number | null = c.ids.s1): Promise<number> {
  const res = await c.cmd.post('/api/weeks', { name, startDate: start, endDate: end, leadId });
  expect(res.status).toBe(200);
  return res.body.id;
}

async function lesson(body: string, debrief: { kind?: string; weekId?: number; title: string; occurredOn: string }): Promise<number> {
  const d = (await c.cmd.post('/api/debriefs', debrief)).body.debrief.id;
  const items = (await c.cmd.post(`/api/debriefs/${d}/items`, { kind: 'lesson', horizon: 'next', body })).body.items as { id: number; body: string }[];
  return items.find((i) => i.body === body)!.id;
}

const prepOf = async () => Object.fromEntries(((await c.cmd.get('/api/weeks')).body as Week[]).map((w) => [w.name, w.staffPrep ? `${w.staffPrep.index}/${w.staffPrep.of}` : null]));
const lessonsOf = async (weekId: number) => (await c.cmd.get(`/api/lessons?week=${weekId}`)).body as BankLesson[];

describe('the staff preparation weeks', () => {
  // NOW is Thursday 1.10.2026: the first week of the preparation ends today
  async function course() {
    await week('שבוע 1 - קליטה', '2026-08-30', '2026-09-03');
    await week('שבוע 2 - סיום שלב א', '2026-09-06', '2026-09-10');
    const nav = await week('שבוע ניווט', '2026-09-13', '2026-09-17');
    await week('שבוע סיום', '2026-09-20', '2026-09-24');
    const p1 = await week('הכנה 1', '2026-09-27', '2026-10-01', c.ids.s1);
    const p2 = await week('הכנה 2', '2026-10-04', '2026-10-08', c.ids.s2);
    const p3 = await week('הכנה 3', '2026-10-11', '2026-10-15', c.ids.s3);
    await week('שבוע קליטה', '2026-10-18', '2026-10-22');
    // lessons for the next cycle: one for a week, one for an event; and one written during the preparation
    const maps = await lesson('מפות יום מראש', { kind: 'weekly', weekId: nav, title: 'תחקיר שבועי - ניווט', occurredOn: '2026-09-17' });
    const water = await lesson('נקודת מים כל 4 ק"מ', { title: 'תחקיר מסע', occurredOn: '2026-09-22' });
    await lesson('להתחיל את ההכנה ביום ראשון', { title: 'תחקיר הכנת סגל', occurredOn: '2026-09-29' });
    return { p1, p2, p3, maps, water };
  }

  it('are the three weeks after the last week named for the end - not after a stage that ends mid-course', async () => {
    await course();
    expect(await prepOf()).toEqual({
      'שבוע 1 - קליטה': null,
      'שבוע 2 - סיום שלב א': null,
      'שבוע ניווט': null,
      'שבוע סיום': null,
      'הכנה 1': '1/3',
      'הכנה 2': '2/3',
      'הכנה 3': '3/3',
      'שבוע קליטה': null,
    });
  });

  it('show every lesson kept for the next cycle, from the debriefs before them - whatever it was written for', async () => {
    const { p1, p2, p3 } = await course();
    for (const w of [p1, p2, p3]) expect((await lessonsOf(w)).map((l) => l.body).sort()).toEqual(['מפות יום מראש', 'נקודת מים כל 4 ק"מ']);
    // a week that is not one of them: only what was written for it
    const other = await week('שבוע ניווט', '2027-01-03', '2027-01-07');
    expect((await lessonsOf(other)).map((l) => l.body)).toEqual(['מפות יום מראש']);
    // the week itself carries which of the preparation it is
    expect((await c.cmd.get(`/api/weeks/${p2}`)).body.week.staffPrep).toEqual({ index: 2, of: 3 });
  });

  it('decide a lesson once for all three: any of their leads, or the commander', async () => {
    const { p1, p2, p3, maps, water } = await course();
    expect((await c.cmd.post(`/api/lessons/${maps}/review`, { weekId: p1, decision: 'applied' })).status).toBe(200);
    const third = await lessonsOf(p3);
    expect(third.find((l) => l.id === maps)!.review).toMatchObject({ decision: 'applied', decidedByName: 'מפקד הקורס' });
    expect(third.find((l) => l.id === water)!.review).toBeNull();
    // the second week's lead decides there; someone else's week is not theirs
    expect((await c.s3.post(`/api/lessons/${water}/review`, { weekId: p2, decision: 'skip' })).status).toBe(403);
    expect((await c.s2.post(`/api/lessons/${water}/review`, { weekId: p2, decision: 'skip' })).status).toBe(200);
    expect((await lessonsOf(p1)).every((l) => l.review)).toBe(true);
  });

  it('remind once for the whole preparation, and leave the bell and the home page when all is decided', async () => {
    const { p1, p2, maps, water } = await course();
    runAutomation();
    runAutomation();
    const asked = (id: number) => notificationsOf(id).filter((n) => n.type === 'lessons');
    expect(asked(c.ids.s1).map((n) => [n.title, n.link])).toEqual([['הכנת סגל: 2 לקחים למחזור הבא מחכים להחלטה', `/weeks/${p1}#prior`]]);
    expect(asked(c.ids.s2)).toEqual([]);
    expect(asked(c.ids.s3)).toEqual([]);
    const lanes = async () => ((await c.cmd.get('/api/dashboard')).body.attention as { kind: string; title: string; weekId: number }[]).filter((a) => a.kind === 'lessons');
    expect(await lanes()).toEqual([expect.objectContaining({ title: 'הכנת סגל: 2 לקחים למחזור הבא', weekId: p1 })]);

    // decided from the second week: the reminder of the first one is finished too
    await c.s2.post(`/api/lessons/${maps}/review`, { weekId: p2, decision: 'applied' });
    await c.s2.post(`/api/lessons/${water}/review`, { weekId: p2, decision: 'skip' });
    expect(await lanes()).toEqual([]);
    expect(db().get<{ finished_at: string | null }>("SELECT finished_at FROM notifications WHERE type = 'lessons'")!.finished_at).not.toBeNull();
  });
});

describe('the preparation across two courses', () => {
  const startNew = () => c.cmd.post('/api/courses/new', { archiveName: 'מחזור 52', name: 'קורס קק"ס - מחזור 53', startDate: '2026-09-20', endDate: '2027-02-25' });

  async function ending(prepWeeks: number) {
    await week('שבוע 1', '2026-08-30', '2026-09-03');
    const last = await week('שבוע סיום', '2026-09-06', '2026-09-10');
    await lesson('לתאם את הקליטה מוקדם', { kind: 'weekly', weekId: last, title: 'תחקיר שבוע סיום', occurredOn: '2026-09-10' });
    for (let i = 0; i < prepWeeks; i++) await week(`הכנה ${i + 1}`, ['2026-09-13', '2026-09-20', '2026-09-27'][i], ['2026-09-17', '2026-09-24', '2026-10-01'][i]);
    expect((await startNew()).status).toBe(200);
  }

  it('the next course\'s first weeks are the preparation when the course ended with its closing week', async () => {
    await ending(0);
    const a = await week('הכנה א', '2026-09-13', '2026-09-17');
    await week('הכנה ב', '2026-09-20', '2026-09-24');
    await week('הכנה ג', '2026-09-27', '2026-10-01');
    await week('שבוע 1 - קליטה', '2026-10-04', '2026-10-08');
    expect(await prepOf()).toEqual({ 'הכנה א': '1/3', 'הכנה ב': '2/3', 'הכנה ג': '3/3', 'שבוע 1 - קליטה': null });
    // the lessons the course that ended kept, there
    expect((await lessonsOf(a)).map((l) => l.body)).toEqual(['לתאם את הקליטה מוקדם']);
  });

  it('only what is left of it, when the course that ended already had some of it', async () => {
    await ending(1);
    await week('הכנה ב', '2026-09-20', '2026-09-24');
    await week('הכנה ג', '2026-09-27', '2026-10-01');
    await week('שבוע 1 - קליטה', '2026-10-04', '2026-10-08');
    expect(await prepOf()).toEqual({ 'הכנה ב': '2/3', 'הכנה ג': '3/3', 'שבוע 1 - קליטה': null });
  });

  it('none, when the whole preparation was in the course that ended', async () => {
    await ending(3);
    await week('שבוע 1 - קליטה', '2026-10-04', '2026-10-08');
    await week('שבוע 2', '2026-10-11', '2026-10-15');
    expect(await prepOf()).toEqual({ 'שבוע 1 - קליטה': null, 'שבוע 2': null });
  });
});

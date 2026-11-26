import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/core';
import { db } from '../src/db';
import { closeSlots, inSlot, syncNextCourse } from '../src/parallel';
import { setSnapshotProvider } from '../src/snapshots';
import { at, newTask, setup, type Ctx } from './helpers';
import type { Task } from '../../shared/types';
let c: Ctx;
beforeEach(async () => {
  config.dataDir = mkdtempSync(join(tmpdir(), 'kks-carryover-'));
  closeSlots(); setSnapshotProvider(null); c = await setup();
  expect((await c.cmd.patch('/api/settings', { courseName: 'מחזור כ׳', startDate: '2026-09-01', endDate: '2026-10-01' })).status).toBe(200);
});
afterEach(() => { closeSlots(); setSnapshotProvider(null); });
async function next() {
  const r = await c.cmd.post('/api/courses/parallel', { name: 'מחזור כ״א', startDate: '2026-10-04', endDate: '2027-01-31' });
  expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.id as number;
}
const into = async (id: number | null) => expect((await c.cmd.post('/api/courses/switch', { id })).status).toBe(200);
const list = async () => (await c.cmd.get('/api/tasks')).body as Task[];
const task = (title: string, deadline = '2026-10-06') => newTask(c.cmd, { title, ownerIds: [c.ids.s1], deadline: at(deadline, '12:00') });

describe('dated work continuing into the next course', () => {
  it('backfills open tasks at the same dates and state, keeps source data and relationships, and is idempotent', async () => {
    const parent = await task('עבודה מתמשכת');
    const sub = await newTask(c.cmd, { title: 'שלב שני', ownerIds: [c.ids.s1], parentId: parent, deadline: at('2026-10-07') });
    await c.cmd.patch(`/api/tasks/${parent}`, { participantIds: [c.ids.s2] });
    db().run("UPDATE tasks SET status = 'in_progress', started_at = ? WHERE id = ?", at('2026-09-30'), parent);
    await task('לפני הסיום', '2026-10-01');
    const done = await task('כבר בוצע'); db().run("UPDATE tasks SET status = 'done' WHERE id = ?", done);
    const cancelled = await task('בוטל'); db().run("UPDATE tasks SET status = 'cancelled' WHERE id = ?", cancelled);
    const slot = await next();
    expect(db().get('SELECT status FROM tasks WHERE id = ?', parent)).toEqual({ status: 'in_progress' });
    await into(slot);
    const copied = (await list()).find(t => t.title === 'עבודה מתמשכת')!;
    expect(copied).toMatchObject({ deadline: at('2026-10-06', '12:00'), status: 'in_progress', ownerId: c.ids.s1, originCourse: 'מחזור כ׳' });
    expect(copied.participantIds).toContain(c.ids.s2);
    expect(inSlot(slot, () => db().get('SELECT parent_id FROM tasks WHERE title = ?', 'שלב שני'))).toEqual({ parent_id: copied.id });
    expect((await list()).filter(t => ['לפני הסיום', 'כבר בוצע', 'בוטל'].includes(t.title))).toEqual([]);
    expect((await c.cmd.get(`/api/tasks/${copied.id}`)).body.updates.some((u: { body: string }) => u.body.includes('נוצר במחזור הקודם'))).toBe(true);
    await c.cmd.patch(`/api/tasks/${copied.id}`, { title: 'נכתב מחדש במחזור הבא' });
    await into(null); syncNextCourse(); syncNextCourse();
    await into(slot);
    expect((await list()).filter(t => t.title === 'נכתב מחדש במחזור הבא')).toHaveLength(1);
    expect((await list()).some(t => t.title === 'עבודה מתמשכת')).toBe(false);
    expect(db().get('SELECT id FROM tasks WHERE id = ?', sub)).toBeTruthy();
  });

  it('uses the local end-of-day boundary, catches new and rescheduled work, and does not recreate deleted copies', async () => {
    const slot = await next();
    const before = await task('יעבור אחרי עדכון', '2026-10-01');
    await c.cmd.patch(`/api/tasks/${before}`, { deadline: at('2026-10-08', '08:00') });
    const boundary = await newTask(c.cmd, { title: 'לילה במחזור הבא', ownerIds: [c.ids.s1], deadline: '2026-10-01T22:30:00.000Z' });
    await into(slot);
    const copied = (await list()).find(t => t.title === 'יעבור אחרי עדכון')!;
    expect(copied.deadline).toBe(at('2026-10-08', '08:00'));
    expect((await list()).some(t => t.title === 'לילה במחזור הבא')).toBe(true);
    expect((await c.cmd.del(`/api/tasks/${copied.id}`)).status).toBe(200);
    await task('פריט מקומי עם מזהה ממוחזר');
    await into(null); syncNextCourse(); await into(slot);
    expect((await list()).some(t => t.title === 'יעבור אחרי עדכון')).toBe(false);
    expect((await list()).find(t => t.title === 'פריט מקומי עם מזהה ממוחזר')?.originCourse).toBeNull();
    await into(null);
    await c.cmd.del(`/api/tasks/${boundary}`);
    await task('מקור חדש לאחר מחיקה');
    await into(slot);
    expect((await list()).some(t => t.title === 'מקור חדש לאחר מחיקה')).toBe(true);
  });

  it('carries calendar occurrences and spanning events, discussions and follow-ups, debrief lessons, absences and visits', async () => {
    const event = await c.cmd.post('/api/events', { title: 'מופע מתמשך', date: '2026-09-30', endDate: '2026-10-05', allDay: true, startTime: '00:00' });
    expect(event.status, JSON.stringify(event.body)).toBe(200);
    const discussion = await c.cmd.post('/api/discussions', { kind: 'planning', title: 'דיון קודם עם המשך', heldOn: '2026-09-30', participantIds: [c.ids.s1], points: ['תכנון'] });
    expect(discussion.status).toBe(200);
    expect((await c.cmd.post(`/api/discussions/${discussion.body.id}/actions`, { body: 'החלטה להמשך', ownerId: c.ids.s1, dueOn: '2026-10-07' })).status).toBe(200);
    const debrief = await c.cmd.post('/api/debriefs', { title: 'תחקיר עם לקח לביצוע', occurredOn: '2026-09-30' });
    expect((await c.cmd.post(`/api/debriefs/${debrief.body.debrief.id}/items`, { kind: 'lesson', body: 'לשפר תיאום', horizon: 'now', ownerId: c.ids.s1, dueDate: '2026-10-06' })).status).toBe(200);
    expect((await c.cmd.post('/api/absences', { userId: c.ids.s1, startDate: '2026-09-30', endDate: '2026-10-05', reason: 'leave', note: 'חופשה' })).status).toBe(200);
    expect((await c.cmd.post('/api/entries', { fullName: 'מבקר לבדיקה', phone: '0501234567', visitorKind: 'civilian', idNumber: '123456782', visitDate: '2026-10-06', reason: 'הרצאה' })).status).toBe(200);
    db().run("UPDATE entry_requests SET visit_date = '2026-10-06' WHERE full_name = 'מבקר לבדיקה'");
    const slot = await next(); await into(slot);
    expect((await c.cmd.get('/api/events?from=2026-10-01&to=2026-10-10')).body).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'מופע מתמשך', date: '2026-09-30', endDate: '2026-10-05', originCourse: 'מחזור כ׳' })]));
    const discussions = (await c.cmd.get('/api/discussions')).body;
    expect(discussions[0]).toMatchObject({ title: 'דיון קודם עם המשך', originCourse: 'מחזור כ׳' });
    expect((await c.cmd.get(`/api/discussions/${discussions[0].id}`)).body.actionList[0]).toMatchObject({ dueOn: '2026-10-07', taskId: null });
    const debriefs = (await c.cmd.get('/api/debriefs')).body;
    expect(debriefs[0].originCourse).toBe('מחזור כ׳');
    expect((await c.cmd.get(`/api/debriefs/${debriefs[0].id}`)).body.items[0]).toMatchObject({ body: 'לשפר תיאום', dueDate: '2026-10-06', taskId: null });
    expect((await c.cmd.get('/api/absences')).body[0]).toMatchObject({ endDate: '2026-10-05', originCourse: 'מחזור כ׳' });
    expect((await c.cmd.get('/api/entries')).body[0]).toMatchObject({ fullName: 'מבקר לבדיקה', originCourse: 'מחזור כ׳' });
    expect(await list()).toEqual([]); // pending lessons/actions retain their review, no approval bypass
  });

  it('keeps private work private and chooses only the immediate next cycle', async () => {
    const privateId = await newTask(c.s1, { title: 'משימה אישית', ownerIds: [c.ids.s1], visibility: 'private', deadline: at('2026-10-08') });
    const slot = await next();
    const later = await c.cmd.post('/api/courses/parallel', { name: 'מחזור כ״ב', startDate: '2027-03-01' });
    expect(later.status).toBe(200);
    await c.s2.post('/api/courses/switch', { id: slot });
    expect((await c.s2.get('/api/tasks')).body).toEqual([]);
    await c.s1.post('/api/courses/switch', { id: slot });
    expect((await c.s1.get('/api/tasks')).body[0]).toMatchObject({ title: 'משימה אישית', visibility: 'private' });
    expect(inSlot(later.body.id, () => db().get<{ n: number }>('SELECT count(*) AS n FROM tasks')!.n)).toBe(0);
    expect(db().get('SELECT visibility FROM tasks WHERE id = ?', privateId)).toEqual({ visibility: 'private' });
  });

  it('also retains future work when ending the current course without a pre-opened next course', async () => {
    await task('המשך אחרי סיום');
    const ended = await c.cmd.post('/api/courses/new', { archiveName: 'מחזור כ׳', name: 'מחזור כ״א', startDate: '2026-10-04', endDate: '2027-01-31' });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect((await list())[0]).toMatchObject({ title: 'המשך אחרי סיום', originCourse: 'מחזור כ׳', deadline: at('2026-10-06', '12:00') });
  });

  it('carries weekly topics into a week at their actual date and picks up later follow-ups in a copied discussion', async () => {
    const week = await c.cmd.post('/api/weeks', { name: 'שבוע אחרון', startDate: '2026-09-27', endDate: '2026-10-01' });
    db().run("INSERT INTO weekly_items(week_id, kind, title, event_date, created_at, updated_at) VALUES (?, 'topic', 'המשך בשבוע הבא', '2026-10-06', '2026-10-01', '2026-10-01')", week.body.id);
    const discussion = await c.cmd.post('/api/discussions', { kind: 'planning', title: 'דיון במחזור הבא', heldOn: '2026-10-05' });
    const slot = await next();
    expect((await c.cmd.post(`/api/discussions/${discussion.body.id}/actions`, { body: 'פעולה שנוספה מאוחר', dueOn: '2026-10-07', ownerId: c.ids.s1 })).status).toBe(200);
    expect(inSlot(slot, () => db().get("SELECT title, event_date FROM weekly_items WHERE title = 'המשך בשבוע הבא'"))).toEqual({ title: 'המשך בשבוע הבא', event_date: '2026-10-06' });
    expect(inSlot(slot, () => db().get("SELECT body FROM discussion_actions WHERE body = 'פעולה שנוספה מאוחר'"))).toBeTruthy();
    expect(inSlot(slot, () => db().all('PRAGMA foreign_key_check'))).toEqual([]);
  });

  it('numbers automatically created continuation weeks by their dates, including 53 to 1', async () => {
    db().run(`INSERT INTO settings(key, value) VALUES ('weekNumberingRule', '"iso"')`);
    const week = await c.cmd.post('/api/weeks', { name: 'שבוע מקור', startDate: '2026-09-27', endDate: '2026-10-01' });
    for (const date of ['2027-01-03', '2026-12-27', '2026-12-20']) {
      db().run("INSERT INTO weekly_items(week_id, kind, title, event_date, created_at, updated_at) VALUES (?, 'topic', ?, ?, '2026-10-01', '2026-10-01')", week.body.id, date, date);
    }
    const slot = await next();
    expect(inSlot(slot, () => db().all<{ number: number }>('SELECT number FROM weeks ORDER BY start_date').map(w => w.number))).toEqual([52, 53, 1]);
    syncNextCourse();
    expect(inSlot(slot, () => db().get<{ n: number }>('SELECT count(*) n FROM weeks')!.n)).toBe(3);
  });

  it('does not recreate an excluded week when a new continuation topic arrives', async () => {
    const slot = await next();
    inSlot(slot, () => db().run("INSERT INTO week_auto_create_exclusions VALUES ('2026-11-22', '2026-11-28')"));
    const week = await c.cmd.post('/api/weeks', { name: 'שבוע מקור', startDate: '2026-09-27', endDate: '2026-10-01' });
    db().run("INSERT INTO weekly_items(week_id, kind, title, event_date, created_at, updated_at) VALUES (?, 'topic', 'נושא לשבוע שהוסר', '2026-11-24', '2026-10-01', '2026-10-01')", week.body.id);
    await task('משימה נשמרת ללא שבוע', '2026-11-24');
    syncNextCourse();
    expect(inSlot(slot, () => db().all('SELECT id FROM weeks'))).toHaveLength(0);
    expect(inSlot(slot, () => db().get("SELECT week_id FROM tasks WHERE title = 'משימה נשמרת ללא שבוע'"))).toEqual({ week_id: null });
    expect(db().get("SELECT id FROM weekly_items WHERE title = 'נושא לשבוע שהוסר'")).toBeTruthy();
  });

  it('keeps continuation provenance on promotion and does not duplicate spanning absences or visits', async () => {
    await task('להמשיך במחזור הבא');
    await c.cmd.post('/api/absences', { userId: c.ids.s1, startDate: '2026-09-30', endDate: '2026-10-05' });
    const slot = await next();
    const promoted = await c.cmd.post(`/api/courses/parallel/${slot}/promote`, { archiveName: 'מחזור כ׳' });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect((await list())[0]).toMatchObject({ title: 'להמשיך במחזור הבא', originCourse: 'מחזור כ׳' });
    const absences = (await c.cmd.get('/api/absences')).body;
    expect(absences).toHaveLength(1);
    expect(absences[0].originCourse).toBe('מחזור כ׳');
    expect(db().all('PRAGMA foreign_key_check')).toEqual([]);
  });
});

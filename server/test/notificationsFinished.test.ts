// The bell keeps what is still open: once what a notification is about is finished - the task done, the
// closing approved, the request decided, the announcement confirmed, the roll call marked - it is out of the
// list and the count. Nothing is deleted for it: a task opened again brings its notifications back.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Notification } from '../../shared/types';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { Db, migrate } from '../src/db';
import { at, newTask, notificationsOf, setup, type Agent, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const bell = async (agent: Agent) => (await agent.get('/api/notifications')).body as Notification[];
const unread = async (agent: Agent) => (await agent.get('/api/notifications/unread')).body.unread as number;
const types = (list: Notification[]) => list.map((n) => n.type);

describe('what is finished leaves the bell', () => {
  it('a task done takes its notifications with it, and opened again brings them back', async () => {
    const id = await newTask(c.s2, { title: 'הזמנת אוטובוסים לסיור', ownerIds: [c.ids.s1] });
    const [assigned] = await bell(c.s1);
    expect(assigned).toMatchObject({ type: 'task_assigned', taskId: id, read: false });
    expect(assigned.finished).toBeUndefined();
    expect(await unread(c.s1)).toBe(1);
    expect((await c.s1.get('/api/auth/me')).body.unread).toBe(1);

    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect(await bell(c.s1)).toEqual([]);
    expect(await unread(c.s1)).toBe(0);
    expect((await c.s1.get('/api/auth/me')).body.unread).toBe(0);
    // a screen that still shows it asks about it, and hears it is finished - to see it go
    const known = (await c.s1.get(`/api/notifications?known=${assigned.id},999999`)).body as Notification[];
    expect(known).toEqual([expect.objectContaining({ id: assigned.id, finished: true })]);

    // the news of it reaches the one who gave it - heard as it comes, not kept in the bell
    expect(notificationsOf(c.ids.s2).map((n) => n.type)).toContain('task_done');
    expect(await bell(c.s2)).toEqual([]);
    expect(await unread(c.s2)).toBe(0);

    await c.s2.post(`/api/tasks/${id}/transition`, { action: 'reopen', note: 'חסר אישור קצין רכב' });
    expect(types(await bell(c.s1)).sort()).toEqual(['reopened', 'task_assigned']);
    expect(await unread(c.s1)).toBe(2);
  });

  it('a closing waiting for approval: approved or sent back it is out; asked again, the new one stands alone', async () => {
    const id = await newTask(c.cmd, { title: 'סיכום מטווח לילה', ownerIds: [c.ids.s1], requiresApproval: true });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    const [first] = await bell(c.cmd);
    expect(first.type).toBe('approval_requested');

    await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'return', note: 'חסרות תמונות מהשטח' });
    expect(await bell(c.cmd)).toEqual([]);
    expect(types(await bell(c.s1))).toContain('returned');

    // done again and asked again: the sending back is answered, and the commander has the new ask only
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect(types(await bell(c.s1))).not.toContain('returned');
    const again = await bell(c.cmd);
    expect(again.map((n) => [n.type, n.id === first.id])).toEqual([['approval_requested', false]]);
    // deleting the new ask does not bring the old one back
    await c.cmd.post('/api/bulk', { entity: 'notifications', action: 'delete', ids: [again[0].id] });
    expect(await bell(c.cmd)).toEqual([]);

    await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'approve' });
    expect(await bell(c.s1)).toEqual([]);
    expect(await unread(c.s1)).toBe(0);
  });

  it('a blocker cleared and a call for a decision answered leave the commander\'s bell', async () => {
    const id = await newTask(c.cmd, { title: 'תיאום שטח אש', ownerIds: [c.ids.s1] });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'block', reason: 'ממתין לאישור', waitingFor: 'קצין המטווח', nextStep: 'לחזור אליו מחר', needsCommander: true });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'escalate', note: 'לבחור שטח חלופי' });
    expect(types(await bell(c.cmd)).sort()).toEqual(['blocked', 'escalated']);
    await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'unblock', note: 'סוכם על שטח חלופי' });
    expect(await bell(c.cmd)).toEqual([]);
  });

  it('a request leaves the approver\'s bell once decided; the answer of yes is news', async () => {
    const id = await newTask(c.cmd, { title: 'הכנת תיק שטח', ownerIds: [c.ids.s1] });
    await c.s1.post(`/api/tasks/${id}/requests`, { type: 'deadline', newDeadline: at('2026-10-08'), reason: 'ממתין לציוד מהאפסנאות' });
    expect(types(await bell(c.cmd))).toEqual(['request']);
    const [pending] = (await c.cmd.get('/api/requests')).body;
    await c.cmd.post(`/api/requests/${pending.id}/decide`, { approve: true });
    expect(await bell(c.cmd)).toEqual([]);
    // s1: the task itself, still open, and its new deadline - the approval of the request is heard, not kept
    expect(types(await bell(c.s1)).sort()).toEqual(['deadline_changed', 'task_assigned']);
    expect(notificationsOf(c.ids.s1).map((n) => n.type)).toContain('request_decided');
  });

  it('an overdue task: answering it, or a new deadline, settles the call to update', async () => {
    const id = await newTask(c.cmd, { title: 'החזרת ציוד קשר', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '12:00') });
    clock.set(new Date(at('2026-10-01', '12:30')));
    runAutomation();
    expect(types(await bell(c.s1))).toContain('overdue');
    await c.s1.post(`/api/tasks/${id}/overdue-response`, { response: 'today', note: 'עד הערב' });
    expect(types(await bell(c.s1))).not.toContain('overdue');
  });

  it('an announcement leaves once confirmed; a closure once done; a committee once decided', async () => {
    const a = (await c.cmd.post('/api/announcements', { title: 'מסדר מפקד ביום חמישי', body: 'במדים א', requireAck: true })).body[0].id;
    expect(types(await bell(c.s1))).toEqual(['announcement']);
    await c.s1.post(`/api/announcements/${a}/read`, {});
    expect(types(await bell(c.s1))).toEqual(['announcement']);
    await c.s1.post(`/api/announcements/${a}/read`, { ack: true });
    expect(await bell(c.s1)).toEqual([]);

    const w = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-03', leadId: c.ids.s2 })).body.id;
    const item = (await c.s2.post('/api/weekly/items', { weekId: w, kind: 'closure', title: 'אישור שטח אש לתרגיל', ownerId: c.ids.s3 })).body.id;
    expect(types(await bell(c.s3))).toContain('weekly_closure');
    await c.cmd.patch(`/api/weekly/items/${item}`, { done: true, outcome: 'אושר' });
    expect(types(await bell(c.s3))).not.toContain('weekly_closure');

    const team = (await c.cmd.post('/api/teams', { name: 'צוות ירדן', commanderId: c.ids.s1 })).body[0].id;
    const cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'טל', teamId: team })).body.cadet.id;
    await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הערכה', reason: 'פער בעבודת צוות' });
    expect(types(await bell(c.s1))).toEqual(['committee']);
    const committee = (await c.cmd.get(`/api/evaluations/${cadet}`)).body.committees[0].id;
    await c.cmd.post(`/api/evaluations/committees/${committee}/decision`, { decision: 'continue', text: 'ממשיך' });
    expect(await bell(c.s1)).toEqual([]);
  });

  it('the roll call reminder leaves once the team is marked; tomorrow\'s takes the place of today\'s', async () => {
    const team = (await c.cmd.post('/api/teams', { name: 'צוות כרמל', commanderId: c.ids.s1 })).body[0].id;
    const cadets = [];
    for (const name of ['עידו', 'רון']) cadets.push((await c.cmd.post('/api/cadets', { firstName: name, lastName: 'לוי', teamId: team })).body.cadet.id as number);
    for (const date of ['2026-10-02', '2026-10-04']) await c.cmd.post('/api/events', { date, startTime: '08:00', title: 'מסדר בוקר' });
    clock.set(new Date(at('2026-10-02', '08:31')));
    runAutomation();
    const [friday] = await bell(c.s1);
    expect(friday.type).toBe('attendance');
    // not marked that day: Sunday's reminder takes its place
    clock.set(new Date(at('2026-10-04', '08:31')));
    runAutomation();
    const sunday = await bell(c.s1);
    expect(sunday.map((n) => [n.type, n.id === friday.id])).toEqual([['attendance', false]]);
    // half the team is not the roll call
    await c.s1.put('/api/attendance', { date: '2026-10-04', entries: [{ cadetId: cadets[0], status: 'present' }] });
    expect(types(await bell(c.s1))).toEqual(['attendance']);
    await c.s1.put('/api/attendance', { date: '2026-10-04', entries: [{ cadetId: cadets[1], status: 'sick' }] });
    expect(await bell(c.s1)).toEqual([]);
  });

  it('an earlier cycle\'s lessons: the reminder leaves once each is decided, and comes back when one is taken back', async () => {
    const week = async (name: string, start: string, end: string, leadId: number) => (await c.cmd.post('/api/weeks', { name, startDate: start, endDate: end, leadId })).body.id as number;
    const old = await week('שבוע ניווט', '2026-09-20', '2026-09-24', c.ids.s1);
    const d = (await c.cmd.post('/api/debriefs', { kind: 'weekly', weekId: old, title: 'תחקיר ניווט', occurredOn: '2026-09-24' })).body.debrief.id;
    const items = (await c.cmd.post(`/api/debriefs/${d}/items`, { kind: 'lesson', horizon: 'next', body: 'מפות יום מראש' })).body.items;
    const lesson = items[0].id as number;
    const next = await week('שבוע ניווט', '2026-10-11', '2026-10-15', c.ids.s2);
    runAutomation();
    expect(types(await bell(c.s2))).toContain('lessons');
    await c.s2.post(`/api/lessons/${lesson}/review`, { weekId: next, decision: 'applied' });
    expect(types(await bell(c.s2))).not.toContain('lessons');
    await c.s2.post(`/api/lessons/${lesson}/review`, { weekId: next, decision: null });
    expect(types(await bell(c.s2))).toContain('lessons');
  });

  it('what is only to know stays: a new update on a task waits until it is read and the task done', async () => {
    const id = await newTask(c.s1, { title: 'תכנון ערב גיבוש', ownerIds: [c.ids.s1, c.ids.s2], assignMode: 'shared' });
    await c.s1.post(`/api/tasks/${id}/updates`, { body: 'נסגר מקום' });
    expect(types(await bell(c.s2))).toContain('update');
    await c.s2.post('/api/notifications/read', { all: true });
    expect(types(await bell(c.s2))).toContain('update');
    expect(await unread(c.s2)).toBe(0);
  });
});

describe('notifications from before', () => {
  it('the ones already said again by a newer one are marked finished once, as the database is brought up to date', () => {
    const old = new Db(':memory:');
    migrate(old, 35);
    old.run("INSERT INTO users(id, username, display_name, role, password_hash, created_at) VALUES (1, 'u', 'איש סגל', 'staff', 'x', '2026-09-01T00:00:00.000Z')");
    old.run("INSERT INTO tasks(id, title, owner_id, created_by, deadline, created_at, updated_at, last_activity_at) VALUES (1, 'משימה', 1, 1, '2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')");
    const add = (id: number, type: string, taskId: number | null) =>
      old.run("INSERT INTO notifications(id, user_id, type, category, title, task_id, created_at) VALUES (?, 1, ?, 'action', 'x', ?, ?)", id, type, taskId, `2026-09-0${id}T08:00:00.000Z`);
    add(1, 'reminder_24h', 1);
    add(2, 'overdue', 1);
    add(3, 'brief', null);
    add(4, 'brief', null);
    add(5, 'blocked', 1);
    migrate(old);
    const marked = old.all<{ id: number }>('SELECT id FROM notifications WHERE finished_at IS NOT NULL ORDER BY id').map((r) => r.id);
    expect(marked).toEqual([1, 3]);
    old.close();
  });
});

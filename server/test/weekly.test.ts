// The weekly (שבועי): each course week's staff meeting - notes on the schedule, professional closures,
// topics the team commanders raise during the week, and the commander's points, which stay the
// commander's until the weekly is held. Holding it sends the summary and moves on what was left open.

import { beforeEach, describe, expect, it } from 'vitest';
import { weeklySummaryText, type WeeklyItem, type WeeklyView } from '../../shared/weekly';
import { newTask, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
let w1 = 0;
let w2 = 0;

beforeEach(async () => {
  c = await setup();
  // the clock stands on 2026-10-01: inside the first week
  w1 = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-03', leadId: c.ids.s2 })).body.id;
  w2 = (await c.cmd.post('/api/weeks', { name: 'שבוע ניווטים', startDate: '2026-10-04', endDate: '2026-10-10' })).body.id;
});

const view = async (agent: Ctx['cmd'], week: number) => (await agent.get(`/api/weekly/${week}`)).body as WeeklyView;
const titles = (v: WeeklyView) => v.items.map((i) => i.title);

describe('the weekly', () => {
  it('what comes up during the week goes to the weekly of the week on now; the points are the commander’s', async () => {
    expect((await c.s1.get('/api/weekly/target')).body).toMatchObject({ weekId: w1, name: 'שבוע שטח' });
    const topic = (await c.s1.post('/api/weekly/items', { kind: 'topic', title: 'עומס הש"ג על הצוערים', details: 'שלושה לילות ברצף' })).body;
    expect(topic.weekId).toBe(w1);
    await c.s1.post('/api/weekly/items', { weekId: w1, kind: 'closure', title: 'אישור שטח אש לתרגיל', ownerId: c.ids.s3 });
    await c.s1.post('/api/weekly/items', { weekId: w1, kind: 'schedule', title: 'להקדים את ההסעה', eventRef: 'e:12', eventDate: '2026-09-29' });
    // the closure's owner hears of it
    expect(notificationsOf(c.ids.s3).some((n) => n.type === 'weekly_closure' && n.link === `/weekly/${w1}`)).toBe(true);
    // the commander's points: the commander's alone
    expect((await c.s1.post('/api/weekly/items', { weekId: w1, kind: 'point', title: 'דגש' })).status).toBe(403);
    await c.cmd.post('/api/weekly/items', { weekId: w1, kind: 'point', title: 'שמירה על שעות שינה' });
    expect(titles(await view(c.cmd, w1))).toContain('שמירה על שעות שינה');
    const staff = await view(c.s1, w1);
    expect(staff).toMatchObject({ pointsHidden: true, canHold: false });
    expect(titles(staff)).toEqual(['עומס הש"ג על הצוערים', 'אישור שטח אש לתרגיל', 'להקדים את ההסעה']);
    expect(staff.items.find((i) => i.kind === 'schedule')).toMatchObject({ eventRef: 'e:12', eventDate: '2026-09-29' });
    // a closure has an owner; a topic does not
    expect(staff.items.find((i) => i.kind === 'closure')).toMatchObject({ ownerId: c.ids.s3, done: false });
    // the counts for the commander's home
    expect((await c.cmd.get('/api/weekly/target')).body.counts).toMatchObject({ topic: 1, closure: 1, schedule: 1, point: 1, open: 2 });
    expect((await c.s1.get('/api/weekly/target')).body.counts.point).toBe(0);
  });

  it('who may change what: the one who raised it, the commander, the week’s team commander, the closure’s owner', async () => {
    const topic = (await c.s1.post('/api/weekly/items', { kind: 'topic', title: 'נושא' })).body.id;
    const closure = (await c.s1.post('/api/weekly/items', { kind: 'closure', title: 'סגירה', ownerId: c.ids.s3 })).body.id;
    // someone else's topic: not to be renamed or deleted
    expect((await c.s3.patch(`/api/weekly/items/${topic}`, { title: 'אחר' })).status).toBe(403);
    expect((await c.s3.del(`/api/weekly/items/${topic}`)).status).toBe(403);
    expect((await c.s3.patch(`/api/weekly/items/${topic}`, { done: true })).status).toBe(403);
    // the week's team commander settles it in the meeting
    expect((await c.s2.patch(`/api/weekly/items/${topic}`, { done: true, outcome: 'הוחלט לפצל את השמירות' })).status).toBe(200);
    // the closure's owner closes it
    expect((await c.s3.patch(`/api/weekly/items/${closure}`, { done: true })).status).toBe(200);
    const v = await view(c.s1, w1);
    expect(v.items.map((i) => [i.title, i.done, i.outcome])).toEqual([
      ['נושא', true, 'הוחלט לפצל את השמירות'],
      ['סגירה', true, ''],
    ]);
    expect(v.items[0]).toMatchObject({ canEdit: true, canSettle: true });
    expect((await view(c.s3, w1)).items[0]).toMatchObject({ canEdit: false, canSettle: false });
    // a topic turned into a task stays linked to it
    const task = await newTask(c.s1, { title: 'פיצול שמירות', ownerIds: [c.ids.s1] });
    await c.s1.patch(`/api/weekly/items/${topic}`, { taskId: task });
    expect((await view(c.s1, w1)).items[0]).toMatchObject({ taskId: task, taskTitle: 'פיצול שמירות' });
    expect((await c.s1.del(`/api/weekly/items/${topic}`)).status).toBe(200);
  });

  it('held: the summary goes to the staff with the points, and what was left open moves to the next weekly', async () => {
    const open = (await c.s1.post('/api/weekly/items', { kind: 'topic', title: 'לא נדון' })).body.id;
    const discussed = (await c.s1.post('/api/weekly/items', { kind: 'topic', title: 'נדון' })).body.id;
    await c.cmd.patch(`/api/weekly/items/${discussed}`, { done: true, outcome: 'סגור' });
    await c.s1.post('/api/weekly/items', { kind: 'closure', title: 'סגירה פתוחה' });
    await c.cmd.post('/api/weekly/items', { kind: 'point', title: 'דגש המפקד' });
    expect((await c.s1.post(`/api/weekly/${w1}/hold`, {})).status).toBe(403);
    const held = (await c.cmd.post(`/api/weekly/${w1}/hold`, {})).body;
    expect(held).toMatchObject({ carried: 2, nextWeekId: w2 });
    expect(notificationsOf(c.ids.s1).find((n) => n.type === 'weekly_summary')).toMatchObject({ title: 'סיכום השבועי - שבוע שטח', link: `/weekly/${w1}` });
    // now everyone sees the points; what was left open is in the next weekly, marked where it came from
    const after = await view(c.s1, w1);
    expect(after.pointsHidden).toBe(false);
    expect(titles(after)).toEqual(['נדון', 'דגש המפקד']);
    const next = await view(c.s1, w2);
    expect(next.items.map((i) => [i.title, i.carriedFrom?.name])).toEqual([
      ['לא נדון', 'שבוע שטח'],
      ['סגירה פתוחה', 'שבוע שטח'],
    ]);
    expect(next.items.find((i) => i.id === open)).toBeTruthy();
    // what comes up now goes to the next one; the held weekly is closed to the staff
    expect((await c.s1.get('/api/weekly/target')).body.weekId).toBe(w2);
    expect((await c.s1.post('/api/weekly/items', { weekId: w1, kind: 'topic', title: 'מאוחר' })).status).toBe(400);
    expect((await c.s1.patch(`/api/weekly/items/${discussed}`, { outcome: 'שונה' })).status).toBe(403);
    expect((await c.cmd.post(`/api/weekly/${w1}/hold`, {})).status).toBe(400);
    // reopened: the points are the commander's again
    await c.cmd.post(`/api/weekly/${w1}/reopen`, {});
    expect((await view(c.s1, w1)).pointsHidden).toBe(true);
    expect(titles(await view(c.s1, w1))).toEqual(['נדון']);
  });

  it('holding without moving on keeps everything in its week; no weeks - nowhere to add', async () => {
    await c.s1.post('/api/weekly/items', { kind: 'topic', title: 'נשאר' });
    expect((await c.cmd.post(`/api/weekly/${w1}/hold`, { carry: false })).body.carried).toBe(0);
    expect(titles(await view(c.s1, w1))).toEqual(['נשאר']);
    await c.cmd.del(`/api/weeks/${w1}`);
    await c.cmd.del(`/api/weeks/${w2}`);
    expect((await c.s1.get('/api/weekly/target')).body.weekId).toBeNull();
    expect((await c.s1.post('/api/weekly/items', { kind: 'topic', title: 'אין שבוע' })).status).toBe(400);
  });
});

describe('the summary as text', () => {
  it('goes section by section, with what was decided', () => {
    const item = (kind: WeeklyItem['kind'], title: string, more: Partial<WeeklyItem> = {}): WeeklyItem => ({
      id: 0,
      weekId: 1,
      kind,
      title,
      details: '',
      eventRef: null,
      eventDate: null,
      ownerId: null,
      ownerName: null,
      done: false,
      outcome: '',
      taskId: null,
      taskTitle: null,
      carriedFrom: null,
      createdBy: null,
      createdByName: null,
      createdAt: '',
      canEdit: false,
      canSettle: false,
      ...more,
    });
    const text = weeklySummaryText({
      week: { id: 1, number: 3, name: 'שבוע שטח', startDate: '', endDate: '', leadId: null, leadName: null, heldAt: null },
      items: [item('topic', 'שמירות', { outcome: 'מפצלים' }), item('closure', 'שטח אש', { done: true, ownerName: 'מפק"צ 3' }), item('point', 'שינה', { details: 'שש שעות' })],
    });
    expect(text).toBe(['*שבועי - שבוע שטח*', '', '*סגירות מקצועיות*', '✔ שטח אש (מפק"צ 3)', '', '*נושאים לשיח*', '• שמירות - מפצלים', '', '*דגשי המפקד*', '• שינה - שש שעות'].join('\n'));
  });
});

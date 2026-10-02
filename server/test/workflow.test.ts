import { beforeEach, describe, expect, it } from 'vitest';
import { zonedIso } from '../../shared/dates';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { db } from '../src/db';
import { at, newTask, notificationsOf, setup, TZ, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('automation (section 72)', () => {
  it('marks overdue once, alerts the owner and the commander for critical tasks', async () => {
    const normal = await newTask(c.cmd, { title: 'רגילה', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '12:00') });
    const critical = await newTask(c.cmd, { title: 'קריטית', ownerIds: [c.ids.s2], deadline: at('2026-10-01', '12:00'), priority: 'critical' });
    clock.set(new Date(at('2026-10-01', '12:30')));
    expect(runAutomation().overdue).toBe(2);
    expect(runAutomation().overdue).toBe(0);
    expect(notificationsOf(c.ids.s1).some((n) => n.type === 'overdue')).toBe(true);
    const cmdN = notificationsOf(c.ids.cmd);
    expect(cmdN.filter((n) => n.type === 'critical_overdue')).toHaveLength(1);
    expect((await c.s1.get(`/api/tasks/${normal}`)).body.task.overdue).toBe(true);
    expect((await c.s2.get(`/api/tasks/${critical}`)).body.task.tone).toBe('red');
  });

  it('sends 24h reminders, and 2h reminders only for high/critical', async () => {
    await newTask(c.cmd, { title: 'רגילה', ownerIds: [c.ids.s1], deadline: at('2026-10-03', '09:00') });
    await newTask(c.cmd, { title: 'גבוהה', ownerIds: [c.ids.s1], deadline: at('2026-10-03', '09:00'), priority: 'high' });
    clock.set(new Date(at('2026-10-02', '09:30')));
    expect(runAutomation().reminders24).toBe(2);
    clock.set(new Date(at('2026-10-03', '07:30')));
    const r = runAutomation();
    expect(r.reminders2).toBe(1);
    expect(notificationsOf(c.ids.s1).filter((n) => n.type === 'reminder_2h')).toHaveLength(1);
  });

  it('a new task due within 24h does not trigger a duplicate reminder', async () => {
    await newTask(c.cmd, { title: 'היום', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '18:00') });
    expect(runAutomation().reminders24).toBe(0);
  });
});

describe('recurring tasks (section 15)', () => {
  it('creates each occurrence once, silently, on matching days', async () => {
    await c.cmd.post('/api/recurring', { title: 'עדכון לו"ז למחר', frequency: 'daily', time: '20:00', assignee: String(c.ids.s1) });
    await c.cmd.post('/api/recurring', { title: 'סיכום שבוע', frequency: 'weekly', weekdays: [4], time: '16:00', assignee: 'all' });
    await c.cmd.post('/api/recurring', { title: 'פתיחת שבוע', frequency: 'weekly', weekdays: [0], time: '08:00', assignee: String(c.ids.s2) });
    // today is Thursday: daily + Thursday rule (all staff -> 3 copies)
    const tasks = () => db().all<{ title: string }>('SELECT title FROM tasks WHERE recurring_rule_id IS NOT NULL');
    expect(tasks()).toHaveLength(4);
    runAutomation();
    expect(tasks()).toHaveLength(4);
    expect(notificationsOf(c.ids.s1).some((n) => n.title.includes('עדכון לו"ז'))).toBe(false);
    // Sunday
    clock.set(new Date(at('2026-10-04', '06:00')));
    runAutomation();
    expect(tasks().filter((t) => t.title === 'פתיחת שבוע')).toHaveLength(1);
    expect(tasks().filter((t) => t.title === 'עדכון לו"ז למחר')).toHaveLength(2);
  });

  it('a rule created after today\'s time starts tomorrow', async () => {
    await c.cmd.post('/api/recurring', { title: 'אימון גופני', frequency: 'daily', time: '06:30', assignee: String(c.ids.s1) });
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM tasks')!.n).toBe(0);
  });

  it('only the commander manages recurring rules', async () => {
    expect((await c.s1.post('/api/recurring', { title: 'x', frequency: 'daily', time: '20:00', assignee: 'all' })).status).toBe(403);
  });
});

describe('weeks (sections 36-38, 53-56)', () => {
  async function makeWeeks() {
    const res = await c.cmd.post('/api/weeks/generate', {
      startDate: '2026-10-04',
      count: 3,
      names: ['שבוע התקפה', 'שבוע הגנה', 'שבוע ניווט'],
      leadIds: [c.ids.s1, c.ids.s2, c.ids.s3],
    });
    expect(res.status).toBe(200);
    return res.body as { id: number; name: string; startDate: string; endDate: string; leadId: number }[];
  }

  it('generates the course weeks and updates course dates', async () => {
    const weeks = await makeWeeks();
    expect(weeks.map((w) => [w.name, w.startDate, w.endDate])).toEqual([
      ['שבוע התקפה', '2026-10-04', '2026-10-10'],
      ['שבוע הגנה', '2026-10-11', '2026-10-17'],
      ['שבוע ניווט', '2026-10-18', '2026-10-24'],
    ]);
    const me = await c.cmd.get('/api/auth/me');
    expect(me.body.settings).toMatchObject({ startDate: '2026-10-04', endDate: '2026-10-24' });
    expect(notificationsOf(c.ids.s1).some((n) => n.title.includes('שבוע התקפה'))).toBe(true);
  });

  it('readiness = done / total, by domain too (sections 14, 76)', async () => {
    const [w] = await makeWeeks();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await newTask(c.cmd, { title: `t${i}`, ownerIds: [c.ids.s1], deadline: at('2026-10-06'), domain: i < 2 ? 'לוגיסטיקה' : 'בטיחות' }));
    await c.s1.post(`/api/tasks/${ids[0]}/transition`, { action: 'complete' });
    await c.s1.post(`/api/tasks/${ids[2]}/transition`, { action: 'complete' });
    await c.s1.post(`/api/tasks/${ids[3]}/transition`, { action: 'complete' });
    const d = await c.cmd.get(`/api/weeks/${w.id}`);
    expect(d.body.week.readiness).toBe(75);
    expect(d.body.byDomain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'לוגיסטיקה', readiness: 50 }),
        expect.objectContaining({ domain: 'בטיחות', readiness: 100 }),
      ]),
    );
  });

  it('week opening turns checklist items into tasks for the lead (section 38)', async () => {
    const [w] = await makeWeeks();
    const tpl = await c.cmd.post('/api/templates', {
      name: 'פתיחת שבוע',
      kind: 'week',
      items: [
        { title: 'לו"ז מאושר', offsetDays: -3, owner: 'week_lead', domain: 'לו"ז' },
        { title: 'רפואה מתואמת', offsetDays: -2, owner: String(c.ids.s3) },
        { title: 'בטיחות מאושרת', offsetDays: -1 },
      ],
    });
    // staff who do not lead the week cannot open it
    expect((await c.s2.post(`/api/weeks/${w.id}/open`, { templateId: tpl.body.id })).status).toBe(403);
    const res = await c.s1.post(`/api/weeks/${w.id}/open`, { templateId: tpl.body.id, itemIndexes: [0, 1] });
    expect(res.body.ids).toHaveLength(2);
    const d = await c.cmd.get(`/api/weeks/${w.id}`);
    expect(d.body.week.status).toBe('open');
    expect(d.body.appliedTemplateIds).toEqual([tpl.body.id]);
    const titles = d.body.tasks.map((t: { title: string; ownerId: number; deadline: string }) => [t.title, t.ownerId, t.deadline]);
    expect(titles).toEqual(
      expect.arrayContaining([
        ['לו"ז מאושר', c.ids.s1, at('2026-10-01', '18:00')],
        ['רפואה מתואמת', c.ids.s3, at('2026-10-02', '18:00')],
      ]),
    );
  });

  it('templates can be applied automatically N days before a week (section 72)', async () => {
    await makeWeeks();
    await c.cmd.post('/api/templates', { name: 'הכנת שבוע', kind: 'week', autoApplyDaysBefore: 10, items: [{ title: 'סגירת מדריכים', offsetDays: -2, owner: 'week_lead' }] });
    runAutomation();
    // weeks starting 4.10 and 11.10 are within 10 days of 1.10, 18.10 is not -> two tasks
    const rows = db().all<{ owner_id: number }>("SELECT owner_id FROM tasks WHERE title = 'סגירת מדריכים' ORDER BY deadline");
    expect(rows.map((r) => r.owner_id)).toEqual([c.ids.s1, c.ids.s2]);
    runAutomation();
    expect(db().get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE title = 'סגירת מדריכים'")!.n).toBe(2);
  });

  it('closing a week: check, carry over, cancel, lessons that become tasks (sections 54-56)', async () => {
    const [w, next] = await makeWeeks();
    const late = await newTask(c.cmd, { title: 'תיאום הסעה', ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    const move = await newTask(c.cmd, { title: 'סגירת תיק תרגיל', ownerIds: [c.ids.s1], deadline: at('2026-10-09') });
    const cancel = await newTask(c.cmd, { title: 'הזמנת ציוד', ownerIds: [c.ids.s2], deadline: at('2026-10-09') });
    clock.set(new Date(at('2026-10-09', '20:00')));

    const check = await c.s1.get(`/api/weeks/${w.id}/close-check`);
    expect(check.body.overdue.map((t: { id: number }) => t.id).sort()).toEqual([late, move, cancel].sort());
    expect(check.body.nextWeek.id).toBe(next.id);
    expect(check.body.lessonsCount).toBe(0);

    const lesson = await c.s1.post(`/api/weeks/${w.id}/lessons`, {
      kind: 'change',
      body: 'יש לסגור מדריכים מוקדם יותר',
      task: { title: 'סגירת מדריכים עד יום שלישי', ownerId: c.ids.s2, deadline: at('2026-10-13') },
    });
    expect(lesson.body.lessons[0].taskTitle).toBe('סגירת מדריכים עד יום שלישי');

    const res = await c.s1.post(`/api/weeks/${w.id}/close`, {
      decisions: [
        { taskId: late, action: 'keep' },
        { taskId: move, action: 'move', newDeadline: at('2026-10-14') },
        { taskId: cancel, action: 'cancel', reason: 'לא נדרש יותר' },
      ],
    });
    expect(res.body.status).toBe('closed');
    const moved = (await c.cmd.get(`/api/tasks/${move}`)).body.task;
    expect(moved).toMatchObject({ weekId: next.id, carriedCount: 1, deadline: at('2026-10-14') });
    expect((await c.cmd.get(`/api/tasks/${cancel}`)).body.task).toMatchObject({ status: 'cancelled', cancelReason: 'לא נדרש יותר' });
    expect((await c.cmd.get(`/api/tasks/${late}`)).body.task).toMatchObject({ weekId: w.id, overdue: true });
    const lessonTask = db().get<{ week_id: number; owner_id: number }>("SELECT week_id, owner_id FROM tasks WHERE title = 'סגירת מדריכים עד יום שלישי'")!;
    expect(lessonTask).toEqual({ week_id: next.id, owner_id: c.ids.s2 });
    expect(notificationsOf(c.ids.cmd).some((n) => n.title.includes('נסגר'))).toBe(true);
    // weekly snapshot counts the carried task
    const report = await c.cmd.get('/api/reports/weekly?from=2026-10-04');
    expect(report.body.carried).toBe(1);
  });

  it('the commander approves the coming week', async () => {
    const [w] = await makeWeeks();
    expect((await c.s1.post(`/api/weeks/${w.id}/approve`)).status).toBe(403);
    const res = await c.cmd.post(`/api/weeks/${w.id}/approve`);
    expect(res.body.approvedByName).toBe('מפקד הקורס');
  });
});

describe('schedule <-> tasks (sections 22-23, 66-67)', () => {
  it('moving an activity offers to shift its linked tasks', async () => {
    const ev = await c.cmd.post('/api/events', { date: '2026-10-07', startTime: '10:00', title: 'מטווח', location: 'מטווח 3', ownerId: c.ids.s2 });
    expect(ev.status).toBe(200);
    const eid = ev.body.event.id;
    const t1 = await newTask(c.cmd, { title: 'תיאום מטווח', ownerIds: [c.ids.s2], eventId: eid, deadline: at('2026-10-05', '12:00') });
    await newTask(c.cmd, { title: 'הזמנת תחמושת', ownerIds: [c.ids.s1], eventId: eid, deadline: at('2026-10-06', '12:00') });

    const upd = await c.cmd.patch(`/api/events/${eid}`, { date: '2026-10-08' });
    expect(upd.body.deltaMinutes).toBe(24 * 60);
    expect(upd.body.affectedTasks).toHaveLength(2);
    expect(notificationsOf(c.ids.s2).some((n) => n.type === 'event_changed')).toBe(true);

    await c.cmd.post(`/api/events/${eid}/shift-tasks`, { taskIds: [t1], deltaMinutes: upd.body.deltaMinutes });
    expect((await c.cmd.get(`/api/tasks/${t1}`)).body.task.deadline).toBe(at('2026-10-06', '12:00'));
  });

  it('cancelling an activity: cancel tasks or keep them independent', async () => {
    const a = (await c.cmd.post('/api/events', { date: '2026-10-07', startTime: '10:00', title: 'מטווח' })).body.event.id;
    const ta = await newTask(c.cmd, { title: 'תיאום מטווח', ownerIds: [c.ids.s2], eventId: a });
    await c.cmd.post(`/api/events/${a}/cancel`, { taskAction: 'cancel' });
    expect((await c.cmd.get(`/api/tasks/${ta}`)).body.task.status).toBe('cancelled');

    const b = (await c.cmd.post('/api/events', { date: '2026-10-08', startTime: '10:00', title: 'ניווט' })).body.event.id;
    const tb = await newTask(c.cmd, { title: 'הכנת מפות', ownerIds: [c.ids.s1], eventId: b });
    await c.cmd.post(`/api/events/${b}/cancel`, { taskAction: 'keep' });
    expect((await c.cmd.get(`/api/tasks/${tb}`)).body.task).toMatchObject({ status: 'todo', eventId: null });
    expect((await c.cmd.get(`/api/events/${b}`)).body.event.cancelled).toBe(true);
  });

  it('an activity template creates its prep tasks relative to the activity (section 58)', async () => {
    const ev = (await c.cmd.post('/api/events', { date: '2026-10-08', startTime: '09:00', title: 'תרגיל התקפה', ownerId: c.ids.s3 })).body.event.id;
    const tpl = await c.cmd.post('/api/templates', {
      name: 'הכנת פעילות',
      kind: 'activity',
      items: [
        { title: 'לסגור שטח', offsetDays: -5, owner: 'event_owner', stage: 'תיאומים' },
        { title: 'תדריך בטיחות', offsetDays: -1, time: '12:00', owner: 'event_owner', stage: 'אישורים', priority: 'high' },
      ],
    });
    const res = await c.s3.post(`/api/templates/${tpl.body.id}/apply`, { eventId: ev });
    expect(res.status).toBe(200);
    const d = await c.cmd.get(`/api/events/${ev}`);
    expect(d.body.tasks.map((t: { title: string; deadline: string }) => [t.title, t.deadline])).toEqual([
      ['לסגור שטח', at('2026-10-03')],
      ['תדריך בטיחות', at('2026-10-07', '12:00')],
    ]);
    expect(d.body.event).toMatchObject({ taskTotal: 2, taskDone: 0 });
  });

  it('staff cannot add events outside their week', async () => {
    expect((await c.s1.post('/api/events', { date: '2026-10-07', startTime: '10:00', title: 'x' })).status).toBe(403);
  });
});

describe('dashboard and reports', () => {
  it('computes the four headline numbers and the attention list (sections 4-5)', async () => {
    await newTask(c.cmd, { title: 'היום', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '18:00') });
    await newTask(c.cmd, { title: 'באיחור', ownerIds: [c.ids.s2], deadline: at('2026-09-30', '18:00') });
    await newTask(c.cmd, { title: 'בשבוע', ownerIds: [c.ids.s2], deadline: at('2026-10-05', '18:00') });
    const doneId = await newTask(c.cmd, { title: 'הושלמה', ownerIds: [c.ids.s3], deadline: at('2026-10-02', '18:00') });
    await c.s3.post(`/api/tasks/${doneId}/transition`, { action: 'complete' });
    // stale: started 4 days ago and not updated since
    clock.set(new Date(zonedIso('2026-09-27', '10:00', TZ)));
    const stale = await newTask(c.cmd, { title: 'בניית שיעור התקפה', ownerIds: [c.ids.s1], deadline: at('2026-10-20') });
    await c.s1.post(`/api/tasks/${stale}/transition`, { action: 'start' });
    // untouched but far from its deadline - not flagged
    const quiet = await newTask(c.cmd, { title: 'תכנון ניווט לילה', ownerIds: [c.ids.s1], deadline: at('2026-10-20') });
    clock.set(new Date(zonedIso('2026-10-01', '10:00', TZ)));

    const d = (await c.cmd.get('/api/dashboard')).body;
    expect(d.stats).toMatchObject({ today: 1, overdue: 1, week: 2, doneThisWeek: 1 });
    const kinds = d.attention.map((a: { kind: string; title: string }) => `${a.kind}:${a.title}`);
    expect(kinds).toEqual(expect.arrayContaining(['overdue:באיחור', 'due_soon:היום', 'stale:בניית שיעור התקפה']));
    expect(d.attention.find((a: { taskId: number }) => a.taskId === stale).subtitle).toBe('לא עודכן במשך 4 ימים');
    expect(d.attention.find((a: { taskId: number }) => a.taskId === quiet)).toBeUndefined();
    expect(d.staff.find((s: { userId: number }) => s.userId === c.ids.s2)).toMatchObject({ open: 2, overdue: 1 });
    expect((await c.s1.get('/api/dashboard')).status).toBe(403);
  });

  it('copies of an all-staff task appear once in the attention list', async () => {
    await c.cmd.post('/api/tasks', { title: 'מעבר על נהלים', assignMode: 'all', deadline: at('2026-09-30', '18:00') });
    const d = (await c.cmd.get('/api/dashboard')).body;
    const items = d.attention.filter((a: { title: string }) => a.title === 'מעבר על נהלים');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'overdue', count: 3 });
    expect(items[0].ownerName).toContain('מפק"צ 1');
  });

  it('staff page shows on-time / late percentages (section 12)', async () => {
    const a = await newTask(c.cmd, { title: 'a', ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    const b = await newTask(c.cmd, { title: 'b', ownerIds: [c.ids.s1], deadline: at('2026-09-30') });
    await newTask(c.cmd, { title: 'c', ownerIds: [c.ids.s1], deadline: at('2026-09-29') });
    await c.s1.post(`/api/tasks/${a}/transition`, { action: 'complete' });
    await c.s1.post(`/api/tasks/${b}/transition`, { action: 'complete' });
    const p = (await c.cmd.get(`/api/team/${c.ids.s1}`)).body;
    expect(p.stats).toMatchObject({ onTimePct: 33, latePct: 33, openLatePct: 33 });
    expect((await c.s2.get(`/api/team/${c.ids.s1}`)).status).toBe(403);
  });

  it('search covers tasks, staff, weeks and events (section 19)', async () => {
    await newTask(c.cmd, { title: 'תיאום מטווח', ownerIds: [c.ids.s2], domain: 'תיאומים' });
    await c.cmd.post('/api/weeks', { name: 'שבוע מטווחים', startDate: '2026-11-01', endDate: '2026-11-07' });
    await c.cmd.post('/api/events', { date: '2026-10-07', startTime: '10:00', title: 'מטווח לילה' });
    const r = (await c.cmd.get(`/api/search?q=${encodeURIComponent('מטווח')}`)).body;
    expect(r.tasks).toHaveLength(1);
    expect(r.weeks).toHaveLength(1);
    expect(r.events).toHaveLength(1);
    expect((await c.cmd.get(`/api/search?q=${encodeURIComponent('מפק"צ 2')}`)).body.users).toHaveLength(1);
    expect((await c.s1.get(`/api/search?q=${encodeURIComponent('מטווח')}`)).body.tasks).toHaveLength(0);
  });

  it('look-ahead counts the next 14 days (section 25) and day-end summarises (section 52)', async () => {
    await newTask(c.cmd, { title: 'a', ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    await newTask(c.cmd, { title: 'b', ownerIds: [c.ids.s1], deadline: at('2026-10-12') });
    await newTask(c.cmd, { title: 'c', ownerIds: [c.ids.s1], deadline: at('2026-10-30') });
    const la = (await c.cmd.get('/api/reports/lookahead')).body;
    expect(la.days).toHaveLength(14);
    expect(la.weeks.map((w: { total: number }) => w.total)).toEqual([1, 1]);
    const t = await newTask(c.cmd, { title: 'היום', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '17:00') });
    await newTask(c.cmd, { title: 'עוד היום', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '19:00') });
    await newTask(c.cmd, { title: 'מחר', ownerIds: [c.ids.s1], deadline: at('2026-10-02', '09:00') });
    await c.s1.post(`/api/tasks/${t}/transition`, { action: 'complete' });
    const de = (await c.s1.get('/api/reports/day-end')).body;
    expect(de).toMatchObject({ dueToday: 2, doneToday: 1 });
    expect(de.stillOpen.map((x: { title: string }) => x.title)).toEqual(['עוד היום']);
    expect(de.tomorrow.map((x: { title: string }) => x.title)).toEqual(['מחר']);
  });

  it('staff meeting: tasks opened during the meeting appear in its summary (sections 68-69)', async () => {
    const m = (await c.cmd.post('/api/meetings', { title: 'ישיבת סגל שבועית' })).body;
    await newTask(c.cmd, { title: 'לבדוק הקדמת מטווח', ownerIds: [c.ids.s3], meetingId: m.id });
    await c.cmd.patch(`/api/meetings/${m.id}`, { decisions: '- שינוי לו"ז\n- מפק"צ 2 אחראי על ניווט', followUps: 'אישור מדריך' });
    const ended = (await c.cmd.post(`/api/meetings/${m.id}/end`)).body;
    expect(ended.summary.newTasks.map((t: { title: string }) => t.title)).toEqual(['לבדוק הקדמת מטווח']);
    expect(ended.summary.decisions).toEqual(['שינוי לו"ז', 'מפק"צ 2 אחראי על ניווט']);
    expect(ended.summary.followUps).toEqual(['אישור מדריך']);
  });
});

describe('housekeeping', () => {
  it('once a day removes ended sessions, old notifications and expired locks', async () => {
    const { housekeeping } = await import('../src/automation');
    const { db } = await import('../src/db');
    const now = new Date('2026-12-31T08:00:00Z');
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day).toISOString();
    db().run("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES ('old', 1, ?, ?)", at(40), at(10));
    db().run("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES ('live', 1, ?, ?)", at(1), at(-29));
    const note = (id: number, daysAgo: number, read: boolean) =>
      db().run("INSERT INTO notifications(id, user_id, type, category, title, read_at, created_at) VALUES (?, 1, 'x', 'info', 'x', ?, ?)", id, read ? at(daysAgo) : null, at(daysAgo));
    note(9001, 70, true); // read, old: goes
    note(9002, 70, false); // unread, not that old: stays
    note(9003, 130, false); // over four months: goes
    note(9004, 10, true); // recent: stays
    db().run("INSERT INTO login_lockouts(key, until) VALUES ('k', ?)", now.getTime() - 1000);

    expect(housekeeping(now)).toBeGreaterThanOrEqual(4);
    const ids = db().all<{ id: number }>('SELECT id FROM notifications WHERE id > 9000 ORDER BY id').map((r) => r.id);
    expect(ids).toEqual([9002, 9004]);
    expect(db().all<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE token_hash IN ('old', 'live')").map((s) => s.token_hash)).toEqual(['live']);
    expect(db().get('SELECT 1 FROM login_lockouts')).toBeUndefined();
    expect(housekeeping(now)).toBe(0); // once a day
  });
});

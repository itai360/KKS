import { beforeEach, describe, expect, it } from 'vitest';
import { clock } from '../src/core';
import { db } from '../src/db';
import { runAutomation } from '../src/automation';
import { morningBrief, resetMorningBrief } from '../src/digest';
import { streamHandler } from '../src/realtime';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
  resetMorningBrief();
});

const briefs = (uid: number) =>
  notificationsOf(uid)
    .filter((n) => n.type === 'brief')
    .map((n) => ({ ...n, body: db().get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND type = 'brief' AND title = ?", uid, n.title)!.body }));

describe('morning brief', () => {
  it('once a day from seven: what is due today, what is late, the activities one runs - and only when there is something', async () => {
    await c.cmd.post('/api/tasks', { title: 'סגירת לו"ז', ownerIds: [c.ids.s1], deadline: at('2026-10-02', '16:00') });
    await c.cmd.post('/api/tasks', { title: 'דוח ציוד', ownerIds: [c.ids.s1], deadline: at('2026-10-01', '18:00') });
    await c.cmd.post('/api/events', { date: '2026-10-02', startTime: '08:00', title: 'מטווח', ownerId: c.ids.s1 });
    // a leave that day: no brief
    await c.s3.post('/api/absences', { startDate: '2026-10-02', endDate: '2026-10-02' });
    await c.cmd.post('/api/tasks', { title: 'משהו', ownerIds: [c.ids.s3], deadline: at('2026-10-02', '12:00') });

    clock.set(new Date(at('2026-10-02', '06:30')));
    expect(morningBrief(clock.now())).toBe(0);
    clock.set(new Date(at('2026-10-02', '07:01')));
    morningBrief(clock.now());
    expect(briefs(c.ids.s1)).toEqual([
      expect.objectContaining({
        title: 'בוקר טוב - משימה אחת להיום, 1 באיחור, פעילות אחת באחריותך',
        // each task on a line of its own, with its deadline: late first, then today
        body: 'באיחור · דוח ציוד (אתמול 18:00)\nהיום 16:00 · סגירת לו"ז\nבלו"ז היום: 08:00 מטווח',
        category: 'action',
        link: '/my',
      }),
    ]);
    expect(briefs(c.ids.s2)).toHaveLength(0); // nothing open
    expect(briefs(c.ids.s3)).toHaveLength(0); // away
    // again that day (another instance, or a restart): still one
    resetMorningBrief();
    morningBrief(new Date(at('2026-10-02', '08:00')));
    expect(briefs(c.ids.s1)).toHaveLength(1);
    // a server first woken in the afternoon sends no morning brief
    resetMorningBrief();
    expect(morningBrief(new Date(at('2026-10-04', '15:00')))).toBe(0);
  });
});

describe('morning brief - the week ahead', () => {
  it('lists the tasks of the coming days too, every day there are any, and counts what does not fit', async () => {
    const make = (title: string, date: string, time = '12:00', ownerIds = [c.ids.s2]) => c.cmd.post('/api/tasks', { title, ownerIds, deadline: at(date, time) });
    await make('תיאום הסעה', '2026-10-03', '09:00');
    await make('הכנת מצגת', '2026-10-05', '18:00');
    // more than a week away: counted, not listed
    await make('סיכום קורס', '2026-10-20');
    // one they are on, not theirs
    const [shared] = (await c.cmd.post('/api/tasks', { title: 'תרגיל משותף', ownerIds: [c.ids.s3], deadline: at('2026-10-04', '10:00') })).body.ids;
    await c.cmd.patch(`/api/tasks/${shared}`, { participantIds: [c.ids.s2] });

    clock.set(new Date(at('2026-10-02', '07:30')));
    morningBrief(clock.now());
    const [b] = briefs(c.ids.s2);
    expect(b.title).toBe('בוקר טוב - 3 השבוע');
    expect(b.category).toBe('info');
    expect(b.body.split('\n')).toEqual(['מחר 09:00 · תיאום הסעה', 'ראשון 10:00 · תרגיל משותף', 'שני 18:00 · הכנת מצגת', 'ועוד משימה פתוחה אחת']);
  });
});

describe('snoozed notifications', () => {
  it('leave the list and the count until their time, then come back unread on top', async () => {
    await c.cmd.post('/api/tasks', { title: 'להחזיר ציוד', ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    const list = async (q = '') => (await c.s1.get(`/api/notifications${q}`)).body as { id: number; title: string; read: boolean; snoozedUntil: string | null }[];
    const n = (await list())[0];
    const unread = async () => (await c.s1.get('/api/auth/me')).body.unread as number;
    expect(await unread()).toBe(1);

    expect((await c.s1.post(`/api/notifications/${n.id}/snooze`, { until: at('2026-10-01', '09:00') })).status).toBe(400); // in the past
    const res = await c.s1.post(`/api/notifications/${n.id}/snooze`, { until: at('2026-10-02', '06:30') });
    expect(res.body.unread).toBe(0);
    expect(await list()).toHaveLength(0);
    expect((await list('?snoozed=1')).map((x) => x.snoozedUntil)).toEqual([at('2026-10-02', '06:30')]);
    // someone else's: not found
    expect((await c.s2.post(`/api/notifications/${n.id}/snooze`, { until: at('2026-10-03') })).status).toBe(404);

    // before seven: no morning brief in between
    clock.set(new Date(at('2026-10-02', '06:31')));
    runAutomation();
    const back = await list();
    expect(back[0]).toMatchObject({ id: n.id, read: false, snoozedUntil: null });
    expect(await unread()).toBe(1);

    // and "now" brings one back at once
    await c.s1.post(`/api/notifications/${n.id}/snooze`, { until: at('2026-10-09', '08:00') });
    await c.s1.post(`/api/notifications/${n.id}/snooze`, { until: null });
    expect((await list())[0]).toMatchObject({ id: n.id, read: false });
  });
});

describe('notifications, live', () => {
  it('can be new again, and every open screen of the person hears how many are unread after each change', async () => {
    await c.cmd.post('/api/tasks', { title: 'להחזיר ציוד', ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    await c.cmd.post('/api/tasks', { title: 'לתאם הסעה', ownerIds: [c.ids.s1], deadline: at('2026-10-06') });
    // one of the person's screens, listening
    const heard: unknown[] = [];
    const res = { writeHead: () => undefined, write: (chunk: string) => void (chunk.startsWith('data: ') && heard.push(JSON.parse(chunk.slice(6)))) };
    let hangUp = () => undefined as void;
    streamHandler({ user: { id: c.ids.s1 }, on: (_: string, fn: () => void) => void (hangUp = fn) } as never, res as never);
    const states = () => heard.filter((m) => (m as { type: string }).type === 'notifications');
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const [a, b] = (await c.s1.get('/api/notifications')).body as { id: number }[];
    expect((await c.s1.get('/api/notifications/unread')).body).toEqual({ unread: 2 });
    expect((await c.s1.post('/api/notifications/read', { ids: [a.id] })).body).toEqual({ unread: 1 });
    await tick();
    expect(states().at(-1)).toEqual({ type: 'notifications', unread: 1 });

    // new again
    expect((await c.s1.post('/api/notifications/unread', { ids: [a.id] })).body).toEqual({ unread: 2 });
    await tick();
    expect(states().at(-1)).toEqual({ type: 'notifications', unread: 2 });
    // someone else's stays as it is
    await c.s2.post('/api/notifications/read', { ids: [b.id] });
    expect((await c.s1.get('/api/notifications/unread')).body.unread).toBe(2);
    expect((await c.s2.post('/api/notifications/unread', { ids: [] })).status).toBe(400);

    // deleted in place (a swipe): heard too
    await c.s1.post('/api/bulk', { entity: 'notifications', action: 'delete', ids: [b.id] });
    await tick();
    expect(states().at(-1)).toEqual({ type: 'notifications', unread: 1 });

    // one put off is not made new by "unread" - it stays put off
    await c.s1.post(`/api/notifications/${a.id}/snooze`, { until: at('2026-10-03', '08:00') });
    await c.s1.post('/api/notifications/unread', { ids: [a.id] });
    expect((await c.s1.get('/api/notifications?snoozed=1')).body[0]).toMatchObject({ id: a.id, read: true });
    expect((await c.s1.get('/api/notifications/unread')).body.unread).toBe(0);
    hangUp();
  });
});

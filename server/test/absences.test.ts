import { beforeEach, describe, expect, it } from 'vitest';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const task = (agent: Ctx['cmd'], ownerId: number, deadline: string, title = 'משימה') => agent.post('/api/tasks', { title, ownerIds: [ownerId], deadline });

describe('staff availability', () => {
  it('a person marks their own leave; the commander hears of it with the tasks it touches', async () => {
    await task(c.cmd, c.ids.s1, at('2026-10-06'), 'הזמנת שטח');
    await task(c.cmd, c.ids.s1, at('2026-10-20'), 'אחרי החופשה');
    const res = await c.s1.post('/api/absences', { startDate: '2026-10-05', endDate: '2026-10-07', reason: 'leave', note: 'חתונה של אח' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: c.ids.s1, reason: 'leave', tasksDue: 1 });
    const n = notificationsOf(c.ids.cmd).find((x) => x.type === 'absence');
    expect(n).toMatchObject({ title: 'מפק"צ 1 - חופשה 5.10-7.10', category: 'action', link: `/team/${c.ids.s1}` });

    // overlapping days are refused; someone else's leave is the commander's to mark
    expect((await c.s1.post('/api/absences', { startDate: '2026-10-07', endDate: '2026-10-08' })).status).toBe(400);
    expect((await c.s1.post('/api/absences', { userId: c.ids.s2, startDate: '2026-10-12', endDate: '2026-10-12' })).status).toBe(403);
    expect((await c.cmd.post('/api/absences', { userId: c.ids.s2, startDate: '2026-10-12', endDate: '2026-10-12', reason: 'course' })).status).toBe(200);
    expect(notificationsOf(c.ids.s2).some((x) => x.title === 'מפק"צ 2 - השתלמות 12.10')).toBe(true);
    expect((await c.s3.get('/api/absences')).body.map((a: { userName: string }) => a.userName)).toEqual(['מפק"צ 1', 'מפק"צ 2']);
  });

  it('shows who is away and how loaded everyone is when choosing an owner', async () => {
    await c.s2.post('/api/absences', { startDate: '2026-10-05', endDate: '2026-10-09', reason: 'duty' });
    await task(c.cmd, c.ids.s1, at('2026-10-02'));
    await task(c.cmd, c.ids.s1, at('2026-10-05'));
    await task(c.cmd, c.ids.s1, at('2026-09-30')); // overdue
    const load = (await c.s3.get('/api/load?date=2026-10-05')).body as { userId: number; week: number; overdue: number; onDay: number; away: { reason: string } | null }[];
    const s1 = load.find((l) => l.userId === c.ids.s1)!;
    const s2 = load.find((l) => l.userId === c.ids.s2)!;
    expect(s1).toMatchObject({ week: 3, overdue: 1, onDay: 1, away: null });
    expect(s2).toMatchObject({ week: 0, away: { reason: 'duty', endDate: '2026-10-09' } });
    expect((await c.s3.get('/api/load?date=2026-10-12')).body.find((l: { userId: number }) => l.userId === c.ids.s2).away).toBeNull();
  });

  it('puts an absence with tasks due during it on the commander\'s dashboard, and the person as away today', async () => {
    await task(c.cmd, c.ids.s3, at('2026-10-04'), 'סגירת מדריכים');
    await c.s3.post('/api/absences', { startDate: '2026-10-01', endDate: '2026-10-04', reason: 'sick' });
    const dash = (await c.cmd.get('/api/dashboard')).body;
    expect(dash.attention.find((a: { kind: string }) => a.kind === 'away')).toMatchObject({ userId: c.ids.s3, title: 'מפק"צ 3 - מחלה 1.10-4.10' });
    expect(dash.staff.find((s: { userId: number }) => s.userId === c.ids.s3).away).toMatchObject({ reason: 'sick', endDate: '2026-10-04' });
    // removed: gone from the dashboard
    const id = (await c.s3.get(`/api/absences?user=${c.ids.s3}`)).body[0].id;
    expect((await c.s1.del(`/api/absences/${id}`)).status).toBe(403);
    await c.s3.del(`/api/absences/${id}`);
    expect((await c.cmd.get('/api/dashboard')).body.attention.some((a: { kind: string }) => a.kind === 'away')).toBe(false);
  });
});

describe('my contact details', () => {
  it('anyone sets their own phone and email; the directory shows them to all', async () => {
    const res = await c.s1.patch('/api/me/contact', { phone: '050-1234567', email: 's1@kks.org' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: '050-1234567', email: 's1@kks.org' });
    expect((await c.s2.patch('/api/me/contact', { email: 'not an email' })).status).toBe(400);
    const users = (await c.s3.get('/api/users')).body as { id: number; phone: string }[];
    expect(users.find((u) => u.id === c.ids.s1)?.phone).toBe('050-1234567');
  });
});

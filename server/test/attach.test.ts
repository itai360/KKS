// Attaching people to a task beside its owner - the commander following a staff member's task: in a tap
// ("צרפו אותי"), by the ones on it, or when the task is opened.

import { beforeEach, describe, expect, it } from 'vitest';
import type { MyTasksData, TaskDetail } from '../../shared/types';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { db } from '../src/db';
import { morningBrief, resetMorningBrief } from '../src/digest';
import { at, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const detail = async (id: number) => (await c.cmd.get(`/api/tasks/${id}`)).body as TaskDetail;
const mine = async (agent: Ctx['cmd']) => {
  const d = (await agent.get('/api/my')).body as MyTasksData;
  return [...d.overdue, ...d.today, ...d.important, ...d.week, ...d.later].map((t) => t.title);
};

describe('attaching to a task', () => {
  it('when it is opened: the commander follows it - told so, and it is in his oversight, not among his tasks', async () => {
    const r = await c.s1.post('/api/tasks', { title: 'חלוקת שבועות למחזור הבא', ownerIds: [c.ids.s1], attachIds: [c.ids.cmd], deadline: at('2026-10-08') });
    expect(r.status).toBe(200);
    const id = r.body.ids[0] as number;
    expect((await detail(id)).task).toMatchObject({ ownerId: c.ids.s1, participantIds: [c.ids.cmd], overseerIds: [c.ids.cmd] });
    expect(notificationsOf(c.ids.cmd).map((n) => [n.type, n.category, n.title])).toEqual([['task_assigned', 'info', 'לבקרה שלך: "חלוקת שבועות למחזור הבא"']]);
    expect(await mine(c.cmd)).not.toContain('חלוקת שבועות למחזור הבא');
    expect(((await c.cmd.get('/api/my')).body as MyTasksData).oversight.map((t) => t.title)).toEqual(['חלוקת שבועות למחזור הבא']);
    // a copy for each person stays each one's own: no one attached to the copies
    const copies = await c.s1.post('/api/tasks', { title: 'הגשת סילבוס', ownerIds: [c.ids.s1, c.ids.s2], assignMode: 'copies', attachIds: [c.ids.cmd], deadline: at('2026-10-08') });
    for (const tid of copies.body.ids as number[]) expect((await detail(tid)).task.participantIds).toEqual([]);
  });

  it('"צרפו אותי": anyone who sees it joins and leaves; others are attached by the ones on it', async () => {
    const id = (await c.cmd.post('/api/tasks', { title: 'אישור גאנט למסע', ownerIds: [c.ids.s1], deadline: at('2026-10-08') })).body.ids[0] as number;
    // s2 is not on it: attaches only themselves
    expect((await c.s2.post(`/api/tasks/${id}/attach`, { add: [c.ids.s3] })).status).toBe(403);
    const joined = await c.s2.post(`/api/tasks/${id}/attach`, { add: [c.ids.s2] });
    expect(joined.status).toBe(200);
    expect((joined.body as TaskDetail).task.participantIds).toEqual([c.ids.s2]);
    expect((joined.body as TaskDetail).permissions.canAttach).toBe(true);
    // the owner attaches s3; the owner is never attached to their own task
    await c.s1.post(`/api/tasks/${id}/attach`, { add: [c.ids.s3, c.ids.s1] });
    expect((await detail(id)).task.participantIds.sort()).toEqual([c.ids.s2, c.ids.s3].sort());
    expect(notificationsOf(c.ids.s3).map((n) => n.title)).toContain('צורפת למשימה: "אישור גאנט למסע"');
    // taking someone else off: not for another attached one - for the owner
    expect((await c.s2.post(`/api/tasks/${id}/attach`, { remove: [c.ids.s3] })).status).toBe(403);
    await c.s1.post(`/api/tasks/${id}/attach`, { remove: [c.ids.s3] });
    // and leaving is one's own
    await c.s2.post(`/api/tasks/${id}/attach`, { remove: [c.ids.s2] });
    expect((await detail(id)).task.participantIds).toEqual([]);
  });

  it('overseen (בבקרה): no reminder to do it - told when it goes late, whose it is; in his morning brief apart', async () => {
    const id = (await c.s1.post('/api/tasks', { title: 'תיאום הסעות', ownerIds: [c.ids.s1], attachIds: [c.ids.cmd], deadline: at('2026-10-03', '12:00') })).body.ids[0] as number;
    const of = (uid: number) => db().all<{ type: string; category: string; body: string }>('SELECT type, category, body FROM notifications WHERE user_id = ? AND task_id = ? ORDER BY id', uid, id);
    // a day before: the one doing it is reminded; the commander is not
    clock.set(new Date(at('2026-10-02', '13:00')));
    runAutomation();
    expect(of(c.ids.s1).map((n) => n.type)).toContain('reminder_24h');
    expect(of(c.ids.cmd).map((n) => n.type)).not.toContain('reminder_24h');
    // gone late: the one doing it is asked what now; the commander hears whose it is
    clock.set(new Date(at('2026-10-03', '12:30')));
    runAutomation();
    expect(of(c.ids.s1).at(-1)).toMatchObject({ type: 'overdue', category: 'exception' });
    expect(of(c.ids.cmd).at(-1)).toEqual({ type: 'overdue', category: 'info', body: 'אחראי: מפק"צ 1' });
    // the next morning: his own tasks are none; his oversight has one late
    resetMorningBrief();
    clock.set(new Date(at('2026-10-04', '07:30')));
    morningBrief(clock.now());
    const brief = db().get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND type = 'brief'", c.ids.cmd)!;
    expect(brief).toEqual({ title: 'בוקר טוב - משימה אחת בבקרה שלך', body: 'בבקרה שלך: 1 באיחור' });
  });

  it('a commander who joins a task himself oversees it; a staff member attached takes part in it', async () => {
    const id = (await c.s2.post('/api/tasks', { title: 'הכנת מצגת', ownerIds: [c.ids.s2], deadline: at('2026-10-08') })).body.ids[0] as number;
    await c.cmd.post(`/api/tasks/${id}/attach`, { add: [c.ids.cmd] });
    await c.s2.post(`/api/tasks/${id}/attach`, { add: [c.ids.s3] });
    expect((await detail(id)).task).toMatchObject({ participantIds: expect.arrayContaining([c.ids.cmd, c.ids.s3]), overseerIds: [c.ids.cmd] });
    expect(await mine(c.cmd)).not.toContain('הכנת מצגת');
    expect(await mine(c.s3)).toContain('הכנת מצגת');
    expect(notificationsOf(c.ids.s3).map((n) => n.title)).toContain('צורפת למשימה: "הכנת מצגת"');
  });

  it('a private task is not there to join', async () => {
    const id = (await c.cmd.post('/api/tasks', { title: 'שיחה אישית', ownerIds: [c.ids.s1], visibility: 'private', deadline: at('2026-10-08') })).body.ids[0] as number;
    expect((await c.s2.post(`/api/tasks/${id}/attach`, { add: [c.ids.s2] })).status).toBe(404);
  });
});

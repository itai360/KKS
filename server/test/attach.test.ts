// Attaching people to a task beside its owner - the commander following a staff member's task: in a tap
// ("צרפו אותי"), by the ones on it, or when the task is opened.

import { beforeEach, describe, expect, it } from 'vitest';
import type { MyTasksData, TaskDetail } from '../../shared/types';
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
  it('when it is opened: the commander follows it - told so, and it is in his list', async () => {
    const r = await c.s1.post('/api/tasks', { title: 'חלוקת שבועות למחזור הבא', ownerIds: [c.ids.s1], attachIds: [c.ids.cmd], deadline: at('2026-10-08') });
    expect(r.status).toBe(200);
    const id = r.body.ids[0] as number;
    expect((await detail(id)).task).toMatchObject({ ownerId: c.ids.s1, participantIds: [c.ids.cmd] });
    expect(notificationsOf(c.ids.cmd).map((n) => [n.type, n.category, n.title])).toEqual([['task_assigned', 'info', 'צורפת למשימה: "חלוקת שבועות למחזור הבא"']]);
    expect(await mine(c.cmd)).toContain('חלוקת שבועות למחזור הבא');
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

  it('a private task is not there to join', async () => {
    const id = (await c.cmd.post('/api/tasks', { title: 'שיחה אישית', ownerIds: [c.ids.s1], visibility: 'private', deadline: at('2026-10-08') })).body.ids[0] as number;
    expect((await c.s2.post(`/api/tasks/${id}/attach`, { add: [c.ids.s2] })).status).toBe(404);
  });
});

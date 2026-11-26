import { beforeEach, describe, expect, it } from 'vitest';
import { at, newTask, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('a task one staff member gives another', () => {
  it('waits for the other to take it on', async () => {
    const id = await newTask(c.s1, { title: 'הכנת שטח', ownerIds: [c.ids.s2], deadline: at('2026-10-05') });
    const t = (await c.s2.get(`/api/tasks/${id}`)).body.task;
    expect(t.awaitingAccept).toBe(true);
    expect(notificationsOf(c.ids.s2)[0].title).toContain('מבקש/ת להטיל עליך משימה');
    // only the one it was given to answers
    expect((await c.s1.post(`/api/tasks/${id}/accept`, {})).status).toBe(403);
    expect((await c.s2.post(`/api/tasks/${id}/accept`, {})).status).toBe(200);
    expect((await c.s2.get(`/api/tasks/${id}`)).body.task.awaitingAccept).toBe(false);
    expect(notificationsOf(c.ids.s1)[0].title).toContain('קיבל/ה את המשימה');
    expect((await c.s2.post(`/api/tasks/${id}/accept`, {})).status).toBe(400);
  });

  it('handed back, it is whoever gave it', async () => {
    const id = await newTask(c.s1, { title: 'הזמנת ציוד', ownerIds: [c.ids.s2], deadline: at('2026-10-05') });
    expect((await c.s2.post(`/api/tasks/${id}/decline`, {})).status).toBe(200);
    const t = (await c.s1.get(`/api/tasks/${id}`)).body.task;
    expect(t.ownerId).toBe(c.ids.s1);
    expect(t.awaitingAccept).toBe(false);
    expect(notificationsOf(c.ids.s1)[0].title).toContain('החזיר/ה את המשימה');
  });

  it('passed on to another staff member waits too', async () => {
    const id = await newTask(c.s1, { title: 'סידור כיתה', ownerIds: [c.ids.s1], deadline: at('2026-10-05') });
    expect((await c.s1.get(`/api/tasks/${id}`)).body.task.awaitingAccept).toBe(false);
    expect((await c.s1.patch(`/api/tasks/${id}`, { ownerId: c.ids.s2 })).status).toBe(200);
    expect((await c.s2.get(`/api/tasks/${id}`)).body.task.awaitingAccept).toBe(true);
  });

  it('not from the commander, nor from one the commander lets give freely', async () => {
    const fromCmd = await newTask(c.cmd, { title: 'מהמפקד', ownerIds: [c.ids.s2], deadline: at('2026-10-05') });
    expect((await c.s2.get(`/api/tasks/${fromCmd}`)).body.task.awaitingAccept).toBe(false);
    // only the commander sets it
    expect((await c.s1.patch(`/api/users/${c.ids.s1}`, { assignsFreely: true })).status).toBe(403);
    expect((await c.cmd.patch(`/api/users/${c.ids.s1}`, { assignsFreely: true })).status).toBe(200);
    const free = await newTask(c.s1, { title: 'בלי אישור', ownerIds: [c.ids.s2], deadline: at('2026-10-05') });
    expect((await c.s2.get(`/api/tasks/${free}`)).body.task.awaitingAccept).toBe(false);
    expect((await c.cmd.get('/api/users')).body.find((u: { id: number }) => u.id === c.ids.s1).assignsFreely).toBe(true);
  });
});

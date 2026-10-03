import { beforeEach, describe, expect, it } from 'vitest';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('announcements to the staff', () => {
  it('goes to everyone, stays pending until confirmed, and the commander sees who has not', async () => {
    expect((await c.s1.post('/api/announcements', { title: 'שינוי בלו"ז' })).status).toBe(403);
    const res = await c.cmd.post('/api/announcements', { title: 'מסדר מפקד ביום חמישי 07:00', body: 'כל הסגל במדים א', urgent: true });
    expect(res.status).toBe(200);
    const id = res.body[0].id;
    for (const uid of [c.ids.s1, c.ids.s2, c.ids.s3]) {
      expect(notificationsOf(uid).find((n) => n.type === 'announcement')).toMatchObject({ title: 'דחוף - הודעה לסגל: מסדר מפקד ביום חמישי 07:00', category: 'exception', link: '/announcements' });
    }
    expect(notificationsOf(c.ids.cmd).some((n) => n.type === 'announcement')).toBe(false);

    // pending on s1's home until confirmed; seen is not confirmed
    expect((await c.s1.get('/api/announcements?pending=1')).body.map((a: { id: number }) => a.id)).toEqual([id]);
    await c.s1.post(`/api/announcements/${id}/read`, {});
    expect((await c.s1.get('/api/announcements?pending=1')).body).toHaveLength(1);
    const acked = (await c.s1.post(`/api/announcements/${id}/read`, { ack: true })).body[0];
    expect(acked.ackedAt).toBeTruthy();
    expect(acked.audience).toBeUndefined(); // staff do not see the others
    expect((await c.s1.get('/api/announcements?pending=1')).body).toHaveLength(0);

    // the commander: who confirmed, and a reminder to the rest
    const mine = (await c.cmd.get('/api/announcements')).body[0];
    expect(mine.audience.map((a: { name: string; ackedAt: string | null }) => [a.name, !!a.ackedAt])).toEqual([
      ['מפק"צ 2', false],
      ['מפק"צ 3', false],
      ['מפק"צ 1', true],
    ]);
    expect((await c.cmd.post(`/api/announcements/${id}/remind`)).body.reminded).toBe(2);
    expect(notificationsOf(c.ids.s2).filter((n) => n.title.startsWith('תזכורת: נא לאשר קריאה'))).toHaveLength(1);
    expect(notificationsOf(c.ids.s1).filter((n) => n.title.startsWith('תזכורת'))).toHaveLength(0);
    await c.cmd.del(`/api/announcements/${id}`);
    expect((await c.s2.get('/api/announcements')).body).toHaveLength(0);
  });
});

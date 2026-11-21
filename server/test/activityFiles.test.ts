// A week's activity file (תיק פעילות): filled in by the one looking after the activity files with the week's lead,
// and moved on - built, waiting for the company commander, sent on to headquarters, approved.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityFile, ActivityFilesWeek, Notification } from '../../shared/types';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

async function week(name: string, startDate: string, endDate: string, leadId: number | null): Promise<number> {
  const r = await c.cmd.post('/api/weeks', { name, startDate, endDate, leadId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.week?.id ?? r.body.id;
}

describe('activity files', () => {
  it("opened for a week, filled in by the activity files' person and the week's lead, approved by the commander", async () => {
    const field = await week('שבוע שטח', '2026-10-04', '2026-10-08', c.ids.s2);
    const other = await week('שבוע מטווחים', '2026-10-11', '2026-10-15', c.ids.s3);
    // s1 looks after the activity files
    expect((await c.s1.patch('/api/settings', { activityFileOwners: [c.ids.s1] })).status).toBe(403);
    expect((await c.cmd.patch('/api/settings', { activityFileOwners: [c.ids.s1] })).status).toBe(200);

    // the week's lead opens it; someone else on the staff may not
    expect((await c.s3.post('/api/activity-files', { weekId: field })).status).toBe(403);
    const made = await c.s2.post('/api/activity-files', { weekId: field, link: 'https://drive.example/file/1' });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const file = made.body as ActivityFile;
    expect(file).toMatchObject({ title: 'תיק פעילות', status: 'building', link: 'https://drive.example/file/1', canEdit: true });
    expect(file.owners.map((o) => o.id)).toEqual([c.ids.s1, c.ids.s2]);
    expect((await c.s2.post('/api/activity-files', { weekId: field, link: 'drive.example' })).status).toBe(400);

    // every week, with its files - the files' person may open one for any week
    const all = (await c.s3.get('/api/activity-files')).body as ActivityFilesWeek[];
    expect(all.map((w) => [w.name, w.files.length, w.canAdd])).toEqual([
      ['שבוע שטח', 1, false],
      ['שבוע מטווחים', 0, true],
    ]);
    expect(((await c.s1.get('/api/activity-files')).body as ActivityFilesWeek[]).every((w) => w.canAdd)).toBe(true);
    expect((await c.s1.get(`/api/activity-files?week=${other}`)).body).toHaveLength(1);

    // waiting for approval: the commander hears, and it leaves the bell once it moves on
    expect((await c.s1.patch(`/api/activity-files/${file.id}`, { status: 'awaiting', note: 'חסר נספח בטיחות' })).status).toBe(200);
    expect(notificationsOf(c.ids.cmd).at(-1)).toMatchObject({ type: 'activity_file', category: 'action', title: 'תיק פעילות של שבוע שטח ממתין לאישורך', link: `/weeks/${field}` });
    const bell = async () => ((await c.cmd.get('/api/notifications')).body as Notification[]).filter((n) => n.type === 'activity_file').length;
    expect(await bell()).toBe(1);
    // sent back: its people hear, with what is missing
    expect((await c.cmd.patch(`/api/activity-files/${file.id}`, { status: 'building' })).status).toBe(200);
    expect(notificationsOf(c.ids.s1).at(-1)).toMatchObject({ title: 'תיק פעילות של שבוע שטח הוחזר לבנייה' });
    expect(await bell()).toBe(0);
    // on: sent to headquarters, approved
    await c.s2.patch(`/api/activity-files/${file.id}`, { status: 'awaiting' });
    expect((await c.cmd.patch(`/api/activity-files/${file.id}`, { status: 'sent' })).body).toMatchObject({ status: 'sent', statusByName: 'מפקד הקורס' });
    expect((await c.cmd.patch(`/api/activity-files/${file.id}`, { status: 'approved' })).status).toBe(200);
    expect(notificationsOf(c.ids.s2).at(-1)).toMatchObject({ title: 'תיק פעילות של שבוע שטח אושר' });
    // someone not on it may not move it
    expect((await c.s3.patch(`/api/activity-files/${file.id}`, { status: 'building' })).status).toBe(403);
    expect((await c.s3.del(`/api/activity-files/${file.id}`)).status).toBe(403);
    expect((await c.s2.del(`/api/activity-files/${file.id}`)).status).toBe(200);
    expect(((await c.s2.get(`/api/activity-files?week=${field}`)).body as ActivityFilesWeek[])[0].files).toEqual([]);
  });
});

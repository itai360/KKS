// Points for the next staff meeting (נקודות לישב"ס): anyone on the staff adds one; the commander ticks
// it in the meeting, which keeps it in the meeting's summary; the writer or the commander can take it back.

import { beforeEach, describe, expect, it } from 'vitest';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const bodies = (list: { body: string }[]) => list.map((p) => p.body);

describe('points for the staff meeting', () => {
  it('anyone on the staff adds one; the writer and the commander may take it back', async () => {
    expect((await c.s2.post('/api/meeting-points', { body: '   ' })).body.error).toBe('מה להעלות בישיבת הסגל?');
    const list = (await c.s2.post('/api/meeting-points', { body: ' תיאום הסעות לתרגיל ' })).body;
    expect(list).toMatchObject([{ body: 'תיאום הסעות לתרגיל', authorName: 'מפק"צ 2', raisedAt: null, canDelete: true }]);
    await c.s3.post('/api/meeting-points', { body: 'בדיקת ציוד לפני מסע' });
    const seen = (await c.s3.get('/api/meeting-points')).body;
    expect(seen.map((p: { canDelete: boolean }) => p.canDelete)).toEqual([false, true]);
    expect((await c.cmd.get('/api/meeting-points')).body.every((p: { canDelete: boolean }) => p.canDelete)).toBe(true);
    // another staff member cannot delete it; its writer can
    expect((await c.s3.del(`/api/meeting-points/${list[0].id}`)).status).toBe(403);
    expect(bodies((await c.s2.del(`/api/meeting-points/${list[0].id}`)).body)).toEqual(['בדיקת ציוד לפני מסע']);
  });

  it('is ticked in the meeting by the commander, and goes into its summary', async () => {
    const [first] = (await c.s1.post('/api/meeting-points', { body: 'שינוי בשעת ההשכמה' })).body;
    const [, second] = (await c.s2.post('/api/meeting-points', { body: 'חלוקת תורנויות' })).body;
    expect((await c.s1.post(`/api/meeting-points/${first.id}/raise`, { raised: true })).status).toBe(403);
    const meeting = (await c.cmd.post('/api/meetings', { title: 'ישיבת סגל' })).body;
    const ticked = (await c.cmd.post(`/api/meeting-points/${first.id}/raise`, { raised: true })).body;
    // still shown while the meeting goes on, ticked
    expect(ticked.map((p: { body: string; raisedAt: string | null }) => [p.body, !!p.raisedAt])).toEqual([
      ['שינוי בשעת ההשכמה', true],
      ['חלוקת תורנויות', false],
    ]);
    // ticked by mistake, and back
    await c.cmd.post(`/api/meeting-points/${second.id}/raise`, { raised: true });
    await c.cmd.post(`/api/meeting-points/${second.id}/raise`, { raised: false });
    const ended = (await c.cmd.post(`/api/meetings/${meeting.id}/end`)).body;
    expect(ended.summary.points).toEqual([{ body: 'שינוי בשעת ההשכמה', authorName: 'מפק"צ 1' }]);
    // after the meeting only what was not raised waits for the next one
    expect(bodies((await c.s1.get('/api/meeting-points')).body)).toEqual(['חלוקת תורנויות']);
    // between meetings, ticking one marks it dealt with: it leaves the list
    expect((await c.cmd.post(`/api/meeting-points/${second.id}/raise`, { raised: true })).body).toEqual([]);
  });
});

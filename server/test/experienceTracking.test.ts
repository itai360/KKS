// Following the experiences (the tracking table): a mark on each experience, by the cadet's team commander,
// its mentor, the commander or whoever the commander chose to follow every team; and the roles cadets hold
// in the schedule's events move with their event.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Experience } from '../../shared/types';
import { db } from '../src/db';
import { setup, type Agent, type Ctx } from './helpers';

let c: Ctx;
let cadet = 0;
beforeEach(async () => {
  c = await setup(); // the clock stands on 2026-10-01
  const team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
  cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'לוי', teamId: team })).body.cadet.id;
});

const one = async (agent: Agent, id: number) => ((await agent.get('/api/experiences')).body as Experience[]).find((x) => x.id === id)!;

describe('the tracking table', () => {
  it('marks: the team commander, the mentor and the commander - not another staff member', async () => {
    const x = (await c.s1.post('/api/experiences', { cadetId: cadet, role: 'סמל תורן', startDate: '2026-10-04', endDate: '2026-10-05', mentorId: c.ids.s2 })).body as Experience;
    expect(x).toMatchObject({ markedAt: null, canMark: true });
    expect((await one(c.s3, x.id)).canMark).toBe(false);
    expect((await c.s3.post(`/api/experiences/${x.id}/mark`, { marked: true })).status).toBe(403);
    // the mentor marks; everyone sees by whom
    expect((await c.s2.post(`/api/experiences/${x.id}/mark`, { marked: true })).status).toBe(200);
    expect(await one(c.s3, x.id)).toMatchObject({ markedByName: 'מפק"צ 2' });
    expect((await one(c.s3, x.id)).markedAt).toBeTruthy();
    // the team commander takes it off, the commander puts it back
    await c.s1.post(`/api/experiences/${x.id}/mark`, { marked: false });
    expect((await one(c.cmd, x.id)).markedAt).toBeNull();
    await c.cmd.post(`/api/experiences/${x.id}/mark`, { marked: true });
    expect(await one(c.cmd, x.id)).toMatchObject({ markedByName: 'מפקד הקורס' });
  });

  it('whoever the commander chooses follows every team: sees the feedback and marks', async () => {
    const x = (await c.s1.post('/api/experiences', { cadetId: cadet, role: 'מ"מ בתרגיל', startDate: '2026-09-28', endDate: '2026-09-30', mentorId: c.ids.s2 })).body as Experience;
    const feedback = {
      general: 'הוביל את המחלקה בביטחון',
      keep: [
        { title: 'תשדורת סמכותית', axis: 'המקצוע הצבאי - להוביל', text: '' },
        { title: 'מיקום המפקד', axis: 'המקצוע הצבאי - להוביל', text: '' },
      ],
      improve: [
        { title: 'ניהול זמנים', axis: 'המקצוע הצבאי - לבצע', text: '' },
        { title: 'מיקוד במסרים', axis: 'המקצוע הצבאי - להוביל', text: '' },
      ],
      score: 85,
    };
    expect((await c.s2.post(`/api/experiences/${x.id}/feedback`, feedback)).status).toBe(200);
    expect(await one(c.s3, x.id)).toMatchObject({ canSeeFeedback: false, score: null, canMark: false });
    // only the commander chooses
    expect((await c.s1.patch('/api/settings', { experienceTrackers: [c.ids.s3] })).status).toBe(403);
    expect((await c.cmd.patch('/api/settings', { experienceTrackers: [c.ids.s3] })).status).toBe(200);
    expect(await one(c.s3, x.id)).toMatchObject({ canSeeFeedback: true, score: 85, canMark: true, canGiveFeedback: false });
    expect((await c.s3.post(`/api/experiences/${x.id}/mark`, { marked: true })).status).toBe(200);
  });

  it('a role in an event moves with the event to its new day - its feedback task too', async () => {
    const ev = (await c.cmd.post('/api/events', { date: '2026-10-04', startTime: '08:00', title: 'תרגיל התקפה' })).body.event.id;
    const x = (await c.s1.post('/api/experiences', { cadetId: cadet, role: 'מ"כ בתרגיל', startDate: '2026-10-04', endDate: '2026-10-04', mentorId: c.ids.s2, eventId: ev })).body as Experience;
    // ends within a week: its feedback task is open already
    const deadline = () => db().get<{ deadline: string }>('SELECT deadline FROM tasks WHERE experience_id = ?', x.id)?.deadline ?? '';
    expect(deadline().startsWith('2026-10-04')).toBe(true);
    expect((await c.cmd.patch(`/api/events/${ev}`, { date: '2026-10-07' })).status).toBe(200);
    expect(await one(c.cmd, x.id)).toMatchObject({ startDate: '2026-10-07', endDate: '2026-10-07' });
    expect(deadline().startsWith('2026-10-07')).toBe(true);
    // given its feedback, it stays on the day it was held
    db().run("UPDATE experiences SET status = 'done' WHERE id = ?", x.id);
    await c.cmd.patch(`/api/events/${ev}`, { date: '2026-10-09' });
    expect((await one(c.cmd, x.id)).startDate).toBe('2026-10-07');
  });
});

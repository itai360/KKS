// Evaluation files (תיקי הערכה): who sees what, entries and their tone, and the
// version of the file a committee receives.

import { beforeEach, describe, expect, it } from 'vitest';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
let cadet: number;

beforeEach(async () => {
  c = await setup();
  // s1 commands team 1; s2 is another staff member
  const team = (await c.cmd.post('/api/teams', { name: 'צוות 1 - אלון', commanderId: c.ids.s1 })).body[0].id;
  cadet = (await c.cmd.post('/api/cadets', { firstName: 'איתן משה', lastName: 'שפיגלר', personalNumber: '9335581', teamId: team })).body.cadet.id;
});

const entry = (over: Record<string, unknown> = {}) => ({ category: 'פיקוד והובלה', tone: 'positive', title: 'הוביל את הצוות בניווט לילה', body: 'שמר על קצב ועל הצוות גם כשהתעייפו.', occurredOn: '2026-09-30', ...over });

describe('evaluation files', () => {
  it('the team commander and the course commander see the whole file; other staff see their own entries', async () => {
    await c.s1.post(`/api/evaluations/${cadet}/entries`, entry());
    const fromS2 = await c.s2.post(`/api/evaluations/${cadet}/entries`, entry({ tone: 'improve', category: 'עבודת צוות', title: 'לא עזר לחבר בצוות בשטח' }));
    expect(fromS2.status).toBe(200);
    expect(fromS2.body).toMatchObject({ full: false, canEditStanding: false });
    expect(fromS2.body.entries.map((e: { title: string }) => e.title)).toEqual(['לא עזר לחבר בצוות בשטח']);

    for (const agent of [c.s1, c.cmd]) {
      const file = (await agent.get(`/api/evaluations/${cadet}`)).body;
      expect(file.full).toBe(true);
      expect(file.entries).toHaveLength(2);
      expect(file.teamCommanderName).toBe('מפק"צ 1');
    }
    expect((await c.s2.patch(`/api/evaluations/${cadet}`, { standing: 'risk' })).status).toBe(403);
    expect((await c.s1.patch(`/api/evaluations/${cadet}`, { commanderOpinion: 'x' })).status).toBe(403);

    const updated = (await c.s1.patch(`/api/evaluations/${cadet}`, { standing: 'watch', teamOpinion: 'צוער רציני עם פער בעבודת צוות.' })).body;
    expect(updated).toMatchObject({ standing: 'watch', teamOpinion: { text: 'צוער רציני עם פער בעבודת צוות.', byName: 'מפק"צ 1' } });
    expect((await c.cmd.patch(`/api/evaluations/${cadet}`, { commanderOpinion: 'ממשיך במעקב צמוד.' })).body.commanderOpinion.text).toBe('ממשיך במעקב צמוד.');

    // the list: standing and counts as each user may see them
    const [row] = (await c.cmd.get('/api/evaluations')).body;
    expect(row).toMatchObject({ cadetId: cadet, standing: 'watch', positive: 1, improve: 1, exception: 0, notShown: 1, hasOpinions: true, full: true });
    const [rowS2] = (await c.s2.get('/api/evaluations')).body;
    expect(rowS2).toMatchObject({ positive: 0, improve: 1, full: false, standing: 'ok', hasOpinions: false, committee: null });
  });

  it('an exception reaches the team commander and the course commander; entries are marked when shown to the cadet', async () => {
    const file = (await c.s2.post(`/api/evaluations/${cadet}/entries`, entry({ tone: 'exception', category: 'משמעת והתנהגות', title: 'איחר למסדר פעם שלישית' }))).body;
    for (const id of [c.ids.s1, c.ids.cmd]) expect(notificationsOf(id).map((n) => n.title)).toContain('חריג בתיק ההערכה של איתן משה שפיגלר');
    expect(notificationsOf(c.ids.s2)).toEqual([]);

    const id = file.entries[0].id;
    expect((await c.s3.post(`/api/evaluations/entries/${id}/shown`, { shownOn: '2026-10-01' })).status).toBe(403);
    const shown = (await c.s1.post(`/api/evaluations/entries/${id}/shown`, { shownOn: '2026-10-01' })).body; // the team commander showed it
    expect(shown.entries[0].shownOn).toBe('2026-10-01');

    expect((await c.s1.del(`/api/evaluations/entries/${id}`)).status).toBe(403); // only the author or the course commander
    expect((await c.s2.patch(`/api/evaluations/entries/${id}`, { title: 'איחר למסדר' })).body.entries[0].title).toBe('איחר למסדר');
    expect((await c.cmd.del(`/api/evaluations/entries/${id}`)).body.entries).toEqual([]);
  });

  it('brings in the scores, discipline, talks and experiences from the cadet file', async () => {
    for (const rec of [
      { kind: 'evaluation', category: 'פיקוד והובלה', score: 4, body: 'הוביל היטב' },
      { kind: 'evaluation', category: 'פיקוד והובלה', score: 5, body: 'הוביל מצוין' },
      { kind: 'discipline', title: 'איחור', category: 'קלה', body: 'איחר למסדר בוקר' },
      { kind: 'talk', title: 'שיחת אמצע', body: 'מטרות לשבועיים הקרובים' },
    ]) {
      expect((await c.s1.post(`/api/cadets/${cadet}/records`, rec)).status).toBe(200);
    }
    const file = (await c.cmd.get(`/api/evaluations/${cadet}`)).body;
    expect(file.scores).toEqual([{ criterion: 'פיקוד והובלה', average: 4.5, count: 2 }]);
    expect(file.discipline.map((r: { title: string }) => r.title)).toEqual(['איחור']);
    expect(file.talks.map((r: { title: string }) => r.title)).toEqual(['שיחת אמצע']);
    // none of it for someone who does not see the whole file
    const limited = (await c.s2.get(`/api/evaluations/${cadet}`)).body;
    expect([limited.scores, limited.discipline, limited.talks, limited.committees]).toEqual([[], [], [], []]);
  });

  it('a committee receives the file as it stood, which can be refreshed until it decides', async () => {
    await c.s1.post(`/api/evaluations/${cadet}/entries`, entry({ tone: 'exception', title: 'נרדם בשמירה' }));
    expect((await c.s1.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה' })).status).toBe(403);
    const referred = (await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה', reason: 'שני חריגים בשמירה', meetingDate: '2026-10-05' })).body;
    expect(referred.committees).toHaveLength(1);
    const committeeId = referred.committees[0].id;
    expect(notificationsOf(c.ids.s1).map((n) => n.title)).toContain('איתן משה שפיגלר הועבר לוועדת הדחה');
    expect((await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה' })).status).toBe(400); // one open committee at a time

    // written after the referral: not in the committee's version until it is refreshed
    await c.s1.post(`/api/evaluations/${cadet}/entries`, entry({ title: 'שיפור ניכר בשבוע האחרון' }));
    const frozen = (await c.s1.get(`/api/evaluations/committees/${committeeId}`)).body;
    expect(frozen.committee).toMatchObject({ kind: 'ועדת הדחה', reason: 'שני חריגים בשמירה', meetingDate: '2026-10-05', decision: null });
    expect(frozen.file.entries.map((e: { title: string }) => e.title)).toEqual(['נרדם בשמירה']);
    expect((await c.s2.get(`/api/evaluations/committees/${committeeId}`)).status).toBe(403);
    await c.cmd.post(`/api/evaluations/committees/${committeeId}/refresh`);
    expect((await c.cmd.get(`/api/evaluations/committees/${committeeId}`)).body.file.entries).toHaveLength(2);

    // the decision: a dismissal also ends the cadet's course, and the version stays as it was
    const decided = (await c.cmd.post(`/api/evaluations/committees/${committeeId}/decision`, { decision: 'dismissed', text: 'הוחלט על הדחה.' })).body;
    expect(decided.committees[0]).toMatchObject({ decision: 'dismissed', decisionText: 'הוחלט על הדחה.', decidedByName: 'מפקד הקורס' });
    expect(decided.cadet.status).toBe('dropped');
    expect((await c.cmd.post(`/api/evaluations/committees/${committeeId}/refresh`)).status).toBe(400);
    expect((await c.cmd.del(`/api/evaluations/committees/${committeeId}`)).status).toBe(400);
    expect(notificationsOf(c.ids.s1).map((n) => n.title)).toContain('החלטת ועדת הדחה בעניין איתן משה שפיגלר: הודח מהקורס');
    expect((await c.cmd.get('/api/evaluations')).body[0].committee).toEqual({ id: committeeId, kind: 'ועדת הדחה', decision: 'dismissed' });
  });
});

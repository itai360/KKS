import { generateKeyPairSync, sign } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAutomation } from '../src/automation';
import { clock } from '../src/core';
import { db } from '../src/db';
import { setJwksFetcher } from '../src/google';
import { setPushSender, type PushTarget } from '../src/push';
import { at, newTask, notificationsOf, setup, staffMay, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

/** a whole feedback in the course's format (made-up words) */
const feedback = (score = 84, patch: object = {}) => ({
  general: 'הוביל את הכיתה בביטחון ולמד מהר מטעויות',
  keep: [
    { title: 'החלטיות', axis: 'פיקוד והובלה', text: 'החליט מהר גם בלי תמונה מלאה' },
    { title: 'קשר רציף עם הסגל', axis: 'עבודת צוות', text: '' },
  ],
  improve: [
    { title: 'שיתוף הסגנים', axis: 'עבודת צוות', text: 'תכנן לבד' },
    { title: 'ניהול זמן', axis: 'ציר אישי', text: 'ההכנות התארכו' },
  ],
  score,
  ...patch,
});

async function teamWithCadets() {
  const teams = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body;
  const teamId = teams[0].id;
  const a = (await c.cmd.post('/api/cadets', { firstName: 'דניאל', lastName: 'כהן', teamId })).body.cadet.id;
  const b = (await c.cmd.post('/api/cadets', { firstName: 'מאיה', lastName: 'לוי', teamId })).body.cadet.id;
  return { teamId, a, b };
}

describe('cadets and teams (section 31)', () => {
  it('commander manages teams; team commander adds cadets only to their team', async () => {
    const { teamId } = await teamWithCadets();
    // open to the staff by default: teams, and the cadets of every team (details only - not the personal files)
    expect((await c.s2.post('/api/teams', { name: 'צוות 9' })).status).toBe(200);
    expect((await c.s2.post('/api/cadets', { firstName: 'אורי', teamId })).status).toBe(200);
    const theirs = (await c.s2.get('/api/cadets')).body as { canManage: boolean; canEdit: boolean }[];
    expect(theirs.every((x) => x.canEdit && !x.canManage)).toBe(true);
    // kept to the commander
    await staffMay(c, { teams: false, cadets: false });
    expect((await c.s1.post('/api/teams', { name: 'x' })).status).toBe(403);
    expect((await c.s1.post('/api/cadets', { firstName: 'נועם', teamId })).status).toBe(200);
    expect((await c.s2.post('/api/cadets', { firstName: 'נועם', teamId })).status).toBe(403);
    const list = (await c.s2.get('/api/cadets')).body;
    expect(list).toHaveLength(4);
    expect(list.every((x: { canManage: boolean }) => !x.canManage)).toBe(true);
    expect((await c.s1.get('/api/cadets')).body.every((x: { canManage: boolean }) => x.canManage)).toBe(true);
  });

  it('reads a pasted list by its header row, keeps two-word first names, and never adds a cadet twice', async () => {
    const text = [
      'שם פרטי\tשם משפחה\tמספר אישי\tצוות',
      'איתן משה\tשפיגלר\t9335581.0\tצוות 2 - גיורא',
      'יהב\tגור אריה\t9397319.0\tצוות 1 - אלון',
      'עמית\tשמש\t\tצוות 2 - גיורא',
    ].join('\n');
    expect((await c.cmd.post('/api/cadets/import', { text })).body).toEqual({ imported: 3, updated: 0, skipped: 0 });
    const cadets = (await c.cmd.get('/api/cadets')).body;
    const byPn = (pn: string) => cadets.find((x: { personalNumber: string }) => x.personalNumber === pn);
    expect(byPn('9335581')).toMatchObject({ firstName: 'איתן משה', lastName: 'שפיגלר', teamName: 'צוות 2 - גיורא' });
    expect(byPn('9397319')).toMatchObject({ firstName: 'יהב', lastName: 'גור אריה', teamName: 'צוות 1 - אלון' });
    // the same list again: everyone with a personal number is already there
    expect((await c.cmd.post('/api/cadets/import', { text: text.split('\n').slice(0, 3).join('\n') })).body).toEqual({ imported: 0, updated: 0, skipped: 2 });
    expect((await c.cmd.get('/api/teams')).body.map((t: { name: string; cadetCount: number }) => [t.name, t.cadetCount])).toEqual([
      ['צוות 1 - אלון', 1],
      ['צוות 2 - גיורא', 2],
    ]);
  });

  it('imports a pasted list and creates missing teams', async () => {
    const res = await c.cmd.post('/api/cadets/import', { text: 'שם, מספר אישי, טלפון, צוות\nיואב בר\t1234567\t050-1\tצוות 3\nשירה טל, 7654321, , צוות 3\n\n' });
    expect(res.body.imported).toBe(2);
    const teams = (await c.cmd.get('/api/teams')).body;
    expect(teams.map((t: { name: string; cadetCount: number }) => [t.name, t.cadetCount])).toEqual([['צוות 3', 2]]);
    const cadets = (await c.cmd.get('/api/cadets')).body;
    expect(cadets.map((x: { fullName: string; personalNumber: string }) => [x.fullName, x.personalNumber])).toEqual([
      ['יואב בר', '1234567'],
      ['שירה טל', '7654321'],
    ]);
  });

  it('personal talks and discipline stay restricted; notes and evaluations are shared', async () => {
    const { a } = await teamWithCadets();
    await c.s1.post(`/api/cadets/${a}/records`, { kind: 'talk', category: 'שיחת היכרות', body: 'מוטיבציה גבוהה, קושי בבית' });
    await c.s1.post(`/api/cadets/${a}/records`, { kind: 'discipline', category: 'קלה', body: 'איחור למסדר' });
    await c.s1.post(`/api/cadets/${a}/records`, { kind: 'note', body: 'הערה פרטית', private: true });
    expect((await c.s2.post(`/api/cadets/${a}/records`, { kind: 'talk', body: 'x' })).status).toBe(403);
    await c.s2.post(`/api/cadets/${a}/records`, { kind: 'evaluation', category: 'פיקוד והובלה', score: 4, body: 'הוביל היטב בתרגיל' });
    expect((await c.s2.post(`/api/cadets/${a}/records`, { kind: 'evaluation', body: 'בלי ציון' })).status).toBe(400);

    const asOther = (await c.s2.get(`/api/cadets/${a}`)).body;
    expect(asOther.records.map((r: { kind: string }) => r.kind)).toEqual(['evaluation']);
    expect(asOther.cadet).toMatchObject({ talkCount: 0, disciplineCount: 0, avgScore: 4 });
    const asLead = (await c.s1.get(`/api/cadets/${a}`)).body;
    expect(asLead.records).toHaveLength(4);
    expect(asLead.scores).toEqual([expect.objectContaining({ criterion: 'פיקוד והובלה', score: 4 })]);
    expect((await c.s3.get(`/api/cadets/${a}`)).body.records).toHaveLength(1);
    expect(notificationsOf(c.ids.s1).some((n) => n.type === 'cadet_record')).toBe(true);
  });

  it('every staff member records discipline about any cadet - seen only by them and the commanders, the team commander told', async () => {
    const { a } = await teamWithCadets();
    // s2 is not the commander of the cadet's team: a note, an evaluation and discipline - not a personal talk
    expect((await c.s2.post(`/api/cadets/${a}/records`, { kind: 'discipline', category: 'קלה', body: 'איחור למסדר' })).status).toBe(200);
    expect((await c.s2.post(`/api/cadets/${a}/records`, { kind: 'talk', body: 'x' })).status).toBe(403);
    const kinds = async (agent: typeof c.s1) => ((await agent.get(`/api/cadets/${a}`)).body.records as { kind: string }[]).map((r) => r.kind);
    expect(await kinds(c.s2)).toEqual(['discipline']);
    expect(await kinds(c.s1)).toEqual(['discipline']);
    expect(await kinds(c.cmd)).toEqual(['discipline']);
    expect(await kinds(c.s3)).toEqual([]);
    expect(notificationsOf(c.ids.s1).map((n) => n.title)).toContain('מפק"צ 2 הוסיף רישום משמעת על דניאל כהן');

    // a discipline note from another team's staff counts toward the limit, and the commanders hear of it
    await c.s2.post(`/api/cadets/${a}/records`, { kind: 'discipline', body: 'הגיע ללא ציוד', formal: true });
    expect((await c.cmd.get(`/api/cadets/${a}`)).body.cadet.disciplineNotes).toBe(1);
    for (const id of [c.ids.cmd, c.ids.s1]) expect(notificationsOf(id).map((n) => n.title)).toContain('מפק"צ 2 נתן הערת משמעת לדניאל כהן (1 מתוך 3)');
  });

  it('tells whoever records discipline without seeing the rest which time it is and the notes so far - not the records', async () => {
    const { a } = await teamWithCadets();
    const offense = 'זמנים · איחור למסדר';
    const preview = async () => (await c.s2.get(`/api/cadets/${a}/discipline-preview?offense=${encodeURIComponent(offense)}`)).body;
    expect(await preview()).toEqual({ occurrence: 1, notes: 0, refers: false });
    // the team commander recorded it twice, both discipline notes: the next note would go to a committee
    await c.s1.post(`/api/cadets/${a}/records`, { kind: 'discipline', offense, body: 'פעם ראשונה', formal: true });
    await c.s1.post(`/api/cadets/${a}/records`, { kind: 'discipline', offense, body: 'פעם שנייה', formal: true });
    expect(await preview()).toEqual({ occurrence: 3, notes: 2, refers: true });
    expect((await c.s2.get(`/api/cadets/${a}`)).body.records).toEqual([]);
  });

  it('a talk can open a private follow-up task linked to the cadet', async () => {
    const { a } = await teamWithCadets();
    const res = await c.s1.post(`/api/cadets/${a}/records`, {
      kind: 'talk',
      body: 'סיכמנו על תוכנית שיפור',
      followUp: 'שיחה חוזרת בעוד שבוע',
      followUpTask: { title: 'שיחה חוזרת עם דניאל', deadline: at('2026-10-08') },
    });
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0]).toMatchObject({ cadetId: a, cadetName: 'דניאל כהן', visibility: 'private', ownerId: c.ids.s1 });
    expect(res.body.records[0].taskTitle).toBe('שיחה חוזרת עם דניאל');
  });
});

describe('experiences (section 31)', () => {
  it('mentor gets a feedback task; feedback closes it and feeds the development record', async () => {
    const { a } = await teamWithCadets();
    const x = (await c.s1.post('/api/experiences', { cadetId: a, role: 'מ"מ בתרגיל התקפה', startDate: '2026-10-04', endDate: '2026-10-06', goals: 'קבלת החלטות תחת לחץ', mentorId: c.ids.s2 })).body;
    expect(x).toMatchObject({ phase: 'planned', mentorName: 'מפק"צ 2', canGiveFeedback: true });
    // another staff member places and edits experiences (the cadets of every team), but gives no feedback
    expect((await c.s3.get('/api/experiences')).body[0]).toMatchObject({ canGiveFeedback: false, canEdit: true });
    await staffMay(c, { cadets: false });
    const asOther = (await c.s3.get('/api/experiences')).body[0];
    expect(asOther).toMatchObject({ canGiveFeedback: false, canEdit: false });
    expect((await c.s3.post('/api/experiences', { cadetId: a, role: 'x', startDate: '2026-10-04', endDate: '2026-10-04' })).status).toBe(403);
    await staffMay(c, {});

    const mentorTasks = (await c.s2.get('/api/my')).body;
    const feedbackTask = [...mentorTasks.week, ...mentorTasks.later, ...mentorTasks.important].find((t: { experienceId: number }) => t.experienceId === x.id);
    expect(feedbackTask).toMatchObject({ title: 'משוב התנסות: דניאל כהן - מ"מ בתרגיל התקפה', deadline: at('2026-10-06', '18:00') });

    expect((await c.s3.post(`/api/experiences/${x.id}/feedback`, feedback())).status).toBe(403);
    const done = (await c.s2.post(`/api/experiences/${x.id}/feedback`, feedback())).body;
    expect(done).toMatchObject({ status: 'done', phase: 'done', score: 84, feedbackForm: { general: 'הוביל את הכיתה בביטחון ולמד מהר מטעויות' } });
    expect(done.feedbackForm.keep.map((p: { title: string }) => p.title)).toEqual(['החלטיות', 'קשר רציף עם הסגל']);
    expect((await c.s2.get(`/api/tasks/${feedbackTask.id}`)).body.task.status).toBe('done');

    const seenByOther = (await c.s3.get('/api/experiences')).body.find((e: { id: number }) => e.id === x.id);
    expect(seenByOther).toMatchObject({ score: null, strengths: '', feedbackForm: null, canSeeFeedback: false });
    // in the cadet's file: the whole feedback as text; its score out of 100 is not averaged with the evaluations out of 5
    const lead = (await c.s1.get(`/api/cadets/${a}`)).body;
    expect(lead.records[0]).toMatchObject({ kind: 'evaluation', category: 'התנסות', title: 'משוב התנסות: מ"מ בתרגיל התקפה', score: null, private: true });
    expect(lead.records[0].body).toBe(
      [
        'התייחסות כללית: הוביל את הכיתה בביטחון ולמד מהר מטעויות',
        'נקודה לשימור: החלטיות (ציר: פיקוד והובלה)\nהחליט מהר גם בלי תמונה מלאה',
        'נקודה לשימור: קשר רציף עם הסגל (ציר: עבודת צוות)',
        'נקודה לשיפור: שיתוף הסגנים (ציר: עבודת צוות)\nתכנן לבד',
        'נקודה לשיפור: ניהול זמן (ציר: ציר אישי)\nההכנות התארכו',
        'ציון להתנסות: 84 - טוב מאוד',
      ].join('\n\n'),
    );
    expect(lead.cadet.avgScore).toBeNull();
    expect((await c.s3.get(`/api/cadets/${a}`)).body.records).toHaveLength(0);
    expect(notificationsOf(c.ids.s1).map((n) => n.title)).toContain('התקבל משוב על ההתנסות של דניאל כהן (מ"מ בתרגיל התקפה): 84 - טוב מאוד');
  });

  it('changing the mentor moves the open feedback task', async () => {
    const { a } = await teamWithCadets();
    const x = (await c.s1.post('/api/experiences', { cadetId: a, role: 'סמל תורן', startDate: '2026-10-04', endDate: '2026-10-05', mentorId: c.ids.s2 })).body;
    await c.s1.patch(`/api/experiences/${x.id}`, { mentorId: c.ids.s3, endDate: '2026-10-07' });
    const t = db().get<{ owner_id: number; deadline: string }>('SELECT owner_id, deadline FROM tasks WHERE experience_id = ?', x.id)!;
    expect(t).toEqual({ owner_id: c.ids.s3, deadline: at('2026-10-07', '18:00') });
  });

  it('a broad experience is one of the listed types, for half the course or all of it', async () => {
    const { a } = await teamWithCadets();
    const post = (body: object) => c.s1.post('/api/experiences', { cadetId: a, kind: 'broad', startDate: '2026-09-01', endDate: '2026-11-30', ...body });
    expect((await post({ role: 'טבח', span: 'full' })).body.error).toContain('סוג התנסות רוחב לא מוכר');
    expect((await post({ role: 'קב"ט' })).body.error).toContain('לאיזו תקופה');
    const x = (await post({ role: 'קב"ט', span: 'first_half', mentorId: c.ids.s2 })).body;
    expect(x).toMatchObject({ kind: 'broad', span: 'first_half', role: 'קב"ט', startDate: '2026-09-01', endDate: '2026-11-30', mentorId: c.ids.s2 });
    // its feedback task comes a week before it ends
    expect(db().get('SELECT 1 FROM tasks WHERE experience_id = ?', x.id)).toBeUndefined();
    // it becomes a whole-course one, but stays one of the list
    expect((await c.s1.patch(`/api/experiences/${x.id}`, { span: 'full', endDate: '2027-02-28' })).body).toMatchObject({ span: 'full', endDate: '2027-02-28' });
    expect((await c.s1.patch(`/api/experiences/${x.id}`, { role: 'טבח' })).status).toBe(400);
    // an experience in a role has no part of the course
    expect((await c.s1.post('/api/experiences', { cadetId: a, role: 'סמל תורן', span: 'full', startDate: '2026-10-04', endDate: '2026-10-05' })).body).toMatchObject({ kind: 'role', span: null });
    clock.set(new Date(at('2027-02-21', '08:00')));
    expect(runAutomation().feedbackTasks).toBe(1);
    expect(db().get<{ title: string }>('SELECT title FROM tasks WHERE experience_id = ?', x.id)!.title).toBe('משוב התנסות: דניאל כהן - רוחב - קב"ט (קורס שלם)');
  });
});

describe('the feedback task of an experience', () => {
  it('opens for the mentor a week before the experience ends - at once for a shorter one - and only once', async () => {
    const { a, b } = await teamWithCadets();
    const tasksOf = (id: number) => db().all<{ owner_id: number; deadline: string; status: string }>('SELECT owner_id, deadline, status FROM tasks WHERE experience_id = ?', id);
    // three weeks long: nothing yet
    const long = (await c.s1.post('/api/experiences', { cadetId: a, role: 'מ"מ', startDate: '2026-10-01', endDate: '2026-10-21', mentorId: c.ids.s2 })).body;
    expect(tasksOf(long.id)).toEqual([]);
    expect(runAutomation().feedbackTasks).toBe(0);
    // the day before the week before its end: still nothing
    clock.set(new Date(at('2026-10-13', '23:00')));
    runAutomation();
    expect(tasksOf(long.id)).toEqual([]);
    // a week before its end: the mentor's, due on its last day
    clock.set(new Date(at('2026-10-14', '07:00')));
    expect(runAutomation().feedbackTasks).toBe(1);
    expect(tasksOf(long.id)).toEqual([{ owner_id: c.ids.s2, deadline: at('2026-10-21', '18:00'), status: 'todo' }]);
    // once: deleted, it is not opened again
    db().run('DELETE FROM tasks WHERE experience_id = ?', long.id);
    runAutomation();
    expect(tasksOf(long.id)).toEqual([]);

    // ending within the week: at once; with no mentor, the cadet's team commander's
    const short = (await c.s1.post('/api/experiences', { cadetId: b, role: 'סמל תורן', startDate: '2026-10-14', endDate: '2026-10-16' })).body;
    expect(tasksOf(short.id)).toEqual([{ owner_id: c.ids.s1, deadline: at('2026-10-16', '18:00'), status: 'todo' }]);

    // its end brought within the week: the next change opens it
    const moved = (await c.s1.post('/api/experiences', { cadetId: b, role: 'קשר', startDate: '2026-10-14', endDate: '2026-11-30', mentorId: c.ids.s3 })).body;
    expect(tasksOf(moved.id)).toEqual([]);
    await c.s1.patch(`/api/experiences/${moved.id}`, { endDate: '2026-10-18' });
    expect(tasksOf(moved.id)).toEqual([{ owner_id: c.ids.s3, deadline: at('2026-10-18', '18:00'), status: 'todo' }]);

    // feedback given before the week before: no task at all
    const early = (await c.s1.post('/api/experiences', { cadetId: a, role: 'נווט', startDate: '2026-10-14', endDate: '2026-12-31', mentorId: c.ids.s2 })).body;
    expect((await c.s2.post(`/api/experiences/${early.id}/feedback`, feedback())).status).toBe(200);
    clock.set(new Date(at('2026-12-25', '07:00')));
    runAutomation();
    expect(tasksOf(early.id)).toEqual([]);
  });
});

describe("the feedback after an experience, in the course's format", () => {
  it('asks for the general reference, two points to keep and two to improve with their axes, and a score of 0-100', async () => {
    const { a } = await teamWithCadets();
    const x = (await c.s1.post('/api/experiences', { cadetId: a, kind: 'broad', role: 'קב"ט', span: 'first_half', startDate: '2026-09-01', endDate: '2026-10-04', mentorId: c.ids.s2 })).body;
    const give = (body: object) => c.s2.post(`/api/experiences/${x.id}/feedback`, body);
    // what is missing, by name - the words under a point may stay empty
    const blank = { title: '', axis: '', text: '' };
    const res = await give(feedback(70, { general: ' ', keep: [{ title: 'יוזמה', axis: '', text: '' }, blank] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('חסר במשוב: התייחסות כללית, הציר של נקודה לשימור 1, נקודה לשימור 2');
    expect((await give(feedback(101))).body.error).toBe('ציון בין 0 ל-100');
    expect((await give(feedback(80.5))).body.error).toBe('ציון שלם בין 0 ל-100');
    expect((await give(feedback(80, { improve: [feedback().improve[0]] }))).body.error).toBe('במשוב שתי נקודות לשימור ושתי נקודות לשיפור');
    // the experience stays open until the feedback is whole
    expect((await c.s2.get('/api/experiences')).body.find((e: { id: number }) => e.id === x.id)).toMatchObject({ status: 'planned', score: null, feedbackForm: null });

    const done = (await give(feedback(96))).body;
    expect(done).toMatchObject({ status: 'done', score: 96, kind: 'broad' });
    // the points as text where feedback was read before (the evaluation file, search)
    expect(done.strengths).toBe('החלטיות (ציר: פיקוד והובלה)\nהחליט מהר גם בלי תמונה מלאה\nקשר רציף עם הסגל (ציר: עבודת צוות)');
    expect(done.feedback).toBe('הוביל את הכיתה בביטחון ולמד מהר מטעויות');
    const file = (await c.cmd.get(`/api/evaluations/${a}`)).body;
    expect(file.experiences[0]).toMatchObject({ role: 'קב"ט', score: 96, form: { improve: [{ title: 'שיתוף הסגנים' }, { title: 'ניהול זמן' }] } });
    expect((await c.s1.get(`/api/cadets/${a}`)).body.records[0].title).toBe('משוב התנסות: רוחב - קב"ט (חצי קורס ראשון)');
    // an axis typed for a point is offered next time, beside the evaluation criteria
    expect((await c.s3.get('/api/experiences/feedback-axes')).body).toEqual(['עבודת צוות', 'פיקוד והובלה', 'ציר אישי']);
  });

  it('reads the score on the legend: each band up to and including its top', async () => {
    const { scoreBand, SCORE_BANDS } = await import('../../shared/experienceFeedback');
    const bands = [0, 60, 61, 70, 71, 75, 76, 80, 81, 85, 86, 95, 96, 100].map((n) => `${n}:${scoreBand(n).label}`);
    expect(bands).toEqual([
      '0:נכשל',
      '60:נכשל',
      '61:מתחת לנדרש',
      '70:מתחת לנדרש',
      '71:עמד בנדרש',
      '75:עמד בנדרש',
      '76:טוב',
      '80:טוב',
      '81:טוב מאוד',
      '85:טוב מאוד',
      '86:מצוין',
      '95:מצוין',
      '96:יוצא דופן לחיוב',
      '100:יוצא דופן לחיוב',
    ]);
    expect(SCORE_BANDS.map((b) => b.range)).toEqual(['60 ומטה', '60-70', '70-75', '75-80', '80-85', '85-95', '95-100']);
  });

  it('feedback given before the format still reads as it was - out of 5, without points', async () => {
    const { a } = await teamWithCadets();
    const x = (await c.s1.post('/api/experiences', { cadetId: a, role: 'סמל תורן', startDate: '2026-09-20', endDate: '2026-09-21', mentorId: c.ids.s2 })).body;
    db().run("UPDATE experiences SET status = 'done', strengths = 'סדר', improvements = 'זמנים', score = 4 WHERE id = ?", x.id);
    expect((await c.s2.get('/api/experiences')).body.find((e: { id: number }) => e.id === x.id)).toMatchObject({ status: 'done', score: 4, strengths: 'סדר', feedbackForm: null });
    expect((await c.cmd.get(`/api/evaluations/${a}`)).body.experiences[0]).toMatchObject({ score: 4, strengths: 'סדר', form: null });
  });
});

describe('debriefs (sections 31, 57)', () => {
  it('a lesson becomes a task, a recurring task, or a step in an activity template', async () => {
    const d = (await c.s2.post('/api/debriefs', { title: 'תחקיר מטווח', occurredOn: '2026-09-30' })).body.debrief;
    expect(d).toMatchObject({ facilitatorName: 'מפק"צ 2', canEdit: true });
    for (const [kind, body] of [
      ['fact', 'המדריך הגיע באיחור של שעה'],
      ['finding', 'לא בוצע תיאום מוקדם'],
      ['conclusion', 'חסר תיאום מוקדם בין המדריך לבין מפק"צ השבוע'],
      ['lesson', 'לקיים שיחת תיאום 48 שעות לפני הפעילות'],
    ]) {
      await c.s2.post(`/api/debriefs/${d.id}/items`, { kind, body });
    }
    expect((await c.s3.post(`/api/debriefs/${d.id}/items`, { kind: 'fact', body: 'x' })).status).toBe(403);
    const detail = (await c.s3.get(`/api/debriefs/${d.id}`)).body;
    expect(detail.debrief.itemCounts).toEqual({ fact: 1, finding: 1, conclusion: 1, lesson: 1 });
    const lesson = detail.items.find((i: { kind: string }) => i.kind === 'lesson');

    const withTask = (await c.s2.post(`/api/debrief-items/${lesson.id}/task`, { title: 'תיאום מוקדם עם מדריך הירי', ownerIds: [c.ids.s3], deadline: at('2026-10-05') })).body;
    expect(withTask.items.find((i: { id: number }) => i.id === lesson.id).taskTitle).toBe('תיאום מוקדם עם מדריך הירי');
    expect(withTask.tasks[0]).toMatchObject({ ownerId: c.ids.s3, debriefTitle: 'תחקיר מטווח' });
    expect(notificationsOf(c.ids.s3).some((n) => n.type === 'task_assigned')).toBe(true);

    // a recurring task from a lesson: whoever manages the recurring tasks
    await staffMay(c, { templates: false });
    expect((await c.s2.post(`/api/debrief-items/${lesson.id}/recurring`, { title: 'x', frequency: 'daily', time: '20:00', assignee: 'all' })).status).toBe(403);
    await staffMay(c, {});
    const rec = await c.cmd.post(`/api/debrief-items/${lesson.id}/recurring`, { title: 'שיחת תיאום עם מדריכים', frequency: 'weekly', weekdays: [0], time: '10:00', assignee: 'week_lead' });
    expect(rec.body.items.find((i: { id: number }) => i.id === lesson.id).recurringTitle).toBe('שיחת תיאום עם מדריכים');

    const tpl = (await c.cmd.post('/api/templates', { name: 'הכנת פעילות', kind: 'activity', items: [{ title: 'סגירת שטח', offsetDays: -7 }] })).body;
    await c.cmd.post(`/api/debrief-items/${lesson.id}/template`, { templateId: tpl.id, title: 'שיחת תיאום עם מדריך', offsetDays: -2 });
    const updated = (await c.cmd.get(`/api/templates/${tpl.id}`)).body;
    expect(updated.items.at(-1)).toMatchObject({ title: 'שיחת תיאום עם מדריך', offsetDays: -2, owner: 'event_owner' });
  });

  it('finalising a debrief informs the commander', async () => {
    const d = (await c.s2.post('/api/debriefs', { title: 'תחקיר ניווט', occurredOn: '2026-09-30' })).body.debrief;
    await c.s2.patch(`/api/debriefs/${d.id}`, { status: 'final' });
    expect(notificationsOf(c.ids.cmd).some((n) => n.type === 'debrief')).toBe(true);
  });
});

describe('documents (section 31)', () => {
  it('links, files, restricted documents and permissions', async () => {
    await c.s1.post('/api/documents', { title: 'נוהל בטיחות במטווחים', category: 'נהלים', url: 'https://drive.google.com/x' });
    expect((await c.s1.post('/api/documents', { title: 'x', category: 'נהלים', url: 'https://a.b', restricted: true })).status).toBe(403);
    await c.cmd.post('/api/documents', { title: 'פקודת מבצע - מסווג', category: 'פקודות', url: 'https://a.b/c', restricted: true, pinned: true });
    const up = await c.s2
      .post('/api/documents/file?title=' + encodeURIComponent('מצגת התקפה') + '&category=' + encodeURIComponent('מצגות'))
      .set('content-type', 'application/pdf')
      .set('x-filename', encodeURIComponent('attack.pdf'))
      .send(Buffer.from('%PDF test'));
    expect(up.status).toBe(200);

    const asStaff = (await c.s1.get('/api/documents')).body;
    expect(asStaff.map((d: { title: string }) => d.title).sort()).toEqual(['מצגת התקפה', 'נוהל בטיחות במטווחים'].sort());
    const asCmd = (await c.cmd.get('/api/documents')).body;
    expect(asCmd[0]).toMatchObject({ title: 'פקודת מבצע - מסווג', pinned: true });
    const file = asStaff.find((d: { kind: string }) => d.kind === 'file');
    expect((await c.s3.get(file.url)).status).toBe(200);
    expect((await c.s1.del(`/api/documents/${file.id}`)).status).toBe(403);
    expect((await c.s2.del(`/api/documents/${file.id}`)).status).toBe(200);
    const restricted = asCmd[0];
    expect((await c.s1.get(`/api/documents/${restricted.id}/file`)).status).toBe(404);
    expect((await c.cmd.get(`/api/documents?category=${encodeURIComponent('נהלים')}`)).body).toHaveLength(1);
  });
});

describe('web push', () => {
  const sent: { target: PushTarget; payload: { title: string; link: string; category: string } }[] = [];
  let status = 201;
  beforeEach(() => {
    sent.length = 0;
    status = 201;
    setPushSender(async (target, payload) => {
      if (status >= 400) throw Object.assign(new Error('gone'), { statusCode: status });
      sent.push({ target, payload: JSON.parse(payload) });
      return { statusCode: status };
    });
  });

  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' } };

  it('pushes action and exception notifications to subscribed devices', async () => {
    const key = (await c.s1.get('/api/push/key')).body;
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await c.s1.post('/api/push/subscribe', sub)).body.subscriptions).toBe(1);
    await newTask(c.cmd, { title: 'תיאום מטווח', ownerIds: [c.ids.s1] });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ title: 'נוספה לך משימה חדשה: "תיאום מטווח"' });
    expect(sent[0].payload.link).toMatch(/^\/tasks\/\d+$/);
  });

  it('pushes every notification - the updates too - and drops expired subscriptions', async () => {
    await c.cmd.post('/api/push/subscribe', sub);
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1], priority: 'high' });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' }); // an update ("info") to the commander
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((s) => s.payload.category)).toEqual(['info']);
    status = 410;
    const r = await c.cmd.post('/api/push/test');
    expect(r.body.sent).toBe(0);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM push_subscriptions')!.n).toBe(0);
  });

  it('the commander sees who gets them on the phone; the staff do not', async () => {
    await c.s1.post('/api/push/subscribe', sub);
    const list = (await c.cmd.get('/api/users')).body as { id: number; pushDevices?: number }[];
    expect(list.find((u) => u.id === c.ids.s1)?.pushDevices).toBe(1);
    expect(list.find((u) => u.id === c.ids.s2)?.pushDevices).toBe(0);
    const theirs = (await c.s2.get('/api/users')).body as { pushDevices?: number }[];
    expect(theirs.every((u) => u.pushDevices === undefined)).toBe(true);
  });
});

describe('google sign-in', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims: object) => {
    const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = b64({ iss: 'https://accounts.google.com', aud: 'client-123', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims });
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
  };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-123';
    setJwksFetcher(async () => ({ keys: [jwk as never] }));
  });
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it('logs in a user whose e-mail matches, and rejects everything else', async () => {
    await c.cmd.patch(`/api/users/${c.ids.s1}`, { email: 'Yoav@Example.com' });
    expect((await request(c.app).get('/api/public/info')).body.googleClientId).toBe('client-123');

    const agent = request.agent(c.app);
    const ok = await agent.post('/api/auth/google').set('x-kks', '1').send({ credential: token({ email: 'yoav@example.com' }) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(c.ids.s1);
    expect((await agent.get('/api/my')).status).toBe(200);

    const post = (cred: string) => request(c.app).post('/api/auth/google').set('x-kks', '1').send({ credential: cred });
    expect((await post(token({ email: 'stranger@example.com' }))).status).toBe(403);
    expect((await post(token({ email: 'yoav@example.com', aud: 'other-app' }))).status).toBe(401);
    expect((await post(token({ email: 'yoav@example.com', exp: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    const forged = token({ email: 'yoav@example.com' }).replace(/\.[^.]+$/, '.' + Buffer.from('bad').toString('base64url'));
    expect((await post(forged)).status).toBe(401);
  });

  it('is disabled without a client id', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await request(c.app).post('/api/auth/google').set('x-kks', '1').send({ credential: token({ email: 'a@b.c' }) })).status).toBe(404);
  });
});

describe('backup', () => {
  it('lets the commander download a consistent copy of the database', async () => {
    await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1] });
    expect((await c.s1.get('/api/admin/backup')).status).toBe(403);
    const res = await c.cmd.get('/api/admin/backup').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});

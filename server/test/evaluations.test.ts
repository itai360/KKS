// Evaluation files (תיקי הערכה): a living file in nine parts - who opens it, setting each part at
// any time, the history of changes, refusing to write over someone else's change, and the version
// of the file a committee receives.

import { beforeEach, describe, expect, it } from 'vitest';
import type { EvaluationChange, EvaluationFile, EvaluationListItem } from '../../shared/types';
import { Db, db, migrate } from '../src/db';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
let cadet: number;

beforeEach(async () => {
  c = await setup();
  // s1 commands team 1; s2 commands no one here
  const team = (await c.cmd.post('/api/teams', { name: 'צוות 1 - אלון', commanderId: c.ids.s1 })).body[0].id;
  cadet = (await c.cmd.post('/api/cadets', { firstName: 'איתן משה', lastName: 'שפיגלר', personalNumber: '9335581', teamId: team })).body.cadet.id;
});

const set = (agent: Ctx['cmd'], changes: Record<string, unknown>, base?: Record<string, unknown>) => agent.patch(`/api/evaluations/${cadet}`, { changes, ...(base ? { base } : {}) });
const file = async (agent: Ctx['cmd'] = c.cmd) => (await agent.get(`/api/evaluations/${cadet}`)).body as EvaluationFile;

describe('who opens the file', () => {
  it('the company commander and the cadet\'s team commander - no one else, not even by a direct link', async () => {
    expect((await c.cmd.get(`/api/evaluations/${cadet}`)).status).toBe(200);
    expect((await c.s1.get(`/api/evaluations/${cadet}`)).status).toBe(200);
    for (const [method, url, body] of [
      ['get', `/api/evaluations/${cadet}`],
      ['get', `/api/evaluations/${cadet}/history`],
      ['patch', `/api/evaluations/${cadet}`, { changes: { city: 'חיפה' } }],
      ['post', `/api/evaluations/${cadet}/notes`, { occurredOn: '2026-10-01', body: 'x' }],
      ['post', `/api/evaluations/${cadet}/points`, { description: 'x' }],
      ['post', `/api/evaluations/${cadet}/dynamics`, { occurredOn: '2026-10-01', score: 3, rank: 4 }],
    ] as [string, string, object?][]) {
      const agent = c.s2 as unknown as Record<string, (u: string, b?: object) => Promise<{ status: number }>>;
      expect((await agent[method](url, body)).status, `${method} ${url}`).toBe(403);
    }
    // the list holds only the cadets whose files one may open
    expect(((await c.s2.get('/api/evaluations')).body as EvaluationListItem[]).length).toBe(0);
    expect(((await c.s1.get('/api/evaluations')).body as EvaluationListItem[]).map((r) => r.cadetId)).toEqual([cadet]);
  });

  it('the summary is the company commander\'s to write; the team commander reads it', async () => {
    expect((await set(c.s1, { summary: 'סיכום של מפק"צ' })).status).toBe(403);
    await set(c.cmd, { summary: 'צוער רציני; ממשיך במעקב.' });
    const f = await file(c.s1);
    expect(f.summary).toMatchObject({ text: 'צוער רציני; ממשיך במעקב.', byName: 'מפקד הקורס' });
    expect(f.canEditSummary).toBe(false);
    expect((await file(c.cmd)).canEditSummary).toBe(true);
  });
});

describe('a living file', () => {
  it('opens before anything is written: the course and cadet details come from the system', async () => {
    const f = await file();
    expect(f.layout).toBe(2);
    expect(f.general).toEqual({ companyCommander: '', teamCommander: '', companyCommanderAuto: 'מפקד הקורס', teamCommanderAuto: 'מפק"צ 1' });
    expect(f.details).toEqual({ firstName: 'איתן משה', lastName: 'שפיגלר', personalNumber: '9335581', unit: '', city: '', enlistedOn: null, releaseOn: null });
    expect(Object.values(f.exams).every((v) => v === null)).toBe(true);
    expect(f.tests).toEqual(['fitBase', 'readings']);
    expect(f.removableTests).toEqual([]);
    expect([f.dynamics, f.notes, f.points, f.committeeReason, f.militaryPath]).toEqual([[], [], [], '', '']);
  });

  it('every part is set on its own, a part at a time; the cadet card holds the name and number', async () => {
    await set(c.s1, { unit: 'מערך הסייבר', city: 'חיפה', enlistedOn: '2024-03-10', releaseOn: '2027-03-09' });
    await set(c.s1, { militaryPath: '2024 - טירונות\n2024-2025 - מפעיל במרכז' });
    await set(c.s1, { midA: 0, runResult: '11:45', pushups: 42 });
    await set(c.s1, { personalNumber: '9335582', teamCommander: 'סגן נועה' });
    const f = await file(c.s1);
    expect(f.details).toMatchObject({ unit: 'מערך הסייבר', city: 'חיפה', enlistedOn: '2024-03-10', releaseOn: '2027-03-09', personalNumber: '9335582' });
    expect(f.cadet.personalNumber).toBe('9335582');
    expect(f.general.teamCommander).toBe('סגן נועה');
    expect(f.militaryPath).toContain('מפעיל במרכז');
    // zero is a score; what was never entered stays "not entered"
    expect(f.exams).toMatchObject({ midA: 0, midB: null, runResult: '11:45', runScore: null, pushups: 42 });
    // a test with a value is shown even before the course added it
    expect(f.tests).toEqual(['fitBase', 'readings', 'midExam']);
    expect(f.updatedByName).toBe('מפק"צ 1');
    // and back to "not entered"
    await set(c.s1, { midA: null });
    expect((await file()).exams.midA).toBeNull();
    expect((await file()).tests).toEqual(['fitBase', 'readings']);
  });

  it('the threshold fitness test and the readings exam are always there; the rest are added for the whole course', async () => {
    const other = (await c.cmd.post('/api/cadets', { firstName: 'דנה', lastName: 'לוי' })).body.cadet.id as number;
    const tests = `/api/evaluations/${cadet}/tests`;
    expect((await c.s2.post(tests, { test: 'fitMid' })).status).toBe(403);
    expect((await c.s1.post(tests, { test: 'fitBase' })).status).toBe(400);
    const added = (await c.s1.post(tests, { test: 'fitMid' })).body as EvaluationFile;
    expect(added.tests).toEqual(['fitBase', 'readings', 'fitMid']);
    expect(added.removableTests).toEqual(['fitMid']);
    expect((await c.s1.post(tests, { test: 'fitMid' })).status).toBe(200); // twice is once
    // in the other cadets' files too
    expect(((await c.cmd.get(`/api/evaluations/${other}`)).body as EvaluationFile).tests).toEqual(['fitBase', 'readings', 'fitMid']);
    expect(((await c.s1.get('/api/evaluations')).body as EvaluationListItem[])[0]).toMatchObject({ exams: 0, examsTotal: 10 });
    // once a value is entered it stays
    await set(c.s1, { midRunResult: '10:58', midRunScore: 85, readingsA: 92 });
    const f = await file(c.s1);
    expect(f.exams).toMatchObject({ midRunResult: '10:58', midRunScore: 85, readingsA: 92, runResult: null });
    expect(f.removableTests).toEqual([]);
    expect((await c.cmd.del(`${tests}/fitMid`)).body.error).toContain('כבר הוזנו נתונים');
    expect(((await c.s1.get('/api/evaluations')).body as EvaluationListItem[])[0]).toMatchObject({ exams: 3, examsTotal: 10 });
    const history = (await c.s1.get(`/api/evaluations/${cadet}/history`)).body as EvaluationChange[];
    expect(history.map((h) => h.label)).toEqual(expect.arrayContaining(['כושר גופני אמצע - ציון ריצה', 'מבחן מקראות - מועד א׳']));
    // emptied again, it can be taken away - by the commander or the cadet's team commander only
    await set(c.s1, { midRunResult: null, midRunScore: null });
    expect((await c.s2.del(`${tests}/fitMid`)).status).toBe(403);
    expect(((await c.s1.del(`${tests}/fitMid`)).body as EvaluationFile).tests).toEqual(['fitBase', 'readings']);
    expect((await c.s1.del(`${tests}/readings`)).status).toBe(400);
  });

  it('keeps every value within its range', async () => {
    expect((await set(c.s1, { midA: 101 })).body.error).toContain('מבחן אמצע - מועד א׳');
    expect((await set(c.s1, { pushups: 2.5 })).status).toBe(400);
    expect((await set(c.s1, { enlistedOn: '2025-01-01', releaseOn: '2024-01-01' })).body.error).toContain('השחרור לפני');
    expect((await set(c.s1, { firstName: '' })).status).toBe(400);
    for (const bad of [{ score: 0, rank: 3 }, { score: 6, rank: 3 }, { score: 3, rank: 0 }, { score: 3, rank: 13 }, { score: 2.5, rank: 3 }]) {
      expect((await c.s1.post(`/api/evaluations/${cadet}/dynamics`, { occurredOn: '2026-10-01', ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('group dynamics and remarks pile up in order; adding never replaces', async () => {
    await c.s1.post(`/api/evaluations/${cadet}/dynamics`, { occurredOn: '2026-10-15', score: 4, rank: 3 });
    await c.s1.post(`/api/evaluations/${cadet}/dynamics`, { occurredOn: '2026-09-20', score: 2, rank: 9 });
    await c.s1.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-10-02', body: 'שיפור בהובלת הצוות בשטח.' });
    await c.cmd.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-09-25', body: 'פער בעמידה בזמנים.' });
    const f = await file(c.s1);
    expect(f.dynamics.map((d) => [d.occurredOn, d.score, d.rank])).toEqual([['2026-09-20', 2, 9], ['2026-10-15', 4, 3]]);
    expect(f.notes.map((n) => [n.occurredOn, n.authorName])).toEqual([['2026-09-25', 'מפקד הקורס'], ['2026-10-02', 'מפק"צ 1']]);
    // the team commander cannot change the company commander's remark; their own, yes
    expect(f.notes[0].canEdit).toBe(false);
    expect(f.notes[1].canEdit).toBe(true);
    expect((await c.s1.patch(`/api/evaluations/notes/${f.notes[0].id}`, { body: 'x', version: 1 })).status).toBe(403);
  });

  it('a remark or point is updated with its history kept; a change made meanwhile is never written over', async () => {
    await c.s1.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-10-02', body: 'נוסח ראשון' });
    const note = (await file(c.s1)).notes[0];
    const edited = (await c.s1.patch(`/api/evaluations/notes/${note.id}`, { body: 'נוסח שני', version: note.version })).body as EvaluationFile;
    expect(edited.notes[0]).toMatchObject({ body: 'נוסח שני', edited: true, version: 2 });
    // someone still holding the first version is refused, and told who changed it
    const stale = await c.cmd.patch(`/api/evaluations/notes/${note.id}`, { body: 'נוסח של המ"פ', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toContain('מפק"צ 1');
    expect((await file()).notes[0].body).toBe('נוסח שני');

    await c.s1.post(`/api/evaluations/${cadet}/points`, { period: 'שבוע 3', description: 'נרדם בשמירה', significance: 'אמינות ואחריות בתפקיד' });
    const point = (await file()).points[0];
    expect(point).toMatchObject({ period: 'שבוע 3', description: 'נרדם בשמירה', significance: 'אמינות ואחריות בתפקיד' });
    await c.cmd.patch(`/api/evaluations/points/${point.id}`, { significance: 'אמינות - בסיס לבחינת התאמה לקצונה', version: 1 });
    expect((await c.s1.patch(`/api/evaluations/points/${point.id}`, { description: 'x', version: 1 })).status).toBe(409);

    const history = (await c.s1.get(`/api/evaluations/${cadet}/history`)).body as EvaluationChange[];
    const noteEdit = history.find((h) => h.label === 'התייחסות עודכנה')!;
    expect(noteEdit).toMatchObject({ userName: 'מפק"צ 1', oldValue: 'נוסח ראשון', newValue: 'נוסח שני' });
    expect(history.find((h) => h.label === 'נקודה קריטית - משמעות פיקודית עודכנה')).toMatchObject({ userName: 'מפקד הקורס', oldValue: 'אמינות ואחריות בתפקיד' });
  });

  it('a field changed meanwhile by someone else is not overwritten; the history keeps every value', async () => {
    await set(c.s1, { militaryPath: 'גרסה של מפק"צ' }, { militaryPath: '' });
    // the company commander started from the empty field
    const late = await set(c.cmd, { militaryPath: 'גרסה של המ"פ' }, { militaryPath: '' });
    expect(late.status).toBe(409);
    expect(late.body.error).toContain('מסלול צבאי');
    expect((await file()).militaryPath).toBe('גרסה של מפק"צ');
    // seeing the saved version, they decide to replace it
    expect((await set(c.cmd, { militaryPath: 'גרסה של המ"פ' }, { militaryPath: 'גרסה של מפק"צ' })).status).toBe(200);
    const history = (await c.cmd.get(`/api/evaluations/${cadet}/history`)).body as EvaluationChange[];
    expect(history.filter((h) => h.label === 'מסלול צבאי').map((h) => [h.userName, h.oldValue, h.newValue])).toEqual([
      ['מפקד הקורס', 'גרסה של מפק"צ', 'גרסה של המ"פ'],
      ['מפק"צ 1', null, 'גרסה של מפק"צ'],
    ]);
  });

  it('the reason for a committee is optional, and becomes the referral\'s reason', async () => {
    await set(c.s1, { committeeReason: 'שני אירועים חוזרים של חוסר אמינות בשמירה; לבחון התאמה להמשך.' });
    const referred = (await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה' })).body as EvaluationFile;
    expect(referred.committees[0].reason).toBe('שני אירועים חוזרים של חוסר אמינות בשמירה; לבחון התאמה להמשך.');
  });
});

describe('committees', () => {
  it('a committee receives the file as it stood, which can be refreshed until it decides', async () => {
    await c.s1.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-09-30', body: 'נרדם בשמירה' });
    expect((await c.s1.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה' })).status).toBe(403);
    const referred = (await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה', reason: 'שני חריגים בשמירה', meetingDate: '2026-10-05' })).body as EvaluationFile;
    const committeeId = referred.committees[0].id;
    expect(notificationsOf(c.ids.s1).map((n) => n.title)).toContain('איתן משה שפיגלר הועבר לוועדת הדחה');
    expect((await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה' })).status).toBe(400); // one open committee at a time

    // written after the referral: not in the committee's version until it is refreshed
    await c.s1.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-10-02', body: 'שיפור ניכר בשבוע האחרון' });
    const frozen = (await c.s1.get(`/api/evaluations/committees/${committeeId}`)).body;
    expect(frozen.committee).toMatchObject({ kind: 'ועדת הדחה', reason: 'שני חריגים בשמירה', meetingDate: '2026-10-05', decision: null });
    expect(frozen.file.notes.map((n: { body: string }) => n.body)).toEqual(['נרדם בשמירה']);
    expect((await c.s2.get(`/api/evaluations/committees/${committeeId}`)).status).toBe(403);
    await c.cmd.post(`/api/evaluations/committees/${committeeId}/refresh`);
    expect((await c.cmd.get(`/api/evaluations/committees/${committeeId}`)).body.file.notes).toHaveLength(2);

    const decided = (await c.cmd.post(`/api/evaluations/committees/${committeeId}/decision`, { decision: 'dismissed', text: 'הוחלט על הדחה.' })).body as EvaluationFile;
    expect(decided.committees[0]).toMatchObject({ decision: 'dismissed', decisionText: 'הוחלט על הדחה.', decidedByName: 'מפקד הקורס' });
    expect(decided.cadet.status).toBe('dropped');
    expect((await c.cmd.post(`/api/evaluations/committees/${committeeId}/refresh`)).status).toBe(400);
    expect((await c.cmd.get('/api/evaluations')).body[0].committee).toEqual({ id: committeeId, kind: 'ועדת הדחה', decision: 'dismissed' });
  });

  it('a version given to a committee in the earlier form still opens, in the present one', async () => {
    const old = {
      cadet: (await file()).cadet,
      teamCommanderName: 'מפק"צ 1',
      standing: 'watch',
      teamOpinion: { text: 'פער בעבודת צוות', byName: 'מפק"צ 1', at: '2026-09-28T10:00:00.000Z' },
      commanderOpinion: { text: 'ממשיך במעקב', byName: 'מפקד הקורס', at: '2026-09-29T10:00:00.000Z' },
      entries: [{ id: 7, category: 'משמעת', tone: 'exception', title: 'איחור', body: 'איחר למסדר', occurredOn: '2026-09-27', shownOn: null, authorId: c.ids.s1, authorName: 'מפק"צ 1', createdAt: '2026-09-27T10:00:00.000Z' }],
      scores: [],
      experiences: [],
      discipline: [],
      talks: [],
      committees: [],
      generatedAt: '2026-09-30T10:00:00.000Z',
    };
    const id = db().run("INSERT INTO committees(cadet_id, kind, reason, referred_at, snapshot, snapshot_at) VALUES (?, 'ועדת הערכה', '', ?, ?, ?)", cadet, old.generatedAt, JSON.stringify(old), old.generatedAt).id;
    const shown = (await c.cmd.get(`/api/evaluations/committees/${id}`)).body.file as EvaluationFile;
    expect(shown.layout).toBe(2);
    expect(shown.summary.text).toBe('ממשיך במעקב');
    expect(shown.notes.map((n) => n.body)).toEqual(['חוות דעת מפקד הצוות:\nפער בעבודת צוות', 'איחור\nאיחר למסדר']);
    expect(shown.notes[1].legacy).toEqual({ tone: 'exception', category: 'משמעת', shownOn: null });
  });
});

describe('what was written before stays', () => {
  it('the entries keep their writers and dates; the team commander\'s opinion opens their remarks; the commander\'s is the summary', () => {
    const before = new Db(':memory:');
    migrate(before, 27);
    before.run("INSERT INTO users(id, username, password_hash, display_name, role, created_at) VALUES (1, 'cmd', 'x', 'מפקד', 'commander', '2026-09-01'), (2, 's1', 'x', 'מפק\"צ', 'staff', '2026-09-01')");
    before.run("INSERT INTO teams(id, name, commander_id, created_at) VALUES (1, 'צוות', 2, '2026-09-01')");
    before.run("INSERT INTO cadets(id, first_name, team_id, created_at, updated_at) VALUES (1, 'נועם', 1, '2026-09-01', '2026-09-01')");
    before.run("INSERT INTO evaluation_files(cadet_id, standing, team_opinion, team_opinion_by, team_opinion_at, commander_opinion, commander_opinion_by, commander_opinion_at, updated_at) VALUES (1, 'watch', 'צוער רציני', 2, '2026-09-20T08:00:00.000Z', 'במעקב', 1, '2026-09-21T08:00:00.000Z', '2026-09-21T08:00:00.000Z')");
    before.run("INSERT INTO evaluation_entries(cadet_id, category, tone, title, body, occurred_on, shown_on, author_id, created_at, updated_at) VALUES (1, 'משמעת', 'improve', 'איחור', 'איחר למסדר', '2026-09-15', '2026-09-16', 2, '2026-09-15T08:00:00.000Z', '2026-09-15T08:00:00.000Z')");
    migrate(before);
    const rows = before.all<{ title: string; body: string; tone: string | null; occurred_on: string; author_id: number; shown_on: string | null }>('SELECT title, body, tone, occurred_on, author_id, shown_on FROM evaluation_entries ORDER BY occurred_on');
    expect(rows).toEqual([
      { title: 'איחור', body: 'איחר למסדר', tone: 'improve', occurred_on: '2026-09-15', author_id: 2, shown_on: '2026-09-16' },
      { title: '', body: 'חוות דעת מפקד הצוות (מהתיק הקודם):\nצוער רציני', tone: null, occurred_on: '2026-09-20', author_id: 2, shown_on: null },
    ]);
    expect(before.get<{ commander_opinion: string; standing: string; team_opinion: string }>('SELECT commander_opinion, standing, team_opinion FROM evaluation_files')).toEqual({ commander_opinion: 'במעקב', standing: 'watch', team_opinion: 'צוער רציני' });
    before.close();
  });

  it('the fitness entered so far is the threshold test; a mid or final exam already entered is added for the course', () => {
    const before = new Db(':memory:');
    migrate(before, 28);
    before.run("INSERT INTO cadets(id, first_name, created_at, updated_at) VALUES (1, 'נועם', '2026-09-01', '2026-09-01')");
    before.run("INSERT INTO evaluation_files(cadet_id, mid_a, run_result, pushups, updated_at) VALUES (1, 74, '11:30', 40, '2026-09-21T08:00:00.000Z')");
    migrate(before);
    expect(before.all<{ test: string }>('SELECT test FROM evaluation_tests').map((r) => r.test)).toEqual(['midExam']);
    expect(before.get('SELECT mid_a, run_result, pushups, readings_a, mid_run_score FROM evaluation_files')).toEqual({ mid_a: 74, run_result: '11:30', pushups: 40, readings_a: null, mid_run_score: null });
    before.close();
  });
});

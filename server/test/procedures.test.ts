// Not keeping to procedures (shared/procedures.ts), reported from the "+": any staff member reports on any
// cadet - the kind picked from the list, with its own detail where it has one - and it is kept in the cadet's
// file as discipline: seen by the writer, the team commander and the course commander, each kind counted on
// its own, grouped in the discipline reports under its subject. Made-up names and words.

import { beforeEach, describe, expect, it } from 'vitest';
import { byCadet, kindsLine, procedureBody, procedureMissing, procedureOffense, procedureTitle, procedureWhat, readProcedure, type ProcedureEntry, type ProcedureOverview } from '../../shared/procedures';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

/** a cadet in team 1, whose commander is the first staff member */
async function cadetOfTeam1(): Promise<number> {
  const teams = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body;
  return (await c.cmd.post('/api/cadets', { firstName: 'עומר', lastName: 'שלו', teamId: teams[0].id })).body.cadet.id;
}

/** two teams: team 1 (the first staff member commands it) with two cadets, team 2 (the second) with one */
async function twoTeams(): Promise<{ a: number; b: number; x: number }> {
  const t1 = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
  const teams = (await c.cmd.post('/api/teams', { name: 'צוות 2', commanderId: c.ids.s2 })).body;
  const t2 = teams.find((t: { name: string }) => t.name === 'צוות 2').id;
  const add = async (firstName: string, lastName: string, teamId: number) => (await c.cmd.post('/api/cadets', { firstName, lastName, teamId })).body.cadet.id as number;
  return { a: await add('עומר', 'שלו', t1), b: await add('נגה', 'אלון', t1), x: await add('רון', 'דגן', t2) };
}

const records = async (agent: Ctx['cmd'], cadetId: number) =>
  ((await agent.get(`/api/cadets/${cadetId}`)).body.records as { kind: string; title: string; body: string; offense: string; occurrence: number | null; formal: boolean }[]).filter((r) => r.kind === 'discipline');

describe('a report of not keeping to procedures', () => {
  it('reads each kind in words, and says what it still lacks', () => {
    expect(procedureMissing({})).toEqual(['שם הצוער', 'מה קרה']);
    expect(procedureMissing({ cadetId: 3, kind: 'other', other: '  ' })).toEqual(['מה לא נשמר']);
    expect(procedureMissing({ cadetId: 3, kind: 'dress', dress: [] })).toEqual(['מה בדיגום']);
    expect(procedureMissing({ cadetId: 3, kind: 'phone' })).toEqual([]);
    expect(procedureWhat({ kind: 'dress', dress: ['תג שם', 'כומתה'] })).toBe('דיגום - כומתה, תג שם');
    expect(procedureTitle({ kind: 'weapon_left' })).toBe('אי עמידה בנהלים: הפקרת נשק');
    expect(procedureTitle({ kind: 'other', other: ' גילוח  חלקי ' })).toBe('אי עמידה בנהלים: גילוח חלקי');
    expect(procedureOffense({ kind: 'phone' })).toBe('אי עמידה בנהלים · טלפון');
    expect(procedureOffense({ kind: 'other', other: 'גילוח' })).toBe('אי עמידה בנהלים · גילוח');
    // a phone's situation goes first; the situation of anything else is not kept
    expect(procedureBody({ kind: 'phone', situation: 'בשיעור', details: 'הודעות' })).toBe('הסיטואציה: בשיעור\nהודעות');
    expect(procedureBody({ kind: 'weapon_back', situation: 'בשיעור', details: '' })).toBe('');
  });

  it("goes into the cadet's discipline: any staff member reports, the team commander hears, and only they see it", async () => {
    const cadet = await cadetOfTeam1();
    const res = await c.s2.post('/api/procedures', { cadetId: cadet, kind: 'phone', situation: 'במסדר בוקר', details: 'שיחה בטלפון בזמן המסדר' });
    expect(res.status).toBe(200);
    expect(res.body.occurrence).toBe(1);
    // the writer sees it in the file, as discipline
    const mine = await records(c.s2, cadet);
    expect(mine).toEqual([
      expect.objectContaining({ title: 'אי עמידה בנהלים: טלפון', body: 'הסיטואציה: במסדר בוקר\nשיחה בטלפון בזמן המסדר', offense: 'אי עמידה בנהלים · טלפון', occurrence: 1, formal: false }),
    ]);
    // the team commander hears, and sees it; the course commander sees it
    expect(notificationsOf(c.ids.s1).map((n) => n.title)).toContain('מפק"צ 2 הוסיף רישום אי עמידה בנהלים (טלפון) על עומר שלו');
    expect(await records(c.s1, cadet)).toHaveLength(1);
    expect(await records(c.cmd, cadet)).toHaveLength(1);
    // another staff member does not
    expect(await records(c.s3, cadet)).toHaveLength(0);
  });

  it('counts each kind on its own, and the dress by its items', async () => {
    const cadet = await cadetOfTeam1();
    const send = (body: object) => c.s3.post('/api/procedures', { cadetId: cadet, ...body });
    expect((await send({ kind: 'dress', dress: ['שרוך'] })).body.occurrence).toBe(1);
    expect((await send({ kind: 'weapon_left' })).body.occurrence).toBe(1);
    const again = await send({ kind: 'dress', dress: ['כומתה', 'גומיות'], details: 'במסדר' });
    expect(again.body.occurrence).toBe(2);
    const file = await records(c.cmd, cadet);
    expect(file.map((r) => r.title)).toEqual(['אי עמידה בנהלים: דיגום - כומתה, גומיות', 'אי עמידה בנהלים: הפקרת נשק', 'אי עמידה בנהלים: דיגום - שרוך']);
    expect(file[0]).toMatchObject({ occurrence: 2, body: 'במסדר' });
    // "אחר" is counted by its words
    expect((await send({ kind: 'other', other: 'גילוח' })).body.occurrence).toBe(1);
    expect((await send({ kind: 'other', other: ' גילוח ' })).body.occurrence).toBe(2);
    // the discipline report groups them under the subject
    const log = (await c.cmd.get('/api/discipline/log')).body as { category: string; offense: string }[];
    expect(log.map((e) => `${e.category}: ${e.offense}`)).toEqual([
      'אי עמידה בנהלים: דיגום',
      'אי עמידה בנהלים: הפקרת נשק',
      'אי עמידה בנהלים: דיגום',
      'אי עמידה בנהלים: גילוח',
      'אי עמידה בנהלים: גילוח',
    ]);
  });

  it('takes only what the form offers, and nothing missing', async () => {
    const cadet = await cadetOfTeam1();
    const send = (body: object) => c.s2.post('/api/procedures', body);
    expect((await send({ kind: 'phone' })).status).toBe(400);
    expect((await send({ cadetId: cadet, kind: 'shoes' })).status).toBe(400);
    const noItems = await send({ cadetId: cadet, kind: 'dress', dress: [] });
    expect(noItems.status).toBe(400);
    expect(noItems.body.error).toBe('חסר: מה בדיגום');
    expect((await send({ cadetId: cadet, kind: 'dress', dress: ['חגורה'] })).status).toBe(400);
    const noWords = await send({ cadetId: cadet, kind: 'other', other: ' ' });
    expect(noWords.body.error).toBe('חסר: מה לא נשמר');
    expect((await send({ cadetId: cadet, kind: 'other', other: 'א'.repeat(81) })).status).toBe(400);
    expect((await send({ cadetId: 9999, kind: 'phone' })).status).toBe(404);
    expect(await records(c.cmd, cadet)).toHaveLength(0);
  });
});

describe('every report, by cadet', () => {
  it('reads a report back from its record, as it was written', () => {
    const back = (r: Parameters<typeof procedureTitle>[0]) => readProcedure(procedureOffense(r), procedureTitle(r));
    expect(back({ kind: 'weapon_back' })).toEqual({ kind: 'weapon_back', other: '', dress: [] });
    expect(back({ kind: 'dress', dress: ['תג שם', 'שרוך'] })).toEqual({ kind: 'dress', other: '', dress: ['שרוך', 'תג שם'] });
    expect(back({ kind: 'other', other: 'נעליים לא מצוחצחות' })).toEqual({ kind: 'other', other: 'נעליים לא מצוחצחות', dress: [] });
    // a record of the enforcement ladder, not of this form
    expect(readProcedure('טלפונים · שימוש בטלפון בשיעור', 'שימוש בטלפון בשיעור')).toBeNull();
  });

  it('groups the reports by cadet: the most first, each kind counted, the dress items and the other things', () => {
    let id = 0;
    const entry = (cadetId: number, cadetName: string, kind: ProcedureEntry['kind'], occurredOn: string, more: Partial<ProcedureEntry> = {}): ProcedureEntry => ({
      id: ++id,
      cadetId,
      cadetName,
      teamId: 1,
      teamName: 'צוות 1',
      cadetStatus: 'active',
      occurredOn,
      kind,
      other: '',
      dress: [],
      body: '',
      authorName: 'מפק"צ 1',
      occurrence: null,
      canDelete: false,
      ...more,
    });
    const cadets = byCadet([
      entry(1, 'עומר שלו', 'phone', '2026-10-02'),
      entry(2, 'נגה אלון', 'dress', '2026-10-03', { dress: ['כומתה', 'שרוך'] }),
      entry(2, 'נגה אלון', 'dress', '2026-10-05', { dress: ['כומתה'] }),
      entry(2, 'נגה אלון', 'other', '2026-10-04', { other: 'גילוח' }),
      entry(3, 'רון דגן', 'weapon_left', '2026-10-06'),
    ]);
    expect(cadets.map((c) => `${c.cadetName} ${c.total}`)).toEqual(['נגה אלון 3', 'רון דגן 1', 'עומר שלו 1']);
    const noga = cadets[0];
    expect(noga.byKind).toEqual({ weapon_left: 0, weapon_back: 0, phone: 0, dress: 2, other: 1 });
    expect(noga.dress).toEqual([
      { item: 'כומתה', count: 2 },
      { item: 'שרוך', count: 1 },
    ]);
    expect(noga.others).toEqual([{ text: 'גילוח', count: 1 }]);
    expect(noga.last).toBe('2026-10-05');
    expect(noga.entries.map((e) => e.occurredOn)).toEqual(['2026-10-05', '2026-10-04', '2026-10-03']);
    expect(kindsLine(noga)).toBe('דיגום 2 · אחר 1');
  });

  it('shows each one what discipline shows them: the commander every report, a team commander their teams and their own, others their own', async () => {
    const { a, b, x } = await twoTeams();
    await c.s3.post('/api/procedures', { cadetId: a, kind: 'phone', situation: 'בשיעור' });
    await c.s3.post('/api/procedures', { cadetId: a, kind: 'phone' });
    await c.s1.post('/api/procedures', { cadetId: b, kind: 'dress', dress: ['כומתה'] });
    await c.s1.post('/api/procedures', { cadetId: x, kind: 'weapon_left' });
    await c.s2.post('/api/procedures', { cadetId: x, kind: 'other', other: 'גילוח' });
    // a discipline record that is not of this form stays out
    await c.s1.post(`/api/cadets/${a}/records`, { kind: 'discipline', body: 'איחור למסדר' });
    const view = async (agent: Ctx['cmd']) => (await agent.get('/api/procedures')).body as ProcedureOverview;

    const all = await view(c.cmd);
    expect(all.scope).toBe('all');
    expect(all.entries).toHaveLength(5);
    // as many and as recent: by name
    expect(byCadet(all.entries).map((g) => `${g.cadetName} ${g.total}`)).toEqual(['עומר שלו 2', 'רון דגן 2', 'נגה אלון 1']);
    const phone = all.entries.filter((e) => e.cadetId === a);
    expect(phone.map((e) => [e.kind, e.occurrence])).toEqual([
      ['phone', 2],
      ['phone', 1],
    ]);
    expect(phone[1]).toMatchObject({ cadetName: 'עומר שלו', teamName: 'צוות 1', body: 'הסיטואציה: בשיעור', authorName: 'מפק"צ 3', canDelete: true });

    // the first staff member commands team 1: its reports, and the one they wrote on a cadet of team 2
    const lead = await view(c.s1);
    expect(lead.scope).toBe('teams');
    expect(lead.entries.map((e) => `${e.cadetName}: ${procedureWhat(e)}`).sort()).toEqual(['נגה אלון: דיגום - כומתה', 'עומר שלו: טלפון', 'עומר שלו: טלפון', 'רון דגן: הפקרת נשק'].sort());
    // only what they wrote may they delete
    expect(lead.entries.filter((e) => e.canDelete).map((e) => e.kind).sort()).toEqual(['dress', 'weapon_left']);

    // the third commands no team: their own reports only
    const other = await view(c.s3);
    expect(other.scope).toBe('mine');
    expect(other.entries.map((e) => e.cadetId)).toEqual([a, a]);
    // the second commands team 2: its two reports - the one on its cadet by the first included - and none of team 1
    expect((await view(c.s2)).entries.map((e) => e.cadetId)).toEqual([x, x]);
  });
});

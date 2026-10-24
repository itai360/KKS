// Not keeping to procedures (shared/procedures.ts), reported from the "+": any staff member reports on any
// cadet - the kind picked from the list, with its own detail where it has one - and it is kept in the cadet's
// file as discipline: seen by the writer, the team commander and the course commander, each kind counted on
// its own, grouped in the discipline reports under its subject. Made-up names and words.

import { beforeEach, describe, expect, it } from 'vitest';
import { procedureBody, procedureMissing, procedureOffense, procedureTitle, procedureWhat } from '../../shared/procedures';
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

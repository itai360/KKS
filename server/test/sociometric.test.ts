// The sociometric: each team's sheet into a round, cadets found by the names a team writes, where each
// stands in the team and the company, and what stands out. The names and numbers here are made up.

import { beforeEach, describe, expect, it } from 'vitest';
import { computeRound, type SocioEntry } from '../../shared/sociometric';
import { setup, type Ctx } from './helpers';

let c: Ctx;
let team1 = 0;
let team2 = 0;
const ids: Record<string, number> = {};

const CRITERIA = [' כישורי ביטוי ודיון', ' פיקוד ומנהיגות', ' יוזמה', 'מוטיבציה'];
const HEADER = ['שם הצוער', 'ממוצע', 'אחוזון', 'דירוג כללי', ...CRITERIA, 'עמודה 1'];

beforeEach(async () => {
  c = await setup();
  team1 = (await c.cmd.post('/api/teams', { name: 'צוות 1 - אלון', commanderId: c.ids.s1 })).body[0].id;
  team2 = (await c.cmd.post('/api/teams', { name: 'צוות 2 - ברוש', commanderId: c.ids.s2 })).body.find((t: { name: string }) => t.name.startsWith('צוות 2')).id;
  const add = async (first: string, last: string, team: number) => {
    ids[`${first} ${last}`] = (await c.cmd.post('/api/cadets', { firstName: first, lastName: last, personalNumber: '', teamId: team })).body.cadet.id;
  };
  for (const [f, l] of [['רועי', 'כהן'], ['עמית', 'ישראלי'], ['עמית', 'קדם'], ['דנה', 'לוי'], ['יואב', 'מור']]) await add(f, l, team2);
  for (const [f, l] of [['רועי', 'בר'], ['נועה', 'גל'], ['איתי', 'שמש'], ['שירה', 'טל']]) await add(f, l, team1);
});

// a team's sheet as the course keeps it: the cadets, the team's average row, and a list of names below
const sheet = (rows: (string | number)[][]) => [
  HEADER,
  ...rows.map((r, i) => [...r.map(String), String(i + 1)]),
  ['', '', '', '', '', '', '', ''],
  ['', '#REF!', '', '#REF!', '#REF!', '#REF!', '#REF!', '#REF!'],
  ['רועי'],
  ['עמית י'],
];
const team2Sheet = sheet([
  ['רועי', '', '', 2, 5.5, 6, 5.75, 6.25],
  ['עמית י', '', '', 1, 6.5, 6.25, 6, 6.5],
  ['עמית ק', '', '', 5, 3.5, 4.25, 2.5, 4],
  ['דנה', '', '', 3, 5, 5.5, 5.25, 5.5],
  ['יואב', '', '', 4, 4.75, 5, 4.5, 3],
]);

describe('a team sheet', () => {
  it('finds the team by its title and the cadets by first name and initial - before anything is written', async () => {
    expect((await c.s1.post('/api/sociometric/preview', { rows: team2Sheet })).status).toBe(403);
    const p = (await c.cmd.post('/api/sociometric/preview', { rows: team2Sheet, source: 'סוציומטרי צוות 2 קקס' })).body;
    expect(p).toMatchObject({ headerRow: 1, teamId: team2, teamBy: 'title', criteria: CRITERIA.map((x) => x.trim()) });
    // the team's average row and the bare list of names are not cadets
    expect(p.rows.map((r: { name: string; cadetId: number }) => [r.name, r.cadetId])).toEqual([
      ['רועי', ids['רועי כהן']],
      ['עמית י', ids['עמית ישראלי']],
      ['עמית ק', ids['עמית קדם']],
      ['דנה', ids['דנה לוי']],
      ['יואב', ids['יואב מור']],
    ]);
    // without a title: the team most of the names belong to
    expect((await c.cmd.post('/api/sociometric/preview', { rows: team2Sheet })).body).toMatchObject({ teamId: team2, teamBy: 'names' });
    // "רועי" alone is two cadets in the course - in the team it is one
    const noTeam = (await c.cmd.post('/api/sociometric/preview', { rows: team2Sheet, teamId: null })).body;
    expect(noTeam.rows[0]).toMatchObject({ cadetId: null, ambiguous: true });
  });

  it('imports into a new round; a name not found can be given its cadet; the commander and the team commander see it', async () => {
    const renamed = sheet([
      ['רועי', '', '', 1, 6, 6, 6, 6],
      ['עמית', '', '', 2, 5, 5, 5, 5], // two Amits: which one?
    ]);
    const p = (await c.cmd.post('/api/sociometric/preview', { rows: renamed, source: 'צוות 2' })).body;
    expect(p.rows[1]).toMatchObject({ cadetId: null, ambiguous: true });
    const r = (await c.cmd.post('/api/sociometric/import', { rows: renamed, source: 'צוות 2', mapping: { [p.rows[1].line]: ids['עמית קדם'] }, newRound: { name: 'סוציומטרי אמצע', heldOn: '2026-09-20' } })).body;
    expect(r).toMatchObject({ set: 2, unmatched: 0, teamName: 'צוות 2 - ברוש' });
    const view = (await c.cmd.get('/api/sociometric')).body;
    expect(view.round).toMatchObject({ name: 'סוציומטרי אמצע', heldOn: '2026-09-20', cadets: 2, teams: 1 });
    // the round's scale, from all of its scores: 1-7
    expect(view.scale).toBe(7);
    expect(view.rows.map((x: { cadetName: string; rankInTeam: number; avg: number }) => [x.cadetName, x.rankInTeam, x.avg])).toEqual(
      expect.arrayContaining([
        ['רועי כהן', 1, 6],
        ['עמית קדם', 2, 5],
      ]),
    );
    // team 2's commander sees team 2; team 1's commander sees no one of it
    expect((await c.s2.get('/api/sociometric')).body.rows).toHaveLength(2);
    expect((await c.s1.get('/api/sociometric')).body).toMatchObject({ scope: 'team', rows: [] });
    expect((await c.s3.get('/api/sociometric')).body).toMatchObject({ scope: 'none', rows: [] });
    // the cadet's page: the commander and the team commander only
    expect((await c.s2.get(`/api/cadets/${ids['רועי כהן']}/sociometric`)).body[0].row).toMatchObject({ rankInTeam: 1 });
    expect((await c.s1.get(`/api/cadets/${ids['רועי כהן']}/sociometric`)).status).toBe(403);
  });

  it('two teams in a round: the company rank; the next round shows who dropped', async () => {
    const round = (await c.cmd.post('/api/sociometric/import', { rows: team2Sheet, source: 'צוות 2', newRound: { name: 'סוציומטרי אמצע' } })).body.roundId;
    const team1Sheet = sheet([
      ['רועי', '', '', 1, 6.75, 6.5, 6.5, 6.75],
      ['נועה', '', '', 2, 6, 6, 5.5, 6],
      ['איתי', '', '', 3, 5, 4.5, 5, 5],
      ['שירה', '', '', 4, 4, 4.5, 4, 4.5],
    ]);
    await c.cmd.post('/api/sociometric/import', { rows: team1Sheet, source: 'צוות 1', roundId: round });
    const v = (await c.cmd.get('/api/sociometric')).body;
    expect(v.round).toMatchObject({ cadets: 9, teams: 2 });
    const of = (name: string) => v.rows.find((x: { cadetName: string }) => x.cadetName === name);
    expect(of('רועי בר')).toMatchObject({ rankInTeam: 1, companyRank: 1, companyCount: 9, companyStanding: 100 });
    expect(of('עמית קדם')).toMatchObject({ rankInTeam: 5, teamCount: 5, companyRank: 9, outlier: true });
    expect(of('עמית קדם').flags.map((f: { text: string }) => f.text)).toEqual(expect.arrayContaining(['תחתית הצוות - מקום 5 מתוך 5', 'עשירון תחתון בפלוגה']));
    // the next round: Roi falls from 2nd to the bottom, Amit K. climbs from the bottom to the top
    const next = sheet([
      ['רועי', '', '', 5, 3, 3, 3, 3],
      ['עמית י', '', '', 2, 5.5, 5.5, 5.5, 5.5],
      ['עמית ק', '', '', 1, 6, 6, 6, 6],
      ['דנה', '', '', 3, 5, 5, 5, 5],
      ['יואב', '', '', 4, 4.5, 4.5, 4.5, 4.5],
    ]);
    await c.cmd.post('/api/sociometric/import', { rows: next, source: 'צוות 2', newRound: { name: 'סוציומטרי סוף', heldOn: '2026-10-20' } });
    const latest = (await c.cmd.get('/api/sociometric')).body;
    expect(latest.round.name).toBe('סוציומטרי סוף');
    const amit = latest.rows.find((x: { cadetName: string }) => x.cadetName === 'עמית קדם');
    expect(amit.previous).toMatchObject({ round: 'סוציומטרי אמצע', rankInTeam: 5 });
    expect(amit.flags.map((f: { text: string }) => f.text)).toContain('עלה 4 מקומות בצוות מאז סוציומטרי אמצע');
    const roi = latest.rows.find((x: { cadetName: string }) => x.cadetName === 'רועי כהן');
    expect(roi.flags.map((f: { text: string }) => f.text)).toContain('ירד 3 מקומות בצוות מאז סוציומטרי אמצע');
    // an earlier round stays open by its id
    expect((await c.cmd.get(`/api/sociometric?round=${round}`)).body.round.name).toBe('סוציומטרי אמצע');
    // and goes, with its results
    expect((await c.s1.del(`/api/sociometric/rounds/${round}`)).status).toBe(403);
    expect((await c.cmd.del(`/api/sociometric/rounds/${round}`)).status).toBe(200);
    expect((await c.cmd.get('/api/sociometric')).body.rounds.map((r: { name: string }) => r.name)).toEqual(['סוציומטרי סוף']);
  });
});

describe('what stands out', () => {
  const e = (cadetId: number, team: number, rank: number, scores: Record<string, number>): SocioEntry => ({
    cadetId,
    cadetName: `צוער ${cadetId}`,
    teamId: team,
    teamName: `צוות ${team}`,
    teamRank: rank,
    teamSize: 6,
    average: null,
    percentile: null,
    scores,
  });
  it('the average from the criteria when the sheet has none; a criterion far below the cadet or the company; a drop since the round before', () => {
    const crit = ['א', 'ב', 'ג'];
    const entries = [
      e(1, 1, 1, { א: 6.5, ב: 6.5, ג: 6.4 }),
      e(2, 1, 2, { א: 6, ב: 6, ג: 6.2 }),
      e(3, 1, 3, { א: 5.8, ב: 5.5, ג: 4 }), // ג more than a point below its own average
      e(4, 1, 4, { א: 5.5, ב: 5.6, ג: 5.5 }),
      e(5, 1, 5, { א: 5.2, ב: 5, ג: 5.4 }),
      e(6, 1, 6, { א: 4, ב: 2, ג: 4.1 }), // ב far below the company
    ];
    const before = computeRound(entries.map((x) => ({ ...x, teamRank: x.cadetId === 4 ? 1 : x.teamRank })), crit);
    const { rows, means } = computeRound(entries, crit, { name: 'סבב א', rows: before.rows });
    expect(rows[0].avg).toBe(6.47);
    expect(means['']).toBeCloseTo(5.3, 1);
    const flags = (id: number) => rows.find((r) => r.cadetId === id)!.flags.map((f) => `${f.tone}:${f.text}`);
    expect(flags(1)).toContain('green:ראשון בצוות');
    expect(flags(3).some((f) => f.startsWith('orange:חולשה יחסית: ג'))).toBe(true);
    expect(flags(6)).toEqual(expect.arrayContaining(['red:תחתית הצוות - מקום 6 מתוך 6', expect.stringMatching(/^red:ב נמוך מאוד/)]));
    expect(flags(4)).toContain('red:ירד 3 מקומות בצוות מאז סבב א');
    expect(rows.find((r) => r.cadetId === 2)!.outlier).toBe(false);
  });
});

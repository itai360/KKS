// The teams by their number (1, 2, 3...) - set in the teams' dialog - and their commanders with them: in the
// teams' lists, the staff lists and pickers, the staff's checklist, and the "team commanders" group.

import { beforeEach, describe, expect, it } from 'vitest';
import type { StaffChecksBoard, StaffStatus, Team, User } from '../../shared/types';
import { staffGroups } from '../src/staffGroups';
import { Db, db, migrate, withDb } from '../src/db';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('teams in their order', () => {
  it('teams are listed by their number, not by their name - and their commanders with them', async () => {
    // named against their numbers: by name it would be אלון, ברוש, גפן
    // a new team: the teams' list comes back
    const add = async (name: string, commanderId: number, sort: number) => ((await c.cmd.post('/api/teams', { name, commanderId, sort })).body as Team[]).find((t) => t.name === name)!.id;
    await add('צוות גפן', c.ids.s1, 3);
    await add('צוות אלון', c.ids.s3, 2);
    const brosh = await add('צוות ברוש', c.ids.s2, 1);

    const teams = async () => ((await c.cmd.get('/api/teams')).body as Team[]).map((t) => [t.sort, t.name]);
    expect(await teams()).toEqual([
      [1, 'צוות ברוש'],
      [2, 'צוות אלון'],
      [3, 'צוות גפן'],
    ]);
    // the commander first, then the team commanders by their team's number
    const people = async () => ((await c.cmd.get('/api/users')).body as User[]).map((u) => u.id);
    expect(await people()).toEqual([c.ids.cmd, c.ids.s2, c.ids.s3, c.ids.s1]);
    expect(((await c.cmd.get('/api/team')).body as StaffStatus[]).map((s) => s.userId)).toEqual([c.ids.s2, c.ids.s3, c.ids.s1]);
    // the staff's checklist in the same order - a team commander's own team in its place too
    expect(((await c.s1.get('/api/staff-checks')).body as StaffChecksBoard).teams.map((t) => t.name)).toEqual(['צוות ברוש', 'צוות אלון', 'צוות גפן']);
    withDb(db(), () => expect(staffGroups().find((g) => g.rule === 'teamCommanders')?.memberIds).toEqual([c.ids.s2, c.ids.s3, c.ids.s1]));

    // a number changed in the dialog: the order follows
    expect((await c.cmd.put(`/api/teams/${brosh}`, { name: 'צוות ברוש', commanderId: c.ids.s2, sort: 4 })).status).toBe(200);
    expect((await teams()).map(([, n]) => n)).toEqual(['צוות אלון', 'צוות גפן', 'צוות ברוש']);
    expect(await people()).toEqual([c.ids.cmd, c.ids.s3, c.ids.s1, c.ids.s2]);
    // a team without a number given comes next - or takes the number in its name, when no team has it
    await c.cmd.post('/api/teams', { name: 'צוות דקל' });
    expect((await teams()).at(-1)).toEqual([5, 'צוות דקל']);
    await c.cmd.post('/api/teams', { name: 'צוות 1 - תאנה' });
    expect((await teams())[0]).toEqual([1, 'צוות 1 - תאנה']);
    await c.cmd.post('/api/teams', { name: 'צוות 2 - זית' }); // 2 is צוות אלון's: after the last
    expect((await teams()).at(-1)).toEqual([6, 'צוות 2 - זית']);
  });

  it("a course's teams keep the order they were shown in: numbered by their names", () => {
    const d = new Db(':memory:');
    migrate(d, 64);
    // made one after the other, out of order - shown until now by name, the numbers in it in their order
    for (const [name, sort] of [
      ['צוות 10', 1],
      ['צוות 2 - גיורא', 2],
      ['צוות 1 - אלון', 3],
      ['מטה', 3],
    ] as const)
      d.run('INSERT INTO teams(name, sort, created_at) VALUES (?, ?, ?)', name, sort, '2026-01-01T00:00:00.000Z');
    migrate(d);
    expect(d.all('SELECT sort, name FROM teams ORDER BY sort')).toEqual([
      { sort: 1, name: 'מטה' },
      { sort: 2, name: 'צוות 1 - אלון' },
      { sort: 3, name: 'צוות 2 - גיורא' },
      { sort: 4, name: 'צוות 10' },
    ]);
    d.close();
  });
});

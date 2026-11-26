import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STAFF_GROUPS, groupOf, namesOf } from '../../shared/staffGroups';
import type { Task } from '../../shared/types';
import { at, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const open = async (body: Record<string, unknown>) => {
  const r = await c.cmd.post('/api/tasks', { deadline: at('2026-10-05'), ...body });
  expect(r.status).toBe(200);
  return r.body.ids as number[];
};
const listed = async (ids: number[]) => ((await c.cmd.get('/api/tasks?scope=open')).body as Task[]).filter((t) => ids.includes(t.id));

describe('staff groups (סגל / מפק"צים / פורום מוביל)', () => {
  beforeEach(async () => {
    // two of the three staff command a team
    await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 });
    await c.cmd.post('/api/teams', { name: 'צוות 2', commanderId: c.ids.s2 });
  });

  it('works out who is in each group', async () => {
    const groups = (await c.s2.get('/api/staff-groups')).body;
    expect(groups.map((g: { name: string }) => g.name)).toEqual(['סגל', 'מפק"צים', 'פורום מוביל']);
    expect(groups[0].memberIds.sort()).toEqual([c.ids.s1, c.ids.s2, c.ids.s3].sort());
    expect(groups[1].memberIds.sort()).toEqual([c.ids.s1, c.ids.s2].sort());
    // the leading forum is the commander's to choose: no one until then
    expect(groups[2].memberIds).toEqual([]);
  });

  it('names the group of a task given to all the staff, on every copy, with how many are done', async () => {
    const ids = await open({ title: 'לפצל את צוות 5', assignMode: 'all' });
    expect(ids).toHaveLength(3);
    await c.s1.post(`/api/tasks/${ids[0]}/transition`, { action: 'complete' });
    const copies = (await c.cmd.get('/api/tasks')).body.filter((t: Task) => ids.includes(t.id)) as Task[];
    expect(copies.every((t) => t.groupName === 'סגל')).toBe(true);
    expect(copies[0].groupCopies.map((x) => x.id).sort()).toEqual([...ids].sort());
    expect(copies[0].groupCopies.filter((x) => x.done)).toHaveLength(1);
  });

  it('names the team commanders, whoever of them opened it', async () => {
    const byCommander = await open({ title: 'הכנת שיחות אישיות', assignMode: 'copies', ownerIds: [c.ids.s1, c.ids.s2] });
    expect((await listed(byCommander)).map((t) => t.groupName)).toEqual(['מפק"צים', 'מפק"צים']);
    // one of them opens it for both: still the team commanders
    const r = await c.s1.post('/api/tasks', { title: 'תיאום מטווח', assignMode: 'copies', ownerIds: [c.ids.s1, c.ids.s2], deadline: at('2026-10-05') });
    expect((await listed(r.body.ids))[0].groupName).toBe('מפק"צים');
  });

  it('names the leading forum once the commander chose its people - copies, or one task they share', async () => {
    const groups = DEFAULT_STAFF_GROUPS.map((g) => (g.id === 'forum' ? { ...g, memberIds: [c.ids.cmd, c.ids.s1, c.ids.s3] } : g));
    expect((await c.s1.patch('/api/settings', { staffGroups: groups })).status).toBe(403);
    expect((await c.cmd.patch('/api/settings', { staffGroups: groups })).status).toBe(200);
    // the commander gives it to the other two (or to themselves as well)
    const copies = await open({ title: 'סיכום שבוע', assignMode: 'copies', ownerIds: [c.ids.s1, c.ids.s3] });
    expect((await listed(copies))[0].groupName).toBe('פורום מוביל');
    const withMe = await open({ title: 'הכנת פקודה', assignMode: 'copies', ownerIds: [c.ids.cmd, c.ids.s1, c.ids.s3] });
    expect((await listed(withMe))[0].groupName).toBe('פורום מוביל');
    const shared = await open({ title: 'מצגת לסיום', assignMode: 'shared', ownerIds: [c.ids.s1, c.ids.s3] });
    const [one] = await listed(shared);
    expect(one).toMatchObject({ groupName: 'פורום מוביל', groupCopies: [], participantIds: [c.ids.s3] });
  });

  it('leaves people who are not a group, and one person, without a group name', async () => {
    const other = await open({ title: 'תיאום הסעות', assignMode: 'copies', ownerIds: [c.ids.s2, c.ids.s3] });
    expect((await listed(other))[0].groupName).toBeNull();
    const single = await open({ title: 'ציוד', ownerIds: [c.ids.s2] });
    expect((await listed(single))[0]).toMatchObject({ groupName: null, groupCopies: [] });
  });

  it('follows the groups as they are renamed, and refuses two groups of one name', async () => {
    const ids = await open({ title: 'לפצל את צוות 5', assignMode: 'all' });
    const renamed = DEFAULT_STAFF_GROUPS.map((g) => (g.id === 'staff' ? { ...g, name: 'כל הסגל' } : g));
    expect((await c.cmd.patch('/api/settings', { staffGroups: renamed })).status).toBe(200);
    expect((await listed(ids))[0].groupName).toBe('כל הסגל');
    const twice = DEFAULT_STAFF_GROUPS.map((g) => ({ ...g, name: 'סגל' }));
    expect((await c.cmd.patch('/api/settings', { staffGroups: twice })).status).toBe(400);
  });

  it('deletes all the copies of a group task together', async () => {
    const ids = await open({ title: 'לפצל את צוות 5', assignMode: 'all' });
    const r = await c.cmd.post('/api/bulk', { entity: 'tasks', action: 'delete', ids });
    expect(r.body).toMatchObject({ done: 3, failed: [] });
    expect(await listed(ids)).toEqual([]);
  });
});

describe('matching people to a group', () => {
  const groups = [
    { id: 'staff', name: 'סגל', rule: 'staff' as const, memberIds: [2, 3, 4, 5] },
    { id: 'tc', name: 'מפק"צים', rule: 'teamCommanders' as const, memberIds: [2, 3, 4] },
    { id: 'forum', name: 'פורום מוביל', rule: 'custom' as const, memberIds: [1, 6, 7] },
  ];
  it('matches exactly, counting the opener either way', () => {
    expect(groupOf([2, 3, 4, 5], 1, groups)?.name).toBe('סגל');
    expect(groupOf([3, 4], 2, groups)?.name).toBe('מפק"צים');
    expect(groupOf([6, 7], 1, groups)?.name).toBe('פורום מוביל');
    expect(groupOf([1, 6, 7], 1, groups)?.name).toBe('פורום מוביל');
    expect(groupOf([2, 3], 1, groups)).toBeNull();
    expect(groupOf([2, 3, 4, 5, 6], 1, groups)).toBeNull();
    expect(groupOf([6], 1, groups)).toBeNull();
    // a group with no one in it matches nothing
    expect(groupOf([8, 9], 1, [{ id: 'x', name: 'ריק', rule: 'custom', memberIds: [] }])).toBeNull();
  });
  it('names a few people who are not a group', () => {
    expect(namesOf(['דנה', 'יואב'])).toBe('דנה, יואב');
    expect(namesOf(['דנה', 'יואב', 'נועה'])).toBe('דנה, יואב, נועה');
    expect(namesOf(['דנה', 'יואב', 'נועה', 'עומר'])).toBe('דנה, יואב +2');
  });
});

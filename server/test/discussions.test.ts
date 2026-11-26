// Discussions: a planning discussion, a debrief discussion and the rest - a subject, the points to go through and
// what came up on each, the decisions, and the follow-up actions with who owns them and by when; an action
// becomes a task, and its state is its task's.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Discussion, DiscussionSummary } from '../../shared/types';
import { DISCUSSION_POINTS } from '../../shared/discussions';
import { Db, db, migrate } from '../src/db';
import { at, notificationsOf, setup, staffMay, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

async function open(body: Record<string, unknown> = {}): Promise<Discussion> {
  const r = await c.s1.post('/api/discussions', {
    kind: 'planning',
    title: 'תכנון שבוע שטח',
    heldOn: '2026-10-04',
    heldAt: '10:00',
    participantIds: [c.ids.s2, c.ids.cmd],
    points: DISCUSSION_POINTS.planning,
    ...body,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as Discussion;
}

describe('discussions', () => {
  it('opens with its subject, the points of its kind, who leads it and who is asked - and tells them', async () => {
    const d = await open();
    expect(d).toMatchObject({ kind: 'planning', title: 'תכנון שבוע שטח', heldOn: '2026-10-04', heldAt: '10:00', status: 'planned', leadId: c.ids.s1, canEdit: true, canDelete: true });
    expect(d.pointList.map((p) => p.body)).toEqual(DISCUSSION_POINTS.planning);
    expect(d.participantList.map((p) => p.id).sort()).toEqual([c.ids.cmd, c.ids.s2].sort());
    expect(notificationsOf(c.ids.s2).at(-1)).toMatchObject({ type: 'discussion_invite', title: 'זומנת לדיון: תכנון שבוע שטח', link: `/discussions/${d.id}` });
    // the one who opened it is not told of it
    expect(notificationsOf(c.ids.s1).filter((n) => n.type === 'discussion_invite')).toEqual([]);
    expect((await c.s1.post('/api/discussions', { kind: 'planning', title: '', heldOn: '2026-10-04' })).status).toBe(400);
    expect((await c.s1.post('/api/discussions', { kind: 'party', title: 'x', heldOn: '2026-10-04' })).status).toBe(400);
  });

  it('everyone sees it; those in it work on it, the commander too - others only read', async () => {
    const d = await open();
    const seen = (await c.s3.get(`/api/discussions/${d.id}`)).body as Discussion;
    expect([seen.canEdit, seen.canDelete]).toEqual([false, false]);
    expect((await c.s3.post(`/api/discussions/${d.id}/points`, { body: 'נקודה' })).status).toBe(403);
    expect((await c.s2.post(`/api/discussions/${d.id}/points`, { body: 'תיאום עם הגדוד' })).status).toBe(200);
    expect((await c.s2.del(`/api/discussions/${d.id}`)).status).toBe(403);
    const list = (await c.s3.get('/api/discussions')).body as DiscussionSummary[];
    expect(list.map((x) => [x.title, x.mine])).toEqual([['תכנון שבוע שטח', false]]);
    expect(((await c.s2.get('/api/discussions')).body as DiscussionSummary[])[0].mine).toBe(true);
    expect((await c.cmd.del(`/api/discussions/${d.id}`)).status).toBe(200);
    expect((await c.s3.get('/api/discussions')).body).toEqual([]);
  });

  it('points: what came up on each, discussed, in order', async () => {
    const d = await open({ points: ['א', 'ב', 'ג'] });
    const [a, b, g] = d.pointList;
    let out = (await c.s1.patch(`/api/discussion-points/${a.id}`, { outcome: 'הוחלט להקדים ביום', done: true })).body as Discussion;
    expect(out.pointList[0]).toMatchObject({ outcome: 'הוחלט להקדים ביום', done: true });
    expect(out.pointsDone).toBe(1);
    out = (await c.s1.post(`/api/discussions/${d.id}/points/order`, { ids: [g.id, a.id, b.id] })).body as Discussion;
    expect(out.pointList.map((p) => p.body)).toEqual(['ג', 'א', 'ב']);
    out = (await c.s1.del(`/api/discussion-points/${b.id}`)).body as Discussion;
    expect(out.pointList.map((p) => p.body)).toEqual(['ג', 'א']);
  });

  it('follow-up actions: an owner and a date - a task of its owner, its state the task’s', async () => {
    const d = await open();
    let out = (await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'להזמין את המטווח', ownerId: c.ids.s2, dueOn: '2026-10-06' })).body as Discussion;
    const action = out.actionList[0];
    expect(action).toMatchObject({ body: 'להזמין את המטווח', ownerId: c.ids.s2, ownerName: 'מפק"צ 2', dueOn: '2026-10-06', taskId: null, state: 'open' });
    out = (await c.s1.post(`/api/discussion-actions/${action.id}/task`)).body as Discussion;
    const taskId = out.actionList[0].taskId!;
    expect(out.actionList[0].state).toBe('task');
    const task = db().get<{ title: string; owner_id: number; deadline: string; description: string }>('SELECT title, owner_id, deadline, description FROM tasks WHERE id = ?', taskId)!;
    expect(task).toMatchObject({ title: 'להזמין את המטווח', owner_id: c.ids.s2, deadline: at('2026-10-06', '18:00') });
    expect(task.description).toBe('מתוך דיון תכנוני: תכנון שבוע שטח (4.10)');
    expect((await c.s1.post(`/api/discussion-actions/${action.id}/task`)).status).toBe(400);
    // done there: done here
    await c.s2.post(`/api/tasks/${taskId}/transition`, { action: 'accept' });
    await c.s2.post(`/api/tasks/${taskId}/transition`, { action: 'complete' });
    out = (await c.s1.get(`/api/discussions/${d.id}`)).body as Discussion;
    expect(out.actionList[0].state).toBe('done');
    expect(out.actions).toEqual({ total: 1, open: 0, late: 0, done: 1 });
  });

  it('summed up: a task for each action with an owner, and everyone in it told', async () => {
    const d = await open();
    await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'תיאום אמבולנס', ownerId: c.ids.s2, dueOn: '2026-10-05' });
    await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'לבדוק ציוד', ownerId: c.ids.s1 });
    await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'בלי אחראי עדיין' });
    await c.s1.patch(`/api/discussions/${d.id}`, { decisions: 'השטח נקבע לגבעה הצפונית' });
    const r = await c.s1.post(`/api/discussions/${d.id}/summarize`, { openTasks: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.opened).toBe(2);
    const out = r.body.discussion as Discussion;
    expect(out).toMatchObject({ status: 'summarized', decisions: 'השטח נקבע לגבעה הצפונית', summarizedByName: 'מפק"צ 1' });
    expect(out.actionList.map((a) => [a.body, a.state])).toEqual([
      ['תיאום אמבולנס', 'task'],
      ['לבדוק ציוד', 'task'],
      ['בלי אחראי עדיין', 'open'],
    ]);
    // no date: a week from today
    expect(out.actionList[1].dueOn).toBe('2026-10-08');
    expect(notificationsOf(c.ids.cmd).at(-1)).toMatchObject({ type: 'discussion_summary', title: 'סוכם הדיון: תכנון שבוע שטח' });
    expect((await c.s1.post(`/api/discussions/${d.id}/reopen`)).body.status).toBe('planned');
  });

  it("a staff member who may not give the commander a task: that action is said, the others opened", async () => {
    await staffMay(c, { tasks: false });
    const d = await open();
    await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'אישור המפקד', ownerId: c.ids.cmd, dueOn: '2026-10-05' });
    await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'מפה לשטח', ownerId: c.ids.s1, dueOn: '2026-10-05' });
    const r = (await c.s1.post(`/api/discussions/${d.id}/tasks`)).body;
    expect(r.opened).toBe(1);
    expect(r.failed.map((f: { body: string }) => f.body)).toEqual(['אישור המפקד']);
  });

  it('a late action is said - before a task, by its own date', async () => {
    const d = await open({ heldOn: '2026-09-28' });
    const out = (await c.s1.post(`/api/discussions/${d.id}/actions`, { body: 'סיכום כתוב', ownerId: c.ids.s1, dueOn: '2026-09-30' })).body as Discussion;
    expect(out.actionList[0].state).toBe('late');
    expect(out.actions).toEqual({ total: 1, open: 1, late: 1, done: 0 });
  });

  it('the list: newest first, by kind, with its week', async () => {
    const w = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-10-04', endDate: '2026-10-08' })).body;
    await open();
    await open({ kind: 'debrief', title: 'תחקיר תרגיל לילה', heldOn: '2026-09-30' });
    const all = (await c.s1.get('/api/discussions')).body as DiscussionSummary[];
    expect(all.map((x) => [x.title, x.weekName])).toEqual([
      ['תכנון שבוע שטח', 'שבוע שטח'],
      ['תחקיר תרגיל לילה', null],
    ]);
    expect(all[0].weekId).toBe(w.week?.id ?? w.id);
    expect(((await c.s1.get('/api/discussions?kind=debrief')).body as DiscussionSummary[]).map((x) => x.title)).toEqual(['תחקיר תרגיל לילה']);
  });

  it('someone asked later is told; the one asked before is not told again', async () => {
    const d = await open({ participantIds: [c.ids.s2] });
    const before = notificationsOf(c.ids.s2).length;
    await c.s1.patch(`/api/discussions/${d.id}`, { participantIds: [c.ids.s2, c.ids.s3] });
    expect(notificationsOf(c.ids.s3).at(-1)).toMatchObject({ type: 'discussion_invite' });
    expect(notificationsOf(c.ids.s2).length).toBe(before);
  });

  it('participants from outside the staff: a name, what they are, an email for the summary', async () => {
    const d = await open({
      guestList: [
        { name: 'רס"ן ישראל ישראלי', role: 'קצין בטיחות חטיבתי', email: 'Safety.Officer@Example.com' },
        { name: 'נציג הגדוד', role: '', email: '' },
      ],
    });
    expect(d.guestList).toEqual([
      { name: 'רס"ן ישראל ישראלי', role: 'קצין בטיחות חטיבתי', email: 'safety.officer@example.com' },
      { name: 'נציג הגדוד', role: '', email: '' },
    ]);
    expect((await c.s1.patch(`/api/discussions/${d.id}`, { guestList: [{ name: 'א', email: 'לא מייל' }] })).status).toBe(400);
    expect((await c.s1.patch(`/api/discussions/${d.id}`, { guestList: [{ name: '', email: 'a@b.co' }] })).status).toBe(400);
    const out = (await c.s1.patch(`/api/discussions/${d.id}`, { guestList: [{ name: 'נציג הגדוד', role: 'קמב"ץ', email: 'ops@example.com' }] })).body as Discussion;
    expect(out.guestList).toEqual([{ name: 'נציג הגדוד', role: 'קמב"ץ', email: 'ops@example.com' }]);
    // the list unchanged when not sent
    expect(((await c.s1.patch(`/api/discussions/${d.id}`, { decisions: 'x' })).body as Discussion).guestList).toHaveLength(1);
    // others on the staff do not change it
    expect((await c.s3.patch(`/api/discussions/${d.id}`, { guestList: [] })).status).toBe(403);
  });
});

describe('discussions kept before external participants had their own list', () => {
  it('the line written of them becomes one of them', () => {
    const d = new Db(':memory:');
    migrate(d, 59);
    d.run(
      "INSERT INTO discussions(kind, title, held_on, guests, created_at, updated_at) VALUES ('planning', 'תכנון', '2026-10-04', 'קצין הבטיחות, נציג הגדוד', '2026-10-01T07:00:00Z', '2026-10-01T07:00:00Z')",
    );
    d.run("INSERT INTO discussions(kind, title, held_on, created_at, updated_at) VALUES ('debrief', 'תחקיר', '2026-10-04', '2026-10-01T07:00:00Z', '2026-10-01T07:00:00Z')");
    migrate(d);
    expect(d.all('SELECT discussion_id, name, email FROM discussion_guests')).toEqual([{ discussion_id: 1, name: 'קצין הבטיחות, נציג הגדוד', email: '' }]);
    expect(d.all("SELECT guests FROM discussions WHERE guests <> ''")).toEqual([]);
    d.close();
  });
});

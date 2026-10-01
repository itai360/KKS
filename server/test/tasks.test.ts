import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { at, newTask, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('creating tasks', () => {
  it('requires title, owner and deadline (principles 78-79)', async () => {
    expect((await c.cmd.post('/api/tasks', { title: '', ownerIds: [c.ids.s1], deadline: at('2026-10-05') })).status).toBe(400);
    expect((await c.cmd.post('/api/tasks', { title: 'x', ownerIds: [], deadline: at('2026-10-05') })).status).toBe(400);
    expect((await c.cmd.post('/api/tasks', { title: 'x', ownerIds: [c.ids.s1] })).status).toBe(400);
  });

  it('assigns, notifies and shows the task in "my tasks" (section 40)', async () => {
    const id = await newTask(c.cmd, { title: 'סגירת לו"ז לשבוע התקפה', ownerIds: [c.ids.s1], priority: 'high' });
    const my = await c.s1.get('/api/my');
    expect([...my.body.week, ...my.body.important].map((t: { id: number }) => t.id)).toContain(id);
    expect(notificationsOf(c.ids.s1)[0].title).toContain('נוספה לך משימה חדשה');
    const detail = await c.s1.get(`/api/tasks/${id}`);
    expect(detail.body.task.createdByName).toBe('מפקד הקורס');
    expect(detail.body.activity[0].text).toContain('יצר את המשימה');
  });

  it('"all staff" creates a copy per person and tracks progress (section 64)', async () => {
    const res = await c.cmd.post('/api/tasks', { title: 'מעבר על נהלי הקורס', assignMode: 'all', deadline: at('2026-10-01', '18:00') });
    expect(res.body.ids).toHaveLength(3);
    const first = await c.cmd.get(`/api/tasks/${res.body.ids[0]}`);
    expect(first.body.group).toMatchObject({ total: 3, done: 0 });
    const s1Task = (await c.s1.get('/api/my')).body.today[0];
    await c.s1.post(`/api/tasks/${s1Task.id}/transition`, { action: 'complete' });
    const after = await c.cmd.get(`/api/tasks/${res.body.ids[0]}`);
    expect(after.body.group).toMatchObject({ total: 3, done: 1 });
    // staff cannot open an all-staff task
    expect((await c.s1.post('/api/tasks', { title: 'x', assignMode: 'all', deadline: at('2026-10-05') })).status).toBe(403);
  });

  it('a shared task has one owner and closes once for everyone (sections 65, 78)', async () => {
    const id = await newTask(c.cmd, { title: 'הכנת תרגיל מסכם', ownerIds: [c.ids.s1, c.ids.s3], assignMode: 'shared' });
    const d = await c.s3.get(`/api/tasks/${id}`);
    expect(d.body.task.ownerId).toBe(c.ids.s1);
    expect(d.body.task.participantIds).toEqual([c.ids.s3]);
    await c.s3.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect((await c.s1.get(`/api/tasks/${id}`)).body.task.status).toBe('done');
  });

  it('staff create for themselves, and for others only within the week they lead', async () => {
    expect((await c.s1.post('/api/tasks', { title: 'שלי', ownerIds: [c.ids.s1], deadline: at('2026-10-05') })).status).toBe(200);
    expect((await c.s1.post('/api/tasks', { title: 'לאחר', ownerIds: [c.ids.s2], deadline: at('2026-10-05') })).status).toBe(403);
    const week = await c.cmd.post('/api/weeks', { name: 'שבוע התקפה', startDate: '2026-10-04', endDate: '2026-10-10', leadId: c.ids.s1 });
    const ok = await c.s1.post('/api/tasks', { title: 'תיאום מטווח', ownerIds: [c.ids.s2], deadline: at('2026-10-06') });
    expect(ok.status).toBe(200);
    const t = await c.s2.get(`/api/tasks/${ok.body.ids[0]}`);
    expect(t.body.task.weekId).toBe(week.body.id); // auto-attached to the week by its deadline
  });
});

describe('visibility (section 21)', () => {
  it('staff see their own, team-wide and their week tasks, never private ones of others', async () => {
    const own = await newTask(c.cmd, { title: 'של 1', ownerIds: [c.ids.s1] });
    const other = await newTask(c.cmd, { title: 'של 2', ownerIds: [c.ids.s2], deadline: at('2026-10-15') });
    const team = await newTask(c.cmd, { title: 'כללית', ownerIds: [c.ids.s2], visibility: 'team' });
    await c.cmd.post('/api/weeks', { name: 'שבוע 2', startDate: '2026-10-04', endDate: '2026-10-10', leadId: c.ids.s1 });
    const inWeek = await newTask(c.cmd, { title: 'בשבוע שלי', ownerIds: [c.ids.s2], deadline: at('2026-10-07') });
    const privateInWeek = await newTask(c.cmd, { title: 'אישי', ownerIds: [c.ids.s2], deadline: at('2026-10-07'), visibility: 'private' });

    const ids = (await c.s1.get('/api/tasks')).body.map((t: { id: number }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([own, team, inWeek]));
    expect(ids).not.toContain(other);
    expect(ids).not.toContain(privateInWeek);
    expect((await c.s1.get(`/api/tasks/${privateInWeek}`)).status).toBe(404);
    expect((await c.s3.get(`/api/tasks/${inWeek}`)).status).toBe(404);
    expect((await c.cmd.get('/api/tasks')).body).toHaveLength(5);
  });
});

describe('staff restrictions (section 2)', () => {
  it('cannot delete or move the deadline of a commander task, but can request a change (section 62)', async () => {
    const id = await newTask(c.cmd, { title: 'תיאום מטווח', ownerIds: [c.ids.s2] });
    expect((await c.s2.del(`/api/tasks/${id}`)).status).toBe(403);
    expect((await c.s2.patch(`/api/tasks/${id}`, { deadline: at('2026-10-09') })).status).toBe(403);

    const detail = await c.s2.get(`/api/tasks/${id}`);
    expect(detail.body.permissions).toMatchObject({ canChangeDeadline: false, canRequestDeadline: true, canDelete: false });

    const req = await c.s2.post(`/api/tasks/${id}/requests`, { type: 'deadline', newDeadline: at('2026-10-09'), reason: 'ממתין לאישור מטווח' });
    expect(req.status).toBe(200);
    expect((await c.s2.post(`/api/tasks/${id}/requests`, { type: 'deadline', newDeadline: at('2026-10-09'), reason: 'שוב' })).status).toBe(400);
    expect(notificationsOf(c.ids.cmd).some((n) => n.title.includes('בקשת שינוי דד-ליין'))).toBe(true);

    const pending = (await c.cmd.get('/api/requests')).body;
    expect(pending).toHaveLength(1);
    expect((await c.s2.post(`/api/requests/${pending[0].id}/decide`, { approve: true })).status).toBe(403);
    await c.cmd.post(`/api/requests/${pending[0].id}/decide`, { approve: true });

    const after = await c.s2.get(`/api/tasks/${id}`);
    expect(after.body.task.deadline).toBe(at('2026-10-09'));
    expect(after.body.activity.map((a: { text: string }) => a.text).join('|')).toContain('שינה את הדד-ליין');
    expect(notificationsOf(c.ids.s2).some((n) => n.title.includes('אושרה'))).toBe(true);
  });

  it('cannot transfer without approval; an approved transfer keeps history (section 63)', async () => {
    const id = await newTask(c.cmd, { title: 'הזמנת תחמושת', ownerIds: [c.ids.s1] });
    expect((await c.s1.patch(`/api/tasks/${id}`, { ownerId: c.ids.s2 })).status).toBe(403);
    await c.s1.post(`/api/tasks/${id}/requests`, { type: 'transfer', newOwnerId: c.ids.s2, reason: 'אני בהשתלמות' });
    const [r] = (await c.cmd.get('/api/requests')).body;
    await c.cmd.post(`/api/requests/${r.id}/decide`, { approve: true });
    const d = await c.cmd.get(`/api/tasks/${id}`);
    expect(d.body.task.ownerId).toBe(c.ids.s2);
    const log = db().get<{ data: string }>("SELECT data FROM activity WHERE task_id = ? AND action = 'owner'", id)!;
    expect(JSON.parse(log.data)).toMatchObject({ from: c.ids.s1, to: c.ids.s2 });
  });

  it('a rejected request leaves the task unchanged', async () => {
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1] });
    await c.s1.post(`/api/tasks/${id}/requests`, { type: 'deadline', newDeadline: at('2026-10-20'), reason: 'עומס' });
    const [r] = (await c.cmd.get('/api/requests')).body;
    await c.cmd.post(`/api/requests/${r.id}/decide`, { approve: false, note: 'לא ניתן' });
    expect((await c.s1.get(`/api/tasks/${id}`)).body.task.deadline).toBe(at('2026-10-05'));
  });

  it('may edit and delete tasks they created themselves', async () => {
    const id = await newTask(c.s1, { title: 'שלי', ownerIds: [c.ids.s1] });
    expect((await c.s1.patch(`/api/tasks/${id}`, { deadline: at('2026-10-08'), priority: 'high' })).status).toBe(200);
    expect((await c.s1.del(`/api/tasks/${id}`)).status).toBe(200);
  });
});

describe('status flow (section 47)', () => {
  it('start -> blocked (with mandatory explanation) -> resolved -> approval -> returned -> approved', async () => {
    const id = await newTask(c.cmd, { title: 'לו"ז שבוע התקפה', ownerIds: [c.ids.s3], requiresApproval: true });
    expect((await c.s3.post(`/api/tasks/${id}/transition`, { action: 'start' })).body.task.status).toBe('in_progress');

    // principle 80 - no blocker without why / waiting for whom / next step
    expect((await c.s3.post(`/api/tasks/${id}/transition`, { action: 'block', reason: 'ממתין לאישור' })).status).toBe(400);
    const blocked = await c.s3.post(`/api/tasks/${id}/transition`, {
      action: 'block',
      reason: 'ממתין לאישור',
      waitingFor: 'מדריך ירי',
      nextStep: 'תזכורת מחר בבוקר',
      needsCommander: true,
    });
    expect(blocked.body.task).toMatchObject({ status: 'waiting', needsCommander: true });
    const dash = await c.cmd.get('/api/dashboard');
    expect(dash.body.attention.find((a: { taskId: number }) => a.taskId === id).kind).toBe('blocked');
    expect(notificationsOf(c.ids.cmd).some((n) => n.category === 'exception')).toBe(true);

    expect((await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'unblock', note: 'דיברתי עם המדריך' })).body.task.status).toBe('in_progress');

    const req = await c.s3.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect(req.body.task.status).toBe('pending_approval');
    expect(notificationsOf(c.ids.cmd).some((n) => n.title.includes('ביקש לסגור'))).toBe(true);

    expect((await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'return' })).status).toBe(400);
    const returned = await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'return', note: 'חסר תיאום רפואה' });
    expect(returned.body.task.status).toBe('in_progress');
    expect(returned.body.updates.at(-1)).toMatchObject({ kind: 'return', body: 'חסר תיאום רפואה' });

    await c.s3.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect((await c.s3.post(`/api/tasks/${id}/transition`, { action: 'approve' })).status).toBe(403);
    const done = await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'approve' });
    expect(done.body.task.status).toBe('done');
    expect(done.body.task.completedAt).toBeTruthy();
  });

  it('only involved people update status; cancel needs a reason; reopen works', async () => {
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1], visibility: 'team' });
    expect((await c.s2.post(`/api/tasks/${id}/transition`, { action: 'start' })).status).toBe(403);
    expect((await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'cancel' })).status).toBe(400);
    expect((await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'cancel', reason: 'הפעילות בוטלה' })).body.task.status).toBe('cancelled');
    expect((await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'reopen' })).body.task.status).toBe('in_progress');
  });

  it('updates are logged and reach the owner (section 42)', async () => {
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1] });
    await c.s1.post(`/api/tasks/${id}/updates`, { body: 'בוצעה פנייה למדור. ממתין לאישור.' });
    const instr = await c.cmd.post(`/api/tasks/${id}/updates`, { body: 'לוודא גם תיאום רפואה', kind: 'instruction' });
    expect(instr.body.updates.map((u: { kind: string }) => u.kind)).toEqual(['comment', 'instruction']);
    expect(notificationsOf(c.ids.s1).some((n) => n.title.includes('הנחיה חדשה'))).toBe(true);
    // the commander is not pinged for every staff update (section 74)
    expect(notificationsOf(c.ids.cmd).some((n) => n.type === 'update')).toBe(false);
  });

  it('overdue response "needs decision" raises it to the commander (section 61)', async () => {
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1], deadline: at('2026-09-30') });
    const r = await c.s1.post(`/api/tasks/${id}/overdue-response`, { response: 'decision', note: 'צריך לבחור שטח חלופי' });
    expect(r.body.task).toMatchObject({ overdue: true, needsCommander: true, overdueResponse: 'decision' });
    const dash = await c.cmd.get('/api/dashboard');
    expect(dash.body.attention[0]).toMatchObject({ taskId: id, kind: 'decision' });
  });
});

describe('subtasks and dependencies (sections 59-60)', () => {
  it('parent shows progress from subtasks', async () => {
    const parent = await newTask(c.cmd, { title: 'הכנת שבוע התקפה', ownerIds: [c.ids.s1] });
    const a = await newTask(c.cmd, { title: 'סגירת לו"ז', ownerIds: [c.ids.s1], parentId: parent });
    await newTask(c.cmd, { title: 'מדריכים', ownerIds: [c.ids.s2], parentId: parent });
    await c.s1.post(`/api/tasks/${a}/transition`, { action: 'complete' });
    const d = await c.cmd.get(`/api/tasks/${parent}`);
    expect(d.body.task).toMatchObject({ subtaskTotal: 2, subtaskDone: 1 });
    expect(d.body.subtasks).toHaveLength(2);
    expect((await c.cmd.patch(`/api/tasks/${parent}`, { parentId: a })).status).toBe(400);
  });

  it('prevents dependency cycles and notifies when a dependency completes', async () => {
    const build = await newTask(c.cmd, { title: 'בניית לו"ז', ownerIds: [c.ids.s1] });
    const distribute = await newTask(c.cmd, { title: 'הפצת לו"ז לסגל', ownerIds: [c.ids.s2], dependsOn: [build] });
    expect((await c.cmd.post(`/api/tasks/${build}/dependencies`, { dependsOnId: distribute })).status).toBe(400);
    expect((await c.cmd.get(`/api/tasks/${distribute}`)).body.task.openDependencies).toBe(1);
    await c.s1.post(`/api/tasks/${build}/transition`, { action: 'complete' });
    expect((await c.cmd.get(`/api/tasks/${distribute}`)).body.task.openDependencies).toBe(0);
    expect(notificationsOf(c.ids.s2).some((n) => n.type === 'dependency_done')).toBe(true);
  });
});

describe('attachments', () => {
  it('uploads a file and protects the download', async () => {
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1] });
    const res = await c.s1
      .post(`/api/tasks/${id}/files`)
      .set('content-type', 'application/pdf')
      .set('x-filename', encodeURIComponent('תיק תרגיל.pdf'))
      .send(Buffer.from('%PDF-1.4 test'));
    expect(res.status).toBe(200);
    const att = res.body.attachments[0];
    expect(att.title).toBe('תיק תרגיל.pdf');
    expect((await c.s1.get(att.url)).status).toBe(200);
    expect((await c.s2.get(att.url)).status).toBe(404);

    const link = await c.s1.post(`/api/tasks/${id}/links`, { url: 'https://drive.google.com/x', title: 'מצגת' });
    expect(link.body.attachments).toHaveLength(2);
    expect((await c.s1.post(`/api/tasks/${id}/links`, { url: 'javascript:alert(1)' })).status).toBe(400);
  });
});

import { generateKeyPairSync, sign } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { setJwksFetcher } from '../src/google';
import { setPushSender, type PushTarget } from '../src/push';
import { at, newTask, notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
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
    expect((await c.s1.post('/api/teams', { name: 'x' })).status).toBe(403);
    expect((await c.s1.post('/api/cadets', { firstName: 'נועם', teamId })).status).toBe(200);
    expect((await c.s2.post('/api/cadets', { firstName: 'נועם', teamId })).status).toBe(403);
    const list = (await c.s2.get('/api/cadets')).body;
    expect(list).toHaveLength(3);
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
      ['צוות 2 - גיורא', 2],
      ['צוות 1 - אלון', 1],
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
    const asOther = (await c.s3.get('/api/experiences')).body[0];
    expect(asOther).toMatchObject({ canGiveFeedback: false, canEdit: false });
    expect((await c.s3.post('/api/experiences', { cadetId: a, role: 'x', startDate: '2026-10-04', endDate: '2026-10-04' })).status).toBe(403);

    const mentorTasks = (await c.s2.get('/api/my')).body;
    const feedbackTask = [...mentorTasks.week, ...mentorTasks.later, ...mentorTasks.important].find((t: { experienceId: number }) => t.experienceId === x.id);
    expect(feedbackTask).toMatchObject({ title: 'משוב התנסות: דניאל כהן - מ"מ בתרגיל התקפה', deadline: at('2026-10-06', '18:00') });

    expect((await c.s3.post(`/api/experiences/${x.id}/feedback`, { score: 5 })).status).toBe(403);
    const done = (await c.s2.post(`/api/experiences/${x.id}/feedback`, { strengths: 'החלטיות', improvements: 'שליטה בקשר', score: 4 })).body;
    expect(done).toMatchObject({ status: 'done', phase: 'done', score: 4 });
    expect((await c.s2.get(`/api/tasks/${feedbackTask.id}`)).body.task.status).toBe('done');

    const seenByOther = (await c.s3.get('/api/experiences')).body.find((e: { id: number }) => e.id === x.id);
    expect(seenByOther).toMatchObject({ score: null, strengths: '', canSeeFeedback: false });
    const lead = (await c.s1.get(`/api/cadets/${a}`)).body;
    expect(lead.records[0]).toMatchObject({ kind: 'evaluation', category: 'התנסות', score: 4, private: true });
    expect((await c.s3.get(`/api/cadets/${a}`)).body.records).toHaveLength(0);
  });

  it('changing the mentor moves the open feedback task', async () => {
    const { a } = await teamWithCadets();
    const x = (await c.s1.post('/api/experiences', { cadetId: a, role: 'סמל תורן', startDate: '2026-10-04', endDate: '2026-10-05', mentorId: c.ids.s2 })).body;
    await c.s1.patch(`/api/experiences/${x.id}`, { mentorId: c.ids.s3, endDate: '2026-10-07' });
    const t = db().get<{ owner_id: number; deadline: string }>('SELECT owner_id, deadline FROM tasks WHERE experience_id = ?', x.id)!;
    expect(t).toEqual({ owner_id: c.ids.s3, deadline: at('2026-10-07', '18:00') });
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

    expect((await c.s2.post(`/api/debrief-items/${lesson.id}/recurring`, { title: 'x', frequency: 'daily', time: '20:00', assignee: 'all' })).status).toBe(403);
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
  const sent: { target: PushTarget; payload: { title: string; link: string } }[] = [];
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

  it('does not push information-only notifications, and drops expired subscriptions', async () => {
    await c.cmd.post('/api/push/subscribe', sub);
    const id = await newTask(c.cmd, { title: 'x', ownerIds: [c.ids.s1], priority: 'high' });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' }); // "info" to the commander
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
    status = 410;
    const r = await c.cmd.post('/api/push/test');
    expect(r.body.sent).toBe(0);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM push_subscriptions')!.n).toBe(0);
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

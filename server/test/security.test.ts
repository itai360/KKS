// Security: what one staff member must never see of another's (or the commander's) private
// matters - checked on every screen's data at once - and the guards around sign-in,
// requests from other sites, files and links.

import { deflateRawSync } from 'node:zlib';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { assertPublicUrl, isPrivateAddress, isPushEndpoint, safeFetch } from '../src/netguard';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

const SECRET = 'ZQX';

/** private matters of others, each with a marker that must not reach s3 */
/** a call that must succeed - otherwise the test would pass for nothing */
async function ok(res: request.Response | Promise<request.Response>) {
  const r = await res;
  if (r.status !== 200) throw new Error(`planting failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r;
}

async function plantSecrets() {
  const team = (await c.cmd.post('/api/teams', { name: 'צוות אלון', commanderId: c.ids.s1 })).body[0].id;
  const cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועה', lastName: 'כהן', teamId: team })).body.cadet?.id ?? (await c.cmd.get('/api/cadets')).body[0].id;
  const week = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-03', leadId: c.ids.s2 })).body;
  const weekId = week.week?.id ?? week.id;
  // a private task, its update, link and a request on it
  const task = await newTask(c.cmd, { title: `${SECRET}1 משימה פרטית`, description: `${SECRET}1b`, ownerIds: [c.ids.s1], visibility: 'private', weekId });
  await ok(c.s1.post(`/api/tasks/${task}/updates`, { body: `${SECRET}11 עדכון` }));
  await ok(c.s1.post(`/api/tasks/${task}/links`, { url: 'https://example.com/x', title: `${SECRET}12 קישור` }));
  await ok(c.s1.post(`/api/tasks/${task}/requests`, { type: 'deadline', newDeadline: at('2026-10-09'), reason: `${SECRET}8 סיבה` }));
  // a restricted document
  await ok(c.cmd.post('/api/documents', { kind: 'link', title: `${SECRET}2 מסמך מוגבל`, category: 'נהלים', url: 'https://example.com/doc', restricted: true }));
  // a talk and a discipline record (by the team's commander) and another staff member's private note
  await ok(c.s1.post(`/api/cadets/${cadet}/records`, { kind: 'talk', title: 'שיחה', body: `${SECRET}3 שיחה אישית` }));
  await ok(c.s2.post(`/api/cadets/${cadet}/records`, { kind: 'note', title: 'הערה', body: `${SECRET}4 הערה פרטית`, private: true }));
  await ok(c.s1.post(`/api/cadets/${cadet}/records`, { kind: 'discipline', title: 'משמעת', body: `${SECRET}9 משמעת` }));
  // an exemption's reason (the subject and details are for everyone)
  await ok(c.cmd.post(`/api/cadets/${cadet}/exemptions`, { subject: 'גילוח', details: 'עד הודעה חדשה', reason: `${SECRET}5 סיבה רפואית` }));
  // the evaluation file: the commander's opinion and another's entry
  await ok(c.cmd.patch(`/api/evaluations/${cadet}`, { commanderOpinion: `${SECRET}6 חוות דעת`, teamOpinion: `${SECRET}6b`, standing: 'watch' }));
  await ok(c.s2.post(`/api/evaluations/${cadet}/entries`, { category: 'משמעת', tone: 'improve', title: `${SECRET}7 רישום`, body: `${SECRET}7b` }));
  // another person's absence note
  await ok(c.s1.post('/api/absences', { startDate: '2026-10-05', endDate: '2026-10-06', reason: 'sick', note: `${SECRET}10 בדיקה רפואית` }));
  return { cadet, task, weekId, team };
}

const READS = (p: { cadet: number; task: number; weekId: number }, ids: Ctx['ids']) => [
  '/api/auth/me',
  '/api/users',
  '/api/settings',
  '/api/tasks',
  '/api/tasks?status=all',
  '/api/my',
  '/api/briefing',
  '/api/reports/weekly',
  '/api/reports/lookahead',
  '/api/reports/day-end',
  `/api/search?q=${SECRET}`,
  '/api/activity',
  '/api/notifications',
  '/api/notifications?snoozed=1',
  '/api/requests',
  '/api/requests?status=all',
  '/api/weeks',
  `/api/weeks/${p.weekId}`,
  `/api/weeks/${p.weekId}/close-check`,
  '/api/events',
  '/api/cadets',
  '/api/cadets?status=all',
  `/api/cadets/${p.cadet}`,
  `/api/cadets/${p.cadet}/attendance`,
  '/api/exemptions',
  '/api/discipline/overview',
  '/api/discipline/log',
  '/api/evaluations',
  `/api/evaluations/${p.cadet}`,
  '/api/experiences',
  '/api/announcements',
  '/api/attendance',
  '/api/absences',
  '/api/load',
  '/api/debriefs',
  '/api/lessons',
  '/api/documents',
  '/api/alignment',
  `/api/team/${ids.s1}`,
  `/api/team/${ids.cmd}`,
  '/api/templates',
  '/api/recurring',
  '/api/meetings',
  '/api/calendar/sources',
  '/api/auth/sessions',
];

describe('nothing private leaks to another staff member', () => {
  it('no screen, list or search shows s3 the private matters of others', async () => {
    const p = await plantSecrets();
    const leaks: string[] = [];
    for (const url of READS(p, c.ids)) {
      const res = await c.s3.get(url);
      const text = JSON.stringify(res.body);
      const found = [...new Set(text.match(new RegExp(`${SECRET}\\d+b?`, 'g')) ?? [])];
      if (found.length) leaks.push(`${url}: ${found.join(', ')}`);
    }
    expect(leaks).toEqual([]);
    // and the private task itself is not there
    expect((await c.s3.get(`/api/tasks/${p.task}`)).status).toBe(404);
  });

  it('the people allowed still see them', async () => {
    const p = await plantSecrets();
    const s1Cadet = JSON.stringify((await c.s1.get(`/api/cadets/${p.cadet}`)).body); // the team's commander
    expect(s1Cadet).toContain(`${SECRET}3`);
    expect(s1Cadet).toContain(`${SECRET}5`);
    expect(JSON.stringify((await c.s2.get(`/api/evaluations/${p.cadet}`)).body)).toContain(`${SECRET}7`); // their own entry
    expect(JSON.stringify((await c.cmd.get('/api/absences')).body)).toContain(`${SECRET}10`);
    expect(JSON.stringify((await c.s1.get('/api/absences')).body)).toContain(`${SECRET}10`); // their own
    expect(JSON.stringify((await c.cmd.get('/api/documents')).body)).toContain(`${SECRET}2`);
  });

  it('commander-only screens and actions answer 403 to staff', async () => {
    for (const url of ['/api/dashboard', '/api/team', '/api/courses', '/api/admin/snapshots', '/api/admin/backup', '/api/weeks/calendar']) {
      expect((await c.s3.get(url)).status, url).toBe(403);
    }
    expect((await c.s3.patch('/api/settings', { courseName: 'x' })).status).toBe(403);
    expect((await c.s3.post('/api/users', { username: 'evil', password: 'secret123', displayName: 'x', role: 'commander' })).status).toBe(403);
    expect((await c.s3.patch(`/api/users/${c.ids.s3}`, { role: 'commander' })).status).toBe(403);
    expect((await c.s3.post('/api/admin/snapshots', {})).status).toBe(403);
  });
});

describe('nobody changes what is not theirs', () => {
  it('s3 cannot edit, delete or decide on others\' items by their numbers', async () => {
    const p = await plantSecrets();
    const idOf = (sql: string) => db().get<{ id: number }>(sql)!.id;
    const shared = await newTask(c.cmd, { title: 'משימה רגילה של מפק"צ 1', ownerIds: [c.ids.s1] });
    const talk = idOf("SELECT id FROM cadet_records WHERE body LIKE '%ZQX3%'");
    const entry = idOf("SELECT id FROM evaluation_entries WHERE title LIKE '%ZQX7%'");
    const absence = idOf('SELECT id FROM absences LIMIT 1');
    const doc = idOf('SELECT id FROM documents LIMIT 1');
    const exemption = idOf('SELECT id FROM exemptions LIMIT 1');
    const req = idOf('SELECT id FROM requests LIMIT 1');
    const link = idOf('SELECT id FROM attachments LIMIT 1');
    await c.cmd.post('/api/announcements', { title: 'הודעה', body: 'תוכן', requireAck: false });
    const ann = idOf('SELECT id FROM announcements LIMIT 1');
    const attempts: [string, () => Promise<request.Response>][] = [
      ['edit a private task', () => c.s3.patch(`/api/tasks/${p.task}`, { title: 'נפרץ' })],
      ['update a private task', () => c.s3.post(`/api/tasks/${p.task}/updates`, { body: 'נפרץ' })],
      ['delete another\'s task', () => c.s3.del(`/api/tasks/${shared}`)],
      ['edit another\'s task', () => c.s3.patch(`/api/tasks/${shared}`, { title: 'נפרץ' })],
      ['complete another\'s task', () => c.s3.post(`/api/tasks/${shared}/transition`, { action: 'complete' })],
      ['delete a talk', () => c.s3.del(`/api/records/${talk}`)],
      ['edit another\'s evaluation entry', () => c.s3.patch(`/api/evaluations/entries/${entry}`, { title: 'נפרץ' })],
      ['delete another\'s evaluation entry', () => c.s3.del(`/api/evaluations/entries/${entry}`)],
      ['write the commander\'s opinion', () => c.s3.patch(`/api/evaluations/${p.cadet}`, { commanderOpinion: 'נפרץ' })],
      ['delete another\'s absence', () => c.s3.del(`/api/absences/${absence}`)],
      ['mark an absence for another', () => c.s3.post('/api/absences', { userId: c.ids.s1, startDate: '2026-10-10', endDate: '2026-10-11' })],
      ['delete a restricted document', () => c.s3.del(`/api/documents/${doc}`)],
      ['read a restricted document', () => c.s3.get(`/api/documents/${doc}/file`)],
      ['delete an exemption', () => c.s3.del(`/api/exemptions/${exemption}`)],
      ['decide on another\'s request', () => c.s3.post(`/api/requests/${req}/decide`, { approve: true })],
      ['remove a link from a private task', () => c.s3.del(`/api/attachments/${link}`)],
      ['delete an announcement', () => c.s3.del(`/api/announcements/${ann}`)],
      ['move a cadet to another team', () => c.s3.patch(`/api/cadets/${p.cadet}`, { status: 'dismissed' })],
    ];
    const allowed: string[] = [];
    for (const [what, run] of attempts) {
      const res = await run();
      if (res.status < 400) allowed.push(`${what}: ${res.status}`);
    }
    expect(allowed).toEqual([]);
    // and nothing changed
    expect(db().get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', p.task)!.title).toContain('ZQX1');
    expect(db().get('SELECT 1 FROM cadet_records WHERE id = ?', talk)).toBeTruthy();
    expect(db().get<{ status: string }>('SELECT status FROM cadets WHERE id = ?', p.cadet)!.status).toBe('active');
  });
});

describe('guards', () => {
  it('phone notifications go only to the browsers\' push services', async () => {
    const keys = { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' };
    for (const endpoint of ['https://169.254.169.254/latest/meta-data', 'http://fcm.googleapis.com/fcm/send/x', 'https://evil.example.com/push', 'https://fcm.googleapis.com.evil.com/x']) {
      expect((await c.s1.post('/api/push/subscribe', { endpoint, keys })).status, endpoint).toBe(400);
    }
    expect((await c.s1.post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status).toBe(200);
    expect(isPushEndpoint('https://web.push.apple.com/QX')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
  });

  it('an address the server fetches cannot lead into its own network, redirects included', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
    await expect(assertPublicUrl('https://127.0.0.1/cal.ics')).rejects.toThrow();
    await expect(assertPublicUrl('https://[::1]/cal.ics')).rejects.toThrow();
    await expect(assertPublicUrl('http://93.184.216.34/cal.ics')).rejects.toThrow();
    await expect(assertPublicUrl('https://user:pw@93.184.216.34/')).rejects.toThrow();
    await expect(assertPublicUrl('https://93.184.216.34/cal.ics')).resolves.toBeInstanceOf(URL);

    const real = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      if (String(url).includes('/start')) return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } });
      if (String(url).includes('/hop')) return new Response(null, { status: 301, headers: { location: '/final' } });
      return new Response('ok');
    }) as typeof fetch;
    try {
      await expect(safeFetch('https://93.184.216.34/start')).rejects.toThrow('ציבורית');
      expect(asked).toEqual(['https://93.184.216.34/start']); // the internal address was never asked
      expect(await (await safeFetch('https://93.184.216.34/hop')).text()).toBe('ok');
    } finally {
      globalThis.fetch = real;
    }
  });

  it('a new password is not a weak one', async () => {
    const make = (password: string) => c.cmd.post('/api/users', { username: `u${password.length}${Math.random().toString(36).slice(2, 6)}`, password, displayName: 'חדש', role: 'staff' });
    expect((await make('ab12')).body.error).toContain('לפחות 8');
    expect((await make('12345678')).body.error).toContain('אותיות');
    expect((await make('password1')).body.error).toContain('נפוצה');
    expect((await make('Tavor-2026')).status).toBe(200);
    expect((await c.s1.post('/api/auth/password', { current: 'secret123', next: 'abcdefgh' })).body.error).toContain('אותיות');
  });

  it('signing in tells nothing about which names exist, and a name guessed from many addresses is locked', async () => {
    const tryLogin = (username: string, password: string, ip: string) => request(c.app).post('/api/auth/login').set('x-kks', '1').set('X-Forwarded-For', ip).send({ username, password });
    const unknown = await tryLogin('nobody', 'whatever1', '203.0.113.1');
    const wrong = await tryLogin('s1', 'whatever1', '203.0.113.2');
    expect([unknown.status, unknown.body.error]).toEqual([wrong.status, wrong.body.error]);
    for (let i = 0; i < 10; i++) await tryLogin('s2', `guess-${i}x`, `198.51.100.${i + 1}`);
    const locked = await tryLogin('s2', 'secret123', '198.51.100.99'); // the right password, from yet another address
    expect(locked.status).toBe(429);
  });

  it('the sign-in cookie cannot be read by scripts or sent by other sites, and the current password is not guessed', async () => {
    const res = await request(c.app).post('/api/auth/login').set('x-kks', '1').send({ username: 's3', password: 'secret123' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);
    for (let i = 0; i < 5; i++) await c.s3.post('/api/auth/password', { current: `wrong-${i}x`, next: 'Tavor-2026' });
    expect((await c.s3.post('/api/auth/password', { current: 'secret123', next: 'Tavor-2026' })).status).toBe(429);
    // a request from another site, without the app's header, changes nothing
    expect((await request(c.app).post('/api/auth/logout').set('Cookie', cookie.split(';')[0])).status).toBe(403);
  });

  it('a "zip bomb" is refused instead of filling the memory', async () => {
    const bomb = zipDeflated('_chat.txt', deflateRawSync(Buffer.alloc(80 * 1024 * 1024)));
    expect(bomb.length).toBeLessThan(200_000);
    const res = await c.s1.post('/api/alignment/import/file').set('content-type', 'application/zip').send(bomb);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('גדול מדי');
  });

  it('small things: an operation named like a built-in, someone else\'s e-mail, headers', async () => {
    expect((await c.cmd.post('/api/bulk', { entity: 'tasks', action: 'constructor', ids: [1] })).status).toBe(400);
    expect((await c.cmd.post('/api/bulk', { entity: '__proto__', action: 'toString', ids: [1] })).status).toBe(400);
    await c.s1.patch('/api/me/contact', { email: 'Dana@Example.com' });
    expect((await c.s1.get('/api/auth/me')).body.user.email).toBe('dana@example.com');
    expect((await c.s2.patch('/api/me/contact', { email: 'dana@example.com' })).body.error).toContain('כבר משויכת');
    const h = (await c.s1.get('/api/settings')).headers;
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
    expect(h['cache-control']).toBe('no-store');
  });
});

/** a zip with one deflated entry */
function zipDeflated(name: string, data: Buffer): Buffer {
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(80 * 1024 * 1024, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(80 * 1024 * 1024, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = 30 + n.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

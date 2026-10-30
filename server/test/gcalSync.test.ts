// Writing the course's events into Google Calendar (gcalSync.ts), against a Google that lives here: connecting
// by Google's own sign-in, the calendars one may write to, each event written - and changed, moved, deleted
// and brought back - in the calendar chosen for it, the course's calendar in Google, a Google that refuses,
// a permission taken back, and disconnecting. The names and addresses here are made up.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { googleIdOf, setGcalFetch, writtenUids } from '../src/gcalSync';
import { login, setup, type Ctx } from './helpers';

let c: Ctx;

const PRIMARY = 'commander.test@example.com';
const COURSE = 'course-test@group.calendar.google.com';
const READONLY = 'holidays@group.v.calendar.google.com';
/** a staff member's own account, and its one calendar */
const STAFF = 'staff.test@example.com';

/** a Google of our own: tokens, a calendar list, and events by calendar and id */
interface FakeEvent {
  body: Record<string, unknown>;
  status: string;
}
class FakeGoogle {
  events = new Map<string, Map<string, FakeEvent>>();
  calls: { method: string; url: string; body?: string }[] = [];
  refreshFails = false;
  writeFails = 0;
  revoked: string[] = [];
  cal(id: string) {
    if (!this.events.has(id)) this.events.set(id, new Map());
    return this.events.get(id)!;
  }
  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    this.calls.push({ method, url, body });
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      this.revoked.push(new URL(url).searchParams.get('token')!);
      return new Response('', { status: 200 });
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'authorization_code') {
        // the sign-in's code says whose account it is
        const who = p.get('code') === 'staff-code' ? 'staff' : 'cmd';
        const payload = Buffer.from(JSON.stringify({ email: who === 'staff' ? STAFF : PRIMARY })).toString('base64url');
        return Response.json({
          access_token: `ya29.${who}.first`,
          refresh_token: `1//refresh-${who}`,
          expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
          id_token: `e30.${payload}.sig`,
        });
      }
      if (this.refreshFails) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: `ya29.${p.get('refresh_token') === '1//refresh-staff' ? 'staff' : 'cmd'}.again`, expires_in: 3600 });
    }
    const api = 'https://www.googleapis.com/calendar/v3';
    if (!url.startsWith(api)) return new Response('', { status: 404 });
    const path = url.slice(api.length);
    const who = String(new Headers(init?.headers).get('authorization')).split('.')[1];
    if (path.startsWith('/users/me/calendarList')) {
      if (who === 'staff') return Response.json({ items: [{ id: STAFF, summary: STAFF, backgroundColor: '#039be5', accessRole: 'owner', primary: true }] });
      return Response.json({
        items: [
          { id: COURSE, summary: 'לו"ז הקורס', backgroundColor: '#0b8043', accessRole: 'writer' },
          { id: READONLY, summary: 'חגים', backgroundColor: '#ffffff', accessRole: 'reader' },
          { id: PRIMARY, summary: PRIMARY, summaryOverride: 'היומן שלי', backgroundColor: '#9e69af', accessRole: 'owner', primary: true },
        ],
      });
    }
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/?]+))?(\/move)?(?:\?(.*))?$/.exec(path);
    if (!m) return new Response('', { status: 404 });
    const cal = decodeURIComponent(m[1]);
    const id = m[2];
    // each account sees only its own calendars (as Google: not found)
    if ((cal === STAFF) !== (who === 'staff')) return Response.json({ error: { code: 404 } }, { status: 404 });
    if (this.writeFails > 0 && method !== 'GET') {
      this.writeFails--;
      return Response.json({ error: { message: 'Backend Error' } }, { status: 503 });
    }
    if (m[3]) {
      const to = new URLSearchParams(m[4]).get('destination')!;
      if ((to === STAFF) !== (who === 'staff')) return Response.json({ error: { code: 404 } }, { status: 404 });
      const ev = this.cal(cal).get(id!);
      if (!ev) return Response.json({ error: { code: 404 } }, { status: 404 });
      this.cal(cal).delete(id!);
      this.cal(to).set(id!, ev);
      return Response.json({ id, ...ev.body });
    }
    if (method === 'POST') {
      const b = JSON.parse(body!) as Record<string, unknown>;
      const newId = String(b.id);
      if (this.cal(cal).has(newId)) return Response.json({ error: { code: 409 } }, { status: 409 });
      this.cal(cal).set(newId, { body: b, status: String(b.status ?? 'confirmed') });
      return Response.json({ ...b, id: newId, iCalUID: `${newId}@google.com` });
    }
    const ev = this.cal(cal).get(id!);
    if (!ev) return Response.json({ error: { code: 404 } }, { status: 404 });
    if (method === 'PATCH') {
      const b = JSON.parse(body!) as Record<string, unknown>;
      ev.body = { ...ev.body, ...b };
      ev.status = String(b.status ?? ev.status);
      return Response.json({ ...ev.body, id, iCalUID: `${id}@google.com` });
    }
    if (method === 'DELETE') {
      if (ev.status === 'cancelled') return new Response('', { status: 410 });
      ev.status = 'cancelled';
      return new Response(null, { status: 204 });
    }
    return Response.json({ ...ev.body, id });
  };
  /** the events still there in a calendar */
  live(cal: string) {
    return [...this.cal(cal).entries()].filter(([, e]) => e.status !== 'cancelled');
  }
}

let g: FakeGoogle;

beforeEach(async () => {
  c = await setup();
  g = new FakeGoogle();
  setGcalFetch(g.fetch);
});

afterEach(() => {
  setGcalFetch(null);
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

const turnOn = () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret-for-sealing';
};

/** the commander connects their account, as Google's sign-in brings them back */
async function connect(agent = c.cmd, back = '/', code = 'one-time-code') {
  const start = (await agent.post('/api/google/calendar/connect', { back })).body.url as string;
  const state = new URL(start).searchParams.get('state')!;
  return agent.get(`/api/google/drive/callback?state=${state}&code=${code}`);
}

const event = (over: Record<string, unknown> = {}) => ({ date: '2026-10-05', startTime: '09:00', endTime: '10:30', title: 'שיעור ניווט', location: 'כיתה 2', ...over });

describe('connecting', () => {
  it('is offered once the server has a Google client', async () => {
    expect((await c.cmd.get('/api/google/calendar')).body).toMatchObject({ available: false, connected: false });
    expect((await c.cmd.post('/api/google/calendar/connect', {})).status).toBe(503);
  });

  it("goes by Google's sign-in - the same return address as Drive, a lasting permission - and keeps the token sealed", async () => {
    turnOn();
    const start = (await c.cmd.post('/api/google/calendar/connect', { back: '/?view=week' })).body.url as string;
    const u = new URL(start);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('redirect_uri')).toMatch(/\/api\/google\/drive\/callback$/);
    expect(u.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(u.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const state = u.searchParams.get('state')!;
    // someone else coming back with it: refused, and it is used up
    const other = await (await login(c.app, 's2')).get(`/api/google/drive/callback?state=${state}&code=x`);
    expect(other.headers.location).toBe('/?view=week&gcal=denied');
    // the one who asked
    const done = await connect(c.cmd, '/?view=week');
    expect(done.status).toBe(303);
    expect(done.headers.location).toBe('/?view=week&gcal=connected');
    const row = db().get<{ refresh_token: string; email: string }>('SELECT refresh_token, email FROM google_calendar_links')!;
    expect(row.email).toBe(PRIMARY);
    expect(row.refresh_token).not.toContain('refresh-cmd');
    expect(row.refresh_token.startsWith('v1.')).toBe(true);
    // the calendars one may write to, one's own first; a calendar one can only read is not among them
    const status = (await c.cmd.get('/api/google/calendar')).body;
    expect(status).toMatchObject({ available: true, connected: true, email: PRIMARY });
    expect(status.calendars.map((x: { summary: string }) => x.summary)).toEqual(['היומן שלי', 'לו"ז הקורס']);
    // a page of another site is not where one returns
    const odd = (await c.cmd.post('/api/google/calendar/connect', { back: '//evil.example' })).body.url as string;
    const back = await c.cmd.get(`/api/google/drive/callback?state=${new URL(odd).searchParams.get('state')}&error=access_denied`);
    expect(back.headers.location).toBe('/?gcal=cancelled');
  });
});

describe('an event in a Google calendar of its own', () => {
  it('is written there with its fixed id, and kept in step: changed, moved, deleted, brought back', async () => {
    turnOn();
    await connect();
    const made = (await c.cmd.post('/api/events', { ...event(), googleCalendarId: COURSE })).body;
    const id = made.event.id as number;
    const gid = googleIdOf(id);
    expect(gid).toMatch(/^[0-9a-v]{5,}$/);
    expect(made.google).toMatchObject({ calendarId: COURSE, calendarName: 'לו"ז הקורס', state: 'synced', src: 'event' });
    const inGoogle = g.cal(COURSE).get(gid)!;
    expect(inGoogle.body).toMatchObject({
      summary: 'שיעור ניווט',
      location: 'כיתה 2',
      start: { dateTime: '2026-10-05T06:00:00.000Z', timeZone: 'Asia/Jerusalem' },
      end: { dateTime: '2026-10-05T07:30:00.000Z', timeZone: 'Asia/Jerusalem' },
      extendedProperties: { private: { kksEvent: String(id) } },
    });
    // changed in the app: the same event in Google
    await c.cmd.patch(`/api/events/${id}`, { title: 'שיעור ניווט מתקדם', startTime: '11:00', endTime: '12:00' });
    expect(g.live(COURSE)).toHaveLength(1);
    expect(g.cal(COURSE).get(gid)!.body).toMatchObject({ summary: 'שיעור ניווט מתקדם', start: { dateTime: '2026-10-05T08:00:00.000Z' } });
    // to another calendar: moved, not copied
    const moved = (await c.cmd.patch(`/api/events/${id}`, { googleCalendarId: PRIMARY })).body;
    expect(moved.google).toMatchObject({ calendarId: PRIMARY, state: 'synced' });
    expect(g.live(COURSE)).toHaveLength(0);
    expect(g.live(PRIMARY).map(([k]) => k)).toEqual([gid]);
    expect(g.calls.some((x) => x.url.includes('/move?destination='))).toBe(true);
    // cancelled in the app: said in Google
    expect((await c.cmd.post(`/api/events/${id}/cancel`, { taskAction: 'keep' })).status).toBe(200);
    expect(String(g.cal(PRIMARY).get(gid)!.body.summary)).toContain('(בוטל)');
    await c.cmd.post(`/api/events/${id}/restore`);
    // to the trash: gone from Google; back from it: there again, the same event
    await c.cmd.del(`/api/events/${id}`);
    expect(g.live(PRIMARY)).toHaveLength(0);
    await c.cmd.post(`/api/events/${id}/untrash`);
    expect(g.live(PRIMARY).map(([k]) => k)).toEqual([gid]);
    expect(g.cal(PRIMARY).get(gid)!.body.summary).toBe('שיעור ניווט מתקדם');
    // taken out of Google by choice: gone there, the event stays in the app
    const out = (await c.cmd.patch(`/api/events/${id}`, { googleCalendarId: null })).body;
    expect(out.google).toBeNull();
    expect(g.live(PRIMARY)).toHaveLength(0);
    expect((await c.cmd.get(`/api/events/${id}`)).body.event.title).toBe('שיעור ניווט מתקדם');
  });

  it('is never written twice: the same id is found again', async () => {
    turnOn();
    await connect();
    const id = (await c.cmd.post('/api/events', { ...event(), googleCalendarId: COURSE })).body.event.id as number;
    // as if the database lost what it wrote (a request run again): writing again finds the same event
    db().run('UPDATE google_event_links SET pushed_calendar = NULL, pushed_hash = NULL, state = ? WHERE event_id = ?', 'pending', id);
    await c.cmd.post('/api/google/calendar/sync');
    expect(g.live(COURSE)).toHaveLength(1);
  });

  it('only into a calendar one may write to, and only with one\'s own account', async () => {
    turnOn();
    await connect();
    expect((await c.cmd.post('/api/events', { ...event(), googleCalendarId: READONLY })).status).toBe(400);
    // the staff member did not connect an account: their own Google calendars are not theirs to choose here
    expect((await c.s1.post('/api/events', { ...event({ calendar: 'personal' }), googleCalendarId: COURSE })).status).toBe(400);
  });
});

describe("the course's calendar in Google", () => {
  it("takes every event of the course's calendar from today on - whoever adds it - and none of one's own", async () => {
    turnOn();
    await connect();
    const past = (await c.cmd.post('/api/events', event({ date: '2026-09-20', title: 'עבר' }))).body.event.id as number;
    const soon = (await c.cmd.post('/api/events', event({ date: '2026-10-03', title: 'בקרוב' }))).body.event.id as number;
    // only the commander chooses it
    expect((await c.s1.put('/api/google/calendar/course', { calendarId: COURSE })).status).toBe(403);
    expect((await c.s1.get('/api/google/calendar')).body.canSetCourse).toBe(false);
    const status = (await c.cmd.put('/api/google/calendar/course', { calendarId: COURSE })).body;
    expect(status.course).toMatchObject({ calendarId: COURSE, name: 'לו"ז הקורס', mine: true });
    expect(g.cal(COURSE).has(googleIdOf(soon))).toBe(true);
    expect(g.cal(COURSE).has(googleIdOf(past))).toBe(false);
    // a staff member's event in the course's calendar: written with the commander's account
    const theirs = (await c.s1.post('/api/events', event({ date: '2026-10-08', title: 'של מפק"צ', ownerId: c.ids.s1 }))).body;
    expect(theirs.google).toMatchObject({ calendarId: COURSE, state: 'synced', src: 'course' });
    // one's own calendar: not the course's
    const mine = (await c.s1.post('/api/events', event({ date: '2026-10-08', title: 'פרטי', calendar: 'personal' }))).body;
    expect(mine.google).toBeNull();
    expect(g.live(COURSE).map(([, e]) => e.body.summary).sort()).toEqual(['בקרוב', 'של מפק"צ']);
    // moved to one's own calendar: out of the course's in Google
    await c.cmd.patch(`/api/events/${soon}`, { calendar: 'personal' });
    expect(g.live(COURSE).map(([, e]) => e.body.summary)).toEqual(['של מפק"צ']);
    // what this app wrote shows once in a calendar connected by its address - for whoever sees it here
    expect(writtenUids(c.ids.s2).has(`${googleIdOf(theirs.event.id)}@google.com`)).toBe(true);
    const own = (await c.cmd.post('/api/events', { ...event({ title: 'שלי', calendar: 'personal' }), googleCalendarId: COURSE })).body.event.id as number;
    expect(writtenUids(c.ids.cmd).has(`${googleIdOf(own)}@google.com`)).toBe(true);
    expect(writtenUids(c.ids.s2).has(`${googleIdOf(own)}@google.com`)).toBe(false);
  });

  it("an event that goes from the commander's account to a staff member's: out of the one, into the other, and back", async () => {
    turnOn();
    await connect();
    await c.cmd.put('/api/google/calendar/course', { calendarId: COURSE });
    expect((await connect(c.s1, '/', 'staff-code')).headers.location).toContain('gcal=connected');
    const made = (await c.s1.post('/api/events', event({ date: '2026-10-08', title: 'של מפק"צ', ownerId: c.ids.s1 }))).body;
    const id = made.event.id as number;
    const gid = googleIdOf(id);
    expect(made.google).toMatchObject({ calendarId: COURSE, state: 'synced', src: 'course' });
    // into the staff member's own Google calendar: written there with their account, taken out of the course's with the commander's
    const theirs = (await c.s1.patch(`/api/events/${id}`, { googleCalendarId: STAFF })).body;
    expect(theirs.google).toMatchObject({ calendarId: STAFF, state: 'synced', src: 'event' });
    expect(g.live(COURSE)).toHaveLength(0);
    expect(g.live(STAFF).map(([k]) => k)).toEqual([gid]);
    // back to the course's calendar: the same event there again, and none left in theirs
    const back = (await c.s1.patch(`/api/events/${id}`, { googleCalendarId: COURSE })).body;
    expect(back.google).toMatchObject({ calendarId: COURSE, state: 'synced', src: 'course' });
    expect(g.live(STAFF)).toHaveLength(0);
    expect(g.live(COURSE).map(([k]) => k)).toEqual([gid]);
    // to the trash: taken out by the account that wrote it
    await c.s1.del(`/api/events/${id}`);
    expect(g.live(COURSE)).toHaveLength(0);
  });

  it('a series goes with all its days', async () => {
    turnOn();
    await connect();
    const s = (await c.cmd.post('/api/events', { ...event({ title: 'מסדר בוקר', recurrence: 'RRULE:FREQ=DAILY;COUNT=3' }), googleCalendarId: PRIMARY })).body;
    expect(s.google).toMatchObject({ calendarId: PRIMARY, src: 'series' });
    await c.cmd.post('/api/google/calendar/sync');
    expect(g.live(PRIMARY).map(([, e]) => e.body.summary)).toEqual(['מסדר בוקר', 'מסדר בוקר', 'מסדר בוקר']);
  });
});

describe('when Google cannot', () => {
  it('a refusal waits and is tried again; the event is saved in the app all the same', async () => {
    turnOn();
    await connect();
    g.writeFails = 5;
    const made = (await c.cmd.post('/api/events', { ...event(), googleCalendarId: COURSE })).body;
    expect(made.event.title).toBe('שיעור ניווט');
    expect(made.google).toMatchObject({ state: 'error', error: 'Google לא ענה - ננסה שוב' });
    expect((await c.cmd.get('/api/google/calendar')).body.failed).toBe(1);
    // its turn comes again
    db().run('UPDATE google_event_links SET next_try = ?', '2000-01-01T00:00:00.000Z');
    g.writeFails = 0;
    const again = (await c.cmd.post('/api/google/calendar/sync')).body;
    expect(again.done).toBe(1);
    expect((await c.cmd.get(`/api/events/${made.event.id}`)).body.google.state).toBe('synced');
  });

  it('a permission taken back in Google: its events wait for the account, and go out once it connects again', async () => {
    turnOn();
    await connect();
    db().run('DELETE FROM meta WHERE key = ?', 'unused');
    g.refreshFails = true;
    // the token at hand ran out
    setGcalFetch(g.fetch);
    const made = (await c.cmd.post('/api/events', { ...event(), googleCalendarId: COURSE })).status;
    expect(made).toBe(400);
    const status = (await c.cmd.get('/api/google/calendar')).body;
    expect(status).toMatchObject({ connected: false, reconnect: true });
    g.refreshFails = false;
    await connect();
    expect((await c.cmd.post('/api/events', { ...event(), googleCalendarId: COURSE })).body.google.state).toBe('synced');
  });

  it('disconnecting gives the permission back and keeps nothing; what was written stays in Google', async () => {
    turnOn();
    await connect();
    const id = (await c.cmd.post('/api/events', { ...event(), googleCalendarId: COURSE })).body.event.id as number;
    const status = (await c.cmd.del('/api/google/calendar')).body;
    expect(status.connected).toBe(false);
    expect(g.revoked).toEqual(['1//refresh-cmd']);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM google_calendar_links')!.n).toBe(0);
    expect(g.live(COURSE)).toHaveLength(1);
    // a change now waits for an account
    await c.cmd.patch(`/api/events/${id}`, { title: 'אחר' });
    expect((await c.cmd.get(`/api/events/${id}`)).body.google).toMatchObject({ state: 'off' });
  });
});

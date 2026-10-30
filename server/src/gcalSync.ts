// Writing the course's events into Google Calendar. Someone on the staff connects their Google account once
// (Google's own sign-in, the same client and the same return address as saving to Drive); from then on an
// event they put in one of their Google calendars - or every event of the course's calendar, once the
// commander chose the Google calendar it goes to - is written there, and changed, moved, cancelled,
// deleted and brought back there with it.
//
// - The access: "calendar.events" (the events of one's calendars) and "calendar.calendarlist.readonly" (the
//   list to choose from). What Google gives back to keep it - its refresh token - is kept sealed (AES-GCM,
//   with a key drawn from the server's GOOGLE_CLIENT_SECRET): a copy of the database alone opens nothing.
//   Disconnecting gives it back to Google and forgets it.
// - Each event has a fixed id in Google (the database's own key and the event's number), so writing it again -
//   a save tried twice, a request run again - finds the same event and never makes a second one.
// - The app's event stays what the app shows; its copy in Google is written from it. A calendar connected to
//   the schedule by its address shows Google's side of the same events: those written from here are left
//   out of it, so each shows once.

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { CAL_COLORS, type CalColor } from '../../shared/calendarLayers';
import { addDays, localDateKey, zonedIso, zonedToUtc } from '../../shared/dates';
import type { EventGoogle, GoogleCalendarChoice, GoogleCalendarStatus } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, HttpError, nowIso, tz } from './core';
import { db } from './db';
import { driveAvailable, driveRedirectUri } from './googleDrive';
import { EVENT_COLOR_ID } from './gcalApi';
import { canManageEvent } from './schedule';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';
const WAIT_MS = 10 * 60_000;
const LIST_FOR_MS = 5 * 60_000;

/** the same Google client as Drive's: its id and secret on the server */
export const gcalAvailable = (): boolean => driveAvailable();

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let http: Fetch = (url, init) => fetch(url, init);
/** the tests stand in for Google */
export function setGcalFetch(f: Fetch | null): void {
  http = f ?? ((url, init) => fetch(url, init));
  tokens.clear();
  lists.clear();
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------------- the token, sealed ----------------

function sealKey(): Buffer {
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  if (!secret) throw new HttpError(503, 'החיבור ל-Google עוד לא הוגדר בשרת');
  return Buffer.from(hkdfSync('sha256', secret, 'kks-google-calendar', 'refresh-token', 32));
}

export function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** null when it cannot be opened (another secret, or touched) */
export function unseal(sealed: string): string | null {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------- connecting ----------------

interface LinkRow {
  user_id: number;
  email: string;
  refresh_token: string;
  scope: string;
  state: 'ok' | 'revoked';
}

const linkOf = (userId: number) => db().get<LinkRow>('SELECT * FROM google_calendar_links WHERE user_id = ?', userId);

/** where one returns to after Google's sign-in: a page of this site, nothing else */
const safeBack = (back: string | undefined) => (back && /^\/(?!\/)[^\s\\]*$/.test(back) ? back.slice(0, 300) : '/');

/** the address of Google's sign-in for connecting; what comes back is matched to this person */
export function connectUrl(actor: UserRow, origin: string, back?: string): string {
  if (!gcalAvailable()) throw new HttpError(503, 'החיבור ל-Google Calendar עוד לא הוגדר בשרת (GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET).');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  db().run('DELETE FROM google_calendar_requests WHERE expires_at < ?', nowIso());
  db().run(
    'INSERT INTO google_calendar_requests(state_hash, user_id, verifier, back, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha(state),
    actor.id,
    verifier,
    safeBack(back),
    new Date(clock.now().getTime() + WAIT_MS).toISOString(),
  );
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: driveRedirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    // a token that lasts, so later changes reach Google too; asked again each time so Google gives it
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (actor.email) q.set('login_hint', actor.email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface CalendarRequest {
  userId: number;
  verifier: string;
  back: string;
}

/** whether a return from Google's sign-in is one this server is waiting for (connecting, or saving to Drive) */
export function signInWaiting(state: string): boolean {
  if (!state) return false;
  const h = sha(state);
  return !!(db().get('SELECT 1 FROM google_calendar_requests WHERE state_hash = ?', h) || db().get('SELECT 1 FROM google_drive_requests WHERE state_hash = ?', h));
}

/** the connecting this answer from Google belongs to - once, while it is fresh */
export function takeCalendarRequest(state: string): CalendarRequest | null {
  if (!state) return null;
  const r = db().get<{ user_id: number; verifier: string; back: string; expires_at: string }>('SELECT * FROM google_calendar_requests WHERE state_hash = ?', sha(state));
  if (!r) return null;
  db().run('DELETE FROM google_calendar_requests WHERE state_hash = ?', sha(state));
  if (r.expires_at < nowIso()) return null;
  return { userId: r.user_id, verifier: r.verifier, back: r.back };
}

/** Google's answer, or what went wrong in Google's own words (an error code, never a token) */
async function ok(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
  throw new GoogleError(`${what}: ${res.status} ${body}`, res.status);
}

/** Google's "not now" (busy, or asked to slow down): tried again later, never taken as "not allowed" */
async function busy(res: Response, what: string): Promise<GoogleError | null> {
  if (res.ok) return null;
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
  if (res.status >= 500 || res.status === 429 || (res.status === 403 && /rateLimit|quota/i.test(body))) return new GoogleError(`${what}: ${res.status} ${body}`, res.status);
  return null;
}

class GoogleError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** which part of the setup a failure points at, for the person connecting and for the log */
export type ConnectFailure = 'client' | 'api' | 'redirect' | 'scope' | 'failed';
export function connectFailure(message: string): ConnectFailure {
  if (/redirect_uri_mismatch/.test(message)) return 'redirect';
  if (/invalid_client|unauthorized_client/.test(message)) return 'client';
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(message)) return 'api';
  if (/^scope/.test(message)) return 'scope';
  return 'failed';
}

/** the e-mail in Google's sign-in token (straight from Google, over its own connection) */
function emailOf(idToken: string | undefined): string {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string };
    return (payload.email ?? '').slice(0, 200);
  } catch {
    return '';
  }
}

/** the one-time code for a lasting token, kept sealed; the person's waiting events go on again */
export async function finishConnect(userId: number, code: string, verifier: string, origin: string): Promise<void> {
  const res = await ok(
    await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: driveRedirectUri(origin),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
    }),
    'token',
  );
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
  // the permission to write events left unticked on Google's page: nothing kept
  if (!(body.scope ?? '').split(' ').includes(EVENTS_SCOPE)) {
    if (body.access_token) revoke(body.access_token);
    throw new GoogleError('scope: calendar.events not granted');
  }
  if (!body.refresh_token) throw new GoogleError('token: no refresh token');
  const at = nowIso();
  db().run(
    `INSERT INTO google_calendar_links(user_id, email, refresh_token, scope, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'ok', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, scope = excluded.scope, state = 'ok', updated_at = excluded.updated_at`,
    userId,
    emailOf(body.id_token),
    seal(body.refresh_token),
    body.scope ?? '',
    at,
    at,
  );
  if (body.access_token) tokens.set(userId, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000 });
  lists.delete(userId);
  // what waited for this person's account goes on
  db().run("UPDATE google_event_links SET state = 'pending', error = NULL, tries = 0, next_try = NULL WHERE (owner_id = ? OR pushed_owner = ?) AND state IN ('off', 'error')", userId, userId);
}

function revoke(token: string): void {
  void http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

/** the account let go: Google's permission given back, nothing kept; events written stay in Google */
export function disconnect(userId: number): void {
  const link = linkOf(userId);
  if (!link) return;
  const token = unseal(link.refresh_token);
  if (token) revoke(token);
  db().run('DELETE FROM google_calendar_links WHERE user_id = ?', userId);
  db().run("UPDATE google_event_links SET state = 'off', error = 'החשבון נותק מ-Google' WHERE owner_id = ?", userId);
  tokens.delete(userId);
  lists.delete(userId);
}

// ---------------- the access token ----------------

const tokens = new Map<number, { token: string; until: number }>();

async function accessToken(userId: number): Promise<string> {
  const hit = tokens.get(userId);
  if (hit && hit.until > Date.now()) return hit.token;
  const link = linkOf(userId);
  if (!link || link.state !== 'ok') throw new OffError(link ? 'צריך להתחבר שוב ל-Google' : 'החשבון לא מחובר ל-Google');
  const refresh = unseal(link.refresh_token);
  if (!refresh) throw new OffError('צריך להתחבר שוב ל-Google');
  const res = await http('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // taken back in Google's account settings, or expired: the person connects again
    if (/invalid_grant/.test(text)) {
      db().run("UPDATE google_calendar_links SET state = 'revoked', updated_at = ? WHERE user_id = ?", nowIso(), userId);
      throw new OffError('ההרשאה ל-Google בוטלה - צריך להתחבר שוב');
    }
    throw new GoogleError(`refresh: ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 300)}`, res.status);
  }
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  tokens.set(userId, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000 });
  return body.access_token;
}

/** the account cannot write now (not connected, or its permission taken back) - waits for it, not retried */
class OffError extends Error {}

/** a call to the Calendar API as one person; the token renewed once when Google says it went stale */
async function call(userId: number, method: string, path: string, body?: unknown): Promise<Response> {
  const go = async () =>
    http(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken(userId)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await go();
  if (res.status === 401) {
    tokens.delete(userId);
    res = await go();
  }
  return res;
}

// ---------------- the calendars one can write to ----------------

const lists = new Map<number, { at: number; list: GoogleCalendarChoice[] }>();

export async function writableCalendars(userId: number, fresh = false): Promise<GoogleCalendarChoice[]> {
  const hit = lists.get(userId);
  if (!fresh && hit && Date.now() - hit.at < LIST_FOR_MS) return hit.list;
  const res = await ok(await call(userId, 'GET', '/users/me/calendarList?minAccessRole=writer&maxResults=250'), 'calendarList');
  const items = ((await res.json()) as { items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; accessRole?: string }[] }).items ?? [];
  const list = items
    .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
    .map((c) => ({ id: c.id, summary: (c.summaryOverride || c.summary || c.id).slice(0, 120), color: /^#[0-9a-f]{6}$/i.test(c.backgroundColor ?? '') ? c.backgroundColor! : '#4285f4', primary: !!c.primary }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary, 'he'));
  lists.set(userId, { at: Date.now(), list });
  return list;
}

// ---------------- the course's calendar in Google ----------------

interface CourseTarget {
  calendarId: string;
  ownerId: number;
  name: string;
  color: string;
  /** events from this day on go to it (not the course's past) */
  since: string;
}

const COURSE_KEY = 'google_course_calendar';

export function courseTarget(): CourseTarget | null {
  const raw = db().get<{ value: string }>('SELECT value FROM meta WHERE key = ?', COURSE_KEY)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as CourseTarget;
    return v && typeof v.calendarId === 'string' && Number.isInteger(v.ownerId) ? v : null;
  } catch {
    return null;
  }
}

/** the commander's choice: every event of the course's calendar, from today on, also in this Google calendar */
export async function setCourseTarget(actor: UserRow, calendarId: string | null): Promise<void> {
  // every event of the course goes through one account: the commander's choice
  if (actor.role !== 'commander') throw forbidden();
  if (!calendarId) {
    db().run('DELETE FROM meta WHERE key = ?', COURSE_KEY);
    // what was written stays in Google as it is; it is no longer kept in step
    db().run("DELETE FROM google_event_links WHERE src = 'course'");
    return;
  }
  let list: GoogleCalendarChoice[];
  try {
    list = await writableCalendars(actor.id, true);
  } catch (e) {
    if (e instanceof OffError) throw badRequest(`${e.message} - קודם מתחברים, ואז בוחרים יומן`);
    throw new HttpError(502, 'Google לא ענה - נסו שוב בעוד רגע');
  }
  const cal = list.find((c) => c.id === calendarId);
  if (!cal) throw badRequest('אין לך הרשאה לכתוב ביומן הזה ב-Google');
  const value: CourseTarget = { calendarId, ownerId: actor.id, name: cal.summary, color: cal.color, since: localDateKey(clock.now(), tz()) };
  db().run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', COURSE_KEY, JSON.stringify(value));
}

// ---------------- an event's calendar in Google ----------------

interface EventLinkRow {
  event_id: number;
  calendar_id: string;
  calendar_name: string;
  owner_id: number | null;
  src: 'event' | 'series' | 'course';
  pushed_calendar: string | null;
  /** the account that wrote the copy in Google */
  pushed_owner: number | null;
  pushed_hash: string | null;
  ical_uid: string | null;
  state: 'pending' | 'synced' | 'error' | 'off';
  error: string | null;
  tries: number;
  next_try: string | null;
}

/**
 * Where an event goes in Google, chosen with it: undefined - unchanged; null or '' - nowhere (not even the
 * course's); a calendar's id - that calendar of one's own Google account (the course's calendar in Google:
 * as the course's events go). A day of a series takes the whole series with it.
 */
export async function setEventTarget(actor: UserRow, eventId: number, value: string | null | undefined): Promise<void> {
  if (value === undefined) return;
  const ev = db().get<{ id: number; date: string; owner_id: number | null; created_by: number | null; calendar: 'course' | 'personal'; recurrence_id: number | null; guests_can_modify: number }>(
    'SELECT id, date, owner_id, created_by, calendar, recurrence_id, guests_can_modify FROM events WHERE id = ?',
    eventId,
  );
  if (!ev) return;
  if (!canManageEvent(actor, ev)) throw forbidden();
  const course = courseTarget();
  let target: { calendarId: string; name: string; ownerId: number | null } | 'inherit';
  if (!value) target = { calendarId: '', name: '', ownerId: null };
  else if (course && value === course.calendarId && ev.calendar === 'course') target = 'inherit';
  else {
    if (!gcalAvailable()) throw new HttpError(503, 'החיבור ל-Google Calendar עוד לא הוגדר בשרת');
    let list: GoogleCalendarChoice[];
    try {
      list = await writableCalendars(actor.id);
    } catch (e) {
      if (e instanceof OffError) throw badRequest(e.message);
      throw new HttpError(502, 'Google לא ענה - נסו שוב בעוד רגע');
    }
    const cal = list.find((c) => c.id === value);
    if (!cal) throw badRequest('אין לך הרשאה לכתוב ביומן הזה ב-Google');
    target = { calendarId: cal.id, name: cal.summary, ownerId: actor.id };
  }
  const rows = ev.recurrence_id ? db().all<{ id: number }>('SELECT id FROM events WHERE recurrence_id = ?', ev.recurrence_id).map((r) => r.id) : [ev.id];
  db().tx(() => {
    if (ev.recurrence_id) {
      if (target === 'inherit') db().run('DELETE FROM google_series_targets WHERE recurrence_id = ?', ev.recurrence_id);
      else
        db().run(
          'INSERT INTO google_series_targets(recurrence_id, calendar_id, calendar_name, owner_id) VALUES (?, ?, ?, ?) ON CONFLICT(recurrence_id) DO UPDATE SET calendar_id = excluded.calendar_id, calendar_name = excluded.calendar_name, owner_id = excluded.owner_id',
          ev.recurrence_id,
          target.calendarId,
          target.name,
          target.ownerId,
        );
    }
    for (const id of rows) {
      if (target === 'inherit') {
        // back to the course's: what it inherits is set again on the next pass (its copy in Google kept)
        db().run("UPDATE google_event_links SET src = 'course' WHERE event_id = ?", id);
        continue;
      }
      db().run(
        `INSERT INTO google_event_links(event_id, calendar_id, calendar_name, owner_id, src, state) VALUES (?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(event_id) DO UPDATE SET calendar_id = excluded.calendar_id, calendar_name = excluded.calendar_name, owner_id = COALESCE(excluded.owner_id, google_event_links.owner_id), src = excluded.src, state = 'pending', error = NULL, tries = 0, next_try = NULL`,
        id,
        target.calendarId,
        target.name,
        target.ownerId,
        ev.recurrence_id ? 'series' : 'event',
      );
    }
  });
}

/** what an event shows about its copy in Google (read only: what it inherits is written on the next pass) */
export function eventGoogle(eventId: number): EventGoogle | null {
  const l = db().get<EventLinkRow>('SELECT * FROM google_event_links WHERE event_id = ?', eventId);
  if (l) return l.calendar_id ? { calendarId: l.calendar_id, calendarName: l.calendar_name, state: l.state, error: l.error, src: l.src } : null;
  const e = db().get<{ calendar: string; date: string; recurrence_id: number | null; deleted_at: string | null }>('SELECT calendar, date, recurrence_id, deleted_at FROM events WHERE id = ?', eventId);
  if (!e || e.deleted_at) return null;
  if (e.recurrence_id) {
    const t = db().get<{ calendar_id: string; calendar_name: string }>('SELECT calendar_id, calendar_name FROM google_series_targets WHERE recurrence_id = ?', e.recurrence_id);
    if (t) return t.calendar_id ? { calendarId: t.calendar_id, calendarName: t.calendar_name, state: 'pending', error: null, src: 'series' } : null;
  }
  const course = courseTarget();
  if (course && e.calendar === 'course' && e.date >= course.since) return { calendarId: course.calendarId, calendarName: course.name, state: 'pending', error: null, src: 'course' };
  return null;
}

/** the same for many events at once (the calendar's list) - only those with a copy in Google */
export function googleOfMany(ids: number[]): Map<number, EventGoogle> {
  const out = new Map<number, EventGoogle>();
  if (!ids.length) return out;
  const course = courseTarget();
  const anySeries = !!db().get('SELECT 1 FROM google_series_targets LIMIT 1');
  if (!course && !anySeries && !db().get('SELECT 1 FROM google_event_links LIMIT 1')) return out;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const marks = chunk.map(() => '?').join(',');
    const linked = new Set<number>();
    for (const l of db().all<EventLinkRow>(`SELECT * FROM google_event_links WHERE event_id IN (${marks})`, ...chunk)) {
      linked.add(l.event_id);
      if (l.calendar_id) out.set(l.event_id, { calendarId: l.calendar_id, calendarName: l.calendar_name, state: l.state, error: l.error, src: l.src });
    }
    if (!course && !anySeries) continue;
    const rest = chunk.filter((id) => !linked.has(id));
    if (!rest.length) continue;
    const rows = db().all<{ id: number; calendar: string; date: string; recurrence_id: number | null; s_cal: string | null; s_name: string | null }>(
      `SELECT e.id, e.calendar, e.date, e.recurrence_id, t.calendar_id AS s_cal, t.calendar_name AS s_name FROM events e LEFT JOIN google_series_targets t ON t.recurrence_id = e.recurrence_id
       WHERE e.id IN (${rest.map(() => '?').join(',')}) AND e.deleted_at IS NULL`,
      ...rest,
    );
    for (const e of rows) {
      if (e.s_cal !== null) {
        if (e.s_cal) out.set(e.id, { calendarId: e.s_cal, calendarName: e.s_name ?? '', state: 'pending', error: null, src: 'series' });
      } else if (course && e.calendar === 'course' && e.date >= course.since) out.set(e.id, { calendarId: course.calendarId, calendarName: course.name, state: 'pending', error: null, src: 'course' });
    }
  }
  return out;
}

// ---------------- the inherited ----------------

/**
 * The course's events take the course's Google calendar, and the days of a series their series' - written
 * as links, so each is kept in step from then on; an event that left the course's calendar leaves it.
 */
function inherit(): void {
  const course = courseTarget();
  db().run(
    `INSERT INTO google_event_links(event_id, calendar_id, calendar_name, owner_id, src, state)
     SELECT e.id, t.calendar_id, t.calendar_name, t.owner_id, 'series', 'pending' FROM events e JOIN google_series_targets t ON t.recurrence_id = e.recurrence_id
     WHERE NOT EXISTS (SELECT 1 FROM google_event_links l WHERE l.event_id = e.id)`,
  );
  if (course) {
    db().run(
      `INSERT INTO google_event_links(event_id, calendar_id, calendar_name, owner_id, src, state)
       SELECT e.id, ?, ?, ?, 'course', 'pending' FROM events e
       WHERE e.calendar = 'course' AND e.deleted_at IS NULL AND e.date >= ?
         AND NOT EXISTS (SELECT 1 FROM google_event_links l WHERE l.event_id = e.id)
         AND (e.recurrence_id IS NULL OR NOT EXISTS (SELECT 1 FROM google_series_targets t WHERE t.recurrence_id = e.recurrence_id))`,
      course.calendarId,
      course.name,
      course.ownerId,
      course.since,
    );
    db().run(
      "UPDATE google_event_links SET calendar_id = ?, calendar_name = ?, owner_id = ? WHERE src = 'course' AND event_id IN (SELECT id FROM events WHERE calendar = 'course') AND (calendar_id <> ? OR calendar_name <> ? OR owner_id IS NOT ?)",
      course.calendarId,
      course.name,
      course.ownerId,
      course.calendarId,
      course.name,
      course.ownerId,
    );
  }
  // gone to one's own calendar: out of the course's Google calendar
  db().run("UPDATE google_event_links SET calendar_id = '' WHERE src = 'course' AND calendar_id <> '' AND event_id IN (SELECT id FROM events WHERE calendar <> 'course')");
}

// ---------------- the event, as Google keeps it ----------------

const B32 = '0123456789abcdefghijklmnopqrstuv';

/** the database's own key for its events' ids in Google (made once) */
function eventKey(): string {
  const have = db().get<{ value: string }>("SELECT value FROM meta WHERE key = 'google_event_key'")?.value;
  if (have) return have;
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of randomBytes(16)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  db().run("INSERT INTO meta(key, value) VALUES ('google_event_key', ?) ON CONFLICT(key) DO NOTHING", out);
  return db().get<{ value: string }>("SELECT value FROM meta WHERE key = 'google_event_key'")!.value;
}

/** an event's id in Google: Google's own letters (0-9, a-v), the same every time it is written */
export const googleIdOf = (eventId: number) => `${eventKey()}${eventId.toString(32)}`;

interface EventForGoogle {
  id: number;
  date: string;
  start_time: string;
  end_time: string | null;
  end_date: string | null;
  all_day: number;
  title: string;
  location: string;
  notes: string;
  color: string | null;
  cancelled: number;
  transparency: 'opaque' | 'transparent';
  visibility: 'default' | 'public' | 'private';
  deleted_at: string | null;
  owner_name: string | null;
}

function googleBody(e: EventForGoogle): Record<string, unknown> {
  const zone = tz();
  let start: Record<string, string>;
  let end: Record<string, string>;
  if (e.all_day) {
    start = { date: e.date };
    end = { date: addDays(e.end_date ?? e.date, 1) };
  } else {
    const s = zonedToUtc(e.date, e.start_time, zone);
    let f = e.end_time ? zonedToUtc(e.date, e.end_time, zone) : new Date(s.getTime() + 3_600_000);
    if (f <= s) f = new Date(f.getTime() + 86_400_000);
    start = { dateTime: zonedIso(e.date, e.start_time, zone), timeZone: zone };
    end = { dateTime: f.toISOString(), timeZone: zone };
  }
  const description = [e.notes.trim(), e.owner_name ? `אחראי: ${e.owner_name}` : ''].filter(Boolean).join('\n\n');
  return {
    summary: e.cancelled ? `${e.title} (בוטל)` : e.title,
    description,
    location: e.location,
    start,
    end,
    ...(e.color && (CAL_COLORS as readonly string[]).includes(e.color) ? { colorId: EVENT_COLOR_ID[e.color as CalColor] } : {}),
    transparency: e.transparency,
    visibility: e.visibility,
    extendedProperties: { private: { kksEvent: String(e.id) } },
  };
}

// ---------------- keeping Google in step ----------------

interface Work {
  link: EventLinkRow;
  event: EventForGoogle | null;
  /** where it should be in Google (null: nowhere) and what it should say */
  want: { calendarId: string; body: Record<string, unknown>; hash: string } | null;
}

function workToDo(): Work[] {
  inherit();
  const links = db().all<EventLinkRow>("SELECT * FROM google_event_links WHERE (calendar_id <> '' OR pushed_calendar IS NOT NULL) AND state <> 'off'");
  if (!links.length) return [];
  const events = new Map(
    db()
      .all<EventForGoogle>(
        `SELECT e.id, e.date, e.start_time, e.end_time, e.end_date, e.all_day, e.title, e.location, e.notes, e.color, e.cancelled, e.transparency, e.visibility, e.deleted_at, u.display_name AS owner_name
         FROM events e LEFT JOIN users u ON u.id = e.owner_id WHERE e.id IN (SELECT event_id FROM google_event_links)`,
      )
      .map((e) => [e.id, e]),
  );
  const now = nowIso();
  const out: Work[] = [];
  for (const link of links) {
    const event = events.get(link.event_id) ?? null;
    let want: Work['want'] = null;
    if (event && !event.deleted_at && link.calendar_id) {
      const body = googleBody(event);
      want = { calendarId: link.calendar_id, body, hash: sha(JSON.stringify([link.calendar_id, body])) };
    }
    const done = want ? link.pushed_hash === want.hash && link.pushed_calendar === want.calendarId : !link.pushed_calendar;
    if (done && link.state === 'synced') continue;
    if (done && event) {
      db().run("UPDATE google_event_links SET state = 'synced', error = NULL, tries = 0, next_try = NULL WHERE event_id = ?", link.event_id);
      continue;
    }
    if (link.state === 'error' && link.next_try && link.next_try > now) continue;
    out.push({ link, event, want });
  }
  return out;
}

/** writes one event into Google (or takes it out) */
async function push(w: Work): Promise<void> {
  const { link, want } = w;
  const gid = googleIdOf(link.event_id);
  const owner = link.owner_id ?? courseTarget()?.ownerId ?? null;
  // the account whose copy is in Google now - taken out or moved by that account
  const before = link.pushed_owner ?? owner;
  if (!want) {
    // nowhere now: out of the calendar it was in (already gone there is the same)
    if (link.pushed_calendar && before) {
      const res = await call(before, 'DELETE', `/calendars/${encodeURIComponent(link.pushed_calendar)}/events/${gid}`);
      if (!res.ok && res.status !== 404 && res.status !== 410) await ok(res, 'delete');
    }
    if (!w.event) db().run('DELETE FROM google_event_links WHERE event_id = ?', link.event_id);
    else db().run("UPDATE google_event_links SET pushed_calendar = NULL, pushed_owner = NULL, pushed_hash = NULL, state = 'synced', error = NULL, tries = 0, next_try = NULL, synced_at = ? WHERE event_id = ?", nowIso(), link.event_id);
    return;
  }
  if (!owner) throw new OffError('אין חשבון Google שכותב את האירוע');
  const cal = encodeURIComponent(want.calendarId);
  if (link.pushed_calendar && link.pushed_calendar !== want.calendarId) {
    const from = encodeURIComponent(link.pushed_calendar);
    // moved to another calendar of the same account: Google moves the same event
    let left = false;
    if (before === owner) {
      const res = await call(owner, 'POST', `/calendars/${from}/events/${gid}/move?destination=${cal}`);
      const wait = await busy(res, 'move');
      if (wait) throw wait;
      left = res.ok || res.status === 404 || res.status === 410;
    }
    // another account's copy, or one Google would not move: taken out there, and made anew below
    if (!left && before) {
      try {
        const wait = await busy(await call(before, 'DELETE', `/calendars/${from}/events/${gid}`), 'delete');
        if (wait) throw wait;
      } catch (e) {
        // that account let go of Google: its copy stays as it was
        if (!(e instanceof OffError)) throw e;
      }
    }
  }
  const body = { ...want.body, status: 'confirmed' };
  // in place (and brought back, if it was deleted there); not there yet: made, with its fixed id
  let res = await call(owner, 'PATCH', `/calendars/${cal}/events/${gid}`, body);
  if (res.status === 404 || res.status === 410) {
    res = await call(owner, 'POST', `/calendars/${cal}/events`, { ...body, id: gid });
    if (res.status === 409) res = await call(owner, 'PATCH', `/calendars/${cal}/events/${gid}`, body);
  }
  await ok(res, 'write');
  const made = (await res.json().catch(() => ({}))) as { iCalUID?: string };
  db().run(
    "UPDATE google_event_links SET pushed_calendar = ?, pushed_owner = ?, pushed_hash = ?, ical_uid = ?, state = 'synced', error = NULL, tries = 0, next_try = NULL, synced_at = ? WHERE event_id = ?",
    want.calendarId,
    owner,
    want.hash,
    made.iCalUID ?? `${gid}@google.com`,
    nowIso(),
    link.event_id,
  );
}

/** what Google said, in a few words for the person reading it */
function failureText(e: unknown): string {
  if (e instanceof OffError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(m)) return 'ה-Google Calendar API לא מופעל בפרויקט של Google';
  if (/ 403 /.test(m) && /rateLimit|quota/i.test(m)) return 'Google ביקש להאט - ננסה שוב בעוד כמה דקות';
  if (/ 403 /.test(m) || / 404 /.test(m)) return 'אין הרשאה לכתוב ביומן הזה ב-Google';
  if (/ 400 /.test(m)) return 'Google לא קיבל את האירוע';
  return 'Google לא ענה - ננסה שוב';
}

export interface SyncResult {
  done: number;
  failed: number;
  pending: number;
}

/**
 * Keeps Google in step: what changed since it was last written goes out, for up to `budgetMs`. Never throws -
 * what failed waits (a little longer each time) and is tried again; an account that cannot write waits for it.
 */
export async function syncGoogle(budgetMs = 4000, max = 12): Promise<SyncResult> {
  if (!gcalAvailable()) return { done: 0, failed: 0, pending: 0 };
  let work: Work[];
  try {
    work = workToDo();
  } catch (e) {
    console.error('[google calendar] could not read what to write', e);
    return { done: 0, failed: 0, pending: 0 };
  }
  const until = Date.now() + budgetMs;
  let done = 0;
  let failed = 0;
  for (const w of work.slice(0, max)) {
    if (Date.now() > until) break;
    try {
      await push(w);
      done++;
    } catch (e) {
      failed++;
      const off = e instanceof OffError;
      if (!off) console.warn('[google calendar] write failed:', (e as Error).message);
      const tries = w.link.tries + 1;
      const wait = Math.min(6 * 60, 2 ** Math.min(tries, 9)) * 60_000;
      db().run(
        'UPDATE google_event_links SET state = ?, error = ?, tries = ?, next_try = ? WHERE event_id = ?',
        off ? 'off' : 'error',
        failureText(e),
        tries,
        new Date(clock.now().getTime() + wait).toISOString(),
        w.link.event_id,
      );
    }
  }
  return { done, failed, pending: Math.max(0, work.length - done - failed) };
}

/** after an event changed: Google follows at once (a short while; the rest on the next pass) */
export async function syncAfterChange(): Promise<void> {
  if (!gcalAvailable()) return;
  if (!db().get("SELECT 1 FROM google_event_links LIMIT 1") && !courseTarget() && !db().get('SELECT 1 FROM google_series_targets LIMIT 1')) return;
  await syncGoogle(4000, 10);
}

// ---------------- each shows once ----------------

/**
 * The events written from here into Google that this person sees in the app, by the id a calendar's address
 * gives them: Google's copy of those is left out for them. One they do not see here (another's own event in
 * a shared calendar) they still see as Google has it.
 */
export function writtenUids(viewerId: number): Set<string> {
  return new Set(
    db()
      .all<{ ical_uid: string }>(
        `SELECT l.ical_uid FROM google_event_links l JOIN events e ON e.id = l.event_id
         WHERE l.pushed_calendar IS NOT NULL AND l.ical_uid IS NOT NULL AND e.deleted_at IS NULL
           AND (e.calendar = 'course' OR e.created_by = ? OR EXISTS (SELECT 1 FROM event_guests g WHERE g.event_id = e.id AND g.user_id = ?))`,
        viewerId,
        viewerId,
      )
      .map((r) => r.ical_uid),
  );
}

// ---------------- what the screen shows ----------------

export async function calendarStatus(actor: UserRow): Promise<GoogleCalendarStatus> {
  const available = gcalAvailable();
  const link = available ? linkOf(actor.id) : undefined;
  const course = courseTarget();
  let calendars: GoogleCalendarChoice[] = [];
  let error: string | null = null;
  if (link?.state === 'ok') {
    try {
      calendars = await writableCalendars(actor.id);
    } catch (e) {
      error = e instanceof OffError ? e.message : failureText(e);
    }
  }
  const counts = available
    ? db().get<{ pending: number; failed: number }>(
        "SELECT sum(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN state IN ('error', 'off') THEN 1 ELSE 0 END) AS failed FROM google_event_links WHERE calendar_id <> '' OR pushed_calendar IS NOT NULL",
      )
    : undefined;
  const inheritable = available && course ? db().get<{ n: number }>("SELECT count(*) AS n FROM events e WHERE e.calendar = 'course' AND e.deleted_at IS NULL AND e.date >= ? AND NOT EXISTS (SELECT 1 FROM google_event_links l WHERE l.event_id = e.id)", course.since)!.n : 0;
  const owner = course ? getUserRow(course.ownerId) : undefined;
  return {
    available,
    connected: link?.state === 'ok',
    reconnect: link?.state === 'revoked',
    email: link?.email ?? '',
    calendars,
    error,
    course: course ? { calendarId: course.calendarId, name: course.name, color: course.color, ownerName: owner?.display_name ?? '', mine: course.ownerId === actor.id } : null,
    canSetCourse: actor.role === 'commander',
    pending: (counts?.pending ?? 0) + inheritable,
    failed: counts?.failed ?? 0,
  };
}

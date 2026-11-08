// A course opened beside the current one - the next cycle, prepared while this one still runs. Its data is
// apart: a whole database of its own (the same tables), kept inside the current course's database as one value
// (course_slots), so the deployment's one shared copy - saved with a version check - holds both, and a change in
// either is saved the same way. A request runs against the course its person chose (a cookie): the tasks,
// weeks, schedule, cadets and settings are that course's. The people are one: each has one account - signing
// in, notifications, the phone - in the current course's database, copied into the other as they change.
//
// The new course starts with what the commander chose to take from the current one (weeks - moved to its
// dates -, tracks, templates, recurring tasks, teams, documents, the discipline guide, the lessons kept for the
// next cycle), and takes more from it later, item by item. When the current course ends, the one opened beside
// it becomes the current course; the one that ended is kept whole, as every course that ended is.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { addDays, diffDays, isDateKey, localDateKey } from '../../shared/dates';
import { searchKey } from '../../shared/search';
import type { CopyArea, CopySource, ParallelCourse } from '../../shared/types';
import { parseCookies, type UserRow } from './auth';
import { badRequest, clock, config, forbidden, HttpError, notFound, nowIso, resetSettingsCache, tz } from './core';
import { currentSlot, Db, db, homeDb, migrate, withDb, withSlot } from './db';
import { changed } from './journal';
import { numberOn, renamedWeek, weekNumbering } from './weeks';
import type { Topic } from './realtime';

export const SLOT_COOKIE = 'kks_course';

const ALL_TOPICS: Topic[] = ['tasks', 'weeks', 'events', 'templates', 'recurring', 'users', 'settings', 'requests', 'cadets', 'debriefs', 'documents', 'announcements', 'alignment', 'plans', 'weekly', 'entries', 'discussions'];

// ---------------- which course a request is in ----------------

/** the course beside the current one chosen (the cookie "s<id>"); null: the current course */
export function slotOf(req: Request): number | null {
  const m = /^s(\d+)$/.exec(parseCookies(req.headers.cookie)[SLOT_COOKIE] ?? '');
  return m ? Number(m[1]) : null;
}

export function setSlotCookie(res: Response, id: number | null): void {
  if (id === null) res.clearCookie(SLOT_COOKIE, { path: '/' });
  else res.cookie(SLOT_COOKIE, `s${id}`, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 30 * 24 * 3_600_000 });
}

interface SlotRow {
  id: number;
  name: string;
  token: string;
  created_at: string;
  updated_at: string;
}

const slotRow = (id: number) => homeDb().get<SlotRow>('SELECT id, name, token, created_at, updated_at FROM course_slots WHERE id = ?', id);

/** the courses opened beside the current one */
export function listSlots(): { id: number; name: string }[] {
  return homeDb().all<{ id: number; name: string }>('SELECT id, name FROM course_slots ORDER BY id');
}

// ---------------- its database ----------------

interface Opened {
  token: string;
  db: Db;
  path: string;
}
const opened = new Map<number, Opened>();

/** a folder of this process's own: tests run side by side, each with its own copies */
const slotsDir = () => join(config.dataDir, 'slots', String(process.pid));

const changesOf = (d: Db) => d.get<{ n: number }>('SELECT total_changes() AS n')!.n;

/** the course's database, as last saved - opened once on this instance, again only when it was saved elsewhere */
export function slotDb(id: number): Db {
  const row = homeDb().get<{ token: string }>('SELECT token FROM course_slots WHERE id = ?', id);
  if (!row) throw notFound('הקורס לא נמצא');
  const was = opened.get(id);
  if (was && was.token === row.token) return was.db;
  was?.db.close();
  opened.delete(id);
  const data = homeDb().get<{ data: Uint8Array }>('SELECT data FROM course_slots WHERE id = ?', id)!.data;
  const path = join(slotsDir(), `course-${id}.db`);
  mkdirSync(slotsDir(), { recursive: true });
  for (const f of [path, `${path}-journal`]) rmSync(f, { force: true });
  writeFileSync(path, data);
  const d = new Db(path, { wal: false });
  migrate(d); // kept by an earlier release: the newer tables and columns
  opened.set(id, { token: row.token, db: d, path });
  return d;
}

/** what changed in it is kept: written back into the current course's database (saved with it) */
export function persistSlot(id: number): void {
  const o = opened.get(id);
  if (!o) return;
  const token = randomUUID();
  homeDb().run('UPDATE course_slots SET data = ?, token = ?, updated_at = ? WHERE id = ?', readFileSync(o.path), token, nowIso(), id);
  o.token = token;
}

function forget(id: number): void {
  const o = opened.get(id);
  if (!o) return;
  o.db.close();
  opened.delete(id);
  for (const f of [o.path, `${o.path}-journal`]) rmSync(f, { force: true });
}

/** tests: every course beside the current one closed (a test opens a database of its own) */
export function closeSlots(): void {
  for (const id of [...opened.keys()]) forget(id);
}

// ---------------- the people: one account each ----------------

/** the course's own: what of its own WhatsApp group each one has read */
const OWN_USER_COLUMNS = new Set(['alignment_seen_id']);

/** the accounts as they are in the current course, into the other - when they changed since */
function syncUsers(d: Db): void {
  const rows = homeDb().all<Record<string, unknown>>('SELECT * FROM users ORDER BY id');
  const mark = createHash('sha1').update(JSON.stringify(rows)).digest('hex');
  if (d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'users_mark'")?.value === mark) return;
  const have = new Set(d.all<{ name: string }>('PRAGMA table_info(users)').map((c) => c.name));
  const cols = rows.length ? Object.keys(rows[0]).filter((c) => have.has(c)) : [];
  const set = cols.filter((c) => c !== 'id' && !OWN_USER_COLUMNS.has(c));
  d.tx(() => {
    if (cols.length) {
      const sql = `INSERT INTO users(${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
        ON CONFLICT(id) DO UPDATE SET ${set.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
      for (const r of rows) d.run(sql, ...cols.map((c) => r[c] as never));
    }
    d.run("INSERT INTO meta(key, value) VALUES ('users_mark', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", mark);
  });
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ---------------- requests ----------------

/** what is always the current course's: signing in, the courses themselves, notifications, the phone */
const LIVE = [
  /^\/auth\//,
  /^\/courses(\/|$)/,
  /^\/notifications(\/|$)/,
  /^\/push\//,
  /^\/client-error$/,
  /^\/stream$/,
  /^\/sync$/,
  /^\/admin\//,
  /^\/share-target$/,
  /^\/calendar\/feed/,
  /^\/public\//,
  // a person's own: their Google account, their calendar's settings, their contact details
  /^\/google\//,
  /^\/me\//,
  /^\/users\/(me|google-requests)(\/|$)/,
];
/** the accounts are one: changing them is done on the current course's, and copied over from there */
const ACCOUNT_WRITES = [/^\/users(\/|$)/, /^\/me\//];

/**
 * A request of someone who chose the course beside the current one runs against it - every screen; what
 * changed is kept before the answer goes out. A course that no longer is drops the choice.
 */
export function slotScope(req: Request, res: Response, next: NextFunction): void {
  const id = slotOf(req);
  if (id === null || !req.user) return next();
  const row = slotRow(id);
  if (!row) {
    setSlotCookie(res, null);
    return next();
  }
  if (LIVE.some((r) => r.test(req.path))) return next();
  const body = req.body as { entity?: unknown } | undefined;
  if (req.method !== 'GET' && (ACCOUNT_WRITES.some((r) => r.test(req.path)) || (req.path === '/bulk' && body?.entity === 'users'))) return next();
  let d: Db;
  let before: number;
  try {
    d = slotDb(id);
    before = changesOf(d);
    syncUsers(d);
  } catch (e) {
    console.error('[parallel] could not open the course', id, e);
    return next(new HttpError(503, 'לא הצלחנו לפתוח את הקורס. נסו שוב בעוד רגע.'));
  }
  // what changed is written back before the answer leaves (the deployment saves it with the answer)
  const end = res.end.bind(res) as (...a: unknown[]) => Response;
  res.end = ((...args: unknown[]) => {
    try {
      if (changesOf(d) !== before) persistSlot(id);
    } catch (e) {
      console.error('[parallel] could not keep the change', id, e);
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        return end(JSON.stringify({ error: 'השינוי לא נשמר. נסו שוב בעוד רגע.' }));
      }
    }
    return end(...args);
  }) as Response['end'];
  withSlot({ id, name: row.name, db: d }, () => next());
}

/** runs fn against that course's database (reads; a change is kept) - from the current course's routes */
export function inSlot<T>(id: number, fn: () => T): T {
  const row = slotRow(id);
  if (!row) throw notFound('הקורס לא נמצא');
  const d = slotDb(id);
  const before = changesOf(d);
  syncUsers(d);
  const out = withSlot({ id, name: row.name, db: d }, fn);
  if (changesOf(d) !== before) persistSlot(id);
  return out;
}

/** each course beside the current one, its turn of the automation (reminders, recurring tasks, the brief) */
export function forEachSlot(fn: () => void): void {
  for (const s of listSlots()) {
    try {
      inSlot(s.id, fn);
    } catch (e) {
      console.error('[parallel] automation', s.id, e);
    }
  }
}

// ---------------- what the app shows ----------------

/** the courses the app offers to move between: the current one, and those beside it */
export function coursesFor(req: Request): { main: string; slot: { id: number; name: string } | null; slots: { id: number; name: string }[] } {
  const slots = listSlots();
  const id = slotOf(req);
  return { main: String(settingOf(homeDb(), 'courseName') ?? '') || 'הקורס הנוכחי', slot: slots.find((s) => s.id === id) ?? null, slots };
}

export function parallelCourses(): ParallelCourse[] {
  return listSlots().map((s) => {
    const row = slotRow(s.id)!;
    return inSlot(s.id, () => ({ id: s.id, name: s.name, ...courseDates(), stats: quickStats(), createdAt: row.created_at, updatedAt: row.updated_at }));
  });
}

function courseDates(): { startDate: string | null; endDate: string | null } {
  const v = (k: string) => {
    const r = db().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', k);
    try {
      return r ? (JSON.parse(r.value) as string | null) : null;
    } catch {
      return null;
    }
  };
  return { startDate: v('startDate'), endDate: v('endDate') };
}

const n = (sql: string) => db().get<{ n: number }>(sql)!.n;
const quickStats = () => ({ tasks: n('SELECT count(*) AS n FROM tasks WHERE parent_id IS NULL'), weeks: n('SELECT count(*) AS n FROM weeks'), events: n('SELECT count(*) AS n FROM events WHERE deleted_at IS NULL') });

/** moves to a course: one beside the current one, or (null) the current one */
export function switchSlot(res: Response, id: number | null): void {
  if (id !== null && !slotRow(id)) throw notFound('הקורס לא נמצא');
  setSlotCookie(res, id);
}

// ---------------- opening one ----------------

export const COPY_AREAS: CopyArea[] = ['weeks', 'tracks', 'templates', 'recurring', 'teams', 'documents', 'guide', 'lessons'];

const dateOrNull = z
  .string()
  .refine(isDateKey, 'תאריך לא תקין')
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const openCourseSchema = z
  .object({
    name: z.string().trim().min(1, 'חסר שם לקורס').max(120),
    symbol: z.string().trim().max(12).optional(),
    startDate: dateOrNull,
    endDate: dateOrNull,
    take: z.array(z.enum(COPY_AREAS as [CopyArea, ...CopyArea[]])).max(20).optional().default([]),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, 'תאריך הסיום לפני תאריך ההתחלה')
  // the weeks move to the same point of the new course: from its start
  .refine((v) => !!v.startDate || !v.take.includes('weeks'), 'כדי לשכפל את השבועות צריך תאריך התחלה לקורס החדש');

/** the course's setting, as kept (JSON) */
function settingOf(d: Db, key: string): unknown {
  const r = d.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  try {
    return r ? JSON.parse(r.value) : undefined;
  } catch {
    return undefined;
  }
}
const putSetting = (d: Db, key: string, value: unknown) =>
  d.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));

/** how many days on the new course is from the current one: its start from this one's, in whole weeks - a week
 * stays Sunday to Thursday, and a weekly task on its day; none when either start is unknown */
function shiftDays(from: Db, to: Db): number {
  const a = settingOf(from, 'startDate') ?? from.get<{ d: string | null }>('SELECT min(start_date) AS d FROM weeks')?.d;
  const b = settingOf(to, 'startDate');
  return typeof a === 'string' && typeof b === 'string' && isDateKey(a) && isDateKey(b) ? Math.round(diffDays(b, a) / 7) * 7 : 0;
}

/** Opens a course beside the current one: its own database, with what was chosen to take along. */
export function openParallelCourse(actor: UserRow, raw: unknown): ParallelCourse {
  const p = openCourseSchema.parse(raw);
  if (listSlots().length >= 3) throw badRequest('אפשר לפתוח עד שלושה קורסים לצד הקורס הנוכחי');
  mkdirSync(slotsDir(), { recursive: true });
  const path = join(slotsDir(), `new-${randomUUID()}.db`);
  const d = new Db(path, { wal: false });
  let id: number;
  try {
    migrate(d);
    syncUsers(d);
    const home = homeDb();
    d.tx(() => {
      // the way the course works goes along: its settings, under its own name and dates
      copyRows(home, d, 'settings');
      putSetting(d, 'courseName', p.name);
      if (p.symbol) putSetting(d, 'courseSymbol', p.symbol);
      putSetting(d, 'startDate', p.startDate);
      putSetting(d, 'endDate', p.endDate);
      // and what the evaluation and the תקפ"צ are measured by
      copyRows(home, d, 'evaluation_tests');
      replaceRows(home, d, 'takpatz_catalog');
      const shift = shiftDays(home, d);
      for (const area of p.take) copyWhole(area, home, d, shift, p.take);
    });
    const data = readFileSync(path);
    d.close();
    id = homeDb().run('INSERT INTO course_slots(name, data, token, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', p.name, data, randomUUID(), actor.id, nowIso(), nowIso()).id;
  } finally {
    try {
      d.close();
    } catch {
      /* closed already */
    }
    for (const f of [path, `${path}-journal`]) rmSync(f, { force: true });
  }
  return parallelCourses().find((c) => c.id === id)!;
}

// ---------------- copying: the whole of an area into a new course ----------------

/** the columns both have (an older copy may lack a newer one) */
function columnsOf(from: Db, to: Db, table: string): string[] {
  const there = new Set(to.all<{ name: string }>(`PRAGMA table_info(${q(table)})`).map((c) => c.name));
  return from
    .all<{ name: string }>(`PRAGMA table_info(${q(table)})`)
    .map((c) => c.name)
    .filter((c) => there.has(c));
}

/** rows as they are, ids kept (into a course that has none of them yet) */
function copyRows(from: Db, to: Db, table: string, where = '1=1', fix?: (r: Record<string, unknown>) => Record<string, unknown> | null): number {
  const cols = columnsOf(from, to, table);
  const sql = `INSERT OR IGNORE INTO ${q(table)}(${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  let copied = 0;
  for (const raw of from.all<Record<string, unknown>>(`SELECT * FROM ${q(table)} WHERE ${where}`)) {
    const r = fix ? fix({ ...raw }) : raw;
    if (!r) continue;
    copied += to.run(sql, ...cols.map((c) => r[c] as never)).changes;
  }
  return copied;
}

/** what the new course started with by default, instead of this course's */
function replaceRows(from: Db, to: Db, table: string): void {
  if (!from.get(`SELECT 1 FROM ${q(table)} LIMIT 1`)) return;
  to.run(`DELETE FROM ${q(table)}`);
  copyRows(from, to, table);
}

const shiftDate = (d: unknown, days: number) => (typeof d === 'string' && isDateKey(d) && days ? addDays(d, days) : d);

function copyWhole(area: CopyArea, from: Db, to: Db, shift: number, take: CopyArea[]): void {
  switch (area) {
    case 'weeks': {
      // at the same point of the new course, to be planned again - numbered by the calendar where this course is
      const numbering = shift ? weekNumbering(from) : null;
      copyRows(from, to, 'weeks', '1=1', (r) => {
        const start = shiftDate(r.start_date, shift) as string;
        const number = numbering ? numberOn(numbering, start) : (r.number as number);
        return {
          ...r,
          number,
          name: renamedWeek(r.name, r.number, number),
          start_date: start,
          end_date: shiftDate(r.end_date, shift),
          status: 'planning',
          approved_at: null,
          approved_by: null,
          closed_at: null,
          closed_by: null,
          calendar_uid: null,
        };
      });
      return;
    }
    case 'tracks':
      replaceRows(from, to, 'tracks');
      return;
    case 'templates':
      copyRows(from, to, 'templates');
      return;
    case 'recurring':
      // they start making their tasks when the new course does
      copyRows(from, to, 'recurring_rules', '1=1', (r) => ({ ...r, start_date: shiftDate(r.start_date, shift), last_generated_date: null }));
      return;
    case 'teams':
      copyRows(from, to, 'teams');
      return;
    case 'documents':
      copyRows(from, to, 'documents', '1=1', (r) => ({ ...r, week_id: take.includes('weeks') ? r.week_id : null }));
      return;
    case 'guide':
      replaceRows(from, to, 'discipline_guide');
      return;
    case 'lessons': {
      // the lessons kept for the next cycle, with the debriefs they came from - no longer tied to this course's
      // weeks, events or tasks
      const ids = from.all<{ id: number }>("SELECT DISTINCT debrief_id AS id FROM debrief_items WHERE kind = 'lesson' AND horizon = 'next'").map((r) => r.id);
      if (!ids.length) return;
      const inList = `id IN (${ids.join(',')})`;
      copyRows(from, to, 'debriefs', inList, (r) => ({ ...r, event_id: null, week_id: null, status: 'final' }));
      copyRows(from, to, 'debrief_items', `kind = 'lesson' AND horizon = 'next' AND debrief_id IN (${ids.join(',')})`, (r) => ({
        ...r,
        task_id: null,
        recurring_rule_id: take.includes('recurring') ? r.recurring_rule_id : null,
        target_week: take.includes('weeks') ? r.target_week : null,
      }));
      return;
    }
  }
}

// ---------------- copying later: chosen items, into a course that has its own already ----------------

interface AreaSpec {
  table: string;
  /** what an item is called - the same name there means it is there already */
  name: string;
  label: (r: Record<string, unknown>) => string;
  sub?: (r: Record<string, unknown>) => string;
  order: string;
  where?: string;
}

const AREA: Record<CopyArea, AreaSpec> = {
  weeks: { table: 'weeks', name: 'name', label: (r) => String(r.name), sub: (r) => `${r.start_date} - ${r.end_date}`, order: 'start_date, number' },
  tracks: { table: 'tracks', name: 'name', label: (r) => String(r.name), order: 'name' },
  templates: { table: 'templates', name: 'name', label: (r) => String(r.name), sub: (r) => String(r.description ?? ''), order: 'name' },
  recurring: { table: 'recurring_rules', name: 'title', label: (r) => String(r.title), sub: (r) => String(r.frequency ?? ''), order: 'title' },
  teams: { table: 'teams', name: 'name', label: (r) => String(r.name), order: 'sort, name' },
  documents: { table: 'documents', name: 'title', label: (r) => String(r.title), sub: (r) => String(r.category ?? ''), order: 'category, title' },
  guide: { table: 'discipline_guide', name: 'source', label: (r) => `מדרג אכיפה${r.source ? ` · ${r.source}` : ''}`, order: 'id' },
  lessons: {
    table: 'debriefs',
    name: 'title',
    label: (r) => String(r.title),
    sub: (r) => String(r.occurred_on ?? ''),
    order: 'occurred_on DESC, id DESC',
    where: "id IN (SELECT debrief_id FROM debrief_items WHERE kind = 'lesson' AND horizon = 'next')",
  },
};

const sameName = (d: Db, spec: AreaSpec) => new Set(d.all<Record<string, unknown>>(`SELECT ${q(spec.name)} AS n FROM ${q(spec.table)}${spec.where ? ` WHERE ${spec.where}` : ''}`).map((r) => searchKey(String(r.n ?? ''))));

/** what the current course has of an area, each marked when the course beside it has it already */
export function copySource(slotId: number, area: CopyArea): CopySource {
  const spec = AREA[area];
  if (!spec) throw badRequest('אין דבר כזה להעתיק');
  const home = homeDb();
  const rows = home.all<Record<string, unknown>>(`SELECT * FROM ${q(spec.table)}${spec.where ? ` WHERE ${spec.where}` : ''} ORDER BY ${spec.order}`);
  const here = inSlot(slotId, () => sameName(db(), spec));
  return {
    area,
    from: String(settingOf(home, 'courseName') ?? ''),
    items: rows.map((r) => ({ id: Number(r.id), name: spec.label(r), sub: spec.sub?.(r) ?? '', exists: here.has(searchKey(String(r[spec.name] ?? ''))) })),
  };
}

export const copySchema = z.object({
  area: z.enum(COPY_AREAS as [CopyArea, ...CopyArea[]]),
  ids: z.array(z.number().int().positive()).min(1, 'לא נבחר דבר').max(500),
});

/** Copies chosen items of the current course into the course beside it - new there, what it has already left. */
export function copyIntoSlot(slotId: number, raw: unknown): { copied: number; skipped: number } {
  const p = copySchema.parse(raw);
  const spec = AREA[p.area];
  const home = homeDb();
  const rows = home.all<Record<string, unknown>>(`SELECT * FROM ${q(spec.table)} WHERE id IN (${p.ids.join(',')})${spec.where ? ` AND ${spec.where}` : ''}`);
  let copied = 0;
  inSlot(slotId, () => {
    const to = db();
    if (p.area === 'weeks' && typeof settingOf(to, 'startDate') !== 'string') throw badRequest('כדי להעתיק שבועות צריך תאריך התחלה לקורס החדש (בפרטי הקורס, כשעובדים בו)');
    const shift = shiftDays(home, to);
    const here = sameName(to, spec);
    to.tx(() => {
      for (const r of rows) {
        const key = searchKey(String(r[spec.name] ?? ''));
        if (p.area !== 'guide' && here.has(key)) continue;
        insertOne(p.area, home, to, r, shift);
        here.add(key);
        copied++;
      }
    });
  });
  changed(...ALL_TOPICS);
  return { copied, skipped: rows.length - copied };
}

/** a row as new in the other course: a new id, what it points at there by name (or nothing) */
function insertNew(from: Db, to: Db, table: string, r: Record<string, unknown>): number {
  const cols = columnsOf(from, to, table).filter((c) => c !== 'id');
  return to.run(`INSERT INTO ${q(table)}(${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => r[c] as never)).id;
}

/** the week there named as that one here */
function weekThere(from: Db, to: Db, weekId: unknown): number | null {
  if (weekId === null || weekId === undefined) return null;
  const name = from.get<{ name: string }>('SELECT name FROM weeks WHERE id = ?', weekId as number)?.name;
  if (!name) return null;
  const key = searchKey(name);
  return to.all<{ id: number; name: string }>('SELECT id, name FROM weeks').find((w) => searchKey(w.name) === key)?.id ?? null;
}

const userThere = (to: Db, id: unknown) => (typeof id === 'number' && to.get('SELECT 1 FROM users WHERE id = ?', id) ? id : null);

function insertOne(area: CopyArea, from: Db, to: Db, r: Record<string, unknown>, shift: number): void {
  switch (area) {
    case 'weeks': {
      const start = shiftDate(r.start_date, shift) as string;
      const numbering = shift ? weekNumbering(from) : null;
      const wanted = numbering ? numberOn(numbering, start) : (r.number as number);
      const number = to.get('SELECT 1 FROM weeks WHERE number = ?', wanted) ? (to.get<{ n: number | null }>('SELECT max(number) AS n FROM weeks')!.n ?? 0) + 1 : wanted;
      insertNew(from, to, 'weeks', {
        ...r,
        number,
        name: renamedWeek(r.name, r.number, number),
        start_date: start,
        end_date: shiftDate(r.end_date, shift),
        status: 'planning',
        lead_id: userThere(to, r.lead_id),
        approved_at: null,
        approved_by: null,
        closed_at: null,
        closed_by: null,
        calendar_uid: null,
      });
      return;
    }
    case 'tracks':
      insertNew(from, to, 'tracks', { ...r, lead_id: userThere(to, r.lead_id) });
      return;
    case 'templates':
      insertNew(from, to, 'templates', { ...r, created_by: userThere(to, r.created_by) });
      return;
    case 'recurring':
      insertNew(from, to, 'recurring_rules', { ...r, start_date: shiftDate(r.start_date, shift), last_generated_date: null, created_by: userThere(to, r.created_by) ?? r.created_by });
      return;
    case 'teams':
      insertNew(from, to, 'teams', { ...r, commander_id: userThere(to, r.commander_id) });
      return;
    case 'documents':
      insertNew(from, to, 'documents', { ...r, week_id: weekThere(from, to, r.week_id), uploaded_by: userThere(to, r.uploaded_by) });
      return;
    case 'guide':
      // the guide is one: the current course's takes the place of the one there
      to.run('DELETE FROM discipline_guide');
      insertNew(from, to, 'discipline_guide', { ...r, imported_by: userThere(to, r.imported_by) });
      return;
    case 'lessons': {
      const id = insertNew(from, to, 'debriefs', { ...r, event_id: null, week_id: null, status: 'final' });
      for (const it of from.all<Record<string, unknown>>("SELECT * FROM debrief_items WHERE debrief_id = ? AND kind = 'lesson' AND horizon = 'next'", r.id as number)) {
        insertNew(from, to, 'debrief_items', { ...it, debrief_id: id, task_id: null, recurring_rule_id: null, target_week: weekThere(from, to, it.target_week) });
      }
      return;
    }
  }
}

// ---------------- its end: deleted, or becoming the current course ----------------

export function deleteSlot(id: number): void {
  if (!slotRow(id)) throw notFound('הקורס לא נמצא');
  homeDb().tx(() => {
    homeDb().run('DELETE FROM notifications WHERE course_slot = ?', id);
    homeDb().run('DELETE FROM course_slots WHERE id = ?', id);
  });
  forget(id);
}

/** the tables that are not a course's: the people, signing in, notifications, the courses themselves */
const ACCOUNTS = new Set([
  'meta',
  'users',
  'sessions',
  'recovery_codes',
  'login_challenges',
  'login_lockouts',
  'push_subscriptions',
  'snapshots',
  'course_archives',
  'course_slots',
  'notifications',
  'google_requests',
  'google_calendar_links',
  'google_calendar_requests',
  'google_drive_requests',
  'user_calendar_settings',
]);

/** about the people and the base, not the course: the current course's stays, the new one's is added */
const MERGED = new Set(['absences', 'entry_requests', 'calendar_sources']);
/** what makes two the same: an absence of the same person on the same days, a calendar of the same address */
const SAME: Record<string, string[]> = { absences: ['user_id', 'start_date', 'end_date'], calendar_sources: ['url'] };

function mergeRows(from: Db, to: Db, table: string): void {
  const keys = SAME[table];
  for (const r of from.all<Record<string, unknown>>(`SELECT * FROM ${q(table)}`)) {
    if (keys && to.get(`SELECT 1 FROM ${q(table)} WHERE ${keys.map((k) => `${q(k)} IS ?`).join(' AND ')}`, ...keys.map((k) => r[k] as never))) continue;
    insertNew(from, to, table, r);
  }
}

/**
 * The course beside the current one becomes the current course (the caller kept the current one as an
 * archive first): the current course's data is replaced by its, in one transaction; its notifications are
 * the current course's from now on.
 */
export function takeSlotIn(id: number): void {
  if (!slotRow(id)) throw notFound('הקורס לא נמצא');
  if (currentSlot()) throw forbidden('עוברים לקורס הנוכחי לפני שמחליפים אותו');
  const from = slotDb(id);
  syncUsers(from);
  const home = homeDb();
  const tables = home
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((t) => t.name)
    .filter((t) => !ACCOUNTS.has(t));
  home.tx(() => {
    // what refers to what is checked once all is in place
    home.exec('PRAGMA defer_foreign_keys = ON');
    for (const t of tables) if (!MERGED.has(t)) home.run(`DELETE FROM ${q(t)}`);
    // the staff's absences that are over go, as when any course ends
    home.run('DELETE FROM absences WHERE end_date < ?', localDateKey(clock.now(), tz()));
    for (const t of tables) {
      if (!from.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t)) continue;
      if (MERGED.has(t)) mergeRows(from, home, t);
      else copyRows(from, home, t);
    }
    home.run('UPDATE notifications SET task_id = (SELECT t.id FROM tasks t WHERE t.id = notifications.slot_task_id), course_slot = NULL WHERE course_slot = ?', id);
    home.run('DELETE FROM course_slots WHERE id = ?', id);
  });
  forget(id);
  resetSettingsCache();
  changed(...ALL_TOPICS);
}

/** the course's database in reach without a request in it (tests, the automation) */
export function withSlotDb<T>(id: number, fn: () => T): T {
  return withDb(slotDb(id), fn);
}

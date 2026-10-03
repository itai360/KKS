// Previous courses. When a course ends, the commander keeps it whole and starts the next one in
// the same system. The course that ended is a snapshot of the whole database (label 'archive',
// never pruned) listed in course_archives. The next course starts with the people and the way
// the course works - settings, templates, recurring tasks, teams, the discipline guide, the
// documents library, the calendars - and the lessons the course kept for the next cycle (the
// lessons bank). Its tasks, weeks, schedule, cadets, debriefs and the rest stay in the archive.
//
// The commander can open a previous course and read everything in it, on every screen: those
// requests run against that course's database (withDb), read only. A cookie says which course
// is open; signing in, notifications and this screen always work on the current course.

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { addDays, diffDays, isDateKey, localDateKey, localTime, zonedIso } from '../../shared/dates';
import { searchKey } from '../../shared/search';
import type { Priority, TaskStatus } from '../../shared/constants';
import type { CourseArchive, CoursesOverview, CourseStats, PreviousCycleWeek } from '../../shared/types';
import { parseCookies, type UserRow } from './auth';
import { clock, config, forbidden, getSettings, HttpError, notFound, nowIso, resetSettingsCache, tz, updateSettings } from './core';
import { db, Db, migrate, withDb } from './db';
import { changed } from './journal';
import type { Topic } from './realtime';
import { fetchSnapshot, takeSnapshot } from './snapshots';
import { createTasks } from './taskService';

export const COURSE_COOKIE = 'kks_course';

/** What the next course takes with it as is. Every other table starts empty (a few, below, in part). */
const CARRIED = new Set([
  'meta',
  'users',
  'sessions',
  'recovery_codes',
  'push_subscriptions',
  'snapshots',
  'login_lockouts',
  'course_archives',
  'settings',
  'templates',
  'recurring_rules',
  'recurring_instances',
  'teams',
  'discipline_guide',
  'documents',
  'calendar_sources',
  'automation_marks',
]);
/** kept in part: the debriefs with lessons for the next cycle, and the staff's absences still ahead */
const IN_PART = new Set(['debriefs', 'debrief_items', 'absences']);

const ALL_TOPICS: Topic[] = ['tasks', 'weeks', 'events', 'templates', 'recurring', 'users', 'settings', 'meetings', 'requests', 'cadets', 'debriefs', 'documents', 'announcements', 'alignment'];

interface ArchiveRow {
  id: number;
  snapshot_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  stats: string;
  archived_at: string;
  archived_by_name: string | null;
}

const ARCHIVE_SELECT = `SELECT a.*, u.display_name AS archived_by_name FROM course_archives a LEFT JOIN users u ON u.id = a.archived_by`;

function toArchive(r: ArchiveRow): CourseArchive {
  let stats: CourseStats;
  try {
    stats = { ...emptyStats(), ...(JSON.parse(r.stats) as Partial<CourseStats>) };
  } catch {
    stats = emptyStats();
  }
  return { id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, stats, archivedAt: r.archived_at, archivedByName: r.archived_by_name };
}

const emptyStats = (): CourseStats => ({ tasks: 0, doneTasks: 0, weeks: 0, events: 0, cadets: 0, debriefs: 0, lessons: 0 });

const count = (sql: string) => db().get<{ n: number }>(sql)!.n;

/** the size of the course in db() - the current one, or an archive's when in its scope */
function courseStats(): CourseStats {
  return {
    tasks: count('SELECT count(*) AS n FROM tasks WHERE parent_id IS NULL'),
    doneTasks: count("SELECT count(*) AS n FROM tasks WHERE parent_id IS NULL AND status = 'done'"),
    weeks: count('SELECT count(*) AS n FROM weeks'),
    events: count('SELECT count(*) AS n FROM events'),
    cadets: count('SELECT count(*) AS n FROM cadets'),
    debriefs: count('SELECT count(*) AS n FROM debriefs'),
    lessons: count("SELECT count(*) AS n FROM debrief_items WHERE kind = 'lesson' AND horizon = 'next'"),
  };
}

/** the course's dates: as set in the settings, or its first and last week */
function courseRange(): { startDate: string | null; endDate: string | null } {
  const s = getSettings();
  const w = db().get<{ start: string | null; end: string | null }>('SELECT min(start_date) AS start, max(end_date) AS end FROM weeks')!;
  return { startDate: s.startDate ?? w.start ?? null, endDate: s.endDate ?? w.end ?? null };
}

export function archiveRow(id: number): ArchiveRow | undefined {
  return db().get<ArchiveRow>(`${ARCHIVE_SELECT} WHERE a.id = ?`, id);
}

export function coursesOverview(viewing: number | null): CoursesOverview {
  const s = getSettings();
  return {
    current: { name: s.courseName, ...courseRange(), stats: courseStats() },
    archives: db().all<ArchiveRow>(`${ARCHIVE_SELECT} ORDER BY a.archived_at DESC, a.id DESC`).map(toArchive),
    viewing,
  };
}

const dateOrNull = z
  .string()
  .refine(isDateKey, 'תאריך לא תקין')
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const newCourseSchema = z
  .object({
    /** the name the course that ends is kept under */
    archiveName: z.string().trim().min(1, 'חסר שם לקורס שמסתיים').max(120),
    name: z.string().trim().min(1, 'חסר שם לקורס החדש').max(120),
    symbol: z.string().trim().max(12).optional(),
    startDate: dateOrNull,
    endDate: dateOrNull,
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, 'תאריך הסיום לפני תאריך ההתחלה');

/**
 * Ends the current course: keeps it whole as an archive, then clears what belonged to it. If the
 * archive cannot be saved nothing is cleared.
 */
export async function startNewCourse(actor: UserRow, raw: unknown): Promise<CourseArchive> {
  const p = newCourseSchema.parse(raw);
  const range = courseRange();
  const stats = courseStats();
  let snapshotId: string;
  try {
    snapshotId = await takeSnapshot('archive');
  } catch (e) {
    console.error('[courses] could not keep the course', e);
    throw new HttpError(503, 'לא הצלחנו לשמור את הקורס הנוכחי, ולכן לא נמחק דבר. נסו שוב בעוד רגע.');
  }
  const id = db().tx(() => {
    const archiveId = db().run(
      'INSERT INTO course_archives(snapshot_id, name, start_date, end_date, stats, archived_by, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      snapshotId,
      p.archiveName,
      range.startDate,
      range.endDate,
      JSON.stringify(stats),
      actor.id,
      nowIso(),
    ).id;
    clearCourse();
    updateSettings({ courseName: p.name, ...(p.symbol ? { courseSymbol: p.symbol } : {}), startDate: p.startDate, endDate: p.endDate });
    return archiveId;
  });
  resetSettingsCache();
  changed(...ALL_TOPICS);
  return toArchive(archiveRow(id)!);
}

/** empties what belonged to the course that ended (in the caller's transaction) */
function clearCourse(): void {
  const d = db();
  const today = localDateKey(clock.now(), tz());
  // the lessons bank: debriefs with a lesson for the next cycle stay - no longer tied to a week or an event of the course that ended
  d.run("DELETE FROM debriefs WHERE id NOT IN (SELECT debrief_id FROM debrief_items WHERE kind = 'lesson' AND horizon = 'next')");
  d.run("UPDATE debriefs SET event_id = NULL, week_id = NULL, status = 'final'");
  d.run("DELETE FROM debrief_items WHERE NOT (kind = 'lesson' AND horizon = 'next')");
  d.run('UPDATE debrief_items SET task_id = NULL');
  d.run('DELETE FROM absences WHERE end_date < ?', today);
  const tables = d
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((t) => t.name)
    .filter((t) => !CARRIED.has(t) && !IN_PART.has(t));
  // foreign keys stay on: what refers to a cleared row is cleared with it or let go (documents of a week stay)
  for (const t of tables) d.run(`DELETE FROM "${t.replace(/"/g, '""')}"`);
}

// ---------------- reading a previous course ----------------

const open = new Map<string, Db>(); // the archives open on this instance (by snapshot), most recent last
const KEEP_OPEN = 3;
const loading = new Map<string, Promise<Db>>();

/** the archive's database, fetched once per instance and brought up to the current schema */
async function archiveDb(a: ArchiveRow): Promise<Db> {
  const key = a.snapshot_id;
  const ready = open.get(key);
  if (ready) {
    open.delete(key);
    open.set(key, ready);
    return ready;
  }
  let p = loading.get(key);
  if (!p) {
    p = (async () => {
      const dir = join(config.dataDir, 'archives');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${key.replace(/[^\w~-]/g, '_')}.db`);
      if (!existsSync(path)) {
        const tmp = `${path}.${Date.now()}.part`;
        try {
          await fetchSnapshot(a.snapshot_id, tmp);
          renameSync(tmp, path);
        } finally {
          rmSync(tmp, { force: true });
        }
      }
      const d = new Db(path, { wal: false });
      migrate(d); // an archive from an older release gets the newer tables and columns
      open.set(key, d);
      while (open.size > KEEP_OPEN) {
        const [oldest, od] = open.entries().next().value!;
        open.delete(oldest);
        od.close();
      }
      return d;
    })().finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

/** the parts that always work on the current course, also while a previous one is open */
const LIVE = [/^\/share-target$/, /^\/auth\//, /^\/courses(\/|$)/, /^\/notifications(\/|$)/, /^\/push\//, /^\/client-error$/, /^\/stream$/, /^\/sync$/, /^\/admin\/snapshots/];

export function viewingCourse(req: Request): number | null {
  const v = Number(parseCookies(req.headers.cookie)[COURSE_COOKIE]);
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function setCourseCookie(res: Response, id: number | null): void {
  if (id === null) res.clearCookie(COURSE_COOKIE, { path: '/' });
  else res.cookie(COURSE_COOKIE, String(id), { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 12 * 3_600_000 });
}

/**
 * While the commander has a previous course open, the request reads that course (GET only).
 * Anyone else, or a course that no longer exists, drops the cookie and works on the current one.
 */
export async function courseScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = viewingCourse(req);
  if (id === null) return next();
  if (req.user?.role !== 'commander') {
    if (req.user) setCourseCookie(res, null);
    return next();
  }
  if (LIVE.some((r) => r.test(req.path))) return next();
  const a = archiveRow(id);
  if (!a) {
    setCourseCookie(res, null);
    return next();
  }
  if (!['GET', 'HEAD'].includes(req.method)) return next(forbidden(`פתוח כעת קורס קודם (${a.name}) - לקריאה בלבד. חזרו לקורס הנוכחי כדי לשנות.`));
  let d: Db;
  try {
    d = await archiveDb(a);
  } catch (e) {
    console.error('[courses] could not open the archive', a.id, e);
    return next(new HttpError(503, 'לא הצלחנו לפתוח את הקורס הקודם. נסו שוב בעוד רגע.'));
  }
  withDb(d, () => next());
}

/** opens a previous course for reading; null goes back to the current course */
export function viewCourse(res: Response, id: number | null): void {
  if (id !== null && !archiveRow(id)) throw notFound('הקורס לא נמצא');
  setCourseCookie(res, id);
}

/** the name of the course open for reading, for the app's banner */
export function viewingName(req: Request): { id: number; name: string } | null {
  const id = viewingCourse(req);
  if (id === null || req.user?.role !== 'commander') return null;
  const a = archiveRow(id);
  return a ? { id: a.id, name: a.name } : null;
}

// ---------------- the same week in the previous course ----------------

interface PrevTaskRow {
  id: number;
  group_id: string | null;
  title: string;
  description: string;
  owner_id: number | null;
  owner_name: string | null;
  priority: Priority;
  domain: string;
  domain_note: string;
  deadline: string;
  status: TaskStatus;
}

interface WeekRow {
  id: number;
  number: number;
  name: string;
  start_date: string;
  lead_id: number | null;
}

function liveWeek(id: number): WeekRow {
  const w = db().get<WeekRow>('SELECT id, number, name, start_date, lead_id FROM weeks WHERE id = ?', id);
  if (!w) throw notFound('השבוע לא נמצא');
  return w;
}

/** the week of the previous course that this one repeats: by name, else by number */
function matchingWeek(d: Db, w: WeekRow): Omit<WeekRow, 'lead_id'> | undefined {
  const weeks = d.all<Omit<WeekRow, 'lead_id'>>('SELECT id, number, name, start_date FROM weeks ORDER BY start_date');
  const key = searchKey(w.name);
  return weeks.find((x) => !!key && searchKey(x.name) === key) ?? weeks.find((x) => x.number === w.number);
}

/** a task of that week - "a copy for each" as one, with everyone it went to */
interface PrevItem {
  row: PrevTaskRow;
  owners: number[];
}

/**
 * The week's tasks worth repeating: not those of a recurring task (the rule carried over and
 * makes them again) nor those about a particular cadet of that course.
 */
function previousItems(d: Db, weekId: number, ids?: number[]): PrevItem[] {
  const rows = d.all<PrevTaskRow>(
    `SELECT t.id, t.group_id, t.title, t.description, t.owner_id, u.display_name AS owner_name, t.priority, t.domain, t.domain_note, t.deadline, t.status
     FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.week_id = ? AND t.parent_id IS NULL AND t.status <> 'cancelled'
       AND t.recurring_rule_id IS NULL AND t.cadet_id IS NULL AND t.experience_id IS NULL
     ORDER BY t.deadline, t.id`,
    weekId,
  );
  const items: PrevItem[] = [];
  const groups = new Map<string, PrevItem>();
  for (const r of rows) {
    const group = r.group_id ? groups.get(r.group_id) : undefined;
    if (group) {
      if (r.owner_id) group.owners.push(r.owner_id);
      continue;
    }
    const item = { row: r, owners: r.owner_id ? [r.owner_id] : [] };
    if (r.group_id) groups.set(r.group_id, item);
    items.push(item);
  }
  return ids ? items.filter((i) => ids.includes(i.row.id)) : items;
}

/** who gets a repeated task here: the same people if still on the staff, else the week's lead */
function assigneesFor(owners: number[], w: WeekRow, fallback: number): number[] {
  const active = (id: number | null) => !!id && !!db().get('SELECT 1 FROM users WHERE id = ? AND active = 1', id);
  const instead = active(w.lead_id) ? w.lead_id! : fallback;
  return [...new Set((owners.length ? owners : [0]).map((o) => (active(o) ? o : instead)))];
}

const timing = (r: PrevTaskRow, startDate: string) => ({ dayOffset: diffDays(localDateKey(r.deadline, tz()), startDate), time: localTime(r.deadline, tz()) });

/** what was done in this week in the most recent previous course - null when there is none */
export async function previousCycleWeek(weekId: number, actor: UserRow): Promise<PreviousCycleWeek | null> {
  const w = liveWeek(weekId);
  const a = db().get<ArchiveRow>(`${ARCHIVE_SELECT} ORDER BY a.archived_at DESC, a.id DESC LIMIT 1`);
  if (!a) return null;
  const prev = await archiveDb(a);
  const match = matchingWeek(prev, w);
  const out: PreviousCycleWeek = { archiveId: a.id, archiveName: a.name, week: match ? { name: match.name, number: match.number, startDate: match.start_date } : null, tasks: [] };
  if (!match) return out;
  const here = new Set(db().all<{ title: string }>('SELECT title FROM tasks WHERE week_id = ? AND parent_id IS NULL', w.id).map((t) => searchKey(t.title)));
  const names = new Map(db().all<{ id: number; display_name: string }>('SELECT id, display_name FROM users').map((u) => [u.id, u.display_name]));
  out.tasks = previousItems(prev, match.id).map(({ row: r, owners }) => {
    const to = assigneesFor(owners, w, actor.id);
    return {
      id: r.id,
      title: r.title,
      ownerName: owners.length > 1 ? null : r.owner_name,
      assigneeName: to.length > 1 ? null : (names.get(to[0]) ?? null),
      people: owners.length,
      priority: r.priority,
      domain: r.domain,
      ...timing(r, match.start_date),
      status: r.status,
      exists: here.has(searchKey(r.title)),
    };
  });
  return out;
}

export const copyPreviousSchema = z.object({
  archiveId: z.number().int().positive(),
  taskIds: z.array(z.number().int().positive()).min(1, 'לא נבחרו משימות').max(300),
});

/** repeats tasks of the previous course's week in this one, at the same point of the week */
export async function copyPreviousCycleTasks(actor: UserRow, weekId: number, raw: unknown): Promise<{ created: number; skipped: number }> {
  const p = copyPreviousSchema.parse(raw);
  const w = liveWeek(weekId);
  if (actor.role !== 'commander' && w.lead_id !== actor.id) throw forbidden('מעתיקים משימות מהמחזור הקודם - מפקד הקורס או מפק"צ השבוע');
  const a = archiveRow(p.archiveId);
  if (!a) throw notFound('הקורס הקודם לא נמצא');
  const prev = await archiveDb(a);
  const match = matchingWeek(prev, w);
  if (!match) throw notFound('השבוע הזה לא נמצא בקורס הקודם');
  const items = previousItems(prev, match.id, p.taskIds);
  const here = new Set(db().all<{ title: string }>('SELECT title FROM tasks WHERE week_id = ? AND parent_id IS NULL', w.id).map((t) => searchKey(t.title)));
  let created = 0;
  db().tx(() => {
    for (const { row: r, owners } of items) {
      if (here.has(searchKey(r.title))) continue;
      const { dayOffset, time } = timing(r, match.start_date);
      const to = assigneesFor(owners, w, actor.id);
      createTasks(actor, {
        title: r.title,
        description: [r.description, `(חוזרת מ${a.name})`].filter(Boolean).join('\n\n').slice(0, 5000),
        ownerIds: to,
        assignMode: to.length > 1 ? 'copies' : 'shared',
        deadline: zonedIso(addDays(w.start_date, dayOffset), time, tz()),
        weekId: w.id,
        priority: r.priority,
        domain: r.domain,
        domainNote: r.domain_note,
      });
      here.add(searchKey(r.title));
      created++;
    }
  });
  return { created, skipped: p.taskIds.length - created };
}

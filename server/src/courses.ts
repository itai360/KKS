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
import { isDateKey, localDateKey } from '../../shared/dates';
import type { CourseArchive, CoursesOverview, CourseStats } from '../../shared/types';
import { parseCookies, type UserRow } from './auth';
import { clock, config, forbidden, getSettings, HttpError, notFound, nowIso, resetSettingsCache, tz, updateSettings } from './core';
import { db, Db, migrate, withDb } from './db';
import { changed } from './journal';
import type { Topic } from './realtime';
import { fetchSnapshot, takeSnapshot } from './snapshots';

export const COURSE_COOKIE = 'kks_course';

/** What the next course takes with it as is. Every other table starts empty (a few, below, in part). */
const CARRIED = new Set([
  'meta',
  'users',
  'sessions',
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

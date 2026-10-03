// Staff availability: who is away when (leave, a sick day, a course, reserve duty), so a
// task is not handed to someone who is not there, and the tasks that fall on an absence
// are seen - and moved - before it starts.

import { z } from 'zod';
import { ABSENCE_REASON_LABELS, ABSENCE_REASONS, type AbsenceReason } from '../../shared/constants';
import { addDays, dayRange, diffDays, isDateKey, localDateKey, shortDate } from '../../shared/dates';
import type { Absence, UserLoad } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, notify } from './journal';
import { isCommander } from './taskRepo';

interface AbsenceRow {
  id: number;
  user_id: number;
  user_name: string;
  start_date: string;
  end_date: string;
  reason: AbsenceReason;
  note: string;
  created_by_name: string | null;
}

const BASE = `SELECT a.*, u.display_name AS user_name, c.display_name AS created_by_name
FROM absences a JOIN users u ON u.id = a.user_id LEFT JOIN users c ON c.id = a.created_by`;

/** the open tasks someone owns that are due between two days (inclusive), in the course's time zone */
function tasksDueBetween(userId: number, start: string, end: string): number {
  const from = dayRange(start, tz())[0].toISOString();
  const to = dayRange(end, tz())[1].toISOString();
  return db().get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE owner_id = ? AND status NOT IN ('done', 'cancelled') AND deadline >= ? AND deadline < ?", userId, from, to)!.n;
}

const maxDay = (a: string, b: string) => (a > b ? a : b);

function toAbsence(r: AbsenceRow): Absence {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: ABSENCE_REASONS.includes(r.reason) ? r.reason : 'other',
    note: r.note,
    createdByName: r.created_by_name,
    // from today on: what already passed is overdue, not a matter of the absence
    tasksDue: tasksDueBetween(r.user_id, maxDay(r.start_date, localDateKey(clock.now(), tz())), r.end_date),
  };
}

/** absences that touch a range of days (all current and upcoming ones by default), of one person or all */
export function listAbsences(f: { from?: string; to?: string; userId?: number } = {}): Absence[] {
  const today = localDateKey(clock.now(), tz());
  const where = ['a.end_date >= ?'];
  const params: (string | number)[] = [f.from ?? today];
  if (f.to) (where.push('a.start_date <= ?'), params.push(f.to));
  if (f.userId) (where.push('a.user_id = ?'), params.push(f.userId));
  return db()
    .all<AbsenceRow>(`${BASE} WHERE ${where.join(' AND ')} ORDER BY a.start_date, u.display_name`, ...params)
    .map(toAbsence);
}

export const absenceSchema = z
  .object({
    /** someone else's: the commander only */
    userId: z.number().int().positive().optional(),
    startDate: z.string().refine(isDateKey, 'תאריך התחלה לא תקין'),
    endDate: z.string().refine(isDateKey, 'תאריך סיום לא תקין'),
    reason: z.enum(ABSENCE_REASONS).optional().default('leave'),
    note: z.string().trim().max(300).optional().default(''),
  })
  .refine((a) => a.endDate >= a.startDate, 'תאריך הסיום לפני תאריך ההתחלה')
  .refine((a) => diffDays(a.endDate, a.startDate) <= 120, 'היעדרות של יותר מ-120 יום - עדכנו את המשתמש כלא פעיל במקום');

export function addAbsence(actor: UserRow, raw: z.input<typeof absenceSchema>): Absence {
  const a = absenceSchema.parse(raw);
  const userId = a.userId ?? actor.id;
  if (userId !== actor.id && !isCommander(actor)) throw forbidden('איש סגל מסמן היעדרות לעצמו; מפקד הקורס - לכל אחד');
  const who = getUserRow(userId);
  if (!who?.active) throw badRequest('איש הסגל אינו פעיל');
  if (db().get('SELECT 1 FROM absences WHERE user_id = ? AND start_date <= ? AND end_date >= ?', userId, a.endDate, a.startDate)) {
    throw badRequest('כבר מסומנת היעדרות בחלק מהימים האלה');
  }
  const id = db().run(
    'INSERT INTO absences(user_id, start_date, end_date, reason, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    a.startDate,
    a.endDate,
    a.reason,
    a.note,
    actor.id,
    nowIso(),
  ).id;
  const absence = toAbsence(db().get<AbsenceRow>(`${BASE} WHERE a.id = ?`, id)!);
  // the commander hears of it - with the tasks it touches, while there is time to move them
  const range = a.startDate === a.endDate ? shortDate(a.startDate) : `${shortDate(a.startDate)}-${shortDate(a.endDate)}`;
  const recipients = userId === actor.id ? commanderIds() : [userId];
  notify(
    recipients,
    {
      type: 'absence',
      category: absence.tasksDue ? 'action' : 'info',
      title: `${who.display_name} - ${ABSENCE_REASON_LABELS[a.reason]} ${range}`,
      body: absence.tasksDue ? `${absence.tasksDue === 1 ? 'משימה פתוחה אחת נופלת' : `${absence.tasksDue} משימות פתוחות נופלות`} על ימי ההיעדרות` : '',
      link: `/team/${userId}`,
    },
    actor.id,
  );
  changed('users');
  return absence;
}

export function deleteAbsence(actor: UserRow, id: number): void {
  const row = db().get<{ user_id: number }>('SELECT user_id FROM absences WHERE id = ?', id);
  if (!row) throw notFound('ההיעדרות לא נמצאה');
  if (row.user_id !== actor.id && !isCommander(actor)) throw forbidden();
  db().run('DELETE FROM absences WHERE id = ?', id);
  changed('users');
}

/** who is away on a day */
export function awayOn(date: string): Map<number, Pick<Absence, 'startDate' | 'endDate' | 'reason'>> {
  const out = new Map<number, Pick<Absence, 'startDate' | 'endDate' | 'reason'>>();
  for (const r of db().all<{ user_id: number; start_date: string; end_date: string; reason: AbsenceReason }>(
    'SELECT user_id, start_date, end_date, reason FROM absences WHERE start_date <= ? AND end_date >= ?',
    date,
    date,
  )) {
    out.set(r.user_id, { startDate: r.start_date, endDate: r.end_date, reason: r.reason });
  }
  return out;
}

/** everyone's load, and who is away on the day a task would be due (today by default) */
export function staffLoad(date?: string): UserLoad[] {
  const now = clock.now();
  const day = date ?? localDateKey(now, tz());
  const in7 = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();
  const [from, to] = dayRange(day, tz()).map((d) => d.toISOString());
  const away = awayOn(day);
  const counts = new Map<number, { week: number; overdue: number; onDay: number }>();
  for (const r of db().all<{ owner_id: number; week: number; overdue: number; on_day: number }>(
    `SELECT owner_id,
       sum(CASE WHEN recurring_rule_id IS NULL AND deadline < ? THEN 1 ELSE 0 END) AS week,
       sum(CASE WHEN deadline < ? THEN 1 ELSE 0 END) AS overdue,
       sum(CASE WHEN deadline >= ? AND deadline < ? THEN 1 ELSE 0 END) AS on_day
     FROM tasks WHERE status NOT IN ('done', 'cancelled') GROUP BY owner_id`,
    in7,
    now.toISOString(),
    from,
    to,
  )) {
    counts.set(r.owner_id, { week: r.week, overdue: r.overdue, onDay: r.on_day });
  }
  return db()
    .all<{ id: number }>('SELECT id FROM users WHERE active = 1')
    .map((u) => ({ userId: u.id, ...(counts.get(u.id) ?? { week: 0, overdue: 0, onDay: 0 }), away: away.get(u.id) ?? null }));
}

/** absences in the next two weeks with open tasks due during them - to move before they start */
export function absencesAtRisk(days = 14): Absence[] {
  const today = localDateKey(clock.now(), tz());
  return listAbsences({ from: today, to: addDays(today, days) }).filter((a) => a.tasksDue > 0);
}

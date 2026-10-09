// The daily roll call (מצבה): where each active cadet is today - present, late, sick, home,
// at an appointment, or absent - marked by team in seconds, counted for the morning report,
// and kept per cadet, so a pattern of absences is seen early.

import { z } from 'zod';
import { ATTENDANCE_IN, ATTENDANCE_LABELS, ATTENDANCE_STATUSES, type AttendanceStatus } from '../../shared/constants';
import { addDays, isDateKey, localDateKey, localTime } from '../../shared/dates';
import { byTeamAndName } from '../../shared/sort';
import type { AttendanceHistory, RollCall, RollEntry } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, clock, nowIso, tz } from './core';
import { db } from './db';
import { changed, firstTime, notify } from './journal';

const today = () => localDateKey(clock.now(), tz());

export function rollCall(date: string, teamId?: number): RollCall {
  const rows = db().all<{
    id: number;
    full_name: string;
    team_id: number | null;
    team_name: string | null;
    first_name: string;
    last_name: string;
    status: AttendanceStatus | null;
    note: string | null;
    marked_by_name: string | null;
    marked_at: string | null;
  }>(
    `SELECT c.id, trim(c.first_name || ' ' || c.last_name) AS full_name, c.first_name, c.last_name, c.team_id, t.name AS team_name,
       a.status, a.note, u.display_name AS marked_by_name, a.marked_at
     FROM cadets c LEFT JOIN teams t ON t.id = c.team_id
     LEFT JOIN attendance a ON a.cadet_id = c.id AND a.date = ?
     LEFT JOIN users u ON u.id = a.marked_by
     WHERE c.status = 'active' ${teamId ? 'AND c.team_id = ?' : ''}`,
    ...(teamId ? [date, teamId] : [date]),
  );
  rows.sort((a, b) => byTeamAndName({ team: a.team_name, last: a.last_name, first: a.first_name }, { team: b.team_name, last: b.last_name, first: b.first_name }));
  // excused today: shown on the roll, so the one marking knows
  const exempt = new Map<number, string[]>();
  for (const x of db().all<{ cadet_id: number; subject: string }>('SELECT cadet_id, subject FROM exemptions WHERE until IS NULL OR until >= ?', date)) {
    exempt.set(x.cadet_id, [...(exempt.get(x.cadet_id) ?? []), x.subject]);
  }
  const entries: RollEntry[] = rows.map((r) => ({
    cadetId: r.id,
    fullName: r.full_name,
    teamId: r.team_id,
    teamName: r.team_name,
    status: r.status && ATTENDANCE_STATUSES.includes(r.status) ? r.status : null,
    note: r.note ?? '',
    markedByName: r.marked_by_name,
    markedAt: r.marked_at,
    exemptions: exempt.get(r.id) ?? [],
  }));
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as RollCall['counts'];
  counts.total = entries.length;
  counts.unmarked = 0;
  for (const e of entries) {
    if (e.status) counts[e.status]++;
    else counts.unmarked++;
  }
  const commanders = new Map(db().all<{ id: number; name: string | null }>('SELECT t.id, u.display_name AS name FROM teams t LEFT JOIN users u ON u.id = t.commander_id').map((t) => [t.id, t.name]));
  const teams = new Map<string, RollCall['teams'][number]>();
  for (const e of entries) {
    const key = String(e.teamId ?? 0);
    const t = teams.get(key) ?? { teamId: e.teamId, name: e.teamName ?? 'ללא צוות', total: 0, marked: 0, present: 0, commanderName: e.teamId ? (commanders.get(e.teamId) ?? null) : null };
    t.total++;
    if (e.status) t.marked++;
    if (e.status && ATTENDANCE_IN.includes(e.status)) t.present++;
    teams.set(key, t);
  }
  return { date, entries, teams: [...teams.values()], counts };
}

export const markSchema = z.object({
  date: z.string().refine(isDateKey, 'תאריך לא תקין'),
  entries: z
    .array(
      z.object({
        cadetId: z.number().int().positive(),
        /** null: not marked (undo) */
        status: z.enum(ATTENDANCE_STATUSES).nullable(),
        note: z.string().trim().max(200).optional().default(''),
      }),
    )
    .min(1)
    .max(500),
});

/** marks (or clears) cadets on a day's roll; anyone on the staff may - who marked is kept */
export function markAttendance(actor: UserRow, raw: z.input<typeof markSchema>): number {
  const p = markSchema.parse(raw);
  if (p.date > addDays(today(), 14)) throw badRequest('אפשר לסמן מצבה עד שבועיים קדימה (לחופשה מתוכננת)');
  const at = nowIso();
  let n = 0;
  db().tx(() => {
    for (const e of p.entries) {
      if (!db().get("SELECT 1 FROM cadets WHERE id = ? AND status = 'active'", e.cadetId)) throw badRequest('הצוער לא נמצא או אינו פעיל');
      if (e.status === null) {
        n += db().run('DELETE FROM attendance WHERE cadet_id = ? AND date = ?', e.cadetId, p.date).changes;
        continue;
      }
      db().run(
        `INSERT INTO attendance(cadet_id, date, status, note, marked_by, marked_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cadet_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
        e.cadetId,
        p.date,
        e.status,
        // a note belongs to an absence or a late arrival: present clears it
        e.status === 'present' ? '' : e.note,
        actor.id,
        at,
      );
      n++;
    }
  });
  changed('cadets');
  return n;
}

export function attendanceHistory(cadetId: number, days = 60): AttendanceHistory {
  const rows = db().all<{ date: string; status: AttendanceStatus; note: string }>(
    'SELECT date, status, note FROM attendance WHERE cadet_id = ? AND date >= ? ORDER BY date DESC',
    cadetId,
    addDays(today(), -days),
  );
  const counts: AttendanceHistory['counts'] = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { days: rows.filter((r) => r.status !== 'present'), counts };
}

/** a day of the course: something is on the schedule */
function courseDay(date: string): boolean {
  return !!db().get('SELECT 1 FROM events WHERE date = ? AND cancelled = 0', date);
}

/**
 * On a course day from 08:30, a team commander whose team has no one marked yet is reminded
 * once; the commander gets the teams still missing at 10:00.
 */
export function rollCallReminders(now: Date): number {
  const zone = tz();
  const day = localDateKey(now, zone);
  const time = localTime(now, zone);
  if (time < '08:30' || time >= '14:00' || !courseDay(day)) return 0;
  const roll = rollCall(day);
  if (!roll.counts.total) return 0;
  let sent = 0;
  const missing = roll.teams.filter((t) => t.total > 0 && t.marked === 0);
  for (const t of missing) {
    const commander = t.teamId ? db().get<{ commander_id: number | null }>('SELECT commander_id FROM teams WHERE id = ?', t.teamId)?.commander_id : null;
    if (!commander || !firstTime(`roll:${day}:${t.teamId}`)) continue;
    notify([commander], { type: 'attendance', category: 'action', title: `מצבת ${t.name} להיום עוד לא סומנה`, body: `${t.total} צוערים - סימון בלחיצה לכל אחד`, link: `/attendance?team=${t.teamId}`, ref: `attendance:${day}:${t.teamId}` });
    sent++;
  }
  if (time >= '10:00' && missing.length && firstTime(`roll:${day}:commander`)) {
    const ids = db().all<{ id: number }>("SELECT id FROM users WHERE role = 'commander' AND active = 1").map((u) => u.id);
    notify(ids, { type: 'attendance', category: 'info', title: `מצבה: ${missing.map((t) => t.name).join(', ')} עוד לא דיווחו`, body: `סומנו ${roll.counts.total - roll.counts.unmarked} מתוך ${roll.counts.total}`, link: '/attendance', ref: `attendance:${day}` });
    sent++;
  }
  return sent;
}

/** the day's head count in a line ("52/60 · 3 גימלים · 2 בית"), for the dashboard and the brief */
export function headCountLine(roll: RollCall): string {
  const inCourse = roll.counts.present + roll.counts.late;
  const out = ATTENDANCE_STATUSES.filter((s) => !ATTENDANCE_IN.includes(s) && roll.counts[s]).map((s) => `${roll.counts[s]} ${ATTENDANCE_LABELS[s]}`);
  return [`${inCourse}/${roll.counts.total}`, ...out, roll.counts.unmarked ? `${roll.counts.unmarked} לא סומנו` : ''].filter(Boolean).join(' · ');
}

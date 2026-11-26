// The staff of a course, from cycle to cycle: some go on, some leave, new ones come. For a course opened beside
// the current one (parallel.ts), who does not go on is out of that course alone - hidden from its people and
// unable to be given anything in it - while the current course goes on as it is; whoever takes their place gets
// what was theirs there: the team they commanded, the weeks and tracks they led, their recurring tasks, what
// templates gave them, their open tasks, their place in the staff groups and in discussions still to come.
// Someone new to the staff of the next course waits for it: out of the current course, they sign in and work in
// the next one. When it becomes the current course, those out of it leave - their accounts close. In the current
// course itself, leaving is closing the account (the course goes on with the others).

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { localDateKey } from '../../shared/dates';
import type { StaffGroupDef } from '../../shared/staffGroups';
import type { CourseStaffPerson, StaffMoved } from '../../shared/types';
import { createUser, getUserRow, type UserRow } from './auth';
import { badRequest, clock, getSettings, tz, updateSettings } from './core';
import { currentSlot, db, homeDb, withDb } from './db';
import { changed, logActivity } from './journal';
import { newPassword } from './netguard';
import { newcomerIds, syncCourseUsers } from './parallel';

const today = () => localDateKey(clock.now(), tz());

/** who is out of the course in scope, and who took their place */
const outOfCourse = () => new Map(db().all<{ user_id: number; replaced_by: number | null }>('SELECT user_id, replaced_by FROM course_staff_out').map((r) => [r.user_id, r.replaced_by]));

/** the people the courses know: every open account, and the staff waiting for the next course */
function people(): { id: number; display_name: string; title: string; role: string }[] {
  return homeDb().all("SELECT id, display_name, title, role FROM users WHERE active = 1 OR id IN (SELECT user_id FROM course_staff_out) ORDER BY role, display_name");
}

/** the course's people, each with what is theirs in it - what moves to whoever takes their place */
export function courseStaff(): CourseStaffPerson[] {
  const d = db();
  const out = outOfCourse();
  const fresh = new Set(newcomerIds());
  const now = today();
  return people().map((p) => ({
    id: p.id,
    name: p.display_name,
    title: p.title ?? '',
    role: p.role === 'commander' ? 'commander' : 'staff',
    inCourse: !out.has(p.id),
    replacedBy: out.get(p.id) ?? null,
    newcomer: fresh.has(p.id),
    teams: d.all<{ name: string }>('SELECT name FROM teams WHERE commander_id = ? ORDER BY sort, name', p.id).map((t) => t.name),
    weeks: d.get<{ n: number }>('SELECT count(*) AS n FROM weeks WHERE lead_id = ? AND end_date >= ?', p.id, now)!.n,
    tracks: d.all<{ name: string }>('SELECT name FROM tracks WHERE lead_id = ? ORDER BY name', p.id).map((t) => t.name),
    tasks: d.get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE owner_id = ? AND status NOT IN ('done', 'cancelled')", p.id)!.n,
    recurring: d.get<{ n: number }>('SELECT count(*) AS n FROM recurring_rules WHERE assignee = ?', String(p.id))!.n,
  }));
}

const OPEN_TASKS = "SELECT id FROM tasks WHERE status NOT IN ('done', 'cancelled')";
const COMING_DISCUSSIONS = "SELECT id FROM discussions WHERE status = 'planned' AND held_on >= ?";

/** what was the one's in the course in scope becomes the other's (to: null - a team, a week, a track are no one's) */
function handOver(from: number, to: number | null, moved: StaffMoved): void {
  const d = db();
  const now = today();
  moved.teams += d.run('UPDATE teams SET commander_id = ? WHERE commander_id = ?', to, from).changes;
  moved.weeks += d.run('UPDATE weeks SET lead_id = ? WHERE lead_id = ? AND end_date >= ?', to, from, now).changes;
  moved.tracks += d.run('UPDATE tracks SET lead_id = ? WHERE lead_id = ?', to, from).changes;
  if (to === null) return;
  moved.recurring += d.run('UPDATE recurring_rules SET assignee = ? WHERE assignee = ?', String(to), String(from)).changes;
  for (const t of d.all<{ id: number; items: string }>('SELECT id, items FROM templates')) {
    let items: { owner?: string }[];
    try {
      items = JSON.parse(t.items) as { owner?: string }[];
    } catch {
      continue;
    }
    if (!Array.isArray(items) || !items.some((i) => i?.owner === String(from))) continue;
    d.run('UPDATE templates SET items = ? WHERE id = ?', JSON.stringify(items.map((i) => (i?.owner === String(from) ? { ...i, owner: String(to) } : i))), t.id);
    moved.templates++;
  }
  // the open tasks, and a place beside one (not beside a task that is now their own)
  moved.tasks += d.run(`UPDATE tasks SET owner_id = ? WHERE owner_id = ? AND id IN (${OPEN_TASKS})`, to, from).changes;
  d.run(`UPDATE OR IGNORE task_participants SET user_id = ? WHERE user_id = ? AND task_id IN (${OPEN_TASKS})`, to, from);
  d.run(`DELETE FROM task_participants WHERE user_id = ? AND task_id IN (${OPEN_TASKS})`, from);
  d.run('DELETE FROM task_participants WHERE user_id = ? AND task_id IN (SELECT id FROM tasks WHERE owner_id = ?)', to, to);
  // discussions still to come
  d.run(`UPDATE discussions SET lead_id = ? WHERE lead_id = ? AND id IN (${COMING_DISCUSSIONS})`, to, from, now);
  d.run(`UPDATE OR IGNORE discussion_participants SET user_id = ? WHERE user_id = ? AND discussion_id IN (${COMING_DISCUSSIONS})`, to, from, now);
  d.run(`DELETE FROM discussion_participants WHERE user_id = ? AND discussion_id IN (${COMING_DISCUSSIONS})`, from, now);
  // the staff groups the commander chose
  const groups = (getSettings().staffGroups ?? []) as StaffGroupDef[];
  if (groups.some((g) => g.memberIds?.includes(from)))
    updateSettings({ staffGroups: groups.map((g) => (g.memberIds?.includes(from) ? { ...g, memberIds: [...new Set(g.memberIds.map((m) => (m === from ? to : m)))] } : g)) });
}

export const staffChangesSchema = z.object({
  changes: z
    .array(
      z.object({
        userId: z.number().int().positive(),
        inCourse: z.boolean(),
        replacedBy: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Who goes on in the course in scope and who does not, and who takes the place of whoever does not. In a course
 * beside the current one, out of it alone; in the current course, the account closes (someone waiting for the
 * next course who is brought in starts now).
 */
export function applyStaffChanges(me: UserRow, raw: unknown): StaffMoved {
  const { changes } = staffChangesSchema.parse(raw);
  const beside = !!currentSlot();
  const d = db();
  const out = outOfCourse();
  const known = new Set(people().map((p) => p.id));
  const moved: StaffMoved = { teams: 0, weeks: 0, tracks: 0, tasks: 0, recurring: 0, templates: 0 };
  const after = (id: number) => changes.find((x) => x.userId === id)?.inCourse ?? !out.has(id);
  if (new Set(changes.map((c) => c.userId)).size !== changes.length) throw badRequest('כל איש סגל פעם אחת');
  for (const c of changes) {
    if (!known.has(c.userId)) throw badRequest('איש הסגל לא נמצא');
    if (!c.inCourse && c.userId === me.id) throw badRequest('אי אפשר להוציא את עצמך מהקורס');
    if (!c.inCourse && c.replacedBy && (c.replacedBy === c.userId || !known.has(c.replacedBy) || !after(c.replacedBy))) throw badRequest('מי שמחליף צריך להיות בסגל של הקורס');
  }
  d.tx(() => {
    // who comes back first: whoever takes a place may be one of them
    for (const c of changes) {
      if (!c.inCourse || !out.has(c.userId)) continue;
      const name = getUserRow(c.userId)?.display_name ?? '';
      d.run('DELETE FROM course_staff_out WHERE user_id = ?', c.userId);
      // the current course: someone waiting for the next one starts in this one now
      if (!beside) d.run('UPDATE users SET active = 1 WHERE id = ?', c.userId);
      logActivity({ userId: me.id, action: 'staff_change', text: `${me.display_name} החזיר את ${name} לסגל הקורס` });
    }
    for (const c of changes) {
      if (c.inCourse) continue;
      const was = out.get(c.userId);
      // already out: only a (new) replacement changes anything
      if (out.has(c.userId) && (!c.replacedBy || c.replacedBy === was)) continue;
      const name = getUserRow(c.userId)?.display_name ?? '';
      handOver(c.userId, c.replacedBy ?? null, moved);
      if (beside) {
        d.run(
          'INSERT INTO course_staff_out(user_id, replaced_by, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET replaced_by = excluded.replaced_by',
          c.userId,
          c.replacedBy ?? null,
          new Date().toISOString(),
        );
      } else {
        // the current course: whoever leaves it can no longer sign in
        d.run('UPDATE users SET active = 0 WHERE id = ?', c.userId);
        d.run('DELETE FROM sessions WHERE user_id = ?', c.userId);
        d.run('DELETE FROM course_staff_out WHERE user_id = ?', c.userId);
      }
      const by = c.replacedBy ? getUserRow(c.replacedBy)?.display_name : null;
      logActivity({ userId: me.id, action: 'staff_change', text: `${name} לא ממשיך בסגל הקורס${by ? ` - במקומו ${by}` : ''}` });
    }
  });
  // in the course beside the current one: who is in it, as its people see it
  syncCourseUsers();
  changed('users', 'tasks', 'weeks', 'cadets', 'templates', 'recurring', 'settings', 'discussions');
  return moved;
}

export const newcomerSchema = z.object({
  displayName: z.string().trim().min(1, 'חסר שם').max(80),
  title: z.string().trim().max(80).optional().default(''),
  role: z.enum(['staff', 'commander']).optional().default('staff'),
  username: z
    .string()
    .trim()
    .min(2, 'שם משתמש - לפחות 2 תווים')
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'שם משתמש - אותיות באנגלית, ספרות ונקודה'),
  /** none, with an email: they sign in with that Google account */
  password: newPassword.optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().default(''),
  email: z
    .string()
    .trim()
    .max(120)
    .optional()
    .default('')
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'כתובת מייל לא תקינה'),
});

/**
 * Someone new on the staff: an account (theirs to sign in with, the password changed at first). For a course
 * beside the current one, they wait for it - out of the current course until the next one becomes it.
 */
export function addNewcomer(me: UserRow, raw: unknown, forNext: boolean): number {
  const p = newcomerSchema.parse(raw);
  if (!p.password && !p.email) throw badRequest('חסרה סיסמה זמנית (או מייל לכניסה עם Google)');
  const home = homeDb();
  if (home.get('SELECT 1 FROM users WHERE lower(username) = lower(?)', p.username)) throw badRequest('שם המשתמש תפוס');
  if (p.email && home.get('SELECT 1 FROM users WHERE lower(email) = lower(?)', p.email)) throw badRequest('כתובת המייל כבר משויכת למשתמש אחר');
  // the accounts are the current course's (from a course beside it too)
  // signing in with Google needs no password: a random one no one knows (the commander can set one later)
  const googleOnly = !p.password;
  const password = p.password || `${randomBytes(18).toString('base64url')}A1`;
  const id = withDb(home, () => createUser({ username: p.username, password, displayName: p.displayName, title: p.title, role: p.role, phone: p.phone, email: p.email, mustChangePassword: !googleOnly }));
  if (p.email) home.run('DELETE FROM google_requests WHERE email = ?', p.email.toLowerCase());
  if (forNext) {
    home.tx(() => {
      home.run('INSERT OR IGNORE INTO course_staff_out(user_id, at) VALUES (?, ?)', id, new Date().toISOString());
      // not in the current course: its people do not see them, nothing of it is given to them
      home.run('UPDATE users SET active = 0 WHERE id = ?', id);
    });
  }
  withDb(home, () => logActivity({ userId: me.id, action: 'staff_change', text: `${me.display_name} הוסיף את ${p.displayName} לסגל${forNext ? ' של הקורס הבא' : ''}` }));
  syncCourseUsers();
  changed('users');
  return id;
}

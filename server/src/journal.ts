// Activity log (section 20) and notifications (sections 17, 73, 74).

import type { NotificationCategory } from '../../shared/constants';
import type { Notification } from '../../shared/types';
import { nowIso } from './core';
import { db, type Param } from './db';
import { sendPush } from './push';
import { broadcast, pushNotification, pushNotificationState, type Topic } from './realtime';
import { forgetStaffGroups } from './staffGroups';

/** something automation does once (a reminder, a daily brief): true the first time for a key */
export function firstTime(key: string): boolean {
  return db().run('INSERT OR IGNORE INTO automation_marks(key, at) VALUES (?, ?)', key, nowIso()).changes > 0;
}

export function changed(...topics: Topic[]): void {
  forgetStaffGroups();
  db().onCommit(() => broadcast(...topics));
}

export interface ActivityInput {
  taskId?: number | null;
  taskTitle?: string | null;
  weekId?: number | null;
  eventId?: number | null;
  userId?: number | null;
  action: string;
  text: string;
  data?: unknown;
  /** whether this counts as "the task was updated" for staleness. Default true when a user acted. */
  touches?: boolean;
}

export function logActivity(a: ActivityInput): void {
  const at = nowIso();
  let title = a.taskTitle ?? null;
  if (a.taskId && title === null) {
    title = db().get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', a.taskId)?.title ?? null;
  }
  db().run(
    'INSERT INTO activity(task_id, task_title, week_id, event_id, user_id, action, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    a.taskId ?? null,
    title,
    a.weekId ?? null,
    a.eventId ?? null,
    a.userId ?? null,
    a.action,
    a.text,
    a.data === undefined ? null : JSON.stringify(a.data),
    at,
  );
  const touches = a.touches ?? !!a.userId;
  if (a.taskId && touches) {
    db().run('UPDATE tasks SET last_activity_at = ?, updated_at = ? WHERE id = ?', at, at, a.taskId);
  }
}

export interface NotifyInput {
  type: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  taskId?: number | null;
  link?: string | null;
  /** what it is about when that is not (only) its task: "request:12", "announcement:3" - see FINISHED */
  ref?: string | null;
}

interface NotificationRow {
  id: number;
  user_id: number;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  task_id: number | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  snoozed_until?: string | null;
  ref?: string | null;
  finished_at?: string | null;
  /** read with FINISHED: its subject is finished */
  finished?: number | null;
}

// ---------------- what is finished leaves the bell ----------------

/** the news of something done (completed, approved, cancelled, closed, summed up): finished as it comes */
const NEWS_OF_DONE = ['task_done', 'group_done', 'approved', 'cancelled', 'deleted', 'week_closed', 'week_approved', 'weekly_summary', 'event_cancelled'];
/** the kinds about one task: once the task is gone (deleted, done, cancelled), so are they */
const TASK_KINDS = [
  'task_assigned',
  'deadline_changed',
  'owner_changed',
  'dependency_done',
  'blocked',
  'unblocked',
  'approval_requested',
  'returned',
  'reopened',
  'escalated',
  'instruction',
  'update',
  'request',
  'request_decided',
  'carried',
  'overdue',
  'critical_overdue',
  'reminder_24h',
  'reminder_2h',
];
/** about a task, to the ones on it: once it is no longer theirs (passed to someone else), neither are these */
const TO_THE_ONES_ON_IT = ['task_assigned', 'reminder_24h', 'reminder_2h', 'overdue', 'returned', 'reopened', 'carried', 'unblocked'];
/** a newer one of the same kind about the same task says it again (blocked again, sent back again): the older one is done with -
 * not a request (each is its own) and not what someone wrote (each says something else). Marked as the newer one comes
 * (replaceOlder), so deleting the newer one does not bring the older back. */
const SAID_AGAIN = TASK_KINDS.filter((k) => !['request', 'instruction', 'update'].includes(k));
const REMINDERS = ['reminder_24h', 'reminder_2h'];
const quoted = (list: string[]) => list.map((x) => `'${x}'`).join(', ');
/** the number in a ref: "request:12" -> 12 */
const REF_ID = "CAST(substr(n.ref, instr(n.ref, ':') + 1) AS INTEGER)";
/** the event a schedule link opens: "/schedule?date=2026-10-09&event=7" -> 7 */
const eventOf = (link: string) => `CAST(substr(${link}, instr(${link}, '&event=') + 7) AS INTEGER)`;
/** an announcement this person has done with: confirmed (or read, when it asks for no confirmation) */
const ANNOUNCEMENT_DONE = 'EXISTS (SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = n.user_id AND (ar.acked_at IS NOT NULL OR a.require_ack = 0))';

/** the rows FINISHED reads: a notification and its task */
export const NOTIFICATIONS_FROM = 'notifications n LEFT JOIN tasks t ON t.id = n.task_id';

/**
 * Whether what a notification is about is finished - SQL over NOTIFICATIONS_FROM, 1 or 0. A finished one
 * is out of the bell, the notifications page and the count of unread: its task done, cancelled, deleted or
 * passed to someone else; a closing waiting for approval approved or sent back; a request decided; a
 * blocker cleared; a call for a decision answered; "overdue" answered or with the deadline moved past it;
 * a closure in the weekly done; a committee decided; the week's debrief summed up; an announcement
 * confirmed; a roll call marked; a week closed; an event cancelled; and the news of something done.
 * Marked (finished_at): the same said again by a newer one (replaceOlder), and an earlier cycle's
 * lessons all decided (debriefs.ts). Nothing is deleted for it: a task opened again brings its
 * notifications back.
 */
export const FINISHED = `coalesce((CASE
  WHEN n.finished_at IS NOT NULL THEN 1
  WHEN n.type IN (${quoted(NEWS_OF_DONE)}) THEN 1
  WHEN n.type = 'request_decided' AND n.category = 'info' THEN 1
  WHEN n.type IN (${quoted(TASK_KINDS)}) AND (n.task_id IS NULL OR t.id IS NULL OR t.status IN ('done', 'cancelled')) THEN 1
  WHEN n.type = 'request' THEN NOT EXISTS (SELECT 1 FROM requests rq WHERE rq.status = 'pending' AND (CASE WHEN n.ref LIKE 'request:%' THEN rq.id = ${REF_ID} ELSE rq.task_id = n.task_id END))
  WHEN n.type IN (${quoted(TO_THE_ONES_ON_IT)}) AND t.owner_id <> n.user_id AND NOT EXISTS (SELECT 1 FROM task_participants tp WHERE tp.task_id = t.id AND tp.user_id = n.user_id) THEN 1
  WHEN n.type = 'approval_requested' THEN t.status <> 'pending_approval'
  WHEN n.type = 'blocked' THEN t.status <> 'waiting'
  WHEN n.type = 'escalated' THEN t.needs_commander = 0
  WHEN n.type = 'returned' THEN t.status = 'pending_approval'
  WHEN n.type = 'overdue' THEN t.deadline > n.created_at OR coalesce(t.overdue_response_at, '') >= n.created_at
  WHEN n.type = 'critical_overdue' THEN t.deadline > n.created_at
  WHEN n.task_id IS NOT NULL THEN t.id IS NULL OR t.status IN ('done', 'cancelled')
  WHEN n.ref LIKE 'announcement:%' THEN NOT EXISTS (SELECT 1 FROM announcements a WHERE a.id = ${REF_ID} AND NOT ${ANNOUNCEMENT_DONE})
  WHEN n.type = 'announcement' THEN NOT EXISTS (SELECT 1 FROM announcements a WHERE a.created_at <= n.created_at AND NOT ${ANNOUNCEMENT_DONE})
  WHEN n.ref LIKE 'weekly-item:%' THEN NOT EXISTS (SELECT 1 FROM weekly_items wi WHERE wi.id = ${REF_ID} AND wi.done = 0 AND wi.owner_id = n.user_id)
  WHEN n.type = 'weekly_closure' THEN NOT EXISTS (SELECT 1 FROM weekly_items wi WHERE wi.kind = 'closure' AND wi.done = 0 AND wi.owner_id = n.user_id AND n.link = '/weekly/' || wi.week_id)
  WHEN n.type = 'committee' AND n.category = 'info' THEN 1
  WHEN n.ref LIKE 'committee:%' THEN NOT EXISTS (SELECT 1 FROM committees cm WHERE cm.id = ${REF_ID} AND cm.decision IS NULL)
  WHEN n.type = 'committee' THEN NOT EXISTS (SELECT 1 FROM committees cm WHERE cm.decision IS NULL AND n.link = '/evaluations/' || cm.cadet_id)
  WHEN n.type = 'debrief' AND n.category = 'info' THEN 1
  WHEN n.type = 'debrief' AND n.link LIKE '/debriefs?new=weekly&week=%' THEN EXISTS (SELECT 1 FROM debriefs d WHERE d.kind = 'weekly' AND d.status = 'final' AND n.link = '/debriefs?new=weekly&week=' || d.week_id)
  WHEN n.type = 'week_lead' THEN NOT EXISTS (SELECT 1 FROM weeks w WHERE w.status <> 'closed' AND w.lead_id = n.user_id AND n.link = '/weeks/' || w.id)
  WHEN n.type = 'track_lead' THEN NOT EXISTS (SELECT 1 FROM tracks tr WHERE tr.lead_id = n.user_id AND n.link = '/tracks/' || tr.id)
  WHEN n.type = 'event_owner' AND n.link LIKE '%&event=%' THEN NOT EXISTS (SELECT 1 FROM events e WHERE e.cancelled = 0 AND e.owner_id = n.user_id AND e.id = ${eventOf('n.link')})
  WHEN n.type = 'event_changed' AND n.link LIKE '%&event=%' THEN NOT EXISTS (SELECT 1 FROM events e WHERE e.cancelled = 0 AND e.id = ${eventOf('n.link')})
  WHEN n.ref LIKE 'attendance:%' THEN NOT EXISTS (SELECT 1 FROM cadets c WHERE c.status = 'active'
    AND (length(n.ref) <= 21 OR c.team_id = CAST(substr(n.ref, 23) AS INTEGER))
    AND NOT EXISTS (SELECT 1 FROM attendance att WHERE att.cadet_id = c.id AND att.date = substr(n.ref, 12, 10)))
  ELSE 0
END), 0)`;

/** notifications with their task, each with whether it is finished ("finished": 1 / 0) */
export const NOTIFICATION_ROWS = `SELECT n.*, ${FINISHED} AS finished FROM ${NOTIFICATIONS_FROM}`;

export function toNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    title: r.title,
    body: r.body,
    taskId: r.task_id,
    link: r.link ?? (r.task_id ? `/tasks/${r.task_id}` : null),
    read: !!r.read_at,
    createdAt: r.created_at,
    snoozedUntil: r.snoozed_until ?? null,
    ...(r.finished ? { finished: true } : {}),
  };
}

/** how many unread - of the ones still open (what is finished does not count) */
export function unreadCount(userId: number): number {
  return db().get<{ n: number }>(`SELECT count(*) AS n FROM ${NOTIFICATIONS_FROM} WHERE n.user_id = ? AND n.read_at IS NULL AND NOT ${FINISHED}`, userId)!.n;
}

/** what some notifications are about was finished in a way the rules of FINISHED cannot see (an earlier
 * cycle's lessons all decided): marked so - and unmarked when it opens again (a decision taken back) */
export function finishNotifications(finished: boolean, where: string, ...params: Param[]): void {
  const rows = db().all<{ id: number; user_id: number }>(`SELECT id, user_id FROM notifications WHERE (${where}) AND finished_at IS ${finished ? '' : 'NOT '}NULL`, ...params);
  for (const r of rows) {
    db().run('UPDATE notifications SET finished_at = ? WHERE id = ?', finished ? nowIso() : null, r.id);
    notificationsChanged(r.user_id);
  }
}

// people whose notifications changed in this write: each of their open screens hears once, after it is saved
const changedFor = new Set<number>();
let flushing = false;

/** someone's notifications changed (read, unread, put off, deleted, back): their other devices follow at once */
export function notificationsChanged(userId: number): void {
  changedFor.add(userId);
  db().onCommit(() => {
    if (flushing) return;
    flushing = true;
    queueMicrotask(() => {
      flushing = false;
      const ids = [...changedFor];
      changedFor.clear();
      for (const id of ids) pushNotificationState(id, unreadCount(id));
    });
  });
}

/** put off until a time: out of the list and the count until then */
export function snoozeNotification(userId: number, id: number, until: string | null): boolean {
  if (until === null) return resurface(db().all<NotificationRow>('SELECT * FROM notifications WHERE id = ? AND user_id = ? AND snoozed_until IS NOT NULL', id, userId)) > 0;
  return db().run('UPDATE notifications SET snoozed_until = ?, read_at = ? WHERE id = ? AND user_id = ?', until, nowIso(), id, userId).changes > 0;
}

/** snoozed notifications whose time has come: back on top, unread, with the bell and the push again -
 * unless what they were about was finished meanwhile: those just stop waiting */
export function wakeSnoozed(now: string): number {
  const due = db().all<NotificationRow>(`${NOTIFICATION_ROWS} WHERE n.snoozed_until IS NOT NULL AND n.snoozed_until <= ?`, now);
  for (const r of due.filter((r) => r.finished)) db().run('UPDATE notifications SET snoozed_until = NULL WHERE id = ?', r.id);
  return resurface(due.filter((r) => !r.finished));
}

function resurface(rows: NotificationRow[]): number {
  const at = nowIso();
  for (const r of rows) {
    db().run('UPDATE notifications SET snoozed_until = NULL, read_at = NULL, created_at = ? WHERE id = ?', at, r.id);
    notificationsChanged(r.user_id);
    const n = toNotification({ ...r, read_at: null, created_at: at, snoozed_until: null, finished: null });
    db().onCommit(() => {
      pushNotification(r.user_id, n);
      void sendPush(r.user_id, n).catch((e) => console.error('[push]', e));
    });
  }
  return rows.length;
}

/** a new one to someone says again what older ones said (the task blocked again, a new reminder, today's roll
 * call, the event changed again): those are done with - marked now, so deleting the new one leaves them so */
function replaceOlder(uid: number, n: NotifyInput, id: number, at: string): void {
  const mark = (where: string, ...params: Param[]) =>
    db().run(`UPDATE notifications SET finished_at = ? WHERE user_id = ? AND id < ? AND finished_at IS NULL AND ${where}`, at, uid, id, ...params);
  if (n.taskId && SAID_AGAIN.includes(n.type)) mark('task_id = ? AND type = ?', n.taskId, n.type);
  if (n.taskId && [...REMINDERS, 'overdue'].includes(n.type)) mark(`task_id = ? AND type IN (${quoted(REMINDERS)})`, n.taskId);
  // another team's roll call the same day is its own
  if (n.type === 'attendance') mark("type = 'attendance' AND (ref IS NULL OR substr(ref, 12, 10) <> ?)", n.ref?.slice(11, 21) ?? '');
  if (n.type === 'brief') mark("type = 'brief'");
  const event = n.type === 'event_changed' ? /&event=(\d+)$/.exec(n.link ?? '')?.[1] : undefined;
  if (event) mark("type = 'event_changed' AND link LIKE ?", `%&event=${event}`);
}

/** Sends a notification to each recipient except the actor who caused it. */
export function notify(userIds: Iterable<number | null | undefined>, n: NotifyInput, actorId?: number | null): void {
  const seen = new Set<number>();
  for (const uid of userIds) {
    if (!uid || seen.has(uid) || uid === actorId) continue;
    seen.add(uid);
    const created = nowIso();
    const id = db().run(
      'INSERT INTO notifications(user_id, type, category, title, body, task_id, link, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      uid,
      n.type,
      n.category,
      n.title,
      n.body ?? '',
      n.taskId ?? null,
      n.link ?? null,
      n.ref ?? null,
      created,
    ).id;
    replaceOlder(uid, n, id, created);
    // the news of something done is finished as it comes: it is heard (a message, the phone), not kept in the bell
    const row = db().get<NotificationRow>(`${NOTIFICATION_ROWS} WHERE n.id = ?`, id)!;
    notificationsChanged(uid);
    db().onCommit(() => {
      const n = toNotification(row);
      pushNotification(uid, n);
      void sendPush(uid, n).catch((e) => console.error('[push]', e));
    });
  }
}

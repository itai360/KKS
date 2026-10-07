// Activity log (section 20) and notifications (sections 17, 73, 74).

import type { NotificationCategory } from '../../shared/constants';
import type { Notification } from '../../shared/types';
import { nowIso } from './core';
import { db } from './db';
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
}

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
  };
}

export function unreadCount(userId: number): number {
  return db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n;
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

/** snoozed notifications whose time has come: back on top, unread, with the bell and the push again */
export function wakeSnoozed(now: string): number {
  return resurface(db().all<NotificationRow>('SELECT * FROM notifications WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?', now));
}

function resurface(rows: NotificationRow[]): number {
  const at = nowIso();
  for (const r of rows) {
    db().run('UPDATE notifications SET snoozed_until = NULL, read_at = NULL, created_at = ? WHERE id = ?', at, r.id);
    notificationsChanged(r.user_id);
    const n = toNotification({ ...r, read_at: null, created_at: at, snoozed_until: null });
    db().onCommit(() => {
      pushNotification(r.user_id, n);
      void sendPush(r.user_id, n).catch((e) => console.error('[push]', e));
    });
  }
  return rows.length;
}

/** Sends a notification to each recipient except the actor who caused it. */
export function notify(userIds: Iterable<number | null | undefined>, n: NotifyInput, actorId?: number | null): void {
  const seen = new Set<number>();
  for (const uid of userIds) {
    if (!uid || seen.has(uid) || uid === actorId) continue;
    seen.add(uid);
    const created = nowIso();
    const id = db().run(
      'INSERT INTO notifications(user_id, type, category, title, body, task_id, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uid,
      n.type,
      n.category,
      n.title,
      n.body ?? '',
      n.taskId ?? null,
      n.link ?? null,
      created,
    ).id;
    const row = db().get<NotificationRow>('SELECT * FROM notifications WHERE id = ?', id)!;
    notificationsChanged(uid);
    db().onCommit(() => {
      const n = toNotification(row);
      pushNotification(uid, n);
      void sendPush(uid, n).catch((e) => console.error('[push]', e));
    });
  }
}

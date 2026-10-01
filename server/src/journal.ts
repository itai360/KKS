// Activity log (section 20) and notifications (sections 17, 73, 74).

import type { NotificationCategory } from '../../shared/constants';
import type { Notification } from '../../shared/types';
import { nowIso } from './core';
import { db } from './db';
import { broadcast, pushNotification, type Topic } from './realtime';

export function changed(...topics: Topic[]): void {
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
  };
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
    db().onCommit(() => pushNotification(uid, toNotification(row)));
  }
}

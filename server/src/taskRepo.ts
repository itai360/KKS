// Loading tasks, shaping them for the API, and deciding who may see / do what.

import { isOpenStatus, type OverdueResponse, type Priority, type Role, type TaskStatus, type Visibility } from '../../shared/constants';
import { computeFlags } from '../../shared/taskLogic';
import type { Task, TaskPermissions } from '../../shared/types';
import type { UserRow } from './auth';
import { clock, getSettings, notFound } from './core';
import { db } from './db';

export interface TaskRow {
  id: number;
  title: string;
  description: string;
  owner_id: number;
  created_by: number;
  deadline: string;
  priority: Priority;
  status: TaskStatus;
  domain: string;
  week_id: number | null;
  event_id: number | null;
  parent_id: number | null;
  group_id: string | null;
  meeting_id: number | null;
  recurring_rule_id: number | null;
  cadet_id: number | null;
  experience_id: number | null;
  debrief_id: number | null;
  requires_approval: number;
  visibility: Visibility;
  block_reason: string | null;
  block_waiting_for: string | null;
  block_next_step: string | null;
  needs_commander: number;
  overdue_response: OverdueResponse | null;
  overdue_response_at: string | null;
  cancel_reason: string | null;
  carried_count: number;
  reminded_24h: number;
  reminded_2h: number;
  overdue_notified: number;
  started_at: string | null;
  completed_at: string | null;
  completed_late: number | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  owner_name: string;
  created_by_name: string;
  creator_role: Role;
  week_name: string | null;
  week_lead_id: number | null;
  event_title: string | null;
  cadet_name: string | null;
  debrief_title: string | null;
  subtask_total: number;
  subtask_done: number;
  open_deps: number;
  participant_ids: string | null;
}

const BASE = `
SELECT t.*, o.display_name AS owner_name, c.display_name AS created_by_name, c.role AS creator_role,
  w.name AS week_name, w.lead_id AS week_lead_id, e.title AS event_title,
  trim(cd.first_name || ' ' || cd.last_name) AS cadet_name, db.title AS debrief_title,
  (SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.status <> 'cancelled') AS subtask_total,
  (SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtask_done,
  (SELECT count(*) FROM task_dependencies d JOIN tasks dt ON dt.id = d.depends_on_id
     WHERE d.task_id = t.id AND dt.status NOT IN ('done', 'cancelled')) AS open_deps,
  (SELECT group_concat(p.user_id) FROM task_participants p WHERE p.task_id = t.id) AS participant_ids
FROM tasks t
JOIN users o ON o.id = t.owner_id
JOIN users c ON c.id = t.created_by
LEFT JOIN weeks w ON w.id = t.week_id
LEFT JOIN events e ON e.id = t.event_id
LEFT JOIN cadets cd ON cd.id = t.cadet_id
LEFT JOIN debriefs db ON db.id = t.debrief_id
`;

export function queryTasks(where = '1=1', ...params: (string | number | null)[]): TaskRow[] {
  return db().all<TaskRow>(`${BASE} WHERE ${where} ORDER BY t.deadline ASC, t.id ASC`, ...params);
}

export function getTaskRow(id: number): TaskRow | undefined {
  return db().get<TaskRow>(`${BASE} WHERE t.id = ?`, id);
}

export function mustTaskRow(id: number): TaskRow {
  const t = getTaskRow(id);
  if (!t) throw notFound('המשימה לא נמצאה');
  return t;
}

export function participantsOf(t: TaskRow): number[] {
  return t.participant_ids ? t.participant_ids.split(',').map(Number) : [];
}

export function toTask(r: TaskRow, now = clock.now(), staleDays = getSettings().staleDays): Task {
  const flags = computeFlags(
    { status: r.status, priority: r.priority, deadline: r.deadline, lastActivityAt: r.last_activity_at },
    now,
    staleDays,
  );
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    participantIds: participantsOf(r),
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    creatorRole: r.creator_role,
    deadline: r.deadline,
    priority: r.priority,
    status: r.status,
    domain: r.domain,
    weekId: r.week_id,
    weekName: r.week_name,
    eventId: r.event_id,
    eventTitle: r.event_title,
    parentId: r.parent_id,
    groupId: r.group_id,
    meetingId: r.meeting_id,
    recurringRuleId: r.recurring_rule_id,
    cadetId: r.cadet_id,
    cadetName: r.cadet_name,
    experienceId: r.experience_id,
    debriefId: r.debrief_id,
    debriefTitle: r.debrief_title,
    requiresApproval: !!r.requires_approval,
    visibility: r.visibility,
    blockReason: r.block_reason,
    blockWaitingFor: r.block_waiting_for,
    blockNextStep: r.block_next_step,
    needsCommander: !!r.needs_commander,
    overdueResponse: r.overdue_response,
    overdueResponseAt: r.overdue_response_at,
    cancelReason: r.cancel_reason,
    carriedCount: r.carried_count,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at,
    subtaskTotal: r.subtask_total,
    subtaskDone: r.subtask_done,
    openDependencies: r.open_deps,
    ...flags,
  };
}

// ---------------- permissions (sections 2 and 21) ----------------

export const isCommander = (u: Pick<UserRow, 'role'>) => u.role === 'commander';

export function canView(u: UserRow, t: TaskRow): boolean {
  if (isCommander(u)) return true;
  if (t.owner_id === u.id || t.created_by === u.id) return true;
  if (participantsOf(t).includes(u.id)) return true;
  if (t.visibility === 'team') return true;
  if (t.visibility !== 'private' && t.week_lead_id === u.id) return true;
  return false;
}

/** Title, description, priority, etc. Only the commander or whoever created the task. */
export function canEdit(u: UserRow, t: TaskRow): boolean {
  return isCommander(u) || t.created_by === u.id;
}

/** A staff member cannot move a deadline the commander set (section 2) - they request it (section 62). */
export function canChangeDeadline(u: UserRow, t: TaskRow): boolean {
  return isCommander(u) || t.created_by === u.id;
}

/** Re-assigning needs approval (section 2), except a week lead organising their own week. */
export function canChangeOwner(u: UserRow, t: TaskRow): boolean {
  if (isCommander(u)) return true;
  return t.created_by === u.id && t.week_lead_id === u.id;
}

/** Staff cannot delete tasks the commander assigned them (section 2). */
export function canDelete(u: UserRow, t: TaskRow): boolean {
  return isCommander(u) || t.created_by === u.id;
}

export function canUpdateStatus(u: UserRow, t: TaskRow): boolean {
  return isCommander(u) || t.owner_id === u.id || t.created_by === u.id || participantsOf(t).includes(u.id);
}

/** Who approves a completion (section 45/46) or a deadline/transfer request. */
export function canApprove(u: UserRow, t: TaskRow): boolean {
  if (isCommander(u)) return true;
  return t.created_by === u.id && t.creator_role !== 'commander' && t.owner_id !== u.id;
}

export function permissionsFor(u: UserRow, t: TaskRow): TaskPermissions {
  const open = isOpenStatus(t.status);
  const deadline = canChangeDeadline(u, t);
  const owner = canChangeOwner(u, t);
  const involved = t.owner_id === u.id || participantsOf(t).includes(u.id);
  return {
    canEdit: canEdit(u, t),
    canChangeDeadline: deadline,
    canChangeOwner: owner,
    canDelete: canDelete(u, t),
    canUpdateStatus: canUpdateStatus(u, t),
    canApprove: canApprove(u, t),
    canCancel: canEdit(u, t),
    canRequestDeadline: open && !deadline && involved,
    canRequestTransfer: open && !owner && involved,
  };
}

export function visibleTasks(u: UserRow, where = '1=1', ...params: (string | number | null)[]): Task[] {
  const now = clock.now();
  const stale = getSettings().staleDays;
  return queryTasks(where, ...params)
    .filter((r) => canView(u, r))
    .map((r) => toTask(r, now, stale));
}

/** Users that approve a request or completion on this task. */
export function approverIds(t: TaskRow): number[] {
  const commanders = db()
    .all<{ id: number }>("SELECT id FROM users WHERE role = 'commander' AND active = 1")
    .map((r) => r.id);
  if (t.creator_role !== 'commander' && t.created_by !== t.owner_id) return [t.created_by, ...commanders];
  return commanders;
}

export function involvedIds(t: TaskRow): number[] {
  return [t.owner_id, ...participantsOf(t)];
}

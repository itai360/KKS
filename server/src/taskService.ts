// Task business rules: creation, edits, the status flow (section 47), blockers
// (43-44), approvals (45-46), overdue responses (61), requests (62-63).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BLOCK_REASONS,
  domainLabel,
  isOpenStatus,
  OTHER_DOMAIN,
  OVERDUE_RESPONSE_LABELS,
  OVERDUE_RESPONSES,
  PRIORITIES,
  PRIORITY_LABELS,
  VISIBILITIES,
  VISIBILITY_LABELS,
} from '../../shared/constants';
import { formatDateTime, HOUR, localDateKey } from '../../shared/dates';
import type { GroupProgress, TaskDetail, TaskRequest } from '../../shared/types';
import { commanderIds, getUserRow, staffIds, type UserRow } from './auth';
import { badRequest, clock, forbidden, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import {
  approverIds,
  canApprove,
  canChangeDeadline,
  canChangeOwner,
  canDelete,
  canEdit,
  canUpdateStatus,
  canView,
  getTaskRow,
  involvedIds,
  isCommander,
  mustTaskRow,
  participantsOf,
  permissionsFor,
  queryTasks,
  toTask,
  type TaskRow,
} from './taskRepo';

export const isoDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'תאריך לא תקין')
  .transform((s) => new Date(s).toISOString());

const linkSchema = z.object({
  url: z.string().trim().url('קישור לא תקין').refine((u) => /^https?:\/\//i.test(u), 'קישור חייב להתחיל ב-http'),
  title: z.string().trim().max(200).optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'חובה למלא שם משימה').max(200),
  description: z.string().max(5000).optional().default(''),
  assignMode: z.enum(['shared', 'copies', 'all']).optional().default('shared'),
  ownerIds: z.array(z.number().int().positive()).optional().default([]),
  deadline: isoDateTime,
  priority: z.enum(PRIORITIES).optional().default('normal'),
  domain: z.string().trim().max(60).optional().default(''),
  /** the area "אחר": what it is */
  domainNote: z.string().trim().max(120).optional().default(''),
  weekId: z.number().int().positive().nullable().optional(),
  /** the course track; not given - the track named like the task's area, if there is one */
  trackId: z.number().int().positive().nullable().optional(),
  eventId: z.number().int().positive().nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  meetingId: z.number().int().positive().nullable().optional(),
  cadetId: z.number().int().positive().nullable().optional(),
  experienceId: z.number().int().positive().nullable().optional(),
  debriefId: z.number().int().positive().nullable().optional(),
  requiresApproval: z.boolean().optional().default(false),
  visibility: z.enum(VISIBILITIES).optional().default('normal'),
  links: z.array(linkSchema).optional().default([]),
  dependsOn: z.array(z.number().int().positive()).optional().default([]),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export interface CreateOptions {
  /** created by automation (templates/recurring) on behalf of a user - skips staff restrictions */
  system?: boolean;
  /** do not notify owners (recurring tasks would otherwise flood everyone, section 74) */
  silent?: boolean;
  recurringRuleId?: number;
  activityText?: string;
}

const fmt = (iso: string) => formatDateTime(iso, tz());

export function weekForDate(dateKey: string): number | null {
  return (
    db().get<{ id: number }>('SELECT id FROM weeks WHERE start_date <= ? AND end_date >= ? ORDER BY start_date LIMIT 1', dateKey, dateKey)
      ?.id ?? null
  );
}

/** the track named like an area (שטח, ניווטים...) - where a task in that area goes unless told otherwise */
export function trackForDomain(domain: string): number | null {
  return domain ? (db().get<{ id: number }>('SELECT id FROM tracks WHERE name = ?', domain)?.id ?? null) : null;
}

function weekLead(weekId: number | null | undefined): number | null {
  if (!weekId) return null;
  return db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', weekId)?.lead_id ?? null;
}

function requireActiveUser(id: number): UserRow {
  const u = getUserRow(id);
  if (!u || !u.active) throw badRequest('איש הסגל שנבחר אינו קיים או אינו פעיל');
  return u;
}

function reminderFlags(deadline: string) {
  const left = Date.parse(deadline) - clock.now().getTime();
  return {
    reminded24: left <= 24 * HOUR ? 1 : 0,
    reminded2: left <= 2 * HOUR ? 1 : 0,
    overdueNotified: left < 0 ? 1 : 0,
  };
}

export function createTasks(actor: UserRow, raw: CreateTaskInput, opts: CreateOptions = {}): number[] {
  const input = createTaskSchema.parse(raw);
  const commander = isCommander(actor);

  let weekId = input.weekId;
  let parent: TaskRow | undefined;
  if (input.parentId) {
    parent = getTaskRow(input.parentId);
    if (!parent || (!opts.system && !canView(actor, parent))) throw badRequest('משימת האב לא נמצאה');
    if (weekId === undefined) weekId = parent.week_id;
  }
  let trackId = input.trackId;
  if (trackId === undefined) trackId = parent?.track_id ?? trackForDomain(input.domain);
  if (trackId && !db().get('SELECT 1 FROM tracks WHERE id = ?', trackId)) throw badRequest('הציר לא נמצא');
  if (weekId === undefined) weekId = weekForDate(localDateKey(input.deadline, tz()));
  if (weekId && !db().get('SELECT 1 FROM weeks WHERE id = ?', weekId)) throw badRequest('השבוע לא נמצא');
  if (input.eventId && !db().get('SELECT 1 FROM events WHERE id = ?', input.eventId)) throw badRequest('הפעילות לא נמצאה');
  if (input.cadetId && !db().get('SELECT 1 FROM cadets WHERE id = ?', input.cadetId)) throw badRequest('הצוער לא נמצא');
  if (input.experienceId && !db().get('SELECT 1 FROM experiences WHERE id = ?', input.experienceId)) throw badRequest('ההתנסות לא נמצאה');
  if (input.debriefId && !db().get('SELECT 1 FROM debriefs WHERE id = ?', input.debriefId)) throw badRequest('התחקיר לא נמצא');

  let owners: number[];
  if (input.assignMode === 'all') {
    if (!commander && !opts.system) throw forbidden('רק מפקד הקורס יכול לפתוח משימה לכל הסגל');
    owners = staffIds().filter((id) => id !== actor.id);
    if (!owners.length) throw badRequest('אין אנשי סגל פעילים');
  } else {
    owners = [...new Set(input.ownerIds)];
    if (!owners.length) throw badRequest('חובה לבחור אחראי');
    owners.forEach(requireActiveUser);
  }

  // Section 2: staff open tasks for themselves and for other staff members; for the course
  // commander only within the week they lead.
  if (!commander && !opts.system) {
    const lead = weekLead(weekId);
    const above = owners.filter((id) => id !== actor.id && getUserRow(id)?.role !== 'staff');
    if (above.length && lead !== actor.id) {
      throw forbidden('איש סגל יכול לפתוח משימה לעצמו ולשאר הסגל; למפקד הקורס - רק בשבוע שבאחריותו');
    }
  }

  const deps = [...new Set(input.dependsOn)];
  for (const d of deps) if (!db().get('SELECT 1 FROM tasks WHERE id = ?', d)) throw badRequest('משימת התלות לא נמצאה');

  // shared -> one task, first owner is the single accountable owner (section 78)
  // copies/all -> a separate copy for each person, tracked together (section 64)
  const asCopies = input.assignMode === 'all' || (input.assignMode === 'copies' && owners.length > 1);
  const groupId = asCopies ? randomUUID() : null;
  const units: { owner: number; participants: number[] }[] = asCopies
    ? owners.map((o) => ({ owner: o, participants: [] }))
    : [{ owner: owners[0], participants: owners.slice(1) }];

  const ids: number[] = [];
  db().tx(() => {
    for (const unit of units) {
      const at = nowIso();
      const flags = reminderFlags(input.deadline);
      const id = db().run(
        `INSERT INTO tasks(title, description, owner_id, created_by, deadline, priority, status, domain, domain_note, week_id, track_id, event_id,
           parent_id, group_id, meeting_id, recurring_rule_id, cadet_id, experience_id, debrief_id, requires_approval, visibility,
           reminded_24h, reminded_2h, overdue_notified, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.title,
        input.description,
        unit.owner,
        actor.id,
        input.deadline,
        input.priority,
        input.domain,
        input.domain === OTHER_DOMAIN ? input.domainNote : '',
        weekId ?? null,
        trackId ?? null,
        input.eventId ?? null,
        input.parentId ?? null,
        groupId,
        input.meetingId ?? null,
        opts.recurringRuleId ?? null,
        input.cadetId ?? null,
        input.experienceId ?? null,
        input.debriefId ?? null,
        input.requiresApproval,
        input.visibility,
        flags.reminded24,
        flags.reminded2,
        flags.overdueNotified,
        at,
        at,
        at,
      ).id;
      ids.push(id);
      for (const p of unit.participants) db().run('INSERT INTO task_participants(task_id, user_id) VALUES (?, ?)', id, p);
      for (const d of deps) db().run('INSERT OR IGNORE INTO task_dependencies(task_id, depends_on_id) VALUES (?, ?)', id, d);
      for (const l of input.links) {
        db().run(
          "INSERT INTO attachments(task_id, user_id, kind, title, url, created_at) VALUES (?, ?, 'link', ?, ?, ?)",
          id,
          actor.id,
          l.title || l.url,
          l.url,
          at,
        );
      }
      logActivity({
        taskId: id,
        taskTitle: input.title,
        weekId: weekId ?? null,
        userId: actor.id,
        action: 'created',
        text: opts.activityText ?? `${actor.display_name} יצר את המשימה`,
      });
      if (!opts.silent) {
        notify(
          [unit.owner, ...unit.participants],
          {
            type: 'task_assigned',
            category: 'action',
            title: `נוספה לך משימה חדשה: "${input.title}"`,
            body: `מאת ${actor.display_name} · דד-ליין ${fmt(input.deadline)}`,
            taskId: id,
          },
          actor.id,
        );
      }
    }
  });
  changed('tasks', 'weeks');
  return ids;
}

// ---------------- edits ----------------

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    priority: z.enum(PRIORITIES),
    domain: z.string().trim().max(60),
    domainNote: z.string().trim().max(120),
    weekId: z.number().int().positive().nullable(),
    trackId: z.number().int().positive().nullable(),
    eventId: z.number().int().positive().nullable(),
    parentId: z.number().int().positive().nullable(),
    requiresApproval: z.boolean(),
    visibility: z.enum(VISIBILITIES),
    deadline: isoDateTime,
    ownerId: z.number().int().positive(),
    participantIds: z.array(z.number().int().positive()),
  })
  .partial()
  .strict();
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

function isDescendant(candidateParentId: number, taskId: number): boolean {
  let cur: number | null = candidateParentId;
  const seen = new Set<number>();
  while (cur) {
    if (cur === taskId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = db().get<{ parent_id: number | null }>('SELECT parent_id FROM tasks WHERE id = ?', cur)?.parent_id ?? null;
  }
  return false;
}

/** Applies an edit. `bypass` is used when an approved request applies the change. */
export function updateTask(actor: UserRow, id: number, raw: UpdateTaskInput, bypass = false, via?: string): void {
  const patch = updateTaskSchema.parse(raw);
  const t = mustTaskRow(id);
  if (!bypass && !canView(actor, t)) throw notFound('המשימה לא נמצאה');

  const coreKeys = ['title', 'description', 'priority', 'domain', 'domainNote', 'weekId', 'trackId', 'eventId', 'parentId', 'requiresApproval', 'visibility', 'participantIds'] as const;
  if (!bypass && coreKeys.some((k) => patch[k] !== undefined) && !canEdit(actor, t)) {
    throw forbidden('רק מי שיצר את המשימה או מפקד הקורס יכולים לערוך אותה');
  }
  if (!bypass && patch.deadline !== undefined && patch.deadline !== t.deadline && !canChangeDeadline(actor, t)) {
    throw forbidden('לא ניתן לשנות דד-ליין שקבע מפקד הקורס - יש להגיש בקשת שינוי דד-ליין');
  }
  if (!bypass && patch.ownerId !== undefined && patch.ownerId !== t.owner_id && !canChangeOwner(actor, t, patch.ownerId)) {
    throw forbidden('העברת אחריות לאיש סגל אחר דורשת אישור - יש להגיש בקשת העברה');
  }

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const logs: { action: string; text: string; data?: unknown }[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  const who = actor.display_name;
  const suffix = via ? ` (${via})` : '';

  db().tx(() => {
    if (patch.title !== undefined && patch.title !== t.title) {
      set('title', patch.title);
      logs.push({ action: 'title', text: `${who} שינה את שם המשימה ל"${patch.title}"` });
    }
    if (patch.description !== undefined && patch.description !== t.description) {
      set('description', patch.description);
      logs.push({ action: 'description', text: `${who} עדכן את פירוט המשימה` });
    }
    if (patch.priority !== undefined && patch.priority !== t.priority) {
      set('priority', patch.priority);
      logs.push({ action: 'priority', text: `${who} שינה עדיפות ל"${PRIORITY_LABELS[patch.priority]}"` });
    }
    // the detail belongs to "אחר": another area clears it
    const nextDomain = patch.domain ?? t.domain;
    const nextNote = nextDomain === OTHER_DOMAIN ? (patch.domainNote ?? t.domain_note) : '';
    if (patch.domain !== undefined && patch.domain !== t.domain) set('domain', patch.domain);
    if (nextNote !== t.domain_note) set('domain_note', nextNote);
    if (nextDomain !== t.domain || nextNote !== t.domain_note) {
      logs.push({ action: 'domain', text: `${who} שינה תחום ל"${domainLabel(nextDomain, nextNote) || 'ללא'}"` });
    }
    if (patch.weekId !== undefined && patch.weekId !== t.week_id) {
      const w = patch.weekId ? db().get<{ name: string }>('SELECT name FROM weeks WHERE id = ?', patch.weekId) : null;
      if (patch.weekId && !w) throw badRequest('השבוע לא נמצא');
      set('week_id', patch.weekId);
      logs.push({ action: 'week', text: w ? `${who} שייך את המשימה ל"${w.name}"` : `${who} הסיר את השיוך לשבוע` });
    }
    if (patch.trackId !== undefined && patch.trackId !== t.track_id) {
      const tr = patch.trackId ? db().get<{ name: string }>('SELECT name FROM tracks WHERE id = ?', patch.trackId) : null;
      if (patch.trackId && !tr) throw badRequest('הציר לא נמצא');
      set('track_id', patch.trackId);
      logs.push({ action: 'track', text: tr ? `${who} שייך את המשימה לציר "${tr.name}"` : `${who} הסיר את השיוך לציר` });
    }
    if (patch.eventId !== undefined && patch.eventId !== t.event_id) {
      const e = patch.eventId ? db().get<{ title: string }>('SELECT title FROM events WHERE id = ?', patch.eventId) : null;
      if (patch.eventId && !e) throw badRequest('הפעילות לא נמצאה');
      set('event_id', patch.eventId);
      logs.push({ action: 'event', text: e ? `${who} קישר את המשימה לפעילות "${e.title}"` : `${who} הסיר את הקישור לפעילות` });
    }
    if (patch.parentId !== undefined && patch.parentId !== t.parent_id) {
      if (patch.parentId) {
        if (patch.parentId === id || isDescendant(patch.parentId, id)) throw badRequest('לא ניתן ליצור מעגל של משימות משנה');
        const p = getTaskRow(patch.parentId);
        if (!p) throw badRequest('משימת האב לא נמצאה');
        logs.push({ action: 'parent', text: `${who} הגדיר את המשימה כמשימת משנה של "${p.title}"` });
      } else logs.push({ action: 'parent', text: `${who} הפך את המשימה למשימה עצמאית` });
      set('parent_id', patch.parentId);
    }
    if (patch.requiresApproval !== undefined && Number(patch.requiresApproval) !== t.requires_approval) {
      set('requires_approval', patch.requiresApproval ? 1 : 0);
      logs.push({ action: 'approval', text: patch.requiresApproval ? `${who} הגדיר שנדרש אישור מפקד לסגירה` : `${who} ביטל את דרישת האישור` });
    }
    if (patch.visibility !== undefined && patch.visibility !== t.visibility) {
      set('visibility', patch.visibility);
      logs.push({ action: 'visibility', text: `${who} שינה נראות ל"${VISIBILITY_LABELS[patch.visibility].split(' - ')[0]}"` });
    }
    if (patch.deadline !== undefined && patch.deadline !== t.deadline) {
      const f = reminderFlags(patch.deadline);
      set('deadline', patch.deadline);
      set('reminded_24h', f.reminded24);
      set('reminded_2h', f.reminded2);
      set('overdue_notified', f.overdueNotified);
      set('overdue_response', null);
      set('overdue_response_at', null);
      logs.push({
        action: 'deadline',
        text: `${who} שינה את הדד-ליין מ-${fmt(t.deadline)} ל-${fmt(patch.deadline)}${suffix}`,
        data: { from: t.deadline, to: patch.deadline },
      });
      notify(
        involvedIds(t),
        { type: 'deadline_changed', category: 'info', title: `הדד-ליין של "${t.title}" שונה`, body: `דד-ליין חדש: ${fmt(patch.deadline)}`, taskId: id },
        actor.id,
      );
    }
    if (patch.ownerId !== undefined && patch.ownerId !== t.owner_id) {
      const newOwner = requireActiveUser(patch.ownerId);
      set('owner_id', patch.ownerId);
      db().run('DELETE FROM task_participants WHERE task_id = ? AND user_id = ?', id, patch.ownerId);
      // Section 63: keep previous owner, new owner, who and when.
      logs.push({
        action: 'owner',
        text: `${who} העביר אחריות מ${t.owner_name} ל${newOwner.display_name}${suffix}`,
        data: { from: t.owner_id, fromName: t.owner_name, to: newOwner.id, toName: newOwner.display_name },
      });
      notify(
        [newOwner.id],
        { type: 'task_assigned', category: 'action', title: `הועברה אליך משימה: "${t.title}"`, body: `דד-ליין ${fmt(patch.deadline ?? t.deadline)}`, taskId: id },
        actor.id,
      );
      notify([t.owner_id], { type: 'owner_changed', category: 'info', title: `המשימה "${t.title}" הועברה ל${newOwner.display_name}`, taskId: id }, actor.id);
    }
    if (patch.participantIds !== undefined) {
      const ownerId = patch.ownerId ?? t.owner_id;
      const next = [...new Set(patch.participantIds)].filter((p) => p !== ownerId);
      next.forEach(requireActiveUser);
      const prev = participantsOf(t);
      const added = next.filter((p) => !prev.includes(p));
      const removed = prev.filter((p) => !next.includes(p));
      if (added.length || removed.length) {
        db().run('DELETE FROM task_participants WHERE task_id = ?', id);
        for (const p of next) db().run('INSERT INTO task_participants(task_id, user_id) VALUES (?, ?)', id, p);
        const names = (ids: number[]) => ids.map((i) => getUserRow(i)?.display_name).join(', ');
        if (added.length) logs.push({ action: 'participants', text: `${who} צירף את ${names(added)} למשימה` });
        if (removed.length) logs.push({ action: 'participants', text: `${who} הסיר את ${names(removed)} מהמשימה` });
        notify(added, { type: 'task_assigned', category: 'action', title: `צורפת למשימה: "${t.title}"`, taskId: id }, actor.id);
      }
    }
    if (sets.length) {
      db().run(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, nowIso(), id);
    }
    for (const l of logs) logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, ...l });
  });
  if (logs.length) changed('tasks', 'weeks');
}

// ---------------- status flow ----------------

export const transitionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({
    action: z.literal('block'),
    reason: z.enum(BLOCK_REASONS),
    waitingFor: z.string().trim().min(2, 'יש לפרט למי ממתינים').max(200),
    nextStep: z.string().trim().min(2, 'יש לפרט מה הצעד הבא').max(300),
    needsCommander: z.boolean().optional().default(false),
  }),
  z.object({ action: z.literal('unblock'), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('complete'), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal('approve'), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('return'), note: z.string().trim().min(2, 'יש לכתוב מה חסר').max(2000) }),
  z.object({ action: z.literal('cancel'), reason: z.string().trim().min(2, 'יש לכתוב סיבת ביטול').max(500) }),
  z.object({ action: z.literal('reopen'), note: z.string().trim().max(1000).optional() }),
  // "ביטול" right after marking it done: back as it was, as if it had not been marked
  z.object({ action: z.literal('undo_complete') }),
  z.object({ action: z.literal('escalate'), note: z.string().trim().min(2, 'יש לפרט איזו החלטה נדרשת').max(1000) }),
  z.object({ action: z.literal('clear_attention'), note: z.string().trim().max(1000).optional() }),
]);
export type TransitionInput = z.input<typeof transitionSchema>;

function addUpdateRow(taskId: number, userId: number, kind: string, body: string): void {
  db().run('INSERT INTO task_updates(task_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)', taskId, userId, kind, body, nowIso());
}

function completeNotifications(actor: UserRow, t: TaskRow, notifyCreator = true): void {
  // Group copies (section 64): one notification when everybody finished, not per person.
  if (!notifyCreator) {
    // the approver already knows
  } else if (t.group_id) {
    const left = db().get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE group_id = ? AND status NOT IN ('done', 'cancelled')", t.group_id)!.n;
    if (left === 0) {
      notify([t.created_by], { type: 'group_done', category: 'info', title: `כל הסגל השלים את "${t.title}"`, taskId: t.id }, actor.id);
    }
  } else {
    // Section 74: the commander is told about completions only when it matters.
    const creatorIsCommander = t.creator_role === 'commander';
    if (!creatorIsCommander || t.priority === 'high' || t.priority === 'critical' || t.requires_approval) {
      notify(
        [t.created_by],
        { type: 'task_done', category: 'info', title: `${actor.display_name} השלים את המשימה "${t.title}"`, taskId: t.id },
        actor.id,
      );
    }
  }
  // Dependents can now move forward (section 59).
  const dependents = db().all<{ id: number; title: string; owner_id: number }>(
    `SELECT t.id, t.title, t.owner_id FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
     WHERE d.depends_on_id = ? AND t.status NOT IN ('done', 'cancelled')`,
    t.id,
  );
  for (const d of dependents) {
    notify(
      [d.owner_id],
      { type: 'dependency_done', category: 'info', title: `"${t.title}" הושלמה - אפשר להתקדם ב"${d.title}"`, taskId: d.id },
      actor.id,
    );
  }
}

/** how long after marking a task done its "ביטול" still undoes it */
export const UNDO_COMPLETE_MS = 2 * 60_000;

export function transition(actor: UserRow, id: number, raw: TransitionInput): void {
  const input = transitionSchema.parse(raw);
  const t = mustTaskRow(id);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  const who = actor.display_name;
  const now = nowIso();
  const requireStatus = (...allowed: string[]) => {
    if (!allowed.includes(t.status)) throw badRequest('לא ניתן לבצע פעולה זו במצב הנוכחי של המשימה');
  };
  const requireUpdate = () => {
    if (!canUpdateStatus(actor, t)) throw forbidden('רק האחראים על המשימה יכולים לעדכן את הסטטוס');
  };

  db().tx(() => {
    switch (input.action) {
      case 'start': {
        requireUpdate();
        requireStatus('todo');
        db().run("UPDATE tasks SET status = 'in_progress', started_at = coalesce(started_at, ?) WHERE id = ?", now, id);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'status', text: `${who} שינה סטטוס ל"בטיפול"` });
        break;
      }
      case 'block': {
        requireUpdate();
        requireStatus('todo', 'in_progress', 'waiting');
        db().run(
          "UPDATE tasks SET status = 'waiting', block_reason = ?, block_waiting_for = ?, block_next_step = ?, needs_commander = ? WHERE id = ?",
          input.reason,
          input.waitingFor,
          input.nextStep,
          input.needsCommander ? 1 : 0,
          id,
        );
        logActivity({
          taskId: id,
          weekId: t.week_id,
          userId: actor.id,
          action: 'blocked',
          text: `${who} סימן חסם: ${input.reason}. ממתין ל: ${input.waitingFor}. צעד הבא: ${input.nextStep}${input.needsCommander ? ' · נדרשת התערבות מפקד' : ''}`,
        });
        if (input.needsCommander) {
          notify(
            commanderIds(),
            { type: 'blocked', category: 'exception', title: `חסם במשימה "${t.title}" - נדרשת התערבות`, body: `${input.reason} · ${who}`, taskId: id },
            actor.id,
          );
        } else {
          notify([t.created_by], { type: 'blocked', category: 'exception', title: `חסם במשימה "${t.title}"`, body: `${input.reason} · ${who}`, taskId: id }, actor.id);
        }
        break;
      }
      case 'unblock': {
        if (!canUpdateStatus(actor, t) && !isCommander(actor)) throw forbidden();
        requireStatus('waiting');
        db().run(
          "UPDATE tasks SET status = 'in_progress', block_reason = NULL, block_waiting_for = NULL, block_next_step = NULL, needs_commander = 0, started_at = coalesce(started_at, ?) WHERE id = ?",
          now,
          id,
        );
        if (input.note) addUpdateRow(id, actor.id, 'comment', input.note);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'unblocked', text: `${who} סימן שהחסם טופל${input.note ? `: ${input.note}` : ''}` });
        notify([t.owner_id], { type: 'unblocked', category: 'info', title: `החסם במשימה "${t.title}" טופל`, taskId: id }, actor.id);
        break;
      }
      case 'complete': {
        requireUpdate();
        requireStatus('todo', 'in_progress', 'waiting');
        if (input.note) addUpdateRow(id, actor.id, 'comment', input.note);
        if (t.requires_approval && !canApprove(actor, t)) {
          db().run("UPDATE tasks SET status = 'pending_approval', needs_commander = 0 WHERE id = ?", id);
          logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'approval_requested', text: `${who} ביקש לסגור את המשימה - ממתין לאישור` });
          notify(
            approverIds(t),
            { type: 'approval_requested', category: 'action', title: `${who} ביקש לסגור את המשימה "${t.title}"`, taskId: id },
            actor.id,
          );
        } else {
          const late = Date.parse(t.deadline) < clock.now().getTime() ? 1 : 0;
          db().run(
            "UPDATE tasks SET status = 'done', completed_at = ?, completed_late = ?, needs_commander = 0, block_reason = NULL, block_waiting_for = NULL, block_next_step = NULL WHERE id = ?",
            now,
            late,
            id,
          );
          logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'done', text: `${who} סימן את המשימה כהושלמה` });
          completeNotifications(actor, t);
        }
        break;
      }
      case 'approve': {
        if (!canApprove(actor, t)) throw forbidden('אין לך הרשאה לאשר את המשימה');
        requireStatus('pending_approval');
        const late = Date.parse(t.deadline) < clock.now().getTime() ? 1 : 0;
        db().run("UPDATE tasks SET status = 'done', completed_at = ?, completed_late = ? WHERE id = ?", now, late, id);
        if (input.note) addUpdateRow(id, actor.id, 'instruction', input.note);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'approved', text: `${who} אישר את סגירת המשימה` });
        notify(involvedIds(t), { type: 'approved', category: 'info', title: `המשימה "${t.title}" אושרה ונסגרה`, taskId: id }, actor.id);
        completeNotifications(actor, t, false);
        break;
      }
      case 'return': {
        if (!canApprove(actor, t)) throw forbidden('אין לך הרשאה להחזיר את המשימה');
        requireStatus('pending_approval');
        db().run("UPDATE tasks SET status = 'in_progress' WHERE id = ?", id);
        addUpdateRow(id, actor.id, 'return', input.note);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'returned', text: `${who} החזיר את המשימה להשלמה: ${input.note}` });
        notify(involvedIds(t), { type: 'returned', category: 'action', title: `המשימה "${t.title}" הוחזרה להשלמה`, body: input.note, taskId: id }, actor.id);
        break;
      }
      case 'cancel': {
        if (!canEdit(actor, t)) throw forbidden('רק מי שיצר את המשימה או מפקד הקורס יכולים לבטל אותה');
        if (!isOpenStatus(t.status)) throw badRequest('המשימה כבר סגורה');
        db().run("UPDATE tasks SET status = 'cancelled', cancel_reason = ?, needs_commander = 0 WHERE id = ?", input.reason, id);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'cancelled', text: `${who} ביטל את המשימה: ${input.reason}` });
        notify(involvedIds(t), { type: 'cancelled', category: 'info', title: `המשימה "${t.title}" בוטלה`, body: input.reason, taskId: id }, actor.id);
        break;
      }
      case 'reopen': {
        if (!canEdit(actor, t) && !canApprove(actor, t)) throw forbidden();
        requireStatus('done', 'cancelled');
        db().run("UPDATE tasks SET status = 'in_progress', completed_at = NULL, completed_late = NULL, cancel_reason = NULL WHERE id = ?", id);
        if (input.note) addUpdateRow(id, actor.id, 'instruction', input.note);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'reopened', text: `${who} פתח מחדש את המשימה${input.note ? `: ${input.note}` : ''}` });
        notify(involvedIds(t), { type: 'reopened', category: 'action', title: `המשימה "${t.title}" נפתחה מחדש`, body: input.note, taskId: id }, actor.id);
        break;
      }
      case 'undo_complete': {
        requireStatus('done');
        // only the one who marked it done, and only a moment after - later it is reopened, with a note
        const last = db().get<{ user_id: number | null }>("SELECT user_id FROM activity WHERE task_id = ? AND action = 'done' ORDER BY id DESC LIMIT 1", id);
        const doneAt = t.completed_at ? Date.parse(t.completed_at) : 0;
        if (!last || last.user_id !== actor.id || clock.now().getTime() - doneAt > UNDO_COMPLETE_MS) {
          throw badRequest('כבר אי אפשר לבטל את הסימון - אפשר לפתוח את המשימה מחדש');
        }
        db().run("UPDATE tasks SET status = ?, completed_at = NULL, completed_late = NULL WHERE id = ?", t.started_at ? 'in_progress' : 'todo', id);
        // what marking it done told others a moment ago is taken back
        db().run(
          `DELETE FROM notifications WHERE created_at >= ? AND ((task_id = ? AND type IN ('task_done', 'group_done'))
             OR (type = 'dependency_done' AND task_id IN (SELECT task_id FROM task_dependencies WHERE depends_on_id = ?)))`,
          t.completed_at,
          id,
          id,
        );
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'undone', text: `${who} ביטל את הסימון כהושלמה` });
        break;
      }
      case 'escalate': {
        requireUpdate();
        if (!isOpenStatus(t.status)) throw badRequest('המשימה כבר סגורה');
        db().run('UPDATE tasks SET needs_commander = 1 WHERE id = ?', id);
        addUpdateRow(id, actor.id, 'comment', `נדרשת החלטת מפקד: ${input.note}`);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'escalated', text: `${who} ביקש החלטת מפקד: ${input.note}` });
        notify(commanderIds(), { type: 'escalated', category: 'exception', title: `נדרשת החלטה במשימה "${t.title}"`, body: input.note, taskId: id }, actor.id);
        break;
      }
      case 'clear_attention': {
        if (!isCommander(actor)) throw forbidden();
        db().run('UPDATE tasks SET needs_commander = 0 WHERE id = ?', id);
        if (input.note) addUpdateRow(id, actor.id, 'instruction', input.note);
        logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'attention_cleared', text: `${who} סימן שהטיפול שלו הסתיים${input.note ? `: ${input.note}` : ''}` });
        if (input.note) notify(involvedIds(t), { type: 'instruction', category: 'action', title: `הנחיה חדשה במשימה "${t.title}"`, body: input.note, taskId: id }, actor.id);
        break;
      }
    }
  });
  changed('tasks', 'weeks');
}

// ---------------- updates, overdue response ----------------

export function addUpdate(actor: UserRow, id: number, body: string, kind: 'comment' | 'instruction' = 'comment'): void {
  const t = mustTaskRow(id);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  const text = body.trim();
  if (!text) throw badRequest('העדכון ריק');
  if (kind === 'instruction' && !canEdit(actor, t) && !isCommander(actor)) kind = 'comment';
  db().tx(() => {
    addUpdateRow(id, actor.id, kind, text);
    logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'update', text: `${actor.display_name} ${kind === 'instruction' ? 'הוסיף הנחיה' : 'הוסיף עדכון'}` });
    // Section 74: the commander sees updates on the dashboard instead of being pinged for each one.
    const recipients = [...involvedIds(t)];
    if (t.creator_role !== 'commander') recipients.push(t.created_by);
    notify(
      recipients,
      {
        type: kind === 'instruction' ? 'instruction' : 'update',
        category: kind === 'instruction' ? 'action' : 'info',
        title: kind === 'instruction' ? `הנחיה חדשה במשימה "${t.title}"` : `עדכון חדש במשימה "${t.title}"`,
        body: `${actor.display_name}: ${text.slice(0, 140)}`,
        taskId: id,
      },
      actor.id,
    );
  });
  changed('tasks');
}

export const overdueResponseSchema = z.object({
  response: z.enum(OVERDUE_RESPONSES),
  note: z.string().trim().max(1000).optional(),
});

export function respondOverdue(actor: UserRow, id: number, raw: z.input<typeof overdueResponseSchema>): void {
  const input = overdueResponseSchema.parse(raw);
  const t = mustTaskRow(id);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  if (!involvedIds(t).includes(actor.id) && !isCommander(actor)) throw forbidden();
  if (!isOpenStatus(t.status)) throw badRequest('המשימה כבר סגורה');
  db().tx(() => {
    db().run(
      `UPDATE tasks SET overdue_response = ?, overdue_response_at = ?${input.response === 'decision' ? ', needs_commander = 1' : ''} WHERE id = ?`,
      input.response,
      nowIso(),
      id,
    );
    if (input.note) addUpdateRow(id, actor.id, 'comment', input.note);
    logActivity({
      taskId: id,
      weekId: t.week_id,
      userId: actor.id,
      action: 'overdue_response',
      text: `${actor.display_name} דיווח על האיחור: ${OVERDUE_RESPONSE_LABELS[input.response]}${input.note ? ` - ${input.note}` : ''}`,
    });
    if (input.response === 'decision') {
      notify(commanderIds(), { type: 'escalated', category: 'exception', title: `נדרשת החלטה במשימה באיחור "${t.title}"`, body: input.note, taskId: id }, actor.id);
    }
  });
  changed('tasks');
}

// ---------------- requests (sections 62, 63) ----------------

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('deadline'), newDeadline: isoDateTime, reason: z.string().trim().min(2, 'יש לכתוב סיבה').max(1000) }),
  z.object({ type: z.literal('transfer'), newOwnerId: z.number().int().positive(), reason: z.string().trim().min(2, 'יש לכתוב סיבה').max(1000) }),
]);

export function createRequest(actor: UserRow, taskId: number, raw: z.input<typeof requestSchema>): number {
  const input = requestSchema.parse(raw);
  const t = mustTaskRow(taskId);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  if (!involvedIds(t).includes(actor.id)) throw forbidden('רק האחראים על המשימה יכולים להגיש בקשה');
  if (!isOpenStatus(t.status)) throw badRequest('המשימה כבר סגורה');
  if (db().get("SELECT 1 FROM requests WHERE task_id = ? AND type = ? AND status = 'pending'", taskId, input.type)) {
    throw badRequest('כבר קיימת בקשה פתוחה מסוג זה למשימה');
  }
  let id = 0;
  db().tx(() => {
    if (input.type === 'deadline') {
      id = db().run(
        'INSERT INTO requests(type, task_id, requested_by, new_deadline, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        'deadline',
        taskId,
        actor.id,
        input.newDeadline,
        input.reason,
        nowIso(),
      ).id;
      logActivity({ taskId, weekId: t.week_id, userId: actor.id, action: 'request', text: `${actor.display_name} ביקש שינוי דד-ליין ל-${fmt(input.newDeadline)}: ${input.reason}` });
      notify(
        approverIds(t),
        { type: 'request', category: 'action', title: `בקשת שינוי דד-ליין: "${t.title}"`, body: `${actor.display_name} · ${fmt(t.deadline)} ← ${fmt(input.newDeadline)} · ${input.reason}`, taskId, link: '/requests' },
        actor.id,
      );
    } else {
      const target = requireActiveUser(input.newOwnerId);
      if (target.id === t.owner_id) throw badRequest('זהו כבר האחראי על המשימה');
      id = db().run(
        'INSERT INTO requests(type, task_id, requested_by, new_owner_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        'transfer',
        taskId,
        actor.id,
        target.id,
        input.reason,
        nowIso(),
      ).id;
      logActivity({ taskId, weekId: t.week_id, userId: actor.id, action: 'request', text: `${actor.display_name} ביקש להעביר את האחריות ל${target.display_name}: ${input.reason}` });
      notify(
        approverIds(t),
        { type: 'request', category: 'action', title: `בקשת העברת אחריות: "${t.title}"`, body: `${actor.display_name} ← ${target.display_name} · ${input.reason}`, taskId, link: '/requests' },
        actor.id,
      );
    }
  });
  changed('tasks', 'requests');
  return id;
}

interface RequestRow {
  id: number;
  type: 'deadline' | 'transfer';
  task_id: number;
  requested_by: number;
  new_deadline: string | null;
  new_owner_id: number | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: number | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  task_title: string;
  current_deadline: string;
  current_owner_name: string;
  requested_by_name: string;
  new_owner_name: string | null;
  decided_by_name: string | null;
}

const REQUEST_BASE = `
SELECT r.*, t.title AS task_title, t.deadline AS current_deadline, o.display_name AS current_owner_name,
  rb.display_name AS requested_by_name, no.display_name AS new_owner_name, db.display_name AS decided_by_name
FROM requests r
JOIN tasks t ON t.id = r.task_id
JOIN users o ON o.id = t.owner_id
JOIN users rb ON rb.id = r.requested_by
LEFT JOIN users no ON no.id = r.new_owner_id
LEFT JOIN users db ON db.id = r.decided_by
`;

function toRequest(r: RequestRow): TaskRequest {
  return {
    id: r.id,
    type: r.type,
    taskId: r.task_id,
    taskTitle: r.task_title,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    newDeadline: r.new_deadline,
    newOwnerId: r.new_owner_id,
    newOwnerName: r.new_owner_name,
    currentDeadline: r.current_deadline,
    currentOwnerName: r.current_owner_name,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    decisionNote: r.decision_note,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

export function listRequests(actor: UserRow, where = '1=1', ...params: (string | number)[]): TaskRequest[] {
  const rows = db().all<RequestRow>(`${REQUEST_BASE} WHERE ${where} ORDER BY r.created_at DESC`, ...params);
  return rows
    .filter((r) => {
      if (r.requested_by === actor.id) return true;
      const t = getTaskRow(r.task_id);
      return !!t && canApprove(actor, t);
    })
    .map(toRequest);
}

export function pendingRequestsFor(actor: UserRow): TaskRequest[] {
  return listRequests(actor, "r.status = 'pending'").filter((r) => r.requestedBy !== actor.id || isCommander(actor));
}

export const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() });

export function decideRequest(actor: UserRow, requestId: number, raw: z.input<typeof decideSchema>): void {
  const input = decideSchema.parse(raw);
  const r = db().get<RequestRow>(`${REQUEST_BASE} WHERE r.id = ?`, requestId);
  if (!r) throw notFound('הבקשה לא נמצאה');
  const t = mustTaskRow(r.task_id);
  if (!canApprove(actor, t)) throw forbidden('אין לך הרשאה להחליט על הבקשה');
  if (r.status !== 'pending') throw badRequest('הבקשה כבר טופלה');
  const label = r.type === 'deadline' ? 'שינוי הדד-ליין' : 'העברת האחריות';
  db().tx(() => {
    db().run(
      'UPDATE requests SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?',
      input.approve ? 'approved' : 'rejected',
      actor.id,
      input.note ?? null,
      nowIso(),
      requestId,
    );
    if (input.approve) {
      if (r.type === 'deadline' && r.new_deadline) updateTask(actor, t.id, { deadline: r.new_deadline }, true, `אישור בקשה של ${r.requested_by_name}`);
      if (r.type === 'transfer' && r.new_owner_id) updateTask(actor, t.id, { ownerId: r.new_owner_id }, true, `אישור בקשה של ${r.requested_by_name}`);
    } else {
      logActivity({ taskId: t.id, weekId: t.week_id, userId: actor.id, action: 'request_rejected', text: `${actor.display_name} דחה את בקשת ${label}${input.note ? `: ${input.note}` : ''}` });
    }
    notify(
      [r.requested_by],
      {
        type: 'request_decided',
        category: input.approve ? 'info' : 'action',
        title: input.approve ? `בקשת ${label} אושרה: "${t.title}"` : `בקשת ${label} נדחתה: "${t.title}"`,
        body: input.note,
        taskId: t.id,
      },
      actor.id,
    );
  });
  changed('tasks', 'requests');
}

// ---------------- delete, dependencies ----------------

export function deleteTask(actor: UserRow, id: number): void {
  const t = mustTaskRow(id);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  if (!canDelete(actor, t)) throw forbidden('לא ניתן למחוק משימה שהקצה מפקד הקורס');
  db().tx(() => {
    logActivity({ taskId: id, weekId: t.week_id, userId: actor.id, action: 'deleted', text: `${actor.display_name} מחק את המשימה "${t.title}"` });
    notify(involvedIds(t), { type: 'deleted', category: 'info', title: `המשימה "${t.title}" נמחקה` }, actor.id);
    db().run('DELETE FROM tasks WHERE id = ?', id);
  });
  changed('tasks', 'weeks');
}

function dependsTransitively(from: number, target: number): boolean {
  const stack = [from];
  const seen = new Set<number>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const r of db().all<{ depends_on_id: number }>('SELECT depends_on_id FROM task_dependencies WHERE task_id = ?', cur)) {
      stack.push(r.depends_on_id);
    }
  }
  return false;
}

export function addDependency(actor: UserRow, taskId: number, dependsOnId: number): void {
  const t = mustTaskRow(taskId);
  const d = mustTaskRow(dependsOnId);
  if (!canView(actor, t) || !canView(actor, d)) throw notFound('המשימה לא נמצאה');
  if (!canEdit(actor, t) && !involvedIds(t).includes(actor.id)) throw forbidden();
  if (taskId === dependsOnId || dependsTransitively(dependsOnId, taskId)) throw badRequest('תלות זו יוצרת מעגל');
  db().tx(() => {
    db().run('INSERT OR IGNORE INTO task_dependencies(task_id, depends_on_id) VALUES (?, ?)', taskId, dependsOnId);
    logActivity({ taskId, weekId: t.week_id, userId: actor.id, action: 'dependency', text: `${actor.display_name} הגדיר שהמשימה תלויה ב"${d.title}"` });
  });
  changed('tasks');
}

export function removeDependency(actor: UserRow, taskId: number, dependsOnId: number): void {
  const t = mustTaskRow(taskId);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  if (!canEdit(actor, t) && !involvedIds(t).includes(actor.id)) throw forbidden();
  const d = getTaskRow(dependsOnId);
  db().tx(() => {
    db().run('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?', taskId, dependsOnId);
    logActivity({ taskId, weekId: t.week_id, userId: actor.id, action: 'dependency', text: `${actor.display_name} הסיר את התלות ב"${d?.title ?? ''}"` });
  });
  changed('tasks');
}

// ---------------- detail ----------------

export function groupProgress(groupId: string): GroupProgress {
  const rows = queryTasks('t.group_id = ?', groupId);
  const now = clock.now();
  return {
    groupId,
    total: rows.filter((r) => r.status !== 'cancelled').length,
    done: rows.filter((r) => r.status === 'done').length,
    members: rows.map((r) => ({
      taskId: r.id,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      status: r.status,
      overdue: isOpenStatus(r.status) && Date.parse(r.deadline) < now.getTime(),
    })),
  };
}

/** for the task's page: the week it is the weekly debrief task of (weeklyDebriefTask.ts), and the debrief once opened */
function weeklyDebriefOfTask(taskId: number): { weekId: number; weekName: string; debriefId: number | null } | null {
  const r = db().get<{ week_id: number; name: string; debrief_id: number | null }>(
    `SELECT x.week_id, w.name, (SELECT d.id FROM debriefs d WHERE d.week_id = x.week_id AND d.kind = 'weekly' ORDER BY d.id LIMIT 1) AS debrief_id
     FROM week_debrief_tasks x JOIN weeks w ON w.id = x.week_id WHERE x.task_id = ?`,
    taskId,
  );
  return r ? { weekId: r.week_id, weekName: r.name, debriefId: r.debrief_id } : null;
}

export function taskDetail(actor: UserRow, id: number): TaskDetail {
  const t = mustTaskRow(id);
  if (!canView(actor, t)) throw notFound('המשימה לא נמצאה');
  const updates = db()
    .all<{ id: number; task_id: number; user_id: number; user_name: string; kind: TaskDetail['updates'][number]['kind']; body: string; created_at: string }>(
      `SELECT u.*, coalesce(us.display_name, '') AS user_name FROM task_updates u LEFT JOIN users us ON us.id = u.user_id
       WHERE u.task_id = ? ORDER BY u.created_at ASC, u.id ASC`,
      id,
    )
    .map((u) => ({ id: u.id, taskId: u.task_id, userId: u.user_id, userName: u.user_name, kind: u.kind, body: u.body, createdAt: u.created_at }));
  const attachments = listAttachments('a.task_id = ?', id);
  const activity = listActivity('a.task_id = ?', [id], 200).reverse();
  const subtasks = queryTasks('t.parent_id = ?', id)
    .filter((r) => canView(actor, r))
    .map((r) => toTask(r));
  const parentRow = t.parent_id ? getTaskRow(t.parent_id) : undefined;
  const pick = (r: TaskRow) => ({ id: r.id, title: r.title, status: r.status, ownerName: r.owner_name, deadline: r.deadline });
  const dependsOn = queryTasks('t.id IN (SELECT depends_on_id FROM task_dependencies WHERE task_id = ?)', id).map(pick);
  const blocks = queryTasks('t.id IN (SELECT task_id FROM task_dependencies WHERE depends_on_id = ?)', id).map(pick);
  const requests = listRequests(actor, 'r.task_id = ?', id);
  return {
    task: toTask(t),
    updates,
    attachments,
    activity,
    subtasks,
    parent: parentRow && canView(actor, parentRow) ? { id: parentRow.id, title: parentRow.title } : null,
    dependsOn,
    blocks,
    group: t.group_id && (isCommander(actor) || t.created_by === actor.id) ? groupProgress(t.group_id) : null,
    requests,
    weeklyDebrief: weeklyDebriefOfTask(id),
    permissions: permissionsFor(actor, t),
  };
}

// ---------------- attachments & activity listing ----------------

interface AttachmentRow {
  id: number;
  task_id: number | null;
  event_id: number | null;
  user_id: number;
  user_name: string;
  kind: 'link' | 'file';
  title: string;
  url: string | null;
  size: number | null;
  created_at: string;
}

export function listAttachments(where: string, ...params: number[]) {
  return db()
    .all<AttachmentRow>(
      `SELECT a.*, coalesce(u.display_name, '') AS user_name FROM attachments a LEFT JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.created_at`,
      ...params,
    )
    .map((a) => ({
      id: a.id,
      taskId: a.task_id,
      eventId: a.event_id,
      userId: a.user_id,
      userName: a.user_name,
      kind: a.kind,
      title: a.title,
      url: a.kind === 'file' ? `/api/files/${a.id}` : (a.url ?? ''),
      size: a.size,
      createdAt: a.created_at,
    }));
}

export function listActivity(where: string, params: (string | number)[], limit = 100) {
  return db()
    .all<{
      id: number;
      task_id: number | null;
      task_title: string | null;
      week_id: number | null;
      user_id: number | null;
      user_name: string | null;
      action: string;
      text: string;
      created_at: string;
    }>(
      `SELECT a.*, u.display_name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${Math.max(1, Math.min(500, limit))}`,
      ...params,
    )
    .map((a) => ({
      id: a.id,
      taskId: a.task_id,
      taskTitle: a.task_title,
      weekId: a.week_id,
      userId: a.user_id,
      userName: a.user_name,
      action: a.action,
      text: a.text,
      createdAt: a.created_at,
    }));
}

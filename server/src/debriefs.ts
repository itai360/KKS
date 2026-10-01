// Section 31 (debriefs) and 57: event -> facts -> findings -> conclusions -> lessons,
// and every lesson can become a task, a recurring task, or a step in an activity template
// (e.g. "שיחת תיאום עם מדריך - 48 שעות לפני כל פעילות").

import { z } from 'zod';
import { DEBRIEF_ITEM_KINDS, PRIORITIES, isOpenStatus, type DebriefItemKind, type TaskStatus } from '../../shared/constants';
import { isDateKey } from '../../shared/dates';
import type { Debrief, DebriefDetail, DebriefItem } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { badRequest, forbidden, notFound, nowIso } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { recurringSchema, saveRule } from './recurring';
import { isCommander, visibleTasks } from './taskRepo';
import { createTasks, isoDateTime, weekForDate } from './taskService';
import { getTemplate, saveTemplate } from './templates';

interface DebriefRow {
  id: number;
  title: string;
  occurred_on: string;
  event_id: number | null;
  event_title: string | null;
  week_id: number | null;
  week_name: string | null;
  facilitator_id: number | null;
  facilitator_name: string | null;
  participants: string;
  summary: string;
  status: 'draft' | 'final';
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  open_tasks: number;
}

const BASE = `
SELECT d.*, e.title AS event_title, w.name AS week_name, f.display_name AS facilitator_name, c.display_name AS created_by_name,
  (SELECT count(*) FROM tasks t WHERE t.debrief_id = d.id AND t.status NOT IN ('done', 'cancelled')) AS open_tasks
FROM debriefs d
JOIN users c ON c.id = d.created_by
LEFT JOIN events e ON e.id = d.event_id
LEFT JOIN weeks w ON w.id = d.week_id
LEFT JOIN users f ON f.id = d.facilitator_id
`;

const canEditDebrief = (actor: UserRow, d: Pick<DebriefRow, 'created_by' | 'facilitator_id'>) =>
  isCommander(actor) || d.created_by === actor.id || d.facilitator_id === actor.id;

function counts(debriefId: number): Record<DebriefItemKind, number> {
  const out = { fact: 0, finding: 0, conclusion: 0, lesson: 0 } as Record<DebriefItemKind, number>;
  for (const r of db().all<{ kind: DebriefItemKind; n: number }>('SELECT kind, count(*) AS n FROM debrief_items WHERE debrief_id = ? GROUP BY kind', debriefId)) {
    out[r.kind] = r.n;
  }
  return out;
}

function toDebrief(actor: UserRow, d: DebriefRow): Debrief {
  return {
    id: d.id,
    title: d.title,
    occurredOn: d.occurred_on,
    eventId: d.event_id,
    eventTitle: d.event_title,
    weekId: d.week_id,
    weekName: d.week_name,
    facilitatorId: d.facilitator_id,
    facilitatorName: d.facilitator_name,
    participants: d.participants,
    summary: d.summary,
    status: d.status,
    createdBy: d.created_by,
    createdByName: d.created_by_name,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    itemCounts: counts(d.id),
    openTasks: d.open_tasks,
    canEdit: canEditDebrief(actor, d),
  };
}

function debriefRow(id: number): DebriefRow {
  const d = db().get<DebriefRow>(`${BASE} WHERE d.id = ?`, id);
  if (!d) throw notFound('התחקיר לא נמצא');
  return d;
}

export function listDebriefs(actor: UserRow, f: { weekId?: number; eventId?: number } = {}): Debrief[] {
  const where: string[] = [];
  const params: number[] = [];
  if (f.weekId) (where.push('d.week_id = ?'), params.push(f.weekId));
  if (f.eventId) (where.push('d.event_id = ?'), params.push(f.eventId));
  return db()
    .all<DebriefRow>(`${BASE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.occurred_on DESC, d.id DESC`, ...params)
    .map((d) => toDebrief(actor, d));
}

export const debriefSchema = z.object({
  title: z.string().trim().min(1, 'חובה לתת שם לתחקיר').max(200),
  occurredOn: z.string().refine(isDateKey, 'תאריך לא תקין'),
  eventId: z.number().int().positive().nullable().optional().default(null),
  facilitatorId: z.number().int().positive().nullable().optional().default(null),
  participants: z.string().max(2000).optional().default(''),
  summary: z.string().max(10000).optional().default(''),
});

export function createDebrief(actor: UserRow, raw: z.input<typeof debriefSchema>): number {
  const d = debriefSchema.parse(raw);
  if (d.eventId && !db().get('SELECT 1 FROM events WHERE id = ?', d.eventId)) throw badRequest('הפעילות לא נמצאה');
  if (d.facilitatorId && !getUserRow(d.facilitatorId)?.active) throw badRequest('מנחה התחקיר אינו פעיל');
  const at = nowIso();
  const id = db().run(
    `INSERT INTO debriefs(title, occurred_on, event_id, week_id, facilitator_id, participants, summary, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.title,
    d.occurredOn,
    d.eventId,
    weekForDate(d.occurredOn),
    d.facilitatorId ?? actor.id,
    d.participants,
    d.summary,
    actor.id,
    at,
    at,
  ).id;
  logActivity({ userId: actor.id, eventId: d.eventId, action: 'debrief', text: `${actor.display_name} פתח תחקיר: ${d.title}` });
  changed('debriefs');
  return id;
}

export function updateDebrief(actor: UserRow, id: number, raw: Partial<z.input<typeof debriefSchema>> & { status?: 'draft' | 'final' }): void {
  const cur = debriefRow(id);
  if (!canEditDebrief(actor, cur)) throw forbidden();
  const p = debriefSchema.partial().extend({ status: z.enum(['draft', 'final']).optional() }).parse(raw);
  const occurredOn = p.occurredOn ?? cur.occurred_on;
  db().tx(() => {
    db().run(
      'UPDATE debriefs SET title = ?, occurred_on = ?, event_id = ?, week_id = ?, facilitator_id = ?, participants = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?',
      p.title ?? cur.title,
      occurredOn,
      p.eventId !== undefined ? p.eventId : cur.event_id,
      weekForDate(occurredOn),
      p.facilitatorId !== undefined ? p.facilitatorId : cur.facilitator_id,
      p.participants ?? cur.participants,
      p.summary ?? cur.summary,
      p.status ?? cur.status,
      nowIso(),
      id,
    );
    if (p.status === 'final' && cur.status !== 'final') {
      logActivity({ userId: actor.id, action: 'debrief_final', text: `${actor.display_name} סיכם את התחקיר "${cur.title}"` });
      if (!isCommander(actor)) {
        const lessons = counts(id).lesson;
        notify(commanderIds(), { type: 'debrief', category: 'info', title: `תחקיר "${cur.title}" סוכם`, body: `${lessons} לקחים · ${cur.open_tasks} משימות המשך פתוחות`, link: `/debriefs/${id}` }, actor.id);
      }
    }
  });
  changed('debriefs');
}

export function deleteDebrief(actor: UserRow, id: number): void {
  const d = debriefRow(id);
  if (!isCommander(actor) && d.created_by !== actor.id) throw forbidden();
  db().run('DELETE FROM debriefs WHERE id = ?', id);
  changed('debriefs', 'tasks');
}

// ---------------- items ----------------

interface ItemRow {
  id: number;
  debrief_id: number;
  kind: DebriefItemKind;
  body: string;
  sort: number;
  task_id: number | null;
  task_title: string | null;
  task_status: TaskStatus | null;
  recurring_rule_id: number | null;
  recurring_title: string | null;
  created_at: string;
}

const ITEM_BASE = `
SELECT i.*, t.title AS task_title, t.status AS task_status, r.title AS recurring_title
FROM debrief_items i LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN recurring_rules r ON r.id = i.recurring_rule_id
`;

function toItem(i: ItemRow): DebriefItem {
  return {
    id: i.id,
    debriefId: i.debrief_id,
    kind: i.kind,
    body: i.body,
    sort: i.sort,
    taskId: i.task_id,
    taskTitle: i.task_title,
    taskStatus: i.task_status,
    recurringRuleId: i.recurring_rule_id,
    recurringTitle: i.recurring_title,
    createdAt: i.created_at,
  };
}

function itemRow(id: number): ItemRow {
  const i = db().get<ItemRow>(`${ITEM_BASE} WHERE i.id = ?`, id);
  if (!i) throw notFound('הפריט לא נמצא');
  return i;
}

export const itemSchema = z.object({ kind: z.enum(DEBRIEF_ITEM_KINDS), body: z.string().trim().min(1, 'הפריט ריק').max(3000) });

export function addItem(actor: UserRow, debriefId: number, raw: z.input<typeof itemSchema>): number {
  const d = debriefRow(debriefId);
  if (!canEditDebrief(actor, d)) throw forbidden();
  const it = itemSchema.parse(raw);
  const sort = (db().get<{ n: number | null }>('SELECT max(sort) AS n FROM debrief_items WHERE debrief_id = ?', debriefId)?.n ?? 0) + 1;
  const id = db().run(
    'INSERT INTO debrief_items(debrief_id, kind, body, sort, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    debriefId,
    it.kind,
    it.body,
    sort,
    actor.id,
    nowIso(),
  ).id;
  db().run('UPDATE debriefs SET updated_at = ? WHERE id = ?', nowIso(), debriefId);
  changed('debriefs');
  return id;
}

export function updateItem(actor: UserRow, id: number, body: string): void {
  const i = itemRow(id);
  if (!canEditDebrief(actor, debriefRow(i.debrief_id))) throw forbidden();
  const text = body.trim();
  if (!text) throw badRequest('הפריט ריק');
  db().run('UPDATE debrief_items SET body = ? WHERE id = ?', text, id);
  changed('debriefs');
}

export function deleteItem(actor: UserRow, id: number): void {
  const i = itemRow(id);
  if (!canEditDebrief(actor, debriefRow(i.debrief_id))) throw forbidden();
  db().run('DELETE FROM debrief_items WHERE id = ?', id);
  changed('debriefs');
}

export const itemTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  ownerIds: z.array(z.number().int().positive()).optional().default([]),
  allStaff: z.boolean().optional().default(false),
  deadline: isoDateTime,
  priority: z.enum(PRIORITIES).optional().default('normal'),
});

/** "אילו משימות נוצרות בעקבות הלקחים?" - a lesson or conclusion becomes a task. */
export function itemToTask(actor: UserRow, itemId: number, raw: z.input<typeof itemTaskSchema>): number[] {
  const i = itemRow(itemId);
  const d = debriefRow(i.debrief_id);
  if (!canEditDebrief(actor, d)) throw forbidden();
  const input = itemTaskSchema.parse(raw);
  let ids: number[] = [];
  db().tx(() => {
    ids = createTasks(
      actor,
      {
        title: input.title,
        description: `בעקבות התחקיר "${d.title}":\n${i.body}`,
        assignMode: input.allStaff ? 'all' : 'shared',
        ownerIds: input.ownerIds,
        deadline: input.deadline,
        priority: input.priority,
        domain: 'הערכה',
        debriefId: d.id,
      },
      { system: true },
    );
    db().run('UPDATE debrief_items SET task_id = ? WHERE id = ?', ids[0], itemId);
  });
  changed('debriefs', 'tasks');
  return ids;
}

/** A lesson that should happen every time becomes a recurring task (commander only, like all recurring tasks). */
export function itemToRecurring(actor: UserRow, itemId: number, raw: z.input<typeof recurringSchema>): number {
  if (!isCommander(actor)) throw forbidden('משימות חוזרות מוגדרות על ידי מפקד הקורס');
  itemRow(itemId);
  let ruleId = 0;
  db().tx(() => {
    ruleId = saveRule(actor, raw);
    db().run('UPDATE debrief_items SET recurring_rule_id = ? WHERE id = ?', ruleId, itemId);
  });
  changed('debriefs');
  return ruleId;
}

export const itemTemplateSchema = z.object({
  templateId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  offsetDays: z.number().int().min(-60).max(60),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  owner: z.string().max(20).optional(),
});

/** "שיחת תיאום עם מדריך - 48 שעות לפני כל פעילות": the lesson becomes a step of an activity template. */
export function itemToTemplate(actor: UserRow, itemId: number, raw: z.input<typeof itemTemplateSchema>): void {
  if (!isCommander(actor)) throw forbidden('תבניות מנוהלות על ידי מפקד הקורס');
  const i = itemRow(itemId);
  const input = itemTemplateSchema.parse(raw);
  const tpl = getTemplate(input.templateId);
  db().tx(() => {
    saveTemplate(
      actor,
      {
        name: tpl.name,
        description: tpl.description,
        kind: tpl.kind,
        autoApplyDaysBefore: tpl.autoApplyDaysBefore,
        items: [
          ...tpl.items,
          { title: input.title, offsetDays: input.offsetDays, time: input.time, owner: input.owner ?? (tpl.kind === 'activity' ? 'event_owner' : 'week_lead'), description: `לקח מתחקיר: ${i.body}`, stage: tpl.kind === 'activity' ? 'לקחים' : undefined },
        ],
      },
      tpl.id,
    );
    logActivity({ userId: actor.id, action: 'template', text: `${actor.display_name} הוסיף לתבנית "${tpl.name}" את הלקח: ${input.title}` });
  });
  changed('debriefs', 'templates');
}

export function debriefDetail(actor: UserRow, id: number): DebriefDetail {
  const d = debriefRow(id);
  return {
    debrief: toDebrief(actor, d),
    items: db()
      .all<ItemRow>(`${ITEM_BASE} WHERE i.debrief_id = ? ORDER BY i.sort, i.id`, id)
      .map(toItem),
    tasks: visibleTasks(actor, 't.debrief_id = ?', id).sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status))),
  };
}

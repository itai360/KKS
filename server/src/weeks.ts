// Course weeks: timeline (37), opening (38), readiness (14, 76), closing (54-56).

import { z } from 'zod';
import { CARRY_ACTIONS, isOpenStatus, LESSON_KINDS } from '../../shared/constants';
import { addDays, diffDays, isDateKey, localDateKey, localTime, zonedIso } from '../../shared/dates';
import { readinessPct } from '../../shared/taskLogic';
import type { CloseCheck, DomainReadiness, Lesson, Week, WeekDetail } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, getSettings, notFound, nowIso, patchSchema, tz, updateSettings } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { listEvents } from './schedule';
import { listExperiences } from './cadets';
import { listDebriefs } from './debriefs';
import { isCommander, mustTaskRow, visibleTasks } from './taskRepo';
import { createTasks, isoDateTime } from './taskService';
import { applyTemplate, listTemplates } from './templates';
import { followWeekLead } from './weeklyDebriefTask';

interface WeekRow {
  id: number;
  number: number;
  name: string;
  topic: string;
  goals: string;
  start_date: string;
  end_date: string;
  lead_id: number | null;
  lead_name: string | null;
  status: Week['status'];
  approved_at: string | null;
  approved_by_name: string | null;
  closed_at: string | null;
  total_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
}

// Readiness counts preparation tasks; routine recurring tasks are excluded.
const WEEK_BASE = `
SELECT w.*, u.display_name AS lead_name, a.display_name AS approved_by_name,
  (SELECT count(*) FROM tasks t WHERE t.week_id = w.id AND t.status <> 'cancelled' AND t.recurring_rule_id IS NULL) AS total_tasks,
  (SELECT count(*) FROM tasks t WHERE t.week_id = w.id AND t.status = 'done' AND t.recurring_rule_id IS NULL) AS done_tasks,
  (SELECT count(*) FROM tasks t WHERE t.week_id = w.id AND t.status NOT IN ('done', 'cancelled') AND t.deadline < ?) AS overdue_tasks
FROM weeks w
LEFT JOIN users u ON u.id = w.lead_id
LEFT JOIN users a ON a.id = w.approved_by
`;

function toWeek(r: WeekRow): Week {
  return {
    id: r.id,
    number: r.number,
    name: r.name,
    topic: r.topic,
    goals: r.goals,
    startDate: r.start_date,
    endDate: r.end_date,
    leadId: r.lead_id,
    leadName: r.lead_name,
    status: r.status,
    approvedAt: r.approved_at,
    approvedByName: r.approved_by_name,
    closedAt: r.closed_at,
    totalTasks: r.total_tasks,
    doneTasks: r.done_tasks,
    overdueTasks: r.overdue_tasks,
    readiness: readinessPct(r.done_tasks, r.total_tasks),
  };
}

export function listWeeks(where = '1=1', ...params: (string | number)[]): Week[] {
  return db()
    .all<WeekRow>(`${WEEK_BASE} WHERE ${where} ORDER BY w.start_date, w.number`, nowIso(), ...params)
    .map(toWeek);
}

export function getWeek(id: number): Week {
  const w = listWeeks('w.id = ?', id)[0];
  if (!w) throw notFound('השבוע לא נמצא');
  return w;
}

export function weekContaining(dateKey: string): Week | null {
  return listWeeks('w.start_date <= ? AND w.end_date >= ?', dateKey, dateKey)[0] ?? null;
}

export function nextWeekAfter(w: Pick<Week, 'startDate' | 'id'>): Week | null {
  return listWeeks('w.start_date > ? AND w.id <> ?', w.startDate, w.id)[0] ?? null;
}

export function domainReadiness(where: string, ...params: (string | number)[]): DomainReadiness[] {
  const rows = db().all<{ domain: string; total: number; done: number }>(
    `SELECT CASE WHEN t.domain = '' THEN 'ללא תחום' ELSE t.domain END AS domain,
       count(*) AS total, sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
     FROM tasks t WHERE t.status <> 'cancelled' AND t.recurring_rule_id IS NULL AND ${where}
     GROUP BY 1 ORDER BY total DESC`,
    ...params,
  );
  return rows.map((r) => ({ domain: r.domain, total: r.total, done: r.done, readiness: readinessPct(r.done, r.total) }));
}

const canManage = (actor: UserRow, w: Pick<Week, 'leadId'>) => isCommander(actor) || w.leadId === actor.id;

export const weekSchema = z.object({
  number: z.number().int().min(0).max(100).optional(),
  name: z.string().trim().min(1, 'חובה לתת שם לשבוע').max(80),
  topic: z.string().max(200).optional().default(''),
  goals: z.string().max(4000).optional().default(''),
  startDate: z.string().refine(isDateKey, 'תאריך לא תקין'),
  endDate: z.string().refine(isDateKey, 'תאריך לא תקין'),
  leadId: z.number().int().positive().nullable().optional().default(null),
});

function checkLead(id: number | null | undefined): void {
  if (!id) return;
  const u = getUserRow(id);
  if (!u || !u.active) throw badRequest('המפק"צ שנבחר אינו פעיל');
}

/**
 * The number of a week given none: counted on from the nearest week by date, so it follows the
 * course's own numbering - 1, 2, 3, or the calendar's 38, 39, 40. The first week is 1.
 */
export function inferWeekNumber(startDate: string, known: { number: number; startDate: string }[] = weekNumbers()): number {
  if (!known.length) return 1;
  const near = known.reduce((a, b) => (Math.abs(diffDays(b.startDate, startDate)) < Math.abs(diffDays(a.startDate, startDate)) ? b : a));
  const n = near.number + Math.round(diffDays(startDate, near.startDate) / 7);
  return n >= 1 && n <= 100 ? n : Math.max(...known.map((k) => k.number)) + 1;
}

const weekNumbers = () => db().all<{ number: number; startDate: string }>('SELECT number, start_date AS startDate FROM weeks');

export function createWeek(actor: UserRow, raw: z.input<typeof weekSchema>): number {
  const w = weekSchema.parse(raw);
  if (w.endDate < w.startDate) throw badRequest('תאריך הסיום לפני תאריך ההתחלה');
  checkLead(w.leadId);
  const number = w.number ?? inferWeekNumber(w.startDate);
  const id = db().tx(() => {
    const id = db().run(
      'INSERT INTO weeks(number, name, topic, goals, start_date, end_date, lead_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      number,
      w.name,
      w.topic,
      w.goals,
      w.startDate,
      w.endDate,
      w.leadId,
      nowIso(),
    ).id;
    logActivity({ weekId: id, userId: actor.id, action: 'week_created', text: `${actor.display_name} יצר את ${w.name}` });
    // Tasks already due inside the new week's dates are attached to it.
    db().run(
      'UPDATE tasks SET week_id = ? WHERE week_id IS NULL AND deadline >= ? AND deadline < ?',
      id,
      zonedIso(w.startDate, '00:00', tz()),
      zonedIso(addDays(w.endDate, 1), '00:00', tz()),
    );
    return id;
  });
  if (w.leadId) notifyLead(actor, id, w.leadId, w.name);
  changed('weeks', 'tasks');
  return id;
}

function notifyLead(actor: UserRow, weekId: number, leadId: number, name: string): void {
  notify([leadId], { type: 'week_lead', category: 'action', title: `מונית למפק"צ אחראי על ${name}`, link: `/weeks/${weekId}` }, actor.id);
}

export function updateWeek(actor: UserRow, id: number, raw: Partial<z.input<typeof weekSchema>>): void {
  const cur = getWeek(id);
  if (!canManage(actor, cur)) throw forbidden();
  const patch = patchSchema(weekSchema).parse(raw);
  // The lead may update goals/topic; dates, name and lead belong to the commander.
  if (!isCommander(actor) && (patch.startDate || patch.endDate || patch.leadId !== undefined || patch.name || patch.number !== undefined)) {
    throw forbidden('רק מפקד הקורס יכול לשנות תאריכים, שם ומפק"צ אחראי');
  }
  checkLead(patch.leadId);
  const next = { ...cur, ...patch };
  if ((patch.endDate ?? cur.endDate) < (patch.startDate ?? cur.startDate)) throw badRequest('תאריך הסיום לפני תאריך ההתחלה');
  db().tx(() => {
    db().run(
      'UPDATE weeks SET number = ?, name = ?, topic = ?, goals = ?, start_date = ?, end_date = ?, lead_id = ? WHERE id = ?',
      next.number,
      next.name,
      next.topic,
      next.goals,
      next.startDate,
      next.endDate,
      patch.leadId !== undefined ? patch.leadId : cur.leadId,
      id,
    );
    logActivity({ weekId: id, userId: actor.id, action: 'week_updated', text: `${actor.display_name} עדכן את פרטי ${next.name}` });
  });
  if (patch.leadId && patch.leadId !== cur.leadId) {
    notifyLead(actor, id, patch.leadId, next.name);
    followWeekLead(actor, id, patch.leadId);
  }
  changed('weeks', 'tasks');
}

export function deleteWeek(id: number): void {
  getWeek(id);
  db().run('DELETE FROM weeks WHERE id = ?', id);
  changed('weeks', 'tasks');
}

export const generateSchema = z.object({
  startDate: z.string().refine(isDateKey, 'תאריך לא תקין'),
  count: z.number().int().min(1).max(30),
  names: z.array(z.string().trim().max(80)).optional().default([]),
  leadIds: z.array(z.number().int().positive().nullable()).optional().default([]),
});

/** Section 36: create the list of course weeks in one go. */
export function generateWeeks(actor: UserRow, raw: z.input<typeof generateSchema>): number[] {
  const g = generateSchema.parse(raw);
  const base = db().get<{ n: number | null }>('SELECT max(number) AS n FROM weeks')?.n ?? 0;
  const ids: number[] = [];
  db().tx(() => {
    for (let i = 0; i < g.count; i++) {
      const start = addDays(g.startDate, i * 7);
      ids.push(
        createWeek(actor, {
          number: base + i + 1,
          name: g.names[i] || `שבוע ${base + i + 1}`,
          startDate: start,
          endDate: addDays(start, 6),
          leadId: g.leadIds[i] ?? null,
        }),
      );
    }
    const s = getSettings();
    const last = addDays(g.startDate, g.count * 7 - 1);
    updateSettings({
      startDate: s.startDate && s.startDate < g.startDate ? s.startDate : g.startDate,
      endDate: s.endDate && s.endDate > last ? s.endDate : last,
    });
  });
  return ids;
}

function listLessons(weekId: number): Lesson[] {
  return db()
    .all<{
      id: number;
      week_id: number;
      kind: Lesson['kind'];
      body: string;
      created_by: number;
      created_by_name: string;
      task_id: number | null;
      task_title: string | null;
      created_at: string;
    }>(
      `SELECT l.*, u.display_name AS created_by_name, t.title AS task_title FROM lessons l
       JOIN users u ON u.id = l.created_by LEFT JOIN tasks t ON t.id = l.task_id
       WHERE l.week_id = ? ORDER BY l.created_at`,
      weekId,
    )
    .map((l) => ({
      id: l.id,
      weekId: l.week_id,
      kind: l.kind,
      body: l.body,
      createdBy: l.created_by,
      createdByName: l.created_by_name,
      taskId: l.task_id,
      taskTitle: l.task_title,
      createdAt: l.created_at,
    }));
}

export function weekDetail(actor: UserRow, id: number): WeekDetail {
  const week = getWeek(id);
  const next = nextWeekAfter(week);
  return {
    week,
    byDomain: domainReadiness('t.week_id = ?', id),
    tasks: visibleTasks(actor, 't.week_id = ?', id),
    events: listEvents(week.startDate, week.endDate),
    lessons: listLessons(id),
    checklistTemplates: listTemplates('week'),
    appliedTemplateIds: db()
      .all<{ template_id: number }>('SELECT template_id FROM week_templates WHERE week_id = ?', id)
      .map((r) => r.template_id),
    nextWeek: next ? { id: next.id, name: next.name, startDate: next.startDate } : null,
    debriefs: listDebriefs(actor, { weekId: id }),
    experiences: listExperiences(actor, { weekId: id }),
  };
}

export const openWeekSchema = z.object({
  templateId: z.number().int().positive().optional(),
  itemIndexes: z.array(z.number().int().min(0)).optional(),
  owners: z.record(z.string(), z.number().int().positive()).optional(),
});

/** Section 38: "פתיחת שבוע" - optional checklist items become tasks. */
export function openWeek(actor: UserRow, id: number, raw: z.input<typeof openWeekSchema>): number[] {
  const w = getWeek(id);
  if (!canManage(actor, w)) throw forbidden('רק מפקד הקורס או המפק"צ האחראי יכולים לפתוח את השבוע');
  const input = openWeekSchema.parse(raw);
  let created: number[] = [];
  db().tx(() => {
    if (input.templateId) {
      created = applyTemplate(actor, input.templateId, { weekId: id, itemIndexes: input.itemIndexes, owners: input.owners }, { trusted: true });
    }
    if (w.status === 'planning') db().run("UPDATE weeks SET status = 'open' WHERE id = ?", id);
    logActivity({ weekId: id, userId: actor.id, action: 'week_opened', text: `${actor.display_name} ביצע פתיחת שבוע ל${w.name}${created.length ? ` ונפתחו ${created.length} משימות` : ''}` });
  });
  changed('weeks', 'tasks');
  return created;
}

/** Section 53: the commander approves the coming week. */
export function approveWeek(actor: UserRow, id: number): void {
  const w = getWeek(id);
  db().tx(() => {
    db().run('UPDATE weeks SET approved_at = ?, approved_by = ? WHERE id = ?', nowIso(), actor.id, id);
    logActivity({ weekId: id, userId: actor.id, action: 'week_approved', text: `${actor.display_name} אישר את ${w.name} (מוכנות ${w.readiness}%)` });
    if (w.leadId) notify([w.leadId], { type: 'week_approved', category: 'info', title: `${w.name} אושר על ידי מפקד הקורס`, link: `/weeks/${id}` }, actor.id);
  });
  changed('weeks');
}

export function closeCheck(actor: UserRow, id: number): CloseCheck {
  const w = getWeek(id);
  const tasks = visibleTasks(actor, 't.week_id = ?', id).filter((t) => isOpenStatus(t.status));
  const next = nextWeekAfter(w);
  return {
    overdue: tasks.filter((t) => t.overdue),
    open: tasks.filter((t) => !t.overdue),
    blocked: tasks.filter((t) => t.status === 'waiting'),
    lessonsCount: db().get<{ n: number }>('SELECT count(*) AS n FROM lessons WHERE week_id = ?', id)!.n,
    nextWeek: next ? { id: next.id, name: next.name, startDate: next.startDate } : null,
  };
}

export const closeSchema = z.object({
  decisions: z
    .array(
      z.object({
        taskId: z.number().int().positive(),
        action: z.enum(CARRY_ACTIONS),
        newDeadline: isoDateTime.optional(),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .default([]),
});

/** Sections 54-55: close the week, deciding what happens to each unfinished task. */
export function closeWeek(actor: UserRow, id: number, raw: z.input<typeof closeSchema>): void {
  const w = getWeek(id);
  if (!canManage(actor, w)) throw forbidden('רק מפקד הקורס או המפק"צ האחראי יכולים לסגור את השבוע');
  if (w.status === 'closed') throw badRequest('השבוע כבר נסגר');
  const { decisions } = closeSchema.parse(raw);
  const next = nextWeekAfter(w);
  const now = clock.now();
  db().tx(() => {
    for (const d of decisions) {
      const t = mustTaskRow(d.taskId);
      if (t.week_id !== id || !isOpenStatus(t.status)) continue;
      if (d.action === 'move') {
        // a week after the deadline (or after today, when already late), at its hour of the day
        const base = new Date(Math.max(Date.parse(t.deadline), now.getTime()));
        const newDeadline = d.newDeadline ?? zonedIso(addDays(localDateKey(base, tz()), 7), localTime(t.deadline, tz()), tz());
        db().run(
          'UPDATE tasks SET week_id = ?, deadline = ?, carried_count = carried_count + 1, reminded_24h = 0, reminded_2h = 0, overdue_notified = 0, overdue_response = NULL WHERE id = ?',
          next?.id ?? null,
          newDeadline,
          t.id,
        );
        logActivity({
          taskId: t.id,
          weekId: id,
          userId: actor.id,
          action: 'carried',
          text: `${actor.display_name} העביר את המשימה ל${next ? next.name : 'המשך'} בסגירת ${w.name}`,
          data: { fromWeek: id, toWeek: next?.id ?? null, from: t.deadline, to: newDeadline },
        });
        notify([t.owner_id], { type: 'carried', category: 'info', title: `המשימה "${t.title}" עברה ל${next ? next.name : 'שבוע הבא'}`, taskId: t.id }, actor.id);
      } else if (d.action === 'cancel') {
        const reason = d.reason || `בוטלה בסגירת ${w.name}`;
        db().run("UPDATE tasks SET status = 'cancelled', cancel_reason = ?, needs_commander = 0 WHERE id = ?", reason, t.id);
        logActivity({ taskId: t.id, weekId: id, userId: actor.id, action: 'cancelled', text: `${actor.display_name} ביטל את המשימה בסגירת השבוע: ${reason}` });
      } else {
        logActivity({ taskId: t.id, weekId: id, userId: actor.id, action: 'kept', text: `${actor.display_name} השאיר את המשימה פתוחה בסגירת ${w.name}` });
      }
    }
    db().run("UPDATE weeks SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?", nowIso(), actor.id, id);
    logActivity({ weekId: id, userId: actor.id, action: 'week_closed', text: `${actor.display_name} סגר את ${w.name}` });
    if (!isCommander(actor)) {
      notify(commanderIds(), { type: 'week_closed', category: 'info', title: `${w.name} נסגר על ידי ${actor.display_name}`, link: `/weeks/${id}` }, actor.id);
    }
  });
  changed('weeks', 'tasks');
}

export const lessonSchema = z.object({
  kind: z.enum(LESSON_KINDS),
  body: z.string().trim().min(2, 'יש לכתוב את הלקח').max(2000),
  task: z
    .object({
      title: z.string().trim().min(1).max(200),
      ownerId: z.number().int().positive(),
      deadline: isoDateTime,
      weekId: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});

/** Section 56: a lesson can immediately produce a task, so it doesn't stay text only. */
export function addLesson(actor: UserRow, weekId: number, raw: z.input<typeof lessonSchema>): number {
  const w = getWeek(weekId);
  const input = lessonSchema.parse(raw);
  let id = 0;
  db().tx(() => {
    let taskId: number | null = null;
    if (input.task) {
      const next = nextWeekAfter(w);
      const mayAssign = canManage(actor, w) || input.task.ownerId === actor.id;
      if (!mayAssign) throw forbidden('רק מפקד הקורס או מפק"צ השבוע יכולים לפתוח משימה לאחרים מתוך לקח');
      [taskId] = createTasks(
        actor,
        {
          title: input.task.title,
          description: `בעקבות לקח מ${w.name}: ${input.body}`,
          ownerIds: [input.task.ownerId],
          deadline: input.task.deadline,
          weekId: input.task.weekId !== undefined ? input.task.weekId : (next?.id ?? undefined),
        },
        { system: true },
      );
    }
    id = db().run(
      'INSERT INTO lessons(week_id, kind, body, created_by, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      weekId,
      input.kind,
      input.body,
      actor.id,
      taskId,
      nowIso(),
    ).id;
    logActivity({ weekId, userId: actor.id, action: 'lesson', text: `${actor.display_name} הוסיף לקח ל${w.name}` });
  });
  changed('weeks');
  return id;
}

export function deleteLesson(actor: UserRow, id: number): void {
  const l = db().get<{ created_by: number }>('SELECT created_by FROM lessons WHERE id = ?', id);
  if (!l) throw notFound();
  if (!isCommander(actor) && l.created_by !== actor.id) throw forbidden();
  db().run('DELETE FROM lessons WHERE id = ?', id);
  changed('weeks');
}

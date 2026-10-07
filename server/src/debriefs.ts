// Section 31 (debriefs) and 57: event -> facts -> findings -> conclusions -> lessons,
// and every lesson can become a task, a recurring task, or a step in an activity template
// (e.g. "שיחת תיאום עם מדריך - 48 שעות לפני כל פעילות").

import { z } from 'zod';
import { DEBRIEF_ITEM_KINDS, PRIORITIES, isOpenStatus, type DebriefItemKind, type TaskStatus } from '../../shared/constants';
import { addDays, isDateKey, localDateKey, localTime, zonedIso } from '../../shared/dates';
import {
  answered,
  COMPANY_DEBRIEF_ROLE,
  DEBRIEF_KINDS,
  DEBRIEF_KIND_LABELS,
  formFor,
  goalsFromText,
  isWeekDebrief,
  LESSON_DECISIONS,
  LESSON_HORIZONS,
  LESSON_REQUIRED,
  needsAPoint,
  type DebriefAnswers,
  type DebriefKind,
  type LessonDecision,
  type LessonHorizon,
} from '../../shared/debriefForms';
import { searchKey } from '../../shared/search';
import type { BankLesson, Debrief, DebriefDetail, DebriefItem, LessonReview } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { badRequest, forbidden, getSettings, notFound, nowIso, patchSchema, tz } from './core';
import { db } from './db';
import { changed, firstTime as once, logActivity, notify } from './journal';
import { recurringSchema, saveRule } from './recurring';
import { isCommander, visibleTasks } from './taskRepo';
import { createTasks, isoDateTime, weekForDate } from './taskService';
import { getTemplate, saveTemplate } from './templates';
import { closeWeeklyDebriefTask } from './weeklyDebriefTask';

interface DebriefRow {
  id: number;
  kind: DebriefKind;
  answers: string;
  title: string;
  occurred_on: string;
  event_id: number | null;
  event_title: string | null;
  activity: string;
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
SELECT d.*, coalesce(e.title, nullif(d.activity, '')) AS event_title, w.name AS week_name, f.display_name AS facilitator_name, c.display_name AS created_by_name,
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

function parseAnswers(raw: string): DebriefAnswers {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as DebriefAnswers) : {};
  } catch {
    return {};
  }
}

const cadetName = (id: number) => db().get<{ n: string }>("SELECT trim(first_name || ' ' || last_name) AS n FROM cadets WHERE id = ?", id)?.n ?? null;

/**
 * The cadet who brings the company debrief on a day: the one in the broad experience of training
 * officer (קה"ד רוחבי) then - and the staff member who mentors that experience.
 */
export function companyPresenter(date: string): { cadetId: number; cadetName: string; mentorId: number | null } | null {
  const rows = db().all<{ cadet_id: number; role: string; mentor_id: number | null; name: string }>(
    `SELECT x.cadet_id, x.role, x.mentor_id, trim(c.first_name || ' ' || c.last_name) AS name FROM experiences x JOIN cadets c ON c.id = x.cadet_id
     WHERE x.kind = 'broad' AND x.start_date <= ? AND x.end_date >= ? AND c.status = 'active' ORDER BY x.start_date DESC, x.id DESC`,
    date,
    date,
  );
  const r = rows.find((x) => searchKey(x.role) === searchKey(COMPANY_DEBRIEF_ROLE));
  return r ? { cadetId: r.cadet_id, cadetName: r.name, mentorId: r.mentor_id } : null;
}

function presenterOf(kind: DebriefKind, a: DebriefAnswers): number | null {
  return kind === 'company' && typeof a.presenterId === 'number' ? a.presenterId : null;
}

function checkPresenter(a: Partial<DebriefAnswers>): void {
  const p = a.presenterId;
  if (p === undefined || p === null) return;
  if (typeof p !== 'number' || !db().get('SELECT 1 FROM cadets WHERE id = ?', p)) throw badRequest('הצוער שמעביר את התחקיר לא נמצא');
}

function toDebrief(actor: UserRow, d: DebriefRow): Debrief {
  const kind = DEBRIEF_KINDS.includes(d.kind) ? d.kind : 'general';
  const answers = parseAnswers(d.answers);
  const presenterId = presenterOf(kind, answers);
  return {
    id: d.id,
    kind,
    answers,
    presenterId,
    presenterName: presenterId ? cadetName(presenterId) : null,
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

const answersSchema = z
  .record(z.string().max(40), z.unknown())
  .refine((a) => JSON.stringify(a).length <= 40000, 'התחקיר ארוך מדי');

export const debriefSchema = z.object({
  kind: z.enum(DEBRIEF_KINDS).optional().default('general'),
  /** a weekly debrief names its week (it often takes place on the next week's first day) */
  weekId: z.number().int().positive().nullable().optional().default(null),
  answers: answersSchema.optional().default({}),
  title: z.string().trim().min(1, 'חובה לתת שם לתחקיר').max(200),
  occurredOn: z.string().refine(isDateKey, 'תאריך לא תקין'),
  eventId: z.number().int().positive().nullable().optional().default(null),
  /** an activity from the synced Google calendar, by name (a schedule event goes by eventId) */
  activity: z.string().trim().max(200).optional().default(''),
  facilitatorId: z.number().int().positive().nullable().optional().default(null),
  participants: z.string().max(2000).optional().default(''),
  summary: z.string().max(10000).optional().default(''),
});

function weekRow(id: number): { id: number; number: number; name: string; goals: string } {
  const w = db().get<{ id: number; number: number; name: string; goals: string }>('SELECT id, number, name, goals FROM weeks WHERE id = ?', id);
  if (!w) throw badRequest('השבוע לא נמצא');
  return w;
}

export function createDebrief(actor: UserRow, raw: z.input<typeof debriefSchema>): number {
  const d = debriefSchema.parse(raw);
  if (d.eventId && !db().get('SELECT 1 FROM events WHERE id = ?', d.eventId)) throw badRequest('הפעילות לא נמצאה');
  if (d.facilitatorId && !getUserRow(d.facilitatorId)?.active) throw badRequest('מנחה התחקיר אינו פעיל');
  const week = isWeekDebrief(d.kind) && d.weekId ? weekRow(d.weekId) : null;
  if (isWeekDebrief(d.kind) && !week) throw badRequest('בחרו את השבוע שהתחקיר עוסק בו');
  checkPresenter(d.answers);
  let answers = d.answers;
  // a weekly debrief starts from the goals its week set
  if (d.kind === 'weekly' && week && !answers.goals) answers = { ...answers, goals: goalsFromText(week.goals) };
  // the company debrief: brought by the training officer of that day, unless another cadet was chosen
  if (d.kind === 'company' && answers.presenterId === undefined) answers = { ...answers, presenterId: companyPresenter(d.occurredOn)?.cadetId ?? null };
  const at = nowIso();
  const id = db().run(
    `INSERT INTO debriefs(kind, answers, title, occurred_on, event_id, activity, week_id, facilitator_id, participants, summary, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.kind,
    JSON.stringify(answers),
    d.title,
    d.occurredOn,
    d.eventId,
    d.eventId ? '' : d.activity,
    week ? week.id : weekForDate(d.occurredOn),
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
  const p = patchSchema(debriefSchema).extend({ status: z.enum(['draft', 'final']).optional() }).parse(raw);
  const occurredOn = p.occurredOn ?? cur.occurred_on;
  const eventId = p.eventId !== undefined ? p.eventId : cur.event_id;
  if (p.eventId && !db().get('SELECT 1 FROM events WHERE id = ?', p.eventId)) throw badRequest('הפעילות לא נמצאה');
  // answers come per question: two people filling different parts of the form both keep theirs
  if (p.answers) checkPresenter(p.answers);
  const answers = p.answers ? { ...parseAnswers(cur.answers), ...p.answers } : parseAnswers(cur.answers);
  if (JSON.stringify(answers).length > 40000) throw badRequest('התחקיר ארוך מדי');
  const weekId = isWeekDebrief(cur.kind) ? (p.weekId ? weekRow(p.weekId).id : cur.week_id) : weekForDate(occurredOn);
  const summingUp = p.status === 'final' && cur.status !== 'final';
  if (summingUp && cur.kind !== 'general') checkReady(cur, answers);
  db().tx(() => {
    db().run(
      'UPDATE debriefs SET answers = ?, title = ?, occurred_on = ?, event_id = ?, activity = ?, week_id = ?, facilitator_id = ?, participants = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(answers),
      p.title ?? cur.title,
      occurredOn,
      eventId,
      eventId ? '' : (p.activity ?? cur.activity),
      weekId,
      p.facilitatorId !== undefined ? p.facilitatorId : cur.facilitator_id,
      p.participants ?? cur.participants,
      p.summary ?? cur.summary,
      p.status ?? cur.status,
      nowIso(),
      id,
    );
    // the week or event it is about changed: the lessons kept for the next cycle follow it
    if (p.weekId !== undefined || p.eventId !== undefined || p.activity !== undefined || p.title !== undefined) {
      const t = lessonTarget(debriefRow(id));
      db().run("UPDATE debrief_items SET target = ?, target_key = ?, target_week = ? WHERE debrief_id = ? AND horizon = 'next'", t.target, t.key, t.week, id);
    }
    if (summingUp) {
      const opened = cur.kind === 'general' ? 0 : lessonsToTasks(actor, cur);
      // the week's lead had it as a task: done
      if (cur.kind === 'weekly' && weekId) closeWeeklyDebriefTask(actor, weekId);
      logActivity({ userId: actor.id, action: 'debrief_final', text: `${actor.display_name} סיכם את התחקיר "${cur.title}"` });
      if (answers.safetyEvent === true) {
        notify(commanderIds(), { type: 'debrief', category: 'exception', title: `אירוע בטיחות במופע: ${cur.title}`, body: String(answers.safety ?? '').slice(0, 200), link: `/debriefs/${id}` }, actor.id);
      }
      if (!isCommander(actor)) {
        const lessons = counts(id).lesson;
        notify(commanderIds(), { type: 'debrief', category: 'info', title: `תחקיר "${cur.title}" סוכם`, body: `${lessons} לקחים · ${cur.open_tasks + opened} משימות המשך פתוחות`, link: `/debriefs/${id}` }, actor.id);
      }
    }
  });
  changed('debriefs', 'tasks');
}

/** before a form is summed up: the questions that must be answered, and lessons that can be acted on */
function checkReady(d: DebriefRow, answers: DebriefAnswers): void {
  const missing = formFor(d.kind)
    .filter((s) => s.questions.some((q) => q.required && !answered(q, answers)))
    .map((s) => s.title);
  if (missing.length) throw badRequest(`כדי לסכם חסר: ${missing.join(', ')}`);
  if (needsAPoint(d.kind, answers)) throw badRequest(`כדי לסכם צריך לפחות נקודה אחת - ${formFor(d.kind).map((s) => s.title).join(', ')}`);
  const lessons = db().all<{ horizon: LessonHorizon | null; owner_id: number | null; due_date: string | null; task_id: number | null }>(
    "SELECT horizon, owner_id, due_date, task_id FROM debrief_items WHERE debrief_id = ? AND kind = 'lesson'",
    d.id,
  );
  if (!lessons.length && LESSON_REQUIRED[d.kind]) throw badRequest('תחקיר בלי לקחים לא משנה דבר - הוסיפו לפחות לקח אחד');
  if (lessons.some((l) => l.horizon === 'now' && !l.task_id && (!l.owner_id || !l.due_date))) throw badRequest('לכל לקח להמשך המחזור צריך אחראי ותאריך - כך הוא הופך למשימה');
}

/** on summing up: every lesson for this cycle becomes a task for its owner, by its date */
function lessonsToTasks(actor: UserRow, d: DebriefRow): number {
  const rows = db().all<{ id: number; body: string; owner_id: number; due_date: string }>(
    "SELECT id, body, owner_id, due_date FROM debrief_items WHERE debrief_id = ? AND kind = 'lesson' AND horizon = 'now' AND task_id IS NULL AND owner_id IS NOT NULL AND due_date IS NOT NULL",
    d.id,
  );
  const time = getSettings().defaultDeadlineTime;
  for (const l of rows) {
    const [taskId] = createTasks(
      actor,
      {
        title: l.body.split('\n')[0].slice(0, 200),
        description: `לקח מ${DEBRIEF_KIND_LABELS[d.kind]} "${d.title}":\n${l.body}`,
        ownerIds: [l.owner_id],
        deadline: zonedIso(l.due_date, time, tz()),
        domain: 'הערכה',
        debriefId: d.id,
      },
      { system: true },
    );
    db().run('UPDATE debrief_items SET task_id = ? WHERE id = ?', taskId, l.id);
  }
  return rows.length;
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
  horizon: LessonHorizon | null;
  owner_id: number | null;
  owner_name: string | null;
  due_date: string | null;
  target: string;
}

const ITEM_BASE = `
SELECT i.*, t.title AS task_title, t.status AS task_status, r.title AS recurring_title, o.display_name AS owner_name
FROM debrief_items i LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN recurring_rules r ON r.id = i.recurring_rule_id
LEFT JOIN users o ON o.id = i.owner_id
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
    horizon: i.horizon,
    ownerId: i.owner_id,
    ownerName: i.owner_name,
    dueDate: i.due_date,
    target: i.target,
  };
}

function itemRow(id: number): ItemRow {
  const i = db().get<ItemRow>(`${ITEM_BASE} WHERE i.id = ?`, id);
  if (!i) throw notFound('הפריט לא נמצא');
  return i;
}

export const itemSchema = z.object({
  kind: z.enum(DEBRIEF_ITEM_KINDS),
  body: z.string().trim().min(1, 'הפריט ריק').max(3000),
  horizon: z.enum(LESSON_HORIZONS).nullable().optional().default(null),
  ownerId: z.number().int().positive().nullable().optional().default(null),
  dueDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional().default(null),
});

/** what a lesson for the next cycle is for: the week (by number and name) or the event (by name) */
function lessonTarget(d: DebriefRow): { target: string; key: string; week: number | null } {
  if (isWeekDebrief(d.kind) && d.week_id) {
    const w = weekRow(d.week_id);
    return { target: `שבוע ${w.number} · ${w.name}`, key: searchKey(w.name), week: w.number };
  }
  const name = d.event_title || d.title;
  return { target: name, key: searchKey(name), week: null };
}

export function addItem(actor: UserRow, debriefId: number, raw: z.input<typeof itemSchema>): number {
  const d = debriefRow(debriefId);
  if (!canEditDebrief(actor, d)) throw forbidden();
  const it = itemSchema.parse(raw);
  if (it.ownerId && !getUserRow(it.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const t = it.horizon === 'next' ? lessonTarget(d) : { target: '', key: '', week: null };
  const sort = (db().get<{ n: number | null }>('SELECT max(sort) AS n FROM debrief_items WHERE debrief_id = ?', debriefId)?.n ?? 0) + 1;
  const id = db().run(
    'INSERT INTO debrief_items(debrief_id, kind, body, sort, created_by, created_at, horizon, owner_id, due_date, target, target_key, target_week) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    debriefId,
    it.kind,
    it.body,
    sort,
    actor.id,
    nowIso(),
    it.horizon,
    it.ownerId,
    it.dueDate,
    t.target,
    t.key,
    t.week,
  ).id;
  db().run('UPDATE debriefs SET updated_at = ? WHERE id = ?', nowIso(), debriefId);
  changed('debriefs');
  return id;
}

export const itemPatchSchema = z.object({
  body: z.string().max(3000).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional(),
});

export function updateItem(actor: UserRow, id: number, raw: z.input<typeof itemPatchSchema>): void {
  const i = itemRow(id);
  if (!canEditDebrief(actor, debriefRow(i.debrief_id))) throw forbidden();
  const p = itemPatchSchema.parse(raw);
  const text = p.body !== undefined ? p.body.trim() : i.body;
  if (!text) throw badRequest('הפריט ריק');
  if (p.ownerId && !getUserRow(p.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  db().run(
    'UPDATE debrief_items SET body = ?, owner_id = ?, due_date = ? WHERE id = ?',
    text,
    p.ownerId !== undefined ? p.ownerId : i.owner_id,
    p.dueDate !== undefined ? p.dueDate : i.due_date,
    id,
  );
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

interface BankRow {
  id: number;
  body: string;
  target: string;
  target_key: string;
  target_week: number | null;
  owner_name: string | null;
  debrief_id: number;
  debrief_title: string;
  kind: DebriefKind;
  occurred_on: string;
  week_id: number | null;
  event_id: number | null;
  created_by_name: string | null;
}

function bankRows(): BankRow[] {
  return db().all<BankRow>(
    `SELECT i.id, i.body, i.target, i.target_key, i.target_week, o.display_name AS owner_name, d.id AS debrief_id, d.title AS debrief_title,
       d.kind, d.occurred_on, d.week_id, d.event_id, c.display_name AS created_by_name
     FROM debrief_items i JOIN debriefs d ON d.id = i.debrief_id
     LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users c ON c.id = i.created_by
     WHERE i.kind = 'lesson' AND i.horizon = 'next'
     ORDER BY d.occurred_on DESC, i.id`,
  );
}

/** for a week: what an earlier cycle wrote for a week of the same number or name - not this week's own */
function forWeek(rows: BankRow[], w: { id: number; number: number; name: string }): BankRow[] {
  const key = searchKey(w.name);
  return rows.filter((r) => r.week_id !== w.id && (r.target_week === w.number || (!!r.target_key && r.target_key === key)));
}

/** for an event: what was written for an event of that name - not by this very event */
function forEvent(rows: BankRow[], e: { id: number; title: string }): BankRow[] {
  const key = searchKey(e.title);
  return rows.filter((r) => r.event_id !== e.id && r.target_week === null && !!r.target_key && !!key && (key.includes(r.target_key) || r.target_key.includes(key)));
}

const contextKey = (f: { weekId?: number; eventId?: number }) => (f.weekId ? `w:${f.weekId}` : `e:${f.eventId}`);

function reviewsFor(context: string): Map<number, LessonReview> {
  const out = new Map<number, LessonReview>();
  for (const r of db().all<{ item_id: number; decision: LessonDecision; note: string; task_id: number | null; task_title: string | null; task_status: TaskStatus | null; decided_by_name: string | null; decided_at: string }>(
    `SELECT r.item_id, r.decision, r.note, r.task_id, t.title AS task_title, t.status AS task_status, u.display_name AS decided_by_name, r.decided_at
     FROM lesson_reviews r LEFT JOIN tasks t ON t.id = r.task_id LEFT JOIN users u ON u.id = r.decided_by WHERE r.context = ?`,
    context,
  )) {
    out.set(r.item_id, { decision: r.decision, note: r.note, taskId: r.task_id, taskTitle: r.task_title, taskStatus: r.task_status, decidedByName: r.decided_by_name, decidedAt: r.decided_at });
  }
  return out;
}

function eventRow(id: number): { id: number; title: string; date: string; owner_id: number | null; week_id: number | null } {
  const e = db().get<{ id: number; title: string; date: string; owner_id: number | null; week_id: number | null }>('SELECT id, title, date, owner_id, week_id FROM events WHERE id = ?', id);
  if (!e) throw notFound('הפעילות לא נמצאה');
  return e;
}

/**
 * The lessons bank: lessons kept for the next cycle. For a week - those written for a week of the
 * same number or name in an earlier cycle; for an event - those for an event of that name; with
 * what was decided about each there.
 */
export function lessonBank(f: { weekId?: number; eventId?: number } = {}): BankLesson[] {
  const rows = bankRows();
  const list = f.weekId ? forWeek(rows, weekRow(f.weekId)) : f.eventId ? forEvent(rows, eventRow(f.eventId)) : rows;
  const reviews = f.weekId || f.eventId ? reviewsFor(contextKey(f)) : null;
  return list.map((r) => ({
    id: r.id,
    body: r.body,
    target: r.target,
    targetWeek: r.target_week,
    ownerName: r.owner_name,
    debriefId: r.debrief_id,
    debriefTitle: r.debrief_title,
    debriefKind: DEBRIEF_KINDS.includes(r.kind) ? r.kind : 'general',
    occurredOn: r.occurred_on,
    createdByName: r.created_by_name,
    ...(reviews ? { review: reviews.get(r.id) ?? null } : {}),
  }));
}

/** who decides about the lessons for a week (its lead) or an event (its owner, or its week's lead) - and the commander */
function canDecideLessons(actor: UserRow, f: { weekId?: number; eventId?: number }): boolean {
  if (isCommander(actor)) return true;
  if (f.weekId) return weekRowLead(f.weekId) === actor.id;
  const e = eventRow(f.eventId!);
  return e.owner_id === actor.id || (!!e.week_id && weekRowLead(e.week_id) === actor.id);
}

const weekRowLead = (id: number) => db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', id)?.lead_id ?? null;

export const lessonReviewSchema = z
  .object({
    weekId: z.number().int().positive().optional(),
    eventId: z.number().int().positive().optional(),
    /** null: undo the decision (a task opened stays) */
    decision: z.enum(LESSON_DECISIONS).nullable(),
    note: z.string().trim().max(500).optional().default(''),
    task: z
      .object({
        title: z.string().trim().min(1, 'חובה לתת שם למשימה').max(200),
        ownerId: z.number().int().positive(),
        deadline: isoDateTime,
      })
      .optional(),
  })
  .refine((v) => !!v.weekId !== !!v.eventId, 'לקח נבחן מול שבוע או מול פעילות')
  .refine((v) => v.decision !== 'task' || !!v.task, 'חסרים פרטי המשימה');

/** a lesson from an earlier cycle, on its week or event: turn it into a task, mark it applied, or not relevant */
export function reviewLesson(actor: UserRow, itemId: number, raw: z.input<typeof lessonReviewSchema>): void {
  const p = lessonReviewSchema.parse(raw);
  const item = db().get<{ id: number; body: string; kind: string; horizon: string | null; debrief_title: string }>(
    'SELECT i.id, i.body, i.kind, i.horizon, d.title AS debrief_title FROM debrief_items i JOIN debriefs d ON d.id = i.debrief_id WHERE i.id = ?',
    itemId,
  );
  if (!item || item.kind !== 'lesson' || item.horizon !== 'next') throw notFound('הלקח לא נמצא');
  const f = { weekId: p.weekId, eventId: p.eventId };
  const event = p.eventId ? eventRow(p.eventId) : null;
  if (p.weekId) weekRow(p.weekId);
  if (!canDecideLessons(actor, f)) throw forbidden('על לקחי המחזור הקודם מחליטים מפקד הקורס ומפק"צ השבוע (או האחראי על הפעילות)');
  const context = contextKey(f);
  db().tx(() => {
    if (p.decision === null) {
      db().run('DELETE FROM lesson_reviews WHERE item_id = ? AND context = ?', itemId, context);
      return;
    }
    let taskId: number | null = null;
    if (p.decision === 'task' && p.task) {
      [taskId] = createTasks(actor, {
        title: p.task.title,
        description: `לקח מהמחזור הקודם (${item.debrief_title}):\n${item.body}`,
        ownerIds: [p.task.ownerId],
        deadline: p.task.deadline,
        ...(p.weekId ? { weekId: p.weekId } : { eventId: event!.id, weekId: event!.week_id }),
      });
    }
    db().run(
      `INSERT INTO lesson_reviews(item_id, context, week_id, event_id, decision, note, task_id, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, context) DO UPDATE SET decision = excluded.decision, note = excluded.note, task_id = coalesce(excluded.task_id, lesson_reviews.task_id),
         decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
      itemId,
      context,
      p.weekId ?? null,
      p.eventId ?? null,
      p.decision,
      p.note,
      taskId,
      actor.id,
      nowIso(),
    );
  });
  changed('debriefs', 'tasks');
}

/** the weeks ahead whose earlier-cycle lessons are still waiting for a decision */
export function pendingPriorLessons(today: string, days = 14): { weekId: number; name: string; leadId: number | null; leadName: string | null; startDate: string; pending: number }[] {
  const rows = bankRows();
  if (!rows.length) return [];
  const weeks = db().all<{ id: number; number: number; name: string; lead_id: number | null; lead_name: string | null; start_date: string }>(
    "SELECT w.id, w.number, w.name, w.lead_id, u.display_name AS lead_name, w.start_date FROM weeks w LEFT JOIN users u ON u.id = w.lead_id WHERE w.status <> 'closed' AND w.start_date >= ? AND w.start_date <= ? ORDER BY w.start_date",
    today,
    addDays(today, days),
  );
  return weeks
    .map((w) => {
      const reviews = reviewsFor(`w:${w.id}`);
      return { weekId: w.id, name: w.name, leadId: w.lead_id, leadName: w.lead_name, startDate: w.start_date, pending: forWeek(rows, w).filter((r) => !reviews.has(r.id)).length };
    })
    .filter((w) => w.pending > 0);
}

/** weeks that ended in the last days without a weekly debrief */
export function weeksWithoutDebrief(today: string, days = 7): { weekId: number; name: string; leadId: number | null; leadName: string | null; endDate: string }[] {
  return db()
    .all<{ id: number; name: string; lead_id: number | null; lead_name: string | null; end_date: string }>(
      `SELECT w.id, w.name, w.lead_id, u.display_name AS lead_name, w.end_date FROM weeks w LEFT JOIN users u ON u.id = w.lead_id
       WHERE w.end_date <= ? AND w.end_date >= ? AND NOT EXISTS (SELECT 1 FROM debriefs d WHERE d.week_id = w.id AND d.kind = 'weekly')
       ORDER BY w.end_date DESC`,
      today,
      addDays(today, -days),
    )
    .map((w) => ({ weekId: w.id, name: w.name, leadId: w.lead_id, leadName: w.lead_name, endDate: w.end_date }));
}

/**
 * The learning loop, run by the automation: the week's lead is reminded to hold the weekly
 * debrief on the week's last day (from noon), and to decide about the lessons an earlier cycle
 * kept for a week two weeks before it starts - for an event, its owner a week before.
 */
export function learningReminders(now: Date): number {
  const zone = tz();
  const today = localDateKey(now, zone);
  const afternoon = localTime(now, zone) >= '12:00';
  let sent = 0;
  const to = (leadId: number | null) => (leadId ? [leadId] : commanderIds());

  for (const w of weeksWithoutDebrief(today, 3)) {
    if (w.endDate === today && !afternoon) continue;
    if (!once(`debrief:${w.weekId}`)) continue;
    notify(to(w.leadId), {
      type: 'debrief',
      category: 'action',
      title: `הגיע זמן התחקיר השבועי: ${w.name}`,
      body: 'מה הושג, מה לשמר ומה לשפר - ולקחים עם אחראי, להמשך המחזור ולשבוע הזה במחזור הבא',
      link: `/debriefs?new=weekly&week=${w.weekId}`,
    });
    sent++;
  }

  for (const w of pendingPriorLessons(today)) {
    if (!once(`lessons:w:${w.weekId}`)) continue;
    notify(to(w.leadId), {
      type: 'lessons',
      category: 'action',
      title: `${w.pending === 1 ? 'לקח אחד' : `${w.pending} לקחים`} מהמחזור הקודם ל${w.name}`,
      body: 'לפני שהשבוע מתחיל: לכל לקח - משימה, יושם או לא רלוונטי',
      link: `/weeks/${w.weekId}#prior`,
    });
    sent++;
  }

  const rows = bankRows().filter((r) => r.target_week === null);
  if (rows.length) {
    const events = db().all<{ id: number; title: string; date: string; owner_id: number | null; week_id: number | null }>(
      'SELECT id, title, date, owner_id, week_id FROM events WHERE cancelled = 0 AND date >= ? AND date <= ?',
      today,
      addDays(today, 7),
    );
    for (const e of events) {
      const lessons = forEvent(rows, e);
      if (!lessons.length) continue;
      const reviews = reviewsFor(`e:${e.id}`);
      const pending = lessons.filter((l) => !reviews.has(l.id)).length;
      const who = e.owner_id ?? (e.week_id ? weekRowLead(e.week_id) : null);
      if (!pending || !who || !once(`lessons:e:${e.id}`)) continue;
      notify([who], {
        type: 'lessons',
        category: 'action',
        title: `${pending === 1 ? 'לקח אחד' : `${pending} לקחים`} ממופעים קודמים: ${e.title}`,
        body: 'לפני הפעילות: לכל לקח - משימה, יושם או לא רלוונטי',
        link: `/schedule?date=${e.date}&event=${e.id}`,
      });
      sent++;
    }
  }
  return sent;
}

export function debriefDetail(actor: UserRow, id: number): DebriefDetail {
  const d = debriefRow(id);
  return {
    week: isWeekDebrief(d.kind) && d.week_id ? weekRow(d.week_id) : null,
    debrief: toDebrief(actor, d),
    items: db()
      .all<ItemRow>(`${ITEM_BASE} WHERE i.debrief_id = ? ORDER BY i.sort, i.id`, id)
      .map(toItem),
    tasks: visibleTasks(actor, 't.debrief_id = ?', id).sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status))),
  };
}

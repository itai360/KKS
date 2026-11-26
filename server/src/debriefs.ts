import { courseOrigin } from './courseCarryover';
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
  groupOf,
  isWeekDebrief,
  isStaffDebrief,
  LESSON_HORIZON_LABELS,
  NEXT_CYCLE_GROUPS,
  ownerNames,
  ownersOf,
  type ProposalOwner,
  LESSON_DECISIONS,
  LESSON_HORIZONS,
  LESSON_REQUIRED,
  needsAPoint,
  tidyAnswers,
  type DebriefAnswers,
  type DebriefKind,
  type LessonDecision,
  type LessonHorizon,
  WEEK_NOTE_PARTS,
  type WeekNotePart,
} from '../../shared/debriefForms';
import { searchKey } from '../../shared/search';
import type { BankLesson, BroadHolder, Debrief, DebriefDetail, DebriefContributions, DebriefContributionLesson, DebriefContributionPoint, DebriefItem, LessonReview, WeekNoteWeek } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, getSettings, notFound, nowIso, patchSchema, tz } from './core';
import { db } from './db';
import { changed, finishNotifications, firstTime as once, logActivity, notify } from './journal';
import { recurringSchema, saveRule } from './recurring';
import { staffPrepOf, staffPrepSiblings, staffPrepWeeks } from './staffPrep';
import { isCommander, visibleTasks } from './taskRepo';
import { createTasks, isoDateTime, weekForDate } from './taskService';
import { getTemplate, saveTemplate } from './templates';
import { closeWeeklyDebriefTask } from './weeklyDebriefTask';
import { may } from './abilities';

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
  track_id: number | null;
  track_name: string | null;
  facilitator_id: number | null;
  facilitator_name: string | null;
  participants: string;
  summary: string;
  status: 'draft' | 'final';
  /** a weekly debrief its lead sent for the commander's approval */
  submitted_at: string | null;
  submitted_by_name: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  open_tasks: number;
}

const BASE = `
SELECT d.*, coalesce(e.title, nullif(d.activity, '')) AS event_title, w.name AS week_name, f.display_name AS facilitator_name, c.display_name AS created_by_name,
  sb.display_name AS submitted_by_name, tr.name AS track_name,
  (SELECT count(*) FROM tasks t WHERE t.debrief_id = d.id AND t.status NOT IN ('done', 'cancelled')) AS open_tasks
FROM debriefs d
JOIN users c ON c.id = d.created_by
LEFT JOIN events e ON e.id = d.event_id AND e.deleted_at IS NULL
LEFT JOIN weeks w ON w.id = d.week_id
LEFT JOIN tracks tr ON tr.id = d.track_id
LEFT JOIN users f ON f.id = d.facilitator_id
LEFT JOIN users sb ON sb.id = d.submitted_by
`;

/** the weekly debrief is summed up - approved - by the commander; its lead sends it for approval */
const needsApproval = (actor: UserRow, d: Pick<DebriefRow, 'kind'>) => isStaffDebrief(d.kind) && !isCommander(actor);

function debriefLead(d: Pick<DebriefRow, 'facilitator_id' | 'week_id' | 'track_id' | 'created_by'>): number {
  return d.facilitator_id ?? (d.track_id ? db().get<{ lead_id: number | null }>('SELECT lead_id FROM tracks WHERE id = ?', d.track_id)?.lead_id : null) ?? (d.week_id ? db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', d.week_id)?.lead_id : null) ?? d.created_by;
}
const canEditDebrief = (actor: UserRow, d: Pick<DebriefRow, 'kind' | 'created_by' | 'facilitator_id' | 'week_id' | 'track_id'>) =>
  isCommander(actor) || (isStaffDebrief(d.kind) ? debriefLead(d) === actor.id : d.created_by === actor.id || d.facilitator_id === actor.id);

const canContribute = (actor: UserRow, d: DebriefRow) => !!actor.active && isStaffDebrief(d.kind) && d.status === 'draft' && debriefLead(d) !== actor.id;

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

/**
 * The broad staff (סגל רוחב) a company debrief can put a topic on: the cadets holding a broad role on the
 * day it takes place, or during the week it is about - one row per cadet and role.
 */
function broadStaff(d: Pick<DebriefRow, 'kind' | 'occurred_on' | 'week_id'>): BroadHolder[] {
  if (d.kind !== 'company') return [];
  const w = d.week_id ? db().get<{ start_date: string; end_date: string }>('SELECT start_date, end_date FROM weeks WHERE id = ?', d.week_id) : null;
  const rows = db().all<{ cadet_id: number; role: string; name: string }>(
    `SELECT DISTINCT x.cadet_id, x.role, trim(c.first_name || ' ' || c.last_name) AS name FROM experiences x JOIN cadets c ON c.id = x.cadet_id
     WHERE x.kind = 'broad' AND c.status = 'active' AND ((x.start_date <= ? AND x.end_date >= ?) OR (x.start_date <= ? AND x.end_date >= ?))`,
    d.occurred_on,
    d.occurred_on,
    w?.end_date ?? '',
    w?.start_date ?? '9999',
  );
  return rows.map((r) => ({ cadetId: r.cadet_id, name: r.name, role: r.role.trim() })).sort((a, b) => a.role.localeCompare(b.role, 'he') || a.name.localeCompare(b.name, 'he'));
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
    originCourse: courseOrigin('debriefs', d.id),
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
    trackId: d.track_id,
    trackName: d.track_name,
    facilitatorId: d.facilitator_id,
    facilitatorName: d.facilitator_name,
    participants: d.participants,
    summary: d.summary,
    status: d.status,
    submittedAt: d.status === 'draft' ? d.submitted_at : null,
    submittedByName: d.status === 'draft' ? d.submitted_by_name : null,
    canSumUp: canEditDebrief(actor, d) && !needsApproval(actor, d),
    createdBy: d.created_by,
    createdByName: d.created_by_name,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    itemCounts: counts(d.id),
    openTasks: d.open_tasks,
    canEdit: canEditDebrief(actor, d),
    canContribute: canContribute(actor, d),
  };
}

function debriefRow(id: number): DebriefRow {
  const d = db().get<DebriefRow>(`${BASE} WHERE d.id = ?`, id);
  if (!d) throw notFound('התחקיר לא נמצא');
  return d;
}

/**
 * A company debrief this user may fill now, to read the company's own document into it - and the cadets
 * holding a broad role then, whom a topic can be put on by their role.
 */
/** a debrief about to be filled from its template file: may be filled now, what it holds, and whom its topics may go to */
export function debriefToFill(
  actor: UserRow,
  id: number,
): { kind: DebriefKind; answers: DebriefAnswers; participants: string; summary: string; broad: BroadHolder[]; items: { kind: DebriefItemKind; body: string; horizon: LessonHorizon | null }[] } {
  const d = debriefRow(id);
  if (!canEditDebrief(actor, d)) throw forbidden();
  if (d.status !== 'draft') throw badRequest('התחקיר כבר סוכם. כדי לייבא אליו - קודם להחזיר אותו לטיוטה.');
  const items = db().all<{ kind: DebriefItemKind; body: string; horizon: LessonHorizon | null }>('SELECT kind, body, horizon FROM debrief_items WHERE debrief_id = ? ORDER BY sort, id', id);
  return { kind: d.kind, answers: parseAnswers(d.answers), participants: d.participants, summary: d.summary, broad: broadStaff(d), items };
}

export function companyDebriefToFill(actor: UserRow, id: number): { broad: BroadHolder[]; size: number } {
  const d = debriefRow(id);
  if (!canEditDebrief(actor, d)) throw forbidden();
  if (d.kind !== 'company') throw badRequest('ייבוא מקובץ הוא לתחק"ש פלוגתי');
  if (d.status !== 'draft') throw badRequest('התחקיר כבר סוכם. כדי לייבא אליו - קודם להחזיר אותו לטיוטה.');
  // how much it holds already, against the most a debrief keeps
  return { broad: broadStaff(d), size: d.answers.length };
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
  trackId: z.number().int().positive().nullable().optional().default(null),
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

function debriefTrack(id: number | null | undefined) {
  if (!id) throw badRequest('בחרו את ציר ההכשרה שהתחקיר עוסק בו');
  const track = db().get<{ id: number; name: string; goals: string; lead_id: number | null }>('SELECT id, name, goals, lead_id FROM tracks WHERE id = ?', id);
  if (!track) throw badRequest('הציר לא נמצא');
  return track;
}

export function createDebrief(actor: UserRow, raw: z.input<typeof debriefSchema>): number {
  const d = debriefSchema.parse(raw);
  if (d.eventId && !db().get('SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL', d.eventId)) throw badRequest('הפעילות לא נמצאה');
  if (d.facilitatorId && !getUserRow(d.facilitatorId)?.active) throw badRequest('מנחה התחקיר אינו פעיל');
  const week = isWeekDebrief(d.kind) && d.weekId ? weekRow(d.weekId) : null;
  if (isWeekDebrief(d.kind) && !week) throw badRequest('בחרו את השבוע שהתחקיר עוסק בו');
  const track = d.kind === 'track' ? debriefTrack(d.trackId) : null;
  if (d.kind !== 'track' && d.trackId) throw badRequest('בחירת ציר לתחקיר זמינה בתחקיר ציר');
  checkPresenter(d.answers);
  let answers = tidyAnswers(d.kind, d.answers);
  // a weekly debrief starts from the goals its week set
  if (d.kind === 'weekly' && week && !answers.goals) answers = { ...answers, goals: goalsFromText(week.goals) };
  if (track && !answers.goals) answers = { ...answers, goals: goalsFromText(track.goals) };
  // the company debrief: brought by the training officer of that day, unless another cadet was chosen
  if (d.kind === 'company' && answers.presenterId === undefined) answers = { ...answers, presenterId: companyPresenter(d.occurredOn)?.cadetId ?? null };
  const at = nowIso();
  const id = db().tx(() => {
    const newId = db().run(
      `INSERT INTO debriefs(kind, answers, title, occurred_on, event_id, activity, week_id, track_id, facilitator_id, participants, summary, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.kind,
      JSON.stringify(answers),
      d.title,
      d.occurredOn,
      track ? null : d.eventId,
      track || d.eventId ? '' : d.activity,
      track ? null : week ? week.id : weekForDate(d.occurredOn),
      track?.id ?? null,
      d.facilitatorId ?? track?.lead_id ?? (d.kind === 'weekly' && week ? weekRowLead(week.id) : null) ?? actor.id,
      d.participants,
      d.summary,
      actor.id,
      at,
      at,
    ).id;
    // what the staff added on the way, waiting for the week's weekly debrief
    if (d.kind === 'weekly' && week) takeWaitingNotes(debriefRow(newId));
    return newId;
  });
  logActivity({ userId: actor.id, eventId: d.eventId, action: 'debrief', text: `${actor.display_name} פתח תחקיר: ${d.title}` });
  changed('debriefs');
  return id;
}

export function updateDebrief(actor: UserRow, id: number, raw: Partial<z.input<typeof debriefSchema>> & { status?: 'draft' | 'final' }): void {
  const cur = debriefRow(id);
  if (!canEditDebrief(actor, cur)) throw forbidden();
  const p = patchSchema(debriefSchema).extend({ status: z.enum(['draft', 'final']).optional() }).parse(raw);
  if (isStaffDebrief(cur.kind) && cur.status === 'final' && p.status !== 'draft') throw badRequest('התחקיר אושר. מפקד הקורס צריך להחזיר אותו לטיוטה לפני שינוי');
  const occurredOn = p.occurredOn ?? cur.occurred_on;
  const eventId = cur.kind === 'track' ? null : p.eventId !== undefined ? p.eventId : cur.event_id;
  const trackId = p.trackId !== undefined ? p.trackId : cur.track_id;
  if (cur.kind === 'track') debriefTrack(trackId);
  else if (trackId) throw badRequest('בחירת ציר לתחקיר זמינה בתחקיר ציר');
  if (p.eventId && !db().get('SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL', p.eventId)) throw badRequest('הפעילות לא נמצאה');
  // answers come per question: two people filling different parts of the form both keep theirs
  if (p.answers) checkPresenter(p.answers);
  const answers = p.answers ? { ...parseAnswers(cur.answers), ...tidyAnswers(cur.kind, p.answers) } : parseAnswers(cur.answers);
  if (JSON.stringify(answers).length > 40000) throw badRequest('התחקיר ארוך מדי');
  const weekId = cur.kind === 'track' ? null : isWeekDebrief(cur.kind) ? (p.weekId ? weekRow(p.weekId).id : cur.week_id) : weekForDate(occurredOn);
  // taking the approval of a weekly debrief back is the commander's, as giving it is
  if (p.status === 'draft' && cur.status === 'final' && needsApproval(actor, cur)) throw forbidden('את אישור התחקיר מבטל מפקד הקורס');
  const asked = p.status === 'final' && cur.status !== 'final';
  if (asked && pendingContributionPoints(id)) throw badRequest('לפני שליחה או אישור התחקיר יש לעבור על כל תוספות הסגל ולשלב או לדחות אותן');
  // the lead of a weekly debrief sends it to the commander, whose approval sums it up
  const sending = asked && needsApproval(actor, cur);
  const summingUp = asked && !sending;
  if (asked && cur.kind !== 'general') checkReady(cur, answers);
  db().tx(() => {
    db().run(
      'UPDATE debriefs SET answers = ?, title = ?, occurred_on = ?, event_id = ?, activity = ?, week_id = ?, track_id = ?, facilitator_id = ?, participants = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(answers),
      p.title ?? cur.title,
      occurredOn,
      eventId,
      cur.kind === 'track' || eventId ? '' : (p.activity ?? cur.activity),
      weekId,
      trackId,
      p.facilitatorId !== undefined ? p.facilitatorId : cur.facilitator_id,
      p.participants ?? cur.participants,
      p.summary ?? cur.summary,
      sending ? cur.status : (p.status ?? cur.status),
      nowIso(),
      id,
    );
    // returned to a draft by the commander: it waits to be sent again
    if (p.status === 'draft' && cur.status === 'final') db().run('UPDATE debriefs SET submitted_at = NULL, submitted_by = NULL WHERE id = ?', id);
    if (sending) {
      db().run('UPDATE debriefs SET submitted_at = ?, submitted_by = ? WHERE id = ?', nowIso(), actor.id, id);
      // the lead's part is done: their task to write it closes
      if (cur.kind === 'weekly' && weekId) closeWeeklyDebriefTask(actor, weekId);
      logActivity({ userId: actor.id, action: 'debrief_sent', text: `${actor.display_name} שלח לאישור את התחקיר "${cur.title}"` });
      const lessons = counts(id).lesson;
      notify(
        commanderIds(),
        { type: 'debrief', category: 'action', title: `התחקיר ${cur.kind === 'track' ? 'בציר' : 'השבועי'} מחכה לאישורך: ${cur.title}`, body: `${actor.display_name} שלח · ${lessons} לקחים`, link: `/debriefs/${id}`, ref: `debrief-approval:${id}` },
        actor.id,
      );
    }
    // the week or event it is about changed: the lessons kept for the next cycle follow it
    if (p.weekId !== undefined || p.trackId !== undefined || p.eventId !== undefined || p.activity !== undefined || p.title !== undefined) {
      const t = lessonTarget(debriefRow(id));
      db().run("UPDATE debrief_items SET target = ?, target_key = ?, target_week = ? WHERE debrief_id = ? AND horizon = 'next'", t.target, t.key, t.week, id);
    }
    if (summingUp) {
      // the approval it waited for is given
      finishNotifications(true, 'ref = ?', `debrief-approval:${id}`);
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
  if (needsAPoint(d.kind, answers)) {
    // the sections that hold topics (a form of topics), or all of them
    const form = formFor(d.kind);
    const ofTopics = form.filter((s) => s.questions.some((q) => q.type === 'proposals'));
    throw badRequest(`כדי לסכם צריך לפחות נושא אחד - ${(ofTopics.length ? ofTopics : form).map((s) => s.title).join(', ')}`);
  }
  const lessons = db().all<{ horizon: LessonHorizon | null; owner_id: number | null; owners: string; due_date: string | null; task_id: number | null }>(
    "SELECT horizon, owner_id, owners, due_date, task_id FROM debrief_items WHERE debrief_id = ? AND kind = 'lesson'",
    d.id,
  );
  if (!lessons.length && LESSON_REQUIRED[d.kind]) throw badRequest('תחקיר בלי לקחים לא משנה דבר - הוסיפו לפחות לקח אחד');
  if (lessons.some((l) => l.horizon === 'now' && !l.task_id && ((!l.owner_id && !parseOwners(l.owners).length) || !l.due_date)))
    throw badRequest(d.kind === 'company' ? 'לכל נקודה לטיפול צריך אחראי ותאריך - כך היא הופכת למשימה' : 'לכל לקח להמשך המחזור צריך אחראי ותאריך - כך הוא הופך למשימה');
}

/**
 * On summing up: every lesson for this cycle becomes a task for its owners, by its date - the staff among
 * them; one on a group or a cadet alone is followed by the debrief's facilitator (or whoever sums it up),
 * who it is on written in the task.
 */
function lessonsToTasks(actor: UserRow, d: DebriefRow): number {
  const rows = db()
    .all<{ id: number; body: string; owner_id: number | null; owner_name: string | null; owners: string; due_date: string; track_id: number | null }>(
      "SELECT i.id, i.body, i.owner_id, o.display_name AS owner_name, i.owners, i.due_date, i.track_id FROM debrief_items i LEFT JOIN users o ON o.id = i.owner_id WHERE i.debrief_id = ? AND i.kind = 'lesson' AND i.horizon = 'now' AND i.task_id IS NULL AND i.due_date IS NOT NULL",
      d.id,
    )
    .map((l) => ({ ...l, list: itemOwners(l) }))
    .filter((l) => l.list.length);
  const time = getSettings().defaultDeadlineTime;
  for (const l of rows) {
    const staff = l.list.filter((o) => o.kind === 'user' && getUserRow(o.id)?.active).map((o) => o.id);
    const others = l.list.some((o) => o.kind !== 'user');
    const follower = d.facilitator_id && getUserRow(d.facilitator_id)?.active ? d.facilitator_id : actor.id;
    const [taskId] = createTasks(
      actor,
      {
        title: l.body.split('\n')[0].slice(0, 200),
        description: `לקח מ${DEBRIEF_KIND_LABELS[d.kind]} "${d.title}":\n${l.body}${others ? `\n\nבאחריות: ${ownerNames(l.list)}` : ''}`,
        ownerIds: staff.length ? staff : [follower],
        deadline: zonedIso(l.due_date, time, tz()),
        domain: 'הערכה',
        debriefId: d.id,
        // in the lesson's training track (none chosen: the evaluation's, as before)
        ...(l.track_id ? { trackId: l.track_id } : {}),
      },
      { system: true },
    );
    db().run('UPDATE debrief_items SET task_id = ? WHERE id = ?', taskId, l.id);
  }
  return rows.length;
}

export function deleteDebrief(actor: UserRow, id: number): void {
  const d = debriefRow(id);
  if (isStaffDebrief(d.kind) ? !canEditDebrief(actor, d) : !isCommander(actor) && d.created_by !== actor.id) throw forbidden();
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
  owners: string;
  due_date: string | null;
  target: string;
  track_id: number | null;
  track_name: string | null;
}

/** the owners kept with a lesson (a list, as JSON; none before there could be several) */
function parseOwners(v: string | null | undefined): ProposalOwner[] {
  if (!v) return [];
  try {
    return ownersOf(JSON.parse(v));
  } catch {
    return [];
  }
}

/** a lesson's owners: its list, or the one staff member it had */
const itemOwners = (i: Pick<ItemRow, 'owners' | 'owner_id' | 'owner_name'>): ProposalOwner[] => {
  const list = parseOwners(i.owners);
  return list.length ? list : i.owner_id ? [{ kind: 'user', id: i.owner_id, name: i.owner_name ?? '' }] : [];
};

const ITEM_BASE = `
SELECT i.*, t.title AS task_title, t.status AS task_status, r.title AS recurring_title, o.display_name AS owner_name, tr.name AS track_name
FROM debrief_items i LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN recurring_rules r ON r.id = i.recurring_rule_id
LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN tracks tr ON tr.id = i.track_id
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
    owners: itemOwners(i),
    trackId: i.track_id ?? null,
    trackName: i.track_name ?? null,
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
  /** several (the company debrief): people, cadets, groups */
  owners: z.array(z.unknown()).max(12).optional(),
  dueDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional().default(null),
  /** a lesson's training track */
  trackId: z.number().int().positive().nullable().optional().default(null),
});

const checkTrack = (id: number | null | undefined) => {
  if (id && !db().get('SELECT 1 FROM tracks WHERE id = ?', id)) throw badRequest('הציר לא נמצא');
};

/**
 * A lesson's owners as kept: each one there (an active staff member, a cadet of the course, a group) under
 * its name now - for the next cycle, not this cycle's company or its broad staff, nor one of its cadets. The
 * first staff member among them is the one the task is for.
 */
function settleOwners(horizon: LessonHorizon | null, raw: unknown[]): { list: ProposalOwner[]; ownerId: number | null } {
  const list = ownersOf(raw).map((o): ProposalOwner => {
    if (o.kind === 'user') {
      const u = getUserRow(o.id);
      if (!u?.active) throw badRequest('האחראי שנבחר אינו פעיל');
      return { ...o, name: u.display_name };
    }
    if (o.kind === 'cadet') {
      const c = db().get<{ name: string }>("SELECT trim(first_name || ' ' || last_name) AS name FROM cadets WHERE id = ?", o.id);
      if (!c) throw badRequest('הצוער שנבחר לא נמצא');
      return { ...o, name: c.name };
    }
    return o;
  });
  if (horizon === 'next' && list.some((o) => o.kind === 'cadet' || (o.kind === 'group' && !NEXT_CYCLE_GROUPS.includes(groupOf(o)!))))
    throw badRequest('לקח למחזור הבא - על הסגל, לא על הפלוגה או סגל הרוחב של המחזור הזה');
  return { list, ownerId: list.find((o) => o.kind === 'user')?.id ?? null };
}

/** what a lesson for the next cycle is for: the week (by number and name) or the event (by name) */
function lessonTarget(d: DebriefRow): { target: string; key: string; week: number | null } {
  if (d.kind === 'track' && d.track_name) return { target: `ציר ${d.track_name}`, key: searchKey(d.track_name), week: null };
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
  requireStaffDraft(d);
  const it = itemSchema.parse(raw);
  if (raw.trackId === undefined && it.kind === 'lesson') it.trackId = d.track_id;
  if (it.ownerId && !getUserRow(it.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  checkTrack(it.trackId);
  let owners: ProposalOwner[] = [];
  if (it.owners) {
    const s = settleOwners(it.horizon, it.owners);
    owners = s.list;
    it.ownerId = s.ownerId;
  }
  const id = insertItem(d, { ...it, owners }, actor.id);
  changed('debriefs');
  return id;
}

/** an item at the end of the debrief, written by `by` (a lesson for the next cycle keeps what it is for) */
function insertItem(d: DebriefRow, it: Pick<DebriefItem, 'kind' | 'body' | 'horizon' | 'ownerId' | 'dueDate'> & { owners?: ProposalOwner[]; trackId?: number | null }, by: number | null, at = nowIso()): number {
  const t = it.horizon === 'next' ? lessonTarget(d) : { target: '', key: '', week: null };
  const sort = (db().get<{ n: number | null }>('SELECT max(sort) AS n FROM debrief_items WHERE debrief_id = ?', d.id)?.n ?? 0) + 1;
  const id = db().run(
    'INSERT INTO debrief_items(debrief_id, kind, body, sort, created_by, created_at, horizon, owner_id, due_date, target, target_key, target_week, owners, track_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    d.id,
    it.kind,
    it.body,
    sort,
    by,
    at,
    it.horizon,
    it.ownerId,
    it.dueDate,
    t.target,
    t.key,
    t.week,
    it.owners?.length ? JSON.stringify(it.owners) : '',
    it.kind === 'lesson' ? (it.trackId === undefined ? d.track_id : it.trackId) : null,
  ).id;
  db().run('UPDATE debriefs SET updated_at = ? WHERE id = ?', nowIso(), d.id);
  return id;
}

// ---------------- on the way: a note for the week's debrief (the bottom bar's "+") ----------------

export const weekNoteSchema = z.object({
  weekId: z.number().int().positive(),
  part: z.enum(WEEK_NOTE_PARTS),
  body: z.string().trim().min(1, 'כתבו מה להוסיף').max(3000),
  ownerId: z.number().int().positive().nullable().optional().default(null),
  dueDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional().default(null),
});

interface WeekNote {
  part: WeekNotePart;
  body: string;
  ownerId: number | null;
  dueDate: string | null;
  createdBy: number | null;
  createdAt: string;
}

/** the week's weekly debrief - the first one opened for it */
const weeklyDebriefOf = (weekId: number) => db().get<DebriefRow>(`${BASE} WHERE d.week_id = ? AND d.kind = 'weekly' ORDER BY d.id LIMIT 1`, weekId);

const waitingNotes = (weekId: number) => db().get<{ n: number }>('SELECT count(*) AS n FROM debrief_contributions WHERE week_id = ?', weekId)!.n;

/** into the debrief (the caller's transaction): a line at the end of its list, or a lesson of whoever wrote it */
function putWeekNote(d: DebriefRow, n: WeekNote): void {
  if (n.part === 'sustain' || n.part === 'improve') {
    // read again here: two people adding at once both keep their line
    const answers = parseAnswers(db().get<{ answers: string }>('SELECT answers FROM debriefs WHERE id = ?', d.id)!.answers);
    const list = (Array.isArray(answers[n.part]) ? (answers[n.part] as unknown[]) : []).filter((x): x is string => typeof x === 'string');
    // the empty line the form keeps at the end to type into gives way to the new one
    while (list.length && !list[list.length - 1].trim()) list.pop();
    answers[n.part] = [...list, n.body];
    db().run('UPDATE debriefs SET answers = ?, updated_at = ? WHERE id = ?', JSON.stringify(answers), nowIso(), d.id);
    return;
  }
  insertItem(d, { kind: 'lesson', body: n.body, horizon: n.part, ownerId: n.part === 'now' ? n.ownerId : null, dueDate: n.part === 'now' ? n.dueDate : null }, n.createdBy, n.createdAt);
}

/** Contributions via the quick-add menu obey the same review gate as the full form. */
function reviewableWeekNote(d: DebriefRow, n: WeekNote): void {
  const author = n.createdBy ? getUserRow(n.createdBy) : null;
  if (n.createdBy === debriefLead(d) || (author && isCommander(author))) return putWeekNote(d, n);
  const points: NewContributionPoint[] = n.part === 'sustain' || n.part === 'improve'
    ? [{ questionId: n.part, label: n.part === 'sustain' ? 'מה עבד' : 'מה לא עבד', value: n.body, lesson: null }]
    : [{ questionId: null, label: n.part === 'now' ? 'לקחים להמשך המחזור' : 'לקחים לשבוע הזה במחזור הבא', value: null, lesson: { body: n.body, horizon: n.part, ownerId: n.ownerId, dueDate: n.dueDate } }];
  insertContribution(d, { id: n.createdBy, name: author?.display_name ?? 'איש סגל לשעבר' }, points, n.createdAt);
}

/**
 * Something for the week's weekly debrief, added on the way by any staff member: a line to keep or to
 * improve, or a lesson for the rest of the cycle or for this week in the next one. It goes into the
 * week's debrief while it is open; with none opened yet it waits for it - the debrief stays its lead's
 * to open, and the reminder to hold it still comes. A debrief summed up takes no more.
 */
export function addWeekNote(actor: UserRow, raw: z.input<typeof weekNoteSchema>): { debriefId: number | null; waiting: number } {
  const p = weekNoteSchema.parse(raw);
  const w = weekRow(p.weekId);
  if (p.ownerId && !getUserRow(p.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  const d = weeklyDebriefOf(w.id);
  if (d?.status === 'final') throw badRequest(`התחקיר השבועי של ${w.name} כבר סוכם - אפשר לפתוח אותו מהתחקירים`);
  const note: WeekNote = { part: p.part, body: p.body, ownerId: p.ownerId, dueDate: p.dueDate, createdBy: actor.id, createdAt: nowIso() };
  db().tx(() => {
    if (d) reviewableWeekNote(d, note);
    else
      db().run(
        'INSERT INTO debrief_contributions(week_id, part, body, owner_id, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        w.id,
        note.part,
        note.body,
        note.part === 'now' ? note.ownerId : null,
        note.part === 'now' ? note.dueDate : null,
        note.createdBy,
        note.createdAt,
      );
  });
  changed('debriefs', 'weeks');
  return { debriefId: d?.id ?? null, waiting: d ? 0 : waitingNotes(w.id) };
}

/** the week's notes that waited for its debrief, into it as it is opened (the caller's transaction) */
function takeWaitingNotes(d: DebriefRow): void {
  if (!d.week_id) return;
  const rows = db().all<{ part: WeekNotePart; body: string; owner_id: number | null; due_date: string | null; created_by: number | null; created_at: string }>(
    'SELECT part, body, owner_id, due_date, created_by, created_at FROM debrief_contributions WHERE week_id = ? ORDER BY id',
    d.week_id,
  );
  for (const r of rows) reviewableWeekNote(d, { part: r.part, body: r.body, ownerId: r.owner_id, dueDate: r.due_date, createdBy: r.created_by, createdAt: r.created_at });
  db().run('DELETE FROM debrief_contributions WHERE week_id = ?', d.week_id);
}

/** the weeks the "+" offers: the week on now (or the last one that started) first, and the one before it */
export function weekNoteTarget(): { weekId: number | null; weeks: WeekNoteWeek[] } {
  const today = localDateKey(clock.now(), tz());
  const started = db().all<{ id: number; number: number; name: string; start_date: string; end_date: string }>(
    'SELECT id, number, name, start_date, end_date FROM weeks WHERE start_date <= ? ORDER BY start_date DESC, id DESC LIMIT 2',
    today,
  );
  const weeks = started.map((w) => {
    const d = weeklyDebriefOf(w.id);
    return { id: w.id, number: w.number, name: w.name, startDate: w.start_date, endDate: w.end_date, debriefId: d?.id ?? null, summedUp: d?.status === 'final', waiting: d ? 0 : waitingNotes(w.id) };
  });
  return { weekId: weeks.find((w) => !w.summedUp)?.id ?? null, weeks };
}

export const itemPatchSchema = z.object({
  body: z.string().max(3000).optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  owners: z.array(z.unknown()).max(12).optional(),
  dueDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional(),
  trackId: z.number().int().positive().nullable().optional(),
});

export function updateItem(actor: UserRow, id: number, raw: z.input<typeof itemPatchSchema>): void {
  const i = itemRow(id);
  const d = debriefRow(i.debrief_id);
  if (!canEditDebrief(actor, d)) throw forbidden();
  requireStaffDraft(d);
  const p = itemPatchSchema.parse(raw);
  const text = p.body !== undefined ? p.body.trim() : i.body;
  if (!text) throw badRequest('הפריט ריק');
  if (p.ownerId && !getUserRow(p.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
  // several (the company debrief) - or one staff member, the list going with it
  const settled = p.owners ? settleOwners(i.horizon, p.owners) : null;
  checkTrack(p.trackId);
  const trackId = p.trackId !== undefined ? p.trackId : i.track_id;
  db().run(
    'UPDATE debrief_items SET body = ?, owner_id = ?, owners = ?, due_date = ?, track_id = ? WHERE id = ?',
    text,
    settled ? settled.ownerId : p.ownerId !== undefined ? p.ownerId : i.owner_id,
    settled ? (settled.list.length ? JSON.stringify(settled.list) : '') : p.ownerId !== undefined ? '' : i.owners,
    p.dueDate !== undefined ? p.dueDate : i.due_date,
    i.kind === 'lesson' ? trackId : null,
    id,
  );
  // the task the lesson became goes in its track too
  if (p.trackId !== undefined && i.task_id) {
    db().run('UPDATE tasks SET track_id = ? WHERE id = ?', trackId, i.task_id);
    changed('debriefs', 'tasks', 'weeks');
  } else changed('debriefs');
}

export function deleteItem(actor: UserRow, id: number): void {
  const i = itemRow(id);
  const d = debriefRow(i.debrief_id);
  if (!canEditDebrief(actor, d)) throw forbidden();
  requireStaffDraft(d);
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

function requireStaffDraft(d: DebriefRow): void {
  if (isStaffDebrief(d.kind) && d.status === 'final') throw badRequest('התחקיר אושר. מפקד הקורס צריך להחזיר אותו לטיוטה לפני שינוי');
}

function requireApprovedStaffLesson(d: DebriefRow): void {
  if (isStaffDebrief(d.kind) && d.status !== 'final') throw badRequest('לפני הפיכת לקח למשימה או לתבנית נדרש אישור מפקד הקורס לתחקיר');
}

/** "אילו משימות נוצרות בעקבות הלקחים?" - a lesson or conclusion becomes a task. */
export function itemToTask(actor: UserRow, itemId: number, raw: z.input<typeof itemTaskSchema>): number[] {
  const i = itemRow(itemId);
  const d = debriefRow(i.debrief_id);
  if (!canEditDebrief(actor, d)) throw forbidden();
  requireApprovedStaffLesson(d);
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
        ...(i.track_id ? { trackId: i.track_id } : {}),
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
  if (!may(actor, 'templates')) throw forbidden('משימות חוזרות מוגדרות על ידי מפקד הקורס');
  requireApprovedStaffLesson(debriefRow(itemRow(itemId).debrief_id));
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
  if (!may(actor, 'templates')) throw forbidden('תבניות מנוהלות על ידי מפקד הקורס');
  const i = itemRow(itemId);
  requireApprovedStaffLesson(debriefRow(i.debrief_id));
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
  return db().all<BankRow & { owners: string }>(
    `SELECT i.id, i.body, i.target, i.target_key, i.target_week, o.display_name AS owner_name, i.owners, d.id AS debrief_id, d.title AS debrief_title,
       d.kind, d.occurred_on, d.week_id, d.event_id, c.display_name AS created_by_name
     FROM debrief_items i JOIN debriefs d ON d.id = i.debrief_id
     LEFT JOIN users o ON o.id = i.owner_id LEFT JOIN users c ON c.id = i.created_by
     WHERE i.kind = 'lesson' AND i.horizon = 'next'
     ORDER BY d.occurred_on DESC, i.id`,
  ).map(({ owners, ...r }) => {
    // several, or a group: their names
    const list = parseOwners(owners);
    return list.length ? { ...r, owner_name: ownerNames(list) } : r;
  });
}

/**
 * For a week: what an earlier cycle wrote for a week of the same number or name - not this week's own.
 * In the staff's preparation weeks after the closing week: every lesson kept for the next cycle, from
 * the debriefs held before them, whatever week or event it was written for.
 */
function forWeek(rows: BankRow[], w: { id: number; number: number; name: string }, prep = staffPrepOf(w.id)): BankRow[] {
  if (prep) return rows.filter((r) => r.week_id !== w.id && r.occurred_on < prep.before);
  const key = searchKey(w.name);
  return rows.filter((r) => r.kind !== 'track' && r.week_id !== w.id && (r.target_week === w.number || (!!r.target_key && r.target_key === key)));
}

/** for an event: what was written for an event of that name - not by this very event */
function forEvent(rows: BankRow[], e: { id: number; title: string }): BankRow[] {
  const key = searchKey(e.title);
  return rows.filter((r) => r.kind !== 'track' && r.event_id !== e.id && r.target_week === null && !!r.target_key && !!key && (key.includes(r.target_key) || r.target_key.includes(key)));
}

// the preparation weeks decide a lesson once, for all of them: on the first of them
const contextKey = (f: { weekId?: number; eventId?: number }) => (f.weekId ? `w:${staffPrepOf(f.weekId)?.anchorId ?? f.weekId}` : `e:${f.eventId}`);

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
  const e = db().get<{ id: number; title: string; date: string; owner_id: number | null; week_id: number | null }>('SELECT id, title, date, owner_id, week_id FROM events WHERE id = ? AND deleted_at IS NULL', id);
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
  const item = db().get<{ id: number; body: string; kind: string; horizon: string | null; track_id: number | null; debrief_id: number; debrief_title: string }>(
    'SELECT i.id, i.body, i.kind, i.horizon, i.track_id, i.debrief_id, d.title AS debrief_title FROM debrief_items i JOIN debriefs d ON d.id = i.debrief_id WHERE i.id = ?',
    itemId,
  );
  if (!item || item.kind !== 'lesson' || item.horizon !== 'next') throw notFound('הלקח לא נמצא');
  if (p.decision === 'task') requireApprovedStaffLesson(debriefRow(itemRow(itemId).debrief_id));
  const f = { weekId: p.weekId, eventId: p.eventId };
  const event = p.eventId ? eventRow(p.eventId) : null;
  if (p.weekId) weekRow(p.weekId);
  if (!canDecideLessons(actor, f)) throw forbidden('על לקחי המחזור הקודם מחליטים מפקד הקורס ואחראי השבוע (או האחראי על הפעילות)');
  const context = contextKey(f);
  db().tx(() => {
    if (p.decision === null) {
      db().run('DELETE FROM lesson_reviews WHERE item_id = ? AND context = ?', itemId, context);
      settleLessonReminders(f);
      return;
    }
    let taskId: number | null = null;
    if (p.decision === 'task' && p.task) {
      [taskId] = createTasks(actor, {
        title: p.task.title,
        description: `לקח מהמחזור הקודם (${item.debrief_title}):\n${item.body}`,
        ownerIds: [p.task.ownerId],
        deadline: p.task.deadline,
        debriefId: item.debrief_id,
        ...(item.track_id ? { trackId: item.track_id } : {}),
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
    settleLessonReminders(f);
  });
  changed('debriefs', 'tasks');
}

/** the reminders about a week's (or an event's) earlier-cycle lessons leave the bell once every one of them is
 * decided - and come back when a decision is taken back and one waits again */
function settleLessonReminders(f: { weekId?: number; eventId?: number }): void {
  const rows = bankRows();
  const lessons = f.weekId ? forWeek(rows, weekRow(f.weekId)) : forEvent(rows, eventRow(f.eventId!));
  const reviews = reviewsFor(contextKey(f));
  const waiting = lessons.some((l) => !reviews.has(l.id));
  if (f.weekId) {
    // a reminder of the preparation went out on whichever of its weeks was on then
    const prep = staffPrepOf(f.weekId);
    const ids = prep ? staffPrepSiblings(prep.anchorId) : [f.weekId];
    finishNotifications(!waiting, `type = 'lessons' AND link IN (${ids.map(() => '?').join(', ')})`, ...ids.map((id) => `/weeks/${id}#prior`));
  } else finishNotifications(!waiting, "type = 'lessons' AND link LIKE ?", `/schedule?date=%&event=${f.eventId}`);
}

/**
 * The weeks ahead whose earlier-cycle lessons are still waiting for a decision. The staff's preparation
 * counts once, while it lasts: on the week of it that is on now, or next.
 */
export function pendingPriorLessons(
  today: string,
  days = 14,
): { weekId: number; name: string; leadId: number | null; leadName: string | null; startDate: string; pending: number; staffPrep: boolean }[] {
  const rows = bankRows();
  if (!rows.length) return [];
  const prep = staffPrepWeeks();
  const weeks = db().all<{ id: number; number: number; name: string; lead_id: number | null; lead_name: string | null; start_date: string }>(
    "SELECT w.id, w.number, w.name, w.lead_id, u.display_name AS lead_name, w.start_date FROM weeks w LEFT JOIN users u ON u.id = w.lead_id WHERE w.status <> 'closed' AND w.end_date >= ? AND w.start_date <= ? ORDER BY w.start_date, w.id",
    today,
    addDays(today, days),
  );
  const seen = new Set<number>();
  const out: ReturnType<typeof pendingPriorLessons> = [];
  for (const w of weeks) {
    const p = prep.get(w.id) ?? null;
    if (p) {
      if (seen.has(p.anchorId)) continue;
      seen.add(p.anchorId);
    } else if (w.start_date < today) continue;
    const reviews = reviewsFor(`w:${p?.anchorId ?? w.id}`);
    const pending = forWeek(rows, w, p).filter((r) => !reviews.has(r.id)).length;
    if (pending > 0) out.push({ weekId: w.id, name: w.name, leadId: w.lead_id, leadName: w.lead_name, startDate: w.start_date, pending, staffPrep: !!p });
  }
  return out;
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
    const n = w.pending === 1 ? 'לקח אחד' : `${w.pending} לקחים`;
    notify(to(w.leadId), {
      type: 'lessons',
      category: 'action',
      title: w.staffPrep ? `הכנת סגל: ${n} למחזור הבא מחכים להחלטה` : `${n} מהמחזור הקודם ל${w.name}`,
      body: w.staffPrep ? `${w.name} - כל הלקחים שהתחקירים שמרו למחזור הבא: לכל לקח - משימה, יושם או לא רלוונטי` : 'לפני שהשבוע מתחיל: לכל לקח - משימה, יושם או לא רלוונטי',
      link: `/weeks/${w.weekId}#prior`,
    });
    sent++;
  }

  const rows = bankRows().filter((r) => r.target_week === null);
  if (rows.length) {
    const events = db().all<{ id: number; title: string; date: string; owner_id: number | null; week_id: number | null }>(
      "SELECT id, title, date, owner_id, week_id FROM events WHERE cancelled = 0 AND deleted_at IS NULL AND calendar = 'course' AND date >= ? AND date <= ?",
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
    broadStaff: broadStaff(d),
    debrief: toDebrief(actor, d),
    items: db()
      .all<ItemRow>(`${ITEM_BASE} WHERE i.debrief_id = ? ORDER BY i.sort, i.id`, id)
      .map(toItem),
    tasks: visibleTasks(actor, 't.debrief_id = ?', id).sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status))),
  };
}

// ---------------- staff contributions, reviewed before entering the weekly debrief ----------------

interface ContributionPointRow {
  id: number;
  submission_id: number;
  question_id: string | null;
  label: string;
  value: string;
  lesson: string | null;
  status: DebriefContributionPoint['status'];
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  author_id: number | null;
  author_name: string;
  created_at: string;
}
const CONTRIBUTION_POINTS = `SELECT p.*, s.author_id, s.author_name, s.created_at FROM debrief_submission_points p
 JOIN debrief_submissions s ON s.id = p.submission_id WHERE s.debrief_id = ?`;

function pendingContributionPoints(id: number): number {
  return db().get<{ n: number }>(`SELECT count(*) AS n FROM debrief_submission_points p JOIN debrief_submissions s ON s.id = p.submission_id WHERE s.debrief_id = ? AND p.status = 'pending'`, id)!.n;
}

function contributionDebrief(id: number, draft = false): DebriefRow {
  const d = debriefRow(id);
  if (!isStaffDebrief(d.kind)) throw badRequest('תוספות סגל זמינות בתחקיר שבועי ובתחקיר ציר');
  if (draft && d.status !== 'draft') throw badRequest('התחקיר כבר אושר. מפקד הקורס צריך להחזיר אותו לטיוטה לפני הוספה או סקירה');
  return d;
}

export function debriefContributions(actor: UserRow, id: number): DebriefContributions {
  const d = contributionDebrief(id);
  const rows = db().all<ContributionPointRow>(`${CONTRIBUTION_POINTS} ORDER BY s.id, p.id`, id);
  const submissions = db().all<{ id: number; author_id: number | null; author_name: string; created_at: string }>('SELECT * FROM debrief_submissions WHERE debrief_id = ? ORDER BY id', id);
  return {
    canContribute: canContribute(actor, d),
    canReview: !!actor.active && d.status === 'draft' && (isCommander(actor) || debriefLead(d) === actor.id),
    contributions: submissions.map((s) => ({
      id: s.id, authorId: s.author_id, authorName: s.author_name, createdAt: s.created_at,
      points: rows.filter((p) => p.submission_id === s.id).map((p) => ({
        id: p.id, questionId: p.question_id, label: p.label, value: JSON.parse(p.value) as unknown,
        lesson: p.lesson ? JSON.parse(p.lesson) as DebriefContributionLesson : null,
        status: p.status, reviewedByName: p.reviewed_by_name, reviewedAt: p.reviewed_at,
      })),
    })),
  };
}

const contributionLessonSchema = z.object({
  body: z.string().trim().min(1, 'כתבו את הלקח').max(3000),
  horizon: z.enum(['now', 'next']),
  trackId: z.number().int().positive().nullable().optional().default(null),
  ownerId: z.number().int().positive().nullable().optional().default(null),
  dueDate: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional().default(null),
}).strict();
export const contributionSchema = z.object({
  answers: answersSchema.optional().default({}),
  lessons: z.array(contributionLessonSchema).max(100).optional().default([]),
}).strict();

type NewContributionPoint = Pick<DebriefContributionPoint, 'questionId' | 'label' | 'value' | 'lesson'>;

/** Validate the same weekly question shapes, allowing a contributor to fill only relevant sections. */
function contributionPoints(answers: DebriefAnswers, lessons: DebriefContributionLesson[], kind: DebriefKind = 'weekly'): NewContributionPoint[] {
  const questions = formFor(kind).flatMap((s) => s.questions);
  if (Object.keys(answers).some((key) => !questions.some((q) => q.id === key))) throw badRequest('סעיף לא מוכר בטופס התחקיר');
  const points: NewContributionPoint[] = [];
  for (const q of questions) {
    const raw = answers[q.id];
    if (raw === undefined || raw === null || raw === '') continue;
    const push = (value: unknown) => points.push({ questionId: q.id, label: q.label, value, lesson: null });
    if (q.type === 'rating') {
      push(z.number().int().min(1).max(5).parse(raw));
    } else if (q.type === 'list') {
      for (const v of z.array(z.string().trim().max(3000)).max(100).parse(raw)) if (v) push(v);
    } else if (q.type === 'goals') {
      const goals = z.array(z.object({ goal: z.string().trim().max(3000), status: z.enum(['', 'met', 'partial', 'missed']), note: z.string().trim().max(3000) }).strict()).max(100).parse(raw);
      for (const g of goals) if (g.goal) push(g);
    } else {
      const v = z.string().trim().max(10000).parse(raw);
      if (v) push(v);
    }
  }
  for (const lesson of lessons) {
    checkTrack(lesson.trackId);
    if (lesson.ownerId && !getUserRow(lesson.ownerId)?.active) throw badRequest('האחראי שנבחר אינו פעיל');
    points.push({ questionId: null, label: LESSON_HORIZON_LABELS[kind][lesson.horizon].title, value: null, lesson });
  }
  if (!points.length) throw badRequest('הוסיפו לפחות נקודה אחת לפני השליחה');
  if (points.length > 200 || JSON.stringify(points).length > 80000) throw badRequest('התוספת ארוכה מדי');
  return points;
}

function insertContribution(d: DebriefRow, author: { id: number | null; name: string }, points: NewContributionPoint[], at = nowIso()): void {
  const id = db().run('INSERT INTO debrief_submissions(debrief_id, author_id, author_name, created_at) VALUES (?, ?, ?, ?)', d.id, author.id, author.name, at).id;
  for (const point of points) db().run('INSERT INTO debrief_submission_points(submission_id, question_id, label, value, lesson) VALUES (?, ?, ?, ?, ?)', id, point.questionId, point.label, JSON.stringify(point.value), point.lesson ? JSON.stringify(point.lesson) : null);
  db().run('UPDATE debriefs SET updated_at = ? WHERE id = ?', nowIso(), d.id);
  notify([debriefLead(d)], { type: 'debrief', category: 'action', title: `תוספות סגל מחכות לסקירה: ${d.title}`, body: `${author.name} הוסיף/ה ${points.length} נקודות`, link: `/debriefs/${d.id}`, ref: `debrief-contributions:${d.id}` }, author.id ?? undefined);
}

export function submitDebriefContribution(actor: UserRow, id: number, raw: z.input<typeof contributionSchema>): void {
  const input = contributionSchema.parse(raw);
  db().tx(() => {
    const d = contributionDebrief(id, true);
    if (!actor.active || debriefLead(d) === actor.id) throw forbidden('אחראי התחקיר ממלא את הטופס הראשי');
    const lessons = input.lessons.map((lesson, i) => ({ ...lesson, trackId: raw.lessons?.[i]?.trackId === undefined ? d.track_id : lesson.trackId }));
    const points = contributionPoints(input.answers, lessons, d.kind);
    insertContribution(d, { id: actor.id, name: actor.display_name }, points);
    logActivity({ userId: actor.id, action: 'debrief_contribution', text: `${actor.display_name} שלח ${points.length} נקודות לסקירת אחראי התחקיר "${d.title}"` });
  });
  changed('debriefs');
}

export const contributionReviewSchema = z.object({
  pointIds: z.array(z.number().int().positive()).min(1).max(1000),
  decision: z.enum(['accepted', 'rejected']),
}).strict();

export function reviewDebriefContributions(actor: UserRow, id: number, raw: z.input<typeof contributionReviewSchema>): void {
  const p = contributionReviewSchema.parse(raw);
  db().tx(() => {
    const d = contributionDebrief(id, true);
    if (!actor.active || (!isCommander(actor) && debriefLead(d) !== actor.id)) throw forbidden('רק אחראי התחקיר או מפקד הקורס יכולים לסקור תוספות');
    const wanted = new Set(p.pointIds);
    const rows = db().all<ContributionPointRow>(CONTRIBUTION_POINTS, id).filter((point) => wanted.has(point.id));
    if (rows.length !== wanted.size) throw badRequest('אחת הנקודות לא שייכת לתחקיר הזה');
    if (!isCommander(actor) && rows.some((point) => point.author_id === actor.id)) throw forbidden('אי אפשר לאשר או לדחות תוספת שכתבת בעצמך');
    // A retry of the same decision is safe; reversing a reviewed point needs an explicit new submission.
    if (rows.some((point) => point.status !== 'pending' && point.status !== p.decision)) throw badRequest('אחת הנקודות כבר נבדקה. רעננו את הרשימה');
    const pending = rows.filter((point) => point.status === 'pending');
    if (!pending.length) return;
    const answers = parseAnswers(d.answers);
    for (const point of pending) {
      if (p.decision === 'accepted') {
        if (point.lesson) {
          const lesson = contributionLessonSchema.parse(JSON.parse(point.lesson));
          checkTrack(lesson.trackId);
          if (lesson.ownerId && !getUserRow(lesson.ownerId)?.active) throw badRequest('האחראי ללקח אינו פעיל. אפשר לדחות את הנקודה ולבקש תוספת מעודכנת');
          insertItem(d, { kind: 'lesson', ...lesson }, point.author_id, point.created_at);
        } else if (point.question_id) {
          const value: unknown = JSON.parse(point.value);
          const question = formFor(d.kind).flatMap((s) => s.questions).find((q) => q.id === point.question_id)!;
          const key = question.id;
          if (question.type === 'list' || question.type === 'goals') answers[key] = [...(Array.isArray(answers[key]) ? answers[key] as unknown[] : []), value];
          else if (question.type === 'rating') {
            if (typeof answers[key] !== 'number') answers[key] = value;
            else answers.headline = [answers.headline, `${point.author_name} — ${question.label}: ${String(value)}/5`].filter(Boolean).join('\n\n');
          } else answers[key] = [answers[key], String(value)].filter(Boolean).join('\n\n');
        }
      }
      db().run('UPDATE debrief_submission_points SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ? WHERE id = ?', p.decision, actor.id, actor.display_name, nowIso(), point.id);
    }
    if (JSON.stringify(answers).length > 40000) throw badRequest('התחקיר ארוך מדי. יש לקצר את הטופס לפני שילוב הנקודות');
    if (p.decision === 'accepted') {
      db().run('UPDATE debriefs SET answers = ?, submitted_at = NULL, submitted_by = NULL, updated_at = ? WHERE id = ?', JSON.stringify(answers), nowIso(), id);
      finishNotifications(true, 'ref = ?', `debrief-approval:${id}`);
    }
    if (!pendingContributionPoints(id)) finishNotifications(true, 'ref = ?', `debrief-contributions:${id}`);
    logActivity({ userId: actor.id, action: 'debrief_contribution_review', text: `${actor.display_name} ${p.decision === 'accepted' ? 'שילב' : 'דחה'} ${pending.length} נקודות בתחקיר "${d.title}"` });
  });
  changed('debriefs');
}

// Discussions: a planning discussion, a debrief discussion, a situation assessment, a decision, a coordination,
// a safety discussion, the cadets' state. Each has its subject, the points it goes through - and what came up on
// each -, its decisions, and the follow-up actions: what, who owns it, by when. An action becomes a task (one at
// a time, or all of them as the discussion is summed up), and its state is its task's from then on.
//
// Everyone on the staff sees the discussions; whoever opened one, leads it or was asked to it works on it, and
// the commander on all of them.

import { z } from 'zod';
import { addDays, isDateKey, isTimeString, localDateKey, shortDate, zonedIso } from '../../shared/dates';
import { DISCUSSION_KIND_LABELS, DISCUSSION_KINDS, type DiscussionKind } from '../../shared/discussions';
import type { Discussion, DiscussionAction, DiscussionActionState, DiscussionGuest, DiscussionSummary } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, getSettings, HttpError, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander } from './taskRepo';
import { createTasks, weekForDate } from './taskService';

interface Row {
  id: number;
  kind: DiscussionKind;
  title: string;
  background: string;
  held_on: string;
  held_at: string | null;
  week_id: number | null;
  week_name: string | null;
  lead_id: number | null;
  lead_name: string | null;
  decisions: string;
  status: 'planned' | 'summarized';
  summarized_at: string | null;
  summarized_by_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
}

interface ActionRow {
  id: number;
  discussion_id: number;
  body: string;
  owner_id: number | null;
  owner_name: string | null;
  due_on: string | null;
  task_id: number | null;
  task_status: string | null;
  task_deadline: string | null;
}

const BASE = `SELECT d.*, w.name AS week_name, l.display_name AS lead_name, c.display_name AS created_by_name, s.display_name AS summarized_by_name
  FROM discussions d
  LEFT JOIN weeks w ON w.id = d.week_id
  LEFT JOIN users l ON l.id = d.lead_id
  LEFT JOIN users c ON c.id = d.created_by
  LEFT JOIN users s ON s.id = d.summarized_by`;

const ACTIONS = `SELECT a.*, u.display_name AS owner_name, t.status AS task_status, t.deadline AS task_deadline
  FROM discussion_actions a LEFT JOIN users u ON u.id = a.owner_id LEFT JOIN tasks t ON t.id = a.task_id`;

const today = () => localDateKey(clock.now(), tz());

/** where an action stands: its task's state once it has one; before - open, or late past its date */
function stateOf(a: ActionRow): DiscussionActionState {
  if (a.task_id && a.task_status) {
    if (a.task_status === 'done') return 'done';
    if (a.task_status === 'cancelled') return 'cancelled';
    return a.task_deadline && Date.parse(a.task_deadline) < clock.now().getTime() ? 'late' : 'task';
  }
  return a.due_on && a.due_on < today() ? 'late' : 'open';
}

const toAction = (a: ActionRow): DiscussionAction => ({
  id: a.id,
  body: a.body,
  ownerId: a.owner_id,
  ownerName: a.owner_name,
  dueOn: a.due_on,
  // a task since deleted: the action is open again
  taskId: a.task_status ? a.task_id : null,
  state: stateOf(a),
});

const participantIds = (id: number) => db().all<{ user_id: number }>('SELECT user_id FROM discussion_participants WHERE discussion_id = ?', id).map((p) => p.user_id);

function summary(r: Row, me: UserRow, actions: ActionRow[], people: number[], points: { done: number }[]): DiscussionSummary {
  const states = actions.map(stateOf);
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    heldOn: r.held_on,
    heldAt: r.held_at,
    status: r.status,
    leadId: r.lead_id,
    leadName: r.lead_name,
    weekId: r.week_id,
    weekName: r.week_name,
    participants: people.length,
    points: points.length,
    pointsDone: points.filter((p) => p.done).length,
    actions: {
      total: actions.length,
      open: states.filter((s) => s === 'open' || s === 'task' || s === 'late').length,
      late: states.filter((s) => s === 'late').length,
      done: states.filter((s) => s === 'done').length,
    },
    mine: r.lead_id === me.id || people.includes(me.id) || actions.some((a) => a.owner_id === me.id),
  };
}

/** who works on it: the commander, whoever opened it, leads it or was asked to it */
const mayEdit = (me: UserRow, r: Pick<Row, 'id' | 'created_by' | 'lead_id'>) =>
  isCommander(me) || r.created_by === me.id || r.lead_id === me.id || participantIds(r.id).includes(me.id);

function row(id: number): Row {
  const r = db().get<Row>(`${BASE} WHERE d.id = ?`, id);
  if (!r) throw notFound('הדיון לא נמצא');
  return r;
}

function editable(me: UserRow, id: number): Row {
  const r = row(id);
  if (!mayEdit(me, r)) throw forbidden('על הדיון עובדים מי שפתח אותו, מוביל אותו או זומן אליו, ומפקד הקורס');
  return r;
}

export function listDiscussions(me: UserRow, f: { kind?: string } = {}): DiscussionSummary[] {
  const kind = f.kind && (DISCUSSION_KINDS as readonly string[]).includes(f.kind) ? f.kind : null;
  const rows = db().all<Row>(`${BASE} ${kind ? 'WHERE d.kind = ?' : ''} ORDER BY d.held_on DESC, d.held_at DESC, d.id DESC`, ...(kind ? [kind] : []));
  if (!rows.length) return [];
  const actions = new Map<number, ActionRow[]>();
  for (const a of db().all<ActionRow>(`${ACTIONS} ORDER BY a.sort, a.id`)) actions.set(a.discussion_id, [...(actions.get(a.discussion_id) ?? []), a]);
  const people = new Map<number, number[]>();
  for (const p of db().all<{ discussion_id: number; user_id: number }>('SELECT discussion_id, user_id FROM discussion_participants'))
    people.set(p.discussion_id, [...(people.get(p.discussion_id) ?? []), p.user_id]);
  const points = new Map<number, { done: number }[]>();
  for (const p of db().all<{ discussion_id: number; done: number }>('SELECT discussion_id, done FROM discussion_points'))
    points.set(p.discussion_id, [...(points.get(p.discussion_id) ?? []), p]);
  return rows.map((r) => summary(r, me, actions.get(r.id) ?? [], people.get(r.id) ?? [], points.get(r.id) ?? []));
}

export function discussionDetail(me: UserRow, id: number): Discussion {
  const r = row(id);
  const actions = db().all<ActionRow>(`${ACTIONS} WHERE a.discussion_id = ? ORDER BY a.sort, a.id`, id);
  const people = db().all<{ id: number; name: string }>(
    'SELECT u.id, u.display_name AS name FROM discussion_participants p JOIN users u ON u.id = p.user_id WHERE p.discussion_id = ? ORDER BY u.display_name',
    id,
  );
  const points = db().all<{ id: number; body: string; outcome: string; done: number }>('SELECT id, body, outcome, done FROM discussion_points WHERE discussion_id = ? ORDER BY sort, id', id);
  return {
    ...summary(
      r,
      me,
      actions,
      people.map((p) => p.id),
      points,
    ),
    background: r.background,
    decisions: r.decisions,
    guestList: db().all<DiscussionGuest>('SELECT name, role, email FROM discussion_guests WHERE discussion_id = ? ORDER BY sort, id', id),
    participantList: people,
    pointList: points.map((p) => ({ id: p.id, body: p.body, outcome: p.outcome, done: !!p.done })),
    actionList: actions.map(toAction),
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    summarizedAt: r.summarized_at,
    summarizedByName: r.summarized_by_name,
    canEdit: mayEdit(me, r),
    canDelete: isCommander(me) || r.created_by === me.id,
  };
}

// ---------------- opening and changing one ----------------

const dateKey = z.string().refine(isDateKey, 'תאריך לא תקין');
const timeOrNull = z
  .string()
  .refine(isTimeString, 'שעה לא תקינה')
  .nullable()
  .optional()
  .transform((v) => v || null);
const person = z.number().int().positive();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** someone from outside the staff: a name, what they are, an email (or none) */
const guestSchema = z.object({
  name: z.string().trim().min(1, 'חסר שם למשתתף החיצוני').max(120),
  role: z.string().trim().max(120).optional().default(''),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .default('')
    .refine((v) => !v || EMAIL.test(v), 'כתובת המייל לא תקינה'),
});

function putGuests(id: number, guests: DiscussionGuest[]): void {
  db().run('DELETE FROM discussion_guests WHERE discussion_id = ?', id);
  guests.forEach((g, i) => db().run('INSERT INTO discussion_guests(discussion_id, name, role, email, sort) VALUES (?, ?, ?, ?, ?)', id, g.name, g.role, g.email.toLowerCase(), i + 1));
}

export const discussionSchema = z.object({
  kind: z.enum(DISCUSSION_KINDS),
  title: z.string().trim().min(1, 'חסר נושא לדיון').max(200),
  background: z.string().max(5000).optional().default(''),
  heldOn: dateKey,
  heldAt: timeOrNull,
  weekId: person.nullable().optional(),
  leadId: person.nullable().optional(),
  participantIds: z.array(person).max(80).optional().default([]),
  guestList: z.array(guestSchema).max(40).optional().default([]),
  /** the points to go through - the kind's usual ones, as kept or changed */
  points: z.array(z.string().trim().min(1).max(300)).max(40).optional().default([]),
});

const updateSchema = z
  .object({
    kind: z.enum(DISCUSSION_KINDS),
    title: z.string().trim().min(1, 'חסר נושא לדיון').max(200),
    background: z.string().max(5000),
    heldOn: dateKey,
    heldAt: timeOrNull,
    weekId: person.nullable(),
    leadId: person.nullable(),
    participantIds: z.array(person).max(80),
    guestList: z.array(guestSchema).max(40),
    decisions: z.string().max(10000),
  })
  .partial();

const activePerson = (id: number | null | undefined, what: string) => {
  if (!id) return;
  const u = getUserRow(id);
  if (!u || !u.active) throw badRequest(`${what} שנבחר אינו פעיל`);
};

const when = (r: { held_on: string; held_at: string | null }) => `${shortDate(r.held_on)}${r.held_at ? ` ${r.held_at}` : ''}`;

/** asked to it: told, with when and what it is */
function invite(me: UserRow, id: number, people: number[]): void {
  const r = row(id);
  notify(
    people,
    { type: 'discussion_invite', category: 'info', title: `זומנת לדיון: ${r.title}`, body: `${DISCUSSION_KIND_LABELS[r.kind]} · ${when(r)}`, link: `/discussions/${id}`, ref: `discussion:${id}` },
    me.id,
  );
}

export function createDiscussion(me: UserRow, raw: unknown): number {
  const p = discussionSchema.parse(raw);
  const lead = p.leadId === undefined ? me.id : p.leadId;
  activePerson(lead, 'מוביל הדיון');
  const people = [...new Set(p.participantIds)];
  people.forEach((u) => activePerson(u, 'המשתתף'));
  const weekId = p.weekId === undefined ? weekForDate(p.heldOn) : p.weekId;
  if (weekId && !db().get('SELECT 1 FROM weeks WHERE id = ?', weekId)) throw badRequest('השבוע לא נמצא');
  const at = nowIso();
  const id = db().tx(() => {
    const id = db().run(
      'INSERT INTO discussions(kind, title, background, held_on, held_at, week_id, lead_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.kind,
      p.title,
      p.background,
      p.heldOn,
      p.heldAt,
      weekId ?? null,
      lead ?? null,
      me.id,
      at,
      at,
    ).id;
    for (const u of people) db().run('INSERT INTO discussion_participants(discussion_id, user_id) VALUES (?, ?)', id, u);
    putGuests(id, p.guestList);
    p.points.forEach((body, i) => db().run('INSERT INTO discussion_points(discussion_id, body, sort) VALUES (?, ?, ?)', id, body, i + 1));
    logActivity({ userId: me.id, weekId: weekId ?? null, action: 'discussion', text: `${me.display_name} פתח ${DISCUSSION_KIND_LABELS[p.kind]}: ${p.title}` });
    return id;
  });
  invite(me, id, [...people, ...(lead ? [lead] : [])]);
  changed('discussions');
  return id;
}

const touch = (id: number) => db().run('UPDATE discussions SET updated_at = ? WHERE id = ?', nowIso(), id);

export function updateDiscussion(me: UserRow, id: number, raw: unknown): void {
  const cur = editable(me, id);
  const p = updateSchema.parse(raw);
  if (p.leadId !== undefined) activePerson(p.leadId, 'מוביל הדיון');
  const before = participantIds(id);
  const people = p.participantIds ? [...new Set(p.participantIds)] : null;
  people?.filter((u) => !before.includes(u)).forEach((u) => activePerson(u, 'המשתתף'));
  // moved to another day: the week of that day, unless one was chosen
  const weekId = p.weekId !== undefined ? p.weekId : p.heldOn && p.heldOn !== cur.held_on ? weekForDate(p.heldOn) : cur.week_id;
  if (weekId && !db().get('SELECT 1 FROM weeks WHERE id = ?', weekId)) throw badRequest('השבוע לא נמצא');
  db().tx(() => {
    db().run(
      'UPDATE discussions SET kind = ?, title = ?, background = ?, held_on = ?, held_at = ?, week_id = ?, lead_id = ?, decisions = ?, updated_at = ? WHERE id = ?',
      p.kind ?? cur.kind,
      p.title ?? cur.title,
      p.background ?? cur.background,
      p.heldOn ?? cur.held_on,
      p.heldAt !== undefined ? p.heldAt : cur.held_at,
      weekId ?? null,
      p.leadId !== undefined ? p.leadId : cur.lead_id,
      p.decisions ?? cur.decisions,
      nowIso(),
      id,
    );
    if (people) {
      db().run('DELETE FROM discussion_participants WHERE discussion_id = ?', id);
      for (const u of people) db().run('INSERT INTO discussion_participants(discussion_id, user_id) VALUES (?, ?)', id, u);
    }
    if (p.guestList) putGuests(id, p.guestList);
  });
  // asked to it now: told (the one now leading it too)
  const added = [...(people ?? []).filter((u) => !before.includes(u)), ...(p.leadId && p.leadId !== cur.lead_id && !before.includes(p.leadId) ? [p.leadId] : [])];
  if (added.length) invite(me, id, added);
  changed('discussions');
}

export function deleteDiscussion(me: UserRow, id: number): void {
  const r = row(id);
  if (!isCommander(me) && r.created_by !== me.id) throw forbidden('דיון מוחקים מי שפתח אותו או מפקד הקורס');
  // the tasks opened from it stay - each its own
  db().run('DELETE FROM discussions WHERE id = ?', id);
  changed('discussions');
}

// ---------------- its points ----------------

const pointSchema = z.object({ body: z.string().trim().min(1, 'הנקודה ריקה').max(300) });
const pointPatch = z.object({ body: z.string().trim().min(1, 'הנקודה ריקה').max(300), outcome: z.string().max(3000), done: z.boolean() }).partial();

const pointOf = (pid: number) => {
  const p = db().get<{ id: number; discussion_id: number }>('SELECT id, discussion_id FROM discussion_points WHERE id = ?', pid);
  if (!p) throw notFound('הנקודה לא נמצאה');
  return p;
};

export function addPoint(me: UserRow, id: number, raw: unknown): void {
  editable(me, id);
  const p = pointSchema.parse(raw);
  const sort = (db().get<{ n: number | null }>('SELECT max(sort) AS n FROM discussion_points WHERE discussion_id = ?', id)!.n ?? 0) + 1;
  db().run('INSERT INTO discussion_points(discussion_id, body, sort) VALUES (?, ?, ?)', id, p.body, sort);
  touch(id);
  changed('discussions');
}

export function updatePoint(me: UserRow, pid: number, raw: unknown): number {
  const pt = pointOf(pid);
  editable(me, pt.discussion_id);
  const p = pointPatch.parse(raw);
  const sets = Object.entries({ body: p.body, outcome: p.outcome, done: p.done === undefined ? undefined : p.done ? 1 : 0 }).filter(([, v]) => v !== undefined);
  if (sets.length) db().run(`UPDATE discussion_points SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v as string | number), pid);
  touch(pt.discussion_id);
  changed('discussions');
  return pt.discussion_id;
}

export function deletePoint(me: UserRow, pid: number): number {
  const pt = pointOf(pid);
  editable(me, pt.discussion_id);
  db().run('DELETE FROM discussion_points WHERE id = ?', pid);
  changed('discussions');
  return pt.discussion_id;
}

/** the points in the order given */
export function orderPoints(me: UserRow, id: number, raw: unknown): void {
  editable(me, id);
  const { ids } = z.object({ ids: z.array(person).max(100) }).parse(raw);
  db().tx(() => ids.forEach((pid, i) => db().run('UPDATE discussion_points SET sort = ? WHERE id = ? AND discussion_id = ?', i + 1, pid, id)));
  changed('discussions');
}

// ---------------- its follow-up actions ----------------

const actionSchema = z.object({
  body: z.string().trim().min(1, 'הפעולה ריקה').max(300),
  ownerId: person.nullable().optional(),
  dueOn: dateKey.nullable().optional(),
});
const actionPatch = z.object({ body: z.string().trim().min(1, 'הפעולה ריקה').max(300), ownerId: person.nullable(), dueOn: dateKey.nullable() }).partial();

const actionOf = (aid: number) => {
  const a = db().get<ActionRow>(`${ACTIONS} WHERE a.id = ?`, aid);
  if (!a) throw notFound('הפעולה לא נמצאה');
  return a;
};

export function addAction(me: UserRow, id: number, raw: unknown): void {
  editable(me, id);
  const p = actionSchema.parse(raw);
  activePerson(p.ownerId, 'האחראי');
  const sort = (db().get<{ n: number | null }>('SELECT max(sort) AS n FROM discussion_actions WHERE discussion_id = ?', id)!.n ?? 0) + 1;
  db().run('INSERT INTO discussion_actions(discussion_id, body, owner_id, due_on, sort) VALUES (?, ?, ?, ?, ?)', id, p.body, p.ownerId ?? null, p.dueOn ?? null, sort);
  touch(id);
  changed('discussions');
}

export function updateAction(me: UserRow, aid: number, raw: unknown): number {
  const a = actionOf(aid);
  editable(me, a.discussion_id);
  const p = actionPatch.parse(raw);
  if (p.ownerId !== undefined) activePerson(p.ownerId, 'האחראי');
  db().run(
    'UPDATE discussion_actions SET body = ?, owner_id = ?, due_on = ? WHERE id = ?',
    p.body ?? a.body,
    p.ownerId !== undefined ? p.ownerId : a.owner_id,
    p.dueOn !== undefined ? p.dueOn : a.due_on,
    aid,
  );
  touch(a.discussion_id);
  changed('discussions');
  return a.discussion_id;
}

export function deleteAction(me: UserRow, aid: number): number {
  const a = actionOf(aid);
  editable(me, a.discussion_id);
  // its task, if one was opened, stays
  db().run('DELETE FROM discussion_actions WHERE id = ?', aid);
  changed('discussions');
  return a.discussion_id;
}

/** an action as a task: of its owner, due at the end of its day (the course's usual hour) */
function taskFor(me: UserRow, d: Row, a: ActionRow): number {
  if (!a.owner_id) throw badRequest('לפעולה אין אחראי - בחרו אחראי לפני שפותחים משימה');
  const due = a.due_on ?? addDays(today(), 7);
  const [taskId] = createTasks(me, {
    title: a.body.slice(0, 200),
    description: `מתוך ${DISCUSSION_KIND_LABELS[d.kind]}: ${d.title} (${shortDate(d.held_on)})`,
    ownerIds: [a.owner_id],
    deadline: zonedIso(due, getSettings().defaultDeadlineTime || '18:00', tz()),
  });
  db().run('UPDATE discussion_actions SET task_id = ?, due_on = ? WHERE id = ?', taskId, due, a.id);
  return taskId;
}

const hasTask = (a: ActionRow) => !!a.task_id && !!a.task_status;

export function openActionTask(me: UserRow, aid: number): number {
  const a = actionOf(aid);
  const d = editable(me, a.discussion_id);
  if (hasTask(a)) throw badRequest('לפעולה הזו כבר נפתחה משימה');
  taskFor(me, d, a);
  changed('discussions', 'tasks');
  return a.discussion_id;
}

/** a task for each action with an owner and none yet - those that cannot (the commander's, by a staff member
 * who may not) are said, the others opened */
export function openActionTasks(me: UserRow, id: number): { opened: number; failed: { body: string; error: string }[] } {
  const d = editable(me, id);
  const out = { opened: 0, failed: [] as { body: string; error: string }[] };
  for (const a of db().all<ActionRow>(`${ACTIONS} WHERE a.discussion_id = ? ORDER BY a.sort, a.id`, id)) {
    if (hasTask(a) || !a.owner_id) continue;
    try {
      taskFor(me, d, a);
      out.opened++;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      out.failed.push({ body: a.body, error: e.message });
    }
  }
  if (out.opened) changed('discussions', 'tasks');
  return out;
}

/**
 * Summed up: marked so, and everyone in it is told - who led it, who was asked, who owns an action. With the
 * tasks asked for, each action with an owner becomes one.
 */
export function summarizeDiscussion(me: UserRow, id: number, raw: unknown): { opened: number; failed: { body: string; error: string }[] } {
  editable(me, id);
  const { openTasks } = z.object({ openTasks: z.boolean().optional().default(true) }).parse(raw ?? {});
  const result = openTasks ? openActionTasks(me, id) : { opened: 0, failed: [] };
  db().run("UPDATE discussions SET status = 'summarized', summarized_at = ?, summarized_by = ?, updated_at = ? WHERE id = ?", nowIso(), me.id, nowIso(), id);
  const r = row(id);
  const owners = db().all<{ owner_id: number }>('SELECT DISTINCT owner_id FROM discussion_actions WHERE discussion_id = ? AND owner_id IS NOT NULL', id).map((a) => a.owner_id);
  const actions = db().get<{ n: number }>('SELECT count(*) AS n FROM discussion_actions WHERE discussion_id = ?', id)!.n;
  notify(
    [...participantIds(id), ...(r.lead_id ? [r.lead_id] : []), ...owners],
    {
      type: 'discussion_summary',
      category: 'info',
      title: `סוכם הדיון: ${r.title}`,
      body: `${DISCUSSION_KIND_LABELS[r.kind]} · ${when(r)}${actions ? ` · ${actions === 1 ? 'פעולה אחת להמשך' : `${actions} פעולות להמשך`}` : ''}`,
      link: `/discussions/${id}`,
      ref: `discussion:${id}`,
    },
    me.id,
  );
  logActivity({ userId: me.id, weekId: r.week_id, action: 'discussion', text: `${me.display_name} סיכם ${DISCUSSION_KIND_LABELS[r.kind]}: ${r.title}` });
  changed('discussions');
  return result;
}

export function reopenDiscussion(me: UserRow, id: number): void {
  editable(me, id);
  db().run("UPDATE discussions SET status = 'planned', summarized_at = NULL, summarized_by = NULL, updated_at = ? WHERE id = ?", nowIso(), id);
  changed('discussions');
}

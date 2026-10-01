// Section 31 (version 3) - cadets: teams, notes, personal talks, discipline,
// evaluations, development tracking; and experiences (role, goals, mentor,
// tasks, feedback, evaluation).

import { z } from 'zod';
import {
  CADET_STATUSES,
  RECORD_KINDS,
  RESTRICTED_RECORD_KINDS,
  type CadetStatus,
  type RecordKind,
} from '../../shared/constants';
import { isDateKey, localDateKey, zonedIso } from '../../shared/dates';
import type { Cadet, CadetDetail, CadetRecord, Experience, Team } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, clock, forbidden, getSettings, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander, visibleTasks } from './taskRepo';
import { createTasks, isoDateTime, updateTask, weekForDate } from './taskService';

const today = () => localDateKey(clock.now(), tz());

// ---------------- teams ----------------

interface TeamRow {
  id: number;
  name: string;
  commander_id: number | null;
  commander_name: string | null;
  sort: number;
  cadet_count: number;
}

export function listTeams(): Team[] {
  return db()
    .all<TeamRow>(
      `SELECT t.*, u.display_name AS commander_name,
        (SELECT count(*) FROM cadets c WHERE c.team_id = t.id AND c.status = 'active') AS cadet_count
       FROM teams t LEFT JOIN users u ON u.id = t.commander_id ORDER BY t.sort, t.name`,
    )
    .map((r) => ({ id: r.id, name: r.name, commanderId: r.commander_id, commanderName: r.commander_name, sort: r.sort, cadetCount: r.cadet_count }));
}

export const teamSchema = z.object({
  name: z.string().trim().min(1, 'חובה לתת שם לצוות').max(60),
  commanderId: z.number().int().positive().nullable().optional().default(null),
  sort: z.number().int().min(0).max(100).optional(),
});

export function saveTeam(actor: UserRow, raw: z.input<typeof teamSchema>, id?: number): number {
  const t = teamSchema.parse(raw);
  if (t.commanderId && !getUserRow(t.commanderId)?.active) throw badRequest('המפקד שנבחר אינו פעיל');
  if (id) {
    if (!db().get('SELECT 1 FROM teams WHERE id = ?', id)) throw notFound('הצוות לא נמצא');
    db().run('UPDATE teams SET name = ?, commander_id = ?, sort = coalesce(?, sort) WHERE id = ?', t.name, t.commanderId, t.sort ?? null, id);
  } else {
    const sort = t.sort ?? (db().get<{ n: number | null }>('SELECT max(sort) AS n FROM teams')?.n ?? 0) + 1;
    id = db().run('INSERT INTO teams(name, commander_id, sort, created_at) VALUES (?, ?, ?, ?)', t.name, t.commanderId, sort, nowIso()).id;
  }
  logActivity({ userId: actor.id, action: 'team', text: `${actor.display_name} עדכן את הצוות "${t.name}"` });
  changed('cadets');
  return id;
}

export function deleteTeam(id: number): void {
  db().run('DELETE FROM teams WHERE id = ?', id);
  changed('cadets');
}

// ---------------- cadets ----------------

interface CadetRow {
  id: number;
  first_name: string;
  last_name: string;
  personal_number: string;
  team_id: number | null;
  team_name: string | null;
  team_commander_id: number | null;
  phone: string;
  notes: string;
  status: CadetStatus;
}

const CADET_BASE = `
SELECT c.*, t.name AS team_name, t.commander_id AS team_commander_id
FROM cadets c LEFT JOIN teams t ON t.id = c.team_id
`;

interface RecordRow {
  id: number;
  cadet_id: number;
  kind: RecordKind;
  title: string;
  body: string;
  category: string;
  score: number | null;
  follow_up: string;
  private: number;
  task_id: number | null;
  task_title: string | null;
  week_id: number | null;
  week_name: string | null;
  author_id: number;
  author_name: string;
  occurred_on: string;
  created_at: string;
}

const RECORD_BASE = `
SELECT r.*, u.display_name AS author_name, t.title AS task_title, w.name AS week_name
FROM cadet_records r JOIN users u ON u.id = r.author_id
LEFT JOIN tasks t ON t.id = r.task_id LEFT JOIN weeks w ON w.id = r.week_id
`;

/** Commander or the commander of the cadet's team. */
export function canManageCadet(actor: UserRow, c: Pick<CadetRow, 'team_commander_id'>): boolean {
  return isCommander(actor) || (c.team_commander_id !== null && c.team_commander_id === actor.id);
}

/** Talks and discipline are always restricted; any record can be marked private. */
export function canViewRecord(actor: UserRow, r: Pick<RecordRow, 'author_id' | 'private' | 'kind'>, c: Pick<CadetRow, 'team_commander_id'>): boolean {
  if (canManageCadet(actor, c) || r.author_id === actor.id) return true;
  return !r.private && !RESTRICTED_RECORD_KINDS.includes(r.kind);
}

function cadetRow(id: number): CadetRow {
  const c = db().get<CadetRow>(`${CADET_BASE} WHERE c.id = ?`, id);
  if (!c) throw notFound('הצוער לא נמצא');
  return c;
}

function toCadet(actor: UserRow, c: CadetRow, records: RecordRow[]): Cadet {
  const visible = records.filter((r) => canViewRecord(actor, r, c));
  const scores = visible.filter((r) => r.kind === 'evaluation' && r.score !== null).map((r) => r.score as number);
  return {
    id: c.id,
    firstName: c.first_name,
    lastName: c.last_name,
    fullName: `${c.first_name} ${c.last_name}`.trim(),
    personalNumber: c.personal_number,
    teamId: c.team_id,
    teamName: c.team_name,
    phone: c.phone,
    notes: canManageCadet(actor, c) ? c.notes : '',
    status: c.status,
    recordCount: visible.length,
    lastRecordAt: visible.reduce<string | null>((m, r) => (m && m > r.created_at ? m : r.created_at), null),
    avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    disciplineCount: visible.filter((r) => r.kind === 'discipline').length,
    talkCount: visible.filter((r) => r.kind === 'talk').length,
    canManage: canManageCadet(actor, c),
  };
}

function toRecord(actor: UserRow, r: RecordRow): CadetRecord {
  return {
    id: r.id,
    cadetId: r.cadet_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    category: r.category,
    score: r.score,
    followUp: r.follow_up,
    private: !!r.private,
    taskId: r.task_id,
    taskTitle: r.task_title,
    weekId: r.week_id,
    weekName: r.week_name,
    authorId: r.author_id,
    authorName: r.author_name,
    occurredOn: r.occurred_on,
    createdAt: r.created_at,
    canDelete: isCommander(actor) || r.author_id === actor.id,
  };
}

export function listCadets(actor: UserRow, filter: { teamId?: number; status?: string; q?: string } = {}): Cadet[] {
  const rows = db().all<CadetRow>(`${CADET_BASE} ORDER BY t.sort, t.name, c.last_name, c.first_name`);
  const records = db().all<RecordRow>(`${RECORD_BASE}`);
  const byCadet = new Map<number, RecordRow[]>();
  for (const r of records) byCadet.set(r.cadet_id, [...(byCadet.get(r.cadet_id) ?? []), r]);
  const q = filter.q?.trim().toLowerCase();
  return rows
    .filter((c) => !filter.teamId || c.team_id === filter.teamId)
    .filter((c) => !filter.status || filter.status === 'all' || c.status === filter.status)
    .filter((c) => !q || [c.first_name, c.last_name, c.personal_number, c.team_name].some((f) => f && f.toLowerCase().includes(q)))
    .map((c) => toCadet(actor, c, byCadet.get(c.id) ?? []));
}

export const cadetSchema = z.object({
  firstName: z.string().trim().min(1, 'חובה למלא שם פרטי').max(60),
  lastName: z.string().trim().max(60).optional().default(''),
  personalNumber: z.string().trim().max(20).optional().default(''),
  teamId: z.number().int().positive().nullable().optional().default(null),
  phone: z.string().trim().max(30).optional().default(''),
  notes: z.string().max(4000).optional().default(''),
  status: z.enum(CADET_STATUSES).optional().default('active'),
});

function teamCommander(teamId: number | null | undefined): number | null {
  if (!teamId) return null;
  const t = db().get<{ commander_id: number | null }>('SELECT commander_id FROM teams WHERE id = ?', teamId);
  if (!t) throw badRequest('הצוות לא נמצא');
  return t.commander_id;
}

export function createCadet(actor: UserRow, raw: z.input<typeof cadetSchema>): number {
  const c = cadetSchema.parse(raw);
  if (!isCommander(actor) && teamCommander(c.teamId) !== actor.id) throw forbidden('ניתן להוסיף צוערים רק לצוות שבפיקודך');
  const at = nowIso();
  const id = db().run(
    'INSERT INTO cadets(first_name, last_name, personal_number, team_id, phone, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    c.firstName,
    c.lastName,
    c.personalNumber,
    c.teamId,
    c.phone,
    c.notes,
    c.status,
    at,
    at,
  ).id;
  changed('cadets');
  return id;
}

export function updateCadet(actor: UserRow, id: number, raw: Partial<z.input<typeof cadetSchema>>): void {
  const cur = cadetRow(id);
  if (!canManageCadet(actor, cur)) throw forbidden();
  const p = cadetSchema.partial().parse(raw);
  // moving a cadet between teams is the commander's call
  if (p.teamId !== undefined && p.teamId !== cur.team_id && !isCommander(actor)) throw forbidden('העברת צוער בין צוותים שמורה למפקד הקורס');
  if (p.teamId) teamCommander(p.teamId);
  db().run(
    'UPDATE cadets SET first_name = ?, last_name = ?, personal_number = ?, team_id = ?, phone = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?',
    p.firstName ?? cur.first_name,
    p.lastName ?? cur.last_name,
    p.personalNumber ?? cur.personal_number,
    p.teamId !== undefined ? p.teamId : cur.team_id,
    p.phone ?? cur.phone,
    p.notes ?? cur.notes,
    p.status ?? cur.status,
    nowIso(),
    id,
  );
  if (p.status && p.status !== cur.status) {
    logActivity({ userId: actor.id, action: 'cadet_status', text: `${actor.display_name} עדכן את סטטוס הצוער ${cur.first_name} ${cur.last_name}` });
  }
  changed('cadets');
}

export function deleteCadet(id: number): void {
  cadetRow(id);
  db().run('DELETE FROM cadets WHERE id = ?', id);
  changed('cadets', 'tasks');
}

export const importSchema = z.object({
  text: z.string().max(100_000),
  teamId: z.number().int().positive().nullable().optional(),
});

/**
 * Paste a list (one cadet per line): "full name [, personal number] [, phone] [, team]".
 * Tabs, commas or semicolons separate columns, so a column copied from Excel works.
 */
export function importCadets(actor: UserRow, raw: z.input<typeof importSchema>): number {
  const { text, teamId } = importSchema.parse(raw);
  const teams = new Map(listTeams().map((t) => [t.name.trim(), t.id]));
  let n = 0;
  db().tx(() => {
    for (const line of text.split(/\r?\n/)) {
      const cols = line.split(/\t|;|,/).map((c) => c.trim());
      if (!cols[0] || /^(שם|name)/i.test(cols[0])) continue;
      const parts = cols[0].split(/\s+/);
      let team = teamId ?? null;
      if (!team && cols[3]) {
        team = teams.get(cols[3]) ?? null;
        if (!team) {
          team = db().run('INSERT INTO teams(name, sort, created_at) VALUES (?, ?, ?)', cols[3], teams.size + 1, nowIso()).id;
          teams.set(cols[3], team);
        }
      }
      createCadet(actor, { firstName: parts[0], lastName: parts.slice(1).join(' '), personalNumber: cols[1] ?? '', phone: cols[2] ?? '', teamId: team });
      n++;
    }
    logActivity({ userId: actor.id, action: 'cadets_import', text: `${actor.display_name} ייבא ${n} צוערים` });
  });
  return n;
}

// ---------------- records ----------------

export const recordSchema = z
  .object({
    kind: z.enum(RECORD_KINDS),
    title: z.string().trim().max(200).optional().default(''),
    body: z.string().trim().max(5000).optional().default(''),
    category: z.string().trim().max(60).optional().default(''),
    score: z.number().int().min(1).max(5).nullable().optional().default(null),
    followUp: z.string().trim().max(2000).optional().default(''),
    private: z.boolean().optional().default(false),
    occurredOn: z.string().refine(isDateKey, 'תאריך לא תקין').optional(),
    followUpTask: z
      .object({ title: z.string().trim().min(1).max(200), deadline: isoDateTime, ownerId: z.number().int().positive().optional() })
      .optional(),
  })
  .refine((r) => r.kind !== 'evaluation' || r.score !== null, { message: 'יש לתת ציון להערכה (1-5)', path: ['score'] })
  .refine((r) => r.body || r.title, { message: 'יש לכתוב תוכן', path: ['body'] });

export function addRecord(actor: UserRow, cadetId: number, raw: z.input<typeof recordSchema>): number {
  const c = cadetRow(cadetId);
  const r = recordSchema.parse(raw);
  const manage = canManageCadet(actor, c);
  if (RESTRICTED_RECORD_KINDS.includes(r.kind) && !manage) throw forbidden('שיחות אישיות ומשמעת נרשמות על ידי מפקד הצוות או מפקד הקורס');
  const occurredOn = r.occurredOn ?? today();
  const name = `${c.first_name} ${c.last_name}`.trim();
  let id = 0;
  db().tx(() => {
    let taskId: number | null = null;
    if (r.followUpTask) {
      const owner = r.followUpTask.ownerId ?? actor.id;
      if (owner !== actor.id && !manage) throw forbidden('ניתן לפתוח משימת המשך רק לעצמך');
      [taskId] = createTasks(
        actor,
        {
          title: r.followUpTask.title,
          description: `בעקבות ${r.kind === 'talk' ? 'שיחה אישית' : 'רישום'} עם הצוער ${name}`,
          ownerIds: [owner],
          deadline: r.followUpTask.deadline,
          domain: 'צוערים',
          cadetId,
          visibility: RESTRICTED_RECORD_KINDS.includes(r.kind) || r.private ? 'private' : 'normal',
        },
        { system: manage },
      );
    }
    id = db().run(
      `INSERT INTO cadet_records(cadet_id, kind, title, body, category, score, follow_up, private, task_id, week_id, author_id, occurred_on, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cadetId,
      r.kind,
      r.title,
      r.body,
      r.category,
      r.kind === 'evaluation' ? r.score : null,
      r.followUp,
      r.private,
      taskId,
      weekForDate(occurredOn),
      actor.id,
      occurredOn,
      nowIso(),
    ).id;
    if (c.team_commander_id && c.team_commander_id !== actor.id && (r.kind === 'evaluation' || r.kind === 'note')) {
      notify(
        [c.team_commander_id],
        { type: 'cadet_record', category: 'info', title: `${actor.display_name} הוסיף ${r.kind === 'evaluation' ? 'הערכה' : 'הערה'} על ${name}`, link: `/cadets/${cadetId}` },
        actor.id,
      );
    }
  });
  changed('cadets');
  return id;
}

export function deleteRecord(actor: UserRow, id: number): void {
  const r = db().get<{ author_id: number }>('SELECT author_id FROM cadet_records WHERE id = ?', id);
  if (!r) throw notFound();
  if (!isCommander(actor) && r.author_id !== actor.id) throw forbidden();
  db().run('DELETE FROM cadet_records WHERE id = ?', id);
  changed('cadets');
}

export function cadetDetail(actor: UserRow, id: number): CadetDetail {
  const c = cadetRow(id);
  const rows = db().all<RecordRow>(`${RECORD_BASE} WHERE r.cadet_id = ? ORDER BY r.occurred_on DESC, r.id DESC`, id);
  const visible = rows.filter((r) => canViewRecord(actor, r, c));
  return {
    cadet: toCadet(actor, c, rows),
    records: visible.map((r) => toRecord(actor, r)),
    experiences: listExperiences(actor, { cadetId: id }),
    tasks: visibleTasks(actor, 't.cadet_id = ?', id),
    scores: visible
      .filter((r) => r.kind === 'evaluation' && r.score !== null)
      .map((r) => ({ date: r.occurred_on, criterion: r.category || 'כללי', score: r.score as number }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------- experiences ----------------

interface ExperienceRow {
  id: number;
  cadet_id: number;
  cadet_name: string;
  team_name: string | null;
  team_commander_id: number | null;
  role: string;
  week_id: number | null;
  week_name: string | null;
  event_id: number | null;
  event_title: string | null;
  start_date: string;
  end_date: string;
  goals: string;
  mentor_id: number | null;
  mentor_name: string | null;
  status: 'planned' | 'done';
  strengths: string;
  improvements: string;
  feedback: string;
  score: number | null;
  evaluated_by_name: string | null;
  evaluated_at: string | null;
  created_by: number;
  feedback_task_id: number | null;
}

const EXP_BASE = `
SELECT x.*, trim(c.first_name || ' ' || c.last_name) AS cadet_name, tm.name AS team_name, tm.commander_id AS team_commander_id,
  w.name AS week_name, e.title AS event_title, m.display_name AS mentor_name, ev.display_name AS evaluated_by_name,
  (SELECT t.id FROM tasks t WHERE t.experience_id = x.id ORDER BY t.id LIMIT 1) AS feedback_task_id
FROM experiences x
JOIN cadets c ON c.id = x.cadet_id
LEFT JOIN teams tm ON tm.id = c.team_id
LEFT JOIN weeks w ON w.id = x.week_id
LEFT JOIN events e ON e.id = x.event_id
LEFT JOIN users m ON m.id = x.mentor_id
LEFT JOIN users ev ON ev.id = x.evaluated_by
`;

function phaseOf(x: Pick<ExperienceRow, 'status' | 'start_date' | 'end_date'>): Experience['phase'] {
  if (x.status === 'done') return 'done';
  const t = today();
  if (t < x.start_date) return 'planned';
  if (t <= x.end_date) return 'active';
  return 'awaiting_feedback';
}

function experiencePerms(actor: UserRow, x: ExperienceRow) {
  const teamCmd = x.team_commander_id === actor.id;
  const seeFeedback = isCommander(actor) || teamCmd || x.mentor_id === actor.id || x.created_by === actor.id;
  return {
    canSeeFeedback: seeFeedback,
    canEdit: isCommander(actor) || teamCmd || x.created_by === actor.id,
    canGiveFeedback: isCommander(actor) || teamCmd || x.mentor_id === actor.id,
  };
}

function toExperience(actor: UserRow, x: ExperienceRow): Experience {
  const p = experiencePerms(actor, x);
  return {
    id: x.id,
    cadetId: x.cadet_id,
    cadetName: x.cadet_name,
    teamName: x.team_name,
    role: x.role,
    weekId: x.week_id,
    weekName: x.week_name,
    eventId: x.event_id,
    eventTitle: x.event_title,
    startDate: x.start_date,
    endDate: x.end_date,
    goals: x.goals,
    mentorId: x.mentor_id,
    mentorName: x.mentor_name,
    status: x.status,
    phase: phaseOf(x),
    strengths: p.canSeeFeedback ? x.strengths : '',
    improvements: p.canSeeFeedback ? x.improvements : '',
    feedback: p.canSeeFeedback ? x.feedback : '',
    score: p.canSeeFeedback ? x.score : null,
    evaluatedByName: x.evaluated_by_name,
    evaluatedAt: x.evaluated_at,
    feedbackTaskId: x.feedback_task_id,
    ...p,
  };
}

export function listExperiences(actor: UserRow, f: { cadetId?: number; mentorId?: number; weekId?: number } = {}): Experience[] {
  const where: string[] = [];
  const params: number[] = [];
  if (f.cadetId) (where.push('x.cadet_id = ?'), params.push(f.cadetId));
  if (f.mentorId) (where.push('x.mentor_id = ?'), params.push(f.mentorId));
  if (f.weekId) (where.push('x.week_id = ?'), params.push(f.weekId));
  return db()
    .all<ExperienceRow>(`${EXP_BASE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY x.start_date DESC, x.id DESC`, ...params)
    .map((x) => toExperience(actor, x));
}

function experienceRow(id: number): ExperienceRow {
  const x = db().get<ExperienceRow>(`${EXP_BASE} WHERE x.id = ?`, id);
  if (!x) throw notFound('ההתנסות לא נמצאה');
  return x;
}

export const experienceSchema = z
  .object({
    cadetId: z.number().int().positive(),
    role: z.string().trim().min(1, 'חובה לציין תפקיד').max(80),
    startDate: z.string().refine(isDateKey, 'תאריך לא תקין'),
    endDate: z.string().refine(isDateKey, 'תאריך לא תקין'),
    goals: z.string().max(4000).optional().default(''),
    mentorId: z.number().int().positive().nullable().optional().default(null),
    eventId: z.number().int().positive().nullable().optional().default(null),
  })
  .refine((x) => x.endDate >= x.startDate, { message: 'תאריך הסיום לפני תאריך ההתחלה', path: ['endDate'] });

export function createExperience(actor: UserRow, raw: z.input<typeof experienceSchema>): number {
  const x = experienceSchema.parse(raw);
  const c = cadetRow(x.cadetId);
  if (!canManageCadet(actor, c)) throw forbidden('רק מפקד הצוות או מפקד הקורס יכולים לשבץ התנסות');
  if (x.mentorId && !getUserRow(x.mentorId)?.active) throw badRequest('המפקד החונך אינו פעיל');
  const name = `${c.first_name} ${c.last_name}`.trim();
  let id = 0;
  db().tx(() => {
    id = db().run(
      `INSERT INTO experiences(cadet_id, role, week_id, event_id, start_date, end_date, goals, mentor_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      x.cadetId,
      x.role,
      weekForDate(x.startDate),
      x.eventId,
      x.startDate,
      x.endDate,
      x.goals,
      x.mentorId,
      actor.id,
      nowIso(),
    ).id;
    // The mentor gets a feedback task due at the end of the experience.
    createTasks(
      actor,
      {
        title: `משוב התנסות: ${name} - ${x.role}`,
        description: x.goals ? `מטרות ההתנסות:\n${x.goals}` : '',
        ownerIds: [x.mentorId ?? actor.id],
        deadline: zonedIso(x.endDate, getSettings().defaultDeadlineTime, tz()),
        domain: 'הערכה',
        cadetId: x.cadetId,
        experienceId: id,
        visibility: 'private',
      },
      { system: true },
    );
    logActivity({ userId: actor.id, action: 'experience', text: `${actor.display_name} שיבץ את ${name} להתנסות כ${x.role}` });
  });
  changed('cadets', 'tasks');
  return id;
}

export function updateExperience(actor: UserRow, id: number, raw: Partial<z.input<typeof experienceSchema>>): void {
  const cur = experienceRow(id);
  if (!experiencePerms(actor, cur).canEdit) throw forbidden();
  const p = z
    .object({
      role: z.string().trim().min(1).max(80),
      startDate: z.string().refine(isDateKey),
      endDate: z.string().refine(isDateKey),
      goals: z.string().max(4000),
      mentorId: z.number().int().positive().nullable(),
      eventId: z.number().int().positive().nullable(),
    })
    .partial()
    .parse(raw);
  const next = {
    role: p.role ?? cur.role,
    start: p.startDate ?? cur.start_date,
    end: p.endDate ?? cur.end_date,
    goals: p.goals ?? cur.goals,
    mentor: p.mentorId !== undefined ? p.mentorId : cur.mentor_id,
    event: p.eventId !== undefined ? p.eventId : cur.event_id,
  };
  if (next.end < next.start) throw badRequest('תאריך הסיום לפני תאריך ההתחלה');
  db().tx(() => {
    db().run(
      'UPDATE experiences SET role = ?, start_date = ?, end_date = ?, goals = ?, mentor_id = ?, event_id = ?, week_id = ? WHERE id = ?',
      next.role,
      next.start,
      next.end,
      next.goals,
      next.mentor,
      next.event,
      weekForDate(next.start),
      id,
    );
    // keep the open feedback task in step with the mentor and the end date
    const task = db().get<{ id: number; status: string; owner_id: number; deadline: string }>(
      "SELECT id, status, owner_id, deadline FROM tasks WHERE experience_id = ? AND status NOT IN ('done', 'cancelled') ORDER BY id LIMIT 1",
      id,
    );
    if (task) {
      const patch: { ownerId?: number; deadline?: string } = {};
      if (next.mentor && next.mentor !== task.owner_id) patch.ownerId = next.mentor;
      const deadline = zonedIso(next.end, getSettings().defaultDeadlineTime, tz());
      if (next.end !== cur.end_date) patch.deadline = deadline;
      if (Object.keys(patch).length) updateTask(actor, task.id, patch, true, 'עדכון התנסות');
    }
  });
  changed('cadets', 'tasks');
}

export const feedbackSchema = z.object({
  strengths: z.string().trim().max(4000).optional().default(''),
  improvements: z.string().trim().max(4000).optional().default(''),
  feedback: z.string().trim().max(4000).optional().default(''),
  score: z.number().int().min(1).max(5),
});

/** Feedback closes the experience, completes the mentor's task and feeds the cadet's development record. */
export function giveFeedback(actor: UserRow, id: number, raw: z.input<typeof feedbackSchema>): void {
  const x = experienceRow(id);
  if (!experiencePerms(actor, x).canGiveFeedback) throw forbidden('רק החונך, מפקד הצוות או מפקד הקורס נותנים משוב');
  const f = feedbackSchema.parse(raw);
  const at = nowIso();
  db().tx(() => {
    db().run(
      "UPDATE experiences SET status = 'done', strengths = ?, improvements = ?, feedback = ?, score = ?, evaluated_by = ?, evaluated_at = ? WHERE id = ?",
      f.strengths,
      f.improvements,
      f.feedback,
      f.score,
      actor.id,
      at,
      id,
    );
    for (const t of db().all<{ id: number; deadline: string }>("SELECT id, deadline FROM tasks WHERE experience_id = ? AND status NOT IN ('done', 'cancelled')", id)) {
      const late = Date.parse(t.deadline) < clock.now().getTime() ? 1 : 0;
      db().run("UPDATE tasks SET status = 'done', completed_at = ?, completed_late = ?, needs_commander = 0 WHERE id = ?", at, late, t.id);
      logActivity({ taskId: t.id, userId: actor.id, action: 'done', text: `${actor.display_name} מסר משוב - המשימה הושלמה` });
    }
    const body = [f.strengths && `חוזקות: ${f.strengths}`, f.improvements && `לשיפור: ${f.improvements}`, f.feedback].filter(Boolean).join('\n');
    db().run(
      `INSERT INTO cadet_records(cadet_id, kind, title, body, category, score, private, week_id, author_id, occurred_on, created_at)
       VALUES (?, 'evaluation', ?, ?, 'התנסות', ?, 1, ?, ?, ?, ?)`,
      x.cadet_id,
      `התנסות: ${x.role}`,
      body,
      f.score,
      x.week_id,
      actor.id,
      x.end_date < today() ? x.end_date : today(),
      at,
    );
    if (x.team_commander_id) {
      notify([x.team_commander_id], { type: 'experience_feedback', category: 'info', title: `התקבל משוב על ההתנסות של ${x.cadet_name} (${x.role})`, link: `/cadets/${x.cadet_id}` }, actor.id);
    }
  });
  changed('cadets', 'tasks');
}

export function deleteExperience(actor: UserRow, id: number): void {
  const x = experienceRow(id);
  if (!isCommander(actor) && x.created_by !== actor.id) throw forbidden();
  db().tx(() => {
    db().run("UPDATE tasks SET status = 'cancelled', cancel_reason = 'ההתנסות בוטלה' WHERE experience_id = ? AND status NOT IN ('done', 'cancelled')", id);
    db().run('DELETE FROM experiences WHERE id = ?', id);
  });
  changed('cadets', 'tasks');
}

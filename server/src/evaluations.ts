// Evaluation files (תיקי הערכה): a living file that goes with each cadet through the course. Nine
// parts: who fills it in, the cadet's details, the military path, exams and fitness, group dynamics,
// the reason for a committee, the team commander's dated remarks, the critical points and the
// company commander's summary - next to what the cadet file already holds (discipline, talks,
// experiences, scores). Any part is filled in at any time; nothing waits for a committee. When a
// cadet does come before one, the file as it stands is kept with the committee.
//
// Only the company commander (the course commander) and the cadet's team commander open the file,
// on every request. The summary is the company commander's to write; the team commander reads it.
// Every change is kept in the file's history (when, who, what was there before); a change based on
// what someone else has meanwhile changed is refused, never written over it.

import { z } from 'zod';
import { COMMITTEE_DECISIONS, COMMITTEE_DECISION_LABELS, COMMITTEE_KINDS, committeeTo, DISCIPLINE_COMMITTEE_KIND, STANDING_LABELS, STANDINGS } from '../../shared/constants';
import { isDateKey, localDateKey } from '../../shared/dates';
import { EVALUATION_FIELDS, EVALUATION_SECTIONS, EXAM_FIELDS, EXAM_TESTS, EXAM_TEXT_FIELDS, examsEntered, shownTests, type EvaluationSection } from '../../shared/evaluation';
import type { Committee, CommitteeDetail, EvaluationChange, EvaluationExams, EvaluationField, EvaluationFile, EvaluationListItem, EvaluationNote, EvaluationPoint, ExamTest } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { cadetRow, canManageCadet, disciplineOrder, listExperiences, RECORD_BASE, toCadet, toRecord, type CadetRow, type RecordRow } from './cadets';
import { badRequest, clock, forbidden, HttpError, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander } from './taskRepo';
import { weekContaining } from './weeks';

interface FileRow {
  standing: (typeof STANDINGS)[number];
  commander_opinion: string;
  commander_opinion_by_name: string | null;
  commander_opinion_at: string | null;
  company_commander: string;
  team_commander: string;
  unit: string;
  city: string;
  enlisted_on: string | null;
  release_on: string | null;
  military_path: string;
  run_result: string | null;
  run_score: number | null;
  pushups: number | null;
  pushups_score: number | null;
  readings_a: number | null;
  readings_b: number | null;
  mid_run_result: string | null;
  mid_run_score: number | null;
  mid_pushups: number | null;
  mid_pushups_score: number | null;
  mid_a: number | null;
  mid_b: number | null;
  end_run_result: string | null;
  end_run_score: number | null;
  end_pushups: number | null;
  end_pushups_score: number | null;
  final_a: number | null;
  final_b: number | null;
  committee_reason: string;
  updated_at: string;
  updated_by_name: string | null;
}

interface NoteRow {
  id: number;
  cadet_id: number;
  category: string;
  tone: 'positive' | 'improve' | 'exception' | null;
  title: string;
  body: string;
  occurred_on: string;
  shown_on: string | null;
  author_id: number;
  author_name: string;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  version: number;
}

interface PointRow {
  id: number;
  cadet_id: number;
  period: string;
  description: string;
  significance: string;
  author_id: number;
  author_name: string;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  version: number;
}

interface CommitteeRow {
  id: number;
  cadet_id: number;
  kind: string;
  reason: string;
  meeting_date: string | null;
  referred_by_name: string | null;
  referred_at: string;
  snapshot: string;
  snapshot_at: string;
  decision: (typeof COMMITTEE_DECISIONS)[number] | null;
  decision_text: string;
  decided_by_name: string | null;
  decided_at: string | null;
}

const NOTE_BASE = `
SELECT e.*, u.display_name AS author_name, ub.display_name AS updated_by_name
FROM evaluation_entries e JOIN users u ON u.id = e.author_id LEFT JOIN users ub ON ub.id = e.updated_by
`;
const POINT_BASE = `
SELECT p.*, u.display_name AS author_name, ub.display_name AS updated_by_name
FROM evaluation_points p JOIN users u ON u.id = p.author_id LEFT JOIN users ub ON ub.id = p.updated_by
`;
const COMMITTEE_BASE = `
SELECT c.*, rb.display_name AS referred_by_name, dcd.display_name AS decided_by_name
FROM committees c LEFT JOIN users rb ON rb.id = c.referred_by LEFT JOIN users dcd ON dcd.id = c.decided_by
`;

const today = () => localDateKey(clock.now(), tz());
/** "ל" before a name: "ועדת הדחה" becomes "לוועדת הדחה" */
const to = committeeTo;
const dateKey = z.string().refine(isDateKey, 'תאריך לא תקין');
const fullName = (c: Pick<CadetRow, 'first_name' | 'last_name'>) => `${c.first_name} ${c.last_name}`.trim();

function fileRow(cadetId: number): FileRow | undefined {
  return db().get<FileRow>(
    `SELECT f.*, b.display_name AS commander_opinion_by_name, ub.display_name AS updated_by_name
     FROM evaluation_files f LEFT JOIN users b ON b.id = f.commander_opinion_by LEFT JOIN users ub ON ub.id = f.updated_by
     WHERE f.cadet_id = ?`,
    cadetId,
  );
}

function ensureFile(cadetId: number): void {
  db().run('INSERT INTO evaluation_files(cadet_id, updated_at) VALUES (?, ?) ON CONFLICT(cadet_id) DO NOTHING', cadetId, nowIso());
}

/** the company commander and the cadet's team commander - no one else, however the file is reached */
function openFile(actor: UserRow, cadetId: number): CadetRow {
  const c = cadetRow(cadetId);
  if (!canManageCadet(actor, c)) throw forbidden('תיק ההערכה פתוח רק למ"פ ולמפק"צ האחראי על הצוער');
  return c;
}

/** something in the file changed: who and when, for the file's header */
function touched(actor: UserRow, cadetId: number): void {
  ensureFile(cadetId);
  db().run('UPDATE evaluation_files SET updated_at = ?, updated_by = ? WHERE cadet_id = ?', nowIso(), actor.id, cadetId);
}

const asText = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

function remember(actor: UserRow, cadetId: number, section: EvaluationSection, action: EvaluationChange['action'], field: string, before: unknown, after: unknown, itemId: number | null = null): void {
  db().run(
    'INSERT INTO evaluation_history(cadet_id, section, item_id, action, field, old_value, new_value, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    cadetId,
    section,
    itemId,
    action,
    field,
    asText(before),
    asText(after),
    actor.id,
    nowIso(),
  );
}

/** someone else changed it meanwhile: say who, and change nothing */
function conflict(what: string, cadetId: number, field: string, itemId: number | null = null): never {
  const last = db().get<{ name: string | null }>(
    `SELECT u.display_name AS name FROM evaluation_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.cadet_id = ? AND h.field = ? AND (? IS NULL OR h.item_id = ?) ORDER BY h.id DESC LIMIT 1`,
    cadetId,
    field,
    itemId,
    itemId,
  );
  throw new HttpError(409, `${what} עודכן בינתיים${last?.name ? ` על ידי ${last.name}` : ''}. השינוי שלך לא נשמר כדי לא לדרוס את שלו - בדקו את הנוסח השמור והחליטו.`);
}

function toNote(actor: UserRow, e: NoteRow): EvaluationNote {
  return {
    id: e.id,
    occurredOn: e.occurred_on,
    body: e.title ? `${e.title}${e.body ? `\n${e.body}` : ''}` : e.body,
    authorId: e.author_id,
    authorName: e.author_name,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    updatedByName: e.updated_by_name,
    version: e.version,
    edited: e.version > 1,
    canEdit: isCommander(actor) || e.author_id === actor.id,
    legacy: e.tone || e.category || e.shown_on ? { tone: e.tone, category: e.category, shownOn: e.shown_on } : null,
  };
}

function toPoint(actor: UserRow, p: PointRow): EvaluationPoint {
  return {
    id: p.id,
    period: p.period,
    description: p.description,
    significance: p.significance,
    authorName: p.author_name,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    updatedByName: p.updated_by_name,
    version: p.version,
    edited: p.version > 1,
    canEdit: isCommander(actor) || p.author_id === actor.id,
  };
}

function toCommittee(r: CommitteeRow): Committee {
  return {
    id: r.id,
    cadetId: r.cadet_id,
    kind: r.kind,
    reason: r.reason,
    meetingDate: r.meeting_date,
    referredAt: r.referred_at,
    referredByName: r.referred_by_name,
    snapshotAt: r.snapshot_at,
    decision: r.decision,
    decisionText: r.decision_text,
    decidedAt: r.decided_at,
    decidedByName: r.decided_by_name,
  };
}

/** where each exam and fitness field is kept */
const EXAM_COLUMNS: Record<keyof EvaluationExams, keyof FileRow> = {
  runResult: 'run_result',
  runScore: 'run_score',
  pushups: 'pushups',
  pushupsScore: 'pushups_score',
  readingsA: 'readings_a',
  readingsB: 'readings_b',
  midRunResult: 'mid_run_result',
  midRunScore: 'mid_run_score',
  midPushups: 'mid_pushups',
  midPushupsScore: 'mid_pushups_score',
  midA: 'mid_a',
  midB: 'mid_b',
  endRunResult: 'end_run_result',
  endRunScore: 'end_run_score',
  endPushups: 'end_pushups',
  endPushupsScore: 'end_pushups_score',
  finalA: 'final_a',
  finalB: 'final_b',
};

function examsOf(f: FileRow | undefined): EvaluationExams {
  return Object.fromEntries(EXAM_FIELDS.map((k) => [k, (f?.[EXAM_COLUMNS[k]] as string | number | null | undefined) ?? null])) as unknown as EvaluationExams;
}

/** the tests added for the whole course (the threshold fitness test and the readings exam are always there) */
const addedTests = (): ExamTest[] => db().all<{ test: ExamTest }>('SELECT test FROM evaluation_tests').map((r) => r.test);

/** an added test that no file has a value in yet */
function testIsEmpty(test: ExamTest): boolean {
  const where = EXAM_TESTS[test].fields.map((k) => `${EXAM_COLUMNS[k]} IS NOT NULL`).join(' OR ');
  return !db().get(`SELECT 1 FROM evaluation_files WHERE ${where} LIMIT 1`);
}

/** the first active company commander: the name the file shows until another is written */
const companyCommanderName = () => {
  const id = commanderIds()[0];
  return id ? (getUserRow(id)?.display_name ?? null) : null;
};

/** the file as it stands (the viewer only decides what they may still change) */
function buildFile(viewer: UserRow, cadetId: number): EvaluationFile {
  const c = cadetRow(cadetId);
  const f = fileRow(cadetId);
  const records = db().all<RecordRow>(`${RECORD_BASE} WHERE r.cadet_id = ? ORDER BY r.occurred_on DESC, r.id DESC`, cadetId);
  const byCriterion = new Map<string, number[]>();
  for (const r of records) {
    if (r.kind !== 'evaluation' || r.score === null) continue;
    const k = r.category || 'כללי';
    byCriterion.set(k, [...(byCriterion.get(k) ?? []), r.score]);
  }
  const order = disciplineOrder(records);
  const teamCommanderName = c.team_commander_id ? (getUserRow(c.team_commander_id)?.display_name ?? null) : null;
  const commander = isCommander(viewer);
  const exams = examsOf(f);
  const added = addedTests();

  return {
    layout: 2,
    cadet: toCadet(viewer, c, records),
    teamCommanderName,
    general: { companyCommander: f?.company_commander ?? '', teamCommander: f?.team_commander ?? '', companyCommanderAuto: companyCommanderName(), teamCommanderAuto: teamCommanderName },
    details: {
      firstName: c.first_name,
      lastName: c.last_name,
      personalNumber: c.personal_number,
      unit: f?.unit ?? '',
      city: f?.city ?? '',
      enlistedOn: f?.enlisted_on ?? null,
      releaseOn: f?.release_on ?? null,
    },
    militaryPath: f?.military_path ?? '',
    tests: shownTests(added, exams),
    exams,
    removableTests: added.filter((t) => !EXAM_TESTS[t].always && testIsEmpty(t)),
    dynamics: db()
      .all<{ id: number; occurred_on: string; score: number; rank: number; author_id: number; author_name: string }>(
        'SELECT d.*, u.display_name AS author_name FROM evaluation_dynamics d JOIN users u ON u.id = d.author_id WHERE d.cadet_id = ? ORDER BY d.occurred_on, d.id',
        cadetId,
      )
      .map((d) => ({ id: d.id, occurredOn: d.occurred_on, score: d.score, rank: d.rank, authorName: d.author_name, canDelete: commander || d.author_id === viewer.id })),
    committeeReason: f?.committee_reason ?? '',
    notes: db()
      .all<NoteRow>(`${NOTE_BASE} WHERE e.cadet_id = ? ORDER BY e.occurred_on, e.id`, cadetId)
      .map((e) => toNote(viewer, e)),
    points: db()
      .all<PointRow>(`${POINT_BASE} WHERE p.cadet_id = ? ORDER BY p.created_at, p.id`, cadetId)
      .map((p) => toPoint(viewer, p)),
    summary: { text: f?.commander_opinion ?? '', byName: f?.commander_opinion_by_name ?? null, at: f?.commander_opinion_at ?? null },
    standing: f?.standing ?? 'ok',
    scores: [...byCriterion].map(([criterion, list]) => ({ criterion, count: list.length, average: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 })),
    experiences: listExperiences(viewer, { cadetId })
      .filter((x) => x.status === 'done')
      .map((x) => ({ role: x.role, startDate: x.startDate, endDate: x.endDate, mentorName: x.mentorName, score: x.score, strengths: x.strengths, improvements: x.improvements })),
    discipline: records.filter((r) => r.kind === 'discipline').map((r) => toRecord(viewer, r, order)),
    talks: records.filter((r) => r.kind === 'talk').map((r) => toRecord(viewer, r)),
    committees: db().all<CommitteeRow>(`${COMMITTEE_BASE} WHERE c.cadet_id = ? ORDER BY c.referred_at DESC`, cadetId).map(toCommittee),
    updatedAt: f?.updated_at ?? null,
    updatedByName: f?.updated_by_name ?? null,
    canEditSummary: commander,
    canRefer: commander,
    generatedAt: nowIso(),
  };
}

/** The evaluation file - for the company commander and the cadet's team commander only. */
export function evaluationFile(actor: UserRow, cadetId: number): EvaluationFile {
  openFile(actor, cadetId);
  return buildFile(actor, cadetId);
}

/** The cadets whose files this user may open, with the state of each file. */
export function listEvaluations(actor: UserRow): EvaluationListItem[] {
  const cadets = db()
    .all<CadetRow>(
      `SELECT c.*, t.name AS team_name, t.commander_id AS team_commander_id FROM cadets c LEFT JOIN teams t ON t.id = c.team_id
       ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, t.sort, t.name, c.last_name, c.first_name`,
    )
    .filter((c) => canManageCadet(actor, c));
  const files = new Map(
    db()
      .all<FileRow & { cadet_id: number }>('SELECT f.*, ub.display_name AS updated_by_name FROM evaluation_files f LEFT JOIN users ub ON ub.id = f.updated_by')
      .map((f) => [f.cadet_id, f]),
  );
  const count = (table: string) => new Map(db().all<{ cadet_id: number; n: number }>(`SELECT cadet_id, count(*) AS n FROM ${table} GROUP BY cadet_id`).map((r) => [r.cadet_id, r.n]));
  const notes = count('evaluation_entries');
  const points = count('evaluation_points');
  const dynamics = new Map<number, { score: number; rank: number; occurredOn: string }>();
  for (const d of db().all<{ cadet_id: number; score: number; rank: number; occurred_on: string }>('SELECT cadet_id, score, rank, occurred_on FROM evaluation_dynamics ORDER BY occurred_on, id')) {
    dynamics.set(d.cadet_id, { score: d.score, rank: d.rank, occurredOn: d.occurred_on }); // the latest one
  }
  const committees = new Map<number, CommitteeRow>();
  for (const r of db().all<CommitteeRow>('SELECT * FROM committees ORDER BY referred_at')) committees.set(r.cadet_id, r); // the latest one
  const discipline = new Map(
    db()
      .all<{ cadet_id: number; n: number }>("SELECT cadet_id, count(*) AS n FROM cadet_records WHERE kind = 'discipline' AND formal = 1 GROUP BY cadet_id")
      .map((r) => [r.cadet_id, r.n]),
  );
  const added = addedTests();

  return cadets.map((c) => {
    const f = files.get(c.id);
    const committee = committees.get(c.id);
    const exams = examsOf(f);
    const tally = examsEntered(shownTests(added, exams), exams);
    return {
      cadetId: c.id,
      fullName: fullName(c),
      personalNumber: c.personal_number,
      teamId: c.team_id,
      teamName: c.team_name,
      status: c.status,
      standing: f?.standing ?? 'ok',
      notes: notes.get(c.id) ?? 0,
      points: points.get(c.id) ?? 0,
      exams: tally.entered,
      examsTotal: tally.total,
      lastDynamics: dynamics.get(c.id) ?? null,
      hasSummary: !!f?.commander_opinion.trim(),
      hasCommitteeReason: !!f?.committee_reason.trim(),
      disciplineNotes: discipline.get(c.id) ?? 0,
      committee: committee ? { id: committee.id, kind: committee.kind, decision: committee.decision } : null,
      updatedAt: f?.updated_by_name ? f.updated_at : null,
      updatedByName: f?.updated_by_name ?? null,
    };
  });
}

// ---------------- the fields: set one by one ----------------

const score = z.number().min(0, 'ציון בין 0 ל-100').max(100, 'ציון בין 0 ל-100').nullable();
const text = (max: number) => z.string().max(max, 'הטקסט ארוך מדי');
type FieldRule = { schema: z.ZodType<string | number | null>; column?: keyof FileRow; cadet?: 'first_name' | 'last_name' | 'personal_number' };
const REPS: (keyof EvaluationExams)[] = ['pushups', 'midPushups', 'endPushups'];
const EXAM_RULES = Object.fromEntries(
  EXAM_FIELDS.map((k): [keyof EvaluationExams, FieldRule] => [
    k,
    {
      schema: EXAM_TEXT_FIELDS.includes(k) ? z.string().trim().max(40).nullable() : REPS.includes(k) ? z.number().int('מספר שלם של חזרות').min(0).max(1000).nullable() : score,
      column: EXAM_COLUMNS[k],
    },
  ]),
) as Record<keyof EvaluationExams, FieldRule>;
const FIELD_RULES: Record<EvaluationField, FieldRule> = {
  companyCommander: { schema: text(120), column: 'company_commander' },
  teamCommander: { schema: text(120), column: 'team_commander' },
  firstName: { schema: z.string().trim().min(1, 'חובה למלא שם פרטי').max(60), cadet: 'first_name' },
  lastName: { schema: z.string().trim().max(60), cadet: 'last_name' },
  personalNumber: { schema: z.string().trim().max(20), cadet: 'personal_number' },
  unit: { schema: text(120), column: 'unit' },
  city: { schema: text(120), column: 'city' },
  enlistedOn: { schema: dateKey.nullable(), column: 'enlisted_on' },
  releaseOn: { schema: dateKey.nullable(), column: 'release_on' },
  militaryPath: { schema: text(20_000), column: 'military_path' },
  ...EXAM_RULES,
  committeeReason: { schema: text(20_000), column: 'committee_reason' },
  summary: { schema: text(20_000), column: 'commander_opinion' },
  standing: { schema: z.enum(STANDINGS), column: 'standing' },
};

const value = z.union([z.string(), z.number(), z.null()]);
const fieldsSchema = z.object({
  /** the new values */
  changes: z.record(z.string(), value),
  /** what the user saw before changing each field: if it changed meanwhile, nothing is written */
  base: z.record(z.string(), value).optional(),
});

/** fields that can be "not entered" (null), as distinct from empty text or a zero */
const NULLABLE: EvaluationField[] = ['enlistedOn', 'releaseOn', ...EXAM_FIELDS];

/** a value as kept: text trimmed, an empty one "not entered" where that exists */
function normalize(field: EvaluationField, v: unknown): string | number | null {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' && NULLABLE.includes(field)) return null;
    return field === 'militaryPath' || field === 'committeeReason' || field === 'summary' ? v.replace(/\s+$/, '') : t;
  }
  return (v as number | null) ?? null;
}


function currentValue(c: CadetRow, f: FileRow | undefined, field: EvaluationField): string | number | null {
  const rule = FIELD_RULES[field];
  if (rule.cadet) return c[rule.cadet];
  const empty = field === 'standing' ? 'ok' : NULLABLE.includes(field) ? null : '';
  return f ? ((f[rule.column!] as string | number | null) ?? empty) : empty;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim());

/** sets fields of the file - all of them, or none when one of them changed meanwhile */
export function updateEvaluationFields(actor: UserRow, cadetId: number, raw: unknown): void {
  const c = openFile(actor, cadetId);
  const { changes, base } = fieldsSchema.parse(raw);
  const fields = Object.keys(changes).filter((k): k is EvaluationField => Object.hasOwn(FIELD_RULES, k));
  if (!fields.length) throw badRequest('אין מה לשמור');
  if (fields.includes('summary') && !isCommander(actor)) throw forbidden('את סיכום המ"פ כותב המ"פ');
  const f = fileRow(cadetId);
  const next = new Map<EvaluationField, string | number | null>();
  for (const field of fields) {
    const rule = FIELD_RULES[field];
    const parsed = rule.schema.safeParse(normalize(field, changes[field]));
    if (!parsed.success) throw badRequest(`${EVALUATION_FIELDS[field].label}: ${parsed.error.issues[0]?.message ?? 'ערך לא תקין'}`);
    next.set(field, parsed.data);
    if (base && Object.hasOwn(base, field) && !same(currentValue(c, f, field), normalize(field, base[field]))) conflict(EVALUATION_FIELDS[field].label, cadetId, field);
  }
  const enlisted = next.has('enlistedOn') ? next.get('enlistedOn') : (f?.enlisted_on ?? null);
  const release = next.has('releaseOn') ? next.get('releaseOn') : (f?.release_on ?? null);
  if (enlisted && release && String(release) < String(enlisted)) throw badRequest('תאריך השחרור לפני תאריך הגיוס');

  const now = nowIso();
  db().tx(() => {
    ensureFile(cadetId);
    for (const [field, v] of next) {
      const before = currentValue(c, f, field);
      if (same(before, v)) continue;
      const rule = FIELD_RULES[field];
      // the cadet card holds the name and personal number; the file shows them from there
      if (rule.cadet) db().run(`UPDATE cadets SET ${rule.cadet} = ?, updated_at = ? WHERE id = ?`, v, now, cadetId);
      else db().run(`UPDATE evaluation_files SET ${rule.column} = ? WHERE cadet_id = ?`, v, cadetId);
      if (field === 'summary') db().run('UPDATE evaluation_files SET commander_opinion_by = ?, commander_opinion_at = ? WHERE cadet_id = ?', actor.id, now, cadetId);
      remember(actor, cadetId, EVALUATION_FIELDS[field].section, 'set', field, before, v);
      if (field === 'standing') {
        logActivity({ userId: actor.id, action: 'evaluation_standing', text: `${actor.display_name} עדכן את מצבו של ${fullName(c)} בתיק ההערכה: ${STANDING_LABELS[v as (typeof STANDINGS)[number]]}` });
        if (v === 'risk') notify(commanderIds(), { type: 'evaluation', category: 'exception', title: `${fullName(c)} סומן "בסיכון" בתיק ההערכה`, link: `/evaluations/${cadetId}` }, actor.id);
      }
    }
    touched(actor, cadetId);
  });
  changed('cadets');
}

// ---------------- the exams the course has reached ----------------

const testSchema = z.object({ test: z.enum(['fitMid', 'midExam', 'fitEnd', 'finalExam']) });

/** adds a test to the files of every cadet in the course - from any file its user may open */
export function addExamTest(actor: UserRow, cadetId: number, raw: unknown): void {
  openFile(actor, cadetId);
  const { test } = testSchema.parse(raw);
  const added = db().run('INSERT INTO evaluation_tests(test, added_by, added_at) VALUES (?, ?, ?) ON CONFLICT(test) DO NOTHING', test, actor.id, nowIso()).changes > 0;
  if (!added) return;
  logActivity({ userId: actor.id, action: 'evaluation_test', text: `${actor.display_name} הוסיף "${EXAM_TESTS[test].label}" לתיקי ההערכה של כל הצוערים` });
  changed('cadets');
}

/** takes an added test away again - only while no file has a value in it */
export function removeExamTest(actor: UserRow, cadetId: number, test: string): void {
  openFile(actor, cadetId);
  const t = testSchema.parse({ test }).test;
  if (!testIsEmpty(t)) throw badRequest(`כבר הוזנו נתונים ב"${EXAM_TESTS[t].label}" - הוא נשאר בתיקים`);
  if (db().run('DELETE FROM evaluation_tests WHERE test = ?', t).changes === 0) return;
  logActivity({ userId: actor.id, action: 'evaluation_test', text: `${actor.display_name} הסיר את "${EXAM_TESTS[t].label}" מתיקי ההערכה` });
  changed('cadets');
}

// ---------------- group dynamics ----------------

const dynamicsSchema = z.object({
  occurredOn: dateKey,
  score: z.number().int('ציון שלם בין 1 ל-5').min(1, 'ציון בין 1 ל-5').max(5, 'ציון בין 1 ל-5'),
  rank: z.number().int('מיקום שלם בין 1 ל-12').min(1, 'מיקום בין 1 ל-12').max(12, 'מיקום בין 1 ל-12'),
});

export function addDynamics(actor: UserRow, cadetId: number, raw: unknown): void {
  openFile(actor, cadetId);
  const d = dynamicsSchema.parse(raw);
  db().tx(() => {
    const id = db().run('INSERT INTO evaluation_dynamics(cadet_id, occurred_on, score, rank, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', cadetId, d.occurredOn, d.score, d.rank, actor.id, nowIso()).id;
    remember(actor, cadetId, 'dynamics', 'add', 'dynamics', null, `${d.occurredOn}: ציון ${d.score}, מיקום ${d.rank}`, id);
    touched(actor, cadetId);
  });
  changed('cadets');
}

export function deleteDynamics(actor: UserRow, id: number): number {
  const d = db().get<{ cadet_id: number; author_id: number; occurred_on: string; score: number; rank: number }>('SELECT * FROM evaluation_dynamics WHERE id = ?', id);
  if (!d) throw notFound('ההערכה לא נמצאה');
  openFile(actor, d.cadet_id);
  if (!isCommander(actor) && d.author_id !== actor.id) throw forbidden('הערכה נמחקת בידי מי שהזין אותה או המ"פ');
  db().tx(() => {
    db().run('DELETE FROM evaluation_dynamics WHERE id = ?', id);
    remember(actor, d.cadet_id, 'dynamics', 'delete', 'dynamics', `${d.occurred_on}: ציון ${d.score}, מיקום ${d.rank}`, null, id);
    touched(actor, d.cadet_id);
  });
  changed('cadets');
  return d.cadet_id;
}

// ---------------- the team commander's remarks ----------------

const noteSchema = z.object({
  occurredOn: dateKey,
  body: z.string().trim().min(1, 'כתבו את ההתייחסות').max(20_000, 'ההתייחסות ארוכה מדי'),
});
const noteEditSchema = noteSchema.partial().extend({ version: z.number().int().positive() });

export function addNote(actor: UserRow, cadetId: number, raw: unknown): void {
  openFile(actor, cadetId);
  const n = noteSchema.parse(raw);
  const now = nowIso();
  db().tx(() => {
    const id = db().run(
      'INSERT INTO evaluation_entries(cadet_id, body, occurred_on, week_id, author_id, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      cadetId,
      n.body,
      n.occurredOn,
      weekContaining(n.occurredOn)?.id ?? null,
      actor.id,
      now,
      now,
      actor.id,
    ).id;
    remember(actor, cadetId, 'notes', 'add', 'note', null, n.body, id);
    touched(actor, cadetId);
  });
  changed('cadets');
}

function noteRow(id: number): NoteRow {
  const e = db().get<NoteRow>(`${NOTE_BASE} WHERE e.id = ?`, id);
  if (!e) throw notFound('ההתייחסות לא נמצאה');
  return e;
}

export function updateNote(actor: UserRow, id: number, raw: unknown): number {
  const e = noteRow(id);
  openFile(actor, e.cadet_id);
  if (!isCommander(actor) && e.author_id !== actor.id) throw forbidden('התייחסות מעודכנת בידי מי שכתב אותה או המ"פ');
  const p = noteEditSchema.parse(raw);
  if (p.version !== e.version) conflict('ההתייחסות', e.cadet_id, 'note', id);
  const before = toNote(actor, e);
  const body = p.body ?? before.body;
  const occurredOn = p.occurredOn ?? e.occurred_on;
  if (body === before.body && occurredOn === e.occurred_on) return e.cadet_id;
  db().tx(() => {
    // a remark from before the present form keeps its words in one text from now on
    db().run(
      "UPDATE evaluation_entries SET title = '', body = ?, occurred_on = ?, week_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?",
      body,
      occurredOn,
      weekContaining(occurredOn)?.id ?? null,
      nowIso(),
      actor.id,
      id,
      e.version,
    );
    if (body !== before.body) remember(actor, e.cadet_id, 'notes', 'edit', 'note', before.body, body, id);
    if (occurredOn !== e.occurred_on) remember(actor, e.cadet_id, 'notes', 'edit', 'noteDate', e.occurred_on, occurredOn, id);
    touched(actor, e.cadet_id);
  });
  changed('cadets');
  return e.cadet_id;
}

export function deleteNote(actor: UserRow, id: number): number {
  const e = noteRow(id);
  openFile(actor, e.cadet_id);
  if (!isCommander(actor) && e.author_id !== actor.id) throw forbidden('התייחסות נמחקת בידי מי שכתב אותה או המ"פ');
  db().tx(() => {
    db().run('DELETE FROM evaluation_entries WHERE id = ?', id);
    remember(actor, e.cadet_id, 'notes', 'delete', 'note', `${e.occurred_on}: ${toNote(actor, e).body}`, null, id);
    touched(actor, e.cadet_id);
  });
  changed('cadets');
  return e.cadet_id;
}

// ---------------- critical points ----------------

const pointSchema = z.object({
  period: z.string().trim().max(120).default(''),
  description: z.string().trim().min(1, 'תארו את האירוע או הממצא').max(10_000, 'התיאור ארוך מדי'),
  significance: z.string().trim().max(10_000, 'הטקסט ארוך מדי').default(''),
});
const pointEditSchema = z.object({
  period: z.string().trim().max(120).optional(),
  description: z.string().trim().min(1, 'תארו את האירוע או הממצא').max(10_000).optional(),
  significance: z.string().trim().max(10_000).optional(),
  version: z.number().int().positive(),
});

export function addPoint(actor: UserRow, cadetId: number, raw: unknown): void {
  openFile(actor, cadetId);
  const p = pointSchema.parse(raw);
  const now = nowIso();
  db().tx(() => {
    const id = db().run(
      'INSERT INTO evaluation_points(cadet_id, period, description, significance, author_id, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      cadetId,
      p.period,
      p.description,
      p.significance,
      actor.id,
      now,
      now,
      actor.id,
    ).id;
    remember(actor, cadetId, 'points', 'add', 'point', null, [p.period, p.description, p.significance].filter(Boolean).join(' | '), id);
    touched(actor, cadetId);
  });
  changed('cadets');
}

function pointRow(id: number): PointRow {
  const p = db().get<PointRow>(`${POINT_BASE} WHERE p.id = ?`, id);
  if (!p) throw notFound('הנקודה לא נמצאה');
  return p;
}

export function updatePoint(actor: UserRow, id: number, raw: unknown): number {
  const cur = pointRow(id);
  openFile(actor, cur.cadet_id);
  if (!isCommander(actor) && cur.author_id !== actor.id) throw forbidden('נקודה מעודכנת בידי מי שכתב אותה או המ"פ');
  const p = pointEditSchema.parse(raw);
  if (p.version !== cur.version) conflict('הנקודה', cur.cadet_id, 'point', id);
  const next = { period: p.period ?? cur.period, description: p.description ?? cur.description, significance: p.significance ?? cur.significance };
  const changedKeys = (['period', 'description', 'significance'] as const).filter((k) => next[k] !== cur[k]);
  if (!changedKeys.length) return cur.cadet_id;
  db().tx(() => {
    db().run(
      'UPDATE evaluation_points SET period = ?, description = ?, significance = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?',
      next.period,
      next.description,
      next.significance,
      nowIso(),
      actor.id,
      id,
      cur.version,
    );
    for (const k of changedKeys) remember(actor, cur.cadet_id, 'points', 'edit', `point.${k}`, cur[k], next[k], id);
    touched(actor, cur.cadet_id);
  });
  changed('cadets');
  return cur.cadet_id;
}

export function deletePoint(actor: UserRow, id: number): number {
  const cur = pointRow(id);
  openFile(actor, cur.cadet_id);
  if (!isCommander(actor) && cur.author_id !== actor.id) throw forbidden('נקודה נמחקת בידי מי שכתב אותה או המ"פ');
  db().tx(() => {
    db().run('DELETE FROM evaluation_points WHERE id = ?', id);
    remember(actor, cur.cadet_id, 'points', 'delete', 'point', [cur.period, cur.description, cur.significance].filter(Boolean).join(' | '), null, id);
    touched(actor, cur.cadet_id);
  });
  changed('cadets');
  return cur.cadet_id;
}

// ---------------- the history ----------------

const ITEM_LABELS: Record<string, string> = {
  note: 'התייחסות',
  noteDate: 'תאריך התייחסות',
  'point.period': 'נקודה קריטית - תאריך / תקופה',
  'point.description': 'נקודה קריטית - תיאור',
  'point.significance': 'נקודה קריטית - משמעות פיקודית',
  point: 'נקודה קריטית',
  dynamics: 'הערכת דינמיקה קבוצתית',
};
const ACTION_WORDS: Record<EvaluationChange['action'], string> = { set: '', add: 'נוספה', edit: 'עודכנה', delete: 'נמחקה' };

/** every change in the file, newest first */
export function evaluationHistory(actor: UserRow, cadetId: number): EvaluationChange[] {
  openFile(actor, cadetId);
  return db()
    .all<{ id: number; at: string; user_name: string | null; section: string; action: EvaluationChange['action']; field: string; old_value: string | null; new_value: string | null; item_id: number | null }>(
      'SELECT h.*, u.display_name AS user_name FROM evaluation_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.cadet_id = ? ORDER BY h.id DESC LIMIT 1000',
      cadetId,
    )
    .map((h) => {
      const field = EVALUATION_FIELDS[h.field as EvaluationField]?.label;
      const item = ITEM_LABELS[h.field];
      const label = field ?? `${item ?? EVALUATION_SECTIONS[h.section as EvaluationSection] ?? h.section}${ACTION_WORDS[h.action] ? ` ${ACTION_WORDS[h.action]}` : ''}`;
      return { id: h.id, at: h.at, userName: h.user_name, section: h.section, action: h.action, label, oldValue: h.old_value, newValue: h.new_value, itemId: h.item_id };
    });
}

// ---------------- committees ----------------

const referSchema = z.object({
  kind: z.string().trim().min(1).max(60).default(COMMITTEE_KINDS[0]),
  reason: z.string().trim().max(2000).optional().default(''),
  meetingDate: dateKey.nullable().optional(),
});

function committeeRow(id: number): CommitteeRow {
  const r = db().get<CommitteeRow>(`${COMMITTEE_BASE} WHERE c.id = ?`, id);
  if (!r) throw notFound('הוועדה לא נמצאה');
  return r;
}

/** Refers the cadet to a committee; the file as it stands now is the version the committee receives. */
export function referToCommittee(actor: UserRow, cadetId: number, raw: z.input<typeof referSchema>): number {
  if (!isCommander(actor)) throw forbidden('העברה לוועדה היא החלטה של מפקד הקורס');
  const c = cadetRow(cadetId);
  const r = referSchema.parse(raw);
  if (db().get('SELECT 1 FROM committees WHERE cadet_id = ? AND decision IS NULL', cadetId)) throw badRequest('הצוער כבר הועבר לוועדה שעדיין לא החליטה');
  const now = nowIso();
  // the reason written in the file, unless another was given
  if (!r.reason) r.reason = fileRow(cadetId)?.committee_reason.trim().slice(0, 2000) ?? '';
  const snapshot = JSON.stringify(buildFile(actor, cadetId));
  const id = db().tx(() => {
    const id = db().run(
      'INSERT INTO committees(cadet_id, kind, reason, meeting_date, referred_by, referred_at, snapshot, snapshot_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      cadetId,
      r.kind,
      r.reason,
      r.meetingDate ?? null,
      actor.id,
      now,
      snapshot,
      now,
    ).id;
    const name = `${c.first_name} ${c.last_name}`.trim();
    logActivity({ userId: actor.id, action: 'committee_referral', text: `${actor.display_name} העביר את ${name} ${to(r.kind)}` });
    notify([c.team_commander_id], { type: 'committee', category: 'action', title: `${name} הועבר ${to(r.kind)}`, body: 'תיק ההערכה שלו הוא מה שהוועדה תקבל - כדאי לוודא שהוא מלא ומעודכן.', link: `/evaluations/${cadetId}` }, actor.id);
    return id;
  });
  changed('cadets');
  return id;
}

/**
 * The discipline note that reached the limit sends the cadet to an evaluation
 * committee - by the course's rule, not anyone's decision - with the file as
 * it stands, the note included.
 */
export function referForDiscipline(actor: UserRow, cadetId: number, recordId: number, notes: number): number {
  const now = nowIso();
  const list = db()
    .all<{ occurred_on: string; title: string; category: string }>("SELECT occurred_on, title, category FROM cadet_records WHERE cadet_id = ? AND kind = 'discipline' AND formal = 1 ORDER BY occurred_on, id", cadetId)
    .map((n, i) => `${i + 1}. ${n.occurred_on.split('-').reverse().join('.')} - ${n.title || n.category || 'הערת משמעת'}`);
  const id = db().run(
    'INSERT INTO committees(cadet_id, kind, reason, referred_by, referred_at, snapshot, snapshot_at, from_record) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    cadetId,
    DISCIPLINE_COMMITTEE_KIND,
    [`קיבל ${notes} הערות משמעת:`, ...list].join('\n'),
    actor.id,
    now,
    JSON.stringify(buildFile(actor, cadetId)),
    now,
    recordId,
  ).id;
  const c = cadetRow(cadetId);
  logActivity({ userId: actor.id, action: 'committee_referral', text: `${c.first_name} ${c.last_name} עלה ${to(DISCIPLINE_COMMITTEE_KIND)} (${notes} הערות משמעת)` });
  return id;
}

/** Before the committee decides, the version it receives can be brought up to date. */
export function refreshCommitteeVersion(actor: UserRow, id: number): number {
  if (!isCommander(actor)) throw forbidden();
  const r = committeeRow(id);
  if (r.decision) throw badRequest('הוועדה כבר החליטה; הגרסה שהוצגה לה נשמרת כפי שהייתה');
  db().run('UPDATE committees SET snapshot = ?, snapshot_at = ? WHERE id = ?', JSON.stringify(buildFile(actor, r.cadet_id)), nowIso(), id);
  changed('cadets');
  return r.cadet_id;
}

const decisionSchema = z.object({
  decision: z.enum(COMMITTEE_DECISIONS),
  text: z.string().trim().max(4000).optional().default(''),
  meetingDate: dateKey.nullable().optional(),
});

export function decideCommittee(actor: UserRow, id: number, raw: z.input<typeof decisionSchema>): number {
  if (!isCommander(actor)) throw forbidden();
  const r = committeeRow(id);
  const d = decisionSchema.parse(raw);
  const c = cadetRow(r.cadet_id);
  const name = `${c.first_name} ${c.last_name}`.trim();
  db().tx(() => {
    db().run(
      'UPDATE committees SET decision = ?, decision_text = ?, decided_by = ?, decided_at = ?, meeting_date = coalesce(?, meeting_date, ?) WHERE id = ?',
      d.decision,
      d.text,
      actor.id,
      nowIso(),
      d.meetingDate ?? null,
      today(),
      id,
    );
    // a dismissal also ends the cadet's course
    if (d.decision === 'dismissed') db().run("UPDATE cadets SET status = 'dropped', updated_at = ? WHERE id = ?", nowIso(), r.cadet_id);
    logActivity({ userId: actor.id, action: 'committee_decision', text: `${r.kind} של ${name}: ${COMMITTEE_DECISION_LABELS[d.decision]}` });
    notify([c.team_commander_id], { type: 'committee', category: 'info', title: `החלטת ${r.kind} בעניין ${name}: ${COMMITTEE_DECISION_LABELS[d.decision]}`, link: `/evaluations/${r.cadet_id}` }, actor.id);
  });
  changed('cadets');
  return r.cadet_id;
}

/** A referral made by mistake, before the committee decided. */
export function cancelCommittee(actor: UserRow, id: number): number {
  if (!isCommander(actor)) throw forbidden();
  const r = committeeRow(id);
  if (r.decision) throw badRequest('ועדה שהחליטה נשארת בתיק');
  db().run('DELETE FROM committees WHERE id = ?', id);
  changed('cadets');
  return r.cadet_id;
}

/** The committee with the file exactly as it was presented to it. */
export function committeeDetail(actor: UserRow, id: number): CommitteeDetail {
  const r = committeeRow(id);
  openFile(actor, r.cadet_id);
  // a referral carried over from the first release has no saved version yet: the file as it is now
  if (!r.snapshot) return { committee: toCommittee(r), file: buildFile(actor, r.cadet_id) };
  const saved = JSON.parse(r.snapshot) as EvaluationFile | LegacyFile;
  return { committee: toCommittee(r), file: 'layout' in saved && saved.layout === 2 ? withTests(saved) : fromLegacy(saved as LegacyFile) };
}

/** a version kept before tests could be added: the tests it has values in, the rest not entered */
function withTests(file: EvaluationFile): EvaluationFile {
  if (file.tests) return file;
  const exams = { ...examsOf(undefined), ...file.exams };
  return { ...file, exams, tests: shownTests([], exams), removableTests: [] };
}

/** a version given to a committee before the file had its present form */
interface LegacyFile {
  cadet: EvaluationFile['cadet'];
  teamCommanderName: string | null;
  standing: EvaluationFile['standing'];
  teamOpinion?: { text: string; byName: string | null; at: string | null };
  commanderOpinion?: { text: string; byName: string | null; at: string | null };
  entries?: { id: number; category: string; tone: 'positive' | 'improve' | 'exception'; title: string; body: string; occurredOn: string; shownOn: string | null; authorId: number; authorName: string; createdAt: string }[];
  scores: EvaluationFile['scores'];
  experiences: EvaluationFile['experiences'];
  discipline: EvaluationFile['discipline'];
  talks: EvaluationFile['talks'];
  committees: EvaluationFile['committees'];
  generatedAt: string;
}

/** shown in the present form, nothing added: the remarks as they were, the opinions where they now belong */
function fromLegacy(old: LegacyFile): EvaluationFile {
  const notes: EvaluationNote[] = (old.entries ?? [])
    .map((e) => ({
      id: e.id,
      occurredOn: e.occurredOn,
      body: e.title ? `${e.title}${e.body ? `\n${e.body}` : ''}` : e.body,
      authorId: e.authorId,
      authorName: e.authorName,
      createdAt: e.createdAt,
      updatedAt: e.createdAt,
      updatedByName: null,
      version: 1,
      edited: false,
      canEdit: false,
      legacy: { tone: e.tone, category: e.category, shownOn: e.shownOn },
    }))
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id - b.id);
  if (old.teamOpinion?.text) {
    notes.unshift({ id: 0, occurredOn: (old.teamOpinion.at ?? old.generatedAt).slice(0, 10), body: `חוות דעת מפקד הצוות:\n${old.teamOpinion.text}`, authorId: 0, authorName: old.teamOpinion.byName ?? '', createdAt: old.teamOpinion.at ?? old.generatedAt, updatedAt: old.teamOpinion.at ?? old.generatedAt, updatedByName: null, version: 1, edited: false, canEdit: false, legacy: null });
  }
  return {
    layout: 2,
    cadet: old.cadet,
    teamCommanderName: old.teamCommanderName,
    general: { companyCommander: '', teamCommander: '', companyCommanderAuto: null, teamCommanderAuto: old.teamCommanderName },
    details: { firstName: old.cadet.firstName, lastName: old.cadet.lastName, personalNumber: old.cadet.personalNumber, unit: '', city: '', enlistedOn: null, releaseOn: null },
    militaryPath: '',
    tests: shownTests([], {}),
    exams: examsOf(undefined),
    removableTests: [],
    dynamics: [],
    committeeReason: '',
    notes,
    points: [],
    summary: old.commanderOpinion ?? { text: '', byName: null, at: null },
    standing: old.standing,
    scores: old.scores ?? [],
    experiences: old.experiences ?? [],
    discipline: old.discipline ?? [],
    talks: old.talks ?? [],
    committees: old.committees ?? [],
    updatedAt: null,
    updatedByName: null,
    canEditSummary: false,
    canRefer: false,
    generatedAt: old.generatedAt,
  };
}

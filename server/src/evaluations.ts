// Evaluation files (תיקי הערכה): a running assessment of each cadet - detailed
// entries with their tone, the team commander's and the course commander's
// opinion, and the cadet's overall standing, alongside what the cadet file
// already holds (scores, discipline, personal talks, experiences). When a cadet
// comes before a committee, the file as it stands is kept with the committee:
// that is the version the committee decides on.
//
// The whole file is seen by the course commander and the cadet's team
// commander. Any staff member can add an entry and sees their own entries.

import { z } from 'zod';
import { COMMITTEE_DECISIONS, COMMITTEE_DECISION_LABELS, COMMITTEE_KINDS, EVAL_TONE_LABELS, EVAL_TONES, STANDING_LABELS, STANDINGS } from '../../shared/constants';
import { isDateKey, localDateKey } from '../../shared/dates';
import type { Committee, CommitteeDetail, EvaluationEntry, EvaluationFile, EvaluationListItem } from '../../shared/types';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { cadetRow, canManageCadet, disciplineOrder, listExperiences, RECORD_BASE, toCadet, toRecord, type CadetRow, type RecordRow } from './cadets';
import { badRequest, clock, forbidden, notFound, nowIso, patchSchema, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander } from './taskRepo';
import { weekContaining } from './weeks';

interface FileRow {
  standing: (typeof STANDINGS)[number];
  team_opinion: string;
  team_opinion_by_name: string | null;
  team_opinion_at: string | null;
  commander_opinion: string;
  commander_opinion_by_name: string | null;
  commander_opinion_at: string | null;
}

interface EntryRow {
  id: number;
  cadet_id: number;
  category: string;
  tone: (typeof EVAL_TONES)[number];
  title: string;
  body: string;
  occurred_on: string;
  week_id: number | null;
  week_name: string | null;
  shown_on: string | null;
  author_id: number;
  author_name: string;
  created_at: string;
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

const ENTRY_BASE = `
SELECT e.*, u.display_name AS author_name, w.name AS week_name
FROM evaluation_entries e JOIN users u ON u.id = e.author_id LEFT JOIN weeks w ON w.id = e.week_id
`;
const COMMITTEE_BASE = `
SELECT c.*, rb.display_name AS referred_by_name, dcd.display_name AS decided_by_name
FROM committees c LEFT JOIN users rb ON rb.id = c.referred_by LEFT JOIN users dcd ON dcd.id = c.decided_by
`;

const today = () => localDateKey(clock.now(), tz());
/** "ל" before a name: "ועדת הדחה" becomes "לוועדת הדחה" */
const to = (name: string) => `ל${name.startsWith('ו') && !name.startsWith('וו') ? `ו${name}` : name}`;
const dateKey = z.string().refine(isDateKey, 'תאריך לא תקין');

function fileRow(cadetId: number): FileRow | undefined {
  return db().get<FileRow>(
    `SELECT f.*, a.display_name AS team_opinion_by_name, b.display_name AS commander_opinion_by_name
     FROM evaluation_files f LEFT JOIN users a ON a.id = f.team_opinion_by LEFT JOIN users b ON b.id = f.commander_opinion_by
     WHERE f.cadet_id = ?`,
    cadetId,
  );
}

function ensureFile(cadetId: number): void {
  db().run('INSERT INTO evaluation_files(cadet_id, updated_at) VALUES (?, ?) ON CONFLICT(cadet_id) DO NOTHING', cadetId, nowIso());
}

const canEditEntry = (actor: UserRow, e: Pick<EntryRow, 'author_id'>) => isCommander(actor) || e.author_id === actor.id;

function toEntry(actor: UserRow, e: EntryRow): EvaluationEntry {
  return {
    id: e.id,
    cadetId: e.cadet_id,
    category: e.category,
    tone: e.tone,
    title: e.title,
    body: e.body,
    occurredOn: e.occurred_on,
    weekId: e.week_id,
    weekName: e.week_name,
    shownOn: e.shown_on,
    authorId: e.author_id,
    authorName: e.author_name,
    createdAt: e.created_at,
    canEdit: canEditEntry(actor, e),
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

/** The evaluation file as this user may see it. */
export function evaluationFile(actor: UserRow, cadetId: number): EvaluationFile {
  const c = cadetRow(cadetId);
  const full = canManageCadet(actor, c);
  const f = fileRow(cadetId);
  const records = db().all<RecordRow>(`${RECORD_BASE} WHERE r.cadet_id = ? ORDER BY r.occurred_on DESC, r.id DESC`, cadetId);
  const entries = db()
    .all<EntryRow>(`${ENTRY_BASE} WHERE e.cadet_id = ? ORDER BY e.occurred_on DESC, e.id DESC`, cadetId)
    .filter((e) => full || e.author_id === actor.id);

  const byCriterion = new Map<string, number[]>();
  for (const r of records) {
    if (r.kind !== 'evaluation' || r.score === null) continue;
    const k = r.category || 'כללי';
    byCriterion.set(k, [...(byCriterion.get(k) ?? []), r.score]);
  }
  const opinion = (text: string | undefined, byName: string | null | undefined, at: string | null | undefined) => ({ text: text ?? '', byName: byName ?? null, at: at ?? null });
  const order = disciplineOrder(records);

  return {
    cadet: toCadet(actor, c, records),
    teamCommanderName: c.team_commander_id ? (getUserRow(c.team_commander_id)?.display_name ?? null) : null,
    standing: f?.standing ?? 'ok',
    teamOpinion: full ? opinion(f?.team_opinion, f?.team_opinion_by_name, f?.team_opinion_at) : opinion('', null, null),
    commanderOpinion: full ? opinion(f?.commander_opinion, f?.commander_opinion_by_name, f?.commander_opinion_at) : opinion('', null, null),
    entries: entries.map((e) => toEntry(actor, e)),
    scores: full
      ? [...byCriterion].map(([criterion, list]) => ({ criterion, count: list.length, average: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 }))
      : [],
    experiences: full
      ? listExperiences(actor, { cadetId })
          .filter((x) => x.status === 'done')
          .map((x) => ({ role: x.role, startDate: x.startDate, endDate: x.endDate, mentorName: x.mentorName, score: x.score, strengths: x.strengths, improvements: x.improvements }))
      : [],
    discipline: full ? records.filter((r) => r.kind === 'discipline').map((r) => toRecord(actor, r, order)) : [],
    talks: full ? records.filter((r) => r.kind === 'talk').map((r) => toRecord(actor, r)) : [],
    committees: full ? db().all<CommitteeRow>(`${COMMITTEE_BASE} WHERE c.cadet_id = ? ORDER BY c.referred_at DESC`, cadetId).map(toCommittee) : [],
    full,
    canEditStanding: full,
    canEditCommanderOpinion: isCommander(actor),
    canRefer: isCommander(actor),
    generatedAt: nowIso(),
  };
}

/** Every cadet with the state of their file, as far as this user may see it. */
export function listEvaluations(actor: UserRow): EvaluationListItem[] {
  const cadets = db().all<CadetRow>(
    `SELECT c.*, t.name AS team_name, t.commander_id AS team_commander_id FROM cadets c LEFT JOIN teams t ON t.id = c.team_id
     ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, t.sort, t.name, c.last_name, c.first_name`,
  );
  const files = new Map(db().all<{ cadet_id: number; standing: FileRow['standing']; opinions: number }>(
    "SELECT cadet_id, standing, (team_opinion <> '' OR commander_opinion <> '') AS opinions FROM evaluation_files",
  ).map((f) => [f.cadet_id, f]));
  const entries = db().all<Pick<EntryRow, 'cadet_id' | 'tone' | 'shown_on' | 'author_id' | 'created_at'>>('SELECT cadet_id, tone, shown_on, author_id, created_at FROM evaluation_entries');
  const committees = new Map<number, CommitteeRow>();
  for (const r of db().all<CommitteeRow>('SELECT * FROM committees ORDER BY referred_at')) committees.set(r.cadet_id, r); // the latest one
  const notes = new Map(
    db()
      .all<{ cadet_id: number; n: number }>("SELECT cadet_id, count(*) AS n FROM cadet_records WHERE kind = 'discipline' AND formal = 1 GROUP BY cadet_id")
      .map((r) => [r.cadet_id, r.n]),
  );

  return cadets.map((c) => {
    const full = canManageCadet(actor, c);
    const mine = entries.filter((e) => e.cadet_id === c.id && (full || e.author_id === actor.id));
    const f = files.get(c.id);
    const committee = full ? committees.get(c.id) : undefined;
    return {
      cadetId: c.id,
      fullName: `${c.first_name} ${c.last_name}`.trim(),
      personalNumber: c.personal_number,
      teamId: c.team_id,
      teamName: c.team_name,
      status: c.status,
      standing: full ? (f?.standing ?? 'ok') : 'ok',
      positive: mine.filter((e) => e.tone === 'positive').length,
      improve: mine.filter((e) => e.tone === 'improve').length,
      exception: mine.filter((e) => e.tone === 'exception').length,
      notShown: mine.filter((e) => !e.shown_on && e.tone !== 'positive').length,
      lastEntryAt: mine.reduce<string | null>((m, e) => (m && m > e.created_at ? m : e.created_at), null),
      hasOpinions: full && !!f?.opinions,
      disciplineNotes: full ? (notes.get(c.id) ?? 0) : 0,
      committee: committee ? { id: committee.id, kind: committee.kind, decision: committee.decision } : null,
      full,
    };
  });
}

// ---------------- the file ----------------

const fileSchema = z.object({
  standing: z.enum(STANDINGS),
  teamOpinion: z.string().max(6000),
  commanderOpinion: z.string().max(6000),
});

export function updateEvaluationFile(actor: UserRow, cadetId: number, raw: Partial<z.input<typeof fileSchema>>): void {
  const c = cadetRow(cadetId);
  if (!canManageCadet(actor, c)) throw forbidden('רק מפקד הצוות ומפקד הקורס מעדכנים את תיק ההערכה');
  const p = patchSchema(fileSchema).parse(raw);
  if (p.commanderOpinion !== undefined && !isCommander(actor)) throw forbidden('את חוות הדעת של מפקד הקורס כותב מפקד הקורס');
  const before = fileRow(cadetId)?.standing ?? 'ok';
  const now = nowIso();
  db().tx(() => {
    ensureFile(cadetId);
    if (p.standing) db().run('UPDATE evaluation_files SET standing = ? WHERE cadet_id = ?', p.standing, cadetId);
    if (p.teamOpinion !== undefined) db().run('UPDATE evaluation_files SET team_opinion = ?, team_opinion_by = ?, team_opinion_at = ? WHERE cadet_id = ?', p.teamOpinion.trim(), actor.id, now, cadetId);
    if (p.commanderOpinion !== undefined) {
      db().run('UPDATE evaluation_files SET commander_opinion = ?, commander_opinion_by = ?, commander_opinion_at = ? WHERE cadet_id = ?', p.commanderOpinion.trim(), actor.id, now, cadetId);
    }
    db().run('UPDATE evaluation_files SET updated_at = ? WHERE cadet_id = ?', now, cadetId);
    const name = `${c.first_name} ${c.last_name}`.trim();
    if (p.standing && p.standing !== before) {
      logActivity({ userId: actor.id, action: 'evaluation_standing', text: `${actor.display_name} עדכן את מצבו של ${name} בתיק ההערכה: ${STANDING_LABELS[p.standing]}` });
      if (p.standing === 'risk') {
        notify(commanderIds(), { type: 'evaluation', category: 'exception', title: `${name} סומן "בסיכון" בתיק ההערכה`, link: `/evaluations/${cadetId}` }, actor.id);
      }
    }
  });
  changed('cadets');
}

// ---------------- entries ----------------

const entrySchema = z.object({
  category: z.string().trim().min(1, 'בחרו תחום').max(60),
  tone: z.enum(EVAL_TONES),
  title: z.string().trim().min(1, 'כתבו במשפט אחד מה קרה').max(160),
  body: z.string().max(6000).optional().default(''),
  occurredOn: dateKey.optional(),
  shownOn: dateKey.nullable().optional(),
});

export function addEvaluationEntry(actor: UserRow, cadetId: number, raw: z.input<typeof entrySchema>): number {
  const c = cadetRow(cadetId);
  const e = entrySchema.parse(raw);
  const occurredOn = e.occurredOn ?? today();
  const now = nowIso();
  const entryId = db().tx(() => {
    const id = db().run(
      'INSERT INTO evaluation_entries(cadet_id, category, tone, title, body, occurred_on, week_id, shown_on, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      cadetId,
      e.category,
      e.tone,
      e.title,
      e.body.trim(),
      occurredOn,
      weekContaining(occurredOn)?.id ?? null,
      e.shownOn ?? null,
      actor.id,
      now,
      now,
    ).id;
    ensureFile(cadetId);
    const name = `${c.first_name} ${c.last_name}`.trim();
    logActivity({ userId: actor.id, action: 'evaluation_entry', text: `${actor.display_name} הוסיף רישום (${EVAL_TONE_LABELS[e.tone]}) לתיק ההערכה של ${name}` });
    // an exception is something the team commander and the course commander must know about
    if (e.tone === 'exception') {
      notify([c.team_commander_id, ...commanderIds()], { type: 'evaluation', category: 'exception', title: `חריג בתיק ההערכה של ${name}`, body: e.title, link: `/evaluations/${cadetId}` }, actor.id);
    }
    return id;
  });
  changed('cadets');
  return entryId;
}

function entryRow(id: number): EntryRow {
  const e = db().get<EntryRow>(`${ENTRY_BASE} WHERE e.id = ?`, id);
  if (!e) throw notFound('הרישום לא נמצא');
  return e;
}

export function updateEvaluationEntry(actor: UserRow, id: number, raw: Partial<z.input<typeof entrySchema>>): number {
  const e = entryRow(id);
  if (!canEditEntry(actor, e)) throw forbidden('רק מי שכתב את הרישום (או מפקד הקורס) יכול לשנות אותו');
  const p = patchSchema(entrySchema).parse(raw);
  const occurredOn = p.occurredOn ?? e.occurred_on;
  db().run(
    'UPDATE evaluation_entries SET category = ?, tone = ?, title = ?, body = ?, occurred_on = ?, week_id = ?, shown_on = ?, updated_at = ? WHERE id = ?',
    p.category ?? e.category,
    p.tone ?? e.tone,
    p.title ?? e.title,
    p.body !== undefined ? p.body.trim() : e.body,
    occurredOn,
    p.occurredOn ? (weekContaining(occurredOn)?.id ?? null) : e.week_id,
    p.shownOn !== undefined ? p.shownOn : e.shown_on,
    nowIso(),
    id,
  );
  changed('cadets');
  return e.cadet_id;
}

/** Marks that the cadet was shown the entry (by its author, the team commander or the course commander). */
export function setEntryShown(actor: UserRow, id: number, shownOn: string | null): number {
  const e = entryRow(id);
  if (!canEditEntry(actor, e) && !canManageCadet(actor, cadetRow(e.cadet_id))) throw forbidden();
  if (shownOn !== null && !isDateKey(shownOn)) throw badRequest('תאריך לא תקין');
  db().run('UPDATE evaluation_entries SET shown_on = ?, updated_at = ? WHERE id = ?', shownOn, nowIso(), id);
  changed('cadets');
  return e.cadet_id;
}

export function deleteEvaluationEntry(actor: UserRow, id: number): number {
  const e = entryRow(id);
  if (!canEditEntry(actor, e)) throw forbidden('רק מי שכתב את הרישום (או מפקד הקורס) יכול למחוק אותו');
  db().run('DELETE FROM evaluation_entries WHERE id = ?', id);
  changed('cadets');
  return e.cadet_id;
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
  const snapshot = JSON.stringify(evaluationFile(actor, cadetId));
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

/** Before the committee decides, the version it receives can be brought up to date. */
export function refreshCommitteeVersion(actor: UserRow, id: number): number {
  if (!isCommander(actor)) throw forbidden();
  const r = committeeRow(id);
  if (r.decision) throw badRequest('הוועדה כבר החליטה; הגרסה שהוצגה לה נשמרת כפי שהייתה');
  db().run('UPDATE committees SET snapshot = ?, snapshot_at = ? WHERE id = ?', JSON.stringify(evaluationFile(actor, r.cadet_id)), nowIso(), id);
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
  if (!canManageCadet(actor, cadetRow(r.cadet_id))) throw forbidden();
  return { committee: toCommittee(r), file: JSON.parse(r.snapshot) as EvaluationFile };
}

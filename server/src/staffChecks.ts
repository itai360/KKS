// The staff's checklist for each cadet (shared/staffChecks.ts): a table for each team - its cadets, and what the
// staff did with each (the opening talk, the experience, the feedback, the sociometric...). A square is marked
// once it happened. The assignment's needs its grade: it goes into the cadet's evaluation file (one of the
// course's grades) and into the course's grade sheet in Google (gradeSheet.ts).

import { z } from 'zod';
import { staffCheckItem, STAFF_CHECK_ITEMS } from '../../shared/staffChecks';
import type { StaffCheckMark, StaffChecksBoard, StaffChecksTeam } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, forbidden, notFound, nowIso } from './core';
import { db } from './db';
import { gradeValue, setGrade, touched } from './evaluations';
import { gradeSheetStatus, writeGradeToSheet } from './gradeSheet';
import { changed, logActivity } from './journal';
import { may } from './abilities';

interface MarkRow {
  cadet_id: number;
  item: string;
  done_at: string;
  by_name: string | null;
  grade: number | null;
  sheet_state: StaffCheckMark['sheet'];
  sheet_note: string;
}

const toMark = (m: MarkRow): StaffCheckMark => ({ at: m.done_at, byName: m.by_name ?? '', grade: m.grade, sheet: m.sheet_state, sheetNote: m.sheet_note });

/** may mark a cadet's squares: the commander, the cadet's team commander, and whoever may handle every team's cadets */
function canMark(actor: UserRow, commanderId: number | null): boolean {
  return actor.role === 'commander' || may(actor, 'cadets') || (commanderId !== null && commanderId === actor.id);
}

const marksOf = (cadetIds: number[]) => {
  const out = new Map<number, Record<string, StaffCheckMark>>();
  if (!cadetIds.length) return out;
  for (const m of db().all<MarkRow>(
    `SELECT s.cadet_id, s.item, s.done_at, u.display_name AS by_name, s.grade, s.sheet_state, s.sheet_note
     FROM staff_checks s LEFT JOIN users u ON u.id = s.done_by WHERE s.cadet_id IN (${cadetIds.map(() => '?').join(',')})`,
    ...cadetIds,
  )) {
    const list = out.get(m.cadet_id) ?? {};
    list[m.item] = toMark(m);
    out.set(m.cadet_id, list);
  }
  return out;
};

/** every team's table, by the teams' numbers (1, 2, 3...) */
export function staffChecksBoard(actor: UserRow): StaffChecksBoard {
  const teams = db().all<{ id: number; name: string; commander_id: number | null; commander_name: string | null }>(
    'SELECT t.id, t.name, t.commander_id, u.display_name AS commander_name FROM teams t LEFT JOIN users u ON u.id = t.commander_id ORDER BY t.sort, t.name',
  );
  const cadets = db().all<{ id: number; first_name: string; last_name: string; team_id: number | null }>(
    "SELECT id, first_name, last_name, team_id FROM cadets WHERE status = 'active' ORDER BY first_name, last_name",
  );
  const marks = marksOf(cadets.map((c) => c.id));
  const row = (c: (typeof cadets)[number]) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), marks: marks.get(c.id) ?? {} });
  const out: StaffChecksTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    commanderName: t.commander_name,
    canMark: canMark(actor, t.commander_id),
    mine: t.commander_id === actor.id,
    cadets: cadets.filter((c) => c.team_id === t.id).map(row),
  }));
  const loose = cadets.filter((c) => c.team_id === null || !teams.some((t) => t.id === c.team_id));
  if (loose.length) out.push({ id: null, name: 'ללא צוות', commanderName: null, canMark: canMark(actor, null), mine: false, cadets: loose.map(row) });
  return { teams: out, sheet: gradeSheetStatus(actor) };
}

export const markSchema = z.object({
  done: z.boolean(),
  grade: z.number().min(0, 'ציון בין 0 ל-100').max(100, 'ציון בין 0 ל-100').nullable().optional(),
});

/** the grade as one of the course's grades in the cadet's evaluation file (kept in its history) */
function gradeIntoFile(actor: UserRow, cadetId: number, name: string, value: number): void {
  const item = db().get<{ id: number }>('SELECT id FROM grade_items WHERE name = ?', name)?.id ?? db().run('INSERT INTO grade_items(name, created_at) VALUES (?, ?)', name, nowIso()).id;
  if (setGrade(actor, cadetId, item, gradeValue(cadetId, item), value)) touched(actor, cadetId);
}

function cadetOf(cadetId: number) {
  const c = db().get<{ id: number; first_name: string; last_name: string; commander_id: number | null }>(
    "SELECT c.id, c.first_name, c.last_name, t.commander_id FROM cadets c LEFT JOIN teams t ON t.id = c.team_id WHERE c.id = ? AND c.status = 'active'",
    cadetId,
  );
  if (!c) throw notFound('הצוער לא נמצא');
  return c;
}

/** a square marked (with its grade, where one is asked for) or cleared; the grade written into the sheet */
export async function markStaffCheck(actor: UserRow, cadetId: number, key: string, raw: unknown): Promise<StaffCheckMark | null> {
  const item = staffCheckItem(key);
  if (!item) throw notFound('המשימה לא נמצאה');
  const c = cadetOf(cadetId);
  if (!canMark(actor, c.commander_id)) throw forbidden('רק מפקד הצוות או מפקד הקורס מסמנים לצוער הזה');
  const p = markSchema.parse(raw);
  if (!p.done) {
    db().run('DELETE FROM staff_checks WHERE cadet_id = ? AND item = ?', cadetId, key);
    changed('cadets');
    return null;
  }
  const grade = item.grade ? (p.grade ?? null) : null;
  if (item.grade && grade === null) throw badRequest(`כדי לסמן "${item.label}" צריך לרשום את הציון`);
  db().run(
    `INSERT INTO staff_checks(cadet_id, item, done_at, done_by, grade, sheet_state, sheet_note, sheet_at) VALUES (?, ?, ?, ?, ?, '', '', NULL)
     ON CONFLICT(cadet_id, item) DO UPDATE SET done_at = excluded.done_at, done_by = excluded.done_by, grade = excluded.grade, sheet_state = '', sheet_note = '', sheet_at = NULL`,
    cadetId,
    key,
    nowIso(),
    actor.id,
    grade,
  );
  if (item.grade && grade !== null) {
    gradeIntoFile(actor, cadetId, item.grade.item, grade);
    logActivity({ userId: actor.id, action: 'staff_check', text: `${actor.display_name} רשם ציון ${grade} ב"${item.label}" ל${`${c.first_name} ${c.last_name}`.trim()}` });
    await toSheet(cadetId, key);
  }
  changed('cadets');
  return markOf(cadetId, key);
}

/** the grade of a marked square into the sheet (again) */
async function toSheet(cadetId: number, key: string): Promise<void> {
  const item = staffCheckItem(key);
  const m = db().get<{ grade: number | null }>('SELECT grade FROM staff_checks WHERE cadet_id = ? AND item = ?', cadetId, key);
  if (!item?.grade || m?.grade === null || m?.grade === undefined) return;
  const r = await writeGradeToSheet(cadetId, item.grade.column, m.grade);
  db().run('UPDATE staff_checks SET sheet_state = ?, sheet_note = ?, sheet_at = ? WHERE cadet_id = ? AND item = ?', r.state, r.note, nowIso(), cadetId, key);
}

function markOf(cadetId: number, key: string): StaffCheckMark | null {
  const m = db().get<MarkRow>(
    'SELECT s.cadet_id, s.item, s.done_at, u.display_name AS by_name, s.grade, s.sheet_state, s.sheet_note FROM staff_checks s LEFT JOIN users u ON u.id = s.done_by WHERE s.cadet_id = ? AND s.item = ?',
    cadetId,
    key,
  );
  return m ? toMark(m) : null;
}

/** a grade that did not reach the sheet, tried again */
export async function retrySheet(actor: UserRow, cadetId: number, key: string): Promise<StaffCheckMark | null> {
  const c = cadetOf(cadetId);
  if (!canMark(actor, c.commander_id)) throw forbidden();
  if (!markOf(cadetId, key)) throw notFound('הסימון לא נמצא');
  await toSheet(cadetId, key);
  changed('cadets');
  return markOf(cadetId, key);
}

/** every grade that did not reach the sheet yet (connected now, or fixed): tried again */
export async function retryAllSheet(actor: UserRow): Promise<{ written: number; failed: number }> {
  if (actor.role !== 'commander') throw forbidden();
  const keys = STAFF_CHECK_ITEMS.filter((i) => i.grade).map((i) => i.key);
  if (!keys.length) return { written: 0, failed: 0 };
  const rows = db().all<{ cadet_id: number; item: string }>(
    `SELECT cadet_id, item FROM staff_checks WHERE grade IS NOT NULL AND sheet_state <> 'written' AND item IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  let written = 0;
  for (const r of rows) {
    await toSheet(r.cadet_id, r.item);
    if (markOf(r.cadet_id, r.item)?.sheet === 'written') written++;
  }
  changed('cadets');
  return { written, failed: rows.length - written };
}

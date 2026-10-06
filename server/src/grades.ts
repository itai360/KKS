// Grades from the course's grade sheet (גליון הציונים). After an exam or a fitness test the course
// commander uploads the sheet (or a link to it); each cadet is found by personal number (or by name),
// and every number lands in that cadet's evaluation file: a column the file knows fills its field
// (כש"ג פתיחה - the threshold fitness score, ציון מקראות - the readings exam...), any other column of
// numbers becomes one of the course's other grades, named as in the sheet. The commander sees what
// will change before anything is written; every change is kept in the file's history, and an empty
// cell never erases a grade.

import { z } from 'zod';
import { EVALUATION_FIELDS, EXAM_SCORE_FIELDS, EXAM_TESTS, GRADE_SHEET_COLUMNS, testOf } from '../../shared/evaluation';
import { searchKey } from '../../shared/search';
import type { EvaluationExams, GradeColumn, GradeImportPreview, GradeImportResult, GradeTarget } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, forbidden, nowIso } from './core';
import { db } from './db';
import { examValue, gradeValue, setExamValue, setGrade, touched } from './evaluations';
import { changed, logActivity } from './journal';
import { readSpreadsheet } from './sheets';
import { isCommander } from './taskRepo';

type ExamKey = keyof EvaluationExams;

const requireCommanderActor = (actor: UserRow) => {
  if (!isCommander(actor)) throw forbidden('ייבוא ציונים לכל הקורס הוא של מפקד הקורס');
};

// ---------------- reading the sheet ----------------

/** The sheets of an uploaded file, empty rows left out; the grade sheet (with a personal number column) first. */
export function readGradeSheets(actor: UserRow, buf: Buffer): { name: string; rows: string[][] }[] {
  requireCommanderActor(actor);
  const sheets = readSpreadsheet(buf)
    .map((s) => ({ name: s.name, rows: s.rows.filter((r) => r.some((c) => c.trim() !== '')).slice(0, 3000) }))
    .filter((s) => s.rows.length > 0);
  if (!sheets.length) throw badRequest('הקובץ ריק');
  return sheets.sort((a, b) => Number(!!headerOf(b.rows)) - Number(!!headerOf(a.rows)));
}

const IDENTITY: [string[], 'pn' | 'first' | 'last' | 'full' | 'team'][] = [
  [['מספר אישי', 'מ.א', 'מ"א', 'מא'], 'pn'],
  [['שם פרטי'], 'first'],
  [['שם משפחה'], 'last'],
  [['שם מלא', 'שם', 'שם הצוער'], 'full'],
  [['צוות', 'מספר', '#'], 'team'],
];
const identityOf = (cell: string) => {
  const k = searchKey(cell);
  return IDENTITY.find(([names]) => names.some((n) => searchKey(n) === k))?.[1] ?? null;
};
const KNOWN = new Map(Object.entries(GRADE_SHEET_COLUMNS).flatMap(([field, names]) => names!.map((n) => [searchKey(n), field as ExamKey])));

interface Header {
  row: number;
  pn: number;
  first: number;
  last: number;
  full: number;
  grades: { index: number; header: string }[];
}

/** the header row: one of the first rows, with a personal number or a name column */
function headerOf(rows: string[][]): Header | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const kinds = rows[r].map(identityOf);
    const at = (k: string) => kinds.indexOf(k as never);
    if (at('pn') < 0 && at('full') < 0 && (at('first') < 0 || at('last') < 0)) continue;
    const grades = rows[r].map((h, index) => ({ index, header: h.replace(/\s+/g, ' ').trim() })).filter((c, i) => c.header && !kinds[i]);
    return { row: r, pn: at('pn'), first: at('first'), last: at('last'), full: at('full'), grades };
  }
  return null;
}

const normalizePn = (v: string) => v.trim().replace(/\.0+$/, '').replace(/\D/g, '');

/** a cell as a grade: a number of 0-100, a number out of range, something else, or nothing */
function cellValue(raw: string | undefined): { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'range' } | { kind: 'other' } {
  const t = (raw ?? '').trim().replace(',', '.');
  if (!t) return { kind: 'empty' };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'other' };
  const n = Math.round(Number(t) * 100) / 100;
  return n < 0 || n > 100 ? { kind: 'range' } : { kind: 'number', value: n };
}

interface Parsed {
  header: Header;
  rows: { line: number; cells: string[]; name: string; personalNumber: string; cadetId: number | null; cadetName: string | null }[];
}

/** the cadets' rows under the header, each matched to a cadet of the course */
function parse(table: string[][]): Parsed {
  const header = headerOf(table);
  if (!header) throw badRequest('לא נמצאה שורת כותרות עם "מספר אישי" או שם הצוער');
  const cadets = db().all<{ id: number; first_name: string; last_name: string; personal_number: string }>('SELECT id, first_name, last_name, personal_number FROM cadets');
  const byPn = new Map(cadets.filter((c) => normalizePn(c.personal_number)).map((c) => [normalizePn(c.personal_number), c]));
  const byName = new Map<string, (typeof cadets)[number]>();
  for (const c of cadets) {
    byName.set(searchKey(`${c.first_name} ${c.last_name}`), c);
    byName.set(searchKey(`${c.last_name} ${c.first_name}`), c);
  }
  const rows: Parsed['rows'] = [];
  for (let r = header.row + 1; r < table.length; r++) {
    const cells = table[r];
    const at = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    const pn = normalizePn(at(header.pn));
    const name = (header.full >= 0 ? at(header.full) : `${at(header.first)} ${at(header.last)}`).replace(/\s+/g, ' ').trim();
    // a team's title row, or an empty one
    if (!pn && (!name || (header.full < 0 && (!at(header.first) || !at(header.last))))) continue;
    const c = (pn && byPn.get(pn)) || (name && byName.get(searchKey(name))) || null;
    rows.push({ line: r + 1, cells, name, personalNumber: pn, cadetId: c?.id ?? null, cadetName: c ? `${c.first_name} ${c.last_name}`.trim() : null });
  }
  if (!rows.length) throw badRequest('לא נמצאו צוערים מתחת לשורת הכותרות');
  return { header, rows };
}

// ---------------- what goes where ----------------

/** the grade now in the file for a target (a score field, or one of the course's grades) */
const current = (cadetId: number, target: GradeTarget): number | null =>
  target.startsWith('item:') ? gradeValue(cadetId, Number(target.slice(5))) : (examValue(cadetId, target as ExamKey) as number | null);
const items = () => db().all<{ id: number; name: string }>('SELECT id, name FROM grade_items ORDER BY id');

function targetsList(): GradeImportPreview['targets'] {
  return [
    { value: 'skip', label: 'לא לייבא' },
    ...EXAM_SCORE_FIELDS.map((k) => ({ value: k as GradeTarget, label: EVALUATION_FIELDS[k].label })),
    ...items().map((i) => ({ value: `item:${i.id}` as GradeTarget, label: `ציון: ${i.name}` })),
    { value: 'new', label: 'ציון חדש בשם העמודה' },
  ];
}

/** a column's default: the field its header names, a grade of the same name, a new grade - or nothing, when it holds no numbers */
function suggest(header: string, numbers: number): GradeTarget {
  const known = KNOWN.get(searchKey(header));
  if (known) return known;
  const same = items().find((i) => searchKey(i.name) === searchKey(header));
  if (same) return `item:${same.id}`;
  return numbers > 0 ? 'new' : 'skip';
}

const targetSchema = z.string().refine((t) => t === 'skip' || t === 'new' || /^item:\d+$/.test(t) || (EXAM_SCORE_FIELDS as string[]).includes(t), 'יעד לא מוכר');
const importSchema = z.object({
  rows: z.array(z.array(z.string().max(500))).min(2, 'הגליון ריק').max(3000, 'הגליון גדול מדי'),
  /** column index -> where it goes; a column not given gets its default */
  mapping: z.record(z.string(), targetSchema).optional().default({}),
  /** false: a grade already in the file stays as it is */
  overwrite: z.boolean().optional().default(true),
});

function plan(raw: unknown) {
  const { rows: table, mapping, overwrite } = importSchema.parse(raw);
  const parsed = parse(table);
  const columns: GradeColumn[] = parsed.header.grades.map(({ index, header }) => {
    const cells = parsed.rows.filter((r) => r.cadetId).map((r) => cellValue(r.cells[index]));
    const numbers = cells.filter((c) => c.kind === 'number').length;
    const target = (mapping[String(index)] as GradeTarget | undefined) ?? suggest(header, numbers);
    return { index, header, target, values: 0, changes: 0, other: cells.filter((c) => c.kind === 'other').length, outOfRange: cells.filter((c) => c.kind === 'range').length };
  });
  const used = columns.filter((c) => c.target !== 'skip' && c.target !== 'new').map((c) => c.target);
  const twice = used.find((t, i) => used.indexOf(t) !== i);
  if (twice) throw badRequest(`שתי עמודות מכוונות לאותו ציון (${labelOf(twice)}) - בחרו אחת`);
  for (const col of columns) {
    if (col.target === 'skip') continue;
    const itemId = col.target.startsWith('item:') ? Number(col.target.slice(5)) : null;
    if (itemId && !db().get('SELECT 1 FROM grade_items WHERE id = ?', itemId)) throw badRequest('הציון שנבחר לא נמצא');
    for (const r of parsed.rows) {
      if (!r.cadetId) continue;
      const v = cellValue(r.cells[col.index]);
      if (v.kind !== 'number') continue;
      col.values++;
      const before = col.target === 'new' ? null : current(r.cadetId, col.target);
      if (before !== null && before !== v.value) col.changes++;
    }
  }
  return { parsed, columns, overwrite };
}

const labelOf = (t: GradeTarget) => (t.startsWith('item:') ? (items().find((i) => `item:${i.id}` === t)?.name ?? t) : (EVALUATION_FIELDS[t as ExamKey]?.label ?? t));

/** What the sheet would put where - nothing is written. */
export function previewGrades(actor: UserRow, raw: unknown): GradeImportPreview {
  requireCommanderActor(actor);
  const { parsed, columns } = plan(raw);
  return {
    headerRow: parsed.header.row + 1,
    columns,
    rows: parsed.rows.map(({ line, name, personalNumber, cadetId, cadetName }) => ({ line, name, personalNumber, cadetId, cadetName })),
    targets: targetsList(),
  };
}

/** A grade that came in by mistake goes away - while no cadet has a value in it. */
export function removeGradeItem(actor: UserRow, id: number): void {
  requireCommanderActor(actor);
  const item = db().get<{ name: string }>('SELECT name FROM grade_items WHERE id = ?', id);
  if (!item) throw badRequest('הציון לא נמצא');
  if (db().get('SELECT 1 FROM grade_values WHERE item_id = ?', id)) throw badRequest(`כבר הוזנו ציונים ב"${item.name}" - הוא נשאר בתיקים`);
  db().run('DELETE FROM grade_items WHERE id = ?', id);
  logActivity({ userId: actor.id, action: 'grades_import', text: `${actor.display_name} הסיר את "${item.name}" מהציונים בתיקי ההערכה` });
  changed('cadets');
}

/** Writes the sheet's grades into the cadets' files, each change in the file's history. */
export function importGrades(actor: UserRow, raw: unknown): GradeImportResult {
  requireCommanderActor(actor);
  const { parsed, columns, overwrite } = plan(raw);
  const result: GradeImportResult = { cadets: 0, set: 0, replaced: 0, kept: 0, unmatched: parsed.rows.filter((r) => !r.cadetId).length };
  const touchedCadets = new Set<number>();
  db().tx(() => {
    for (const col of columns) {
      if (col.target === 'skip' || col.values === 0) continue;
      let target = col.target;
      if (target === 'new') {
        const name = col.header.slice(0, 60);
        const existing = items().find((i) => searchKey(i.name) === searchKey(name));
        target = `item:${existing?.id ?? db().run('INSERT INTO grade_items(name, created_at) VALUES (?, ?)', name, nowIso()).id}`;
      }
      const itemId = target.startsWith('item:') ? Number(target.slice(5)) : null;
      // a grade of a test the course has not added yet: the test comes with it
      if (!itemId) {
        const test = testOf(target as ExamKey);
        if (!EXAM_TESTS[test].always) db().run('INSERT INTO evaluation_tests(test, added_by, added_at) VALUES (?, ?, ?) ON CONFLICT(test) DO NOTHING', test, actor.id, nowIso());
      }
      for (const r of parsed.rows) {
        if (!r.cadetId) continue;
        const v = cellValue(r.cells[col.index]);
        if (v.kind !== 'number') continue;
        const before = current(r.cadetId, target);
        if (before !== null && before !== v.value && !overwrite) {
          result.kept++;
          continue;
        }
        const wrote = itemId ? setGrade(actor, r.cadetId, itemId, before, v.value) : setExamValue(actor, r.cadetId, target as ExamKey, v.value);
        if (!wrote) continue;
        result.set++;
        if (before !== null) result.replaced++;
        touchedCadets.add(r.cadetId);
      }
    }
    for (const id of touchedCadets) touched(actor, id);
  });
  result.cadets = touchedCadets.size;
  if (result.set) {
    logActivity({ userId: actor.id, action: 'grades_import', text: `${actor.display_name} ייבא ציונים מגליון הציונים: ${result.set} ציונים ל-${result.cadets} צוערים` });
    changed('cadets');
  }
  return result;
}

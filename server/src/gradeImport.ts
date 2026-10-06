import { z } from 'zod';
import { EXAM_FIELDS, EXAM_TEXT_FIELDS } from '../../shared/evaluation';
import {
  GRADE_COLUMN_LABELS,
  GRADE_IMPORT_LIMIT,
  gradeKey,
  inferGradeColumn,
  personalKey,
  type GradeColumn,
  type GradeField,
  type GradePreview,
  type GradePreviewRow,
  type GradeUpload,
  type GradeWrite,
} from '../../shared/gradeImport';
import type { UserRow } from './auth';
import { badRequest } from './core';
import { db } from './db';
import { examImportCadets, updateEvaluationFields } from './evaluations';
import { changed, logActivity } from './journal';
import { readSpreadsheet } from './sheets';

/** Reads all grade sheets, preserving the workbook's actual row numbers. Never saves grades. */
export function gradeSheets(buf: Buffer): GradeUpload {
  if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest('יש לבחור קובץ XLSX או CSV');
  if (buf[0] === 0xd0 || buf.subarray(0, 200).toString().toLowerCase().includes('<html')) throw badRequest('יש לשמור את הקובץ בפורמט XLSX או CSV');
  const sheets = readSpreadsheet(buf, { formatNumbers: true });
  const result: GradeUpload = { sheets: [], skippedSheets: [] };
  let count = 0;
  for (const sheet of sheets) {
    const h = sheet.rows.slice(0, 50).findIndex((r) => {
      const columns = r.map(inferGradeColumn);
      return columns.includes('personalNumber') || columns.includes('fullName') || (columns.includes('firstName') && columns.includes('lastName'));
    });
    if (h < 0) {
      result.skippedSheets.push(sheet.name);
      continue;
    }
    const headers = sheet.rows[h];
    if (headers.length > 64) throw badRequest('ניתן לייבא עד 64 עמודות בגיליון. הסירו עמודות שאינן נדרשות.');
    const rows = sheet.rows
      .slice(h + 1)
      .flatMap((values, i) => (values.some((v) => v.trim()) ? [{ line: sheet.rowNumbers?.[h + i + 1] ?? h + i + 2, values: headers.map((_, c) => values[c] ?? '') }] : []));
    count += rows.length;
    if (count > GRADE_IMPORT_LIMIT) throw badRequest(`ניתן לייבא עד ${GRADE_IMPORT_LIMIT} שורות בכל סבב. פצלו את הקובץ.`);
    if (rows.some((r) => r.values.some((v) => v.length > 120))) throw badRequest('נמצא תא ארוך מדי. יש להעלות גיליון ציונים בלבד.');
    result.sheets.push({ name: sheet.name, headers, mapping: headers.map(inferGradeColumn), rows });
  }
  if (!result.sheets.length) throw badRequest('לא נמצאה שורת כותרות עם מספר אישי או שם מלא. אפשר להשתמש גם בשם פרטי ושם משפחה.');
  return result;
}

const column = z.enum(['', ...Object.keys(GRADE_COLUMN_LABELS)] as [GradeColumn, ...GradeColumn[]]);
const sourceSchema = z.object({
  filename: z.string().max(255),
  name: z.string().max(120),
  headers: z.array(z.string().max(120)).max(64),
  mapping: z.array(column).max(64),
  rows: z.array(z.object({ line: z.number().int().positive(), values: z.array(z.string().max(120)).max(64) })).max(GRADE_IMPORT_LIMIT),
});
const previewSchema = z.object({ sources: z.array(sourceSchema).min(1).max(50), overwrite: z.boolean().default(false) });

function gradeValue(field: GradeField, raw: string): string | number {
  const text = raw.trim();
  if (EXAM_TEXT_FIELDS.includes(field)) {
    if (!/^\d{1,3}:[0-5]\d$/.test(text)) throw badRequest('זמן ריצה צריך להיות בדקות ושניות, למשל 12:30');
    return text;
  }
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) throw badRequest('נדרש ציון מספרי');
  const n = Number(text.replace(',', '.'));
  const reps = field.toLowerCase().endsWith('pushups');
  if (n > (reps ? 1000 : 100) || (reps && !Number.isInteger(n))) throw badRequest(reps ? 'נדרש מספר חזרות שלם בין 0 ל-1000' : 'הציון צריך להיות בין 0 ל-100');
  return n;
}

/** Matching is exact and scoped to the caller. An unknown supplied number never falls back to a name. */
export function previewGrades(actor: UserRow, raw: unknown): GradePreview {
  const { sources, overwrite } = previewSchema.parse(raw);
  if (sources.reduce((n, s) => n + s.rows.length, 0) > GRADE_IMPORT_LIMIT) throw badRequest(`ניתן לייבא עד ${GRADE_IMPORT_LIMIT} שורות בכל סבב`);
  const cadets = examImportCadets(actor);
  type Cadet = (typeof cadets)[number];
  const byNumber = new Map<string, Cadet[]>(),
    byName = new Map<string, Cadet[]>();
  for (const c of cadets) {
    const pn = personalKey(c.personalNumber),
      name = gradeKey(c.fullName);
    if (pn) byNumber.set(pn, [...(byNumber.get(pn) ?? []), c]);
    byName.set(name, [...(byName.get(name) ?? []), c]);
  }
  const out: GradePreview = { rows: [], writes: [], summary: { cadets: 0, grades: 0, issues: 0, kept: 0, unchanged: 0, empty: 0 } };
  const seen = new Map<string, GradePreviewRow[]>();
  for (const source of sources) {
    const mapped = source.mapping.filter(Boolean);
    if (new Set(mapped).size !== mapped.length) throw badRequest(`${source.name}: יותר מעמודה אחת משויכת לאותו שדה`);
    if (!mapped.includes('personalNumber') && !mapped.includes('fullName') && !(mapped.includes('firstName') && mapped.includes('lastName')))
      throw badRequest(`${source.name}: יש לשייך מספר אישי או שם מלא`);
    const fields = source.mapping.flatMap((f, i) => (EXAM_FIELDS.includes(f as GradeField) ? [{ field: f as GradeField, i }] : []));
    if (!fields.length) throw badRequest(`${source.name}: יש לשייך לפחות עמודת ציונים אחת`);
    const at = (values: string[], key: GradeColumn) => (values[source.mapping.indexOf(key)] ?? '').trim();
    for (const row of source.rows) {
      const values = fields.filter(({ i }) => row.values[i]?.trim());
      if (!values.length) {
        out.summary.empty++;
        continue;
      }
      const name = at(row.values, 'fullName') || `${at(row.values, 'firstName')} ${at(row.values, 'lastName')}`.trim();
      const pn = personalKey(at(row.values, 'personalNumber'));
      const r: GradePreviewRow = { source: `${source.filename} / ${source.name}`, line: row.line, name, personalNumber: pn, cells: [] };
      out.rows.push(r);
      const matches = pn ? byNumber.get(pn) : byName.get(gradeKey(name));
      if (!matches?.length) {
        r.issue = 'לא נמצא צוער תואם בתיקים שבאחריותך';
        continue;
      }
      if (matches.length !== 1) {
        r.issue = 'נמצאה יותר מהתאמה אחת. נדרש מספר אישי ייחודי';
        continue;
      }
      const c = matches[0];
      if (pn && name && gradeKey(name) !== gradeKey(c.fullName)) {
        r.issue = 'המספר האישי תואם, אך השם שונה. בדקו את פרטי הצוער בקובץ';
        continue;
      }
      r.cadetId = c.id;
      r.name = c.fullName;
      r.teamName = c.teamName;
      r.matchedBy = pn ? 'number' : 'name';
      for (const { field, i } of values) {
        const key = `${c.id}:${field}`;
        seen.set(key, [...(seen.get(key) ?? []), r]);
        try {
          const value = gradeValue(field, row.values[i]);
          const before = c.exams[field] ?? null;
          r.cells.push({ field, value, before, status: before === value ? 'same' : before === null ? 'new' : overwrite ? 'replace' : 'keep' });
        } catch (e) {
          r.issue = `${GRADE_COLUMN_LABELS[field]}: ${(e as Error).message}`;
        }
      }
    }
  }
  // Both conflicting rows are excluded; upload order must never choose the winning grade.
  for (const rows of seen.values()) if (rows.length > 1) for (const row of rows) row.issue = 'אותו צוער ואותו ציון מופיעים יותר מפעם אחת בקבצים. הסירו את הכפילות';
  const writes = new Map<number, GradeWrite>();
  for (const row of out.rows) {
    if (row.issue) {
      out.summary.issues++;
      continue;
    }
    for (const c of row.cells) {
      if (c.status === 'keep') {
        out.summary.kept++;
        continue;
      }
      if (c.status === 'same') {
        out.summary.unchanged++;
        continue;
      }
      const w = writes.get(row.cadetId!) ?? { cadetId: row.cadetId!, changes: {}, base: {} };
      Object.assign(w.changes, { [c.field]: c.value });
      Object.assign(w.base, { [c.field]: c.before });
      writes.set(w.cadetId, w);
      out.summary.grades++;
    }
  }
  out.writes = [...writes.values()];
  out.summary.cadets = writes.size;
  return out;
}

const grade = z.union([z.number().finite(), z.string().max(40), z.null()]);
const applySchema = z.object({
  writes: z
    .array(
      z.object({
        cadetId: z.number().int().positive(),
        changes: z.record(z.string(), grade),
        base: z.record(z.string(), grade),
      }),
    )
    .min(1)
    .max(GRADE_IMPORT_LIMIT),
});

/** Every row is permission-checked again; a stale preview rolls the entire batch back. */
export function applyGrades(actor: UserRow, raw: unknown): { cadets: number; grades: number } {
  const { writes } = applySchema.parse(raw);
  if (new Set(writes.map((w) => w.cadetId)).size !== writes.length) throw badRequest('צוער מופיע יותר מפעם אחת בבקשת השמירה');
  let grades = 0;
  db().tx(() => {
    for (const w of writes) {
      const fields = Object.keys(w.changes);
      if (
        !fields.length ||
        fields.some(
          (f) => !EXAM_FIELDS.includes(f as GradeField) || !Object.hasOwn(w.base, f) || w.changes[f] === null || (typeof w.changes[f] === 'string' && !w.changes[f].trim()),
        )
      )
        throw badRequest('בקשת הייבוא אינה תקינה. צרו תצוגה מקדימה חדשה');
      updateEvaluationFields(actor, w.cadetId, w, false);
      grades += fields.length;
    }
    logActivity({ userId: actor.id, action: 'evaluation_import', text: `${actor.display_name} ייבא ${grades} ציונים ל-${writes.length} תיקי הערכה` });
    changed('cadets');
  });
  return { cadets: writes.length, grades };
}

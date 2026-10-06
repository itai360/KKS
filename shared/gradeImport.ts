import { EVALUATION_FIELDS, EXAM_FIELDS } from './evaluation';
import type { EvaluationExams } from './types';

export type GradeField = keyof EvaluationExams;
export type GradeColumn = GradeField | 'personalNumber' | 'firstName' | 'lastName' | 'fullName' | '';
export const GRADE_IMPORT_LIMIT = 2000;
export const GRADE_COLUMN_LABELS: Record<Exclude<GradeColumn, ''>, string> = {
  personalNumber: 'מספר אישי',
  firstName: 'שם פרטי',
  lastName: 'שם משפחה',
  fullName: 'שם מלא',
  ...Object.fromEntries(EXAM_FIELDS.map((f) => [f, EVALUATION_FIELDS[f].label])),
} as Record<Exclude<GradeColumn, ''>, string>;

export const gradeKey = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, '')
    .replace(/["'״׳.־–-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
export const personalKey = (s: string) => s.trim().replace(/\.0+$/, '');
const aliases: Record<string, GradeColumn> = {
  מא: 'personalNumber',
  'שם הצוער': 'fullName',
  שם: 'fullName',
  'כשג פתיחה': 'fitBaseTotal',
  'כשג סף': 'fitBaseTotal',
  'כשג אמצע': 'fitMidTotal',
  'כשג סוף': 'fitEndTotal',
  'ציון מקראות': 'readingsA',
  'מבחן 1': 'midA',
  'מבחן מסכם': 'finalA',
  'ציון סופי': 'courseGrade',
};
export function inferGradeColumn(header: string): GradeColumn {
  const key = gradeKey(header);
  return aliases[key] ?? (Object.entries(GRADE_COLUMN_LABELS).find(([, label]) => gradeKey(label) === key)?.[0] as GradeColumn | undefined) ?? '';
}

export interface GradeSheet {
  name: string;
  headers: string[];
  mapping: GradeColumn[];
  rows: { line: number; values: string[] }[];
}
export interface GradeSource extends GradeSheet {
  filename: string;
}
export interface GradeUpload {
  sheets: GradeSheet[];
  skippedSheets: string[];
}
export interface GradeWrite {
  cadetId: number;
  changes: Partial<EvaluationExams>;
  base: Partial<EvaluationExams>;
}
export interface GradePreviewRow {
  source: string;
  line: number;
  name: string;
  personalNumber: string;
  cadetId?: number;
  teamName?: string | null;
  matchedBy?: 'number' | 'name';
  issue?: string;
  cells: { field: GradeField; value: string | number; before: string | number | null; status: 'new' | 'replace' | 'keep' | 'same' }[];
}
export interface GradePreview {
  rows: GradePreviewRow[];
  writes: GradeWrite[];
  summary: { cadets: number; grades: number; issues: number; kept: number; unchanged: number; empty: number };
}

// The evaluation file's parts and fields in words: the screen, the history and the server's
// messages name them the same way.

import type { EvaluationExams, EvaluationField, ExamTest } from './types';

/** the heading of the file's first table */
export const EVALUATION_TITLE = 'קורס קציני סייבר';

export const EVALUATION_SECTIONS = {
  general: 'פרטים כלליים',
  details: 'פרטי הצוער',
  path: 'מסלול צבאי',
  exams: 'ציוני מבחנים וכושר גופני',
  dynamics: 'הערכות דינמיקה קבוצתית',
  reason: 'סיבת העלאה לוועדה',
  notes: 'התייחסויות המפק"צ לצוער',
  points: 'נקודות ואירועים קריטיים',
  summary: 'סיכום המ"פ',
  standing: 'מצב בתיק',
} as const;
export type EvaluationSection = keyof typeof EVALUATION_SECTIONS;

export const EVALUATION_FIELDS: Record<EvaluationField, { label: string; section: EvaluationSection }> = {
  companyCommander: { label: 'שם המ"פ', section: 'general' },
  teamCommander: { label: 'שם המפק"צ', section: 'general' },
  firstName: { label: 'שם פרטי', section: 'details' },
  lastName: { label: 'שם משפחה', section: 'details' },
  personalNumber: { label: 'מספר אישי', section: 'details' },
  unit: { label: 'מערך', section: 'details' },
  city: { label: 'עיר מגורים', section: 'details' },
  enlistedOn: { label: 'תאריך גיוס', section: 'details' },
  releaseOn: { label: 'תאריך שחרור', section: 'details' },
  militaryPath: { label: 'מסלול צבאי', section: 'path' },
  runResult: { label: 'כושר גופני סף - תוצאת ריצה', section: 'exams' },
  runScore: { label: 'כושר גופני סף - ציון ריצה', section: 'exams' },
  pushups: { label: 'כושר גופני סף - שכיבות סמיכה (חזרות)', section: 'exams' },
  pushupsScore: { label: 'כושר גופני סף - ציון שכיבות סמיכה', section: 'exams' },
  fitBaseScore: { label: 'כושר גופני סף - ציון כש"ג', section: 'exams' },
  readingsA: { label: 'מבחן מקראות - מועד א׳', section: 'exams' },
  readingsB: { label: 'מבחן מקראות - מועד ב׳', section: 'exams' },
  midRunResult: { label: 'כושר גופני אמצע - תוצאת ריצה', section: 'exams' },
  midRunScore: { label: 'כושר גופני אמצע - ציון ריצה', section: 'exams' },
  midPushups: { label: 'כושר גופני אמצע - שכיבות סמיכה (חזרות)', section: 'exams' },
  midPushupsScore: { label: 'כושר גופני אמצע - ציון שכיבות סמיכה', section: 'exams' },
  midFitScore: { label: 'כושר גופני אמצע - ציון כש"ג', section: 'exams' },
  midA: { label: 'מבחן אמצע - מועד א׳', section: 'exams' },
  midB: { label: 'מבחן אמצע - מועד ב׳', section: 'exams' },
  endRunResult: { label: 'כושר גופני סוף - תוצאת ריצה', section: 'exams' },
  endRunScore: { label: 'כושר גופני סוף - ציון ריצה', section: 'exams' },
  endPushups: { label: 'כושר גופני סוף - שכיבות סמיכה (חזרות)', section: 'exams' },
  endPushupsScore: { label: 'כושר גופני סוף - ציון שכיבות סמיכה', section: 'exams' },
  endFitScore: { label: 'כושר גופני סוף - ציון כש"ג', section: 'exams' },
  finalA: { label: 'מבחן סוף - מועד א׳', section: 'exams' },
  finalB: { label: 'מבחן סוף - מועד ב׳', section: 'exams' },
  committeeReason: { label: 'סיבת העלאה לוועדה', section: 'reason' },
  summary: { label: 'סיכום המ"פ', section: 'summary' },
  standing: { label: 'מצב בתיק', section: 'standing' },
};

type ExamKey = keyof EvaluationExams;
/**
 * The exams and fitness tests, in the order of the course. A fitness test has a run (result,
 * score) and push-ups (repetitions, score); an exam has a first and a second date. The threshold
 * fitness test and the readings exam are in every file; the rest are added for the whole course
 * when it reaches them.
 */
export const EXAM_TESTS: Record<ExamTest, { label: string; always: boolean } & ({ kind: 'fitness'; fields: [run: ExamKey, runScore: ExamKey, pushups: ExamKey, pushupsScore: ExamKey, total: ExamKey] } | { kind: 'exam'; fields: [a: ExamKey, b: ExamKey] })> = {
  fitBase: { label: 'כושר גופני סף', always: true, kind: 'fitness', fields: ['runResult', 'runScore', 'pushups', 'pushupsScore', 'fitBaseScore'] },
  readings: { label: 'מבחן מקראות', always: true, kind: 'exam', fields: ['readingsA', 'readingsB'] },
  fitMid: { label: 'כושר גופני אמצע', always: false, kind: 'fitness', fields: ['midRunResult', 'midRunScore', 'midPushups', 'midPushupsScore', 'midFitScore'] },
  midExam: { label: 'מבחן אמצע', always: false, kind: 'exam', fields: ['midA', 'midB'] },
  fitEnd: { label: 'כושר גופני סוף', always: false, kind: 'fitness', fields: ['endRunResult', 'endRunScore', 'endPushups', 'endPushupsScore', 'endFitScore'] },
  finalExam: { label: 'מבחן סוף', always: false, kind: 'exam', fields: ['finalA', 'finalB'] },
};
export const TEST_ORDER: ExamTest[] = ['fitBase', 'readings', 'fitMid', 'midExam', 'fitEnd', 'finalExam'];
export const EXAM_FIELDS: ExamKey[] = TEST_ORDER.flatMap((t) => EXAM_TESTS[t].fields);
/** fields whose value is free text (a run time); the rest are numbers */
export const EXAM_TEXT_FIELDS: ExamKey[] = ['runResult', 'midRunResult', 'endRunResult'];
/** fields that count repetitions; every other number is a score of 0-100 */
export const EXAM_REPS_FIELDS: ExamKey[] = ['pushups', 'midPushups', 'endPushups'];
/** the score fields a grade sheet column can fill */
export const EXAM_SCORE_FIELDS: ExamKey[] = EXAM_FIELDS.filter((k) => !EXAM_TEXT_FIELDS.includes(k) && !EXAM_REPS_FIELDS.includes(k));
/** the test a field belongs to */
export const testOf = (k: ExamKey): ExamTest => TEST_ORDER.find((t) => (EXAM_TESTS[t].fields as readonly ExamKey[]).includes(k))!;

/**
 * Grade sheet columns (גליון הציונים) that fill a field of the file, by their header. Any other
 * column of numbers becomes one of the course's other grades, named as in the sheet.
 */
export const GRADE_SHEET_COLUMNS: Partial<Record<ExamKey, string[]>> = {
  fitBaseScore: ['כש"ג פתיחה', 'כש"ג סף', 'ציון כש"ג פתיחה', 'כושר גופני סף', 'כושר פתיחה'],
  midFitScore: ['כש"ג אמצע', 'ציון כש"ג אמצע', 'כושר גופני אמצע', 'כושר אמצע'],
  endFitScore: ['כש"ג סוף', 'כש"ג סיום', 'ציון כש"ג סוף', 'כושר גופני סוף', 'כושר סוף'],
  readingsA: ['ציון מקראות', 'מקראות', 'מבחן מקראות'],
  midA: ['מבחן 1', 'מבחן אמצע', 'ציון מבחן 1', 'ציון מבחן אמצע'],
  finalA: ['מבחן מסכם', 'מבחן סוף', 'ציון מבחן מסכם', 'ציון מבחן סוף'],
};

const entered = (v: unknown) => v !== null && v !== undefined && v !== '';
/** the tests a file shows: those always there, those the course added, and any that has a value */
export function shownTests(added: readonly string[], exams: Partial<EvaluationExams>): ExamTest[] {
  return TEST_ORDER.filter((t) => EXAM_TESTS[t].always || added.includes(t) || EXAM_TESTS[t].fields.some((f) => entered(exams[f])));
}
/** how many of the shown tests' fields are entered, of how many */
export function examsEntered(tests: readonly ExamTest[], exams: Partial<EvaluationExams>): { entered: number; total: number } {
  const fields = tests.flatMap((t) => EXAM_TESTS[t].fields);
  return { entered: fields.filter((f) => entered(exams[f])).length, total: fields.length };
}

/** what a field that was never filled in says */
export const NOT_ENTERED = 'טרם הוזן';

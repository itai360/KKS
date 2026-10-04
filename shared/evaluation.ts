// The evaluation file's parts and fields in words: the screen, the history and the server's
// messages name them the same way.

import type { EvaluationExams, EvaluationField } from './types';

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
  midA: { label: 'מבחן אמצע - מועד א׳', section: 'exams' },
  midB: { label: 'מבחן אמצע - מועד ב׳', section: 'exams' },
  finalA: { label: 'מבחן סוף - מועד א׳', section: 'exams' },
  finalB: { label: 'מבחן סוף - מועד ב׳', section: 'exams' },
  runResult: { label: 'ריצה - תוצאה', section: 'exams' },
  runScore: { label: 'ריצה - ציון', section: 'exams' },
  pushups: { label: 'שכיבות סמיכה - חזרות', section: 'exams' },
  pushupsScore: { label: 'שכיבות סמיכה - ציון', section: 'exams' },
  committeeReason: { label: 'סיבת העלאה לוועדה', section: 'reason' },
  summary: { label: 'סיכום המ"פ', section: 'summary' },
  standing: { label: 'מצב בתיק', section: 'standing' },
};

export const EXAM_FIELDS: (keyof EvaluationExams)[] = ['midA', 'midB', 'finalA', 'finalB', 'runResult', 'runScore', 'pushups', 'pushupsScore'];

/** what a field that was never filled in says */
export const NOT_ENTERED = 'טרם הוזן';

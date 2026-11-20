// The staff's checklist for each cadet (server/src/staffChecks.ts): what a team commander does with each of their
// cadets through the course - a square each, marked once it happened. The assignment's check needs its grade: it
// goes into the cadet's evaluation file and into the course's grade sheet in Google (gradeSheet.ts).

export interface StaffCheckItem {
  key: string;
  label: string;
  /** marked with a grade: the grade's name in the evaluation file, and the column it goes in in the grade sheet */
  grade?: { item: string; column: string };
}

export const STAFF_CHECK_ITEMS: StaffCheckItem[] = [
  { key: 'opening_talk', label: 'שיחת פתיחה' },
  { key: 'experience_plan', label: 'א.ת התנסות' },
  { key: 'experience_feedback', label: 'משוב לאחר התנסות' },
  { key: 'sifra_assignment', label: 'בדיקת מטלה ספרא וסייפא', grade: { item: 'ציון ספרא סייפא', column: 'ציון ספרא סייפא' } },
  { key: 'mid_socio', label: 'הורדת סוציומטרי אמצע' },
  { key: 'mid_feedback_written', label: 'כתבתי משוב אמצע' },
  { key: 'mid_feedback', label: 'הורדת משוב אמצע' },
  { key: 'end_socio', label: 'הורדת סוציומטרי סוף' },
  { key: 'end_feedback_written', label: 'כתבתי משוב סוף' },
  { key: 'end_feedback', label: 'הורדת משוב סוף' },
];

export const staffCheckItem = (key: string) => STAFF_CHECK_ITEMS.find((i) => i.key === key) ?? null;

// Shared domain vocabulary for client and server. Lists of choices are kept in alphabetical order
// (shared/test/sort.test.ts), the catch-all "אחר" last; scales and sequences keep their own order.

import { sortHe } from './sort';

export const ROLES = ['commander', 'staff'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  commander: 'מפקד הקורס',
  staff: 'איש סגל',
};

export const STATUSES = ['todo', 'in_progress', 'waiting', 'pending_approval', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'לביצוע',
  in_progress: 'בטיפול',
  waiting: 'ממתין',
  pending_approval: 'ממתין לאישור',
  done: 'הושלם',
  cancelled: 'בוטל',
};
export const OPEN_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'waiting', 'pending_approval'];
export const CLOSED_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];
export function isOpenStatus(s: TaskStatus): boolean {
  return s !== 'done' && s !== 'cancelled';
}

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'נמוכה',
  normal: 'רגילה',
  high: 'גבוהה',
  critical: 'קריטית',
};
export const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, critical: 3 };

/** areas added later - a course that already keeps its own list gets them too (migration 19) */
export const ADDED_DOMAINS = ['חינוך', 'אקדמיה', 'אימון גופני', 'שטח', 'ניווטים', 'דת', 'רכב'];

/** the area chosen when none fits - with a few words saying what it is */
export const OTHER_DOMAIN = 'אחר';

/** "אחר: תקשוב" - the area as shown, with its detail when it is "other" */
export function domainLabel(domain: string, note?: string | null): string {
  return domain === OTHER_DOMAIN && note ? `${domain}: ${note}` : domain;
}

export const DEFAULT_DOMAINS = [...sortHe(['בטיחות', 'הדרכה', 'הערכה', 'לו"ז', 'לוגיסטיקה', 'משמעת', 'פרט', 'צוערים', 'תיאומים', ...ADDED_DOMAINS]), 'אחר'];

/** the course's tracks (צירים בקורס) - each with a lead and its tasks, alongside the weeks; a course can add its own */
export const COURSE_TRACKS = sortHe(['חינוך', 'אקדמיה', 'אימון גופני', 'שטח', 'ניווטים', 'דת', 'רכב', 'מסע פתיחה', 'מארס טורקי', 'תרגיל מסכם']);

export const VISIBILITIES = ['normal', 'team', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  normal: 'רגילה - אחראים, יוצר ומפק"צ השבוע',
  team: 'כללית - גלויה לכל הסגל',
  private: 'מוגבלת - אחראים ומפקד בלבד',
};

// Section 43 - a blocked task must carry a reason.
export const BLOCK_REASONS = [
  'חסר כוח אדם',
  'חסר ציוד',
  'חסרה החלטת מפקד',
  'ממתין לאישור',
  'ממתין לתשובת גורם חיצוני',
  'תלוי במשימה אחרת',
  'אחר',
] as const;

// Section 61 - what the owner says when a task becomes overdue.
export const OVERDUE_RESPONSES = ['today', 'new_deadline', 'blocked', 'decision'] as const;
export type OverdueResponse = (typeof OVERDUE_RESPONSES)[number];
export const OVERDUE_RESPONSE_LABELS: Record<OverdueResponse, string> = {
  today: 'צפוי להסתיים היום',
  new_deadline: 'נדרש דד-ליין חדש',
  blocked: 'קיים חסם',
  decision: 'נדרשת החלטת מפקד',
};

export const WEEK_STATUSES = ['planning', 'open', 'closed'] as const;
export type WeekStatus = (typeof WEEK_STATUSES)[number];
export const WEEK_STATUS_LABELS: Record<WeekStatus, string> = {
  planning: 'בתכנון',
  open: 'פתוח',
  closed: 'נסגר',
};

export const LESSON_KINDS = ['good', 'bad', 'change'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];
export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  good: 'מה עבד טוב',
  bad: 'מה לא עבד',
  change: 'מה צריך לשנות',
};

export const REQUEST_TYPES = ['deadline', 'transfer'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  deadline: 'בקשת שינוי דד-ליין',
  transfer: 'בקשת העברת אחריות',
};

export const NOTIFICATION_CATEGORIES = ['action', 'info', 'exception'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  action: 'דורש ממני פעולה',
  info: 'מידע',
  exception: 'חריגות',
};

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

// Week closing - what happens to an unfinished task (section 55).
export const CARRY_ACTIONS = ['keep', 'move', 'cancel'] as const;
export type CarryAction = (typeof CARRY_ACTIONS)[number];
export const CARRY_ACTION_LABELS: Record<CarryAction, string> = {
  keep: 'נשארת באיחור',
  move: 'עוברת לשבוע הבא',
  cancel: 'מבוטלת',
};

// Section 18 - tag colors.
export type Tone = 'red' | 'orange' | 'yellow' | 'green' | 'gray' | 'blue' | 'purple';

// ---------------- Version 3 (section 31) ----------------

export const CADET_STATUSES = ['active', 'dropped', 'graduated'] as const;
export type CadetStatus = (typeof CADET_STATUSES)[number];
export const CADET_STATUS_LABELS: Record<CadetStatus, string> = {
  active: 'פעיל',
  dropped: 'הודח / פרש',
  graduated: 'סיים',
};
export const CADET_STATUS_TONES: Record<CadetStatus, Tone> = { active: 'green', dropped: 'red', graduated: 'blue' };

export const RECORD_KINDS = ['note', 'talk', 'discipline', 'evaluation'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const RECORD_KIND_LABELS: Record<RecordKind, string> = {
  note: 'הערה',
  talk: 'שיחה אישית',
  discipline: 'משמעת',
  evaluation: 'הערכה',
};
/** Personal talks and discipline are always restricted to the author, the team commander and the course commander. */
export const RESTRICTED_RECORD_KINDS: readonly RecordKind[] = ['talk', 'discipline'];

export const EVALUATION_CRITERIA = ['יוזמה', 'כושר גופני', 'מקצועיות', 'עבודת צוות', 'ערכים ודוגמה אישית', 'פיקוד והובלה'] as const;
export const DISCIPLINE_SEVERITIES = ['קלה', 'בינונית', 'חמורה'] as const;
/** A cadet who gets this many discipline notes (הערות משמעת) goes to an evaluation committee. */
export const DISCIPLINE_NOTE_LIMIT = 3;
export const DISCIPLINE_COMMITTEE_KIND = 'ועדת הערכה';
/** "ועדת הערכה" -> "לוועדת הערכה": after the prefix the vav doubles */
export const committeeTo = (name: string) => `ל${name.startsWith('ו') && !name.startsWith('וו') ? `ו${name}` : name}`;
export const TALK_TYPES = ['שיחה יזומה', 'שיחת אמצע', 'שיחת היכרות', 'שיחת משוב', 'שיחת סיום'] as const;
/** the talks in the order the course holds them (TALK_TYPES is alphabetical, for choosing) */
export const TALK_COURSE_ORDER: readonly (typeof TALK_TYPES)[number][] = ['שיחת היכרות', 'שיחת אמצע', 'שיחת משוב', 'שיחה יזומה', 'שיחת סיום'];

// ---------------- evaluation files (תיקי הערכה) ----------------

export const STANDINGS = ['ok', 'watch', 'risk'] as const;
export type Standing = (typeof STANDINGS)[number];
export const STANDING_LABELS: Record<Standing, string> = { ok: 'תקין', watch: 'במעקב', risk: 'בסיכון' };
export const STANDING_TONES: Record<Standing, string> = { ok: 'green', watch: 'yellow', risk: 'red' };

export const EVAL_TONES = ['positive', 'improve', 'exception'] as const;
export type EvalTone = (typeof EVAL_TONES)[number];
export const EVAL_TONE_LABELS: Record<EvalTone, string> = { positive: 'לשבח', improve: 'לשיפור', exception: 'חריג' };
export const EVAL_TONE_TONES: Record<EvalTone, string> = { positive: 'green', improve: 'orange', exception: 'red' };

/** What an evaluation entry is about: the evaluation criteria, conduct, and anything else. */
export const EVAL_CATEGORIES = [...EVALUATION_CRITERIA, 'משמעת והתנהגות', 'אחר'] as const;

export const COMMITTEE_KINDS = ['ועדת הדחה', 'ועדת הערכה', 'ועדת חריגים', 'ועדת מעבר שלב', 'ועדת סיום', 'אחר'] as const;
export const COMMITTEE_DECISIONS = ['dismissed', 'continue', 'conditional', 'other'] as const;
export type CommitteeDecision = (typeof COMMITTEE_DECISIONS)[number];
export const COMMITTEE_DECISION_LABELS: Record<CommitteeDecision, string> = {
  continue: 'ממשיך בקורס',
  conditional: 'ממשיך בתנאים / במעקב',
  dismissed: 'הודח מהקורס',
  other: 'אחר',
};

export const DEBRIEF_ITEM_KINDS = ['fact', 'finding', 'conclusion', 'lesson'] as const;
export type DebriefItemKind = (typeof DEBRIEF_ITEM_KINDS)[number];
export const DEBRIEF_ITEM_LABELS: Record<DebriefItemKind, string> = {
  fact: 'עובדות',
  finding: 'ממצאים',
  conclusion: 'מסקנות',
  lesson: 'לקחים',
};

export const DOCUMENT_CATEGORIES = ['חומרי הדרכה', 'מצגות', 'נהלים', 'פקודות', 'קישורים', 'אחר'] as const;

/** why someone on the staff is away (section: availability) */
export const ABSENCE_REASONS = ['course', 'leave', 'sick', 'duty', 'other'] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];
export const ABSENCE_REASON_LABELS: Record<AbsenceReason, string> = {
  leave: 'חופשה',
  sick: 'מחלה',
  course: 'השתלמות',
  duty: 'מילואים / תורנות',
  other: 'היעדרות',
};

/** the daily roll call (מצבה): where each cadet is today */
export const ATTENDANCE_STATUSES = ['present', 'late', 'sick', 'leave', 'appointment', 'absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'נוכח',
  late: 'איחור',
  sick: 'גימלים',
  leave: 'בית / חופשה',
  appointment: 'תור / בדיקה',
  absent: 'נעדר',
};
export const ATTENDANCE_TONES: Record<AttendanceStatus, Tone> = { present: 'green', late: 'yellow', sick: 'orange', leave: 'blue', appointment: 'purple', absent: 'red' };
/** counted as in the course today (for the head count) */
export const ATTENDANCE_IN: readonly AttendanceStatus[] = ['present', 'late'];

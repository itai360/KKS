// Shared domain vocabulary for client and server.

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

export const DEFAULT_DOMAINS = [
  'הדרכה',
  'בטיחות',
  'לוגיסטיקה',
  'משמעת',
  'פרט',
  'לו"ז',
  'תיאומים',
  'צוערים',
  'הערכה',
  'אחר',
];

export const VISIBILITIES = ['normal', 'team', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  normal: 'רגילה - אחראים, יוצר ומפק"צ השבוע',
  team: 'כללית - גלויה לכל הסגל',
  private: 'מוגבלת - אחראים ומפקד בלבד',
};

// Section 43 - a blocked task must carry a reason.
export const BLOCK_REASONS = [
  'ממתין לאישור',
  'ממתין לתשובת גורם חיצוני',
  'חסר ציוד',
  'חסר כוח אדם',
  'חסרה החלטת מפקד',
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

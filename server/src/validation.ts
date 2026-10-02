// A refused form says in Hebrew which field and what is wrong with it - never
// "Too big: expected string to have <=200 characters" or an English field name.

import type { ZodError } from 'zod';

const LABELS: Record<string, string> = {
  title: 'הכותרת',
  name: 'השם',
  description: 'התיאור',
  body: 'הטקסט',
  notes: 'ההערות',
  firstName: 'השם הפרטי',
  lastName: 'שם המשפחה',
  personalNumber: 'המספר האישי',
  phone: 'הטלפון',
  email: 'כתובת המייל',
  displayName: 'השם',
  username: 'שם המשתמש',
  password: 'הסיסמה',
  current: 'הסיסמה הנוכחית',
  next: 'הסיסמה החדשה',
  deadline: 'הדד-ליין',
  date: 'התאריך',
  occurredOn: 'התאריך',
  startDate: 'תאריך ההתחלה',
  endDate: 'תאריך הסיום',
  startTime: 'שעת ההתחלה',
  endTime: 'שעת הסיום',
  until: 'תאריך הסיום',
  location: 'המיקום',
  summary: 'התיאור',
  participants: 'המשתתפים',
  topic: 'הנושא',
  goals: 'המטרות',
  reason: 'הסיבה',
  details: 'הפירוט',
  subject: 'הנושא',
  url: 'הקישור',
  category: 'הקטגוריה',
  domain: 'התחום',
  followUp: 'צעדי ההמשך',
  offense: 'המקרה',
  courseName: 'שם הקורס',
  courseSymbol: 'סמל הקורס',
  text: 'הטקסט',
  decision: 'ההחלטה',
  strengths: 'החוזקות',
  improvements: 'הנקודות לשיפור',
  feedback: 'המשוב',
  role: 'התפקיד',
  priority: 'העדיפות',
  status: 'הסטטוס',
  score: 'הציון',
  ownerIds: 'האחראים',
  links: 'הקישורים',
};

export function zodMessage(e: ZodError): string {
  const issue = e.issues[0];
  if (!issue) return 'נתונים לא תקינים';
  // a message written in Hebrew in the schema says it best
  if (/[֐-׿]/.test(issue.message)) return issue.message;
  const key = [...issue.path].reverse().find((p) => typeof p === 'string') as string | undefined;
  const label = (key && LABELS[key]) || 'אחד השדות';
  const i = issue as typeof issue & { origin?: string; maximum?: number | bigint; minimum?: number | bigint; format?: string };
  switch (issue.code) {
    case 'too_big':
      if (i.origin === 'string') return `${label} - אפשר עד ${i.maximum} תווים`;
      if (i.origin === 'array' || i.origin === 'set') return `${label} - אפשר עד ${i.maximum} פריטים`;
      return `${label} - הערך המרבי הוא ${i.maximum}`;
    case 'too_small':
      if (i.origin === 'string') return Number(i.minimum) <= 1 ? `${label} - חובה למלא` : `${label} - לפחות ${i.minimum} תווים`;
      if (i.origin === 'array' || i.origin === 'set') return `${label} - חובה לבחור לפחות ${Number(i.minimum) <= 1 ? 'אחד' : i.minimum}`;
      return `${label} - הערך המזערי הוא ${i.minimum}`;
    case 'invalid_type':
      return /received undefined/.test(issue.message) ? `${label} - חובה למלא` : `${label} - ערך לא תקין`;
    case 'invalid_format':
      if (i.format === 'email') return 'כתובת המייל לא תקינה';
      if (i.format === 'url') return 'הקישור לא תקין';
      return `${label} - ערך לא תקין`;
    default:
      return `${label} - ערך לא תקין`;
  }
}

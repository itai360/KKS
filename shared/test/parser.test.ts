import { describe, expect, it } from 'vitest';
import { zonedIso } from '../dates';
import { parseTaskText } from '../parser';

const TZ = 'Asia/Jerusalem';
// Thursday 1.10.2026, 10:00
const now = new Date(zonedIso('2026-10-01', '10:00', TZ));
const users = [
  { id: 1, displayName: 'מפקד הקורס', title: 'מפקד הקורס' },
  { id: 2, displayName: 'מפק"צ 1', title: '' },
  { id: 3, displayName: 'מפק"צ 2', title: '' },
  { id: 4, displayName: 'מפק"צ 3', title: '' },
  { id: 5, displayName: 'מפק"צ 4', title: '' },
  { id: 12, displayName: 'מפק"צ 12', title: '' },
  { id: 20, displayName: 'נועה לוי', title: 'מפק"צ 5' },
];
const weeks = [
  { id: 30, name: 'שבוע התקפה' },
  { id: 31, name: 'שבוע הגנה' },
];
const ctx = { users, weeks, now, tz: TZ, defaultTime: '18:00' };

describe('parseTaskText', () => {
  it('parses the spec example (section 27)', () => {
    const r = parseTaskText('תפתח למפק"צ 2 משימה לסגור את המטווח עד יום רביעי בשעה 18:00 בעדיפות גבוהה', ctx);
    expect(r.title).toBe('סגירת מטווח');
    expect(r.ownerIds).toEqual([3]);
    expect(r.priority).toBe('high');
    expect(r.deadline).toBe(zonedIso('2026-10-07', '18:00', TZ));
    expect(r.missing).toEqual([]);
  });

  it('accepts Hebrew gershayim and quote-less names', () => {
    expect(parseTaskText('תפתח למפק״צ 2 משימה לבדוק ציוד מחר', ctx).ownerIds).toEqual([3]);
    expect(parseTaskText('מפקצ 2 לבדוק ציוד מחר', ctx).ownerIds).toEqual([3]);
  });

  it('does not confuse מפק"צ 1 with מפק"צ 12', () => {
    expect(parseTaskText('מפק"צ 12 - להכין תיק תרגיל עד מחר', ctx).ownerIds).toEqual([12]);
    expect(parseTaskText('מפק"צ 1 - להכין תיק תרגיל עד מחר', ctx).ownerIds).toEqual([2]);
  });

  it('parses the quick-order example (section 26) and links the week', () => {
    const r = parseTaskText('להכין מסמך לקראת שבוע הגנה עד מחר 12:00.', ctx);
    expect(r.title).toBe('הכנת מסמך לקראת שבוע הגנה');
    expect(r.deadline).toBe(zonedIso('2026-10-02', '12:00', TZ));
    expect(r.weekId).toBe(31);
    expect(r.missing).toEqual(['owner']);
  });

  it('parses a staff-meeting line (section 68)', () => {
    const r = parseTaskText('מפק"צ 4 - לבדוק אפשרות להקדים את המטווח עד מחר ב-10:00.', ctx);
    expect(r.ownerIds).toEqual([5]);
    expect(r.title).toBe('בדיקת אפשרות להקדים את המטווח');
    expect(r.deadline).toBe(zonedIso('2026-10-02', '10:00', TZ));
  });

  it('recognises "all staff" and time-only deadlines', () => {
    const r = parseTaskText('לכל הסגל לעבור על מסמך נהלי הקורס עד 18:00', ctx);
    expect(r.allStaff).toBe(true);
    expect(r.title).toBe('מעבר על מסמך נהלי הקורס');
    expect(r.deadline).toBe(zonedIso('2026-10-01', '18:00', TZ));
  });

  it('time already passed today rolls to tomorrow', () => {
    const r = parseTaskText('מפק"צ 1 לסגור לו"ז עד 08:00', ctx);
    expect(r.deadline).toBe(zonedIso('2026-10-02', '08:00', TZ));
  });

  it('supports several owners (shared task) and explicit dates', () => {
    const r = parseTaskText('מפק"צ 1 ומפק"צ 3 להכין תרגיל מסכם עד 4.10', ctx);
    expect(r.ownerIds).toEqual([2, 4]);
    expect(r.title).toBe('הכנת תרגיל מסכם');
    expect(r.deadline).toBe(zonedIso('2026-10-04', '18:00', TZ));
  });

  it('matches a user by role title as well as by name', () => {
    expect(parseTaskText('למפק"צ 5 לתאם הסעות מחר בבוקר', ctx).ownerIds).toEqual([20]);
    expect(parseTaskText('לנועה לוי לתאם הסעות מחר בבוקר', ctx).ownerIds).toEqual([20]);
    const r = parseTaskText('לנועה לוי לתאם את ההסעות מחר בבוקר', ctx);
    expect(r.title).toBe('תיאום הסעות');
    expect(r.deadline).toBe(zonedIso('2026-10-02', '08:00', TZ));
  });

  it('understands urgency words and relative days', () => {
    const r = parseTaskText('דחוף - מפק"צ 2 לבדוק תחמושת בעוד 3 ימים', ctx);
    expect(r.priority).toBe('high');
    expect(r.deadline).toBe(zonedIso('2026-10-04', '18:00', TZ));
    expect(r.title).toBe('בדיקת תחמושת');
    expect(parseTaskText('מפק"צ 2 לסגור שטח בעדיפות קריטית מחרתיים', ctx).priority).toBe('critical');
  });

  it('end of week means Thursday', () => {
    const r = parseTaskText('מפק"צ 3 לסכם את השבוע עד סוף השבוע', ctx);
    expect(r.deadline).toBe(zonedIso('2026-10-01', '18:00', TZ));
    expect(r.title).toBe('סיכום שבוע');
  });

  it('reports what is missing', () => {
    const r = parseTaskText('לסגור את המטווח', ctx);
    expect(r.title).toBe('סגירת מטווח');
    expect(r.missing).toEqual(['owner', 'deadline']);
  });
});

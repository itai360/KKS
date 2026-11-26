import { describe, expect, it } from 'vitest';
import { zonedIso } from '../dates';
import { parseEventText } from '../eventParser';

const TZ = 'Asia/Jerusalem';
// Thursday 1.10.2026, 10:00
const now = new Date(zonedIso('2026-10-01', '10:00', TZ));
const users = [
  { id: 1, displayName: 'מפקד הקורס', title: 'מפקד הקורס' },
  { id: 2, displayName: 'מפק"צ 1', title: '' },
  { id: 3, displayName: 'מפק"צ 2', title: '' },
  { id: 12, displayName: 'מפק"צ 12', title: '' },
  { id: 20, displayName: 'נועה לוי', title: 'מפק"צ 5' },
];
const ctx = { users, now, tz: TZ, defaultDate: '2026-10-01' };
const parse = (s: string, c: Partial<typeof ctx> = {}) => parseEventText(s, { ...ctx, ...c });

describe('parseEventText', () => {
  it('reads the title, the day, a range of hours and the place', () => {
    expect(parse('מטווח מחר 10-12 @שטח 30')).toEqual({
      title: 'מטווח',
      date: '2026-10-02',
      dateGiven: true,
      startTime: '10:00',
      endTime: '12:00',
      location: 'שטח 30',
      ownerId: null,
    });
  });

  it('reads a weekday, an hour with its part of the day and an owner', () => {
    const r = parse('תדריך בטיחות ביום שלישי ב-8 בבוקר אחראי מפק"צ 2');
    expect(r.title).toBe('תדריך בטיחות');
    // this week's Tuesday has passed: the next one
    expect(r.date).toBe('2026-10-06');
    expect(r.startTime).toBe('08:00');
    expect(r.endTime).toBeNull();
    expect(r.ownerId).toBe(3);
  });

  it('puts an event with no day on the day open in the calendar', () => {
    const r = parse('ישיבת סגל בין 20:00 ל-21:30', { defaultDate: '2026-10-05' });
    expect(r).toMatchObject({ title: 'ישיבת סגל', date: '2026-10-05', dateGiven: false, startTime: '20:00', endTime: '21:30' });
  });

  it('reads the ways a range is written', () => {
    expect(parse('שיעור מ-9 עד 11').startTime).toBe('09:00');
    expect(parse('שיעור מ-9 עד 11').endTime).toBe('11:00');
    expect(parse('שיעור 10:15-11:45')).toMatchObject({ startTime: '10:15', endTime: '11:45', title: 'שיעור' });
    expect(parse('שיעור בשעות 13-15')).toMatchObject({ startTime: '13:00', endTime: '15:00', title: 'שיעור' });
    // "10-2": the end is past noon
    expect(parse('תרגיל 10-2')).toMatchObject({ startTime: '10:00', endTime: '14:00' });
  });

  it('lets the part of the day set the hour', () => {
    expect(parse('שיעור 4-6 אחה"צ')).toMatchObject({ title: 'שיעור', startTime: '16:00', endTime: '18:00' });
    expect(parse('שיחה ב-8 בערב').startTime).toBe('20:00');
    expect(parse('שיחה ב-2 בצהריים').startTime).toBe('14:00');
    expect(parse('תצפית ב-2 בלילה').startTime).toBe('02:00');
    expect(parse('תצפית ב-12 בלילה').startTime).toBe('00:00');
    // a part of the day alone: its usual hour
    expect(parse('מסדר בבוקר')).toMatchObject({ title: 'מסדר', startTime: '08:00' });
    // "הערב" is also today
    expect(parse('פגישת סגל הערב', { defaultDate: '2026-10-04' })).toMatchObject({ title: 'פגישת סגל', date: '2026-10-01', startTime: '20:00' });
  });

  it('keeps "ערב" inside a title', () => {
    expect(parse('ארוחת ערב 19:00 למשך שעה')).toMatchObject({ title: 'ארוחת ערב', startTime: '19:00', endTime: '20:00' });
  });

  it('turns a length into an end time, and never mistakes it for a range', () => {
    expect(parse('מסדר ב-10 ל-3 שעות')).toMatchObject({ title: 'מסדר', startTime: '10:00', endTime: '13:00' });
    expect(parse('הרצאה 9:00 לשעתיים')).toMatchObject({ startTime: '09:00', endTime: '11:00' });
    expect(parse('תדריך 7:30 למשך 45 דקות')).toMatchObject({ startTime: '07:30', endTime: '08:15', title: 'תדריך' });
    expect(parse('הפסקה 12:00 לחצי שעה').endTime).toBe('12:30');
  });

  it('reads a written date, a letter weekday and days ahead', () => {
    expect(parse('הרצאה 12.10 ב-9:30')).toMatchObject({ title: 'הרצאה', date: '2026-10-12', startTime: '09:30' });
    expect(parse('ביום ה\' ב-14:00 תרגיל')).toMatchObject({ title: 'תרגיל', date: '2026-10-01', startTime: '14:00' });
    expect(parse('ביקור בעוד 3 ימים ב-11').date).toBe('2026-10-04');
    // a date months back is next year's
    expect(parse('פתיחה 3.1 ב-8').date).toBe('2027-01-03');
  });

  it('finds a weekday in the week open in the calendar', () => {
    // looking at next week: its Sunday, not the one after
    expect(parse('מסדר ביום ראשון 7:00', { defaultDate: '2026-10-06' }).date).toBe('2026-10-04');
    // "הבא": next week's, whatever is open
    expect(parse('מסדר ביום שני הבא 7:00').date).toBe('2026-10-05');
    // today's weekday: today
    expect(parse('תרגיל בחמישי ב-20').date).toBe('2026-10-01');
  });

  it('takes an owner only after "אחראי", without quote marks, and tells 1 from 12', () => {
    expect(parse('שיחה עם מפק"צ 2 ב-10')).toMatchObject({ title: 'שיחה עם מפק"צ 2', ownerId: null, startTime: '10:00' });
    expect(parse('מטווח ב-10 אחראי מפקצ 2').ownerId).toBe(3);
    expect(parse('מטווח ב-10 אחראי מפק"צ 12').ownerId).toBe(12);
    expect(parse('מטווח ב-10 באחריות מפק"צ 1').ownerId).toBe(2);
    expect(parse('מטווח ב-10 אחראית: נועה לוי').ownerId).toBe(20);
  });

  it('ends the place at a comma, and reads "מיקום:"', () => {
    expect(parse('@כיתה 4, שיעור עזרה ראשונה ב-13')).toMatchObject({ location: 'כיתה 4', title: 'שיעור עזרה ראשונה' });
    expect(parse('כנס מיקום: אולם ב\' מחר 9:00')).toMatchObject({ location: 'אולם ב\'', title: 'כנס', date: '2026-10-02' });
  });

  it('drops the words that only ask to add', () => {
    expect(parse('הוסף אירוע: מסדר יציאה מחר ב-14:00').title).toBe('מסדר יציאה');
  });

  it('leaves the time empty when none is written', () => {
    expect(parse('יום ספורט מחרתיים')).toMatchObject({ title: 'יום ספורט', date: '2026-10-03', startTime: null, endTime: null });
    expect(parse('')).toMatchObject({ title: '', date: '2026-10-01', dateGiven: false, startTime: null });
  });
});

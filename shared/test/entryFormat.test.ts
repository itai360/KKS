// The base's entry format (shared/entry.ts): the message written line by line as the base's own form, and
// the same message pasted back - as WhatsApp hands it on - read into the request. Made-up people and places.

import { describe, expect, it } from 'vitest';
import { emptyEntryFields, entryMessage, parseEntryMessages, parseVisitDays, visitDays, type EntryFields } from '../entry';

const TODAY = '2026-10-29';
const place = { camp: 'מחנה הבדיקה', unit: 'יחידת הבדיקה' };

/** a message as it arrives in WhatsApp: the form's labels in bold, spaced as people type them */
const PASTED = `*🔵פורמט אישור כניסה למחנה הבדיקה 🔵*

*תאריך:* 30-31/10
*יחידה אליה המבקר מגיע:* יחידת הבדיקה
*שם מלא:*  דנה כהן
*מס' טלפון:* 0501234567
*אזרח/חייל:* אזרח
*דרגה:*
*סיווג ביטחוני:*
*נדרש ליווי/ לא נדרש ליווי:* לא נדרש
*מספר אישי/ת״ז :* 123456782
*רגלי/רכוב:* רכוב
*סיבת הגעה :* מרצה בקורס
*רכב צבאי/אזרחי:* אזרחי
*מספר רכב:*1234567
*סוג וצבע רכב*: מאזדה 3 לבנה`;

const visitor: EntryFields = {
  ...emptyEntryFields(),
  visitDate: '2026-10-30',
  visitEndDate: '2026-10-31',
  fullName: 'דנה כהן',
  phone: '0501234567',
  visitorKind: 'civilian',
  idNumber: '123456782',
  escort: false,
  byCar: true,
  carMilitary: false,
  carNumber: '1234567',
  carKind: 'מאזדה 3 לבנה',
  reason: 'מרצה בקורס',
};

describe('the message in the base format', () => {
  it('is written line by line as the base writes it, an empty line after the title, nothing after a label that does not apply', () => {
    expect(entryMessage(visitor, place)).toBe(
      [
        '*🔵פורמט אישור כניסה למחנה הבדיקה 🔵*',
        '',
        '*תאריך:* 30-31/10',
        '*יחידה אליה המבקר מגיע:* יחידת הבדיקה',
        '*שם מלא:* דנה כהן',
        "*מס' טלפון:* 0501234567",
        '*אזרח/חייל:* אזרח',
        '*דרגה:*',
        '*סיווג ביטחוני:*',
        '*נדרש ליווי/ לא נדרש ליווי:* לא נדרש',
        '*מספר אישי/ת״ז :* 123456782',
        '*רגלי/רכוב:* רכוב',
        '*סיבת הגעה :* מרצה בקורס',
        '*רכב צבאי/אזרחי:* אזרחי',
        '*מספר רכב:* 1234567',
        '*סוג וצבע רכב*: מאזדה 3 לבנה',
      ].join('\n'),
    );
  });

  it("a soldier on foot with an escort: rank, the car's lines empty; the request's own unit and camp before the course's", () => {
    const soldier: EntryFields = { ...visitor, visitEndDate: '', visitorKind: 'soldier', rank: 'סרן', clearance: 'סודי', escort: true, byCar: false, unit: 'יחידה אחרת', camp: 'מחנה אחר' };
    const lines = entryMessage(soldier, place).split('\n');
    expect(lines[0]).toBe('*🔵פורמט אישור כניסה למחנה אחר 🔵*');
    expect(lines).toEqual(
      expect.arrayContaining([
        '*תאריך:* 30/10',
        '*יחידה אליה המבקר מגיע:* יחידה אחרת',
        '*אזרח/חייל:* חייל',
        '*דרגה:* סרן',
        '*סיווג ביטחוני:* סודי',
        '*נדרש ליווי/ לא נדרש ליווי:* נדרש',
        '*רגלי/רכוב:* רגלי',
        '*רכב צבאי/אזרחי:*',
        '*מספר רכב:*',
        '*סוג וצבע רכב*:',
      ]),
    );
    expect(entryMessage({ ...soldier, camp: '' }, { camp: '', unit: '' }).split('\n')[0]).toBe('*🔵פורמט אישור כניסה 🔵*');
  });
});

describe('the message pasted back', () => {
  it('fills every field of the request, the unit and the camp with them', () => {
    const { entries, rest } = parseEntryMessages(PASTED, TODAY);
    expect(rest).toBe('');
    expect(entries).toHaveLength(1);
    expect(entries[0].fields).toEqual({ ...visitor, unit: 'יחידת הבדיקה', camp: 'מחנה הבדיקה' });
    expect(entries[0].found).toHaveLength(12);
  });

  it('reads back what it writes, for a civilian and for a soldier in a military car', () => {
    const soldier: EntryFields = { ...visitor, visitorKind: 'soldier', rank: 'רס"ן', clearance: 'סודי ביותר', escort: true, carMilitary: true, carNumber: '123-456', unit: 'יחידת הבדיקה', camp: 'מחנה הבדיקה' };
    for (const e of [{ ...visitor, unit: 'יחידת הבדיקה', camp: 'מחנה הבדיקה' }, soldier]) {
      expect(parseEntryMessages(entryMessage(e, place), TODAY).entries[0].fields).toEqual(e);
    }
  });

  it('takes the labels as people send them: without the bold, the title or the order, with other spellings', () => {
    const loose = `שם מלא: יואב לוי
טלפון: 052-765-4321
תאריך: 5.11
אזרח / חייל: חייל
דרגה: סמל
ת"ז: 7654321
ליווי: נדרש ליווי
מספר רכב: 12-345-67
סוג רכב: טויוטה כסופה
רכב: צבאי
סיבת ההגעה: פגישה`;
    const [e] = parseEntryMessages(loose, TODAY).entries;
    expect(e.fields).toMatchObject({
      fullName: 'יואב לוי',
      phone: '052-765-4321',
      visitDate: '2026-11-05',
      visitEndDate: '',
      visitorKind: 'soldier',
      rank: 'סמל',
      idNumber: '7654321',
      escort: true,
      byCar: true,
      carMilitary: true,
      carNumber: '12-345-67',
      carKind: 'טויוטה כסופה',
      reason: 'פגישה',
    });
  });

  it('reads several messages in one paste, and leaves what is none of them', () => {
    const two = `${PASTED}\n\n${PASTED.replace('דנה כהן', 'יואב לוי').replace('30-31/10', '2/11')}\nותודה רבה`;
    const { entries, rest } = parseEntryMessages(two, TODAY);
    expect(entries.map((x) => [x.fields.fullName, x.fields.visitDate, x.fields.visitEndDate])).toEqual([
      ['דנה כהן', '2026-10-30', '2026-10-31'],
      ['יואב לוי', '2026-11-02', ''],
    ]);
    expect(rest).toBe('ותודה רבה');
    // the labels said twice without a title between: two messages as well
    const untitled = PASTED.split('\n').slice(2).join('\n');
    expect(parseEntryMessages(`${untitled}\n${untitled}`, TODAY).entries).toHaveLength(2);
  });

  it('is not a message when it has fewer than three of the form\'s labels', () => {
    expect(parseEntryMessages('שם: דנה\nמה קורה?', TODAY).entries).toEqual([]);
    expect(parseEntryMessages('דני כהן איחר למסדר', TODAY)).toEqual({ entries: [], rest: 'דני כהן איחר למסדר' });
  });
});

describe('the days of a visit', () => {
  it('as the form writes them, and back', () => {
    expect(visitDays('2026-10-30')).toBe('30/10');
    expect(visitDays('2026-10-30', '2026-10-31')).toBe('30-31/10');
    expect(visitDays('2026-10-30', '2026-11-02')).toBe('30/10-2/11');
    expect(parseVisitDays('30-31/10', TODAY)).toEqual({ start: '2026-10-30', end: '2026-10-31' });
    expect(parseVisitDays('30/10-2/11', TODAY)).toEqual({ start: '2026-10-30', end: '2026-11-02' });
    expect(parseVisitDays('30.10.2026', TODAY)).toEqual({ start: '2026-10-30', end: '' });
    expect(parseVisitDays('יום שישי 30/10', TODAY)).toEqual({ start: '2026-10-30', end: '' });
    // a day well behind is next year's; over the turn of the year, the end in the next one
    expect(parseVisitDays('5/1', TODAY)).toEqual({ start: '2027-01-05', end: '' });
    expect(parseVisitDays('30/12-2/1', TODAY)).toEqual({ start: '2026-12-30', end: '2027-01-02' });
    expect(parseVisitDays('32/10', TODAY)).toBeNull();
    expect(parseVisitDays('מחר', TODAY)).toBeNull();
  });
});

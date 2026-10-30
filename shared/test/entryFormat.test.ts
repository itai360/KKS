// The base's entry format (shared/entry.ts): the message written line by line as the base's own form, with no
// date, and the same message pasted back - as WhatsApp hands it on - read into the request. Made-up people and
// places.

import { describe, expect, it } from 'vitest';
import { emptyEntryFields, entryMessage, parseEntryMessages, type EntryFields } from '../entry';

const place = { camp: 'מחנה הבדיקה', unit: 'יחידת הבדיקה' };

/** a message as it arrives in WhatsApp: the form's labels in bold, spaced as people type them - an older one,
 *  with the date line the form once had */
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
  it('is written line by line as the base writes it, with no date, an empty line after the title, nothing after a label that does not apply', () => {
    expect(entryMessage(visitor, place)).toBe(
      [
        '*🔵פורמט אישור כניסה למחנה הבדיקה 🔵*',
        '',
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
    const soldier: EntryFields = { ...visitor, visitorKind: 'soldier', rank: 'סרן', clearance: 'סודי', escort: true, byCar: false, unit: 'יחידה אחרת', camp: 'מחנה אחר' };
    const lines = entryMessage(soldier, place).split('\n');
    expect(lines[0]).toBe('*🔵פורמט אישור כניסה למחנה אחר 🔵*');
    expect(lines).toEqual(
      expect.arrayContaining([
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
    expect(lines.some((l) => l.includes('תאריך'))).toBe(false);
  });
});

describe('the message pasted back', () => {
  it('fills every field of the request, the unit and the camp with them; a date line stays in the message and is left out', () => {
    const { entries, rest } = parseEntryMessages(PASTED);
    expect(rest).toBe('');
    expect(entries).toHaveLength(1);
    expect(entries[0].fields).toEqual({ ...visitor, unit: 'יחידת הבדיקה', camp: 'מחנה הבדיקה' });
    expect(entries[0].found).toHaveLength(11);
  });

  it('reads back what it writes, for a civilian and for a soldier in a military car', () => {
    const soldier: EntryFields = { ...visitor, visitorKind: 'soldier', rank: 'רס"ן', clearance: 'סודי ביותר', escort: true, carMilitary: true, carNumber: '123-456', unit: 'יחידת הבדיקה', camp: 'מחנה הבדיקה' };
    for (const e of [{ ...visitor, unit: 'יחידת הבדיקה', camp: 'מחנה הבדיקה' }, soldier]) {
      expect(parseEntryMessages(entryMessage(e, place)).entries[0].fields).toEqual(e);
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
    const [e] = parseEntryMessages(loose).entries;
    expect(e.fields).not.toHaveProperty('visitDate');
    expect(e.fields).toMatchObject({
      fullName: 'יואב לוי',
      phone: '052-765-4321',
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
    const { entries, rest } = parseEntryMessages(two);
    expect(entries.map((x) => x.fields.fullName)).toEqual(['דנה כהן', 'יואב לוי']);
    expect(rest).toBe('ותודה רבה');
    // the labels said twice without a title between: two messages as well
    const untitled = PASTED.split('\n').slice(2).join('\n');
    expect(parseEntryMessages(`${untitled}\n${untitled}`).entries).toHaveLength(2);
    // and so are messages written now, with no date line
    const fresh = entryMessage(visitor, place);
    expect(parseEntryMessages(`${fresh}\n${fresh.replace('דנה כהן', 'יואב לוי')}`).entries.map((x) => x.fields.fullName)).toEqual(['דנה כהן', 'יואב לוי']);
  });

  it('is not a message when it has fewer than three of the form\'s labels', () => {
    expect(parseEntryMessages('שם: דנה\nמה קורה?').entries).toEqual([]);
    expect(parseEntryMessages('דני כהן איחר למסדר')).toEqual({ entries: [], rest: 'דני כהן איחר למסדר' });
  });
});

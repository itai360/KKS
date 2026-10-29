// The built-in reading of smart entry (shared/smartEntry.ts): free Hebrew, as staff write it, placed and
// filled - names from the course's lists, days resolved the way the matter means them (a punishment in the
// past, a visit ahead), several cadets an item each, two matters in one sentence two items. Made-up names.

import { describe, expect, it } from 'vitest';
import { analyzeLocal, matchOffense, smartMissing, splitSentences, type SmartContext } from '../smartEntry';

/** Thursday 29.10.2026, 09:00 in Israel */
const ctx: SmartContext = {
  cadets: [
    { id: 1, firstName: 'דני', lastName: 'כהן', teamName: 'צוות 1' },
    { id: 2, firstName: 'יוסי', lastName: 'לוי', teamName: 'צוות 1' },
    { id: 3, firstName: 'נועה', lastName: 'ברק', teamName: 'צוות 2' },
    { id: 4, firstName: 'איתמר', lastName: 'שושן', teamName: 'צוות 2' },
    { id: 5, firstName: 'מיכל', lastName: 'אורן', teamName: 'צוות 3' },
  ],
  staff: [
    { id: 10, displayName: 'מפקד הקורס', title: 'מפקד הקורס' },
    { id: 11, displayName: 'רון אלמוג', title: 'מפק"צ 1' },
    { id: 12, displayName: 'גלית שמיר', title: 'מפק"צ 2' },
  ],
  me: 10,
  offenses: [
    { key: 'זמנים · איחור למסדר', category: 'זמנים', name: 'איחור למסדר', definition: [] },
    { key: 'טלפונים · שימוש בטלפון בשיעור', category: 'טלפונים', name: 'שימוש בטלפון בשיעור', definition: ['הודעות, משחקים, גלישה'] },
  ],
  now: new Date('2026-10-29T09:00:00+02:00'),
};

const read = (text: string) => analyzeLocal(text, ctx);
const one = (text: string) => {
  const items = read(text);
  expect(items, text).toHaveLength(1);
  return items[0];
};

describe('placing each thing', () => {
  it('a punishment or a broken rule: discipline, with the ladder offense and the day it happened', () => {
    const it1 = one('דני כהן איחר למסדר בוקר, קיבל שעה ביציאה');
    expect(it1.kind).toBe('discipline');
    expect(it1.confidence).toBe('high');
    expect(it1.fields).toMatchObject({ cadetId: 1, offense: 'זמנים · איחור למסדר', title: 'איחור למסדר', date: '2026-10-29', details: 'איחר למסדר בוקר, קיבל שעה ביציאה' });
    expect(read('נועה ברק ויוסי לוי לא הגיעו לשיעור ניווט אתמול').map((i) => [i.fields.cadetId, i.fields.date])).toEqual([
      [3, '2026-10-28'],
      [2, '2026-10-28'],
    ]);
    const note = one('הערת משמעת לדני כהן על חוצפה');
    expect(note.fields).toMatchObject({ formal: true, details: 'חוצפה' });
  });

  it('several cadets with the same matter: an item each; two matters in a sentence: two items', () => {
    expect(read('יוסי לוי ונועה ברק איחרו למסדר').map((i) => [i.kind, i.fields.cadetId])).toEqual([
      ['discipline', 2],
      ['discipline', 3],
    ]);
    expect(read('דני כהן איחר למסדר ויוסי לוי הפקיר נשק').map((i) => [i.kind, i.fields.cadetId])).toEqual([
      ['discipline', 1],
      ['procedure', 2],
    ]);
    // a sentence that names nobody belongs with the one before
    expect(read('דני כהן איחר למסדר. הוא קיבל שעה ביציאה. נועה ברק השאירה את הנשק במטבח.').map((i) => i.kind)).toEqual(['discipline', 'procedure']);
  });

  it("the course's procedures: a weapon left or on the back, a phone, the dress", () => {
    expect(one('איתמר שושן הפקיר נשק בחדר האוכל').fields.procedure).toBe('weapon_left');
    expect(one('מיכל אורן - הנשק היה מאחורה במסדר').fields.procedure).toBe('weapon_back');
    expect(one('מיכל אורן - כומתה ושרוך לא תקינים').fields).toMatchObject({ procedure: 'dress', dress: ['כומתה', 'שרוך'] });
    const phone = one('יוסי לוי היה עם טלפון בשיעור');
    expect(phone.fields).toMatchObject({ procedure: 'phone', situation: 'בשיעור' });
    // the ladder's own phone offense is offered too
    expect(phone.alternatives).toContain('discipline');
  });

  it("a visitor: the entry approval's fields, numbers and all", () => {
    const e = one('אישור כניסה לאבי מזרחי מחר, 050-1234567, ת"ז 123456789, ברכב מאזדה לבנה 12-345-67, לצורך הרצאה');
    expect(e.kind).toBe('entry');
    expect(e.fields.date).toBe('2026-10-30');
    expect(e.fields.entry).toMatchObject({ fullName: 'אבי מזרחי', phone: '050-1234567', idNumber: '123456789', visitorKind: 'civilian', byCar: true, carNumber: '12-345-67', carKind: 'מאזדה לבנה', reason: 'הרצאה' });
    expect(smartMissing(e)).toEqual([]);
    const soldier = one('סמל רועי פרץ יגיע ביום ראשון לבסיס, מ.א 7654321, טלפון 052-7654321, רגלי, צריך ליווי');
    expect(soldier.fields.entry).toMatchObject({ fullName: 'רועי פרץ', rank: 'סמל', visitorKind: 'soldier', idNumber: '7654321', escort: true, byCar: false });
    expect(soldier.fields.date).toBe('2026-11-01');
    expect(smartMissing(soldier)).toEqual(['סיבת הגעה']);
  });

  it('an exemption: from what, until when (on a Thursday, "until Thursday" is next week), and why', () => {
    const x = one('פטור מריצות לנועה ברק עד יום חמישי בגלל נקע בקרסול');
    expect(x.kind).toBe('exemption');
    expect(x.fields).toMatchObject({ cadetId: 3, subject: 'ריצות', until: '2026-11-05', details: 'נקע בקרסול' });
  });

  it("where a cadet is: sick is an exemption (גימלים) to the last day; at home or at an appointment, a note", () => {
    const sick = one('יוסי לוי בגימלים היום ומחר');
    expect(sick.kind).toBe('exemption');
    expect(sick.fields).toMatchObject({ cadetId: 2, subject: 'גימלים', date: '2026-10-29', until: '2026-10-30' });
    const home = one('דני כהן בבית היום, חזר מבדיקה');
    expect(home.kind).toBe('note');
    expect(home.fields).toMatchObject({ cadetId: 1, title: 'בית / חופשה · היום', details: 'בית / חופשה היום: חזר מבדיקה' });
    const appointment = one('מיכל אורן בתור לרופא שיניים מחר ב-10');
    expect(appointment.kind).toBe('note');
    expect(appointment.fields).toMatchObject({ cadetId: 5, date: '2026-10-30', title: 'תור / בדיקה · 30.10' });
  });

  it('a staff member away is an absence - the writer when they speak of themselves', () => {
    expect(one('אני בחופשה מ-2.11 עד 4.11').fields).toMatchObject({ userId: 10, date: '2026-11-02', endDate: '2026-11-04', absenceReason: 'leave' });
    expect(one('גלית שמיר במילואים ביום שלישי').fields).toMatchObject({ userId: 12, date: '2026-11-03', absenceReason: 'duty' });
    const sick = one('רון אלמוג בגימלים מחר');
    expect(sick.kind).toBe('absence');
    expect(sick.fields).toMatchObject({ userId: 11, absenceReason: 'sick', date: '2026-10-30' });
  });

  it('tasks, events, the weekly, the debrief and announcements', () => {
    expect(one('משימה לרון אלמוג לסגור את המטווח עד יום רביעי בשעה 18:00').fields).toMatchObject({ title: 'סגירת מטווח', ownerIds: [11], date: '2026-11-04', time: '18:00' });
    expect(one('תזכיר לי להתקשר להורים של איתמר שושן ביום ראשון').fields).toMatchObject({ title: 'להתקשר להורים של איתמר שושן', ownerIds: [10], date: '2026-11-01' });
    expect(one('פגישה עם המ"פ מחר 10-11 בחדר הישיבות').fields).toMatchObject({ title: 'פגישה עם המ"פ', date: '2026-10-30', time: '10:00', endTime: '11:00', location: 'חדר הישיבות' });
    expect(one('סגירה מקצועית לשבועי: לוח הזמנים של שבוע 6, אחראי רון אלמוג').fields).toMatchObject({ weeklyKind: 'closure', title: 'לוח הזמנים של שבוע 6', ownerIds: [11] });
    expect(one('לקח למחזור הבא: לתאם הסעות מראש').fields).toMatchObject({ part: 'next', details: 'לתאם הסעות מראש' });
    const a = one('הודעה לכל הסגל: מחר מסדר מפקד ב-7:00, דחוף');
    expect(a.kind).toBe('announcement');
    expect(a.fields).toMatchObject({ title: 'מחר מסדר מפקד ב-7:00', urgent: true });
  });

  it('a praise or a personal matter is a note in the file', () => {
    const n = one('מיכל אורן הצטיינה בתרגיל הניווט, הובילה את הצוות');
    expect(n.kind).toBe('note');
    expect(n.fields).toMatchObject({ cadetId: 5, title: 'הצטיינה בתרגיל הניווט' });
  });
});

describe('the pieces', () => {
  it('cuts sentences, not abbreviations or dates', () => {
    expect(splitSentences('דני כהן איחר. ת.ז. 123 ב-3.11 הגיע. נועה ברק בבית')).toEqual(['דני כהן איחר.', 'ת.ז. 123 ב-3.11 הגיע.', 'נועה ברק בבית']);
    expect(splitSentences('- דני כהן איחר\n2) נועה ברק בבית')).toEqual(['דני כהן איחר', 'נועה ברק בבית']);
  });

  it("matches the ladder's offense by its words, not by a word in common", () => {
    expect(matchOffense('איחרו למסדר בוקר', ctx.offenses)?.key).toBe('זמנים · איחור למסדר');
    expect(matchOffense('שיחק בפלאפון בהרצאה', ctx.offenses)?.key).toBe('טלפונים · שימוש בטלפון בשיעור');
    expect(matchOffense('הגיע לשיעור', ctx.offenses)).toBeNull();
  });

  it('says what an item lacks, in words', () => {
    expect(smartMissing({ kind: 'task', fields: { ...one('צריך להזמין אוטובוס').fields, date: null } })).toEqual(['דד-ליין']);
    expect(smartMissing({ kind: 'discipline', fields: { ...one('דני כהן איחר למסדר').fields, cadetId: null } })).toEqual(['צוער']);
  });
});

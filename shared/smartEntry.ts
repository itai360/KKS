// Smart entry (הזנה חכמה): the staff write in their own words - a punishment, an entry approval, a cadet
// at home sick, a task, a meeting - and the app works out where each thing belongs and fills its form.
// One text may hold several things: each line, each sentence, and each cadet named in it is an item of
// its own. What is worked out is only a draft: every item is shown, can be changed or dropped, and is
// filed only when the writer confirms - through the same rules as the screen it belongs to.
//
// This file is the shared part: the items, what each needs, and the built-in reading of Hebrew, which
// works offline and is always there. The server may ask Claude for a deeper reading (smartEntry.ts on
// the server) and checks whatever comes back against the same rules.

import { ABSENCE_REASON_LABELS, ATTENDANCE_LABELS, PRIORITY_LABELS, WEEKDAY_NAMES, type AbsenceReason, type AttendanceStatus, type Priority } from './constants';
import { addDays, DEFAULT_TZ, diffDays, isDateKey, localDateKey, shortDate, toDateKey, weekdayOf } from './dates';
import { WEEK_NOTE_PART_LABELS, type WeekNotePart } from './debriefForms';
import { emptyEntryFields, entryMissing, parseEntryMessages, type EntryFields, type VisitorKind } from './entry';
import { parseEventText } from './eventParser';
import { Extractor, HB, LB, looseNameSource, normalizeHebrew, parseTaskText, RB } from './parser';
import { DRESS_ITEMS, PROCEDURE_LABELS, procedureMissing, type ProcedureKind } from './procedures';
import { WEEKLY_KIND_LABELS, type WeeklyKind } from './weekly';

// ---------------- the items ----------------

export const SMART_KINDS = ['discipline', 'procedure', 'entry', 'exemption', 'note', 'absence', 'task', 'event', 'weekly', 'weekNote', 'announcement'] as const;
export type SmartKind = (typeof SMART_KINDS)[number];

export const SMART_KIND_LABELS: Record<SmartKind, string> = {
  discipline: 'רישום משמעת',
  procedure: 'אי עמידה בנהלים',
  entry: 'אישור כניסה',
  exemption: 'פטור',
  note: 'הערה בתיק הצוער',
  absence: 'היעדרות איש סגל',
  task: 'משימה',
  event: 'אירוע ביומן',
  weekly: 'לשבועי',
  weekNote: 'לתחקיר השבוע',
  announcement: 'הודעה לסגל',
};

export const SMART_KIND_ICONS: Record<SmartKind, string> = {
  discipline: 'alert',
  procedure: 'shield',
  entry: 'stamp',
  exemption: 'hand',
  note: 'edit',
  absence: 'calendar',
  task: 'tasks',
  event: 'calendar',
  weekly: 'weekly',
  weekNote: 'lightbulb',
  announcement: 'flag',
};

/** where each is kept, in a few words (the card says it under the kind) */
export const SMART_KIND_PLACES: Record<SmartKind, string> = {
  discipline: 'נרשם בתיק הצוער, לפי מדרג האכיפה',
  procedure: 'נרשם בתיק הצוער ונספר לפי סוג',
  entry: 'נשלח למפקד הקורס בפורמט הבסיס',
  exemption: 'נרשם בתיק הצוער, וכל הסגל מקבל הודעה',
  note: 'נרשם בתיק הצוער',
  absence: 'נרשם בהיעדרויות הסגל',
  task: 'נפתחת משימה לאחראי',
  event: 'נוסף ליומן',
  weekly: 'נוסף לשבועי הקרוב',
  weekNote: 'נוסף לתחקיר השבועי של השבוע',
  announcement: 'נשלח לכל הסגל',
};

/** the kinds that are about one cadet: several cadets named in one sentence make an item each */
export const CADET_KINDS: readonly SmartKind[] = ['discipline', 'procedure', 'exemption', 'note'];

/**
 * What the reading tells apart before it places a thing: the kinds, and a cadet's whereabouts on a day
 * (sick, at home, at an appointment...) - which, the course keeping no roll call, is filed as an
 * exemption (גימלים) or a note in the file (fromWhereabouts).
 */
type ReadKind = SmartKind | 'whereabouts';
const READ_CADET_KINDS: readonly ReadKind[] = [...CADET_KINDS, 'whereabouts'];

/** a visitor's details, as the entry form has them (no date: who comes and why) */
export type EntryDraft = EntryFields;

export const emptyEntry = (): EntryDraft => emptyEntryFields();

/** every field any kind may need; each kind reads its own */
export interface SmartFields {
  /** the cadet it is about (discipline, procedure, exemption, note) */
  cadetId: number | null;
  /** the staff member away (absence) */
  userId: number | null;
  /** who is in charge: a task's owners, an event's or a weekly item's owner (the first) */
  ownerIds: number[];
  /** the day: it happened, the visit, the event, the deadline, the first day away, the roll call's */
  date: string | null;
  /** the last day away, or of an event of several days */
  endDate: string | null;
  /** a deadline's or an event's hour */
  time: string | null;
  endTime: string | null;
  /** a task's, an event's, a weekly item's or an announcement's title; a record's heading */
  title: string;
  /** the rest of what was written: the record's text, the reason, the announcement's body */
  details: string;
  /** discipline: the offense on the enforcement ladder ("קטגוריה · מקרה"), or "" */
  offense: string;
  /** discipline: given as a discipline note (הערת משמעת) */
  formal: boolean;
  /** procedure: what was not kept */
  procedure: ProcedureKind | null;
  dress: string[];
  situation: string;
  other: string;
  /** entry: the visitor */
  entry: EntryDraft | null;
  /** exemption: from what, and until when (null: until further notice) */
  subject: string;
  until: string | null;
  absenceReason: AbsenceReason | null;
  /** where a cadet is that day, as the words say it - the reading's own: filed as an exemption or a note */
  attendance: AttendanceStatus | null;
  priority: Priority | null;
  location: string;
  weeklyKind: WeeklyKind | null;
  part: WeekNotePart | null;
  urgent: boolean;
}

export const emptyFields = (): SmartFields => ({
  cadetId: null,
  userId: null,
  ownerIds: [],
  date: null,
  endDate: null,
  time: null,
  endTime: null,
  title: '',
  details: '',
  offense: '',
  formal: false,
  procedure: null,
  dress: [],
  situation: '',
  other: '',
  entry: null,
  subject: '',
  until: null,
  absenceReason: null,
  attendance: null,
  priority: null,
  location: '',
  weeklyKind: null,
  part: null,
  urgent: false,
});

export type SmartConfidence = 'high' | 'medium' | 'low';

/** the ladder's word on a discipline item: which time this is for the cadet, and what the ladder says to do */
export interface SmartLadder {
  occurrence: number;
  /** what the ladder says for this time (null: it says nothing) */
  step: string | null;
  /** the step is a discipline note / sends to a committee */
  note: boolean;
  committee: boolean;
  /** the cadet's discipline notes so far */
  notes: number;
}

export interface SmartItem {
  /** stable within one reading, for the screen */
  key: string;
  kind: SmartKind;
  confidence: SmartConfidence;
  /** the words it came from */
  source: string;
  /** why it was read so, in a few Hebrew words */
  why: string;
  fields: SmartFields;
  /** other places it might belong, best first */
  alternatives: SmartKind[];
  /** the server's word: the ladder (discipline, procedure) */
  ladder?: SmartLadder | null;
  /** the server's word: why this writer cannot file it (null: may) */
  blocked?: string | null;
}

export interface SmartAnalysis {
  /** 'ai': Claude read it; 'local': the built-in reading */
  source: 'ai' | 'local';
  items: SmartItem[];
  /** Claude is set up on the server (the reading may still have been the built-in one, when it failed) */
  aiAvailable: boolean;
}

/** what one item filed came to */
export interface SmartResult {
  key: string;
  ok: boolean;
  /** "נרשם בתיק של ..." / the error */
  message: string;
  /** where to see it */
  link: string | null;
}

// ---------------- what each needs ----------------

/** what an item still lacks before it can be filed, in words (empty: ready) */
export function smartMissing(item: Pick<SmartItem, 'kind' | 'fields'>): string[] {
  const f = item.fields;
  const out: string[] = [];
  const need = (ok: unknown, label: string) => {
    if (!ok) out.push(label);
  };
  switch (item.kind) {
    case 'discipline':
      need(f.cadetId, 'צוער');
      need(f.offense || f.title.trim() || f.details.trim(), 'מה קרה');
      break;
    case 'procedure':
      need(f.cadetId, 'צוער');
      if (f.procedure) out.push(...procedureMissing({ cadetId: f.cadetId ?? 1, kind: f.procedure, other: f.other, dress: f.dress }));
      else out.push('מה לא נשמר');
      break;
    case 'entry':
      out.push(...entryMissing(f.entry ?? emptyEntry()));
      break;
    case 'exemption':
      need(f.cadetId, 'צוער');
      need(f.subject.trim(), 'ממה הפטור');
      break;
    case 'note':
      need(f.cadetId, 'צוער');
      need(f.details.trim() || f.title.trim(), 'תוכן');
      break;
    case 'absence':
      need(f.date, 'מתאריך');
      break;
    case 'task':
      need(f.title.trim(), 'כותרת');
      need(f.ownerIds.length, 'אחראי');
      need(f.date, 'דד-ליין');
      break;
    case 'event':
      need(f.title.trim(), 'כותרת');
      need(f.date, 'תאריך');
      break;
    case 'weekly':
      need(f.title.trim(), 'על מה מדובר');
      need(f.weeklyKind, 'סוג');
      break;
    case 'weekNote':
      need(f.details.trim() || f.title.trim(), 'מה להוסיף');
      need(f.part, 'לשימור / לשיפור / לקח');
      break;
    case 'announcement':
      need(f.title.trim(), 'כותרת');
      break;
  }
  return out;
}

/** a few words on what the item will be, for the card's head ("פעם שנייה" etc. come from the ladder) */
export function smartSummary(item: Pick<SmartItem, 'kind' | 'fields'>, names: { cadet?: string | null; user?: string | null }): string {
  const f = item.fields;
  const who = names.cadet ?? '';
  switch (item.kind) {
    case 'discipline':
      return [who, f.offense ? f.offense.split(' · ').pop() : f.title].filter(Boolean).join(' · ');
    case 'procedure':
      return [who, f.procedure ? (f.procedure === 'other' ? f.other || PROCEDURE_LABELS.other : PROCEDURE_LABELS[f.procedure]) : ''].filter(Boolean).join(' · ');
    case 'entry':
      return f.entry?.fullName || 'מבקר';
    case 'exemption':
      return [who, f.subject && `פטור מ${f.subject.replace(/^מ/, '')}`].filter(Boolean).join(' · ');
    case 'note':
      return who;
    case 'absence':
      return [names.user ?? '', f.absenceReason ? ABSENCE_REASON_LABELS[f.absenceReason] : ''].filter(Boolean).join(' · ');
    case 'task':
      return [f.title, f.priority && f.priority !== 'normal' ? `עדיפות ${PRIORITY_LABELS[f.priority]}` : ''].filter(Boolean).join(' · ');
    case 'event':
      return f.title;
    case 'weekly':
      return [f.weeklyKind ? WEEKLY_KIND_LABELS[f.weeklyKind] : '', f.title].filter(Boolean).join(' · ');
    case 'weekNote':
      return f.part ? WEEK_NOTE_PART_LABELS[f.part] : '';
    case 'announcement':
      return f.title;
  }
}

// ---------------- the built-in reading ----------------

export interface SmartPerson {
  id: number;
  name: string;
  /** other names it goes by: a cadet's "last first", a staff member's title ("מפק"צ 2") */
  aliases?: string[];
}

export interface SmartCadet {
  id: number;
  firstName: string;
  lastName: string;
  teamName?: string | null;
}

export interface SmartOffense {
  key: string;
  category: string;
  name: string;
  definition: string[];
}

export interface SmartContext {
  cadets: SmartCadet[];
  staff: { id: number; displayName: string; title?: string; username?: string }[];
  /** who writes: "אני" and "לי" are them */
  me: number;
  offenses: SmartOffense[];
  now?: Date;
  tz?: string;
}

const P = `[ובלהמשכ]{0,3}`; // the letters that may come before a word: ו, ה, ב, ל, מ, ש, כ
const word = (src: string) => new RegExp(`${LB}${P}(?:${src})${RB}`);
const exact = (src: string) => new RegExp(`${LB}(?:${src})${RB}`);

interface Rule {
  kind: ReadKind;
  re: RegExp;
  w: number;
  why: string;
  apply?: (f: SmartFields) => void;
}

const set =
  <K extends keyof SmartFields>(k: K, v: SmartFields[K]) =>
  (f: SmartFields) => {
    f[k] = v;
  };

/** the words that say where a thing belongs - each with its weight and the reason the card shows */
const RULES: Rule[] = [
  // discipline: a rule broken, a punishment given
  { kind: 'discipline', re: word('עונש|עונשים|ענישה'), w: 3, why: 'עונש' },
  { kind: 'discipline', re: exact('נענש|נענשה|נענשו|הוענש|הוענשה|יוענש|להעניש|להעניש|תעניש|העניש|העניש[הו]'), w: 3, why: 'עונש' },
  { kind: 'discipline', re: word('ריתוק|ריתוקים'), w: 4, why: 'ריתוק' },
  { kind: 'discipline', re: exact('ריתקו|ריתקתי|ריתקנו|מרותק|מרותקת|מרותקים|רותק|רותקה|רותקו'), w: 4, why: 'ריתוק' },
  { kind: 'discipline', re: new RegExp(`${LB}${P}הער(?:ת|ות)\\s+משמעת${RB}`), w: 6, why: 'הערת משמעת', apply: set('formal', true) },
  { kind: 'discipline', re: word('אזהרה|שיחת\\s+אזהרה|נזיפה'), w: 2.5, why: 'אזהרה' },
  { kind: 'discipline', re: exact('ננזף|ננזפה|ננזפו'), w: 3, why: 'נזיפה' },
  { kind: 'discipline', re: exact('איחר|איחרה|איחרו|איחרת|איחרתי|מאחר|מאחרת|מאחרים|התאחר|התאחרה'), w: 3, why: 'איחור' },
  { kind: 'discipline', re: word('איחור|איחורים'), w: 3, why: 'איחור' },
  { kind: 'discipline', re: new RegExp(`${LB}(?:שבת\\s+(?:ב)?(?:ריתוק|סגורה|בבסיס)|סגירת\\s+שבת|[ינת]?סוגר(?:ת|ים)?\\s+שבת|יסגור\\s+שבת|תסגור\\s+שבת|נשאר(?:ת|ים|ה|ו)?\\s+(?:ל|ב)?שבת)${RB}`), w: 4, why: 'סגירת שבת' },
  { kind: 'discipline', re: new RegExp(`${LB}(?:שע(?:ה|תיים|ות)\\s+(?:ב|על\\s+ה)יציאה|(?:ב)?יציאה\\s+מאוחרת)${RB}`), w: 3, why: 'עיכוב ביציאה' },
  { kind: 'discipline', re: word('משמעת|משמעתי|משמעתית|עבירה|עבירת'), w: 3, why: 'משמעת' },
  { kind: 'discipline', re: exact('התחצף|התחצפה|התחצפו|חוצפה|חצוף|חצופה|זלזול|זלזל|זלזלה|זלזלו|הזלזול|התנהגות\\s+לא\\s+הולמת'), w: 3, why: 'התנהגות' },
  { kind: 'discipline', re: new RegExp(`${LB}(?:נרדם|נרדמה|נרדמו|(?:ישן|ישנה|ישנו)\\s+ב(?:שיעור|הרצאה|שמירה|עמדה|כיתה|תדריך))${RB}`), w: 3, why: 'שינה' },
  { kind: 'discipline', re: exact('עישן|עישנה|עישנו|עישון|סיגריה|סיגריות|מעשן|מעשנת'), w: 3, why: 'עישון' },
  { kind: 'discipline', re: new RegExp(`${LB}(?:לא\\s+(?:הגיע|הגיעה|הגיעו|הופיע|הופיעה|הופיעו)\\s+ל|הבריז|הבריזה|הבריזו|הברזה)`), w: 2.5, why: 'לא הגיע' },
  { kind: 'discipline', re: exact('שכח|שכחה|שכחו|שכחת'), w: 2, why: 'שכחה' },
  { kind: 'discipline', re: new RegExp(`${LB}לא\\s+(?:ביצע|ביצעה|ביצעו|מילא|מילאה|מילאו|הכין|הכינה|הכינו|הגיש|הגישה|הגישו|עשה|עשתה|עשו)${RB}`), w: 2, why: 'אי ביצוע' },
  { kind: 'discipline', re: word('תלונה|תלונות'), w: 1, why: 'תלונה' },

  // not keeping to procedures (the course's quick report)
  {
    kind: 'procedure',
    re: new RegExp(`${LB}(?:(?:הפקר(?:ת|ה)?|הפקיר(?:ה|ו)?|השאיר(?:ה|ו)?|שכח(?:ה|ו)?|עזב(?:ה|ו)?)\\s+(?:את\\s+)?(?:ה)?נשק|(?:ה)?נשק\\s+(?:מופקר|הופקר|נשכח|לבד|ללא\\s+השגחה))`),
    w: 7,
    why: 'הפקרת נשק',
    apply: set('procedure', 'weapon_left'),
  },
  { kind: 'procedure', re: new RegExp(`${LB}(?:ה)?נשק\\s+(?:(?:היה|היתה|נמצא)\\s+)?(?:מאחור(?:ה)?|על\\s+הגב|הפוך)`), w: 7, why: 'נשק מאחורה', apply: set('procedure', 'weapon_back') },
  { kind: 'procedure', re: word('טלפון|טלפונים|פלאפון|פלאפונים|סלולרי|סלולר|סמארטפון|נייד'), w: 3, why: 'טלפון', apply: set('procedure', 'phone') },
  { kind: 'procedure', re: word('דיגום|כומתה|כומתות|שרוך|שרוכים|גומיות|גומיה|גומייה|תג\\s+(?:ה)?שם'), w: 5, why: 'דיגום', apply: set('procedure', 'dress') },
  { kind: 'procedure', re: new RegExp(`${LB}(?:אי[\\s-]*עמידה\\s+ב(?:ה)?נהלים|לא\\s+עמד(?:ה|ו)?\\s+ב(?:ה)?(?:נוהל|נהלים)|הפר(?:ה|ו)?\\s+(?:את\\s+)?(?:ה)?נוהל|הפרת\\s+(?:ה)?נוהל)`), w: 5, why: 'אי עמידה בנהלים', apply: set('procedure', 'other') },
  { kind: 'procedure', re: word('נוהל|נהלים'), w: 2, why: 'נוהל' },

  // a visitor at the gate
  { kind: 'entry', re: new RegExp(`${LB}${P}אישור(?:י)?\\s+(?:כניסה|הכנסה)${RB}`), w: 7, why: 'אישור כניסה' },
  { kind: 'entry', re: new RegExp(`${LB}(?:(?:ל)?הכניס(?:ו)?\\s+(?:את\\s+)?|כניסה\\s+ל(?:ה)?בסיס|[יתנ]?גיע(?:ו)?\\s+ל(?:ה)?בסיס|מגיע(?:ה|ים)?\\s+ל(?:ה)?בסיס|יבקר|תבקר|יבקרו)`), w: 4, why: 'מגיע לבסיס' },
  { kind: 'entry', re: word('מבקר|מבקרת|מבקרים|אורח|אורחת|אורחים|ביקור'), w: 2, why: 'מבקר' },
  { kind: 'entry', re: exact('אזרח|אזרחית|אזרחים'), w: 1.5, why: 'אזרח', apply: (f) => (f.entry = { ...(f.entry ?? emptyEntry()), visitorKind: 'civilian' }) },
  { kind: 'entry', re: word('ליווי|מלווה'), w: 1.5, why: 'ליווי' },

  // excused from something
  { kind: 'exemption', re: word('פטור|פטורה|פטורים|הפטור|לפטור|פוטר|פוטרה'), w: 7, why: 'פטור' },
  { kind: 'exemption', re: new RegExp(`${LB}(?:ללא|בלי)\\s+(?:נעליים|נעלים|נעל|כומתה|משקל|ציוד|ריצות|ריצה|הליכה|שמירות)|${LB}${P}סנדלים${RB}`), w: 3, why: 'הגבלה' },
  { kind: 'exemption', re: word('הגבלה|הגבלות|מגבלה|מגבלות|הגבלה\\s+רפואית'), w: 2, why: 'הגבלה' },

  // where a cadet is on a day (filed as an exemption or a note)
  { kind: 'whereabouts', re: word('גימלים|גמלים|גימ"לים'), w: 4, why: 'גימלים', apply: set('attendance', 'sick') },
  { kind: 'whereabouts', re: exact('חולה|חולים|חולת'), w: 2, why: 'חולה', apply: set('attendance', 'sick') },
  {
    kind: 'whereabouts',
    re: new RegExp(`${LB}(?:(?:נשאר(?:ה|ו)?|נמצא(?:ת|ים)?|יצא(?:ה|ו)?|שוחרר(?:ה|ו)?|נסע(?:ה|ו)?|הלך|הלכה|הלכו)\\s+(?:ל)?(?:ה)?בית(?:ה)?|בבית\\s+(?:היום|מחר|השבוע)|הביתה)${RB}`),
    w: 3,
    why: 'בבית',
    apply: set('attendance', 'leave'),
  },
  {
    kind: 'whereabouts',
    re: new RegExp(`${LB}(?:תור\\s+(?:ל|אצל|ב)|${P}(?:מרפאה|מרפאת|קופ"ח|קופת\\s+חולים|בית\\s+חולים|ביה"ח|בי"ח|רופא|רופאה|אורתופד|מיון|בדיקה\\s+רפואית|בדיקות))${RB}`),
    w: 3,
    why: 'תור / בדיקה',
    apply: set('attendance', 'appointment'),
  },
  { kind: 'whereabouts', re: exact('נעדר|נעדרת|נעדרו|נפקד|נפקדה|נפקדו'), w: 3, why: 'נעדר', apply: set('attendance', 'absent') },
  { kind: 'whereabouts', re: new RegExp(`${LB}(?:(?:הגיע|הגיעה|הגיעו|יגיע|תגיע|יגיעו)\\s+באיחור|מאחר(?:ת)?\\s+היום)`), w: 2, why: 'איחור', apply: set('attendance', 'late') },

  // a note in the file
  { kind: 'note', re: exact('הצטיין|הצטיינה|הצטיינו|בלט|בלטה|בלטו|מצטיין|מצטיינת|הפגין|הפגינה|הפגינו|השתפר|השתפרה|השתפרו|התקדם|התקדמה|התקדמו|יוזמה|מקצועי|מקצועית'), w: 3, why: 'הערכה' },
  { kind: 'note', re: word('הערה|הערות|לציין|ציון\\s+לשבח|שבח|מחמאה|כל\\s+הכבוד'), w: 2, why: 'הערה' },
  { kind: 'note', re: word('מוטיבציה|מצב\\s+רוח|מצב\\s+אישי|משפחה|משפחתי|משפחתית|בעיה\\s+אישית|קושי|קשיים|לחוץ|לחוצה|לחץ|געגועים'), w: 2, why: 'מצב אישי' },
  { kind: 'note', re: new RegExp(`${LB}(?:דיברתי|שוחחתי|נפגשתי|ישבתי)\\s+עם`), w: 2, why: 'שיחה' },

  // a staff member away
  { kind: 'absence', re: word('חופש|חופשה|חופשת'), w: 4, why: 'חופשה', apply: set('absenceReason', 'leave') },
  { kind: 'absence', re: new RegExp(`${LB}(?:${P}ימ(?:י|ים)?\\s+מחלה|יום\\s+מחלה|במחלה)${RB}`), w: 4, why: 'מחלה', apply: set('absenceReason', 'sick') },
  { kind: 'absence', re: word('מילואים|תורנות'), w: 4, why: 'מילואים / תורנות', apply: set('absenceReason', 'duty') },
  { kind: 'absence', re: word('השתלמות|הכשרה|סמינר'), w: 3, why: 'השתלמות', apply: set('absenceReason', 'course') },
  { kind: 'absence', re: new RegExp(`${LB}(?:לא\\s+(?:אהיה|אגיע|יהיה|תהיה|יגיע|תגיע|נהיה|נגיע|אהיה\\s+זמין|זמין|זמינה)|${P}חו"ל|היעדרות|נעדר(?:ת)?\\s+(?:מ|ב))`), w: 3.5, why: 'לא יהיה' },

  // a task
  { kind: 'task', re: word('משימה|משימות|מטלה|מטלות'), w: 3, why: 'משימה' },
  { kind: 'task', re: new RegExp(`${LB}(?:צריך|צריכה|צריכים|חייב|חייבת|חייבים|יש)\\s+ל[${HB}]{2,}`), w: 2, why: 'צריך לעשות' },
  { kind: 'task', re: word('תזכורת|להזכיר|תזכיר|תזכירי'), w: 3, why: 'תזכורת' },
  { kind: 'task', re: new RegExp(`${LB}עד\\s+(?:ה|ל)?(?:יום|מחר|היום|סוף|-?\\d)`), w: 2, why: 'דד-ליין' },
  { kind: 'task', re: word('דדליין|דד-ליין|לבצע|לטפל'), w: 1.5, why: 'לבצע' },
  // a sentence that opens with what to do ("להזמין אוטובוס...", "לבדוק את..."): a task - not the words
  // that say where something goes ("לשבועי", "לתחקיר", "לשימור"), and not "לקבוע" (a time: the calendar)
  { kind: 'task', re: new RegExp(`^\\s*ל(?!שבועי|ישיבת|תחקיר|שימור|שיפור|יומן|לו"ז|כל|סגל|הודיע|עדכן|קבוע)[${HB}]{3,}${RB}`), w: 2.5, why: 'מה לעשות' },

  // an event in the calendar
  { kind: 'event', re: word('פגישה|פגישת|ישיבה|ישיבת|שיעור|הרצאה|מסדר|תרגיל|סיור|מטווח|טקס|כנס|אימון|מבחן|בוחן|ארוחה|ארוחת|הסעה|תדריך|הדרכה|סדנה|פעילות|אירוע'), w: 1.5, why: 'פעילות' },
  { kind: 'event', re: word('ביומן|ליומן|בלו"ז|ללו"ז|לוח\\s+זמנים|לקבוע|תקבע|קבע'), w: 3, why: 'ליומן' },

  // the weekly staff meeting
  { kind: 'weekly', re: new RegExp(`${LB}(?:ל|ב)שבועי(?:\\s+(?:ה)?קרוב)?${RB}|${LB}לישיבת\\s+(?:ה)?שבועי`), w: 7, why: 'שבועי' },
  { kind: 'weekly', re: word('סגירה\\s+מקצועית|סגירות\\s+מקצועיות'), w: 4, why: 'סגירה מקצועית', apply: set('weeklyKind', 'closure') },
  { kind: 'weekly', re: new RegExp(`${LB}(?:נושא\\s+לשיח|לשיח|לדיון)${RB}`), w: 3, why: 'נושא לשיח', apply: set('weeklyKind', 'topic') },
  { kind: 'weekly', re: new RegExp(`${LB}הערה\\s+ללו"?ז${RB}`), w: 4, why: 'הערה ללו"ז', apply: set('weeklyKind', 'schedule') },
  { kind: 'weekly', re: word('דגש|דגשים'), w: 2, why: 'דגש', apply: set('weeklyKind', 'point') },

  // this week's debrief
  { kind: 'weekNote', re: new RegExp(`${LB}(?:ל|ב)תחקיר(?:\\s+(?:ה)?שבוע(?:י)?)?${RB}`), w: 6, why: 'תחקיר השבוע' },
  { kind: 'weekNote', re: word('לשימור'), w: 4, why: 'לשימור', apply: set('part', 'sustain') },
  { kind: 'weekNote', re: word('לשיפור'), w: 4, why: 'לשיפור', apply: set('part', 'improve') },
  { kind: 'weekNote', re: word('לקח|לקחים|הפקת\\s+לקחים'), w: 3, why: 'לקח', apply: set('part', 'now') },
  { kind: 'weekNote', re: new RegExp(`${LB}(?:ל|ב)מחזור\\s+(?:ה)?בא${RB}`), w: 3, why: 'למחזור הבא', apply: set('part', 'next') },

  // to all the staff
  {
    kind: 'announcement',
    re: new RegExp(`${LB}(?:${P}הודעה\\s+(?:ל|אל\\s+)(?:כל\\s+)?(?:ה)?סגל|${P}הודעה\\s+לכולם|(?:ל)?עדכן\\s+את\\s+(?:כל\\s+)?(?:ה)?סגל|(?:ל)?הודיע\\s+ל(?:כל\\s+)?(?:ה)?סגל|לכל\\s+הסגל\\s*:|פרסום\\s+(?:ל|אל\\s+)(?:ה)?סגל|תפרסם\\s+ל(?:כל\\s+)?(?:ה)?סגל)`),
    w: 7,
    why: 'הודעה לסגל',
  },
  { kind: 'announcement', re: new RegExp(`(?:^|\\s)(?:ל)?כולם\\s*:`), w: 4, why: 'לכולם' },
];

const URGENT = exact('דחוף|דחופה|בדחיפות|בהול|בהולה');

/** the words a part of the text starts with to say it is about the next thing (a list, numbered) */
const BULLET = /^\s*(?:[-*•·▪◦–]|\d{1,2}[.)]|[א-י]['.)])\s*/;

/**
 * The text cut into the things it holds: its lines, and in each line its sentences. A sentence that
 * names nobody and says nothing of its own place belongs with the one before (the analyzer joins them).
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(BULLET, '').trim();
    if (!line) continue;
    // a sentence ends at ".", "!" or "?" before a space and a letter - not in "ת.ז." or a date ("3.11")
    let start = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== ';') continue;
      const next = line.slice(i + 1);
      if (!/^\s+[֐-׿A-Za-z"]/.test(next)) continue;
      // the word before: an abbreviation with a dot inside it ("ת.ז", "מ.א") or one letter is not an end
      const before = line.slice(start, i).split(/\s+/).pop() ?? '';
      if (/[.]/.test(before) || before.length < 2) continue;
      const s = line.slice(start, i + 1).trim();
      if (s) out.push(s);
      start = i + 1;
    }
    const rest = line.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out;
}

// --- names ---

interface NameSource {
  id: number;
  source: string;
  len: number;
  strength: 'full' | 'part';
  re?: RegExp;
}

/** the names of a list, worked out once per list (a reading looks for them in every sentence) */
const sourceCache = new WeakMap<object, NameSource[]>();
function cached(list: object, make: () => NameSource[]): NameSource[] {
  let s = sourceCache.get(list);
  if (!s) {
    s = make().map((n) => ({ ...n, re: new RegExp(`${LB}${P}(?:${n.source})(?![${HB}\\w\\d])`) }));
    sourceCache.set(list, s);
  }
  return s;
}

/** words too common to be a name on their own */
const COMMON = new Set(['חן', 'טל', 'בן', 'שי', 'גל', 'דור', 'אור', 'שחר', 'ים', 'עד', 'רון', 'לב', 'ניר', 'שקד', 'אל', 'זיו', 'עוז', 'רז', 'נוי', 'עמית', 'שלום', 'אמת', 'עומר', 'צור', 'הדר', 'דניאל', 'מפקד', 'מפקדת', 'קצין', 'קצינה', 'סגן', 'סרן', 'מדריך', 'מדריכה', 'רס"ר', 'ראש', 'סגנית']);

function cadetSources(cadets: SmartCadet[]): NameSource[] {
  return cached(cadets, () => makeCadetSources(cadets));
}

function makeCadetSources(cadets: SmartCadet[]): NameSource[] {
  const out: NameSource[] = [];
  const count = (pick: (c: SmartCadet) => string) => {
    const m = new Map<string, number>();
    for (const c of cadets) {
      const k = normalizeHebrew(pick(c));
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const lasts = count((c) => c.lastName);
  const firsts = count((c) => c.firstName);
  for (const c of cadets) {
    const first = normalizeHebrew(c.firstName);
    const last = normalizeHebrew(c.lastName);
    for (const full of [`${first} ${last}`, `${last} ${first}`]) if (first && last) out.push({ id: c.id, source: looseNameSource(full), len: full.length, strength: 'full' });
    // one name alone: only when no other cadet has it, and it is not a common word
    if (last.length >= 2 && lasts.get(last) === 1 && !COMMON.has(last)) out.push({ id: c.id, source: looseNameSource(last), len: last.length, strength: 'part' });
    if (first.length >= 3 && firsts.get(first) === 1 && !COMMON.has(first)) out.push({ id: c.id, source: looseNameSource(first), len: first.length, strength: 'part' });
  }
  return out.sort((a, b) => b.len - a.len);
}

function staffSources(staff: SmartContext['staff']): NameSource[] {
  return cached(staff, () => makeStaffSources(staff));
}

function makeStaffSources(staff: SmartContext['staff']): NameSource[] {
  const out: NameSource[] = [];
  const firsts = new Map<string, number>();
  for (const u of staff) {
    const f = normalizeHebrew(u.displayName).split(' ')[0];
    if (f) firsts.set(f, (firsts.get(f) ?? 0) + 1);
  }
  for (const u of staff) {
    for (const name of [u.displayName, u.title]) {
      const n = name ? normalizeHebrew(name) : '';
      if (n.length >= 2) out.push({ id: u.id, source: looseNameSource(n), len: n.length, strength: 'full' });
    }
    const first = normalizeHebrew(u.displayName).split(' ')[0];
    if (first && first.length >= 3 && firsts.get(first) === 1 && !COMMON.has(first) && first !== normalizeHebrew(u.displayName)) {
      out.push({ id: u.id, source: looseNameSource(first), len: first.length, strength: 'part' });
    } else if (first && first.length >= 2 && firsts.get(first) === 1 && COMMON.has(first) && first !== normalizeHebrew(u.displayName)) {
      // also a word ("רון", "טל"): a name only where a name is expected - "אחראי רון", "באחריות טל", "- רון",
      // ", רון", or spoken to at the start ("רון, תבדוק...")
      const name = looseNameSource(first);
      out.push({ id: u.id, source: `(?<=(?:אחראי(?:ת)?|באחריות|[-–,])\\s*)${name}|(?<=^\\s*)${name}(?=\\s*,)`, len: first.length, strength: 'part' });
    }
  }
  return out.sort((a, b) => b.len - a.len);
}

interface Hit {
  id: number;
  at: number;
  strength: 'full' | 'part';
}

/** a title without the staff it names as owners ("סגירת מטווח - אחראי גלית" → "סגירת מטווח") */
function dropStaffNames(title: string, ctx: SmartContext, ids: number[]): string {
  if (!ids.length) return title;
  let t = title;
  for (const u of ctx.staff.filter((s) => ids.includes(s.id))) {
    const names = [u.displayName, u.title, u.displayName.split(' ')[0]].filter((x): x is string => !!x && x.trim().length >= 2).sort((a, b) => b.length - a.length);
    for (const n of names) t = t.replace(new RegExp(`${LB}[ול]?(?:${looseNameSource(normalizeHebrew(n))})${RB}`, 'g'), ' ');
  }
  return t
    .replace(new RegExp(`${LB}(?:אחראי(?:ת)?|באחריות)${RB}\\s*:?`, 'g'), ' ')
    .replace(/\s*[-–,:]\s*(?=[-–,:]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,\-–:]+|[\s,\-–:]+$/g, '')
    .trim();
}

/** the people named, in the order they are named; their names are taken out of what is left of the text */
function takePeople(ex: Extractor, sources: NameSource[]): Hit[] {
  const hits: Hit[] = [];
  for (const s of sources) {
    if (hits.some((h) => h.id === s.id)) continue;
    const m = ex.take(s.re ?? new RegExp(`${LB}${P}(?:${s.source})(?![${HB}\\w\\d])`));
    if (m) hits.push({ id: s.id, at: m.index, strength: s.strength });
  }
  return hits.sort((a, b) => a.at - b.at);
}

// --- numbers (taken first: they look like times and dates) ---

interface Numbers {
  phone: string | null;
  idNumber: string | null;
  carNumber: string | null;
  /** the id is a soldier's personal number */
  personal: boolean;
}

const digits = (s: string) => s.replace(/\D/g, '');

function takeNumbers(ex: Extractor): Numbers {
  const out: Numbers = { phone: null, idNumber: null, carNumber: null, personal: false };
  // a car's number: after "רכב" / "מ.ר", or written with dashes as plates are (12-345-67, 123-45-678)
  const car = ex.take(/(?:(?:מספר\s+)?רכב|מ\.?ר\.?|לוחית)\s*:?\s*(\d{2,3}-?\d{2,3}-?\d{2,3})(?![\d])/) ?? ex.take(/(?<![\d-])(\d{2,3}-\d{2,3}-\d{2,3})(?![\d-])/);
  if (car) out.carNumber = car[1];
  // a phone: 05x-xxxxxxx, 0x-xxxxxxx, +972
  const phone = ex.take(/(?<![\d])(?:\+972[-\s]?|0)(5\d|[2-489]|7\d)[-\s]?(\d{3})[-\s]?(\d{4})(?![\d])/);
  if (phone) {
    const d = digits(phone[0]).replace(/^972/, '0');
    out.phone = d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 2)}-${d.slice(2)}`;
  }
  // an id: after its name, or nine digits alone (an ID card); seven alone are a soldier's number
  const named = ex.take(/(ת\.?\s?ז\.?|ת"ז|תז|תעודת\s+זהות|מ\.?\s?א\.?|מ"א|מספר\s+אישי|מס'\s+אישי)\s*:?\s*(\d{5,10})(?![\d])/);
  if (named) {
    out.idNumber = named[2];
    out.personal = /^מ|אישי/.test(named[1]);
  } else {
    const nine = ex.take(/(?<![\d-])(\d{9})(?![\d-])/);
    const seven = nine ? null : ex.take(/(?<![\d-])(\d{7})(?![\d-])/);
    if (nine) out.idNumber = nine[1];
    else if (seven) {
      out.idNumber = seven[1];
      out.personal = true;
    }
  }
  return out;
}

// --- days and hours ---

const DAY_NAMES = WEEKDAY_NAMES.join('|');
const DAY_LETTERS: Record<string, number> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5, ש: 6 };

/** a weekday's date: the coming one (today counts), or the last one (today counts) */
function weekday(today: string, target: number, dir: 'past' | 'future'): string {
  const cur = weekdayOf(today);
  return dir === 'future' ? addDays(today, (target - cur + 7) % 7) : addDays(today, -((cur - target + 7) % 7));
}

/** one day named in words, or null */
function dayOf(text: string, today: string, dir: 'past' | 'future'): string | null {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if (/^(?:ה|ל|ב)?היום$|^הבוקר$|^הערב$|^הלילה$/.test(t)) return today;
  if (/^(?:ל|ב|ה)?מחר$/.test(t)) return addDays(today, 1);
  if (/^(?:ל|ב|ה)?מחרתיים$/.test(t)) return addDays(today, 2);
  if (/^(?:ב|ה)?אתמול$/.test(t)) return addDays(today, -1);
  if (/^(?:ב|ה)?שלשום$/.test(t)) return addDays(today, -2);
  if ((m = t.match(new RegExp(`^(?:(?:ה|ב|ל)?יום\\s+|ב|ל)?(${DAY_NAMES})(?:\\s+(הבא|הקרוב|שעבר))?$`)))) {
    const target = WEEKDAY_NAMES.indexOf(m[1] as (typeof WEEKDAY_NAMES)[number]);
    if (m[2] === 'הבא') {
      const d = weekday(today, target, 'future');
      return d === today ? addDays(d, 7) : d;
    }
    if (m[2] === 'שעבר') {
      const d = weekday(today, target, 'past');
      return d === today ? addDays(d, -7) : d;
    }
    return weekday(today, target, m[2] === 'הקרוב' ? 'future' : dir);
  }
  if ((m = t.match(/^(?:ה|ב|ל)?יום\s+([אבגדהוש])['׳]$/))) return weekday(today, DAY_LETTERS[m[1]], dir);
  if ((m = t.match(/^(?:ה|ב|ל)?-?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/))) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let key = toDateKey(y, mo, d);
    if (!isDateKey(key)) return null;
    // no year: the nearest such day in the direction meant
    if (!m[3]) {
      if (dir === 'future' && key < addDays(today, -60)) key = toDateKey(y + 1, mo, d);
      if (dir === 'past' && key > addDays(today, 60)) key = toDateKey(y - 1, mo, d);
    }
    return key;
  }
  return null;
}

const DAY_WORD = `(?:(?:ה|ב|ל)?(?:היום|מחרתיים|מחר|אתמול|שלשום|הבוקר|הערב|הלילה)|(?:(?:ה|ב|ל)?יום\\s+|ב|ל)(?:${DAY_NAMES})(?:\\s+(?:הבא|הקרוב|שעבר))?|(?:ה|ב|ל)?יום\\s+[אבגדהוש]['׳]|(?:ה|ב|ל)?-?\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?)`;

interface Days {
  date: string | null;
  endDate: string | null;
  /** "עד ..." alone: the last day (a deadline, the end of an exemption) */
  until: string | null;
}

function takeDays(ex: Extractor, today: string, dir: 'past' | 'future'): Days {
  const out: Days = { date: null, endDate: null, until: null };
  // a range: "מ-3.11 עד 5.11", "מיום ראשון עד שלישי", "בין ה-3.11 ל-5.11"
  const range =
    ex.take(new RegExp(`${LB}(?:מ(?:ה|יום)?\\s*-?\\s*|מתאריך\\s+)(${DAY_WORD})\\s*(?:-|עד|ועד)\\s*(?:ה|יום\\s+|ל)?-?(${DAY_WORD})(?![\\d])`)) ??
    ex.take(new RegExp(`${LB}בין\\s+(?:ה|יום\\s+)?-?(${DAY_WORD})\\s+(?:ל|עד)\\s*-?(?:ה|יום\\s+)?(${DAY_WORD})(?![\\d])`));
  if (range) {
    const a = dayOf(range[1], today, dir);
    const b = dayOf(range[2], today, 'future');
    if (a && b) {
      out.date = a;
      out.endDate = b >= a ? b : addDays(b, 7 * Math.ceil(diffDays(a, b) / 7));
      return out;
    }
  }
  const until = ex.take(new RegExp(`${LB}עד\\s+(?:ל|ה)?(${DAY_WORD})(?![\\d])`));
  if (until) {
    const d = dayOf(until[1], today, 'future');
    // "until Thursday" on a Thursday is next week's; "עד היום" stays today
    out.until = d === today && !/היום|הערב|הלילה/.test(until[1]) && /יום|^[בל]/.test(until[1]) && !/\d/.test(until[1]) ? addDays(d, 7) : d;
  }
  // two days with "ו": "היום ומחר", "ביום ראשון ושני"
  const pair = ex.take(new RegExp(`${LB}(${DAY_WORD})\\s+ו(?:ב|ל)?(${DAY_WORD}|${DAY_NAMES})(?![\\d])`));
  if (pair) {
    const a = dayOf(pair[1], today, dir);
    const b = dayOf(pair[2], today, 'future') ?? dayOf(`יום ${pair[2]}`, today, 'future');
    if (a && b) {
      out.date = a < b ? a : b;
      out.endDate = a < b ? b : a;
      return out;
    }
  }
  const single = ex.take(new RegExp(`${LB}(${DAY_WORD})(?![\\d:])`));
  if (single) out.date = dayOf(single[1], today, dir);
  // "בעוד שבוע", "בעוד 3 ימים", "בשבוע הבא", "בסוף השבוע"
  if (!out.date) {
    const inDays = ex.take(new RegExp(`${LB}בעוד\\s+(?:(\\d+)\\s+ימים|(יומיים)|(שבוע)|(שבועיים))${RB}`));
    if (inDays) out.date = addDays(today, inDays[1] ? Number(inDays[1]) : inDays[2] ? 2 : inDays[3] ? 7 : 14);
    else if (ex.take(new RegExp(`${LB}(?:ב|ל)?שבוע\\s+הבא${RB}`))) out.date = addDays(today, 7 - weekdayOf(today));
    else if (ex.take(new RegExp(`${LB}(?:ב|ל|עד\\s+)?סוף\\s+(?:ה)?שבוע${RB}`))) out.date = weekday(today, 4, 'future');
  }
  return out;
}

const HOUR = '([01]?\\d|2[0-3])';
const MIN = '([0-5]\\d)';
const pad = (n: number) => String(n).padStart(2, '0');

function takeHours(ex: Extractor, text: string): { start: string | null; end: string | null } {
  const evening = new RegExp(`${LB}(?:בערב|אחה"?צ|אחר\\s+הצהריים|אחרי\\s+הצהריים|בלילה)${RB}`).test(text);
  const fix = (h: number) => (evening && h < 12 ? h + 12 : h);
  const range = ex.take(new RegExp(`${LB}(?:בין\\s+(?:השעות\\s+)?|מ(?:ה?שעה)?\\s*-?\\s*|ב(?:שעות)?\\s*-?\\s*)?${HOUR}(?::${MIN})?\\s*(?:-|עד|ל-?|ועד)\\s*${HOUR}(?::${MIN})?(?![\\d:./])`));
  if (range && Number(range[3]) >= Number(range[1])) {
    return { start: `${pad(fix(Number(range[1])))}:${range[2] ?? '00'}`, end: `${pad(fix(Number(range[3])))}:${range[4] ?? '00'}` };
  }
  const at = ex.take(new RegExp(`${LB}(?:(?:ב|עד|מ)?(?:שעה|השעה)\\s*-?\\s*|ב\\s*-\\s*|ב-?)${HOUR}(?::${MIN})?(?![\\d:./])`)) ?? ex.take(new RegExp(`(?<![\\d:./])${HOUR}:${MIN}(?![\\d:./])`));
  if (at) return { start: `${pad(fix(Number(at[1])))}:${at[2] ?? '00'}`, end: null };
  const part = ex.take(new RegExp(`${LB}(?:בבוקר|בצהריים|בצהרים|אחה"?צ|אחר\\s+הצהריים|בערב|בלילה)${RB}`));
  if (part) return { start: /בוקר/.test(part[0]) ? '08:00' : /צהר/.test(part[0]) ? '12:00' : /ערב/.test(part[0]) ? '20:00' : /לילה/.test(part[0]) ? '22:00' : '16:00', end: null };
  return { start: null, end: null };
}

// --- a visitor's details ---

const RANKS = ['טוראי', 'טור\'', 'רב"ט', 'רבט', 'סמל', 'סמ"ר', 'סמר', 'רס"ל', 'רסל', 'רס"ר', 'רס"ם', 'רס"מ', 'רס"ב', 'רנ"ג', 'סג"ם', 'סגם', 'סגן', 'סרן', 'רס"ן', 'רסן', 'סא"ל', 'סאל', 'אל"ם', 'אלם', 'תא"ל', 'אלוף', 'רא"ל', 'קמ"א', 'קא"ם'];
const RANK_RE = new RegExp(`${LB}(${RANKS.map((r) => r.replace(/"/g, '"?').replace(/'/g, "'?")).join('|')})${RB}`);
const CAR_BRANDS = 'מאזדה|טויוטה|יונדאי|קיה|סקודה|פולקסווגן|שברולט|פורד|ניסאן|מיצובישי|סוזוקי|הונדה|רנו|פיג\'ו|סיטרואן|סובארו|ב\\.?מ\\.?וו|מרצדס|אאודי|טסלה|סיאט|פיאט|דאצ\'יה|אופל|וולוו|לקסוס|ג\'יפ|MG|BYD|גיאולי|צ\'רי';
const COLORS = 'לבנה|לבן|שחורה|שחור|אפורה|אפור|כסופה|כסוף|כחולה|כחול|אדומה|אדום|ירוקה|ירוק|צהובה|צהוב|חומה|חום|בז\'|כתומה|כתום|זהובה|זהב';

function takeVisitor(ex: Extractor, text: string, n: Numbers): EntryDraft {
  const e = emptyEntry();
  if (n.phone) e.phone = n.phone;
  if (n.idNumber) e.idNumber = n.idNumber;
  // the visitor's name: the words after "אישור כניסה ל" / "עבור" / "למבקר" (a rank may come first), or before "יגיע"
  const RANK_SRC = RANK_RE.source.replace(/^\(\?<!\[[^\]]+\]\)/, '').replace(/\(\?!\[[^\]]+\]\)$/, '');
  const NAME = `((?:(?!היום|מחר|מחרתיים|ביום|בשעה|לצורך|בשביל|כדי|עם|ברכב|רכוב|רגלי|טלפון|ת"ז|תז|יגיע|תגיע|מגיע|מגיעה)[${HB}"'-]{2,}\\s*){1,3})`;
  const named =
    ex.take(new RegExp(`${LB}(?:${P}אישור(?:י)?\\s+(?:כניסה|הכנסה)\\s+(?:ל|עבור\\s+|של\\s+)?|עבור\\s+|למבקר(?:ת)?\\s+|ל?אורח(?:ת)?\\s+|(?:ל)?הכניס\\s+(?:את\\s+)?)(?:${RANK_SRC}\\s+)?${NAME}`)) ??
    ex.take(new RegExp(`^\\s*(?:${RANK_SRC}\\s+)?((?:[${HB}"'-]{2,}\\s+){1,2}[${HB}"'-]{2,})\\s+(?=(?:יגיע|תגיע|מגיע|מגיעה|יבוא|תבוא|יבקר|תבקר)${RB})`));
  if (named) {
    const groups = named.slice(1).filter((g) => g !== undefined);
    const rankHit = groups.find((g) => RANK_RE.test(g) && g.trim().split(/\s+/).length === 1);
    if (rankHit) e.rank = rankHit;
    e.fullName = (groups.find((g) => g !== rankHit) ?? '').replace(/\s+/g, ' ').trim();
  }
  const rank = ex.take(RANK_RE);
  if (rank) e.rank = rank[1];
  e.visitorKind = rank || e.rank || n.personal || exact('חייל|חיילת|קצין|קצינה|נגד|נגדת|במילואים').test(text) ? 'soldier' : 'civilian';
  const clearance = ex.take(new RegExp(`${LB}(?:סיווג|בסיווג)\\s*:?\\s*(שמור|סודי\\s+ביותר|סודי|ללא(?:\\s+סיווג)?|[א-ת]{2,10})`));
  if (clearance) e.clearance = clearance[1];
  if (new RegExp(`${LB}(?:לא\\s+(?:דרוש|צריך|נדרש)\\s+ליווי|בלי\\s+ליווי|ללא\\s+ליווי)`).test(text)) e.escort = false;
  else if (new RegExp(`${LB}(?:דרוש|צריך|נדרש|עם|יש)\\s+ליווי|${LB}בליווי${RB}|${LB}מלווה${RB}`).test(text)) e.escort = true;
  const kind = ex.take(new RegExp(`${LB}(?:${CAR_BRANDS})(?:\\s+[\\w${HB}\\d"'-]{1,12})?(?:\\s+(?:${COLORS}))?${RB}`, 'i'));
  if (kind) e.carKind = kind[0].trim();
  if (n.carNumber) e.carNumber = n.carNumber;
  e.byCar = !!(n.carNumber || kind || new RegExp(`${LB}(?:ברכב|רכוב|רכובה|ברכבו|ברכבה|עם\\s+רכב|מגיע(?:ה)?\\s+ברכב)${RB}`).test(text)) && !new RegExp(`${LB}רגלי(?:ת)?${RB}`).test(text);
  if (!e.fullName) {
    const KEY = /יגיע|תגיע|מגיע|מגיעה|מחר|היום|ביום|בשעה|לבסיס|רכב|ברכב|ליווי|רגלי|טלפון|אישור|כניסה|לצורך|הורה|אבא|אמא|של/;
    const alone = ex
      .remaining()
      .split(/\s*,\s*/)
      .map((p) => p.trim())
      .find((p) => /^[\u0590-\u05FF"'-]{2,}(?:\s+[\u0590-\u05FF"'-]{2,}){1,2}$/.test(p) && !KEY.test(p));
    if (alone) e.fullName = alone;
  }
  const why = ex.take(new RegExp(`${LB}(?:לצורך|בשביל|כדי|מטרת\\s+הביקור|סיבת\\s+(?:ה)?הגעה|סיבה)\\s*:?\\s*(.+)$`));
  if (why) e.reason = why[1].replace(/[.,;]+$/, '').trim();
  else {
    const what = ex.take(new RegExp(`${LB}(?:ל|עבור\\s+)((?:הרצאה|שיחה|פגישה|ביקור|ראיון|מסדר|טקס|כנס|הדרכה|תדריך|ישיבה|סיור|מבחן|טיפול|תיקון|הובלה|משלוח|אירוע)[^,.;]*)`));
    if (what) e.reason = what[1].trim();
  }
  return e;
}

// --- the offense on the ladder ---

/** final letters as their plain forms, so "טלפונים" and "טלפון" compare */
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const unfinal = (s: string) => s.replace(/[ךםןףץ]/g, (c) => FINALS[c]);

/** words that mean the same in a ladder's language (written with plain letters) */
const SAME: [RegExp, string][] = [
  [/^(?:איחר|איחור|מאחר|התאחר)/, 'איחור'],
  [/^(?:טלפונ|פלאפונ|סלולר|נייד|סמארטפונ)/, 'טלפונ'],
  [/^(?:שכח)/, 'שכחה'],
  [/^(?:ישנ$|ישנה$|נרדמ|שינה)/, 'שינה'],
  [/^(?:עישנ|עישונ|סיגרי|מעשנ)/, 'עישונ'],
  [/^(?:הבריז|הברזה|נפקד|נעדר|היעדרות)/, 'היעדרות'],
  [/^(?:מסדר|מיסדר)/, 'מסדר'],
  [/^(?:ציוד|קיטבג|ווסט|אפוד)/, 'ציוד'],
  [/^(?:חוצפ|התחצפ|חצופ|זלזול|זלזל)/, 'חוצפה'],
  [/^(?:שיעור|הרצאה|כיתה|כיתת)/, 'שיעור'],
];

/**
 * The forms a written word may stand for, for comparing: as written, without one or two letters that may
 * come before it ("בהרצאה" is ב+הרצאה, "לטלפון" is ל+טלפון), without a plural ending, each in its plain
 * letters and its common meaning.
 */
function variants(w: string): string[] {
  const base = w.replace(/["'׳״]/g, '');
  const forms = new Set<string>([base]);
  if (base.length > 3 && /^[ובלהמשכ]/.test(base)) forms.add(base.slice(1));
  if (base.length > 4 && /^(?:וה|של|שה|וב|ול|ומ|כש|מה|לה|בה|וש|מש)/.test(base)) forms.add(base.slice(2));
  for (const f of [...forms]) if (f.length > 4) forms.add(f.replace(/(?:ים|ות)$/, ''));
  const out = new Set<string>();
  for (const f of forms) {
    const plain = unfinal(f);
    out.add(SAME.find(([re]) => re.test(plain))?.[1] ?? plain);
  }
  return [...out].filter((x) => x.length > 1);
}

const STOP = new Set(['של', 'את', 'עם', 'על', 'אל', 'או', 'גם', 'לא', 'כל', 'זה', 'זו', 'היה', 'היתה', 'הוא', 'היא', 'מקרה', 'פעם', 'ב', 'ל', 'ה']);
/** a text's words, each as the forms it may stand for */
const wordsOf = (s: string): string[][] =>
  normalizeHebrew(s)
    .split(/[\s,.;:()/\-–]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(variants)
    .filter((v) => v.length);

/** the ladder's offense the words speak of best, and how well (0-1) */
export function matchOffense(text: string, offenses: SmartOffense[]): { key: string; score: number } | null {
  const said = new Set(wordsOf(text).flat());
  if (!said.size) return null;
  const hits = (words: string[][]) => words.filter((forms) => forms.some((f) => said.has(f))).length;
  let best: { key: string; score: number } | null = null;
  for (const o of offenses) {
    const name = wordsOf(o.name);
    if (!name.length) continue;
    const def = o.definition.flatMap(wordsOf);
    const score = Math.min(1, (hits(name) / name.length) * 0.85 + (def.length ? hits(def) / def.length : 0) * 0.3 + (hits(wordsOf(o.category)) ? 0.15 : 0));
    if (score > (best?.score ?? 0)) best = { key: o.key, score };
  }
  return best && best.score >= 0.45 ? best : null;
}

/** the words after a cue, within one of the pieces left of the sentence (names and days taken out cut it) */
function afterCue(ex: Extractor, cue: RegExp, stop: RegExp = /$^/): string {
  for (const piece of ex.pieces()) {
    const m = cue.exec(piece);
    if (!m) continue;
    const after = piece.slice(m.index + m[0].length);
    const end = after.search(stop);
    return (end >= 0 ? after.slice(0, end) : after).replace(/^[\s:,-]+|[\s.,;:-]+$/g, '').trim();
  }
  return '';
}

// --- the rest of the words ---

const LEAD_WORDS = new Set(['תרשום', 'רשום', 'תרשמי', 'לרשום', 'תוסיף', 'הוסף', 'תוסיפי', 'להוסיף', 'תפתח', 'פתח', 'לפתוח', 'תכניס', 'להכניס', 'תעדכן', 'עדכן', 'לעדכן', 'בבקשה', 'צריך', 'יש', 'ש', 'כי', 'ו', 'גם', 'אני', 'אנחנו', 'תקבע', 'קבע', 'לקבוע']);
const TRAIL_WORDS = new Set(['ב', 'ב-', 'מ', 'מ-', 'עד', 'בין', 'ל', 'ל-', 'ו', 'בשעה', 'ביום', 'של', 'עם', 'את', 'על', 'כי', 'ש', 'גם']);

/** what is left of a sentence once its names, days, hours and numbers are taken: tidy, for a title or a text */
function rest(ex: Extractor, drop: RegExp[] = []): string {
  let s = ex.remaining();
  for (const re of drop) s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), ' ');
  let words = s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length && (LEAD_WORDS.has(words[0]) || /^[-:,.;!?]+$/.test(words[0]))) words.shift();
  while (words.length && (TRAIL_WORDS.has(words[words.length - 1]) || /^[-:,.;!?]+$/.test(words[words.length - 1]))) words.pop();
  words = words.map((w, i) => (i === 0 ? w.replace(/^[-:,.;]+/, '') : w));
  return words.join(' ').replace(/\s+([,.:;!?])/g, '$1').replace(/^[,.:;\-\s]+|[,;:\-\s]+$/g, '').trim();
}

/** a heading of a few words from a text: its first clause, cut at a word */
function heading(s: string, max = 70): string {
  const first = s.split(/[,;\n]|\.(?!\d)|:(?!\d)/)[0].trim() || s.trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max).replace(/\s+\S*$/, '')}...`;
}

// --- the reading of one sentence ---

interface Reading {
  scores: Map<ReadKind, number>;
  whys: Map<ReadKind, string[]>;
  fields: SmartFields;
  cadets: Hit[];
  staff: Hit[];
  numbers: Numbers;
  firstPerson: boolean;
}

/** the kinds a sentence speaks of, by its words alone (and the fields those words set) */
function scoreWords(text: string): { scores: Map<ReadKind, number>; whys: Map<ReadKind, string[]>; fields: SmartFields } {
  const scores = new Map<ReadKind, number>();
  const whys = new Map<ReadKind, string[]>();
  const fields = emptyFields();
  const seen = new Set<string>();
  for (const r of RULES) {
    if (!r.re.test(text)) continue;
    // each reason counts once per kind ("איחר" and "איחור" are one)
    const id = `${r.kind}:${r.why}`;
    if (seen.has(id)) continue;
    seen.add(id);
    scores.set(r.kind, (scores.get(r.kind) ?? 0) + r.w);
    whys.set(r.kind, [...(whys.get(r.kind) ?? []), r.why]);
    r.apply?.(fields);
  }
  if (URGENT.test(text)) fields.urgent = true;
  return { scores, whys, fields };
}

const FIRST_PERSON = new RegExp(`${LB}(?:אני|אהיה|אגיע|אצא|אסע|אעדר|לי|שלי|עצמי)${RB}`);

function read(text: string, ctx: SmartContext): Reading {
  const ex = new Extractor(text);
  const numbers = takeNumbers(ex);
  const cadets = takePeople(ex, cadetSources(ctx.cadets));
  const staff = takePeople(ex, staffSources(ctx.staff));
  const { scores, whys, fields } = scoreWords(text);
  const firstPerson = FIRST_PERSON.test(text);
  const add = (k: ReadKind, w: number, why?: string) => {
    scores.set(k, (scores.get(k) ?? 0) + w);
    if (why) whys.set(k, [...(whys.get(k) ?? []), why]);
  };
  const ladder = matchOffense(text, ctx.offenses);
  if (ladder) {
    add('discipline', (1.5 + 3 * ladder.score) * ((scores.get('procedure') ?? 0) >= 3 ? 0.5 : 1));
    fields.offense = ladder.key;
  }
  // a staff member (or the writer) sick, at home or away: an absence, not a cadet's whereabouts
  const att = scores.get('whereabouts') ?? 0;
  if (att && !cadets.length && (staff.length || firstPerson) && fields.attendance && fields.attendance !== 'late') {
    add('absence', Math.max(4, att), fields.attendance === 'sick' ? 'מחלה' : 'לא יהיה');
    if (!fields.absenceReason) fields.absenceReason = fields.attendance === 'sick' ? 'sick' : fields.attendance === 'leave' ? 'leave' : 'other';
  }
  // a staff member "בקורס" / "בהשתלמות": away on a course (a cadet "בקורס" is only in the course)
  if (staff.length && !cadets.length && new RegExp(`${LB}(?:בקורס|בהשתלמות|בהכשרה)${RB}`).test(text)) {
    add('absence', 3.5, 'בקורס');
    if (!fields.absenceReason) fields.absenceReason = 'course';
  }
  // who it is about tells as much as the words
  if (cadets.length) {
    for (const k of READ_CADET_KINDS) if (scores.has(k)) add(k, 1.5);
    add('note', 1.2);
  } else {
    for (const k of READ_CADET_KINDS) if (scores.has(k)) scores.set(k, scores.get(k)! * 0.45);
  }
  // a staff member away, or the writer: an absence; a cadet away: their whereabouts
  if (scores.has('absence')) {
    if (staff.length || firstPerson) add('absence', 1.5);
    else if (cadets.length) {
      add('whereabouts', scores.get('absence')! * 0.8, whys.get('absence')?.[0]);
      if (!fields.attendance) fields.attendance = fields.absenceReason === 'sick' ? 'sick' : 'leave';
      scores.set('absence', scores.get('absence')! * 0.3);
    }
  }
  if (numbers.phone) add('entry', 2, 'טלפון');
  if (numbers.idNumber) add('entry', 2.5, numbers.personal ? 'מספר אישי' : 'ת"ז');
  if (numbers.carNumber) add('entry', 2, 'מספר רכב');
  if (RANK_RE.test(text) && scores.has('entry')) add('entry', 1);
  if (staff.length) {
    add('task', 1);
    if (scores.has('event')) add('event', 0.5);
  }
  if (new RegExp(`${HOUR}(?::${MIN})?\\s*(?:-|עד)\\s*${HOUR}(?::${MIN})?`).test(text) && scores.has('event')) add('event', 2.5, 'שעות');
  else if (/\d{1,2}:\d{2}|בשעה/.test(text)) add('event', 1);
  // nothing else said: a task when it says to do something, otherwise a note about the cadet
  add('task', 0.6);
  return { scores, whys, fields, cadets, staff, numbers, firstPerson };
}

/** does a sentence say anything of its own - a name, or a word that places it? */
function anchored(text: string, ctx: SmartContext): boolean {
  const r = read(text, ctx);
  if (r.cadets.length || r.staff.length || r.numbers.phone || r.numbers.idNumber) return true;
  for (const [k, s] of r.scores) if (k !== 'task' && k !== 'note' && s >= 3) return true;
  return (r.scores.get('task') ?? 0) >= 3;
}

/** a part of a sentence says where it goes by itself: a kind's words weigh enough (a cadet's kinds need the cadet) */
function strongKind(text: string, ctx: SmartContext): ReadKind | null {
  const r = read(text, ctx);
  let best: ReadKind | null = null;
  let top = 0;
  for (const [k, sc] of r.scores) {
    if (k === 'task' || k === 'note') continue;
    if (sc >= 4 && sc > top && (!READ_CADET_KINDS.includes(k) || r.cadets.length)) {
      best = k;
      top = sc;
    }
  }
  return best;
}

/**
 * A sentence cut where it turns to another matter - at a comma or an "ו" - when each side says where it
 * goes by itself: "דני כהן איחר למסדר ויוסי לוי הפקיר נשק" is two things, "דני כהן ויוסי לוי איחרו" one.
 */
function splitClauses(sentence: string, ctx: SmartContext): string[] {
  const parts = sentence.split(/,\s*|\s+(?=ו[\u0590-\u05FF]{2})/).filter((p) => p.trim());
  if (parts.length < 2) return [sentence];
  const strong = parts.map((p) => strongKind(p, ctx));
  if (strong.filter(Boolean).length < 2) return [sentence];
  const groups: { text: string; strong: boolean }[] = [];
  let pending = '';
  parts.forEach((p, i) => {
    const sep = (prev: string) => (/,\s*$/.test(prev) || !p.startsWith('ו') ? ', ' : ' ');
    if (strong[i]) {
      groups.push({ text: pending ? `${pending}${sep(pending)}${p}` : p, strong: true });
      pending = '';
    } else if (groups.length) groups[groups.length - 1].text += `${sep(groups[groups.length - 1].text)}${p}`;
    else pending = pending ? `${pending} ${p}` : p;
  });
  return groups.map((g) => g.text.trim());
}

/** the text's things: its sentences (and their clauses), each joined to the one before when it says nothing of its own */
export function splitSegments(text: string, ctx: SmartContext): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    let first = true;
    for (const sentence of splitSentences(line)) {
      for (const s of splitClauses(sentence, ctx)) {
        // a part that names nobody and says nothing of its own place belongs with the one before it - in
        // its own line: a new line is a new thing, as the writer is asked to write them
        if (!first && out.length && !anchored(s, ctx)) out[out.length - 1] = `${out[out.length - 1]} ${s}`;
        else out.push(s);
        first = false;
      }
    }
  }
  return out;
}

const confidence = (top: number, second: number, complete: boolean): SmartConfidence => (top >= 6 && top - second >= 2 && complete ? 'high' : top >= 3 && complete ? 'medium' : top >= 4.5 ? 'medium' : 'low');

let seq = 0;
const newKey = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The built-in reading: each thing the text holds, placed and filled as far as its words go. */
export function analyzeLocal(input: string, ctx: SmartContext): SmartItem[] {
  const tz = ctx.tz ?? DEFAULT_TZ;
  const now = ctx.now ?? new Date();
  const today = localDateKey(now, tz);
  // the base's entry format pasted as it came (one or several): each is an entry approval, read field by
  // field - the rest of the text is read as any other
  const { items, rest } = entryFormats(input);
  for (const raw of splitSegments(rest, ctx)) {
    const text = normalizeHebrew(raw);
    if (!text) continue;
    const r = read(text, ctx);
    const ranked = [...r.scores.entries()].sort((a, b) => b[1] - a[1]);
    const read1 = ranked[0][0];
    const cadetIds = r.cadets.map((h) => h.id);
    const filled = fill(read1, text, r, ctx, today, now, tz);
    const { kind, fields: base } = read1 === 'whereabouts' ? fromWhereabouts(filled, today) : { kind: read1, fields: filled };
    const alternatives = ranked
      .slice(1)
      .map(([k]) => (k === 'whereabouts' ? 'note' : k))
      .filter((k, i) => ranked[i + 1][1] >= (k === 'event' ? 2.5 : 2) && k !== kind)
      .slice(0, 3);
    const complete = smartMissing({ kind, fields: base }).length === 0;
    const why = whyOf(read1, r, ctx);
    const conf = confidence(ranked[0][1], ranked[1]?.[1] ?? 0, complete);
    // one item for each cadet named, when it is about cadets
    const fan = CADET_KINDS.includes(kind) && cadetIds.length > 1 ? cadetIds : [base.cadetId];
    for (const cadetId of fan) {
      items.push({ key: newKey(), kind, confidence: conf, source: raw.trim(), why, fields: { ...base, cadetId, dress: [...base.dress], ownerIds: [...base.ownerIds], entry: base.entry ? { ...base.entry } : null }, alternatives });
    }
  }
  return items;
}

/** the base's entry format in a text: an item for each message, and what is left of the text */
export function entryFormats(input: string): { items: SmartItem[]; rest: string } {
  const { entries, rest } = parseEntryMessages(input);
  const items = entries.map(({ fields: e }): SmartItem => {
    const fields: SmartFields = { ...emptyFields(), entry: e };
    const complete = smartMissing({ kind: 'entry', fields }).length === 0;
    return {
      key: newKey(),
      kind: 'entry',
      confidence: complete ? 'high' : 'medium',
      source: e.fullName,
      why: 'פורמט אישור כניסה',
      fields,
      alternatives: [],
    };
  });
  return { items, rest };
}

function whyOf(kind: ReadKind, r: Reading, ctx: SmartContext): string {
  const parts: string[] = [];
  const cadet = r.cadets[0] && ctx.cadets.find((c) => c.id === r.cadets[0].id);
  if (READ_CADET_KINDS.includes(kind) && cadet) parts.push(r.cadets.length > 1 ? `${r.cadets.length} צוערים` : `צוער: ${cadet.firstName} ${cadet.lastName}`);
  const words = [...new Set(r.whys.get(kind) ?? [])];
  if (words.length) parts.push(words.slice(0, 3).map((w) => `"${w}"`).join(', '));
  if (kind === 'discipline' && r.fields.offense) parts.push(`במדרג: ${r.fields.offense.split(' · ').pop()}`);
  return parts.join(' · ') || 'לפי מילות המשפט';
}

/**
 * A cadet's whereabouts, filed where the course keeps them: sick (גימלים) is an exemption until its last day
 * - the staff are told; at home, at an appointment, absent or late is a note in the cadet's file.
 */
function fromWhereabouts(f: SmartFields, today: string): { kind: SmartKind; fields: SmartFields } {
  const status = f.attendance ?? 'absent';
  const start = f.date ?? today;
  if (status === 'sick') return { kind: 'exemption', fields: { ...f, subject: 'גימלים', until: f.endDate ?? start, date: start } };
  const days = f.endDate && f.endDate > start ? `${shortDate(start)} - ${shortDate(f.endDate)}` : start === today ? 'היום' : shortDate(start);
  const label = ATTENDANCE_LABELS[status];
  return { kind: 'note', fields: { ...f, date: start, title: `${label} · ${days}`, details: f.details ? `${label} ${days}: ${f.details}` : `${label} ${days}` } };
}

/** the fields of the kind chosen, from the sentence */
function fill(kind: ReadKind, text: string, r: Reading, ctx: SmartContext, today: string, now: Date, tz: string): SmartFields {
  const f: SmartFields = { ...emptyFields(), ...pickSet(r.fields, kind) };
  const ex = new Extractor(text);
  takeNumbers(ex);
  if (kind !== 'entry' && kind !== 'announcement' && kind !== 'weekly' && kind !== 'weekNote') {
    takePeople(ex, cadetSources(ctx.cadets));
    takePeople(ex, staffSources(ctx.staff));
  }
  f.cadetId = READ_CADET_KINDS.includes(kind) ? (r.cadets[0]?.id ?? null) : null;
  switch (kind) {
    case 'discipline': {
      const days = takeDays(ex, today, 'past');
      f.date = days.date && days.date <= today ? days.date : today;
      const offense = matchOffense(text, ctx.offenses);
      if (offense) f.offense = offense.key;
      r.fields.offense = f.offense;
      f.details = rest(ex, [new RegExp(`${LB}${P}הער(?:ת|ות)\\s+משמעת${RB}`)]).replace(/^(?:על|בגלל|עקב)\s+/, '');
      f.title = f.offense ? (f.offense.split(' · ').pop() ?? '') : heading(f.details, 60);
      break;
    }
    case 'procedure': {
      takeDays(ex, today, 'past');
      if (!f.procedure) f.procedure = 'other';
      if (f.procedure === 'dress') {
        f.dress = DRESS_ITEMS.filter((d) => {
          if (d === 'שרוך') return word('שרוך|שרוכים').test(text);
          if (d === 'גומיות') return word('גומיות|גומיה|גומייה').test(text);
          if (d === 'תג שם') return word('תג\\s+(?:ה)?שם').test(text);
          return word(d).test(text);
        });
      }
      const words = rest(ex, [/אי[\s-]*עמידה\s+ב(?:ה)?נהלים/]);
      if (f.procedure === 'phone')
        f.situation = words
          .replace(new RegExp(`(?:${LB}(?:היה|היתה|הייתה|נתפס|נתפסה|נתפסו|נמצא|נמצאה|השתמש|השתמשה|שיחק|שיחקה|דיבר|דיברה)\\s+)?(?:(?:עם|ב)\\s*)?(?:ה)?(?:טלפון|פלאפון|נייד|סלולרי|סמארטפון)${RB}`, 'g'), ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 300);
      else if (f.procedure === 'other') f.other = heading(words, 80).replace(/\.\.\.$/, '');
      f.details = f.procedure === 'phone' ? '' : words;
      break;
    }
    case 'entry': {
      const days = takeDays(ex, today, 'future');
      f.date = days.date ?? days.until;
      takeHours(ex, text);
      f.entry = { ...takeVisitor(ex, text, r.numbers), ...(r.fields.entry?.visitorKind && !r.numbers.personal && !RANK_RE.test(text) ? { visitorKind: r.fields.entry.visitorKind } : {}) };
      break;
    }
    case 'exemption': {
      const days = takeDays(ex, today, 'future');
      f.until = days.until ?? days.endDate;
      const stop = new RegExp(`\\s+(?:עד|בגלל|עקב|בעקבות|לאור|כי|מסיבות|בשל|לפי|על\\s+פי)${RB}|[,.;]`);
      f.subject = afterCue(ex, new RegExp(`${LB}${P}(?:פטור|פטורה|פטורים|לפטור|פוטר|פוטרה)\\s+(?:את\\s+\\S+\\s+)?מ(?:ה)?`), stop).slice(0, 80);
      if (!f.subject) f.subject = afterCue(ex, new RegExp(`${LB}(?:ללא|בלי)\\s+`), stop).slice(0, 80);
      const reason = afterCue(ex, new RegExp(`${LB}(?:בגלל|עקב|בעקבות|לאור|מסיבות|בשל|כי)\\s+`));
      const lead = afterCue(ex, new RegExp(`${LB}(?:לפי|על\\s+פי)\\s+`));
      f.details = [reason, lead && `לפי ${lead}`].filter(Boolean).join(' · ').slice(0, 300);
      break;
    }
    case 'whereabouts': {
      const days = takeDays(ex, today, 'future');
      f.date = days.date ?? today;
      f.endDate = days.endDate && days.endDate > f.date ? days.endDate : null;
      if (!f.attendance) f.attendance = 'absent';
      f.details = rest(ex, [new RegExp(`${LB}${P}(?:מצבה|גימלים|גמלים|חולה|חולת|נעדר|נעדרת|נפקד|נפקדה)${RB}`), new RegExp(`${LB}${P}בית${RB}|${LB}הביתה${RB}`), /(?:נשאר|נשארה|נמצא|נמצאת|יצא|יצאה|שוחרר|שוחררה|נסע|נסעה)\s+(?=$|[,.])/]).slice(0, 200);
      break;
    }
    case 'note': {
      const days = takeDays(ex, today, 'past');
      f.date = days.date && days.date <= today ? days.date : today;
      f.details = rest(ex);
      f.title = heading(f.details, 60);
      break;
    }
    case 'absence': {
      const days = takeDays(ex, today, 'future');
      f.date = days.date ?? (days.until ? today : null);
      f.endDate = days.endDate ?? days.until ?? f.date;
      f.userId = r.staff[0]?.id ?? (r.firstPerson ? ctx.me : null) ?? ctx.me;
      if (!f.absenceReason) f.absenceReason = 'other';
      f.details = rest(ex, [/חופש(?:ה|ת)?|מילואים|תורנות|השתלמות|יום\s+מחלה|ימי\s+מחלה|לא\s+(?:אהיה|יהיה|תהיה|יגיע|תגיע|אגיע)/]).slice(0, 300);
      break;
    }
    case 'task': {
      const users = ctx.staff.map((u) => ({ id: u.id, displayName: u.displayName, title: u.title, username: u.username }));
      const plain = text.replace(new RegExp(`^(?:(?:תזכיר(?:י)?|להזכיר)\\s+(?:לי|ל[${HB}]+)\\s+|תזכורת\\s*:?\\s*|(?:צריך|צריכה|צריכים|חייב|חייבת|חייבים|יש)\\s+(?=ל[${HB}]{2}))`), '');
      const t = parseTaskText(plain, { users, now, tz });
      f.title = t.title || heading(rest(ex), 80);
      // the owners: as the task parser read them, else the staff named anywhere in it (a first name too,
      // "אחראי גלית", "רון וגלית") - their names then leave the title - else the writer
      const named = [...new Set(r.staff.map((h) => h.id))];
      f.ownerIds = t.ownerIds.length ? t.ownerIds : named.length ? named : [ctx.me];
      if (!t.ownerIds.length && named.length) f.title = dropStaffNames(f.title, ctx, named) || f.title;
      f.date = t.deadlineDate;
      f.time = t.deadlineTime;
      f.priority = t.priority;
      if (r.fields.urgent && !f.priority) f.priority = 'high';
      break;
    }
    case 'event': {
      const users = ctx.staff.map((u) => ({ id: u.id, displayName: u.displayName, title: u.title, username: u.username }));
      const e = parseEventText(text, { users, defaultDate: today, now, tz });
      e.title = e.title.replace(new RegExp(`${LB}(?:(?:ב|ל)?שבוע\\s+(?:ה)?(?:בא|הבא|קרוב)|בעוד\\s+(?:שבוע|שבועיים|יומיים|\\d+\\s+ימים))${RB}`, 'g'), ' ').replace(/\s+/g, ' ').trim();
      f.title = e.title;
      if (!e.location) {
        const place = /\s+ב((?:חדר|כיתת|כיתה|אולם|מגרש|שטח|מטווח|מועדון|בסיס|מתחם|קומה|משרד|לשכת|רחבת|רחבה|חדר\s+האוכל|מגורי|בית)[^,.;]*)$/.exec(e.title);
        if (place) {
          e.location = place[1].trim();
          f.title = e.title.slice(0, place.index).trim();
        }
      }
      f.date = e.date;
      f.time = e.startTime;
      f.endTime = e.endTime;
      f.location = e.location;
      f.ownerIds = e.ownerId ? [e.ownerId] : [];
      break;
    }
    case 'weekly': {
      if (!f.weeklyKind) f.weeklyKind = 'topic';
      f.ownerIds = r.staff.map((h) => h.id).slice(0, 1);
      const words = dropStaffNames(
        rest(ex, [/(?:ל|ב)שבועי(?:\s+(?:ה)?קרוב)?|לישיבת\s+(?:ה)?שבועי|סגירה\s+מקצועית|נושא\s+לשיח|לשיח|לדיון|הערה\s+ללו"?ז|דגש(?:ים)?/])
          .replace(f.ownerIds.length ? /,?\s*(?:אחראי(?:ת)?|באחריות|אחריות)\s*:?\s*[^,.;]*$/ : /$^/, '')
          .trim(),
        ctx,
        f.ownerIds,
      );
      f.title = heading(words, 120).replace(/\.\.\.$/, '');
      f.details = words.length > f.title.length ? words : '';
      break;
    }
    case 'weekNote': {
      if (!f.part) f.part = 'improve';
      f.ownerIds = r.staff.map((h) => h.id).slice(0, 1);
      f.details = rest(ex, [/(?:ל|ב)תחקיר(?:\s+(?:ה)?שבוע(?:י)?)?|לשימור|לשיפור|(?:ל|ב)מחזור\s+(?:ה)?בא/, new RegExp(`${LB}(?:לקח|לקחים)\\s*:?`)]).replace(/^[:\s]+/, '');
      break;
    }
    case 'announcement': {
      const ann = new Extractor(text);
      const words = rest(ann, [/(?:ה)?הודעה\s+(?:ל|אל\s+)(?:כל\s+)?(?:ה)?סגל|(?:ה)?הודעה\s+לכולם|(?:ל)?עדכן\s+את\s+(?:כל\s+)?(?:ה)?סגל|(?:ל)?הודיע\s+ל(?:כל\s+)?(?:ה)?סגל|לכל\s+הסגל\s*:?|פרסום\s+(?:ל|אל\s+)(?:ה)?סגל|תפרסם\s+ל(?:כל\s+)?(?:ה)?סגל/, URGENT]);
      f.title = heading(words, 80).replace(/\.\.\.$/, '');
      f.details = words.length > f.title.length + 3 ? words : '';
      break;
    }
  }
  return f;
}

/** only the fields the words set that belong to the kind chosen */
function pickSet(f: SmartFields, kind: ReadKind): Partial<SmartFields> {
  switch (kind) {
    case 'discipline':
      return { formal: f.formal };
    case 'procedure':
      return { procedure: f.procedure };
    case 'whereabouts':
      return { attendance: f.attendance };
    case 'absence':
      return { absenceReason: f.absenceReason };
    case 'weekly':
      return { weeklyKind: f.weeklyKind };
    case 'weekNote':
      return { part: f.part };
    case 'announcement':
      return { urgent: f.urgent };
    case 'task':
      return { priority: f.urgent ? 'high' : null };
    default:
      return {};
  }
}

/** visitor kinds, for whoever needs the list */
export const VISITOR_KIND_OPTIONS: VisitorKind[] = ['civilian', 'soldier'];

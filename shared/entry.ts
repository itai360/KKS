// A request to let a visitor into the base (אישור כניסה): its fields, the message in the format the base asks
// for - bold labels, ready for WhatsApp, line by line as the base's own form - and the reading of that same
// message pasted back (one or several), so a format received in WhatsApp fills the request by itself. The
// camp's and the unit's names are the course's own (settings) or the pasted message's, never written here.

import { addDays, parseDateKey, toDateKey } from './dates';

export const VISITOR_KINDS = ['civilian', 'soldier'] as const;
export type VisitorKind = (typeof VISITOR_KINDS)[number];
export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = { civilian: 'אזרח', soldier: 'חייל' };

export interface EntryFields {
  visitDate: string;
  /** the last day of a visit of several days ("30-31/10"); '' for one day */
  visitEndDate: string;
  fullName: string;
  phone: string;
  visitorKind: VisitorKind;
  /** a soldier's */
  rank: string;
  clearance: string;
  /** a soldier's personal number, or an ID number */
  idNumber: string;
  escort: boolean;
  byCar: boolean;
  /** a military vehicle (רכב צבאי) rather than a private one */
  carMilitary: boolean;
  carNumber: string;
  /** its make and color */
  carKind: string;
  reason: string;
  /** where the visitor comes, as a pasted message said it: '' - the course's own (settings) */
  unit: string;
  camp: string;
}

/** a request with nothing in it yet */
export const emptyEntryFields = (): EntryFields => ({
  visitDate: '',
  visitEndDate: '',
  fullName: '',
  phone: '',
  visitorKind: 'civilian',
  rank: '',
  clearance: '',
  idNumber: '',
  escort: false,
  byCar: false,
  carMilitary: false,
  carNumber: '',
  carKind: '',
  reason: '',
  unit: '',
  camp: '',
});

/** where the visitor comes: the camp in the title, the unit on its first line */
export interface EntryPlace {
  camp: string;
  unit: string;
}

/** "27.10.2026" */
export function fullDate(key: string): string {
  const { year, month, day } = parseDateKey(key);
  return `${day}.${month}.${year}`;
}

/** the days of a visit as the base's form writes them: "30/10", "30-31/10", "30/10-2/11" */
export function visitDays(start: string, end = ''): string {
  if (!start) return '';
  const a = parseDateKey(start);
  if (!end || end <= start) return `${a.day}/${a.month}`;
  const b = parseDateKey(end);
  return a.month === b.month && a.year === b.year ? `${a.day}-${b.day}/${a.month}` : `${a.day}/${a.month}-${b.day}/${b.month}`;
}

/** the same, with the year: for a notification, a list */
export function visitDaysLong(start: string, end = ''): string {
  if (!start) return '';
  if (!end || end <= start) return fullDate(start);
  const a = parseDateKey(start);
  const b = parseDateKey(end);
  return a.year === b.year && a.month === b.month ? `${a.day}-${b.day}.${a.month}.${a.year}` : `${fullDate(start)} - ${fullDate(end)}`;
}

/** what is still missing for the base - its labels, in the form's order */
export function entryMissing(e: EntryFields): string[] {
  const missing: string[] = [];
  if (!e.fullName.trim()) missing.push('שם מלא');
  if (!e.visitDate) missing.push('תאריך');
  if (!e.phone.trim()) missing.push('טלפון');
  if (e.visitorKind === 'soldier' && !e.rank.trim()) missing.push('דרגה');
  if (!e.idNumber.trim()) missing.push(e.visitorKind === 'soldier' ? 'מספר אישי' : 'ת"ז');
  if (e.byCar && !e.carNumber.trim()) missing.push('מספר רכב');
  if (e.byCar && !e.carKind.trim()) missing.push('סוג וצבע רכב');
  if (!e.reason.trim()) missing.push('סיבת הגעה');
  return missing;
}

/**
 * The message, line by line in the base's format - its labels exactly as the base writes them, a line that
 * does not apply to this visitor left empty after its label. The camp and the unit: the request's own (a
 * pasted message's), else the course's.
 */
export function entryMessage(e: EntryFields, place: EntryPlace): string {
  const camp = (e.camp || place.camp).trim();
  const unit = (e.unit || place.unit).trim();
  const line = (label: string, value: string) => (value.trim() ? `${label} ${value.trim()}` : label);
  return [
    `*🔵פורמט אישור כניסה${camp ? ` ל${camp}` : ''} 🔵*`,
    '',
    line('*תאריך:*', visitDays(e.visitDate, e.visitEndDate)),
    line('*יחידה אליה המבקר מגיע:*', unit),
    line('*שם מלא:*', e.fullName),
    line("*מס' טלפון:*", e.phone),
    line('*אזרח/חייל:*', VISITOR_KIND_LABELS[e.visitorKind]),
    line('*דרגה:*', e.visitorKind === 'soldier' ? e.rank : ''),
    line('*סיווג ביטחוני:*', e.clearance),
    line('*נדרש ליווי/ לא נדרש ליווי:*', e.escort ? 'נדרש' : 'לא נדרש'),
    line('*מספר אישי/ת״ז :*', e.idNumber),
    line('*רגלי/רכוב:*', e.byCar ? 'רכוב' : 'רגלי'),
    line('*סיבת הגעה :*', e.reason),
    line('*רכב צבאי/אזרחי:*', e.byCar ? (e.carMilitary ? 'צבאי' : 'אזרחי') : ''),
    line('*מספר רכב:*', e.byCar ? e.carNumber : ''),
    line('*סוג וצבע רכב*:', e.byCar ? e.carKind : ''),
  ].join('\n');
}

// ---------------- the message pasted back ----------------

/** a pasted message: the request it holds, and which of its fields it gave */
export interface ParsedEntry {
  fields: EntryFields;
  /** the fields the message gave a value to */
  found: (keyof EntryFields)[];
}

/** WhatsApp's marks, emoji and the invisible direction marks: none of them part of a label or a value */
const MARKS = /[*_~`‎‏‪-‮⁦-⁩️‍]|[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const TITLE = /פורמט\s+(?:ל)?אישור\s+כניסה/;

/** a label as it is compared: no marks, spaces, quotes or dots ("מספר אישי/ת״ז :" → "מספראישי/תז") */
const labelKey = (s: string) => s.replace(MARKS, '').replace(/[\s'"״׳`.:\-–]/g, '');

/** each label of the form to its field - the more particular first ("רכב צבאי/אזרחי" before "אזרח/חייל") */
const LABELS: [RegExp, keyof EntryFields][] = [
  [/רכב.*(?:צבאי|אזרחי)|(?:צבאי|אזרחי).*רכב|^רכב$/, 'carMilitary'],
  [/מספררכב|מסרכב|^מר$|לוחית|רישוי/, 'carNumber'],
  [/סוג|צבע/, 'carKind'],
  [/תאריך|מועד|^מתי$/, 'visitDate'],
  [/יחידה/, 'unit'],
  [/שם/, 'fullName'],
  [/טלפון|נייד|פלאפון|^טל$/, 'phone'],
  [/חייל|אזרח/, 'visitorKind'],
  [/דרגה/, 'rank'],
  [/סיווג/, 'clearance'],
  [/ליווי/, 'escort'],
  [/אישי|תז|זהות|^מא$/, 'idNumber'],
  [/רגלי|רכוב/, 'byCar'],
  [/סיב|מטר/, 'reason'],
];

/** a value as written, without WhatsApp's marks; a lone "-" says nothing */
const valueOf = (s: string) => {
  const v = s.replace(MARKS, '').replace(/\s+/g, ' ').trim();
  return /^[-–—.]*$/.test(v) ? '' : v;
};

/** a day of a pasted date: its year as written, else the one that keeps it ahead (a visit is to come) */
function dayKey(day: number, month: number, year: string | undefined, today: string): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  let y = year ? (year.length <= 2 ? 2000 + Number(year) : Number(year)) : parseDateKey(today).year;
  if (day > new Date(Date.UTC(y, month, 0)).getUTCDate()) return null;
  if (!year && toDateKey(y, month, day) < addDays(today, -30)) y += 1;
  return day > new Date(Date.UTC(y, month, 0)).getUTCDate() ? null : toDateKey(y, month, day);
}

/** "30-31/10", "30/10", "30.10.2026", "30/10-2/11" → the first and last day ('' when one) */
export function parseVisitDays(raw: string, today: string): { start: string; end: string } | null {
  const m = /(\d{1,2})\s*(?:[-–]\s*(\d{1,2})\s*)?[./\\]\s*(\d{1,2})(?:\s*[./\\]\s*(\d{4}|\d{2}))?(?:\s*(?:[-–]|עד)\s*(\d{1,2})\s*[./\\]\s*(\d{1,2})(?:\s*[./\\]\s*(\d{4}|\d{2}))?)?/.exec(raw);
  if (!m) return null;
  const start = dayKey(Number(m[1]), Number(m[3]), m[4], today);
  if (!start) return null;
  const year = parseDateKey(start).year;
  const endDay = Number(m[2] ?? m[5] ?? 0);
  const endMonth = Number(m[2] ? m[3] : (m[6] ?? 0));
  const endYear = m[2] ? m[4] : m[7];
  let end = endDay ? dayKey(endDay, endMonth, endYear ?? String(year), today) : null;
  // over the turn of a year ("30/12-2/1"): the end falls in the next one
  if (end && end < start && !endYear) end = dayKey(endDay, endMonth, String(year + 1), today);
  return { start, end: end && end > start ? end : '' };
}

/** each field from its value as the form says it ("לא נדרש", "רכוב", "אזרחי"...) */
function setField(f: EntryFields, key: keyof EntryFields, v: string, today: string): boolean {
  switch (key) {
    case 'visitDate': {
      const days = parseVisitDays(v, today);
      if (!days) return false;
      f.visitDate = days.start;
      f.visitEndDate = days.end;
      return true;
    }
    case 'visitorKind':
      if (/חייל|חיילת|קבע|סדיר|מילואים|קצין|קצינה|נגד|נגדת/.test(v)) f.visitorKind = 'soldier';
      else if (/אזרח/.test(v)) f.visitorKind = 'civilian';
      else return false;
      return true;
    case 'escort':
      if (!v) return false;
      f.escort = !/^לא|לא\s*(?:נדרש|דרוש|צריך)/.test(v) && /נדרש|דרוש|צריך|כן|^ליווי/.test(v);
      return true;
    case 'byCar':
      if (/רכוב|רכב/.test(v)) f.byCar = true;
      else if (/רגלי|ברגל/.test(v)) f.byCar = false;
      else return false;
      return true;
    case 'carMilitary':
      if (/צבאי/.test(v)) f.carMilitary = true;
      else if (/אזרחי|פרטי/.test(v)) f.carMilitary = false;
      else return false;
      return true;
    case 'idNumber':
      f.idNumber = v.replace(/\D/g, '').slice(0, 10);
      return !!f.idNumber;
    case 'phone':
      f.phone = v.replace(/[^\d+\-\s()]/g, '').trim().slice(0, 20);
      return !!f.phone;
    case 'carNumber':
      f.carNumber = v.replace(/[^\d-]/g, '').slice(0, 20);
      return !!f.carNumber;
    case 'fullName':
    case 'rank':
    case 'clearance':
    case 'carKind':
    case 'reason':
    case 'unit': {
      const max = key === 'reason' ? 300 : key === 'carKind' ? 60 : key === 'fullName' || key === 'unit' ? 80 : 30;
      f[key] = v.slice(0, max);
      return !!f[key];
    }
    default:
      return false;
  }
}

/**
 * Reads the base's format pasted back - as WhatsApp hands it on, labels in bold, in any order, with or
 * without its title - into requests, one for each message in the text (a new title, or a label said a second
 * time, starts the next). A text with fewer than three of the form's labels is not one. `rest`: the lines of
 * the text that are none of the messages.
 */
export function parseEntryMessages(text: string, today: string): { entries: ParsedEntry[]; rest: string } {
  const entries: ParsedEntry[] = [];
  const restLines: string[] = [];
  let cur: { f: EntryFields; found: Set<keyof EntryFields>; lines: string[] } | null = null;
  // lines since the last of the form's: inside a message they are part of it, after its last one they are not
  let tail: string[] = [];
  const close = () => {
    if (cur && cur.found.size >= 3) {
      // a car's number, make or kind says it came by car
      if (!cur.found.has('byCar') && (cur.f.carNumber || cur.f.carKind || cur.found.has('carMilitary'))) cur.f.byCar = true;
      entries.push({ fields: cur.f, found: [...cur.found] });
    } else if (cur) restLines.push(...cur.lines);
    restLines.push(...tail);
    cur = null;
    tail = [];
  };
  const open = () => {
    cur = { f: emptyEntryFields(), found: new Set(), lines: [] };
    return cur;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const plain = raw.replace(MARKS, '').trim();
    if (!plain) continue;
    if (TITLE.test(plain)) {
      if (cur) close();
      const c = open();
      // "פורמט אישור כניסה למחנה הבדיקה" → "מחנה הבדיקה"
      c.f.camp = plain.replace(/^.*?פורמט\s+(?:ל)?אישור\s+כניסה\s*/, '').replace(/^ל/, '').trim().slice(0, 80);
      c.lines.push(raw);
      continue;
    }
    const colon = raw.search(/[:：]/);
    const key = colon > 0 ? LABELS.find(([re]) => re.test(labelKey(raw.slice(0, colon))))?.[1] : undefined;
    if (!key) {
      if (cur) tail.push(raw);
      else restLines.push(raw);
      continue;
    }
    let c = cur ?? open();
    // a label said a second time: the next message
    if (c.found.has(key) && c.found.size >= 3) {
      close();
      c = open();
    }
    c.lines.push(...tail, raw);
    tail = [];
    if (setField(c.f, key, valueOf(raw.slice(colon + 1)), today)) c.found.add(key);
  }
  close();
  return { entries, rest: restLines.join('\n').trim() };
}

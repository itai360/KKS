// A request to let a visitor into the base (אישור כניסה): its fields, the message in the format the base asks
// for - bold labels, ready for WhatsApp, line by line as the base's own form - and the reading of that same
// message pasted back (one or several), so a format received in WhatsApp fills the request by itself. The
// camp's and the unit's names are the course's own (settings) or the pasted message's, never written here.
// No dates: a request is who comes and why, not when.

export const VISITOR_KINDS = ['civilian', 'soldier'] as const;
export type VisitorKind = (typeof VISITOR_KINDS)[number];
export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = { civilian: 'אזרח', soldier: 'חייל' };

export interface EntryFields {
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

/** what is still missing for the base - its labels, in the form's order */
export function entryMissing(e: EntryFields): string[] {
  const missing: string[] = [];
  if (!e.fullName.trim()) missing.push('שם מלא');
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

/** a label the form once had: still part of a pasted message, but nothing is taken from it */
type Label = keyof EntryFields | 'date';

/** each label of the form to its field - the more particular first ("רכב צבאי/אזרחי" before "אזרח/חייל") */
const LABELS: [RegExp, Label][] = [
  [/רכב.*(?:צבאי|אזרחי)|(?:צבאי|אזרחי).*רכב|^רכב$/, 'carMilitary'],
  [/מספררכב|מסרכב|^מר$|לוחית|רישוי/, 'carNumber'],
  [/סוג|צבע/, 'carKind'],
  [/תאריך|מועד|^מתי$/, 'date'],
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

/** each field from its value as the form says it ("לא נדרש", "רכוב", "אזרחי"...) */
function setField(f: EntryFields, key: Label, v: string): boolean {
  switch (key) {
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
export function parseEntryMessages(text: string): { entries: ParsedEntry[]; rest: string } {
  const entries: ParsedEntry[] = [];
  const restLines: string[] = [];
  let cur: { f: EntryFields; found: Set<Label>; lines: string[] } | null = null;
  // lines since the last of the form's: inside a message they are part of it, after its last one they are not
  let tail: string[] = [];
  const close = () => {
    if (cur && cur.found.size >= 3) {
      // a car's number, make or kind says it came by car
      if (!cur.found.has('byCar') && (cur.f.carNumber || cur.f.carKind || cur.found.has('carMilitary'))) cur.f.byCar = true;
      entries.push({ fields: cur.f, found: [...cur.found].filter((k): k is keyof EntryFields => k !== 'date') });
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
    // a date (the form once asked for one) keeps its line in the message, and counts as a label said
    if (key === 'date' ? !!valueOf(raw.slice(colon + 1)) : setField(c.f, key, valueOf(raw.slice(colon + 1)))) c.found.add(key);
  }
  close();
  return { entries, rest: restLines.join('\n').trim() };
}

// A request to let a visitor into the base (אישור כניסה): its fields, and the message in the format the
// base asks for - bold labels, ready for WhatsApp. The camp's and the unit's names are the course's own
// (settings), never written here.

import { parseDateKey } from './dates';

export const VISITOR_KINDS = ['civilian', 'soldier'] as const;
export type VisitorKind = (typeof VISITOR_KINDS)[number];
export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = { civilian: 'אזרח', soldier: 'חייל' };

export interface EntryFields {
  visitDate: string;
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
  carNumber: string;
  /** its make and color */
  carKind: string;
  reason: string;
}

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

/** The message, line by line in the base's format; a line that does not apply to this visitor says "-" */
export function entryMessage(e: EntryFields, place: EntryPlace): string {
  const v = (s: string) => s.trim() || '-';
  const camp = place.camp.trim();
  return [
    `*🔵פורמט אישור כניסה${camp ? ` ל${camp}` : ''} 🔵*`,
    `*יחידה אליה המבקר מגיע*: ${v(place.unit)}`,
    `*שם מלא:* ${v(e.fullName)}`,
    `*תאריך:* ${e.visitDate ? fullDate(e.visitDate) : '-'}`,
    `*מס' טלפון:* ${v(e.phone)}`,
    `*אזרח/חייל:* ${VISITOR_KIND_LABELS[e.visitorKind]}`,
    `*דרגה:* ${e.visitorKind === 'soldier' ? v(e.rank) : '-'}`,
    `*סיווג ביטחוני*: ${v(e.clearance)}`,
    `*מספר אישי/ת״ז :* ${v(e.idNumber)}`,
    `*דרוש ליווי/ לא דרוש ליווי*: ${e.escort ? 'דרוש ליווי' : 'לא דרוש ליווי'}`,
    `*רגלי/רכוב*: ${e.byCar ? 'רכוב' : 'רגלי'}`,
    `*מספר רכב:* ${e.byCar ? v(e.carNumber) : '-'}`,
    `*סוג וצבע רכב*: ${e.byCar ? v(e.carKind) : '-'}`,
    `*סיבת הגעה*: ${v(e.reason)}`,
  ].join('\n');
}

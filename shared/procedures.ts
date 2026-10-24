// Not keeping to procedures (אי עמידה בנהלים): a quick report on a cadet from the "+" - what happened, picked
// from a short list (some with a detail of their own), and a few words. It is kept in the cadet's file as a
// discipline record, so it is counted, seen and exported with the rest of the cadet's discipline: under the
// subject "אי עמידה בנהלים", each kind counted on its own ("פעם שנייה").

export const PROCEDURE_SUBJECT = 'אי עמידה בנהלים';

export const PROCEDURE_KINDS = ['weapon_left', 'weapon_back', 'phone', 'dress', 'other'] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

export const PROCEDURE_LABELS: Record<ProcedureKind, string> = {
  weapon_left: 'הפקרת נשק',
  weapon_back: 'נשק מאחורה',
  phone: 'טלפון',
  dress: 'דיגום',
  other: 'אחר',
};

/** what may be out of order in the dress (דיגום) */
export const DRESS_ITEMS = ['כומתה', 'שרוך', 'גומיות', 'תג שם'] as const;
export type DressItem = (typeof DRESS_ITEMS)[number];

export const PROCEDURE_LIMITS = { other: 80, situation: 300, details: 2000 } as const;

export interface ProcedureReport {
  cadetId: number;
  kind: ProcedureKind;
  /** "אחר": what was not kept */
  other?: string;
  /** "טלפון": in what situation (may stay empty) */
  situation?: string;
  /** "דיגום": what was out of order - one or more */
  dress?: string[];
  /** a few words on it (may stay empty) */
  details?: string;
}

/** what the report still lacks, in words */
export function procedureMissing(r: Partial<ProcedureReport>): string[] {
  const out: string[] = [];
  if (!r.cadetId) out.push('שם הצוער');
  if (!r.kind) out.push('מה קרה');
  else if (r.kind === 'other' && !r.other?.trim()) out.push('מה לא נשמר');
  else if (r.kind === 'dress' && !r.dress?.length) out.push('מה בדיגום');
  return out;
}

/** "אחר" in words: the words written, without the spaces around them */
const otherText = (r: Pick<ProcedureReport, 'other'>) => (r.other ?? '').trim().replace(/\s+/g, ' ');

/** the kind in a few words: "דיגום - כומתה, שרוך", the words of "אחר", or the kind's name */
export function procedureWhat(r: Pick<ProcedureReport, 'kind' | 'other' | 'dress'>): string {
  if (r.kind === 'other') return otherText(r) || PROCEDURE_LABELS.other;
  if (r.kind === 'dress' && r.dress?.length) return `${PROCEDURE_LABELS.dress} - ${dressInOrder(r.dress).join(', ')}`;
  return PROCEDURE_LABELS[r.kind];
}

/** the dress items picked, in the list's order, each once */
export const dressInOrder = (items: readonly string[]) => DRESS_ITEMS.filter((d) => items.includes(d));

/**
 * The offense the record keeps - "אי עמידה בנהלים · טלפון" - so each kind is counted on its own and the
 * discipline reports group them under the subject; "אחר" is counted by its words.
 */
export function procedureOffense(r: Pick<ProcedureReport, 'kind' | 'other'>): string {
  return `${PROCEDURE_SUBJECT} · ${r.kind === 'other' ? otherText(r) || PROCEDURE_LABELS.other : PROCEDURE_LABELS[r.kind]}`;
}

/** the record's title in the cadet's file */
export const procedureTitle = (r: Pick<ProcedureReport, 'kind' | 'other' | 'dress'>) => `${PROCEDURE_SUBJECT}: ${procedureWhat(r)}`;

/** the record's text: the situation of a phone, then the words written */
export function procedureBody(r: Pick<ProcedureReport, 'kind' | 'situation' | 'details'>): string {
  const situation = r.kind === 'phone' ? (r.situation ?? '').trim() : '';
  return [situation && `הסיטואציה: ${situation}`, (r.details ?? '').trim()].filter(Boolean).join('\n');
}

/** an exemption of the cadet on what is reported (a dress exemption, say) - worth a look before reporting */
export function procedureExemption(kind: ProcedureKind | null, exemptions: readonly string[]): string | undefined {
  if (!kind || kind === 'other') return undefined;
  const label = PROCEDURE_LABELS[kind];
  return exemptions.find((x) => x.trim() && (x.includes(label) || label.includes(x.trim())));
}

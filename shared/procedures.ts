// Not keeping to procedures (אי עמידה בנהלים): a quick report on a cadet from the "+" - what happened, picked
// from a short list (some with a detail of their own), and a few words. It is kept in the cadet's file as a
// discipline record, so it is counted, seen and exported with the rest of the cadet's discipline: under the
// subject "אי עמידה בנהלים", each kind counted on its own ("פעם שנייה").

import type { CadetStatus } from './constants';
import { byHe } from './sort';

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

/**
 * A record's report read back from what it keeps - the inverse of procedureOffense and procedureTitle
 * (null: not a report of this form). Words of "אחר" that are a kind's name read as that kind.
 */
export function readProcedure(offense: string, title: string): { kind: ProcedureKind; other: string; dress: string[] } | null {
  const prefix = `${PROCEDURE_SUBJECT} · `;
  if (!offense.startsWith(prefix)) return null;
  const label = offense.slice(prefix.length);
  const kind = PROCEDURE_KINDS.find((k) => k !== 'other' && PROCEDURE_LABELS[k] === label) ?? 'other';
  if (kind === 'other') return { kind, other: label, dress: [] };
  if (kind !== 'dress') return { kind, other: '', dress: [] };
  const items = title.startsWith(`${PROCEDURE_SUBJECT}: ${PROCEDURE_LABELS.dress} - `) ? title.split(' - ').slice(1).join(' - ').split(', ') : [];
  return { kind, other: '', dress: dressInOrder(items) };
}

// ---------------- the overview: every report, by cadet ----------------

/** a report as the overview lists it */
export interface ProcedureEntry {
  /** the discipline record it is kept as */
  id: number;
  cadetId: number;
  cadetName: string;
  teamId: number | null;
  teamName: string | null;
  cadetStatus: CadetStatus;
  occurredOn: string;
  kind: ProcedureKind;
  /** "אחר": what was not kept */
  other: string;
  /** "דיגום": the items */
  dress: string[];
  /** the situation of a phone, and the words written */
  body: string;
  authorName: string;
  /** which time this kind was, for the cadet */
  occurrence: number | null;
  canDelete: boolean;
}

export interface ProcedureOverview {
  /** what the user sees, as with all discipline: every report, those on the cadets of their teams (and their own), or their own */
  scope: 'all' | 'teams' | 'mine';
  /** newest first */
  entries: ProcedureEntry[];
}

export type KindCounts = Record<ProcedureKind, number>;

export const emptyCounts = (): KindCounts => ({ weapon_left: 0, weapon_back: 0, phone: 0, dress: 0, other: 0 });

/** how many reports of each kind */
export function kindCounts(entries: readonly Pick<ProcedureEntry, 'kind'>[]): KindCounts {
  const out = emptyCounts();
  for (const e of entries) out[e.kind]++;
  return out;
}

/** a cadet in the overview: how many reports, of which kinds, which dress items and which other things */
export interface ProcedureCadet {
  cadetId: number;
  cadetName: string;
  teamId: number | null;
  teamName: string | null;
  cadetStatus: CadetStatus;
  total: number;
  byKind: KindCounts;
  /** the dress items, each with its count, in the list's order */
  dress: { item: string; count: number }[];
  /** the words of "אחר", each with its count, the most first */
  others: { text: string; count: number }[];
  /** the latest report's day */
  last: string;
  /** newest first */
  entries: ProcedureEntry[];
}

/** The reports by cadet: the most reports first, then the latest, then by name. */
export function byCadet(entries: readonly ProcedureEntry[]): ProcedureCadet[] {
  const map = new Map<number, ProcedureEntry[]>();
  for (const e of entries) map.set(e.cadetId, [...(map.get(e.cadetId) ?? []), e]);
  const out: ProcedureCadet[] = [];
  for (const list of map.values()) {
    const sorted = [...list].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id - a.id);
    const first = sorted[0];
    const dress = new Map<string, number>();
    const others = new Map<string, number>();
    for (const e of sorted) {
      for (const d of e.dress) dress.set(d, (dress.get(d) ?? 0) + 1);
      if (e.kind === 'other') others.set(e.other, (others.get(e.other) ?? 0) + 1);
    }
    out.push({
      cadetId: first.cadetId,
      cadetName: first.cadetName,
      teamId: first.teamId,
      teamName: first.teamName,
      cadetStatus: first.cadetStatus,
      total: sorted.length,
      byKind: kindCounts(sorted),
      dress: DRESS_ITEMS.filter((d) => dress.has(d)).map((item) => ({ item, count: dress.get(item)! })),
      others: [...others].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || byHe(a.text, b.text)),
      last: first.occurredOn,
      entries: sorted,
    });
  }
  return out.sort((a, b) => b.total - a.total || b.last.localeCompare(a.last) || byHe(a.cadetName, b.cadetName));
}

/** a cadet's kinds in words, the most first: "דיגום 3 · טלפון 1" */
export function kindsLine(c: Pick<ProcedureCadet, 'byKind'>): string {
  return PROCEDURE_KINDS.filter((k) => c.byKind[k] > 0)
    .sort((a, b) => c.byKind[b] - c.byKind[a])
    .map((k) => `${PROCEDURE_LABELS[k]} ${c.byKind[k]}`)
    .join(' · ');
}

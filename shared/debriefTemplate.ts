// A debrief as a Word file to fill in: every part of its form in the order the screen has it - the
// details, each question under its section with a box or a table to write in, then the lessons (or, in an
// activity debrief, its facts, findings, conclusions and lessons) - with what is in the debrief already
// written in. Uploaded back (server/src/debriefTemplate.ts), each box goes to its own place: a part is
// found by its label, so the labels stay as they are; rows may be added to a table, and empty ones are
// left out. Google Drive opens the file as a Google Docs document, and its link imports the same way.

import { DEBRIEF_ITEM_KINDS, DEBRIEF_ITEM_LABELS, type DebriefItemKind } from './constants';
import { docxFile, fileName, HEAD_FILL, PAGE_WIDTH, cell, para, row, run, table } from './docx';
import {
  DEBRIEF_KIND_LABELS,
  formFor,
  goalsFromText,
  GOAL_STATUS_LABELS,
  LESSON_HORIZON_LABELS,
  proposalRows,
  type DebriefAnswers,
  type DebriefKind,
  type DebriefQuestion,
  type GoalAnswer,
  type LessonHorizon,
  type QuestionType,
  ownerNames,
} from './debriefForms';

import type { DebriefDetail } from './types';

export { DOCX_TYPE } from './docx';

/** a filled template put into its debrief: the debrief now, what went where, and how to put it back */
export interface TemplateResult {
  detail: DebriefDetail;
  /** the parts filled (by their labels), and how many lessons and items were added */
  placed: { parts: string[]; items: number };
  /** the debrief as it was: the answers changed (null - none was there), the details, and the items added */
  undo: { answers: Record<string, unknown>; participants?: string; summary?: string; itemIds: number[] };
}

/** the file's first line: how an uploaded file is known as this template (with the kind after it) */
export const TEMPLATE_TITLE = 'תבנית למילוי תחקיר';

export type SlotType = QuestionType | 'detail' | 'lessonsNow' | 'lessonsNext' | 'items';

/** a place in the debrief the file has a box for */
export interface TemplateSlot {
  /** 'participants', 'summary', a question's id, 'lessons:now' / 'lessons:next', 'items:fact' ... */
  key: string;
  label: string;
  type: SlotType;
  /** the section it is written under (a question) */
  section?: { id: string; title: string; hint?: string };
  question?: DebriefQuestion;
  itemKind?: DebriefItemKind;
}

/** the details at the top: who took part, and the background (an activity debrief: what happened) */
export const detailLabel = (kind: DebriefKind, key: 'participants' | 'summary') => (key === 'participants' ? 'משתתפים' : kind === 'general' ? 'תיאור האירוע' : 'רקע קצר');

/** every place the file has a box for, in the order it writes them */
export function templateSlots(kind: DebriefKind): TemplateSlot[] {
  const slots: TemplateSlot[] = [
    { key: 'participants', label: detailLabel(kind, 'participants'), type: 'detail' },
    { key: 'summary', label: detailLabel(kind, 'summary'), type: 'detail' },
  ];
  for (const s of formFor(kind)) for (const q of s.questions) slots.push({ key: q.id, label: q.label, type: q.type, section: { id: s.id, title: s.title, hint: s.hint }, question: q });
  if (kind === 'general') for (const k of DEBRIEF_ITEM_KINDS) slots.push({ key: `items:${k}`, label: DEBRIEF_ITEM_LABELS[k], type: 'items', itemKind: k });
  else {
    slots.push({ key: 'lessons:now', label: LESSON_HORIZON_LABELS[kind].now.title, type: 'lessonsNow' });
    slots.push({ key: 'lessons:next', label: LESSON_HORIZON_LABELS[kind].next.title, type: 'lessonsNext' });
  }
  return slots;
}

/** the lines of explanation the file writes under a title (the reading leaves them out) */
export function templateHints(kind: DebriefKind): string[] {
  const out = formFor(kind).flatMap((s) => (s.hint ? [s.hint] : []));
  if (kind !== 'general') out.push(lessonNowHint(kind), LESSON_HORIZON_LABELS[kind].next.hint);
  return out.filter(Boolean);
}
const lessonNowHint = (kind: DebriefKind) => `${LESSON_HORIZON_LABELS[kind].now.hint} אחראי - בשם כפי שהוא באתר; תאריך - כמו 12.11.2026.`;

/** the headers of the tables, as the file writes them and the reading finds them */
export const GOAL_HEADERS = ['מטרה', 'הושג / חלקית / לא הושג', 'הערה'] as const;
export const PROPOSAL_HEADERS = ['נושא', 'הצעה / פתרון', 'באחריות מי', 'תיעוד התקדמות'] as const;
export const LESSON_HEADERS = ['לקח', 'אחראי', 'תאריך יעד'] as const;
/** a question's hint as the file writes it beside the label */
export const SLOT_HINTS: Partial<Record<SlotType, string>> = { rating: 'מספר מ-1 עד 5', flag: 'כן / לא', list: 'שורה לכל דבר' };

/** what the file is made from: the debrief as the screen has it */
export interface TemplateInput {
  kind: DebriefKind;
  title: string;
  /** the date as the site writes it, and what it is about (the week, the event) */
  when: string;
  about: string;
  participants: string;
  summary: string;
  answers: DebriefAnswers;
  items: { kind: DebriefItemKind; body: string; horizon: LessonHorizon | null; ownerName: string | null; dueDate: string | null }[];
  /** the week's goals, which a weekly debrief's goals start from */
  weekGoals?: string;
}

const GREY = '6B7280';
const NAVY = '1C3672';
/** rows left empty under what is written, to write more */
const SPARE = 3;

/** "2026-11-05" -> "5.11.2026" */
const dateText = (key: string | null) => {
  const m = key ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '';
};

const widthsOf = (parts: number[]) => {
  const total = parts.reduce((a, b) => a + b, 0);
  const w = parts.map((p) => Math.floor((PAGE_WIDTH * p) / total));
  w[w.length - 1] += PAGE_WIDTH - w.reduce((a, b) => a + b, 0);
  return w;
};

/** a table: a head row (tinted, repeated on the next page), the rows written, and room for more */
function grid(parts: number[], headers: readonly string[] | null, rows: string[][], spare = SPARE): string {
  const w = widthsOf(parts);
  const body = [...rows, ...Array.from({ length: spare }, () => w.map(() => ''))];
  return table(w, [
    ...(headers ? [row(headers.map((h, i) => cell(w[i], run(h, { bold: true }), { fill: HEAD_FILL })), true)] : []),
    ...body.map((r) => row(r.map((v, i) => cell(w[i], run(v || ' '))))),
  ]);
}

/** a box to write in (a question answered in words) */
const box = (text: string, lines = 2) => grid([1], null, [[text.trim() || '\n'.repeat(lines - 1)]], 0);

const label = (text: string, hint?: string) =>
  para(run(text, { bold: true }) + (hint ? run(`  (${hint})`, { size: 10, color: GREY }) : ''), { before: 200, after: 80, keepNext: true });

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

function goalRows(input: TemplateInput, v: unknown): string[][] {
  const goals: GoalAnswer[] = Array.isArray(v) && v.length ? (v as GoalAnswer[]) : input.kind === 'weekly' && input.weekGoals ? goalsFromText(input.weekGoals) : [];
  return goals.filter((g) => g?.goal?.trim()).map((g) => [g.goal, g.status ? GOAL_STATUS_LABELS[g.status] : '', g.note ?? '']);
}

/** a question's box or table, with its answer written in */
function answerOf(input: TemplateInput, q: DebriefQuestion): string {
  const v = input.answers[q.id];
  switch (q.type) {
    case 'text':
      return box(typeof v === 'string' ? v : '', 3);
    case 'list':
      return grid([1], null, strings(v).map((t) => [t]));
    case 'rating':
      return box(typeof v === 'number' ? String(v) : '', 1);
    case 'flag':
      return box(v === true ? 'כן' : v === false ? 'לא' : '', 1);
    case 'numbers': {
      const n = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const fields = q.fields ?? [];
      return grid(
        fields.map(() => 1),
        fields.map((f) => f.label),
        [fields.map((f) => (typeof n[f.id] === 'number' ? String(n[f.id]) : ''))],
        0,
      );
    }
    case 'goals':
      return grid([6, 2.4, 3.6], GOAL_HEADERS, goalRows(input, v), 2);
    case 'proposals':
      return grid(
        [3, 3.4, 1.8, 2.2],
        PROPOSAL_HEADERS,
        proposalRows(v).map((r) => [r.topic, r.proposal, r.owners?.length ? ownerNames(r.owners) : (r.ownerText ?? ''), r.progress ?? '']),
      );
  }
}

function body(input: TemplateInput): string {
  const kindLabel = DEBRIEF_KIND_LABELS[input.kind];
  const slots = templateSlots(input.kind);
  const out: string[] = [
    para(run(`${TEMPLATE_TITLE} · ${kindLabel}`, { bold: true, size: 15, color: NAVY }), { after: 60 }),
    para(run([input.title, input.when, input.about].filter(Boolean).join(' · '), { size: 11, color: GREY }), { after: 200, rule: true }),
    grid(
      [1],
      null,
      [
        [
          'איך ממלאים: כותבים בתוך המסגרות והטבלאות שמתחת לכל כותרת. לא משנים את הכותרות המודגשות - לפיהן המערכת יודעת לאן כל דבר נכנס. ' +
            'אפשר להוסיף שורות לטבלה (Tab בתא האחרון) ולהשאיר שורות ריקות. בסוף - בתחקיר באתר: "ייבוא מקובץ", ומעלים את הקובץ או מדביקים את הקישור שלו ב-Google Docs.',
        ],
      ],
      0,
    ),
    para(run('פרטי התחקיר', { bold: true, size: 13, color: NAVY }), { before: 320, after: 100, keepNext: true, rule: true }),
  ];
  // the details: a label on the right, what to write beside it
  const w = widthsOf([1, 3]);
  out.push(
    table(
      w,
      (['participants', 'summary'] as const).map((key) =>
        row([cell(w[0], run(detailLabel(input.kind, key), { bold: true }), { fill: HEAD_FILL }), cell(w[1], run((key === 'participants' ? input.participants : input.summary).trim() || ' '))]),
      ),
    ),
  );

  let section = '';
  let n = 0;
  for (const s of slots) {
    if (s.type === 'detail') continue;
    if (s.section && s.section.id !== section) {
      section = s.section.id;
      n++;
      out.push(para(run(`${n}. ${s.section.title}`, { bold: true, size: 13, color: NAVY }), { before: 360, after: 60, keepNext: true, rule: true }));
      if (s.section.hint) out.push(para(run(s.section.hint, { size: 10, color: GREY }), { after: 60, keepNext: true }));
    }
    if (s.question) {
      out.push(label(s.label, s.question.hint ?? SLOT_HINTS[s.type]), answerOf(input, s.question));
      continue;
    }
    // the lessons, or an activity debrief's lists: a section of their own
    n++;
    out.push(para(run(`${n}. ${s.label}`, { bold: true, size: 13, color: NAVY }), { before: 360, after: 60, keepNext: true, rule: true }));
    if (s.type === 'lessonsNow') {
      if (input.kind !== 'general') out.push(para(run(lessonNowHint(input.kind), { size: 10, color: GREY }), { after: 60, keepNext: true }));
      const rows = input.items.filter((i) => i.kind === 'lesson' && (i.horizon ?? 'now') === 'now').map((i) => [i.body, i.ownerName ?? '', dateText(i.dueDate)]);
      out.push(grid([6, 2.2, 1.8], LESSON_HEADERS, rows));
    } else if (s.type === 'lessonsNext') {
      const hint = input.kind === 'general' ? '' : LESSON_HORIZON_LABELS[input.kind].next.hint;
      if (hint) out.push(para(run(hint, { size: 10, color: GREY }), { after: 60, keepNext: true }));
      out.push(grid([1], [LESSON_HEADERS[0]], input.items.filter((i) => i.kind === 'lesson' && i.horizon === 'next').map((i) => [i.body])));
    } else if (s.type === 'items' && s.itemKind) {
      out.push(grid([1], null, input.items.filter((i) => i.kind === s.itemKind).map((i) => [i.body])));
    }
  }
  return out.join('');
}

/** the debrief as a Word file to fill in, and its file's name */
export function debriefTemplateDocx(input: TemplateInput): { data: Uint8Array; name: string } {
  return { data: docxFile(`${TEMPLATE_TITLE} - ${input.title}`, body(input)), name: fileName(`${input.title} - תבנית למילוי`, 'docx') };
}

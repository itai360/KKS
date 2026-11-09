// A debrief's template file, filled in and uploaded (a Word file, its Google Docs link, or pasted): each box
// read into its own place (shared/debriefTemplate.ts writes the file). A part is found by its label - the
// details by their table's labels, a question by its label and the box or table after it, the lessons and an
// activity debrief's lists by their section's title. Nothing in the debrief is lost: a text the file does
// not hold goes on after the file's, rows the file has not are kept after its own, and the lessons and items
// it already has are not added again. What it changed is returned, to undo in one press.

import type { DebriefItemKind } from '../../shared/constants';
import { zonedIso, isDateKey, localDateKey } from '../../shared/dates';
import {
  DEBRIEF_KIND_LABELS,
  type DebriefImport,
  DEBRIEF_KINDS,
  formFor,
  proposalRows,
  type DebriefAnswers,
  type DebriefKind,
  type GoalAnswer,
  type LessonHorizon,
  type ProposalAnswer,
} from '../../shared/debriefForms';
import { GOAL_HEADERS, LESSON_HEADERS, PROPOSAL_HEADERS, TEMPLATE_TITLE, detailLabel, templateHints, templateSlots, type TemplateResult, type TemplateSlot } from '../../shared/debriefTemplate';
import type { BroadHolder } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, clock, tz } from './core';
import { db } from './db';
import { blocksOf, importDebrief, ownersNamed, people, personNamed, type Person } from './debriefImport';
import { addItem, debriefDetail, debriefToFill, updateDebrief } from './debriefs';
import type { Block } from './discipline';

/** quotes, dashes and spaces as a keyboard types them */
const norm = (s: string) =>
  s
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/[–—־]/g, '-')
    .replace(/[ \t ]+/g, ' ')
    .trim();
/** a label as compared: no number before it or colon after it */
const labelKey = (s: string) =>
  norm(s)
    .replace(/^\d{1,2}\s*[.)]\s*/, '')
    .replace(/\s*:\s*$/, '')
    .trim();
/** a label with a hint written after it in brackets: the label alone */
const withoutHint = (s: string) => s.replace(/\s*\([^()]*\)\s*$/, '').trim();
const same = (a: string, b: string) => norm(a).replace(/\s+/g, ' ') === norm(b).replace(/\s+/g, ' ');

/** the kind a template file says it is for (its first line), or null when the file is no template */
export function templateKind(blocks: Block[]): DebriefKind | null | undefined {
  for (const b of blocks.slice(0, 12)) {
    if (b.kind === 'table') continue;
    const t = norm(b.text);
    if (!t.includes(TEMPLATE_TITLE)) continue;
    return DEBRIEF_KINDS.find((k) => t.includes(norm(DEBRIEF_KIND_LABELS[k]))) ?? null;
  }
  return undefined;
}

interface Gathered {
  slot: TemplateSlot;
  tables: string[][][];
  paras: string[];
}

/** the template's parts, each with the tables and lines that came after its label */
function gather(blocks: Block[], kind: DebriefKind): { parts: Gathered[]; details: Partial<Record<'participants' | 'summary', string>> } {
  const slots = templateSlots(kind);
  const byLabel = new Map(slots.filter((s) => s.type !== 'detail').map((s) => [labelKey(s.label), s]));
  const sectionTitles = new Set([...formFor(kind).map((s) => labelKey(s.title)), labelKey('פרטי התחקיר')]);
  const hints = new Set(templateHints(kind).map(labelKey));
  const details: Partial<Record<'participants' | 'summary', string>> = {};
  const parts: Gathered[] = [];
  let cur: Gathered | null = null;
  for (const b of blocks) {
    if (b.kind === 'table') {
      // the details: their labels down its first column
      const rows = b.grid.filter((r) => r.length >= 2);
      const found = (['participants', 'summary'] as const).filter((key) => rows.some((r) => same(labelKey(r[0]), detailLabel(kind, key))));
      if (found.length && !cur) {
        for (const key of found) {
          const r = rows.find((x) => same(labelKey(x[0]), detailLabel(kind, key)))!;
          const text = r.slice(1).join('\n').trim();
          if (text) details[key] = text;
        }
        continue;
      }
      if (cur) cur.tables.push(b.grid);
      continue;
    }
    const text = b.text.trim();
    if (!text) continue;
    const key = labelKey(text);
    const slot = byLabel.get(key) ?? byLabel.get(withoutHint(key));
    if (slot) {
      cur = { slot, tables: [], paras: [] };
      parts.push(cur);
      continue;
    }
    // a section's title: what follows is not the last question's
    if (sectionTitles.has(key)) {
      cur = null;
      continue;
    }
    // the file's own explanation under a title
    if (hints.has(key)) continue;
    const item = b.kind === 'para' ? b.item : null;
    if (cur) cur.paras.push(item && item !== '•' ? `${item} ${text}` : text);
  }
  return { parts, details };
}

// ---------------- a part's value ----------------

const isHeader = (row: string[], headers: readonly string[]) => row.length > 0 && headers.some((h, i) => row[i] !== undefined && same(row[i], h)) && same(row[0] ?? '', headers[0]);

/** a part's rows: each table's (its head row left out), then any line written outside them as a row of its own */
function rowsOf(g: Gathered, headers: readonly string[] | null): string[][] {
  const out: string[][] = [];
  for (const t of g.tables) for (const r of t) if (!(headers && isHeader(r.map(norm), headers)) && r.some((c) => c.trim())) out.push(r.map((c) => c.trim()));
  for (const p of g.paras) out.push([p.replace(/^[•·\-*]\s*/, '')]);
  return out;
}

const textOf = (g: Gathered) => [...g.tables.flatMap((t) => t.flatMap((r) => r)), ...g.paras].map((t) => t.trim()).filter(Boolean).join('\n');

/** the first word of a cell, as written (a Hebrew word has no \\b to end it) */
const firstWord = (text: string) => norm(text).split(/[\s.,;:!()]+/)[0]?.toLowerCase() ?? '';

function goalStatus(text: string): GoalAnswer['status'] {
  const t = norm(text);
  if (!t) return '';
  if (/חלקי/.test(t)) return 'partial';
  if (['לא', '✗', 'x'].includes(firstWord(t))) return 'missed';
  if (/הושג|✓|✔/.test(t) || ['כן', 'v'].includes(firstWord(t))) return 'met';
  return '';
}

/** "12.11.2026", "12/11/26", "12.11" (this year) -> "2026-11-12" */
export function dateOf(text: string): string | null {
  const m = /(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/.exec(text);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(localDateKey(clock.now(), tz()).slice(0, 4));
  const key = `${year}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  return isDateKey(key) && localDateKey(zonedIso(key, '12:00', tz()), tz()) === key ? key : null;
}

export interface TemplateRead {
  details: Partial<Record<'participants' | 'summary', string>>;
  answers: DebriefAnswers;
  /** this cycle's lessons (or an activity debrief's), the next cycle's, and an activity debrief's other lists */
  items: { kind: DebriefItemKind; horizon: LessonHorizon | null; body: string; ownerId: number | null; dueDate: string | null }[];
}

/** the filled template read into the debrief's places (what the file left empty is not there) */
export function readTemplate(blocks: Block[], kind: DebriefKind, all: Person[] = [], broad: BroadHolder[] = []): TemplateRead {
  const { parts, details } = gather(blocks, kind);
  const staff = all.filter((p) => p.owner.kind === 'user');
  const answers: DebriefAnswers = {};
  const items: TemplateRead['items'] = [];
  for (const g of parts) {
    const s = g.slot;
    switch (s.type) {
      case 'text': {
        const t = textOf(g);
        if (t) answers[s.key] = t;
        break;
      }
      case 'list': {
        const lines = rowsOf(g, null)
          .map((r) => r.filter(Boolean).join(' '))
          .filter(Boolean);
        if (lines.length) answers[s.key] = lines;
        break;
      }
      case 'rating': {
        const n = /(?:^|\D)([1-5])(?:\D|$)/.exec(textOf(g));
        if (n) answers[s.key] = Number(n[1]);
        break;
      }
      case 'flag': {
        const w = firstWord(textOf(g));
        if (['כן', 'היה', 'yes', 'v', '✓', '✔'].includes(w)) answers[s.key] = true;
        else if (['לא', 'no'].includes(w)) answers[s.key] = false;
        break;
      }
      case 'numbers': {
        const fields = s.question?.fields ?? [];
        const grid = g.tables[0] ?? [];
        const head = grid.findIndex((r) => fields.some((f) => r.some((c) => same(c, f.label))));
        const values = grid[head + 1] ?? (head < 0 ? grid[0] : undefined);
        if (!values) break;
        const out: Record<string, number> = {};
        fields.forEach((f, i) => {
          const col = head >= 0 ? grid[head].findIndex((c) => same(c, f.label)) : i;
          const n = /\d+/.exec(values[col] ?? '');
          if (n) out[f.id] = Number(n[0]);
        });
        if (Object.keys(out).length) answers[s.key] = out;
        break;
      }
      case 'goals': {
        const goals = rowsOf(g, GOAL_HEADERS)
          .filter((r) => r[0])
          .map((r): GoalAnswer => ({ goal: r[0], status: goalStatus(r[1] ?? ''), note: r[2] ?? '' }));
        if (goals.length) answers[s.key] = goals;
        break;
      }
      case 'proposals': {
        const rows = rowsOf(g, PROPOSAL_HEADERS).filter((r) => r[0] || r[1]);
        const out = rows.map((r): ProposalAnswer => {
          const row: ProposalAnswer = { topic: r[0] ?? '', proposal: r[1] ?? '', owner: null };
          const who = (r[2] ?? '').trim();
          if (who) {
            const found = ownersNamed(who, all, broad);
            if (found) {
              row.owner = found[0];
              row.owners = found;
            } else row.ownerText = who;
          }
          if (r[3]) row.progress = r[3];
          return row;
        });
        if (out.length) answers[s.key] = out;
        break;
      }
      case 'lessonsNow':
        for (const r of rowsOf(g, LESSON_HEADERS)) {
          if (!r[0]) continue;
          const who = (r[1] ?? '').trim();
          const owner = who ? personNamed(who, staff, []) : null;
          // someone not found by the name: kept in the lesson's words, to choose on the screen
          items.push({ kind: 'lesson', horizon: 'now', body: owner || !who ? r[0] : `${r[0]} (אחראי: ${who})`, ownerId: owner?.id ?? null, dueDate: dateOf(r[2] ?? '') });
        }
        break;
      case 'lessonsNext':
        for (const r of rowsOf(g, [LESSON_HEADERS[0]])) if (r[0]) items.push({ kind: 'lesson', horizon: 'next', body: r.filter(Boolean).join(' '), ownerId: null, dueDate: null });
        break;
      case 'items':
        for (const r of rowsOf(g, null)) if (r[0] && s.itemKind) items.push({ kind: s.itemKind, horizon: null, body: r.filter(Boolean).join(' '), ownerId: null, dueDate: null });
        break;
    }
  }
  return { details, answers, items };
}

// ---------------- into the debrief, adding to what it holds ----------------

const flat = (s: string) => norm(s).replace(/\s+/g, ' ').toLowerCase();

/** a text from the file beside the one in the debrief: the file's, with what only the debrief has after it */
function mergedText(had: string, read: string): string {
  if (!had.trim() || flat(read).includes(flat(had))) return read;
  if (flat(had).includes(flat(read))) return had;
  return `${had.trimEnd()}\n\n${read}`;
}

/** what a question holds after the file: the file's rows, then the debrief's that the file has not */
function mergedAnswer(type: TemplateSlot['type'], had: unknown, read: unknown): unknown {
  if (type === 'text') return mergedText(typeof had === 'string' ? had : '', read as string);
  if (type === 'list') {
    const mine = Array.isArray(had) ? had.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
    const theirs = read as string[];
    return [...theirs, ...mine.filter((m) => !theirs.some((t) => flat(t) === flat(m)))];
  }
  if (type === 'goals') {
    const mine = Array.isArray(had) ? (had as GoalAnswer[]).filter((g) => g?.goal?.trim()) : [];
    const theirs = read as GoalAnswer[];
    return [
      ...theirs.map((t) => {
        const m = mine.find((x) => flat(x.goal) === flat(t.goal));
        return m ? { goal: t.goal, status: t.status || m.status, note: t.note || m.note } : t;
      }),
      ...mine.filter((m) => !theirs.some((t) => flat(t.goal) === flat(m.goal))),
    ];
  }
  if (type === 'proposals') {
    const mine = proposalRows(had).filter((r) => r.topic.trim() || r.proposal.trim());
    const theirs = read as ProposalAnswer[];
    const key = (r: ProposalAnswer) => flat(r.topic);
    return [
      // one already there keeps whom it was put on, when the file names no one
      ...theirs.map((t) => {
        const m = mine.find((x) => key(x) === key(t));
        return m && !t.owner && !t.ownerText ? { ...t, owner: m.owner ?? null, ...(m.owners?.length ? { owners: m.owners } : {}), ...(m.ownerText ? { ownerText: m.ownerText } : {}) } : t;
      }),
      ...mine.filter((m) => !theirs.some((t) => key(t) === key(m))),
    ];
  }
  // a rating, the numbers, a yes or no: the file's
  return read;
}


/** A filled template into its debrief: read, then each part into its place, adding to what is there. */
export function importTemplate(actor: UserRow, id: number, buf: Buffer): TemplateResult {
  const blocks = blocksOf(buf);
  const kind = templateKind(blocks);
  const cur = debriefToFill(actor, id);
  if (kind === undefined) throw badRequest('זה לא קובץ התבנית. בתחקיר: "תבנית למילוי" מורידה אותה - ממלאים בה ומעלים אותה.');
  if (kind !== cur.kind) throw badRequest(`התבנית היא של ${kind ? DEBRIEF_KIND_LABELS[kind] : 'תחקיר אחר'}, והתחקיר הזה הוא ${DEBRIEF_KIND_LABELS[cur.kind]}. צריך את התבנית שלו.`);
  const read = readTemplate(blocks, cur.kind, people(), cur.broad);

  const slots = new Map(templateSlots(cur.kind).map((s) => [s.key, s]));
  const answers: DebriefAnswers = {};
  const undoAnswers: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const [key, value] of Object.entries(read.answers)) {
    const slot = slots.get(key);
    if (!slot) continue;
    const next = mergedAnswer(slot.type, cur.answers[key], value);
    if (JSON.stringify(next) === JSON.stringify(cur.answers[key] ?? null)) continue;
    answers[key] = next;
    undoAnswers[key] = cur.answers[key] ?? null;
    parts.push(slot.label);
  }
  const patch: { answers?: DebriefAnswers; participants?: string; summary?: string } = {};
  const undo: TemplateResult['undo'] = { answers: undoAnswers, itemIds: [] };
  if (Object.keys(answers).length) patch.answers = answers;
  for (const key of ['participants', 'summary'] as const) {
    const text = read.details[key];
    if (!text) continue;
    const next = mergedText(cur[key], text);
    if (next === cur[key]) continue;
    patch[key] = next;
    undo[key] = cur[key];
    parts.unshift(detailLabel(cur.kind, key));
  }
  // the lessons and items the debrief does not have yet
  const have = new Set(cur.items.map((i) => `${i.kind}|${i.horizon ?? ''}|${flat(i.body)}`));
  const fresh = read.items.filter((i) => {
    const k = `${i.kind}|${i.horizon ?? ''}|${flat(i.body)}`;
    if (have.has(k)) return false;
    have.add(k);
    return true;
  });
  if (!Object.keys(patch).length && !fresh.length) throw badRequest(parts.length || read.items.length ? 'כל מה שבקובץ כבר נמצא בתחקיר' : 'לא נמצא בקובץ מה למלא - האם מילאתם את התבנית?');

  db().tx(() => {
    if (Object.keys(patch).length) updateDebrief(actor, id, patch);
    for (const i of fresh) undo.itemIds.push(addItem(actor, id, { kind: i.kind, body: i.body.slice(0, 3000), horizon: i.horizon, ownerId: i.ownerId, dueDate: i.dueDate }));
  });
  return { detail: debriefDetail(actor, id), placed: { parts, items: fresh.length }, undo };
}

/**
 * A document uploaded to a debrief: its template filled in - put in its places now - or, for a company debrief,
 * the company's own summary document (read, for the screen to add to the form).
 */
export function importDocument(actor: UserRow, id: number, buf: Buffer): { template: TemplateResult } | DebriefImport {
  if (templateKind(blocksOf(buf)) !== undefined) return { template: importTemplate(actor, id, buf) };
  if (debriefToFill(actor, id).kind === 'company') return importDebrief(actor, id, buf);
  throw badRequest('זה לא קובץ התבנית. בתחקיר: "תבנית למילוי" מורידה אותה - ממלאים בה ומעלים אותה.');
}

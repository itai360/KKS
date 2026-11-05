// A company debrief (תחק"ש פלוגתי) written in the company's own document - a Word file, a shared Google
// Docs document, or the document pasted - read into its form, with nothing of the document left out:
//   the lessons table (פער | לקח + פתרון | אחראי | תיעוד התקדמות) -> the topics before the company: the gap,
//     the lesson and solution as its proposal, who it is on (someone in the course by name or by a broad
//     role - or the name as written) and its progress;
//   "נקודות להעברה לסגל" -> the general topics before the staff (a "פתרון" line starts a topic's proposal);
//   "הלך רוח", "מסרים / פערים שלא מצאנו להם פתרון", "נקודות של הסגל" -> their own questions;
//   anything else - another heading, the lines before the first one, another table - "נקודות נוספות",
//     under its heading.
// A section's title is found by its words, as a heading or a short line of its own (an export of Google
// Docs writes a title as a plain paragraph). The form is filled by the screen, added to what is in it.

import type { DebriefImport, ProposalAnswer, ProposalOwner } from '../../shared/debriefForms';
import type { BroadHolder } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest } from './core';
import { db } from './db';
import { companyDebriefToFill } from './debriefs';
import { docxBlocks, htmlBlocks, type Block } from './discipline';

export type ImportPart = 'lessons' | 'mood' | 'unsolved' | 'toStaff' | 'staffPoints';


/** quotes and dashes as a keyboard types them, the spaces single */
const norm = (s: string) =>
  s
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’`]/g, "'")
    .replace(/[–—־]/g, '-')
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();

const TITLES: [ImportPart, RegExp][] = [
  ['lessons', /^(טבלת )?(ה)?לקחים$|^פערים ולקחים$|^לקחים ופערים$/],
  ['mood', /^הלך ה?רוח/],
  ['unsolved', /^מסרים\b|לא מצאנו (להם )?(פתרון|פיתרון)|שלא נמצא להם (פתרון|פיתרון)/],
  ['toStaff', /^(נקודות )?(להעברה|להעביר) (ל|אל )?ה?סגל|^נקודות לסגל$/],
  ['staffPoints', /^נקודות (של )?ה?סגל$|^(מענה|תשובות|דברי) ה?סגל/],
];

/** a section the title names; a long line is text, whatever its first words */
export function partOf(text: string): ImportPart | null {
  const t = norm(text).replace(/[\s:\-.]+$/, '');
  if (!t || t.length > 70) return null;
  return TITLES.find(([, re]) => re.test(t))?.[0] ?? null;
}

interface Line {
  text: string;
  item: string | null;
}
interface Section {
  part: ImportPart | null;
  title: string;
  lines: Line[];
  tables: string[][][];
}

/** the document in its sections, in order; what comes before the first title is a section with no title */
function sectionsOf(blocks: Block[]): Section[] {
  const out: Section[] = [{ part: null, title: '', lines: [], tables: [] }];
  for (const b of blocks) {
    const cur = out[out.length - 1];
    if (b.kind === 'table') {
      cur.tables.push(b.grid);
      continue;
    }
    // a title of its own: a heading, or a known title on a line that is not an item of a list
    const known = b.kind === 'para' && b.item ? null : partOf(b.text);
    if (b.kind === 'heading' || known) {
      out.push({ part: known, title: norm(b.text), lines: [], tables: [] });
      continue;
    }
    cur.lines.push({ text: b.text, item: b.item });
  }
  return out;
}

// ---------------- who a topic is on ----------------

export interface Person {
  owner: ProposalOwner;
  full: string;
  first: string;
}

/** a name to compare: no quotes or punctuation, in lower case (a name written in English) */
const nameKey = (s: string) =>
  norm(s)
    .toLowerCase()
    .replace(/["'.,:;()\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function people(): Person[] {
  const users = db().all<{ id: number; display_name: string }>('SELECT id, display_name FROM users WHERE active = 1');
  const cadets = db().all<{ id: number; first_name: string; last_name: string }>("SELECT id, first_name, last_name FROM cadets WHERE status = 'active'");
  const person = (owner: ProposalOwner): Person => {
    const full = nameKey(owner.name);
    return { owner, full, first: full.split(' ')[0] };
  };
  return [
    ...cadets.map((c) => person({ kind: 'cadet', id: c.id, name: `${c.first_name} ${c.last_name}`.trim() })),
    ...users.map((u) => person({ kind: 'user', id: u.id, name: u.display_name })),
  ].filter((p) => p.full);
}

/**
 * Someone in the course the words name, when exactly one: the whole name, the name inside more words
 * ("קב"ט - עמית חריט"), a broad role one cadet holds then ("קב"ט"), or a first name alone that only one has.
 */
export function personNamed(text: string, all: Person[], broad: BroadHolder[]): ProposalOwner | null {
  const t = nameKey(text);
  // a sentence is not a name
  if (!t || t.split(' ').length > 6) return null;
  const one = (list: Person[]) => (new Set(list.map((p) => `${p.owner.kind}:${p.owner.id}`)).size === 1 ? list[0].owner : null);
  const exact = all.filter((p) => p.full === t);
  if (exact.length) return one(exact);
  const within = all.filter((p) => p.full.includes(' ') && ` ${t} `.includes(` ${p.full} `));
  if (within.length) return one(within);
  const role = broad.filter((h) => nameKey(h.role) === t);
  if (role.length) return new Set(role.map((h) => h.cadetId)).size === 1 ? { kind: 'cadet', id: role[0].cadetId, name: role[0].name } : null;
  if (!t.includes(' ')) return one(all.filter((p) => p.first === t));
  return null;
}

// ---------------- the lessons table ----------------

type Column = 'topic' | 'proposal' | 'owner' | 'progress';
const HEADERS: [Column, RegExp][] = [
  ['topic', /פער|נושא|בעיה|קושי/],
  ['proposal', /לקח|פתרון|פיתרון|הצעה/],
  ['owner', /אחרא|באחריות/],
  ['progress', /תיעוד|התקדמות|סטטוס|מעקב|ביצוע/],
];

/** the columns a header row names, or null when the row is not a header (two of them at least) */
function headerOf(row: string[]): Map<Column, number> | null {
  const cols = new Map<Column, number>();
  row.forEach((cell, i) => {
    const t = norm(cell);
    if (!t || t.length > 40) return;
    const kind = HEADERS.find(([k, re]) => !cols.has(k) && re.test(t))?.[0];
    if (kind) cols.set(kind, i);
  });
  return cols.size >= 2 ? cols : null;
}

/** a table of lessons: one with a lessons header, or any table under the lessons title */
const isLessonsTable = (grid: string[][]) => !!grid.length && !!headerOf(grid[0]);

function lessonRows(grid: string[][], all: Person[], broad: BroadHolder[], owners: DebriefImport['owners']): ProposalAnswer[] {
  const header = headerOf(grid[0]);
  // no header: the columns in the order of the company's table
  const cols = header ?? new Map<Column, number>([['topic', 0], ['proposal', 1], ['owner', 2], ['progress', 3]]);
  const used = new Set(cols.values());
  const out: ProposalAnswer[] = [];
  for (const row of header ? grid.slice(1) : grid) {
    if (!row.some((c) => c.trim()) || headerOf(row)) continue;
    const cell = (k: Column) => (cols.has(k) ? (row[cols.get(k)!] ?? '').trim() : '');
    const r: ProposalAnswer = { topic: cell('topic'), proposal: cell('proposal'), owner: null };
    const who = cell('owner');
    if (who) {
      const found = personNamed(who, all, broad);
      if (found) {
        r.owner = found;
        owners.named++;
      } else {
        r.ownerText = who;
        owners.asWritten++;
      }
    }
    // a column of its own beyond the four: kept with the progress, under its header
    const extra = row.map((c, i) => (used.has(i) || !c.trim() ? '' : `${(header && grid[0][i]?.trim()) || `עמודה ${i + 1}`}: ${c.trim()}`)).filter(Boolean);
    const progress = [cell('progress'), ...extra].filter(Boolean).join('\n');
    if (progress) r.progress = progress;
    out.push(r);
  }
  return out;
}

// ---------------- the lines of a section ----------------

/** a list item's own lines (a line break inside it makes two) */
const listLines = (lines: Line[]) => lines.flatMap((l) => l.text.split('\n')).map((t) => t.trim()).filter(Boolean);

/** the lines as text: a numbered item with its number, a blank line kept between groups */
function textOf(lines: Line[]): string {
  const out: string[] = [];
  for (const l of lines) {
    const text = l.text.trim();
    if (!text) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(l.item && l.item !== '•' ? `${l.item} ${text}` : l.item ? `• ${text}` : text);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

const tableText = (grid: string[][]) =>
  grid
    .map((r) => r.map((c) => c.trim().replace(/\n/g, ' / ')).filter(Boolean).join(' | '))
    .filter(Boolean)
    .join('\n');

const SOLUTION = /^ה?(פתרון|פיתרון|פתרונות|פיתרונות|הצעה|הצעות|הצעת פתרון)\s*[:\-]?\s*/;
const POINT = /^([א-ת]|\d{1,2})(['"]?[.)]?\s+|['"]\s*)\S/;

/**
 * Points for the staff: each starts on an item of a list or a line numbered "א" / "1." / "ב'"; the lines
 * after it are its details, and from a "פתרון" line on - its proposal.
 */
function pointsOf(lines: Line[]): ProposalAnswer[] {
  const out: { topic: string[]; proposal: string[] }[] = [];
  let toProposal = false;
  for (const l of lines) {
    l.text.split('\n').forEach((raw, i) => {
      const text = raw.trim();
      if (!text) return;
      const sol = SOLUTION.exec(norm(text));
      if (sol) {
        if (!out.length) out.push({ topic: [], proposal: [] });
        toProposal = true;
        const rest = norm(text).slice(sol[0].length).trim();
        if (rest) out[out.length - 1].proposal.push(rest);
        return;
      }
      // a new point: the first line of a list item, or a numbered line
      if (!out.length || (i === 0 && !!l.item) || POINT.test(norm(text))) {
        out.push({ topic: [], proposal: [] });
        toProposal = false;
      }
      const cur = out[out.length - 1];
      (toProposal ? cur.proposal : cur.topic).push(text);
    });
  }
  return out.map((p) => ({ topic: p.topic.join('\n'), proposal: p.proposal.join('\n'), owner: null }));
}

// ---------------- the whole document ----------------

export function debriefFromBlocks(blocks: Block[], all: Person[] = [], broad: BroadHolder[] = []): DebriefImport {
  const owners = { named: 0, asWritten: 0 };
  const company: ProposalAnswer[] = [];
  const staffGeneral: ProposalAnswer[] = [];
  const mood: string[] = [];
  const unsolved: string[] = [];
  const staffPoints: string[] = [];
  const more: string[] = [];
  // what has no question of its own: under its heading, as the document has it
  const aside = (title: string, text: string) => {
    if (text.trim()) more.push(title ? `${title}\n${text}` : text);
  };

  for (const s of sectionsOf(blocks)) {
    const leftOver: string[] = [];
    for (const grid of s.tables) {
      if (isLessonsTable(grid) || s.part === 'lessons') company.push(...lessonRows(grid, all, broad, owners));
      else leftOver.push(tableText(grid));
    }
    if (s.part === 'mood') mood.push(...listLines(s.lines));
    else if (s.part === 'unsolved') unsolved.push(...listLines(s.lines));
    else if (s.part === 'toStaff') staffGeneral.push(...pointsOf(s.lines));
    else if (s.part === 'staffPoints') {
      const t = textOf(s.lines);
      if (t) staffPoints.push(t);
    } else leftOver.unshift(textOf(s.lines));
    aside(s.title, leftOver.filter((t) => t.trim()).join('\n'));
  }

  const answers: DebriefImport['answers'] = {};
  if (company.length) answers.company = company;
  if (staffGeneral.length) answers.staffGeneral = staffGeneral;
  if (mood.length) answers.mood = mood;
  if (unsolved.length) answers.unsolved = unsolved;
  if (staffPoints.length) answers.staffPoints = staffPoints.join('\n\n');
  if (more.length) answers.more = more.join('\n\n');
  return { answers, owners };
}

/** a document as it came: a Word file, the HTML of a Google Docs export or of the document pasted, or text */
export function blocksOf(buf: Buffer): Block[] {
  if (!buf.length) throw badRequest('לא התקבל קובץ');
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return docxBlocks(buf);
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0xe011cfd0) throw badRequest('זה קובץ Word ישן (.doc). צריך לשמור אותו כ-.docx (קובץ ← שמירה בשם) ולהעלות שוב.');
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') throw badRequest('צריך את הקובץ כ-Word (.docx), לא PDF.');
  if (buf.subarray(0, 2048).includes(0)) throw badRequest('צריך קובץ Word (.docx)');
  const text = buf.toString('utf8');
  if (/<(table|p|div|h[1-6]|li|br)\b/i.test(text)) return htmlBlocks(text);
  return text.split(/\r?\n/).map((l) => ({ kind: 'para' as const, item: null, text: l }));
}

/** the most a debrief keeps (as the server checks on saving) */
const MAX_ANSWERS = 40000;

/** a company debrief's document, read for its form (which the screen fills, adding to what is there) */
export function importDebrief(actor: UserRow, id: number, buf: Buffer): DebriefImport {
  const { broad, size } = companyDebriefToFill(actor, id);
  const read = debriefFromBlocks(blocksOf(buf), people(), broad);
  if (!Object.keys(read.answers).length) throw badRequest('לא נמצא במסמך תוכן לתחקיר');
  if (size + JSON.stringify(read.answers).length > MAX_ANSWERS) throw badRequest('המסמך ארוך מדי לתחקיר אחד');
  return read;
}

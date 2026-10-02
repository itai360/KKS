// The enforcement ladder (מדרג אכיפה): what staff do the first, second, ...
// time a cadet breaks a rule, and the wording of each discipline note. It lives
// in the course's own document, so the commander imports it - from a Google
// Docs link, a Word file, or by pasting the document - and it is kept in the
// database, never in the code. Re-importing replaces it; records keep the
// offense by name, so the count goes on.
//
// Reading a document: its table with columns like "קטגוריה | מקרה | פעם ראשונה |
// פעם שניה ..." is the ladder (merged cells count for every row and column they
// cover); a line starting with "*" and the list under it explains an offense;
// each heading after the table with text under it is the wording of a note.

import { localDateKey, startOfWeek } from '../../shared/dates';
import type { Cadet, DisciplineGuide, DisciplineLetter, DisciplineOffense, DisciplineOverview, DisciplineStep, DisciplineSummary } from '../../shared/types';
import type { UserRow } from './auth';
import { disciplineOrder, listCadets, RECORD_BASE, type RecordRow } from './cadets';
import { badRequest, clock, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity } from './journal';
import { decode, googleFetch, unzip } from './sheets';

export type Block = { kind: 'heading'; level: number; text: string } | { kind: 'para'; text: string; item: string | null } | { kind: 'table'; grid: string[][] };

const clean = (s: string) => s.replace(/[ \t ]+/g, ' ').trim();
const lines = (s: string) => s.split('\n').map(clean).filter(Boolean).join('\n');

// ---------------- HTML (a Google Docs export, or the document pasted) ----------------

const decodeHtml = (s: string) =>
  decode(
    s
      .replace(/&nbsp;/g, ' ')
      .replace(/&rsquo;|&lsquo;/g, "'")
      .replace(/&rdquo;|&ldquo;/g, '"')
      .replace(/&ndash;|&mdash;/g, '-'),
  );

interface Cell {
  paras: string[];
  rowspan: number;
  colspan: number;
}

/** Fills a table's merged cells into every row and column they cover. */
function toGrid(rows: Cell[][]): string[][] {
  const grid: (string | undefined)[][] = rows.map(() => []);
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row) {
      while (grid[r][c] !== undefined) c++;
      const text = lines(cell.paras.join('\n'));
      for (let dr = 0; dr < Math.min(cell.rowspan, rows.length - r); dr++) for (let dc = 0; dc < cell.colspan; dc++) grid[r + dr][c + dc] = text;
      c += cell.colspan;
    }
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

const span = (attrs: string, name: string) => Math.max(1, Math.min(50, Number(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs)?.[1] ?? 1)));

/** The headings, paragraphs, list items and tables of an HTML document, in order. */
export function htmlBlocks(html: string): Block[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, '');
  const blocks: Block[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let block: { kind: 'heading'; level: number; text: string } | { kind: 'para'; item: string | null; text: string } | null = null;
  let tableDepth = 0;
  let rows: Cell[][] = [];
  let row: Cell[] | null = null;
  let cell: Cell | null = null;

  const flush = () => {
    if (block) {
      const text = lines(block.text);
      if (block.kind === 'heading') {
        if (text) blocks.push({ kind: 'heading', level: block.level, text });
      } else blocks.push({ kind: 'para', item: block.item, text });
    }
    block = null;
  };
  const newPara = () => {
    if (cell && cell.paras[cell.paras.length - 1] !== '') cell.paras.push('');
  };

  for (const m of src.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g)) {
    const [, close, rawTag, attrs, text] = m;
    if (text !== undefined) {
      const t = decodeHtml(text).replace(/\s+/g, ' ');
      if (cell) cell.paras[cell.paras.length - 1] += t;
      else if (!tableDepth && t.trim()) (block ??= { kind: 'para', item: null, text: '' }).text += t;
      else if (!tableDepth && block) block.text += t;
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (tag === 'table') {
      if (!close) {
        if (tableDepth++ === 0) {
          flush();
          rows = [];
        }
      } else if (tableDepth > 0 && --tableDepth === 0) {
        if (cell && row) row.push(cell);
        if (row) rows.push(row);
        cell = row = null;
        const grid = toGrid(rows);
        if (grid.length) blocks.push({ kind: 'table', grid });
      }
      continue;
    }
    if (tableDepth) {
      if (tableDepth > 1) {
        if (/^(p|div|br|li|tr)$/.test(tag)) newPara(); // a table inside a cell reads as its lines
        continue;
      }
      if (tag === 'tr') {
        if (!close) row = [];
        else if (row) {
          if (cell) row.push(cell);
          rows.push(row);
          cell = row = null;
        }
      } else if (tag === 'td' || tag === 'th') {
        if (!close && row) {
          if (cell) row.push(cell);
          cell = { paras: [''], rowspan: span(attrs, 'rowspan'), colspan: span(attrs, 'colspan') };
        } else if (close && row && cell) {
          row.push(cell);
          cell = null;
        }
      } else if (/^(p|div|br|li|h[1-6])$/.test(tag)) newPara();
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      flush();
      if (!close) block = { kind: 'heading', level: Number(tag[1]), text: '' };
    } else if (tag === 'ol' || tag === 'ul') {
      flush();
      if (!close) lists.push({ ordered: tag === 'ol', n: Number(/start\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1) - 1 });
      else lists.pop();
    } else if (tag === 'li') {
      flush();
      if (!close) {
        const list = lists[lists.length - 1];
        block = { kind: 'para', item: list?.ordered ? `${++list.n}.` : '•', text: '' };
      }
    } else if (tag === 'p' || tag === 'div') {
      // a paragraph inside a list item is that item
      if (!close && block?.kind === 'para' && block.item && !clean(block.text)) continue;
      flush();
      if (!close) block = { kind: 'para', item: null, text: '' };
    } else if (tag === 'br') {
      if (block) block.text += '\n';
    } else if (tag === 'hr') flush();
  }
  flush();
  return blocks;
}

// ---------------- Word (.docx) ----------------

const wordText = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? decode(m[1]) : m[0] === '<w:br/>' ? '\n' : ' ')).join('');

/** The headings, paragraphs, list items and tables of a Word document. */
export function docxBlocks(buf: Buffer): Block[] {
  const files = unzip(buf, 'הקובץ אינו קובץ Word תקין');
  const xml = files.get('word/document.xml')?.toString('utf8');
  if (!xml) throw badRequest('הקובץ אינו קובץ Word תקין');
  // which lists are numbered
  const numbering = files.get('word/numbering.xml')?.toString('utf8') ?? '';
  const formats = new Map<string, string>();
  for (const m of numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    formats.set(m[1], /<w:numFmt w:val="(\w+)"/.exec(m[2])?.[1] ?? 'bullet');
  }
  const ordered = new Map<string, boolean>();
  for (const m of numbering.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abstract = /<w:abstractNumId w:val="(\d+)"/.exec(m[2])?.[1] ?? '';
    ordered.set(m[1], (formats.get(abstract) ?? 'bullet') !== 'bullet');
  }
  const counters = new Map<string, number>();

  const blocks: Block[] = [];
  const body = xml.slice(xml.indexOf('<w:body'));
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const part = m[0];
    if (part.startsWith('<w:tbl>')) {
      const grid: string[][] = [];
      for (const tr of part.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        const r = grid.length;
        const row: string[] = [];
        for (const tc of tr[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)) {
          const width = Math.max(1, Number(/<w:gridSpan w:val="(\d+)"/.exec(tc[0])?.[1] ?? 1));
          const merge = /<w:vMerge(?: w:val="(\w+)")?\s*\/>/.exec(tc[0]);
          const c = row.length;
          const text = merge && merge[1] !== 'restart' && r > 0 ? (grid[r - 1][c] ?? '') : lines([...tc[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((p) => wordText(p[0])).join('\n'));
          for (let i = 0; i < width; i++) row.push(text);
        }
        grid.push(row);
      }
      const width = Math.max(0, ...grid.map((r) => r.length));
      if (grid.length) blocks.push({ kind: 'table', grid: grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) });
      continue;
    }
    const style = /<w:pStyle w:val="([^"]+)"/.exec(part)?.[1] ?? '';
    const text = lines(wordText(part));
    const heading = /^heading\s?(\d)$/i.exec(style)?.[1] ?? (/^title$/i.test(style) ? '1' : null);
    if (heading) {
      if (text) blocks.push({ kind: 'heading', level: Number(heading), text });
      continue;
    }
    const numId = /<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/.exec(part)?.[1];
    let item: string | null = null;
    if (numId && numId !== '0') {
      if (ordered.get(numId)) {
        counters.set(numId, (counters.get(numId) ?? 0) + 1);
        item = `${counters.get(numId)}.`;
      } else item = '•';
    }
    blocks.push({ kind: 'para', item, text });
  }
  return blocks;
}

// ---------------- from the document to the ladder ----------------

const ORDINALS = [/ראשונה/, /שני?יה/, /שלישית/, /רביעית/, /חמישית/, /שישית/, /שביעית/, /שמינית/, /תשיעית/, /עשירית/];

/** "פעם רביעית" or "פעם 4" -> 4 */
export function ordinalOf(text: string): number | null {
  const m = /פעם\s+(\S+)/.exec(text);
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return Number(m[1]);
  const i = ORDINALS.findIndex((re) => re.test(m[1]));
  return i < 0 ? null : i + 1;
}

const STOP = new Set(['ללא', 'לפי', 'בלי', 'של', 'עם', 'את', 'על', 'או', 'כמו', 'וכו', 'פעם', 'לא']);
const words = (s: string) =>
  s
    .replace(/["'`*()[\]{},.:;!?\-–/\\]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
/** Hebrew words with or without a one-letter prefix (ה, ב, ל, מ, ש, ו, כ), and by their first letters. */
function sameWord(a: string, b: string): boolean {
  const forms = (w: string) => (w.length > 3 && /^[הבלמשוכ]/.test(w) ? [w, w.slice(1)] : [w]);
  for (const x of forms(a))
    for (const y of forms(b)) {
      if (x === y) return true;
      let n = 0;
      while (n < x.length && n < y.length && x[n] === y[n]) n++;
      if (n >= 4) return true;
    }
  return false;
}

/**
 * The wording that fits a discipline note: a heading for the same time ("פעם
 * רביעית") that has the most of the offense's words (counting double) and of
 * its category's.
 */
export function matchLetter(letters: DisciplineLetter[], offense: { category: string; name: string }, occurrence: number): number | null {
  const own = words(offense.name);
  const shared = words(offense.category);
  let best: number | null = null;
  let bestScore = 0;
  letters.forEach((l, i) => {
    if (ordinalOf(l.title) !== occurrence) return;
    const title = words(l.title.replace(/פעם\s+\S+/, ''));
    const found = (list: string[]) => (list.length ? list.filter((w) => title.some((t) => sameWord(w, t))).length / list.length : 0);
    const score = 2 * found(own) + found(shared);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const isStepHeader = (s: string) => /פעם|^\d+$/.test(s.trim());
const plain = (s: string) => clean(s.replace(/\*+/g, '').replace(/\n/g, ' '));
const normalize = (s: string) => plain(s).replace(/["'`]/g, '');

/** The ladder, the explanations of offenses and the wording of notes, from a document's blocks. */
export function guideFromBlocks(blocks: Block[]): { offenses: DisciplineOffense[]; letters: DisciplineLetter[] } {
  const offenses: DisciplineOffense[] = [];
  let firstTable = -1;
  blocks.forEach((b, bi) => {
    if (b.kind !== 'table' || b.grid.length < 2) return;
    const header = b.grid[0];
    const first = header.findIndex(isStepHeader);
    if (first < 1) return;
    if (firstTable < 0) firstTable = bi;
    const stepCols = header.map((h, i) => (i >= first && isStepHeader(h) ? i : -1)).filter((i) => i >= 0);
    const caseCol = first - 1;
    const categoryCol = first >= 2 ? 0 : -1;
    for (const row of b.grid.slice(1)) {
      const category = categoryCol >= 0 ? plain(row[categoryCol]) : '';
      const name = plain(row[caseCol]) || category;
      const steps: (DisciplineStep | null)[] = stepCols.map((i) => {
        const text = lines(row[i] ?? '');
        return text ? { text, note: /הערת\s+משמעת/.test(text), committee: /ועד(ת|ה)/.test(text), letter: null } : null;
      });
      while (steps.length && !steps[steps.length - 1]) steps.pop();
      if (!name || !steps.length) continue;
      const key = category && category !== name ? `${category} · ${name}` : name;
      if (offenses.some((o) => o.key === key)) continue;
      offenses.push({ key, category, name, definition: [], steps });
    }
  });
  if (!offenses.length) throw badRequest('לא נמצאה במסמך טבלת מדרג. צריכה להיות טבלה עם כותרות כמו "מקרה", "פעם ראשונה", "פעם שניה".');

  // "*משחק בנשק חמור" and the list under it: what counts as that offense
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== 'para' || b.item || !/^\*+/.test(b.text)) continue;
    const target = normalize(b.text);
    const offense = offenses.find((o) => normalize(o.name) === target) ?? offenses.find((o) => target && normalize(o.name).includes(target));
    if (!offense) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n.kind !== 'para' || !n.item) break;
      if (n.text) offense.definition.push(n.text);
    }
  }

  // each heading after the ladder with text under it is the wording of a note
  const letters: DisciplineLetter[] = [];
  for (let i = firstTable + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== 'heading') continue;
    const body: string[] = [];
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n.kind !== 'para') break;
      if (n.text) body.push(n.item ? `${n.item} ${n.text}` : n.text);
    }
    if (body.length) letters.push({ title: plain(b.text), body: body.join('\n') });
  }
  return linkLetters({ offenses, letters });
}

/** Each discipline-note step gets the wording for its offense and time. */
export function linkLetters<G extends { offenses: DisciplineOffense[]; letters: DisciplineLetter[] }>(guide: G): G {
  for (const o of guide.offenses)
    o.steps.forEach((s, i) => {
      if (s?.note) s.letter = matchLetter(guide.letters, o, i + 1);
    });
  return guide;
}

/** A step written by hand (the demo's sample ladder). */
export const demoStep = (text: string): DisciplineStep => ({ text, note: /הערת\s+משמעת/.test(text), committee: /ועד(ת|ה)/.test(text), letter: null });

/** A document file: Word, or HTML (a Google Docs export, or what was pasted). */
export function guideFromFile(buf: Buffer): { offenses: DisciplineOffense[]; letters: DisciplineLetter[] } {
  if (!buf.length) throw badRequest('לא התקבל קובץ');
  if (buf.readUInt32LE(0) === 0x04034b50) return guideFromBlocks(docxBlocks(buf));
  const text = buf.toString('utf8');
  if (!/<(table|p|div|h\d)\b/i.test(text)) throw badRequest('צריך קובץ Word (.docx) או את המסמך עצמו (להעתיק הכל ולהדביק)');
  return guideFromBlocks(htmlBlocks(text));
}

// ---------------- from a Google Docs link ----------------

/** The addresses to try for a shared Google Docs document or a Word file in Drive. */
export function googleDocUrls(raw: string): string[] {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest('הקישור אינו תקין');
  }
  const id = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
  if (u.protocol !== 'https:' || !['docs.google.com', 'drive.google.com'].includes(u.hostname) || !id) throw badRequest('צריך קישור למסמך ב-Google Docs');
  return u.pathname.startsWith('/document/')
    ? [`https://docs.google.com/document/d/${id}/export?format=html`]
    : [`https://drive.google.com/uc?export=download&id=${id}`, `https://docs.google.com/document/d/${id}/export?format=html`];
}

const NOT_SHARED =
  'לא ניתן לקרוא את המסמך מהקישור - הוא לא משותף. אפשר לשתף אותו ("שיתוף" ← "כל מי שיש לו את הקישור"), או בלי לשתף: להעתיק את כל המסמך ולהדביק כאן, או להוריד אותו כקובץ Word ולהעלות.';

export async function guideFromLink(raw: string, maxBytes: number): Promise<{ offenses: DisciplineOffense[]; letters: DisciplineLetter[] }> {
  for (const url of googleDocUrls(raw)) {
    const res = await googleFetch(url).catch(() => null);
    if (!res?.ok || /accounts\.google\.com|ServiceLogin/.test(res.url)) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw badRequest('המסמך גדול מדי');
    if (/accounts\.google\.com\/(v3\/)?signin|ServiceLogin/.test(buf.subarray(0, 20_000).toString('utf8'))) continue;
    return guideFromFile(buf);
  }
  throw badRequest(NOT_SHARED);
}

// ---------------- kept in the database ----------------

interface GuideRow {
  offenses: string;
  letters: string;
  source: string;
  imported_at: string;
  imported_by_name: string | null;
}

export function getGuide(): DisciplineGuide {
  const r = db().get<GuideRow>('SELECT g.*, u.display_name AS imported_by_name FROM discipline_guide g LEFT JOIN users u ON u.id = g.imported_by WHERE g.id = 1');
  if (!r) return { offenses: [], letters: [], source: '', importedAt: null, importedByName: null };
  return { offenses: JSON.parse(r.offenses), letters: JSON.parse(r.letters), source: r.source, importedAt: r.imported_at, importedByName: r.imported_by_name };
}

export function saveGuide(actor: UserRow, guide: { offenses: DisciplineOffense[]; letters: DisciplineLetter[] }, source: string): DisciplineGuide {
  db().run(
    `INSERT INTO discipline_guide(id, offenses, letters, source, imported_at, imported_by) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET offenses = excluded.offenses, letters = excluded.letters, source = excluded.source, imported_at = excluded.imported_at, imported_by = excluded.imported_by`,
    JSON.stringify(guide.offenses),
    JSON.stringify(guide.letters),
    source.slice(0, 500),
    nowIso(),
    actor.id,
  );
  logActivity({ userId: actor.id, action: 'discipline_guide', text: `${actor.display_name} עדכן את מדרג האכיפה (${guide.offenses.length} מקרים, ${guide.letters.length} נוסחי הערות משמעת)` });
  changed('settings');
  return getGuide();
}

// ---------------- the picture for the commanders ----------------

/** The active cadets this user manages and their discipline records, newest first. */
function managedDiscipline(actor: UserRow) {
  const managed = listCadets(actor, { status: 'active' }).filter((c) => c.canManage);
  const byId = new Map(managed.map((c) => [c.id, c]));
  const rows = db()
    .all<RecordRow>(`${RECORD_BASE} WHERE r.kind = 'discipline' ORDER BY r.occurred_on DESC, r.id DESC`)
    .filter((r) => byId.has(r.cadet_id));
  return { managed, byId, rows };
}

/** Discipline between two days (inclusive): how much, by subject, and by cadet. */
function summarize(rows: RecordRow[], byId: Map<number, Cadet>, from: string, to: string): DisciplineSummary {
  const inRange = rows.filter((r) => r.occurred_on >= from && r.occurred_on <= to);
  const categories = new Map<string, number>();
  const cadets = new Map<number, { events: number; notes: number }>();
  for (const r of inRange) {
    const category = r.offense.includes(' · ') ? r.offense.split(' · ')[0] : 'אחר';
    categories.set(category, (categories.get(category) ?? 0) + 1);
    const e = cadets.get(r.cadet_id) ?? { events: 0, notes: 0 };
    e.events++;
    if (r.formal) e.notes++;
    cadets.set(r.cadet_id, e);
  }
  return {
    events: inRange.length,
    notes: inRange.filter((r) => r.formal).length,
    byCategory: [...categories].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'he')),
    cadets: [...cadets]
      .map(([id, e]) => {
        const c = byId.get(id)!;
        return { id, fullName: c.fullName, teamName: c.teamName, ...e, totalNotes: c.disciplineNotes };
      })
      .sort((a, b) => b.notes - a.notes || b.events - a.events || a.fullName.localeCompare(b.fullName, 'he')),
  };
}

/** The weekly report's discipline section; null for someone who manages no cadets. */
export function disciplineSummary(actor: UserRow, from: string, to: string): DisciplineSummary | null {
  const { managed, byId, rows } = managedDiscipline(actor);
  return managed.length ? summarize(rows, byId, from, to) : null;
}

/** This week's discipline, the cadets with notes, and the latest records - of the active cadets the user manages. */
export function disciplineOverview(actor: UserRow): DisciplineOverview {
  const { managed, byId, rows } = managedDiscipline(actor);
  const order = disciplineOrder(rows);
  const today = localDateKey(clock.now(), tz());
  const { events, notes, byCategory } = summarize(rows, byId, startOfWeek(today), today);
  return {
    managed: managed.length,
    week: { events, notes, byCategory },
    cadets: managed
      .filter((c) => c.disciplineNotes > 0 || (c.notesCommittee && !c.notesCommittee.decision))
      .sort((a, b) => b.disciplineNotes - a.disciplineNotes || a.fullName.localeCompare(b.fullName, 'he'))
      .map((c) => ({ id: c.id, fullName: c.fullName, teamName: c.teamName, notes: c.disciplineNotes, committee: c.notesCommittee })),
    recent: rows.slice(0, 8).map((r) => ({
      id: r.id,
      cadetId: r.cadet_id,
      cadetName: byId.get(r.cadet_id)!.fullName,
      title: r.title || r.category || (r.formal ? 'הערת משמעת' : 'משמעת'),
      formal: !!r.formal,
      occurrence: order.get(r.id)?.occurrence ?? null,
      occurredOn: r.occurred_on,
      authorName: r.author_name,
    })),
  };
}

export function deleteGuide(actor: UserRow): void {
  db().run('DELETE FROM discipline_guide WHERE id = 1');
  logActivity({ userId: actor.id, action: 'discipline_guide', text: `${actor.display_name} הסיר את מדרג האכיפה` });
  changed('settings');
}

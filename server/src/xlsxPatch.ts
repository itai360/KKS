// A grade written into a spreadsheet as it is: the course's grade sheet - an Excel file or a Google Sheets one.
// The cadet's row is found by personal number (or by name), the column by its header; one cell changes and
// everything else in the file - its look, its other sheets, its formulas - stays as it was.

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { crc32 } from '../../shared/zip';
import { searchKey } from '../../shared/search';
import { decode } from './sheets';

// ---------------- where the grade goes ----------------

export interface GridRow {
  /** the row's number in the sheet (from 1) */
  row: number;
  cells: string[];
}

export interface Who {
  pn: string;
  first: string;
  last: string;
}

const digits = (s: string) => s.replace(/\D/g, '');
const key = (s: string) => searchKey(s).replace(/\s+/g, ' ').trim();

/** a header is the column: the same words, or all the words that tell it (without "ציון") */
function headerIs(cell: string, column: string): boolean {
  const c = key(cell);
  const t = key(column);
  if (!c || !t) return false;
  if (c === t) return true;
  const words = t.split(' ').filter((w) => w !== 'ציון');
  return words.length > 0 && words.every((w) => c.split(' ').some((x) => x === w || x.startsWith(w) || w.startsWith(x)));
}

const PN = ['מספר אישי', 'מא', 'מ.א', 'מ"א'];
const FIRST = ['שם פרטי'];
const LAST = ['שם משפחה'];
const FULL = ['שם מלא', 'שם', 'שם הצוער'];
const colOf = (cells: string[], names: string[]) => cells.findIndex((c) => names.some((n) => key(c) === key(n)));

/** the cell of the cadet's grade in a sheet - or why it was not found */
export function locate(grid: GridRow[], who: Who, column: string): { row: number; col: number } | { error: string } {
  const headerAt = grid.slice(0, 40).findIndex((r) => r.cells.some((c) => headerIs(c, column)));
  if (headerAt < 0) return { error: `לא נמצאה בגליון עמודה "${column}"` };
  const head = grid[headerAt].cells;
  const col = head.findIndex((c) => headerIs(c, column));
  const pn = colOf(head, PN);
  const first = colOf(head, FIRST);
  const last = colOf(head, LAST);
  const full = colOf(head, FULL);
  const below = grid.slice(headerAt + 1);
  let found: GridRow[] = [];
  const myPn = digits(who.pn);
  if (pn >= 0 && myPn) found = below.filter((r) => digits(r.cells[pn] ?? '') === myPn);
  if (!found.length) {
    const me = key(`${who.first} ${who.last}`);
    if (first >= 0 && last >= 0) found = below.filter((r) => key(`${r.cells[first] ?? ''} ${r.cells[last] ?? ''}`) === me);
    else if (full >= 0) found = below.filter((r) => key(r.cells[full] ?? '') === me);
  }
  if (!found.length) return { error: 'הצוער לא נמצא בגליון (לפי מספר אישי או שם)' };
  if (found.length > 1) return { error: 'בגליון יש יותר משורה אחת לצוער' };
  return { row: found[0].row, col };
}

// ---------------- an Excel file: the zip, read and written back ----------------

interface Entry {
  name: string;
  nameBytes: Buffer;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compSize: number;
  size: number;
  external: number;
  data: Buffer;
}

function entries(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    if (compSize === 0xffffffff || size === 0xffffffff) throw new Error('zip64');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nameBytes = Buffer.from(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({
      name: nameBytes.toString('utf8'),
      nameBytes,
      flags: buf.readUInt16LE(p + 8) & ~0x0008, // sizes are in the header from now on, not after the data
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      compSize,
      size,
      external: buf.readUInt32LE(p + 38),
      data: Buffer.from(buf.subarray(start, start + compSize)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const contentOf = (e: Entry): Buffer => (e.method === 0 ? e.data : e.method === 8 ? inflateRawSync(e.data, { maxOutputLength: 64 * 1024 * 1024 }) : Buffer.alloc(0));

function withContent(e: Entry, text: string): Entry {
  const raw = Buffer.from(text, 'utf8');
  const data = deflateRawSync(raw);
  return { ...e, method: 8, crc: crc32(raw), size: raw.length, compSize: data.length, data };
}

function zip(list: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of list) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compSize, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(e.nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, e.nameBytes, e.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.flags, 8);
    c.writeUInt16LE(e.method, 10);
    c.writeUInt16LE(e.time, 12);
    c.writeUInt16LE(e.date, 14);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.compSize, 20);
    c.writeUInt32LE(e.size, 24);
    c.writeUInt16LE(e.nameBytes.length, 28);
    c.writeUInt32LE(e.external, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, e.nameBytes);
    offset += 30 + e.nameBytes.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------- an Excel file: its sheets ----------------

const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

export function colIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface XlsxSheet {
  name: string;
  path: string;
  grid: GridRow[];
}

function sheetsOf(files: Map<string, string>): XlsxSheet[] {
  const text = (n: string) => files.get(n) ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  return [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const grid: GridRow[] = [];
    for (const row of text(path).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(/\sr="(\d+)"/.exec(` ${row[1]}`)?.[1] ?? grid.length + 1);
      const cells: string[] = [];
      for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const type = /t="([^"]+)"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
        cells[ref ? colIndex(ref) : cells.length] = (type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? texts(c[2] ?? '') : v !== undefined ? decode(v) : '').trim();
      }
      grid.push({ row: r, cells: Array.from(cells, (x) => x ?? '') });
    }
    return { name: decode(/name="([^"]*)"/.exec(m[0])?.[1] ?? ''), path, grid };
  });
}

/** one cell of a sheet's XML set to a number: its look kept; a cell with a formula is not touched */
export function setCellXml(xml: string, row: number, col: number, value: number): string | { error: string } {
  const ref = `${colName(col)}${row}`;
  const rowRe = new RegExp(`<row\\b(?=[^>]*\\sr="${row}")([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const m = rowRe.exec(xml);
  if (!m) return { error: 'השורה של הצוער לא נמצאה בגליון' };
  let attrs = m[1];
  const inner = m[3] ?? '';
  // the row's hint of its columns, wide enough for the new cell
  attrs = attrs.replace(/\sspans="(\d+):(\d+)"/, (_, a: string, b: string) => ` spans="${Math.min(Number(a), col + 1)}:${Math.max(Number(b), col + 1)}"`);
  const cellRe = new RegExp(`<c\\b(?=[^>]*\\sr="${ref}")([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const cm = cellRe.exec(inner);
  let next: string;
  if (cm) {
    if (/<f[\s>]/.test(cm[2] ?? '')) return { error: 'בתא של הציון בגליון יש נוסחה - לא נכתב' };
    const style = /\ss="\d+"/.exec(cm[1])?.[0] ?? '';
    next = inner.replace(cm[0], `<c r="${ref}"${style}><v>${value}</v></c>`);
  } else {
    const cell = `<c r="${ref}"><v>${value}</v></c>`;
    // in its place among the row's cells, by column
    let at = inner.length;
    for (const c of inner.matchAll(/<c\b[^>]*\sr="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      if (colIndex(c[1]) > col) {
        at = c.index;
        break;
      }
    }
    next = inner.slice(0, at) + cell + inner.slice(at);
  }
  return xml.slice(0, m.index) + `<row${attrs}>${next}</row>` + xml.slice(m.index + m[0].length);
}

/** the workbook asks to be calculated again when opened: totals that count the new grade show it */
function recalcOnOpen(workbook: string): string {
  if (/<calcPr\b[^>]*fullCalcOnLoad=/.test(workbook)) return workbook.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
  if (/<calcPr\b/.test(workbook)) return workbook.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  return workbook.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
}

/** the cadet's grade into an Excel file: the file back with that one cell changed - or why not */
export function writeGradeXlsx(buf: Buffer, who: Who, column: string, value: number): { file: Buffer; cell: string; sheet: string } | { error: string } {
  let list: Entry[];
  try {
    list = entries(buf);
  } catch {
    return { error: 'קובץ הגליון אינו קובץ אקסל תקין' };
  }
  const xml = new Map<string, string>();
  for (const e of list) if (/\.(xml|rels)$/i.test(e.name)) xml.set(e.name, contentOf(e).toString('utf8'));
  let firstError = '';
  for (const s of sheetsOf(xml)) {
    const at = locate(s.grid, who, column);
    if ('error' in at) {
      firstError ||= at.error;
      // the column is in this sheet: what is wrong is here
      if (!at.error.startsWith('לא נמצאה בגליון עמודה')) return at;
      continue;
    }
    const changed = setCellXml(xml.get(s.path) ?? '', at.row, at.col, value);
    if (typeof changed !== 'string') return changed;
    const out = list.map((e) => (e.name === s.path ? withContent(e, changed) : e.name === 'xl/workbook.xml' ? withContent(e, recalcOnOpen(xml.get(e.name) ?? '')) : e));
    return { file: zip(out), cell: `${colName(at.col)}${at.row}`, sheet: s.name };
  }
  return { error: firstError || 'הגליון ריק' };
}

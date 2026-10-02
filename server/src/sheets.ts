// Reading a cadet list from a spreadsheet: an Excel file (.xlsx), a CSV, or a
// Google Sheets / Drive link. The result is the text the paste import reads
// (cadets.ts importCadets), shown to the commander before anything is saved.
// No spreadsheet library: an .xlsx is a zip of XML files.

import { inflateRawSync } from 'node:zlib';
import { badRequest } from './core';

type Table = string[][];

// ---------------- reading files ----------------

/** The files inside a zip archive (stored or deflated entries). */
export function unzip(buf: Buffer, invalid = 'הקובץ אינו קובץ אקסל תקין'): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw badRequest(invalid);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** XML and HTML character references. */
export const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** The sheets of an .xlsx file, in workbook order. */
export function readXlsx(buf: Buffer): { name: string; rows: Table }[] {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheets = [...text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(/name="([^"]*)"/.exec(m[0])?.[1] ?? ''),
    target: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) ?? '',
  }));
  if (!sheets.length) throw badRequest('הקובץ אינו קובץ אקסל תקין');
  return sheets.map(({ name, target }) => {
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const rows: Table = [];
    for (const row of text(path).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const value = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? texts(body) : v !== undefined ? decode(v) : '';
        cells[ref ? columnIndex(ref) : cells.length] = value.trim();
      }
      rows.push(Array.from(cells, (x) => x ?? ''));
    }
    return { name, rows };
  });
}

/** CSV or tab-separated text, with quoted fields. */
export function readCsv(text: string): Table {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') cell += '"', i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) row.push(cell.trim()), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell.trim()]);
  return rows;
}

export function readSpreadsheet(buf: Buffer): { name: string; rows: Table }[] {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  return [{ name: 'קובץ', rows: readCsv(buf.toString('utf8')) }];
}

// ---------------- finding the cadets in a sheet ----------------

const TITLES: [RegExp, 'first' | 'last' | 'full' | 'pn' | 'phone' | 'team'][] = [
  [/^שם פרטי$/, 'first'],
  [/^שם משפחה$/, 'last'],
  [/^(שם מלא|שם|שם הצוער|name)$/i, 'full'],
  [/^(מספר אישי|מ\.?\s?א\.?|מ"א)$/, 'pn'],
  [/^(טלפון|נייד|פלאפון|מספר טלפון)$/, 'phone'],
  [/^(צוות|team)$/i, 'team'],
];
const titleOf = (cell: string) => TITLES.find(([re]) => re.test(cell.replace(/\s+/g, ' ').trim()))?.[1] ?? null;
const isNumber = (s: string) => /^\d+(\.\d+)?$/.test(s.trim());
const filled = (r: string[]) => r.filter((x) => x.trim() !== '');
const clean = (s: string) => s.replace(/[\t;,]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface SheetImport {
  text: string;
  sheet: string;
  cadets: number;
  teams: string[];
}

/** A header row with the columns we know, cadets under it, maybe in sections titled with the team. */
function fromHeaderRow(rows: Table): Omit<SheetImport, 'sheet'> | null {
  const h = rows.slice(0, 10).findIndex((r) => r.map(titleOf).filter(Boolean).length >= 2);
  if (h < 0) return null;
  const cols = rows[h].map(titleOf);
  const at = (r: string[], key: string) => (cols.indexOf(key as never) >= 0 ? (r[cols.indexOf(key as never)] ?? '').trim() : '');
  const out: string[][] = [];
  let section = '';
  for (const r of rows.slice(h + 1)) {
    const cells = filled(r);
    if (!cells.length) continue;
    // a row with one word-cell only: the title of the section below it (often the team)
    if (cells.length === 1 && !isNumber(cells[0]) && !at(r, 'last') && !(cols.includes('first') && at(r, 'first'))) {
      section = cells[0];
      continue;
    }
    const first = at(r, 'first');
    const last = at(r, 'last');
    const full = at(r, 'full') || `${first} ${last}`.trim();
    if (!full) continue;
    const team = at(r, 'team');
    out.push([first, last, full, at(r, 'pn').replace(/\.0+$/, ''), at(r, 'phone'), team && !isNumber(team) ? team : section]);
  }
  if (!out.length) return null;
  const split = cols.includes('first') || cols.includes('last');
  const header = split ? ['שם פרטי', 'שם משפחה', 'מספר אישי', 'טלפון', 'צוות'] : ['שם מלא', 'מספר אישי', 'טלפון', 'צוות'];
  const lines = out.map(([first, last, full, pn, phone, team]) => (split ? [first, last, pn, phone, team] : [full, pn, phone, team]).map(clean).join('\t'));
  return { text: [header.join('\t'), ...lines].join('\n'), cadets: out.length, teams: [...new Set(out.map((o) => o[5]).filter(Boolean))] };
}

/** A column for each team: the team in the first row, its cadets' names under it. */
function fromTeamColumns(rows: Table): Omit<SheetImport, 'sheet'> | null {
  const head = rows.findIndex((r) => filled(r).length >= 2);
  if (head < 0) return null;
  const out: [string, string][] = [];
  rows[head].forEach((team, i) => {
    if (!team.trim()) return;
    for (const r of rows.slice(head + 1)) {
      const name = (r[i] ?? '').trim();
      if (name && !isNumber(name)) out.push([name, team.trim()]);
    }
  });
  if (out.length < 2) return null;
  return { text: ['שם מלא\tצוות', ...out.map(([n, t]) => `${clean(n)}\t${clean(t)}`)].join('\n'), cadets: out.length, teams: [...new Set(out.map((o) => o[1]))] };
}

/** The cadets of the first sheet that holds a list we can read. */
export function cadetsFromSpreadsheet(buf: Buffer): SheetImport {
  const sheets = readSpreadsheet(buf);
  for (const s of sheets) {
    const found = fromHeaderRow(s.rows);
    if (found) return { ...found, sheet: s.name };
  }
  for (const s of sheets) {
    const found = fromTeamColumns(s.rows);
    if (found) return { ...found, sheet: s.name };
  }
  throw badRequest('לא נמצאה בקובץ רשימת צוערים. צריכה להיות שורת כותרות כמו "שם פרטי", "שם משפחה", "מספר אישי", "צוות" - או עמודה לכל צוות.');
}

// ---------------- Google Sheets / Drive links ----------------

/** The download addresses of a shared Google Sheets or Drive file (Google hosts only). */
export function googleDownloadUrls(raw: string): string[] {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest('הקישור אינו תקין');
  }
  const id = /\/d\/([a-zA-Z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
  if (u.protocol !== 'https:' || !['docs.google.com', 'drive.google.com'].includes(u.hostname) || !id) {
    throw badRequest('צריך קישור ל-Google Sheets או לקובץ ב-Google Drive');
  }
  const gid = u.searchParams.get('gid') ?? /gid=(\d+)/.exec(u.hash)?.[1];
  return [
    `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx${gid ? `&gid=${gid}` : ''}`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ];
}

let fetcher = async (url: string): Promise<Response> => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });

/** A request to Google (replaced in tests). */
export const googleFetch = (url: string) => fetcher(url);

/** Tests replace the network. */
export function setSheetFetcher(fn: typeof fetcher): void {
  fetcher = fn;
}

/** Downloads a shared sheet; a file that is not shared with "anyone with the link" comes back as a sign-in page. */
export async function downloadGoogleSheet(raw: string, maxBytes: number): Promise<Buffer> {
  for (const url of googleDownloadUrls(raw)) {
    const res = await fetcher(url).catch(() => null);
    if (!res?.ok) continue;
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw badRequest('הקובץ גדול מדי');
    if (/text\/html/.test(type) || buf.subarray(0, 200).toString('utf8').toLowerCase().includes('<html')) continue;
    return buf;
  }
  throw badRequest('לא ניתן להוריד את הקובץ. ב-Google צריך לשתף אותו: "שיתוף" ← "כל מי שיש לו את הקישור" (צופה). אפשר גם להוריד אותו כקובץ אקסל ולהעלות כאן.');
}

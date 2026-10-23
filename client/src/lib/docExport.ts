// A document page of the site (a talk, a debrief, a plan approval, the week's order, an evaluation file)
// as a Word file - Google Drive opens it as a Google Docs document. What the printed page shows is what the
// file holds: headings, paragraphs, lists and tables as they are on the page, bold where they are bold,
// the tables' columns as wide as on the screen; buttons and what printing leaves out are left out.

import { cell, docxFile, DOCX_TYPE, fileName, HEAD_FILL, PAGE_WIDTH, para, row, run, table, type RunStyle } from '@shared/docx';
import { shareOrSave } from './download';

const SKIP = '.no-print, button, svg, img, script, style, template, [aria-hidden="true"], .sr-only, input[type=hidden], input[type=checkbox], input[type=radio]';
const INLINE = /^inline/;

const hidden = (el: Element) => {
  const cs = getComputedStyle(el);
  return cs.display === 'none' || cs.visibility === 'hidden';
};
const skipped = (el: Element) => el.matches(SKIP) || hidden(el);

/** a field's value as the text it holds (a choice: what is chosen) */
function fieldText(el: HTMLElement): string | null {
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLInputElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent ?? '';
  return null;
}

/** the text inside, as runs: bold where it shows bold, line breaks kept where the page keeps them */
const runsOf = (node: Node, style: RunStyle = {}) => runsOfNodes([...node.childNodes], style);

function runsOfNodes(nodes: Node[], style: RunStyle = {}): string {
  let out = '';
  nodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const raw = n.textContent ?? '';
      const parent = n.parentElement;
      const keepLines = parent ? /^pre/.test(getComputedStyle(parent).whiteSpace) : false;
      const text = keepLines ? raw : raw.replace(/\s+/g, ' ');
      if (text) out += run(text, style);
      return;
    }
    if (!(n instanceof HTMLElement) || skipped(n)) return;
    if (n.tagName === 'BR') {
      out += '<w:r><w:br/></w:r>';
      return;
    }
    const value = fieldText(n);
    if (value !== null) {
      if (value.trim()) out += run(value, style);
      return;
    }
    const bold = style.bold || /^(B|STRONG|TH)$/.test(n.tagName) || Number(getComputedStyle(n).fontWeight) >= 600;
    out += runsOf(n, { ...style, bold });
  });
  return out;
}

/** holds only text and inline pieces (one paragraph), not blocks of its own */
function inlineOnly(el: Element): boolean {
  for (const c of el.children) {
    if (skipped(c)) continue;
    if (fieldText(c as HTMLElement) !== null) continue;
    if (!INLINE.test(getComputedStyle(c).display)) return false;
  }
  return true;
}

const hasText = (runs: string) => /<w:t xml:space="preserve">[^<]*\S/.test(runs);

function tableOf(t: HTMLTableElement): string {
  const rows = [...t.rows].filter((r) => !skipped(r));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => [...r.cells].filter((c) => !skipped(c)).reduce((n, c) => n + (c.colSpan || 1), 0)));
  if (!cols) return '';
  // the columns as wide as on the screen, taken from the row with every column
  const full = rows.find((r) => [...r.cells].filter((c) => !skipped(c)).length === cols);
  const seen = full ? [...full.cells].filter((c) => !skipped(c)).map((c) => c.getBoundingClientRect().width) : [];
  const total = seen.reduce((a, b) => a + b, 0);
  const widths = seen.length === cols && total > 0 ? seen.map((w) => Math.max(500, Math.round((PAGE_WIDTH * w) / total))) : Array.from({ length: cols }, () => Math.floor(PAGE_WIDTH / cols));
  const caption = t.caption && !skipped(t.caption) ? para(runsOf(t.caption, { bold: true }), { keepNext: true, after: 60 }) : '';
  const xmlRows = rows.map((r) => {
    let at = 0;
    const head = r.parentElement?.tagName === 'THEAD';
    const cells = [...r.cells]
      .filter((c) => !skipped(c))
      .map((c) => {
        const span = c.colSpan || 1;
        const w = widths.slice(at, at + span).reduce((a, b) => a + b, 0);
        at += span;
        const isHead = head || c.tagName === 'TH';
        const inner = inlineOnly(c) ? para(runsOf(c, { bold: isHead }), { after: 0 }) : blocks(c, true) || para('', { after: 0 });
        return cell(w, inner, { fill: isHead ? HEAD_FILL : undefined, span });
      });
    return row(cells, head);
  });
  return caption + table(widths, xmlRows);
}

/** the blocks inside, in order, as paragraphs and tables */
function blocks(el: Element, inCell = false): string {
  let out = '';
  const after = inCell ? 0 : undefined;
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) out += para(run(text), { after });
      return;
    }
    if (!(n instanceof HTMLElement) || skipped(n)) return;
    const tag = n.tagName;
    if (tag === 'H1') out += para(runsOf(n, { bold: true, size: 16 }), { after: 120 });
    else if (tag === 'H2') out += para(runsOf(n, { bold: true, size: 13 }), { before: 240, after: 80, keepNext: true });
    else if (/^H[3-6]$/.test(tag)) out += para(runsOf(n, { bold: true }), { before: 160, after: 60, keepNext: true });
    else if (tag === 'TABLE') out += tableOf(n as HTMLTableElement) + para('', { after: 60 });
    else if (tag === 'UL' || tag === 'OL') out += listOf(n, 1, inCell);
    else if (tag === 'DL') {
      for (const dt of n.querySelectorAll(':scope > dt, :scope > div > dt')) {
        const dd = dt.nextElementSibling;
        out += para(runsOf(dt, { bold: true }) + run(': ') + (dd ? runsOf(dd) : ''), { after });
      }
    } else if (sideBySide(n)) out += lineOf(n, after);
    else if (fieldText(n) !== null) {
      const v = fieldText(n)!;
      if (v.trim()) out += para(run(v), { after });
    } else if (inlineOnly(n)) {
      const runs = runsOf(n);
      if (hasText(runs)) out += para(runs, { after });
    } else out += blocks(n, inCell);
  });
  return out;
}

const HEADING_SIZE: Record<string, number | undefined> = { H1: 16, H2: 13 };

/** a short row of pieces side by side (a section's number and its title, a label and its value): one line */
function sideBySide(el: HTMLElement): boolean {
  if (!/flex|grid/.test(getComputedStyle(el).display)) return false;
  const kids = [...el.children].filter((c) => !skipped(c));
  return kids.length >= 2 && kids.length <= 4 && kids.every((c) => !c.querySelector('table, ul, ol, p, div div') && inlineOnly(c));
}

function lineOf(el: HTMLElement, after: number | undefined): string {
  const kids = [...el.children].filter((c) => !skipped(c));
  const heading = kids.find((c) => /^H[1-6]$/.test(c.tagName));
  const size = heading ? HEADING_SIZE[heading.tagName] : undefined;
  const runs = kids
    .map((c, i) => {
      const text = (c.textContent ?? '').trim();
      // a section's number before its title reads "1. "
      const gap = i < kids.length - 1 ? (/^\d+$/.test(text) ? '. ' : ' ') : '';
      return runsOf(c, { bold: !!heading || undefined, size }) + (gap ? run(gap, { bold: !!heading || undefined, size }) : '');
    })
    .join('');
  if (!hasText(runs)) return '';
  return heading ? para(runs, { before: 200, after: 80, keepNext: true }) : para(runs, { after });
}

const isList = (n: Node): n is HTMLElement => n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL') && !skipped(n);

/** a list's items, each its own paragraph with its mark, a list inside an item pushed in further */
function listOf(list: HTMLElement, depth: number, inCell: boolean): string {
  let out = '';
  [...list.children]
    .filter((li) => !skipped(li))
    .forEach((li, i) => {
      const mark = list.tagName === 'OL' ? `${i + 1}. ` : '• ';
      const nodes = [...li.childNodes];
      out += para(run(mark) + runsOfNodes(nodes.filter((c) => !isList(c))), { indent: 360 * depth, after: inCell ? 0 : 60 });
      for (const sub of nodes.filter(isList)) out += listOf(sub, depth + 1, inCell);
    });
  return out;
}

/** the page's document as a Word file, named for it */
export function elementDocx(el: HTMLElement, title: string): Uint8Array {
  return docxFile(title, blocks(el));
}

export function saveElementDocx(el: HTMLElement, title: string): Promise<void> {
  return shareOrSave(fileName(title, 'docx'), new Blob([elementDocx(el, title) as BlobPart], { type: DOCX_TYPE }));
}

// A team's takpatz as the course's spreadsheet: its five sheets in its order and by its names, each cell
// in the file's own style (server/src/takpatzTemplate.ts), its column widths, frozen panes, filters,
// lists to choose from, the tracking table and the legends - with the team's data in it. What changes
// with the data moves with it: a row for each cadet however many, an experience over several weeks is
// one cell merged across them (the merges are worked out from the weeks, not copied), the legends go
// down under the last cadet, and every range follows the rows there are. Nothing of the file's example
// rows is written; an experience no cell could hold (two in one week) stops the export instead.

import { esc, XML_HEAD } from '../../shared/docx';
import {
  BOARD_SHEET_NAMES,
  CATEGORY_INFO,
  FIRST_WEEK,
  HALF_LABELS,
  STAGE_KEYS,
  STATUS_LABELS,
  TAKPATZ_CATEGORIES,
  TAKPATZ_HALVES,
  THIRD_LABELS,
  TRACK_STAGES,
  weekRange,
  type TakpatzBoard,
  type TakpatzCategory,
  type TakpatzHalf,
  type TakpatzPlacement,
  type TakpatzTeamView,
} from '../../shared/takpatz';
import { columnName, XLSX_TYPE } from '../../shared/xlsx';
import { zipStore } from '../../shared/zip';
import { TAKPATZ_STYLES, TAKPATZ_THEME } from './takpatzTemplate';

export { XLSX_TYPE };

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

export const SHEET_NAMES = [BOARD_SHEET_NAMES.main, BOARD_SHEET_NAMES.alt, 'מעקב התנסויות ומשובים', 'תכנון התנסויות צוותיות', 'מיפוי שלישים לאחר ODT'] as const;

// ---------------- the file's cell styles (their numbers in its styles) ----------------

/** a week with nothing in it; the middle and the end of an experience merged over weeks */
const S = { empty: 9, mergeMid: 8, mergeEnd: 10 } as const;

/** an experience: its first cell when it spans weeks, its cell when it takes one */
const PLACEMENT_STYLE: Record<TakpatzCategory, { start: number; single: number }> = {
  broad_company: { start: 12, single: 71 },
  broad_team: { start: 24, single: 72 },
  command_team: { start: 50, single: 19 },
  instruct_team: { start: 74, single: 75 },
  instruct_company: { start: 73, single: 15 },
};

/** the planning sheet's three rows of a kind: its title, its experiences, who has each */
const PLAN_STYLE: Record<TakpatzCategory, { head: number; item: number; who: number }> = {
  broad_company: { head: 13, item: 17, who: 22 },
  broad_team: { head: 23, item: 25, who: 35 },
  command_team: { head: 38, item: 40, who: 42 },
  instruct_team: { head: 45, item: 48, who: 49 },
  instruct_company: { head: 52, item: 53, who: 55 },
};
/** the planning sheet calls the team's instruction "צוותי" in its second half */
const PLAN_TITLE: Partial<Record<`${TakpatzHalf}:${TakpatzCategory}`, string>> = { '2:instruct_team': 'הדרכתי - צוותי' };

// ---------------- a sheet's cells ----------------

class Strings {
  list: string[] = [];
  private index = new Map<string, number>();
  of(s: string): number {
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
}

/** a cell's text: the line breaks kept, nothing Excel cannot hold */
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

class Grid {
  private rows = new Map<number, { attrs: string; cells: Map<number, string> }>();
  merges: string[] = [];
  constructor(private strings: Strings) {}

  private row(r: number) {
    let row = this.rows.get(r);
    if (!row) {
      row = { attrs: '', cells: new Map() };
      this.rows.set(r, row);
    }
    return row;
  }

  rowAttrs(r: number, attrs: string): void {
    this.row(r).attrs = attrs;
  }

  /** a cell (column from 1) in a style, empty or with a text or a number */
  set(col: number, r: number, style: number, value?: string | number | null): void {
    const ref = `${columnName(col - 1)}${r}`;
    let xml: string;
    if (typeof value === 'number') xml = `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    else if (value) xml = `<c r="${ref}" s="${style}" t="s"><v>${this.strings.of(clean(value))}</v></c>`;
    else xml = `<c r="${ref}" s="${style}"/>`;
    this.row(r).cells.set(col, xml);
  }

  /** a text across columns `from`..`to`: one merged cell, its middle and end in their styles */
  span(from: number, to: number, r: number, style: number, value: string, mid: number = S.mergeMid, end: number = S.mergeEnd): void {
    this.set(from, r, style, value);
    if (to <= from) return;
    for (let c = from + 1; c < to; c++) this.set(c, r, mid);
    this.set(to, r, end);
    this.merges.push(`${columnName(from - 1)}${r}:${columnName(to - 1)}${r}`);
  }

  data(): string {
    const out = [...this.rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, row]) => {
        const cells = [...row.cells.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
        return cells.length ? `<row r="${r}"${row.attrs}>${cells.join('')}</row>` : `<row r="${r}"${row.attrs}/>`;
      });
    return `<sheetData>${out.join('')}</sheetData>`;
  }

  mergeXml(): string {
    return this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  }
}

const worksheet = (parts: string[]) => `${XML_HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">${parts.join('')}</worksheet>`;
const listRule = (sqref: string, values: string[]) =>
  `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${sqref}"><formula1>${esc(`"${values.join(',')}"`)}</formula1></dataValidation></dataValidations>`;

// ---------------- what cannot be written ----------------

/** experiences of one cadet in one plan that share a week - one cell cannot hold both */
export function exportProblems(view: TakpatzTeamView): string[] {
  const names = new Map(view.cadets.map((c) => [c.id, c.name]));
  const out: string[] = [];
  const scheduled = view.placements.filter((p) => p.weekFrom !== null && p.weekTo !== null);
  scheduled.forEach((a, i) => {
    for (const b of scheduled.slice(i + 1)) {
      if (a.cadetId === b.cadetId && a.board === b.board && a.weekFrom! <= b.weekTo! && b.weekFrom! <= a.weekTo!)
        out.push(`${names.get(a.cadetId) ?? ''}: "${a.label}" (${weekRange(a.weekFrom, a.weekTo)}) ו"${b.label}" (${weekRange(b.weekFrom, b.weekTo)}) באותו שבוע ב${a.board === 'main' ? 'תכנון הראשי' : 'תכנון הנוסף'}`);
    }
  });
  return out;
}

// ---------------- the two plans ("תקפץ א", "Sheet8") ----------------

const PROFILE_HEAD = ['שם הצוער', 'שליש', 'יעד אישי 1', 'יעד אישי 2', 'יעד אישי 3', 'הערות', 'רעיונות ומחשבות'];
/** the head row's styles in the file, column by column (A..P) */
const HEAD_STYLES = [1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 2, 2, 2, 3];
const WEEK_COL = 8; // H
/** experiences not in a week yet are kept beside the weeks, from column R on */
const ASIDE_COL = 18;

function writePlacement(g: Grid, r: number, col: number, p: TakpatzPlacement, weeks: number): void {
  const st = PLACEMENT_STYLE[p.category];
  if (weeks <= 1) g.set(col, r, st.single, p.label);
  else g.span(col, col + weeks - 1, r, st.start, p.label);
}

/** the cadets' rows: their own details, then the plan's experiences in the weeks and beside them */
function boardRows(g: Grid, view: TakpatzTeamView, board: TakpatzBoard, rowAttrs: string): void {
  const weeks = view.weeks.length;
  view.cadets.forEach((c, i) => {
    const r = 2 + i;
    g.rowAttrs(r, rowAttrs);
    g.set(1, r, 4, c.name);
    g.set(2, r, 5, c.third ? THIRD_LABELS[c.third] : null);
    c.goals.forEach((goal, k) => g.set(3 + k, r, 4, goal));
    g.set(6, r, c.notes ? 34 : S.empty, c.notes);
    g.set(7, r, c.ideas ? 31 : S.empty, c.ideas);
    for (let w = 0; w < weeks; w++) g.set(WEEK_COL + w, r, S.empty);
    const mine = view.placements.filter((p) => p.cadetId === c.id && p.board === board);
    for (const p of mine.filter((x) => x.weekFrom !== null)) writePlacement(g, r, WEEK_COL + (p.weekFrom! - FIRST_WEEK), p, p.weekTo! - p.weekFrom! + 1);
    let aside = ASIDE_COL;
    for (const p of mine.filter((x) => x.weekFrom === null)) {
      writePlacement(g, r, aside, p, p.span);
      aside += p.span;
    }
  });
}

function boardHead(g: Grid, view: TakpatzTeamView): void {
  // two lines: the week's number over its title
  g.rowAttrs(1, ' ht="30" customHeight="1"');
  PROFILE_HEAD.forEach((h, i) => g.set(1 + i, 1, HEAD_STYLES[i], h));
  view.weeks.forEach((w, i) => g.set(WEEK_COL + i, 1, HEAD_STYLES[WEEK_COL - 1 + i] ?? 2, `שבוע ${w.n}\n${w.title}`));
}

/** the main plan's legends under the cadets, as the file has them (and its hidden list of optional ones) */
function mainLegend(g: Grid, top: number): void {
  const at = (col: string) => col.charCodeAt(0) - 64;
  const ht = ' ht="14.25" customHeight="1"';
  for (let r = top; r <= top + 5; r++) g.rowAttrs(r, ht);
  g.span(at('C'), at('D'), top, 54, 'רוחב פלוגתי');
  g.span(at('E'), at('H'), top, 23, 'רוחב צוותי');
  g.set(at('I'), top, 52, 'הדרכתי - פלוגתי');
  g.merges.push(`I${top}:K${top}`);
  const items: [string, number, string?][] = [
    ['C', 17, 'קל"ג '],
    ['D', 17, 'קחו"ם'],
    ['E', 25, 'קה"ד'],
    ['F', 25, 'א. סימולציות'],
    ['G', 56],
    ['H', 25, 'קחו"ם'],
    ['I', 53, 'סק"ם מלחמה'],
    ['J', 53, "התנסות אוכ'"],
    ['K', 53, 'קרוסלת כלים'],
    ['L', 58, 'סיור סד"ח X4'],
    ['N', 60, 'ממ"ש'],
  ];
  for (const [c, s, v] of items) g.set(at(c), top + 1, s, v);
  for (const [c, s] of [['C', 62], ['D', 22], ['E', 35], ['F', 35], ['G', 35], ['H', 35], ['I', 55], ['J', 55], ['K', 55]] as const) g.set(at(c), top + 2, s);
  g.set(at('C'), top + 3, 38, 'פיקודי - צוות');
  for (const c of 'DEFGH') g.set(at(c), top + 3, 66);
  g.set(at('I'), top + 3, 67);
  ['ממ"ש היסוד', 'ממ"ש שטח', 'מ"כ שטח', 'ממ"ש המקצוע', 'ממ"ש מנהיגות + ניווטים', 'ממ"ש פרט', "א' צוות"].forEach((v, i) => g.set(at('C') + i, top + 4, 40, v));
  for (let i = 0; i < 7; i++) g.set(at('C') + i, top + 5, 42);
  const hidden = ' ht="14.25" hidden="1" customHeight="1"';
  for (let r = top + 13; r <= top + 16; r++) g.rowAttrs(r, hidden);
  g.set(at('H'), top + 13, 68, 'אופציונלי:');
  g.set(at('I'), top + 13, 68, 'קמן');
  g.set(at('I'), top + 14, 68, 'קאג צוותי');
}

const MAIN_COLS =
  '<cols><col customWidth="1" min="1" max="1" width="13.86"/><col customWidth="1" hidden="1" min="2" max="2" width="12.57"/><col customWidth="1" min="3" max="3" width="32.29"/><col customWidth="1" min="4" max="4" width="22.0"/><col customWidth="1" min="5" max="5" width="22.71"/><col customWidth="1" min="6" max="6" width="20.43"/><col customWidth="1" min="7" max="7" width="17.71"/><col customWidth="1" min="8" max="8" width="11.14"/><col customWidth="1" min="9" max="9" width="16.43"/><col customWidth="1" min="10" max="10" width="15.57"/><col customWidth="1" min="11" max="11" width="12.57"/><col customWidth="1" min="12" max="12" width="10.86"/><col customWidth="1" min="13" max="13" width="17.0"/><col customWidth="1" min="14" max="14" width="17.43"/><col customWidth="1" min="15" max="15" width="13.43"/><col customWidth="1" min="16" max="18" width="13.71"/><col customWidth="1" min="19" max="19" width="16.43"/><col customWidth="1" min="20" max="20" width="12.71"/><col customWidth="1" min="21" max="21" width="13.0"/><col customWidth="1" min="22" max="22" width="15.29"/><col customWidth="1" min="23" max="28" width="8.71"/></cols>';
const FORMAT = '<sheetFormatPr customHeight="1" defaultColWidth="14.43" defaultRowHeight="15.0"/>';
const PAGE = '<printOptions/><pageMargins bottom="0.75" footer="0.0" header="0.0" left="0.7" right="0.7" top="0.75"/><pageSetup orientation="portrait"/>';
const OUTLINE = '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>';

/** the last column of the plan's head (P with nine weeks) */
const lastHeadCol = (view: TakpatzTeamView) => columnName(WEEK_COL - 2 + view.weeks.length);

function mainSheet(view: TakpatzTeamView, strings: Strings): string {
  const g = new Grid(strings);
  boardHead(g, view);
  boardRows(g, view, 'main', ' ht="14.25" customHeight="1"');
  const last = view.cadets.length + 1;
  mainLegend(g, last + 4);
  return worksheet([
    '<sheetPr><pageSetUpPr/></sheetPr>',
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane xSplit="1.0" ySplit="1.0" topLeftCell="B2" activePane="bottomRight" state="frozen"/><selection activeCell="B1" sqref="B1" pane="topRight"/><selection activeCell="A2" sqref="A2" pane="bottomLeft"/><selection activeCell="B2" sqref="B2" pane="bottomRight"/></sheetView></sheetViews>',
    FORMAT,
    MAIN_COLS,
    g.data(),
    `<autoFilter ref="$A$1:$${lastHeadCol(view)}$${last}"/>`,
    g.mergeXml(),
    PAGE,
  ]);
}

function altSheet(view: TakpatzTeamView, strings: Strings): string {
  const g = new Grid(strings);
  boardHead(g, view);
  boardRows(g, view, 'alt', '');
  return worksheet([
    OUTLINE,
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane xSplit="1.0" topLeftCell="B1" activePane="topRight" state="frozen"/><selection activeCell="C2" sqref="C2" pane="topRight"/></sheetView></sheetViews>',
    FORMAT,
    g.data(),
    g.mergeXml(),
  ]);
}

// ---------------- the tracking ("מעקב התנסויות ומשובים") ----------------

const TRACK_HEAD = ['התנסות', 'צוער', ...TRACK_STAGES.map((s) => s.label)];

function trackingSheet(view: TakpatzTeamView, strings: Strings): { xml: string; table: string } {
  const g = new Grid(strings);
  const ht = ' ht="22.5" customHeight="1"';
  g.rowAttrs(1, ht);
  TRACK_HEAD.forEach((h, i) => g.set(1 + i, 1, 26, h));
  const rows = view.tracking;
  rows.forEach((t, i) => {
    const r = 2 + i;
    g.rowAttrs(r, ht);
    g.set(1, r, 30, t.label);
    g.set(2, r, 30, t.cadetName);
    STAGE_KEYS.forEach((k, j) => {
      const s = t.stages[k].status;
      g.set(3 + j, r, j < 2 ? 30 : 36, s ? STATUS_LABELS[s] : null);
    });
  });
  // a table holds at least one row under its head
  const last = Math.max(2, rows.length + 1);
  if (!rows.length) for (let c = 1; c <= 7; c++) g.set(c, 2, c <= 4 ? 30 : 36);
  const xml = worksheet([
    OUTLINE,
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1.0" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection activeCell="B3" sqref="B3" pane="bottomLeft"/></sheetView></sheetViews>',
    FORMAT,
    '<cols><col customWidth="1" min="1" max="1" width="15.14"/><col customWidth="1" min="3" max="3" width="20.29"/><col customWidth="1" min="6" max="6" width="15.14"/><col customWidth="1" min="7" max="7" width="15.57"/></cols>',
    g.data(),
    listRule(`C2:G${last}`, Object.values(STATUS_LABELS)),
    '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>',
  ]);
  const table =
    `${XML_HEAD}<table xmlns="${MAIN}" ref="A1:G${last}" displayName="Table_1" name="Table_1" id="1"><autoFilter ref="A1:G${last}"/>` +
    `<tableColumns count="7">${TRACK_HEAD.map((h, i) => `<tableColumn name="${esc(h)}" id="${i + 1}"/>`).join('')}</tableColumns>` +
    '<tableStyleInfo name="מעקב התנסויות ומשובים-style" showColumnStripes="0" showFirstColumn="1" showLastColumn="1" showRowStripes="1"/></table>';
  return { xml, table };
}

// ---------------- the team's planning by halves ("תכנון התנסויות צוותיות") ----------------

function planningSheet(view: TakpatzTeamView, strings: Strings): string {
  const g = new Grid(strings);
  const names = new Map(view.cadets.map((c) => [c.id, c.name]));
  const items = (half: TakpatzHalf, kind: string) => view.catalog.filter((x) => x.half === half && x.kind === kind);
  const kinds = TAKPATZ_CATEGORIES.filter((k) => TAKPATZ_HALVES.some((h) => items(h, k).length));
  // each half as wide as its widest kind (the file: five columns, then four)
  const width = (h: TakpatzHalf) => Math.max(2, ...kinds.map((k) => items(h, k).length));
  const start: Record<TakpatzHalf, number> = { 1: 1, 2: width(1) + 2 };
  const widths: Record<number, number> = {};
  const fit = (col: number, s: string) => {
    widths[col] = Math.max(widths[col] ?? 0, Math.max(...s.split('\n').map((l) => l.length)) * 0.84);
  };
  for (const h of TAKPATZ_HALVES) {
    const from = start[h];
    const to = from + width(h) - 1;
    g.span(from, to, 1, 7, HALF_LABELS[h]);
    kinds.forEach((k, ki) => {
      const list = items(h, k);
      if (!list.length) return;
      const top = 2 + ki * 3;
      const st = PLAN_STYLE[k];
      const n = list.length;
      g.span(from, from + n - 1, top, st.head, PLAN_TITLE[`${h}:${k}`] ?? CATEGORY_INFO[k].label);
      list.forEach((item, i) => {
        const who = view.placements
          .filter((p) => p.board === 'main' && p.catalogId === item.id)
          .map((p) => `${names.get(p.cadetId) ?? ''}${p.label !== item.name ? ` (${p.label})` : ''}`)
          .join(', ');
        g.set(from + i, top + 1, st.item, item.name);
        g.set(from + i, top + 2, st.who, who);
        fit(from + i, item.name);
        if (who) fit(from + i, who);
      });
      // the rest of the half's width in gray, a line at its end
      for (let r = top; r <= top + 2; r++) for (let c = from + n; c <= to; c++) g.set(c, r, c === to ? 16 : 14);
    });
  }
  // the roles a broad company experience can take, one column for each half, beside them
  const rolesCol = start[2] + width(2) + 1;
  const roles = TAKPATZ_HALVES.map((h) => items(h, 'role'));
  const rolesLen = Math.max(...roles.map((r) => r.length));
  roles.forEach((list, i) => {
    for (let k = 0; k < rolesLen; k++) {
      if (list[k]) {
        g.set(rolesCol + i, 3 + k, 20, list[k].name);
        fit(rolesCol + i, list[k].name);
      } else g.set(rolesCol + i, 3 + k, 43);
    }
  });
  // the colors' legend, under the planning
  const legend = 2 + kinds.length * 3 + 3;
  g.set(1, legend, 59, 'קל"ג');
  g.merges.push(`A${legend}:D${legend}`);
  g.set(1, legend + 2, 61, 'קחו"ם צוותי');
  g.merges.push(`A${legend + 2}:D${legend + 2}`);
  g.set(1, legend + 4, 63, 'ממ"ש');
  g.set(1, legend + 6, 64, 'סק"ן כוכבים');
  g.set(1, legend + 8, 65, 'קרוסלת כלים');
  const defaultWidth = 14.43;
  const cols = Object.entries(widths)
    .map(([c, w]) => [Number(c), Math.max(Number(c) === 8 ? 18.43 : defaultWidth, Math.round(w * 100) / 100)] as const)
    .filter(([c, w]) => w > defaultWidth || c === 8)
    .sort((a, b) => a[0] - b[0]);
  return worksheet([
    OUTLINE,
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>',
    FORMAT,
    cols.length ? `<cols>${cols.map(([c, w]) => `<col customWidth="1" min="${c}" max="${c}" width="${w}"/>`).join('')}</cols>` : '',
    g.data(),
    g.mergeXml(),
  ]);
}

// ---------------- the thirds after the ODT ("מיפוי שלישים לאחר ODT") ----------------

function thirdsSheet(view: TakpatzTeamView, strings: Strings): string {
  const g = new Grid(strings);
  const n = view.cadets.length;
  g.set(1, 1, 69, 'שם');
  g.set(2, 1, 69, 'שליש');
  g.set(3, 1, 69, `מספור (1-${Math.max(n, 1)})`);
  const sorted = [...view.cadets].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name, 'he'));
  sorted.forEach((c, i) => {
    g.set(1, 2 + i, 70, c.name);
    g.set(2, 2 + i, 70, c.third ? THIRD_LABELS[c.third] : null);
    g.set(3, 2 + i, 70, c.rank ?? null);
  });
  const last = Math.max(2, n + 1);
  if (!n) for (let c = 1; c <= 3; c++) g.set(c, 2, 70);
  return worksheet([
    OUTLINE,
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>',
    FORMAT,
    g.data(),
    `<autoFilter ref="$A$1:$C$${last}"><sortState ref="A1:C${last}"><sortCondition ref="C1:C${last}"/></sortState></autoFilter>`,
    listRule(`B2:B${last}`, Object.values(THIRD_LABELS)),
  ]);
}

// ---------------- the workbook ----------------

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** the team's takpatz as the spreadsheet; the caller checked who may have it */
export function takpatzXlsx(view: TakpatzTeamView): Uint8Array {
  const problems = exportProblems(view);
  if (problems.length) throw new Error(`overlap: ${problems.join('; ')}`);
  const strings = new Strings();
  const main = mainSheet(view, strings);
  const alt = altSheet(view, strings);
  const tracking = trackingSheet(view, strings);
  const planning = planningSheet(view, strings);
  const thirds = thirdsSheet(view, strings);
  const sheets = [main, alt, tracking.xml, planning, thirds];
  const mainLast = view.cadets.length + 1;
  const thirdsLast = Math.max(2, view.cadets.length + 1);
  const workbook =
    `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><workbookPr/><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
    SHEET_NAMES.map((n, i) => `<sheet state="visible" name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 4}"/>`).join('') +
    '</sheets><definedNames>' +
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${esc(`${quoteSheet(SHEET_NAMES[0])}!$A$1:$${lastHeadCol(view)}$${mainLast}`)}</definedName>` +
    `<definedName name="_xlnm._FilterDatabase" localSheetId="4" hidden="1">${esc(`${quoteSheet(SHEET_NAMES[4])}!$A$1:$C$${thirdsLast}`)}</definedName>` +
    '</definedNames><calcPr/></workbook>';
  const rels =
    `${XML_HEAD}<Relationships xmlns="${PKG}">` +
    `<Relationship Id="rId1" Type="${REL}/theme" Target="theme/theme1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 4}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    '</Relationships>';
  const shared =
    `${XML_HEAD}<sst xmlns="${MAIN}" count="${strings.list.length}" uniqueCount="${strings.list.length}">` +
    strings.list.map((s) => `<si><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`).join('') +
    '</sst>';
  const types =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>' +
    '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  const core =
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(`תקפ״צ - ${view.team.name}`)}</dc:title><dc:language>he-IL</dc:language></cp:coreProperties>`;
  return zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: core },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/styles.xml', data: TAKPATZ_STYLES },
    { name: 'xl/theme/theme1.xml', data: TAKPATZ_THEME },
    { name: 'xl/sharedStrings.xml', data: shared },
    ...sheets.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
    { name: 'xl/worksheets/_rels/sheet3.xml.rels', data: `${XML_HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table1.xml"/></Relationships>` },
    { name: 'xl/tables/table1.xml', data: tracking.table },
  ]);
}

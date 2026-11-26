// Excel files made in the page: one sheet, right to left, the head row bold on a tint, frozen and with
// filters, columns as wide as what they hold, the text as text (never a formula). Google Drive opens such
// a file as a Google Sheets spreadsheet.

import { esc, XML_HEAD } from './docx';
import { zipStore } from './zip';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type SheetCell = string | number | null | undefined;

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** the column's letters: 0 -> A, 25 -> Z, 26 -> AA */
export function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** a sheet's name as Excel takes it: up to 31 characters, none of []:*?/\ */
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'גיליון';

// the head row: bold, on the tint, a line under it; the rest wraps and starts at the top of its cell
const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="11"/><name val="Arial"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3E9F4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8C8C8C"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** a column as wide as its longest line, within reason */
function widthOf(values: SheetCell[]): number {
  let longest = 6;
  for (const v of values) for (const line of String(v ?? '').split('\n')) longest = Math.max(longest, line.length);
  return Math.min(60, Math.round(longest * 1.15 + 2));
}

/** one sheet: its name, the head row and the rows under it */
export function xlsxFile(name: string, header: string[], rows: SheetCell[][]): Uint8Array {
  const strings: string[] = [];
  const index = new Map<string, number>();
  const text = (s: string) => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i;
  };
  const all = [header, ...rows];
  const cols = Math.max(1, ...all.map((r) => r.length));
  const xmlRows = all
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          if (v === null || v === undefined || v === '') return '';
          const ref = `${columnName(ci)}${ri + 1}`;
          const style = ri === 0 ? 1 : 2;
          return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}" s="${style}"><v>${v}</v></c>` : `<c r="${ref}" s="${style}" t="s"><v>${text(String(v))}</v></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  const last = `${columnName(cols - 1)}${all.length}`;
  const widths = Array.from({ length: cols }, (_, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${widthOf(all.map((r) => r[ci]))}" customWidth="1"/>`).join('');
  const sheet =
    `${XML_HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${xmlRows}</sheetData>` +
    (rows.length ? `<autoFilter ref="A1:${last}"/>` : '') +
    '</worksheet>';
  const shared = `${XML_HEAD}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  const workbook = `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="${esc(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zipStore([
    {
      name: '[Content_Types].xml',
      data:
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    { name: 'xl/workbook.xml', data: workbook },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/sharedStrings.xml', data: shared },
  ]);
}

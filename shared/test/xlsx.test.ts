// A table as an Excel file: the parts Excel and Google Sheets read, right to left, the head row styled and
// frozen, numbers as numbers and text as text (never a formula), every word escaped.

import { describe, expect, it } from 'vitest';
import { columnName, xlsxFile } from '../xlsx';

function files(zip: Uint8Array): Map<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  for (let at = 0; v.getUint32(at, true) === 0x04034b50; ) {
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen));
    out.set(name, new TextDecoder().decode(zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size)));
    at += 30 + nameLen + size;
  }
  return out;
}

describe('a table as an Excel file', () => {
  const zip = files(xlsxFile('משימות: שבוע 3', ['משימה', 'אחראי', 'ימים'], [['סגירת לו"ז & תיאום', 'מפק"צ 2', 3], ['=SUM(A1)', null, 0], ['שורה\nשנייה', '', 12.5]]));

  it('holds the parts, the sheet named as Excel allows', () => {
    expect([...zip.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', 'xl/sharedStrings.xml']);
    expect(zip.get('xl/workbook.xml')).toContain('<sheet name="משימות  שבוע 3" sheetId="1" r:id="rId1"/>');
  });

  it('right to left, the head row styled and frozen, filters over the table', () => {
    const sheet = zip.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:C4"/>');
    expect(sheet).toContain('<c r="A1" s="1" t="s"><v>0</v></c>');
    // numbers stay numbers; an empty cell is left out
    expect(sheet).toContain('<c r="C2" s="2"><v>3</v></c>');
    expect(sheet).toContain('<c r="C3" s="2"><v>0</v></c>');
    expect(sheet).not.toContain('r="B3"');
    // nothing is ever a formula
    expect(sheet).not.toContain('<f>');
  });

  it('keeps every word, escaped, once', () => {
    const shared = zip.get('xl/sharedStrings.xml')!;
    expect(shared).toContain('<t xml:space="preserve">סגירת לו&quot;ז &amp; תיאום</t>');
    expect(shared).toContain('<t xml:space="preserve">=SUM(A1)</t>');
    expect(shared).toContain('שורה\nשנייה');
    expect(shared.match(/<si>/g)).toHaveLength(7);
  });

  it('names columns past Z as Excel does', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

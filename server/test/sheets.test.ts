// Cadet lists from spreadsheets: Excel files in the common layouts, CSV, Google
// links, and an import that moves cadets between teams instead of adding copies.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cadetsFromSpreadsheet, googleDownloadUrls, readCsv, setSheetFetcher } from '../src/sheets';
import { setup, zip, type Ctx } from './helpers';

/** A minimal .xlsx (stored zip entries): one sheet per array of rows. */
function xlsx(sheets: Record<string, (string | number)[][]>): Buffer {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const names = Object.keys(sheets);
  const files: [string, string][] = [
    ['xl/workbook.xml', `<workbook xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ...names.map((n, i): [string, string] => [
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet><sheetData>${sheets[n]
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((v, c) => {
                if (v === '') return '';
                if (typeof v === 'number') return `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`;
                strings.push(v);
                return `<c r="${col(c)}${r + 1}" t="s"><v>${strings.length - 1}</v></c>`;
              })
              .join('')}</row>`,
        )
        .join('')}</sheetData></worksheet>`,
    ]),
  ];
  files.push(['xl/sharedStrings.xml', `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`]);
  return zip(files);
}

// like a course grade sheet: the "צוות" column numbers the cadets, the team is a title row above them
const gradeSheet = xlsx({
  ציונים: [
    ['צוות', 'מספר אישי', 'שם משפחה', 'שם פרטי', 'מבחן 1'],
    ['אלון'],
    [1, 9397319.0, 'גור אריה', 'יהב', 90],
    [2, 9239377, 'שפיגלר', 'איתן משה', 85],
    ['גיורא'],
    [1, 9198271, 'שמש', 'עמית', ''],
  ],
});

describe('reading a spreadsheet', () => {
  it('finds the cadets under team title rows, keeping first and last names apart', () => {
    const r = cadetsFromSpreadsheet(gradeSheet);
    expect(r).toMatchObject({ sheet: 'ציונים', cadets: 3, teams: ['אלון', 'גיורא'] });
    expect(r.text.split('\n')).toEqual([
      'שם פרטי\tשם משפחה\tמספר אישי\tטלפון\tצוות',
      'יהב\tגור אריה\t9397319\t\tאלון',
      'איתן משה\tשפיגלר\t9239377\t\tאלון',
      'עמית\tשמש\t9198271\t\tגיורא',
    ]);
  });

  it('reads a column for each team, and skips sheets without a list', () => {
    const r = cadetsFromSpreadsheet(xlsx({ ריק: [['הערות כלליות']], צוותים: [['צוות 1', '', 'צוות 2'], ['הילה ליפיק', '', 'עמית שמש'], ['סתיו שגב']] }));
    expect(r).toMatchObject({ sheet: 'צוותים', cadets: 3, teams: ['צוות 1', 'צוות 2'] });
    expect(r.text.split('\n')).toEqual(['שם מלא\tצוות', 'הילה ליפיק\tצוות 1', 'סתיו שגב\tצוות 1', 'עמית שמש\tצוות 2']);
  });

  it('reads CSV with quotes, and says so when there is no list', () => {
    expect(readCsv('שם מלא,צוות\n"כהן, דני",אלון\r\nמאיה לוי,"גיורא"')).toEqual([
      ['שם מלא', 'צוות'],
      ['כהן, דני', 'אלון'],
      ['מאיה לוי', 'גיורא'],
    ]);
    expect(() => cadetsFromSpreadsheet(Buffer.from('סתם טקסט'))).toThrow(/לא נמצאה בקובץ רשימת צוערים/);
  });

  it('turns Google Sheets and Drive links into download addresses, and nothing else', () => {
    expect(googleDownloadUrls('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?usp=sharing&rtpof=true')).toEqual([
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=xlsx',
      'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
    ]);
    expect(googleDownloadUrls('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view')[1]).toContain('id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    for (const bad of ['https://example.com/d/1AbCdEfGhIjKlMnOpQrStUvW/x', 'http://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvW/edit', 'not a link']) {
      expect(() => googleDownloadUrls(bad)).toThrow();
    }
  });
});

describe('importing cadets from a spreadsheet', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });
  afterEach(() => setSheetFetcher(async () => new Response('', { status: 404 })));

  it('reads an uploaded file into the import box, then imports it', async () => {
    const res = await c.cmd.post('/api/cadets/import/file').set('content-type', 'application/octet-stream').send(gradeSheet);
    expect(res.status).toBe(200);
    expect(res.body.cadets).toBe(3);
    expect((await c.s1.post('/api/cadets/import/file').set('content-type', 'application/octet-stream').send(gradeSheet)).status).toBe(403);
    expect((await c.cmd.post('/api/cadets/import', { text: res.body.text })).body).toEqual({ imported: 3, updated: 0, skipped: 0 });
  });

  it('downloads a shared Google sheet; one that is not shared says how to share it', async () => {
    let shared = false;
    const asked: string[] = [];
    setSheetFetcher(async (url) => {
      asked.push(url);
      if (!shared || url.includes('/export')) return new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(gradeSheet, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    });
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?usp=sharing';
    const closed = await c.cmd.post('/api/cadets/import/link', { url });
    expect(closed.status).toBe(400);
    expect(closed.body.error).toContain('כל מי שיש לו את הקישור');
    shared = true;
    const open = await c.cmd.post('/api/cadets/import/link', { url });
    expect(open.body).toMatchObject({ cadets: 3, teams: ['אלון', 'גיורא'] });
    expect(asked.at(-1)).toContain('drive.google.com/uc');
  });

  it('a list with other team names moves cadets instead of adding copies', async () => {
    const team1 = (await c.cmd.post('/api/teams', { name: 'צוות 1 - אלון' })).body[0].id;
    await c.cmd.post('/api/cadets/import', { text: 'שם פרטי\tשם משפחה\tמספר אישי\tצוות\nיהב\tגור אריה\t9397319\tגיורא\nעמית\tשמש\t\tגיורא' });
    // the corrected list: "אלון" is the existing "צוות 1 - אלון"; עמית שמש gets his personal number
    const r = await c.cmd.post('/api/cadets/import', { text: 'שם מלא\tמספר אישי\tצוות\nיהב גור אריה\t9397319\tאלון\nעמית שמש\t9198271\tגיורא\nסתיו שגב\t9416936\tאלון' });
    expect(r.body).toEqual({ imported: 1, updated: 2, skipped: 0 });
    const cadets = (await c.cmd.get('/api/cadets')).body as { fullName: string; personalNumber: string; teamId: number }[];
    expect(cadets).toHaveLength(3);
    expect(cadets.find((x) => x.fullName === 'יהב גור אריה')).toMatchObject({ teamId: team1 });
    expect(cadets.find((x) => x.fullName === 'עמית שמש')).toMatchObject({ personalNumber: '9198271' });
    expect(cadets.find((x) => x.fullName === 'סתיו שגב')).toMatchObject({ teamId: team1 });
    expect((await c.cmd.get('/api/teams')).body.map((t: { name: string }) => t.name)).toEqual(['צוות 1 - אלון', 'גיורא']);
  });
});

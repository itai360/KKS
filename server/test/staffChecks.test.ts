// The staff's checklist for each cadet: a table for each team, a square marked once it happened; the assignment's
// needs its grade - into the cadet's evaluation file, and into the course's grade sheet (an Excel file in Google
// Drive, written as it is). And the team commanders' weekly ממ"ש tasks.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StaffChecksBoard } from '../../shared/types';
import { zipStore } from '../../shared/zip';
import { Db, db, migrate } from '../src/db';
import { seal } from '../src/gcalSync';
import { setSheetFetch } from '../src/gradeSheet';
import { generateRecurring } from '../src/recurring';
import { readXlsx } from '../src/sheets';
import { locate, setCellXml, writeGradeXlsx } from '../src/xlsxPatch';
import { setup, staffMay, type Ctx } from './helpers';

/** a grade sheet as the course keeps it: a header, then each team under its commander's name (made-up people) */
function gradeSheet(): Buffer {
  const strings = ['צוות', 'מספר אישי', 'שם פרטי', 'שם משפחה', 'מבחן 1', 'ציון ספרא סייפא', 'ממוצע', 'מפקד א', 'רועי', 'אלון', 'שירה', 'גל'];
  const s = (t: string) => `<c t="s"><v>${strings.indexOf(t)}</v></c>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1" spans="1:7"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>6</v></c></row>
<row r="2"><c r="A2" t="s"><v>7</v></c></row>
<row r="3" spans="1:7"><c r="A3"><v>1</v></c><c r="B3"><v>1234567</v></c><c r="C3" t="s"><v>8</v></c><c r="D3" t="s"><v>9</v></c><c r="E3" s="2"><v>90</v></c><c r="F3" s="2"/><c r="G3"><f>AVERAGE(E3:F3)</f><v>90</v></c></row>
<row r="4" spans="1:5"><c r="A4"><v>2</v></c><c r="B4"><v>7654321</v></c><c r="C4" t="s"><v>10</v></c><c r="D4" t="s"><v>11</v></c><c r="E4"><v>80</v></c></row>
</sheetData></worksheet>`.replace(/\n/g, '');
  void s;
  const shared = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
  return Buffer.from(
    zipStore([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="ציונים" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      { name: 'xl/sharedStrings.xml', data: shared },
      { name: 'xl/media/logo.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
    ]),
  );
}

describe('a grade into the grade sheet, the file kept as it is', () => {
  it('finds the row by personal number (or name) and the column by its header; one cell changes', () => {
    const out = writeGradeXlsx(gradeSheet(), { pn: '1234567', first: 'רועי', last: 'אלון' }, 'ציון ספרא סייפא', 87);
    if ('error' in out) throw new Error(out.error);
    expect(out.cell).toBe('F3');
    const [sheet] = readXlsx(out.file);
    expect(sheet.rows[2]).toEqual(['1', '1234567', 'רועי', 'אלון', '90', '87', '90']);
    expect(sheet.rows[3].slice(0, 5)).toEqual(['2', '7654321', 'שירה', 'גל', '80']);
    // by name, a cell that was not there - in its place in the row
    const byName = writeGradeXlsx(out.file, { pn: '', first: 'שירה', last: 'גל' }, 'ספרא סייפא', 92.5);
    if ('error' in byName) throw new Error(byName.error);
    expect(byName.cell).toBe('F4');
    expect(readXlsx(byName.file)[0].rows[3]).toEqual(['2', '7654321', 'שירה', 'גל', '80', '92.5']);
    // the cell's look stays; the other files of the workbook too
    expect(setCellXml('<sheetData><row r="3"><c r="F3" s="2"/></row></sheetData>', 3, 5, 87)).toBe('<sheetData><row r="3"><c r="F3" s="2"><v>87</v></c></row></sheetData>');
    expect(byName.file.includes(Buffer.from('logo.png'))).toBe(true);
  });

  it('says why, when it cannot', () => {
    expect(writeGradeXlsx(gradeSheet(), { pn: '1111111', first: 'אין', last: 'כזה' }, 'ציון ספרא סייפא', 80)).toEqual({ error: 'הצוער לא נמצא בגליון (לפי מספר אישי או שם)' });
    expect(writeGradeXlsx(gradeSheet(), { pn: '1234567', first: '', last: '' }, 'ציון אחר לגמרי', 80)).toEqual({ error: 'לא נמצאה בגליון עמודה "ציון אחר לגמרי"' });
    expect(setCellXml('<row r="3"><c r="G3"><f>SUM(A1)</f></c></row>', 3, 6, 1)).toEqual({ error: 'בתא של הציון בגליון יש נוסחה - לא נכתב' });
    expect(writeGradeXlsx(Buffer.from('not a zip'), { pn: '1', first: '', last: '' }, 'x', 1)).toEqual({ error: 'קובץ הגליון אינו קובץ אקסל תקין' });
    // a Google Sheets file's values: the same search
    expect(locate([{ row: 1, cells: ['מספר אישי', 'ציון ספרא סייפא'] }, { row: 2, cells: ['555', ''] }], { pn: '555', first: '', last: '' }, 'ציון ספרא סייפא')).toEqual({ row: 2, col: 1 });
  });
});

describe("the staff's checklist", () => {
  let c: Ctx;
  let cadet: number;
  beforeEach(async () => {
    c = await setup();
    const team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
    cadet = (await c.cmd.post('/api/cadets', { firstName: 'רועי', lastName: 'אלון', personalNumber: '1234567', teamId: team })).body.cadet.id;
  });
  afterEach(() => setSheetFetch(null));

  const board = async () => (await c.s1.get('/api/staff-checks')).body as StaffChecksBoard;

  it("a square marked once it happened - by the team's commander; the assignment's needs its grade, which goes into the evaluation file", async () => {
    const b = await board();
    expect(b.teams[0]).toMatchObject({ name: 'צוות 1', mine: true, canMark: true, cadets: [{ id: cadet, name: 'רועי אלון', marks: {} }] });
    expect(b.sheet).toMatchObject({ connected: false, canManage: false });

    expect((await c.s1.put(`/api/staff-checks/${cadet}/opening_talk`, { done: true })).status).toBe(200);
    expect((await c.s1.put(`/api/staff-checks/${cadet}/nope`, { done: true })).status).toBe(404);
    expect((await c.s1.put(`/api/staff-checks/${cadet}/sifra_assignment`, { done: true })).body.error).toContain('צריך לרשום את הציון');
    expect((await c.s1.put(`/api/staff-checks/${cadet}/sifra_assignment`, { done: true, grade: 120 })).status).toBe(400);
    const r = await c.s1.put(`/api/staff-checks/${cadet}/sifra_assignment`, { done: true, grade: 88 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mark).toMatchObject({ grade: 88, sheet: 'off', byName: 'מפק"צ 1' });
    const marks = (await board()).teams[0].cadets[0].marks;
    expect(Object.keys(marks).sort()).toEqual(['opening_talk', 'sifra_assignment']);
    // one of the course's grades in the cadet's evaluation file
    expect(db().get<{ value: number }>("SELECT v.value FROM grade_values v JOIN grade_items i ON i.id = v.item_id WHERE i.name = 'ציון ספרא סייפא' AND v.cadet_id = ?", cadet)?.value).toBe(88);

    // cleared
    expect((await c.s1.put(`/api/staff-checks/${cadet}/opening_talk`, { done: false })).body.mark).toBeNull();
    expect(Object.keys((await board()).teams[0].cadets[0].marks)).toEqual(['sifra_assignment']);

    // another staff member, when the commander did not open every team's cadets to the staff: not theirs to mark
    await staffMay(c, { cadets: false });
    expect((await c.s2.get('/api/staff-checks')).body.teams[0]).toMatchObject({ canMark: false, mine: false });
    expect((await c.s2.put(`/api/staff-checks/${cadet}/opening_talk`, { done: true })).status).toBe(403);
    expect((await c.s1.put(`/api/staff-checks/${cadet}/opening_talk`, { done: true })).status).toBe(200);
  });

  it('with the grade sheet connected: the grade is written into the Excel file in Drive', async () => {
    process.env.GOOGLE_CLIENT_ID ||= 'test-client';
    process.env.GOOGLE_CLIENT_SECRET ||= 'test-secret';
    const fileId = 'FILE_ID_FOR_THE_TEST_0123456789';
    expect((await c.cmd.put('/api/grade-sheet', { url: `https://docs.google.com/spreadsheets/d/${fileId}/edit` })).body).toMatchObject({ url: expect.stringContaining(fileId), connected: false, canManage: true });
    db().run("UPDATE grade_sheet SET refresh_token = ?, email = 'editor@example.com' WHERE id = 1", seal('refresh-token'));
    let uploaded: Buffer | null = null;
    setSheetFetch(async (url, init) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'access', expires_in: 3600 });
      if (url.includes(`/files/${fileId}?fields=`)) return Response.json({ id: fileId, name: 'גליון ציונים', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', capabilities: { canEdit: true } });
      if (url.includes(`/files/${fileId}?alt=media`)) return new Response(new Uint8Array(gradeSheet()));
      if (url.includes(`/upload/drive/v3/files/${fileId}`) && init?.method === 'PATCH') {
        uploaded = Buffer.from(init.body as Uint8Array);
        return Response.json({ id: fileId });
      }
      return new Response('not found', { status: 404 });
    });
    const r = await c.s1.put(`/api/staff-checks/${cadet}/sifra_assignment`, { done: true, grade: 91 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mark).toMatchObject({ grade: 91, sheet: 'written', sheetNote: 'ציונים F3' });
    expect(readXlsx(uploaded!)[0].rows[2][5]).toBe('91');

    // Google says no: the grade is kept, why it did not reach the sheet is told, and it is tried again
    setSheetFetch(async (url) => (url.startsWith('https://oauth2.googleapis.com/token') ? Response.json({ access_token: 'access2', expires_in: 3600 }) : new Response('', { status: 403 })));
    const denied = await c.s1.put(`/api/staff-checks/${cadet}/sifra_assignment`, { done: true, grade: 93 });
    expect(denied.body.mark).toMatchObject({ grade: 93, sheet: 'error', sheetNote: 'לחשבון המחובר אין הרשאה לערוך את הגליון' });
    expect((await c.cmd.post('/api/staff-checks/sheet/retry')).body).toEqual({ written: 0, failed: 1 });
  });
});

describe("the team commanders' weekly ממ\"ש tasks", () => {
  it('a course with a staff gets them once; each team commander a task of their own, on Tuesday and on Thursday', async () => {
    const c = await setup();
    // the course's database as it was before them, its staff in it: brought up to date
    const old = new Db(':memory:');
    migrate(old, 63);
    old.run("INSERT INTO users(username, password_hash, display_name, role, created_at) VALUES ('x', 'x', 'מפקד', 'commander', '2026-01-01')");
    migrate(old);
    expect(old.all<{ title: string; weekdays: string; assignee: string }>('SELECT title, weekdays, assignee FROM recurring_rules ORDER BY id')).toEqual([
      { title: 'הורדת התנסות ממ״ש', weekdays: '[2]', assignee: 'team_commanders' },
      { title: 'לעשות אישור תכניות ממ״ש', weekdays: '[4]', assignee: 'team_commanders' },
    ]);
    old.close();

    await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 });
    await c.cmd.post('/api/teams', { name: 'צוות 2', commanderId: c.ids.s2 });
    const rule = await c.cmd.post('/api/recurring', { title: 'הורדת התנסות ממ״ש', frequency: 'weekly', weekdays: [2], time: '18:00', assignee: 'team_commanders' });
    expect(rule.status, JSON.stringify(rule.body)).toBe(200);
    expect(rule.body.assigneeLabel ?? (await c.cmd.get('/api/recurring')).body[0].assigneeLabel).toBe('המפק״צים');
    // Tuesday 6.10.2026
    expect(generateRecurring('2026-10-06')).toBe(2);
    const owners = db().all<{ owner_id: number }>("SELECT owner_id FROM tasks WHERE title = 'הורדת התנסות ממ״ש' ORDER BY owner_id").map((t) => t.owner_id);
    expect(owners).toEqual([c.ids.s1, c.ids.s2].sort((a, b) => a - b));
    expect(generateRecurring('2026-10-07')).toBe(0);
  });
});

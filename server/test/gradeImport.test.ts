import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'vitest';
import { EXAM_FIELDS } from '../../shared/evaluation';
import { inferGradeColumn, type GradePreview, type GradeSource } from '../../shared/gradeImport';
import { gradeSheets } from '../src/gradeImport';
import { db } from '../src/db';
import { setup, zip, type Ctx } from './helpers';

// Only synthetic names and grades. The user's source workbook is never a repository fixture.
const HEADERS = [
  'צוות',
  'מספר אישי',
  'שם משפחה',
  'שם פרטי',
  'פ"א מפ',
  'כש"ג פתיחה',
  'כש"ג אמצע',
  'כש"ג סוף',
  'ציון מקראות',
  'ציון חש"צ',
  'מבחן 1',
  'מבחן מסכם',
  'ציון ספרא סייפא',
  'ציון אדם נוף מולדתו',
  'ציון פקא ותחקיר',
  'ציון התנסויות',
  'ציון סופי',
];
const source = (headers: string[], rows: string[][], filename = 'grades.csv'): GradeSource => ({
  filename,
  name: 'ציונים',
  headers,
  mapping: headers.map(inferGradeColumn),
  rows: rows.map((values, i) => ({ line: i + 2, values })),
});
let c: Ctx;
let first: number, second: number;
const preview = async (sources: GradeSource[], overwrite = false, agent = c.cmd) => {
  const r = await agent.post('/api/evaluations/import/preview', { sources, overwrite });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as GradePreview;
};
const exams = async (id: number) => (await c.cmd.get(`/api/evaluations/${id}`)).body.exams;
beforeEach(async () => {
  c = await setup();
  const team = (await c.cmd.post('/api/teams', { name: 'צוות בדיקה', commanderId: c.ids.s1 })).body[0].id;
  first = (await c.cmd.post('/api/cadets', { firstName: 'דוגמה', lastName: 'ראשונה', personalNumber: '10001', teamId: team })).body.cadet.id;
  second = (await c.cmd.post('/api/cadets', { firstName: 'דוגמה', lastName: 'שנייה', personalNumber: '10002' })).body.cadet.id;
});

describe('bulk evaluation grade import', () => {
  it('maps every grade in the supplied layout, previews without writing, then saves into the cadet file and history', async () => {
    const s = source(HEADERS, [['אלון', '10001.0', 'ראשונה', 'דוגמה', 'V', '80', '81', '82', '83', '84', '85', '86', '87', '88', '89', '90', '91']]);
    const p = await preview([s]);
    assert.equal(p.summary.grades, 12);
    assert.equal((await exams(first)).hashatz, null);
    assert.equal((await c.cmd.post('/api/evaluations/import/apply', { writes: p.writes })).status, 200);
    const f = (await c.cmd.get(`/api/evaluations/${first}`)).body;
    assert.equal(f.exams.fitBaseTotal, 80);
    assert.equal(f.exams.runScore, null); // a total fitness grade is not a running grade
    assert.equal(f.exams.hashatz, 84);
    assert.equal(f.exams.courseGrade, 91);
    assert.ok(f.tests.includes('courseGrade'));
    assert.equal((await c.cmd.get(`/api/evaluations/${first}/history`)).body.length, 12);
    assert.equal((await preview([s])).summary.unchanged, 12);
  });

  it('keeps zero distinct from blank and leaves existing grades alone by default', async () => {
    await c.cmd.patch(`/api/evaluations/${first}`, { changes: { readingsA: 60, hashatz: 45 } });
    const s = source(['מספר אישי', 'ציון מקראות', 'ציון חש"צ', 'ציון סופי'], [['10001', '90', '', '0']]);
    const p = await preview([s]);
    assert.equal(p.summary.kept, 1);
    assert.equal(p.summary.grades, 1);
    await c.cmd.post('/api/evaluations/import/apply', { writes: p.writes });
    assert.equal((await exams(first)).readingsA, 60);
    assert.equal((await exams(first)).hashatz, 45);
    assert.equal((await exams(first)).courseGrade, 0);
    const replacement = await preview([s], true);
    assert.equal(replacement.rows[0].cells[0].before, 60);
    assert.equal(replacement.rows[0].cells[0].status, 'replace');
    await c.cmd.post('/api/evaluations/import/apply', { writes: replacement.writes });
    assert.equal((await exams(first)).readingsA, 90);
  });

  it('rejects unknown numbers, mismatching names and ambiguous names without guessing', async () => {
    await c.cmd.post('/api/cadets', { firstName: 'דוגמה', lastName: 'ראשונה', personalNumber: '10003' });
    const p = await preview([
      source(
        ['מספר אישי', 'שם מלא', 'ציון מקראות'],
        [
          ['99999', 'דוגמה ראשונה', '90'],
          ['10001', 'דוגמה אחרת', '90'],
          ['', 'דוגמה ראשונה', '90'],
          ['', 'דוגמה שנייה', '80'],
        ],
      ),
    ]);
    assert.equal(p.summary.issues, 3);
    assert.equal(p.summary.cadets, 1);
    assert.equal(p.writes[0].cadetId, second);
    assert.equal(p.rows[3].matchedBy, 'name');
  });

  it('excludes both duplicate rows across files but allows distinct exams for the same cadet', async () => {
    const a = source(['מספר אישי', 'ציון מקראות'], [['10001', '90']]);
    const b = source(['מספר אישי', 'ציון מקראות'], [['10001', '80']], 'second.csv');
    const p = await preview([a, b]);
    assert.equal(p.summary.issues, 2);
    assert.equal(p.writes.length, 0);
    const good = await preview([a, source(['מספר אישי', 'ציון חש"צ'], [['10001', '70']])]);
    assert.equal(good.writes.length, 1);
    assert.equal(good.summary.grades, 2);
  });

  it('validates the entire row, with numeric ranges, decimals and repetition/time formats', async () => {
    const p = await preview([
      source(
        ['מספר אישי', 'ציון מקראות', 'ציון חש"צ'],
        [
          ['10001', '101', '80'],
          ['10002', '85,5', '90'],
        ],
      ),
    ]);
    assert.equal(p.summary.issues, 1);
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].changes.readingsA, 85.5);
    const invalid = source(['מספר אישי', 'זמן', 'חזרות'], [['10001', '12:70', '1.5']]);
    invalid.mapping = ['personalNumber', 'runResult', 'pushups'];
    assert.equal((await preview([invalid])).summary.issues, 1);
  });

  it('limits staff preview to their cadets and rechecks permission on apply atomically', async () => {
    const data = source(
      ['מספר אישי', 'ציון מקראות'],
      [
        ['10001', '90'],
        ['10002', '80'],
      ],
    );
    const scoped = await preview([data], false, c.s1);
    assert.equal(scoped.summary.cadets, 1);
    assert.equal(scoped.rows[1].cadetId, undefined);
    const all = await preview([data]);
    assert.equal((await c.s1.post('/api/evaluations/import/apply', { writes: all.writes })).status, 403);
    assert.equal((await exams(first)).readingsA, null);
    assert.equal((await c.cmd.get(`/api/evaluations/${first}/history`)).body.length, 0);
  });

  it('rolls back every row and history entry if a grade changes after preview', async () => {
    const p = await preview([
      source(
        ['מספר אישי', 'ציון מקראות'],
        [
          ['10001', '90'],
          ['10002', '80'],
        ],
      ),
    ]);
    await c.cmd.patch(`/api/evaluations/${second}`, { changes: { readingsA: 75 } });
    assert.equal((await c.cmd.post('/api/evaluations/import/apply', { writes: p.writes })).status, 409);
    assert.equal((await exams(first)).readingsA, null);
    assert.equal((await exams(second)).readingsA, 75);
    assert.equal((await c.cmd.get(`/api/evaluations/${first}/history`)).body.length, 0);
  });

  it('rejects forged non-grade fields, missing base values, clearing, duplicate mappings and duplicate cadets', async () => {
    for (const changes of [{ summary: 'oops' }, { readingsA: null }, { readingsA: 101 }, { runResult: '   ' }]) {
      assert.equal(
        (await c.cmd.post('/api/evaluations/import/apply', { writes: [{ cadetId: first, changes, base: { summary: '', readingsA: null, runResult: null } }] })).status,
        400,
      );
    }
    const w = { cadetId: first, changes: { readingsA: 90 }, base: {} };
    assert.equal((await c.cmd.post('/api/evaluations/import/apply', { writes: [w] })).status, 400);
    w.base = { readingsA: null };
    assert.equal((await c.cmd.post('/api/evaluations/import/apply', { writes: [w, w] })).status, 400);
    const s = source(['מספר אישי', 'ציון מקראות', 'ציון מקראות'], [['10001', '90', '80']]);
    assert.equal((await c.cmd.post('/api/evaluations/import/preview', { sources: [s] })).status, 400);
  });

  it('uploads CSV through the authenticated file endpoint, skipping blank rows and team section labels', async () => {
    const csv = Buffer.from('מספר אישי,שם מלא,ציון מקראות\n,צוות אלון,\n10001,דוגמה ראשונה,0\n,,\n');
    const r = await c.cmd.post('/api/evaluations/import/file').set('content-type', 'application/octet-stream').send(csv);
    assert.equal(r.status, 200);
    const p = await preview(r.body.sheets.map((s: GradeSource) => ({ ...s, filename: 'test.csv' })));
    assert.equal(p.summary.empty, 1);
    assert.equal(p.summary.grades, 1);
  });

  it('reads Excel time/percentage formats and cached formula results, retaining real row numbers', () => {
    const xlsx = zip([
      ['xl/workbook.xml', '<workbook><sheets><sheet name="Grades" r:id="r1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="45"/><xf numFmtId="10"/></cellXfs></styleSheet>'],
      [
        'xl/worksheets/sheet1.xml',
        '<worksheet><sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>מספר אישי</t></is></c><c r="B3" t="inlineStr"><is><t>כושר גופני סף - תוצאת ריצה</t></is></c><c r="C3" t="inlineStr"><is><t>ציון מקראות</t></is></c></row><row r="8"><c r="A8"><v>10001</v></c><c r="B8" s="1"><v>0.008680555555555556</v></c><c r="C8" s="2"><f>0.8+0.05</f><v>0.85</v></c></row></sheetData></worksheet>',
      ],
    ]);
    const s = gradeSheets(xlsx).sheets[0];
    assert.equal(s.rows[0].line, 8);
    assert.deepEqual(s.rows[0].values, ['10001', '12:30', '85']);
  });

  it('supports 2,000 cadets in one atomic batch and rejects a larger batch', async () => {
    const now = '2026-10-01T07:00:00.000Z';
    db().tx(() => {
      for (let i = 0; i < 2000; i++)
        db().run('INSERT INTO cadets(first_name, last_name, personal_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'בדיקה', String(i), String(20000 + i), now, now);
    });
    const s = source(
      ['מספר אישי', 'ציון מקראות'],
      Array.from({ length: 2000 }, (_, i) => [String(20000 + i), String(i % 101)]),
    );
    const p = await preview([s]);
    assert.equal(p.summary.cadets, 2000);
    const applied = await c.cmd.post('/api/evaluations/import/apply', { writes: p.writes });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.grades, 2000);
    assert.equal(db().get<{ n: number }>('SELECT count(*) AS n FROM evaluation_history')!.n, 2000);
    s.rows.push({ line: 2002, values: ['99999', '90'] });
    assert.equal((await c.cmd.post('/api/evaluations/import/preview', { sources: [s] })).status, 400);
    assert.equal(new Set(EXAM_FIELDS).size, EXAM_FIELDS.length);
  });
});

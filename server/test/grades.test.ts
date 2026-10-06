// Grades from the course's grade sheet: matching cadets, what goes where, seeing it before importing,
// the history of every change, and that an empty cell never erases a grade. The names and numbers
// here are made up.

import { beforeEach, describe, expect, it } from 'vitest';
import type { EvaluationChange, EvaluationFile } from '../../shared/types';
import { db } from '../src/db';
import { setup, type Ctx } from './helpers';

let c: Ctx;
let a = 0;
let b = 0;

beforeEach(async () => {
  c = await setup();
  const team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
  a = (await c.cmd.post('/api/cadets', { firstName: 'נועה', lastName: 'כהן', personalNumber: '1000001', teamId: team })).body.cadet.id;
  b = (await c.cmd.post('/api/cadets', { firstName: 'עידו', lastName: 'לוי', personalNumber: '', teamId: team })).body.cadet.id;
});

// the sheet's layout: a header, a team's title row, a row per cadet
const sheet = (rowsA: string[], rowsB: string[]) => [
  ['צוות', 'מספר אישי', 'שם משפחה', 'שם פרטי', 'פ"א מפ', 'כש"ג פתיחה', 'כש"ג אמצע', 'ציון מקראות', 'ציון חש"צ', 'מבחן 1', 'ציון סופי'],
  ['אלון', '', '', '', '', '', '', '', '', '', ''],
  ['1.0', '1000001.0', 'כהן', 'נועה', 'V', ...rowsA],
  ['2.0', '', 'לוי', 'עידו', 'V', ...rowsB], // found by name
  ['3.0', '1999999.0', 'אחר', 'מישהו', 'V', '80', '', '', '', '', ''], // not in the course
];
const file = async (id: number) => (await c.cmd.get(`/api/evaluations/${id}`)).body as EvaluationFile;

describe('the grade sheet', () => {
  it('shows what goes where before anything is written - for the course commander only', async () => {
    const rows = sheet(['85.0', '', '92', '100', '120', '88.5'], ['70', '', '', '95', '', '']);
    expect((await c.s1.post('/api/evaluations/grades/preview', { rows })).status).toBe(403);
    const p = (await c.cmd.post('/api/evaluations/grades/preview', { rows })).body;
    expect(p.headerRow).toBe(1);
    expect(Object.fromEntries(p.columns.map((x: { header: string; target: string }) => [x.header, x.target]))).toEqual({
      'פ"א מפ': 'skip',
      'כש"ג פתיחה': 'fitBaseScore',
      'כש"ג אמצע': 'midFitScore',
      'ציון מקראות': 'readingsA',
      'ציון חש"צ': 'new',
      'מבחן 1': 'midA',
      'ציון סופי': 'new',
    });
    const col = (h: string) => p.columns.find((x: { header: string }) => x.header === h);
    expect(col('פ"א מפ')).toMatchObject({ values: 0, other: 2 });
    expect(col('מבחן 1')).toMatchObject({ values: 0, outOfRange: 1 });
    expect(p.rows.map((r: { cadetId: number | null }) => r.cadetId)).toEqual([a, b, null]);
    // nothing written yet
    expect((await file(a)).exams.fitBaseScore).toBeNull();
  });

  it('imports into each cadet\'s file, with the tests and grades it needs, every change in the history', async () => {
    const rows = sheet(['85.0', '', '92', '100', '61', '88.5'], ['70', '', '', '95', '', '']);
    const r = (await c.cmd.post('/api/evaluations/grades/import', { rows })).body;
    expect(r).toMatchObject({ cadets: 2, set: 7, replaced: 0, unmatched: 1 });
    const fa = await file(a);
    expect(fa.exams).toMatchObject({ fitBaseScore: 85, readingsA: 92, midA: 61, midFitScore: null });
    expect(fa.tests).toContain('midExam'); // the mid exam came with its grade
    expect(fa.grades.map((g) => [g.name, g.value])).toEqual([
      ['ציון חש"צ', 100],
      ['ציון סופי', 88.5],
    ]);
    expect((await file(b)).grades.map((g) => g.value)).toEqual([95, null]);
    const history = (await c.cmd.get(`/api/evaluations/${a}/history`)).body as EvaluationChange[];
    expect(history.map((h) => h.label)).toEqual(expect.arrayContaining(['כושר גופני סף - ציון כש"ג', 'ציון: ציון חש"צ', 'מבחן אמצע - מועד א׳']));
    // the team commander sees them in the file, and can correct one
    const id = fa.grades[0].id;
    expect((await c.s1.patch(`/api/evaluations/${a}`, { changes: { [`grade:${id}`]: 98 }, base: { [`grade:${id}`]: 100 } })).status).toBe(200);
    expect((await c.s1.patch(`/api/evaluations/${a}`, { changes: { [`grade:${id}`]: 97 }, base: { [`grade:${id}`]: 100 } })).status).toBe(409);
    expect((await c.s1.patch(`/api/evaluations/${a}`, { changes: { [`grade:${id}`]: 101 } })).status).toBe(400);
  });

  it('the next sheet adds what is new; an empty cell erases nothing; a different grade is kept unless asked', async () => {
    await c.cmd.post('/api/evaluations/grades/import', { rows: sheet(['85', '', '92', '100', '', ''], ['70', '', '', '', '', '']) });
    // after the mid fitness test: the threshold column changed for one cadet, the readings column is empty
    const next = sheet(['86', '77', '', '100', '', ''], ['70', '81', '', '', '', '']);
    const p = (await c.cmd.post('/api/evaluations/grades/preview', { rows: next })).body;
    expect(p.columns.find((x: { header: string }) => x.header === 'כש"ג פתיחה')).toMatchObject({ values: 2, changes: 1 });
    expect((await c.cmd.post('/api/evaluations/grades/import', { rows: next, overwrite: false })).body).toMatchObject({ set: 2, kept: 1 });
    expect((await file(a)).exams).toMatchObject({ fitBaseScore: 85, midFitScore: 77, readingsA: 92 });
    expect((await c.cmd.post('/api/evaluations/grades/import', { rows: next })).body).toMatchObject({ set: 1, replaced: 1 });
    expect((await file(a)).exams.fitBaseScore).toBe(86);
  });

  it('a column can go elsewhere, never two to one place; a grade nobody has can be taken away', async () => {
    const rows = sheet(['85', '', '92', '100', '', ''], ['', '', '', '', '', '']);
    const twice = await c.cmd.post('/api/evaluations/grades/preview', { rows, mapping: { 7: 'fitBaseScore' } });
    expect(twice.body.error).toContain('שתי עמודות');
    const moved = (await c.cmd.post('/api/evaluations/grades/import', { rows, mapping: { 7: 'readingsB', 8: 'skip' } })).body;
    expect(moved.set).toBe(2);
    expect((await file(a)).exams).toMatchObject({ readingsA: null, readingsB: 92 });
    expect((await file(a)).grades).toEqual([]);
    const unused = db().run("INSERT INTO grade_items(name, created_at) VALUES ('ציון ניסיון', '2026-10-05T08:00:00.000Z')").id;
    expect((await file(a)).grades).toEqual([{ id: unused, name: 'ציון ניסיון', value: null, removable: true }]);
    expect((await c.s1.del(`/api/evaluations/grade-items/${unused}`)).status).toBe(403);
    expect((await c.cmd.del(`/api/evaluations/grade-items/${unused}`)).status).toBe(200);
    expect((await file(a)).grades).toEqual([]);
  });
});

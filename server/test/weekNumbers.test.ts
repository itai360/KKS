import { describe, expect, it } from 'vitest';
import { Db, db, migrate } from '../src/db';
import { setup } from './helpers';

const GOOGLE_URL = 'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-123/basic.ics';

function oldCourse(weeks: [number, string, string][]): Db {
  const d = new Db(':memory:');
  migrate(d, 19);
  for (const [n, name, start] of weeks) d.run("INSERT INTO weeks(number, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, '2026-09-01')", n, name, start, start);
  migrate(d);
  return d;
}
const numbers = (d: Db) => d.all<{ name: string; number: number }>('SELECT name, number FROM weeks ORDER BY start_date').map((w) => [w.name, w.number]);

describe('week numbers', () => {
  it('a week numbered after all the others (1) takes its neighbours\' calendar numbering (38)', () => {
    const d = oldCourse([
      [1, 'שבוע סף', '2026-09-13'],
      [39, 'שבוע לבנת היסוד', '2026-09-20'],
      [40, 'שבוע 40 - שטח', '2026-09-27'],
    ]);
    expect(numbers(d)).toEqual([
      ['שבוע סף', 38],
      ['שבוע לבנת היסוד', 39],
      ['שבוע 40 - שטח', 40],
    ]);
    d.close();
  });

  it('leaves a course counted 1, 2, 3 alone - one stray high number renumbers nothing', () => {
    const d = oldCourse([
      [1, 'יסודות', '2026-09-06'],
      [2, 'שטח', '2026-09-13'],
      [45, 'הגנה', '2026-09-20'],
      [4, 'התקפה', '2026-09-27'],
    ]);
    expect(numbers(d).map((w) => w[1])).toEqual([1, 2, 45, 4]);
    d.close();
  });

  it('a new week counts on from the nearest one; an import numbers a nameless week from its neighbours', async () => {
    const c = await setup();
    const add = async (name: string, startDate: string) => (await c.cmd.post('/api/weeks', { name, startDate, endDate: startDate })).body;
    await c.cmd.post('/api/weeks', { name: 'לבנת היסוד', number: 39, startDate: '2026-09-20', endDate: '2026-09-26' });
    await add('שבוע סף', '2026-09-13');
    await add('שבוע שטח', '2026-09-27');
    const list = (await c.cmd.get('/api/weeks')).body as { name: string; number: number }[];
    expect(list.map((w) => [w.name, w.number])).toEqual([
      ['שבוע סף', 38],
      ['לבנת היסוד', 39],
      ['שבוע שטח', 40],
    ]);

    // the calendar: "שבוע סף" has no number in its name, the next week says 51
    const applied = await c.cmd.post('/api/weeks/calendar/apply', {
      url: GOOGLE_URL,
      items: [
        { uid: 'a', name: 'שבוע סף - מחזור 53', startDate: '2026-12-06', endDate: '2026-12-10', number: null, weekId: null },
        { uid: 'b', name: 'שבוע 51 - יסודות', startDate: '2026-12-13', endDate: '2026-12-17', number: 51, weekId: null },
      ],
    });
    expect(applied.status).toBe(200);
    const imported = (applied.body as { name: string; number: number }[]).filter((w) => w.name.includes('מחזור 53') || w.name.includes('51'));
    expect(imported.map((w) => [w.name, w.number])).toEqual([
      ['שבוע סף - מחזור 53', 50],
      ['שבוע 51 - יסודות', 51],
    ]);
  });
});

describe('the confirmed 2026–2027 course boundary', () => {
  function beforeFix(d: Db) {
    for (const [number, name, start] of [
      [52, 'שבוע הכנה', '2026-12-20'],
      [1, 'שבוע שטח', '2026-12-27'],
      [2, 'שבוע פרט', '2027-01-03'],
      [3, 'שבוע 3 - פיקוד', '2027-01-10'],
    ] as const) d.run("INSERT INTO weeks(number, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, '2026-11-23')", number, name, start, start);
  }

  it('repairs existing numbers and embedded labels once, preserving identities and chronological order', () => {
    const d = new Db(':memory:');
    migrate(d, 69);
    beforeFix(d);
    const before = d.all('SELECT id, start_date, end_date FROM weeks ORDER BY start_date');
    migrate(d);
    expect(numbers(d)).toEqual([['שבוע הכנה', 52], ['שבוע שטח', 53], ['שבוע פרט', 1], ['שבוע 2 - פיקוד', 2]]);
    expect(d.all('SELECT id, start_date, end_date FROM weeks ORDER BY start_date')).toEqual(before);
    migrate(d);
    expect(numbers(d).map(w => w[1])).toEqual([52, 53, 1, 2]);
    d.close();
  });

  it('does not change another course with those names on different dates', () => {
    const d = new Db(':memory:');
    migrate(d, 69);
    beforeFix(d);
    d.run("UPDATE weeks SET start_date = '2026-12-28' WHERE name = 'שבוע שטח'");
    migrate(d);
    expect(numbers(d).map(w => w[1])).toEqual([52, 1, 2, 3]);
    d.close();
  });

  it('keeps the corrected numbering when adding, generating, moving or checking weeks', async () => {
    const c = await setup();
    db().run(`INSERT INTO settings(key, value) VALUES ('weekNumberingRule', '"iso"')`);
    for (const [name, startDate] of [['שבוע שטח', '2026-12-27'], ['שבוע פרט', '2027-01-03']]) {
      expect((await c.cmd.post('/api/weeks', { name, startDate, endDate: startDate })).status).toBe(200);
    }
    expect((await c.cmd.post('/api/weeks/generate', { startDate: '2027-01-10', count: 2 })).status).toBe(200);
    let list = (await c.cmd.get('/api/weeks')).body;
    expect(list.map((w: { number: number }) => w.number)).toEqual([53, 1, 2, 3]);
    expect((await c.cmd.get('/api/weeks?course=1')).body.map((w: { number: number }) => w.number)).toEqual([53, 1, 2, 3]);
    expect((await c.cmd.get('/api/weeks/renumber')).body).toEqual({ changes: [] });
    expect((await c.cmd.patch(`/api/weeks/${list[3].id}`, { startDate: '2027-01-24', endDate: '2027-01-30' })).status).toBe(200);
    list = (await c.cmd.get('/api/weeks')).body;
    expect(list.map((w: { number: number }) => w.number)).toEqual([53, 1, 2, 4]);
    expect(list[3].name).toBe('שבוע 4');
  });
});

describe('repairing generated weeks and planning chronology', () => {
  it('repairs generic overflow names, including an earlier auto-created week, across all planning APIs', async () => {
    const c = await setup();
    const d = db();
    // Insertion order and numeric order both differ from calendar order.
    for (const [number, name, start] of [
      [54, 'שבוע 54', '2027-01-03'],
      [53, 'שבוע שטח — תרגיל', '2026-12-27'],
      [55, 'שבוע 55', '2026-12-20'],
      [56, 'שבוע 56', '2027-01-10'],
    ] as const) d.run("INSERT INTO weeks(number, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, '2026-11-23')", number, name, start, start);
    const ids = d.all<{ id: number }>('SELECT id FROM weeks ORDER BY start_date').map(w => w.id);
    d.exec('DROP TABLE week_auto_create_exclusions');
    d.run("UPDATE meta SET value = '70' WHERE key = 'schema_version'");
    migrate(d);
    expect(numbers(d)).toEqual([['שבוע 52', 52], ['שבוע שטח — תרגיל', 53], ['שבוע 1', 1], ['שבוע 2', 2]]);
    const weeks = (await c.cmd.get('/api/weeks')).body;
    expect(weeks.map((w: { id: number }) => w.id)).toEqual(ids);
    const plans = (await c.cmd.get('/api/plans')).body;
    expect(plans.weeks.map((p: { week: { id: number } }) => p.week.id)).toEqual(ids);
    const plan = (await c.cmd.get(`/api/plans/${ids[1]}`)).body;
    expect(plan.horizon.map((w: { weekId: number }) => w.weekId)).toEqual(ids.slice(1));
    const span = (await c.cmd.get(`/api/three-week/${ids[0]}`)).body;
    expect(span.weeks.map((p: { week: { number: number } }) => p.week.number)).toEqual([52, 53, 1, 2]);
    const detail = (await c.cmd.get(`/api/weeks/${ids[1]}`)).body;
    expect(detail.nextWeek.id).toBe(ids[2]);
    expect((await c.cmd.get('/api/weeks/renumber')).body).toEqual({ changes: [] });
  });

  it('recognizes the confirmed dates even with renamed weeks and another entry in between', () => {
    const d = new Db(':memory:');
    migrate(d, 70);
    for (const [number, name, start] of [
      [1, 'שבוע שטח (אימון)', '2026-12-27'],
      [54, 'שבוע 54', '2026-12-29'],
      [2, 'שבוע פרט — מחזור כא', '2027-01-03'],
    ] as const) d.run("INSERT INTO weeks(number, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, '2026-11-23')", number, name, start, start);
    migrate(d);
    expect(numbers(d).map(w => w[1])).toEqual([53, 53, 1]);
    d.close();
  });
});

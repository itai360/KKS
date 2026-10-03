import { describe, expect, it } from 'vitest';
import { Db, migrate } from '../src/db';
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

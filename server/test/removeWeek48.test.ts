import { describe, expect, it } from 'vitest';
import { Db, db, migrate } from '../src/db';
import { newTask, setup } from './helpers';

const add = (d: Db, number: number, date: string) => d.run("INSERT INTO weeks(number, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, '2026-11-23')", number, `שבוע ${number}`, date, date).id;

describe('remove the unnecessary week 48', () => {
  it('removes it from weeks and plan approval while keeping its tasks and all later week numbers', async () => {
    const c = await setup();
    const d = db();
    const id = add(d, 48, '2026-11-22');
    add(d, 49, '2026-11-29'); add(d, 53, '2026-12-27'); add(d, 1, '2027-01-03');
    const task = await newTask(c.cmd, { title: 'משימה שנשמרת', ownerIds: [c.ids.s1], weekId: id, deadline: '2026-11-24T10:00:00Z' });
    const before = d.get('SELECT title, deadline, status, owner_id FROM tasks WHERE id = ?', task);
    d.exec('DROP TABLE week_auto_create_exclusions');
    d.run("UPDATE meta SET value = '71' WHERE key = 'schema_version'");
    migrate(d);
    expect((await c.cmd.get('/api/weeks')).body.map((w: { number: number }) => w.number)).toEqual([49, 53, 1]);
    expect((await c.cmd.get('/api/plans')).body.weeks.map((p: { week: { number: number } }) => p.week.number)).toEqual([49, 53, 1]);
    expect(d.get('SELECT title, deadline, status, owner_id FROM tasks WHERE id = ?', task)).toEqual(before);
    expect(d.get<{ week_id: number | null }>('SELECT week_id FROM tasks WHERE id = ?', task)?.week_id).toBeNull();
    expect(d.all('PRAGMA foreign_key_check')).toEqual([]);
    migrate(d);
    expect(d.all('SELECT * FROM week_auto_create_exclusions')).toHaveLength(1);
  });

  it('leaves week 48 of another course intact', () => {
    const d = new Db(':memory:'); migrate(d, 71);
    add(d, 48, '2026-11-22'); add(d, 49, '2026-11-29');
    migrate(d);
    expect(d.all('SELECT id FROM weeks')).toHaveLength(2);
    expect(d.all('SELECT * FROM week_auto_create_exclusions')).toHaveLength(0);
    d.close();
  });
});

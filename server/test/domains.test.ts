import { describe, expect, it } from 'vitest';
import { ADDED_DOMAINS, DEFAULT_DOMAINS } from '../../shared/constants';
import { Db, migrate } from '../src/db';
import { setup } from './helpers';

describe('areas of responsibility', () => {
  it('a new course has them all, "אחר" last', async () => {
    const c = await setup();
    const domains = (await c.s1.get('/api/auth/me')).body.settings.domains as string[];
    expect(domains).toEqual(DEFAULT_DOMAINS);
    for (const d of ['חינוך', 'אקדמיה', 'אימון גופני', 'שטח', 'ניווטים', 'דת', 'רכב']) expect(domains).toContain(d);
    expect(domains.at(-1)).toBe('אחר');
  });

  it('a course with its own list gets the new areas before "אחר", once, keeping its own', () => {
    const old = new Db(':memory:');
    migrate(old, 18);
    old.run("INSERT INTO settings(key, value) VALUES ('domains', ?)", JSON.stringify(['הדרכה', 'שטח', 'מבצעים', 'אחר']));
    migrate(old);
    const list = JSON.parse(old.get<{ value: string }>("SELECT value FROM settings WHERE key = 'domains'")!.value) as string[];
    expect(list).toEqual(['הדרכה', 'שטח', 'מבצעים', ...ADDED_DOMAINS.filter((d) => d !== 'שטח'), 'אחר']);
    old.close();
  });

  it('a course that never changed its list keeps following the defaults', () => {
    const old = new Db(':memory:');
    migrate(old, 18);
    migrate(old);
    expect(old.get("SELECT 1 FROM settings WHERE key = 'domains'")).toBeUndefined();
    old.close();
  });
});

describe('the area "אחר"', () => {
  it('keeps a few words saying what it is, and drops them for another area', async () => {
    const c = await setup();
    const created = await c.cmd.post('/api/tasks', { title: 'הכנת טקס', ownerIds: [c.ids.s1], deadline: '2026-10-05T15:00:00.000Z', domain: 'אחר', domainNote: 'טקסים' });
    const id = created.body.ids[0];
    const get = async () => (await c.cmd.get(`/api/tasks/${id}`)).body.task as { domain: string; domainNote: string };
    expect(await get()).toMatchObject({ domain: 'אחר', domainNote: 'טקסים' });
    await c.cmd.patch(`/api/tasks/${id}`, { domainNote: 'טקסים ואירועים' });
    expect((await get()).domainNote).toBe('טקסים ואירועים');
    await c.cmd.patch(`/api/tasks/${id}`, { domain: 'שטח' });
    expect(await get()).toMatchObject({ domain: 'שטח', domainNote: '' });
    // a detail without "אחר" is not kept
    const other = (await c.cmd.post('/api/tasks', { title: 'ניווט לילה', ownerIds: [c.ids.s1], deadline: '2026-10-05T15:00:00.000Z', domain: 'ניווטים', domainNote: 'x' })).body.ids[0];
    expect((await c.cmd.get(`/api/tasks/${other}`)).body.task.domainNote).toBe('');
  });
});

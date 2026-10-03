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

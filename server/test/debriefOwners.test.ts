// Who a topic is on, by the words of a company's document: groups by their names, and several at once.

import { describe, expect, it } from 'vitest';
import { groupNamed, ownersNamed } from '../src/debriefImport';

describe('owners named in a document', () => {
  it('groups by their names - with or without quotes, ה or the plural', () => {
    expect(groupNamed('מפק"צים')).toMatchObject({ kind: 'group', name: 'מפק״צים' });
    expect(groupNamed('ממ״שים')).toMatchObject({ kind: 'group', name: 'ממ״שים' });
    expect(groupNamed('הסגל')).toMatchObject({ name: 'סגל' });
    expect(groupNamed('רוחב')).toMatchObject({ name: 'סגל רוחב' });
    expect(groupNamed('מעבירי ההתנסויות')).toMatchObject({ name: 'מעבירי התנסויות' });
    expect(groupNamed('הפלוגה')).toMatchObject({ name: 'פלוגה' });
    expect(groupNamed('שעון בחדר האוכל')).toBeNull();
  });
  it('several, when every one is found; none when one is not', () => {
    expect(ownersNamed('סגל + פלוגה', [], [])?.map((o) => o.name)).toEqual(['סגל', 'פלוגה']);
    expect(ownersNamed('מפק"צים, ממ"שים', [], [])?.map((o) => o.name)).toEqual(['מפק״צים', 'ממ״שים']);
    expect(ownersNamed('סגל ופלוגה', [], [])?.map((o) => o.name)).toEqual(['סגל', 'פלוגה']);
    expect(ownersNamed('סגל, משה', [], [])).toBeNull();
  });
});

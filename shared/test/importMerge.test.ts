import { expect, it } from 'vitest';
import { appendImportedText } from '../importMerge';
import { appendImportedProposals, withImported } from '../debriefForms';

it('preserves typed wording and appends only new lines across repeated imports', () => {
  const typed = 'מה שכבר כתבתי  \nנקודה משותפת';
  const file = 'נקודה משותפת\nתוספת מהקובץ\nתוספת מהקובץ';
  const combined = appendImportedText(typed, file);
  expect(combined).toBe(`${typed}\n\nתוספת מהקובץ`);
  expect(appendImportedText(combined, file)).toBe(combined);
  expect(appendImportedText(typed, '')).toBe(typed);
});

it('retains distinct owners and progress on otherwise identical imported proposals', () => {
  const mine = { topic: 'נושא', proposal: 'הצעה', owner: { kind: 'user' as const, id: 1, name: 'אחראי א' }, progress: 'נכתב ידנית' };
  const file = { ...mine, owner: { kind: 'user' as const, id: 2, name: 'אחראי ב' }, progress: 'נוסף מקובץ' };
  const result = appendImportedProposals([mine], [file, file]);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject(mine);
  expect(result[1]).toMatchObject(file);
  expect(withImported({ company: result }, { company: [file] })).toEqual({});
});

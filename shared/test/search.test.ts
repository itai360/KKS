import { describe, expect, it } from 'vitest';
import { matchesSearch, searchKey } from '../search';

describe('search', () => {
  it('finds Hebrew however it was typed', () => {
    expect(matchesSearch('מפק"צ', 'מפק״צ 2')).toBe(true);
    expect(matchesSearch('מפקצ', 'מפק״צ 2')).toBe(true);
    expect(matchesSearch("צ'ק", 'צ׳ק ליסט')).toBe(true);
    expect(matchesSearch('שָׁלוֹם', 'שלום')).toBe(true);
    expect(matchesSearch('בן אבי', 'בן-אבי')).toBe(true);
    expect(matchesSearch('אברהמ', 'אברהם')).toBe(true);
    expect(matchesSearch('ABC', 'abc')).toBe(true);
  });

  it('needs every word, in any of the fields', () => {
    expect(matchesSearch('דנה כהן', 'דנה', 'כהן')).toBe(true);
    expect(matchesSearch('כהן דנה', 'דנה', 'כהן')).toBe(true);
    expect(matchesSearch('מפק"צ 2 מטווח', 'סגירת מטווח', 'מפק״צ 2')).toBe(true);
    expect(matchesSearch('מפק"צ 2 ניווט', 'סגירת מטווח', 'מפק״צ 2')).toBe(false);
    expect(matchesSearch('', 'כל דבר')).toBe(true);
    expect(searchKey('  שבוע   הגנה ')).toBe('שבוע הגנה');
  });
});

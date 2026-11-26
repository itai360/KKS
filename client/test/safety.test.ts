import { describe, expect, it } from 'vitest';
import { csvCell } from '../src/lib/csvCell';
import { safeUrl } from '../src/lib/safeUrl';
import { vcard } from '../src/lib/contact';

describe('exports that open in Excel', () => {
  it('keep a formula-like text as text, and numbers and phone numbers as they are', () => {
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('+cmd|calc')).toBe('"\'+cmd|calc"');
    expect(csvCell('-2+3+cmd')).toBe('"\'-2+3+cmd"');
    expect(csvCell('+972 54-123-4567')).toBe('"+972 54-123-4567"');
    expect(csvCell('-5')).toBe('"-5"');
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell('דנה כהן')).toBe('"דנה כהן"');
    expect(csvCell(null)).toBe('""');
  });
});

describe('links from the data', () => {
  it('lead to web addresses or this site only', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('/api/files/3')).toBe('/api/files/3');
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl(' JavaScript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>')).toBe('#');
    expect(safeUrl('//evil.example.com')).toBe('#');
    expect(safeUrl(null)).toBe('#');
  });
});

describe('the contacts file', () => {
  it('a name cannot add lines of its own', () => {
    const card = vcard([{ name: 'דנה\rTEL:+1555\nEMAIL:x@evil' }]);
    expect(card.split('\r\n').filter((l) => l.startsWith('TEL') || l.startsWith('EMAIL'))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { intlNumber, telHref, vcard, waHref } from '../src/lib/contact';

describe('phone numbers for call and WhatsApp', () => {
  it('reads numbers the way people type them', () => {
    expect(intlNumber('050-1234567')).toBe('972501234567');
    expect(intlNumber('+972 50 123 4567')).toBe('972501234567');
    expect(intlNumber('00972501234567')).toBe('972501234567');
    expect(intlNumber('972-50-1234567')).toBe('972501234567');
    expect(intlNumber('')).toBeNull();
    expect(intlNumber('אין')).toBeNull();
    expect(telHref('050-1234567')).toBe('tel:+972501234567');
    expect(waHref('050-1234567')).toBe('https://wa.me/972501234567');
    expect(waHref('')).toBeNull();
  });

  it('writes a contacts file a phone can import', () => {
    const v = vcard([{ name: 'מפק"צ 1', phone: '050-1234567', email: 'a@b.co', org: 'קורס, מחזור 52', title: 'מפקד צוות' }, { name: 'בלי טלפון' }]);
    expect(v.split('BEGIN:VCARD')).toHaveLength(3);
    expect(v).toContain('TEL;TYPE=CELL:+972501234567');
    expect(v).toContain('ORG:קורס\\, מחזור 52');
    expect(v).not.toContain('undefined');
  });
});

// Calling, messaging and saving contacts from a phone number as people type it
// ("050-1234567", "+972 50 123 4567").

/** digits only, in international form for Israel (972...), or null when there is no number */
export function intlNumber(phone: string): string | null {
  const d = phone.replace(/[^\d+]/g, '');
  if (!d.replace(/\D/g, '')) return null;
  if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

export const telHref = (phone: string) => (intlNumber(phone) ? `tel:+${intlNumber(phone)}` : null);
export const waHref = (phone: string) => (intlNumber(phone) ? `https://wa.me/${intlNumber(phone)}` : null);

/** a vCard file of several people - opened on a phone, it adds them to the contacts */
export function vcard(people: { name: string; phone?: string; email?: string; org?: string; title?: string }[]): string {
  // a line break of any kind (\r too) is escaped, so a name cannot add lines of its own
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
  return people
    .map((p) =>
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${esc(p.name)}`,
        `N:${esc(p.name)};;;;`,
        p.org && `ORG:${esc(p.org)}`,
        p.title && `TITLE:${esc(p.title)}`,
        p.phone && intlNumber(p.phone) && `TEL;TYPE=CELL:+${intlNumber(p.phone)}`,
        p.email && `EMAIL:${esc(p.email)}`,
        'END:VCARD',
      ]
        .filter(Boolean)
        .join('\r\n'),
    )
    .join('\r\n');
}

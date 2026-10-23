// The feedback as a Word file: a zip Word opens (the parts it needs, each well-formed XML), written right to
// left, with the feedback's own words in the format's order - and the axes the points are chosen from.

import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { axisAbout, FEEDBACK_AXES, FEEDBACK_AXIS_GROUPS } from '../experienceFeedback';
import { feedbackDocName, feedbackDocx, type FeedbackDocument } from '../feedbackDocx';
import { crc32 } from '../zip';

/** the files in a stored (uncompressed) zip, checking each one's CRC */
function readZip(zip: Uint8Array): Map<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    expect(v.getUint16(at + 8, true)).toBe(0);
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen));
    const data = zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(v.getUint32(at + 14, true)).toBe(crc32(data));
    out.set(name, new TextDecoder().decode(data));
    at += 30 + nameLen + size;
  }
  // the central directory follows, and the end record points at it
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  expect(v.getUint16(end + 10, true)).toBe(out.size);
  expect(v.getUint32(end + 16, true)).toBe(at);
  return out;
}

/** every tag closed, in order */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0;
}

const doc: FeedbackDocument = {
  cadetName: 'נועם לוי',
  topic: 'מ"מ בתרגיל',
  date: '28.09-30.09.2026',
  form: {
    general: 'הוביל בביטחון & בשקט <ללא> היסוס',
    keep: [
      { title: 'פקודות ברורות', axis: 'המקצוע הצבאי - הובלה', text: 'פקודה קצרה לפני כל שלב' },
      { title: 'רתימת הצוות', axis: 'מנהיגות - הנעה ומוטיבציה', text: '' },
    ],
    improve: [
      { title: 'ניהול זמן', axis: 'המקצוע הצבאי - ביצוע ובקרה', text: 'שורה ראשונה\nשורה שנייה' },
      { title: 'שיתוף הסגנים', axis: 'מנהיגות - פיתוח פקודים', text: '' },
    ],
  },
  score: 88,
};

describe('the feedback as a Word file', () => {
  it('is a zip of the parts Word needs, each well-formed', () => {
    const files = readZip(feedbackDocx(doc));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/settings.xml', 'docProps/core.xml']);
    for (const [name, xml] of files) expect(wellFormed(xml), name).toBe(true);
    // the zip's checksum is the standard one
    const sample = new TextEncoder().encode('משוב');
    expect(crc32(sample)).toBe(zlibCrc32(sample));
  });

  it('reads right to left, in the format order, with the feedback words', () => {
    const xml = readZip(feedbackDocx(doc)).get('word/document.xml')!;
    // the tables' first column on the right, paragraphs and runs right to left, and Hebrew bold and sizes
    expect(xml.match(/<w:bidiVisual\/>/g)).toHaveLength(2);
    expect(xml).toContain('<w:rtl/>');
    expect(xml).toContain('<w:b/><w:bCs/>');
    expect(xml).toContain('<w:sz w:val="28"/><w:szCs w:val="28"/>');
    // A4, 2 cm margins
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    // the words, escaped, in the order of the format
    const order = ['משוב לאחר התנסות', 'שם הצוער', 'נועם לוי', 'מ&quot;מ בתרגיל', '28.09-30.09.2026', 'התייחסות כללית מילולית', 'הוביל בביטחון &amp; בשקט &lt;ללא&gt; היסוס', '(ציר: המקצוע הצבאי - הובלה) ', 'פקודות ברורות', 'נקודה לשיפור', 'שורה ראשונה</w:t><w:br/><w:t xml:space="preserve">שורה שנייה', 'מקרא הערכה להתנסות', 'נכשל', 'יוצא דופן לחיוב', 'ציון להתנסות', '>88<', '(מצוין)'];
    let from = 0;
    for (const word of order) {
      const at = xml.indexOf(word, from);
      expect(at, word).toBeGreaterThan(-1);
      from = at;
    }
    // the score's band is the one marked in the legend
    expect(xml.match(/w:fill="C9D6EC"/g)).toHaveLength(2);
    expect(xml).toMatch(/w:fill="C9D6EC"\/><w:vAlign w:val="center"\/><\/w:tcPr><w:p><w:pPr><w:bidi\/><w:spacing w:after="0"\/><w:jc w:val="center"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:bCs\/><w:sz w:val="20"\/><w:szCs w:val="20"\/><w:rtl\/><\/w:rPr><w:t xml:space="preserve">מצוין</);
  });

  it('before the feedback is given: the form, its details filled in and the rest to write', () => {
    const xml = readZip(feedbackDocx({ ...doc, form: null, score: null })).get('word/document.xml')!;
    expect(xml).toContain('נועם לוי');
    expect(xml.match(/נקודה לשימור: /g)).toHaveLength(2);
    expect(xml.match(/נקודה לשיפור: /g)).toHaveLength(2);
    expect(xml).toContain('(ציר:                    ) ');
    expect(xml).not.toContain('C9D6EC');
    expect(xml).not.toContain('פקודות ברורות');
  });

  it('is named for the cadet and the experience, as a file name can hold it', () => {
    expect(feedbackDocName('נועם לוי', 'מ"מ בתרגיל / שלב א')).toBe('משוב לאחר התנסות - נועם לוי - מ״מ בתרגיל שלב א.docx');
  });
});

describe('the axes of a point', () => {
  it('four main axes, each part chosen as "main - part", none twice', () => {
    expect(FEEDBACK_AXIS_GROUPS.map((g) => g.name)).toEqual(['המקצוע הצבאי', 'ערכים', 'מנהיגות', 'חוסן']);
    expect(FEEDBACK_AXES).toHaveLength(25);
    expect(new Set(FEEDBACK_AXES).size).toBe(25);
    expect(FEEDBACK_AXES).toContain('ערכים - חיי אדם');
    expect(axisAbout('מנהיגות - מודעות עצמית')).toBe('הכרת החוזקות והחולשות, צניעות וביקורת עצמית');
    // the values have no words of their own; an axis typed before the list has none either
    expect(axisAbout('ערכים - אמינות')).toBe('');
    expect(axisAbout('פיקוד והובלה')).toBe('');
  });
});

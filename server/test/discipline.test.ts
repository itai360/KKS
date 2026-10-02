// Discipline notes (הערות משמעת) - the third dismisses the cadet - and the
// enforcement ladder the commander imports from the course's document.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CadetDetail, DisciplineGuide, EvaluationFile } from '../../shared/types';
import { guideFromFile, htmlBlocks, ordinalOf } from '../src/discipline';
import { setSheetFetcher } from '../src/sheets';
import { notificationsOf, setup, zip, type Ctx } from './helpers';

// like a Google Docs export: merged category cells, a step over two columns, a footnote, wordings under headings
const exported = `<html><head><style>.c1{color:#000}</style></head><body>
<p class="title"><span>נוהל אכיפה</span></p><p><span>טבלה מנחה</span></p>
<table><tr><td><p>קטגוריה</p></td><td><p>מקרה</p></td><td><p>פעם ראשונה</p></td><td><p>פעם שניה</p></td><td><p>פעם שלישית</p></td></tr>
<tr><td rowspan="2"><p>זמנים</p></td><td><p>איחור למסדר</p></td><td><p>הערה במקום</p></td><td><p>שיחה עם המפקד</p><p>ריתוק שעה</p></td><td><p>הערת משמעת</p></td></tr>
<tr><td><p>איחור לשיעור*</p></td><td colspan="2"><p>לא נכנס לשיעור</p></td><td><p>הערת משמעת</p></td></tr>
<tr><td><p>התנהלות</p></td><td><p>יציאה מהשיעור</p></td><td><p>הערת משמעת ועולה לוועדת הערכה</p></td><td><p></p></td><td><p></p></td></tr>
</table>
<p>*איחור לשיעור</p><ul><li>הגעה אחרי שהמרצה התחיל</li><li>חזרה מאוחרת מהפסקה</li></ul>
<h3>איחור למסדר - פעם שלישית</h3><ol><li>חומרת המעשה: איחור חוזר.</li><li>הציפייה להמשך: להגיע בזמן.</li></ol>
<h3>איחור לשיעור - פעם שלישית</h3><ol><li>חומרת המעשה: איחור לשיעור.</li></ol>
<h3>יציאה משיעור ללא אישור - פעם ראשונה</h3><p>נוסח קצר.</p>
<h3>כותרת בלי תוכן</h3>
</body></html>`;

// like the same document copied from Google Docs and pasted
const pasted = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b"><p dir="rtl" style="line-height:1.38"><span style="font-size:11pt">נוהל</span></p><div dir="rtl" align="right"><table style="border:none"><colgroup><col width="80"></colgroup><tbody><tr style="height:0pt"><td style="border:solid"><p dir="rtl"><span>מקרה</span></p></td><td><p dir="rtl"><span>פעם ראשונה</span></p></td><td><p dir="rtl"><span>פעם שנייה</span></p></td></tr><tr><td><p dir="rtl"><span>שכחת&nbsp;ציוד</span></p></td><td><p dir="rtl"><span>הערה</span></p></td><td><p dir="rtl"><span>הערת משמעת</span></p></td></tr></tbody></table></div><h3 dir="rtl"><span>שכחת ציוד - פעם שנייה</span></h3><ol style="margin-top:0"><li dir="rtl" style="list-style-type:decimal"><p dir="rtl" role="presentation"><span>חומרת המעשה: שכחת ציוד.</span></p></li><li dir="rtl"><p dir="rtl" role="presentation"><span>הציפייה: להקפיד.</span></p></li></ol></b>`;

/** A minimal Word document: paragraphs (Heading3 and a numbered list) and a table with merged cells. */
function docx(): Buffer {
  const p = (text: string, extra = '') => `<w:p><w:pPr>${extra}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const tc = (text: string, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr>${p(text)}</w:tc>`;
  const list = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>';
  const document = `<w:document><w:body>${p('נוהל', '<w:pStyle w:val="Title"/>')}<w:tbl><w:tblPr/>
<w:tr>${tc('קטג׳')}${tc('מקרה')}${tc('פעם ראשונה')}${tc('פעם שניה')}</w:tr>
<w:tr>${tc('נשק', '<w:vMerge w:val="restart"/>')}${tc('נשק לא נקי')}${tc('הערה במקום', '<w:gridSpan w:val="2"/>')}</w:tr>
<w:tr>${tc('', '<w:vMerge/>')}${tc('שכחת נשק')}${tc('תחקיר')}${tc('הערת משמעת')}</w:tr>
</w:tbl>${p('שכחת נשק - פעם שנייה', '<w:pStyle w:val="Heading3"/>')}${p('חומרת המעשה: חמור.', list)}${p('הציפייה: לשמור על הנשק.', list)}</w:body></w:document>`;
  const numbering =
    '<w:numbering><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="7"/></w:num></w:numbering>';
  return zip([
    ['word/document.xml', document],
    ['word/numbering.xml', numbering],
  ]);
}

describe('reading the enforcement ladder from a document', () => {
  it('a Google Docs export: merged cells, footnotes, and the wording of each note', () => {
    const g = guideFromFile(Buffer.from(exported));
    expect(g.offenses.map((o) => o.key)).toEqual(['זמנים · איחור למסדר', 'זמנים · איחור לשיעור', 'התנהלות · יציאה מהשיעור']);
    const [roll, lesson, leaving] = g.offenses;
    expect(roll.steps.map((s) => s?.text)).toEqual(['הערה במקום', 'שיחה עם המפקד\nריתוק שעה', 'הערת משמעת']);
    expect(roll.steps.map((s) => s?.note)).toEqual([false, false, true]);
    // a step over two columns counts for both times; the footnote explains the offense
    expect(lesson).toMatchObject({ name: 'איחור לשיעור', definition: ['הגעה אחרי שהמרצה התחיל', 'חזרה מאוחרת מהפסקה'] });
    expect(lesson.steps.map((s) => s?.text)).toEqual(['לא נכנס לשיעור', 'לא נכנס לשיעור', 'הערת משמעת']);
    expect(leaving.steps).toHaveLength(1);
    expect(leaving.steps[0]).toMatchObject({ note: true, committee: true });
    // headings with text under them are wordings; each note step gets the one for its offense and time
    expect(g.letters.map((l) => l.title)).toEqual(['איחור למסדר - פעם שלישית', 'איחור לשיעור - פעם שלישית', 'יציאה משיעור ללא אישור - פעם ראשונה']);
    expect(g.letters[0].body).toBe('1. חומרת המעשה: איחור חוזר.\n2. הציפייה להמשך: להגיע בזמן.');
    expect([roll.steps[2]?.letter, lesson.steps[2]?.letter, leaving.steps[0]?.letter]).toEqual([0, 1, 2]);
  });

  it('the document pasted from Google Docs, and a Word file', () => {
    const fromPaste = guideFromFile(Buffer.from(pasted));
    expect(fromPaste.offenses).toEqual([
      {
        key: 'שכחת ציוד',
        category: '',
        name: 'שכחת ציוד',
        definition: [],
        steps: [
          { text: 'הערה', note: false, committee: false, letter: null },
          { text: 'הערת משמעת', note: true, committee: false, letter: 0 },
        ],
      },
    ]);
    expect(fromPaste.letters).toEqual([{ title: 'שכחת ציוד - פעם שנייה', body: '1. חומרת המעשה: שכחת ציוד.\n2. הציפייה: להקפיד.' }]);

    const fromWord = guideFromFile(docx());
    expect(fromWord.offenses.map((o) => [o.key, o.steps.map((s) => s?.text)])).toEqual([
      ['נשק · נשק לא נקי', ['הערה במקום', 'הערה במקום']],
      ['נשק · שכחת נשק', ['תחקיר', 'הערת משמעת']],
    ]);
    expect(fromWord.offenses[1].steps[1]?.letter).toBe(0);
    expect(fromWord.letters).toEqual([{ title: 'שכחת נשק - פעם שנייה', body: '1. חומרת המעשה: חמור.\n2. הציפייה: לשמור על הנשק.' }]);
  });

  it('reads the time from a heading, and refuses a document without a ladder', () => {
    expect([ordinalOf('איחור - פעם רביעית'), ordinalOf('פעם שנייה'), ordinalOf('פעם שניה'), ordinalOf('פעם 7'), ordinalOf('בלי')]).toEqual([4, 2, 2, 7, null]);
    expect(htmlBlocks('<p>א</p><ul><li>ב</li></ul>')).toEqual([
      { kind: 'para', item: null, text: 'א' },
      { kind: 'para', item: '•', text: 'ב' },
    ]);
    expect(() => guideFromFile(Buffer.from('<p>סתם מסמך</p><table><tr><td>א</td><td>ב</td></tr></table>'))).toThrow('לא נמצאה במסמך טבלת מדרג');
  });
});

describe('the ladder in the system', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });
  afterEach(() => setSheetFetcher(async () => new Response('', { status: 404 })));

  it('the commander imports it - pasted, from a file, or from a shared link - and every staff member reads it', async () => {
    const paste = (agent: Ctx['cmd'], body: string, name = 'pasted.html') => agent.post('/api/discipline/guide/file').set('content-type', 'text/html').set('x-filename', name).send(body);
    expect((await paste(c.s1, exported)).status).toBe(403);
    const saved = (await paste(c.cmd, exported)).body as DisciplineGuide;
    expect(saved).toMatchObject({ source: 'הדבקה מהמסמך', importedByName: 'מפקד הקורס' });
    expect(saved.offenses).toHaveLength(3);
    const read = (await c.s2.get('/api/discipline/guide')).body as DisciplineGuide;
    expect(read.letters).toHaveLength(3);

    const word = await c.cmd.post('/api/discipline/guide/file').set('content-type', 'application/octet-stream').set('x-filename', encodeURIComponent('נהלים.docx')).send(docx());
    expect(word.body).toMatchObject({ source: 'קובץ: נהלים.docx' });
    expect((await paste(c.cmd, '<p>בלי טבלה</p>')).status).toBe(400);

    // a link: a private document says how to share it or paste it instead
    let shared = false;
    setSheetFetcher(async (url) => {
      expect(url).toBe('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/export?format=html');
      return shared ? new Response(exported, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('', { status: 401 });
    });
    const url = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit?usp=sharing';
    const closed = await c.cmd.post('/api/discipline/guide/link', { url });
    expect(closed.status).toBe(400);
    expect(closed.body.error).toContain('להעתיק את כל המסמך');
    shared = true;
    expect((await c.cmd.post('/api/discipline/guide/link', { url })).body).toMatchObject({ source: url });
    expect((await c.cmd.post('/api/discipline/guide/link', { url: 'https://example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345' })).status).toBe(400);

    expect((await c.s1.del('/api/discipline/guide')).status).toBe(403);
    await c.cmd.del('/api/discipline/guide');
    expect((await c.s1.get('/api/discipline/guide')).body).toMatchObject({ offenses: [], letters: [], importedAt: null });
  });
});

describe('discipline notes', () => {
  let c: Ctx;
  let cadet: number;
  beforeEach(async () => {
    c = await setup();
    // s1 commands the cadet's team; s2 is other staff
    const team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
    cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'לוי', teamId: team })).body.cadet.id;
  });

  const record = (over: Record<string, unknown>) => ({ kind: 'discipline', body: 'פירוט', occurredOn: '2026-09-28', ...over });
  const detail = async (agent = c.cmd) => (await agent.get(`/api/cadets/${cadet}`)).body as CadetDetail;

  it('counts each offense, and the third note dismisses the cadet', async () => {
    expect((await c.s2.post(`/api/cadets/${cadet}/records`, record({ formal: true }))).status).toBe(403);
    // the same offense twice: the second time, by date
    await c.s1.post(`/api/cadets/${cadet}/records`, record({ offense: 'זמנים · איחור למסדר', body: '', occurredOn: '2026-09-29' }));
    await c.s1.post(`/api/cadets/${cadet}/records`, record({ offense: 'זמנים · איחור למסדר', occurredOn: '2026-09-27' }));
    let d = await detail();
    expect(d.records.map((r) => [r.title, r.occurrence, r.formal])).toEqual([
      ['איחור למסדר', 2, false],
      ['איחור למסדר', 1, false],
    ]);

    const first = (await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true, offense: 'זמנים · איחור למסדר', occurredOn: '2026-09-30' }))).body as CadetDetail;
    expect(first.cadet).toMatchObject({ disciplineNotes: 1, status: 'active', dismissedByNotes: false });
    expect(first.records[0]).toMatchObject({ formal: true, noteNumber: 1, occurrence: 3 });
    expect(notificationsOf(c.ids.cmd).map((n) => n.title)).toContain('מפק"צ 1 נתן הערת משמעת לנועם לוי (1 מתוך 3)');

    await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true, occurredOn: '2026-10-01' }));
    const third = (await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true, occurredOn: '2026-10-01' }))).body as CadetDetail;
    expect(third.cadet).toMatchObject({ disciplineNotes: 3, status: 'dropped', dismissedByNotes: true });
    expect(third.records.filter((r) => r.formal).map((r) => r.noteNumber)).toEqual([3, 2, 1]);
    expect(notificationsOf(c.ids.cmd).at(-1)).toMatchObject({ title: 'נועם לוי קיבל הערת משמעת 3 מתוך 3 והודח מהקורס', category: 'exception' });
    expect(notificationsOf(c.ids.s1)).toEqual([]); // the one who gave it

    // the count is as private as discipline itself; the evaluation file carries the notes
    const list = async (agent: Ctx['cmd']) => ((await agent.get('/api/cadets?status=all')).body as { disciplineNotes: number; status: string }[])[0];
    expect(await list(c.cmd)).toMatchObject({ disciplineNotes: 3, status: 'dropped' });
    expect(await list(c.s2)).toMatchObject({ disciplineNotes: 0, status: 'dropped' });
    const file = (await c.s1.get(`/api/evaluations/${cadet}`)).body as EvaluationFile;
    expect(file.discipline.filter((r) => r.formal).map((r) => r.noteNumber)).toEqual([3, 2, 1]);

    // a note given by mistake is deleted: the cadet is back
    await c.s1.del(`/api/records/${third.records[0].id}`);
    d = await detail();
    expect(d.cadet).toMatchObject({ disciplineNotes: 2, status: 'active', dismissedByNotes: false });
  });

  it('a status set by hand stays: no return on delete, and no dismissal of a cadet who already left', async () => {
    for (let i = 0; i < 3; i++) await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true }));
    expect((await detail()).cadet.dismissedByNotes).toBe(true);
    // the commander keeps the dismissal but makes it his own decision
    await c.cmd.patch(`/api/cadets/${cadet}`, { status: 'dropped' });
    expect((await detail()).cadet.dismissedByNotes).toBe(true);
    await c.cmd.patch(`/api/cadets/${cadet}`, { status: 'active' });
    await c.cmd.patch(`/api/cadets/${cadet}`, { status: 'dropped' });
    const d = await detail();
    expect(d.cadet).toMatchObject({ status: 'dropped', dismissedByNotes: false });
    await c.s1.del(`/api/records/${d.records[0].id}`);
    expect((await detail()).cadet.status).toBe('dropped');
    // already out: another note changes nothing
    await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true }));
    expect((await detail()).cadet).toMatchObject({ status: 'dropped', dismissedByNotes: false, disciplineNotes: 3 });
  });
});

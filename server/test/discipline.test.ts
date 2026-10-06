// Discipline notes (הערות משמעת) - the third dismisses the cadet - and the
// enforcement ladder the commander imports from the course's document.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cadet, CadetDetail, CommitteeDetail, DisciplineGuide, DisciplineLogEntry, DisciplineOverview, EvaluationFile, EvaluationListItem, WeeklyReport } from '../../shared/types';
import { db, Db, migrate } from '../src/db';
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

  it('counts each offense, and the third note sends the cadet to an evaluation committee', async () => {
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
    expect(first.cadet).toMatchObject({ disciplineNotes: 1, status: 'active', notesCommittee: null });
    expect(first.records[0]).toMatchObject({ formal: true, noteNumber: 1, occurrence: 3 });
    expect(notificationsOf(c.ids.cmd).map((n) => n.title)).toContain('מפק"צ 1 נתן הערת משמעת לנועם לוי (1 מתוך 3)');

    await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true, occurredOn: '2026-10-01' }));
    const third = (await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true, title: 'יציאה בלי אישור', occurredOn: '2026-10-01' }))).body as CadetDetail;
    expect(third.cadet).toMatchObject({ disciplineNotes: 3, status: 'active', notesCommittee: { decision: null } });
    expect(third.records.filter((r) => r.formal).map((r) => r.noteNumber)).toEqual([3, 2, 1]);
    expect(notificationsOf(c.ids.cmd).at(-1)).toMatchObject({ title: 'נועם לוי קיבל הערת משמעת 3 מתוך 3 ועולה לוועדת הערכה', category: 'exception' });
    expect(notificationsOf(c.ids.s1)).toEqual([]); // the one who gave it

    // the committee: in the evaluation file, with the reason and the file as it was, the third note included
    const committee = (await c.s1.get(`/api/evaluations/committees/${third.cadet.notesCommittee!.id}`)).body as CommitteeDetail;
    expect(committee.committee).toMatchObject({ kind: 'ועדת הערכה', referredByName: 'מפק"צ 1', decision: null });
    expect(committee.committee.reason).toBe('קיבל 3 הערות משמעת:\n1. 30.09.2026 - איחור למסדר\n2. 01.10.2026 - הערת משמעת\n3. 01.10.2026 - יציאה בלי אישור');
    expect(committee.file.discipline.filter((r) => r.formal)).toHaveLength(3);
    const [row] = (await c.cmd.get('/api/evaluations')).body as EvaluationListItem[];
    expect(row).toMatchObject({ disciplineNotes: 3, committee: { kind: 'ועדת הערכה', decision: null } });

    // the count is as private as discipline itself
    const list = async (agent: Ctx['cmd']) => ((await agent.get('/api/cadets')).body as Cadet[])[0];
    expect(await list(c.cmd)).toMatchObject({ disciplineNotes: 3, status: 'active' });
    expect(await list(c.s2)).toMatchObject({ disciplineNotes: 0, notesCommittee: null });

    // a note given by mistake is deleted before the committee decides: the referral is cancelled
    await c.s1.del(`/api/records/${third.records[0].id}`);
    d = await detail();
    expect(d.cadet).toMatchObject({ disciplineNotes: 2, notesCommittee: null });
    expect((await c.cmd.get(`/api/evaluations/${cadet}`)).body.committees).toEqual([]);
  });

  it('the committee decides; a decided committee stays, and an open one is not doubled', async () => {
    // a committee the commander opened by hand: the third note does not open another
    const manual = (await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת חריגים' })).body as EvaluationFile;
    for (let i = 0; i < 3; i++) await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true }));
    let file = (await c.cmd.get(`/api/evaluations/${cadet}`)).body as EvaluationFile;
    expect(file.committees.map((x) => x.kind)).toEqual(['ועדת חריגים']);
    expect((await detail()).cadet.notesCommittee).toBeNull();
    await c.cmd.del(`/api/evaluations/committees/${manual.committees[0].id}`);

    // the fourth note, with no committee open, opens one; its decision dismisses
    const d = (await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true }))).body as CadetDetail;
    const id = d.cadet.notesCommittee!.id;
    await c.cmd.post(`/api/evaluations/committees/${id}/decision`, { decision: 'dismissed', text: 'הוחלט להדיח' });
    expect((await detail()).cadet).toMatchObject({ status: 'dropped', notesCommittee: { id, decision: 'dismissed' } });
    // deleting notes now changes nothing: the decision is part of the file
    for (const r of (await detail()).records.slice(0, 2)) await c.s1.del(`/api/records/${r.id}`);
    file = (await c.cmd.get(`/api/evaluations/${cadet}`)).body as EvaluationFile;
    expect(file.committees.map((x) => x.decision)).toEqual(['dismissed']);
    expect((await detail()).cadet.status).toBe('dropped');
  });

  it('the commanders see this week, who has notes, and the latest records - of their own cadets', async () => {
    await c.s1.post(`/api/cadets/${cadet}/records`, record({ offense: 'זמנים · איחור למסדר', occurredOn: '2026-09-28' }));
    await c.s1.post(`/api/cadets/${cadet}/records`, record({ offense: 'זמנים · איחור למסדר', formal: true, occurredOn: '2026-09-30' }));
    await c.s1.post(`/api/cadets/${cadet}/records`, record({ title: 'ישן', occurredOn: '2026-09-20' })); // last week
    const o = (await c.s1.get('/api/discipline/overview')).body as DisciplineOverview;
    expect(o).toMatchObject({ managed: 1, week: { events: 2, notes: 1, byCategory: [{ category: 'זמנים', count: 2 }] } });
    expect(o.cadets).toEqual([{ id: cadet, fullName: 'נועם לוי', teamName: 'צוות 1', notes: 1, committee: null }]);
    expect(o.recent.map((r) => [r.title, r.occurrence, r.formal])).toEqual([
      ['איחור למסדר', 2, true],
      ['איחור למסדר', 1, false],
      ['ישן', null, false],
    ]);
    // another cadet with the same offense: their own first time
    const other = (await c.cmd.post('/api/cadets', { firstName: 'דנה', lastName: 'כץ', teamId: (await detail()).cadet.teamId })).body.cadet.id;
    await c.s1.post(`/api/cadets/${other}/records`, record({ offense: 'זמנים · איחור למסדר', occurredOn: '2026-10-01' }));
    const both = (await c.cmd.get('/api/discipline/overview')).body as DisciplineOverview;
    expect(both).toMatchObject({ managed: 2, week: { events: 3 } });
    expect(both.recent.map((r) => [r.cadetName, r.occurrence])).toEqual([
      ['דנה כץ', 1],
      ['נועם לוי', 2],
      ['נועם לוי', 1],
      ['נועם לוי', null],
    ]);
    await c.cmd.del(`/api/cadets/${other}`);
    // staff without a team see nothing
    expect((await c.s2.get('/api/discipline/overview')).body).toEqual({ managed: 0, week: { events: 0, notes: 0, byCategory: [] }, cadets: [], recent: [] });

    // the weekly report has the same, for the week it shows
    const weekly = async (agent: Ctx['cmd'], from: string) => ((await agent.get(`/api/reports/weekly?from=${from}`)).body as WeeklyReport).discipline;
    expect(await weekly(c.s1, '2026-09-27')).toEqual({
      events: 2,
      notes: 1,
      byCategory: [{ category: 'זמנים', count: 2 }],
      cadets: [{ id: cadet, fullName: 'נועם לוי', teamName: 'צוות 1', events: 2, notes: 1, totalNotes: 1 }],
    });
    expect(await weekly(c.cmd, '2026-09-20')).toMatchObject({ events: 1, notes: 0, byCategory: [{ category: 'אחר', count: 1 }] });
    expect(await weekly(c.s2, '2026-09-27')).toBeNull();

    // the log for export: oldest first, with the case split from its subject
    const log = (await c.s1.get('/api/discipline/log?from=2026-09-27&to=2026-10-03')).body as DisciplineLogEntry[];
    expect(log.map((r) => [r.occurredOn, r.category, r.offense, r.occurrence, r.formal, r.noteNumber, r.authorName])).toEqual([
      ['2026-09-28', 'זמנים', 'איחור למסדר', 1, false, null, 'מפק"צ 1'],
      ['2026-09-30', 'זמנים', 'איחור למסדר', 2, true, 1, 'מפק"צ 1'],
    ]);
    expect((await c.s1.get('/api/discipline/log')).body).toHaveLength(3);
    expect((await c.s2.get('/api/discipline/log')).body).toEqual([]);
  });

  it('a cadet who already left gets no committee', async () => {
    await c.cmd.patch(`/api/cadets/${cadet}`, { status: 'dropped' });
    for (let i = 0; i < 3; i++) await c.s1.post(`/api/cadets/${cadet}/records`, record({ formal: true }));
    expect((await detail()).cadet).toMatchObject({ status: 'dropped', disciplineNotes: 3, notesCommittee: null });
  });

  it('a cadet the first release dismissed at the third note goes to the committee instead', () => {
    const old = new Db(':memory:');
    migrate(old, 8);
    old.run("INSERT INTO users(id, username, password_hash, display_name, role, created_at) VALUES (1, 'u', 'x', 'מפקד', 'commander', '2026-10-01')");
    old.run("INSERT INTO cadets(id, first_name, last_name, status, created_at, updated_at) VALUES (1, 'נועם', 'לוי', 'dropped', '2026-10-01', '2026-10-01')");
    old.run("INSERT INTO cadets(id, first_name, last_name, status, created_at, updated_at) VALUES (2, 'דנה', 'כץ', 'dropped', '2026-10-01', '2026-10-01')");
    old.run("INSERT INTO cadet_records(id, cadet_id, kind, author_id, occurred_on, created_at, formal) VALUES (9, 1, 'discipline', 1, '2026-10-02', '2026-10-02T09:00:00.000Z', 1)");
    old.run('UPDATE cadets SET dismissed_by_record = 9 WHERE id = 1');
    migrate(old);
    expect(old.all('SELECT id, status, dismissed_by_record FROM cadets ORDER BY id')).toEqual([
      { id: 1, status: 'active', dismissed_by_record: null },
      { id: 2, status: 'dropped', dismissed_by_record: null }, // left for another reason
    ]);
    expect(old.all('SELECT cadet_id, kind, referred_by, from_record, decision FROM committees')).toEqual([{ cadet_id: 1, kind: 'ועדת הערכה', referred_by: 1, from_record: 9, decision: null }]);
    old.close();
  });
});

describe('exemptions', () => {
  let c: Ctx;
  let cadet: number;
  beforeEach(async () => {
    c = await setup();
    const team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
    cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'לוי', teamId: team })).body.cadet.id;
  });
  const shaving = { subject: 'דיגום', details: 'פטור גילוח', reason: 'אישור רפואי', until: '2026-10-15' };

  it('the team commander records one; every staff member sees it and hears of it, the reason stays with the commanders', async () => {
    expect((await c.s2.post(`/api/cadets/${cadet}/exemptions`, shaving)).status).toBe(403);
    expect((await c.s1.post(`/api/cadets/${cadet}/exemptions`, { ...shaving, until: '2026-09-01' })).status).toBe(400);
    const d = (await c.s1.post(`/api/cadets/${cadet}/exemptions`, shaving)).body as CadetDetail;
    expect(d.cadet.exemptions).toEqual(['דיגום']);
    expect(d.exemptions).toMatchObject([{ subject: 'דיגום', details: 'פטור גילוח', reason: 'אישור רפואי', until: '2026-10-15', active: true, canDelete: true, createdByName: 'מפק"צ 1' }]);
    for (const id of [c.ids.s2, c.ids.s3, c.ids.cmd]) expect(notificationsOf(id).map((n) => n.title)).toContain('פטור: נועם לוי - דיגום עד 15.10');
    expect(notificationsOf(c.ids.s1)).toEqual([]);

    // other staff: what and until when, not why
    const seen = (await c.s2.get(`/api/cadets/${cadet}`)).body as CadetDetail;
    expect(seen.exemptions).toMatchObject([{ subject: 'דיגום', details: 'פטור גילוח', reason: '', canDelete: false }]);
    expect((await c.s2.get('/api/exemptions')).body).toHaveLength(1);
    expect((await c.s2.get('/api/briefing')).body.exemptions).toMatchObject([{ cadetName: 'נועם לוי', subject: 'דיגום' }]);

    expect((await c.s2.del(`/api/exemptions/${d.exemptions[0].id}`)).status).toBe(403);
    expect(((await c.s1.del(`/api/exemptions/${d.exemptions[0].id}`)).body as CadetDetail).cadet.exemptions).toEqual([]);
  });

  it('an exemption past its last day stays in the file but is no longer current', async () => {
    await c.s1.post(`/api/cadets/${cadet}/exemptions`, { subject: 'נשק', until: '2026-10-01' });
    await c.s1.post(`/api/cadets/${cadet}/exemptions`, { subject: 'דיגום' }); // until further notice
    db().run("UPDATE exemptions SET until = '2026-09-30' WHERE subject = 'נשק'");
    const d = (await c.cmd.get(`/api/cadets/${cadet}`)).body as CadetDetail;
    expect(d.cadet.exemptions).toEqual(['דיגום']);
    expect(d.exemptions.map((x) => [x.subject, x.active])).toEqual([
      ['דיגום', true],
      ['נשק', false],
    ]);
    expect(((await c.cmd.get('/api/exemptions')).body as { subject: string }[]).map((x) => x.subject)).toEqual(['דיגום']);
  });
});

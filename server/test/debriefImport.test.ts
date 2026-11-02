import { beforeEach, describe, expect, it } from 'vitest';
import { withImported, type ProposalAnswer } from '../../shared/debriefForms';
import { blocksOf, debriefFromBlocks, partOf } from '../src/debriefImport';
import { docxBlocks } from '../src/discipline';
import { setup, zip, type Ctx } from './helpers';

type Client = Ctx['s2'];
const upload = (who: Client, url: string, file: Buffer) => who.post(url).set('content-type', 'application/octet-stream').send(file);

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

// a company debrief written in the company's own format (the names and the course are made up)
const p = (text: string, extra = '') => `<w:p><w:pPr>${extra}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const title = (text: string) => p(text, '<w:pStyle w:val="Title"/>');
const bullet = (text: string) => p(text, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
const tc = (...lines: string[]) => `<w:tc><w:tcPr/>${(lines.length ? lines : ['']).map((l) => p(l)).join('')}</w:tc>`;
const tr = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;

function debriefDocx(): Buffer {
  const body = [
    p('סיכום תחק"ש - שבוע 3'),
    title('לקחים'),
    `<w:tbl><w:tblPr/>${[
      tr(tc('פער'), tc('לקח + פתרון'), tc('אחראי'), tc('תיעוד התקדמות')),
      tr(tc('חלוקת ציוד איטית -', '"לקח יותר מדי זמן"'), tc('-להכין מראש', '-לחלק לפי צוותים'), tc('יואב כרמי'), tc('חולק לפי צוותים בשבוע שעבר')),
      tr(tc('רעש בחדרים'), tc('-שקט אחרי 23:00'), tc('נועה'), tc()),
      tr(tc('תורנויות'), tc(), tc('קב"ט'), tc('עודכן לוח')),
      tr(tc('מקלחות'), tc('-לוח זמנים'), tc('דני'), tc()),
    ].join('')}</w:tbl>`,
    p(''),
    title('הלך רוח - תחושות בזמן התחק"ש'),
    bullet('אווירה טובה'),
    bullet('ויכוח על הלו"ז'),
    title('מסרים / פערים שלא מצאנו להם פתרון'),
    bullet('עומס בסופי שבוע'),
    title('נקודות להעברה לסגל'),
    bullet('א חדר כושר -'),
    p('-סגור בערב'),
    p('פתרון-'),
    p('-לפתוח עד 22:00'),
    p('ב מים קרים'),
    p('פתרון: מתקן נוסף'),
    title('נקודות של הסגל '),
    p("א' שטח - חיובי"),
    p(''),
    p('מפקד-'),
    p('1.זמנים - לא נכנסים באיחור'),
    title('הערות כלליות'),
    p('תודה לצוות המטבח'),
  ].join('');
  const numbering =
    '<w:numbering><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="3"/></w:num></w:numbering>';
  return zip([
    ['word/document.xml', `<w:document><w:body>${body}</w:body></w:document>`],
    ['word/numbering.xml', numbering],
  ]);
}

const rowOf = (rows: ProposalAnswer[] | undefined, topic: string) => rows?.find((r) => r.topic.startsWith(topic));

async function companyDebrief() {
  const teamId = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
  const cadet = async (firstName: string, lastName: string) => (await c.cmd.post('/api/cadets', { firstName, lastName, teamId })).body.cadet.id as number;
  const yoav = await cadet('יואב', 'כרמי');
  const noa = await cadet('נועה', 'שחר');
  const guard = await cadet('אורי', 'לב');
  await c.s1.post('/api/experiences', { cadetId: guard, kind: 'broad', role: 'קב"ט', span: 'full', startDate: '2026-09-01', endDate: '2026-12-31' });
  const week = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-10-04', endDate: '2026-10-08', leadId: c.ids.s1 })).body;
  const weekId = (week.week?.id ?? week.id) as number;
  const id = (await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'תחק"ש פלוגתי', occurredOn: '2026-10-08' })).body.debrief.id as number;
  return { id, weekId, yoav, noa, guard };
}

describe('a company debrief from its document', () => {
  it('finds the sections by their titles', () => {
    expect(partOf('לקחים')).toBe('lessons');
    expect(partOf('הלך רוח - תחושות בזמן התחק״ש')).toBe('mood');
    expect(partOf('מסרים / פערים שלא מצאנו להם פתרון')).toBe('unsolved');
    expect(partOf('נקודות להעברה לסגל:')).toBe('toStaff');
    expect(partOf('נקודות של הסגל ')).toBe('staffPoints');
    // a line of text that begins with the same words is not a title
    expect(partOf('הלך רוח טוב בפלוגה כל השבוע, למרות העומס וכל מה שהיה בשטח, ותודה לכולם על המאמץ הגדול')).toBeNull();
    expect(partOf('מרחבים מוגנים -')).toBeNull();
  });

  it('reads the lessons table, the points for the staff, the summing up - and leaves nothing out', () => {
    const buf = debriefDocx();
    const { answers } = debriefFromBlocks(blocksOf(buf));
    // the lessons table: the topics before the company, with their proposals and progress
    expect(answers.company).toHaveLength(4);
    expect(rowOf(answers.company, 'חלוקת ציוד')).toEqual({
      topic: 'חלוקת ציוד איטית -\n"לקח יותר מדי זמן"',
      proposal: '-להכין מראש\n-לחלק לפי צוותים',
      owner: null,
      ownerText: 'יואב כרמי',
      progress: 'חולק לפי צוותים בשבוע שעבר',
    });
    expect(rowOf(answers.company, 'תורנויות')).toMatchObject({ proposal: '', ownerText: 'קב"ט', progress: 'עודכן לוח' });
    // the points for the staff: a point on each item or numbered line, its proposal from the "פתרון" line
    expect(answers.staffGeneral).toEqual([
      { topic: 'א חדר כושר -\n-סגור בערב', proposal: '-לפתוח עד 22:00', owner: null },
      { topic: 'ב מים קרים', proposal: 'מתקן נוסף', owner: null },
    ]);
    expect(answers.mood).toEqual(['אווירה טובה', 'ויכוח על הלו"ז']);
    expect(answers.unsolved).toEqual(['עומס בסופי שבוע']);
    // the staff's points as written, a blank line between groups
    expect(answers.staffPoints).toBe("א' שטח - חיובי\n\nמפקד-\n1.זמנים - לא נכנסים באיחור");
    // what has no question of its own: under its heading (the line before the first title has none)
    expect(answers.more).toBe('סיכום תחק"ש - שבוע 3\n\nהערות כלליות\nתודה לצוות המטבח');

    // every word of the document is in the form, but the titles, the table's header and the "פתרון" marks
    const labels = /^(לקחים|פער|לקח|\+|אחראי|תיעוד|התקדמות|הלך|רוח|-|תחושות|בזמן|התחק"ש|מסרים|\/|פערים|שלא|מצאנו|להם|פתרון|נקודות|להעברה|לסגל|של|הסגל|פתרון-|פתרון:)$/;
    const filled = JSON.stringify(answers).replace(/\\n/g, ' ').replace(/\\"/g, '"');
    const words = docxBlocks(buf)
      .flatMap((b) => (b.kind === 'table' ? b.grid.flat() : [b.text]))
      .flatMap((t) => t.split(/\s+/))
      .filter((w) => w && !labels.test(w));
    expect(words.filter((w) => !filled.includes(w))).toEqual([]);
  });

  it('is added to what the form holds: nothing taken out, and the same document twice adds nothing', () => {
    const read = debriefFromBlocks(blocksOf(debriefDocx())).answers;
    const current = { company: [{ topic: 'נושא שכבר נכתב', proposal: 'הצעה' }], mood: ['אווירה טובה'], staffPoints: 'נכתב קודם', presenterId: 7 };
    const changes = withImported(current, read);
    expect((changes.company as ProposalAnswer[]).map((r) => r.topic.split('\n')[0])).toEqual(['נושא שכבר נכתב', 'חלוקת ציוד איטית -', 'רעש בחדרים', 'תורנויות', 'מקלחות']);
    // a line already there is not written twice
    expect(changes.mood).toEqual(['אווירה טובה', 'ויכוח על הלו"ז']);
    expect(changes.staffPoints).toBe(`נכתב קודם\n\n${read.staffPoints}`);
    expect(changes.unsolved).toEqual(['עומס בסופי שבוע']);
    // only what the document fills changes
    expect(Object.keys(changes).sort()).toEqual(['company', 'mood', 'more', 'staffGeneral', 'staffPoints', 'unsolved']);
    expect(withImported({ ...current, ...changes }, read)).toEqual({});
  });

  it('a Google Docs export: a title is a plain paragraph there', () => {
    const html = `<html><body><p class="title"><span>לקחים</span></p><table><tr><td><p>פער</p></td><td><p>לקח + פתרון</p></td><td><p>אחראי</p></td></tr>
      <tr><td><p>איחורים</p></td><td><p>תזכורת</p><p>עונשים</p></td><td><p></p></td></tr></table>
      <p class="title"><span>הלך רוח</span></p><ul><li><p>רגוע</p></li></ul></body></html>`;
    const { answers } = debriefFromBlocks(blocksOf(Buffer.from(html)));
    expect(answers.company).toEqual([{ topic: 'איחורים', proposal: 'תזכורת\nעונשים', owner: null }]);
    expect(answers.mood).toEqual(['רגוע']);
  });

  it('a file that is not a document is refused', () => {
    expect(() => blocksOf(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]))).toThrow(/\.doc/);
    expect(() => blocksOf(Buffer.from('%PDF-1.7'))).toThrow(/PDF/);
    expect(() => blocksOf(Buffer.alloc(0))).toThrow();
  });

  it('on the company debrief: who the topics are on, by name, by first name or by broad role', async () => {
    const { id, yoav, noa, guard } = await companyDebrief();
    const res = await upload(c.s2, `/api/debriefs/${id}/import/file`, debriefDocx());
    expect(res.status).toBe(200);
    const rows = res.body.answers.company as ProposalAnswer[];
    expect(rowOf(rows, 'חלוקת ציוד')).toMatchObject({ owner: { kind: 'cadet', id: yoav, name: 'יואב כרמי' } });
    expect(rowOf(rows, 'חלוקת ציוד')?.ownerText).toBeUndefined();
    // a first name only one cadet has
    expect(rowOf(rows, 'רעש')).toMatchObject({ owner: { kind: 'cadet', id: noa } });
    // a broad role, held by one cadet that week
    expect(rowOf(rows, 'תורנויות')).toMatchObject({ owner: { kind: 'cadet', id: guard, name: 'אורי לב' } });
    // no one by that name: kept as written
    expect(rowOf(rows, 'מקלחות')).toMatchObject({ owner: null, ownerText: 'דני' });
    expect(res.body.owners).toEqual({ named: 3, asWritten: 1 });

    // the screen saves it as the form's answers: the progress and the name as written are kept
    expect((await c.s2.patch(`/api/debriefs/${id}`, { answers: res.body.answers })).status).toBe(200);
    let saved = (await c.s2.get(`/api/debriefs/${id}`)).body.debrief.answers;
    expect(rowOf(saved.company, 'מקלחות')).toMatchObject({ ownerText: 'דני' });
    expect(rowOf(saved.company, 'חלוקת ציוד')).toMatchObject({ progress: 'חולק לפי צוותים בשבוע שעבר' });
    expect(saved.staffPoints).toContain('מפקד-');
    // someone chosen for it: the name as written goes
    const chosen = (saved.company as ProposalAnswer[]).map((r) => (r.topic === 'מקלחות' ? { ...r, owner: { kind: 'cadet', id: noa, name: 'נועה שחר' } } : r));
    await c.s2.patch(`/api/debriefs/${id}`, { answers: { company: chosen } });
    saved = (await c.s2.get(`/api/debriefs/${id}`)).body.debrief.answers;
    expect(rowOf(saved.company, 'מקלחות')?.ownerText).toBeUndefined();
    // the summing up lines alone are not a topic, the topics are
    expect((await c.s2.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
  });

  it('only into a company debrief its editor may fill, while a draft', async () => {
    const { id, weekId } = await companyDebrief();
    // another staff member, not its lead or its writer
    expect((await upload(c.s3, `/api/debriefs/${id}/import/file`, debriefDocx())).status).toBe(403);
    // nothing is fetched for one who may not fill it
    expect((await c.s3.post(`/api/debriefs/${id}/import/link`, { url: 'https://docs.google.com/document/d/abcdefghijklmnop/edit' })).status).toBe(403);
    const weekly = (await c.s2.post('/api/debriefs', { kind: 'weekly', weekId, title: 'תחקיר שבועי', occurredOn: '2026-10-08' })).body.debrief.id;
    expect((await upload(c.s2, `/api/debriefs/${weekly}/import/file`, debriefDocx())).body.error).toBe('ייבוא מקובץ הוא לתחק"ש פלוגתי');
    await c.s2.patch(`/api/debriefs/${id}`, { answers: { company: [{ topic: 'נושא', proposal: '' }] } });
    await c.s2.patch(`/api/debriefs/${id}`, { status: 'final' });
    expect((await upload(c.s2, `/api/debriefs/${id}/import/file`, debriefDocx())).body.error).toContain('כבר סוכם');
    // a document with nothing for the debrief
    const empty = await c.s2.post('/api/debriefs', { kind: 'company', weekId, title: 'עוד תחק"ש', occurredOn: '2026-10-09' });
    expect((await upload(c.s2, `/api/debriefs/${empty.body.debrief.id}/import/file`, zip([['word/document.xml', '<w:document><w:body></w:body></w:document>']]))).body.error).toBe(
      'לא נמצא במסמך תוכן לתחקיר',
    );
  });
});

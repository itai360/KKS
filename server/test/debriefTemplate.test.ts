import { beforeEach, describe, expect, it } from 'vitest';
import { debriefTemplateDocx, type TemplateInput } from '../../shared/debriefTemplate';
import type { DebriefDetail } from '../../shared/types';
import { docxBlocks } from '../src/discipline';
import { dateOf, readTemplate, templateKind } from '../src/debriefTemplate';
import { setup, type Ctx } from './helpers';

type Client = Ctx['s2'];
const upload = (who: Client, url: string, file: Uint8Array) => who.post(url).set('content-type', 'application/octet-stream').send(Buffer.from(file));

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

/** the template of a debrief, as the screen makes it from what it shows */
function templateOf(d: DebriefDetail): Uint8Array {
  const x = d.debrief;
  const input: TemplateInput = {
    kind: x.kind,
    title: x.title,
    when: x.occurredOn,
    about: x.weekName ?? x.eventTitle ?? '',
    participants: x.participants,
    summary: x.summary,
    answers: x.answers,
    items: d.items.map((i) => ({ kind: i.kind, body: i.body, horizon: i.horizon, ownerName: i.ownerName, dueDate: i.dueDate })),
    weekGoals: d.week?.goals,
  };
  return debriefTemplateDocx(input).data;
}

async function week() {
  const w = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-10-04', endDate: '2026-10-08', leadId: c.ids.s1 })).body;
  return (w.week?.id ?? w.id) as number;
}
const create = async (body: object) => (await c.s2.post('/api/debriefs', body)).body.debrief.id as number;
const detail = async (id: number) => (await c.s2.get(`/api/debriefs/${id}`)).body as DebriefDetail;

describe('a debrief as a template to fill in', () => {
  it('a weekly debrief: its file back into an empty one puts every part in its place', async () => {
    const weekId = await week();
    const filled = await create({ kind: 'weekly', weekId, title: 'תחקיר שבוע שטח', occurredOn: '2026-10-08', participants: 'סגל הקורס', summary: 'שבוע עמוס' });
    const answers = {
      goals: [
        { goal: 'לסיים את המטווח', status: 'met', note: '' },
        { goal: 'שיחות אישיות לכל הצוערים', status: 'partial', note: 'חצי מהצוערים' },
      ],
      rating: 4,
      headline: 'שבוע טוב, עם עומס בערבים',
      sustain: ['תדריך בוקר קצר', 'חלוקת התורנויות'],
      improve: ['איחור בהסעות'],
      schedule: 'הלו"ז היה צפוף\nביום שלישי זז שיעור',
      load: 'על הסגל בערבים',
      cadets: 'מצב רוח טוב',
    };
    await c.s2.patch(`/api/debriefs/${filled}`, { answers });
    await c.s2.post(`/api/debriefs/${filled}/items`, { kind: 'lesson', body: 'לתאם הסעות יומיים מראש', horizon: 'now', ownerId: c.ids.s1, dueDate: '2026-10-12' });
    await c.s2.post(`/api/debriefs/${filled}/items`, { kind: 'lesson', body: 'להקדים את המטווח לתחילת השבוע', horizon: 'next' });
    const file = templateOf(await detail(filled));

    // the file says what it is for
    expect(templateKind(docxBlocks(Buffer.from(file)))).toBe('weekly');

    const empty = await create({ kind: 'weekly', weekId, title: 'תחקיר שבוע שטח - עותק', occurredOn: '2026-10-08' });
    const res = await upload(c.s2, `/api/debriefs/${empty}/import/file`, file);
    expect(res.status).toBe(200);
    expect(res.body.template.placed.items).toBe(2);
    const got = await detail(empty);
    expect(got.debrief.answers).toEqual(answers);
    expect(got.debrief).toMatchObject({ participants: 'סגל הקורס', summary: 'שבוע עמוס' });
    const lessons = got.items.map((i) => ({ body: i.body, horizon: i.horizon, ownerId: i.ownerId, dueDate: i.dueDate }));
    expect(lessons).toEqual([
      { body: 'לתאם הסעות יומיים מראש', horizon: 'now', ownerId: c.ids.s1, dueDate: '2026-10-12' },
      { body: 'להקדים את המטווח לתחילת השבוע', horizon: 'next', ownerId: null, dueDate: null },
    ]);

    // the same file again adds nothing; undo puts it back as it was
    expect((await upload(c.s2, `/api/debriefs/${empty}/import/file`, file)).body.error).toBe('כל מה שבקובץ כבר נמצא בתחקיר');
    const undo = res.body.template.undo;
    await c.s2.patch(`/api/debriefs/${empty}`, { answers: undo.answers, participants: undo.participants, summary: undo.summary });
    for (const itemId of undo.itemIds) await c.s2.del(`/api/debrief-items/${itemId}`);
    const back = await detail(empty);
    expect(back.items).toHaveLength(0);
    expect(back.debrief.summary).toBe('');
  });

  it('fills in on top of what the debrief has: nothing it holds is lost', async () => {
    const weekId = await week();
    const source = await create({ kind: 'weekly', weekId, title: 'א', occurredOn: '2026-10-08' });
    await c.s2.patch(`/api/debriefs/${source}`, { answers: { sustain: ['תדריך בוקר קצר'], headline: 'שבוע טוב', rating: 5 } });
    const file = templateOf(await detail(source));
    const target = await create({ kind: 'weekly', weekId, title: 'ב', occurredOn: '2026-10-08' });
    await c.s2.patch(`/api/debriefs/${target}`, { answers: { sustain: ['שיחת סיכום'], headline: 'כתוב כבר', rating: 3 } });
    expect((await upload(c.s2, `/api/debriefs/${target}/import/file`, file)).status).toBe(200);
    const a = (await detail(target)).debrief.answers;
    expect(a.sustain).toEqual(['תדריך בוקר קצר', 'שיחת סיכום']);
    expect(a.headline).toBe('כתוב כבר\n\nשבוע טוב');
    expect(a.rating).toBe(5);
  });

  it('an event debrief: the numbers, the safety flag and the rating', async () => {
    const answers = { numbers: { started: 40, finished: 37, evacuated: 3 }, goals: [{ goal: 'לסיים את המסע', status: 'missed', note: 'שלושה פונו' }], safetyEvent: true, safety: 'פינוי בגלל התייבשות', rating: 3, sustain: ['חובש בכל חוליה'], improve: [] as string[] };
    const source = await create({ kind: 'event', title: 'מסע', occurredOn: '2026-10-08' });
    await c.s2.patch(`/api/debriefs/${source}`, { answers });
    const target = await create({ kind: 'event', title: 'מסע - עותק', occurredOn: '2026-10-08' });
    expect((await upload(c.s2, `/api/debriefs/${target}/import/file`, templateOf(await detail(source)))).status).toBe(200);
    const { improve: _empty, ...filled } = answers;
    expect((await detail(target)).debrief.answers).toEqual(filled);
  });

  it('a company debrief: each topic with whom it is on, by name - or the name as written', async () => {
    const weekId = await week();
    const source = await create({ kind: 'company', weekId, title: 'תחק"ש', occurredOn: '2026-10-08' });
    const company = [
      { topic: 'איחור לארוחות', proposal: 'שעון בחדר האוכל', owner: { kind: 'user', id: c.ids.s3, name: 'מפק"צ 3' }, progress: 'הוזמן' },
      { topic: 'ניקיון המגורים', proposal: 'תורנות קבועה', owner: null, ownerText: 'רס"פ' },
    ];
    await c.s2.patch(`/api/debriefs/${source}`, { answers: { company, mood: ['עייפות', 'גאווה'], staffPoints: 'הסגל הודה לפלוגה' } });
    const target = await create({ kind: 'company', weekId, title: 'תחק"ש - עותק', occurredOn: '2026-10-08' });
    expect((await upload(c.s2, `/api/debriefs/${target}/import/file`, templateOf(await detail(source)))).status).toBe(200);
    const a = (await detail(target)).debrief.answers;
    expect(a.company).toEqual(company);
    expect(a.mood).toEqual(['עייפות', 'גאווה']);
    expect(a.staffPoints).toBe('הסגל הודה לפלוגה');
  });

  it('an activity debrief: its facts, findings, conclusions and lessons', async () => {
    const source = await create({ kind: 'general', title: 'תרגיל', occurredOn: '2026-10-08', summary: 'תרגיל כיתה בשטח' });
    for (const [kind, body] of [['fact', 'ההסעה איחרה'], ['finding', 'לא היה וידוא ערב לפני'], ['conclusion', 'חסר תיאום'], ['lesson', 'וידוא טלפוני ערב לפני']])
      await c.s2.post(`/api/debriefs/${source}/items`, { kind, body });
    const target = await create({ kind: 'general', title: 'תרגיל - עותק', occurredOn: '2026-10-08' });
    expect((await upload(c.s2, `/api/debriefs/${target}/import/file`, templateOf(await detail(source)))).status).toBe(200);
    const got = await detail(target);
    expect(got.items.map((i) => [i.kind, i.body])).toEqual([
      ['fact', 'ההסעה איחרה'],
      ['finding', 'לא היה וידוא ערב לפני'],
      ['conclusion', 'חסר תיאום'],
      ['lesson', 'וידוא טלפוני ערב לפני'],
    ]);
    expect(got.debrief.summary).toBe('תרגיל כיתה בשטח');
  });

  it("says when the file is another kind's template, or none", async () => {
    const weekId = await week();
    const weekly = await create({ kind: 'weekly', weekId, title: 'שבועי', occurredOn: '2026-10-08' });
    const event = await create({ kind: 'event', title: 'מסע', occurredOn: '2026-10-08' });
    const wrong = await upload(c.s2, `/api/debriefs/${weekly}/import/file`, templateOf(await detail(event)));
    expect(wrong.body.error, JSON.stringify(wrong.body).slice(0, 300)).toContain('התבנית היא של תחקיר מופע עצים');
    // a template left empty
    expect((await upload(c.s2, `/api/debriefs/${weekly}/import/file`, templateOf(await detail(weekly)))).body.error).toContain('לא נמצא בקובץ מה למלא');
  });

  it('reads what a person writes: a status in words, a date in the ways it is written, a row outside the table', () => {
    expect(dateOf('12.11.2026')).toBe('2026-11-12');
    expect(dateOf('3/1/27')).toBe('2027-01-03');
    expect(dateOf('31.02.2026')).toBeNull();
    const blocks = docxBlocks(Buffer.from(debriefTemplateDocx({ kind: 'weekly', title: 'ת', when: '', about: '', participants: '', summary: '', answers: {}, items: [] }).data));
    // a line written under a question's box, not in it: still that question's
    const i = blocks.findIndex((b) => b.kind !== 'table' && b.text.startsWith('מה עבד'));
    blocks.splice(i + 2, 0, { kind: 'para', item: '•', text: 'שיחת בוקר' });
    expect(readTemplate(blocks, 'weekly').answers.sustain).toEqual(['שיחת בוקר']);
  });
});

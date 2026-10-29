// Smart entry (הזנה חכמה): free Hebrew read into items - the built-in reading, or Claude's when the server has
// its key (checked against the course's lists, the people's numbers kept here) - and each item the writer
// confirms filed through its screen's own rules: the ladder, the permissions, the notices. Made-up names and
// numbers only; no real keys or calls.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SmartAnalysis, SmartItem, SmartResult } from '../../shared/smartEntry';
import { getUserRow } from '../src/auth';
import { db } from '../src/db';
import { demoStep, saveGuide } from '../src/discipline';
import { maskNumbers } from '../src/smartEntry';
import { setTalkAiFetch } from '../src/talkAi';
import { setup, staffMay, type Ctx } from './helpers';

let c: Ctx;
let cadet: { dani: number; yossi: number; noa: number };
const KEYS = ['ANTHROPIC_API_KEY', 'KKS_AI_MODEL'];
const saved: Record<string, string | undefined> = {};
let sent: { url: string; body: unknown }[] = [];

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const MODELS = { data: ['x-opus-2'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: 'x-opus-2', last_id: 'x-opus-2' };

/** Claude's streamed answer: one text block, then how it stopped */
function claudeStream(text: string, stop = 'end_turn'): Response {
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'x-opus-2', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function answer(messages: () => Response) {
  setTalkAiFetch(async (input, init) => {
    const req = new Request(input as string | URL | Request, init);
    const body = (req.headers.get('content-type') ?? '').includes('json') ? await req.json() : null;
    sent.push({ url: req.url, body });
    if (req.url.includes('/v1/models')) return json(MODELS);
    if (req.url.includes('/v1/messages')) return messages();
    return new Response('{}', { status: 404 });
  });
}

/** an item as Claude returns it: every field there, empty where it has nothing */
const aiItem = (over: Record<string, unknown>) => ({
  kind: 'note',
  source: '',
  why: '',
  confidence: 'high',
  cadet: '',
  staff: [],
  date: null,
  endDate: null,
  time: null,
  endTime: null,
  title: '',
  details: '',
  offense: null,
  formal: false,
  procedure: null,
  dress: [],
  situation: '',
  other: '',
  entry: null,
  subject: '',
  until: null,
  absenceReason: null,
  attendance: null,
  priority: null,
  location: '',
  weeklyKind: null,
  part: null,
  urgent: false,
  ...over,
});

const analyze = async (who: Ctx['cmd'], text: string): Promise<SmartAnalysis> => {
  const r = await who.post('/api/smart/analyze', { text });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const apply = async (who: Ctx['cmd'], items: SmartItem[]): Promise<SmartResult[]> => {
  const r = await who.post('/api/smart/apply', { items: items.map((i) => ({ key: i.key, kind: i.kind, fields: i.fields })) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.results;
};
const records = (cadetId: number) => db().all<{ kind: string; title: string; body: string; offense: string; formal: number; occurred_on: string }>('SELECT kind, title, body, offense, formal, occurred_on FROM cadet_records WHERE cadet_id = ? ORDER BY id', cadetId);

beforeEach(async () => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sent = [];
  setTalkAiFetch(null);
  c = await setup();
  const teams = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body;
  const add = async (firstName: string, lastName: string) => (await c.cmd.post('/api/cadets', { firstName, lastName, teamId: teams[0].id })).body.cadet.id as number;
  cadet = { dani: await add('דני', 'כהן'), yossi: await add('יוסי', 'לוי'), noa: await add('נועה', 'ברק') };
  saveGuide(
    getUserRow(c.ids.cmd)!,
    { offenses: [{ key: 'זמנים · איחור למסדר', category: 'זמנים', name: 'איחור למסדר', definition: [], steps: ['הערה במקום', 'שיחת אזהרה עם מפקד הצוות', 'שעה ביציאה', 'הערת משמעת'].map(demoStep) }], letters: [] },
    'בדיקה',
  );
  // this week (Thursday 1.10.2026) and the next
  await c.cmd.post('/api/weeks', { name: 'שבוע פתיחה', startDate: '2026-09-27', endDate: '2026-10-03' });
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setTalkAiFetch(null);
});

describe('the built-in reading, through the server', () => {
  it('reads several things from one text, each placed, with the ladder on discipline', async () => {
    const a = await analyze(c.cmd, 'דני כהן ויוסי לוי איחרו למסדר בוקר\nנועה ברק הפקירה נשק בחדר האוכל\nאישור כניסה לאבי מזרחי מחר, 050-1234567, ת"ז 123456789, לצורך הרצאה');
    expect(a.source).toBe('local');
    expect(a.aiAvailable).toBe(false);
    expect(a.items.map((i) => [i.kind, i.fields.cadetId])).toEqual([
      ['discipline', cadet.dani],
      ['discipline', cadet.yossi],
      ['procedure', cadet.noa],
      ['entry', null],
    ]);
    expect(a.items[0].fields.offense).toBe('זמנים · איחור למסדר');
    expect(a.items[0].ladder).toMatchObject({ occurrence: 1, step: 'הערה במקום', note: false });
    expect(a.items[2].fields.procedure).toBe('weapon_left');
    expect(a.items[3].fields).toMatchObject({ date: '2026-10-02', entry: { fullName: 'אבי מזרחי', phone: '050-1234567', idNumber: '123456789', reason: 'הרצאה' } });
    // nothing is filed by reading
    expect(records(cadet.dani)).toEqual([]);
  });

  it('files each item through its own screen, and the ladder counts on', async () => {
    const first = await analyze(c.cmd, 'דני כהן איחר למסדר');
    const r1 = await apply(c.cmd, first.items);
    expect(r1).toEqual([expect.objectContaining({ ok: true, link: `/cadets/${cadet.dani}` })]);
    expect(records(cadet.dani)).toEqual([expect.objectContaining({ kind: 'discipline', offense: 'זמנים · איחור למסדר', title: 'איחור למסדר', occurred_on: '2026-10-01' })]);
    // the second time: the ladder's second step
    const again = await analyze(c.cmd, 'דני כהן איחר שוב למסדר');
    expect(again.items[0].ladder).toMatchObject({ occurrence: 2, step: 'שיחת אזהרה עם מפקד הצוות' });
  });

  it('files every kind: procedure, entry, exemption, a cadet sick, note, absence, task, event, weekly, debrief, announcement', async () => {
    const text = [
      'נועה ברק - כומתה ושרוך לא תקינים',
      'אישור כניסה לאבי מזרחי מחר, 050-1234567, ת"ז 123456789, לצורך הרצאה',
      'פטור מריצות ליוסי לוי עד יום ראשון בגלל נקע',
      'דני כהן בגימלים היום ומחר',
      'נועה ברק הצטיינה בניווט',
      'מפק"צ 2 בחופשה מ-4.10 עד 6.10',
      'משימה למפק"צ 3 להכין מצגת לתדריך עד יום ראשון',
      'פגישת סגל מחר 10-11 בחדר הישיבות',
      'לשבועי: לדבר על העומס בשבוע השטח',
      'לתחקיר השבוע לשימור: התדריך לפני הניווט',
      'הודעה לכל הסגל: מחר מסדר ב-7:00',
    ].join('\n');
    const a = await analyze(c.cmd, text);
    expect(a.items.map((i) => i.kind)).toEqual(['procedure', 'entry', 'exemption', 'exemption', 'note', 'absence', 'task', 'event', 'weekly', 'weekNote', 'announcement']);
    expect(a.items.every((i) => !i.blocked)).toBe(true);
    const results = await apply(c.cmd, a.items);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(records(cadet.noa).map((r) => [r.kind, r.title])).toEqual([
      ['discipline', 'אי עמידה בנהלים: דיגום - כומתה, שרוך'],
      ['note', 'הצטיינה בניווט'],
    ]);
    expect(db().get<{ full_name: string; status: string }>('SELECT full_name, status FROM entry_requests')).toEqual({ full_name: 'אבי מזרחי', status: 'pending' });
    // a cadet sick is an exemption from everything to the last day - the roll call is no more
    expect(db().all<{ subject: string; until: string }>('SELECT subject, until FROM exemptions ORDER BY id')).toEqual([
      { subject: 'ריצות', until: '2026-10-04' },
      { subject: 'גימלים', until: '2026-10-02' },
    ]);
    expect(db().get<{ user_id: number; start_date: string; end_date: string; reason: string }>('SELECT user_id, start_date, end_date, reason FROM absences')).toEqual({ user_id: c.ids.s2, start_date: '2026-10-04', end_date: '2026-10-06', reason: 'leave' });
    expect(db().get<{ title: string; owner_id: number }>('SELECT title, owner_id FROM tasks ORDER BY id DESC LIMIT 1')).toEqual({ title: 'הכנת מצגת לתדריך', owner_id: c.ids.s3 });
    expect(db().get<{ title: string; date: string; start_time: string; end_time: string; location: string }>("SELECT title, date, start_time, end_time, location FROM events WHERE title LIKE 'פגישת%'")).toEqual({
      title: 'פגישת סגל',
      date: '2026-10-02',
      start_time: '10:00',
      end_time: '11:00',
      location: 'חדר הישיבות',
    });
    expect(db().get<{ kind: string; title: string }>('SELECT kind, title FROM weekly_items')).toEqual({ kind: 'topic', title: 'לדבר על העומס בשבוע השטח' });
    expect(db().get<{ part: string; body: string }>('SELECT part, body FROM debrief_contributions')).toEqual({ part: 'sustain', body: 'התדריך לפני הניווט' });
    expect(db().get<{ title: string }>('SELECT title FROM announcements')).toEqual({ title: 'מחר מסדר ב-7:00' });
  });

  it("says what a writer may not file, and files the rest; what is missing is said, not guessed", async () => {
    // a staff member who is no team commander, where the commander keeps cadets' details and announcements to
    // themselves: no exemptions, no announcements - and no one else's absence
    await staffMay(c, { cadets: false, cadetFiles: false, announcements: false });
    const a = await analyze(c.s2, 'פטור מריצות לדני כהן\nהודעה לכל הסגל: נוהל חדש\nמפק"צ 3 בחופשה מחר\nיוסי לוי איחר למסדר');
    expect(a.items.map((i) => [i.kind, !!i.blocked])).toEqual([
      ['exemption', true],
      ['announcement', true],
      ['absence', true],
      ['discipline', false],
    ]);
    const results = await apply(c.s2, a.items);
    expect(results.map((r) => r.ok)).toEqual([false, false, false, true]);
    expect(results[0].message).toContain('מפקד הצוות');
    expect(records(cadet.yossi)).toHaveLength(1);
    // an entry without the visitor's details: not filed, and it says what is missing
    const e = await analyze(c.cmd, 'אישור כניסה לאבי מזרחי מחר');
    const [r] = await apply(c.cmd, e.items);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/^חסר: .*טלפון/);
  });
});

describe("Claude's reading", () => {
  it('masks the numbers that identify people, sends the course lists, and checks what comes back', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const reply = {
      items: [
        aiItem({ kind: 'discipline', source: 'דני כהן איחר למסדר', why: 'איחור למסדר', cadet: `c${cadet.dani}`, date: '2026-10-01', title: 'איחור למסדר', details: 'איחר למסדר הבוקר', offense: 'זמנים · איחור למסדר' }),
        aiItem({
          kind: 'entry',
          source: 'אבי מזרחי יגיע מחר ⟦1⟧ ת"ז ⟦2⟧',
          why: 'מבקר שמגיע לבסיס',
          date: '2026-10-02',
          entry: { fullName: 'אבי מזרחי', phone: '⟦1⟧', visitorKind: 'civilian', rank: '', clearance: '', idNumber: '⟦2⟧', escort: false, byCar: false, carNumber: '', carKind: '', reason: 'הרצאה' },
        }),
        // an id not in the lists, and a ladder key that is not there: dropped, not trusted
        aiItem({ kind: 'note', source: 'מישהו', cadet: 'c999', offense: 'לא קיים' }),
      ],
    };
    answer(() => claudeStream(JSON.stringify(reply)));
    const a = await analyze(c.cmd, 'דני כהן איחר למסדר. אבי מזרחי יגיע מחר 050-1234567 ת"ז 123456789 להרצאה');
    expect(a.source).toBe('ai');
    expect(a.items[0]).toMatchObject({ kind: 'discipline', fields: { cadetId: cadet.dani, offense: 'זמנים · איחור למסדר' }, ladder: { occurrence: 1 } });
    expect(a.items[1].fields.entry).toMatchObject({ phone: '050-1234567', idNumber: '123456789' });
    expect(a.items[2].fields).toMatchObject({ cadetId: null, offense: '' });
    const req = sent.find((s) => s.url.includes('/v1/messages'))!.body as { system: { text: string }[]; messages: { content: string }[] };
    const all = JSON.stringify(req);
    expect(all).not.toContain('1234567');
    expect(all).not.toContain('123456789');
    expect(req.messages[0].content).toContain('⟦1⟧');
    expect(req.system[1].text).toContain(`c${cadet.dani}: דני כהן`);
    expect(req.system[1].text).toContain('זמנים · איחור למסדר');
  });

  it('when Claude does not answer, the built-in reading does', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    answer(() => json({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500));
    const a = await analyze(c.cmd, 'דני כהן איחר למסדר');
    expect(a.source).toBe('local');
    expect(a.aiAvailable).toBe(true);
    expect(a.items[0]).toMatchObject({ kind: 'discipline', fields: { cadetId: cadet.dani } });
  });
});

describe('the numbers that stay here', () => {
  it('masks phones, ID numbers and car plates, not hours or dates', () => {
    const { masked, values } = maskNumbers('מחר ב-10:00, 3.11, טלפון 050-1234567, ת"ז 123456789, רכב 12-345-67, 4 צוערים');
    expect(masked).toBe('מחר ב-10:00, 3.11, טלפון ⟦1⟧, ת"ז ⟦2⟧, רכב ⟦3⟧, 4 צוערים');
    expect(values).toEqual(['050-1234567', '123456789', '12-345-67']);
  });
});

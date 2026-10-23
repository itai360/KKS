// The axis and the trait (אופן המימוש) recommended for a point of feedback from the words written under it
// (traitAi.ts, shared/traitSuggest.ts): the built-in matcher reads Hebrew as it is written, Claude is asked
// when the server has its key - its answer checked against the catalog - and the built-in one answers when
// Claude does not. Only whoever may give the feedback may ask. Made-up names and words; no real keys or calls.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { traitPlace } from '../../shared/evaluationTraits';
import { axisPlace, axisTraits, pointProblem } from '../../shared/experienceFeedback';
import { suggestTraitsLocal, TRAIT_HINTS } from '../../shared/traitSuggest';
import { setTalkAiFetch } from '../src/talkAi';
import { setup, type Ctx } from './helpers';

let c: Ctx;
const KEYS = ['ANTHROPIC_API_KEY', 'KKS_AI_MODEL'];
const saved: Record<string, string | undefined> = {};
let sent: { url: string; body: unknown }[] = [];

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const MODELS = { data: ['x-haiku-3', 'x-opus-2'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: 'x-haiku-3', last_id: 'x-opus-2' };

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

/** an experience of a cadet in team 1, its mentor the second staff member */
async function experience(): Promise<number> {
  const teams = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body;
  const cadet = (await c.cmd.post('/api/cadets', { firstName: 'יואב', lastName: 'שחר', teamId: teams[0].id })).body.cadet.id;
  return (await c.s1.post('/api/experiences', { cadetId: cadet, role: 'מ"מ בתרגיל', startDate: '2026-09-28', endDate: '2026-09-30', mentorId: c.ids.s2 })).body.id;
}

const NOTE = 'לא חילק תפקידים לסגנים ועשה הכול לבד, מה שגרם לעומס';

beforeEach(async () => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sent = [];
  setTalkAiFetch(null);
  c = await setup();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setTalkAiFetch(null);
});

describe('a point of feedback: its axis, then how it shows', () => {
  it("offers under each axis only its own traits, and takes only the catalog's combinations", () => {
    expect(axisPlace('המקצוע הצבאי - להוביל')).toEqual({ axis: 'military', sub: 'military.lead' });
    expect(axisPlace('חוסן')).toEqual({ axis: 'resilience', sub: null });
    expect(axisPlace('פיקוד והובלה')).toBeNull();
    expect(axisTraits('המקצוע הצבאי - להוביל').map((t) => t.name)).toContain('האצלת סמכויות');
    expect(axisTraits('חוסן')).toHaveLength(24);
    expect(axisTraits('')).toEqual([]);
    expect(pointProblem({ axis: 'המקצוע הצבאי - להוביל', title: 'האצלת סמכויות' })).toBeNull();
    expect(pointProblem({ axis: 'המקצוע הצבאי - להוביל', title: 'שם אחר', trait: 'military.lead.7' })).toBeNull();
    expect(pointProblem({ axis: 'המקצוע הצבאי - לבצע', title: 'האצלת סמכויות' })).toBe('"האצלת סמכויות" אינו אופן מימוש של הציר המקצוע הצבאי - לבצע');
    expect(pointProblem({ axis: 'המקצוע הצבאי - להוביל', title: 'ניהול זמנים', trait: 'military.execute.7' })).not.toBeNull();
    // nothing to say of a point not yet filled in - that is what is missing, not wrong
    expect(pointProblem({ axis: '', title: '' })).toBeNull();
  });
});

describe('the built-in recommendation', () => {
  it('knows only the catalog\'s traits', () => {
    for (const id of Object.keys(TRAIT_HINTS)) expect(traitPlace(id), id).toBeDefined();
  });

  it('reads the words as Hebrew writes them - with the letters joined in front and the endings - best first', () => {
    const first = (text: string) => suggestTraitsLocal(text)[0];
    expect(first(NOTE)).toMatchObject({ trait: 'military.lead.7', axis: 'המקצוע הצבאי - להוביל', title: 'האצלת סמכויות' });
    expect(first(NOTE).reason).toContain('"חילק"');
    expect(first('איחר בהגשת התוכנית ולא עמד בזמנים שנקבעו').trait).toBe('military.execute.7');
    expect(first('שמר על קור רוח גם כשהתרגיל השתנה ברגע האחרון').trait).toBe('resilience.2');
    expect(first('נערך מראש לכל תרחיש והגיע מוכן עם כל הפרטים').trait).toBe('military.prepare.5');
    expect(first('מדבר מהר מדי ולא וידא שכולם הבינו').trait).toBe('military.lead.3');
    expect(first('קיבל את הביקורת בפתיחות ויישם אותה כבר באותו יום').trait).toBe('resilience.5');
    expect(suggestTraitsLocal(NOTE).length).toBeLessThanOrEqual(3);
  });

  it('recommends nothing when nothing in the words fits', () => {
    expect(suggestTraitsLocal('אבג דהו זחט')).toEqual([]);
    expect(suggestTraitsLocal('')).toEqual([]);
  });
});

describe('asking for a recommendation', () => {
  it('is for whoever may give the feedback, on a few words at least - without Claude, the built-in one answers', async () => {
    const id = await experience();
    expect((await c.s3.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'improve' })).status).toBe(403);
    const short = await c.s2.post(`/api/experiences/${id}/feedback/suggest`, { text: 'לא טוב', kind: 'improve' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('כתבו בפירוט כמה מילים על מה שראיתם, ואז בקשו המלצה');
    expect((await c.s2.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'other' })).status).toBe(400);
    const res = await c.s2.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'improve' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('local');
    expect(res.body.suggestions[0]).toMatchObject({ trait: 'military.lead.7', axis: 'המקצוע הצבאי - להוביל', title: 'האצלת סמכויות' });
    // the team's commander and the course commander may ask too
    expect((await c.s1.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'keep' })).status).toBe(200);
    expect((await c.cmd.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'keep' })).status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("asks Claude when the server has its key: the catalog, the kind of point and the words go out; the answer is checked against the catalog", async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const id = await experience();
    answer(() =>
      claudeStream(
        JSON.stringify({
          suggestions: [
            { trait: 'military.lead.7', reason: 'עשה הכול לבד במקום לחלק לסגנים' },
            { trait: 'resilience.17', reason: 'העומס שנוצר' },
            { trait: 'military.lead.7', reason: 'פעמיים' },
          ],
        }),
      ),
    );
    const res = await c.s2.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'improve' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      source: 'ai',
      suggestions: [
        { trait: 'military.lead.7', axis: 'המקצוע הצבאי - להוביל', title: 'האצלת סמכויות', reason: 'עשה הכול לבד במקום לחלק לסגנים' },
        { trait: 'resilience.17', axis: 'חוסן', title: 'תפקוד בתנאי לחץ', reason: 'העומס שנוצר' },
      ],
    });
    const req = sent.find((s) => s.url.includes('/v1/messages'))!.body as {
      model: string;
      system: { text: string; cache_control?: unknown }[];
      messages: { content: string }[];
      output_config: { effort: string; format: { type: string } };
    };
    expect(req.model).toBe('x-opus-2');
    expect(req.output_config.effort).toBe('low');
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.system[0].text).toContain('military.lead.7: המקצוע הצבאי › להוביל › האצלת סמכויות');
    expect(req.system[0].text).toContain('resilience.2: חוסן › קור רוח');
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.messages[0].content).toContain('נקודה לשיפור');
    expect(req.messages[0].content).toContain(NOTE);
  });

  it('falls back on the built-in one when Claude declines or does not answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const id = await experience();
    answer(() => claudeStream('', 'refusal'));
    const declined = await c.s2.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'improve' });
    expect(declined.body.source).toBe('local');
    expect(declined.body.suggestions[0].trait).toBe('military.lead.7');
    answer(() => json({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529));
    const busy = await c.s2.post(`/api/experiences/${id}/feedback/suggest`, { text: NOTE, kind: 'improve' });
    expect(busy.body).toMatchObject({ source: 'local', suggestions: [expect.objectContaining({ trait: 'military.lead.7' })] });
  });
});

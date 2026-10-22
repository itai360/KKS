// A personal talk from its recording (talkAi.ts): which services are on, who may use them, the
// requests that go out - to the speech-to-text service and to Claude, both answered here - and what
// the commander gets back. Made-up names and texts; no real keys, no real calls.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTalkAiFetch } from '../src/talkAi';
import { setup, type Ctx } from './helpers';

let c: Ctx;
const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'KKS_AI_MODEL', 'KKS_TRANSCRIBE_MODEL'];
const saved: Record<string, string | undefined> = {};

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}
let sent: Sent[] = [];

/** answers the outside services: each handler gets the request and returns a response (or undefined: 404) */
function answer(handle: (s: Sent) => Response | undefined) {
  setTalkAiFetch(async (input, init) => {
    const req = new Request(input as string | URL | Request, init);
    const type = req.headers.get('content-type') ?? '';
    const body = type.includes('multipart/form-data') ? await req.formData() : type.includes('json') ? await req.json() : await req.text();
    const s = { url: req.url, method: req.method, headers: req.headers, body };
    sent.push(s);
    return handle(s) ?? new Response('{}', { status: 404 });
  });
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** Claude's streamed answer: one text block (the form as JSON), then how it stopped */
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

/** the newest models first, as the models list gives them */
const MODELS = { data: ['x-haiku-3', 'x-opus-2', 'x-opus-1'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2026-01-01T00:00:00Z' })), has_more: false, first_id: 'x-haiku-3', last_id: 'x-opus-1' };

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(2000, 1)]);

async function cadetOfTeam1() {
  const teams = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body;
  return (await c.cmd.post('/api/cadets', { firstName: 'נועה', lastName: 'ברק', teamId: teams[0].id })).body.cadet.id as number;
}

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

describe('a talk from its recording', () => {
  it('is off until the server has its keys, and says so', async () => {
    const cadet = await cadetOfTeam1();
    expect((await c.s1.get('/api/talks/ai')).body).toEqual({ transcribe: false, summarize: false });
    const part = await c.s1.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV);
    expect(part.status).toBe(503);
    expect(part.body.error).toBe('תמלול הקלטות עוד לא הופעל באתר');
    const sum = await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחה יזומה', transcript: 'שלום' });
    expect(sum.status).toBe(503);
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect((await c.s1.get('/api/talks/ai')).body).toEqual({ transcribe: true, summarize: true });
    expect(sent).toEqual([]);
  });

  it("writes out a part of the recording - only for the cadet's team commander or the course commander", async () => {
    const cadet = await cadetOfTeam1();
    process.env.OPENAI_API_KEY = 'test-openai';
    answer((s) => (s.url === 'https://api.openai.com/v1/audio/transcriptions' ? json({ text: '  שלום נועה, איך עבר השבוע?  ' }) : undefined));
    // another team's commander: refused before anything goes out
    expect((await c.s2.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV)).status).toBe(403);
    expect(sent).toEqual([]);
    for (const who of [c.s1, c.cmd]) {
      const res = await who.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ text: 'שלום נועה, איך עבר השבוע?' });
    }
    const req = sent[0];
    expect(req.method).toBe('POST');
    expect(req.headers.get('authorization')).toBe('Bearer test-openai');
    const form = req.body as FormData;
    expect(form.get('language')).toBe('he');
    expect(form.get('response_format')).toBe('json');
    expect(String(form.get('model'))).not.toBe('');
    const file = form.get('file') as File;
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(WAV.length);
    // the model of the transcription can be set
    process.env.KKS_TRANSCRIBE_MODEL = 'stt-test-model';
    await c.s1.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV);
    expect((sent.at(-1)!.body as FormData).get('model')).toBe('stt-test-model');
  });

  it('uses the other transcription service when its key is set, and tells what went wrong in Hebrew', async () => {
    const cadet = await cadetOfTeam1();
    process.env.OPENAI_API_KEY = 'test-openai';
    process.env.ELEVENLABS_API_KEY = 'test-eleven';
    let status = 200;
    answer((s) => (s.url === 'https://api.elevenlabs.io/v1/speech-to-text' ? (status === 200 ? json({ text: 'בוקר טוב' }) : json({ detail: 'no' }, status)) : undefined));
    const ok = await c.s1.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV);
    expect(ok.body).toEqual({ text: 'בוקר טוב' });
    expect(sent[0].headers.get('xi-api-key')).toBe('test-eleven');
    expect((sent[0].body as FormData).get('language_code')).toBe('he');
    status = 401;
    const bad = await c.s1.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV);
    expect(bad.status).toBe(502);
    expect(bad.body.error).toContain('בדקו את מפתח התמלול');
    status = 429;
    expect((await c.s1.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(WAV)).status).toBe(429);
    // an empty part never goes out
    const before = sent.length;
    expect((await c.s1.post(`/api/talks/ai/transcribe?cadet=${cadet}`).set('content-type', 'audio/wav').send(Buffer.alloc(0))).status).toBe(400);
    expect(sent.length).toBe(before);
  });

  it("sums the transcript up in the talk type's fields - the newest model of the main line, unless one is set", async () => {
    const cadet = await cadetOfTeam1();
    process.env.ANTHROPIC_API_KEY = 'test-claude';
    const form = { reason: 'ירידה בתפקוד בשבוע האחרון', raised: 'עומס בבית, אח שחלה', agreed: 'יציאה מוקדמת ביום חמישי', remember: 'אח בבית חולים', focus: '', next: 'לבדוק מצב בעוד שבוע' };
    answer((s) => {
      if (s.url.startsWith('https://api.anthropic.com/v1/models')) return json(MODELS);
      if (s.url === 'https://api.anthropic.com/v1/messages') return claudeStream(JSON.stringify(form));
      return undefined;
    });
    // only the cadet's commanders
    expect((await c.s2.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחה יזומה', transcript: 'שלום' })).status).toBe(403);
    expect((await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'סתם שיחה', transcript: 'שלום' })).status).toBe(400);
    const res = await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחה יזומה', transcript: 'מפקד: מה שלומך? צוערת: קשה לי השבוע, אחי בבית חולים.' });
    expect(res.status).toBe(200);
    // the empty field stays out; nothing beyond the form's fields
    expect(res.body).toEqual({ answers: { reason: form.reason, raised: form.raised, agreed: form.agreed, remember: form.remember, next: form.next } });

    const call = sent.find((s) => s.url.endsWith('/v1/messages'))!;
    expect(call.headers.get('x-api-key')).toBe('test-claude');
    const body = call.body as { model: string; stream: boolean; system: string; output_config: { effort: string; format: { type: string; schema: { properties: Record<string, unknown> } } }; messages: { content: string }[] };
    expect(body.model).toBe('x-opus-2');
    expect(body.stream).toBe(true);
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(Object.keys(body.output_config.format.schema.properties).sort()).toEqual(['agreed', 'focus', 'next', 'raised', 'reason', 'remember']);
    expect(body.system).toContain('Only what was said in the talk');
    expect(body.messages[0].content).toContain('סוג השיחה: שיחה יזומה');
    expect(body.messages[0].content).toContain('שם הצוער/ת: נועה');
    expect(body.messages[0].content).toContain('צוערת: קשה לי השבוע');
    expect(body.messages[0].content).not.toContain('ברק'); // the first name is enough

    // the model is looked up once
    await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחה יזומה', transcript: 'שוב' });
    expect(sent.filter((s) => s.url.includes('/v1/models')).length).toBe(1);
    // a model set in the environment wins, with no lookup
    setTalkAiFetch(null);
    sent = [];
    process.env.KKS_AI_MODEL = 'x-set-model';
    answer((s) => (s.url.endsWith('/v1/messages') ? claudeStream(JSON.stringify(form)) : undefined));
    await c.cmd.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחה יזומה', transcript: 'שלום' });
    expect(sent.map((s) => s.url)).toEqual(['https://api.anthropic.com/v1/messages']);
    expect((sent[0].body as { model: string }).model).toBe('x-set-model');
  });

  it('tells the commander when a talk could not be summed up', async () => {
    const cadet = await cadetOfTeam1();
    process.env.ANTHROPIC_API_KEY = 'test-claude';
    process.env.KKS_AI_MODEL = 'x-set-model';
    let reply = () => claudeStream('', 'refusal');
    answer((s) => (s.url.endsWith('/v1/messages') ? reply() : undefined));
    const refused = await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחת סיום', transcript: 'שלום' });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toContain('מלאו את הטופס ידנית');
    reply = () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    const badKey = await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחת סיום', transcript: 'שלום' });
    expect(badKey.status).toBe(502);
    expect(badKey.body.error).toContain('בדקו את מפתח Claude');
    expect((await c.s1.post('/api/talks/ai/summarize', { cadetId: cadet, type: 'שיחת סיום', transcript: '   ' })).status).toBe(400);
  });
});

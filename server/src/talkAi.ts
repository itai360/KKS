// A personal talk from its recording. The browser cuts the recording into short parts; each part is
// written out by a speech-to-text service, and Claude sums the transcript up in the fields of the
// talk's form - a draft the commander reads, corrects and saves. Nothing of it is kept here: not the
// recording, not the transcript; only what the commander saves in the talk.
//
// Set in the server's environment (none of it is in the code):
// - ANTHROPIC_API_KEY: the summary. KKS_AI_MODEL picks the model; without it, the newest model of
//   the line made for most work that the key can use, looked up once.
// - ELEVENLABS_API_KEY or OPENAI_API_KEY: the transcription. KKS_TRANSCRIBE_MODEL picks its model.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { cleanAnswers, numberedSections, talkFields, type TalkAnswers, type TalkType } from '../../shared/talks';
import { badRequest, HttpError } from './core';

const env = (k: string) => (process.env[k] ?? '').trim();

/** the most a recording's part may weigh: two minutes of the browser's WAV is under 4 MB */
export const MAX_PART_BYTES = 4_500_000;
/** the longest transcript summed up at once: well over an hour of talk */
export const MAX_TRANSCRIPT_CHARS = 200_000;

export interface TalkAiStatus {
  /** a recording can be written out */
  transcribe: boolean;
  /** a transcript can be summed up in the form */
  summarize: boolean;
}

type SttProvider = 'elevenlabs' | 'openai';
const sttProvider = (): SttProvider | null => (env('ELEVENLABS_API_KEY') ? 'elevenlabs' : env('OPENAI_API_KEY') ? 'openai' : null);

export const talkAiStatus = (): TalkAiStatus => ({ transcribe: !!sttProvider(), summarize: !!env('ANTHROPIC_API_KEY') });

// the outside services are reached through this, so tests can answer for them
let aiFetch: typeof fetch = (input, init) => fetch(input, init);
let client: Anthropic | null = null;
let chosenModel: string | null = null;

/** Tests: answer the outside services' requests (null: the network again). */
export function setTalkAiFetch(f: typeof fetch | null): void {
  aiFetch = f ?? ((input, init) => fetch(input, init));
  client = null;
  chosenModel = null;
}

// ---------------- the recording, written out ----------------

/** a few words of what the talk is about, so course terms come out right */
const STT_CONTEXT = 'שיחה אישית בין מפקד צוות לצוער בקורס קצינים: צוער, צוערת, מפק"צ, מ"פ, צוות, פלוגה, קורס, התנסות, שבוע, תרגיל, מסע.';

function sttFailure(status: number): HttpError {
  if (status === 401 || status === 403) return new HttpError(502, 'שירות התמלול דחה את המפתח שלנו - בדקו את מפתח התמלול בהגדרות השרת');
  if (status === 429) return new HttpError(429, 'שירות התמלול עמוס או שנגמרה המכסה. נסו שוב בעוד כמה דקות');
  if (status === 413) return new HttpError(413, 'חלק ההקלטה גדול מדי לשירות התמלול');
  return new HttpError(502, 'שירות התמלול לא ענה כמו שצריך. נסו שוב');
}

/** One part of a recording (WAV from the browser), written out in Hebrew. */
export async function transcribePart(audio: Buffer, mime: string): Promise<string> {
  const provider = sttProvider();
  if (!provider) throw new HttpError(503, 'תמלול הקלטות עוד לא הופעל באתר');
  if (!Buffer.isBuffer(audio) || !audio.length) throw badRequest('חלק ההקלטה ריק');
  if (audio.length > MAX_PART_BYTES) throw new HttpError(413, 'חלק ההקלטה גדול מדי');
  const type = /^audio\/[\w.+-]+$/.test(mime) ? mime : 'audio/wav';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type }), type === 'audio/wav' ? 'part.wav' : 'part');
  const model = env('KKS_TRANSCRIBE_MODEL');
  let res: Response;
  try {
    if (provider === 'elevenlabs') {
      form.append('model_id', model || 'scribe_v1');
      form.append('language_code', 'he');
      form.append('tag_audio_events', 'false');
      res = await aiFetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: form, signal: AbortSignal.timeout(120_000) });
    } else {
      form.append('model', model || 'gpt-4o-transcribe');
      form.append('language', 'he');
      form.append('response_format', 'json');
      form.append('prompt', STT_CONTEXT);
      res = await aiFetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}` }, body: form, signal: AbortSignal.timeout(120_000) });
    }
  } catch (e) {
    console.error('[talk-ai] transcription unreachable', provider, (e as Error)?.message);
    throw new HttpError(502, 'שירות התמלול לא ענה. נסו שוב');
  }
  if (!res.ok) {
    console.error('[talk-ai] transcription failed', provider, res.status, (await res.text().catch(() => '')).slice(0, 300));
    throw sttFailure(res.status);
  }
  const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
  return typeof data?.text === 'string' ? data.text.trim() : '';
}

// ---------------- the transcript, summed up in the form ----------------

// one retry at most, and each try within two minutes: the whole request stays inside the server's five
const claude = () => (client ??= new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), fetch: aiFetch, maxRetries: 1, timeout: 120_000 }));

/** The model for the summary: as configured, or the newest of the line made for most work (newest first in the list). */
async function summaryModel(): Promise<string> {
  const set = env('KKS_AI_MODEL');
  if (set) return set;
  if (chosenModel) return chosenModel;
  let newest = '';
  for await (const m of claude().models.list()) {
    newest ||= m.id;
    if (/opus/i.test(m.id)) return (chosenModel = m.id);
  }
  if (!newest) throw new HttpError(502, 'לא נמצא מודל זמין לסיכום');
  return (chosenModel = newest);
}

const SYSTEM = `You draft the personal-talk form of an officers' course from the transcript of a recorded talk between a staff commander and a cadet. The commander reads the draft, corrects it and saves it in the cadet's file.

How to fill each field:
- Write in Hebrew, as the commander's note about the cadet (third person about the cadet).
- Only what was said in the talk. Do not add assessments, advice, diagnoses or facts that were not said. When the talk did not touch a field, leave it as an empty string.
- Short and concrete: one to three sentences, or a few short items on separate lines. The fields of "רישום קצר מיד בסיום" take a few words each.
- The transcript was made by a machine: names, terms and words may be misheard, and it does not mark who is speaking. Tell the speakers apart by what they say - the commander mostly asks, the cadet mostly answers - and write what was meant, not the transcription's mistakes. Leave out a word you cannot make out rather than guess it.
- Call the cadet by first name, or "הצוער" / "הצוערת" as the talk shows; when it is unclear, prefer wording that needs no gender.
- Personal details stay as they were said: the form is the course's own record.`;

function formOutline(type: TalkType): string {
  return numberedSections(type)
    .map(({ section, number }) => {
      const head = `${number ? `${number}. ` : ''}${section.title}`;
      return [head, ...section.fields.map((f) => `- ${f.id}: ${f.label}${f.hint ? ` (${f.hint})` : ''}${f.points ? ' - נקודות, כל נקודה בשורה משלה' : ''}`)].join('\n');
    })
    .join('\n\n');
}

/** what the commander is told when the summary could not be made */
function summaryFailure(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof Anthropic.NotFoundError) chosenModel = null; // the model went away: look again next time
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, 'שירות הסיכום דחה את המפתח שלנו - בדקו את מפתח Claude בהגדרות השרת');
  }
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'שירות הסיכום עמוס כרגע. נסו שוב בעוד כמה דקות');
  console.error('[talk-ai] summary failed', e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error)?.message);
  return new HttpError(502, 'שירות הסיכום לא ענה כמו שצריך. נסו שוב');
}

/** The talk's form filled from its transcript: only the type's fields, empty ones left out. */
export async function summarizeTalk(type: TalkType, transcript: string, cadetFirstName: string): Promise<TalkAnswers> {
  if (!env('ANTHROPIC_API_KEY')) throw new HttpError(503, 'סיכום שיחות עוד לא הופעל באתר');
  const text = transcript.trim();
  if (!text) throw badRequest('אין תמליל לסכם');
  if (text.length > MAX_TRANSCRIPT_CHARS) throw badRequest('התמליל ארוך מדי לסיכום אחד');
  // every field of the form, described as the form names it
  const titles = new Map(numberedSections(type).flatMap(({ section }) => section.fields.map((f) => [f.id, section.title] as const)));
  const schema = z.object(Object.fromEntries(talkFields(type).map((f) => [f.id, z.string().describe(`${titles.get(f.id)} - ${f.label}${f.hint ? `: ${f.hint}` : ''}`)])));
  const prompt = `סוג השיחה: ${type}\nשם הצוער/ת: ${cadetFirstName}\n\nסעיפי הטופס (המזהה של כל שדה ומה נכתב בו):\n${formOutline(type)}\n\nתמליל השיחה:\n<transcript>\n${text}\n</transcript>`;
  const refused = () => new HttpError(422, 'את השיחה הזו לא ניתן היה לסכם אוטומטית - מלאו את הטופס ידנית');
  const model = await summaryModel().catch((e: unknown) => {
    throw summaryFailure(e);
  });
  const stream = claude().messages.stream({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content: prompt }],
  });
  // how it stopped, seen while it streams: a declined talk leaves no form for the SDK to read, and it fails
  const seen: { stop: string | null } = { stop: null };
  stream.on('streamEvent', (_event, snapshot) => {
    seen.stop = snapshot.stop_reason;
  });
  const message = await stream.finalMessage().catch((e: unknown) => {
    throw seen.stop === 'refusal' ? refused() : summaryFailure(e);
  });
  if (message.stop_reason === 'refusal') throw refused();
  if (!message.parsed_output) {
    console.error('[talk-ai] summary without a form', message.stop_reason);
    throw new HttpError(502, 'הסיכום לא חזר בצורה תקינה. נסו שוב');
  }
  return cleanAnswers(type, message.parsed_output);
}

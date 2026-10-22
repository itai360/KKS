// A talk summed up from its recording (server/src/talkAi.ts): the commander uploads the recording -
// the browser cuts it into short parts, each is written out on the server - and the transcript is
// summed up in the fields of this talk's form; or a transcript made elsewhere is pasted. What comes
// back fills only the fields still empty, for the commander to read and correct before saving. The
// recording itself is not kept anywhere.

import { useEffect, useRef, useState } from 'react';
import type { TalkAnswers, TalkType } from '@shared/talks';
import { api } from '../lib/api';
import { haptic } from '../lib/haptics';
import { prepareRecording, RecordingError, type PreparedRecording } from '../lib/recording';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { ErrorBox } from './ui';

interface Status {
  transcribe: boolean;
  summarize: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'writing'; done: number; total: number }
  | { kind: 'summing' }
  | { kind: 'done'; text: string }
  | { kind: 'failed'; message: string; resume: boolean };

/** parts written out at the same time */
const PARALLEL = 3;
/** a file this big is not a talk's recording a browser can open */
const MAX_FILE_MB = 300;

const minutes = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} שניות` : `${Math.round(s / 60)} דקות`);

export function TalkRecording({
  cadetId,
  type,
  transcript,
  onTranscript,
  onSummary,
}: {
  cadetId: number;
  type: TalkType;
  /** the transcript so far (kept in the talk's draft until it is saved) */
  transcript: string;
  onTranscript: (text: string) => void;
  /** fills the empty fields from the summary; says how many it filled and how many it left as written */
  onSummary: (answers: TalkAnswers) => { filled: number; kept: number };
}) {
  const { user } = useSession();
  const status = useApi<Status>('/api/talks/ai', []);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [showText, setShowText] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // the recording being written out: its parts, and the text of each part done so far
  const job = useRef<{ rec: PreparedRecording; texts: (string | null)[] } | null>(null);
  const stopped = useRef(false);
  useEffect(() => {
    return () => {
      stopped.current = true; // the window closed: no more parts go out
    };
  }, []);

  const canSum = !!status.data?.summarize;

  const summarize = async (text: string) => {
    setPhase({ kind: 'summing' });
    try {
      const { answers } = await api.post<{ answers: TalkAnswers }>('/api/talks/ai/summarize', { cadetId, type, transcript: text });
      const { filled, kept } = onSummary(answers);
      haptic('success');
      setPhase({
        kind: 'done',
        text: !filled
          ? 'הסיכום לא מצא בשיחה מה להוסיף לשדות הריקים.'
          : `מולאו ${filled === 1 ? 'שדה אחד' : `${filled} שדות`} מההקלטה${kept ? ` (${kept === 1 ? 'שדה אחד שכבר נכתב נשאר כמו שהוא' : `${kept} שדות שכבר נכתבו נשארו כמו שהם`})` : ''}. עברו על הנוסח ותקנו לפני השמירה.`,
      });
    } catch (e) {
      setPhase({ kind: 'failed', message: (e as Error).message, resume: false });
    }
  };

  /** writes out the parts not done yet, a few at a time, in order; then sums the talk up */
  const writeOut = async () => {
    const j = job.current;
    if (!j) return;
    stopped.current = false;
    const missing = j.texts.flatMap((t, i) => (t === null ? [i] : []));
    const done = () => j.texts.filter((t) => t !== null).length;
    const failure: { at: number; message: string } = { at: Infinity, message: '' };
    setPhase({ kind: 'writing', done: done(), total: j.rec.count });
    let next = 0;
    const worker = async () => {
      while (next < missing.length && failure.at === Infinity && !stopped.current) {
        const i = missing[next++];
        try {
          const { text } = await api.post<{ text: string }>(`/api/talks/ai/transcribe?cadet=${cadetId}`, j.rec.part(i));
          j.texts[i] = text;
          if (!stopped.current) setPhase({ kind: 'writing', done: done(), total: j.rec.count });
        } catch (e) {
          if (i < failure.at) Object.assign(failure, { at: i, message: (e as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (failure.at !== Infinity) return setPhase({ kind: 'failed', message: failure.message, resume: true });
    if (stopped.current) return setPhase({ kind: 'failed', message: 'התמלול נעצר. אפשר להמשיך מאיפה שנעצר.', resume: true });
    const text = j.texts.filter(Boolean).join('\n').trim();
    onTranscript(text);
    if (!text) return setPhase({ kind: 'failed', message: 'לא נמצא בהקלטה דיבור שאפשר לתמלל', resume: false });
    if (!canSum) return setPhase({ kind: 'done', text: 'התמליל מוכן. הסיכום האוטומטי עוד לא הופעל באתר - אפשר להעתיק ממנו לשדות.' });
    await summarize(text);
  };

  const pick = async (file: File) => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setPhase({ kind: 'failed', message: `הקובץ גדול מ-${MAX_FILE_MB}MB`, resume: false });
    setPasting(false);
    setPhase({ kind: 'reading' });
    try {
      const rec = await prepareRecording(file);
      job.current = { rec, texts: Array<string | null>(rec.count).fill(null) };
      await writeOut();
    } catch (e) {
      setPhase({ kind: 'failed', message: e instanceof RecordingError ? e.message : 'לא הצלחנו לקרוא את ההקלטה', resume: false });
    }
  };

  if (!status.data) return null;
  if (!status.data.transcribe && !canSum) {
    return user.role === 'commander' ? (
      <p className="tiny muted talk-rec-off">
        <Icon name="mic" size={13} /> סיכום שיחה מהקלטה עוד לא הופעל: כדי להפעיל, מגדירים בהגדרות השרת מפתח Claude ומפתח לשירות תמלול.
      </p>
    ) : null;
  }
  const busy = phase.kind === 'reading' || phase.kind === 'writing' || phase.kind === 'summing';
  const recSeconds = job.current?.rec.seconds;

  return (
    <div className={`talk-rec${busy ? ' is-busy' : ''}`}>
      <div className="talk-rec-head">
        <span className="talk-rec-icon" aria-hidden="true">
          <Icon name="mic" size={18} />
        </span>
        <div className="grow">
          <b>סיכום מהקלטה</b>
          <div className="tiny muted">
            {status.data.transcribe
              ? 'העלו את הקלטת השיחה - היא תתומלל ותסוכם לפי סעיפי השיחה, לבדיקה שלכם לפני השמירה. ההקלטה עצמה לא נשמרת.'
              : 'הדביקו תמליל של השיחה - הוא יסוכם לפי סעיפי השיחה, לבדיקה שלכם לפני השמירה.'}
          </div>
        </div>
      </div>

      {busy && (
        <div className="talk-rec-progress" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="grow small">
            {phase.kind === 'reading' && 'קורא את ההקלטה...'}
            {phase.kind === 'writing' && `מתמלל${recSeconds ? ` ${minutes(recSeconds)}` : ''}: ${phase.done} מתוך ${phase.total} חלקים`}
            {phase.kind === 'summing' && 'מסכם לפי סעיפי השיחה... זה לוקח עד דקה'}
          </span>
          {phase.kind === 'writing' && (
            <>
              <span className="mini-bar talk-rec-bar" aria-hidden="true">
                <i style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }} />
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => (stopped.current = true)}>
                עצירה
              </button>
            </>
          )}
        </div>
      )}
      {phase.kind === 'done' && (
        <div className="small talk-rec-done" role="status">
          <Icon name="check" size={15} /> {phase.text}
        </div>
      )}
      {phase.kind === 'failed' && (
        <div className="col gap-6">
          <ErrorBox error={phase.message} />
          {phase.resume && (
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void writeOut()}>
              <Icon name="repeat" /> המשך התמלול
            </button>
          )}
        </div>
      )}

      {!busy && (
        <div className="row wrap gap-6">
          {status.data.transcribe && (
            <button type="button" className={`btn btn-sm${transcript ? ' btn-ghost' : ' btn-primary'}`} onClick={() => fileInput.current?.click()}>
              <Icon name="upload" /> {transcript ? 'הקלטה אחרת' : 'העלאת הקלטה'}
            </button>
          )}
          {canSum && (
            <button type="button" className={`btn btn-sm btn-ghost${pasting ? ' on' : ''}`} aria-expanded={pasting} onClick={() => setPasting((v) => !v)}>
              <Icon name="file" /> הדבקת תמליל
            </button>
          )}
          {transcript && canSum && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void summarize(transcript)} title="לסכם שוב את התמליל - למשל אחרי שינוי סוג השיחה">
              <Icon name="repeat" /> סיכום מחדש
            </button>
          )}
          {transcript && (
            <button type="button" className="btn btn-sm btn-ghost" aria-expanded={showText} onClick={() => setShowText((v) => !v)}>
              {showText ? 'הסתרת התמליל' : 'הצגת התמליל'}
            </button>
          )}
        </div>
      )}
      {pasting && !busy && (
        <div className="col gap-6">
          <textarea
            className="textarea"
            rows={5}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="הדביקו כאן את תמליל השיחה (מתמלול בטלפון, בוואטסאפ או בכל כלי אחר)"
            aria-label="תמליל השיחה"
            data-transient
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            style={{ alignSelf: 'flex-start' }}
            disabled={!pasted.trim()}
            onClick={() => {
              const text = pasted.trim();
              onTranscript(text);
              setPasting(false);
              setPasted('');
              void summarize(text);
            }}
          >
            סיכום לפי הטופס
          </button>
        </div>
      )}
      {showText && transcript && <textarea className="textarea talk-rec-text" readOnly rows={8} value={transcript} aria-label="התמליל" data-transient />}
      <input
        ref={fileInput}
        type="file"
        accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.amr,.3gp,.webm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pick(f);
        }}
      />
    </div>
  );
}

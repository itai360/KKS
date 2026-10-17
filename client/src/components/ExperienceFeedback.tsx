// The feedback after an experience in the course's format (shared/experienceFeedback.ts): the form the
// mentor fills in - laid out as the paper one: the cadet, the experience and its dates on top, a general
// reference, two points to keep and two to improve, and the score on its legend - and the feedback as it
// shows once given.

import { useMemo, useState } from 'react';
import { fmtDateIL, shortDate } from '@shared/dates';
import {
  asFeedbackForm,
  emptyFeedback,
  FEEDBACK_AXES,
  feedbackMissing,
  POINT_LABELS,
  SCORE_BANDS,
  SCORE_MAX,
  scoreBand,
  type ExperienceFeedbackForm,
  type FeedbackPoint,
  type PointKind,
} from '@shared/experienceFeedback';
import { experienceName } from '@shared/experiences';
import { sortHe } from '@shared/sort';
import type { Experience } from '@shared/types';
import { api } from '../lib/api';
import { useDraft } from '../lib/draft';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, SuggestInput } from './ui';

const KINDS: PointKind[] = ['keep', 'improve'];
const KIND_TONE: Record<PointKind, string> = { keep: 't-green', improve: 't-orange' };
const KIND_ICON: Record<PointKind, string> = { keep: 'check', improve: 'arrowUp' };
const TITLE_HINT: Record<PointKind, string> = { keep: 'לדוגמה: החלטיות', improve: 'לדוגמה: שיתוף הסגנים בתכנון' };

/** the dates of an experience as one: "1.10-05.10.2026", or its single day */
export const experienceDates = (x: Pick<Experience, 'startDate' | 'endDate'>) => (x.startDate === x.endDate ? fmtDateIL(x.startDate) : `${shortDate(x.startDate)}-${fmtDateIL(x.endDate)}`);

/** a score typed: a whole number from 0 to 100, or nothing */
const parseScore = (s: string): number | null => (/^\d{1,3}$/.test(s) && Number(s) <= SCORE_MAX ? Number(s) : null);

interface Draft {
  form: ExperienceFeedbackForm;
  score: string;
}

function readDraft(stored: string): Draft {
  try {
    const d = JSON.parse(stored) as { form?: unknown; score?: unknown } | null;
    const form = asFeedbackForm(d?.form);
    if (form) return { form, score: typeof d?.score === 'string' ? d.score : '' };
  } catch {
    /* nothing kept */
  }
  return { form: emptyFeedback(), score: '' };
}

const anyTyped = (d: Draft) => !!(d.score || d.form.general.trim() || [...d.form.keep, ...d.form.improve].some((p) => p.title.trim() || p.axis.trim() || p.text.trim()));

/** the score's band, as a badge: "85 · טוב מאוד"; feedback given before the format, out of 5 */
export function ScoreBadge({ x }: { x: Pick<Experience, 'score' | 'feedbackForm'> }) {
  if (x.score === null) return null;
  if (!x.feedbackForm) return <span className="badge t-gray mono">ציון {x.score}/5</span>;
  const band = scoreBand(x.score);
  return (
    <span className={`badge t-${band.tone}`} title={`ציון ${x.score} מתוך 100 - ${band.label}`}>
      <span className="mono">{x.score}</span> · {band.label}
    </span>
  );
}

export function FeedbackDialog({ x, onClose }: { x: Experience; onClose: () => void }) {
  const toast = useToast();
  // what was typed is kept until it is saved, in this tab only - a long feedback is not lost to a closed window
  const [stored, setStored] = useDraft(`experience-feedback:${x.id}`);
  const [draft, setDraftState] = useState<Draft>(() => readDraft(stored));
  const used = useApi<string[]>('/api/experiences/feedback-axes', ['cadets']);
  const axes = useMemo(() => sortHe([...new Set([...FEEDBACK_AXES, ...(used.data ?? [])])]), [used.data]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (d: Draft) => {
    setDraftState(d);
    setStored(anyTyped(d) ? JSON.stringify(d) : '');
  };
  const setPoint = (kind: PointKind, i: number, patch: Partial<FeedbackPoint>) =>
    update({ ...draft, form: { ...draft.form, [kind]: draft.form[kind].map((p, j) => (j === i ? { ...p, ...patch } : p)) } });
  const score = parseScore(draft.score);
  const badScore = draft.score !== '' && score === null;
  const band = score === null ? null : scoreBand(score);
  const missing = feedbackMissing(draft.form, score);

  const save = async () => {
    if (missing.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/experiences/${x.id}/feedback`, { ...draft.form, score });
      setStored('');
      toast({ title: 'המשוב נשמר ונכנס לתיק הצוער', tone: 'green' });
      emitLocalChange('cadets', 'tasks');
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title="משוב לאחר התנסות"
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted fb-missing" aria-live="polite">
            {missing.length ? `חסר: ${missing.join(', ')}` : 'הכל מולא - אפשר לשמור.'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || missing.length > 0} onClick={() => void save()}>
            {busy ? 'שומר...' : 'שמירת המשוב'}
          </button>
        </>
      }
    >
      <div className="col gap-16 fb-form">
        <dl className="fb-head">
          <div>
            <dt>שם הצוער</dt>
            <dd>
              {x.cadetName}
              {x.teamName && <span className="muted"> · {x.teamName}</span>}
            </dd>
          </div>
          <div>
            <dt>נושא ההתנסות</dt>
            <dd>{experienceName(x.kind, x.role, x.span)}</dd>
          </div>
          <div>
            <dt>תאריך ההתנסות</dt>
            <dd className="mono">{experienceDates(x)}</dd>
          </div>
        </dl>
        {x.goals && (
          <div className="info-box" style={{ whiteSpace: 'pre-wrap' }}>
            <b>מטרות ההתנסות:</b> {x.goals}
          </div>
        )}

        <Field label="התייחסות כללית מילולית" required>
          <textarea
            className="textarea"
            rows={3}
            value={draft.form.general}
            maxLength={4000}
            onChange={(e) => update({ ...draft, form: { ...draft.form, general: e.target.value } })}
            placeholder="איך עברה ההתנסות, במשפטים ספורים"
            data-autofocus
          />
        </Field>

        {KINDS.map((kind) =>
          draft.form[kind].map((p, i) => {
            const name = `${POINT_LABELS[kind]} ${i + 1}`;
            return (
              <fieldset key={`${kind}-${i}`} className={`fb-point ${KIND_TONE[kind]}`}>
                <legend>
                  <Icon name={KIND_ICON[kind]} size={14} /> {name}
                </legend>
                <div className="fb-point-row">
                  <Field label="הנקודה" required className="grow">
                    <input className="input" value={p.title} maxLength={300} onChange={(e) => setPoint(kind, i, { title: e.target.value })} placeholder={i === 0 ? TITLE_HINT[kind] : undefined} aria-label={name} />
                  </Field>
                  <Field label="ציר" required className="fb-axis">
                    <SuggestInput value={p.axis} onChange={(v) => setPoint(kind, i, { axis: v })} options={axes} maxLength={60} placeholder="בחירה או הקלדה" aria-label={`הציר של ${name}`} />
                  </Field>
                </div>
                <Field label="פירוט">
                  <textarea className="textarea" rows={2} value={p.text} maxLength={2000} onChange={(e) => setPoint(kind, i, { text: e.target.value })} placeholder="מה ראית, ומתי" aria-label={`פירוט ${name}`} />
                </Field>
              </fieldset>
            );
          }),
        )}

        <div className="field fb-score" role="group" aria-labelledby="fb-score-l">
          <span id="fb-score-l">
            ציון להתנסות<span className="req"> *</span>
          </span>
          <div className="row gap-12 wrap fb-score-row">
            <input
              className="input mono fb-score-input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              value={draft.score}
              onChange={(e) => update({ ...draft, score: e.target.value.replace(/\D/g, '') })}
              placeholder="0-100"
              aria-label="ציון להתנסות, מ-0 עד 100"
              aria-invalid={badScore || undefined}
              aria-describedby="fb-band"
            />
            <span className="muted small">מתוך 100</span>
            <span id="fb-band" aria-live="polite">
              {band && <span className={`badge t-${band.tone} fb-band`}>{band.label}</span>}
              {badScore && <span className="small text-red">ציון בין 0 ל-100</span>}
            </span>
          </div>
          <span className="tiny muted fb-legend-title">מקרא הערכה להתנסות</span>
          <ol className="fb-legend" aria-label="מקרא הערכה להתנסות">
            {SCORE_BANDS.map((b) => (
              <li key={b.label} className={`t-${b.tone}${band === b ? ' on' : ''}`} aria-current={band === b || undefined}>
                <b>{b.label}</b>
                <span className="mono">{b.range}</span>
              </li>
            ))}
          </ol>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** a feedback given in the format: the general reference, then the points to keep and to improve with their axes */
export function FeedbackView({ form, by, compact }: { form: ExperienceFeedbackForm; by: string | null; compact?: boolean }) {
  return (
    <div className="update mt-8 fb-view">
      {form.general && <p className="small fb-general">{form.general}</p>}
      <ul className="fb-points">
        {KINDS.flatMap((kind) =>
          form[kind]
            .filter((p) => p.title)
            .map((p, i) => (
              <li key={`${kind}-${i}`} className={KIND_TONE[kind]}>
                <Icon name={KIND_ICON[kind]} size={14} />
                <div className="grow">
                  <span className="sr-only">{POINT_LABELS[kind]}: </span>
                  <b className="small">{p.title}</b>
                  {p.axis && <span className="tiny muted"> · ציר: {p.axis}</span>}
                  {!compact && p.text && <div className="tiny muted fb-point-text">{p.text}</div>}
                </div>
              </li>
            )),
        )}
      </ul>
      {by && <div className="tiny muted mt-8">משוב: {by}</div>}
    </div>
  );
}

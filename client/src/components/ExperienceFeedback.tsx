// The feedback after an experience in the course's format (shared/experienceFeedback.ts): the form the
// mentor fills in - laid out as the paper one: the cadet, the experience and its dates on top, a general
// reference, two points to keep and two to improve, and the score on its legend - and the feedback as it
// shows once given.

import { useState } from 'react';
import { fmtDateIL, shortDate } from '@shared/dates';
import {
  asFeedbackForm,
  axisAbout,
  emptyFeedback,
  FEEDBACK_AXES,
  FEEDBACK_AXIS_GROUPS,
  axisValue,
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
import { DOCX_TYPE, feedbackDocName, feedbackDocx } from '@shared/feedbackDocx';
import type { Experience } from '@shared/types';
import { api } from '../lib/api';
import { saveFile } from '../lib/download';
import { useDraft } from '../lib/draft';
import { emitLocalChange } from '../lib/realtime';
import { Icon } from './Icon';
import { Select } from './pickers';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal } from './ui';

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

        <AxesGuide />

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
                    <AxisSelect value={p.axis} onChange={(v) => setPoint(kind, i, { axis: v })} label={`הציר של ${name}`} />
                  </Field>
                </div>
                {axisAbout(p.axis) && <p className="tiny muted fb-axis-about">{axisAbout(p.axis)}</p>}
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

/** the axis of a point: the four main axes as groups, each with its parts - one typed before the list stays */
function AxisSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} searchable>
      <option value="">בחירת ציר...</option>
      {value && !FEEDBACK_AXES.includes(value) && <option value={value}>{value}</option>}
      {FEEDBACK_AXIS_GROUPS.map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.axes.map((a) => (
            <option key={a.name} value={axisValue(g.name, a.name)}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** what each axis takes in, folded until asked for */
function AxesGuide() {
  return (
    <details className="fb-axes-guide">
      <summary>
        <Icon name="lightbulb" size={15} /> מה כולל כל ציר
      </summary>
      <div className="fb-axes-groups">
        {FEEDBACK_AXIS_GROUPS.map((g) => (
          <section key={g.name}>
            <h4>{g.name}</h4>
            <p className="tiny muted">{g.about}</p>
            <ul>
              {g.axes.map((a) => (
                <li key={a.name} className="small">
                  <b>{a.name}</b>
                  {a.about && <span className="muted"> - {a.about}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/** the feedback as a Word file, in the format on paper */
export function FeedbackWordButton({ x, small }: { x: Experience; small?: boolean }) {
  if (!x.feedbackForm) return null;
  const form = x.feedbackForm;
  const download = () => {
    const topic = experienceName(x.kind, x.role, x.span);
    const file = feedbackDocx({ cadetName: x.cadetName, topic, date: experienceDates(x), form, score: x.score });
    void saveFile(feedbackDocName(x.cadetName, topic), new Blob([file as BlobPart], { type: DOCX_TYPE }));
  };
  return (
    <button type="button" className={`btn btn-ghost${small ? ' btn-sm' : ''}`} onClick={download} title="המשוב כקובץ Word, בפורמט המשוב">
      <Icon name="download" /> קובץ Word
    </button>
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

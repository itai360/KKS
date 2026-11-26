// The feedback after an experience in the course's format (shared/experienceFeedback.ts): the form the
// mentor fills in - laid out as the paper one: the cadet, the experience and its dates on top, a general
// reference, a point to keep and a point to improve (more of either added with a button) - each its axis,
// then how it shows (אופן המימוש, one of that axis' traits in the catalog), a recommendation of both from
// the words written under it - and the score on its legend; and the feedback as it shows once given.

import { useRef, useState, type ReactNode } from 'react';
import type { TraitSuggestion, TraitSuggestions } from '@shared/traitSuggest';
import { SUGGEST_MIN_WORDS, wordCount } from '@shared/traitSuggest';
import { fmtDateIL, shortDate } from '@shared/dates';
import {
  asFeedbackForm,
  axisTraits,
  emptyFeedback,
  emptyPoint,
  FEEDBACK_AXES,
  FEEDBACK_AXIS_GROUPS,
  FEEDBACK_POINTS,
  FEEDBACK_POINTS_MAX,
  axisValue,
  feedbackMissing,
  isBlankPoint,
  pointName,
  pointProblem,
  POINT_LABELS,
  SCORE_BANDS,
  SCORE_MAX,
  scoreBand,
  type ExperienceFeedbackForm,
  type FeedbackPoint,
  type PointKind,
  tidyFeedback,
} from '@shared/experienceFeedback';
import { experienceName } from '@shared/experiences';
import { DOCX_TYPE, feedbackDocName, feedbackDocx } from '@shared/feedbackDocx';
import type { Experience } from '@shared/types';
import { api } from '../lib/api';
import { shareOrSave } from '../lib/download';
import { useDraft } from '../lib/draft';
import { emitLocalChange } from '../lib/realtime';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { Select } from './pickers';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal } from './ui';

const KINDS: PointKind[] = ['keep', 'improve'];
const KIND_TONE: Record<PointKind, string> = { keep: 't-green', improve: 't-orange' };
const KIND_ICON: Record<PointKind, string> = { keep: 'check', improve: 'arrowUp' };

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
  // another point of a kind: it opens empty under the others, ready to write in
  const addPoint = (kind: PointKind) => {
    const at = draft.form[kind].length;
    if (at >= FEEDBACK_POINTS_MAX) return;
    update({ ...draft, form: { ...draft.form, [kind]: [...draft.form[kind], emptyPoint()] } });
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-point="${kind}-${at}"] input`)?.focus());
  };
  // a point added can go again (the first of each kind stays) - asked first when something is written in it
  const removePoint = async (kind: PointKind, i: number) => {
    const p = draft.form[kind][i];
    const name = pointName(kind, i, draft.form[kind].length);
    if (!isBlankPoint(p) && !(await ask({ title: `להסיר את ${name}?`, body: 'מה שנכתב בה יימחק.', confirm: 'הסרה', cancel: 'ביטול', danger: true }))) return;
    update({ ...draft, form: { ...draft.form, [kind]: draft.form[kind].filter((_, j) => j !== i) } });
    requestAnimationFrame(() => document.getElementById(`fb-add-${kind}`)?.focus());
  };
  // a new axis keeps how it shows only when that is one of its own
  const setAxis = (kind: PointKind, i: number, axis: string) => {
    const p = draft.form[kind][i];
    const keep = axisTraits(axis).some((t) => (p.trait ? t.id === p.trait : t.name === p.title.trim()));
    setPoint(kind, i, keep ? { axis } : { axis, title: '', trait: undefined });
  };
  const pick = (kind: PointKind, i: number, s: Pick<TraitSuggestion, 'axis' | 'trait' | 'title'>) => setPoint(kind, i, { axis: s.axis, trait: s.trait, title: s.title });
  const score = parseScore(draft.score);
  const badScore = draft.score !== '' && score === null;
  const band = score === null ? null : scoreBand(score);
  const missing = feedbackMissing(draft.form, score);
  // an axis or a way it shows that is not the catalog's (one typed before it): chosen again before saving
  const tidy = tidyFeedback(draft.form);
  const problems = KINDS.flatMap((kind) => tidy[kind].map((p, i) => pointProblem(p) && `${pointName(kind, i, tidy[kind].length)}: ${pointProblem(p)}`)).filter(Boolean) as string[];
  const ready = !missing.length && !problems.length;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/experiences/${x.id}/feedback`, { ...tidyFeedback(draft.form), score });
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
            {missing.length ? `חסר: ${missing.join(', ')}` : problems.length ? problems[0] : 'הכל מולא - אפשר לשמור.'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={() => void save()}>
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

        {KINDS.map((kind) => (
          <div key={kind} className="col gap-12 fb-kind">
            {draft.form[kind].map((p, i) => {
              const name = pointName(kind, i, draft.form[kind].length);
              return (
                <fieldset key={`${kind}-${i}`} className={`fb-point ${KIND_TONE[kind]}`} data-point={`${kind}-${i}`}>
                  <legend>
                    <Icon name={KIND_ICON[kind]} size={14} /> {name}
                  </legend>
                  {i >= FEEDBACK_POINTS && (
                    <button type="button" className="icon-btn fb-point-remove" onClick={() => void removePoint(kind, i)} aria-label={`הסרת ${name}`} title={`הסרת ${name}`}>
                      <Icon name="x" size={15} />
                    </button>
                  )}
                  <div className="fb-point-row">
                    <Field label="ציר" required className="fb-axis">
                      <AxisSelect value={p.axis} onChange={(v) => setAxis(kind, i, v)} label={`הציר של ${name}`} />
                    </Field>
                    <Field label="אופן המימוש" required className="fb-how">
                      <HowSelect point={p} onChange={(t) => setPoint(kind, i, { trait: t?.id, title: t?.name ?? '' })} label={`אופן המימוש של ${name}`} />
                    </Field>
                  </div>
                  <Recommend experienceId={x.id} kind={kind} point={p} onPick={(s) => pick(kind, i, s)}>
                    <Field label="פירוט">
                      <textarea className="textarea" rows={2} value={p.text} maxLength={2000} onChange={(e) => setPoint(kind, i, { text: e.target.value })} placeholder="מה ראית, ומתי - ותתקבל המלצה על הציר ואופן המימוש" aria-label={`פירוט ${name}`} />
                    </Field>
                  </Recommend>
                </fieldset>
              );
            })}
            {draft.form[kind].length < FEEDBACK_POINTS_MAX && (
              <button type="button" id={`fb-add-${kind}`} className={`fb-add ${KIND_TONE[kind]}`} onClick={() => addPoint(kind)}>
                <Icon name="plus" size={16} /> הוספת {POINT_LABELS[kind]}
              </button>
            )}
          </div>
        ))}

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
            <option key={a.name} value={axisValue(g.name, a.name)} data-shown={axisValue(g.name, a.name)}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** how the axis showed (אופן המימוש): the traits under the axis chosen - none to pick before it */
function HowSelect({ point, onChange, label }: { point: FeedbackPoint; onChange: (t: { id: string; name: string } | null) => void; label: string }) {
  const traits = axisTraits(point.axis);
  // a point given before the catalog: its words, if they are one of the axis' traits
  const chosen = traits.find((t) => (point.trait ? t.id === point.trait : t.name === point.title.trim()));
  const placeholder = !point.axis ? 'קודם בוחרים ציר' : traits.length ? 'בחירת אופן המימוש...' : 'בחרו ציר מהרשימה';
  return (
    <Select value={chosen?.id ?? ''} onChange={(e) => onChange(traits.find((t) => t.id === e.target.value) ?? null)} aria-label={label} disabled={!traits.length} searchable>
      <option value="">{placeholder}</option>
      {traits.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}

interface Asked {
  /** the words it was asked on */
  text: string;
  busy: boolean;
  result: TraitSuggestions | null;
  error: string | null;
}

/**
 * A recommendation of the axis and how it showed, from the words under the point: asked with the button -
 * or by itself when the words are written before an axis is chosen and the field is left. A tap on one fills
 * both; the mentor may still choose otherwise.
 */
function Recommend({ experienceId, kind, point, onPick, children }: { experienceId: number; kind: PointKind; point: FeedbackPoint; onPick: (s: TraitSuggestion) => void; children: ReactNode }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  // one request at a time: leaving the field by tapping the button asks once
  const inFlight = useRef(false);
  const text = point.text.trim();
  const enough = wordCount(text) >= SUGGEST_MIN_WORDS;
  const stale = !!asked && !asked.busy && asked.text !== text;
  const run = async () => {
    if (!enough || inFlight.current) return;
    inFlight.current = true;
    setAsked((a) => ({ text, busy: true, result: a?.result ?? null, error: null }));
    try {
      const result = await api.post<TraitSuggestions>(`/api/experiences/${experienceId}/feedback/suggest`, { text, kind });
      setAsked({ text, busy: false, result, error: null });
    } catch (e) {
      setAsked({ text, busy: false, result: null, error: (e as Error).message });
    } finally {
      inFlight.current = false;
    }
  };
  const list = asked?.result?.suggestions ?? [];
  const chosenTrait = point.trait ?? axisTraits(point.axis).find((t) => t.name === point.title.trim())?.id;
  return (
    <div
      className="fb-recommend"
      // the words written first and the field left: the recommendation comes by itself, once for those words
      onBlurCapture={(e) => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA' && !point.axis && enough && asked?.text !== text) void run();
      }}
    >
      {children}
      <div className="row gap-8 wrap fb-recommend-head">
        <button type="button" className="btn btn-ghost btn-sm fb-recommend-btn" disabled={!enough || asked?.busy} onClick={() => void run()} aria-describedby={enough ? undefined : `fb-rec-hint-${kind}`}>
          <Icon name="sparkle" size={15} /> {asked?.busy ? 'מחפש התאמה...' : asked && !stale ? 'המלצה מחדש' : 'המלצה על ציר ואופן מימוש'}
        </button>
        {!enough && (
          <span className={text ? 'tiny muted' : 'sr-only'} id={`fb-rec-hint-${kind}`}>
            {text ? 'עוד כמה מילים בפירוט, ותתקבל המלצה' : 'כתבו בפירוט מה ראיתם, ותתקבל המלצה'}
          </span>
        )}
        {stale && list.length > 0 && <span className="tiny muted">הפירוט השתנה - אפשר לבקש שוב</span>}
      </div>
      <div aria-live="polite">
        {asked?.error && <p className="tiny text-red">{asked.error}</p>}
        {asked?.result && !asked.busy && !list.length && <p className="tiny muted">לא נמצאה התאמה ברורה בפירוט - בחרו את הציר ואופן המימוש ידנית.</p>}
        {list.length > 0 && (
          <ul className={`fb-suggestions${asked?.busy ? ' is-busy' : ''}`} aria-label="המלצות לציר ולאופן המימוש">
            {list.map((s) => {
              const on = chosenTrait === s.trait && point.axis === s.axis;
              return (
                <li key={s.trait}>
                  <button type="button" className={`fb-suggestion${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onPick(s)}>
                    <span className="fb-suggestion-axis tiny">{s.axis}</span>
                    <b className="small">{s.title}</b>
                    {s.reason && <span className="tiny muted fb-suggestion-why">{s.reason}</span>}
                    {on && <Icon name="check" size={14} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
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

/**
 * The experience as a Word file in the feedback's format - Google Drive opens it as Google Docs: the feedback
 * given, or (before it is given) the form with the cadet, the experience and its date filled in.
 */
export function FeedbackWordButton({ x, small }: { x: Experience; small?: boolean }) {
  const given = x.status === 'done';
  if (given && !x.feedbackForm) return null;
  const form = given ? x.feedbackForm : null;
  const download = () => {
    const topic = experienceName(x.kind, x.role, x.span);
    const file = feedbackDocx({ cadetName: x.cadetName, topic, date: experienceDates(x), form, score: given ? x.score : null });
    void shareOrSave(feedbackDocName(x.cadetName, topic), new Blob([file as BlobPart], { type: DOCX_TYPE }));
  };
  return (
    <button type="button" className={`btn btn-ghost${small ? ' btn-sm' : ''}`} onClick={download} title={given ? 'המשוב כקובץ Word - נפתח ב-Google Docs' : 'טופס המשוב עם פרטי ההתנסות, למילוי - Word / Google Docs'}>
      <Icon name="file" /> {given ? 'Docs / Word' : 'טופס משוב'}
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
                  {p.trait ? (
                    <>
                      <span className="tiny muted fb-view-axis">
                        <span className="sr-only">ציר: </span>
                        {p.axis}
                      </span>
                      <span className="sr-only">אופן המימוש: </span>
                      <b className="small">{p.title}</b>
                    </>
                  ) : (
                    <>
                      <b className="small">{p.title}</b>
                      {p.axis && <span className="tiny muted"> · ציר: {p.axis}</span>}
                    </>
                  )}
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

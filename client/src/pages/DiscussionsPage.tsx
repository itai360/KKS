// Discussions (server/src/discussions.ts): a planning discussion before a week in the field, a debrief after an
// exercise, a situation assessment, a decision, a coordination, a safety discussion, the cadets' state. Each one:
// its subject, the points it goes through and what came up on each, its decisions, and the follow-up actions -
// what, who owns it, by when - each of which becomes a task, and is followed as one from then on.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { shortDate, weekdayName } from '@shared/dates';
import { DISCUSSION_KIND_HINTS, DISCUSSION_KIND_ICONS, DISCUSSION_KIND_LABELS, DISCUSSION_KIND_TONES, DISCUSSION_KINDS, DISCUSSION_POINTS, type DiscussionKind } from '@shared/discussions';
import type { Discussion, DiscussionAction, DiscussionActionState, DiscussionSummary } from '@shared/types';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { UserPicker } from '../components/NewTask';
import { useToast } from '../components/Toasts';
import { DateInput, Empty, ErrorBox, Field, Loading, Modal, PageError, PageHead, Select, TimeInput } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime, todayKey } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

const when = (d: { heldOn: string; heldAt: string | null }) => `${weekdayName(d.heldOn)} ${shortDate(d.heldOn)}${d.heldAt ? ` · ${d.heldAt}` : ''}`;

function KindBadge({ kind }: { kind: DiscussionKind }) {
  return (
    <span className={`badge t-${DISCUSSION_KIND_TONES[kind]} disc-kind`}>
      <Icon name={DISCUSSION_KIND_ICONS[kind]} size={13} /> {DISCUSSION_KIND_LABELS[kind]}
    </span>
  );
}

const STATE_LABEL: Record<DiscussionActionState, string> = { open: 'פתוחה', task: 'משימה פתוחה', late: 'באיחור', done: 'הושלמה', cancelled: 'בוטלה' };
const STATE_TONE: Record<DiscussionActionState, string> = { open: 'gray', task: 'blue', late: 'red', done: 'green', cancelled: 'gray' };

// ---------------- the list ----------------

export function DiscussionsPage() {
  const { data, error, loading } = useApi<DiscussionSummary[]>('/api/discussions', ['discussions', 'tasks']);
  const [params, setParams] = useSearchParams();
  const kind = (DISCUSSION_KINDS as readonly string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as DiscussionKind) : null;
  const [creating, setCreating] = useState(params.get('new') === '1');
  const today = todayKey();
  const all = data ?? [];
  const list = all.filter((d) => !kind || d.kind === kind);
  const byTime = (a: DiscussionSummary, b: DiscussionSummary) => a.heldOn.localeCompare(b.heldOn) || (a.heldAt ?? '').localeCompare(b.heldAt ?? '');
  const ahead = list.filter((d) => d.status === 'planned' && d.heldOn >= today).sort(byTime);
  const toSum = list.filter((d) => d.status === 'planned' && d.heldOn < today);
  const summed = list.filter((d) => d.status === 'summarized');
  const setKind = (k: DiscussionKind | null) => {
    const next = new URLSearchParams(params);
    if (k) next.set('kind', k);
    else next.delete('kind');
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHead
        title="דיונים"
        sub="דיון תכנוני, דיון תחקירי ועוד - נושא, נקודות לדיון, החלטות ופעולות להמשך עם אחראים."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> דיון חדש
          </button>
        }
      />
      {all.length > 0 && (
        <div className="chips chips-scroll mb-12" role="group" aria-label="סוג הדיון">
          <button className={`chip${!kind ? ' on' : ''}`} aria-pressed={!kind} onClick={() => setKind(null)}>
            הכל <span className="mono tiny">{all.length}</span>
          </button>
          {DISCUSSION_KINDS.filter((k) => all.some((d) => d.kind === k)).map((k) => (
            <button key={k} className={`chip${kind === k ? ' on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              {DISCUSSION_KIND_LABELS[k]} <span className="mono tiny">{all.filter((d) => d.kind === k).length}</span>
            </button>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !list.length ? (
        <Empty
          icon="message"
          title={kind ? `עוד אין ${DISCUSSION_KIND_LABELS[kind]}` : 'עוד אין דיונים'}
          text={
            <>
              דיון תכנוני לפני שבוע שטח, דיון תחקירי אחרי תרגיל - לכל דיון נושא, נקודות לדיון, החלטות ופעולות להמשך עם אחראים.{' '}
              <button type="button" className="link-btn" onClick={() => setCreating(true)}>
                פתיחת דיון
              </button>
            </>
          }
        />
      ) : (
        <div className="col gap-16">
          {ahead.length > 0 && <DiscussionGroup title="קרובים" list={ahead} />}
          {toSum.length > 0 && <DiscussionGroup title="התקיימו - עוד לא סוכמו" list={toSum} />}
          {summed.length > 0 && <DiscussionGroup title="סוכמו" list={summed} />}
        </div>
      )}
      {creating && <NewDiscussion kind={kind} onClose={() => setCreating(false)} />}
    </div>
  );
}

function DiscussionGroup({ title, list }: { title: string; list: DiscussionSummary[] }) {
  return (
    <section aria-label={title}>
      <h2 className="label-caps disc-group-title">
        {title} <span className="mono">{list.length}</span>
      </h2>
      <div className="disc-list">
        {list.map((d) => (
          <DiscussionCard key={d.id} d={d} />
        ))}
      </div>
    </section>
  );
}

function DiscussionCard({ d }: { d: DiscussionSummary }) {
  const a = d.actions;
  return (
    <Link to={`/discussions/${d.id}`} className="card disc-card">
      <span className={`disc-mark t-${DISCUSSION_KIND_TONES[d.kind]}`} aria-hidden="true">
        <Icon name={DISCUSSION_KIND_ICONS[d.kind]} size={18} />
      </span>
      <span className="grow col disc-card-main">
        <span className="strong disc-card-title">{d.title}</span>
        <span className="tiny muted">
          {DISCUSSION_KIND_LABELS[d.kind]} · {when(d)}
          {d.leadName && ` · מוביל: ${d.leadName}`}
          {d.weekName && ` · ${d.weekName}`}
        </span>
        <span className="disc-card-facts tiny">
          {d.points > 0 && <span>{d.status === 'summarized' || d.pointsDone ? `${d.pointsDone}/${d.points} נקודות נדונו` : `${d.points} נקודות לדיון`}</span>}
          {a.total > 0 && (
            <span>
              {a.total === 1 ? 'פעולה אחת' : `${a.total} פעולות`}
              {a.open > 0 && (a.open === 1 ? ' · אחת פתוחה' : ` · ${a.open} פתוחות`)}
              {a.late > 0 && <span className="text-red strong"> · {a.late} באיחור</span>}
              {a.open === 0 && a.done > 0 && ' · הושלמו'}
            </span>
          )}
          {d.mine && <span className="disc-mine">אני בדיון</span>}
        </span>
      </span>
      <Icon name="chevronLeft" size={16} />
    </Link>
  );
}

// ---------------- opening one ----------------

function NewDiscussion({ kind: initial, onClose }: { kind: DiscussionKind | null; onClose: () => void }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const [kind, setKind] = useState<DiscussionKind>(initial ?? 'planning');
  const [title, setTitle] = useState('');
  const [heldOn, setHeldOn] = useState(todayKey());
  const [heldAt, setHeldAt] = useState('');
  const [lead, setLead] = useState<number[]>([user.id]);
  const [people, setPeople] = useState<number[]>([]);
  const [points, setPoints] = useState(DISCUSSION_POINTS[initial ?? 'planning'].join('\n'));
  const [pointsTouched, setPointsTouched] = useState(false);
  const [background, setBackground] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // another kind: its usual points, unless the points were written by hand
  useEffect(() => {
    if (!pointsTouched) setPoints(DISCUSSION_POINTS[kind].join('\n'));
  }, [kind, pointsTouched]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<Discussion>('/api/discussions', {
        kind,
        title,
        heldOn,
        heldAt: heldAt || null,
        leadId: lead[0] ?? null,
        participantIds: people,
        background,
        points: points
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean),
      });
      navigate(`/discussions/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="דיון חדש"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !title.trim() || !heldOn}>
            {busy ? 'פותח...' : 'פתיחת הדיון'}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="disc-kinds" role="radiogroup" aria-label="סוג הדיון">
          {DISCUSSION_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`disc-kind-pick t-${DISCUSSION_KIND_TONES[k]}${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
              <span className="disc-mark" aria-hidden="true">
                <Icon name={DISCUSSION_KIND_ICONS[k]} size={18} />
              </span>
              <span className="col">
                <span className="strong small">{DISCUSSION_KIND_LABELS[k]}</span>
                <span className="tiny muted">{DISCUSSION_KIND_HINTS[k]}</span>
              </span>
            </button>
          ))}
        </div>
        <Field label="נושא הדיון" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={kind === 'debrief' ? 'לדוגמה: תחקיר תרגיל לילה' : 'לדוגמה: תכנון שבוע שטח'} data-autofocus />
        </Field>
        <div className="row wrap gap-16">
          <Field label="תאריך" required className="grow">
            <DateInput value={heldOn} onChange={(v) => setHeldOn(v)} />
          </Field>
          <Field label="שעה" className="grow">
            <TimeInput value={heldAt} onChange={setHeldAt} />
          </Field>
        </div>
        <Field label="מוביל הדיון">
          <UserPicker value={lead} onChange={setLead} multiple={false} />
        </Field>
        <Field label="משתתפים" hint="יקבלו התראה על הדיון">
          <UserPicker value={people} onChange={setPeople} />
        </Field>
        <Field label="רקע ומטרה">
          <textarea className="textarea" rows={2} value={background} onChange={(e) => setBackground(e.target.value)} maxLength={5000} placeholder="למה מתכנסים, ומה צריך לצאת מהדיון" />
        </Field>
        <Field label="נקודות לדיון" hint={`נקודה בכל שורה - הנקודות הרגילות של ${DISCUSSION_KIND_LABELS[kind]}, לשנות או למחוק`}>
          <textarea
            className="textarea"
            rows={Math.min(8, Math.max(3, points.split('\n').length))}
            value={points}
            onChange={(e) => {
              setPoints(e.target.value);
              setPointsTouched(true);
            }}
          />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// ---------------- one discussion ----------------

/** the summary to send on: what was discussed, decided, and who does what by when */
function summaryText(d: Discussion): string {
  const lines = [`${DISCUSSION_KIND_LABELS[d.kind]}: ${d.title}`, `${when(d)}${d.leadName ? ` · מוביל: ${d.leadName}` : ''}`];
  const who = [...d.participantList.map((p) => p.name), ...(d.guests.trim() ? [d.guests.trim()] : [])];
  if (who.length) lines.push(`משתתפים: ${who.join(', ')}`);
  if (d.background.trim()) lines.push('', d.background.trim());
  if (d.pointList.length) {
    lines.push('', 'נקודות לדיון:');
    d.pointList.forEach((p, i) => lines.push(`${i + 1}. ${p.body}${p.outcome.trim() ? ` - ${p.outcome.trim()}` : ''}`));
  }
  if (d.decisions.trim()) lines.push('', 'החלטות:', d.decisions.trim());
  if (d.actionList.length) {
    lines.push('', 'פעולות להמשך:');
    for (const a of d.actionList) lines.push(`• ${a.body}${a.ownerName ? ` - ${a.ownerName}` : ''}${a.dueOn ? `, עד ${shortDate(a.dueOn)}` : ''}`);
  }
  return lines.join('\n');
}

export function DiscussionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: d, error, status, loading, setData } = useApi<Discussion>(`/api/discussions/${id}`, ['discussions', 'tasks']);
  const [editing, setEditing] = useState(false);
  const [summing, setSumming] = useState(false);

  if (loading && !d)
    return (
      <div className="page narrow">
        <Loading rows={5} />
      </div>
    );
  if (!d)
    return (
      <div className="page narrow">
        <PageError error={error} status={status ?? 404} what="הדיון" back="/discussions" backLabel="לדיונים" />
      </div>
    );

  /** a change, and the discussion as it is after it */
  const save = async (run: () => Promise<Discussion>) => {
    try {
      setData(await run());
      return true;
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
      return false;
    }
  };
  const share = async () => {
    const text = summaryText(d);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: d.title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast({ title: 'הסיכום הועתק - אפשר להדביק בוואטסאפ או במייל', tone: 'green' });
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ title: 'לא הצלחנו להעתיק את הסיכום', tone: 'red' });
    }
  };
  const remove = async () => {
    if (!(await ask({ title: `למחוק את הדיון "${d.title}"?`, body: 'הנקודות, ההחלטות והפעולות יימחקו. משימות שנפתחו מהפעולות יישארו.', confirm: 'מחיקת הדיון', danger: true }))) return;
    try {
      await api.del(`/api/discussions/${d.id}`);
      navigate('/discussions');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const ready = d.actionList.filter((a) => !a.taskId && a.ownerId);

  return (
    <div className="page narrow disc-page">
      <PageHead
        title={d.title}
        tags={
          <>
            <KindBadge kind={d.kind} />
            {d.status === 'summarized' && <span className="badge t-green">סוכם</span>}
          </>
        }
        sub={
          <>
            {when(d)}
            {d.leadName && ` · מוביל: ${d.leadName}`}
            {d.weekId && d.weekName && (
              <>
                {' · '}
                <Link to={`/weeks/${d.weekId}`}>{d.weekName}</Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <button className="btn" onClick={() => void share()}>
              <Icon name="share" /> שיתוף הסיכום
            </button>
            {d.canEdit && (
              <button className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" /> עריכה
              </button>
            )}
            {d.canDelete && (
              <button className="icon-btn" aria-label="מחיקת הדיון" title="מחיקת הדיון" onClick={() => void remove()}>
                <Icon name="trash" />
              </button>
            )}
          </>
        }
      />

      <div className="col gap-16">
        {(d.participantList.length > 0 || d.guests) && (
          <div className="disc-people small" aria-label="משתתפים">
            <Icon name="users" size={16} />
            <span className="grow">
              {d.participantList.map((p) => p.name).join(', ')}
              {d.guests && `${d.participantList.length ? ', ' : ''}${d.guests}`}
            </span>
          </div>
        )}

        {(d.canEdit || d.background) && (
          <section className="card" aria-labelledby="disc-bg">
            <div className="card-head">
              <h3 className="grow" id="disc-bg">
                רקע ומטרה
              </h3>
            </div>
            <div className="card-body">
              <SavedText value={d.background} canEdit={d.canEdit} placeholder="למה מתכנסים, ומה צריך לצאת מהדיון" onSave={(background) => save(() => api.patch<Discussion>(`/api/discussions/${d.id}`, { background }))} />
            </div>
          </section>
        )}

        <Points d={d} save={save} />

        <section className="card" aria-labelledby="disc-decisions">
          <div className="card-head">
            <Icon name="stamp" />
            <h3 className="grow" id="disc-decisions">
              החלטות
            </h3>
          </div>
          <div className="card-body">
            <SavedText value={d.decisions} canEdit={d.canEdit} rows={3} placeholder="מה הוחלט בדיון" empty="לא נרשמו החלטות" onSave={(decisions) => save(() => api.patch<Discussion>(`/api/discussions/${d.id}`, { decisions }))} />
          </div>
        </section>

        <Actions d={d} save={save} ready={ready.length} />

        {d.canEdit && d.status === 'planned' && (
          <div className="disc-sum">
            <span className="grow small muted">בסוף הדיון: הפעולות הופכות למשימות של האחראים, וכל מי שבדיון מקבל התראה עם הסיכום.</span>
            <button className="btn btn-primary" onClick={() => setSumming(true)}>
              <Icon name="check" /> סיכום הדיון
            </button>
          </div>
        )}
        {d.status === 'summarized' && (
          <p className="tiny muted disc-summed">
            סוכם {d.summarizedAt && fmtDateTime(d.summarizedAt)}
            {d.summarizedByName && ` על ידי ${d.summarizedByName}`}
            {d.canEdit && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => void save(() => api.post<Discussion>(`/api/discussions/${d.id}/reopen`))}>
                  פתיחה מחדש
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {editing && <EditDiscussion d={d} onClose={() => setEditing(false)} onSaved={setData} />}
      {summing && <SumUp d={d} ready={ready.length} onClose={() => setSumming(false)} onDone={setData} />}
    </div>
  );
}

/** text kept as it is left (the field loses focus) - or read */
function SavedText({ value, canEdit, onSave, placeholder, empty, rows = 2 }: { value: string; canEdit: boolean; onSave: (v: string) => Promise<unknown> | void; placeholder?: string; empty?: string; rows?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  if (!canEdit) return value.trim() ? <p className="prewrap small">{value}</p> : <p className="small muted">{empty ?? '-'}</p>;
  return (
    <textarea
      className="textarea"
      rows={Math.max(rows, Math.min(10, text.split('\n').length))}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) void onSave(text);
      }}
    />
  );
}

type Save = (run: () => Promise<Discussion>) => Promise<boolean>;

/** discussed: ticked at the touch, back again if it could not be kept */
function PointCheck({ point, canEdit, save }: { point: Discussion['pointList'][number]; canEdit: boolean; save: Save }) {
  const [done, setDone] = useState(point.done);
  useEffect(() => {
    setDone(point.done);
  }, [point.done]);
  return (
    <input
      type="checkbox"
      checked={done}
      disabled={!canEdit}
      aria-label={`${point.body} - נדון`}
      onChange={(e) => {
        const next = e.target.checked;
        setDone(next);
        void save(() => api.patch<Discussion>(`/api/discussion-points/${point.id}`, { done: next })).then((ok) => {
          if (!ok) setDone(!next);
        });
      }}
    />
  );
}

function Points({ d, save }: { d: Discussion; save: Save }) {
  const [adding, setAdding] = useState('');
  const n = d.pointList.length;
  const add = () => {
    const body = adding.trim();
    if (!body) return;
    setAdding('');
    void save(() => api.post<Discussion>(`/api/discussions/${d.id}/points`, { body }));
  };
  const move = (i: number, by: number) => {
    const ids = d.pointList.map((p) => p.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    void save(() => api.post<Discussion>(`/api/discussions/${d.id}/points/order`, { ids }));
  };
  return (
    <section className="card" aria-labelledby="disc-points">
      <div className="card-head">
        <Icon name="checks" />
        <h3 className="grow" id="disc-points">
          נקודות לדיון
        </h3>
        {n > 0 && (
          <span className="tiny muted">
            {d.pointsDone}/{n} נדונו
          </span>
        )}
      </div>
      <div className="card-body col gap-8">
        {!n && <p className="small muted">עוד אין נקודות.</p>}
        <ol className="disc-points">
          {d.pointList.map((p, i) => (
            <li key={p.id} className={`disc-point${p.done ? ' is-done' : ''}`}>
              <label className="disc-point-check" title={p.done ? 'נדון' : 'סימון שנדון'}>
                <PointCheck point={p} canEdit={d.canEdit} save={save} />
              </label>
              <div className="grow col gap-6">
                {d.canEdit ? (
                  <PointText point={p} save={save} />
                ) : (
                  <>
                    <span className="small strong">{p.body}</span>
                    {p.outcome && <span className="small prewrap muted">{p.outcome}</span>}
                  </>
                )}
              </div>
              {d.canEdit && (
                <span className="disc-row-tools">
                  <button type="button" className="icon-btn" aria-label="למעלה" title="למעלה" disabled={i === 0} onClick={() => move(i, -1)}>
                    <Icon name="arrowUp" size={15} />
                  </button>
                  <button type="button" className="icon-btn" aria-label="מחיקת הנקודה" title="מחיקה" onClick={() => void save(() => api.del<Discussion>(`/api/discussion-points/${p.id}`))}>
                    <Icon name="x" size={15} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {d.canEdit && (
          <div className="row gap-6">
            <input
              className="input grow"
              value={adding}
              maxLength={300}
              placeholder="נקודה נוספת לדיון"
              aria-label="נקודה נוספת לדיון"
              enterKeyHint="done"
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button className="btn" onClick={add} disabled={!adding.trim()}>
              <Icon name="plus" /> הוספה
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function PointText({ point, save }: { point: Discussion['pointList'][number]; save: Save }) {
  const [body, setBody] = useState(point.body);
  const [outcome, setOutcome] = useState(point.outcome);
  useEffect(() => {
    setBody(point.body);
  }, [point.body]);
  useEffect(() => {
    setOutcome(point.outcome);
  }, [point.outcome]);
  const keep = (patch: { body?: string; outcome?: string }) => void save(() => api.patch<Discussion>(`/api/discussion-points/${point.id}`, patch));
  return (
    <>
      <input
        className="input disc-point-body"
        value={body}
        maxLength={300}
        aria-label="הנקודה"
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          if (body.trim() && body !== point.body) keep({ body });
          else if (!body.trim()) setBody(point.body);
        }}
      />
      <textarea
        className="textarea disc-point-outcome"
        rows={outcome ? Math.min(6, outcome.split('\n').length + 1) : 1}
        value={outcome}
        placeholder="מה עלה, מה הוחלט"
        aria-label={`מה עלה על: ${point.body}`}
        onChange={(e) => setOutcome(e.target.value)}
        onBlur={() => {
          if (outcome !== point.outcome) keep({ outcome });
        }}
      />
    </>
  );
}

function Actions({ d, save, ready }: { d: Discussion; save: Save; ready: number }) {
  const setDiscussion = (next: Discussion) => void save(async () => next);
  const { users } = useSession();
  const toast = useToast();
  const people = users.filter((u) => u.active);
  const [body, setBody] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const add = () => {
    if (!body.trim()) return;
    const payload = { body: body.trim(), ownerId: owner ? Number(owner) : null, dueOn: due || null };
    setBody('');
    void save(() => api.post<Discussion>(`/api/discussions/${d.id}/actions`, payload));
  };
  const openAll = async () => {
    try {
      const r = await api.post<{ opened: number; failed: { body: string; error: string }[]; discussion: Discussion }>(`/api/discussions/${d.id}/tasks`);
      setDiscussion(r.discussion);
      if (r.opened) toast({ title: r.opened === 1 ? 'נפתחה משימה אחת' : `נפתחו ${r.opened} משימות`, tone: 'green' });
      for (const f of r.failed) toast({ title: `"${f.body}": ${f.error}`, tone: 'red' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  return (
    <section className="card" aria-labelledby="disc-actions">
      <div className="card-head">
        <Icon name="zap" />
        <h3 className="grow" id="disc-actions">
          פעולות להמשך
        </h3>
        {d.actions.total > 0 && (
          <span className="tiny muted">
            {d.actions.done}/{d.actions.total} הושלמו
          </span>
        )}
      </div>
      <div className="card-body col gap-8">
        {!d.actionList.length && <p className="small muted">עוד אין פעולות. לכל פעולה - אחראי ותאריך יעד, והיא הופכת למשימה שלו.</p>}
        <div className="disc-actions">
          {d.actionList.map((a) => (
            <ActionRow key={a.id} a={a} d={d} save={save} people={people} />
          ))}
        </div>
        {d.canEdit && (
          <div className="disc-action-add">
            <input
              className="input"
              value={body}
              maxLength={300}
              placeholder="פעולה להמשך - מה צריך לעשות"
              aria-label="פעולה חדשה"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="אחראי">
              <option value="">אחראי...</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
            <DateInput value={due} onChange={(v) => setDue(v)} aria-label="תאריך יעד" />
            <button className="btn" onClick={add} disabled={!body.trim()}>
              <Icon name="plus" /> הוספה
            </button>
          </div>
        )}
        {d.canEdit && ready > 0 && (
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => void openAll()}>
              <Icon name="tasks" size={15} /> {ready === 1 ? 'פתיחת משימה לפעולה' : `פתיחת משימות ל-${ready} פעולות`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ActionRow({ a, d, save, people }: { a: DiscussionAction; d: Discussion; save: Save; people: { id: number; displayName: string }[] }) {
  const [body, setBody] = useState(a.body);
  useEffect(() => {
    setBody(a.body);
  }, [a.body]);
  const patch = (p: Record<string, unknown>) => void save(() => api.patch<Discussion>(`/api/discussion-actions/${a.id}`, p));
  // once a task, its owner and date are the task's - changed there
  const fixed = !d.canEdit || !!a.taskId;
  return (
    <div className={`disc-action is-${a.state}`}>
      <div className="disc-action-main">
        {d.canEdit && !a.taskId ? (
          <input
            className="input"
            value={body}
            maxLength={300}
            aria-label="הפעולה"
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => {
              if (body.trim() && body !== a.body) patch({ body });
              else if (!body.trim()) setBody(a.body);
            }}
          />
        ) : (
          <span className="small strong">{a.body}</span>
        )}
        <span className={`badge t-${STATE_TONE[a.state]}`}>{STATE_LABEL[a.state]}</span>
      </div>
      <div className="disc-action-meta">
        {fixed ? (
          <span className="small">
            <span className="muted">אחראי: </span>
            {a.ownerName ?? 'לא נקבע'}
            {a.dueOn && (
              <>
                <span className="muted"> · עד </span>
                {shortDate(a.dueOn)}
              </>
            )}
          </span>
        ) : (
          <>
            <Select value={a.ownerId ?? ''} onChange={(e) => patch({ ownerId: e.target.value ? Number(e.target.value) : null })} aria-label="אחראי">
              <option value="">אחראי...</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
            <DateInput value={a.dueOn ?? ''} onChange={(v) => patch({ dueOn: v || null })} aria-label="תאריך יעד" />
          </>
        )}
        <span className="grow" />
        {a.taskId ? (
          <Link to={`/tasks/${a.taskId}`} className="btn btn-ghost btn-sm">
            למשימה <Icon name="chevronLeft" size={14} />
          </Link>
        ) : (
          d.canEdit && (
            <button className="btn btn-ghost btn-sm" disabled={!a.ownerId} title={a.ownerId ? 'פתיחת משימה לאחראי' : 'בחרו אחראי קודם'} onClick={() => void save(() => api.post<Discussion>(`/api/discussion-actions/${a.id}/task`))}>
              <Icon name="tasks" size={15} /> פתיחת משימה
            </button>
          )
        )}
        {d.canEdit && (
          <button type="button" className="icon-btn" aria-label="מחיקת הפעולה" title={a.taskId ? 'מחיקת הפעולה (המשימה נשארת)' : 'מחיקה'} onClick={() => void save(() => api.del<Discussion>(`/api/discussion-actions/${a.id}`))}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function EditDiscussion({ d, onClose, onSaved }: { d: Discussion; onClose: () => void; onSaved: (d: Discussion) => void }) {
  const [kind, setKind] = useState<DiscussionKind>(d.kind);
  const [title, setTitle] = useState(d.title);
  const [heldOn, setHeldOn] = useState(d.heldOn);
  const [heldAt, setHeldAt] = useState(d.heldAt ?? '');
  const [lead, setLead] = useState<number[]>(d.leadId ? [d.leadId] : []);
  const [people, setPeople] = useState<number[]>(d.participantList.map((p) => p.id));
  const [guests, setGuests] = useState(d.guests);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.patch<Discussion>(`/api/discussions/${d.id}`, { kind, title, heldOn, heldAt: heldAt || null, leadId: lead[0] ?? null, participantIds: people, guests }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="עריכת הדיון"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !title.trim() || !heldOn}>
            {busy ? 'שומר...' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="סוג הדיון">
          <Select value={kind} onChange={(e) => setKind(e.target.value as DiscussionKind)}>
            {DISCUSSION_KINDS.map((k) => (
              <option key={k} value={k}>
                {DISCUSSION_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="נושא הדיון" required>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="row wrap gap-16">
          <Field label="תאריך" required className="grow">
            <DateInput value={heldOn} onChange={(v) => setHeldOn(v)} />
          </Field>
          <Field label="שעה" className="grow">
            <TimeInput value={heldAt} onChange={setHeldAt} />
          </Field>
        </div>
        <Field label="מוביל הדיון">
          <UserPicker value={lead} onChange={setLead} multiple={false} />
        </Field>
        <Field label="משתתפים" hint="מי שנוסף יקבל התראה">
          <UserPicker value={people} onChange={setPeople} />
        </Field>
        <Field label="משתתפים נוספים" hint="מחוץ לסגל - שמות או תפקידים">
          <input className="input" value={guests} onChange={(e) => setGuests(e.target.value)} maxLength={500} placeholder='לדוגמה: קצין הבטיחות, נציג הגדוד' />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function SumUp({ d, ready, onClose, onDone }: { d: Discussion; ready: number; onClose: () => void; onDone: (d: Discussion) => void }) {
  const toast = useToast();
  const [openTasks, setOpenTasks] = useState(ready > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undiscussed = d.pointList.filter((p) => !p.done).length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ opened: number; failed: { body: string; error: string }[]; discussion: Discussion }>(`/api/discussions/${d.id}/summarize`, { openTasks });
      onDone(r.discussion);
      toast({ title: r.opened ? `הדיון סוכם - ${r.opened === 1 ? 'נפתחה משימה אחת' : `נפתחו ${r.opened} משימות`}` : 'הדיון סוכם', tone: 'green' });
      for (const f of r.failed) toast({ title: `"${f.body}": ${f.error}`, tone: 'red' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="סיכום הדיון"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'מסכם...' : 'סיכום'}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p className="small">כל מי שבדיון - המוביל, המשתתפים ואחראי הפעולות - יקבל התראה עם הסיכום.</p>
        {undiscussed > 0 && <p className="small text-orange">{undiscussed === 1 ? 'נקודה אחת לא סומנה שנדונה.' : `${undiscussed} נקודות לא סומנו שנדונו.`}</p>}
        {ready > 0 && (
          <label className="check">
            <input type="checkbox" checked={openTasks} onChange={(e) => setOpenTasks(e.target.checked)} />
            <span className="small">{ready === 1 ? 'לפתוח משימה לפעולה עם אחראי' : `לפתוח משימות ל-${ready} הפעולות עם אחראי`}</span>
          </label>
        )}
        {d.actionList.some((a) => !a.ownerId) && <p className="tiny muted">פעולה בלי אחראי נשארת פתוחה בדיון, בלי משימה.</p>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

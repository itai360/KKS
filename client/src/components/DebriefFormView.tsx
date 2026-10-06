// A debrief filled in as a form - the weekly debrief, or an intensive event (a march, a
// final exercise): numbered sections that save as they are typed, lessons with an owner
// and a date, and one button that sums it up - this cycle's lessons become tasks, the next
// cycle's are kept in the lessons bank for the same week or event.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { STATUS_LABELS } from '@shared/constants';
import { addDays, shortDate } from '@shared/dates';
import {
  answered,
  DEBRIEF_KIND_HINTS,
  DEBRIEF_KIND_LABELS,
  formFor,
  GOAL_STATUS_LABELS,
  LESSON_HORIZON_LABELS,
  type DebriefAnswers,
  type DebriefQuestion,
  type DebriefSection,
  type GoalAnswer,
  type LessonHorizon,
} from '@shared/debriefForms';
import type { DebriefDetail, DebriefItem } from '@shared/types';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { PriorLessons } from './DebriefBits';
import { TaskList } from './TaskRow';
import { useToast } from './Toasts';
import { Bar, DateInput, PageHead, Select } from './ui';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * The answers as typed: each change waits a moment and is sent with the others typed
 * meanwhile. What was typed shows until the server has it, so a refresh from someone
 * else filling another part of the form never overwrites it. One save at a time: two
 * in flight could reach the server (several instances in the cloud) in the wrong order,
 * and the older one would overwrite the newer.
 */
function useAnswers(id: number, server: DebriefAnswers, onSaved: (d: DebriefDetail) => void) {
  const [local, setLocal] = useState<DebriefAnswers>({});
  const [state, setState] = useState<SaveState>('idle');
  const pending = useRef<DebriefAnswers>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    while (inflight.current) await inflight.current;
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    setState('saving');
    const save = (async () => {
      try {
        const res = await api.patch<DebriefDetail>(`/api/debriefs/${id}`, { answers: body });
        onSavedRef.current(res);
        setLocal((l) => {
          const n = { ...l };
          for (const k of Object.keys(body)) if (n[k] === body[k] && !(k in pending.current)) delete n[k];
          return n;
        });
        setState(Object.keys(pending.current).length ? 'pending' : 'saved');
      } catch {
        // kept, and sent with the next change or "try again"
        pending.current = { ...body, ...pending.current };
        setState('error');
      }
    })();
    inflight.current = save;
    await save;
    inflight.current = null;
  }, [id]);

  const set = (key: string, value: unknown) => {
    setLocal((l) => ({ ...l, [key]: value }));
    pending.current[key] = value;
    setState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  };

  // leaving the screen sends what was typed; closing the tab asks first
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      void flush();
    };
  }, [flush]);

  const all: DebriefAnswers = { ...server, ...local };
  return { all, set, flush, state };
}

const ANCHOR = (s: string) => `dsec-${s}`;

export function DebriefFormView({ data, setData, onEdit }: { data: DebriefDetail; setData: (d: DebriefDetail) => void; onEdit: () => void }) {
  const d = data.debrief;
  const toast = useToast();
  const navigate = useNavigate();
  const sections = formFor(d.kind);
  const { all, set, flush, state } = useAnswers(d.id, d.answers, setData);
  const editable = d.canEdit && d.status === 'draft';
  const { isCommander } = useSession();
  const [busy, setBusy] = useState(false);

  const lessons = data.items.filter((i) => i.kind === 'lesson');
  const ofHorizon = (h: LessonHorizon) => lessons.filter((l) => (l.horizon ?? 'now') === h);
  const unowned = ofHorizon('now').filter((l) => !l.taskId && (!l.ownerId || !l.dueDate));

  // the same check the server makes before summing up, shown while filling in
  const missing: { label: string; anchor: string }[] = [
    ...sections.filter((s) => s.questions.some((q) => q.required && !answered(q, all))).map((s) => ({ label: s.title, anchor: ANCHOR(s.id) })),
    ...(lessons.length ? [] : [{ label: 'לקח אחד לפחות', anchor: ANCHOR('now') }]),
    ...(unowned.length ? [{ label: unowned.length === 1 ? 'אחראי ותאריך ללקח' : `אחראי ותאריך ל-${unowned.length} לקחים`, anchor: ANCHOR('now') }] : []),
  ];
  const questions = sections.flatMap((s) => s.questions);
  const done = questions.filter((q) => answered(q, all)).length + (lessons.length ? 1 : 0);
  const total = questions.length + 1;

  const run = async (fn: () => Promise<DebriefDetail>, ok?: string) => {
    try {
      setData(await fn());
      if (ok) toast({ title: ok, tone: 'green' });
      emitLocalChange('debriefs', 'tasks');
      return true;
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
      return false;
    }
  };

  const goTo = (anchor: string) => {
    const el = document.getElementById(anchor);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
  };

  const sumUp = async () => {
    if (missing.length) {
      toast({ title: `כדי לסכם חסר: ${missing.map((m) => m.label).join(', ')}`, tone: 'red' });
      goTo(missing[0].anchor);
      return;
    }
    const toOpen = ofHorizon('now').filter((l) => !l.taskId).length;
    const kept = ofHorizon('next').length;
    const ok = await ask({
      title: 'לסכם את התחקיר?',
      body: [toOpen ? `${toOpen === 1 ? 'לקח אחד ייפתח כמשימה' : `${toOpen} לקחים ייפתחו כמשימות`} לאחראים, לפי התאריכים שנקבעו.` : '', kept ? `${kept === 1 ? 'לקח אחד יישמר' : `${kept} לקחים יישמרו`} בבנק הלקחים למחזור הבא.` : '', all.safetyEvent === true ? 'מפקד הקורס יקבל התראה על אירוע הבטיחות.' : '']
        .filter(Boolean)
        .join(' '),
      confirm: 'סיכום התחקיר',
    });
    if (!ok) return;
    setBusy(true);
    await flush();
    await run(() => api.patch<DebriefDetail>(`/api/debriefs/${d.id}`, { status: 'final' }), toOpen ? `התחקיר סוכם · ${toOpen === 1 ? 'נפתחה משימה אחת' : `נפתחו ${toOpen} משימות`}` : 'התחקיר סוכם');
    setBusy(false);
  };

  const about = d.kind === 'weekly' ? (data.week ? `שבוע ${data.week.number} · ${data.week.name}` : d.weekName) : d.eventTitle;
  // what earlier cycles kept for this week or event - decided about on the week page, or here by the commander
  const prior = d.kind === 'weekly' && d.weekId ? { weekId: d.weekId } : d.kind === 'event' && d.eventId ? { eventId: d.eventId } : null;

  return (
    <div className="page dform-page">
      <PageHead
        eyebrow={
          <Link to="/debriefs" className="muted">
            תחקירים
          </Link>
        }
        title={d.title}
        sub={[DEBRIEF_KIND_LABELS[d.kind], about, shortDate(d.occurredOn), d.facilitatorName && `מנחה: ${d.facilitatorName}`, d.status === 'final' ? 'סוכם' : 'טיוטה'].filter(Boolean).join(' · ')}
        actions={
          <>
            <button className="btn" onClick={() => window.print()} aria-label="הדפסה">
              <Icon name="print" />
              <span className="hide-mobile">הדפסה</span>
            </button>
            {d.canEdit && (
              <>
                <button className="btn" onClick={onEdit}>
                  <Icon name="edit" /> פרטים
                </button>
                {d.status === 'final' && (
                  <button className="btn" onClick={() => void run(() => api.patch<DebriefDetail>(`/api/debriefs/${d.id}`, { status: 'draft' }), 'התחקיר חזר לטיוטה')}>
                    החזר לטיוטה
                  </button>
                )}
                <button
                  className="btn btn-ghost text-red"
                  aria-label="מחיקה"
                  onClick={async () =>
                    (await ask({ title: 'למחוק את התחקיר?', body: 'התשובות והלקחים שבו יימחקו. משימות שנפתחו ממנו יישארו.', confirm: 'מחיקה', danger: true })) &&
                    void api.del(`/api/debriefs/${d.id}`).then(() => {
                      emitLocalChange('debriefs');
                      navigate('/debriefs');
                    })
                  }
                >
                  <Icon name="trash" />
                </button>
              </>
            )}
          </>
        }
      />

      <div className="dform">
        <div className="col gap-16 dform-main">
          <div className={`card card-pad dform-intro ${d.kind === 'event' ? 't-purple' : 't-blue'}`}>
            <div className="row wrap gap-6">
              <span className={`badge ${d.kind === 'event' ? 't-purple' : 't-blue'}`}>{DEBRIEF_KIND_LABELS[d.kind]}</span>
              {d.status === 'final' ? <span className="badge t-green">סוכם</span> : <span className="badge t-yellow">טיוטה</span>}
              <span className="grow" />
              <span className="tiny muted mono">
                {done}/{total}
              </span>
            </div>
            <Bar value={(done / total) * 100} tone={done === total ? 'green' : 'blue'} label="התקדמות מילוי הטופס" />
            <p className="small muted">{d.status === 'final' ? 'התחקיר סוכם: הלקחים להמשך המחזור נפתחו כמשימות, והלקחים למחזור הבא שמורים בבנק הלקחים.' : DEBRIEF_KIND_HINTS[d.kind]}</p>
            {(d.participants || d.summary) && (
              <div className="small">
                {d.participants && <div className="muted">משתתפים: {d.participants}</div>}
                {d.summary && <p className="prewrap mt-8">{d.summary}</p>}
              </div>
            )}
          </div>

          {prior && (
            <PriorLessons
              title={d.kind === 'weekly' ? 'מה המחזור הקודם למד על השבוע הזה' : 'מה למדנו במופעים קודמים'}
              context={{ ...prior, canDecide: isCommander && editable, owner: null, due: addDays(d.occurredOn, 3) }}
            />
          )}

          {sections.map((s, i) => (
            <Section key={s.id} section={s} n={i + 1} answers={all} editable={editable} onChange={set} onDone={() => void flush()} />
          ))}

          {(['now', 'next'] as const).map((h, i) => (
            <LessonsCard key={h} n={sections.length + i + 1} horizon={h} data={data} items={ofHorizon(h)} editable={editable} run={run} />
          ))}

          <div className="card">
            <div className="card-head">
              <Icon name="tasks" />
              <h3 className="grow">משימות בעקבות התחקיר</h3>
              <span className="mono tiny muted">{data.tasks.length}</span>
            </div>
            <div className="card-body">
              <TaskList tasks={data.tasks} empty={<p className="small muted">בסיכום התחקיר כל לקח להמשך המחזור נפתח כאן כמשימה לאחראי שלו.</p>} />
            </div>
          </div>
        </div>

        <nav className="dform-toc no-print" aria-label="סעיפי הטופס">
          <div className="label-caps">סעיפים</div>
          {sections.map((s, i) => {
            const ok = s.questions.some((q) => answered(q, all));
            const need = s.questions.some((q) => q.required && !answered(q, all));
            return (
              <a key={s.id} href={`#${ANCHOR(s.id)}`} onClick={(e) => (e.preventDefault(), goTo(ANCHOR(s.id)))} className={ok && !need ? 'ok' : need ? 'need' : ''}>
                <span className="dsec-num">{ok && !need ? <Icon name="check" size={12} /> : i + 1}</span>
                {s.title}
              </a>
            );
          })}
          {(['now', 'next'] as const).map((h, i) => {
            const n = ofHorizon(h).length;
            const need = h === 'now' ? (!lessons.length || unowned.length > 0) : false;
            return (
              <a key={h} href={`#${ANCHOR(h)}`} onClick={(e) => (e.preventDefault(), goTo(ANCHOR(h)))} className={n && !need ? 'ok' : need ? 'need' : ''}>
                <span className="dsec-num">{n && !need ? <Icon name="check" size={12} /> : sections.length + i + 1}</span>
                {LESSON_HORIZON_LABELS[d.kind][h].title}
                {n > 0 && <span className="mono tiny muted"> {n}</span>}
              </a>
            );
          })}
        </nav>
      </div>

      {editable && (
        <div className="fab-dock page-fab no-print">
          <SaveIndicator state={state} retry={() => void flush()} />
          {missing.length > 0 && (
            <button type="button" className="fab-missing" onClick={() => goTo(missing[0].anchor)}>
              חסר: {missing.map((m) => m.label).join(', ')}
            </button>
          )}
          <button className={`btn btn-primary fab-send${missing.length ? ' incomplete' : ''}`} onClick={() => void sumUp()} disabled={busy}>
            <Icon name="check" /> {busy ? 'מסכם...' : 'סיכום התחקיר'}
            {missing.length > 0 && <span className="fab-count">חסרים {missing.length}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

function SaveIndicator({ state, retry }: { state: SaveState; retry: () => void }) {
  if (state === 'error')
    return (
      <span className="save-state error fab-hint" role="status">
        <Icon name="alert" size={14} /> לא נשמר
        <button className="btn btn-sm" onClick={retry}>
          נסו שוב
        </button>
      </span>
    );
  return (
    <span className={`save-state fab-hint tiny muted${state === 'idle' ? ' quiet' : ''}`} role="status">
      {state === 'saving' || state === 'pending' ? 'שומר...' : state === 'saved' ? (
        <>
          <Icon name="check" size={13} /> נשמר
        </>
      ) : (
        'כל שינוי נשמר מעצמו'
      )}
    </span>
  );
}

function Section({
  section,
  n,
  answers,
  editable,
  onChange,
  onDone,
}: {
  section: DebriefSection;
  n: number;
  answers: DebriefAnswers;
  editable: boolean;
  onChange: (key: string, value: unknown) => void;
  onDone: () => void;
}) {
  const alert = section.alert && answers.safetyEvent === true;
  const ok = section.questions.some((q) => answered(q, answers)) && !section.questions.some((q) => q.required && !answered(q, answers));
  return (
    <section id={ANCHOR(section.id)} className={`card dsec${alert ? ' alert' : ''}`} aria-labelledby={`${ANCHOR(section.id)}-h`}>
      <div className="card-head">
        <span className="dsec-num">{n}</span>
        <h2 className="grow" id={`${ANCHOR(section.id)}-h`}>
          {section.title}
        </h2>
        {ok && <Icon name="check" size={16} />}
      </div>
      <div className="card-body col gap-16">
        {section.hint && <p className="small muted">{section.hint}</p>}
        {section.questions.map((q) => (
          <Question key={q.id} q={q} value={answers[q.id]} editable={editable} onChange={(v) => onChange(q.id, v)} onDone={onDone} alert={!!alert} />
        ))}
      </div>
    </section>
  );
}

function Question({ q, value, editable, onChange, onDone, alert }: { q: DebriefQuestion; value: unknown; editable: boolean; onChange: (v: unknown) => void; onDone: () => void; alert: boolean }) {
  const id = `q-${q.id}`;
  const head = (
    <span className="dq-label" id={`${id}-l`}>
      {q.label}
      {q.required && <span className="req"> *</span>}
      {q.hint && <span className="tiny muted"> · {q.hint}</span>}
    </span>
  );
  // a single field takes its label; several controls are a group named by it
  if (q.type === 'text')
    return (
      <label className="dq" htmlFor={id}>
        {head}
        {editable ? (
          <textarea id={id} className="textarea dq-text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} onBlur={onDone} />
        ) : (
          <Read text={typeof value === 'string' ? value : ''} />
        )}
      </label>
    );
  return (
    <div className="dq" role="group" aria-labelledby={`${id}-l`}>
      {head}
      {q.type === 'list' && <ListInput value={Array.isArray(value) ? (value as string[]) : []} editable={editable} onChange={onChange} onDone={onDone} label={q.label} />}
      {q.type === 'rating' && <Rating value={typeof value === 'number' ? value : 0} editable={editable} onChange={(v) => (onChange(v), onDone())} />}
      {q.type === 'goals' && <Goals value={Array.isArray(value) ? (value as GoalAnswer[]) : []} editable={editable} onChange={onChange} onDone={onDone} />}
      {q.type === 'numbers' && <Numbers fields={q.fields ?? []} value={value && typeof value === 'object' ? (value as Record<string, number>) : {}} editable={editable} onChange={onChange} onDone={onDone} />}
      {q.type === 'flag' && (
        <>
          <Choice
            value={value === true ? 'yes' : value === false ? 'no' : ''}
            editable={editable}
            options={[
              { value: 'no', label: 'לא', tone: 'green' },
              { value: 'yes', label: 'כן', tone: 'red' },
            ]}
            onChange={(v) => (onChange(v === 'yes' ? true : v === 'no' ? false : null), onDone())}
            label={q.label}
          />
          {alert && <p className="small text-red">בסיכום התחקיר מפקד הקורס יקבל התראה על האירוע. פרטו מה קרה ומה נעשה.</p>}
        </>
      )}
    </div>
  );
}

function Read({ text }: { text: string }) {
  return text.trim() ? <p className="prewrap dq-read">{text}</p> : <p className="muted">-</p>;
}

/** buttons that pick one value; clicking the chosen one clears it */
function Choice<T extends string>({ value, options, editable, onChange, label }: { value: T | ''; options: { value: T; label: string; tone: string }[]; editable: boolean; onChange: (v: T | '') => void; label: string }) {
  if (!editable) {
    const o = options.find((x) => x.value === value);
    return o ? <span className={`badge t-${o.tone}`}>{o.label}</span> : <span className="muted">-</span>;
  }
  return (
    <div className="dq-choice" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`t-${o.tone}`} aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? '' : o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Rating({ value, editable, onChange }: { value: number; editable: boolean; onChange: (v: number | null) => void }) {
  const tone = (n: number) => (n <= 2 ? 'red' : n === 3 ? 'yellow' : 'green');
  if (!editable) return value ? <span className={`badge t-${tone(value)}`}>{value} / 5</span> : <span className="muted">-</span>;
  return (
    <div className="dq-rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`t-${tone(n)}`} aria-pressed={value === n} aria-label={`${n} מתוך 5`} onClick={() => onChange(value === n ? null : n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

/** a list of short items: Enter moves to the next row, an emptied row goes away */
function ListInput({ value, editable, onChange, onDone, label }: { value: string[]; editable: boolean; onChange: (v: string[]) => void; onDone: () => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  if (!editable) {
    const items = value.filter((v) => v.trim());
    return items.length ? (
      <ul className="dq-list-read">
        {items.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    ) : (
      <p className="muted">-</p>
    );
  }
  const rows = [...value, ''];
  const focusRow = (i: number) => box.current?.querySelectorAll<HTMLInputElement>('input')[i]?.focus();
  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[i].trim()) focusRow(i + 1);
    } else if (e.key === 'Backspace' && !rows[i] && i > 0) {
      e.preventDefault();
      if (i < value.length) onChange(value.filter((_, j) => j !== i));
      focusRow(i - 1);
    }
  };
  return (
    <div className="dq-list" ref={box}>
      {rows.map((v, i) => (
        <div key={i} className="dq-list-row">
          <span className="dq-bullet" aria-hidden="true">
            {i + 1}
          </span>
          <input
            className="input"
            value={v}
            aria-label={`${label} ${i + 1}`}
            enterKeyHint="next"
            placeholder={i === value.length ? (i ? 'עוד אחד...' : 'כתבו ולחצו Enter') : undefined}
            onChange={(e) => {
              const next = [...value];
              next[i] = e.target.value;
              onChange(next);
            }}
            onKeyDown={(e) => onKey(e, i)}
            onBlur={() => {
              if (value.some((x) => !x.trim())) onChange(value.filter((x) => x.trim()));
              onDone();
            }}
          />
          {i < value.length && (
            <button type="button" className="icon-btn" aria-label="הסרה" onClick={() => (onChange(value.filter((_, j) => j !== i)), onDone())}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const GOAL_TONES = { met: 'green', partial: 'yellow', missed: 'red' } as const;

function Goals({ value, editable, onChange, onDone }: { value: GoalAnswer[]; editable: boolean; onChange: (v: GoalAnswer[]) => void; onDone: () => void }) {
  // nothing to start from: one empty row to type the first goal in
  const rows: GoalAnswer[] = value.length || !editable ? value : [{ goal: '', status: '', note: '' }];
  const patch = (i: number, p: Partial<GoalAnswer>) => onChange(rows.map((g, j) => (j === i ? { ...g, ...p } : g)));
  if (!rows.length) return <p className="muted">-</p>;
  return (
    <div className="dq-goals">
      {rows.map((g, i) => (
        <div key={i} className="goal-row">
          {editable ? (
            <input className="input goal-name" value={g.goal} placeholder="המטרה" aria-label={`מטרה ${i + 1}`} onChange={(e) => patch(i, { goal: e.target.value })} onBlur={onDone} />
          ) : (
            <span className="goal-name strong">{g.goal}</span>
          )}
          <Choice
            value={g.status}
            editable={editable}
            label={`האם הושגה: ${g.goal || `מטרה ${i + 1}`}`}
            options={(['met', 'partial', 'missed'] as const).map((s) => ({ value: s, label: GOAL_STATUS_LABELS[s], tone: GOAL_TONES[s] }))}
            onChange={(s) => (patch(i, { status: s }), onDone())}
          />
          {editable ? (
            <input className="input goal-note" value={g.note} placeholder="למה? (משפט אחד)" aria-label={`הסבר למטרה ${i + 1}`} onChange={(e) => patch(i, { note: e.target.value })} onBlur={onDone} />
          ) : (
            g.note && <span className="goal-note small muted">{g.note}</span>
          )}
          {editable && i < value.length && (
            <button type="button" className="icon-btn goal-del" aria-label={`הסרת מטרה ${i + 1}`} onClick={() => (onChange(value.filter((_, j) => j !== i)), onDone())}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([...rows, { goal: '', status: '', note: '' }])}>
          <Icon name="plus" /> מטרה
        </button>
      )}
    </div>
  );
}

function Numbers({ fields, value, editable, onChange, onDone }: { fields: { id: string; label: string }[]; value: Record<string, number>; editable: boolean; onChange: (v: Record<string, number>) => void; onDone: () => void }) {
  const rate = value.started > 0 && typeof value.finished === 'number' ? Math.round((value.finished / value.started) * 100) : null;
  return (
    <div className="dq-numbers">
      {fields.map((f) => (
        <label key={f.id} className="field">
          <span>{f.label}</span>
          {editable ? (
            <input
              className="input mono"
              type="number"
              inputMode="numeric"
              min={0}
              max={9999}
              value={value[f.id] ?? ''}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value === '') delete next[f.id];
                else next[f.id] = Math.max(0, Math.round(Number(e.target.value)));
                onChange(next);
              }}
              onBlur={onDone}
            />
          ) : (
            <span className="dq-big mono">{value[f.id] ?? '-'}</span>
          )}
        </label>
      ))}
      {rate !== null && (
        <div className="dq-rate">
          <span className="label-caps">סיימו</span>
          <span className={`dq-big mono ${rate >= 90 ? 'text-green' : rate < 75 ? 'text-red' : ''}`}>{rate}%</span>
        </div>
      )}
    </div>
  );
}

function LessonsCard({
  n,
  horizon,
  data,
  items,
  editable,
  run,
}: {
  n: number;
  horizon: LessonHorizon;
  data: DebriefDetail;
  items: DebriefItem[];
  editable: boolean;
  run: (fn: () => Promise<DebriefDetail>, ok?: string) => Promise<boolean>;
}) {
  const d = data.debrief;
  const { title, hint } = LESSON_HORIZON_LABELS[d.kind][horizon];
  const now = horizon === 'now';
  return (
    <section id={ANCHOR(horizon)} className={`card dsec dsec-lessons ${now ? 't-orange' : 't-blue'}`} aria-labelledby={`${ANCHOR(horizon)}-h`}>
      <div className="card-head">
        <span className="dsec-num">{n}</span>
        <h2 className="grow" id={`${ANCHOR(horizon)}-h`}>
          {title}
        </h2>
        <span className="mono tiny muted">{items.length}</span>
      </div>
      <div className="card-body col lessons-body">
        {hint && <p className="small muted">{hint}</p>}
        {items.map((l) => (
          <LessonRow key={l.id} lesson={l} now={now} editable={editable} run={run} />
        ))}
        {!items.length && !editable && <p className="muted">-</p>}
        {editable && <AddLesson debriefId={d.id} horizon={horizon} run={run} first={!items.length} />}
      </div>
    </section>
  );
}

function OwnerSelect({ value, onChange, required, label }: { value: number | null; onChange: (v: number | null) => void; required: boolean; label: string }) {
  const { users } = useSession();
  return (
    <Select className={`select${required && !value ? ' missing' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label={label} aria-invalid={required && !value}>
      <option value="">{required ? 'אחראי...' : 'אחראי (לא חובה)'}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.displayName}
        </option>
      ))}
    </Select>
  );
}

function LessonRow({ lesson: l, now, editable, run }: { lesson: DebriefItem; now: boolean; editable: boolean; run: (fn: () => Promise<DebriefDetail>, ok?: string) => Promise<boolean> }) {
  const [body, setBody] = useState(l.body);
  // someone else edited it: show theirs unless this one is being typed
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setBody(l.body);
  }, [l.body]);
  const patch = (p: Record<string, unknown>) => run(() => api.patch<DebriefDetail>(`/api/debrief-items/${l.id}`, p));
  const locked = !editable || !!l.taskId;
  return (
    <div className={`lesson-row${now && !l.taskId && (!l.ownerId || !l.dueDate) ? ' incomplete' : ''}`}>
      {locked ? (
        <div className="lesson-body prewrap">{l.body}</div>
      ) : (
        <textarea
          className="textarea lesson-body"
          value={body}
          aria-label="הלקח"
          onFocus={() => (typing.current = true)}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => {
            typing.current = false;
            if (body.trim() && body.trim() !== l.body) void patch({ body: body.trim() });
            else setBody(l.body);
          }}
        />
      )}
      <div className="lesson-meta">
        {l.taskId ? (
          <Link to={`/tasks/${l.taskId}`} className="badge t-blue">
            <Icon name="tasks" size={11} /> משימה · {l.ownerName} · {l.taskStatus ? STATUS_LABELS[l.taskStatus] : ''}
          </Link>
        ) : locked ? (
          <span className="tiny muted">
            {[l.ownerName && `אחראי: ${l.ownerName}`, l.dueDate && `עד ${shortDate(l.dueDate)}`, !now && l.target && `יוצג ב: ${l.target}`].filter(Boolean).join(' · ')}
          </span>
        ) : (
          <>
            <OwnerSelect value={l.ownerId} onChange={(v) => void patch({ ownerId: v })} required={now} label="אחראי ללקח" />
            {now && (
              <DateInput
                className={`input mono${l.dueDate ? '' : ' missing'}`}
                value={l.dueDate ?? ''}
                min={todayKey()}
                aria-label="עד מתי"
                aria-invalid={!l.dueDate}
                onChange={(v) => void patch({ dueDate: v || null })}
              />
            )}
            {!now && l.target && <span className="tiny muted">יוצג ב: {l.target}</span>}
          </>
        )}
        {editable && (
          <button className="icon-btn lesson-del" aria-label="מחיקת הלקח" onClick={async () => (await ask({ title: 'למחוק את הלקח?', body: l.taskId ? 'המשימה שנפתחה ממנו תישאר.' : undefined, confirm: 'מחיקה', danger: true })) && void run(() => api.del<DebriefDetail>(`/api/debrief-items/${l.id}`))}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function AddLesson({ debriefId, horizon, run, first }: { debriefId: number; horizon: LessonHorizon; run: (fn: () => Promise<DebriefDetail>, ok?: string) => Promise<boolean>; first: boolean }) {
  const now = horizon === 'now';
  const [body, setBody] = useState('');
  const [owner, setOwner] = useState<number | null>(null);
  const [due, setDue] = useState(addDays(todayKey(), 7));
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await run(() => api.post<DebriefDetail>(`/api/debriefs/${debriefId}/items`, { kind: 'lesson', horizon, body: body.trim(), ownerId: owner, dueDate: now ? due || null : null }));
    setBusy(false);
    if (ok) {
      setBody('');
      setOwner(null);
    }
  };
  return (
    <form
      className="lesson-row lesson-new"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <textarea
        className="textarea lesson-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void add();
          }
        }}
        placeholder={now ? (first ? 'מה עושים אחרת מעכשיו? לדוגמה: תדריך בטיחות יום לפני כל תרגיל' : 'לקח נוסף...') : first ? 'מה כדאי שהמחזור הבא יידע? לדוגמה: להקדים את התרגיל ליום שני' : 'לקח נוסף...'}
        aria-label={now ? 'לקח חדש להמשך המחזור' : 'לקח חדש למחזור הבא'}
        data-transient
      />
      <div className="lesson-meta">
        <OwnerSelect value={owner} onChange={setOwner} required={false} label="אחראי ללקח החדש" />
        {now && <DateInput value={due} min={todayKey()} onChange={(v) => setDue(v)} aria-label="עד מתי" />}
        <button className="btn btn-sm" disabled={!body.trim() || busy}>
          <Icon name="plus" /> הוספה
        </button>
      </div>
    </form>
  );
}

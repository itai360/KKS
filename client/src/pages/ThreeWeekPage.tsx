// The three-week plan (אישור תוכניות תלת שבועי, server/src/plans.ts): the week now and the three after it
// in one document, to present the coming weeks to the commander above at once - day by day, the
// milestones and how ready they are, each week's goals and where its own plan stands, the risks, the
// staff, the cadets and what is asked of the commander above - and to record their approval. The arrows
// (and a swipe on a phone) move it a week back or on.

import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { ABSENCE_REASON_LABELS } from '@shared/constants';
import { addDays, diffDays, shortDate, weekdayName } from '@shared/dates';
import type { PlanEvent, ThreeWeekPlan, ThreeWeekWeek, Week } from '@shared/types';
import { DocPager, ShareButton, useDocNav, type DocLink } from '../components/DocNav';
import { PlanCalendars, useReloadWhileLoading } from '../components/GoogleCalendar';
import { Icon } from '../components/Icon';
import { ApproveDialog, dateRange, EditButton, EditDialog, KIND_LABELS, PLAN_STATUS, Prep, StatusSteps, whenOf, Wording } from '../components/PlanParts';
import { SectionRail, type RailItem } from '../components/SectionRail';
import { useToast } from '../components/Toasts';
import { Empty, Loading, Modal, PageError, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi } from '../lib/useApi';

const TOPICS = ['plans', 'weeks', 'events', 'tasks', 'users', 'cadets', 'debriefs'];
const NAME = 'אישור תוכניות תלת שבועי';
/** "של ארבעת השבועות" - what the approval keeps */
const SCOPE = ['של השבוע', 'של השבוע', 'של שני השבועות', 'של שלושת השבועות', 'של ארבעת השבועות'];

/** the days of a week, first to last - and the days after it up to the next week (a weekend), to a row of seven */
function daysOf(w: Week, next: Week | undefined): string[] {
  const gap = next ? addDays(next.startDate, -1) : w.endDate;
  const row = addDays(w.startDate, 6);
  const until = gap > w.endDate ? (gap < row ? gap : row > w.endDate ? row : w.endDate) : w.endDate;
  const out: string[] = [];
  for (let d = w.startDate; d <= until && out.length < 14; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "היום", "מחר", "בעוד 5 ימים" - or that it is behind */
function untilLabel(date: string, today: string): string {
  const n = diffDays(date, today);
  return n < 0 ? 'עבר' : n === 0 ? 'היום' : n === 1 ? 'מחר' : n === 2 ? 'בעוד יומיים' : `בעוד ${n} ימים`;
}

const weeksLabel = (a: number, b: number) => (a === b ? `שבוע ${a}` : `שבועות ${a}-${b}`);

/** how far a week's preparation tasks are */
function Readiness({ w }: { w: Week }) {
  if (!w.totalTasks) return <span className="muted">אין משימות הכנה</span>;
  return (
    <span className="tw-ready">
      <span className="bar" aria-hidden="true">
        <span style={{ width: `${w.readiness}%` }} className={w.readiness === 100 ? 'ok' : w.readiness < 50 ? 'low' : ''} />
      </span>
      <span className="mono">
        {w.readiness}% ({w.doneTasks}/{w.totalTasks})
      </span>
      {w.overdueTasks > 0 && <span className="text-red strong">{w.overdueTasks} באיחור</span>}
    </span>
  );
}

/** a week at a glance: where its own plan stands, its lead, how ready it is, its key activities */
function WeekCard({ part, today }: { part: ThreeWeekWeek; today: string }) {
  const { week: w, plan, key } = part;
  const now = w.startDate <= today && w.endDate >= today;
  return (
    <div className={`plan-week tw-week${now ? ' this' : ''}`}>
      <div className="row gap-6 wrap">
        {now && <span className="badge t-orange">השבוע</span>}
        <Link to={`/plans/${w.id}`} className={`badge ${PLAN_STATUS[plan.status].tone}`} title="התוכנית השבועית של השבוע הזה">
          תוכנית שבועית: {PLAN_STATUS[plan.status].label}
        </Link>
        {plan.changed && <span className="badge t-yellow">השתנה מאז האישור</span>}
      </div>
      <Link to={`/weeks/${w.id}`} className="strong tw-week-name">
        שבוע {w.number} · {w.name}
      </Link>
      {w.topic && <div className="small muted">{w.topic}</div>}
      <div className="tiny muted mono">{dateRange(w.startDate, w.endDate)}</div>
      <div className="tiny tw-week-facts">
        <span>
          <span className="muted">מפק"צ השבוע: </span>
          {w.leadName ?? <span className="text-orange">לא נקבע</span>}
        </span>
        <span>
          <span className="muted">מוכנות: </span>
          <Readiness w={w} />
        </span>
      </div>
      {key.length ? (
        <ul>
          {key.slice(0, 5).map((e) => (
            <li key={e.key}>
              <span className="mono tiny">{shortDate(e.date)}</span> {e.title} <span className={`plan-kind k-${e.kind}`}>{KIND_LABELS[e.kind]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="small muted mt-8">אין עדיין אירועי מפתח</div>
      )}
      {key.length > 5 && <div className="tiny muted">ועוד {key.length - 5} אירועי מפתח</div>}
    </div>
  );
}

/** a main block on a day: its hour, name and kind - a later day of one over several days says it goes on */
function Activity({ e, day }: { e: PlanEvent; day: string }) {
  const goesOn = day !== e.date;
  return (
    <>
      {e.startTime && !goesOn && <span className="mono tiny tw-time">{e.startTime}</span>}
      <span className="tw-act">{e.title}</span>
      {goesOn ? <span className="tiny muted"> (המשך)</span> : <span className={`plan-kind k-${e.kind}`}>{KIND_LABELS[e.kind]}</span>}
      {e.night && !goesOn && <span className="plan-kind k-night">לילה</span>}
      {e.location && !goesOn && <span className="tiny muted tw-where"> · {e.location}</span>}
    </>
  );
}

/** a day shows this many activities, then says how many more */
const DAY_LINES = 6;

/** one week, day by day: the main blocks of each day (one that began the week before goes on in it) */
function WeekDays({ part, next, all, today }: { part: ThreeWeekWeek; next: Week | undefined; all: PlanEvent[]; today: string }) {
  const { week: w } = part;
  const days = daysOf(w, next).map((d) => ({ d, key: all.filter((e) => e.date <= d && e.endDate >= d) }));
  const empty = (i: number) => !!days[i] && !days[i].key.length && days[i].d !== today;
  // a phone lists the days one under the other: days in a row with nothing on them fold into one line there
  const runEnd = (i: number) => {
    let j = i;
    while (empty(j + 1)) j++;
    return j;
  };
  return (
    <div className="tw-block">
      <h3>
        שבוע {w.number} · {w.name} <span className="tiny muted mono">{dateRange(w.startDate, w.endDate)}</span>
      </h3>
      <div className="tw-days" style={{ '--days': days.length } as CSSProperties}>
        {days.map(({ d, key }, i) => {
          const starts = empty(i) && !empty(i - 1) && runEnd(i) > i;
          const inRun = empty(i) && (empty(i - 1) || runEnd(i) > i);
          const run = starts ? days[runEnd(i)].d : null;
          return (
            <Fragment key={d}>
              {run && (
                <div className="tw-day tw-run is-empty" aria-hidden="true">
                  <div className="tw-day-head">
                    <b>
                      {weekdayName(d)}-{weekdayName(run)}
                    </b>{' '}
                    <span className="mono">{dateRange(d, run)}</span>
                  </div>
                  <div className="tiny muted">-</div>
                </div>
              )}
              <div
                className={`tw-day${d === today ? ' is-today' : ''}${key.length ? '' : ' is-empty'}${d > w.endDate ? ' is-off' : ''}${inRun ? ' in-run' : ''}`}
                aria-current={d === today ? 'date' : undefined}
                title={d > w.endDate ? 'אחרי סוף השבוע בקורס' : undefined}
              >
                <div className="tw-day-head">
                  <b>{weekdayName(d)}</b> <span className="mono">{shortDate(d)}</span>
                </div>
                {key.length > 0 && (
                  <ul>
                    {key.slice(0, DAY_LINES).map((e) => (
                      <li key={e.key}>
                        <Activity e={e} day={d} />
                      </li>
                    ))}
                  </ul>
                )}
                {key.length > DAY_LINES && <div className="tiny muted">ועוד {key.length - DAY_LINES}</div>}
                {!key.length && <div className="tiny muted">-</div>}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function ThreeWeekPage() {
  const { weekId } = useParams();
  const toast = useToast();
  const { settings, weeks, viewing } = useSession();
  const { data: doc, error, status, loading, setData, reload } = useApi<ThreeWeekPlan>(weeks.length ? (weekId ? `/api/three-week/${weekId}` : '/api/three-week') : null, TOPICS);
  // a big Google calendar still on its way: the document asks again until its blocks are in
  useReloadWhileLoading(!!doc?.calendars.some((c) => c.loading), reload, doc);
  const [editing, setEditing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [calendars, setCalendars] = useState(false);
  // the approval just recorded: its line at the foot of the document comes in, stamped
  const [justApproved, setJustApproved] = useState(false);
  useEffect(() => {
    if (!justApproved) return;
    document.querySelector('.plan-approval')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    const t = setTimeout(() => setJustApproved(false), 2200);
    return () => clearTimeout(t);
  }, [justApproved]);
  const first = doc?.weeks[0]?.week;
  const last = doc?.weeks[doc.weeks.length - 1]?.week;
  usePageTitle(first && last ? `${NAME} - ${weeksLabel(first.number, last.number)}` : NAME);
  // the four weeks from a week earlier and a week later: the arrows, a swipe on a phone
  const page = useRef<HTMLDivElement>(null);
  const at = weeks.findIndex((x) => x.id === (doc?.startWeekId ?? Number(weekId)));
  const link = (i: number): DocLink | null => {
    const x = weeks[i];
    const y = weeks[Math.min(i + 3, weeks.length - 1)];
    return x ? { to: `/three-week/${x.id}`, label: weeksLabel(x.number, y.number), api: `/api/three-week/${x.id}` } : null;
  };
  const prev = at > 0 ? link(at - 1) : null;
  const next = at >= 0 && at + 1 < weeks.length ? link(at + 1) : null;
  useDocNav({ prev, next, swipe: page });

  if (!weeks.length)
    return (
      <div className="page">
        <PageHead title={NAME} />
        <Empty
          icon="layers"
          title="אין עדיין שבועות בקורס"
          text={
            <>
              התוכנית נבנית לפי שבועות הקורס. <Link to="/weeks">להגדרת השבועות</Link>
            </>
          }
        />
      </div>
    );
  if (loading && !doc)
    return (
      <div className="page" ref={page}>
        <Loading rows={7} />
      </div>
    );
  if (!doc || !first || !last)
    return (
      <div className="page" ref={page}>
        <PageError error={error} status={status} what="התוכנית התלת שבועית" back="/plans" backLabel="לאישור תוכניות" />
      </div>
    );

  const today = todayKey();
  const canEdit = !viewing;
  const span = doc.weeks.length;
  const label = weeksLabel(first.number, last.number);
  const approvedWeeks = doc.weeks.filter((p) => p.plan.status === 'approved').length;
  const ready = doc.readiness;
  const allKey = doc.weeks.flatMap((p) => p.key);
  const weekOf = (date: string) => doc.weeks.find((p) => p.week.startDate <= date && p.week.endDate >= date)?.week;
  const lessons = doc.weeks.filter((p) => p.lessons.total > 0);

  const save = async (body: Record<string, unknown>, done?: string) => {
    const d = await api.patch<ThreeWeekPlan>(`/api/three-week/${doc.startWeekId}`, body);
    setData(d);
    emitLocalChange('plans');
    if (done) toast({ title: done, tone: 'green' });
  };
  const setStatus = (s: 'draft' | 'ready', done: string) => void save({ status: s }, done).catch((e: Error) => toast({ title: e.message, tone: 'red' }));

  const parts: RailItem[] = [
    ['tw-bluf', 'השורה התחתונה'],
    ['tw-glance', 'ארבעת השבועות'],
    ['tw-days', 'יום אחר יום'],
    ['tw-milestones', 'אבני דרך'],
    ['tw-goals', 'מטרות'],
    ['tw-risks', 'סיכונים'],
    ['tw-staff', 'סגל'],
    ['tw-cadets', 'צוערים'],
    ...(lessons.length ? [['tw-lessons', 'לקחים']] : []),
    ['tw-requests', 'בקשות'],
  ].map(([id, name], i) => ({ id, label: name, n: i + 1 }));
  const n = (id: string) => parts.find((p) => p.id === id)?.n;

  return (
    <div className="page doc-page" ref={page}>
      <div className="doc-toolbar no-print">
        <DocPager prev={prev} next={next} noun="התוכניות התלת שבועיות" position={doc.current ? 'מהשבוע הנוכחי' : undefined} />
        <StatusSteps status={doc.status} />
        {doc.changes.length > 0 && <span className="badge t-yellow">השתנה מאז האישור</span>}
        <span className="grow" />
        {!doc.current && (
          <Link className="btn btn-ghost" to="/three-week">
            מהשבוע הנוכחי
          </Link>
        )}
        {canEdit && doc.status === 'draft' && (
          <button className="btn" onClick={() => setStatus('ready', 'המסמך מסומן כמוכן להצגה')}>
            <Icon name="check" /> מוכן להצגה
          </button>
        )}
        {canEdit && doc.status === 'ready' && (
          <button className="btn btn-ghost" onClick={() => setStatus('draft', 'המסמך חזר לטיוטה')}>
            חזרה לטיוטה
          </button>
        )}
        {canEdit && doc.status === 'approved' && (
          <button className="btn btn-ghost" onClick={() => setStatus('ready', 'האישור בוטל')}>
            ביטול האישור
          </button>
        )}
        {canEdit && (
          <button className="btn" onClick={() => setApproving(true)}>
            <Icon name="shield" /> {doc.status === 'approved' ? 'עדכון האישור' : 'רישום אישור'}
          </button>
        )}
        <ShareButton title={`${NAME} - ${label}`} />
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
      </div>

      {/* where the activities come from: the course's schedule and each Google calendar, by the name it has there */}
      <div className={`tw-sources no-print${doc.calendars.some((c) => c.error) ? ' has-error' : ''}`} role="note">
        <Icon name="calendar" size={16} />
        <span className="grow">
          {doc.calendars.length ? (
            <>
              הלבנות העיקריות נמשכות מהלו"ז של הקורס ומ{doc.calendarsFrom === 'plan' ? 'יומן התוכנית' : 'יומני הלו"ז'}:{' '}
              {doc.calendars.map((c, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <b>{c.name}</b>{' '}
                  <span className="muted">{c.loading ? '(Google עוד שולח את היומן - הלבנות שלו יופיעו בעוד רגע)' : `(${c.count === 1 ? 'לבנה אחת' : `${c.count} לבנות`} בתקופה)`}</span>
                  {c.error && <span className="text-red"> - {c.error}</span>}
                </span>
              ))}
            </>
          ) : (
            <>הנתונים נמשכים מהלו"ז של הקורס בלבד. כדי למשוך גם את הלבנות העיקריות מיומן Google - בחרו יומן לתוכנית.</>
          )}
        </span>
        {canEdit && (
          <button type="button" className={`btn btn-sm${doc.calendarsFrom === 'plan' ? ' btn-ghost' : ''}`} onClick={() => setCalendars(true)}>
            {doc.calendarsFrom === 'plan' ? 'יומן התוכנית' : 'בחירת יומן לתוכנית'}
          </button>
        )}
      </div>

      <SectionRail label="חלקי המסמך" items={parts} />
      <article className="doc plan-doc tw-doc" aria-label={`${NAME} - ${label}`}>
        <header className="doc-head">
          <div className="doc-kicker">{settings.courseName}</div>
          <h1 data-bar-title={`תלת שבועי - ${label}`}>{NAME}</h1>
          <div className="doc-title">
            {label} · {dateRange(first.startDate, last.endDate)}
          </div>
          {doc.current && span > 1 && <div className="small muted">השבוע הנוכחי ו{span === 4 ? 'שלושת השבועות הבאים' : span === 3 ? 'שני השבועות הבאים' : 'השבוע הבא'}</div>}
          <table className="doc-meta">
            <tbody>
              <tr>
                <th>תקופה</th>
                <td className="mono">
                  {dateRange(first.startDate, last.endDate)} ({diffDays(last.endDate, first.startDate) + 1} ימים)
                </td>
                <th>מיקום בקורס</th>
                <td>
                  {doc.position.first === doc.position.last ? `שבוע ${doc.position.first}` : `שבועות ${doc.position.first}-${doc.position.last}`} מתוך {doc.position.total}
                  {doc.position.daysLeft !== null && ` · ${doc.position.daysLeft} ימים לסיום`}
                </td>
              </tr>
              <tr>
                <th>מוכנות</th>
                <td>
                  {ready.total ? `${Math.round((ready.done / ready.total) * 100)}% (${ready.done}/${ready.total} משימות הכנה)` : 'אין משימות הכנה'}
                  {ready.overdue > 0 && <span className="text-red strong"> · {ready.overdue} באיחור</span>}
                </td>
                <th>תוכניות שבועיות</th>
                <td>
                  {approvedWeeks} מתוך {span} אושרו
                </td>
              </tr>
            </tbody>
          </table>
          <div className="plan-progress" role="img" aria-label={`${label} מתוך ${doc.position.total} שבועות בקורס`}>
            {Array.from({ length: doc.position.total }, (_, i) => (
              <span key={i} className={i + 1 < doc.position.first ? 'past' : i + 1 <= doc.position.last ? 'now' : ''} />
            ))}
          </div>
        </header>

        {doc.changes.length > 0 && (
          <div className="plan-changes" role="note">
            <b>השתנה מאז האישור ב-{doc.approval ? shortDate(doc.approval.on) : ''}:</b>
            <ul>
              {doc.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <section id="tw-bluf">
          <div className="plan-h2">
            <h2>{n('tw-bluf')}. השורה התחתונה</h2>
            <Wording edited={doc.bluf.edited} />
            {canEdit && <EditButton label="השורה התחתונה" onClick={() => setEditing(true)} />}
          </div>
          <p className="plan-bluf">{doc.bluf.text}</p>
        </section>

        <section id="tw-glance">
          <h2>
            {n('tw-glance')}. {span === 4 ? 'ארבעת השבועות' : 'השבועות'} במבט אחד
          </h2>
          <div className="plan-horizon">
            {doc.weeks.map((p) => (
              <WeekCard key={p.week.id} part={p} today={today} />
            ))}
            {span < 4 && (
              <div className="plan-week end">
                <div className="strong">סיום הקורס</div>
              </div>
            )}
          </div>
        </section>

        <section id="tw-days">
          <h2>{n('tw-days')}. לו"ז מפתח - יום אחר יום</h2>
          {doc.weeks.map((p, i) => (
            <WeekDays key={p.week.id} part={p} next={doc.weeks[i + 1]?.week} all={allKey} today={today} />
          ))}
          <p className="tiny muted no-print">
            הלבנות העיקריות בלבד, מהלו"ז של הקורס ומיומן התוכנית: מבחנים, טקסים, תרגילים, ניווטים, מטווחים, ביקורים ובלוקים של כמה ימים. שיעורים, שגרה ופעילויות קטנות לא מוצגים. <Link to="/schedule">ללו"ז המלא</Link>
          </p>
        </section>

        <section id="tw-milestones">
          <h2>{n('tw-milestones')}. אבני דרך ומוכנות</h2>
          {doc.milestones.length ? (
            <table className="doc-table plan-events tw-milestones">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>מתי</th>
                  <th>פעילות</th>
                  <th style={{ width: '16%' }}>אחראי</th>
                  <th style={{ width: 110 }}>הכנות</th>
                  <th style={{ width: 92 }}>עוד</th>
                </tr>
              </thead>
              <tbody>
                {doc.milestones.map((e) => (
                  <tr key={e.key} className={e.endDate < today ? 'done' : ''}>
                    <td className="mono">
                      {whenOf(e)}
                      {e.startTime && e.endDate === e.date && <div className="tiny muted">{e.startTime}{e.endTime ? `-${e.endTime}` : ''}</div>}
                    </td>
                    <td>
                      {e.title} <span className={`plan-kind k-${e.kind}`}>{KIND_LABELS[e.kind]}</span>
                      {e.night && <span className="plan-kind k-night">לילה</span>}
                      <div className="tiny muted">
                        {weekOf(e.date) ? `שבוע ${weekOf(e.date)!.number}` : ''}
                        {e.location && ` · ${e.location}`}
                      </div>
                    </td>
                    {/* an activity from a connected calendar has no one in charge to name */}
                    <td>{e.ownerName ?? (e.source === 'course' ? <span className="text-orange">ללא אחראי</span> : '-')}</td>
                    <td>
                      <Prep e={e} />
                    </td>
                    <td className="small">{untilLabel(e.date, today)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              אין עדיין מבחנים, טקסים, תרגילים, ניווטים או מטווחים בלו"ז של התקופה. <Link className="no-print" to="/schedule">ללו"ז</Link>
            </p>
          )}
          <h3>מוכנות לפי שבוע</h3>
          <ul className="doc-list tw-ready-list">
            {doc.weeks.map((p) => (
              <li key={p.week.id}>
                <b>
                  שבוע {p.week.number} · {p.week.name}:
                </b>{' '}
                <Readiness w={p.week} />
              </li>
            ))}
          </ul>
        </section>

        <section id="tw-goals">
          <h2>{n('tw-goals')}. מטרות לפי שבוע</h2>
          {doc.weeks.map((p) => (
            <div key={p.week.id} className="tw-goals">
              <div className="plan-h2">
                <h3>
                  שבוע {p.week.number} · {p.week.name}
                </h3>
                <Wording edited={p.goals.edited} />
                <Link className="btn btn-ghost btn-sm no-print" to={`/plans/${p.week.id}#plan-goals`}>
                  לתוכנית השבוע <Icon name="chevronLeft" size={14} />
                </Link>
              </div>
              <ol className="doc-list">
                {p.goals.items.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ol>
            </div>
          ))}
        </section>

        <section id="tw-risks">
          <h2>{n('tw-risks')}. סיכונים ומענה</h2>
          {doc.risks.length ? (
            <table className="doc-table plan-risks">
              <thead>
                <tr>
                  <th>נקודה</th>
                  <th style={{ width: '40%' }}>מענה</th>
                </tr>
              </thead>
              <tbody>
                {doc.risks.map((r, i) => (
                  <tr key={i} className={r.level}>
                    <td>
                      <span className={`plan-level ${r.level}`}>{r.level === 'high' ? 'גבוה' : 'בינוני'}</span>
                      {r.weekNumber !== null && <span className="tw-risk-week">שבוע {r.weekNumber}</span>} {r.text}
                    </td>
                    <td>{r.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">לא זוהו נקודות שדורשות מענה מיוחד.</p>
          )}
        </section>

        <section id="tw-staff">
          <h2>{n('tw-staff')}. סגל וכוח אדם</h2>
          <h3>מפק"צי השבועות</h3>
          <ul className="doc-list">
            {doc.weeks.map((p) => (
              <li key={p.week.id}>
                <b>
                  שבוע {p.week.number} · {p.week.name}:
                </b>{' '}
                {p.week.leadName ?? <span className="text-orange">לא נקבע מפק"צ</span>}
              </li>
            ))}
          </ul>
          <h3>היעדרויות סגל בתקופה</h3>
          {doc.absences.length ? (
            <ul className="doc-list">
              {doc.absences.map((a) => {
                const owns = allKey.filter((e) => e.ownerName === a.userName && e.date <= a.endDate && e.endDate >= a.startDate);
                return (
                  <li key={a.id}>
                    <b>{a.userName}</b> <span className="mono">{dateRange(a.startDate, a.endDate)}</span> · {ABSENCE_REASON_LABELS[a.reason]}
                    {a.note && ` - ${a.note}`}
                    {owns.length > 0 && <span className="text-red strong"> · אחראי על {owns.map((e) => e.title).join(', ')} באותם ימים</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">אין היעדרויות סגל רשומות בתקופה.</p>
          )}
        </section>

        <section id="tw-cadets">
          <h2>{n('tw-cadets')}. תמונת מצב צוערים</h2>
          <div className="plan-kpis">
            <div>
              <b>{doc.cadets.active}</b>
              <span>צוערים פעילים</span>
            </div>
            <div>
              <b>{doc.cadets.dropped}</b>
              <span>הודחו / פרשו</span>
            </div>
            <div className={doc.cadets.watch ? 'warn' : ''}>
              <b>{doc.cadets.watch}</b>
              <span>במעקב</span>
            </div>
            <div className={doc.cadets.risk ? 'bad' : ''}>
              <b>{doc.cadets.risk}</b>
              <span>בסיכון</span>
            </div>
            <div className={doc.cadets.committees ? 'warn' : ''}>
              <b>{doc.cadets.committees}</b>
              <span>בוועדת הערכה</span>
            </div>
            <div className={doc.cadets.twoNotes ? 'warn' : ''}>
              <b>{doc.cadets.twoNotes}</b>
              <span>עם 2 הערות משמעת</span>
            </div>
          </div>
        </section>

        {lessons.length > 0 && (
          <section id="tw-lessons">
            <h2>{n('tw-lessons')}. לקחים מהמחזור הקודם</h2>
            {lessons.map((p) => (
              <div key={p.week.id}>
                <h3>
                  שבוע {p.week.number} · {p.week.name}{' '}
                  <span className="tiny muted">
                    {p.lessons.total === 1 ? 'לקח אחד' : `${p.lessons.total} לקחים`}
                    {p.lessons.open > 0 && ` · ${p.lessons.open} עוד בלי החלטה`}
                  </span>
                </h3>
                <ul className="doc-list">
                  {p.lessons.items.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                  {p.lessons.total > p.lessons.items.length && <li className="muted">ועוד {p.lessons.total - p.lessons.items.length} בתוכנית השבוע</li>}
                </ul>
              </div>
            ))}
          </section>
        )}

        <section id="tw-requests">
          <h2>{n('tw-requests')}. בקשות מהמפקד הממונה</h2>
          {doc.requests.length ? (
            <ol className="doc-list">
              {doc.requests.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">אין בקשות מיוחדות לתקופה.</p>
          )}
          {doc.visit && (
            <div className="plan-visit">
              <Icon name="flag" size={16} />
              <span>
                <b>הזמן הטוב לבקר בקורס:</b> {doc.visit.title}, {doc.visit.endDate !== doc.visit.date ? '' : 'יום '}
                {whenOf(doc.visit)}
                {doc.visit.startTime && doc.visit.endDate === doc.visit.date && `, ${doc.visit.startTime}${doc.visit.endTime ? `-${doc.visit.endTime}` : ''}`}
                {doc.visit.location && `, ${doc.visit.location}`}
              </span>
            </div>
          )}
        </section>

        <footer className="doc-foot">
          {doc.approval ? (
            <div className={`plan-approval${justApproved ? ' just-approved' : ''}`}>
              <div>
                <Icon name="check" size={16} /> <b>אושר</b> ע"י {doc.approval.by}, ב-<span className="mono">{shortDate(doc.approval.on)}</span>
              </div>
              {doc.approval.notes && (
                <div className="mt-8">
                  <b>הערות והנחיות המאשר:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{doc.approval.notes}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="doc-sign">
              <div>
                <span>מאשר (דרגה, שם ותפקיד)</span>
                <span className="line" />
              </div>
              <div>
                <span>תאריך וחתימה</span>
                <span className="line" />
              </div>
              <div className="span-2">
                <span>הערות והנחיות המאשר</span>
                <span className="line" />
                <span className="line" />
              </div>
            </div>
          )}
          <div className="tiny muted">
            הופק ב-{shortDate(today)} ממערכת ניהול הקורס{doc.calendars.length > 0 && `, מהלו"ז ומיומן Google: ${doc.calendars.map((c) => c.name).join(', ')}`}
            {doc.updatedByName && doc.updatedAt && ` · נערך לאחרונה ע"י ${doc.updatedByName}`}
          </div>
        </footer>
      </article>

      {editing && (
        <EditDialog
          title="השורה התחתונה"
          initial={doc.bluf.text}
          edited={doc.bluf.edited}
          single
          hint="כמה משפטים שמסכמים את התקופה למי שיש לו שתי דקות."
          onSave={(value) => save({ bluf: value === null ? null : value.trim() })}
          onClose={() => setEditing(false)}
        />
      )}
      {calendars && (
        <Modal
          title="יומן התוכנית"
          onClose={() => setCalendars(false)}
          footer={
            <button type="button" className="btn btn-ghost" onClick={() => setCalendars(false)}>
              סגירה
            </button>
          }
        >
          <PlanCalendars />
        </Modal>
      )}
      {approving && (
        <ApproveDialog<ThreeWeekPlan>
          name={`${NAME} - ${label}`}
          approval={doc.approval}
          url={`/api/three-week/${doc.startWeekId}/approve`}
          scope={SCOPE[span] ?? SCOPE[4]}
          onClose={() => setApproving(false)}
          onDone={(d) => {
            setData(d);
            setApproving(false);
            emitLocalChange('plans');
            haptic('success');
            setJustApproved(true);
            toast({ title: 'האישור נרשם', tone: 'green' });
          }}
        />
      )}
    </div>
  );
}

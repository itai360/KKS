// Sections 4, 5, 32, 49 - the commander's home: understand the course in 10 seconds.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ABSENCE_REASON_LABELS, ATTENDANCE_LABELS, ATTENDANCE_STATUSES, ATTENDANCE_TONES } from '@shared/constants';
import type { AttentionItem, AttentionKind, DashboardData, ScheduleEvent } from '@shared/types';
import { staffHealthLabel } from '@shared/taskLogic';
import { PendingAnnouncements } from '../components/Announcements';
import { CheckMark } from '../components/CheckMark';
import { Decided, useDecision } from '../components/Decision';
import { DisciplineCard } from '../components/DisciplineCard';
import { DoneDrawer } from '../components/DoneDrawer';
import { Icon } from '../components/Icon';
import { WeeklyCard } from '../components/WeeklyCard';
import { useNewTask } from '../components/NewTask';
import { Bar, CountUp, Empty, ErrorBox, Loading, openable, PageHead, Ring } from '../components/ui';
import { api } from '../lib/api';
import { endMinutes, inMinutes, leftMinutes, nowAndNext } from '../lib/agenda';
import { fmtDeadline, fmtLongDate, fmtTime, greetName, greeting, todayKey } from '../lib/format';
import { leaveClass, useLeaving, type LeavePhase } from '../lib/leaving';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';
import { shortDate } from '@shared/dates';

const KIND_LABEL: Record<AttentionKind, string> = {
  overdue: 'באיחור',
  due_soon: 'דד-ליין קרוב',
  stale: 'לא עודכן',
  blocked: 'חסם',
  approval: 'ממתין לאישורך',
  request: 'בקשה',
  decision: 'נדרשת החלטה',
  readiness: 'מוכנות נמוכה',
  overload: 'עומס',
  debrief: 'תחקיר שבועי',
  lessons: 'לקחי המחזור הקודם',
  away: 'היעדרות',
};

export function DashboardPage() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApi<DashboardData>('/api/dashboard', ['tasks', 'weeks', 'events', 'requests', 'cadets']);
  const navigate = useNavigate();
  const newTask = useNewTask();
  const [cmd, setCmd] = useState('');
  useTick();

  return (
    <div className="page dashboard-page">
      <PageHead
        eyebrow={fmtLongDate(todayKey())}
        title={`${greeting()}, ${greetName(user.displayName)}`}
        docTitle="דף הבית"
        sub="תמונת המצב של הקורס, והדברים שצריכים אותך היום."
        actions={
          <>
            <button className="btn" onClick={() => navigate('/briefing')}>
              <Icon name="sun" /> תדריך בוקר
            </button>
            <Link className="btn" to="/my">
              <Icon name="my" /> המשימות שלי
            </Link>
          </>
        }
      />
      <ErrorBox error={error} />
      {error && (
        <button className="btn mb-12" onClick={() => void reload()}>
          <Icon name="repeat" /> ניסיון נוסף
        </button>
      )}
      {loading && !data ? (
        <Loading rows={4} />
      ) : data ? (
        <div className="fade-in col gap-16">
          <SetupNudge />
          <PendingAnnouncements />
          <div className="stats dashboard-stats" aria-label="סיכום המשימות">
            <Stat n={data.stats.today} icon="sun" label="לביצוע היום" hint="משימות לסיום היום" to="/tasks?scope=today" />
            <Stat n={data.stats.overdue} icon="clock" label="באיחור" hint="עבר המועד, נדרש טיפול" alert={data.stats.overdue > 0} to="/tasks?scope=overdue" />
            <Stat n={data.stats.week} icon="calendar" label="לביצוע השבוע" hint="ב-7 הימים הקרובים" to="/tasks?scope=week" />
            <Stat n={data.stats.doneThisWeek} icon="check" label="הושלמו השבוע" hint="נסגרו מתחילת השבוע" to="/tasks?scope=done" />
          </div>

          <details className="dashboard-command-details">
            <summary>
              <Icon name="zap" />
              <span className="grow strong">משימה במשפט אחד</span>
              <span className="small muted hide-mobile">מי, מה ועד מתי</span>
              <Icon name="chevronDown" />
            </summary>
            <form
              className="dashboard-command"
              onSubmit={(e) => {
                e.preventDefault();
                if (!cmd.trim()) return newTask();
                newTask({ text: cmd.trim(), heading: 'פקודה מהירה' }, () => setCmd(''));
              }}
            >
              <label htmlFor="dashboard-command" className="sr-only">
                משימה במשפט אחד
              </label>
              <input
                id="dashboard-command"
                className="input"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder='למשל: מפק"צ 2 להכין תדריך עד מחר ב-12:00'
                aria-describedby="command-hint"
              />
              <button className="btn btn-primary" type="submit">
                <Icon name="plus" /> יצירת משימה
              </button>
              <span id="command-hint" className="tiny muted">
                כותבים מי, מה ועד מתי. אפשר לבדוק ולערוך לפני השליחה.
              </span>
            </form>
          </details>

          <div className="dashboard-workspace">
            <TodayEvents data={data} />
            <Attention items={data.attention} />
            <WeekCard data={data} />
          </div>
          <div className="dashboard-support">
            <WeeklyCard />
            {data.roll && <RollCard roll={data.roll} />}
            <DisciplineCard />
            <StaffHealth data={data} />
            <TracksCard />
            <QuickActions />
          </div>
          <TwoStepNudge />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ n, icon, label, hint, alert, to }: { n: number; icon: string; label: string; hint: string; alert?: boolean; to: string }) {
  return (
    <Link className={`card stat${alert ? ' alert' : ''}`} to={to}>
      <span className="stat-heading">
        <span className="stat-label">{label}</span>
        <Icon name={icon} />
      </span>
      <span className="stat-num">
        <CountUp value={n} />
      </span>
      <span className="stat-footer">
        <span className="stat-hint">{hint}</span>
        <Icon name="chevronLeft" size={16} />
      </span>
    </Link>
  );
}

// Lanes follow the colour language of section 18: red first, then decisions,
// then what is about to slip, then quiet signals.
const LANES: { key: string; label: string; title: string; tone: string; kinds: AttentionKind[] }[] = [
  { key: 'red', label: 'דחוף', title: 'באיחור, חסמים והחלטות', tone: 'red', kinds: ['decision', 'overdue'] },
  { key: 'approve', label: 'לאישורך', title: 'ממתין לאישורך', tone: 'blue', kinds: ['approval', 'request'] },
  { key: 'soon', label: 'בקרוב', title: 'דד-ליין ב-24 השעות הקרובות', tone: 'orange', kinds: ['due_soon'] },
  { key: 'risk', label: 'שבועות בסיכון', title: 'שבועות בסיכון', tone: 'orange', kinds: ['readiness'] },
  { key: 'quiet', label: 'למעקב', title: 'חסמים, עומס, היעדרויות ומשימות שלא עודכנו', tone: 'yellow', kinds: ['blocked', 'stale', 'overload', 'away'] },
  { key: 'learn', label: 'למידה', title: 'למידה ושיפור', tone: 'purple', kinds: ['debrief', 'lessons'] },
];
const LANE_LIMIT = 4;

/** an item's key by what it is (not where it stands), so a refreshed list keeps telling the same items apart */
function attnKeys(items: AttentionItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const k = [i.kind, i.taskId, i.weekId, i.userId, i.requestId, i.title].join('|');
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n ? `${k}#${n}` : k;
  });
}

/** what an item is about: a task or a request stays one thing when it moves on (due soon, then late) */
const subjectOf = (i: AttentionItem) => (i.taskId ? `t${i.taskId}` : i.requestId ? `r${i.requestId}` : [i.kind, i.weekId, i.userId, i.title].join('|'));
/** these go by the calendar (an absence over, a week begun), not because someone took care of them */
const PASSING: ReadonlySet<AttentionKind> = new Set(['away', 'overload', 'readiness']);

function Attention({ items }: { items: AttentionItem[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('all');
  // decided here: out of the counts once its row has folded away (the list catches up a moment later)
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [cleared, setCleared] = useState(false);

  const keyed = useMemo(() => {
    const keys = attnKeys(items);
    return items.map((i, idx) => ({ i, key: keys[idx] }));
  }, [items]);
  // taken care of somewhere else (the task done, the request decided - from the bell, by its owner): it
  // says so where it stood, then folds away; one that only moved on (due soon, now late) just moves
  const subjects = useMemo(() => new Set(keyed.map((x) => subjectOf(x.i))), [keyed]);
  const leaving = useLeaving(keyed, (x) => x.key, (k, last) => !gone.has(k) && !PASSING.has(last.i.kind) && !subjects.has(subjectOf(last.i)) && last);
  const left = keyed.filter((x) => !gone.has(x.key));
  const going = leaving.rows.length > keyed.length;
  // a blocker the owner escalated to the commander belongs with the red items
  const laneOf = (i: AttentionItem) => (i.kind === 'blocked' && i.tone === 'red' ? 'red' : LANES.find((l) => l.kinds.includes(i.kind))?.key);
  const lanes = LANES.map((l) => {
    const rows = leaving.rows.filter((x) => laneOf(x.i) === l.key);
    const n = left.filter((x) => laneOf(x.i) === l.key).length;
    // its last one going: the lane goes with it
    const phases = n ? [] : rows.map((x) => leaving.phaseOf(x.key)).filter(Boolean);
    return { ...l, items: rows, left: n, phase: phases.length ? (phases.includes('done') ? ('done' as const) : ('fold' as const)) : undefined };
  });
  const visible = lanes.filter((l) => (l.left || l.phase) && (filter === 'all' || l.key === filter));
  const decided = (key: string) =>
    setTimeout(() => {
      setGone((g) => {
        const next = new Set(g).add(key);
        if (keyed.every((x) => next.has(x.key))) setCleared(true);
        return next;
      });
    }, 700);

  return (
    <section className="card dashboard-attention" aria-labelledby="attn-title">
      <div className="card-head">
        <span className="dashboard-section-icon">
          <Icon name="target" />
        </span>
        <div className="grow">
          <h2 id="attn-title">לטיפול שלך</h2>
          <p className="small muted">מהדחוף ביותר ועד הדברים שכדאי לעקוב אחריהם</p>
        </div>
        <span className="badge" aria-label={`${left.length} פריטים לטיפול`} key={left.length}>
          {left.length}
        </span>
      </div>
      {(left.length > 0 || going) && (
        <div className="attention-filters" role="group" aria-label="סינון פריטים לטיפול">
          <button className={`chip${filter === 'all' ? ' on' : ''}`} aria-pressed={filter === 'all'} aria-controls="attention-results" onClick={() => setFilter('all')}>
            הכל <span>{left.length}</span>
          </button>
          {lanes
            .filter((l) => l.left || filter === l.key)
            .map((l) => (
              <button
                key={l.key}
                className={`chip${filter === l.key ? ' on' : ''}`}
                aria-pressed={filter === l.key}
                aria-controls="attention-results"
                onClick={() => setFilter(l.key)}
              >
                <span className={`dot t-${l.tone}`} />
                {l.label}
                <span>{l.left}</span>
              </button>
            ))}
        </div>
      )}
      <div id="attention-results">
        {left.length === 0 && !going ? (
          <div className={cleared ? 'just-cleared attention-cleared' : undefined}>
            <Empty
              mark={cleared ? <CheckMark size={44} /> : undefined}
              title="הכל מתקדם כמתוכנן"
              text={cleared ? 'טיפלת בכל מה שחיכה לך. דברים חדשים יופיעו כאן כשיגיעו.' : 'אין חריגות שמחייבות את התערבותך כרגע.'}
            />
          </div>
        ) : visible.length === 0 ? (
          <Empty
            icon="check"
            title="אין כרגע פריטים בקבוצה הזו"
            text={
              <button className="btn btn-ghost" onClick={() => setFilter('all')}>
                לכל הפריטים
              </button>
            }
          />
        ) : (
          visible.map((l) => {
            const all = !!expanded[l.key];
            const list = all ? l.items : l.items.slice(0, LANE_LIMIT);
            return (
              <div key={l.key} className={leaveClass(l.phase)}>
                <div id={`lane-${l.key}`} className="attn">
                  <div className="group-title attention-group-title">
                    <span className={`dot t-${l.tone}`} />
                    <span>{l.title}</span>
                    {l.left > 0 && <span className="n">{l.left}</span>}
                    <span className="line" />
                  </div>
                  {list.map(({ i, key }) => (
                    <AttentionRow key={key} i={i} onDecided={() => decided(key)} leaving={leaving.phaseOf(key)} />
                  ))}
                  {l.items.length > LANE_LIMIT && (
                    <button className="btn btn-ghost attention-more" aria-expanded={all} onClick={() => setExpanded({ ...expanded, [l.key]: !all })}>
                      {all ? 'הצג פחות' : `הצג עוד ${l.items.length - LANE_LIMIT}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

const destination = (i: AttentionItem) => i.link || (i.taskId ? `/tasks/${i.taskId}` : i.weekId ? `/weeks/${i.weekId}` : i.userId ? `/team/${i.userId}` : '/tasks');

/** one thing that needs the commander: approved or rejected right here, it says so and folds away - and
 *  so does one taken care of elsewhere meanwhile (leaving) */
function AttentionRow({ i, onDecided, leaving }: { i: AttentionItem; onDecided: () => void; leaving?: LeavePhase }) {
  const d = useDecision(onDecided);
  const decides = i.kind === 'approval' || i.kind === 'request';
  const approve = () =>
    void d.decide(
      'approved',
      () => (i.kind === 'approval' && i.taskId ? api.post(`/api/tasks/${i.taskId}/transition`, { action: 'approve' }) : api.post(`/api/requests/${i.requestId}/decide`, { approve: true })),
      i.kind === 'approval' ? 'המשימה אושרה ונסגרה' : 'הבקשה אושרה',
    );
  const reject = () => void d.decide('rejected', () => api.post(`/api/requests/${i.requestId}/decide`, { approve: false }), 'הבקשה נדחתה');
  return (
    <div className={`swipe-wrap attn-decide${d.fold || leaving === 'fold' ? ' is-removing' : ''}${leaving ? ' is-finished' : ''}`}>
      <div className="swipe-row">
        <div className={`attn-item dashboard-attn-item t-${i.tone}`}>
          <Link className="attention-link" to={destination(i)}>
            <span className="attn-bar" />
            <div style={{ minWidth: 0 }}>
              <div className="attn-kind">
                {KIND_LABEL[i.kind]}
                {i.count && i.count > 1 ? ` · ${i.count} אנשי סגל` : ''}
              </div>
              <div className="attn-title">{i.title}</div>
              <div className="attn-sub">
                {[i.ownerName && (i.kind === 'readiness' ? `מפק"צ: ${i.ownerName}` : `אחראי: ${i.ownerName}`), i.deadline && `דד-ליין: ${fmtDeadline(i.deadline)}`, i.subtitle].filter(Boolean).join(' · ')}
              </div>
              {d.error && <div className="tiny text-red">{d.error}</div>}
            </div>
            <Icon name="chevronLeft" className="faint" size={18} />
          </Link>
          {leaving && !d.verdict ? (
            <div className="attention-actions">
              <span className="verdict-pill t-green" role="status">
                <Icon name="check" size={15} />
                טופל
              </span>
            </div>
          ) : (
            decides &&
            (d.verdict ? (
              <div className="attention-actions">
                <Decided verdict={d.verdict} />
              </div>
            ) : (
              <div className="row gap-6 attention-actions">
                <button className="btn btn-sm btn-primary" onClick={approve} aria-label={`אישור: ${i.title}`}>
                  אשר
                </button>
                {i.kind === 'request' && (
                  <button className="btn btn-sm" onClick={reject} aria-label={`דחייה: ${i.title}`}>
                    דחה
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function WeekCard({ data }: { data: DashboardData }) {
  const navigate = useNavigate();
  const weeks = [data.currentWeek && { label: 'השבוע הנוכחי', w: data.currentWeek }, data.nextWeek && { label: 'השבוע הבא', w: data.nextWeek }].filter(Boolean) as {
    label: string;
    w: NonNullable<DashboardData['nextWeek']>;
  }[];
  if (!weeks.length) {
    return (
      <div className="card card-pad dashboard-weeks">
        <div className="label-caps">שבועות הקורס</div>
        <p className="small muted mt-8">עדיין לא הוגדרו שבועות.</p>
        <button className="btn btn-sm mt-12" onClick={() => navigate('/settings#weeks')}>
          הגדרת שבועות
        </button>
      </div>
    );
  }
  return (
    <section className="card dashboard-weeks" aria-label="שבועות הקורס">
      <div className="card-head">
        <Icon name="layers" />
        <h3 className="grow">השבוע בקורס</h3>
        <Link className="btn btn-ghost btn-sm" to="/weeks">
          לכל השבועות
          <Icon name="chevronLeft" size={15} />
        </Link>
      </div>
      {weeks.map(({ label, w }, i) => (
        <Link key={w.id} className="row week-summary" style={{ borderTop: i ? '1px solid var(--line)' : undefined }} to={`/weeks/${w.id}`}>
          <div className="grow">
            <div className="label-caps">{label}</div>
            <div className="strong" style={{ fontSize: 17 }}>
              {w.name}
            </div>
            <div className="tiny muted">
              {shortDate(w.startDate)}-{shortDate(w.endDate)} · {w.leadName ? `מפק"צ: ${w.leadName}` : 'ללא מפק"צ אחראי'}
            </div>
            <div className="tiny muted">
              {w.doneTasks}/{w.totalTasks} משימות {w.approvedAt ? '· אושר' : ''}
            </div>
          </div>
          <div className="week-readiness">
            <Ring value={w.readiness} size={64} tone={w.totalTasks === 0 ? 'gray' : undefined} />
            <span className="tiny muted">מוכנות</span>
          </div>
        </Link>
      ))}
    </section>
  );
}

/** the course's tracks in a glance: those with tasks, what needs attention first */
function TracksCard() {
  const { tracks } = useSession();
  const live = tracks
    .filter((t) => t.totalTasks > 0)
    .sort((a, b) => b.overdueTasks - a.overdueTasks || a.readiness - b.readiness)
    .slice(0, 6);
  const noLead = tracks.filter((t) => !t.leadId).length;
  if (!tracks.length) return null;
  return (
    <section className="card" aria-label="צירים בקורס">
      <div className="card-head">
        <Icon name="route" />
        <h3 className="grow">צירים בקורס</h3>
        <Link className="btn btn-ghost btn-sm" to="/tracks">
          לכל הצירים
          <Icon name="chevronLeft" size={15} />
        </Link>
      </div>
      {live.length === 0 ? (
        <div className="card-body small muted">עדיין אין משימות בצירים. משימה נכנסת לציר לפי השדה "ציר בקורס" שלה.</div>
      ) : (
        live.map((t) => (
          <Link key={t.id} to={`/tracks/${t.id}`} className="health track-line">
            <span className="strong" style={{ width: 96 }}>
              {t.name}
            </span>
            <div className="grow">
              <Bar value={t.readiness} label={`מוכנות ${t.name}`} />
            </div>
            <span className="mono tiny" style={{ width: 52, textAlign: 'left' }}>
              {t.doneTasks}/{t.totalTasks}
            </span>
            <span className="track-line-flag">{t.overdueTasks > 0 && <span className="badge t-red">{t.overdueTasks} באיחור</span>}</span>
          </Link>
        ))
      )}
      {noLead > 0 && (
        <div className="card-body tiny muted" style={{ paddingTop: 8 }}>
          {noLead === tracks.length ? 'לאף ציר עוד לא נקבע אחראי' : `${noLead} צירים בלי אחראי`} - <Link to="/tracks">קביעת אחראים</Link>
        </div>
      )}
    </section>
  );
}

/** today's roll call in a glance: who is in, who is not and why, which teams have not reported */
function RollCard({ roll }: { roll: NonNullable<DashboardData['roll']> }) {
  const navigate = useNavigate();
  const inCourse = roll.counts.present + roll.counts.late;
  return (
    <div className="card" {...openable(() => navigate('/attendance'))} aria-label={`מצבה היום: ${roll.line}`}>
      <div className="card-head">
        <Icon name="check" />
        <h3 className="grow">מצבה היום</h3>
        <span className="mono strong">
          {inCourse}/{roll.counts.total}
        </span>
      </div>
      <div className="card-body col gap-6">
        <div className="row wrap gap-6">
          {ATTENDANCE_STATUSES.filter((s) => s !== 'present' && roll.counts[s] > 0).map((s) => (
            <span key={s} className={`badge t-${ATTENDANCE_TONES[s]}`}>
              {ATTENDANCE_LABELS[s]} {roll.counts[s]}
            </span>
          ))}
          {roll.counts.unmarked > 0 && <span className="badge">לא סומנו {roll.counts.unmarked}</span>}
        </div>
        {roll.teamsMissing.length > 0 && <span className="small text-orange">עוד לא דיווחו: {roll.teamsMissing.join(', ')}</span>}
      </div>
    </div>
  );
}

function StaffHealth({ data }: { data: DashboardData }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">הסגל</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/team')}>
          לכל הצוות
        </button>
      </div>
      {data.staff.length === 0 && <div className="card-body small muted">לא הוגדרו אנשי סגל.</div>}
      {data.staff.map((s) => (
        <div key={s.userId} className="health" {...openable(() => navigate(`/team/${s.userId}`))}>
          <span className={`dot t-${s.overdue > 1 ? 'red' : s.overdue === 1 ? 'orange' : 'green'}`} />
          <span className="strong grow">{s.name}</span>
          {s.away && (
            <span className="badge t-purple">
              {ABSENCE_REASON_LABELS[s.away.reason]} עד {shortDate(s.away.endDate)}
            </span>
          )}
          <span className={`small ${s.overdue ? 'text-red strong' : 'muted'}`}>{staffHealthLabel(s.overdue)}</span>
          <span className="tiny mono muted">{s.open} פתוחות</span>
        </div>
      ))}
    </div>
  );
}

function TodayEvents({ data }: { data: DashboardData }) {
  const [expanded, setExpanded] = useState(false);
  const today = todayKey();
  const nowTime = fmtTime(new Date().toISOString());
  const live = nowAndNext(data.todayEvents, today, nowTime);
  const nowMin = Number(nowTime.slice(0, 2)) * 60 + Number(nowTime.slice(3, 5));
  // what is over is out of the way - one line at the top that opens to it; one that ends while the page is
  // open goes there (a moment, then folded), as in the schedule (components/Agenda.tsx)
  const liveNow = live.now?.id;
  const { over, ahead } = useMemo(() => {
    const ended = (e: ScheduleEvent) => e.id !== liveNow && endMinutes(e) <= nowMin;
    return { over: data.todayEvents.filter(ended), ahead: data.todayEvents.filter((e) => !ended(e)) };
  }, [data.todayEvents, nowMin, liveNow]);
  const leaving = useLeaving(ahead, (e) => e.id, (id) => over.find((e) => e.id === id));
  // folded, the three that come next (the one going on first); one leaving stays until it has folded
  const shown = new Set((expanded ? ahead : ahead.slice(0, 3)).map((e) => e.id));
  const events = leaving.rows.filter((e) => shown.has(e.id) || leaving.phaseOf(e.id));
  const row = (e: ScheduleEvent) => {
    const isNow = live.now?.id === e.id;
    const isNext = live.next?.id === e.id;
    const past = !isNow && endMinutes(e) <= nowMin;
    return (
      <Link key={e.id} className={`dashboard-event${isNow ? ' is-now' : ''}${past ? ' is-past' : ''}`} to={`/schedule?date=${e.date}&event=${e.id}`}>
        <span className="dashboard-event-time mono">
          <b>{e.startTime}</b>
          {e.endTime && <span>{e.endTime}</span>}
        </span>
        <span className="dashboard-event-marker" aria-hidden="true" />
        <span className="grow">
          <b>{e.title}</b>
          {isNow && <span className="badge t-orange dashboard-event-when">עכשיו · {leftMinutes(live.left)}</span>}
          {isNext && <span className="badge t-blue dashboard-event-when">{inMinutes(live.until)}</span>}
          {(e.location || e.ownerName) && <span className="dashboard-event-detail">{[e.location, e.ownerName].filter(Boolean).join(' · ')}</span>}
          {isNow && (
            <span className="un-bar dashboard-event-bar" aria-hidden="true">
              <i style={{ inlineSize: `${Math.round(live.progress * 100)}%` }} />
            </span>
          )}
        </span>
        {e.taskTotal > 0 && (
          <span className={`badge ${e.taskDone < e.taskTotal ? 't-orange' : 't-green'}`} title="משימות הכנה שהושלמו">
            <span className="mono">
              {e.taskDone}/{e.taskTotal}
            </span>
            <span className="sr-only"> משימות הכנה שהושלמו</span>
          </span>
        )}
      </Link>
    );
  };
  return (
    <section className="card dashboard-schedule" aria-labelledby="today-title">
      <div className="card-head">
        <Icon name="calendar" />
        <h3 id="today-title" className="grow">
          לו"ז היום
        </h3>
        <Link className="btn btn-ghost btn-sm" to="/schedule">
          ללו"ז המלא
          <Icon name="chevronLeft" size={15} />
        </Link>
      </div>
      {data.todayEvents.length === 0 ? (
        <div className="card-body small muted">
          אין אירועים מתוכננים להיום.{' '}
          <Link to="/schedule?new=1" className="dashboard-inline-link">
            הוספת אירוע
          </Link>
        </div>
      ) : (
        <>
          <DoneDrawer row id="dashboard-earlier" count={over.length} label="מוקדם יותר היום">
            {over.map(row)}
          </DoneDrawer>
          {events.length === 0 ? (
            <div className="card-body small muted dashboard-day-over">אין עוד אירועים היום</div>
          ) : (
            events.map((e) => (
              <div key={e.id} className={leaveClass(leaving.phaseOf(e.id))}>
                {row(e)}
              </div>
            ))
          )}
        </>
      )}
      {ahead.length > 3 && (
        <button className="btn btn-ghost agenda-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'הצג פחות' : `עוד ${ahead.length - 3} אירועים היום`}
          <Icon name="chevronDown" size={16} />
        </button>
      )}
    </section>
  );
}

function QuickActions() {
  const newTask = useNewTask();
  const navigate = useNavigate();
  return (
    <div className="card card-pad">
      <div className="label-caps mb-12">פעולות מהירות</div>
      <div className="grid-2" style={{ gap: 8 }}>
        <button className="btn" onClick={() => newTask()}>
          <Icon name="plus" /> משימה
        </button>
        <button className="btn" onClick={() => newTask({ allStaff: true, heading: 'משימה לכל הסגל' })}>
          <Icon name="users" /> לכל הסגל
        </button>
        <button className="btn" onClick={() => navigate('/recurring?new=1')}>
          <Icon name="repeat" /> משימה חוזרת
        </button>
        <button className="btn" onClick={() => navigate('/schedule?new=1')}>
          <Icon name="calendar" /> עדכון לו"ז
        </button>
      </div>
    </div>
  );
}

/** A new course: the few steps that make the system useful, until they are done. */
const NUDGE_KEY = 'kks.twoStepNudge';

/** the commander's account opens everything: until two-step sign-in is on, a reminder (can wait a week) */
function TwoStepNudge() {
  const { user, viewing, isCommander } = useSession();
  const navigate = useNavigate();
  const [later, setLater] = useState(() => {
    try {
      return Number(localStorage.getItem(NUDGE_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  if (!isCommander || user.twoFactor || viewing || later) return null;
  const wait = () => {
    try {
      localStorage.setItem(NUDGE_KEY, String(Date.now() + 7 * 86_400_000));
    } catch {
      /* this visit only */
    }
    setLater(true);
  };
  return (
    <div className="card card-pad row wrap setup-nudge">
      <Icon name="shield" />
      <div className="grow">
        <div className="strong">אימות דו-שלבי לחשבון מפקד הקורס</div>
        <div className="small muted">החשבון שלך פותח את כל נתוני הקורס. עם קוד מאפליקציה בטלפון, גם מי שיודע את הסיסמה לא ייכנס. לוקח דקה.</div>
      </div>
      <button className="btn btn-primary" onClick={() => navigate('/settings#security')}>
        הפעלה
      </button>
      <button className="btn btn-ghost" onClick={wait}>
        בשבוע הבא
      </button>
    </div>
  );
}

function SetupNudge() {
  const { settings, weeks, staff } = useSession();
  const navigate = useNavigate();
  const steps = [
    { done: !!settings.startDate && !!settings.endDate, label: 'תאריכי הקורס' },
    { done: staff.length > 0, label: 'אנשי הסגל' },
    { done: weeks.length > 0, label: 'שבועות הקורס' },
  ];
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="card card-pad row wrap setup-nudge">
      <Icon name="flag" />
      <div className="grow">
        <div className="strong">
          הקמת הקורס - {done} מתוך {steps.length}
        </div>
        <div className="small muted">הצעד הבא: {next.label}. אחרי ההקמה המערכת מתחילה לעבוד בשבילך - משימות, לו"ז ותמונת מצב.</div>
      </div>
      <button className="btn btn-primary" onClick={() => navigate('/settings')}>
        להמשך ההקמה
      </button>
    </div>
  );
}

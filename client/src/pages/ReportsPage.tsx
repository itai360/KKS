// Sections 24 (weekly snapshot), 25 (look ahead), 52 (end of day), 20 (activity log).

import { Link, useNavigate, useSearchParams } from 'react-router';
import { addDays, shortDate, startOfWeek, weekdayName, weekdayOf } from '@shared/dates';
import { DISCIPLINE_NOTE_LIMIT } from '@shared/constants';
import type { ActivityEntry, DayEndData, DisciplineLogEntry, DisciplineSummary, LookAheadData, WeeklyReport } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { GroupTitle, TaskList } from '../components/TaskRow';
import { Bar, Empty, ErrorBox, Loading, PageHead, Ring } from '../components/ui';
import { dateKeyOf, fmtAgo, fmtDateTime, fmtLongDate, todayKey } from '../lib/format';
import { api, qs } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

/** The discipline records as a spreadsheet: one week, or the whole course. */
async function exportDiscipline(from?: string, to?: string): Promise<void> {
  const log = await api.get<DisciplineLogEntry[]>(`/api/discipline/log${qs({ from, to })}`);
  await saveCsv(
    from ? `משמעת-${from}` : 'משמעת-כל-הקורס',
    ['תאריך', 'צוער', 'צוות', 'נושא', 'מקרה', 'פעם', 'הערת משמעת', 'חומרה', 'כותרת', 'פירוט', 'נרשם על ידי'],
    log.map((r) => [
      r.occurredOn.split('-').reverse().join('.'),
      r.cadetName,
      r.teamName ?? '',
      r.category,
      r.offense,
      r.occurrence ?? '',
      r.formal ? `כן (${r.noteNumber})` : '',
      r.severity,
      r.title,
      r.body,
      r.authorName,
    ]),
  );
}

/** The week's discipline among the cadets this user manages (the staff update it weekly). */
function WeeklyDiscipline({ d, from, to }: { d: DisciplineSummary; from: string; to: string }) {
  const toast = useToast();
  const save = (a?: string, b?: string) => void exportDiscipline(a, b).catch((e: Error) => toast({ title: e.message, tone: 'red' }));
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="shield" />
        <h3 className="grow">משמעת</h3>
        <span className="small muted">
          {d.events} {d.events === 1 ? 'אירוע' : 'אירועים'} · {d.notes} {d.notes === 1 ? 'הערת משמעת' : 'הערות משמעת'}
        </span>
        <span className="row gap-4 no-print">
          <button className="btn btn-sm" disabled={!d.events} onClick={() => save(from, to)} title="רישומי המשמעת של השבוע לאקסל">
            <Icon name="download" size={14} /> ייצוא השבוע
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => save()} title="כל רישומי המשמעת מתחילת הקורס">
            כל הקורס
          </button>
        </span>
      </div>
      {d.events === 0 ? (
        <div className="card-body">
          <p className="small muted" style={{ margin: 0 }}>
            לא נרשמה משמעת בשבוע הזה.
          </p>
        </div>
      ) : (
        <>
          <div className="card-body row wrap gap-4">
            {d.byCategory.map((c) => (
              <span key={c.category} className="badge">
                {c.category} {c.count}
              </span>
            ))}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>צוער</th>
                <th className="hide-mobile">צוות</th>
                <th className="num-cell">אירועים</th>
                <th className="num-cell">הערות משמעת</th>
                <th className="num-cell">עד עכשיו</th>
              </tr>
            </thead>
            <tbody>
              {d.cadets.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cadets/${c.id}`}>{c.fullName}</Link>
                  </td>
                  <td className="hide-mobile">{c.teamName ?? '-'}</td>
                  <td className="num-cell">{c.events}</td>
                  <td className={`num-cell${c.notes ? ' text-red' : ''}`}>{c.notes}</td>
                  <td className="num-cell" title="הערות משמעת מתחילת הקורס">
                    {c.totalNotes}/{DISCIPLINE_NOTE_LIMIT}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function WeeklyReportPage() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? addDays(startOfWeek(todayKey()), -7);
  const { data, error, loading } = useApi<WeeklyReport>(`/api/reports/weekly?from=${from}`, ['tasks']);
  const isLast = from === addDays(startOfWeek(todayKey()), -7);
  const isCurrent = from === startOfWeek(todayKey());
  return (
    <div className="page">
      <PageHead
        eyebrow={isLast ? 'השבוע שהסתיים' : isCurrent ? 'השבוע הנוכחי' : 'תמונת מצב שבועית'}
        title="תמונת מצב שבועית"
        sub={data ? `${shortDate(data.from)}-${shortDate(data.to)} · ללא משימות שגרה חוזרות` : undefined}
        actions={
          <>
            <button className="btn" onClick={() => setParams({ from: addDays(from, -7) })}>
              <Icon name="chevronRight" /> שבוע קודם
            </button>
            {!isCurrent && (
              <button className="btn" onClick={() => setParams({ from: addDays(from, 7) })}>
                שבוע הבא <Icon name="chevronLeft" />
              </button>
            )}
            <button className="btn" onClick={() => window.print()}>
              <Icon name="print" /> הדפסה
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : data ? (
        <div className="fade-in col gap-16">
          <div className="stats">
            <Num n={data.opened} label="משימות נפתחו" />
            <Num n={data.completed} label="הושלמו" />
            <Num n={data.carried} label="עברו לשבוע הבא" />
            <Num n={data.overdue} label="באיחור" alert={data.overdue > 0} />
          </div>
          <div className="split">
            <div>
              <div className="section-title">
                <h2>נקודות פתוחות</h2>
                <span className="count-pill">{data.openPoints.length}</span>
              </div>
              <TaskList tasks={data.openPoints} empty={<Empty title="אין נקודות פתוחות" text="כל המשימות שתוכננו לשבוע הושלמו." />} />
            </div>
            <div className="col gap-16">
              <div className="card">
                <div className="card-head">
                  <h3>לפי תחום</h3>
                </div>
                <div className="card-body col gap-6">
                  {data.byDomain.length === 0 && <p className="small muted">לא תוכננו משימות לשבוע זה.</p>}
                  {data.byDomain.map((d) => (
                    <div key={d.domain} className="row small">
                      <span style={{ width: 100 }} className="strong">
                        {d.domain}
                      </span>
                      <div className="grow">
                        <Bar value={d.readiness} label={`מוכנות ${d.domain}`} />
                      </div>
                      <span className="mono" style={{ width: 44, textAlign: 'left' }}>
                        {d.readiness}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>ביצוע לפי איש סגל</h3>
                </div>
                {data.completedByStaff.length ? (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>שם</th>
                        <th className="num-cell">הושלמו</th>
                        <th className="num-cell">מתוכן באיחור</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.completedByStaff.map((s) => (
                        <tr key={s.userId}>
                          <td>{s.name}</td>
                          <td className="num-cell">{s.done}</td>
                          <td className={`num-cell ${s.late ? 'text-red' : ''}`}>{s.late}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="card-body">
                    <p className="small muted">לא הושלמו משימות בשבוע זה.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          {data.discipline && <WeeklyDiscipline d={data.discipline} from={data.from} to={data.to} />}
        </div>
      ) : null}
    </div>
  );
}

function Num({ n, label, alert }: { n: number; label: string; alert?: boolean }) {
  return (
    <div className={`card stat${alert ? ' alert' : ''}`} style={{ cursor: 'default' }}>
      <span className="stat-label">{label}</span>
      <span className="stat-num">{n}</span>
    </div>
  );
}

export function LookAheadPage() {
  const { data, error, loading } = useApi<LookAheadData>('/api/reports/lookahead', ['tasks', 'weeks']);
  const { staff } = useSession();
  const navigate = useNavigate();
  const max = Math.max(1, ...(data?.days.map((d) => d.total) ?? [1]));
  return (
    <div className="page">
      <PageHead title="מבט קדימה" sub="14 הימים הקרובים - לזהות עומס מראש, לא רק לטפל בבעיות כשהן מגיעות." />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : data ? (
        <div className="fade-in col gap-16">
          <div className="grid-2">
            {data.weeks.map((w) => (
              <div key={w.label} className="card card-pad row" style={{ cursor: w.week ? 'pointer' : 'default' }} onClick={() => w.week && navigate(`/weeks/${w.week.id}`)}>
                <div className="grow">
                  <div className="label-caps">{w.label}</div>
                  <div className="stat-num" style={{ fontSize: 58 }}>
                    {w.total}
                  </div>
                  <div className="small muted">
                    משימות · {shortDate(w.from)}-{shortDate(w.to)}
                    {w.week && ` · ${w.week.name}`}
                  </div>
                </div>
                {w.week && <Ring value={w.week.readiness} size={84} tone={w.week.totalTasks === 0 ? 'gray' : undefined} />}
              </div>
            ))}
          </div>
          <div className="card card-pad">
            <div className="row">
              <div className="label-caps grow">משימות פתוחות לפי יום</div>
              <span className="tiny muted">
                <span className="dot" style={{ background: 'var(--orange)' }} /> עדיפות גבוהה/קריטית
              </span>
            </div>
            <div className="bars" style={{ height: 190 }}>
              {data.days.map((d) => {
                const wd = weekdayOf(d.date);
                return (
                  <div key={d.date} className={`b${wd === 5 || wd === 6 ? ' weekend' : ''}`} title={`${weekdayName(d.date)} ${shortDate(d.date)}: ${d.total}`}>
                    <span className="val">{d.total || ''}</span>
                    <div className="col-fill" style={{ height: `${(d.total / max) * 130}px` }}>
                      {d.critical > 0 && <div className="crit" style={{ height: `${(d.critical / Math.max(1, d.total)) * 100}%` }} />}
                    </div>
                    <span className="lbl">{weekdayName(d.date).slice(0, 2)}</span>
                    <span className="lbl">{shortDate(d.date)}</span>
                  </div>
                );
              })}
            </div>
            {data.days.every((d) => !d.total) && <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>אין משימות פתוחות ב-14 הימים הקרובים.</p>}
          </div>
          <div className="card">
            <div className="card-head">
              <h3>עומס לפי איש סגל - 14 ימים</h3>
            </div>
            <div className="card-body col gap-6">
              {data.staffLoad.map((s) => {
                const top = Math.max(1, data.staffLoad[0]?.total ?? 1);
                return (
                  <Link key={s.userId} to={`/tasks?owner=${s.userId}&scope=open`} className="row small">
                    <span className="strong" style={{ width: 120 }}>
                      {s.name}
                    </span>
                    <div className="grow">
                      <Bar value={(s.total / top) * 100} tone="gray" label={`משימות פתוחות של ${s.name}`} />
                    </div>
                    <span className="mono" style={{ width: 30, textAlign: 'left' }}>
                      {s.total}
                    </span>
                  </Link>
                );
              })}
              {!data.staffLoad.length && <p className="small muted">{staff.length ? 'לאף איש סגל אין משימות פתוחות ב-14 הימים הקרובים.' : 'עדיין לא הוגדרו אנשי סגל.'}</p>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DayEndPage() {
  const { data, error, loading } = useApi<DayEndData>('/api/reports/day-end', ['tasks']);
  const navigate = useNavigate();
  const pct = data && data.dueToday ? Math.round((data.doneToday / data.dueToday) * 100) : 0;
  return (
    <div className="page narrow">
      <PageHead eyebrow={data ? fmtLongDate(data.date) : undefined} title="סיכום היום" sub="אין צורך בדוח יומי נפרד - המידע כבר במערכת." />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : data ? (
        <div className="fade-in col gap-16">
          <div className="card card-pad row">
            {data.dueToday ? <Ring value={pct} size={110} /> : <Ring value={0} size={110} tone="gray" />}
            <div>
              <div className="label-caps">השלמת היום</div>
              {data.dueToday ? (
                <>
                  <div className="stat-num" style={{ fontSize: 56 }}>
                    {data.doneToday} מתוך {data.dueToday}
                  </div>
                  <div className="small muted">
                    משימות שהיו לביצוע היום · {data.completedToday.length} הושלמו היום בסך הכל
                  </div>
                </>
              ) : (
                <>
                  <div className="strong" style={{ fontSize: 20 }}>לא היו משימות לביצוע היום</div>
                  <div className="small muted">{data.completedToday.length} משימות הושלמו היום בסך הכל</div>
                </>
              )}
            </div>
          </div>
          <div>
            <GroupTitle title="נשאר פתוח" count={data.stillOpen.length} tone={data.stillOpen.length ? 'red' : 'green'} />
            <TaskList tasks={data.stillOpen} showOwner={false} empty={<p className="small muted">הכל נסגר להיום.</p>} />
          </div>
          <div>
            <GroupTitle title="למחר" count={data.tomorrow.length} tone="orange" />
            <TaskList tasks={data.tomorrow} showOwner={false} empty={<p className="small muted">אין משימות למחר.</p>} />
          </div>
          {data.completedToday.length > 0 && (
            <div>
              <GroupTitle title="הושלמו היום" count={data.completedToday.length} tone="green" />
              <TaskList tasks={data.completedToday} showOwner={false} />
            </div>
          )}
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/')}>
            חזרה למשימות
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ActivityPage() {
  const { data, error, loading } = useApi<ActivityEntry[]>('/api/activity?limit=200', ['tasks', 'weeks', 'events', 'meetings']);
  const groups = new Map<string, ActivityEntry[]>();
  for (const a of data ?? []) {
    const k = fmtLongDate(dateKeyOf(a.createdAt));
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return (
    <div className="page narrow">
      <PageHead title="יומן פעילות" sub="כל שינוי נשמר: מי, מה ומתי." />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : !data?.length ? (
        <Empty icon="history" title="אין פעילות עדיין" />
      ) : (
        [...groups.entries()].map(([day, list]) => (
          <div key={day} className="mb-12">
            <GroupTitle title={day} count={list.length} />
            <div className="card card-pad">
              <div className="timeline">
                {list.map((a) => (
                  <div key={a.id} className="tl-item">
                    <div className="tl-time" title={fmtDateTime(a.createdAt)}>
                      {fmtDateTime(a.createdAt).split(' ')[1]} · {fmtAgo(a.createdAt)}
                    </div>
                    <div>
                      {a.text}
                      {a.taskId && a.taskTitle && (
                        <>
                          {' · '}
                          <Link to={`/tasks/${a.taskId}`} className="strong">
                            {a.taskTitle}
                          </Link>
                        </>
                      )}
                      {!a.taskId && a.taskTitle && a.action === 'deleted' && <span className="muted"> ({a.taskTitle})</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

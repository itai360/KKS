// Sections 10 and 48 - what a staff member opens in the morning.

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { shortDate } from '@shared/dates';
import type { MyTasksData, ScheduleEvent } from '@shared/types';
import { UpNext } from '../components/Agenda';
import { DisciplineCard } from '../components/DisciplineCard';
import { PendingAnnouncements } from '../components/Announcements';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { BulkToggle } from '../components/Bulk';
import { DoneDrawer, revealDrawer } from '../components/DoneDrawer';
import { GroupTaskRow, TaskBulkScope, TaskList, TaskRow, TaskSection } from '../components/TaskRow';
import { CountUp, Empty, ErrorBox, Loading, openable, PageHead, Ring } from '../components/ui';
import { fmtLongDate, fmtTime, greetName, greeting, todayKey } from '../lib/format';
import { haptic } from '../lib/haptics';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';

export function MyTasksPage() {
  const { user, isCommander } = useSession();
  const { data, error, loading } = useApi<MyTasksData>('/api/my', ['tasks', 'weeks']);
  const navigate = useNavigate();
  const newTask = useNewTask();
  useTick();

  const total = data ? data.overdue.length + data.today.length + data.important.length + data.week.length + data.later.length + data.waiting.length : 0;

  const allTasks = data ? [...data.overdue, ...data.today, ...data.important, ...data.week, ...data.later, ...data.waiting, ...data.teamTasks] : [];

  return (
    <TaskBulkScope tasks={allTasks}>
    <div className="page">
      <PageHead
        eyebrow={fmtLongDate(todayKey())}
        title={isCommander ? 'המשימות שלי' : `${greeting()}, ${greetName(user.displayName)}`}
        docTitle={isCommander ? 'המשימות שלי' : 'דף הבית'}
        sub="היום, באיחור, השבוע ובהמשך - מה שאתה צריך לעשות."
        actions={
          <>
            <BulkToggle />
            <button className="btn" onClick={() => navigate('/day-end')}>
              <Icon name="moon" /> סיכום יום
            </button>
            <button className="btn btn-primary" onClick={() => newTask({ ownerIds: [user.id] })}>
              <Icon name="plus" /> משימה לעצמי
            </button>
          </>
        }
      />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={5} />
      ) : data ? (
        <div className="fade-in">
          <PendingAnnouncements spaced />
          <TodayOnSchedule />
          <DayProgress done={data.stats.doneToday} late={data.stats.overdue} today={data.stats.today} />
          {/* four zeros say nothing: with nothing open and nothing done today, the empty state says it */}
          {(total > 0 || data.stats.doneToday > 0) && (
            <div className="stats">
              <MiniStat n={data.stats.today} label="היום" target="group-today" />
              <MiniStat n={data.stats.overdue} label="באיחור" alert={data.stats.overdue > 0} target="group-overdue" />
              <MiniStat n={data.stats.week} label="השבוע" target="group-week" />
              <MiniStat n={data.stats.doneToday} label="הושלמו היום" target="my-done" />
            </div>
          )}

          <div className="split mt-16">
            <div>
              {total === 0 && (
                <Empty
                  title="אין משימות פתוחות"
                  text={
                    <>
                      כל הכבוד. משימות חדשות יופיעו כאן ברגע שייפתחו.
                      <span className="empty-actions">
                        <button className="btn" onClick={() => navigate('/tasks')}>
                          לכל המשימות <Icon name="chevronLeft" size={15} />
                        </button>
                      </span>
                    </>
                  }
                />
              )}
              <TaskSection id="group-overdue" title="באיחור" tasks={data.overdue} tone="red" showOwner={false} />
              <TaskSection id="group-today" title="היום" tasks={data.today} tone="orange" showOwner={false} />
              <TaskSection title="חשוב - עדיפות גבוהה" tasks={data.important} tone="red" showOwner={false} />
              <TaskSection id="group-week" title="השבוע" tasks={data.week} tone="yellow" showOwner={false} />
              <TaskSection title="בהמשך" tasks={data.later} tone="gray" showOwner={false} />
              <TaskSection title="ממתין לאישור מפקד" tasks={data.waiting} tone="blue" showOwner={false} />
              {/* what was done is out of the way: one line that opens to it */}
              <DoneDrawer id="my-done" count={data.recentDone.length} label="הושלמו לאחרונה">
                <TaskList tasks={data.recentDone} showOwner={false} />
              </DoneDrawer>
            </div>
            <div className="col gap-16 sticky-side">
              <DisciplineCard />
              {data.myWeeks.length > 0 && (
                <div className="card">
                  <div className="card-head">
                    <h3>השבועות שבאחריותי</h3>
                  </div>
                  {data.myWeeks.map((w) => (
                    <div key={w.id} className="row" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', cursor: 'pointer' }} {...openable(() => navigate(`/weeks/${w.id}`))}>
                      <div className="grow">
                        <div className="strong">{w.name}</div>
                        <div className="tiny muted">
                          {shortDate(w.startDate)}-{shortDate(w.endDate)} · {w.doneTasks}/{w.totalTasks} משימות
                        </div>
                      </div>
                      <Ring value={w.readiness} size={60} tone={w.totalTasks === 0 ? 'gray' : undefined} />
                    </div>
                  ))}
                </div>
              )}
              <div className="card">
                <div className="card-head">
                  <h3 className="grow">משימות כלליות של הפלוגה</h3>
                  <span className="tiny mono muted">{data.teamTasks.length}</span>
                </div>
                <div className="card-body">
                  {data.teamTasks.length === 0 ? (
                    <p className="small muted">אין משימות כלליות פתוחות.</p>
                  ) : (
                    <div className="list">
                      {data.teamTasks.slice(0, 8).map((t) => (t.groupCopies.length > 1 ? <GroupTaskRow key={t.id} task={t} /> : <TaskRow key={t.id} task={t} />))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </TaskBulkScope>
  );
}

/** What goes on now in the course's schedule and what comes next - the schedule where the day starts. */
function TodayOnSchedule() {
  const today = todayKey();
  const { data } = useApi<ScheduleEvent[]>(`/api/events?from=${today}&to=${today}`, ['events']);
  const navigate = useNavigate();
  if (!data) return null;
  return (
    <div className="my-up-next">
      <UpNext
        events={data}
        today={today}
        nowTime={fmtTime(new Date().toISOString())}
        onOpen={(e) => navigate(`/schedule?date=${e.date}&event=${e.id}`)}
        head={
          <>
            <Icon name="calendar" size={15} />
            <span className="grow">לו"ז היום</span>
            <Link to="/schedule" className="un-link">
              ללו"ז <Icon name="chevronLeft" size={14} />
            </Link>
          </>
        }
      />
    </div>
  );
}

/**
 * The day so far, ticked off: one mark for each task done today, still late or due today - filling in as
 * they are done; when nothing is left for today, it says so, with a check (and a buzz, the moment it happens).
 */
function DayProgress({ done, late, today }: { done: number; late: number; today: number }) {
  const navigate = useNavigate();
  const left = late + today;
  const all = done + left;
  // the last one done while the page is open: that is the moment to mark
  const before = useRef(left);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    const was = before.current;
    before.current = left;
    if (was > 0 && left === 0 && done > 0) {
      haptic('success');
      setCleared(true);
    }
  }, [left, done]);
  if (!all) return null;
  const marks = all <= 24;
  return (
    <div className={`card day-progress${left === 0 ? ' is-clear' : ''}${cleared ? ' just-cleared' : ''}`} role="group" aria-label="היום שלך">
      <div className="row">
        {left === 0 ? (
          <>
            <span className="day-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="12" cy="12" r="10.5" />
                <path d="M7 12.5l3.2 3.2L17 9" />
              </svg>
            </span>
            <span className="grow strong">סיימת את כל מה שהיה להיום</span>
            <button type="button" className="btn btn-sm" onClick={() => navigate('/day-end')}>
              <Icon name="moon" size={14} /> סיכום יום
            </button>
          </>
        ) : (
          <>
            <span className="grow">
              <b>היום שלך</b>
              <span className="small muted">
                {' '}
                · {done === 1 ? 'אחת בוצעה, ' : done ? `${done} בוצעו, ` : ''}
                {left === 1 ? 'נשארה אחת' : `נשארו ${left}`}
              </span>
            </span>
            <span className="mono small muted">
              {done}/{all}
            </span>
          </>
        )}
      </div>
      {marks ? (
        <div className="day-marks" aria-hidden="true">
          {Array.from({ length: all }, (_, i) => (
            <i key={i} className={i < done ? 'is-done' : i < done + late ? 'is-late' : ''} />
          ))}
        </div>
      ) : (
        <div className="day-bar" aria-hidden="true">
          <i style={{ width: `${(done / all) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** A number at the top; a tap brings its group of tasks into view (when it has any). */
function MiniStat({ n, label, alert, target }: { n: number; label: string; alert?: boolean; target: string }) {
  // a drawer opens on the way (the done ones are tucked in one)
  const go = () => {
    revealDrawer(target);
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <button type="button" className={`card stat${alert ? ' alert' : ''}`} style={{ textAlign: 'start', cursor: n ? 'pointer' : 'default' }} onClick={go} disabled={!n} aria-label={`${label}: ${n}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-num">
        <CountUp value={n} />
      </span>
    </button>
  );
}

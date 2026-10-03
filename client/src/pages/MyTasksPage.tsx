// Sections 10 and 48 - what a staff member opens in the morning.

import { useNavigate } from 'react-router';
import { shortDate } from '@shared/dates';
import type { MyTasksData, Task } from '@shared/types';
import { DisciplineCard } from '../components/DisciplineCard';
import { PendingAnnouncements } from '../components/Announcements';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { BulkToggle } from '../components/Bulk';
import { GroupTitle, TaskBulkScope, TaskList } from '../components/TaskRow';
import { Empty, ErrorBox, Loading, openable, PageHead, Ring } from '../components/ui';
import { fmtLongDate, greetName, greeting, todayKey } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi, useTick } from '../lib/useApi';

export function MyTasksPage() {
  const { user, isCommander } = useSession();
  const { data, error, loading } = useApi<MyTasksData & { teamTasks: Task[] }>('/api/my', ['tasks', 'weeks']);
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
          <div className="stats">
            <MiniStat n={data.stats.today} label="היום" target="group-today" />
            <MiniStat n={data.stats.overdue} label="באיחור" alert={data.stats.overdue > 0} target="group-overdue" />
            <MiniStat n={data.stats.week} label="השבוע" target="group-week" />
            <MiniStat n={data.stats.doneToday} label="הושלמו היום" target="group-done" />
          </div>

          <div className="split mt-16">
            <div>
              {total === 0 && <Empty title="אין משימות פתוחות" text="כל הכבוד. משימות חדשות יופיעו כאן ברגע שייפתחו." />}
              {data.overdue.length > 0 && (
                <>
                  <GroupTitle id="group-overdue" title="באיחור" count={data.overdue.length} tone="red" />
                  <TaskList tasks={data.overdue} showOwner={false} />
                </>
              )}
              {data.today.length > 0 && (
                <>
                  <GroupTitle id="group-today" title="היום" count={data.today.length} tone="orange" />
                  <TaskList tasks={data.today} showOwner={false} />
                </>
              )}
              {data.important.length > 0 && (
                <>
                  <GroupTitle title="חשוב - עדיפות גבוהה" count={data.important.length} tone="red" />
                  <TaskList tasks={data.important} showOwner={false} />
                </>
              )}
              {data.week.length > 0 && (
                <>
                  <GroupTitle id="group-week" title="השבוע" count={data.week.length} tone="yellow" />
                  <TaskList tasks={data.week} showOwner={false} />
                </>
              )}
              {data.later.length > 0 && (
                <>
                  <GroupTitle title="בהמשך" count={data.later.length} tone="gray" />
                  <TaskList tasks={data.later} showOwner={false} />
                </>
              )}
              {data.waiting.length > 0 && (
                <>
                  <GroupTitle title="ממתין לאישור מפקד" count={data.waiting.length} tone="blue" />
                  <TaskList tasks={data.waiting} showOwner={false} />
                </>
              )}
              {data.recentDone.length > 0 && (
                <>
                  <GroupTitle id="group-done" title="הושלמו לאחרונה" count={data.recentDone.length} tone="green" />
                  <TaskList tasks={data.recentDone} showOwner={false} />
                </>
              )}
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
                  {data.teamTasks.length === 0 ? <p className="small muted">אין משימות כלליות פתוחות.</p> : <TaskList tasks={data.teamTasks.slice(0, 8)} />}
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

/** A number at the top; a tap brings its group of tasks into view (when it has any). */
function MiniStat({ n, label, alert, target }: { n: number; label: string; alert?: boolean; target: string }) {
  const go = () => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <button type="button" className={`card stat${alert ? ' alert' : ''}`} style={{ textAlign: 'start', cursor: n ? 'pointer' : 'default' }} onClick={go} disabled={!n} aria-label={`${label}: ${n}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-num">{n}</span>
    </button>
  );
}

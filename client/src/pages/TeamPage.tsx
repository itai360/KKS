// Sections 11-12: the staff and each staff member's page.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { shortDate } from '@shared/dates';
import type { StaffPageData, StaffStatus } from '@shared/types';
import { staffHealthLabel } from '@shared/taskLogic';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { TaskList } from '../components/TaskRow';
import { Empty, ErrorBox, Loading, PageHead, Ring, initials } from '../components/ui';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function TeamPage() {
  const { data, error, loading } = useApi<StaffStatus[]>('/api/team');
  const navigate = useNavigate();
  return (
    <div className="page">
      <PageHead title="הצוות" sub="אצל מי יש עומס או עיכוב - בלי לעבור איש-איש ולשאול." />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={3} />
      ) : !data?.length ? (
        <Empty icon="users" title="אין אנשי סגל" text="הוסיפו אנשי סגל במסך ההגדרות." />
      ) : (
        <div className="staff-grid fade-in">
          {data.map((s) => (
            <div key={s.userId} className="card staff-card" onClick={() => navigate(`/team/${s.userId}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/team/${s.userId}`)}>
              <div className="row">
                <div className="avatar">{initials(s.name)}</div>
                <div className="grow">
                  <div className="strong" style={{ fontSize: 17 }}>
                    {s.name}
                  </div>
                  <div className={`small ${s.overdue ? 'text-red strong' : 'muted'}`}>
                    <span className={`dot t-${s.overdue > 1 ? 'red' : s.overdue === 1 ? 'orange' : 'green'}`} /> {staffHealthLabel(s.overdue)}
                  </div>
                </div>
              </div>
              <div className="staff-nums">
                <div>
                  <b>{s.open}</b>
                  <span>פתוחות</span>
                </div>
                <div>
                  <b>{s.inProgress}</b>
                  <span>בטיפול</span>
                </div>
                <div>
                  <b className={s.overdue ? 'text-red' : ''}>{s.overdue}</b>
                  <span>באיחור</span>
                </div>
                <div>
                  <b>{s.done}</b>
                  <span>הושלמו</span>
                </div>
              </div>
              {(s.waiting > 0 || s.dueToday > 0) && (
                <div className="row gap-6 mt-12 wrap">
                  {s.dueToday > 0 && <span className="badge t-orange">{s.dueToday} להיום</span>}
                  {s.waiting > 0 && <span className="badge t-purple">{s.waiting} ממתינות</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'open' | 'overdue' | 'done' | 'self' | 'commander';

export function StaffPage() {
  const { id } = useParams();
  const { isCommander } = useSession();
  const newTask = useNewTask();
  const { data, error, loading } = useApi<StaffPageData>(`/api/team/${id}`, ['tasks', 'weeks']);
  const [tab, setTab] = useState<Tab>('open');

  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <ErrorBox error={error} />
      </div>
    );
  const s = data.stats;
  const lists: Record<Tab, { label: string; tasks: StaffPageData['open'] }> = {
    open: { label: 'פתוחות', tasks: data.open },
    overdue: { label: 'באיחור', tasks: data.overdue },
    done: { label: 'הושלמו', tasks: data.done },
    self: { label: 'שפתח לעצמו', tasks: data.selfCreated },
    commander: { label: 'ממפקד הקורס', tasks: data.fromCommander },
  };

  return (
    <div className="page">
      <PageHead
        eyebrow={data.user.title || (data.user.role === 'commander' ? 'מפקד הקורס' : 'איש סגל')}
        title={data.user.displayName}
        sub={staffHealthLabel(s.overdue)}
        actions={
          isCommander && (
            <button className="btn btn-primary" onClick={() => newTask({ ownerIds: [data.user.id] })}>
              <Icon name="plus" /> משימה ל{data.user.displayName}
            </button>
          )
        }
      />
      <div className="stats fade-in">
        <div className="card stat" style={{ cursor: 'default' }}>
          <span className="stat-label">פתוחות</span>
          <span className="stat-num">{s.open}</span>
          <span className="stat-hint">{s.inProgress} בטיפול · {s.waiting} ממתינות</span>
        </div>
        <div className={`card stat${s.overdue ? ' alert' : ''}`} style={{ cursor: 'default' }}>
          <span className="stat-label">באיחור</span>
          <span className="stat-num">{s.overdue}</span>
        </div>
        <div className="card stat" style={{ cursor: 'default' }}>
          <span className="stat-label">הושלמו</span>
          <span className="stat-num">{s.done}</span>
          <span className="stat-hint">{s.doneThisWeek} השבוע</span>
        </div>
        <div className="card stat" style={{ cursor: 'default' }}>
          <span className="stat-label">עמידה בזמנים</span>
          <span className="stat-num">{s.onTimePct}%</span>
          <span className="stat-hint">
            באיחור {s.latePct}% · פתוחות באיחור {s.openLatePct}%
          </span>
        </div>
      </div>
      <p className="tiny muted mt-8">הנתונים נועדו לבקרה ניהולית ולא לציון פורמלי.</p>

      <div className="split mt-16">
        <div>
          <div className="tabs">
            {(Object.keys(lists) as Tab[]).map((k) => (
              <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
                {lists[k].label}
                <span className="n">{lists[k].tasks.length}</span>
              </button>
            ))}
          </div>
          <TaskList tasks={lists[tab].tasks} showOwner={false} empty={<Empty title="אין משימות" />} />
        </div>
        <div className="col gap-16 sticky-side">
          <div className="card">
            <div className="card-head">
              <h3>הקרובות ביותר</h3>
            </div>
            <div className="card-body">
              {data.upcoming.length ? <TaskList tasks={data.upcoming.slice(0, 5)} showOwner={false} /> : <p className="small muted">אין משימות קרובות.</p>}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h3>שבועות באחריותו</h3>
            </div>
            {data.weeks.length === 0 && <div className="card-body small muted">לא משויך כמפק"צ אחראי לשבוע.</div>}
            {data.weeks.map((w) => (
              <Link key={w.id} to={`/weeks/${w.id}`} className="row" style={{ padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
                <div className="grow">
                  <div className="strong">{w.name}</div>
                  <div className="tiny muted">
                    {shortDate(w.startDate)}-{shortDate(w.endDate)}
                  </div>
                </div>
                <Ring value={w.readiness} size={54} tone={w.totalTasks === 0 ? 'gray' : undefined} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

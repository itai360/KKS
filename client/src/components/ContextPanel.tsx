// The panel beside the calendar, as Google Calendar keeps one at its edge: the day picked (what is on it,
// what is due, who is away), its course week (the lead, the goals, how ready it is, what is late), the
// person's own open tasks, and what waits for the commander's decision. All from the course's own API -
// what each person may see is the server's to say.

import { Link } from 'react-router';
import { dayOrder, inRange, type CalItem } from '@shared/calendarLayers';
import type { Task, TaskRequest, Week } from '@shared/types';
import type { PanelTab } from '../lib/calendarPrefs';
import { setCalendarPrefs } from '../lib/calendarPrefs';
import { fmtDeadline } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { longDay } from './ItemCard';
import { TaskList } from './TaskRow';
import { Empty, Loading, Ring } from './ui';

const TABS: { id: PanelTab; label: string; icon: string; commander?: boolean }[] = [
  { id: 'day', label: 'היום שנבחר', icon: 'sun' },
  { id: 'week', label: 'השבוע בקורס', icon: 'layers' },
  { id: 'tasks', label: 'המשימות שלי', icon: 'tasks' },
  { id: 'approvals', label: 'ממתין להחלטה', icon: 'inbox', commander: true },
];

/** the strip of the panel's tabs at the calendar's edge: a press opens one, a second press closes it */
export function PanelStrip({ panel }: { panel: PanelTab | null }) {
  const { isCommander } = useSession();
  return (
    <div className="gc-strip" role="toolbar" aria-label="חלונית צד">
      {TABS.filter((t) => !t.commander || isCommander).map((t) => (
        <button
          key={t.id}
          type="button"
          className={`icon-btn${panel === t.id ? ' is-on' : ''}`}
          aria-pressed={panel === t.id}
          aria-label={t.label}
          title={t.label}
          onClick={() => setCalendarPrefs({ panel: panel === t.id ? null : t.id })}
        >
          <Icon name={t.icon} />
        </button>
      ))}
    </div>
  );
}

function DayTab({ date, items, onOpen }: { date: string; items: CalItem[]; onOpen: (item: CalItem, el: HTMLElement) => void }) {
  const day = inRange(items, date, date).sort(dayOrder);
  const groups: { title: string; list: CalItem[] }[] = [
    { title: 'אירועים', list: day.filter((i) => i.src.kind === 'event' || i.src.kind === 'external') },
    { title: 'להגיש היום', list: day.filter((i) => i.src.kind === 'task') },
    { title: 'לא בבסיס', list: day.filter((i) => i.src.kind === 'absence') },
    { title: 'עוד ביום הזה', list: day.filter((i) => i.src.kind === 'experience' || i.src.kind === 'debrief' || i.src.kind === 'week') },
  ];
  return (
    <div className="cp-body">
      <h3 className="cp-day">{longDay(date)}</h3>
      {!day.length && <Empty icon="calendar" title="יום פנוי" text="אין ביום הזה כלום מהשכבות שמוצגות." />}
      {groups
        .filter((g) => g.list.length)
        .map((g) => (
          <section key={g.title} className="cp-group">
            <div className="label-caps">{g.title}</div>
            {g.list.map((i) => (
              <button key={i.key} type="button" className={`cp-item c-${i.color}${i.faded ? ' is-faded' : ''}`} onClick={(e) => onOpen(i, e.currentTarget)}>
                <span className="cp-swatch" aria-hidden="true" />
                <span className="grow">
                  <span className="cp-item-title">{i.title}</span>
                  <span className="tiny muted">{[i.start && i.src.kind !== 'task' ? `${i.start}${i.end ? ` - ${i.end}` : ''}` : i.src.kind === 'task' ? `עד ${i.start}` : '', i.sub].filter(Boolean).join(' · ')}</span>
                </span>
                {i.overdue && <span className="badge t-red">באיחור</span>}
              </button>
            ))}
          </section>
        ))}
    </div>
  );
}

function WeekTab({ week }: { week: Week | undefined }) {
  // what is late or urgent this week - the server keeps to what this person may see
  const tasks = useApi<Task[]>(week ? `/api/tasks?week=${week.id}&hideClosed=1&recurring=0` : null, ['tasks']);
  if (!week) return <div className="cp-body"><Empty icon="layers" title="לא בתוך שבוע של הקורס" text="היום שנבחר לא נופל בשום שבוע בקורס." /></div>;
  const critical = (tasks.data ?? []).filter((t) => t.overdue || t.priority === 'critical' || t.priority === 'high' || t.blockReason).slice(0, 8);
  return (
    <div className="cp-body">
      <div className="cp-week">
        <Ring value={week.readiness} size={64} tone={week.totalTasks === 0 ? 'gray' : undefined} />
        <div className="grow">
          <h3>{week.name}</h3>
          <div className="small muted">{[week.leadName && `מפק"צ מוביל: ${week.leadName}`, week.totalTasks ? `${week.doneTasks}/${week.totalTasks} משימות` : 'אין משימות', week.overdueTasks ? `${week.overdueTasks} באיחור` : ''].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {week.goals && (
        <section className="cp-group">
          <div className="label-caps">מטרות השבוע</div>
          <p className="small cp-goals">{week.goals}</p>
        </section>
      )}
      <section className="cp-group">
        <div className="label-caps">באיחור, דחוף או חסום</div>
        {tasks.loading && !tasks.data ? <Loading rows={2} /> : <TaskList tasks={critical} empty={<p className="small muted">אין - השבוע בדרך הנכונה.</p>} />}
      </section>
      <div className="cp-links">
        <Link to={`/weeks/${week.id}`} className="btn btn-sm btn-primary">
          דף השבוע
        </Link>
        <Link to={`/weekly/${week.id}`} className="btn btn-sm">
          שבועי
        </Link>
        <Link to={`/weeks/${week.id}/order`} className="btn btn-sm btn-ghost">
          פקודת שבוע
        </Link>
      </div>
    </div>
  );
}

function TasksTab() {
  const mine = useApi<Task[]>('/api/tasks?owner=me&hideClosed=1&recurring=0', ['tasks']);
  const list = [...(mine.data ?? [])].sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 30);
  return (
    <div className="cp-body">
      {mine.loading && !mine.data ? <Loading rows={4} /> : <TaskList tasks={list} showOwner={false} collapse={false} empty={<Empty icon="check" title="אין משימות פתוחות" text="כל המשימות שלך הושלמו." />} />}
      <div className="cp-links">
        <Link to="/my" className="btn btn-sm">
          כל המשימות שלי
        </Link>
      </div>
    </div>
  );
}

function ApprovalsTab() {
  const requests = useApi<TaskRequest[]>('/api/requests', ['requests', 'tasks']);
  const pending = useApi<Task[]>('/api/tasks?status=pending_approval', ['tasks']);
  const n = (requests.data?.length ?? 0) + (pending.data?.length ?? 0);
  return (
    <div className="cp-body">
      {requests.loading && !requests.data ? (
        <Loading rows={3} />
      ) : !n ? (
        <Empty icon="inbox" title="אין מה להחליט" text="אין בקשות ואין משימות שממתינות לאישור." />
      ) : (
        <>
          {(pending.data ?? []).map((t) => (
            <Link key={`t${t.id}`} to={`/tasks/${t.id}`} className="cp-item">
              <span className="grow">
                <span className="cp-item-title">{t.title}</span>
                <span className="tiny muted">ממתינה לאישור · {t.ownerName}</span>
              </span>
              <Icon name="chevronLeft" size={16} />
            </Link>
          ))}
          {(requests.data ?? []).map((r) => (
            <Link key={`r${r.id}`} to="/requests" className="cp-item">
              <span className="grow">
                <span className="cp-item-title">{r.taskTitle}</span>
                <span className="tiny muted">
                  {r.requestedByName} · {r.newDeadline ? `הארכה ל-${fmtDeadline(r.newDeadline)}` : r.newOwnerName ? `העברה ל${r.newOwnerName}` : 'בקשה'}
                </span>
              </span>
              <Icon name="chevronLeft" size={16} />
            </Link>
          ))}
        </>
      )}
      <div className="cp-links">
        <Link to="/requests" className="btn btn-sm">
          אישורים ובקשות
        </Link>
      </div>
    </div>
  );
}

export function ContextPanel({ tab, date, items, week, onOpen }: { tab: PanelTab; date: string; items: CalItem[]; week: Week | undefined; onOpen: (item: CalItem, el: HTMLElement) => void }) {
  const t = TABS.find((x) => x.id === tab)!;
  return (
    <aside className="gc-panel" aria-label={t.label}>
      <div className="gc-panel-head">
        <h2 className="grow">{t.label}</h2>
        <button type="button" className="icon-btn" onClick={() => setCalendarPrefs({ panel: null })} aria-label="סגירת החלונית" title="סגירה">
          <Icon name="x" />
        </button>
      </div>
      {tab === 'day' && <DayTab date={date} items={items} onOpen={onOpen} />}
      {tab === 'week' && <WeekTab week={week} />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'approvals' && <ApprovalsTab />}
    </aside>
  );
}

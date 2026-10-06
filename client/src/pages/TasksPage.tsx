// Section 6 - the course task repository, as a table, list or board, with filters.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type TaskStatus } from '@shared/constants';
import type { Task } from '@shared/types';
import { DeadlineText, PriorityBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { BulkCheck, bulkClick, BulkToggle, useBulk } from '../components/Bulk';
import { canQuickUpdate, TaskBulkScope, TaskList } from '../components/TaskRow';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, openable, PageHead, Seg, Select } from '../components/ui';
import { api, qs } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useIncremental } from '../lib/incremental';
import { useApi, useTick } from '../lib/useApi';

type View = 'table' | 'list' | 'board';
// a remembered view is a convenience: storage can be missing or blocked
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not saved */
  }
}

const SCOPES: [string, string][] = [
  ['open', 'פתוחות'],
  ['overdue', 'באיחור'],
  ['today', 'להיום'],
  ['week', 'לשבוע הקרוב'],
  ['attention', 'חריגות'],
  ['done', 'הושלמו'],
  ['all', 'הכל'],
];

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const { staff, users, weeks, tracks, settings, isCommander } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const [view, setView] = useState<View>(() => (window.innerWidth < 860 ? 'list' : ((readPref('kks.tasksView') as View | null) ?? 'table')));
  useTick();

  const f = {
    scope: params.get('scope') ?? 'open',
    owner: params.get('owner') ?? '',
    week: params.get('week') ?? '',
    track: params.get('track') ?? '',
    domain: params.get('domain') ?? '',
    status: params.get('status') ?? '',
    priority: params.get('priority') ?? '',
    q: params.get('q') ?? '',
    routine: params.get('routine') ?? '0',
  };
  const set = (k: keyof typeof f, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const url = `/api/tasks${qs({
    scope: f.scope === 'all' ? undefined : f.scope,
    owner: f.owner,
    week: f.week,
    track: f.track,
    domain: f.domain,
    status: f.status,
    priority: f.priority,
    q: f.q,
    recurring: f.routine === '1' ? undefined : '0',
  })}`;
  const { data, error, loading } = useApi<Task[]>(url);
  const changeView = (v: View) => {
    setView(v);
    writePref('kks.tasksView', v);
  };
  const people = isCommander ? users : staff;
  const active = [f.owner, f.week, f.track, f.domain, f.status, f.priority, f.q].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <TaskBulkScope tasks={data ?? []}>
    <div className="page">
      <PageHead
        title="כל המשימות"
        sub={data ? `${data.length} משימות` : undefined}
        actions={
          <>
            <BulkToggle />
            <Seg
              value={view}
              onChange={changeView}
              options={[
                { value: 'table', label: 'טבלה', icon: 'tasks' },
                { value: 'list', label: 'רשימה', icon: 'layers' },
                { value: 'board', label: 'לוח', icon: 'board' },
              ]}
            />
            <button
              className="btn hide-mobile"
              onClick={() => data && exportCsv(data).catch((e: Error) => toast({ title: e.message, tone: 'red' }))}
              disabled={!data?.length}
              title="ייצוא הרשימה המסוננת לאקסל"
            >
              <Icon name="download" /> אקסל
            </button>
            <button className="btn btn-primary" onClick={() => newTask({ weekId: f.week ? Number(f.week) : undefined })}>
              <Icon name="plus" /> משימה
            </button>
          </>
        }
      />
      <div className="chips chips-scroll mb-12">
        {SCOPES.map(([v, l]) => (
          <button key={v} className={`chip${f.scope === v ? ' on' : ''}${v === 'overdue' && f.scope === v ? ' t-red' : ''}`} onClick={() => set('scope', v === 'open' ? '' : v)}>
            {l}
          </button>
        ))}
      </div>
      <button className="btn btn-sm only-mobile mb-12" onClick={() => setFiltersOpen(!filtersOpen)}>
        <Icon name="filter" /> סינון{active ? ` (${active})` : ''}
      </button>
      <div className={`filters${filtersOpen ? '' : ' mobile-collapsed'}`}>
        <input className="input" placeholder="מילת מפתח..." value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="חיפוש במשימות" />
        <Select className="select" value={f.owner} onChange={(e) => set('owner', e.target.value)} aria-label="איש סגל">
          <option value="">כל הסגל</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </Select>
        <Select className="select" value={f.week} onChange={(e) => set('week', e.target.value)} aria-label="שבוע">
          <option value="">כל השבועות</option>
          <option value="none">ללא שבוע</option>
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select className="select" value={f.track} onChange={(e) => set('track', e.target.value)} aria-label="ציר">
          <option value="">כל הצירים</option>
          <option value="none">ללא ציר</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select className="select" value={f.domain} onChange={(e) => set('domain', e.target.value)} aria-label="תחום">
          <option value="">כל התחומים</option>
          {settings.domains.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
        <Select className="select" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="סטטוס">
          <option value="">כל הסטטוסים</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          <option value="overdue">באיחור</option>
        </Select>
        <Select className="select" value={f.priority} onChange={(e) => set('priority', e.target.value)} aria-label="עדיפות">
          <option value="">כל העדיפויות</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
        <label className="check small">
          <input type="checkbox" checked={f.routine === '1'} onChange={(e) => set('routine', e.target.checked ? '1' : '')} />
          כולל משימות שגרה
        </label>
        {active > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setParams(f.scope !== 'open' ? { scope: f.scope } : {}, { replace: true })}>
            <Icon name="x" /> נקה סינון
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={6} />
      ) : !data?.length ? (
        <Empty icon="filter" title="אין משימות" text="אין משימות שתואמות את הסינון." />
      ) : view === 'list' ? (
        <TaskList tasks={data} />
      ) : view === 'table' ? (
        <TaskTable tasks={data} />
      ) : (
        <Board tasks={data} />
      )}
    </div>
    </TaskBulkScope>
  );
}

function TaskTable({ tasks }: { tasks: Task[] }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  const [sort, setSort] = useState<'deadline' | 'priority' | 'owner' | 'status'>('deadline');
  const sorted = useMemo(() => {
    const rank = { low: 0, normal: 1, high: 2, critical: 3 };
    const list = [...tasks];
    if (sort === 'priority') list.sort((a, b) => rank[b.priority] - rank[a.priority] || a.deadline.localeCompare(b.deadline));
    else if (sort === 'owner') list.sort((a, b) => a.ownerName.localeCompare(b.ownerName, 'he') || a.deadline.localeCompare(b.deadline));
    else if (sort === 'status') list.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.deadline.localeCompare(b.deadline));
    else list.sort((a, b) => a.deadline.localeCompare(b.deadline));
    return list;
  }, [tasks, sort]);
  const { shown, more } = useIncremental(sorted);
  const th = (key: typeof sort, label: string) => (
    <th>
      <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto', fontSize: 12, color: sort === key ? 'var(--ink)' : undefined }} onClick={() => setSort(key)}>
        {label} {sort === key && '↓'}
      </button>
    </th>
  );
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 6, padding: 0 }} />
            <th>משימה</th>
            {th('owner', 'אחראי')}
            <th>יצר</th>
            <th>תחום</th>
            <th>שבוע</th>
            {th('deadline', 'דד-ליין')}
            {th('priority', 'עדיפות')}
            {th('status', 'סטטוס')}
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.id} className={`click t-${t.tone}${bulk?.selected.has(t.id) ? ' selected' : ''}`} {...openable(bulkClick(bulk, t.id, () => navigate(`/tasks/${t.id}`)), { role: false })}>
              <td style={{ padding: 0, width: 6, background: 'var(--tone)' }} />
              <td style={{ maxWidth: 340 }}>
                <div className="strong row gap-6" style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}>
                  <BulkCheck id={t.id} />
                  {t.title}
                </div>
                {t.subtaskTotal > 0 && (
                  <div className="tiny muted mono">
                    {t.subtaskDone}/{t.subtaskTotal} משימות משנה
                  </div>
                )}
              </td>
              <td>
                {t.ownerName}
                {t.participantIds.length > 0 && <span className="muted"> +{t.participantIds.length}</span>}
              </td>
              <td className="small muted">{t.createdByName}</td>
              <td className="small">{t.domain || <span className="faint">-</span>}</td>
              <td className="small">{t.weekName || <span className="faint">-</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <span className="task-meta" style={{ marginTop: 0 }}>
                  <DeadlineText task={t} />
                </span>
              </td>
              <td>
                <PriorityBadge priority={t.priority} hideNormal={false} />
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <StatusBadge status={t.status} overdue={t.overdue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </div>
  );
}

const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'pending_approval', 'done'];

function Board({ tasks }: { tasks: Task[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isCommander } = useSession();
  const [over, setOver] = useState<TaskStatus | null>(null);

  const drop = async (taskId: number, to: TaskStatus) => {
    setOver(null);
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === to) return;
    if (!canQuickUpdate(t, user.id, isCommander)) return toast({ title: 'רק האחראים יכולים לעדכן סטטוס', tone: 'red' });
    let action: string | null = null;
    if (to === 'in_progress' && t.status === 'todo') action = 'start';
    else if (to === 'in_progress' && t.status === 'waiting') action = 'unblock';
    else if (to === 'done' || to === 'pending_approval') action = t.status === 'pending_approval' ? 'approve' : 'complete';
    else if (to === 'waiting') {
      toast({ title: 'סימון חסם דורש הסבר - פתח את המשימה', tone: 'blue' });
      return navigate(`/tasks/${t.id}`);
    }
    if (!action) return toast({ title: 'מעבר זה לא אפשרי מהלוח', tone: 'red' });
    try {
      await api.post(`/api/tasks/${t.id}/transition`, { action });
      emitLocalChange('tasks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <div className="board">
      {BOARD_COLUMNS.map((col) => {
        const list = tasks.filter((t) => t.status === col);
        return (
          <div
            key={col}
            className={`board-col${over === col ? ' drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => void drop(Number(e.dataTransfer.getData('text/plain')), col)}
          >
            <div className="board-col-head">
              <StatusBadge status={col} />
              <span className="mono tiny muted">{list.length}</span>
            </div>
            <BoardCards tasks={list} />
          </div>
        );
      })}
    </div>
  );
}

function BoardCards({ tasks }: { tasks: Task[] }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  const { shown, more } = useIncremental(tasks, 60);
  return (
    <>
      {shown.map((t) => (
        <div
          key={t.id}
          className={`board-card t-${t.tone}${bulk?.selected.has(t.id) ? ' selected' : ''}`}
          draggable={!bulk?.active}
          onDragStart={(e) => e.dataTransfer.setData('text/plain', String(t.id))}
          {...openable(bulkClick(bulk, t.id, () => navigate(`/tasks/${t.id}`)))}
        >
          <div className="task-title row gap-6">
            <BulkCheck id={t.id} />
            {t.title}
          </div>
          <div className="task-meta">
            <span>{t.ownerName}</span>
            <span className="sep">
              <DeadlineText task={t} />
            </span>
          </div>
          <div className="row gap-4 mt-8 wrap">
            <PriorityBadge priority={t.priority} />
            {t.overdue && <span className="badge t-red">באיחור</span>}
            {t.domain && <span className="badge">{t.domain}</span>}
          </div>
        </div>
      ))}
      {more}
    </>
  );
}

function exportCsv(tasks: Task[]) {
  return saveCsv(
    'משימות',
    ['משימה', 'אחראי', 'משתתפים', 'יצר', 'תחום', 'שבוע', 'דד-ליין', 'עדיפות', 'סטטוס', 'באיחור', 'הושלמה'],
    tasks.map((t) => [
      t.title,
      t.ownerName,
      t.participantIds.length,
      t.createdByName,
      t.domain,
      t.weekName ?? '',
      fmtDateTime(t.deadline),
      PRIORITY_LABELS[t.priority],
      STATUS_LABELS[t.status],
      t.overdue ? 'כן' : '',
      t.completedAt ? fmtDateTime(t.completedAt) : '',
    ]),
  );
}

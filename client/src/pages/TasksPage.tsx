// Section 6 - the course task repository, as a table, list or board, with filters.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type Priority, type TaskStatus } from '@shared/constants';
import type { Task, TaskDetail } from '@shared/types';
import { DeadlineText, PriorityBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { BulkCheck, bulkClick, BulkToggle, useBulk } from '../components/Bulk';
import { canQuickUpdate, TaskBulkScope, TaskList } from '../components/TaskRow';
import { TaskActions } from '../components/TaskActions';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, openable, PageHead, Seg, Select } from '../components/ui';
import { api, qs } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useIncremental } from '../lib/incremental';
import { useApi, useTick } from '../lib/useApi';

import { boardTransition, changeTaskFilter, newTaskFromFilters, sortTasks, taskFilters, taskSortPreference, taskViewPreference, TASK_SCOPES, TASK_SORTS, type TaskSort, type TaskView } from '../lib/taskView';
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

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const { user, staff, users, weeks, tracks, settings, isCommander, viewing } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const [view, setView] = useState<TaskView>(() => taskViewPreference(readPref('kks.tasksView'), window.innerWidth < 860));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tick = useTick();
  const f = taskFilters(params);
  const [query, setQuery] = useState(f.q);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(f.q), 250);
    return () => clearTimeout(timer);
  }, [f.q]);
  const set = (key: keyof typeof f, value: string) => setParams((current) => changeTaskFilter(current, key, value), { replace: true });
  const sort = taskSortPreference(params.get('sort'));
  const reversed = params.get('dir') === 'reverse';
  const changeSort = (value: TaskSort, toggle = false) => {
    const next = new URLSearchParams(params);
    next.set('sort', value);
    if (toggle && value === sort && !reversed) next.set('dir', 'reverse');
    else next.delete('dir');
    setParams(next, { replace: true });
  };
  const scopedStatus = f.scope === 'waiting' || f.scope === 'pending_approval' ? f.scope : f.status;
  const url = `/api/tasks${qs({
    scope: f.scope === 'all' ? undefined : scopedStatus === f.scope ? 'open' : f.scope,
    owner: f.owner, createdBy: f.createdBy === 'me' ? user.id : f.createdBy,
    week: f.week, track: f.track, domain: f.domain, status: scopedStatus,
    priority: f.priority, q: query, recurring: f.routine === '1' ? undefined : '0',
  })}`;
  const { data, error, loading, reload } = useApi<Task[]>(url, ['tasks', 'users', 'weeks']);
  useEffect(() => {
    if (tick > 0) void reload();
  }, [tick, reload]);
  const busy = loading || query !== f.q || retrying;
  const sorted = useMemo(() => sortTasks(data ?? [], sort, reversed), [data, sort, reversed]);
  const shown = busy || error ? [] : sorted;
  const changeView = (value: TaskView) => {
    setView(value);
    writePref('kks.tasksView', value);
  };
  const people = isCommander ? users : staff;
  const nameOf = (id: string) => id === 'me' ? 'אני' : users.find((u) => String(u.id) === id)?.displayName ?? id;
  const activeFilters = [
    f.owner && { key: 'owner', label: `אחראי: ${nameOf(f.owner)}` },
    f.createdBy && { key: 'createdBy', label: `יצר: ${nameOf(f.createdBy)}` },
    f.week && { key: 'week', label: f.week === 'none' ? 'ללא שבוע' : weeks.find((w) => String(w.id) === f.week)?.name ?? 'שבוע' },
    f.track && { key: 'track', label: f.track === 'none' ? 'ללא ציר' : tracks.find((t) => String(t.id) === f.track)?.name ?? 'ציר' },
    f.domain && { key: 'domain', label: f.domain },
    f.status && { key: 'status', label: f.status === 'overdue' ? 'באיחור' : STATUS_LABELS[f.status as TaskStatus] },
    f.priority && { key: 'priority', label: `עדיפות: ${PRIORITY_LABELS[f.priority as Priority] ?? f.priority}` },
    f.routine === '1' && { key: 'routine', label: 'כולל משימות שגרה' },
  ].filter(Boolean) as { key: keyof typeof f; label: string }[];
  const filtered = activeFilters.length > 0 || !!f.q;
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const key of ['owner', 'createdBy', 'week', 'track', 'domain', 'status', 'priority', 'q', 'routine']) next.delete(key);
    setParams(next, { replace: true });
    searchRef.current?.focus();
  };
  const create = () => newTask(newTaskFromFilters(f, user.id));

  return (
    <TaskBulkScope tasks={shown}>
      <div className="page tasks-page">
        <PageHead title="כל המשימות" sub="אחריות, דד-ליינים ומעקב אחר הביצוע של הסגל." actions={!viewing && (
          <button className="btn btn-primary" onClick={create}><Icon name="plus" /> משימה חדשה</button>
        )} />
        <section className="card tasks-controls" aria-label="חיפוש וסינון משימות">
          <div className="tasks-search-row">
            <div className="tasks-search">
              <Icon name="search" />
              <input ref={searchRef} className="input" type="search" placeholder="חיפוש משימה, אחראי או מילת מפתח" value={f.q}
                onChange={(e) => set('q', e.target.value)} aria-label="חיפוש במשימות" />
              {f.q && <button className="icon-btn" aria-label="נקה חיפוש" onClick={() => { set('q', ''); searchRef.current?.focus(); }}><Icon name="x" /></button>}
            </div>
            <button className={`btn${filtersOpen ? ' btn-primary' : ''}`} aria-expanded={filtersOpen} aria-controls="task-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
              <Icon name="filter" /> סינון{activeFilters.length > 0 && <span className="tasks-filter-count">{activeFilters.length}</span>}
            </button>
          </div>
          <div className="tasks-scopes" role="group" aria-label="מצב המשימות">
            {TASK_SCOPES.map(([value, label]) => (
              <button key={value} className={`chip${f.scope === value ? ' on' : ''}${value === 'overdue' && f.scope === value ? ' t-red' : ''}`}
                aria-pressed={f.scope === value} onClick={() => set('scope', value === 'open' ? '' : value)}>{label}</button>
            ))}
          </div>
          <div className="tasks-shortcuts" role="group" aria-label="משימות הקשורות אליי">
            <button className={`chip chip-sm${f.owner === 'me' || f.owner === String(user.id) ? ' on' : ''}`}
              aria-pressed={f.owner === 'me' || f.owner === String(user.id)} onClick={() => set('owner', f.owner === 'me' || f.owner === String(user.id) ? '' : 'me')}><Icon name="my" /> באחריותי</button>
            <button className={`chip chip-sm${f.createdBy === 'me' || f.createdBy === String(user.id) ? ' on' : ''}`}
              aria-pressed={f.createdBy === 'me' || f.createdBy === String(user.id)} onClick={() => set('createdBy', f.createdBy === 'me' || f.createdBy === String(user.id) ? '' : 'me')}><Icon name="edit" /> משימות שפתחתי</button>
          </div>
          {filtersOpen && <div className="tasks-filter-grid" id="task-filters">
            <Field label="אחראי"><Select value={f.owner === String(user.id) ? 'me' : f.owner} onChange={(e) => set('owner', e.target.value)} aria-label="איש סגל">
              <option value="">כל הסגל</option><option value="me">באחריותי</option>
              {people.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </Select></Field>
            <Field label="שבוע"><Select value={f.week} onChange={(e) => set('week', e.target.value)} aria-label="שבוע">
              <option value="">כל השבועות</option><option value="none">ללא שבוע</option>
              {weeks.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select></Field>
            <Field label="ציר"><Select value={f.track} onChange={(e) => set('track', e.target.value)} aria-label="ציר">
              <option value="">כל הצירים</option><option value="none">ללא ציר</option>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select></Field>
            <Field label="תחום"><Select value={f.domain} onChange={(e) => set('domain', e.target.value)} aria-label="תחום">
              <option value="">כל התחומים</option>{settings.domains.map((d) => <option key={d}>{d}</option>)}
            </Select></Field>
            <Field label="סטטוס"><Select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="סטטוס">
              <option value="">כל הסטטוסים</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}<option value="overdue">באיחור</option>
            </Select></Field>
            <Field label="עדיפות"><Select value={f.priority} onChange={(e) => set('priority', e.target.value)} aria-label="עדיפות">
              <option value="">כל העדיפויות</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </Select></Field>
            <label className="check small tasks-routine"><input type="checkbox" checked={f.routine === '1'} onChange={(e) => set('routine', e.target.checked ? '1' : '')} />כולל משימות שגרה</label>
          </div>}
          {filtered && <div className="tasks-active-filters" aria-label="הסינון הפעיל">
            {activeFilters.map(({ key, label }) => <button key={key} className="tasks-filter-tag" aria-label={`הסר סינון: ${label}`} onClick={() => set(key, '')}>{label}<Icon name="x" size={13} /></button>)}
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>נקה חיפוש וסינון</button>
          </div>}
        </section>
        <div className="tasks-results-toolbar">
          <span className="tasks-result-count" role="status" aria-live="polite">{busy ? 'טוען משימות...' : error ? 'הטעינה נכשלה' : `${shown.length} משימות`}</span>
          <div className="tasks-sort">
            <Select value={sort} onChange={(e) => changeSort(e.target.value as TaskSort)} aria-label="מיון משימות">
              {TASK_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <button className="icon-btn" aria-label="הפוך את סדר המיון" title="הפוך את סדר המיון" aria-pressed={reversed} onClick={() => changeSort(sort, true)}>{reversed ? '↑' : '↓'}</button>
          </div>
          <Seg value={view} onChange={changeView} options={[{ value: 'table', label: 'טבלה', icon: 'tasks' }, { value: 'list', label: 'רשימה', icon: 'layers' }, { value: 'board', label: 'לוח', icon: 'board' }]} />
          {!viewing && <BulkToggle />}
          <button className="btn btn-sm" onClick={() => exportCsv(shown).catch((e: Error) => toast({ title: e.message, tone: 'red' }))} disabled={!shown.length} title="ייצוא הרשימה המסוננת לפי סדר התצוגה"><Icon name="download" /> אקסל</button>
        </div>
        <section className="tasks-results" aria-label="תוצאות המשימות" aria-busy={busy}>
          {busy ? <Loading rows={5} /> : error ? <div className="card card-pad">
            <ErrorBox error={error} /><button className="btn" onClick={async () => { setRetrying(true); try { await reload(); } finally { setRetrying(false); } }}><Icon name="repeat" /> נסה שוב</button>
          </div> : !shown.length ? <div className="card tasks-empty">
            <Empty icon={filtered ? 'search' : 'tasks'} title={filtered ? 'לא נמצאו משימות מתאימות' : 'אין משימות בתצוגה הזו'} text={filtered ? 'אפשר להסיר סינון או לנסות מילות חיפוש אחרות.' : 'משימות שמתאימות למצב שבחרת יופיעו כאן.'} />
            <div className="row wrap gap-8">
              {filtered ? <button className="btn" onClick={clearFilters}>נקה חיפוש וסינון</button> : f.scope !== 'all' && <button className="btn" onClick={() => set('scope', 'all')}>הצג את כל המשימות</button>}
              {!viewing && <button className="btn btn-primary" onClick={create}><Icon name="plus" /> משימה חדשה</button>}
            </div>
          </div> : view === 'list' ? <TaskList tasks={shown} /> : view === 'table' ? <TaskTable tasks={shown} sort={sort} reversed={reversed} onSort={(value) => changeSort(value, true)} /> : <Board tasks={shown} />}
        </section>
      </div>
    </TaskBulkScope>
  );
}

function TaskTable({ tasks, sort, reversed, onSort }: { tasks: Task[]; sort: TaskSort; reversed: boolean; onSort: (value: TaskSort) => void }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  const { shown, more } = useIncremental(tasks);
  const th = (key: TaskSort, label: string) => (
    <th aria-sort={sort === key ? ((key === 'priority' || key === 'newest') !== reversed ? 'descending' : 'ascending') : 'none'}>
      <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto', fontSize: 12, color: sort === key ? 'var(--ink)' : undefined }} onClick={() => onSort(key)}>
        {label} {sort === key && (reversed ? '↑' : '↓')}
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
  const toast = useToast();
  const { user, isCommander, viewing } = useSession();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);
  const columns: TaskStatus[] = tasks.some((t) => t.status === 'cancelled') ? [...BOARD_COLUMNS, 'cancelled'] : BOARD_COLUMNS;
  const drop = async (taskId: number, to: TaskStatus) => {
    setOver(null);
    if (viewing || saving.current) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === to) return;
    const action = boardTransition(task, to, user.id, isCommander);
    if (action === 'details') {
      setSelected(task.id);
      return;
    }
    if (!action) return toast({ title: 'לשינוי הזה יש לפתוח את פעולות המשימה', tone: 'blue' });
    saving.current = true;
    setBusy(true);
    try {
      const result = await api.post<TaskDetail>(`/api/tasks/${task.id}/transition`, { action });
      toast({ title: result.task.status === 'pending_approval' ? 'המשימה נשלחה לאישור' : `הסטטוס עודכן: ${STATUS_LABELS[result.task.status]}`, body: task.title, tone: 'green' });
      emitLocalChange('tasks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return <>
    <p className="small muted tasks-board-hint">{viewing ? 'מחזור קודם - צפייה בלבד.' : 'אפשר לגרור משימה בין עמודות או לבחור "עדכון" בכרטיס.'}</p>
    <div className="board tasks-board" aria-busy={busy} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
      {columns.map((column) => {
        const list = tasks.filter((task) => task.status === column);
        return <section key={column} aria-label={STATUS_LABELS[column]} className={`board-col${over === column ? ' drop' : ''}`}
          onDragOver={(e) => { if (!viewing && !busy) { e.preventDefault(); setOver(column); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); }}
          onDrop={(e) => { e.preventDefault(); void drop(Number(e.dataTransfer.getData('text/plain')), column); }}>
          <div className="board-col-head"><StatusBadge status={column} /><span className="mono tiny muted">{list.length}</span></div>
          {list.length ? <BoardCards tasks={list} busy={busy || !!viewing} onUpdate={setSelected} /> : <div className="tasks-board-empty">אין משימות</div>}
        </section>;
      })}
    </div>
    {selected !== null && <TaskUpdateDialog key={selected} taskId={selected} onClose={() => setSelected(null)} />}
  </>;
}

function BoardCards({ tasks, busy, onUpdate }: { tasks: Task[]; busy: boolean; onUpdate: (id: number) => void }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  const { user, isCommander, viewing } = useSession();
  const { shown, more } = useIncremental(tasks, 60);
  return <>
    {shown.map((task) => <div key={task.id} className={`board-card t-${task.tone}${bulk?.selected.has(task.id) ? ' selected' : ''}`}
      draggable={!busy && !bulk?.active && canQuickUpdate(task, user.id, isCommander)}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(task.id)); e.dataTransfer.effectAllowed = 'move'; }}
      {...openable(bulkClick(bulk, task.id, () => navigate(`/tasks/${task.id}`)))}>
      <div className="task-title row gap-6"><BulkCheck id={task.id} />{task.title}</div>
      <div className="task-meta"><span>{task.ownerName}</span><span className="sep"><DeadlineText task={task} /></span></div>
      <div className="row gap-4 mt-8 wrap"><PriorityBadge priority={task.priority} />{task.overdue && <span className="badge t-red">באיחור</span>}{task.domain && <span className="badge">{task.domain}</span>}</div>
      {task.status === 'waiting' && task.blockReason && <p className="tasks-board-blocker">חסם: {task.blockReason}</p>}
      {!bulk?.active && !viewing && canQuickUpdate(task, user.id, isCommander) && <button className="btn btn-sm tasks-board-update" disabled={busy} aria-label={`עדכון משימה: ${task.title}`}
        onClick={(e) => { e.stopPropagation(); onUpdate(task.id); }}><Icon name="edit" size={14} /> עדכון</button>}
    </div>)}
    {more}
  </>;
}

function TaskUpdateDialog({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, error, loading, reload, setData } = useApi<TaskDetail>(`/api/tasks/${taskId}`);
  return <Modal title={data?.task.title ?? 'עדכון משימה'} onClose={onClose} footer={<>
    <button className="btn" onClick={() => navigate(`/tasks/${taskId}`)}>פתיחת המשימה המלאה</button>
    <button className="btn btn-primary" onClick={onClose}>חזרה ללוח</button>
  </>}>
    {loading && !data ? <Loading rows={3} /> : error ? <><ErrorBox error={error} /><button className="btn" onClick={() => void reload()}>נסה שוב</button></> : data && <>
      <div className="row wrap gap-8 mb-12"><StatusBadge status={data.task.status} overdue={data.task.overdue} /><span className="small muted">{data.task.ownerName}</span><DeadlineText task={data.task} /></div>
      <TaskActions detail={data} onChange={setData} onDeleted={onClose} />
    </>}
  </Modal>;
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

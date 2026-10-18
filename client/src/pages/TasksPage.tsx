// Section 6 - the course task repository, as a table, list or board, with filters.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type TaskStatus } from '@shared/constants';
import type { Task } from '@shared/types';
import { DeadlineText, PriorityBadge, StatusBadge } from '../components/Badges';
import { Icon } from '../components/Icon';
import { useNewTask } from '../components/NewTask';
import { BulkCheck, bulkClick, BulkToggle, useBulk } from '../components/Bulk';
import { unlessHeld, useTaskMenu } from '../components/TaskMenu';
import { canQuickUpdate, doneNow, GroupTag, prefetchTask, ProgressBadge, TaskBulkScope, TaskCheck, TaskList, useGroupTag, useLiveFlash, useTaskTick } from '../components/TaskRow';
import { finishedJustNow, leaveClass, noteFinished, useLeaving } from '../lib/leaving';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, openable, PageHead, Seg, Select } from '../components/ui';
import { api, qs } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useIncremental } from '../lib/incremental';
import { useApi, useTick } from '../lib/useApi';
import { foldTasks, groupLabel, type TaskView } from '../lib/taskGroups';
import { CourseBoard, type BoardGrouping, type BoardSort } from '../components/CourseBoard';
import './TasksWorkspace.css';

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
  ['all', 'הכל'],
  ['open', 'פתוחות'],
  ['overdue', 'באיחור'],
  ['today', 'להיום'],
  ['week', 'לשבוע הקרוב'],
  ['attention', 'חריגות'],
  ['done', 'הושלמו'],
];

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const { staff, users, weeks, tracks, settings, isCommander, user, userName, viewing } = useSession();
  const newTask = useNewTask();
  const toast = useToast();
  const [view, setView] = useState<View>(() => {
    const saved = readPref('kks.workBoardView');
    return saved === 'list' || saved === 'board' ? saved : 'table';
  });
  const [groupBy, setGroupBy] = useState<BoardGrouping>('status');
  const [sortBy, setSortBy] = useState<BoardSort>('deadline');
  useTick();

  const f = {
    scope: params.get('scope') ?? 'all',
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
  // a task given to a group is one row, under the group's name - unless the list is one person's
  const collapse = !f.owner && (view !== 'table' || groupBy !== 'owner');
  const rows = useMemo(() => foldTasks(data ?? [], user.id, collapse), [data, collapse, user.id]);
  const changeView = (v: View) => {
    setView(v);
    writePref('kks.workBoardView', v);
  };
  const people = isCommander ? users : staff;
  const active = [f.owner, f.week, f.track, f.domain, f.status, f.priority, f.routine === '1' ? 'routine' : ''].filter(Boolean).length;
  const filtered = active > 0 || Boolean(f.q);
  const clearFilters = () => setParams(f.scope !== 'all' ? { scope: f.scope } : {}, { replace: true });
  const createTask = () => newTask({ weekId: f.week && f.week !== 'none' ? Number(f.week) : undefined });
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <TaskBulkScope tasks={data ?? []} collapse={collapse}>
    <div className="page tasks-workspace">
      <PageHead
        title="לוח הקורס"
        docTitle="לוח הקורס"
        sub={`${settings.courseName} · משימות, אחריות ותכנון העבודה`}
        actions={
          viewing ? <span className="badge">קורס קודם · לצפייה בלבד</span> : <button className="btn btn-primary" onClick={createTask}>
            <Icon name="plus" /> משימה חדשה
          </button>
        }
      />
      <div className="task-view-tabs">
        <Seg value={view} onChange={changeView} options={[
          { value: 'table', label: 'לוח ראשי', icon: 'tasks' },
          { value: 'board', label: 'קנבן', icon: 'board' },
          { value: 'list', label: 'רשימה', icon: 'layers' },
        ]} />
      </div>
      <section className="task-controls" aria-label="חיפוש וסינון משימות">
        <div className="task-search-row">
          <div className="task-search">
            <Icon name="search" size={20} />
            <input
              className="input"
              type="search"
              placeholder="חיפוש בלוח"
              value={f.q}
              onChange={(e) => set('q', e.target.value)}
              aria-label="חיפוש במשימות"
            />
          </div>
          <button
            className={`btn btn-ghost task-filter-toggle${active ? ' is-set' : ''}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-controls="task-advanced-filters"
          >
            <Icon name="filter" /> סינון
            {active > 0 && <span className="task-filter-count">{active}</span>}
            <Icon name="chevronDown" size={14} className={filtersOpen ? 'is-open' : ''} />
          </button>
          {view === 'table' && <div className="task-board-options">
            <Select className="select" aria-label="קיבוץ משימות" value={groupBy} onChange={(e) => setGroupBy(e.target.value as BoardGrouping)}>
              <option value="status">קיבוץ: סטטוס</option><option value="week">קיבוץ: שבוע</option><option value="owner">קיבוץ: אחראי</option>
            </Select>
            <Select className="select" aria-label="מיון משימות" value={sortBy} onChange={(e) => setSortBy(e.target.value as BoardSort)}>
              <option value="deadline">מיון: תאריך יעד</option><option value="priority">מיון: עדיפות</option><option value="title">מיון: שם משימה</option>
            </Select>
          </div>}
        </div>
        <div className="task-scope-row" role="group" aria-label="אילו משימות להציג">
          {SCOPES.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`task-scope${f.scope === v ? ' is-active' : ''}`}
              aria-pressed={f.scope === v}
              onClick={() => set('scope', v === 'all' ? '' : v)}
            >
              {v === 'open' && <Icon name="tasks" size={15} />}
              {v === 'overdue' && <Icon name="clock" size={15} />}
              {v === 'done' && <Icon name="check" size={15} />}
              {l}
            </button>
          ))}
        </div>
        {filtersOpen && (
          <div id="task-advanced-filters" className="task-advanced-filters">
            <div className="task-filter-heading">
              <span className="strong">סינון הלוח</span>
              {filtered && <button className="btn btn-ghost btn-sm" onClick={clearFilters}><Icon name="x" size={14} /> איפוס סינון</button>}
            </div>
            <div className="task-filter-fields">
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
            </div>
          </div>
        )}
      </section>
      <div className="task-results-toolbar">
        <div className="task-results-summary" aria-live="polite" aria-atomic="true">
          <span className="strong">{SCOPES.find(([scope]) => scope === f.scope)?.[1] ?? 'משימות'}</span>
          {data && <span className="task-result-count">{rows.length}</span>}
          {loading && data && <span className="tiny muted">מעדכן…</span>}
          {filtered && !filtersOpen && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>איפוס סינון</button>}
        </div>
        <div className="task-result-actions">
          {!viewing && <BulkToggle />}
          <button
            className="btn task-export"
            onClick={() => data && exportCsv(data, userName).catch((e: Error) => toast({ title: e.message, tone: 'red' }))}
            disabled={!data?.length}
            title="ייצוא הרשימה המסוננת לאקסל"
          >
            <Icon name="download" size={16} /><span>ייצוא</span>
          </button>

        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={6} />
      ) : !data && error ? null : !data?.length ? (
        <div className="task-empty-state">
          <Empty
            icon={filtered ? 'search' : f.scope === 'done' ? 'check' : 'tasks'}
            title={filtered ? 'לא מצאנו משימות שמתאימות' : f.scope === 'done' ? 'ההתקדמות שלכם תופיע כאן' : 'אפשר להתחיל ממשימה אחת'}
            text={
              <>
                {filtered ? 'אפשר לנסות חיפוש אחר או להסיר את הסינון.' : f.scope === 'done' ? 'כל משימה שתושלם תישמר כאן, כדי שתוכלו לראות מה כבר עשיתם.' : 'אין משימות בתצוגה הזו. אפשר להוסיף משימה או לבחור סינון אחר.'}
                <span className="empty-actions">
                  {filtered ? (
                    <button className="btn btn-primary" onClick={clearFilters}>איפוס הסינון <Icon name="chevronLeft" size={16} /></button>
                  ) : (
                    !viewing && <button className="btn btn-primary" onClick={createTask}><Icon name="plus" /> יצירת משימה</button>
                  )}
                  {f.scope !== 'all' && <button className="btn btn-ghost" onClick={() => setParams({ scope: 'all' }, { replace: true })}>לכל המשימות</button>}
                </span>
              </>
            }
          />
        </div>
      ) : view === 'list' ? (
        <TaskList tasks={data} collapse={collapse} />
      ) : view === 'table' ? (
        <CourseBoard rows={rows} groupBy={groupBy} sortBy={sortBy} />
      ) : (
        <Board rows={rows} />
      )}
    </div>
    </TaskBulkScope>
  );
}

const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'pending_approval', 'done'];

function Board({ rows }: { rows: TaskView[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isCommander } = useSession();
  const [over, setOver] = useState<TaskStatus | null>(null);

  const drop = async (taskId: number, to: TaskStatus) => {
    setOver(null);
    const row = rows.find((x) => x.task.id === taskId);
    if (!row || row.task.status === to) return;
    // a whole group's card moves as its people do their copies
    if (row.folded) return toast({ title: 'משימה של קבוצה מתקדמת כשכל אחד מעדכן את שלו', body: 'פתח אותה כדי לראות מי השלים', tone: 'blue' });
    const t = row.task;
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
      const d = await api.post<{ task: Task }>(`/api/tasks/${t.id}/transition`, { action });
      // closed: it goes from its column done, folding
      if (d.task?.status === 'done') noteFinished('tasks', [t.id]);
      emitLocalChange('tasks');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  return (
    <div className="board">
      {BOARD_COLUMNS.map((col) => {
        const list = rows.filter((r) => r.task.status === col);
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
            <BoardCards rows={list} />
          </div>
        );
      })}
    </div>
  );
}

function BoardCards({ rows }: { rows: TaskView[] }) {
  // ticked done here and gone from the column: it stays a moment, done, and folds away
  const leaving = useLeaving(rows, (r) => r.task.id, (id, last) => finishedJustNow('tasks', id) && { ...last, task: doneNow(last.task) });
  const { shown, more } = useIncremental(leaving.rows, 60);
  return (
    <>
      {shown.map((r) => (
        <div key={r.task.id} className={leaveClass(leaving.phaseOf(r.task.id))}>
          <BoardCard t={r.task} folded={r.folded} />
        </div>
      ))}
      {more}
    </>
  );
}

function BoardCard({ t, folded }: { t: Task; folded: boolean }) {
  const navigate = useNavigate();
  const bulk = useBulk();
  const tick = useTaskTick(t, folded);
  const tag = useGroupTag(t, !folded);
  const flash = useLiveFlash(`${t.status}|${t.deadline}|${t.ownerId}|${t.title}|${t.priority}|${t.overdue}`);
  const menu = useTaskMenu(t, tick, bulk?.active || folded);
  return (
    <div
      className={`board-card t-${tick.done ? 'green' : t.tone}${bulk?.selected.has(t.id) ? ' selected' : ''}${tick.done ? ' is-done' : ''}${flash ? ' flash' : ''}${menu.lifted ? ' is-lifted' : ''}`}
      draggable={!bulk?.active && !folded}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(t.id))}
      {...openable(bulkClick(bulk, t.id, unlessHeld(menu, () => navigate(`/tasks/${t.id}`))))}
      {...menu.bind}
      onPointerEnter={() => prefetchTask(t.id)}
      onFocus={() => prefetchTask(t.id)}
    >
      <div className="task-title row gap-6">
        {bulk?.active ? <BulkCheck id={t.id} /> : <TaskCheck task={t} tick={tick} small />}
        <span style={{ textDecoration: tick.done ? 'line-through' : undefined }}>{t.title}</span>
      </div>
      <div className="task-meta dotted">
        {!folded && <span>{t.ownerName}</span>}
        {tag && <GroupTag label={tag} className={folded ? '' : 'sep'} />}
        <span className="sep">
          <DeadlineText task={t} />
        </span>
      </div>
      <div className="row gap-4 mt-8 wrap">
        <ProgressBadge task={t} />
        <PriorityBadge priority={t.priority} />
        {t.overdue && <span className="badge t-red">באיחור</span>}
        {t.domain && <span className="badge">{t.domain}</span>}
      </div>
      {menu.menu}
    </div>
  );
}

// each person's copy on its own line - the group in its own column - so it can be followed in the sheet
function exportCsv(tasks: Task[], userName: (id: number) => string) {
  return saveCsv(
    'משימות',
    ['משימה', 'אחראי', 'קבוצה', 'משתתפים', 'יצר', 'תחום', 'שבוע', 'דד-ליין', 'עדיפות', 'סטטוס', 'באיחור', 'הושלמה'],
    tasks.map((t) => [
      t.title,
      t.ownerName,
      groupLabel(t, userName),
      t.participantIds.map(userName).join(', '),
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

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { domainLabel, PRIORITY_LABELS, STATUSES, STATUS_LABELS, type TaskStatus } from '@shared/constants';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { groupLabel, isGrouped, peopleOf, type TaskView } from '../lib/taskGroups';
import { BoardCellEditor, type BoardField } from './BoardCellEditor';
import { useBulk } from './Bulk';
import { Icon } from './Icon';
import { useNewTask } from './NewTask';
import { initials } from './ui';
import './CourseBoard.css';

export type BoardGrouping = 'status' | 'week' | 'owner';
export type BoardSort = 'deadline' | 'priority' | 'title';
const COLORS: Record<TaskStatus, string> = {
  todo: '#579bfc', in_progress: '#fdab3d', waiting: '#e2445c',
  pending_approval: '#a25ddc', done: '#00c875', cancelled: '#9b9da8',
};
const GROUP_NAMES: Record<TaskStatus, string> = {
  todo: 'משימות לביצוע', in_progress: 'בתהליך עבודה', waiting: 'ממתינות להתקדמות',
  pending_approval: 'ממתינות לאישור', done: 'הושלמו', cancelled: 'בוטלו',
};
const AVATAR_COLORS = ['#0073ea', '#a25ddc', '#00854d', '#d83a52', '#5956a8', '#b76400'];
interface WorkGroup { id: string; title: string; color: string; rows: TaskView[]; weekId?: number | null; ownerId?: number; closed?: boolean; canAdd?: boolean }

export function CourseBoard({ rows, groupBy, sortBy }: { rows: TaskView[]; groupBy: BoardGrouping; sortBy: BoardSort }) {
  const { weeks, userName } = useSession();
  const [editing, setEditing] = useState<{ taskId: number; field: BoardField; anchor: HTMLElement } | null>(null);
  const groups = useMemo(() => {
    const rank = { low: 0, normal: 1, high: 2, critical: 3 };
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'title') return a.task.title.localeCompare(b.task.title, 'he');
      if (sortBy === 'priority') return rank[b.task.priority] - rank[a.task.priority] || a.task.deadline.localeCompare(b.task.deadline);
      return a.task.deadline.localeCompare(b.task.deadline);
    });
    const result = new Map<string, WorkGroup>();
    if (groupBy === 'status') {
      STATUSES.forEach((s) => result.set(s, { id: s, title: GROUP_NAMES[s], color: COLORS[s], rows: [], closed: s === 'done' || s === 'cancelled', canAdd: s === 'todo' }));
    } else if (groupBy === 'week') {
      weeks.forEach((w, i) => result.set(String(w.id), { id: String(w.id), title: w.name, color: AVATAR_COLORS[i % AVATAR_COLORS.length], weekId: w.id, rows: [], canAdd: true }));
    }
    for (const row of sorted) {
      const t = row.task;
      const id = groupBy === 'status' ? t.status : groupBy === 'week' ? String(t.weekId ?? 'none') : String(t.ownerId);
      if (!result.has(id)) result.set(id, {
        id, title: groupBy === 'week' ? (t.weekName ?? 'ללא שבוע') : userName(t.ownerId),
        color: AVATAR_COLORS[result.size % AVATAR_COLORS.length], rows: [], canAdd: true,
        ...(groupBy === 'week' ? { weekId: t.weekId } : { ownerId: t.ownerId }),
      });
      result.get(id)!.rows.push(row);
    }
    return [...result.values()].filter((g) => g.rows.length > 0);
  }, [rows, groupBy, sortBy, weeks, userName]);

  return (
    <div className="course-board">
      <p className="course-board-hint"><Icon name="edit" size={13} /> לחצו על תא לעדכון · על שם משימה לפתיחת הפרטים <span>החליקו לצדדים לעמודות נוספות</span></p>
      {groups.map((group) => <BoardGroup key={`${groupBy}:${group.id}`} group={group} edit={(taskId, field, anchor) => setEditing({ taskId, field, anchor })} />)}
      {editing && <BoardCellEditor key={`${editing.taskId}:${editing.field}`} {...editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BoardGroup({ group, edit }: { group: WorkGroup; edit: (id: number, field: BoardField, anchor: HTMLElement) => void }) {
  const { viewing } = useSession();
  const [collapsed, setCollapsed] = useState(Boolean(group.closed));
  const [limit, setLimit] = useState(7);
  const [draft, setDraft] = useState('');
  const newTask = useNewTask();
  const done = group.rows.filter((r) => r.task.status === 'done').length;
  const visible = group.rows.slice(0, limit);
  return (
    <section className={`work-group${collapsed ? ' is-collapsed' : ''}`} style={{ '--group-color': group.color } as CSSProperties} aria-label={group.title}>
      <button className="work-group-heading" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <Icon name="chevronDown" size={19} />
        <h2>{group.title}</h2><span>{group.rows.length} משימות</span>
        {collapsed && <span className="work-group-collapsed-progress">{done} הושלמו</span>}
      </button>
      {!collapsed && <>
        <div className="work-table-scroll" tabIndex={0} role="region" aria-label={`טבלת ${group.title}`}>
          <table className="work-table">
            <colgroup><col className="work-col-check" /><col className="work-col-name" /><col className="work-col-owner" /><col className="work-col-status" /><col className="work-col-date" /><col className="work-col-priority" /><col className="work-col-domain" /><col className="work-col-week" /></colgroup>
            <thead><tr><th aria-label="בחירה" /><th scope="col">משימה</th><th scope="col">אחראים</th><th scope="col">סטטוס</th><th scope="col">תאריך יעד</th><th scope="col">עדיפות</th><th scope="col">תחום</th><th scope="col">שבוע</th></tr></thead>
            <tbody>{visible.map((row) => <WorkRow key={row.task.id} row={row} edit={edit} />)}</tbody>
          </table>
        </div>
        {group.rows.length > limit && <button className="work-show-more" onClick={() => setLimit(limit + 25)}><Icon name="chevronDown" size={14} /> הצגת {Math.min(25, group.rows.length - limit)} משימות נוספות</button>}
        {group.canAdd && !viewing && <form className="work-add-row" onSubmit={(e) => { e.preventDefault(); newTask({ title: draft.trim() || undefined, weekId: group.weekId, ownerIds: group.ownerId ? [group.ownerId] : undefined }, () => setDraft('')); }}>
          <Icon name="plus" size={16} /><input aria-label={`הוספת משימה לקבוצה ${group.title}`} placeholder="הוספת משימה…" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} />
          <button type="submit" aria-label={`יצירת משימה בקבוצה ${group.title}`}>{draft ? 'המשך' : 'הוספה'} <Icon name="plus" size={13} /></button>
        </form>}
        <div className="work-group-summary"><span>{done} מתוך {group.rows.length} הושלמו</span><div className="work-status-summary" role="img" aria-label={STATUSES.map((s) => `${STATUS_LABELS[s]}: ${group.rows.filter((r) => r.task.status === s).length}`).join(', ')}>{STATUSES.map((s) => {
          const count = group.rows.filter((r) => r.task.status === s).length;
          return count > 0 && <i key={s} title={`${STATUS_LABELS[s]}: ${count}`} style={{ flex: count, background: COLORS[s] }} />;
        })}</div></div>
      </>}
    </section>
  );
}

function WorkRow({ row: { task: t, folded }, edit }: { row: TaskView; edit: (id: number, field: BoardField, anchor: HTMLElement) => void }) {
  const bulk = useBulk();
  const { userName, viewing } = useSession();
  const grouped = isGrouped(t);
  const owners = grouped && !folded ? [t.ownerId] : peopleOf(t);
  const open = (field: BoardField, anchor: HTMLElement) => edit(t.id, field, anchor);
  const ownerLabel = folded ? groupLabel(t, userName) : t.ownerName;
  // Shared metadata needs an explicit one-copy/all-copies choice in the detail editor.
  const cell = (field: BoardField, className: string, children: ReactNode, label: string) => folded || (grouped && (field === 'priority' || field === 'deadline'))
    ? <Link to={`/tasks/${t.id}`} className={className} title="משימה קבוצתית — פתחו לעדכון העותק המתאים" aria-label={`${label}: ${t.title}, משימה קבוצתית`}>{children}</Link>
    : <button className={className} onClick={(e) => open(field, e.currentTarget)} aria-label={`${label}: ${t.title}`}>{children}</button>;
  return <tr data-task-id={t.id} className={bulk?.selected.has(t.id) ? 'is-selected' : ''}>
    <td className="work-check"><input type="checkbox" disabled={!!viewing} checked={bulk?.selected.has(t.id) ?? false} aria-label={`בחירת ${t.title}`} onChange={() => { if (!bulk || viewing) return; if (!bulk.active) bulk.setActive(true); bulk.toggle(t.id); }} /></td>
    <td className="work-name"><div><Link to={`/tasks/${t.id}`} title={t.title}>{t.title}</Link>{!folded && !grouped && !viewing && <button className="work-title-edit" aria-label={`עריכת שם: ${t.title}`} onClick={(e) => open('title', e.currentTarget)}><Icon name="edit" size={14} /></button>}{grouped && !folded && <span className="work-subtasks" title="הסטטוס והאחראי בשורה הזו מתייחסים לעותק הזה">עותק</span>}{t.subtaskTotal > 0 && <span className="work-subtasks" title="משימות משנה">{t.subtaskDone}/{t.subtaskTotal}</span>}</div></td>
    <td>{cell('owner', 'work-cell work-owners', <><span className="work-avatars" aria-hidden="true">{owners.slice(0, 2).map((id) => <i key={id} style={{ background: AVATAR_COLORS[id % AVATAR_COLORS.length] }}>{initials(userName(id))}</i>)}{owners.length > 2 && <i className="work-avatar-more">+{owners.length - 2}</i>}</span><span className="work-owner-name">{ownerLabel}</span></>, 'שינוי אחראי')}</td>
    <td>{cell('status', `work-cell work-status work-status-${t.status}`, <>{STATUS_LABELS[t.status]}{folded && <span className="work-group-count">{t.groupCopies.filter((c) => c.done).length}/{t.groupCopies.length}</span>}</>, 'שינוי סטטוס')}</td>
    <td>{cell('deadline', `work-cell work-deadline${t.overdue ? ' is-overdue' : ''}`, <><Icon name={t.overdue ? 'alert' : 'calendar'} size={14} /><span title={fmtDateTime(t.deadline)}>{fmtDate(t.deadline)}</span></>, 'שינוי תאריך יעד')}</td>
    <td>{cell('priority', `work-cell work-priority work-priority-${t.priority}`, PRIORITY_LABELS[t.priority], 'שינוי עדיפות')}</td>
    <td><span className="work-domain" title={domainLabel(t.domain, t.domainNote)}>{t.domain ? domainLabel(t.domain, t.domainNote) : '—'}</span></td>
    <td>{t.weekId ? <Link className="work-cell work-week" to={`/weeks/${t.weekId}`} title={t.weekName ?? ''}>{t.weekName}</Link> : <span className="work-cell muted">—</span>}</td>
  </tr>;
}

// Read-side views: dashboard (4, 5, 32), my tasks (10, 48), team (11, 12),
// briefing (50), weekly snapshot (24), look-ahead (25), end of day (52), search (19).

import { isOpenStatus, OVERDUE_RESPONSE_LABELS, PRIORITY_RANK } from '../../shared/constants';
import { addDays, DAY, dayRange, daysSince, diffDays, localDateKey, startOfWeek, zonedToUtc } from '../../shared/dates';
import { readinessPct } from '../../shared/taskLogic';
import type {
  AttentionItem,
  BriefingData,
  DashboardData,
  DayEndData,
  LookAheadData,
  MyTasksData,
  SearchResults,
  StaffPageData,
  StaffStatus,
  Task,
  WeeklyReport,
} from '../../shared/types';
import { getUserRow, toUser, type UserRow } from './auth';
import { clock, forbidden, getSettings, notFound, tz } from './core';
import { db } from './db';
import { listEvents } from './schedule';
import { getTaskRow, isCommander, visibleTasks, canApprove } from './taskRepo';
import { pendingRequestsFor } from './taskService';
import { listWeeks, weekContaining } from './weeks';

const ms = (iso: string) => Date.parse(iso);
const byDeadline = (a: Task, b: Task) => ms(a.deadline) - ms(b.deadline);
const byPriorityThenDeadline = (a: Task, b: Task) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || byDeadline(a, b);
const involves = (t: Task, uid: number) => t.ownerId === uid || t.participantIds.includes(uid);

function ctx() {
  const now = clock.now();
  const zone = tz();
  const today = localDateKey(now, zone);
  const [dayStart, dayEnd] = dayRange(today, zone).map((d) => d.getTime());
  const weekStart = zonedToUtc(startOfWeek(today), '00:00', zone).getTime();
  return { now, nowMs: now.getTime(), zone, today, dayStart, dayEnd, weekStart };
}

function staffRows(): UserRow[] {
  return db().all<UserRow>("SELECT * FROM users WHERE role = 'staff' AND active = 1 ORDER BY display_name");
}

function staffStatus(u: UserRow, tasks: Task[], c: ReturnType<typeof ctx>): StaffStatus {
  const own = tasks.filter((t) => t.ownerId === u.id);
  const open = own.filter((t) => isOpenStatus(t.status));
  return {
    userId: u.id,
    name: u.display_name,
    title: u.title,
    open: open.length,
    inProgress: open.filter((t) => t.status === 'in_progress').length,
    waiting: open.filter((t) => t.status === 'waiting').length,
    overdue: open.filter((t) => t.overdue).length,
    done: own.filter((t) => t.status === 'done').length,
    doneThisWeek: own.filter((t) => t.status === 'done' && t.completedAt && ms(t.completedAt) >= c.weekStart).length,
    dueToday: open.filter((t) => ms(t.deadline) >= c.dayStart && ms(t.deadline) < c.dayEnd).length,
  };
}

export function dashboard(actor: UserRow): DashboardData {
  const c = ctx();
  const s = getSettings();
  const all = visibleTasks(actor);
  const open = all.filter((t) => isOpenStatus(t.status));
  const in7 = c.nowMs + 7 * DAY;

  const stats = {
    today: open.filter((t) => ms(t.deadline) >= c.dayStart && ms(t.deadline) < c.dayEnd).length,
    overdue: open.filter((t) => t.overdue).length,
    week: open.filter((t) => ms(t.deadline) >= c.nowMs && ms(t.deadline) < in7).length,
    doneThisWeek: all.filter((t) => t.status === 'done' && t.completedAt && ms(t.completedAt) >= c.weekStart).length,
    dueSoon: open.filter((t) => t.dueSoon).length,
    blocked: open.filter((t) => t.status === 'waiting').length,
  };

  // Section 77 - management by exception. Routine recurring tasks surface only when important.
  const notable = (t: Task) => !t.recurringRuleId || PRIORITY_RANK[t.priority] >= PRIORITY_RANK.high;
  const attention: AttentionItem[] = [];
  const listed = new Set<number>();
  // copies of one all-staff task (section 64) collapse into a single line per kind
  const groupItems = new Map<string, { entry: AttentionItem; names: string[] }>();
  const push = (t: Task, item: Omit<AttentionItem, 'taskId' | 'ownerName' | 'deadline' | 'title'> & { title?: string }) => {
    if (listed.has(t.id)) return;
    listed.add(t.id);
    if (t.groupId) {
      const key = `${t.groupId}:${item.kind}`;
      const existing = groupItems.get(key);
      if (existing) {
        const { entry, names } = existing;
        names.push(t.ownerName);
        entry.count = names.length;
        entry.ownerName = names.length > 3 ? `${names.slice(0, 3).join(', ')} ועוד ${names.length - 3}` : names.join(', ');
        return;
      }
      const entry: AttentionItem = { title: t.title, taskId: t.id, ownerName: t.ownerName, deadline: t.deadline, count: 1, ...item };
      groupItems.set(key, { entry, names: [t.ownerName] });
      attention.push(entry);
      return;
    }
    attention.push({ title: t.title, taskId: t.id, ownerName: t.ownerName, deadline: t.deadline, ...item });
  };

  for (const t of open.filter((t) => t.needsCommander).sort(byDeadline)) {
    const decision = t.status !== 'waiting';
    push(t, {
      kind: decision ? 'decision' : 'blocked',
      tone: 'red',
      subtitle: decision
        ? t.overdueResponse === 'decision'
          ? 'באיחור - נדרשת החלטת מפקד'
          : 'נדרשת החלטת מפקד'
        : `חסם: ${t.blockReason ?? ''}${t.blockWaitingFor ? ` · ממתין ל${t.blockWaitingFor}` : ''}`,
    });
  }
  for (const t of open.filter((t) => t.overdue && notable(t)).sort(byDeadline)) {
    push(t, {
      kind: 'overdue',
      tone: 'red',
      subtitle: t.overdueResponse ? `האחראי דיווח: ${OVERDUE_RESPONSE_LABELS[t.overdueResponse]}` : 'עבר הדד-ליין',
    });
  }
  for (const t of open.filter((t) => t.status === 'pending_approval').sort(byDeadline)) {
    const row = getTaskRow(t.id);
    if (row && canApprove(actor, row)) push(t, { kind: 'approval', tone: 'blue', subtitle: `${t.ownerName} ביקש לסגור את המשימה` });
  }
  const requests = pendingRequestsFor(actor).filter((r) => r.requestedBy !== actor.id);
  for (const r of requests) {
    attention.push({
      kind: 'request',
      tone: 'blue',
      title: r.taskTitle,
      subtitle: r.type === 'deadline' ? `בקשת הארכה של ${r.requestedByName}: ${r.reason}` : `בקשת העברה ל${r.newOwnerName}: ${r.reason}`,
      taskId: r.taskId,
      requestId: r.id,
      ownerName: r.requestedByName,
      deadline: r.type === 'deadline' ? (r.newDeadline ?? undefined) : r.currentDeadline,
    });
  }
  for (const t of open.filter((t) => t.status === 'waiting' && notable(t)).sort(byDeadline)) {
    push(t, { kind: 'blocked', tone: 'purple', subtitle: `חסם: ${t.blockReason ?? ''}${t.blockWaitingFor ? ` · ממתין ל${t.blockWaitingFor}` : ''}` });
  }
  for (const t of open.filter((t) => t.dueSoon && notable(t)).sort(byPriorityThenDeadline)) {
    push(t, { kind: 'due_soon', tone: 'orange', subtitle: 'דד-ליין ב-24 השעות הקרובות' });
  }
  for (const t of open.filter((t) => t.stale && !t.recurringRuleId).sort((a, b) => ms(a.lastActivityAt) - ms(b.lastActivityAt))) {
    push(t, { kind: 'stale', tone: 'yellow', subtitle: `לא עודכן במשך ${daysSince(t.lastActivityAt, c.now)} ימים` });
  }

  const weeks = listWeeks();
  for (const w of weeks) {
    const until = diffDays(w.startDate, c.today);
    if (w.status === 'closed' || until < 0 || until > 14) continue;
    if (w.totalTasks > 0 && w.readiness >= s.readinessWarnThreshold) continue;
    attention.push({
      kind: 'readiness',
      tone: until <= 7 ? 'red' : 'orange',
      title: `${w.name} - מוכנות ${w.readiness}%`,
      subtitle: `${w.totalTasks ? `${w.doneTasks} מתוך ${w.totalTasks} משימות הושלמו` : 'עדיין לא נפתחו משימות'} · מתחיל ${until === 0 ? 'היום' : until === 1 ? 'מחר' : `בעוד ${until} ימים`}`,
      weekId: w.id,
      ownerName: w.leadName ?? undefined,
    });
  }

  const staff = staffRows().map((u) => staffStatus(u, all, c));
  for (const st of staff) {
    const load = open.filter((t) => t.ownerId === st.userId && !t.recurringRuleId && ms(t.deadline) < in7).length;
    if (load > s.overloadThreshold) {
      attention.push({ kind: 'overload', tone: 'yellow', title: `עומס על ${st.name}`, subtitle: `${load} משימות פתוחות בשבוע הקרוב`, userId: st.userId });
    }
  }

  return {
    stats,
    attention,
    staff,
    currentWeek: weeks.find((w) => w.startDate <= c.today && w.endDate >= c.today) ?? null,
    nextWeek: weeks.find((w) => w.startDate > c.today) ?? null,
    todayEvents: listEvents(c.today, c.today, false),
    pendingApprovals: attention.filter((a) => a.kind === 'approval').length,
    pendingRequests: requests.length,
  };
}

export function myTasks(actor: UserRow): MyTasksData & { teamTasks: Task[] } {
  const c = ctx();
  const visible = visibleTasks(actor);
  const mine = visible.filter((t) => involves(t, actor.id));
  const open = mine.filter((t) => isOpenStatus(t.status));
  const in7 = dayRange(addDays(c.today, 7), c.zone)[1].getTime();
  const used = new Set<number>();
  const take = (pred: (t: Task) => boolean, sort = byDeadline) => {
    const out = open.filter((t) => !used.has(t.id) && pred(t)).sort(sort);
    out.forEach((t) => used.add(t.id));
    return out;
  };
  const waiting = take((t) => t.status === 'pending_approval');
  const overdue = take((t) => t.overdue);
  const today = take((t) => ms(t.deadline) < c.dayEnd, byPriorityThenDeadline);
  const important = take((t) => PRIORITY_RANK[t.priority] >= PRIORITY_RANK.high);
  const week = take((t) => ms(t.deadline) < in7);
  const later = take(() => true);
  const recentDone = mine
    .filter((t) => t.status === 'done' && t.completedAt && c.nowMs - ms(t.completedAt) < 3 * DAY)
    .sort((a, b) => ms(b.completedAt!) - ms(a.completedAt!));
  return {
    overdue,
    today,
    important,
    week,
    later,
    waiting,
    recentDone,
    myWeeks: listWeeks('w.lead_id = ? AND w.end_date >= ?', actor.id, c.today),
    teamTasks: teamTasks(visible, mine, actor.id),
    stats: {
      today: today.length,
      overdue: overdue.length,
      week: today.length + important.filter((t) => ms(t.deadline) < in7).length + week.length,
      doneToday: mine.filter((t) => t.status === 'done' && t.completedAt && ms(t.completedAt) >= c.dayStart).length,
    },
  };
}

/** Company-wide tasks, without the other copies of an all-staff task I already have (section 64). */
function teamTasks(visible: Task[], mine: Task[], uid: number): Task[] {
  const myGroups = new Set(mine.map((t) => t.groupId).filter(Boolean));
  const seenGroups = new Set<string>();
  return visible
    .filter((t) => t.visibility === 'team' && !involves(t, uid) && isOpenStatus(t.status))
    .filter((t) => {
      if (!t.groupId) return true;
      if (myGroups.has(t.groupId) || seenGroups.has(t.groupId)) return false;
      seenGroups.add(t.groupId);
      return true;
    })
    .sort(byDeadline);
}

export function team(actor: UserRow): StaffStatus[] {
  const c = ctx();
  const all = visibleTasks(actor);
  return staffRows().map((u) => staffStatus(u, all, c));
}

export function staffPage(actor: UserRow, userId: number): StaffPageData {
  if (!isCommander(actor) && actor.id !== userId) throw forbidden('ניתן לצפות רק בעמוד שלך');
  const u = getUserRow(userId);
  if (!u) throw notFound('איש הסגל לא נמצא');
  const c = ctx();
  const tasks = visibleTasks(actor).filter((t) => involves(t, userId));
  const own = tasks.filter((t) => t.ownerId === userId);
  const base = staffStatus(u, tasks, c);
  const done = own.filter((t) => t.status === 'done');
  const lateDone = db().get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE owner_id = ? AND status = 'done' AND completed_late = 1", userId)!.n;
  const openLate = own.filter((t) => t.overdue).length;
  const denom = done.length + openLate;
  const onTime = done.length - lateDone;
  const open = tasks.filter((t) => isOpenStatus(t.status)).sort(byDeadline);
  return {
    user: toUser(u),
    stats: {
      ...base,
      total: own.filter((t) => t.status !== 'cancelled').length,
      onTimePct: denom ? Math.round((onTime / denom) * 100) : 0,
      latePct: denom ? Math.round((lateDone / denom) * 100) : 0,
      openLatePct: denom ? Math.round((openLate / denom) * 100) : 0,
    },
    open,
    overdue: open.filter((t) => t.overdue),
    done: done.sort((a, b) => ms(b.completedAt ?? b.updatedAt) - ms(a.completedAt ?? a.updatedAt)).slice(0, 50),
    selfCreated: own.filter((t) => t.createdBy === userId && isOpenStatus(t.status)),
    fromCommander: own.filter((t) => t.creatorRole === 'commander' && isOpenStatus(t.status)),
    upcoming: open.filter((t) => !t.overdue).slice(0, 8),
    weeks: listWeeks('w.lead_id = ?', userId),
  };
}

export function briefing(actor: UserRow): BriefingData {
  const c = ctx();
  const open = visibleTasks(actor).filter((t) => isOpenStatus(t.status));
  const tomorrowEnd = dayRange(addDays(c.today, 1), c.zone)[1].getTime();
  const critical = open
    .filter((t) => (t.priority === 'critical' || t.priority === 'high') && ms(t.deadline) < tomorrowEnd)
    .sort(byPriorityThenDeadline);
  const dueToday = open.filter((t) => !t.overdue && ms(t.deadline) < c.dayEnd).sort(byDeadline);
  const overdue = open.filter((t) => t.overdue).sort(byDeadline);
  const blocked = open.filter((t) => t.status === 'waiting' || t.needsCommander).sort(byDeadline);
  const byOwner = staffRows()
    .map((u) => ({
      userId: u.id,
      name: u.display_name,
      dueToday: dueToday.filter((t) => t.ownerId === u.id).length,
      overdue: overdue.filter((t) => t.ownerId === u.id).length,
      blocked: blocked.filter((t) => t.ownerId === u.id).length,
    }))
    .filter((r) => r.dueToday + r.overdue + r.blocked > 0);
  return { date: c.today, events: listEvents(c.today, c.today, false), critical, dueToday, overdue, blocked, byOwner };
}

export function weeklyReport(actor: UserRow, weekStartKey?: string): WeeklyReport {
  const c = ctx();
  const from = weekStartKey ? startOfWeek(weekStartKey) : addDays(startOfWeek(c.today), -7);
  const to = addDays(from, 6);
  const start = zonedToUtc(from, '00:00', c.zone).getTime();
  const end = zonedToUtc(addDays(to, 1), '00:00', c.zone).getTime();
  const tasks = visibleTasks(actor).filter((t) => !t.recurringRuleId);
  const inRange = (iso: string | null) => !!iso && ms(iso) >= start && ms(iso) < end;
  const due = tasks.filter((t) => inRange(t.deadline) && t.status !== 'cancelled');
  const ids = new Set(tasks.map((t) => t.id));
  const carried = db()
    .all<{ task_id: number }>(
      "SELECT DISTINCT task_id FROM activity WHERE action = 'carried' AND created_at >= ? AND created_at < ? AND task_id IS NOT NULL",
      new Date(start).toISOString(),
      new Date(end).toISOString(),
    )
    .filter((r) => ids.has(r.task_id)).length;
  const domains = new Map<string, { total: number; done: number }>();
  for (const t of due) {
    const d = t.domain || 'ללא תחום';
    const e = domains.get(d) ?? { total: 0, done: 0 };
    e.total++;
    if (t.status === 'done') e.done++;
    domains.set(d, e);
  }
  const completed = tasks.filter((t) => t.status === 'done' && inRange(t.completedAt));
  const staff = staffRows().map((u) => {
    const mine = completed.filter((t) => t.ownerId === u.id);
    return { userId: u.id, name: u.display_name, done: mine.length, late: mine.filter((t) => ms(t.completedAt!) > ms(t.deadline)).length };
  });
  return {
    from,
    to,
    opened: tasks.filter((t) => inRange(t.createdAt)).length,
    completed: completed.length,
    carried,
    overdue: due.filter((t) => isOpenStatus(t.status) && t.overdue).length,
    byDomain: [...domains.entries()]
      .map(([domain, v]) => ({ domain, ...v, readiness: readinessPct(v.done, v.total) }))
      .sort((a, b) => b.total - a.total),
    openPoints: due.filter((t) => isOpenStatus(t.status)).sort(byPriorityThenDeadline),
    completedByStaff: staff,
  };
}

export function lookAhead(actor: UserRow): LookAheadData {
  const c = ctx();
  const open = visibleTasks(actor).filter((t) => isOpenStatus(t.status) && !t.recurringRuleId);
  const days: LookAheadData['days'] = [];
  for (let i = 0; i < 14; i++) {
    const key = addDays(c.today, i);
    const [s, e] = dayRange(key, c.zone).map((d) => d.getTime());
    const list = open.filter((t) => ms(t.deadline) >= s && ms(t.deadline) < e);
    const byOwner: Record<number, number> = {};
    for (const t of list) byOwner[t.ownerId] = (byOwner[t.ownerId] ?? 0) + 1;
    days.push({ date: key, total: list.length, critical: list.filter((t) => PRIORITY_RANK[t.priority] >= PRIORITY_RANK.high).length, byOwner });
  }
  const nextSunday = addDays(startOfWeek(c.today), 7);
  const weeks = [0, 1].map((i) => {
    const from = addDays(nextSunday, i * 7);
    const to = addDays(from, 6);
    const s = zonedToUtc(from, '00:00', c.zone).getTime();
    const e = zonedToUtc(addDays(to, 1), '00:00', c.zone).getTime();
    return {
      label: i === 0 ? 'שבוע הבא' : 'בעוד שבועיים',
      from,
      to,
      total: open.filter((t) => ms(t.deadline) >= s && ms(t.deadline) < e).length,
      week: weekContaining(from),
    };
  });
  const horizon = dayRange(addDays(c.today, 13), c.zone)[1].getTime();
  const staffLoad = staffRows()
    .map((u) => ({ userId: u.id, name: u.display_name, total: open.filter((t) => t.ownerId === u.id && ms(t.deadline) < horizon).length }))
    .sort((a, b) => b.total - a.total);
  return { days, weeks, staffLoad };
}

export function dayEnd(actor: UserRow): DayEndData {
  const c = ctx();
  const mine = visibleTasks(actor).filter((t) => involves(t, actor.id));
  const [tStart, tEnd] = dayRange(addDays(c.today, 1), c.zone).map((d) => d.getTime());
  const dueTodayAll = mine.filter((t) => t.status !== 'cancelled' && ms(t.deadline) >= c.dayStart && ms(t.deadline) < c.dayEnd);
  const completedToday = mine.filter((t) => t.status === 'done' && t.completedAt && ms(t.completedAt) >= c.dayStart);
  return {
    date: c.today,
    dueToday: dueTodayAll.length,
    doneToday: dueTodayAll.filter((t) => t.status === 'done').length,
    completedToday,
    stillOpen: mine.filter((t) => isOpenStatus(t.status) && ms(t.deadline) < c.dayEnd).sort(byDeadline),
    tomorrow: mine.filter((t) => isOpenStatus(t.status) && ms(t.deadline) >= tStart && ms(t.deadline) < tEnd).sort(byDeadline),
  };
}

export function search(actor: UserRow, q: string): SearchResults {
  const needle = q.trim().replace(/[״]/g, '"').toLowerCase();
  if (needle.length < 2) return { tasks: [], users: [], weeks: [], events: [] };
  const has = (...fields: (string | null | undefined)[]) => fields.some((f) => f && f.replace(/[״]/g, '"').toLowerCase().includes(needle));
  const tasks = visibleTasks(actor)
    .filter((t) => has(t.title, t.description, t.domain, t.weekName, t.ownerName, t.eventTitle))
    .sort((a, b) => Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status)) || byDeadline(a, b))
    .slice(0, 60);
  const users = db()
    .all<UserRow>('SELECT * FROM users WHERE active = 1')
    .filter((u) => has(u.display_name, u.title, u.username))
    .map(toUser);
  const weeks = listWeeks().filter((w) => has(w.name, w.topic, w.goals, w.leadName));
  const c = ctx();
  const events = listEvents(addDays(c.today, -120), addDays(c.today, 365)).filter((e) => has(e.title, e.location, e.notes, e.ownerName)).slice(0, 40);
  return { tasks, users, weeks, events };
}

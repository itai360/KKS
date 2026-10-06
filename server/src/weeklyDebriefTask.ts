// The weekly debrief as a task: on the Tuesday of each course week its lead gets a task to hold the
// week's debrief, due the next Tuesday at 12:00. It closes itself when the week's weekly debrief is
// summed up, and follows the week to a new lead. Run by the automation (automation.ts).

import { addDays, diffDays, localDateKey, localTime, weekdayOf, zonedIso } from '../../shared/dates';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { clock, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity } from './journal';
import { createTasks, updateTask } from './taskService';

/** the task opens on this day of the week (Sunday = 0), from this hour */
const OPEN_WEEKDAY = 2;
const OPEN_TIME = '08:00';
const DUE_TIME = '12:00';

/** the week's Tuesday - or, for a week without one, its first day */
export function openingDay(startDate: string, endDate: string): string {
  const days = Math.max(0, diffDays(endDate, startDate));
  for (let i = 0; i <= days; i++) {
    const d = addDays(startDate, i);
    if (weekdayOf(d) === OPEN_WEEKDAY) return d;
  }
  return startDate;
}

interface WeekRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  lead_id: number;
}

/**
 * Opens the task for each week whose Tuesday has come. Once per week: a task deleted is not opened
 * again. A week given its lead later still gets it, until the day before it would be due.
 */
export function weeklyDebriefTasks(now: Date = clock.now()): number {
  const zone = tz();
  const today = localDateKey(now, zone);
  const time = localTime(now, zone);
  const weeks = db().all<WeekRow>(
    `SELECT w.id, w.name, w.start_date, w.end_date, w.lead_id FROM weeks w
     WHERE w.lead_id IS NOT NULL AND w.start_date <= ? AND w.start_date >= ?
       AND NOT EXISTS (SELECT 1 FROM week_debrief_tasks x WHERE x.week_id = w.id)`,
    today,
    addDays(today, -21),
  );
  let opened = 0;
  for (const w of weeks) {
    const open = openingDay(w.start_date, w.end_date);
    if (today < open || (today === open && time < OPEN_TIME)) continue;
    // too late to open: from the day it would be due
    if (today > addDays(open, 6)) continue;
    const lead = getUserRow(w.lead_id);
    if (!lead?.active) continue;
    const mark = (taskId: number | null) => db().run('INSERT OR IGNORE INTO week_debrief_tasks(week_id, task_id, created_at) VALUES (?, ?, ?)', w.id, taskId, nowIso());
    // the week's debrief was already summed up: nothing left to ask for
    if (db().get("SELECT 1 FROM debriefs WHERE week_id = ? AND kind = 'weekly' AND status = 'final'", w.id)) {
      mark(null);
      continue;
    }
    const actor = getUserRow(commanderIds()[0] ?? 0) ?? lead;
    db().tx(() => {
      const [id] = createTasks(
        actor,
        {
          title: `תחקיר שבועי - ${w.name}`,
          description: `לקיים את התחקיר השבועי של ${w.name}: מה הושג מול מטרות השבוע, מה לשמר ומה לשפר, ולקחים עם אחראי ותאריך - להמשך המחזור ולשבוע הזה במחזור הבא.\nהמשימה נסגרת מעצמה כשהתחקיר מסוכם.`,
          ownerIds: [lead.id],
          deadline: zonedIso(addDays(open, 7), DUE_TIME, zone),
          priority: 'normal',
          domain: '',
          weekId: w.id,
        },
        { system: true, activityText: `המערכת פתחה את משימת התחקיר השבועי של ${w.name} לאחראי השבוע` },
      );
      mark(id ?? null);
    });
    opened++;
  }
  if (opened) changed('tasks', 'weeks');
  return opened;
}

const openTaskOf = (weekId: number) =>
  db().get<{ id: number; owner_id: number }>(
    "SELECT t.id, t.owner_id FROM week_debrief_tasks x JOIN tasks t ON t.id = x.task_id WHERE x.week_id = ? AND t.status NOT IN ('done', 'cancelled')",
    weekId,
  );

/** the week's weekly debrief was summed up: its task is done */
export function closeWeeklyDebriefTask(actor: UserRow, weekId: number): void {
  const t = openTaskOf(weekId);
  if (!t) return;
  const now = nowIso();
  const late = db().get<{ deadline: string }>('SELECT deadline FROM tasks WHERE id = ?', t.id)!.deadline < now ? 1 : 0;
  db().run(
    "UPDATE tasks SET status = 'done', completed_at = ?, completed_late = ?, needs_commander = 0, block_reason = NULL, block_waiting_for = NULL, block_next_step = NULL WHERE id = ?",
    now,
    late,
    t.id,
  );
  logActivity({ taskId: t.id, weekId, userId: actor.id, action: 'done', text: `המשימה נסגרה: ${actor.display_name} סיכם את התחקיר השבועי` });
  changed('tasks', 'weeks');
}

/** the week has a new lead: the open task goes to them */
export function followWeekLead(actor: UserRow, weekId: number, leadId: number | null): void {
  const t = openTaskOf(weekId);
  if (!t || !leadId || t.owner_id === leadId) return;
  updateTask(actor, t.id, { ownerId: leadId }, true, 'אחראי השבוע הוחלף');
}

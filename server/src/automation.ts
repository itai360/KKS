// Section 72 - automation rules that run without manual intervention:
// deadline passed -> overdue + alerts, 24h / 2h reminders, critical delay -> commander,
// recurring tasks, and automatic week templates.

import { addDays, diffDays, HOUR, localDateKey } from '../../shared/dates';
import { commanderIds, getUserRow, type UserRow } from './auth';
import { clock, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { generateRecurring } from './recurring';
import { involvedIds, queryTasks } from './taskRepo';
import { applyTemplate } from './templates';

export interface AutomationResult {
  overdue: number;
  reminders24: number;
  reminders2: number;
  recurring: number;
  templates: number;
}

export function runAutomation(): AutomationResult {
  const now = clock.now();
  const nowS = now.toISOString();
  const res: AutomationResult = { overdue: 0, reminders24: 0, reminders2: 0, recurring: 0, templates: 0 };

  // 1. Deadline passed -> overdue (derived status) + alerts, once per deadline.
  for (const t of queryTasks("t.status NOT IN ('done', 'cancelled') AND t.overdue_notified = 0 AND t.deadline < ?", nowS)) {
    db().tx(() => {
      db().run('UPDATE tasks SET overdue_notified = 1 WHERE id = ?', t.id);
      logActivity({ taskId: t.id, weekId: t.week_id, action: 'overdue', text: 'המשימה עברה את הדד-ליין וסומנה "באיחור"', touches: false });
      notify(involvedIds(t), {
        type: 'overdue',
        category: 'exception',
        title: `המשימה "${t.title}" עברה את הדד-ליין`,
        body: 'נא לעדכן: צפוי להסתיים היום / נדרש דד-ליין חדש / קיים חסם / נדרשת החלטת מפקד',
        taskId: t.id,
      });
      if (t.priority === 'critical' || t.priority === 'high') {
        notify(commanderIds(), {
          type: 'critical_overdue',
          category: 'exception',
          title: `משימה ${t.priority === 'critical' ? 'קריטית' : 'בעדיפות גבוהה'} באיחור: "${t.title}"`,
          body: `אחראי: ${t.owner_name}`,
          taskId: t.id,
        });
      }
    });
    res.overdue++;
  }

  // 2. 24 hours before the deadline.
  const in24 = new Date(now.getTime() + 24 * HOUR).toISOString();
  for (const t of queryTasks("t.status NOT IN ('done', 'cancelled') AND t.reminded_24h = 0 AND t.deadline >= ? AND t.deadline <= ?", nowS, in24)) {
    db().tx(() => {
      db().run('UPDATE tasks SET reminded_24h = 1 WHERE id = ?', t.id);
      notify(involvedIds(t), { type: 'reminder_24h', category: 'action', title: `נותרו 24 שעות לסיום המשימה "${t.title}"`, taskId: t.id });
    });
    res.reminders24++;
  }

  // 3. Two hours before - high and critical only.
  const in2 = new Date(now.getTime() + 2 * HOUR).toISOString();
  for (const t of queryTasks(
    "t.status NOT IN ('done', 'cancelled') AND t.reminded_2h = 0 AND t.priority IN ('high', 'critical') AND t.deadline >= ? AND t.deadline <= ?",
    nowS,
    in2,
  )) {
    db().tx(() => {
      db().run('UPDATE tasks SET reminded_2h = 1 WHERE id = ?', t.id);
      notify(involvedIds(t), { type: 'reminder_2h', category: 'action', title: `נותרו שעתיים לסיום המשימה "${t.title}"`, taskId: t.id });
    });
    res.reminders2++;
  }

  // 4. Recurring tasks for today.
  const today = localDateKey(now, tz());
  res.recurring = generateRecurring(today);

  // 5. "A new week opens -> its templates are created automatically".
  const templates = db().all<{ id: number; auto_apply_days_before: number; created_by: number | null }>(
    'SELECT id, auto_apply_days_before, created_by FROM templates WHERE auto_apply_days_before IS NOT NULL',
  );
  if (templates.length) {
    const weeks = db().all<{ id: number; start_date: string; end_date: string }>(
      "SELECT id, start_date, end_date FROM weeks WHERE status <> 'closed' AND end_date >= ? AND start_date <= ?",
      today,
      addDays(today, 60),
    );
    for (const tpl of templates) {
      const actor: UserRow | undefined =
        (tpl.created_by ? getUserRow(tpl.created_by) : undefined) ?? (commanderIds()[0] ? getUserRow(commanderIds()[0]) : undefined);
      if (!actor) continue;
      for (const w of weeks) {
        if (diffDays(w.start_date, today) > tpl.auto_apply_days_before) continue;
        if (db().get('SELECT 1 FROM week_templates WHERE week_id = ? AND template_id = ?', w.id, tpl.id)) continue;
        try {
          res.templates += applyTemplate(actor, tpl.id, { weekId: w.id }, { automatic: true }).length;
        } catch (e) {
          console.error('[automation] template', tpl.id, 'week', w.id, e);
          db().run('INSERT OR IGNORE INTO week_templates(week_id, template_id, applied_at) VALUES (?, ?, ?)', w.id, tpl.id, nowIso());
        }
      }
    }
  }

  if (res.overdue || res.reminders24 || res.reminders2 || res.recurring || res.templates) changed('tasks', 'weeks');
  return res;
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler(intervalMs = 60_000): void {
  const tick = () => {
    try {
      runAutomation();
    } catch (e) {
      console.error('[automation] failed', e);
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// Section 15: recurring tasks (every day / every Sunday / every evening / end of week).

import { z } from 'zod';
import { PRIORITIES, WEEKDAY_NAMES } from '../../shared/constants';
import { localDateKey, localTime, weekdayOf, zonedIso, addDays } from '../../shared/dates';
import type { RecurringRule } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, clock, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed } from './journal';
import { createTasks, weekForDate } from './taskService';

export const recurringSchema = z
  .object({
    title: z.string().trim().min(1, 'חובה למלא שם').max(200),
    description: z.string().max(2000).optional().default(''),
    frequency: z.enum(['daily', 'weekly']),
    weekdays: z.array(z.number().int().min(0).max(6)).optional().default([]),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה'),
    assignee: z.string().regex(/^(all|week_lead|\d+)$/),
    priority: z.enum(PRIORITIES).optional().default('normal'),
    domain: z.string().max(60).optional().default(''),
    active: z.boolean().optional().default(true),
  })
  .refine((r) => r.frequency === 'daily' || r.weekdays.length > 0, { message: 'יש לבחור לפחות יום אחד', path: ['weekdays'] });

interface RuleRow {
  id: number;
  title: string;
  description: string;
  frequency: 'daily' | 'weekly';
  weekdays: string;
  time: string;
  assignee: string;
  priority: RecurringRule['priority'];
  domain: string;
  active: number;
  start_date: string;
  last_generated_date: string | null;
  created_by: number;
  created_at: string;
}

function assigneeLabel(a: string): string {
  if (a === 'all') return 'כל הסגל';
  if (a === 'week_lead') return 'מפק"צ השבוע';
  return getUserRow(Number(a))?.display_name ?? 'לא ידוע';
}

function toRule(r: RuleRow): RecurringRule {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    frequency: r.frequency,
    weekdays: JSON.parse(r.weekdays),
    time: r.time,
    assignee: r.assignee,
    assigneeLabel: assigneeLabel(r.assignee),
    priority: r.priority,
    domain: r.domain,
    active: !!r.active,
    createdAt: r.created_at,
    lastGeneratedDate: r.last_generated_date,
  };
}

export function describeRule(r: Pick<RecurringRule, 'frequency' | 'weekdays' | 'time'>): string {
  if (r.frequency === 'daily') return `כל יום ב-${r.time}`;
  return `כל ${r.weekdays.map((d) => `יום ${WEEKDAY_NAMES[d]}`).join(', ')} ב-${r.time}`;
}

export function listRules(): RecurringRule[] {
  return db().all<RuleRow>('SELECT * FROM recurring_rules ORDER BY active DESC, time, title').map(toRule);
}

function validateAssignee(a: string): void {
  if (/^\d+$/.test(a)) {
    const u = getUserRow(Number(a));
    if (!u || !u.active) throw badRequest('איש הסגל שנבחר אינו פעיל');
  }
}

export function saveRule(actor: UserRow, raw: z.input<typeof recurringSchema>, id?: number): number {
  const r = recurringSchema.parse(raw);
  validateAssignee(r.assignee);
  const weekdays = JSON.stringify(r.frequency === 'weekly' ? [...new Set(r.weekdays)].sort() : []);
  if (id) {
    if (!db().get('SELECT 1 FROM recurring_rules WHERE id = ?', id)) throw notFound('המשימה החוזרת לא נמצאה');
    db().run(
      'UPDATE recurring_rules SET title = ?, description = ?, frequency = ?, weekdays = ?, time = ?, assignee = ?, priority = ?, domain = ?, active = ? WHERE id = ?',
      r.title,
      r.description,
      r.frequency,
      weekdays,
      r.time,
      r.assignee,
      r.priority,
      r.domain,
      r.active,
      id,
    );
  } else {
    // Start today if today's occurrence is still ahead, otherwise tomorrow.
    const now = clock.now();
    const today = localDateKey(now, tz());
    const start = r.time > localTime(now, tz()) ? today : addDays(today, 1);
    id = db().run(
      `INSERT INTO recurring_rules(title, description, frequency, weekdays, time, assignee, priority, domain, active, start_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.title,
      r.description,
      r.frequency,
      weekdays,
      r.time,
      r.assignee,
      r.priority,
      r.domain,
      r.active,
      start,
      actor.id,
      nowIso(),
    ).id;
  }
  changed('recurring');
  generateRecurring(localDateKey(clock.now(), tz()));
  return id;
}

export function deleteRule(id: number): void {
  db().run('DELETE FROM recurring_rules WHERE id = ?', id);
  changed('recurring');
}

function matches(rule: RuleRow, dateKey: string): boolean {
  if (dateKey < rule.start_date) return false;
  if (rule.frequency === 'daily') return true;
  return (JSON.parse(rule.weekdays) as number[]).includes(weekdayOf(dateKey));
}

/** Creates today's instances of every recurring rule (idempotent). Returns number of tasks created. */
export function generateRecurring(dateKey: string): number {
  let created = 0;
  const rules = db().all<RuleRow>('SELECT * FROM recurring_rules WHERE active = 1');
  for (const rule of rules) {
    if (!matches(rule, dateKey)) continue;
    if (db().get('SELECT 1 FROM recurring_instances WHERE rule_id = ? AND date = ?', rule.id, dateKey)) continue;
    const creator = getUserRow(rule.created_by);
    db().tx(() => {
      db().run('INSERT INTO recurring_instances(rule_id, date) VALUES (?, ?)', rule.id, dateKey);
      db().run('UPDATE recurring_rules SET last_generated_date = ? WHERE id = ?', dateKey, rule.id);
      if (!creator) return;
      let ownerIds: number[] = [];
      let assignMode: 'shared' | 'all' = 'shared';
      if (rule.assignee === 'all') assignMode = 'all';
      else if (rule.assignee === 'week_lead') {
        const wid = weekForDate(dateKey);
        const lead = wid ? db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', wid)?.lead_id : null;
        ownerIds = [lead ?? creator.id];
      } else {
        const u = getUserRow(Number(rule.assignee));
        if (!u || !u.active) return;
        ownerIds = [u.id];
      }
      try {
        created += createTasks(
          creator,
          {
            title: rule.title,
            description: rule.description,
            assignMode,
            ownerIds,
            deadline: zonedIso(dateKey, rule.time, tz()),
            priority: rule.priority,
            domain: rule.domain,
          },
          { system: true, silent: true, recurringRuleId: rule.id, activityText: 'המערכת יצרה את המשימה החוזרת' },
        ).length;
      } catch {
        // e.g. no active staff for an "all" rule - skip this occurrence
      }
    });
  }
  return created;
}

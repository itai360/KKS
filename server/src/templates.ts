// Section 16/38/58: templates ("פתיחת שבוע", activity workflows) that turn into tasks.

import { z } from 'zod';
import { PRIORITIES } from '../../shared/constants';
import { addDays, isDateKey, zonedIso } from '../../shared/dates';
import type { Template, TemplateItem } from '../../shared/types';
import { getUserRow, type UserRow } from './auth';
import { badRequest, forbidden, getSettings, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed, logActivity } from './journal';
import { isCommander } from './taskRepo';
import { createTasks, weekForDate } from './taskService';

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

export const templateItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  domain: z.string().max(60).optional(),
  priority: z.enum(PRIORITIES).optional(),
  offsetDays: z.number().int().min(-60).max(60),
  time: z.string().regex(timeRe).optional().or(z.literal('')),
  owner: z.string().max(20).optional(),
  stage: z.string().max(60).optional(),
  requiresApproval: z.boolean().optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1, 'חובה לתת שם לתבנית').max(120),
  description: z.string().max(2000).optional().default(''),
  kind: z.enum(['week', 'activity', 'general']).optional().default('general'),
  items: z.array(templateItemSchema).max(100).default([]),
  autoApplyDaysBefore: z.number().int().min(0).max(60).nullable().optional().default(null),
});

interface TemplateRow {
  id: number;
  name: string;
  description: string;
  kind: Template['kind'];
  items: string;
  auto_apply_days_before: number | null;
  created_at: string;
}

function toTemplate(r: TemplateRow): Template {
  let items: TemplateItem[] = [];
  try {
    items = JSON.parse(r.items);
  } catch {
    items = [];
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    items,
    autoApplyDaysBefore: r.auto_apply_days_before,
    createdAt: r.created_at,
  };
}

export function listTemplates(kind?: string): Template[] {
  const rows = kind
    ? db().all<TemplateRow>('SELECT * FROM templates WHERE kind = ? ORDER BY name', kind)
    : db().all<TemplateRow>('SELECT * FROM templates ORDER BY kind, name');
  return rows.map(toTemplate);
}

export function getTemplate(id: number): Template {
  const r = db().get<TemplateRow>('SELECT * FROM templates WHERE id = ?', id);
  if (!r) throw notFound('התבנית לא נמצאה');
  return toTemplate(r);
}

export function saveTemplate(actor: UserRow, raw: z.input<typeof templateSchema>, id?: number): number {
  const t = templateSchema.parse(raw);
  const items = JSON.stringify(t.items);
  if (id) {
    getTemplate(id);
    db().run(
      'UPDATE templates SET name = ?, description = ?, kind = ?, items = ?, auto_apply_days_before = ? WHERE id = ?',
      t.name,
      t.description,
      t.kind,
      items,
      t.autoApplyDaysBefore,
      id,
    );
  } else {
    id = db().run(
      'INSERT INTO templates(name, description, kind, items, auto_apply_days_before, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      t.name,
      t.description,
      t.kind,
      items,
      t.autoApplyDaysBefore,
      actor.id,
      nowIso(),
    ).id;
  }
  changed('templates');
  return id;
}

export function deleteTemplate(id: number): void {
  db().run('DELETE FROM templates WHERE id = ?', id);
  changed('templates');
}

export const applySchema = z.object({
  weekId: z.number().int().positive().nullable().optional(),
  eventId: z.number().int().positive().nullable().optional(),
  anchorDate: z.string().refine(isDateKey, 'תאריך לא תקין').optional(),
  itemIndexes: z.array(z.number().int().min(0)).optional(),
  owners: z.record(z.string(), z.number().int().positive()).optional(),
});

export interface ApplyOptions {
  /** run by the scheduler (section 72) - silent, attributed to the system */
  automatic?: boolean;
  /** caller already verified permissions (e.g. week opening by its lead) */
  trusted?: boolean;
}

/** Creates tasks from a template. Returns the new task ids. */
export function applyTemplate(actor: UserRow, templateId: number, raw: z.input<typeof applySchema>, opts: ApplyOptions = {}): number[] {
  const automatic = !!opts.automatic;
  const input = applySchema.parse(raw);
  const tpl = getTemplate(templateId);
  const event = input.eventId
    ? db().get<{ id: number; date: string; owner_id: number | null; week_id: number | null; title: string }>(
        'SELECT id, date, owner_id, week_id, title FROM events WHERE id = ?',
        input.eventId,
      )
    : undefined;
  if (input.eventId && !event) throw badRequest('הפעילות לא נמצאה');
  const weekId = input.weekId ?? event?.week_id ?? null;
  const week = weekId
    ? db().get<{ id: number; name: string; start_date: string; lead_id: number | null }>('SELECT id, name, start_date, lead_id FROM weeks WHERE id = ?', weekId)
    : undefined;
  if (weekId && !week) throw badRequest('השבוע לא נמצא');

  if (!automatic && !opts.trusted && !isCommander(actor)) {
    const allowed = (week && week.lead_id === actor.id) || (event && event.owner_id === actor.id);
    if (!allowed) throw forbidden('רק מפקד הקורס או המפק"צ האחראי יכולים להפעיל תבנית');
  }

  const anchor = event?.date ?? (input.weekId ? week?.start_date : undefined) ?? input.anchorDate;
  if (!anchor) throw badRequest('יש לבחור שבוע, פעילות או תאריך עוגן');
  const settings = getSettings();
  const indexes = input.itemIndexes ?? tpl.items.map((_, i) => i);
  const leadForDate = (dateKey: string) => {
    if (week?.lead_id) return week.lead_id;
    const wid = weekForDate(dateKey);
    return wid ? (db().get<{ lead_id: number | null }>('SELECT lead_id FROM weeks WHERE id = ?', wid)?.lead_id ?? null) : null;
  };

  const ids: number[] = [];
  db().tx(() => {
    for (const idx of indexes) {
      const item = tpl.items[idx];
      if (!item) continue;
      const dateKey = addDays(anchor, item.offsetDays);
      let owner: number | null = input.owners?.[String(idx)] ?? null;
      if (!owner) {
        const spec = item.owner ?? '';
        if (spec === 'week_lead') owner = leadForDate(dateKey);
        else if (spec === 'event_owner') owner = event?.owner_id ?? null;
        else if (/^\d+$/.test(spec)) {
          const u = getUserRow(Number(spec));
          owner = u && u.active ? u.id : null;
        }
      }
      owner ??= leadForDate(dateKey) ?? event?.owner_id ?? actor.id;
      const created = createTasks(
        actor,
        {
          title: item.title,
          description: item.description ?? '',
          ownerIds: [owner],
          deadline: zonedIso(dateKey, item.time || settings.defaultDeadlineTime, tz()),
          priority: item.priority ?? 'normal',
          domain: item.domain ?? '',
          weekId: input.weekId ?? (event ? event.week_id : undefined) ?? undefined,
          eventId: event?.id ?? null,
          requiresApproval: item.requiresApproval ?? false,
        },
        {
          system: true,
          silent: automatic,
          activityText: automatic
            ? `המערכת יצרה את המשימה אוטומטית מתבנית "${tpl.name}"`
            : `${actor.display_name} יצר את המשימה מתבנית "${tpl.name}"`,
        },
      );
      ids.push(...created);
    }
    if (week) {
      db().run(
        'INSERT OR IGNORE INTO week_templates(week_id, template_id, applied_at, applied_by) VALUES (?, ?, ?, ?)',
        week.id,
        tpl.id,
        nowIso(),
        automatic ? null : actor.id,
      );
      logActivity({
        weekId: week.id,
        userId: automatic ? null : actor.id,
        action: 'template_applied',
        text: `${automatic ? 'המערכת הפעילה' : `${actor.display_name} הפעיל`} את התבנית "${tpl.name}" על ${week.name} (${ids.length} משימות)`,
      });
    }
  });
  changed('tasks', 'weeks');
  return ids;
}

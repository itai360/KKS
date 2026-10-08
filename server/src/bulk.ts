// Changing many items at once (select several, or all, in any list). Each item
// goes through the same function, and the same permission checks, as when it is
// changed on its own; an item that cannot be changed is reported and the others
// still are. Everything happens in one transaction, so the serverless
// deployment saves once.

import { z } from 'zod';
import { CADET_STATUSES, PRIORITIES } from '../../shared/constants';
import { addDays, localDateKey, localTime, zonedIso } from '../../shared/dates';
import type { UserRow } from './auth';
import { deleteCadet, deleteExperience, deleteTeam, updateCadet } from './cadets';
import { badRequest, forbidden, HttpError, nowIso, tz } from './core';
import { db } from './db';
import { deleteDebrief } from './debriefs';
import { deleteDocument, updateDocument } from './documents';
import { changed, notificationsChanged } from './journal';
import { deleteRule } from './recurring';
import { cancelEvent, deleteEvent, restoreEvent, updateEvent } from './schedule';
import { isCommander, mustTaskRow } from './taskRepo';
import { decideRequest, deleteTask, transition, updateTask } from './taskService';
import { deleteTemplate } from './templates';
import { deleteWeek, updateWeek } from './weeks';

type Value = string | number | boolean | null | undefined;
type Op = { commander?: boolean; run: (actor: UserRow, id: number, value: Value) => void };

const toId = (v: Value) => (v === null || v === undefined || v === '' ? null : Number(v));
const days = (v: Value) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 365) throw badRequest('מספר ימים לא תקין');
  return n;
};
const oneOf = <T extends string>(list: readonly T[], v: Value): T => {
  if (!list.includes(v as T)) throw badRequest('ערך לא תקין');
  return v as T;
};

const OPS: Record<string, Record<string, Op>> = {
  tasks: {
    delete: { run: (a, id) => deleteTask(a, id) },
    start: { run: (a, id) => transition(a, id, { action: 'start' }) },
    complete: { run: (a, id) => transition(a, id, { action: 'complete' }) },
    approve: { run: (a, id) => transition(a, id, { action: 'approve' }) },
    cancel: { run: (a, id, v) => transition(a, id, { action: 'cancel', reason: String(v || 'בוטלה בפעולה מרוכזת') }) },
    reopen: { run: (a, id) => transition(a, id, { action: 'reopen' }) },
    priority: { run: (a, id, v) => updateTask(a, id, { priority: oneOf(PRIORITIES, v) }) },
    owner: { run: (a, id, v) => updateTask(a, id, { ownerId: Number(v) }) },
    week: { run: (a, id, v) => updateTask(a, id, { weekId: toId(v) }) },
    domain: { run: (a, id, v) => updateTask(a, id, { domain: String(v ?? '') }) },
    shift: {
      // days on the course's calendar, at the same hour of the day - also across a change of the clock
      run: (a, id, v) => {
        const t = mustTaskRow(id);
        updateTask(a, id, { deadline: zonedIso(addDays(localDateKey(t.deadline, tz()), days(v)), localTime(t.deadline, tz()), tz()) });
      },
    },
  },
  events: {
    delete: { run: (a, id) => deleteEvent(a, id) },
    cancel: { run: (a, id) => cancelEvent(a, id, { taskAction: 'keep' }) },
    restore: { run: (a, id) => restoreEvent(a, id) },
    shift: {
      run: (a, id, v) => {
        const date = db().get<{ date: string }>('SELECT date FROM events WHERE id = ?', id)?.date;
        if (!date) throw badRequest('האירוע לא נמצא');
        updateEvent(a, id, { date: addDays(date, days(v)) });
      },
    },
  },
  cadets: {
    delete: { commander: true, run: (_a, id) => deleteCadet(id) },
    team: { run: (a, id, v) => updateCadet(a, id, { teamId: toId(v) }) },
    status: { run: (a, id, v) => updateCadet(a, id, { status: oneOf(CADET_STATUSES, v) }) },
  },
  teams: {
    delete: { commander: true, run: (_a, id) => deleteTeam(id) },
  },
  weeks: {
    delete: { commander: true, run: (_a, id) => deleteWeek(id) },
    lead: { commander: true, run: (a, id, v) => updateWeek(a, id, { leadId: toId(v) }) },
  },
  documents: {
    delete: { run: (a, id) => deleteDocument(a, id) },
    category: { run: (a, id, v) => updateDocument(a, id, { category: String(v ?? '') }) },
    pin: { run: (a, id, v) => updateDocument(a, id, { pinned: !!v }) },
    restricted: { run: (a, id, v) => updateDocument(a, id, { restricted: !!v }) },
  },
  templates: {
    delete: { commander: true, run: (_a, id) => deleteTemplate(id) },
  },
  recurring: {
    delete: { commander: true, run: (_a, id) => deleteRule(id) },
    active: {
      commander: true,
      run: (_a, id, v) => {
        db().run('UPDATE recurring_rules SET active = ? WHERE id = ?', v ? 1 : 0, id);
        changed('recurring');
      },
    },
  },
  debriefs: {
    delete: { run: (a, id) => deleteDebrief(a, id) },
  },
  experiences: {
    delete: { run: (a, id) => deleteExperience(a, id) },
  },
  requests: {
    approve: { run: (a, id) => decideRequest(a, id, { approve: true }) },
    reject: { run: (a, id, v) => decideRequest(a, id, { approve: false, note: v ? String(v) : undefined }) },
  },
  notifications: {
    read: {
      run: (a, id) => {
        db().run('UPDATE notifications SET read_at = coalesce(read_at, ?) WHERE id = ? AND user_id = ?', nowIso(), id, a.id);
        notificationsChanged(a.id);
      },
    },
    delete: {
      run: (a, id) => {
        db().run('DELETE FROM notifications WHERE id = ? AND user_id = ?', id, a.id);
        notificationsChanged(a.id);
      },
    },
  },
  users: {
    active: {
      commander: true,
      run: (a, id, v) => {
        const u = db().get<{ role: string; active: number }>('SELECT role, active FROM users WHERE id = ?', id);
        if (!u) throw badRequest('המשתמש לא נמצא');
        if (!v && id === a.id) throw badRequest('אי אפשר להשבית את עצמך');
        if (!v && u.role === 'commander' && u.active) {
          const others = db().get<{ n: number }>("SELECT count(*) AS n FROM users WHERE role = 'commander' AND active = 1 AND id <> ?", id)!.n;
          if (others === 0) throw badRequest('חייב להישאר לפחות מפקד קורס פעיל אחד');
        }
        db().run('UPDATE users SET active = ? WHERE id = ?', v ? 1 : 0, id);
        if (!v) db().run('DELETE FROM sessions WHERE user_id = ?', id);
        changed('users');
      },
    },
  },
};

export const bulkSchema = z.object({
  entity: z.string(),
  action: z.string(),
  ids: z.array(z.number().int().positive()).min(1, 'לא נבחר דבר').max(500),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]).optional(),
});

export interface BulkResult {
  done: number;
  failed: { id: number; error: string }[];
}

export function runBulk(actor: UserRow, raw: z.input<typeof bulkSchema>): BulkResult {
  const { entity, action, ids, value } = bulkSchema.parse(raw);
  // own entries only: a name like "constructor" is not an operation
  const op = Object.hasOwn(OPS, entity) && Object.hasOwn(OPS[entity], action) ? OPS[entity][action] : undefined;
  if (!op) throw badRequest('פעולה לא מוכרת');
  if (op.commander && !isCommander(actor)) throw forbidden('הפעולה הזו שמורה למפקד הקורס');
  const result: BulkResult = { done: 0, failed: [] };
  db().tx(() => {
    for (const id of [...new Set(ids)]) {
      try {
        db().tx(() => op.run(actor, id, value)); // an item that fails is rolled back alone
        result.done++;
      } catch (e) {
        result.failed.push({ id, error: e instanceof HttpError ? e.message : 'שגיאה' });
        if (!(e instanceof HttpError)) console.error('[bulk]', entity, action, id, e);
      }
    }
  });
  return result;
}

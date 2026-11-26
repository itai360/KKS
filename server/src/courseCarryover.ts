// Dated work continues into the next course at its actual dates. Copies keep their state;
// a durable source identity prevents retries (or a deleted destination) from recreating them.
import { randomUUID } from 'node:crypto';
import { addDays, isDateKey, localDateKey } from '../../shared/dates';
import { searchKey } from '../../shared/search';
import { nowIso } from './core';
import { inferWeekNumber } from './weekNumbering';
import { Db, db, migrate, type Param } from './db';

type Row = Record<string, Param> & { id: number };
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
export function courseSetting(d: Db, key: string): unknown {
  try { return JSON.parse(d.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? 'null'); } catch { return null; }
}
export function courseDatesOf(d: Db) {
  const weeks = d.get<{ start: string | null; end: string | null }>('SELECT min(start_date) AS start, max(end_date) AS end FROM weeks')!;
  const date = (key: string, fallback: string | null) => { const v = courseSetting(d, key); return typeof v === 'string' && isDateKey(v) ? v : fallback; };
  return { start: date('startDate', weeks.start), end: date('endDate', weeks.end) };
}
export const courseIdentity = (d: Db) => d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'course_uid'")!.value;
export function courseOrigin(table: string, id: number): string | null {
  return db().get<{ source_name: string }>('SELECT source_name FROM course_carryovers WHERE entity = ? AND target_id = ? LIMIT 1', table, id)?.source_name ?? null;
}

// Only operational work and its context; foreign cadet IDs must never refer to another cohort.
const TABLES = ['settings', 'meta', 'course_entity_tokens', 'weeks', 'tracks', 'tasks', 'task_participants', 'task_dependencies', 'task_updates', 'attachments', 'events', 'event_guests', 'debriefs', 'debrief_items', 'debrief_submissions', 'debrief_submission_points', 'discussions', 'discussion_participants', 'discussion_guests', 'discussion_points', 'discussion_actions', 'weekly_items', 'absences', 'entry_requests', 'recurring_rules', 'recurring_instances'];
/** Capture before a course is cleared; no disk copy or credentials are needed. */
export function captureDatedCourse(from: Db): Db {
  const copy = new Db(':memory:');
  migrate(copy);
  copy.exec('PRAGMA foreign_keys = OFF');
  for (const table of TABLES) {
    copy.run(`DELETE FROM ${q(table)}`);
    for (const row of from.all<Record<string, Param>>(`SELECT * FROM ${q(table)}`)) {
      const cols = Object.keys(row);
      copy.run(`INSERT INTO ${q(table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c]));
    }
  }
  return copy;
}

/** Copy all eligible work once, leaving source records and existing destination edits untouched. */
export function carryDatedCourse(from: Db, to: Db, end: string): number {
  const source = courseIdentity(from);
  const sourceName = String(courseSetting(from, 'courseName') || 'המחזור הקודם');
  const zone = String(courseSetting(from, 'timezone') || 'Asia/Jerusalem');
  const after = (value: Param) => {
    if (typeof value !== 'string' || !value) return false;
    const day = isDateKey(value) ? value : localDateKey(value, zone);
    return day > end;
  };
  const maps = new Map<string, Map<number, number>>();
  const fresh = new Map<string, Set<number>>();
  let copied = 0;
  const map = (table: string) => {
    let m = maps.get(table);
    if (!m) {
      from.run(`INSERT OR IGNORE INTO course_entity_tokens(entity, entity_id, token) SELECT ?, id, lower(hex(randomblob(16))) FROM ${q(table)}`, table);
      const tokens = new Map(from.all<{ entity_id: number; token: string }>('SELECT entity_id, token FROM course_entity_tokens WHERE entity = ?', table).map(r => [r.entity_id, r.token]));
      m = new Map(to.all<{ source_id: number; source_token: string; target_id: number }>('SELECT source_id, source_token, target_id FROM course_carryovers WHERE source_course = ? AND entity = ?', source, table).filter(r => tokens.get(r.source_id) === r.source_token).map(r => [r.source_id, r.target_id]));
      maps.set(table, m);
    }
    return m;
  };
  const mapped = (table: string, id: Param): number | null => {
    if (typeof id !== 'number') return null;
    const target = map(table).get(id);
    return target && to.get(`SELECT 1 FROM ${q(table)} WHERE id = ?`, target) ? target : null;
  };
  const insert = (table: string, row: Row, patch: Record<string, Param> = {}, existingId?: number): number | null => {
    if (map(table).has(row.id)) return mapped(table, row.id);
    const data = { ...row, ...patch };
    const cols = Object.keys(data).filter(c => c !== 'id');
    const id = existingId ?? to.run(`INSERT INTO ${q(table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => data[c])).id;
    to.run('INSERT INTO course_carryovers(source_course, source_name, entity, source_id, source_token, target_id, copied_at) VALUES (?, ?, ?, ?, ?, ?, ?)', source, sourceName, table, row.id, from.get<{ token: string }>('SELECT token FROM course_entity_tokens WHERE entity = ? AND entity_id = ?', table, row.id)!.token, id, nowIso());
    map(table).set(row.id, id);
    if (!fresh.has(table)) fresh.set(table, new Set());
    fresh.get(table)!.add(row.id);
    copied++;
    return id;
  };
  const named = (table: string, id: Param) => {
    if (typeof id !== 'number') return null;
    const r = from.get<Row>(`SELECT * FROM ${q(table)} WHERE id = ?`, id);
    if (!r) return null;
    const name = searchKey(String(r.name));
    return to.all<{ id: number; name: string }>(`SELECT id, name FROM ${q(table)}`).find(x => searchKey(x.name) === name)?.id ?? insert(table, r);
  };
  const weekAt = (value: Param, create = false): number | null => {
    if (typeof value !== 'string' || !value) return null;
    const day = isDateKey(value) ? value : localDateKey(value, zone);
    const found = to.get<{ id: number }>('SELECT id FROM weeks WHERE start_date <= ? AND end_date >= ? ORDER BY start_date LIMIT 1', day, day)?.id;
    if (found || !create) return found ?? null;
    if (to.get('SELECT 1 FROM week_auto_create_exclusions WHERE start_date <= ? AND end_date >= ?', day, day)) return null;
    const start = addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay());
    const number = inferWeekNumber(start, undefined, to);
    return to.run("INSERT INTO weeks(number, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)", number, `שבוע ${number}`, start, addDays(start, 6), nowIso()).id;
  };
  const noCadets = (raw: Param): string => {
    try {
      const walk = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.filter(v => !(v && typeof v === 'object' && 'kind' in v && v.kind === 'cadet')).map(walk);
        if (!value || typeof value !== 'object') return value;
        const x = value as Record<string, unknown>;
        if (x.kind === 'cadet') return null;
        const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'presenterId' ? null : walk(v)]));
        const owners = [x.owner, ...(Array.isArray(x.owners) ? x.owners : [])].filter(v => v && typeof v === 'object' && (v as { kind?: string }).kind === 'cadet') as { name?: string }[];
        if (owners.length) o.ownerText = [x.ownerText, ...new Set(owners.map(v => v.name).filter(Boolean))].filter(Boolean).join(', ');
        return o;
      };
      return JSON.stringify(walk(JSON.parse(String(raw))));
    } catch { return String(raw ?? ''); }
  };
  const rows = (table: string, where = '1=1') => from.all<Row>(`SELECT * FROM ${q(table)} WHERE ${where}`);
  const selectedTasks = new Map(rows('tasks', "status NOT IN ('done', 'cancelled')").filter(r => after(r.deadline)).map(r => [r.id, r]));
  // Keep the parent of an unfinished sub-task as context, even if its date precedes the boundary.
  for (const r of selectedTasks.values()) {
    if (typeof r.parent_id === 'number' && !selectedTasks.has(r.parent_id)) {
      const p = from.get<Row>('SELECT * FROM tasks WHERE id = ?', r.parent_id);
      if (p) selectedTasks.set(p.id, p);
    }
  }
  const taskDue = (id: Param) => typeof id === 'number' && selectedTasks.has(id);
  return to.tx(() => {
    for (const r of rows('events', 'cancelled = 0 AND deleted_at IS NULL').filter(r => after(r.end_date || r.date))) {
      insert('events', r, { week_id: weekAt(r.date), recurrence_id: null, series_id: null, original_date: null, detached: 0, deleted_by: null });
    }
    for (const r of rows('discussions')) {
      const actions = rows('discussion_actions', `discussion_id = ${r.id}`);
      if (!(r.status === 'planned' && after(r.held_on)) && !actions.some(a => a.task_id ? taskDue(a.task_id) : after(a.due_on))) continue;
      insert('discussions', r, { week_id: weekAt(r.held_on) });
    }
    for (const r of rows('debriefs')) {
      const items = rows('debrief_items', `debrief_id = ${r.id}`);
      if (!(r.status === 'draft' && after(r.occurred_on)) && !items.some(i => i.horizon !== 'next' && (i.task_id ? taskDue(i.task_id) : after(i.due_date)))) continue;
      insert('debriefs', r, { week_id: ['weekly', 'company'].includes(String(r.kind)) ? weekAt(r.occurred_on, true) : weekAt(r.occurred_on), event_id: mapped('events', r.event_id), track_id: named('tracks', r.track_id), answers: noCadets(r.answers) });
    }
    const task = (r: Row): number | null => {
      if (map('tasks').has(r.id)) return mapped('tasks', r.id);
      const parent = typeof r.parent_id === 'number' && selectedTasks.get(r.parent_id);
      const parentId = parent ? task(parent) : null;
      const rule = typeof r.recurring_rule_id === 'number' ? from.get<{ title: string }>('SELECT title FROM recurring_rules WHERE id = ?', r.recurring_rule_id) : null;
      const there = rule && to.get<{ id: number }>('SELECT id FROM recurring_rules WHERE title = ?', rule.title);
      const occurrence = there ? to.get<{ id: number }>('SELECT id FROM tasks WHERE recurring_rule_id = ? AND owner_id = ? AND deadline = ?', there.id, r.owner_id, r.deadline)?.id : undefined;
      const id = insert('tasks', r, {
        week_id: weekAt(r.deadline), track_id: named('tracks', r.track_id), parent_id: parentId,
        event_id: mapped('events', r.event_id), debrief_id: mapped('debriefs', r.debrief_id), meeting_id: null,
        recurring_rule_id: null, cadet_id: null, experience_id: null,
        group_id: r.group_id ? `${source}:${r.group_id}` : null,
        reminded_24h: 0, reminded_2h: 0, overdue_notified: 0,
      }, occurrence);
      // Keep recurring occurrences distinct from next cycle's freshly generated routine.
      if (id && typeof r.recurring_rule_id === 'number') {
        if (there) {
          to.run('UPDATE tasks SET recurring_rule_id = ? WHERE id = ?', there.id, id);
          to.run('INSERT OR IGNORE INTO recurring_instances(rule_id, date) VALUES (?, ?)', there.id, localDateKey(String(r.deadline), zone));
        }
      }
      return id;
    };
    for (const r of selectedTasks.values()) task(r);
    // Relationships are remapped by source ID, never by coincidentally equal IDs in another cohort.
    const child = (table: string, parentTable: string, key: string, patch: (r: Row) => Record<string, Param> = () => ({}), eligible: (r: Row) => boolean = () => true) => {
      for (const r of rows(table).filter(eligible)) {
        const parent = mapped(parentTable, r[key]);
        if (parent) insert(table, r, { [key]: parent, ...patch(r) });
      }
    };
    child('task_updates', 'tasks', 'task_id');
    for (const [old, id] of map('tasks')) if (fresh.get('tasks')?.has(old)) {
      to.run("INSERT INTO task_updates(task_id, kind, body, created_at) VALUES (?, 'comment', ?, ?)", id, `נוצר במחזור הקודם: ${sourceName}. הועבר עם מועד הביצוע והמצב המקוריים.`, nowIso());
      for (const p of from.all<{ user_id: number }>('SELECT user_id FROM task_participants WHERE task_id = ?', old)) to.run('INSERT OR IGNORE INTO task_participants(task_id, user_id) VALUES (?, ?)', id, p.user_id);
    }
    for (const r of rows('task_dependencies')) {
      const a = mapped('tasks', r.task_id), b = mapped('tasks', r.depends_on_id);
      if (a && b && fresh.get('tasks')?.has(Number(r.task_id))) to.run('INSERT OR IGNORE INTO task_dependencies(task_id, depends_on_id) VALUES (?, ?)', a, b);
    }
    for (const [table, parentTable, key] of [['event_guests', 'events', 'event_id'], ['discussion_participants', 'discussions', 'discussion_id']] as const) {
      for (const r of rows(table)) {
        const parent = mapped(parentTable, r[key]);
        if (!parent || !fresh.get(parentTable)?.has(Number(r[key]))) continue;
        const data = { ...r, [key]: parent }, cols = Object.keys(data);
        to.run(`INSERT OR IGNORE INTO ${q(table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => data[c]));
      }
    }
    child('discussion_points', 'discussions', 'discussion_id');
    child('discussion_guests', 'discussions', 'discussion_id');
    child('discussion_actions', 'discussions', 'discussion_id', r => ({ task_id: mapped('tasks', r.task_id) }), r => r.task_id ? taskDue(r.task_id) : after(r.due_on));
    child('debrief_items', 'debriefs', 'debrief_id', r => ({ task_id: mapped('tasks', r.task_id), recurring_rule_id: null, track_id: named('tracks', r.track_id), owners: noCadets(r.owners) }), r => r.horizon === 'next' || (r.task_id ? taskDue(r.task_id) : after(r.due_date)));
    child('debrief_submissions', 'debriefs', 'debrief_id');
    child('debrief_submission_points', 'debrief_submissions', 'submission_id', r => {
      if (!r.lesson) return {};
      const lesson = JSON.parse(String(r.lesson));
      return { lesson: JSON.stringify({ ...lesson, trackId: named('tracks', lesson.trackId) }) };
    });
    for (const r of rows('weekly_items', 'done = 0').filter(r => after(r.event_date) || taskDue(r.task_id))) {
      const due = r.event_date || selectedTasks.get(Number(r.task_id))?.deadline;
      const weekId = weekAt(due, true);
      if (!weekId) continue; // an explicitly removed week stays absent; the source topic remains intact
      insert('weekly_items', r, { week_id: weekId, task_id: mapped('tasks', r.task_id), event_ref: r.event_ref && String(r.event_ref).startsWith('e:') ? (mapped('events', Number(String(r.event_ref).slice(2))) ? `e:${mapped('events', Number(String(r.event_ref).slice(2)))}` : null) : r.event_ref, carried_from: null });
    }
    for (const r of rows('absences').filter(r => after(r.end_date))) {
      const existing = to.get<{ id: number }>('SELECT id FROM absences WHERE user_id = ? AND start_date = ? AND end_date = ? AND reason = ? AND note = ?', r.user_id, r.start_date, r.end_date, r.reason, r.note)?.id;
      insert('absences', r, {}, existing);
    }
    for (const r of rows('entry_requests').filter(r => after(r.visit_end_date || r.visit_date))) {
      const existing = to.get<{ id: number }>('SELECT id FROM entry_requests WHERE full_name = ? AND id_number = ? AND visit_date = ? AND visit_end_date IS ? AND created_by IS ?', r.full_name, r.id_number, r.visit_date, r.visit_end_date, r.created_by)?.id;
      insert('entry_requests', r, {}, existing);
    }
    for (const r of rows('attachments')) {
      const taskId = mapped('tasks', r.task_id), eventId = mapped('events', r.event_id);
      if (taskId || eventId) insert('attachments', r, { task_id: taskId, event_id: eventId });
    }
    return copied;
  });
}

export function newCourseIdentity(d: Db): void {
  d.run("INSERT INTO meta(key, value) VALUES ('course_uid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", randomUUID());
}

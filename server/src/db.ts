import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type Param = SQLInputValue | boolean | undefined;

function bind(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  private depth = 0;

  /** wal: false keeps the whole database in its one file (the cloud deployment uploads it). */
  constructor(path: string, opts: { wal?: boolean } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
    if (path !== ':memory:' && opts.wal !== false) this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...bind(params)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...bind(params)) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number; id: number } {
    const r = this.stmt(sql).run(...bind(params));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  private commitQueue: (() => void)[] = [];

  /** Runs fn after the outermost transaction commits (immediately when none is open). */
  onCommit(fn: () => void): void {
    if (this.depth === 0) fn();
    else this.commitQueue.push(fn);
  }

  /** Runs fn atomically. Nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth++;
    let out: T;
    try {
      out = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    } catch (e) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      if (this.depth === 0) this.commitQueue = [];
      throw e;
    }
    if (this.depth === 0) {
      const queue = this.commitQueue;
      this.commitQueue = [];
      for (const f of queue) f();
    }
    return out;
  }

  close(): void {
    this.raw.close();
  }
}

const SCHEMA_V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('commander', 'staff')),
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE weeks (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  lead_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'open', 'closed')),
  approved_at TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX events_date ON events(date);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  decisions TEXT NOT NULL DEFAULT '',
  follow_ups TEXT NOT NULL DEFAULT '',
  summary TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE recurring_rules (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  weekdays TEXT NOT NULL DEFAULT '[]',
  time TEXT NOT NULL,
  assignee TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  domain TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  last_generated_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE recurring_instances (
  rule_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (rule_id, date)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  deadline TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'waiting', 'pending_approval', 'done', 'cancelled')),
  domain TEXT NOT NULL DEFAULT '',
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  group_id TEXT,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  recurring_rule_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'normal' CHECK (visibility IN ('normal', 'team', 'private')),
  block_reason TEXT,
  block_waiting_for TEXT,
  block_next_step TEXT,
  needs_commander INTEGER NOT NULL DEFAULT 0,
  overdue_response TEXT,
  overdue_response_at TEXT,
  cancel_reason TEXT,
  carried_count INTEGER NOT NULL DEFAULT 0,
  reminded_24h INTEGER NOT NULL DEFAULT 0,
  reminded_2h INTEGER NOT NULL DEFAULT 0,
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  completed_late INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);
CREATE INDEX tasks_owner ON tasks(owner_id);
CREATE INDEX tasks_deadline ON tasks(deadline);
CREATE INDEX tasks_week ON tasks(week_id);
CREATE INDEX tasks_status ON tasks(status);
CREATE INDEX tasks_group ON tasks(group_id);
CREATE INDEX tasks_parent ON tasks(parent_id);
CREATE INDEX tasks_event ON tasks(event_id);

CREATE TABLE task_participants (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE task_dependencies (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE task_updates (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'comment',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX task_updates_task ON task_updates(task_id);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  title TEXT NOT NULL,
  url TEXT,
  file_name TEXT,
  mime TEXT,
  size INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_title TEXT,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  text TEXT NOT NULL,
  data TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX activity_task ON activity(task_id);
CREATE INDEX activity_created ON activity(created_at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('action', 'info', 'exception')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, read_at);

CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('deadline', 'transfer')),
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  new_deadline TEXT,
  new_owner_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('good', 'bad', 'change')),
  body TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('week', 'activity', 'general')),
  items TEXT NOT NULL DEFAULT '[]',
  auto_apply_days_before INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE week_templates (
  week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  applied_at TEXT NOT NULL,
  applied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (week_id, template_id)
);
`;

// Version 3 of the spec (section 31): cadets, experiences, debriefs, documents.
// Plus push subscriptions and an optional e-mail for Google sign-in.
const SCHEMA_V2 = `
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  commander_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE cadets (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  personal_number TEXT NOT NULL DEFAULT '',
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped', 'graduated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX cadets_team ON cadets(team_id);

CREATE TABLE cadet_records (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'talk', 'discipline', 'evaluation')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  score INTEGER,
  follow_up TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX cadet_records_cadet ON cadet_records(cadet_id);

CREATE TABLE experiences (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  goals TEXT NOT NULL DEFAULT '',
  mentor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done')),
  strengths TEXT NOT NULL DEFAULT '',
  improvements TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  score INTEGER,
  evaluated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  evaluated_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX experiences_cadet ON experiences(cadet_id);

CREATE TABLE debriefs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  facilitator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  participants TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE debrief_items (
  id INTEGER PRIMARY KEY,
  debrief_id INTEGER NOT NULL REFERENCES debriefs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'finding', 'conclusion', 'lesson')),
  body TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  recurring_rule_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX debrief_items_debrief ON debrief_items(debrief_id);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  url TEXT,
  file_name TEXT,
  mime TEXT,
  size INTEGER,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  restricted INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

ALTER TABLE tasks ADD COLUMN cadet_id INTEGER REFERENCES cadets(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN experience_id INTEGER REFERENCES experiences(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN debrief_id INTEGER REFERENCES debriefs(id) ON DELETE SET NULL;
`;

// Google Calendar: a personal feed link per user, and calendars shown in the schedule
const SCHEMA_V3 = `
ALTER TABLE users ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX users_calendar_token ON users(calendar_token);

CREATE TABLE calendar_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
`;

// course weeks imported from a Google calendar keep the event they came from
const SCHEMA_V4 = `
ALTER TABLE weeks ADD COLUMN calendar_uid TEXT;
`;

const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4];

export function migrate(db: Db): void {
  const hasMeta = db.get<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='meta'");
  let version = 0;
  if (hasMeta && hasMeta.n > 0) {
    version = Number(db.get<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'")?.value ?? 0);
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.tx(() => {
      db.exec(MIGRATIONS[v]);
      db.run("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(v + 1));
    });
  }
}

let current: Db | null = null;

export function openDb(path: string, opts: { wal?: boolean } = {}): Db {
  const db = new Db(path, opts);
  migrate(db);
  current = db;
  return db;
}

export function db(): Db {
  if (!current) throw new Error('Database not initialised');
  return current;
}

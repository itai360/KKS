import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADDED_DOMAINS } from '../../shared/constants';

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
    // a file saved in WAL mode stays in it unless told otherwise, and its changes would then sit in a side file
    if (path !== ':memory:') this.raw.exec(`PRAGMA journal_mode = ${opts.wal === false ? 'DELETE' : 'WAL'}`);
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

// evaluation files: an assessment of each cadet, used when a cadet comes before a committee
const SCHEMA_V5 = `
CREATE TABLE evaluation_files (
  cadet_id INTEGER PRIMARY KEY REFERENCES cadets(id) ON DELETE CASCADE,
  standing TEXT NOT NULL DEFAULT 'ok' CHECK (standing IN ('ok', 'watch', 'risk')),
  team_opinion TEXT NOT NULL DEFAULT '',
  team_opinion_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_opinion_at TEXT,
  commander_opinion TEXT NOT NULL DEFAULT '',
  commander_opinion_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  commander_opinion_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE evaluation_entries (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('positive', 'improve', 'exception')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  occurred_on TEXT NOT NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  shown_on TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX evaluation_entries_cadet ON evaluation_entries(cadet_id);

CREATE TABLE committees (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  meeting_date TEXT,
  referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  referred_at TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('continue', 'conditional', 'dismissed', 'other')),
  decision_text TEXT NOT NULL DEFAULT '',
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT
);
CREATE INDEX committees_cadet ON committees(cadet_id);
`;

// the snapshots of the serverless deployment, whose files are kept in its file storage (snapshots.ts)
const SCHEMA_V6 = `
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  saved_at TEXT NOT NULL,
  label TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
`;

// login lockouts shared by every instance of the serverless deployment (auth.ts)
const SCHEMA_V7 = `
CREATE TABLE login_lockouts (key TEXT PRIMARY KEY, until INTEGER NOT NULL);
`;

// discipline notes (הערות משמעת) and the enforcement ladder the commander imports
const SCHEMA_V8 = `
ALTER TABLE cadet_records ADD COLUMN offense TEXT NOT NULL DEFAULT '';
ALTER TABLE cadet_records ADD COLUMN formal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cadets ADD COLUMN dismissed_by_record INTEGER;
CREATE TABLE discipline_guide (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  offenses TEXT NOT NULL,
  letters TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  imported_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
`;

// the third discipline note sends the cadet to an evaluation committee instead of
// dismissing; a cadet the first release dismissed that way goes to the committee now
const SCHEMA_V9 = `
ALTER TABLE committees ADD COLUMN from_record INTEGER;
INSERT INTO committees(cadet_id, kind, reason, referred_by, referred_at, snapshot, snapshot_at, from_record)
  SELECT c.id, 'ועדת הערכה', 'קיבל 3 הערות משמעת', r.author_id, r.created_at, '', r.created_at, c.dismissed_by_record
  FROM cadets c JOIN cadet_records r ON r.id = c.dismissed_by_record
  WHERE c.status = 'dropped' AND NOT EXISTS (SELECT 1 FROM committees x WHERE x.cadet_id = c.id AND x.decision IS NULL);
UPDATE cadets SET status = 'active' WHERE dismissed_by_record IS NOT NULL AND status = 'dropped';
UPDATE cadets SET dismissed_by_record = NULL WHERE dismissed_by_record IS NOT NULL;
`;

// a debrief about an activity in the synced Google calendar keeps its name (it has no event here)
const SCHEMA_V10 = `
ALTER TABLE debriefs ADD COLUMN activity TEXT NOT NULL DEFAULT '';
`;

// exemptions: a cadet excused from a rule (the staff must know not to remark on it)
const SCHEMA_V11 = `
CREATE TABLE exemptions (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  until TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX exemptions_cadet ON exemptions(cadet_id);
`;

// a password someone else set (a new account, a reset): the person picks their own on first sign-in
const SCHEMA_V12 = `
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
`;

// debrief forms: a weekly debrief and an intensive-event debrief, filled in as a form; lessons
// carry an owner and a date (a task when the debrief is summed up) or wait for the next cycle
const SCHEMA_V13 = `
ALTER TABLE debriefs ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';
ALTER TABLE debriefs ADD COLUMN answers TEXT NOT NULL DEFAULT '{}';
ALTER TABLE debrief_items ADD COLUMN horizon TEXT;
ALTER TABLE debrief_items ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE debrief_items ADD COLUMN due_date TEXT;
ALTER TABLE debrief_items ADD COLUMN target TEXT NOT NULL DEFAULT '';
ALTER TABLE debrief_items ADD COLUMN target_key TEXT NOT NULL DEFAULT '';
ALTER TABLE debrief_items ADD COLUMN target_week INTEGER;
CREATE INDEX debrief_items_horizon ON debrief_items(horizon);
`;

// closing the loop on lessons: what was decided about each lesson an earlier cycle kept for
// a week or an event (a task, applied, not relevant), and the reminders automation sends once
const SCHEMA_V14 = `
CREATE TABLE lesson_reviews (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES debrief_items(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT NOT NULL,
  UNIQUE (item_id, context)
);
CREATE TABLE automation_marks (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
`;

// who on the staff is away when (leave, sick day, a course, reserve duty)
const SCHEMA_V15 = `
CREATE TABLE absences (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'leave',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX absences_dates ON absences(end_date, start_date);
`;

// the daily roll call (מצבה): where each cadet is on each day
const SCHEMA_V16 = `
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  marked_at TEXT NOT NULL,
  UNIQUE (cadet_id, date)
);
CREATE INDEX attendance_date ON attendance(date);
`;

// announcements to the staff, and who read and confirmed each one
const SCHEMA_V17 = `
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  require_ack INTEGER NOT NULL DEFAULT 1,
  urgent INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  acked_at TEXT,
  PRIMARY KEY (announcement_id, user_id)
);
`;

// a notification put off until later comes back unread then
const SCHEMA_V18 = `
ALTER TABLE notifications ADD COLUMN snoozed_until TEXT;
CREATE INDEX notifications_snoozed ON notifications(snoozed_until);
`;

// more areas of responsibility (education, academics, PT, field, navigation, religion, vehicles):
// a course that keeps its own list of areas gets them too, before "אחר"
function V19_DOMAINS(db: Db): void {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'domains'");
  if (!row) return; // the defaults already have them
  let list: unknown;
  try {
    list = JSON.parse(row.value);
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  const add = ADDED_DOMAINS.filter((d) => !list.includes(d));
  if (!add.length) return;
  const other = list.indexOf('אחר');
  const next = other >= 0 ? [...list.slice(0, other), ...add, ...list.slice(other)] : [...list, ...add];
  db.run("UPDATE settings SET value = ? WHERE key = 'domains'", JSON.stringify(next.slice(0, 40)));
}

// a week imported without a number in its name ("שבוע סף") was numbered after all the others (1),
// next to weeks that carry the calendar's numbers (39): it takes its neighbours' numbering (38).
// Only a week that looks counted (no higher than the number of weeks), and only when such weeks
// are no more than the ones in the other numbering - one stray high number renumbers nothing.
function V20_WEEK_NUMBERS(db: Db): void {
  const weeks = db.all<{ id: number; number: number; name: string; start_date: string }>('SELECT id, number, name, start_date FROM weeks ORDER BY start_date');
  const high = weeks.filter((w) => w.number > weeks.length);
  const counted = weeks.filter((w) => w.number <= weeks.length && !/שבוע\s*\d/.test(w.name));
  if (!high.length || !counted.length || counted.length > high.length) return;
  const days = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
  for (const w of counted) {
    const near = high.reduce((a, b) => (Math.abs(days(b.start_date, w.start_date)) < Math.abs(days(a.start_date, w.start_date)) ? b : a));
    const n = near.number + Math.round(days(w.start_date, near.start_date) / 7);
    if (n >= 1 && n <= 100 && n !== w.number) db.run('UPDATE weeks SET number = ? WHERE id = ?', n, w.id);
  }
}

// the area "אחר" says what it is
const SCHEMA_V21 = `
ALTER TABLE tasks ADD COLUMN domain_note TEXT NOT NULL DEFAULT '';
`;

// previous courses: a course that ended is kept whole as a snapshot (label 'archive', never pruned)
const SCHEMA_V22 = `
CREATE TABLE course_archives (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archived_at TEXT NOT NULL
);
`;

// "יישור קו": the messages of the staff's WhatsApp group, from WhatsApp's chat export (alignment.ts)
const SCHEMA_V23 = `
CREATE TABLE alignment_messages (
  id INTEGER PRIMARY KEY,
  sent_at TEXT NOT NULL,
  sender TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  media INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL
);
CREATE INDEX alignment_messages_sent ON alignment_messages(sent_at);
CREATE TABLE alignment_imports (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added INTEGER NOT NULL,
  found INTEGER NOT NULL
);
`;

// the last "יישור קו" message each person has seen: the menu counts what came in since
const SCHEMA_V24 = `
ALTER TABLE users ADD COLUMN alignment_seen_id INTEGER NOT NULL DEFAULT 0;
`;

// two-step sign-in (twofactor.ts): the app's secret, the backup codes, and the tickets between password and code
const SCHEMA_V25 = `
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_pending TEXT;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
CREATE TABLE recovery_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id);
CREATE TABLE login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
`;

// plan approval (plans.ts): the commander's wording of a week's plan document, and its approval
const SCHEMA_V26 = `
CREATE TABLE plan_docs (
  week_id INTEGER PRIMARY KEY REFERENCES weeks(id) ON DELETE CASCADE,
  bluf TEXT,
  goals TEXT,
  achievements TEXT,
  emphases TEXT,
  requests TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'approved')),
  approved_by TEXT NOT NULL DEFAULT '',
  approved_on TEXT,
  approval_notes TEXT NOT NULL DEFAULT '',
  approved_events TEXT,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
`;

// a personal talk filled in as a form (shared/talks.ts): the answers by field
const SCHEMA_V27 = `
ALTER TABLE cadet_records ADD COLUMN form TEXT;
`;

// the evaluation file as a living file in nine parts (evaluations.ts): the course and the cadet,
// the military path, exams and fitness, group dynamics, the reason for a committee, the team
// commander's dated remarks, the critical points and the company commander's summary - with the
// history of every change. What was written before stays: the remarks keep their dates and
// writers, the team commander's opinion opens their remarks, the commander's opinion is the summary.
function V28_EVALUATION_FILE(db: Db): void {
  db.exec(`
ALTER TABLE evaluation_files ADD COLUMN company_commander TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluation_files ADD COLUMN team_commander TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluation_files ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluation_files ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluation_files ADD COLUMN enlisted_on TEXT;
ALTER TABLE evaluation_files ADD COLUMN release_on TEXT;
ALTER TABLE evaluation_files ADD COLUMN military_path TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluation_files ADD COLUMN mid_a REAL;
ALTER TABLE evaluation_files ADD COLUMN mid_b REAL;
ALTER TABLE evaluation_files ADD COLUMN final_a REAL;
ALTER TABLE evaluation_files ADD COLUMN final_b REAL;
ALTER TABLE evaluation_files ADD COLUMN run_result TEXT;
ALTER TABLE evaluation_files ADD COLUMN run_score REAL;
ALTER TABLE evaluation_files ADD COLUMN pushups INTEGER;
ALTER TABLE evaluation_files ADD COLUMN pushups_score REAL;
ALTER TABLE evaluation_files ADD COLUMN committee_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluation_files ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE evaluation_entries_v28 (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '',
  tone TEXT,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  occurred_on TEXT NOT NULL,
  week_id INTEGER REFERENCES weeks(id) ON DELETE SET NULL,
  shown_on TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO evaluation_entries_v28(id, cadet_id, category, tone, title, body, occurred_on, week_id, shown_on, author_id, created_at, updated_at)
  SELECT id, cadet_id, category, tone, title, body, occurred_on, week_id, shown_on, author_id, created_at, updated_at FROM evaluation_entries;
DROP TABLE evaluation_entries;
ALTER TABLE evaluation_entries_v28 RENAME TO evaluation_entries;
CREATE INDEX evaluation_entries_cadet ON evaluation_entries(cadet_id);

CREATE TABLE evaluation_dynamics (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  occurred_on TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 12),
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX evaluation_dynamics_cadet ON evaluation_dynamics(cadet_id);

CREATE TABLE evaluation_points (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  period TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  significance TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX evaluation_points_cadet ON evaluation_points(cadet_id);

CREATE TABLE evaluation_history (
  id INTEGER PRIMARY KEY,
  cadet_id INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  item_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('set', 'add', 'edit', 'delete')),
  field TEXT NOT NULL DEFAULT '',
  old_value TEXT,
  new_value TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  at TEXT NOT NULL
);
CREATE INDEX evaluation_history_cadet ON evaluation_history(cadet_id, at);
`);
  // the team commander's opinion becomes the first of their dated remarks (the original column stays as it was)
  db.run(`
INSERT INTO evaluation_entries(cadet_id, body, occurred_on, author_id, created_at, updated_at)
SELECT f.cadet_id, 'חוות דעת מפקד הצוות (מהתיק הקודם):' || char(10) || f.team_opinion,
  substr(coalesce(f.team_opinion_at, f.updated_at), 1, 10),
  coalesce(f.team_opinion_by, (SELECT t.commander_id FROM cadets c JOIN teams t ON t.id = c.team_id WHERE c.id = f.cadet_id), (SELECT id FROM users WHERE role = 'commander' ORDER BY id LIMIT 1)),
  coalesce(f.team_opinion_at, f.updated_at), coalesce(f.team_opinion_at, f.updated_at)
FROM evaluation_files f
WHERE trim(f.team_opinion) <> ''
  AND coalesce(f.team_opinion_by, (SELECT t.commander_id FROM cadets c JOIN teams t ON t.id = c.team_id WHERE c.id = f.cadet_id), (SELECT id FROM users WHERE role = 'commander' ORDER BY id LIMIT 1)) IS NOT NULL`);
}

/** a migration is SQL, or a step that changes data the way SQL alone can't */
const MIGRATIONS: (string | ((db: Db) => void))[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11, SCHEMA_V12, SCHEMA_V13, SCHEMA_V14, SCHEMA_V15, SCHEMA_V16, SCHEMA_V17, SCHEMA_V18, V19_DOMAINS, V20_WEEK_NUMBERS, SCHEMA_V21, SCHEMA_V22, SCHEMA_V23, SCHEMA_V24, SCHEMA_V25, SCHEMA_V26, SCHEMA_V27, V28_EVALUATION_FILE];

/** Brings a database to the current schema (tests may stop at an earlier version). */
export function migrate(db: Db, upTo = MIGRATIONS.length): void {
  const hasMeta = db.get<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='meta'");
  let version = 0;
  if (hasMeta && hasMeta.n > 0) {
    version = Number(db.get<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'")?.value ?? 0);
  }
  for (let v = version; v < upTo; v++) {
    db.tx(() => {
      const step = MIGRATIONS[v];
      if (typeof step === 'string') db.exec(step);
      else step(db);
      db.run("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(v + 1));
    });
  }
}

let current: Db | null = null;
/** a request that reads an earlier course runs against that course's database (courses.ts) */
const scoped = new AsyncLocalStorage<Db>();

export function openDb(path: string, opts: { wal?: boolean } = {}): Db {
  const db = new Db(path, opts);
  migrate(db);
  current = db;
  return db;
}

export function db(): Db {
  const inScope = scoped.getStore();
  if (inScope) return inScope;
  if (!current) throw new Error('Database not initialised');
  return current;
}

/** runs fn (and everything it awaits) with db() returning `d` */
export function withDb<T>(d: Db, fn: () => T): T {
  return scoped.run(d, fn);
}

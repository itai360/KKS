// Snapshots of the whole course database, to undo a mistake (a mass delete,
// a bad import) or recover from damage. Taken automatically - at most every 30
// minutes while people work, plus one a day kept for a month - and on purpose
// right before a delete of many items and before a restore. Restoring copies a
// snapshot's contents into the live database in one transaction, so it works
// the same on a local server and on the serverless deployment (where the
// request's changes are then saved like any other). Sessions and phone
// subscriptions stay as they are, so nobody is logged out.
//
// A local server keeps snapshots as files in DATA_DIR/snapshots. The
// serverless deployment keeps them in its file storage, listed in the
// snapshots table (the provider below, used by cloud.ts).

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SnapshotInfo, SnapshotLabel } from '../../shared/types';
import { badRequest, config, notFound, nowIso, resetSettingsCache } from './core';
import { db, Db, migrate } from './db';
import { changed } from './journal';
import type { Topic } from './realtime';

export const SNAPSHOT_LABELS: SnapshotLabel[] = ['auto', 'manual', 'before_delete', 'before_restore'];
const AUTO_EVERY_MS = 30 * 60_000;
const KEEP_RECENT = 48;
const KEEP_DAYS = 30;

export interface SnapshotProvider {
  list(): Promise<SnapshotInfo[]>;
  take(label: SnapshotLabel): Promise<void>;
  /** the snapshot as an SQLite file, written to `path` */
  fetch(id: string, path: string): Promise<void>;
}

// ---------------- local files ----------------

const dir = () => join(config.dataDir, 'snapshots');
const ID = /^(\d{8}T\d{9}Z)~([a-z_]+)$/;
const stampOf = (d: Date) => d.toISOString().replace(/[-:.]/g, '');
const isoOf = (stamp: string) => `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`;

function localList(): SnapshotInfo[] {
  if (!existsSync(dir())) return [];
  return readdirSync(dir())
    .map((f) => ({ f, m: ID.exec(f.replace(/\.db$/, '')) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => !!x.m && x.f.endsWith('.db') && SNAPSHOT_LABELS.includes(x.m[2] as SnapshotLabel))
    .map(({ f, m }) => ({ id: `${m[1]}~${m[2]}`, savedAt: isoOf(m[1]), label: m[2] as SnapshotLabel, bytes: statSync(join(dir(), f)).size }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Keeps the latest automatic snapshots, the last of each day for a month, and the others for a month. */
export function toPrune(list: SnapshotInfo[], now: Date): string[] {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  const auto = list.filter((s) => s.label === 'auto').sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const keep = new Set(auto.slice(0, KEEP_RECENT).map((s) => s.id));
  const days = new Set<string>();
  for (const s of auto) {
    const day = s.savedAt.slice(0, 10);
    if (s.savedAt >= cutoff && !days.has(day)) {
      days.add(day);
      keep.add(s.id);
    }
  }
  return list.filter((s) => (s.label === 'auto' ? !keep.has(s.id) : s.savedAt < cutoff)).map((s) => s.id);
}

const local: SnapshotProvider = {
  async list() {
    return localList();
  },
  async take(label) {
    mkdirSync(dir(), { recursive: true });
    let stamp = stampOf(new Date());
    while (existsSync(join(dir(), `${stamp}~${label}.db`))) stamp = stampOf(new Date(Date.now() + 1));
    const file = join(dir(), `${stamp}~${label}.db`);
    db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    for (const id of toPrune(localList(), new Date())) rmSync(join(dir(), `${id}.db`), { force: true });
  },
  async fetch(id, path) {
    const file = join(dir(), `${id}.db`);
    if (!ID.test(id) || !existsSync(file)) throw notFound('הגיבוי לא נמצא');
    copyFileSync(file, path);
  },
};

let provider: SnapshotProvider = local;

export function setSnapshotProvider(p: SnapshotProvider): void {
  provider = p;
}

export const listSnapshots = () => provider.list();
export const takeSnapshot = (label: SnapshotLabel) => provider.take(label);

/** A snapshot before a risky change; the change goes ahead even if storage cannot take one. */
export async function snapshotBefore(label: SnapshotLabel): Promise<boolean> {
  try {
    await provider.take(label);
    return true;
  } catch (e) {
    console.error(`[snapshots] could not take a "${label}" snapshot`, e);
    return false;
  }
}

// ---------------- automatic (local server) ----------------

let lastAuto = 0;
let changesAtLastAuto = -1;

/** Called every minute by the local scheduler: a snapshot when there were changes and the last one is 30 minutes old. */
export async function autoSnapshot(now = Date.now()): Promise<boolean> {
  if (provider !== local) return false; // the serverless storage takes its own
  if (!lastAuto) lastAuto = Date.parse(localList().find((s) => s.label === 'auto')?.savedAt ?? '') || 0;
  const n = db().get<{ n: number }>('SELECT total_changes() AS n')!.n;
  if (now - lastAuto < AUTO_EVERY_MS || n === changesAtLastAuto) return false;
  await local.take('auto');
  lastAuto = now;
  changesAtLastAuto = n;
  return true;
}

// ---------------- restoring ----------------

/** Tables not restored from a snapshot: they stay as they are now. */
const KEEP_CURRENT = new Set(['sessions', 'push_subscriptions', 'snapshots', 'login_lockouts']);
const ALL_TOPICS: Topic[] = ['tasks', 'weeks', 'events', 'templates', 'recurring', 'users', 'settings', 'meetings', 'requests', 'cadets', 'debriefs', 'documents'];

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function restoreSnapshot(id: string): Promise<void> {
  if (typeof id !== 'string' || id.length > 100) throw badRequest('גיבוי לא תקין');
  mkdirSync(config.dataDir, { recursive: true });
  const tmp = join(config.dataDir, `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  try {
    await provider.fetch(id, tmp);
    // a snapshot from an older release gets the newer tables and columns first
    const copy = new Db(tmp, { wal: false });
    try {
      migrate(copy);
    } finally {
      copy.close();
    }
    await snapshotBefore('before_restore');
    const live = db();
    live.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS snap`);
    live.exec('PRAGMA foreign_keys = OFF');
    try {
      live.tx(() => {
        const tables = live
          .all<{ name: string }>("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .map((t) => t.name)
          .filter((t) => !KEEP_CURRENT.has(t));
        const inSnap = new Set(live.all<{ name: string }>("SELECT name FROM snap.sqlite_master WHERE type = 'table'").map((t) => t.name));
        for (const t of tables) {
          const where = t === 'meta' ? " WHERE key <> 'schema_version'" : '';
          live.exec(`DELETE FROM main.${quote(t)}${where}`);
          if (!inSnap.has(t)) continue;
          const mine = new Set(live.all<{ name: string }>(`PRAGMA main.table_info(${quote(t)})`).map((c) => c.name));
          const cols = live
            .all<{ name: string }>(`PRAGMA snap.table_info(${quote(t)})`)
            .map((c) => c.name)
            .filter((c) => mine.has(c))
            .map(quote)
            .join(', ');
          if (cols) live.exec(`INSERT INTO main.${quote(t)} (${cols}) SELECT ${cols} FROM snap.${quote(t)}${where}`);
        }
        // sessions of accounts the snapshot does not have end here
        live.run('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users WHERE active = 1)');
        live.run('DELETE FROM push_subscriptions WHERE user_id NOT IN (SELECT id FROM users)');
      });
    } finally {
      live.exec('PRAGMA foreign_keys = ON');
      live.exec('DETACH DATABASE snap');
    }
    resetSettingsCache(); // the course settings came back with the rest
    changed(...ALL_TOPICS);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// ---------------- in file storage (the serverless deployment) ----------------

export interface FileStorage {
  put(name: string, base64: string): Promise<unknown>;
  get(name: string): Promise<string | null>;
  remove(name: string): Promise<unknown>;
}

const fileName = (id: string) => `snapshots/${id}.db`;

/**
 * Snapshots kept in the deployment's file storage, listed in the snapshots
 * table of the database (so every instance sees them). `current` is the
 * database as this instance last loaded it - the state before the request
 * being served changed anything - and its shared version.
 */
export function storedSnapshots(files: FileStorage, current: () => { data: Buffer; version: number }): SnapshotProvider & { autoDue(now: number, version: number): boolean } {
  const list = (): SnapshotInfo[] =>
    db().all<SnapshotInfo>('SELECT id, saved_at AS savedAt, label, bytes FROM snapshots ORDER BY saved_at DESC, id DESC');
  return {
    async list() {
      return list();
    },
    async take(label) {
      const { data, version } = current();
      const now = new Date();
      const id = `${stampOf(now)}~${label}`;
      await files.put(fileName(id), data.toString('base64'));
      db().run('INSERT OR REPLACE INTO snapshots(id, saved_at, label, bytes, version) VALUES (?, ?, ?, ?, ?)', id, nowIso(), label, data.length, version);
      for (const old of toPrune(list(), now)) {
        await files.remove(fileName(old));
        db().run('DELETE FROM snapshots WHERE id = ?', old);
      }
    },
    async fetch(id, path) {
      const known = db().get('SELECT 1 FROM snapshots WHERE id = ?', id);
      const data = known && ID.test(id) ? await files.get(fileName(id)) : null;
      if (!data) throw notFound('הגיבוי לא נמצא');
      writeFileSync(path, Buffer.from(data, 'base64'));
    },
    /** an automatic snapshot is due: the last one is half an hour old and something was saved since */
    autoDue(now, version) {
      const last = db().get<{ saved_at: string; version: number }>("SELECT saved_at, version FROM snapshots WHERE label = 'auto' ORDER BY saved_at DESC LIMIT 1");
      if (!last) return version > 1; // the first, once anything was saved after the course was created
      return now - Date.parse(last.saved_at) >= AUTO_EVERY_MS && version > last.version;
    },
  };
}

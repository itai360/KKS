// A track that lost its lead: who led it, as the automatic backups kept it (snapshots.ts) - looked for back
// from the most recent backup, one a day, until each is found - and when it was last there. The commander
// sees it on the tracks screen, with what the activity log says of the tracks, and puts the leads back.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { searchKey } from '../../shared/search';
import type { TrackLeadHistory } from '../../shared/types';
import { config } from './core';
import { currentSlot, Db, db } from './db';
import { fetchSnapshot, listSnapshots } from './snapshots';

/** at most this many backups are opened (one a day, the most recent first) */
const MAX_LOOKS = 12;
/** the most recent backups are each looked at - a lead gone today */
const RECENT = 4;

export async function trackLeadHistory(): Promise<TrackLeadHistory> {
  const d = db();
  const activity = d
    .all<{ at: string; text: string }>("SELECT created_at AS at, text FROM activity WHERE action IN ('track_updated', 'track_created', 'track_deleted', 'staff_change') ORDER BY id DESC LIMIT 15")
    .map((a) => ({ at: a.at, text: a.text }));
  // the backups are of the current course
  if (currentSlot()) return { missing: [], checked: 0, activity, beside: true };
  const missing = d.all<{ id: number; name: string }>('SELECT id, name FROM tracks WHERE lead_id IS NULL ORDER BY name');
  const out: TrackLeadHistory = { missing: missing.map((t) => ({ trackId: t.id, name: t.name, lead: null })), checked: 0, activity };
  if (!missing.length) return out;
  const active = new Map(d.all<{ id: number; display_name: string }>('SELECT id, display_name FROM users WHERE active = 1').map((u) => [u.id, u.display_name]));

  // the most recent backups (a lead gone today), then one a day - the latest of it - back from there
  const all = (await listSnapshots()).filter((s) => s.label !== 'archive').sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const days = new Set<string>();
  const looks = all
    .filter((s, i) => {
      const day = s.savedAt.slice(0, 10);
      const take = i < RECENT || !days.has(day);
      days.add(day);
      return take;
    })
    .slice(0, MAX_LOOKS);

  const dir = join(config.dataDir, 'lead-history');
  mkdirSync(dir, { recursive: true });
  let newer: string | null = null; // the backup checked before this one (more recent): the lead was gone by it
  for (const s of looks) {
    const open = out.missing.filter((m) => !m.lead);
    if (!open.length) break;
    const path = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    try {
      await fetchSnapshot(s.id, path);
      const snap = new Db(path, { wal: false });
      try {
        out.checked++;
        const hasTracks = snap.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks'");
        if (!hasTracks) continue;
        const rows = snap.all<{ id: number; name: string; lead_id: number | null; lead_name: string | null }>(
          'SELECT t.id, t.name, t.lead_id, u.display_name AS lead_name FROM tracks t LEFT JOIN users u ON u.id = t.lead_id',
        );
        for (const m of open) {
          // the same track: by its id, or (made again since) by its name
          const was = rows.find((r) => r.id === m.trackId && searchKey(r.name) === searchKey(m.name)) ?? rows.find((r) => searchKey(r.name) === searchKey(m.name));
          if (!was?.lead_id) continue;
          m.lead = { id: was.lead_id, name: active.get(was.lead_id) ?? was.lead_name ?? '', active: active.has(was.lead_id), at: s.savedAt, goneBy: newer };
        }
      } finally {
        snap.close();
      }
    } catch (e) {
      console.error('[tracks] could not read the backup', s.id, e);
    } finally {
      rmSync(path, { force: true });
      rmSync(`${path}-journal`, { force: true });
    }
    newer = s.savedAt;
  }
  return out;
}

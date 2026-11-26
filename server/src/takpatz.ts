// The takpatz (תקפ"צ) of each team (shared/takpatz.ts): a team commander keeps their own team's, the
// course commander sees and keeps every team's - and nobody else, in any read, change or export: each
// one is checked here against the team of the cadet it touches, whatever the screen shows. The cadets
// are the course's own (one list); what the takpatz adds to each is theirs by the cadet's id.

import { z } from 'zod';
import { isDateKey } from '../../shared/dates';
import {
  BOARD_LABELS,
  CATALOG_KINDS,
  CATEGORY_INFO,
  emptyStages,
  FIRST_WEEK,
  LAST_WEEK,
  overlapping,
  STAGE_KEYS,
  STAGE_STATUSES,
  STATUS_LABELS,
  TAKPATZ_BOARDS,
  TAKPATZ_CATEGORIES,
  TAKPATZ_WEEKS,
  takpatzMetrics,
  THIRD_LABELS,
  THIRDS,
  TRACK_STAGES,
  weekRange,
  type StageKey,
  type TakpatzBoard,
  type TakpatzCadet,
  type TakpatzCatalogItem,
  type TakpatzCategory,
  type TakpatzHistoryItem,
  type TakpatzOverview,
  type TakpatzPlacement,
  type TakpatzStages,
  type TakpatzTeamView,
  type TakpatzTrackRow,
  type Third,
} from '../../shared/takpatz';
import type { UserRow } from './auth';
import { badRequest, forbidden, getSettings, HttpError, notFound, nowIso } from './core';
import { db } from './db';
import { driveAvailable } from './googleDrive';
import { changed } from './journal';
import { isCommander } from './taskRepo';

// ---------------- who may ----------------

interface TeamRow {
  id: number;
  name: string;
  commander_id: number | null;
  commander_name: string | null;
}

const TEAM_BASE = 'SELECT t.id, t.name, t.commander_id, u.display_name AS commander_name FROM teams t LEFT JOIN users u ON u.id = t.commander_id';
export const NO_ACCESS = 'התקפ"צ של צוות פתוח למפקד הצוות ולמפקד הקורס בלבד';

/** the course commander every team's; a team commander their own team's - nobody else */
export const canKeepTeam = (actor: Pick<UserRow, 'id' | 'role'>, commanderId: number | null): boolean => isCommander(actor) || (commanderId !== null && commanderId === actor.id);

function teamRow(id: number): TeamRow {
  const t = db().get<TeamRow>(`${TEAM_BASE} WHERE t.id = ?`, id);
  if (!t) throw notFound('הצוות לא נמצא');
  return t;
}

/** the team, for someone who may keep its takpatz */
export function requireTeam(actor: UserRow, teamId: number): TeamRow {
  const t = teamRow(teamId);
  if (!canKeepTeam(actor, t.commander_id)) throw forbidden(NO_ACCESS);
  return t;
}

interface CadetRef {
  id: number;
  name: string;
  team_id: number | null;
  status: string;
  commander_id: number | null;
}

/** the cadet, for someone who may keep their team's takpatz (a cadet in no team is in none) */
function requireCadet(actor: UserRow, cadetId: number): CadetRef {
  const c = db().get<CadetRef>(
    `SELECT c.id, trim(c.first_name || ' ' || c.last_name) AS name, c.team_id, c.status, t.commander_id
       FROM cadets c LEFT JOIN teams t ON t.id = c.team_id WHERE c.id = ?`,
    cadetId,
  );
  if (!c) throw notFound('הצוער לא נמצא');
  if (c.team_id === null) throw isCommander(actor) ? badRequest('הצוער אינו משויך לצוות') : forbidden(NO_ACCESS);
  if (!canKeepTeam(actor, c.commander_id)) throw forbidden(NO_ACCESS);
  return c;
}

// ---------------- history ----------------

const HISTORY_KEEP = 300;

function log(actor: UserRow, teamId: number | null, cadetId: number | null, text: string): void {
  db().run('INSERT INTO takpatz_history(team_id, cadet_id, actor_id, text, at) VALUES (?, ?, ?, ?, ?)', teamId, cadetId, actor.id, text, nowIso());
  db().run(`DELETE FROM takpatz_history WHERE team_id = ? AND id NOT IN (SELECT id FROM takpatz_history WHERE team_id = ? ORDER BY id DESC LIMIT ${HISTORY_KEEP})`, teamId, teamId);
  changed('takpatz');
}

// ---------------- reading ----------------

interface ProfileRow {
  id: number;
  name: string;
  goal1: string | null;
  goal2: string | null;
  goal3: string | null;
  notes: string | null;
  ideas: string | null;
  third: Third | null;
  rank: number | null;
  third_updated_at: string | null;
  third_by: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
}

interface PlacementRow {
  id: number;
  cadet_id: number;
  board: TakpatzBoard;
  category: TakpatzCategory;
  catalog_id: number | null;
  label: string;
  week_from: number | null;
  week_to: number | null;
  span: number;
  notes: string;
  updated_at: string;
  updated_by_name: string | null;
}

interface TrackingRow {
  id: number;
  cadet_id: number;
  placement_id: number | null;
  label: string;
  week: number | null;
  stages: string;
  updated_at: string;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'he');

function teamCadets(teamId: number): TakpatzCadet[] {
  return db()
    .all<ProfileRow>(
      `SELECT c.id, trim(c.first_name || ' ' || c.last_name) AS name, p.goal1, p.goal2, p.goal3, p.notes, p.ideas, p.third, p.rank,
              p.third_updated_at, tu.display_name AS third_by, p.updated_at, uu.display_name AS updated_by_name
         FROM cadets c
         LEFT JOIN takpatz_profiles p ON p.cadet_id = c.id
         LEFT JOIN users tu ON tu.id = p.third_updated_by
         LEFT JOIN users uu ON uu.id = p.updated_by
        WHERE c.team_id = ? AND c.status = 'active'`,
      teamId,
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      goals: [r.goal1 ?? '', r.goal2 ?? '', r.goal3 ?? ''] as [string, string, string],
      notes: r.notes ?? '',
      ideas: r.ideas ?? '',
      third: r.third,
      rank: r.rank,
      thirdUpdatedAt: r.third_updated_at,
      thirdUpdatedByName: r.third_by,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
    }))
    .sort(byName);
}

const toPlacement = (r: PlacementRow): TakpatzPlacement => ({
  id: r.id,
  cadetId: r.cadet_id,
  board: r.board,
  category: r.category,
  catalogId: r.catalog_id,
  label: r.label,
  weekFrom: r.week_from,
  weekTo: r.week_to,
  span: r.span,
  notes: r.notes,
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name,
});

const PLACEMENT_BASE = `SELECT p.*, u.display_name AS updated_by_name FROM takpatz_placements p JOIN cadets c ON c.id = p.cadet_id LEFT JOIN users u ON u.id = p.updated_by`;

function teamPlacements(teamId: number): TakpatzPlacement[] {
  return db()
    .all<PlacementRow>(`${PLACEMENT_BASE} WHERE c.team_id = ? AND c.status = 'active' ORDER BY p.week_from IS NULL, p.week_from, p.id`, teamId)
    .map(toPlacement);
}

/** the stages as kept, each one whole whatever the stored text holds */
function readStages(raw: string | null): TakpatzStages {
  const out = emptyStages();
  let got: Record<string, Partial<{ status: string; date: string; note: string }>> = {};
  try {
    got = JSON.parse(raw || '{}') ?? {};
  } catch {
    /* an unreadable value reads as empty */
  }
  for (const k of STAGE_KEYS) {
    const s = got[k];
    if (!s || typeof s !== 'object') continue;
    out[k] = {
      status: (STAGE_STATUSES as readonly string[]).includes(String(s.status)) ? (s.status as TakpatzStages[StageKey]['status']) : null,
      date: isDateKey(s.date) ? s.date : null,
      note: typeof s.note === 'string' ? s.note : '',
    };
  }
  return out;
}

/** a row for each experience of the main plan, and each experience tracked on its own */
function teamTracking(teamId: number, cadets: TakpatzCadet[], placements: TakpatzPlacement[]): TakpatzTrackRow[] {
  const names = new Map(cadets.map((c) => [c.id, c.name]));
  const rows = db().all<TrackingRow>(
    `SELECT k.* FROM takpatz_tracking k JOIN cadets c ON c.id = k.cadet_id WHERE c.team_id = ? AND c.status = 'active'`,
    teamId,
  );
  const ofPlacement = new Map(rows.filter((r) => r.placement_id !== null).map((r) => [r.placement_id!, r]));
  const out: TakpatzTrackRow[] = [];
  for (const p of placements.filter((x) => x.board === 'main')) {
    const r = ofPlacement.get(p.id);
    out.push({
      key: `p${p.id}`,
      trackingId: r?.id ?? null,
      placementId: p.id,
      cadetId: p.cadetId,
      cadetName: names.get(p.cadetId) ?? '',
      label: p.label,
      category: p.category,
      weekFrom: p.weekFrom,
      weekTo: p.weekTo,
      stages: readStages(r?.stages ?? null),
      updatedAt: r?.updated_at ?? null,
    });
  }
  for (const r of rows.filter((x) => x.placement_id === null)) {
    out.push({
      key: `t${r.id}`,
      trackingId: r.id,
      placementId: null,
      cadetId: r.cadet_id,
      cadetName: names.get(r.cadet_id) ?? '',
      label: r.label,
      category: null,
      weekFrom: r.week,
      weekTo: r.week,
      stages: readStages(r.stages),
      updatedAt: r.updated_at,
    });
  }
  const weekOf = (x: TakpatzTrackRow) => (x.weekFrom === null ? 99 : x.weekFrom);
  return out.sort((a, b) => weekOf(a) - weekOf(b) || a.cadetName.localeCompare(b.cadetName, 'he') || a.label.localeCompare(b.label, 'he'));
}

function catalog(): TakpatzCatalogItem[] {
  return db().all<TakpatzCatalogItem>('SELECT id, half, kind, name, sort FROM takpatz_catalog ORDER BY half, sort, id');
}

function lastChange(teamId: number): string | null {
  return db().get<{ at: string }>('SELECT at FROM takpatz_history WHERE team_id = ? ORDER BY id DESC LIMIT 1', teamId)?.at ?? null;
}

/** the team's takpatz as the screens and the export read it */
export function teamView(actor: UserRow, teamId: number): TakpatzTeamView {
  const t = requireTeam(actor, teamId);
  const cadets = teamCadets(t.id);
  const placements = teamPlacements(t.id);
  const tracking = teamTracking(t.id, cadets, placements);
  const courseWeeks = new Map(
    db()
      .all<{ number: number; start_date: string; end_date: string }>('SELECT number, start_date, end_date FROM weeks ORDER BY start_date')
      .map((w) => [w.number, w]),
  );
  const history = db()
    .all<{ at: string; who: string | null; text: string }>(
      'SELECT h.at, u.display_name AS who, h.text FROM takpatz_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.team_id = ? ORDER BY h.id DESC LIMIT 40',
      t.id,
    )
    .map((h): TakpatzHistoryItem => ({ at: h.at, who: h.who, text: h.text }));
  return {
    team: { id: t.id, name: t.name, commanderId: t.commander_id, commanderName: t.commander_name },
    courseName: getSettings().courseName,
    weeks: TAKPATZ_WEEKS.map((w) => ({ n: w.n, title: w.title, startDate: courseWeeks.get(w.n)?.start_date ?? null, endDate: courseWeeks.get(w.n)?.end_date ?? null })),
    catalog: catalog(),
    cadets,
    placements,
    tracking,
    metrics: takpatzMetrics(cadets, placements, tracking),
    history,
    updatedAt: history[0]?.at ?? null,
    canManageCatalog: isCommander(actor),
    driveAvailable: driveAvailable(),
  };
}

/** the teams the actor keeps, each with its numbers - the commander's view of the whole company */
export function overview(actor: UserRow): TakpatzOverview {
  const teams = db()
    .all<TeamRow>(`${TEAM_BASE} ORDER BY t.sort, t.name`)
    .filter((t) => canKeepTeam(actor, t.commander_id));
  return {
    scope: isCommander(actor) ? 'all' : teams.length ? 'team' : 'none',
    teams: teams.map((t) => {
      const cadets = teamCadets(t.id);
      const placements = teamPlacements(t.id);
      return { id: t.id, name: t.name, commanderName: t.commander_name, metrics: takpatzMetrics(cadets, placements, teamTracking(t.id, cadets, placements)), updatedAt: lastChange(t.id) };
    }),
  };
}

// ---------------- a cadet's own: goals, notes, ideas, third and rank ----------------

const text = (max: number) => z.string().max(max, `עד ${max} תווים`).transform((s) => s.trim());

export const profileSchema = z
  .object({
    goals: z.tuple([text(300), text(300), text(300)]).optional(),
    notes: text(2000).optional(),
    ideas: text(2000).optional(),
    third: z.enum(THIRDS).nullable().optional(),
    rank: z.number().int().positive().max(999).nullable().optional(),
    /** a rank another cadet of the team holds: given anyway, once asked */
    allowDuplicateRank: z.boolean().optional(),
  })
  .strict();

export function saveProfile(actor: UserRow, cadetId: number, raw: unknown): TakpatzCadet {
  const p = profileSchema.parse(raw);
  const c = requireCadet(actor, cadetId);
  const cur = teamCadets(c.team_id!).find((x) => x.id === c.id);
  if (!cur) throw notFound('הצוער לא נמצא בצוות');
  const next = {
    goals: p.goals ?? cur.goals,
    notes: p.notes ?? cur.notes,
    ideas: p.ideas ?? cur.ideas,
    third: p.third !== undefined ? p.third : cur.third,
    rank: p.rank !== undefined ? p.rank : cur.rank,
  };
  if (p.rank && p.rank !== cur.rank && !p.allowDuplicateRank) {
    const same = teamCadets(c.team_id!).find((x) => x.id !== c.id && x.rank === p.rank);
    if (same) throw new HttpError(409, `הדירוג ${p.rank} כבר ניתן ל${same.name}`);
  }
  const thirdChanged = next.third !== cur.third || next.rank !== cur.rank;
  const now = nowIso();
  db().run(
    `INSERT INTO takpatz_profiles(cadet_id, goal1, goal2, goal3, notes, ideas, third, rank, third_updated_at, third_updated_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cadet_id) DO UPDATE SET goal1 = excluded.goal1, goal2 = excluded.goal2, goal3 = excluded.goal3, notes = excluded.notes, ideas = excluded.ideas,
       third = excluded.third, rank = excluded.rank,
       third_updated_at = CASE WHEN ? THEN excluded.third_updated_at ELSE takpatz_profiles.third_updated_at END,
       third_updated_by = CASE WHEN ? THEN excluded.third_updated_by ELSE takpatz_profiles.third_updated_by END,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    c.id,
    next.goals[0],
    next.goals[1],
    next.goals[2],
    next.notes,
    next.ideas,
    next.third,
    next.rank,
    thirdChanged ? now : null,
    thirdChanged ? actor.id : null,
    now,
    actor.id,
    thirdChanged ? 1 : 0,
    thirdChanged ? 1 : 0,
  );
  const what: string[] = [];
  if (p.goals && p.goals.join('|') !== cur.goals.join('|')) what.push('יעדים אישיים');
  if (p.notes !== undefined && p.notes !== cur.notes) what.push('הערות');
  if (p.ideas !== undefined && p.ideas !== cur.ideas) what.push('רעיונות ומחשבות');
  if (next.third !== cur.third) what.push(next.third ? `שליש ${THIRD_LABELS[next.third]}` : 'הסרת השליש');
  if (next.rank !== cur.rank) what.push(next.rank ? `דירוג ${next.rank}` : 'הסרת הדירוג');
  if (what.length) log(actor, c.team_id, c.id, `${c.name}: ${what.join(', ')}`);
  return teamCadets(c.team_id!).find((x) => x.id === c.id)!;
}

// ---------------- the experiences in the plans ----------------

const week = z.number().int().min(FIRST_WEEK).max(LAST_WEEK).nullable();

const placementFields = {
  board: z.enum(TAKPATZ_BOARDS),
  category: z.enum(TAKPATZ_CATEGORIES),
  catalogId: z.number().int().positive().nullable().optional(),
  label: z.string().trim().min(1, 'חובה לציין את ההתנסות').max(80, 'שם ההתנסות ארוך מדי'),
  weekFrom: week,
  weekTo: week,
  span: z.number().int().min(1).max(TAKPATZ_WEEKS.length).optional(),
  notes: text(1000).optional(),
};
export const placementSchema = z.object({ cadetId: z.number().int().positive(), ...placementFields }).strict();
const placementPatch = z.object(placementFields).partial().strict();

interface PlacementInput {
  cadetId: number;
  board: TakpatzBoard;
  category: TakpatzCategory;
  catalogId: number | null;
  label: string;
  weekFrom: number | null;
  weekTo: number | null;
  span: number;
  notes: string;
}

/** a whole placement: both weeks or neither, its catalog entry of its kind, no week shared with another */
function checkPlacement(p: PlacementInput, id?: number): PlacementInput {
  if ((p.weekFrom === null) !== (p.weekTo === null)) throw badRequest('בחרו שבוע התחלה ושבוע סיום - או השאירו את שניהם ריקים להתנסות שעוד לא שובצה');
  if (p.weekFrom !== null && p.weekTo !== null && p.weekTo < p.weekFrom) throw badRequest('שבוע הסיום לפני שבוע ההתחלה');
  if (p.catalogId) {
    const item = db().get<{ kind: string }>('SELECT kind FROM takpatz_catalog WHERE id = ?', p.catalogId);
    if (!item) throw badRequest('ההתנסות לא נמצאה במאגר');
    if (item.kind !== p.category) throw badRequest(`ההתנסות מהמאגר היא מסוג אחר מ"${CATEGORY_INFO[p.category].label}"`);
  }
  const span = p.weekFrom !== null ? p.weekTo! - p.weekFrom + 1 : p.span;
  const others = db().all<PlacementRow>(`${PLACEMENT_BASE} WHERE p.cadet_id = ? AND p.board = ?`, p.cadetId, p.board).map(toPlacement);
  const clash = overlapping(others, { ...p, id });
  if (clash)
    throw new HttpError(
      409,
      `בשבוע הזה כבר משובץ "${clash.label}" (${weekRange(clash.weekFrom, clash.weekTo)}). אפשר לקצר אחד מהם, להעביר לשבוע אחר או לשמור את ההתנסות "מחוץ לשבועות" עד שתוחלט.`,
    );
  return { ...p, span };
}

function placementRow(id: number): PlacementRow {
  const r = db().get<PlacementRow>(`${PLACEMENT_BASE} WHERE p.id = ?`, id);
  if (!r) throw notFound('השיבוץ לא נמצא');
  return r;
}

const describe = (p: Pick<PlacementInput, 'label' | 'weekFrom' | 'weekTo' | 'board'>) => `"${p.label}" ${weekRange(p.weekFrom, p.weekTo)} (${BOARD_LABELS[p.board]})`;

function insertPlacement(actor: UserRow, p: PlacementInput): number {
  const now = nowIso();
  return db().run(
    `INSERT INTO takpatz_placements(cadet_id, board, category, catalog_id, label, week_from, week_to, span, notes, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.cadetId,
    p.board,
    p.category,
    p.catalogId,
    p.label,
    p.weekFrom,
    p.weekTo,
    p.span,
    p.notes,
    actor.id,
    now,
    actor.id,
    now,
  ).id;
}

export function createPlacement(actor: UserRow, raw: unknown): TakpatzPlacement {
  const x = placementSchema.parse(raw);
  const c = requireCadet(actor, x.cadetId);
  const p = checkPlacement({ cadetId: c.id, board: x.board, category: x.category, catalogId: x.catalogId ?? null, label: x.label, weekFrom: x.weekFrom, weekTo: x.weekTo, span: x.span ?? 1, notes: x.notes ?? '' });
  const id = db().tx(() => {
    const newId = insertPlacement(actor, p);
    log(actor, c.team_id, c.id, `${c.name}: נוסף ${describe(p)}`);
    return newId;
  });
  return toPlacement(placementRow(id));
}

/** an experience left out of the main plan takes its tracking with it only when nothing was tracked */
function letGoOfTracking(placementId: number): void {
  const r = db().get<TrackingRow>('SELECT * FROM takpatz_tracking WHERE placement_id = ?', placementId);
  if (!r) return;
  const kept = Object.values(readStages(r.stages)).some((s) => s.status || s.date || s.note);
  if (kept) db().run('UPDATE takpatz_tracking SET placement_id = NULL WHERE id = ?', r.id);
  else db().run('DELETE FROM takpatz_tracking WHERE id = ?', r.id);
}

export function updatePlacement(actor: UserRow, id: number, raw: unknown): TakpatzPlacement {
  const patch = placementPatch.parse(raw);
  const cur = placementRow(id);
  const c = requireCadet(actor, cur.cadet_id);
  const merged: PlacementInput = {
    cadetId: c.id,
    board: patch.board ?? cur.board,
    category: patch.category ?? cur.category,
    catalogId: patch.catalogId !== undefined ? patch.catalogId : patch.category && patch.category !== cur.category ? null : cur.catalog_id,
    label: patch.label ?? cur.label,
    weekFrom: patch.weekFrom !== undefined ? patch.weekFrom : cur.week_from,
    weekTo: patch.weekTo !== undefined ? patch.weekTo : cur.week_to,
    span: patch.span ?? cur.span,
    notes: patch.notes ?? cur.notes,
  };
  const p = checkPlacement(merged, id);
  db().tx(() => {
    db().run(
      'UPDATE takpatz_placements SET board = ?, category = ?, catalog_id = ?, label = ?, week_from = ?, week_to = ?, span = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      p.board,
      p.category,
      p.catalogId,
      p.label,
      p.weekFrom,
      p.weekTo,
      p.span,
      p.notes,
      actor.id,
      nowIso(),
      id,
    );
    if (p.board !== 'main') letGoOfTracking(id);
    else db().run('UPDATE takpatz_tracking SET label = ?, week = ? WHERE placement_id = ?', p.label, p.weekFrom, id);
    const was = { label: cur.label, weekFrom: cur.week_from, weekTo: cur.week_to, board: cur.board };
    log(actor, c.team_id, c.id, describe(was) === describe(p) ? `${c.name}: עודכן ${describe(p)}` : `${c.name}: ${describe(was)} עכשיו ${describe(p)}`);
  });
  return toPlacement(placementRow(id));
}

export function deletePlacement(actor: UserRow, id: number): void {
  const cur = placementRow(id);
  const c = requireCadet(actor, cur.cadet_id);
  db().tx(() => {
    letGoOfTracking(id);
    db().run('DELETE FROM takpatz_placements WHERE id = ?', id);
    log(actor, c.team_id, c.id, `${c.name}: הוסר ${describe({ label: cur.label, weekFrom: cur.week_from, weekTo: cur.week_to, board: cur.board })}`);
  });
}

/** the same experience into the other plan */
export function copyPlacement(actor: UserRow, id: number, to: TakpatzBoard): TakpatzPlacement {
  const cur = placementRow(id);
  const c = requireCadet(actor, cur.cadet_id);
  if (cur.board === to) throw badRequest('ההתנסות כבר בתכנון הזה');
  const p = checkPlacement({ cadetId: c.id, board: to, category: cur.category, catalogId: cur.catalog_id, label: cur.label, weekFrom: cur.week_from, weekTo: cur.week_to, span: cur.span, notes: cur.notes });
  const newId = db().tx(() => {
    const n = insertPlacement(actor, p);
    log(actor, c.team_id, c.id, `${c.name}: הועתק ${describe(p)}`);
    return n;
  });
  return toPlacement(placementRow(newId));
}

/** one plan of the team becomes a copy of the other - the experiences in it before are removed */
export function copyBoard(actor: UserRow, teamId: number, from: TakpatzBoard, to: TakpatzBoard): number {
  const t = requireTeam(actor, teamId);
  if (from === to) throw badRequest('בחרו תכנון אחר להעתקה');
  return db().tx(() => {
    const cadetIds = teamCadets(t.id).map((c) => c.id);
    const source = teamPlacements(t.id).filter((p) => p.board === from);
    for (const old of teamPlacements(t.id).filter((p) => p.board === to)) {
      if (to === 'main') letGoOfTracking(old.id);
      db().run('DELETE FROM takpatz_placements WHERE id = ?', old.id);
    }
    for (const p of source.filter((x) => cadetIds.includes(x.cadetId))) insertPlacement(actor, { ...p, board: to });
    log(actor, t.id, null, `${BOARD_LABELS[to]} הוחלף בהעתק של ${BOARD_LABELS[from]} (${source.length} התנסויות)`);
    return source.length;
  });
}

// ---------------- the tracking ----------------

const stageSchema = z
  .object({
    placementId: z.number().int().positive().optional(),
    trackingId: z.number().int().positive().optional(),
    stage: z.enum(STAGE_KEYS as [StageKey, ...StageKey[]]),
    status: z.enum(STAGE_STATUSES).nullable().optional(),
    date: z.string().refine(isDateKey, 'תאריך לא תקין').nullable().optional(),
    note: text(500).optional(),
  })
  .strict()
  .refine((x) => !!x.placementId !== !!x.trackingId, 'בחרו התנסות אחת');

function trackingRow(id: number): TrackingRow {
  const r = db().get<TrackingRow>('SELECT * FROM takpatz_tracking WHERE id = ?', id);
  if (!r) throw notFound('השורה לא נמצאה');
  return r;
}

/** one stage of an experience's tracking: its status, its date and a word on it */
export function setStage(actor: UserRow, raw: unknown): TakpatzTrackRow {
  const x = stageSchema.parse(raw);
  let row: TrackingRow;
  let c: CadetRef;
  if (x.placementId) {
    const p = placementRow(x.placementId);
    c = requireCadet(actor, p.cadet_id);
    if (p.board !== 'main') throw badRequest('המעקב הוא על התנסויות התכנון הראשי');
    const found = db().get<TrackingRow>('SELECT * FROM takpatz_tracking WHERE placement_id = ?', p.id);
    if (found) row = found;
    else {
      const now = nowIso();
      const newId = db().run(
        'INSERT INTO takpatz_tracking(cadet_id, placement_id, label, week, stages, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        p.cadet_id,
        p.id,
        p.label,
        p.week_from,
        '{}',
        actor.id,
        now,
        actor.id,
        now,
      ).id;
      row = trackingRow(newId);
    }
  } else {
    row = trackingRow(x.trackingId!);
    c = requireCadet(actor, row.cadet_id);
  }
  const stages = readStages(row.stages);
  const before = stages[x.stage];
  stages[x.stage] = {
    status: x.status !== undefined ? x.status : before.status,
    date: x.date !== undefined ? x.date : before.date,
    note: x.note ?? before.note,
  };
  db().tx(() => {
    db().run('UPDATE takpatz_tracking SET stages = ?, updated_by = ?, updated_at = ? WHERE id = ?', JSON.stringify(stages), actor.id, nowIso(), row.id);
    const stageLabel = TRACK_STAGES.find((s) => s.key === x.stage)!.label;
    const now = stages[x.stage];
    if (now.status !== before.status) log(actor, c.team_id, c.id, `${c.name} - ${row.label}: ${stageLabel} ${now.status ? STATUS_LABELS[now.status] : 'ללא סטטוס'}`);
    else if (now.date !== before.date || now.note !== before.note) log(actor, c.team_id, c.id, `${c.name} - ${row.label}: עודכן ${stageLabel}`);
  });
  const t = teamView(actor, c.team_id!);
  return t.tracking.find((r) => r.trackingId === row.id)!;
}

export const trackingSchema = z
  .object({
    cadetId: z.number().int().positive(),
    label: z.string().trim().min(1, 'חובה לציין את ההתנסות').max(80),
    week: week.optional(),
  })
  .strict();

/** an experience tracked on its own, outside the plan (a company role given on the way, say) */
export function createTracking(actor: UserRow, raw: unknown): number {
  const x = trackingSchema.parse(raw);
  const c = requireCadet(actor, x.cadetId);
  const now = nowIso();
  return db().tx(() => {
    const newId = db().run(
      'INSERT INTO takpatz_tracking(cadet_id, label, week, stages, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      c.id,
      x.label,
      x.week ?? null,
      '{}',
      actor.id,
      now,
      actor.id,
      now,
    ).id;
    log(actor, c.team_id, c.id, `${c.name}: נוספה למעקב "${x.label}"`);
    return newId;
  });
}

export function updateTracking(actor: UserRow, id: number, raw: unknown): void {
  const x = z.object({ label: z.string().trim().min(1).max(80).optional(), week: week.optional() }).strict().parse(raw);
  const r = trackingRow(id);
  const c = requireCadet(actor, r.cadet_id);
  if (r.placement_id !== null) throw badRequest('השם והשבוע של התנסות מהתכנון נקבעים בתכנון');
  db().tx(() => {
    db().run('UPDATE takpatz_tracking SET label = ?, week = ?, updated_by = ?, updated_at = ? WHERE id = ?', x.label ?? r.label, x.week !== undefined ? x.week : r.week, actor.id, nowIso(), id);
    log(actor, c.team_id, c.id, `${c.name}: עודכנה במעקב "${x.label ?? r.label}"`);
  });
}

/** a row tracked on its own goes; an experience of the plan only has its tracking cleared */
export function deleteTracking(actor: UserRow, id: number): void {
  const r = trackingRow(id);
  const c = requireCadet(actor, r.cadet_id);
  db().tx(() => {
    db().run('DELETE FROM takpatz_tracking WHERE id = ?', id);
    log(actor, c.team_id, c.id, r.placement_id === null ? `${c.name}: הוסרה מהמעקב "${r.label}"` : `${c.name}: נוקה המעקב של "${r.label}"`);
  });
}

// ---------------- the catalog (the course commander's) ----------------

const catalogSchema = z
  .object({
    half: z.union([z.literal(1), z.literal(2)]),
    kind: z.enum(CATALOG_KINDS),
    name: z.string().trim().min(1, 'חובה לתת שם').max(60),
  })
  .strict();

function requireCatalogKeeper(actor: UserRow): void {
  if (!isCommander(actor)) throw forbidden('את מאגר ההתנסויות מתחזק מפקד הקורס');
}

export function addCatalogItem(actor: UserRow, raw: unknown): TakpatzCatalogItem[] {
  requireCatalogKeeper(actor);
  const x = catalogSchema.parse(raw);
  const sort = (db().get<{ s: number | null }>('SELECT max(sort) AS s FROM takpatz_catalog')?.s ?? 0) + 1;
  db().run('INSERT INTO takpatz_catalog(half, kind, name, sort, created_at) VALUES (?, ?, ?, ?, ?)', x.half, x.kind, x.name, sort, nowIso());
  changed('takpatz');
  return catalog();
}

export function updateCatalogItem(actor: UserRow, id: number, raw: unknown): TakpatzCatalogItem[] {
  requireCatalogKeeper(actor);
  const x = z.object({ name: z.string().trim().min(1).max(60).optional(), sort: z.number().int().optional() }).strict().parse(raw);
  const cur = db().get<TakpatzCatalogItem>('SELECT * FROM takpatz_catalog WHERE id = ?', id);
  if (!cur) throw notFound('ההתנסות לא נמצאה במאגר');
  db().run('UPDATE takpatz_catalog SET name = ?, sort = ? WHERE id = ?', x.name ?? cur.name, x.sort ?? cur.sort, id);
  changed('takpatz');
  return catalog();
}

/** out of the catalog; the experiences planned from it stay, by their own name */
export function deleteCatalogItem(actor: UserRow, id: number): TakpatzCatalogItem[] {
  requireCatalogKeeper(actor);
  db().run('DELETE FROM takpatz_catalog WHERE id = ?', id);
  changed('takpatz');
  return catalog();
}

// The sociometric (סוציומטרי): each team's sheet - a row per cadet with an average, a percentile, a
// rank in the team and the criteria - goes into a round (סוציומטרי אמצע, סוציומטרי סוף...). A team's
// sheet names its cadets by first name (and an initial when two share one), so they are found within
// the team; the team is told by the sheet's title ("צוות 2") or by which team's names it holds. Where
// each cadet stands in the company and what stands out is worked out in shared/sociometric.ts. The
// course commander imports; a team commander sees the cadets of the team.

import { z } from 'zod';
import { computeRound, scaleOf, type SocioCadetRound, type SocioEntry, type SocioImportResult, type SocioPreview, type SocioRound, type SocioRoundView, type SocioSheetRow } from '../../shared/sociometric';
import { searchKey } from '../../shared/search';
import type { UserRow } from './auth';
import { badRequest, forbidden, notFound, nowIso } from './core';
import { db } from './db';
import { changed, logActivity } from './journal';
import { readSpreadsheet } from './sheets';
import { isCommander } from './taskRepo';

const requireCommanderActor = (actor: UserRow) => {
  if (!isCommander(actor)) throw forbidden('ייבוא סוציומטרי הוא של מפקד הקורס');
};

// ---------------- reading a sheet ----------------

type Kind = 'name' | 'pn' | 'avg' | 'pct' | 'rank' | 'skip';
const HEADERS: [string[], Kind][] = [
  [['שם הצוער', 'שם', 'שם מלא', 'שם צוער', 'צוער', 'שם ושם משפחה'], 'name'],
  [['מספר אישי', 'מ.א', 'מ"א', 'מא'], 'pn'],
  [['ממוצע', 'ממוצע כללי', 'ציון ממוצע', 'ממוצע סופי'], 'avg'],
  [['אחוזון', 'אחוזון כללי'], 'pct'],
  [['דירוג כללי', 'דירוג', 'מיקום', 'מיקום בצוות', 'דירוג בצוות', 'דירוג סופי'], 'rank'],
  [['צוות', 'מספר', '#', 'מס', "מס'", 'הערות'], 'skip'],
];
const kindOf = (header: string): Kind | null => {
  const k = searchKey(header);
  if (!k) return null;
  if (/^עמודה \d+$/.test(k)) return 'skip';
  return HEADERS.find(([names]) => names.some((n) => searchKey(n) === k))?.[1] ?? null;
};
/** a row that sums the team up, not a cadet */
const SUMMARY = /^(ממוצע|ממוצע צוות|סה"?כ|סך הכל|ממוצע כללי)$/;

const num = (raw: string | undefined): number | null => {
  const t = (raw ?? '').trim().replace(',', '.').replace('%', '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
};

interface Header {
  row: number;
  name: number;
  pn: number;
  avg: number;
  pct: number;
  rank: number;
  criteria: { index: number; name: string }[];
}

/** the header row: one of the first rows, with the cadet's name and a rank, an average or criteria */
function headerOf(rows: string[][]): Header | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const kinds = rows[r].map(kindOf);
    const at = (k: Kind) => kinds.indexOf(k);
    if (at('name') < 0) continue;
    const criteria = rows[r].map((h, index) => ({ index, name: h.replace(/\s+/g, ' ').trim() })).filter((c, i) => c.name && kinds[i] === null);
    if (at('rank') < 0 && at('avg') < 0 && criteria.length < 2) continue;
    return { row: r, name: at('name'), pn: at('pn'), avg: at('avg'), pct: at('pct'), rank: at('rank'), criteria };
  }
  return null;
}

/** the cadets' rows: a name and at least one number; the team's average row and a bare list of names are left out */
function parse(table: string[][]): { header: Header; rows: SocioSheetRow[] } {
  const header = headerOf(table);
  if (!header) throw badRequest('לא נמצאה שורת כותרות עם "שם הצוער" ודירוג, ממוצע או תבחינים');
  const rows: SocioSheetRow[] = [];
  for (let r = header.row + 1; r < table.length; r++) {
    const cells = table[r];
    const at = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    const name = at(header.name).replace(/\s+/g, ' ');
    if (!name || SUMMARY.test(searchKey(name))) continue;
    const scores: Record<string, number> = {};
    for (const c of header.criteria) {
      const v = num(cells[c.index]);
      if (v !== null && v >= 0 && v <= 100) scores[c.name] = v;
    }
    const rank = num(at(header.rank));
    const average = num(at(header.avg));
    let percentile = num(at(header.pct));
    if (percentile !== null && percentile > 0 && percentile <= 1) percentile = Math.round(percentile * 100);
    if (rank === null && average === null && percentile === null && !Object.keys(scores).length) continue;
    rows.push({
      line: r + 1,
      name,
      personalNumber: at(header.pn).replace(/\.0+$/, '').replace(/\D/g, ''),
      rank: rank !== null && rank >= 1 ? Math.round(rank) : null,
      average,
      percentile,
      scores,
    });
  }
  if (!rows.length) throw badRequest('לא נמצאו צוערים עם נתונים מתחת לשורת הכותרות');
  return { header, rows };
}

/** The sheets of a file, empty rows left out; one with a sociometric header first. */
export function readSocioSheets(actor: UserRow, buf: Buffer): { name: string; rows: string[][] }[] {
  requireCommanderActor(actor);
  const sheets = readSpreadsheet(buf)
    .map((s) => ({ name: s.name, rows: s.rows.filter((r) => r.some((c) => c.trim() !== '')).slice(0, 2000) }))
    .filter((s) => s.rows.length > 0);
  if (!sheets.length) throw badRequest('הקובץ ריק');
  return sheets.sort((a, b) => Number(!!headerOf(b.rows)) - Number(!!headerOf(a.rows)));
}

// ---------------- finding the cadets ----------------

interface CadetLite {
  id: number;
  first_name: string;
  last_name: string;
  personal_number: string;
  team_id: number | null;
  team_name: string | null;
}
const cadets = () =>
  db().all<CadetLite>(
    "SELECT c.id, c.first_name, c.last_name, c.personal_number, c.team_id, t.name AS team_name FROM cadets c LEFT JOIN teams t ON t.id = c.team_id WHERE c.status <> 'dropped'",
  );
const fullName = (c: Pick<CadetLite, 'first_name' | 'last_name'>) => `${c.first_name} ${c.last_name}`.trim();

/** a name as a team writes it - "רועי", "עמית י", or the full name - among the cadets given */
function find(row: Pick<SocioSheetRow, 'name' | 'personalNumber'>, pool: CadetLite[]): { cadet: CadetLite | null; ambiguous: boolean } {
  if (row.personalNumber) {
    const c = pool.find((x) => x.personal_number.replace(/\D/g, '') === row.personalNumber);
    if (c) return { cadet: c, ambiguous: false };
  }
  const k = searchKey(row.name);
  const exact = pool.filter((c) => searchKey(fullName(c)) === k || searchKey(`${c.last_name} ${c.first_name}`) === k);
  if (exact.length === 1) return { cadet: exact[0], ambiguous: false };
  const [first, ...rest] = row.name.split(' ');
  const initial = searchKey(rest.join(' ').replace(/[.'׳"]/g, ''));
  let found = pool.filter((c) => {
    const f = searchKey(c.first_name);
    return f === searchKey(first) || f.split(' ')[0] === searchKey(first);
  });
  if (initial) found = found.filter((c) => searchKey(c.last_name).startsWith(initial));
  return { cadet: found.length === 1 ? found[0] : null, ambiguous: found.length > 1 };
}

const teams = () => db().all<{ id: number; name: string }>('SELECT id, name FROM teams ORDER BY sort, id');

/** the team a sheet is of: named in its title ("צוות 2"), or the team most of its names belong to */
function guessTeam(source: string, rows: SocioSheetRow[], all: CadetLite[]): { teamId: number | null; by: 'title' | 'names' | null } {
  const list = teams();
  const token = /צוות\s*([0-9]+|[א-ת]+)/.exec(source)?.[1];
  if (token) {
    const t = list.find((x) => new RegExp(`(^|[^0-9א-ת])${token}($|[^0-9א-ת])`).test(x.name));
    if (t) return { teamId: t.id, by: 'title' };
  }
  let best: { id: number; n: number } | null = null;
  let tie = false;
  for (const t of list) {
    const pool = all.filter((c) => c.team_id === t.id);
    const n = rows.filter((r) => find(r, pool).cadet).length;
    if (!best || n > best.n) {
      best = { id: t.id, n };
      tie = false;
    } else if (n === best.n) tie = true;
  }
  return best && best.n > 0 && !tie ? { teamId: best.id, by: 'names' } : { teamId: null, by: null };
}

// ---------------- what goes where ----------------

const previewSchema = z.object({
  rows: z.array(z.array(z.string().max(300))).min(2, 'הגליון ריק').max(2000, 'הגליון גדול מדי'),
  /** the file's or the sheet's name - it may say the team */
  source: z.string().max(200).optional().default(''),
  /** the team chosen; not given - as the sheet tells */
  teamId: z.number().int().positive().nullable().optional(),
  /** sheet line -> cadet (0: not imported), for names that were not found */
  mapping: z.record(z.string(), z.number().int().min(0)).optional().default({}),
});

function plan(raw: unknown): SocioPreview {
  const input = previewSchema.parse(raw);
  const { header, rows } = parse(input.rows);
  const all = cadets();
  const guess = input.teamId !== undefined ? { teamId: input.teamId, by: input.teamId ? ('chosen' as const) : null } : guessTeam(input.source, rows, all);
  if (guess.teamId && !teams().some((t) => t.id === guess.teamId)) throw badRequest('הצוות לא נמצא');
  const pool = guess.teamId ? all.filter((c) => c.team_id === guess.teamId) : all;
  const byId = new Map(all.map((c) => [c.id, c]));
  const out = rows.map((r) => {
    const chosen = input.mapping[String(r.line)];
    if (chosen !== undefined) {
      const c = chosen ? byId.get(chosen) : undefined;
      if (chosen && !c) throw badRequest('הצוער שנבחר לא נמצא');
      return { ...r, cadetId: c?.id ?? null, cadetName: c ? fullName(c) : null, matchedBy: c ? ('chosen' as const) : null, ambiguous: false };
    }
    const m = find(r, pool);
    return { ...r, cadetId: m.cadet?.id ?? null, cadetName: m.cadet ? fullName(m.cadet) : null, matchedBy: m.cadet ? ('sheet' as const) : null, ambiguous: m.ambiguous };
  });
  const twice = out.filter((r) => r.cadetId).find((r, i, list) => list.findIndex((x) => x.cadetId === r.cadetId) !== i);
  if (twice) throw badRequest(`${twice.cadetName} מופיע פעמיים בגליון - בחרו לאיזו שורה הוא שייך`);
  return {
    headerRow: header.row + 1,
    criteria: header.criteria.map((c) => c.name),
    teamId: guess.teamId ?? null,
    teamBy: guess.by,
    teams: teams(),
    rows: out,
    candidates: pool.map((c) => ({ id: c.id, name: fullName(c), teamName: c.team_name })).sort((a, b) => a.name.localeCompare(b.name, 'he')),
  };
}

/** What a team's sheet would put where - nothing is written. */
export function previewSocio(actor: UserRow, raw: unknown): SocioPreview {
  requireCommanderActor(actor);
  return plan(raw);
}

const importSchema = z.object({
  /** an existing round, or a new one */
  roundId: z.number().int().positive().optional(),
  newRound: z.object({ name: z.string().trim().min(1, 'חובה לתת שם לסבב').max(80), heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).optional(),
});

/** Writes a team's sheet into a round: each cadet found gets their place, average and criteria (replacing what was there). */
export function importSocio(actor: UserRow, raw: unknown): SocioImportResult {
  requireCommanderActor(actor);
  const p = plan(raw);
  const target = importSchema.parse(raw);
  const matched = p.rows.filter((r) => r.cadetId);
  if (!matched.length) throw badRequest('לא זוהו צוערים בגליון - בחרו צוות או שייכו את השמות');
  let roundId = 0;
  db().tx(() => {
    if (target.roundId) {
      if (!db().get('SELECT 1 FROM socio_rounds WHERE id = ?', target.roundId)) throw badRequest('הסבב לא נמצא');
      roundId = target.roundId;
    } else if (target.newRound) {
      const same = db().get<{ id: number }>('SELECT id FROM socio_rounds WHERE name = ?', target.newRound.name);
      roundId = same?.id ?? db().run('INSERT INTO socio_rounds(name, held_on, created_by, created_at) VALUES (?, ?, ?, ?)', target.newRound.name, target.newRound.heldOn ?? null, actor.id, nowIso()).id;
    } else throw badRequest('בחרו סבב או פתחו סבב חדש');
    // the round's criteria: those it had, then the new ones, in the sheet's order
    const had = JSON.parse(db().get<{ criteria: string }>('SELECT criteria FROM socio_rounds WHERE id = ?', roundId)!.criteria) as string[];
    const criteria = [...had, ...p.criteria.filter((c) => !had.includes(c))];
    db().run('UPDATE socio_rounds SET criteria = ? WHERE id = ?', JSON.stringify(criteria), roundId);
    const size = p.rows.filter((r) => r.rank !== null).length || p.rows.length;
    const at = nowIso();
    for (const r of matched) {
      db().run(
        `INSERT INTO socio_entries(round_id, cadet_id, team_rank, team_size, average, percentile, scores, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(round_id, cadet_id) DO UPDATE SET team_rank = excluded.team_rank, team_size = excluded.team_size, average = excluded.average,
           percentile = excluded.percentile, scores = excluded.scores, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        roundId,
        r.cadetId,
        r.rank,
        size,
        r.average,
        r.percentile,
        JSON.stringify(r.scores),
        actor.id,
        at,
      );
    }
  });
  const teamName = p.teams.find((t) => t.id === p.teamId)?.name ?? null;
  const roundName = db().get<{ name: string }>('SELECT name FROM socio_rounds WHERE id = ?', roundId)!.name;
  logActivity({ userId: actor.id, action: 'socio_import', text: `${actor.display_name} ייבא סוציומטרי${teamName ? ` של ${teamName}` : ''} ל"${roundName}": ${matched.length} צוערים` });
  changed('cadets');
  return { roundId, set: matched.length, unmatched: p.rows.length - matched.length, teamName };
}

// ---------------- the results ----------------

interface RoundRow {
  id: number;
  name: string;
  held_on: string | null;
  criteria: string;
  created_at: string;
  cadets: number;
  teams: number;
}
const ROUND_BASE = `
SELECT r.*, (SELECT count(*) FROM socio_entries e WHERE e.round_id = r.id) AS cadets,
  (SELECT count(DISTINCT c.team_id) FROM socio_entries e JOIN cadets c ON c.id = e.cadet_id WHERE e.round_id = r.id) AS teams
FROM socio_rounds r`;
const toRound = (r: RoundRow): SocioRound => ({ id: r.id, name: r.name, heldOn: r.held_on, criteria: JSON.parse(r.criteria) as string[], cadets: r.cadets, teams: r.teams, createdAt: r.created_at });

/** the rounds, earliest first */
function rounds(): SocioRound[] {
  return db().all<RoundRow>(`${ROUND_BASE} ORDER BY coalesce(r.held_on, substr(r.created_at, 1, 10)), r.id`).map(toRound);
}

function entriesOf(roundId: number): SocioEntry[] {
  return db()
    .all<{ cadet_id: number; first_name: string; last_name: string; team_id: number | null; team_name: string | null; team_rank: number | null; team_size: number | null; average: number | null; percentile: number | null; scores: string }>(
      `SELECT e.*, c.first_name, c.last_name, c.team_id, t.name AS team_name FROM socio_entries e
       JOIN cadets c ON c.id = e.cadet_id LEFT JOIN teams t ON t.id = c.team_id WHERE e.round_id = ?`,
      roundId,
    )
    .map((r) => ({
      cadetId: r.cadet_id,
      cadetName: fullName(r),
      teamId: r.team_id,
      teamName: r.team_name,
      teamRank: r.team_rank,
      teamSize: r.team_size,
      average: r.average,
      percentile: r.percentile,
      scores: JSON.parse(r.scores) as Record<string, number>,
    }));
}

/** a round worked out against the round before it */
function computed(list: SocioRound[], index: number): { round: SocioRound; scale: number } & ReturnType<typeof computeRound> {
  const round = list[index];
  const before = index > 0 ? list[index - 1] : null;
  const previous = before ? { name: before.name, rows: computeRound(entriesOf(before.id), before.criteria).rows } : undefined;
  const entries = entriesOf(round.id);
  // the scale is the whole round's, whoever is looking
  return { round, scale: scaleOf(entries), ...computeRound(entries, round.criteria, previous) };
}

/** whose results a person sees: the commander everyone's, a team commander the team's */
function visibleTeams(actor: UserRow): Set<number> | 'all' {
  if (isCommander(actor)) return 'all';
  return new Set(db().all<{ id: number }>('SELECT id FROM teams WHERE commander_id = ?', actor.id).map((t) => t.id));
}

/** A round's results (the latest by default), for whoever may see them. */
export function socioRound(actor: UserRow, roundId?: number): SocioRoundView {
  const scope = visibleTeams(actor);
  const list = rounds();
  const view = scope === 'all' ? 'all' : scope.size ? 'team' : 'none';
  if (!list.length || view === 'none') return { rounds: view === 'none' ? [] : list, round: null, rows: [], means: {}, teamMeans: {}, scale: 7, scope: view };
  const index = roundId ? list.findIndex((r) => r.id === roundId) : list.length - 1;
  if (index < 0) throw notFound('הסבב לא נמצא');
  const c = computed(list, index);
  const rows = scope === 'all' ? c.rows : c.rows.filter((r) => r.teamId !== null && scope.has(r.teamId));
  const teamMeans = scope === 'all' ? c.teamMeans : Object.fromEntries(Object.entries(c.teamMeans).filter(([k]) => k !== 'none' && scope.has(Number(k))));
  return { rounds: list, round: c.round, rows, means: c.means, teamMeans, scale: c.scale, scope: view };
}

/** One cadet across the rounds - for the cadet's page. */
export function socioOfCadet(actor: UserRow, cadetId: number): SocioCadetRound[] {
  const c = db().get<{ team_id: number | null; team_commander_id: number | null }>(
    'SELECT c.team_id, t.commander_id AS team_commander_id FROM cadets c LEFT JOIN teams t ON t.id = c.team_id WHERE c.id = ?',
    cadetId,
  );
  if (!c) throw notFound('הצוער לא נמצא');
  if (!isCommander(actor) && c.team_commander_id !== actor.id) throw forbidden('הסוציומטרי פתוח למפקד הקורס ולמפקד הצוות');
  const list = rounds();
  const out: SocioCadetRound[] = [];
  list.forEach((_, i) => {
    const r = computed(list, i);
    const row = r.rows.find((x) => x.cadetId === cadetId);
    if (row) out.push({ round: r.round, row, means: r.means, teamMeans: r.teamMeans[c.team_id === null ? 'none' : String(c.team_id)] ?? {}, scale: r.scale });
  });
  return out.reverse();
}

/** The commander renames a round or sets its date. */
export function updateSocioRound(actor: UserRow, id: number, raw: unknown): void {
  requireCommanderActor(actor);
  const patch = z.object({ name: z.string().trim().min(1).max(80).optional(), heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(raw);
  const cur = db().get<{ name: string; held_on: string | null }>('SELECT name, held_on FROM socio_rounds WHERE id = ?', id);
  if (!cur) throw notFound('הסבב לא נמצא');
  if (patch.name && patch.name !== cur.name && db().get('SELECT 1 FROM socio_rounds WHERE name = ? AND id <> ?', patch.name, id)) throw badRequest(`כבר יש סבב בשם "${patch.name}"`);
  db().run('UPDATE socio_rounds SET name = ?, held_on = ? WHERE id = ?', patch.name ?? cur.name, patch.heldOn !== undefined ? patch.heldOn : cur.held_on, id);
  changed('cadets');
}

/** A round goes, with all its results. */
export function deleteSocioRound(actor: UserRow, id: number): void {
  requireCommanderActor(actor);
  const r = db().get<{ name: string }>('SELECT name FROM socio_rounds WHERE id = ?', id);
  if (!r) throw notFound('הסבב לא נמצא');
  db().run('DELETE FROM socio_rounds WHERE id = ?', id);
  logActivity({ userId: actor.id, action: 'socio_deleted', text: `${actor.display_name} מחק את סבב הסוציומטרי "${r.name}"` });
  changed('cadets');
}

// The sociometric (סוציומטרי): each team rates its cadets on a set of criteria (כישורי ביטוי ודיון,
// פיקוד ומנהיגות...), and the team's sheet gives each cadet an average, a rank in the team and the
// criteria. From the sheets of all the teams in a round this works out where each cadet stands - in the
// team and in the company - and what stands out: the bottom or the top, a criterion far below the
// cadet's own average or the company's, a sharp drop since the round before. The same rules serve the
// sociometric page and the cadet's page.

export interface SocioRound {
  id: number;
  name: string;
  heldOn: string | null;
  criteria: string[];
  cadets: number;
  teams: number;
  createdAt: string;
}

/** one cadet in a round, as the team's sheet gave it */
export interface SocioEntry {
  cadetId: number;
  cadetName: string;
  teamId: number | null;
  teamName: string | null;
  /** the rank in the team, as the sheet gives it */
  teamRank: number | null;
  /** how many cadets the team's sheet ranked */
  teamSize: number | null;
  average: number | null;
  /** the sheet's own percentile, when it has one */
  percentile: number | null;
  scores: Record<string, number>;
}

export type SocioTone = 'red' | 'orange' | 'green';
export interface SocioFlag {
  tone: SocioTone;
  text: string;
}

export interface SocioRow extends SocioEntry {
  /** the average used: the sheet's, or the criteria's mean */
  avg: number | null;
  /** the rank in the team: the sheet's, or by average */
  rankInTeam: number | null;
  teamCount: number | null;
  /** 0-100, higher is better */
  teamStanding: number | null;
  companyRank: number | null;
  companyCount: number;
  /** 0-100, higher is better - the percentile in the company */
  companyStanding: number | null;
  /** each criterion against the company, in standard deviations */
  z: Record<string, number>;
  flags: SocioFlag[];
  outlier: boolean;
  previous: { round: string; rankInTeam: number | null; companyStanding: number | null } | null;
}

export interface SocioComputed {
  rows: SocioRow[];
  /** the company's mean of each criterion, and of the average ('') */
  means: Record<string, number>;
  /** the same for each team (by team id, or 'none') */
  teamMeans: Record<string, Record<string, number>>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const teamKey = (e: Pick<SocioEntry, 'teamId'>) => (e.teamId === null ? 'none' : String(e.teamId));
const SEVERITY: Record<SocioTone, number> = { red: 0, orange: 1, green: 2 };

/** the average of a cadet: the sheet's, or the mean of the criteria given */
export function averageOf(e: Pick<SocioEntry, 'average' | 'scores'>): number | null {
  if (e.average !== null && Number.isFinite(e.average)) return round2(e.average);
  const vs = Object.values(e.scores).filter(Number.isFinite);
  return vs.length ? round2(mean(vs)) : null;
}

/** ranks, higher first; equal values share a rank (1, 2, 2, 4) */
function ranks<T>(list: T[], value: (t: T) => number): Map<T, number> {
  const sorted = [...list].sort((a, b) => value(b) - value(a));
  const out = new Map<T, number>();
  sorted.forEach((t, i) => out.set(t, i > 0 && value(sorted[i - 1]) === value(t) ? out.get(sorted[i - 1])! : i + 1));
  return out;
}

const standing = (rank: number | null, count: number | null) => (rank && count && count > 1 ? Math.round((100 * (count - rank)) / (count - 1)) : null);

/** where each cadet of a round stands, and what stands out */
export function computeRound(entries: SocioEntry[], criteria: string[], previous?: { name: string; rows: SocioRow[] }): SocioComputed {
  const avgs = new Map(entries.map((e) => [e, averageOf(e)]));
  // the company: everyone with an average
  const withAvg = entries.filter((e) => avgs.get(e) !== null);
  const companyRanks = ranks(withAvg, (e) => avgs.get(e)!);
  const avgValues = withAvg.map((e) => avgs.get(e)!);
  const avgMean = mean(avgValues);
  const avgSd = avgValues.length >= 6 ? sd(avgValues) : 0;
  // each criterion across the company
  const stats = new Map<string, { m: number; s: number; n: number }>();
  for (const c of criteria) {
    const vs = entries.map((e) => e.scores[c]).filter((v): v is number => Number.isFinite(v));
    stats.set(c, { m: mean(vs), s: vs.length >= 6 ? sd(vs) : 0, n: vs.length });
  }
  // each team
  const teams = new Map<string, SocioEntry[]>();
  for (const e of entries) teams.set(teamKey(e), [...(teams.get(teamKey(e)) ?? []), e]);
  const teamRanks = new Map<SocioEntry, number>();
  const teamMeans: SocioComputed['teamMeans'] = {};
  for (const [k, list] of teams) {
    const scored = list.filter((e) => avgs.get(e) !== null);
    const r = ranks(scored, (e) => avgs.get(e)!);
    for (const e of list) {
      const rank = e.teamRank ?? r.get(e) ?? null;
      if (rank) teamRanks.set(e, rank);
    }
    const tm: Record<string, number> = {};
    for (const c of criteria) {
      const vs = list.map((e) => e.scores[c]).filter((v): v is number => Number.isFinite(v));
      if (vs.length) tm[c] = round2(mean(vs));
    }
    const ta = scored.map((e) => avgs.get(e)!);
    if (ta.length) tm[''] = round2(mean(ta));
    teamMeans[k] = tm;
  }
  const prev = new Map(previous?.rows.map((r) => [r.cadetId, r]) ?? []);
  const means: Record<string, number> = {};
  for (const [c, st] of stats) if (st.n) means[c] = round2(st.m);
  if (avgValues.length) means[''] = round2(avgMean);

  const rows = entries.map((e): SocioRow => {
    const avg = avgs.get(e) ?? null;
    const teamCount = e.teamSize ?? teams.get(teamKey(e))!.length;
    const rankInTeam = teamRanks.get(e) ?? null;
    const companyRank = companyRanks.get(e) ?? null;
    const companyCount = withAvg.length;
    const companyStanding = standing(companyRank, companyCount) ?? (e.percentile !== null ? Math.round(e.percentile) : null);
    const z: Record<string, number> = {};
    for (const [c, st] of stats) {
      const v = e.scores[c];
      if (Number.isFinite(v) && st.s > 0) z[c] = round2((v - st.m) / st.s);
    }
    const flags: SocioFlag[] = [];
    // in the team
    if (rankInTeam && teamCount >= 4) {
      if (rankInTeam >= teamCount - (teamCount >= 10 ? 1 : 0)) flags.push({ tone: 'red', text: `תחתית הצוות - מקום ${rankInTeam} מתוך ${teamCount}` });
      else if (rankInTeam === 1 || (rankInTeam === 2 && teamCount >= 10)) flags.push({ tone: 'green', text: rankInTeam === 1 ? 'ראשון בצוות' : 'מקום 2 בצוות' });
    }
    // in the company
    const bottom = companyCount >= 8 && companyStanding !== null && companyStanding <= 10;
    if (bottom) flags.push({ tone: 'red', text: 'עשירון תחתון בפלוגה' });
    else if (companyCount >= 8 && companyStanding !== null && companyStanding >= 90) flags.push({ tone: 'green', text: 'עשירון עליון בפלוגה' });
    if (!bottom && avg !== null && avgSd > 0 && (avg - avgMean) / avgSd <= -1.5) flags.push({ tone: 'red', text: `ממוצע נמוך במיוחד - ${avg} לעומת ${round2(avgMean)} בפלוגה` });
    // the criteria: far below the company, far below the cadet's own average, or far above the company
    const low: SocioFlag[] = [];
    const weak: { c: string; gap: number; v: number }[] = [];
    const high: SocioFlag[] = [];
    for (const c of criteria) {
      const v = e.scores[c];
      if (!Number.isFinite(v)) continue;
      const zc = z[c];
      if (zc !== undefined && zc <= -1.5) low.push({ tone: 'red', text: `${c.trim()} נמוך מאוד - ${v} (בפלוגה ${round2(stats.get(c)!.m)})` });
      else if (avg !== null && avg - v >= 1) weak.push({ c: c.trim(), gap: avg - v, v });
      if (zc !== undefined && zc >= 1.5) high.push({ tone: 'green', text: `בולט ב${c.trim()} - ${v}` });
    }
    flags.push(...low.slice(0, 2));
    flags.push(...weak.sort((a, b) => b.gap - a.gap).slice(0, 2).map((w) => ({ tone: 'orange' as const, text: `חולשה יחסית: ${w.c} - ${w.v} (ממוצע שלו ${avg})` })));
    flags.push(...high.slice(0, 2));
    // since the round before
    const p = prev.get(e.cadetId);
    if (p && previous) {
      if (p.rankInTeam && rankInTeam) {
        const moved = rankInTeam - p.rankInTeam;
        if (moved >= 3) flags.push({ tone: 'red', text: `ירד ${moved} מקומות בצוות מאז ${previous.name}` });
        else if (moved <= -3) flags.push({ tone: 'green', text: `עלה ${-moved} מקומות בצוות מאז ${previous.name}` });
      }
      if (p.companyStanding !== null && companyStanding !== null && p.companyStanding - companyStanding >= 25) {
        flags.push({ tone: 'orange', text: `ירד ${p.companyStanding - companyStanding} אחוזונים בפלוגה מאז ${previous.name}` });
      }
    }
    flags.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
    return {
      ...e,
      avg,
      rankInTeam,
      teamCount,
      teamStanding: standing(rankInTeam, teamCount),
      companyRank,
      companyCount,
      companyStanding,
      z,
      flags,
      outlier: flags.some((f) => f.tone !== 'green'),
      previous: p && previous ? { round: previous.name, rankInTeam: p.rankInTeam, companyStanding: p.companyStanding } : null,
    };
  });
  return { rows, means, teamMeans };
}

/** the top of the scale the criteria are on (1-5, 1-7, 1-10 or 0-100) */
export function scaleOf(rows: Pick<SocioEntry, 'scores'>[]): number {
  const max = Math.max(0, ...rows.flatMap((r) => Object.values(r.scores)));
  return max <= 5 ? 5 : max <= 7 ? 7 : max <= 10 ? 10 : 100;
}

// ---------------- what the server sends ----------------

/** a round's results, for whoever may see them */
export interface SocioRoundView {
  rounds: SocioRound[];
  round: SocioRound | null;
  rows: SocioRow[];
  means: Record<string, number>;
  teamMeans: Record<string, Record<string, number>>;
  /** the top of the round's scale (7 for 1-7) */
  scale: number;
  /** all: the commander; team: a team commander; none: no team to see */
  scope: 'all' | 'team' | 'none';
}

/** one cadet in a round - the cadet's page */
export interface SocioCadetRound {
  round: SocioRound;
  row: SocioRow;
  means: Record<string, number>;
  teamMeans: Record<string, number>;
  /** the top of the round's scale */
  scale: number;
}

/** a cadet's row in a team's sheet */
export interface SocioSheetRow {
  line: number;
  name: string;
  personalNumber: string;
  rank: number | null;
  average: number | null;
  percentile: number | null;
  scores: Record<string, number>;
}

export interface SocioPreview {
  headerRow: number;
  criteria: string[];
  teamId: number | null;
  teamBy: 'title' | 'names' | 'chosen' | null;
  teams: { id: number; name: string }[];
  rows: (SocioSheetRow & { cadetId: number | null; cadetName: string | null; matchedBy: 'sheet' | 'chosen' | null; ambiguous: boolean })[];
  /** the cadets to choose from for a name not found: the team's, or everyone's */
  candidates: { id: number; name: string; teamName: string | null }[];
}

export interface SocioImportResult {
  roundId: number;
  set: number;
  unmatched: number;
  teamName: string | null;
}

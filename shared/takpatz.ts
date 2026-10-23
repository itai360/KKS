// The team commander's takpatz (תקפ"צ): each cadet's personal goals, notes and ideas, the experiences
// planned for them week by week (the main plan and a second plan beside it), the tracking of each
// experience from its handing down to its feedback, the team's planning by halves and the mapping into
// thirds after the ODT. The course's own spreadsheet is the model: its five sheets, their names and
// colors, are what the export writes (server/src/takpatzXlsx.ts).

/** the nine weeks of the plan, by the course's numbering, with their titles in the spreadsheet */
export const TAKPATZ_WEEKS: readonly { n: number; title: string }[] = [
  { n: 0, title: 'סף' },
  { n: 1, title: 'לבנת היסוד' },
  { n: 2, title: 'המקצוע הצבאי' },
  { n: 3, title: 'פרט' },
  { n: 4, title: 'שטח' },
  { n: 5, title: 'מנהיגות' },
  { n: 6, title: 'סד"ח' },
  { n: 7, title: 'זהות' },
  { n: 8, title: 'מסכמים' },
];
export const FIRST_WEEK = TAKPATZ_WEEKS[0].n;
export const LAST_WEEK = TAKPATZ_WEEKS[TAKPATZ_WEEKS.length - 1].n;

/** the kinds of experience, in the spreadsheet's order */
export const TAKPATZ_CATEGORIES = ['broad_company', 'broad_team', 'command_team', 'instruct_team', 'instruct_company'] as const;
export type TakpatzCategory = (typeof TAKPATZ_CATEGORIES)[number];

export interface CategoryInfo {
  label: string;
  /** the spreadsheet's three shades of it: the block's title, an experience, the row under it */
  dark: string;
  mid: string;
  light: string;
}

export const CATEGORY_INFO: Record<TakpatzCategory, CategoryInfo> = {
  broad_company: { label: 'רוחב פלוגתי', dark: '#6AA84F', mid: '#B6D7A8', light: '#D9EAD3' },
  broad_team: { label: 'רוחב צוותי', dark: '#76A5AF', mid: '#A2C4C9', light: '#D0E0E3' },
  command_team: { label: 'פיקודי - צוות', dark: '#6D9EEB', mid: '#A4C2F4', light: '#C9DAF8' },
  instruct_team: { label: 'הדרכתי - צוות', dark: '#8E7CC3', mid: '#B4A7D6', light: '#D9D2E9' },
  instruct_company: { label: 'הדרכתי - פלוגתי', dark: '#B55B87', mid: '#D5A6BD', light: '#EAD1DC' },
};

/** a catalog entry is an experience of one of the kinds - or a role a broad company experience can take */
export const CATALOG_KINDS = [...TAKPATZ_CATEGORIES, 'role'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];
export const ROLE_KIND_LABEL = 'תפקידים';

export const TAKPATZ_HALVES = [1, 2] as const;
export type TakpatzHalf = (typeof TAKPATZ_HALVES)[number];
export const HALF_LABELS: Record<TakpatzHalf, string> = { 1: "חציון א'", 2: "חציון ב'" };

/** the two plans: the main one, and a second one beside it (the spreadsheet's "Sheet8") */
export const TAKPATZ_BOARDS = ['main', 'alt'] as const;
export type TakpatzBoard = (typeof TAKPATZ_BOARDS)[number];
export const BOARD_LABELS: Record<TakpatzBoard, string> = { main: 'תכנון ראשי', alt: 'תכנון נוסף' };
/** the sheets' names in the spreadsheet, kept as they are */
export const BOARD_SHEET_NAMES: Record<TakpatzBoard, string> = { main: 'תקפץ א', alt: 'Sheet8' };

/** the tracking's stages, by the spreadsheet's names */
export const TRACK_STAGES = [
  { key: 'download', label: 'הורדת התנסות' },
  { key: 'at', label: 'א.ת' },
  { key: 'exec', label: 'ביצוע' },
  { key: 'write', label: 'כתיבת משוב' },
  { key: 'deliver', label: 'העברת משוב' },
] as const;
export type StageKey = (typeof TRACK_STAGES)[number]['key'];
export const STAGE_KEYS = TRACK_STAGES.map((s) => s.key) as StageKey[];

export const STAGE_STATUSES = ['done', 'set', 'unset'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
/** the spreadsheet's list: done, set (a time is fixed), not set */
export const STATUS_LABELS: Record<StageStatus, string> = { done: 'בוצע', set: 'נקבע', unset: 'לא נקבע' };

export const THIRDS = ['upper', 'middle', 'lower'] as const;
export type Third = (typeof THIRDS)[number];
export const THIRD_LABELS: Record<Third, string> = { upper: 'עליון', middle: 'אמצעי', lower: 'תחתון' };

export interface TakpatzCatalogItem {
  id: number;
  half: TakpatzHalf;
  kind: CatalogKind;
  name: string;
  sort: number;
}

export interface TakpatzCadet {
  id: number;
  name: string;
  goals: [string, string, string];
  notes: string;
  ideas: string;
  third: Third | null;
  rank: number | null;
  thirdUpdatedAt: string | null;
  thirdUpdatedByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface TakpatzPlacement {
  id: number;
  cadetId: number;
  board: TakpatzBoard;
  category: TakpatzCategory;
  catalogId: number | null;
  label: string;
  /** null for both: not in a week yet - kept beside the weeks, as long as `span` */
  weekFrom: number | null;
  weekTo: number | null;
  span: number;
  notes: string;
  updatedAt: string;
  updatedByName: string | null;
}

export interface TakpatzStage {
  status: StageStatus | null;
  date: string | null;
  note: string;
}
export type TakpatzStages = Record<StageKey, TakpatzStage>;

export interface TakpatzTrackRow {
  /** "p<placement>" for an experience of the main plan, "t<row>" for one tracked on its own */
  key: string;
  trackingId: number | null;
  placementId: number | null;
  cadetId: number;
  cadetName: string;
  label: string;
  category: TakpatzCategory | null;
  weekFrom: number | null;
  weekTo: number | null;
  stages: TakpatzStages;
  updatedAt: string | null;
}

export interface TakpatzMetrics {
  cadets: number;
  /** experiences in the main plan (in a week or beside the weeks) */
  planned: number;
  unscheduled: number;
  executed: number;
  feedbackToWrite: number;
  feedbackToDeliver: number;
  withGoals: number;
  mapped: number;
  withoutExperience: number;
}

export interface TakpatzHistoryItem {
  at: string;
  who: string | null;
  text: string;
}

export interface TakpatzWeek {
  n: number;
  title: string;
  /** the course week with this number, where there is one */
  startDate: string | null;
  endDate: string | null;
}

export interface TakpatzTeamView {
  team: { id: number; name: string; commanderId: number | null; commanderName: string | null };
  courseName: string;
  weeks: TakpatzWeek[];
  catalog: TakpatzCatalogItem[];
  cadets: TakpatzCadet[];
  placements: TakpatzPlacement[];
  tracking: TakpatzTrackRow[];
  metrics: TakpatzMetrics;
  history: TakpatzHistoryItem[];
  updatedAt: string | null;
  canManageCatalog: boolean;
  /** saving to Google Drive is set up on the server */
  driveAvailable: boolean;
}

export interface TakpatzTeamSummary {
  id: number;
  name: string;
  commanderName: string | null;
  metrics: TakpatzMetrics;
  updatedAt: string | null;
}

export interface TakpatzOverview {
  /** the commander sees every team, a team commander their own, anyone else none */
  scope: 'all' | 'team' | 'none';
  teams: TakpatzTeamSummary[];
}

export const emptyStages = (): TakpatzStages => Object.fromEntries(STAGE_KEYS.map((k) => [k, { status: null, date: null, note: '' }])) as unknown as TakpatzStages;

/** the weeks a placement takes, or none beside the weeks */
export const placementWeeks = (p: Pick<TakpatzPlacement, 'weekFrom' | 'weekTo'>): number[] =>
  p.weekFrom === null || p.weekTo === null ? [] : Array.from({ length: p.weekTo - p.weekFrom + 1 }, (_, i) => p.weekFrom! + i);

export const weekRange = (from: number | null, to: number | null): string =>
  from === null || to === null ? 'מחוץ לשבועות' : from === to ? `שבוע ${from}` : `שבועות ${from}-${to}`;

/** two experiences of a cadet in one plan that share a week: one cell of the sheet cannot hold both */
export function overlapping<T extends Pick<TakpatzPlacement, 'id' | 'cadetId' | 'board' | 'weekFrom' | 'weekTo'>>(list: T[], p: Pick<TakpatzPlacement, 'cadetId' | 'board' | 'weekFrom' | 'weekTo'> & { id?: number }): T | undefined {
  if (p.weekFrom === null || p.weekTo === null) return undefined;
  return list.find((o) => o.id !== p.id && o.cadetId === p.cadetId && o.board === p.board && o.weekFrom !== null && o.weekTo !== null && o.weekFrom <= p.weekTo! && p.weekFrom! <= o.weekTo);
}

/** the team's numbers, from the cadets, the main plan and the tracking */
export function takpatzMetrics(cadets: Pick<TakpatzCadet, 'id' | 'goals' | 'third'>[], placements: Pick<TakpatzPlacement, 'cadetId' | 'board' | 'weekFrom'>[], tracking: Pick<TakpatzTrackRow, 'stages'>[]): TakpatzMetrics {
  const main = placements.filter((p) => p.board === 'main');
  const withPlacement = new Set(main.map((p) => p.cadetId));
  const done = (r: Pick<TakpatzTrackRow, 'stages'>, k: StageKey) => r.stages[k].status === 'done';
  return {
    cadets: cadets.length,
    planned: main.length,
    unscheduled: main.filter((p) => p.weekFrom === null).length,
    executed: tracking.filter((r) => done(r, 'exec')).length,
    feedbackToWrite: tracking.filter((r) => done(r, 'exec') && !done(r, 'write')).length,
    feedbackToDeliver: tracking.filter((r) => done(r, 'write') && !done(r, 'deliver')).length,
    withGoals: cadets.filter((c) => c.goals.some((g) => g.trim())).length,
    mapped: cadets.filter((c) => c.third !== null).length,
    withoutExperience: cadets.filter((c) => !withPlacement.has(c.id)).length,
  };
}

/** the file's name: "תקפ״צ - <team> - <course>.xlsx" */
export const takpatzFileName = (team: string, course: string) => `תקפ״צ - ${team} - ${course}`;

// The feedback after an experience (משוב לאחר התנסות), one format for every experience - a role or a
// broad one: a general written reference, a point to keep and a point to improve - more of either may be
// added - each the point, the axis (ציר) it belongs to and a few words on it - and a score from 0 to 100,
// read on the legend below.

/** how many points of each kind the format asks for: one - and more may be added, up to the most */
export const FEEDBACK_POINTS = 1;
export const FEEDBACK_POINTS_MAX = 6;

export interface FeedbackPoint {
  /** the point itself, in a few words */
  title: string;
  /** the axis (ציר) it belongs to */
  axis: string;
  /** what was seen, in a sentence or two (may stay empty) */
  text: string;
}

export interface ExperienceFeedbackForm {
  /** the general written reference (התייחסות כללית מילולית) */
  general: string;
  /** the points to keep (נקודות לשימור) */
  keep: FeedbackPoint[];
  /** the points to improve (נקודות לשיפור) */
  improve: FeedbackPoint[];
}

export type PointKind = 'keep' | 'improve';
export const POINT_LABELS: Record<PointKind, string> = { keep: 'נקודה לשימור', improve: 'נקודה לשיפור' };

export const SCORE_MAX = 100;

export interface ScoreBand {
  label: string;
  /** as the legend writes it */
  range: string;
  /** the band goes up to this score, itself included */
  max: number;
  tone: 'red' | 'orange' | 'yellow' | 'gray' | 'blue' | 'green' | 'purple';
}

/** the legend (מקרא הערכה להתנסות): a band holds the scores up to its top - 60 is "נכשל", 61 is "מתחת לנדרש" */
export const SCORE_BANDS: readonly ScoreBand[] = [
  { label: 'נכשל', range: '60 ומטה', max: 60, tone: 'red' },
  { label: 'מתחת לנדרש', range: '60-70', max: 70, tone: 'orange' },
  { label: 'עמד בנדרש', range: '70-75', max: 75, tone: 'yellow' },
  { label: 'טוב', range: '75-80', max: 80, tone: 'gray' },
  { label: 'טוב מאוד', range: '80-85', max: 85, tone: 'blue' },
  { label: 'מצוין', range: '85-95', max: 95, tone: 'green' },
  { label: 'יוצא דופן לחיוב', range: '95-100', max: 100, tone: 'purple' },
];

export function scoreBand(score: number): ScoreBand {
  return SCORE_BANDS.find((b) => score <= b.max) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export interface FeedbackAxis {
  name: string;
  /** what it takes in, in a few words (the values have none) */
  about?: string;
}

export interface FeedbackAxisGroup {
  name: string;
  about: string;
  axes: readonly FeedbackAxis[];
}

/** the axes a point belongs to: four main ones, each with the parts it holds */
export const FEEDBACK_AXIS_GROUPS: readonly FeedbackAxisGroup[] = [
  {
    name: 'המקצוע הצבאי',
    about: 'היכולת להוביל משימה, לתכנן אותה ולהוציא אותה לפועל',
    axes: [
      { name: 'הובלה', about: 'העברת מסרים, הפעלת סמכות, האצלת סמכויות ומיקום המפקד' },
      { name: 'קבלת החלטות', about: 'שיקול דעת, חשיבה ביקורתית, הבחנה בין עיקר לטפל וקביעת סדרי עדיפויות' },
      { name: 'יוזמה', about: 'יצירתיות, חשיבה מחוץ לקופסה, ראייה כוללת והגדלת ראש' },
      { name: 'הכנה ותכנון', about: 'יסודיות, ירידה לפרטים, סדר וארגון ובקיאות' },
      { name: 'ביצוע ובקרה', about: 'ניהול זמנים, מעקב ובקרה, רצינות והשקעה' },
      { name: 'למידה והשתפרות', about: 'ניתוח, תחקור, הפקת לקחים ושיפור מתמיד' },
    ],
  },
  {
    name: 'ערכים',
    about: 'העקרונות שמכוונים את ההתנהלות ואת אופן ביצוע המשימה',
    axes: [{ name: 'דבקות במשימה וחתירה לניצחון' }, { name: 'אמינות' }, { name: 'אחריות' }, { name: 'שליחות' }, { name: 'משמעת' }, { name: 'רעות' }, { name: 'חיי אדם' }],
  },
  {
    name: 'מנהיגות',
    about: 'היכולת להכיר את עצמך, להשפיע על אנשים ולפתח אותם',
    axes: [
      { name: 'מודעות עצמית', about: 'הכרת החוזקות והחולשות, צניעות וביקורת עצמית' },
      { name: 'תפיסה פיקודית', about: 'גיבוש דרך פיקודית ופעולה לאורה' },
      { name: 'הנעה ומוטיבציה', about: 'רתימת אנשים, יחס מכבד ואיזון בין דרישה להכלה' },
      { name: 'יצירת יציבות ובהירות', about: 'תמונת מצב ברורה, שקיפות, זמינות ונוכחות' },
      { name: 'פיתוח פקודים', about: 'חניכה, יחס אישי, דאגה לפרט וחיזוק תחושת המסוגלות' },
      { name: 'קבלת החלטות פיקודיות', about: 'קריאת המצב והאנשים, התאמה לקהל היעד ואומץ פיקודי' },
    ],
  },
  {
    name: 'חוסן',
    about: 'היכולת לשמור על תפקוד ועל שיקול דעת מול לחץ, קושי ושינוי',
    axes: [
      { name: 'תפקוד תחת לחץ', about: 'התמודדות עם אתגרים ובלת״מים ושמירה על רציפות תפקודית' },
      { name: 'ויסות ושליטה עצמית', about: 'קור רוח, איפוק, סבלנות, פרופורציות והפרדה בין האישי למקצועי' },
      { name: 'עמידות והתמדה', about: 'חוסן פיזי ומנטלי, נחישות, איתנות ותעצומות נפש' },
      { name: 'מסוגלות ואומץ אישי', about: 'תחושת מסוגלות, תעוזה והבעת עמדה' },
      { name: 'גמישות ופתיחות למשוב', about: 'פתיחות לשינויים, חשיבה רעננה ויכולת לתת ולקבל ביקורת' },
      { name: 'חוסן ביחסים ובקבוצה', about: 'אינטליגנציה רגשית ולכידות' },
    ],
  },
];

/** an axis as a point keeps it: the main axis and its part - "מנהיגות - מודעות עצמית" */
export const axisValue = (group: string, axis: string) => `${group} - ${axis}`;

/** every axis that can be chosen, in the order of the groups */
export const FEEDBACK_AXES: readonly string[] = FEEDBACK_AXIS_GROUPS.flatMap((g) => g.axes.map((a) => axisValue(g.name, a.name)));

/** what an axis chosen takes in ("" for one typed before the list, or a value) */
export function axisAbout(value: string): string {
  for (const g of FEEDBACK_AXIS_GROUPS) for (const a of g.axes) if (axisValue(g.name, a.name) === value) return a.about ?? '';
  return '';
}

export const emptyPoint = (): FeedbackPoint => ({ title: '', axis: '', text: '' });
export const emptyFeedback = (): ExperienceFeedbackForm => ({
  general: '',
  keep: Array.from({ length: FEEDBACK_POINTS }, emptyPoint),
  improve: Array.from({ length: FEEDBACK_POINTS }, emptyPoint),
});

/** nothing written in it */
export const isBlankPoint = (p: FeedbackPoint) => !p.title.trim() && !p.axis.trim() && !p.text.trim();

/** a point's name: "נקודה לשימור", numbered once there are more of its kind - "נקודה לשימור 2" */
export const pointName = (kind: PointKind, i: number, of: number) => (of > 1 ? `${POINT_LABELS[kind]} ${i + 1}` : POINT_LABELS[kind]);

/** the points as kept: one added and left empty is dropped - the first of each kind always stays */
export function tidyFeedback(f: ExperienceFeedbackForm): ExperienceFeedbackForm {
  const kept = (list: FeedbackPoint[]) => list.filter((p, i) => i === 0 || !isBlankPoint(p));
  return { ...f, keep: kept(f.keep), improve: kept(f.improve) };
}

/** what the feedback still lacks, in words: the general reference, each point and its axis, the score */
export function feedbackMissing(raw: ExperienceFeedbackForm, score: number | null): string[] {
  const f = tidyFeedback(raw);
  const out: string[] = [];
  if (!f.general.trim()) out.push('התייחסות כללית');
  for (const kind of ['keep', 'improve'] as const) {
    if (!f[kind].length) out.push(POINT_LABELS[kind]);
    f[kind].forEach((p, i) => {
      const name = pointName(kind, i, f[kind].length);
      if (!p.title.trim()) out.push(name);
      else if (!p.axis.trim()) out.push(`הציר של ${name}`);
    });
  }
  if (score === null) out.push('ציון');
  return out;
}

/** a point in one line: "the point (ציר: the axis)" */
export const pointLine = (p: FeedbackPoint) => `${p.title.trim()}${p.axis.trim() ? ` (ציר: ${p.axis.trim()})` : ''}`;

/** the points of a kind as text: each in its line, with its words under it */
export const pointsText = (points: FeedbackPoint[]) =>
  points
    .filter((p) => p.title.trim())
    .map((p) => [pointLine(p), p.text.trim()].filter(Boolean).join('\n'))
    .join('\n');

/** the score as it reads: "85 - טוב מאוד" */
export const scoreText = (score: number) => `${score} - ${scoreBand(score).label}`;

/** the whole feedback as text, in the order of the format - in the cadet's file and wherever it is searched */
export function feedbackText(f: ExperienceFeedbackForm, score: number | null): string {
  const points = (kind: PointKind) =>
    f[kind]
      .filter((p) => p.title.trim())
      .map((p) => [`${POINT_LABELS[kind]}: ${pointLine(p)}`, p.text.trim()].filter(Boolean).join('\n'));
  return [f.general.trim() && `התייחסות כללית: ${f.general.trim()}`, ...points('keep'), ...points('improve'), score !== null && `ציון להתנסות: ${scoreText(score)}`]
    .filter(Boolean)
    .join('\n\n');
}

/** anything as a form (null when it is not one): one point of each kind at least, every field a string */
export function asFeedbackForm(v: unknown): ExperienceFeedbackForm | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<Record<keyof ExperienceFeedbackForm, unknown>>;
  const str = (s: unknown) => (typeof s === 'string' ? s : '');
  const points = (list: unknown) => {
    const given = (Array.isArray(list) ? list : []).slice(0, FEEDBACK_POINTS_MAX) as (Partial<Record<keyof FeedbackPoint, unknown>> | null)[];
    const read = given.map((p) => ({ title: str(p?.title), axis: str(p?.axis), text: str(p?.text) }));
    return read.length >= FEEDBACK_POINTS ? read : [...read, ...Array.from({ length: FEEDBACK_POINTS - read.length }, emptyPoint)];
  };
  return { general: str(o.general), keep: points(o.keep), improve: points(o.improve) };
}

/** a form as stored (JSON) read back */
export function readFeedbackForm(raw: string | null | undefined): ExperienceFeedbackForm | null {
  if (!raw) return null;
  try {
    return asFeedbackForm(JSON.parse(raw));
  } catch {
    return null;
  }
}

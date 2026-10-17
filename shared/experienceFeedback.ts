// The feedback after an experience (משוב לאחר התנסות), one format for every experience - a role or a
// broad one: a general written reference, two points to keep and two to improve - each the point, the
// axis (ציר) it belongs to and a few words on it - and a score from 0 to 100, read on the legend below.

import { EVALUATION_CRITERIA } from './constants';

/** how many points of each kind the format asks for */
export const FEEDBACK_POINTS = 2;

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

/** the axes offered for a point: the course's evaluation criteria - any other can be typed */
export const FEEDBACK_AXES: readonly string[] = EVALUATION_CRITERIA;

export const emptyPoint = (): FeedbackPoint => ({ title: '', axis: '', text: '' });
export const emptyFeedback = (): ExperienceFeedbackForm => ({
  general: '',
  keep: Array.from({ length: FEEDBACK_POINTS }, emptyPoint),
  improve: Array.from({ length: FEEDBACK_POINTS }, emptyPoint),
});

/** what the feedback still lacks, in words: the general reference, each point and its axis, the score */
export function feedbackMissing(f: ExperienceFeedbackForm, score: number | null): string[] {
  const out: string[] = [];
  if (!f.general.trim()) out.push('התייחסות כללית');
  for (const kind of ['keep', 'improve'] as const) {
    f[kind].forEach((p, i) => {
      const name = `${POINT_LABELS[kind]} ${i + 1}`;
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

/** anything as a form (null when it is not one): two points of each kind, every field a string */
export function asFeedbackForm(v: unknown): ExperienceFeedbackForm | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<Record<keyof ExperienceFeedbackForm, unknown>>;
  const str = (s: unknown) => (typeof s === 'string' ? s : '');
  const points = (list: unknown) =>
    Array.from({ length: FEEDBACK_POINTS }, (_, i) => {
      const p = (Array.isArray(list) ? list[i] : null) as Partial<Record<keyof FeedbackPoint, unknown>> | null;
      return { title: str(p?.title), axis: str(p?.axis), text: str(p?.text) };
    });
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

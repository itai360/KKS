// The debrief forms: a weekly debrief (improve this cycle, and the same week in
// the next one) and a debrief of an intensive event (a march, a final exercise).
// One definition serves the screen and the server's check before summing up.

export const DEBRIEF_KINDS = ['general', 'weekly', 'event'] as const;
export type DebriefKind = (typeof DEBRIEF_KINDS)[number];

export const DEBRIEF_KIND_LABELS: Record<DebriefKind, string> = {
  general: 'תחקיר פעילות',
  weekly: 'תחקיר שבועי',
  event: 'תחקיר מופע עצים',
};

export const DEBRIEF_KIND_HINTS: Record<DebriefKind, string> = {
  weekly: 'בסוף כל שבוע: מה הושג, מה לשמר ומה לשפר - ולקחים עם אחראי לשבוע הבא ולאותו שבוע במחזור הבא.',
  event: 'אחרי מופע עצים (מארס, תרגיל מסכם, ניווט לילה): מטרות, ציר זמן, בטיחות, לוגיסטיקה - ולקחים למופע הבא.',
  general: 'עובדות, ממצאים, מסקנות ולקחים - לכל פעילות אחרת.',
};

export type QuestionType = 'text' | 'list' | 'rating' | 'goals' | 'numbers' | 'flag';

export interface DebriefQuestion {
  id: string;
  label: string;
  hint?: string;
  type: QuestionType;
  /** numbers: the counts asked for */
  fields?: { id: string; label: string }[];
  /** the form can't be summed up while this is empty */
  required?: boolean;
}

export interface DebriefSection {
  id: string;
  title: string;
  hint?: string;
  questions: DebriefQuestion[];
  /** shown in red when filled (a safety event) */
  alert?: boolean;
}

/** a goal and whether it was met */
export interface GoalAnswer {
  goal: string;
  status: '' | 'met' | 'partial' | 'missed';
  note: string;
}

export const GOAL_STATUS_LABELS: Record<Exclude<GoalAnswer['status'], ''>, string> = {
  met: 'הושג',
  partial: 'חלקית',
  missed: 'לא הושג',
};

export type DebriefAnswers = Record<string, unknown>;

export const WEEKLY_FORM: DebriefSection[] = [
  {
    id: 'goals',
    title: 'מטרות השבוע',
    hint: 'לכל מטרה - האם הושגה, ובמשפט למה.',
    questions: [{ id: 'goals', label: 'מטרות', type: 'goals', required: true }],
  },
  {
    id: 'overall',
    title: 'תמונה כללית',
    questions: [
      { id: 'rating', label: 'ציון לשבוע', hint: '1 - לא עבד, 5 - מצוין', type: 'rating', required: true },
      { id: 'headline', label: 'במשפט אחד - איך היה השבוע?', type: 'text' },
    ],
  },
  {
    id: 'sustain',
    title: 'לשימור',
    hint: 'מה עבד טוב ושווה לעשות שוב בדיוק כך.',
    questions: [{ id: 'sustain', label: 'מה עבד', type: 'list' }],
  },
  {
    id: 'improve',
    title: 'לשיפור',
    hint: 'מה לא עבד - עובדות, לא האשמות.',
    questions: [{ id: 'improve', label: 'מה לא עבד', type: 'list' }],
  },
  {
    id: 'pace',
    title: 'לו"ז ועומס',
    questions: [
      { id: 'schedule', label: 'האם הלו"ז היה ריאלי? מה זז, מה בוטל ולמה?', type: 'text' },
      { id: 'load', label: 'איפה היה עומס - על הסגל או על הצוערים?', type: 'text' },
    ],
  },
  {
    id: 'cadets',
    title: 'הצוערים',
    questions: [{ id: 'cadets', label: 'מה עלה מהצוערים השבוע? (משוב, מצב רוח, צוערים במעקב)', type: 'text' }],
  },
];

export const EVENT_FORM: DebriefSection[] = [
  {
    id: 'numbers',
    title: 'המופע במספרים',
    questions: [
      {
        id: 'numbers',
        label: 'צוערים',
        type: 'numbers',
        fields: [
          { id: 'started', label: 'התחילו' },
          { id: 'finished', label: 'סיימו' },
          { id: 'evacuated', label: 'פונו / פרשו' },
        ],
      },
    ],
  },
  {
    id: 'goals',
    title: 'מטרות המופע',
    hint: 'מה המופע נועד להשיג, והאם הושג.',
    questions: [{ id: 'goals', label: 'מטרות', type: 'goals', required: true }],
  },
  {
    id: 'timeline',
    title: 'תכנון מול ביצוע',
    questions: [{ id: 'timeline', label: 'ציר הזמן: איפה סטינו מהתכנון, ולמה?', type: 'text' }],
  },
  {
    id: 'safety',
    title: 'בטיחות ורפואה',
    alert: true,
    questions: [
      { id: 'safetyEvent', label: 'היה אירוע בטיחות חריג (פציעה, פינוי, כמעט-תאונה)', type: 'flag' },
      { id: 'safety', label: 'מה קרה, מה עשינו, ומה ימנע את זה בפעם הבאה', type: 'text' },
    ],
  },
  {
    id: 'logistics',
    title: 'לוגיסטיקה ומשאבים',
    questions: [{ id: 'logistics', label: 'ציוד, מים ומזון, הסעות, קשר - מה חסר ומה היה מיותר', type: 'text' }],
  },
  {
    id: 'command',
    title: 'פיקוד ושליטה',
    questions: [{ id: 'command', label: 'תדריך, חלוקת תפקידים, שליטה בשטח - מה עבד ומה לא', type: 'text' }],
  },
  {
    id: 'feedback',
    title: 'משוב צוערים',
    questions: [{ id: 'cadetFeedback', label: 'מה הצוערים אמרו על המופע', type: 'text' }],
  },
  {
    id: 'verdict',
    title: 'שורה תחתונה',
    questions: [
      { id: 'rating', label: 'ציון למופע', hint: '1 - לא עבד, 5 - מצוין', type: 'rating', required: true },
      { id: 'sustain', label: 'לשימור', type: 'list' },
      { id: 'improve', label: 'לשיפור', type: 'list' },
    ],
  },
];

export function formFor(kind: DebriefKind): DebriefSection[] {
  return kind === 'weekly' ? WEEKLY_FORM : kind === 'event' ? EVENT_FORM : [];
}

/** the two horizons of a lesson: this cycle (a task now) or the next cycle (kept in the lessons bank) */
export const LESSON_HORIZONS = ['now', 'next'] as const;
export type LessonHorizon = (typeof LESSON_HORIZONS)[number];

export const LESSON_HORIZON_LABELS: Record<DebriefKind, Record<LessonHorizon, { title: string; hint: string }>> = {
  weekly: {
    now: { title: 'לקחים להמשך המחזור', hint: 'כל לקח עם אחראי ותאריך - בסיכום התחקיר הוא נפתח כמשימה.' },
    next: { title: 'לקחים לשבוע הזה במחזור הבא', hint: 'נשמרים בבנק הלקחים ויוצגו כשהשבוע הזה יגיע במחזור הבא.' },
  },
  event: {
    now: { title: 'לקחים לביצוע עכשיו', hint: 'כל לקח עם אחראי ותאריך - בסיכום התחקיר הוא נפתח כמשימה.' },
    next: { title: 'לקחים למופע הבא', hint: 'נשמרים בבנק הלקחים ויוצגו כשמופע בשם הזה יופיע שוב בלו"ז.' },
  },
  general: {
    now: { title: 'לקחים', hint: '' },
    next: { title: 'לקחים לפעם הבאה', hint: '' },
  },
};

/** has a question been answered (for the form's progress, and the check before summing up) */
export function answered(q: DebriefQuestion, a: DebriefAnswers): boolean {
  const v = a[q.id];
  if (q.type === 'rating') return typeof v === 'number' && v >= 1;
  if (q.type === 'flag') return v === true || v === false;
  if (q.type === 'list') return Array.isArray(v) && v.some((x) => typeof x === 'string' && x.trim());
  if (q.type === 'goals') return Array.isArray(v) && v.some((g) => (g as GoalAnswer)?.goal?.trim() && (g as GoalAnswer).status);
  if (q.type === 'numbers') return !!v && typeof v === 'object' && Object.values(v as object).some((n) => typeof n === 'number');
  return typeof v === 'string' && !!v.trim();
}

/** the goals a week set (one per line), as the starting rows of its form */
export function goalsFromText(text: string): GoalAnswer[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((goal) => ({ goal, status: '', note: '' }));
}

/** what was decided about a lesson an earlier cycle kept, when its week or event comes round */
export const LESSON_DECISIONS = ['task', 'applied', 'skip'] as const;
export type LessonDecision = (typeof LESSON_DECISIONS)[number];

export const LESSON_DECISION_LABELS: Record<LessonDecision, string> = {
  task: 'נפתחה משימה',
  applied: 'יושם',
  skip: 'לא רלוונטי',
};

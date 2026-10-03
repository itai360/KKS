// Personal talks (שיחות אישיות) as forms: every kind of talk has its parts, and every talk ends
// with a short note written right after it - a personal detail to remember, what to follow up,
// what comes next. Plain headings of a commander's talk with a cadet; what is said stays in the
// course's records.

import { TALK_TYPES } from './constants';

export type TalkType = (typeof TALK_TYPES)[number];

export interface TalkField {
  id: string;
  label: string;
  hint?: string;
}

export interface TalkSection {
  id: string;
  title: string;
  /** a numbered part of the talk; the opening, the summary and the note after it are not */
  numbered: boolean;
  fields: TalkField[];
}

/** what a talk keeps: the answers by field */
export type TalkAnswers = Record<string, string>;

const one = (id: string, title: string, hint?: string, numbered = true): TalkSection => ({ id, title, numbered, fields: [{ id, label: title, hint }] });

const after = (...extra: TalkField[]): TalkSection => ({
  id: 'after',
  title: 'רישום קצר מיד בסיום',
  numbered: false,
  fields: [{ id: 'remember', label: 'פרט אישי לזכור' }, ...extra, { id: 'focus', label: 'אתגר / נושא למעקב' }, { id: 'next', label: 'פעולת המשך, אם נדרשת' }],
});

export const TALK_FORMS: Record<TalkType, TalkSection[]> = {
  'שיחת היכרות': [
    one('opening', 'פתיחה', 'איך נפתחה השיחה, מה נאמר בתחילתה', false),
    {
      id: 'person',
      title: 'האדם שמחוץ למדים',
      numbered: true,
      fields: [
        { id: 'home', label: 'מגורים ומשפחה' },
        { id: 'family', label: 'רקע משפחתי' },
        { id: 'interests', label: 'תחביבים ותחומי עניין' },
        { id: 'background', label: 'רקע קודם' },
      ],
    },
    {
      id: 'path',
      title: 'הדרך לקצונה',
      numbered: true,
      fields: [
        { id: 'role', label: 'תפקיד נוכחי / קודם' },
        { id: 'motive', label: 'מניע אישי לקצונה' },
      ],
    },
    {
      id: 'strengths',
      title: 'חוזקה ואתגר',
      numbered: true,
      fields: [
        { id: 'strength', label: 'חוזקה' },
        { id: 'challenge', label: 'אתגר' },
      ],
    },
    one('know', 'מה חשוב שאדע כמפקד'),
    one('summary', 'סיכום', 'התמונה שעלתה מהשיחה', false),
    after({ id: 'motiveShort', label: 'המניע לקצונה' }, { id: 'strengthShort', label: 'חוזקה מרכזית' }),
  ],
  'שיחת אמצע': [
    one('feeling', 'תחושה כללית', 'איך הצוער מרגיש בקורס עד עכשיו', false),
    {
      id: 'progress',
      title: 'התקדמות',
      numbered: true,
      fields: [
        { id: 'goals', label: 'מול היעדים מהשיחה הקודמת' },
        { id: 'strength', label: 'חוזקות שבאו לידי ביטוי' },
        { id: 'improve', label: 'נקודות לשיפור' },
      ],
    },
    one('ahead', 'יעדים להמשך הקורס'),
    one('know', 'מה חשוב שאדע כמפקד'),
    one('summary', 'סיכום', undefined, false),
    after({ id: 'strengthShort', label: 'חוזקה מרכזית' }),
  ],
  'שיחת משוב': [
    one('subject', 'על מה המשוב', 'אירוע, משימה או תקופה', false),
    {
      id: 'feedback',
      title: 'המשוב',
      numbered: true,
      fields: [
        { id: 'good', label: 'מה היה טוב' },
        { id: 'improve', label: 'מה לשפר' },
        { id: 'view', label: 'איך הצוער רואה את זה' },
      ],
    },
    one('ahead', 'יעדים להמשך'),
    one('summary', 'סיכום', undefined, false),
    after(),
  ],
  'שיחה יזומה': [one('reason', 'סיבת השיחה', undefined, false), one('raised', 'מה עלה בשיחה'), one('agreed', 'מה סוכם'), after()],
  'שיחת סיום': [
    one('look', 'מבט לאחור על הקורס', undefined, false),
    one('strengths', 'חוזקות להמשך'),
    one('develop', 'נקודות לפיתוח בתפקיד הבא'),
    one('personal', 'מילה אישית'),
    after(),
  ],
};

export const isTalkType = (s: string): s is TalkType => (TALK_TYPES as readonly string[]).includes(s);

/** the fields a talk of this type has */
export const talkFields = (type: TalkType): TalkField[] => TALK_FORMS[type].flatMap((s) => s.fields);

/** only the fields of the form, trimmed; empty ones left out */
export function cleanAnswers(type: TalkType, raw: Record<string, unknown>): TalkAnswers {
  const out: TalkAnswers = {};
  for (const f of talkFields(type)) {
    const v = raw[f.id];
    if (typeof v === 'string' && v.trim()) out[f.id] = v.trim();
  }
  return out;
}

/** the sections with their numbers, as the form and the printed talk show them */
export function numberedSections(type: TalkType): { section: TalkSection; number: number | null }[] {
  let n = 0;
  return TALK_FORMS[type].map((section) => ({ section, number: section.numbered ? ++n : null }));
}

/** the talk as plain text: search, exports and the evaluation file read it like any record */
export function talkText(type: TalkType, answers: TalkAnswers): string {
  const parts: string[] = [];
  for (const { section, number } of numberedSections(type)) {
    const filled = section.fields.filter((f) => answers[f.id]);
    if (!filled.length) continue;
    const head = `${number ? `${number}. ` : ''}${section.title}`;
    if (section.fields.length === 1) parts.push(`${head}\n${answers[filled[0].id]}`);
    else parts.push(`${head}\n${filled.map((f) => `${f.label}: ${answers[f.id]}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** what to keep in mind about a cadet, from the latest talks: the newest answer to each */
export const TALK_HIGHLIGHTS: { label: string; ids: string[] }[] = [
  { label: 'פרט אישי לזכור', ids: ['remember'] },
  { label: 'המניע לקצונה', ids: ['motiveShort', 'motive'] },
  { label: 'חוזקה מרכזית', ids: ['strengthShort', 'strength'] },
  { label: 'נושא למעקב', ids: ['focus'] },
  { label: 'פעולת המשך', ids: ['next'] },
];

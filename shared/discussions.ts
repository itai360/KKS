// The kinds of discussion the staff holds - each with what it is for and the points it usually goes through
// (server/src/discussions.ts, client/src/pages/DiscussionsPage.tsx).

export const DISCUSSION_KINDS = ['planning', 'debrief', 'situation', 'decision', 'coordination', 'safety', 'cadets'] as const;
export type DiscussionKind = (typeof DISCUSSION_KINDS)[number];

export const DISCUSSION_KIND_LABELS: Record<DiscussionKind, string> = {
  planning: 'דיון תכנוני',
  debrief: 'דיון תחקירי',
  situation: 'הערכת מצב',
  decision: 'דיון החלטה',
  coordination: 'דיון תיאום',
  safety: 'דיון בטיחות',
  cadets: 'דיון צוערים',
};

/** what each is for - said where a discussion is opened */
export const DISCUSSION_KIND_HINTS: Record<DiscussionKind, string> = {
  planning: 'תכנון שבוע או פעילות: מטרות, לו"ז, משאבים ואחריות',
  debrief: 'מה תוכנן, מה קרה ולמה - ומה לוקחים הלאה',
  situation: 'תמונת מצב, פערים ואילוצים - ומה עושים עכשיו',
  decision: 'בעיה שדורשת הכרעה: חלופות, שיקולים והחלטה',
  coordination: 'סנכרון בין גורמים: מי עושה מה ומתי',
  safety: 'לפני פעילות: סיכונים, אמצעי מניעה ונהלים',
  cadets: 'מצב הצוערים: מי מתקשה, מי בולט, ומה עושים',
};

export const DISCUSSION_KIND_ICONS: Record<DiscussionKind, string> = {
  planning: 'plan',
  debrief: 'lightbulb',
  situation: 'pulse',
  decision: 'target',
  coordination: 'users',
  safety: 'shield',
  cadets: 'cap',
};

export const DISCUSSION_KIND_TONES: Record<DiscussionKind, string> = {
  planning: 'purple',
  debrief: 'yellow',
  situation: 'orange',
  decision: 'blue',
  coordination: 'green',
  safety: 'red',
  cadets: 'gray',
};

/** the points a discussion of the kind usually goes through - offered as it opens, to keep, change or drop */
export const DISCUSSION_POINTS: Record<DiscussionKind, string[]> = {
  planning: ['מטרות ויעדים', 'לו"ז ושלבים', 'משאבים ואמצעים', 'סיכונים ובטיחות', 'חלוקת אחריות'],
  debrief: ['מה תוכנן', 'מה קרה בפועל', 'למה - הסיבות לפער', 'מה לשמר', 'מה לשפר'],
  situation: ['תמונת המצב', 'משימות שעל הפרק', 'פערים ואילוצים', 'חלופות', 'מה עושים עכשיו'],
  decision: ['הבעיה וההחלטה הנדרשת', 'חלופות', 'שיקולים ומשמעויות', 'המלצה'],
  coordination: ['עדכון מכל גורם', 'תלויות בין הגורמים', 'נקודות פתוחות', 'מי עושה מה ומתי'],
  safety: ['הפעילות והסיכונים בה', 'אמצעי מניעה', 'נהלים ואישורים', 'כוננות ופינוי'],
  cadets: ['תמונה כללית', 'צוערים מתקשים', 'צוערים בולטים', 'שיחות והתערבויות נדרשות'],
};

export const isDiscussionKind = (v: unknown): v is DiscussionKind => typeof v === 'string' && (DISCUSSION_KINDS as readonly string[]).includes(v);

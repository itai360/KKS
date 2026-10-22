// What the staff (the team commanders and the lateral staff) may do, set by the course commander in the
// settings' permissions: by default nearly everything - the system's dangerous actions and the final
// approvals stay the commander's alone, whatever is set here.

export const STAFF_ABILITIES = [
  'tasks',
  'weeks',
  'schedule',
  'tracks',
  'templates',
  'plans',
  'meetings',
  'cadets',
  'teams',
  'imports',
  'cadetFiles',
  'announcements',
  'alignment',
] as const;

export type StaffAbility = (typeof STAFF_ABILITIES)[number];

/** what the commander set; an ability not set is at its default */
export type StaffPermissions = Partial<Record<StaffAbility, boolean>>;

export interface AbilityInfo {
  key: StaffAbility;
  label: string;
  /** what it lets them do */
  hint: string;
  /** on, until the commander turns it off */
  on: boolean;
}

export const ABILITY_GROUPS: { title: string; abilities: AbilityInfo[] }[] = [
  {
    title: 'משימות ותכנון',
    abilities: [
      { key: 'tasks', label: 'כל המשימות', hint: 'צפייה בכל המשימות (חוץ ממשימות פרטיות), ופתיחת משימה לכל אחד - גם לך ולכל הסגל יחד', on: true },
      { key: 'weeks', label: 'שבועות הקורס', hint: 'הוספת שבועות, תאריכים, שם ומפק"צ אחראי; פתיחה וסגירה של כל שבוע והעתקה מהמחזור הקודם', on: true },
      { key: 'schedule', label: 'לו"ז', hint: 'הוספה, עריכה, ביטול ומחיקה של אירועים בכל יום', on: true },
      { key: 'tracks', label: 'צירים', hint: 'הוספה, שם, אחראי ומחיקה', on: true },
      { key: 'templates', label: 'תבניות ומשימות חוזרות', hint: 'הוספה, עריכה ומחיקה - גם מלקח בתחקיר', on: true },
      { key: 'plans', label: 'הכנת אישור תוכניות ותלת שבועי', hint: 'צפייה ועריכה; האישור עצמו נשאר שלך', on: true },
      { key: 'meetings', label: 'ישיבת סגל', hint: 'פתיחה, ניהול, סיום וסימון נקודות שעלו', on: true },
    ],
  },
  {
    title: 'צוערים',
    abilities: [
      { key: 'cadets', label: 'צוערים בכל הצוותים', hint: 'הוספה, פרטים, העברה בין צוותים, פטורים ושיבוץ התנסויות', on: true },
      { key: 'teams', label: 'צוותים', hint: 'הוספה ועריכה של צוותים ומפקדיהם', on: true },
      { key: 'imports', label: 'ייבוא', hint: 'צוערים מקובץ או מגיליון, ציונים לתיקי ההערכה ומדרג האכיפה', on: true },
      {
        key: 'cadetFiles',
        label: 'תיקים אישיים של כל הצוותים',
        hint: 'תיקי הערכה, שיחות אישיות וסוציומטרי של כל הצוערים. כבוי: כל מפקד צוות - רק הצוות שלו',
        on: false,
      },
    ],
  },
  {
    title: 'סגל ותקשורת',
    abilities: [
      { key: 'announcements', label: 'הודעות לכל הסגל', hint: 'פרסום הודעה עם אישורי קריאה ותזכורת למי שלא קרא', on: true },
      { key: 'alignment', label: 'יישור קו', hint: 'הצמדה ומחיקה של הודעות', on: true },
    ],
  },
];

const DEFAULTS = Object.fromEntries(ABILITY_GROUPS.flatMap((g) => g.abilities.map((a) => [a.key, a.on]))) as Record<StaffAbility, boolean>;

/** whether the staff may do it, as the commander set it (or its default) */
export const staffMay = (perms: StaffPermissions | null | undefined, key: StaffAbility): boolean => perms?.[key] ?? DEFAULTS[key];

/** the commander's alone, whatever is set: shown beside the switches */
export const COMMANDER_ONLY: { title: string; items: string[] }[] = [
  {
    title: 'אישורים סופיים',
    items: [
      'סגירת משימה שסומן בה "נדרש אישור מפקד" - אישור או החזרה',
      'הארכת דד-ליין והעברה של משימה שפתחת',
      'אישור התחקיר השבועי',
      'אישור שבוע, אישור תוכניות ותלת שבועי',
      'סיום השבועי ושליחת הסיכום',
      'הפניה לוועדה והחלטת ועדה',
    ],
  },
  {
    title: 'פעולות מערכת',
    items: [
      'משתמשים, סיסמאות והרשאות',
      'הגדרות הקורס, תחומים וקבוצות סגל',
      'גיבויים ושחזור',
      'קורסים קודמים (כל הארכיון) ופתיחת קורס חדש',
      'חיבור יומני גוגל',
      'מחיקת שבוע, צוות או צוער (עם כל מה ששייך להם)',
    ],
  },
];

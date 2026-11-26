// The course's evaluation traits (צירי הערכה ומאפיינים): the one source of the axes, their sub-axes and the
// traits a commander picks when writing about a cadet - in the evaluation file, in the feedback after an
// experience, and anywhere else the site names them. Change them here only.
//
// Three levels: an axis; under it its sub-axes (חוסן has none - its traits are right under it); under each
// the traits to pick, one or several. A trait is its own choice in its own place: the same words under two
// sub-axes are two traits, each kept with its own axis and sub-axis.
//
// Every axis, sub-axis and trait has a stable id, kept with what is saved. A trait's id is its sub-axis'
// (or axis') id and its number here: a new trait takes the next number of its list, and a number once
// given is never given to another - so what was saved keeps meaning what it meant.

export interface Trait {
  id: string;
  name: string;
}

export interface TraitSubAxis {
  id: string;
  name: string;
  traits: readonly Trait[];
}

export interface TraitAxis {
  id: string;
  name: string;
  /** what the axis is about, in a line */
  about: string;
  /** its sub-axes, in order - none for חוסן */
  subAxes: readonly TraitSubAxis[];
  /** traits right under the axis, when it has no sub-axes */
  traits: readonly Trait[];
}

type Numbered = readonly (readonly [number, string])[];
const list = (owner: string, items: Numbered): Trait[] => items.map(([n, name]) => ({ id: `${owner}.${n}`, name }));
const sub = (axis: string, id: string, name: string, items: Numbered): TraitSubAxis => ({ id: `${axis}.${id}`, name, traits: list(`${axis}.${id}`, items) });

export const TRAIT_AXES: readonly TraitAxis[] = [
  {
    id: 'military',
    name: 'המקצוע הצבאי',
    about: 'היכולת להוביל משימה, לתכנן אותה ולהוציא אותה לפועל',
    traits: [],
    subAxes: [
      sub('military', 'lead', 'להוביל', [
        [1, 'יציאה מאזור הנוחות'],
        [2, 'מיקוד במסרים'],
        [3, 'וידוא ההבנה'],
        [4, 'תשדורת סמכותית'],
        [5, 'קריאת הקהל'],
        [6, 'כושר ביטוי'],
        [7, 'האצלת סמכויות'],
        [8, 'מיקום המפקד'],
      ]),
      sub('military', 'decide', 'להחליט', [
        [1, 'הפעלת שיקול דעת'],
        [2, 'הבחנה בין עיקר לטפל'],
        [3, 'פרואקטיביות'],
        [4, 'חשיבה ביקורתית'],
        [5, 'קביעת סדרי עדיפויות'],
        [6, 'קפדנות'],
      ]),
      sub('military', 'initiate', 'ליזום', [
        [1, 'חשיבה מחוץ לקופסה'],
        [2, 'תכנון משימה לאור המטרה'],
        [3, 'מקוריות'],
        [4, 'גזירת משמעויות'],
        [5, 'הגדלת ראש'],
        [6, 'יצירתיות'],
        [7, 'תכנון מול ביצוע'],
        [8, 'יעילות'],
        [9, 'ראייה כוללת'],
      ]),
      sub('military', 'prepare', 'להכין', [
        [1, 'יסודיות וירידה לפרטים'],
        [2, 'סדר וארגון'],
        [3, 'בקיאות'],
        [4, 'אבחון סיטואציות'],
        [5, 'היערכות מקדימה'],
      ]),
      sub('military', 'execute', 'לבצע', [
        [1, 'עשייה שקטה'],
        [2, 'ביצוע מעקב ובקרה'],
        [3, 'רצינות והשקעה'],
        [4, 'עבודה במקביל'],
        [5, 'ניסוח'],
        [6, 'תחבולנות'],
        [7, 'ניהול זמנים'],
        [8, 'עבודה מול רמה ממונה'],
        [9, 'מוסר עבודה'],
      ]),
      sub('military', 'learn', 'ללמוד', [
        [1, 'ניסוח בכתב'],
        [2, 'חתירה ללמידה ושיפור מתמיד'],
        [3, 'יכולת ניתוח והבנה'],
        [4, 'תחקיר אפקטיבי'],
        [5, 'גמישות מחשבתית'],
        [6, 'הפקת לקחים'],
        [7, 'דקדקנות'],
      ]),
    ],
  },
  {
    id: 'values',
    name: 'ערכים',
    about: 'העקרונות שמכוונים את ההתנהלות ואת אופן ביצוע המשימה',
    traits: [],
    subAxes: [
      sub('values', 'mission', 'דבקות במשימה וחתירה לניצחון', [
        [1, 'חתירה לידע'],
        [2, 'אפקטיביות'],
        [3, 'להט בעשייה'],
        [4, 'סקרנות'],
        [5, 'שאיפה למצוינות'],
        [6, 'חתירה למגע'],
        [7, 'חדשנות'],
      ]),
      sub('values', 'reliability', 'אמינות', [
        [1, 'דיוק'],
        [2, 'הוגנות'],
        [3, 'יושרה'],
        [4, 'אותנטיות'],
        [5, 'נאמנות'],
      ]),
      sub('values', 'responsibility', 'אחריות', [
        [1, 'עבודת צוות'],
        [2, 'התמדה'],
        [3, 'מעורבות'],
        [4, 'מקצועיות'],
        [5, 'עצמאות'],
        [6, 'ראייה מערכתית'],
        [7, 'דוגמה אישית'],
      ]),
      sub('values', 'calling', 'שליחות', [
        [1, 'נאמנות'],
        [2, 'מסירות'],
        [3, 'חיבור למשימה'],
        [4, 'ייצוגיות'],
      ]),
      sub('values', 'discipline', 'משמעת', [
        [1, 'קיום נהלים'],
        [2, 'תקיפות'],
        [3, 'הצבת סטנדרט'],
        [4, 'בקיאות'],
        [5, 'ממלכתיות'],
        [6, 'הצבת גבולות'],
        [7, 'פזיזות'],
      ]),
      sub('values', 'comradeship', 'רעות', [
        [1, 'סובלנות'],
        [2, 'עזרה הדדית'],
        [3, 'כבוד האדם'],
        [4, 'יחסי אנוש'],
        [5, 'הקשבה'],
      ]),
      sub('values', 'life', 'חיי אדם', [
        [1, 'אנושיות'],
        [2, 'בקרה על כוח האדם'],
        [3, 'ביקורתיות'],
        [4, 'אופטימיות'],
        [5, 'רגישות'],
        [6, 'טוהר הנשק'],
        [7, 'קשיחות'],
      ]),
    ],
  },
  {
    id: 'leadership',
    name: 'מנהיגות',
    about: 'היכולת להכיר את עצמך, להשפיע על אנשים ולפתח אותם',
    traits: [],
    subAxes: [
      sub('leadership', 'self', 'להכיר את עצמו ולהיות מודע לחוזקותיו וחולשותיו', [
        [1, 'עמידה מול קהל'],
        [2, 'דומיננטיות'],
        [3, 'צניעות'],
        [4, 'מודעות עצמית'],
        [5, 'ביטחון עצמי'],
        [6, 'תשדורת'],
        [7, 'ביקורת עצמית'],
      ]),
      sub('leadership', 'concept', 'יגבש תפיסה פיקודית', [
        [1, 'פתיחות'],
        [2, 'פועל לאור התפיסה הפיקודית'],
        [3, 'פשטות'],
        [4, 'העברת מסרים'],
        [5, 'פן אישי'],
      ]),
      sub('leadership', 'motivate', 'יעורר מוטיבציה', [
        [1, 'יחס מכבד'],
        [2, 'איזון בין דרישה להכלה'],
        [3, 'ריכוזיות'],
        [4, 'עירור עניין'],
        [5, 'אכיפת משמעת'],
        [6, 'הנעת פקודים'],
        [7, 'רתימת עמיתים'],
        [8, 'אסרטיביות'],
        [9, 'כריזמטיות'],
        [10, 'שיתוף הקהל'],
      ]),
      sub('leadership', 'stability', 'ייצור יציבות ובהירות', [
        [1, 'יצירת תמונת מצב'],
        [2, 'אסרטיביות'],
        [3, 'זמינות'],
        [4, 'מתן רציונל'],
        [5, 'תושייה'],
        [6, 'שקיפות'],
        [7, 'נוכחות'],
      ]),
      sub('leadership', 'develop', 'פיתוח פקודיו', [
        [1, 'ניהול דיון מעמיק'],
        [2, 'ניצול הזדמנויות חינוכיות'],
        [3, 'אתגור מחשבתי'],
        [4, 'ותרנות'],
        [5, 'פיתוח תחושת מסוגלות'],
        [6, 'יחס אישי'],
        [7, 'פיתוח פקודים'],
        [8, 'דאגה לפרט'],
        [9, 'יכולת חניכה'],
      ]),
      sub('leadership', 'decide', 'יקבל החלטות', [
        [1, 'בחירת נקודת התערבות'],
        [2, 'קריאת סיטואציות חברתיות'],
        [3, 'התאמה לקהל היעד'],
        [4, 'דעתנות'],
        [5, 'ביצוע הערכת מצב'],
        [6, 'אומץ פיקודי'],
      ]),
    ],
  },
  {
    id: 'resilience',
    name: 'חוסן',
    about: 'היכולת לשמור על תפקוד ועל שיקול דעת מול לחץ, קושי ושינוי',
    subAxes: [],
    traits: list('resilience', [
      [1, 'התמודדות עם אתגרים'],
      [2, 'קור רוח'],
      [3, 'רציפות תפקודית'],
      [4, 'שליטה ואיפוק'],
      [5, 'יכולת מתן וקבלת ביקורת'],
      [6, 'התמודדות עם בלת״מים'],
      [7, 'חוסן פיזי'],
      [8, 'הפרדה בין אישי למקצועי'],
      [9, 'הסתגלתנות'],
      [10, 'תעוזה'],
      [11, 'ייחודיות'],
      [12, 'נחישות'],
      [13, 'מסוגלות'],
      [14, 'חוסן מנטלי'],
      [15, 'הבעת עמדה'],
      [16, 'פרופורציות'],
      [17, 'תפקוד בתנאי לחץ'],
      [18, 'איתנות'],
      [19, 'פתיחות לשינויים'],
      [20, 'משמעת עצמית'],
      [21, 'אינטליגנציה רגשית'],
      [22, 'חשיבה רעננה'],
      [23, 'לכידות'],
      [24, 'תעצומות נפש'],
    ]),
  },
];

export const traitAxis = (id: string): TraitAxis | undefined => TRAIT_AXES.find((a) => a.id === id);
export const traitSubAxis = (axis: TraitAxis | undefined, id: string | null | undefined): TraitSubAxis | undefined => (id ? axis?.subAxes.find((s) => s.id === id) : undefined);

/** the traits to pick under an axis and its sub-axis (none: the axis has sub-axes and none was chosen) */
export function traitsUnder(axisId: string, subId: string | null | undefined): readonly Trait[] {
  const axis = traitAxis(axisId);
  if (!axis) return [];
  if (!axis.subAxes.length) return subId ? [] : axis.traits;
  return traitSubAxis(axis, subId)?.traits ?? [];
}

/** every trait with its place, in the catalog's order */
export interface TraitPlace {
  trait: Trait;
  axis: TraitAxis;
  sub: TraitSubAxis | null;
}
export const ALL_TRAITS: readonly TraitPlace[] = TRAIT_AXES.flatMap((axis): TraitPlace[] =>
  axis.subAxes.length ? axis.subAxes.flatMap((sub) => sub.traits.map((trait) => ({ trait, axis, sub }))) : axis.traits.map((trait) => ({ trait, axis, sub: null })),
);
const BY_ID = new Map(ALL_TRAITS.map((t) => [t.trait.id, t]));
export const traitPlace = (id: string) => BY_ID.get(id);

/** a choice as it is written in a cadet's file: an axis, its sub-axis (none under חוסן), the traits picked there and words on them */
export interface TraitGroup {
  axis: string;
  sub: string | null;
  /** the traits picked - each with its name as it was when picked, should the catalog later drop it */
  traits: { id: string; name: string }[];
  /** what the commander wrote on these traits (may be empty) */
  text: string;
}

/** a group's place in words: "המקצוע הצבאי · להוביל", or just the axis */
export function groupPlace(g: Pick<TraitGroup, 'axis' | 'sub'>): string {
  const axis = traitAxis(g.axis);
  const sub = traitSubAxis(axis, g.sub);
  return [axis?.name ?? g.axis, sub?.name].filter(Boolean).join(' · ');
}

/** a trait's name now (the catalog's), or as it was kept */
export const traitName = (t: { id: string; name: string }) => traitPlace(t.id)?.trait.name ?? t.name;

/**
 * What is wrong with a group, in words (null: nothing): the axis, the sub-axis it must have (and only one
 * of its own), at least one trait - each one of that place's own.
 */
export function groupProblem(g: { axis: string; sub?: string | null; traits: readonly string[] }): string | null {
  const axis = traitAxis(g.axis);
  if (!axis) return 'ציר לא מוכר';
  if (axis.subAxes.length) {
    if (!g.sub) return `בחרו תת ציר ב${axis.name}`;
    if (!traitSubAxis(axis, g.sub)) return `תת הציר לא שייך לציר ${axis.name}`;
  } else if (g.sub) return `לציר ${axis.name} אין תתי צירים`;
  if (!g.traits.length) return `בחרו לפחות מאפיין אחד ב${groupPlace({ axis: g.axis, sub: g.sub ?? null })}`;
  const own = new Set(traitsUnder(g.axis, g.sub).map((t) => t.id));
  if (g.traits.some((id) => !own.has(id))) return `מאפיין שלא שייך ל${groupPlace({ axis: g.axis, sub: g.sub ?? null })}`;
  if (new Set(g.traits).size !== g.traits.length) return 'מאפיין נבחר פעמיים';
  return null;
}

/** groups as text (the file's history, search): "המקצוע הצבאי · להוביל: מיקוד במסרים, כושר ביטוי" and the words under it */
export function groupsText(groups: readonly TraitGroup[]): string {
  return groups.map((g) => [`${groupPlace(g)}: ${g.traits.map(traitName).join(', ')}`, g.text.trim()].filter(Boolean).join('\n')).join('\n');
}

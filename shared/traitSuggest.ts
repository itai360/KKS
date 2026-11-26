// Which axis and trait (אופן המימוש) a few words about a cadet speak of - the built-in matcher, used when
// Claude is not set up on the server or does not answer. It reads the words the way Hebrew writes them:
// a word is compared without the letters joined to its front (ו, ה, ב, ל, מ, ש, כ), without the common
// endings, and once more without its vowel letters (ו, י) - so "האציל" meets "האצלת" and "תכננו" meets
// "תכנון". A trait is found by the words of its own name and by the everyday words a commander writes for
// it (TRAIT_HINTS below). It only ranks: the commander chooses.

import { ALL_TRAITS, type TraitPlace } from './evaluationTraits';
import { axisValue } from './experienceFeedback';

export interface TraitSuggestion {
  /** the trait's id in the catalog */
  trait: string;
  /** the point's axis as it keeps it: "axis - sub-axis", or the axis alone */
  axis: string;
  /** the trait's name (אופן המימוש) */
  title: string;
  /** why, in a few words */
  reason: string;
}

export interface TraitSuggestions {
  /** who recommended: Claude, or the built-in matcher */
  source: 'ai' | 'local';
  /** best first; none when nothing in the words fits */
  suggestions: TraitSuggestion[];
}

/** the most suggestions shown at once */
export const MAX_SUGGESTIONS = 3;
/** the fewest words worth recommending from */
export const SUGGEST_MIN_WORDS = 3;
/** the longest text read */
export const SUGGEST_MAX_CHARS = 2000;

export const wordCount = (text: string) => text.split(/\s+/).filter((w) => /[֐-׿A-Za-z]{2}/.test(w)).length;

const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const PREFIXES = 'והבלמשכ';
const SECOND: Record<string, string> = { ו: 'הבלמשכ', ש: 'הבלמכ', מ: 'ה', כ: 'ש' };
const SUFFIXES = ['יות', 'ים', 'ות', 'ה', 'ת', 'י', 'ו'];
const MIN_STEM = 3;

/** a word as compared: no points (niqqud), no quote marks, the final letters as the plain ones */
function plain(word: string): string {
  return word
    .replace(/[֑-ׇ]/g, '')
    .replace(/[״׳"'`]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c]);
}

/** without its vowel letters after the first: "תכנונ" and "תכננ" alike */
const skeleton = (w: string) => w[0] + w.slice(1).replace(/[וי]/g, '');

interface Keys {
  /** the word and its forms without front letters and endings */
  strong: Set<string>;
  /** the same without vowel letters - a looser match */
  weak: Set<string>;
}

const keyCache = new Map<string, Keys>();

function keysOf(raw: string): Keys {
  const word = plain(raw);
  const cached = keyCache.get(word);
  if (cached) return cached;
  const fronts = new Set([word]);
  if (PREFIXES.includes(word[0]) && word.length - 1 >= MIN_STEM) fronts.add(word.slice(1));
  // two letters in front only as Hebrew joins them: "וה", "שב", "כש", "מה"...
  if (SECOND[word[0]]?.includes(word[1]) && word.length - 2 >= MIN_STEM) fronts.add(word.slice(2));
  const strong = new Set<string>();
  for (const w of fronts) {
    strong.add(w);
    for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= MIN_STEM) strong.add(w.slice(0, -s.length));
  }
  const weak = new Set([...strong].map(skeleton).filter((w) => w.length >= MIN_STEM + 1));
  const keys = { strong, weak };
  keyCache.set(word, keys);
  return keys;
}

const words = (text: string) => plain(text).split(/[^א-תA-Za-z]+/).filter((w) => w.length >= 2);

/** words that say nothing of a trait on their own */
const STOP = new Set(['של', 'עם', 'בין', 'על', 'מול', 'לאור', 'את', 'אל', 'לפי', 'מתן', 'יכולת', 'וקבלת', 'לא', 'גם', 'הוא', 'היא', 'זה', 'כי', 'אבל', 'מאוד', 'היה', 'הייתה', 'יותר', 'כל', 'הכל', 'הכול', 'לכל', 'רגע', 'ברגע', 'מה', 'מי', 'שלו', 'שלה', 'אותו', 'אותה']);

/**
 * The everyday words for each trait, by its id: one word, or a phrase whose words must all be there.
 * Written as a commander would write them; the matcher finds their other forms.
 */
export const TRAIT_HINTS: Record<string, readonly string[]> = {
  'military.lead.1': ['אזור הנוחות', 'התנדב', 'לקח על עצמו'],
  'military.lead.2': ['מסר', 'ממוקד', 'מיקוד', 'מפוזר', 'תדריך'],
  'military.lead.3': ['וידא', 'הבנה', 'הבינו', 'שאלות הבנה'],
  'military.lead.4': ['סמכותי', 'טון', 'קול', 'נחרץ'],
  'military.lead.5': ['קהל', 'קרא את'],
  'military.lead.6': ['התבטא', 'רהוט', 'דיבור', 'הסביר', 'בהיר', 'שטף', 'תדריך'],
  'military.lead.7': ['האציל', 'האצלה', 'חילק', 'חלוקת תפקידים', 'תפקידים', 'סגנים', 'סגן', 'הטיל'],
  'military.lead.8': ['מיקום', 'מיקם', 'עמד בראש', 'מקדימה', 'מאחור'],
  'military.decide.1': ['שיקול דעת', 'החליט', 'החלטה', 'החלטות', 'החלטי', 'החלטיות'],
  'military.decide.2': ['עיקר', 'טפל', 'עיקרי', 'שולי'],
  'military.decide.3': ['יוזמה', 'יזם', 'מיוזמתו', 'מיוזמתה', 'פרואקטיבי', 'לפני שהתבקש'],
  'military.decide.4': ['ערער', 'בחן', 'הטיל ספק'],
  'military.decide.5': ['עדיפויות', 'עדיפות', 'תיעדף', 'תיעדוף'],
  'military.decide.6': ['הקפיד', 'הקפדה', 'קפדני'],
  'military.initiate.1': ['קופסה', 'פתרון יצירתי', 'שונה'],
  'military.initiate.2': ['תכנון', 'תכנן', 'תוכנית', 'מטרה', 'מטרת'],
  'military.initiate.3': ['מקורי', 'רעיון', 'רעיונות'],
  'military.initiate.4': ['משמעות', 'השלכות', 'גזר'],
  'military.initiate.5': ['הגדיל', 'מעבר לנדרש', 'מעבר למצופה'],
  'military.initiate.6': ['יצירתי'],
  'military.initiate.7': ['תכנון', 'ביצוע', 'בפועל'],
  'military.initiate.8': ['יעיל', 'מהיר', 'בזבוז'],
  'military.initiate.9': ['תמונה רחבה', 'מבט רחב', 'כוללת'],
  'military.prepare.1': ['פרטים', 'יסודי', 'פרט'],
  'military.prepare.2': ['מסודר', 'מאורגן', 'ארגון', 'בלגן', 'מבולגן', 'סדר'],
  'military.prepare.3': ['בקיא', 'ידע', 'שולט בחומר'],
  'military.prepare.4': ['אבחן', 'זיהה', 'סיטואציה'],
  'military.prepare.5': ['היערכות', 'נערך', 'הכין', 'הכנה', 'מוכן', 'מראש'],
  'military.execute.1': ['בשקט', 'שקט'],
  'military.execute.2': ['מעקב', 'בקרה', 'עקב', 'בדק'],
  'military.execute.3': ['השקיע', 'השקעה', 'רציני', 'רצינות'],
  'military.execute.4': ['במקביל', 'מקביל', 'כמה משימות'],
  'military.execute.5': ['ניסח', 'ניסוח'],
  'military.execute.6': ['תחבולה', 'אלתר', 'פתרונות'],
  'military.execute.7': ['זמן', 'זמנים', 'איחור', 'איחר', 'לוז', 'בזמן', 'דדליין', 'מאוחר', 'עמד בזמנים'],
  'military.execute.8': ['ממונה', 'דיווח', 'דיווחים', 'עדכן', 'עדכונים'],
  'military.execute.9': ['מוסר עבודה', 'חרוץ', 'עבד קשה'],
  'military.learn.1': ['בכתב', 'כתיבה', 'מסמך', 'כתב'],
  'military.learn.2': ['השתפר', 'שיפור', 'למד', 'למידה', 'התקדם'],
  'military.learn.3': ['ניתוח', 'ניתח', 'הבין'],
  'military.learn.4': ['תחקיר', 'תחקר', 'תחקור'],
  'military.learn.5': ['גמיש', 'גמישות'],
  'military.learn.6': ['לקחים', 'הפיק'],
  'military.learn.7': ['דקדקן', 'דייקן'],
  'values.mission.1': ['ידע', 'העמיק'],
  'values.mission.2': ['אפקטיבי'],
  'values.mission.3': ['להט', 'אנרגיה', 'התלהבות', 'נלהב'],
  'values.mission.4': ['סקרן', 'שאל שאלות'],
  'values.mission.5': ['מצוינות', 'מצטיין', 'רף גבוה'],
  'values.mission.6': ['מגע', 'הסתער'],
  'values.mission.7': ['חדשני', 'חדש'],
  'values.reliability.1': ['דיוק', 'מדויק', 'דייק'],
  'values.reliability.2': ['הוגן', 'צדק'],
  'values.reliability.3': ['יושר', 'אמת', 'הודה', 'שקר'],
  'values.reliability.4': ['אותנטי', 'כנה'],
  'values.reliability.5': ['נאמן'],
  'values.responsibility.1': ['צוות', 'שיתוף פעולה', 'ביחד', 'יחד'],
  'values.responsibility.2': ['התמיד', 'עקבי', 'לאורך זמן'],
  'values.responsibility.3': ['מעורב', 'השתתף'],
  'values.responsibility.4': ['מקצועי'],
  'values.responsibility.5': ['עצמאי', 'בעצמו', 'בעצמה', 'לבד'],
  'values.responsibility.6': ['מערכתי', 'מערכת'],
  'values.responsibility.7': ['דוגמה', 'דוגמא', 'מודל'],
  'values.calling.1': ['נאמן'],
  'values.calling.2': ['מסור', 'מסירות'],
  'values.calling.3': ['מחובר', 'חיבור'],
  'values.calling.4': ['ייצוגי', 'הופעה', 'לבוש'],
  'values.discipline.1': ['נהלים', 'נוהל', 'הוראות', 'פקודות'],
  'values.discipline.2': ['תקיף'],
  'values.discipline.3': ['סטנדרט', 'רף'],
  'values.discipline.4': ['בקיא'],
  'values.discipline.5': ['ממלכתי'],
  'values.discipline.6': ['גבולות', 'גבול'],
  'values.discipline.7': ['פזיז', 'נמהר', 'חפוז', 'מיהר', 'בחופזה'],
  'values.comradeship.1': ['סבלני', 'סבלנות'],
  'values.comradeship.2': ['עזר', 'עזרה', 'סייע'],
  'values.comradeship.3': ['כבוד', 'מכבד'],
  'values.comradeship.4': ['יחסים', 'חברותי'],
  'values.comradeship.5': ['הקשיב', 'הקשבה', 'קשוב'],
  'values.life.1': ['אנושי'],
  'values.life.2': ['כוח אדם', 'שלומם', 'ספירה'],
    'values.life.4': ['אופטימי', 'חיובי', 'מצב רוח'],
  'values.life.5': ['רגיש'],
  'values.life.6': ['נשק'],
  'values.life.7': ['קשוח'],
  'leadership.self.1': ['מול קהל', 'נאום', 'הציג'],
  'leadership.self.2': ['דומיננטי'],
  'leadership.self.3': ['צנוע'],
  'leadership.self.4': ['מודע', 'מודעות'],
  'leadership.self.5': ['ביטחון', 'בטוח', 'מהסס', 'היסוס', 'היסס'],
  'leadership.self.6': ['תשדורת'],
  'leadership.self.7': ['ביקורת עצמית', 'לקח אחריות'],
  'leadership.concept.1': ['פתוח'],
  'leadership.concept.2': ['תפיסה'],
  'leadership.concept.3': ['פשוט'],
  'leadership.concept.4': ['מסרים', 'העביר'],
  'leadership.concept.5': ['אישי'],
  'leadership.motivate.1': ['מכבד', 'כבוד'],
  'leadership.motivate.2': ['דרישה', 'הכלה', 'הכיל', 'דרש'],
  'leadership.motivate.3': ['ריכוזי', 'שליטה'],
  'leadership.motivate.4': ['עניין', 'מעניין', 'משעמם'],
  'leadership.motivate.5': ['אכף', 'אכיפה', 'משמעת'],
  'leadership.motivate.6': ['הניע', 'מוטיבציה', 'פקודים', 'חיילים'],
  'leadership.motivate.7': ['עמיתים', 'רתם', 'חברים'],
  'leadership.motivate.8': ['אסרטיבי'],
  'leadership.motivate.9': ['כריזמה', 'כריזמטי'],
  'leadership.motivate.10': ['שיתף', 'שיתוף'],
  'leadership.stability.1': ['תמונת מצב'],
  'leadership.stability.2': ['אסרטיבי'],
  'leadership.stability.3': ['זמין'],
  'leadership.stability.4': ['רציונל', 'הסביר למה'],
  'leadership.stability.5': ['תושייה'],
  'leadership.stability.6': ['שקוף', 'שקיפות'],
  'leadership.stability.7': ['נוכח', 'נוכחות'],
  'leadership.develop.1': ['דיון'],
  'leadership.develop.2': ['חינוכי', 'הזדמנות'],
  'leadership.develop.3': ['אתגר', 'אתגור'],
  'leadership.develop.5': ['מסוגלות'],
  'leadership.develop.6': ['שיחה אישית', 'אישי'],
  'leadership.develop.7': ['פיתח', 'פקודים'],
  'leadership.develop.8': ['דאג', 'דאגה'],
  'leadership.develop.9': ['חניכה', 'חנך', 'לימד'],
  'leadership.decide.1': ['התערב', 'התערבות'],
  'leadership.decide.2': ['חברתי', 'חברתית'],
  'leadership.decide.3': ['קהל היעד', 'התאים'],
  'leadership.decide.4': ['דעתן', 'דעה'],
  'leadership.decide.5': ['הערכת מצב'],
  'leadership.decide.6': ['אומץ', 'העז'],
  'resilience.1': ['אתגר', 'קושי', 'קשיים', 'התמודד'],
  'resilience.2': ['קור רוח', 'רגוע', 'שלווה', 'נלחץ'],
  'resilience.3': ['רציפות', 'תפקד לאורך'],
  'resilience.4': ['התפרץ', 'כעס', 'איפוק', 'עצבים', 'נסער'],
  'resilience.5': ['ביקורת', 'משוב', 'הערות', 'קיבל ביקורת', 'יישם'],
  'resilience.6': ['בלתמ', 'הפתעה', 'לא צפוי', 'שינוי'],
  'resilience.7': ['פיזי', 'כושר', 'מסע', 'עייפות'],
  'resilience.8': ['אישי', 'מקצועי'],
  'resilience.9': ['הסתגל', 'הסתגלות'],
  'resilience.10': ['תעוזה', 'העז'],
  'resilience.12': ['נחוש', 'ויתר', 'התעקש'],
  'resilience.13': ['מסוגל'],
  'resilience.14': ['מנטלי'],
  'resilience.15': ['הביע', 'דעה', 'הביע עמדה'],
  'resilience.16': ['פרופורציה'],
  'resilience.17': ['לחץ', 'לחוץ', 'עומס'],
  'resilience.19': ['שינויים', 'פתוח לשינוי'],
  'resilience.20': ['משמעת עצמית'],
  'resilience.21': ['רגשי', 'רגשות', 'אמפתיה'],
  'resilience.24': ['תעצומות'],
};

interface TextIndex {
  strong: Map<string, string>;
  weak: Map<string, string>;
}

/** every form of every word in the text, each pointing back at the word as written */
function indexText(text: string): TextIndex {
  const strong = new Map<string, string>();
  const weak = new Map<string, string>();
  for (const w of text.split(/\s+/)) {
    const shown = w.replace(/^[^א-תA-Za-z]+|[^א-תA-Za-z״׳"']+$/g, '');
    for (const part of words(w)) {
      if (STOP.has(part)) continue;
      const k = keysOf(part);
      for (const s of k.strong) if (!strong.has(s)) strong.set(s, shown);
      for (const s of k.weak) if (!weak.has(s)) weak.set(s, shown);
    }
  }
  return { strong, weak };
}

/** how well a word is found in the text: 1 as it is, 0.6 by its letters alone, 0 not at all - and the word found */
function find(word: string, ix: TextIndex): { score: number; seen: string | null } {
  const k = keysOf(word);
  for (const s of k.strong) if (ix.strong.has(s)) return { score: 1, seen: ix.strong.get(s)! };
  for (const s of k.weak) if (ix.weak.has(s)) return { score: 0.6, seen: ix.weak.get(s)! };
  return { score: 0, seen: null };
}

const nameWords = (name: string) => words(name).filter((w) => !STOP.has(w));

// how telling each word of the traits' names is: rare words weigh more than "חשיבה" or "תכנון"
const DF = new Map<string, number>();
for (const t of ALL_TRAITS) for (const w of new Set(nameWords(t.trait.name))) DF.set(w, (DF.get(w) ?? 0) + 1);
const idf = (w: string) => Math.log(1 + ALL_TRAITS.length / (DF.get(w) ?? 1));

const HINT_WEIGHT = 2.5;
const MIN_SCORE = 1.5;
/** a suggestion far behind the best one is left out */
const NEAR_BEST = 0.45;

function scoreTrait(t: TraitPlace, ix: TextIndex): { score: number; seen: string[] } {
  const seen = new Set<string>();
  const own = nameWords(t.trait.name);
  let matched = 0;
  let nameScore = 0;
  for (const w of own) {
    const f = find(w, ix);
    if (!f.score) continue;
    matched++;
    nameScore += f.score * idf(w);
    seen.add(f.seen!);
  }
  // a name half found counts for less than one found whole
  let score = own.length ? nameScore * (matched / own.length) : 0;
  for (const hint of TRAIT_HINTS[t.trait.id] ?? []) {
    const parts = words(hint).filter((w) => !STOP.has(w));
    const found = parts.map((w) => find(w, ix));
    if (!parts.length || found.some((f) => !f.score)) continue;
    score += HINT_WEIGHT * Math.min(...found.map((f) => f.score));
    for (const f of found) seen.add(f.seen!);
  }
  return { score, seen: [...seen] };
}

/** a point's axis for a trait in its place */
export const placeAxis = (t: TraitPlace) => axisValue(t.axis.name, t.sub?.name ?? t.axis.name);

/** The traits the words speak of, best first (none when nothing fits). */
export function suggestTraitsLocal(text: string, max = MAX_SUGGESTIONS): TraitSuggestion[] {
  const ix = indexText(text.slice(0, SUGGEST_MAX_CHARS));
  if (!ix.strong.size) return [];
  const ranked = ALL_TRAITS.map((t, order) => ({ t, order, ...scoreTrait(t, ix) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked
    .filter((r) => r.score >= ranked[0].score * NEAR_BEST)
    .slice(0, max)
    .map(({ t, seen }) => ({
      trait: t.trait.id,
      axis: placeAxis(t),
      title: t.trait.name,
      reason: `לפי המילים: ${seen
        .slice(0, 3)
        .map((w) => `"${w}"`)
        .join(', ')}`,
    }));
}

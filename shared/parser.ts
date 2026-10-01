// Section 27 - create a task from free Hebrew text, e.g.
//   "תפתח למפק"צ 2 משימה לסגור את המטווח עד יום רביעי בשעה 18:00 בעדיפות גבוהה"
// -> title "סגירת מטווח", owner מפק"צ 2, deadline Wednesday 18:00, priority high.
// Rule-based on purpose: works offline and its result is always shown to the user
// as an editable preview before anything is created.

import { WEEKDAY_NAMES, type Priority } from './constants';
import { addDays, DEFAULT_TZ, localDateKey, localTime, toDateKey, weekdayOf, zonedIso } from './dates';

export interface ParseUser {
  id: number;
  displayName: string;
  title?: string;
  username?: string;
}

export interface ParseContext {
  users: ParseUser[];
  weeks?: { id: number; name: string }[];
  domains?: string[];
  now?: Date;
  tz?: string;
  defaultTime?: string;
}

export interface ParsedTask {
  title: string;
  ownerIds: number[];
  allStaff: boolean;
  deadline: string | null;
  deadlineDate: string | null;
  deadlineTime: string | null;
  priority: Priority | null;
  domain: string | null;
  weekId: number | null;
  missing: ('title' | 'owner' | 'deadline')[];
}

const HB = '\\u0590-\\u05FF';
const LB = `(?<![${HB}\\w])`; // word start (JS \b does not understand Hebrew)
const RB = `(?![${HB}\\w])`; // word end

export function normalizeHebrew(s: string): string {
  return s
    .replace(/[״“”„׳]/g, (c) => (c === '׳' ? "'" : '"'))
    .replace(/[‘’]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex source for a name where quote marks are optional (מפק"צ == מפקצ). */
function looseNameSource(name: string): string {
  const n = normalizeHebrew(name).replace(/["']/g, '');
  return n
    .split('')
    .map((ch) => (ch === ' ' ? '\\s*' : escapeRe(ch) + `["']?`))
    .join('');
}

interface Span {
  start: number;
  end: number;
}

class Extractor {
  text: string;
  private removed: Span[] = [];
  constructor(text: string) {
    this.text = text;
  }
  /** Find the first match not overlapping already-consumed text. */
  take(re: RegExp): RegExpExecArray | null {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(this.text))) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      if (!this.removed.some((r) => span.start < r.end && span.end > r.start)) {
        this.removed.push(span);
        return m;
      }
    }
    return null;
  }
  remaining(): string {
    const chars = this.text.split('');
    for (const r of this.removed) for (let i = r.start; i < r.end; i++) chars[i] = ' ';
    return chars.join('').replace(/\s+/g, ' ').trim();
  }
}

// Infinitive -> construct-state noun, so "לסגור את המטווח" becomes "סגירת מטווח".
const VERB_TO_NOUN: Record<string, string> = {
  לסגור: 'סגירת',
  לתאם: 'תיאום',
  להכין: 'הכנת',
  לבדוק: 'בדיקת',
  לבנות: 'בניית',
  להפיץ: 'הפצת',
  לעדכן: 'עדכון',
  לאשר: 'אישור',
  להזמין: 'הזמנת',
  לארגן: 'ארגון',
  לשלוח: 'שליחת',
  לכתוב: 'כתיבת',
  לקבוע: 'קביעת',
  לוודא: 'וידוא',
  לתדרך: 'תדרוך',
  להעביר: 'העברת',
  לסכם: 'סיכום',
  לפתוח: 'פתיחת',
  לעבור: 'מעבר',
  להגיש: 'הגשת',
  לתקן: 'תיקון',
  לרכז: 'ריכוז',
  לאסוף: 'איסוף',
  להוציא: 'הוצאת',
  לקבל: 'קבלת',
  לבצע: 'ביצוע',
  לנהל: 'ניהול',
  לתכנן: 'תכנון',
  להדפיס: 'הדפסת',
  להחזיר: 'החזרת',
  לחלק: 'חלוקת',
  לסדר: 'סידור',
  להשיג: 'השגת',
  לברר: 'בירור',
  לטפל: 'טיפול',
  לקיים: 'קיום',
  לפרסם: 'פרסום',
  למלא: 'מילוי',
  לשבץ: 'שיבוץ',
  להקצות: 'הקצאת',
  לבקש: 'בקשת',
  להשלים: 'השלמת',
  לסיים: 'סיום',
  להקדים: 'הקדמת',
  לדחות: 'דחיית',
  לבטל: 'ביטול',
  לאמת: 'אימות',
  להעריך: 'הערכת',
  לתרגל: 'תרגול',
  להדריך: 'הדרכת',
  לשריין: 'שריון',
  לתחקר: 'תחקור',
  להכשיר: 'הכשרת',
  לרשום: 'רישום',
  להציג: 'הצגת',
  לנסח: 'ניסוח',
  לאתר: 'איתור',
  לגייס: 'גיוס',
};

const COMMAND_WORDS = new Set([
  'תפתח',
  'פתח',
  'תפתחי',
  'תפתחו',
  'צור',
  'תיצור',
  'תצור',
  'תיצרי',
  'הוסף',
  'תוסיף',
  'תוסיפי',
  'רשום',
  'תרשום',
  'תן',
  'תני',
  'משימה',
  'חדשה',
  'בבקשה',
]);

const DOMAIN_KEYWORDS: [RegExp, string][] = [
  [/לו"?ז/, 'לו"ז'],
  [/בטיחות|מטווח|ירי/, 'בטיחות'],
  [/תיאום|לתאם/, 'תיאומים'],
  [/ציוד|הסע|לוגיסט|תחמושת|אפסנא/, 'לוגיסטיקה'],
  [/שיעור|הדרכ|מדריך|מצגת|תרגיל/, 'הדרכה'],
  [/צוער/, 'צוערים'],
  [/משמעת|ריתוק/, 'משמעת'],
  [/הערכ|משוב|ציון/, 'הערכה'],
];

function nextWeekday(todayKey: string, target: number): string {
  const cur = weekdayOf(todayKey);
  let diff = (target - cur + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(todayKey, diff);
}

export function parseTaskText(input: string, ctx: ParseContext): ParsedTask {
  const tz = ctx.tz ?? DEFAULT_TZ;
  const now = ctx.now ?? new Date();
  const defaultTime = ctx.defaultTime ?? '18:00';
  const todayKey = localDateKey(now, tz);
  const text = normalizeHebrew(input);
  const ex = new Extractor(text);

  // --- owners ---
  let allStaff = false;
  if (ex.take(new RegExp(`${LB}[ול]{0,2}כל\\s+(ה)?סגל${RB}`))) allStaff = true;

  const candidates: { id: number; source: string; len: number }[] = [];
  for (const u of ctx.users) {
    for (const name of [u.displayName, u.title]) {
      if (!name || !name.trim()) continue;
      candidates.push({ id: u.id, source: looseNameSource(name), len: name.length });
    }
  }
  candidates.sort((a, b) => b.len - a.len);
  const owners: { id: number; at: number }[] = [];
  for (const c of candidates) {
    if (owners.some((o) => o.id === c.id)) continue;
    const m = ex.take(new RegExp(`${LB}[ולמבהש]{0,2}(?:${c.source})(?![${HB}\\w\\d])`));
    if (m) owners.push({ id: c.id, at: m.index });
  }
  owners.sort((a, b) => a.at - b.at);

  // --- priority ---
  let priority: Priority | null = null;
  const pm = ex.take(new RegExp(`${LB}ב?עדיפות\\s+(נמוכה|רגילה|גבוהה|קריטית)${RB}`));
  if (pm) {
    priority = ({ נמוכה: 'low', רגילה: 'normal', גבוהה: 'high', קריטית: 'critical' } as const)[
      pm[1] as 'נמוכה' | 'רגילה' | 'גבוהה' | 'קריטית'
    ];
  } else if (ex.take(new RegExp(`${LB}(קריטי|קריטית|בהול|בהולה)${RB}`))) {
    priority = 'critical';
  } else if (ex.take(new RegExp(`${LB}(דחוף|דחופה|בדחיפות)${RB}`))) {
    priority = 'high';
  }

  // --- time ---
  let time: string | null = null;
  const pmHint = new RegExp(`${LB}(בערב|אחה"?צ|אחר\\s+הצהריים|בלילה)${RB}`).test(text);
  const tm = ex.take(new RegExp(`${LB}(?:עד\\s+)?(?:ב(?:שעה)?\\s*-?\\s*)?([01]?\\d|2[0-3]):([0-5]\\d)(?!\\d)`));
  if (tm) {
    let h = Number(tm[1]);
    if (pmHint && h < 12) h += 12;
    time = `${String(h).padStart(2, '0')}:${tm[2]}`;
  } else {
    const hm = ex.take(new RegExp(`${LB}(?:עד\\s+)?בשעה\\s+([01]?\\d|2[0-3])(?![\\d:])`));
    if (hm) {
      let h = Number(hm[1]);
      if (pmHint && h < 12) h += 12;
      time = `${String(h).padStart(2, '0')}:00`;
    }
  }
  const partOfDay = ex.take(new RegExp(`${LB}(בבוקר|בצהריים|בצהרים|בערב|הערב|בלילה|אחה"?צ|אחר\\s+הצהריים)${RB}`));
  if (partOfDay && !time) {
    const w = partOfDay[1];
    time = w === 'בבוקר' ? '08:00' : w.startsWith('בצהר') ? '12:00' : w === 'בלילה' ? '22:00' : w.startsWith('אח') ? '16:00' : '20:00';
  }

  // --- date ---
  let date: string | null = null;
  if (partOfDay && partOfDay[1] === 'הערב') date = todayKey;
  const dayNames = WEEKDAY_NAMES.join('|');
  const wd =
    ex.take(new RegExp(`${LB}(?:עד\\s+)?(?:ה|ב|ל)?יום\\s+(${dayNames})${RB}`)) ??
    ex.take(new RegExp(`${LB}עד\\s+(?:ה|ל)?(${dayNames})${RB}`));
  if (wd) {
    date = nextWeekday(todayKey, WEEKDAY_NAMES.indexOf(wd[1] as (typeof WEEKDAY_NAMES)[number]));
  } else {
    const rel = ex.take(new RegExp(`${LB}(?:עד\\s+)?(?:ל)?(היום|מחרתיים|מחר)${RB}`));
    if (rel) {
      date = rel[1] === 'היום' ? todayKey : rel[1] === 'מחר' ? addDays(todayKey, 1) : addDays(todayKey, 2);
    } else {
      const inDays = ex.take(new RegExp(`${LB}(?:עד\\s+)?בעוד\\s+(?:(\\d+)\\s+ימים|(יומיים)|(שבוע)|(שבועיים))${RB}`));
      if (inDays) {
        const n = inDays[1] ? Number(inDays[1]) : inDays[2] ? 2 : inDays[3] ? 7 : 14;
        date = addDays(todayKey, n);
      } else {
        const explicit = ex.take(
          new RegExp(`${LB}(?:עד\\s+)?(?:ה|ב|ל)?-?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?(?![\\d:])`),
        );
        if (explicit) {
          const d = Number(explicit[1]);
          const mo = Number(explicit[2]);
          let y = explicit[3] ? Number(explicit[3]) : Number(todayKey.slice(0, 4));
          if (y < 100) y += 2000;
          if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
            let key = toDateKey(y, mo, d);
            if (!explicit[3] && key < addDays(todayKey, -60)) key = toDateKey(y + 1, mo, d);
            date = key;
          }
        } else if (ex.take(new RegExp(`${LB}(?:עד\\s+)?(?:ל)?סוף\\s+(ה)?שבוע${RB}`))) {
          const thu = addDays(todayKey, 4 - weekdayOf(todayKey));
          date = thu >= todayKey ? thu : addDays(thu, 7);
        } else if (ex.take(new RegExp(`${LB}(?:עד\\s+)?(?:ב|ל)?שבוע\\s+הבא${RB}`))) {
          date = nextWeekday(todayKey, 0);
        }
      }
    }
  }

  let deadlineDate: string | null = date;
  let deadlineTime: string | null = null;
  if (date) {
    deadlineTime = time ?? defaultTime;
  } else if (time) {
    deadlineTime = time;
    deadlineDate = time > localTime(now, tz) ? todayKey : addDays(todayKey, 1);
  }
  const deadline = deadlineDate && deadlineTime ? zonedIso(deadlineDate, deadlineTime, tz) : null;

  // --- title ---
  let words = ex
    .remaining()
    .split(' ')
    .filter((w) => w.length > 0);
  const isPunct = (w: string) => /^[-:,.;!?]+$/.test(w);
  while (words.length && (COMMAND_WORDS.has(words[0]) || isPunct(words[0]))) words.shift();
  while (words.length && (['עד', 'ב', 'ל', 'בשעה', 'ו', 'עם'].includes(words[words.length - 1]) || isPunct(words[words.length - 1])))
    words.pop();
  if (words.length && /^[-:]/.test(words[0])) words[0] = words[0].replace(/^[-:]+/, '');
  words = words.filter((w) => w.length > 0);
  if (words.length) {
    const noun = VERB_TO_NOUN[words[0]];
    if (noun) {
      words[0] = noun;
      if (words[1] === 'את') {
        words.splice(1, 1);
        if (words[1] && words[1].startsWith('ה') && words[1].length > 2) words[1] = words[1].slice(1);
      }
    }
  }
  const title = words.join(' ').replace(/\s+([,.:;!?])/g, '$1').replace(/[.,;]+$/, '').trim();

  // --- week & domain ---
  let weekId: number | null = null;
  for (const w of ctx.weeks ?? []) {
    if (w.name && text.includes(normalizeHebrew(w.name))) {
      weekId = w.id;
      break;
    }
  }
  let domain: string | null = null;
  for (const [re, d] of DOMAIN_KEYWORDS) {
    if (re.test(text) && (!ctx.domains || ctx.domains.includes(d))) {
      domain = d;
      break;
    }
  }

  const ownerIds = owners.map((o) => o.id);
  const missing: ParsedTask['missing'] = [];
  if (!title) missing.push('title');
  if (!ownerIds.length && !allStaff) missing.push('owner');
  if (!deadline) missing.push('deadline');

  return { title, ownerIds, allStaff, deadline, deadlineDate, deadlineTime, priority, domain, weekId, missing };
}

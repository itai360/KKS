// Quick add in the schedule: one line of Hebrew becomes an event, the way Fantastical and Google
// Calendar's quick add read a sentence, e.g.
//   "מטווח מחר 10-12 @שטח 30"                      -> מטווח, tomorrow 10:00-12:00, at שטח 30
//   "תדריך בטיחות ביום שלישי ב-8 בבוקר אחראי מפק"צ 2" -> Tuesday 08:00, owned by מפק"צ 2
// Rule-based like the task parser (parser.ts): it works offline, and what it read is always shown as
// a live preview before anything is made.

import { WEEKDAY_NAMES } from './constants';
import { addDays, DEFAULT_TZ, diffDays, localDateKey, startOfWeek, toDateKey } from './dates';
import { Extractor, HB, LB, looseNameSource, normalizeHebrew, type ParseUser, RB } from './parser';

export interface ParsedEvent {
  title: string;
  date: string;
  /** false: the text names no day - the day open in the calendar */
  dateGiven: boolean;
  /** null: the text has no time (an event needs one, so the full form asks for it) */
  startTime: string | null;
  endTime: string | null;
  location: string;
  ownerId: number | null;
}

export interface EventParseContext {
  users: ParseUser[];
  /** the day open in the calendar: the event goes there when the text names no day */
  defaultDate: string;
  now?: Date;
  tz?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const HOUR = '([01]?\\d|2[0-3])';
const MIN = '([0-5]\\d)';
/** an hour, with or without its minutes: "8", "08", "8:30" */
const CLOCK = `${HOUR}(?::${MIN})?`;
/** not a longer number, a date or a time going on */
const ENDS = '(?![\\d:./])';
/** "ב-10", "בשעה 10", "בשעות 10-12", "מ-10", "משעה 10", "בין 10" */
const AT = `(?:בין\\s+(?:השעות\\s+)?|מ(?:ה?שעה)?\\s*-?\\s*|ב(?:שעה|שעות)?\\s*-?\\s*)`;
const PARTS = `בבוקר|בצהריים|בצהרים|אחה"?צ|אחר\\s+הצהריים|אחרי\\s+הצהריים|בערב|הערב|בלילה|הלילה`;

/** minutes from midnight, held inside the day */
const minutes = (h: number, m: number) => Math.min(24 * 60 - 1, h * 60 + m);
const clock = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** the hour as the part of the day says: "4 אחה"צ" is 16:00, "2 בלילה" stays 02:00 */
function byPartOfDay(h: number, part: string | null): number {
  if (part?.endsWith('לילה') && h === 12) return 0;
  if (!part || h >= 12) return h;
  if (part.startsWith('אח') || part.endsWith('ערב')) return h + 12;
  if (part.startsWith('בצהר')) return h <= 6 ? h + 12 : h;
  if (part.endsWith('לילה')) return h >= 6 ? h + 12 : h;
  return h;
}

const PART_DEFAULT: [RegExp, string][] = [
  [/^בבוקר$/, '08:00'],
  [/^בצהר/, '12:00'],
  [/^אח/, '16:00'],
  [/ערב$/, '20:00'],
  [/לילה$/, '22:00'],
];

const LEADING = new Set(['הוסף', 'הוסיפי', 'תוסיף', 'תוסיפי', 'צור', 'תיצור', 'קבע', 'תקבע', 'קבעי', 'רשום', 'תרשום', 'אירוע', 'פעילות', 'חדש', 'חדשה', 'ללו"ז', 'בלו"ז', 'ללוז', 'בלוז']);
const TRAILING = new Set(['ב', 'ב-', 'מ', 'מ-', 'עד', 'בין', 'ל', 'ל-', 'ו', 'בשעה', 'ביום', 'של', 'עם', 'ב־']);
const isPunct = (w: string) => /^[-:,.;!?]+$/.test(w);

/** the day a weekday names: in the week open in the calendar, never in the past */
function weekdayDate(target: number, next: boolean, base: string, today: string): string {
  if (next) return addDays(startOfWeek(today), 7 + target);
  const d = addDays(startOfWeek(base), target);
  return d >= today ? d : addDays(d, 7 * Math.ceil(diffDays(today, d) / 7));
}

export function parseEventText(input: string, ctx: EventParseContext): ParsedEvent {
  const tz = ctx.tz ?? DEFAULT_TZ;
  const today = localDateKey(ctx.now ?? new Date(), tz);
  const text = normalizeHebrew(input);
  const ex = new Extractor(text);

  // --- owner: only after "אחראי", so a name in the title stays in the title ---
  let ownerId: number | null = null;
  const candidates = ctx.users
    .flatMap((u) => [u.displayName, u.title].filter((n): n is string => !!n?.trim()).map((n) => ({ id: u.id, source: looseNameSource(n), len: n.length })))
    .sort((a, b) => b.len - a.len);
  for (const c of candidates) {
    if (ex.take(new RegExp(`${LB}ו?(?:אחראי|אחראית|באחריות)\\s*[:-]?\\s*[ולמבהש]{0,2}(?:${c.source})(?![${HB}\\w\\d])`))) {
      ownerId = c.id;
      break;
    }
  }

  // --- time: a range, a length, or one time; the part of the day sets the hour ---
  const partMatch = new RegExp(`${LB}(${PARTS})${RB}`).exec(text);
  const part = partMatch ? partMatch[1] : null;
  let start: number | null = null;
  let end: number | null = null;
  const range = ex.take(new RegExp(`${LB}${AT}?${CLOCK}\\s*(?:-|עד(?:\\s+השעה)?|ל\\s*-?|ועד)\\s*${CLOCK}${ENDS}(?!\\s*(?:שעות|שעה|דקות|דק))`));
  if (range) {
    start = minutes(byPartOfDay(Number(range[1]), part), Number(range[2] ?? 0));
    let eh = byPartOfDay(Number(range[3]), part);
    // "10-2": past noon
    if (minutes(eh, Number(range[4] ?? 0)) <= start && eh < 12 && minutes(eh + 12, 0) > start) eh += 12;
    end = minutes(eh, Number(range[4] ?? 0));
  } else {
    const one =
      ex.take(new RegExp(`${LB}${AT}?${HOUR}:${MIN}${ENDS}`)) ??
      ex.take(new RegExp(`${LB}(?:בשעה\\s+|ב\\s*-\\s*|ב)${HOUR}${ENDS}()`)) ??
      ex.take(new RegExp(`${LB}${HOUR}${ENDS}()(?=\\s+(?:${PARTS})${RB})`));
    if (one) start = minutes(byPartOfDay(Number(one[1]), part), Number(one[2] || 0));
  }
  const length = ex.take(
    new RegExp(`${LB}(?:למשך\\s+|ל\\s*-?\\s*)(?:(\\d{1,3})\\s*(שעות|שעה|דקות|דק'?)|(שעה\\s+וחצי)|(שעתיים)|(חצי\\s+שעה)|(רבע\\s+שעה)|(שעה))${RB}`),
  );
  if (length && start !== null && end === null) {
    const mins = length[1] ? Number(length[1]) * (length[2].startsWith('ש') ? 60 : 1) : length[3] ? 90 : length[4] ? 120 : length[5] ? 30 : length[6] ? 15 : 60;
    end = Math.min(24 * 60 - 1, start + mins);
  }
  const partTaken = ex.take(new RegExp(`${LB}(${PARTS})${RB}`));
  if (start === null && partTaken) {
    const w = partTaken[1];
    const at = PART_DEFAULT.find(([re]) => re.test(w))?.[1];
    if (at) start = minutes(Number(at.slice(0, 2)), 0);
  }

  // --- day ---
  let date: string | null = partTaken && /^ה(ערב|לילה)$/.test(partTaken[1]) ? today : null;
  const names = WEEKDAY_NAMES.join('|');
  const LETTERS = 'אבגדהוש';
  const wd =
    ex.take(new RegExp(`${LB}(?:ה|ב|ל)?יום\\s+(${names})(?:\\s+(הבא|הקרוב))?${RB}`)) ??
    ex.take(new RegExp(`${LB}(?:ה|ב|ל)?יום\\s+([${LETTERS}])'(?:\\s+(הבא|הקרוב))?`)) ??
    // "בחמישי"; not "בשני", which is as often "in two"
    ex.take(new RegExp(`${LB}ב(ראשון|שלישי|רביעי|חמישי|שישי|שבת)(?:\\s+(הבא|הקרוב))?${RB}`));
  if (wd) {
    const target = wd[1].length === 1 ? LETTERS.indexOf(wd[1]) : WEEKDAY_NAMES.indexOf(wd[1] as (typeof WEEKDAY_NAMES)[number]);
    date = weekdayDate(target, wd[2] === 'הבא', ctx.defaultDate > today ? ctx.defaultDate : today, today);
  } else {
    const rel = ex.take(new RegExp(`${LB}(?:ל)?(היום|מחרתיים|מחר)${RB}`));
    if (rel) date = rel[1] === 'היום' ? today : addDays(today, rel[1] === 'מחר' ? 1 : 2);
    else {
      const inDays = ex.take(new RegExp(`${LB}בעוד\\s+(?:(\\d+)\\s+ימים|(יומיים)|(שבוע)|(שבועיים))${RB}`));
      if (inDays) date = addDays(today, inDays[1] ? Number(inDays[1]) : inDays[2] ? 2 : inDays[3] ? 7 : 14);
      else {
        const dm = ex.take(new RegExp(`${LB}(?:ה|ב|ל)?-?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${ENDS}`));
        if (dm) {
          const d = Number(dm[1]);
          const mo = Number(dm[2]);
          let y = dm[3] ? Number(dm[3]) : Number(today.slice(0, 4));
          if (y < 100) y += 2000;
          if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
            let key = toDateKey(y, mo, d);
            // "3.1" in October is next January
            if (!dm[3] && key < addDays(today, -60)) key = toDateKey(y + 1, mo, d);
            date = key;
          }
        }
      }
    }
  }

  // --- place: after "@" (or "מיקום:"), to a comma or the next thing read ---
  let location = '';
  const rest: string[] = [];
  for (const piece of ex.pieces()) {
    const m = location ? null : /(^|\s)(?:@|מיקום\s*:|מקום\s*:|במיקום\s+)\s*([^,]*)(,.*)?$/.exec(piece);
    if (m && m[2].trim()) {
      location = m[2].trim().replace(/[.;!?]+$/, '');
      rest.push(piece.slice(0, m.index), m[3]?.slice(1) ?? '');
    } else rest.push(piece);
  }

  // --- title: what is left, without the words that only joined the rest ---
  const words = rest.join(' ').split(' ').filter(Boolean);
  while (words.length && (LEADING.has(words[0].replace(/[:,-]+$/, '')) || isPunct(words[0]))) words.shift();
  while (words.length && (TRAILING.has(words[words.length - 1]) || isPunct(words[words.length - 1]))) words.pop();
  const title = words
    .join(' ')
    .replace(/^[-:]+\s*/, '')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/[.,;:-]+$/, '')
    .trim();

  return {
    title,
    date: date ?? ctx.defaultDate,
    dateGiven: date !== null,
    startTime: start === null ? null : clock(start),
    endTime: end === null || start === null || end === start ? null : clock(end),
    location,
    ownerId,
  };
}

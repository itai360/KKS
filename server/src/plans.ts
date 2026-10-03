// Plan approval (אישור תוכניות): a document for every course week that the commander presents to
// the commander above them - the week's key activities and the three weeks after it, the goals,
// the achievements expected, what to emphasise, the risks and how they are met, and what the
// commander needs from them. Everything starts as a draft written from the course's own data
// (the schedule and connected calendars, preparation tasks, the previous cycle's lessons, the
// staff's absences, the cadets' standing); the commander rewrites any part, then records the
// approval. When the week's key activities change after that, the document says what changed.

import { z } from 'zod';
import { addDays, diffDays, isDateKey, localDateKey, shortDate, weekdayName } from '../../shared/dates';
import { goalsFromText } from '../../shared/debriefForms';
import type { Absence, BankLesson, ExternalEvent, PlanDocument, PlanEvent, PlanEventKind, PlanHorizonWeek, PlanListItem, PlanRisk, PlanSection, PlanSectionKey, PlansOverview, PlanStatus, ScheduleEvent, Week } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, clock, getSettings, nowIso, tz } from './core';
import { db } from './db';
import { listAbsences } from './absences';
import { externalEvents } from './calendar';
import { lessonBank } from './debriefs';
import { changed } from './journal';
import { listEvents } from './schedule';
import { getWeek, listWeeks } from './weeks';

const SECTIONS: PlanSectionKey[] = ['goals', 'achievements', 'emphases', 'requests'];
/** from this weight an activity is a key one */
const KEY_WEIGHT = 3;

// ---------------- reading the schedule ----------------

type Kind = PlanEventKind | 'routine';

// The first rule that matches decides. Plain Hebrew words of the trade, nothing of any course's own.
const RULES: [Kind, RegExp][] = [
  ['routine', /ארוחת|ארוחה|מסדר בוקר|מסדר ערב|מסדר נוכחות|סיכום יום|ת"ש|ת״ש|כיבוי אורות|השכמה|ניקיון|זמן אישי|זמן מפקד|שעת מפקד|הפסקה|התארגנות|מקלחות/],
  ['exam', /מבחן|מבחני|בוחן|בחינה|מבדק|\btest\b|\bquiz\b/i],
  ['ceremony', /טקס|השבעה|הענקת|מסדר סיום|יום הורים|ערב הורים|ביקור משפחות|כנס/],
  ['learning', /^\s*(שיעור|הרצאה|סדנה|הדרכה|לימוד|סמינר)/],
  ['staff', /^\s*(תחקיר|ישיבת|ישיבה|הכנה|תדריך)/],
  ['range', /מטווח|ירי|קליעה/],
  ['navigation', /ניווט|מסע/],
  ['field', /תרגיל|שטח|לילה|ביוואק|לינת|פשיטה|מארב|התקפה|הגנה/],
  ['visit', /ביקור|סיור|מפגש עם|אורח|יום חשיפה/],
  ['evaluation', /שיחות|שיחה אישית|משוב|הערכה|ועדה|ועדת|ראיון|ראיונות|סוציומטרי|חוות דעת/],
  ['values', /ערכים|מורשת|גיבוש|זהות|שיח|ערב צוות|ערב פלוגה/],
  ['physical', /אימון גופני|כושר|ספורט|ריצה|קרב מגע|שחייה/],
  ['staff', /סגל|ישיבת|ישיבה|תחקיר|פתיחת שבוע|סגירת שבוע|תדריך|הערכת מצב/],
  ['leave', /חופשה|יציאה|פסח|סוכות|ראש השנה|יום כיפור|חנוכה/],
  ['learning', /שיעור|הרצאה|סדנה|הדרכה|לימוד|סמינר|מצגת|למידה/],
];

const BASE_WEIGHT: Record<PlanEventKind, number> = {
  exam: 5,
  ceremony: 5,
  field: 4,
  navigation: 4,
  range: 4,
  visit: 3,
  evaluation: 3,
  learning: 2,
  values: 2,
  leave: 2,
  other: 2,
  physical: 1,
  staff: 1,
};

export function classify(title: string, notes = ''): Kind {
  for (const [kind, re] of RULES) if (re.test(title)) return kind;
  for (const [kind, re] of RULES) if (kind !== 'routine' && re.test(notes)) return kind;
  return 'other';
}

interface RawEvent {
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  location: string;
  ownerName: string | null;
  notes: string;
  prep: { done: number; total: number } | null;
  source: 'course' | 'calendar';
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** a one-day calendar marker that names a course week ("שבוע 3 - התקפה"), not an activity */
const WEEK_MARKER = /^\s*שבוע(?![֐-׿])/;

function fromCourse(e: ScheduleEvent): RawEvent {
  return { date: e.date, startTime: e.startTime, endTime: e.endTime, title: norm(e.title), location: e.location, ownerName: e.ownerName, notes: e.notes, prep: { done: e.taskDone, total: e.taskTotal }, source: 'course' };
}

function fromCalendar(e: ExternalEvent): RawEvent | null {
  if (!e.startTime && WEEK_MARKER.test(e.title)) return null;
  return { date: e.date, startTime: e.startTime, endTime: e.endTime, title: norm(e.title), location: e.location, ownerName: null, notes: '', prep: null, source: 'calendar' };
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * The activities of some days: the same title on consecutive days is one activity (a field
 * week), and what comes back every day with little weight is the routine, left out.
 */
export function readEvents(raw: RawEvent[]): PlanEvent[] {
  // a connected calendar may hold the course's own schedule too
  const seen = new Set(raw.filter((e) => e.source === 'course').map((e) => `${e.date}|${e.title}`));
  const list = raw.filter((e) => e.source === 'course' || !seen.has(`${e.date}|${e.title}`));
  const byTitle = new Map<string, RawEvent[]>();
  for (const e of list) byTitle.set(e.title, [...(byTitle.get(e.title) ?? []), e]);

  const out: PlanEvent[] = [];
  for (const [title, all] of byTitle) {
    const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    const runs: RawEvent[][] = [];
    for (const e of sorted) {
      const run = runs[runs.length - 1];
      const last = run?.[run.length - 1];
      if (last && (e.date === last.date || e.date === addDays(last.date, 1))) run.push(e);
      else runs.push([e]);
    }
    for (const run of runs) {
      const first = run[0];
      const last = run[run.length - 1];
      const kind = classify(title, first.notes);
      if (kind === 'routine') continue;
      const days = diffDays(last.date, first.date) + 1;
      // every day of the week: routine, unless it is an activity that carries weight
      if (days >= 3 && BASE_WEIGHT[kind] <= 2) continue;
      const crosses = !!(first.startTime && first.endTime && first.endTime < first.startTime);
      // hours a day: a long day carries weight; the same short slot two days running does not
      const daily = first.startTime && first.endTime ? (minutes(first.endTime) - minutes(first.startTime) + (crosses ? 1440 : 0)) / 60 : first.startTime ? 0 : 24;
      const prep = run.some((e) => e.prep) ? run.reduce((s, e) => ({ done: s.done + (e.prep?.done ?? 0), total: s.total + (e.prep?.total ?? 0) }), { done: 0, total: 0 }) : null;
      out.push({
        key: `${first.date}|${first.startTime ?? ''}|${title}`,
        title,
        date: first.date,
        endDate: last.date,
        startTime: first.startTime,
        endTime: last.endTime,
        location: first.location,
        ownerName: first.ownerName,
        kind,
        weight: Math.min(6, BASE_WEIGHT[kind] + (daily >= 6 || (days > 1 && daily >= 4) ? 1 : 0)),
        night: /לילה/.test(title) || crosses || (first.startTime ?? '') >= '22:00',
        prep,
        source: first.source,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || b.weight - a.weight);
}

async function eventsBetween(from: string, to: string, withCalendars = true): Promise<PlanEvent[]> {
  const course = listEvents(from, to, false).map(fromCourse);
  let calendar: RawEvent[] = [];
  if (withCalendars) {
    try {
      calendar = (await externalEvents(from, to)).map(fromCalendar).filter((e): e is RawEvent => !!e);
    } catch {
      /* a calendar that cannot be read leaves only the course's own schedule */
    }
  }
  return readEvents([...course, ...calendar]);
}

const isKey = (e: PlanEvent) => e.weight >= KEY_WEIGHT;
const inWeek = (e: PlanEvent, w: { startDate: string; endDate: string }) => e.date >= w.startDate && e.date <= w.endDate;

// ---------------- wording ----------------

/** "א", "א וב", "א, ב וג" */
export function joinHe(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const last = items[items.length - 1];
  const and = /^[א-ת]/.test(last) ? `ו${last}` : `ו-${last}`;
  return `${items.slice(0, -1).join(', ')} ${and}`;
}

const dayLabel = (e: Pick<PlanEvent, 'date' | 'endDate'>) => (e.endDate !== e.date ? `${shortDate(e.date)}-${shortDate(e.endDate)}` : `יום ${weekdayName(e.date)} ${shortDate(e.date)}`);
const whenLabel = (e: PlanEvent) => `${dayLabel(e)}${e.startTime && e.endDate === e.date ? `, ${e.startTime}` : ''}`;
const titles = (list: PlanEvent[], n = 2) => joinHe(list.slice(0, n).map((e) => e.title));
/** a lesson's subject: "שיעור: עקרונות התקפה" -> "עקרונות התקפה" */
const subject = (title: string) => title.replace(/^\s*(שיעור|הרצאה|סדנה|הדרכה|לימוד|סמינר)\s*[:\-–]?\s*/, '').trim() || title;
const byWeight = (list: PlanEvent[]) => [...list].sort((a, b) => b.weight - a.weight || a.date.localeCompare(b.date));
const ofKind = (list: PlanEvent[], ...kinds: PlanEventKind[]) => byWeight(list.filter((e) => kinds.includes(e.kind)));
const unique = (items: string[]) => [...new Set(items.map((s) => s.trim()).filter(Boolean))];
/** "צוער אחד" / "3 צוערים" */
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const cadetsCount = (n: number) => count(n, 'צוער אחד', 'צוערים');

interface Facts {
  week: Week;
  index: number;
  total: number;
  phase: PlanDocument['position']['phase'];
  /** this week's activities, the key ones and the rest */
  all: PlanEvent[];
  key: PlanEvent[];
  ahead: PlanHorizonWeek[];
  absences: Absence[];
  lessons: BankLesson[];
  cadets: PlanDocument['cadets'];
  risks: PlanRisk[];
  visit: PlanEvent | null;
}

function draftGoals(f: Facts): string[] {
  const out = goalsFromText(f.week.goals)
    .map((g) => g.goal)
    .slice(0, 3);
  if (!out.length && f.week.topic) out.push(`להקנות ולתרגל: ${f.week.topic}`);
  const exam = ofKind(f.all, 'exam');
  const field = ofKind(f.all, 'field');
  const range = ofKind(f.all, 'range');
  const nav = ofKind(f.all, 'navigation');
  const ceremony = ofKind(f.all, 'ceremony');
  const visit = ofKind(f.all, 'visit');
  const evaluation = ofKind(f.all, 'evaluation');
  const learning = ofKind(f.all, 'learning');
  if (field.length) out.push(`לתרגל את הצוערים בתנאי שטח, בהפעלת כוח ובקבלת החלטות תחת לחץ - ${titles(field)}`);
  if (range.length) out.push(`לבסס מיומנות ירי ומשמעת בטיחות בנשק - ${titles(range)}`);
  if (nav.length) out.push(`לפתח התמצאות, עצמאות ועמידה במאמץ - ${titles(nav)}`);
  if (exam.length) out.push(`לבחון את רמת השליטה של הצוערים ולזהות מוקדם את מי שצריך חיזוק - ${titles(exam)}`);
  if (learning.length) out.push(`להקנות ידע מקצועי: ${joinHe(unique(learning.map((e) => subject(e.title))).slice(0, 3))}`);
  if (ceremony.length) out.push(`לחזק גאוות יחידה, שייכות וזהות - ${titles(ceremony)}`);
  if (visit.length) out.push(`להרחיב את ההיכרות של הצוערים עם המערכת שאליה ייצאו - ${titles(visit)}`);
  if (evaluation.length) out.push(`לתת לכל צוער תמונת מצב אישית ויעדים להמשך - ${titles(evaluation)}`);
  if (f.all.some((e) => e.kind === 'values')) out.push('לחזק את השיח הערכי ואת הגיבוש בצוותים');
  if (!out.length) out.push('לבנות את לו"ז השבוע ולהגדיר את מטרותיו');
  return unique(out).slice(0, 6);
}

function draftAchievements(f: Facts): string[] {
  const out: string[] = [];
  for (const e of ofKind(f.all, 'exam').slice(0, 2)) out.push(`כל הצוערים נבחנו ב${e.title}; למי שלא עמד ביעד - תוכנית חיזוק ומועד נוסף`);
  for (const e of ofKind(f.all, 'field').slice(0, 2)) out.push(`${e.title} בוצע במלואו לפי התוכנית, ללא אירועי בטיחות, עם תחקיר ולקחים`);
  for (const e of ofKind(f.all, 'range').slice(0, 1)) out.push(`כל הצוערים השלימו את ${e.title} בעמידה בכללי הבטיחות, והתוצאות מתועדות לכל צוער`);
  for (const e of ofKind(f.all, 'navigation').slice(0, 1)) out.push(`כל הצוערים השלימו את ${e.title}, עם ניתוח טעויות ומשוב אישי`);
  for (const e of ofKind(f.all, 'ceremony').slice(0, 1)) out.push(`${e.title} התקיים במועד, אחרי חזרה גנרלית, בהשתתפות מלאה`);
  if (f.all.some((e) => e.kind === 'evaluation')) out.push('כל צוער קיבל משוב אישי ויעד לשיפור, מתועד בתיק הצוער');
  const learning = ofKind(f.all, 'learning');
  if (learning.length) out.push(`הצוערים יודעים להסביר וליישם את ${joinHe(unique(learning.map((e) => subject(e.title))).slice(0, 2))} - נבדק בתרגול או בבוחן קצר`);
  if (f.week.totalTasks) out.push(`כל משימות ההכנה לשבוע הושלמו לפני תחילתו (${f.week.doneTasks}/${f.week.totalTasks} כרגע)`);
  if (f.lessons.length) out.push(`כל ${f.lessons.length === 1 ? 'הלקח' : `${f.lessons.length} הלקחים`} מהמחזור הקודם לשבוע הזה ${f.lessons.length === 1 ? 'קיבל החלטה ויושם' : 'קיבלו החלטה ויושמו'}`);
  out.push('תחקיר שבועי מסוכם, עם לקחים, אחראים ומועדים');
  return unique(out).slice(0, 7);
}

function draftEmphases(f: Facts): string[] {
  const out: string[] = [];
  const effort = ofKind(f.all, 'field', 'range', 'navigation');
  if (effort.length) out.push(`בטיחות: תדריך ואישורים לפני ${titles(effort, 3)}; רפואה ופינוי זמינים לאורך כל הפעילות`);
  const night = f.key.filter((e) => e.night);
  if (night.length) out.push(`פעילות לילה (${titles(night)}): עייפות, תאורה ונהיגה אחרי לילה ער`);
  const month = Number(f.week.startDate.slice(5, 7));
  const outdoors = f.all.some((e) => ['field', 'range', 'navigation', 'physical'].includes(e.kind));
  if (outdoors && month >= 5 && month <= 9) out.push('עונת חום: שתייה מבוקרת, צל והפסקות, והעברת מאמצים לשעות הקרירות לפי הצורך');
  if (outdoors && (month >= 11 || month <= 2)) out.push('חורף: ביגוד חם וציוד גשם, וחלופה מוכנה לכל פעילות בשטח');
  // a long night and an early morning after it
  for (const n of night) {
    const next = f.all.find((e) => e.date === addDays(n.endDate, 1) && e.startTime && e.startTime < '08:00');
    if (next) {
      out.push(`רצף מאמץ: ${n.title} ואחריו ${next.title} בבוקר - לתכנן זמן מנוחה ביניהם`);
      break;
    }
  }
  for (const l of f.lessons.slice(0, 2)) out.push(`לקח מהמחזור הקודם: ${l.body}`);
  // the bridge to the weeks ahead: what has to start now
  const big = f.ahead.slice(1).flatMap((w) => w.events.filter((e) => e.weight >= 5).map((e) => ({ e, w })));
  for (const { e, w } of big.slice(0, 2)) out.push(`להתחיל כבר השבוע את ההכנות ל${e.title} (${w.name}, ${shortDate(e.date)})`);
  if (f.phase === 'opening') out.push('קליטה ותיאום ציפיות: נהלים, סדר יום ובניית אמון בין הצוערים לסגל');
  if (f.phase === 'closing') out.push('סגירת מעגלים: משובים אישיים, החלטות ועדות והכנה לסיום');
  if (f.phase === 'middle' && f.index === Math.ceil(f.total / 2)) out.push('אמצע הקורס: שמירה על המוטיבציה ורענון היעדים מול הצוערים');
  if (f.cadets.twoNotes) out.push(`${cadetsCount(f.cadets.twoNotes)} עם 2 הערות משמעת - שיחת הבהרה לפני שהערה נוספת מעבירה לוועדה`);
  return unique(out).slice(0, 8);
}

function draftRequests(f: Facts): string[] {
  const out: string[] = [];
  const approve = ofKind(f.key, 'field', 'range', 'navigation');
  if (approve.length) out.push(`אישור תוכניות האימון: ${titles(approve, 3)}`);
  const ceremony = f.ahead.flatMap((w) => w.events).find((e) => e.kind === 'ceremony');
  if (ceremony) out.push(`הזמנה ל${ceremony.title} (${whenLabel(ceremony)}) - נשמח לנוכחותך`);
  const gap = f.risks.find((r) => r.text.includes('בהיעדרות'));
  if (gap) out.push(`סיוע בתגבור סגל: ${gap.text}`);
  if (f.cadets.committees) out.push(`עדכון על ${cadetsCount(f.cadets.committees)} בוועדת הערכה ושיתוף בהחלטה`);
  if (f.cadets.risk) out.push(`שיתוף: ${cadetsCount(f.cadets.risk)} בסיכון והמענה שניתן`);
  return unique(out).slice(0, 6);
}

function findRisks(week: Week, all: PlanEvent[], absences: Absence[], lessons: BankLesson[], cadets: PlanDocument['cadets'], today: string): PlanRisk[] {
  const out: PlanRisk[] = [];
  const key = all.filter(isKey);
  if (!key.length && week.endDate >= today) out.push({ level: 'medium', text: 'אין עדיין אירועי מפתח בלו"ז השבוע', answer: 'להשלים את הלו"ז לפני הצגת התוכנית' });
  for (const e of key) {
    if (e.prep && e.prep.total && e.prep.done < e.prep.total && e.endDate >= today) {
      out.push({ level: e.prep.done / e.prep.total < 0.5 ? 'high' : 'medium', text: `מוכנות ${e.title}: ${e.prep.done}/${e.prep.total} משימות הכנה`, answer: `לסגור את משימות ההכנה עד ${shortDate(addDays(e.date, -1))}` });
    }
    if (e.source === 'course' && !e.ownerName) out.push({ level: 'medium', text: `ל${e.title} אין אחראי`, answer: 'למנות אחראי ולעדכן בלו"ז' });
  }
  for (const a of absences) {
    const owned = key.find((e) => e.ownerName === a.userName && e.date <= a.endDate && e.endDate >= a.startDate);
    if (owned) {
      out.push({ level: 'high', text: `${a.userName}, האחראי על ${owned.title}, בהיעדרות ב-${shortDate(owned.date)}`, answer: 'להעביר את האחריות או להזיז את המועד' });
      continue;
    }
    const during = key.filter((e) => e.weight >= 4 && e.date <= a.endDate && e.endDate >= a.startDate);
    if (during.length) out.push({ level: 'medium', text: `${a.userName} בהיעדרות בזמן ${titles(during)}`, answer: 'לוודא כיסוי סגל לפעילות' });
  }
  if (week.overdueTasks) out.push({ level: week.overdueTasks >= 3 ? 'high' : 'medium', text: `${count(week.overdueTasks, 'משימה אחת', 'משימות')} של השבוע באיחור`, answer: 'לסגור או לדחות בהחלטה מפורשת' });
  const undecided = lessons.filter((l) => !l.review).length;
  if (undecided) out.push({ level: 'medium', text: `${count(undecided, 'לקח אחד', 'לקחים')} מהמחזור הקודם לשבוע הזה עוד בלי החלטה`, answer: undecided === 1 ? 'להחליט: משימה, יושם, או לא רלוונטי' : 'להחליט על כל אחד: משימה, יושם, או לא רלוונטי' });
  if (cadets.risk) out.push({ level: 'high', text: `${cadetsCount(cadets.risk)} בסיכון לפי תיקי ההערכה`, answer: 'ליווי צמוד של מפקד הצוות ושיחת מפקד קורס' });
  return out.slice(0, 8);
}

function cadetFacts(): PlanDocument['cadets'] {
  const count = (sql: string) => db().get<{ n: number }>(sql)!.n;
  const standing = new Map(
    db()
      .all<{ standing: string; n: number }>("SELECT f.standing, count(*) AS n FROM evaluation_files f JOIN cadets c ON c.id = f.cadet_id AND c.status = 'active' GROUP BY f.standing")
      .map((r) => [r.standing, r.n]),
  );
  return {
    active: count("SELECT count(*) AS n FROM cadets WHERE status = 'active'"),
    dropped: count("SELECT count(*) AS n FROM cadets WHERE status = 'dropped'"),
    watch: standing.get('watch') ?? 0,
    risk: standing.get('risk') ?? 0,
    committees: count("SELECT count(*) AS n FROM committees m JOIN cadets c ON c.id = m.cadet_id AND c.status = 'active' WHERE m.decision IS NULL"),
    twoNotes: count(
      "SELECT count(*) AS n FROM (SELECT r.cadet_id FROM cadet_records r JOIN cadets c ON c.id = r.cadet_id AND c.status = 'active' WHERE r.kind = 'discipline' AND r.formal = 1 GROUP BY r.cadet_id HAVING count(*) = 2)",
    ),
  };
}

/** where the superior sees the course at its best: a ceremony, then the biggest exercise, by day */
function bestVisit(events: PlanEvent[]): PlanEvent | null {
  const order: PlanEventKind[] = ['ceremony', 'field', 'navigation', 'range', 'exam', 'visit'];
  const candidates = events.filter((e) => order.includes(e.kind) && !(e.startTime && e.startTime >= '22:00'));
  return [...candidates].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.weight - a.weight || a.date.localeCompare(b.date))[0] ?? null;
}

// ---------------- the document ----------------

interface DocRow {
  week_id: number;
  bluf: string | null;
  goals: string | null;
  achievements: string | null;
  emphases: string | null;
  requests: string | null;
  status: PlanStatus;
  approved_by: string;
  approved_on: string | null;
  approval_notes: string;
  approved_events: string | null;
  updated_at: string;
  updated_by_name: string | null;
}

const docRow = (weekId: number) =>
  db().get<DocRow>('SELECT d.*, u.display_name AS updated_by_name FROM plan_docs d LEFT JOIN users u ON u.id = d.updated_by WHERE d.week_id = ?', weekId);

const parseList = (s: string | null): string[] | null => {
  if (s === null) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
};

interface Approved {
  key: string;
  title: string;
  date: string;
  startTime: string | null;
}

/** the key activities at approval against now: added, moved, dropped */
export function changesSince(approved: Approved[], now: PlanEvent[]): string[] {
  const label = (e: { date: string; startTime: string | null }) => `${weekdayName(e.date)} ${shortDate(e.date)}${e.startTime ? ` ${e.startTime}` : ''}`;
  const nowKeys = new Set(now.map((e) => e.key));
  const wasKeys = new Set(approved.map((e) => e.key));
  const added = now.filter((e) => !wasKeys.has(e.key));
  const out: string[] = [];
  for (const was of approved.filter((e) => !nowKeys.has(e.key))) {
    const moved = added.findIndex((e) => e.title === was.title);
    if (moved >= 0) {
      out.push(`הוזז: ${was.title} - מ${label(was)} ל${label(added[moved])}`);
      added.splice(moved, 1);
    } else out.push(`ירד מהתוכנית: ${was.title} (${label(was)})`);
  }
  for (const e of added) out.push(`נוסף: ${e.title} (${label(e)})`);
  return out;
}

function horizonWeeks(week: Week): Week[] {
  return [week, ...listWeeks('w.start_date > ?', week.startDate).slice(0, 3)];
}

const today = () => localDateKey(clock.now(), tz());

export async function planDocument(weekId: number): Promise<PlanDocument> {
  const week = getWeek(weekId);
  const weeks = listWeeks();
  const index = weeks.findIndex((w) => w.id === week.id) + 1;
  const total = weeks.length;
  const span = horizonWeeks(week);
  const events = await eventsBetween(week.startDate, span[span.length - 1].endDate);

  const ahead: PlanHorizonWeek[] = span.map((w) => {
    const mine = events.filter((e) => inWeek(e, w));
    const key = mine.filter(isKey);
    return { weekId: w.id, number: w.number, name: w.name, topic: w.topic, startDate: w.startDate, endDate: w.endDate, events: key.slice(0, 8), more: mine.length - Math.min(key.length, 8) };
  });
  const all = events.filter((e) => inWeek(e, week));
  const key = all.filter(isKey);
  const absences = listAbsences({ from: week.startDate, to: week.endDate });
  const lessons = lessonBank({ weekId: week.id });
  const cadets = cadetFacts();
  const now = today();
  const endDate = getSettings().endDate;
  const daysLeft = endDate && isDateKey(endDate) ? Math.max(0, diffDays(endDate, now)) : null;
  const phase: PlanDocument['position']['phase'] = index <= Math.max(1, Math.round(total * 0.15)) ? 'opening' : index > total - Math.max(1, Math.round(total * 0.15)) ? 'closing' : 'middle';
  const risks = findRisks(week, all, absences, lessons, cadets, now);
  const visit = bestVisit([...ahead[0].events, ...(ahead[1]?.events ?? [])]);
  const facts: Facts = { week, index, total, phase, all, key, ahead, absences, lessons, cadets, risks, visit };

  const row = docRow(week.id);
  const auto: Record<PlanSectionKey, string[]> = { goals: draftGoals(facts), achievements: draftAchievements(facts), emphases: draftEmphases(facts), requests: draftRequests(facts) };
  const sections = Object.fromEntries(
    SECTIONS.map((k): [PlanSectionKey, PlanSection] => {
      const mine = parseList(row?.[k] ?? null);
      return [k, { items: mine ?? auto[k], auto: auto[k], edited: mine !== null }];
    }),
  ) as Record<PlanSectionKey, PlanSection>;

  const next = ahead
    .slice(1)
    .flatMap((w) => w.events)
    .filter((e) => e.weight >= 5)[0];
  const highs = risks.filter((r) => r.level === 'high').length;
  const autoBluf = [
    `${week.name} - שבוע ${index} מתוך ${total} בקורס.`,
    key.length ? `במוקד: ${titles(byWeight(key), 3)}.` : 'עדיין אין אירועי מפתח בלו"ז.',
    week.totalTasks ? `מוכנות ${week.readiness}% (${week.doneTasks}/${week.totalTasks} משימות הכנה).` : '',
    highs ? `${highs === 1 ? 'נקודה אחת דורשת' : `${highs} נקודות דורשות`} מענה.` : '',
    next ? `בהמשך: ${next.title} (${shortDate(next.date)}).` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const approved = row?.status === 'approved' ? (JSON.parse(row.approved_events ?? '[]') as Approved[]) : null;
  return {
    week,
    position: { index, total, daysLeft, phase },
    bluf: { text: row?.bluf ?? autoBluf, auto: autoBluf, edited: row?.bluf != null },
    horizon: ahead,
    sections,
    risks,
    visit,
    cadets,
    absences,
    lessons,
    status: row?.status ?? 'draft',
    approval: row?.status === 'approved' && row.approved_on ? { by: row.approved_by, on: row.approved_on, notes: row.approval_notes } : null,
    changes: approved ? changesSince(approved, key) : [],
    updatedAt: row?.updated_at ?? null,
    updatedByName: row?.updated_by_name ?? null,
  };
}

export async function plansOverview(): Promise<PlansOverview> {
  const weeks = listWeeks();
  const rows = new Map(db().all<DocRow>('SELECT d.*, NULL AS updated_by_name FROM plan_docs d').map((r) => [r.week_id, r]));
  const now = today();
  const current = weeks.find((w) => w.startDate <= now && w.endDate >= now) ?? weeks.find((w) => w.startDate > now) ?? weeks[weeks.length - 1];
  const out: PlanListItem[] = [];
  for (const week of weeks) {
    const row = rows.get(week.id);
    let isChanged = false;
    if (row?.status === 'approved') {
      const key = (await eventsBetween(week.startDate, week.endDate)).filter((e) => inWeek(e, week) && isKey(e));
      isChanged = changesSince(JSON.parse(row.approved_events ?? '[]') as Approved[], key).length > 0;
    }
    out.push({
      week,
      status: row?.status ?? 'draft',
      approval: row?.status === 'approved' && row.approved_on ? { by: row.approved_by, on: row.approved_on } : null,
      changed: isChanged,
      edited: !!row && (row.bluf !== null || SECTIONS.some((k) => row[k] !== null)),
    });
  }
  return { weeks: out, currentWeekId: current?.id ?? null };
}

// ---------------- the commander's wording and the approval ----------------

const lines = z.array(z.string().trim().min(1).max(500)).max(15).nullable().optional();
const saveSchema = z.object({
  bluf: z.string().trim().min(1).max(1000).nullable().optional(),
  goals: lines,
  achievements: lines,
  emphases: lines,
  requests: lines,
  status: z.enum(['draft', 'ready']).optional(),
});

function ensureRow(weekId: number, actor: UserRow): void {
  db().run('INSERT INTO plan_docs(week_id, updated_at, updated_by) VALUES (?, ?, ?) ON CONFLICT(week_id) DO NOTHING', weekId, nowIso(), actor.id);
}

/** rewrites parts of the document (null: back to the automatic draft), or marks it ready / a draft again */
export function savePlan(actor: UserRow, weekId: number, raw: unknown): void {
  getWeek(weekId);
  const p = saveSchema.parse(raw);
  db().tx(() => {
    ensureRow(weekId, actor);
    if (p.bluf !== undefined) db().run('UPDATE plan_docs SET bluf = ? WHERE week_id = ?', p.bluf, weekId);
    for (const k of SECTIONS) {
      const v = p[k];
      if (v === undefined) continue;
      // the same column names as the section keys, fixed above
      db().run(`UPDATE plan_docs SET ${k} = ? WHERE week_id = ?`, v === null || !v.length ? null : JSON.stringify(v), weekId);
    }
    // back to a draft or ready: the approval no longer stands
    if (p.status) db().run("UPDATE plan_docs SET status = ?, approved_by = '', approved_on = NULL, approval_notes = '', approved_events = NULL WHERE week_id = ?", p.status, weekId);
    db().run('UPDATE plan_docs SET updated_at = ?, updated_by = ? WHERE week_id = ?', nowIso(), actor.id, weekId);
  });
  changed('plans');
}

const approveSchema = z.object({
  by: z.string().trim().min(2, 'מי אישר?').max(120),
  on: z.string().refine(isDateKey, 'תאריך לא תקין'),
  notes: z.string().trim().max(3000).default(''),
});

/** the superior approved the plan: who, when, what they said - and what the week held then */
export async function approvePlan(actor: UserRow, weekId: number, raw: unknown): Promise<void> {
  const week = getWeek(weekId);
  const p = approveSchema.parse(raw);
  if (p.on > addDays(today(), 1)) throw badRequest('תאריך האישור עוד לא הגיע');
  const key = (await eventsBetween(week.startDate, week.endDate)).filter((e) => inWeek(e, week) && isKey(e));
  const approved: Approved[] = key.map((e) => ({ key: e.key, title: e.title, date: e.date, startTime: e.startTime }));
  db().tx(() => {
    ensureRow(weekId, actor);
    db().run(
      "UPDATE plan_docs SET status = 'approved', approved_by = ?, approved_on = ?, approval_notes = ?, approved_events = ?, updated_at = ?, updated_by = ? WHERE week_id = ?",
      p.by,
      p.on,
      p.notes,
      JSON.stringify(approved),
      nowIso(),
      actor.id,
      weekId,
    );
  });
  changed('plans');
}

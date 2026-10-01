// Demo data: a course in progress, built through the real services so the
// activity log, notifications and readiness all look like real usage.
//   npm run seed            -> seeds data/kks.db if it is empty
//   npm run seed -- --reset -> wipes and re-seeds

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, startOfWeek, zonedIso, localDateKey } from '../../shared/dates';
import { createUser, getUserRow, type UserRow } from './auth';
import { runAutomation } from './automation';
import { clock, config, getSettings, updateSettings } from './core';
import { db, openDb } from './db';
import { endMeeting, startMeeting, updateMeeting } from './meetings';
import { saveRule } from './recurring';
import { createEvent } from './schedule';
import { addDependency, addUpdate, createRequest, createTasks, respondOverdue, transition } from './taskService';
import { saveTemplate, applyTemplate } from './templates';
import { addLesson, approveWeek, closeWeek, generateWeeks, openWeek } from './weeks';

const PASSWORD = process.env.SEED_PASSWORD ?? 'kks12345';
const dbPath = join(config.dataDir, 'kks.db');

if (process.argv.includes('--reset') && existsSync(dbPath)) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f);
}
openDb(dbPath);
if (db().get<{ n: number }>('SELECT count(*) AS n FROM users')!.n > 0) {
  console.log('Database already has data. Use "npm run seed -- --reset" to start over.');
  process.exit(0);
}

const TZ = getSettings().timezone;
const realNow = new Date();
const today = localDateKey(realNow, TZ);
const d = (offset: number, time = '18:00') => zonedIso(addDays(today, offset), time, TZ);
/** run fn as if it happened at the given moment */
function at<T>(iso: string, fn: () => T): T {
  clock.set(new Date(iso));
  try {
    return fn();
  } finally {
    clock.set(null);
  }
}

// ---------------- course & people ----------------
updateSettings({ courseName: 'קורס קק"ס - מחזור 52', courseSymbol: 'קק"ס' });

const ids = {
  cmd: createUser({ username: 'mefaked', password: PASSWORD, displayName: 'מפקד הקורס', title: 'רס"ן דנה כהן', role: 'commander', phone: '050-0000000' }),
  s1: createUser({ username: 'mefakatz1', password: PASSWORD, displayName: 'מפק"צ 1', title: 'סגן יואב לוי', role: 'staff' }),
  s2: createUser({ username: 'mefakatz2', password: PASSWORD, displayName: 'מפק"צ 2', title: 'סגן נועה ברק', role: 'staff' }),
  s3: createUser({ username: 'mefakatz3', password: PASSWORD, displayName: 'מפק"צ 3', title: 'סגן עומר שושן', role: 'staff' }),
  s4: createUser({ username: 'mefakatz4', password: PASSWORD, displayName: 'מפק"צ 4', title: 'סגן מאיה רוזן', role: 'staff' }),
  s5: createUser({ username: 'mefakatz5', password: PASSWORD, displayName: 'מפק"צ 5', title: 'סגן איתי פרץ', role: 'staff' }),
};
const u = (id: number): UserRow => getUserRow(id)!;
const cmd = u(ids.cmd);
const S = [ids.s1, ids.s2, ids.s3, ids.s4, ids.s5];

// ---------------- weeks (section 37) ----------------
const sunday = startOfWeek(today);
const firstSunday = addDays(sunday, -14);
const weekIds = at(d(-20, '09:00'), () =>
  generateWeeks(cmd, {
    startDate: firstSunday,
    count: 7,
    names: ['שבוע קליטה', 'שבוע יסודות', 'שבוע שטח', 'שבוע התקפה', 'שבוע הגנה', 'שבוע ניווט', 'שבוע סיכום'],
    leadIds: [ids.s1, ids.s2, ids.s3, ids.s2, ids.s4, ids.s5, ids.s1],
  }),
);
db().run("UPDATE weeks SET topic = 'קליטת הצוערים, ציוד והכרות' WHERE id = ?", weekIds[0]);
db().run("UPDATE weeks SET topic = 'יסודות הפיקוד, ניווט בסיסי' WHERE id = ?", weekIds[1]);
db().run("UPDATE weeks SET topic = 'שהייה בשטח, תרגילי כיתה' WHERE id = ?", weekIds[2]);
db().run(
  "UPDATE weeks SET topic = 'מחלקה בהתקפה', goals = ? WHERE id = ?",
  'הקניית עקרונות ההתקפה ברמת הכיתה והמחלקה.\nתרגיל התקפה יום ולילה.\nמטווח הפעלת כוח.',
  weekIds[3],
);
db().run("UPDATE weeks SET topic = 'מחלקה בהגנה' WHERE id = ?", weekIds[4]);
db().run("UPDATE weeks SET topic = 'ניווט יום ולילה' WHERE id = ?", weekIds[5]);
db().run("UPDATE weeks SET topic = 'תרגיל מסכם, משובים וסיום' WHERE id = ?", weekIds[6]);

// ---------------- templates (sections 16, 38, 58) ----------------
const weekTpl = at(d(-20, '09:30'), () =>
  saveTemplate(cmd, {
    name: 'פתיחת שבוע',
    kind: 'week',
    description: 'רשימת התיוג הקבועה לקראת כל שבוע',
    items: [
      { title: 'לו"ז מאושר', offsetDays: -4, owner: 'week_lead', domain: 'לו"ז', priority: 'high' },
      { title: 'מדריכים מאושרים', offsetDays: -5, owner: 'week_lead', domain: 'הדרכה' },
      { title: 'שטחים סגורים', offsetDays: -6, owner: 'week_lead', domain: 'תיאומים' },
      { title: 'ציוד מוכן', offsetDays: -2, owner: 'week_lead', domain: 'לוגיסטיקה' },
      { title: 'רפואה מתואמת', offsetDays: -3, owner: 'week_lead', domain: 'תיאומים' },
      { title: 'בטיחות מאושרת', offsetDays: -2, owner: 'week_lead', domain: 'בטיחות', priority: 'high' },
      { title: 'הסעות מתואמות', offsetDays: -3, owner: 'week_lead', domain: 'לוגיסטיקה' },
      { title: 'חומרי הדרכה מוכנים', offsetDays: -2, owner: 'week_lead', domain: 'הדרכה' },
      { title: 'משימות לצוערים הופצו', offsetDays: -1, owner: 'week_lead', domain: 'צוערים' },
      { title: 'סגל מכיר את השבוע', offsetDays: -1, time: '20:00', owner: 'week_lead', domain: 'הדרכה' },
    ],
  }),
);
at(d(-20, '09:40'), () =>
  saveTemplate(cmd, {
    name: 'הכנת פעילות מרכזית',
    kind: 'activity',
    description: 'תכנון, תיאומים, הכנה מקצועית, אישורים וסיכום',
    items: [
      { title: 'הגדרת מטרה, מיקום ואחראי', offsetDays: -10, owner: 'event_owner', stage: 'תכנון', domain: 'הדרכה' },
      { title: 'סגירת שטח', offsetDays: -7, owner: 'event_owner', stage: 'תיאומים', domain: 'תיאומים' },
      { title: 'תיאום רפואה', offsetDays: -5, owner: 'event_owner', stage: 'תיאומים', domain: 'תיאומים' },
      { title: 'תיאום מדריכים', offsetDays: -5, owner: 'event_owner', stage: 'תיאומים', domain: 'הדרכה' },
      { title: 'הזמנת ציוד והסעות', offsetDays: -4, owner: 'event_owner', stage: 'תיאומים', domain: 'לוגיסטיקה' },
      { title: 'הכנת תיק תרגיל', offsetDays: -3, owner: 'event_owner', stage: 'הכנה מקצועית', domain: 'הדרכה' },
      { title: 'תדריך בטיחות', offsetDays: -1, time: '12:00', owner: 'event_owner', stage: 'אישורים', domain: 'בטיחות', priority: 'high' },
      { title: 'אישור מפקד', offsetDays: -1, time: '16:00', owner: 'event_owner', stage: 'אישורים', requiresApproval: true },
      { title: 'תחקיר והפקת לקחים', offsetDays: 1, owner: 'event_owner', stage: 'סיכום', domain: 'הערכה' },
    ],
  }),
);
at(d(-20, '09:50'), () =>
  saveTemplate(cmd, {
    name: 'סיכום שבוע',
    kind: 'general',
    items: [
      { title: 'סגירת משימות פתוחות', offsetDays: 0, time: '12:00', owner: 'week_lead' },
      { title: 'תחקיר שבועי', offsetDays: 0, time: '14:00', owner: 'week_lead', domain: 'הערכה' },
      { title: 'הזנת לקחים', offsetDays: 0, time: '16:00', owner: 'week_lead', domain: 'הערכה' },
    ],
  }),
);

// ---------------- past weeks: opened, worked, closed with lessons ----------------
function workWeek(weekIndex: number, lateIdx: number[]) {
  const weekId = weekIds[weekIndex];
  const start = addDays(firstSunday, weekIndex * 7);
  const lead = [ids.s1, ids.s2][weekIndex];
  const leadRow = u(lead);
  const created = at(zonedIso(addDays(start, -8), '10:00', TZ), () => openWeek(leadRow, weekId, { templateId: weekTpl }));
  created.forEach((tid, i) => {
    const row = db().get<{ deadline: string; owner_id: number }>('SELECT deadline, owner_id FROM tasks WHERE id = ?', tid)!;
    const late = lateIdx.includes(i);
    const doneAt = new Date(Date.parse(row.deadline) + (late ? 20 : -26) * 3600_000).toISOString();
    at(new Date(Date.parse(doneAt) - 30 * 3600_000).toISOString(), () => transition(u(row.owner_id), tid, { action: 'start' }));
    at(doneAt, () => transition(u(row.owner_id), tid, { action: 'complete' }));
  });
  const extra = at(zonedIso(start, '09:00', TZ), () =>
    createTasks(cmd, { title: weekIndex === 0 ? 'חלוקת ציוד אישי לצוערים' : 'ניווט בסיסי - תיק ניווט', ownerIds: [S[(weekIndex + 2) % 5]], deadline: zonedIso(addDays(start, 2), '12:00', TZ), domain: weekIndex === 0 ? 'לוגיסטיקה' : 'הדרכה' }),
  );
  at(zonedIso(addDays(start, 2), '10:00', TZ), () => transition(u(S[(weekIndex + 2) % 5]), extra[0], { action: 'complete' }));
  at(zonedIso(addDays(start, 5), '13:00', TZ), () => {
    addLesson(leadRow, weekId, { kind: 'good', body: weekIndex === 0 ? 'קליטה מסודרת - חלוקת הציוד לפי צוותים חסכה זמן' : 'שילוב מדריכי ניווט מהיום הראשון עבד מצוין' });
    addLesson(leadRow, weekId, { kind: 'bad', body: weekIndex === 0 ? 'אישור המדריכים הגיע ברגע האחרון' : 'ההסעות לשטח איחרו פעמיים' });
    addLesson(leadRow, weekId, {
      kind: 'change',
      body: 'יש לסגור מדריכים מוקדם יותר',
      task: weekIndex === 1 ? { title: 'סגירת מדריכים עד יום שלישי', ownerId: ids.s3, deadline: zonedIso(addDays(start, 9), '18:00', TZ) } : undefined,
    });
  });
  at(zonedIso(addDays(start, 5), '15:00', TZ), () => closeWeek(leadRow, weekId, { decisions: [] }));
}
workWeek(0, [1]);
workWeek(1, [4, 7]);

// ---------------- current week (section 13) ----------------
const curWeek = weekIds[2];
const curTasks = at(d(-9, '10:00'), () => openWeek(u(ids.s3), curWeek, { templateId: weekTpl }));
curTasks.forEach((tid, i) => {
  const row = db().get<{ deadline: string; owner_id: number }>('SELECT deadline, owner_id FROM tasks WHERE id = ?', tid)!;
  if (i === 2) return; // stays open and is now overdue
  at(new Date(Date.parse(row.deadline) - 20 * 3600_000).toISOString(), () => transition(u(row.owner_id), tid, { action: 'complete' }));
});
at(d(-8, '09:00'), () => approveWeek(cmd, curWeek));

// ---------------- next week: attack week (sections 13, 23, 60) ----------------
const attack = weekIds[3];
const attackStart = addDays(sunday, 7);
const attackTasks = at(d(-6, '09:00'), () => openWeek(u(ids.s2), attack, { templateId: weekTpl, owners: { '4': ids.s4, '6': ids.s5 } }));
[0, 2, 7].forEach((i) => {
  const tid = attackTasks[i];
  const row = db().get<{ owner_id: number }>('SELECT owner_id FROM tasks WHERE id = ?', tid)!;
  at(d(-1, '15:00'), () => transition(u(row.owner_id), tid, { action: 'complete' }));
});

// The spec's own examples (sections 5, 9, 46)
const range = at(d(-6, '09:30'), () => createEvent(cmd, { date: addDays(attackStart, 3), startTime: '10:00', endTime: '15:00', title: 'מטווח הפעלת כוח', location: 'מטווח 7', ownerId: ids.s2, notes: 'מטווח יום עם תרגולת ירי בתנועה' }));
const exercise = at(d(-6, '09:40'), () => createEvent(cmd, { date: addDays(attackStart, 4), startTime: '06:00', endTime: '22:00', title: 'תרגיל התקפה', location: 'שטח אש 30', ownerId: ids.s3 }));

const rangeCoord = at(d(-5, '08:42'), () =>
  createTasks(cmd, { title: 'תיאום מטווח', ownerIds: [ids.s2], deadline: d(-1, '18:00'), priority: 'high', domain: 'תיאומים', eventId: range, weekId: attack, description: 'סגירת מטווח 7 מול מפקדת המטווחים, כולל שעות וכמות צוערים.' }),
)[0];
at(d(-5, '09:15'), () => transition(u(ids.s2), rangeCoord, { action: 'start' }));
at(d(-3, '14:30'), () => addUpdate(u(ids.s2), rangeCoord, 'בוצעה פנייה למדור מטווחים. ממתין לאישור.'));
at(realNow.toISOString(), () => respondOverdue(u(ids.s2), rangeCoord, { response: 'today', note: 'דיברתי עם קצין המטווחים - אישור צפוי עד הצהריים' }));

const rangeTasks: [string, number, number, string, string?][] = [
  ['תיאום מדריכי ירי', ids.s2, 2, 'הדרכה'],
  ['תיאום רפואה למטווח', ids.s4, 3, 'תיאומים'],
  ['הזמנת תחמושת', ids.s5, 1, 'לוגיסטיקה', 'high'],
  ['תדריך בטיחות מטווח', ids.s2, 5, 'בטיחות', 'critical'],
  ['תיאום הסעות למטווח', ids.s5, 4, 'לוגיסטיקה'],
  ['רשימת צוערים למטווח', ids.s1, 4, 'צוערים'],
];
const rangeIds = rangeTasks.map(([title, owner, off, domain, priority]) =>
  at(d(-5, '10:00'), () => createTasks(cmd, { title, ownerIds: [owner], deadline: d(off, '16:00'), domain, priority: (priority as 'high') ?? 'normal', eventId: range, weekId: attack })[0]),
);
at(d(-1, '11:00'), () => transition(u(ids.s1), rangeIds[5], { action: 'complete' }));
at(d(-2, '12:00'), () => transition(u(ids.s5), rangeIds[2], { action: 'start' }));
at(d(-1, '09:00'), () => createRequest(u(ids.s5), rangeIds[2], { type: 'deadline', newDeadline: d(3, '12:00'), reason: 'מדור תחמושת סגור עד יום ראשון, ההזמנה תצא בתחילת השבוע' }));

// Section 9 - the full example
const schedTask = at(d(-4, '08:30'), () =>
  createTasks(cmd, {
    title: 'סגירת לו"ז לשבוע התקפה',
    ownerIds: [ids.s3],
    deadline: d(2, '18:00'),
    priority: 'high',
    domain: 'לו"ז',
    weekId: attack,
    requiresApproval: true,
    description: 'יש לסגור את כלל הפעילויות, המדריכים, התרגילים, ההפסקות, הארוחות והתיאומים עד יום ראשון.',
  }),
)[0];
at(d(-4, '09:00'), () => transition(u(ids.s3), schedTask, { action: 'start' }));
at(d(-3, '20:10'), () => addUpdate(u(ids.s3), schedTask, 'טיוטה ראשונית מוכנה. ממתין לאישור מדריך ירי.'));
at(d(-2, '08:05'), () => addUpdate(cmd, schedTask, 'לוודא גם תיאום רפואה.', 'instruction'));
at(d(-1, '17:12'), () => addUpdate(u(ids.s3), schedTask, 'בוצע. ממתין לתשובת המרפאה.'));
at(d(0, '08:40'), () => transition(u(ids.s3), schedTask, { action: 'complete', note: 'הלו"ז סגור ומצורף, כולל תיאום רפואה.' }));

// Section 5 - due today / not updated / blocked
at(d(-2, '10:00'), () => createTasks(cmd, { title: 'סגירת לו"ז שבוע הבא', ownerIds: [ids.s4], deadline: d(0, '18:00'), priority: 'high', domain: 'לו"ז', weekId: curWeek }));
const lesson = at(d(-6, '11:00'), () => createTasks(cmd, { title: 'בניית שיעור התקפה', ownerIds: [ids.s1], deadline: d(4, '12:00'), domain: 'הדרכה', weekId: attack })[0]);
at(d(-4, '10:00'), () => transition(u(ids.s1), lesson, { action: 'start' }));
const area = at(d(-5, '12:00'), () => createTasks(cmd, { title: 'אישור שטח אימונים לתרגיל', ownerIds: [ids.s3], deadline: d(1, '12:00'), priority: 'high', domain: 'תיאומים', eventId: exercise, weekId: attack })[0]);
at(d(-2, '16:00'), () =>
  transition(u(ids.s3), area, { action: 'block', reason: 'ממתין לתשובת גורם חיצוני', waitingFor: 'קצין שטחי אש פיקודי', nextStep: 'תזכורת טלפונית מחר ב-09:00', needsCommander: true }),
);
const bus = at(d(-5, '12:10'), () => createTasks(cmd, { title: 'הזמנת הסעה לתרגיל', ownerIds: [ids.s5], deadline: d(3, '12:00'), domain: 'לוגיסטיקה', eventId: exercise, weekId: attack })[0]);
at(d(-5, '12:11'), () => addDependency(cmd, bus, area));

// Section 60 - parent with subtasks
const parent = at(d(-6, '13:00'), () => createTasks(cmd, { title: 'הכנת תרגיל התקפה', ownerIds: [ids.s3], deadline: d(5, '18:00'), priority: 'high', domain: 'הדרכה', eventId: exercise, weekId: attack })[0]);
const subs = ['הכנת תיק תרגיל', 'תדריך מדריכים', 'הכנת ציוד לתרגיל', 'תרחישי תרגיל'].map((t, i) =>
  at(d(-6, '13:05'), () => createTasks(cmd, { title: t, ownerIds: [i === 2 ? ids.s5 : ids.s3], deadline: d(i + 2, '16:00'), parentId: parent, domain: i === 2 ? 'לוגיסטיקה' : 'הדרכה' })[0]),
);
at(d(-1, '18:00'), () => transition(u(ids.s3), subs[0], { action: 'complete' }));
at(d(0, '09:30'), () => transition(u(ids.s3), subs[3], { action: 'start' }));

// Section 59 - dependency chain
const build = at(d(-3, '10:00'), () => createTasks(u(ids.s2), { title: 'בניית לו"ז שבוע התקפה - טיוטה למדריכים', ownerIds: [ids.s2], deadline: d(1, '12:00'), domain: 'לו"ז', weekId: attack })[0]);
const distribute = at(d(-3, '10:05'), () => createTasks(u(ids.s2), { title: 'הפצת לו"ז לסגל', ownerIds: [ids.s4], deadline: d(2, '20:00'), domain: 'לו"ז', weekId: attack, dependsOn: [build] })[0]);
void distribute;

// Section 64 - one task for all the staff
const allStaff = at(d(-1, '07:30'), () => createTasks(cmd, { title: 'לעבור על מסמך נהלי הקורס המעודכן', assignMode: 'all', deadline: d(0, '18:00'), domain: 'משמעת', visibility: 'team' }));
allStaff.slice(0, 3).forEach((tid, i) => at(d(-1, `1${i + 2}:00`), () => transition(u(S[i]), tid, { action: 'complete' })));

// Section 65 - shared task
at(d(-3, '11:00'), () => createTasks(cmd, { title: 'הכנת תרגיל מסכם', ownerIds: [ids.s1, ids.s3], assignMode: 'shared', deadline: d(24, '18:00'), domain: 'הדרכה', weekId: weekIds[6] }));

// a few more realistic open tasks in the next two weeks (section 25)
const more: [string, number, number, string, string?][] = [
  ['תיאום מדריכים לשבוע הגנה', ids.s4, 9, 'הדרכה'],
  ['הכנת מצגת עקרונות ההגנה', ids.s4, 10, 'הדרכה'],
  ['סגירת שטח לשבוע הגנה', ids.s4, 8, 'תיאומים', 'high'],
  ['שיחות אישיות - צוות 2', ids.s2, 2, 'פרט'],
  ['ריכוז משובי צוערים - שבוע יסודות', ids.s2, -1, 'הערכה'],
  ['בדיקת מלאי ציוד לילה', ids.s5, 6, 'לוגיסטיקה'],
  ['תכנון ניווט לילה', ids.s5, 15, 'הדרכה'],
  ['עדכון תיקי צוערים', ids.s1, 1, 'צוערים'],
];
more.forEach(([title, owner, off, domain, priority], i) => {
  at(d(-2, '09:00'), () => {
    const [tid] = createTasks(cmd, { title, ownerIds: [owner], deadline: d(off, i % 2 ? '12:00' : '18:00'), domain, priority: (priority as 'high') ?? 'normal' });
    if (i === 3) transition(u(owner), tid, { action: 'start' });
  });
});

// staff self-created tasks
at(d(-1, '21:00'), () => createTasks(u(ids.s1), { title: 'הכנת דף מסרים לצוערים', ownerIds: [ids.s1], deadline: d(1, '08:00'), domain: 'צוערים' }));
at(d(-1, '21:30'), () => createTasks(u(ids.s4), { title: 'החזרת ציוד קשר למחסן', ownerIds: [ids.s4], deadline: d(0, '14:00'), domain: 'לוגיסטיקה' }));

// ---------------- schedule for today and tomorrow (section 22) ----------------
const day: [string, string, string, string, number?][] = [
  ['06:30', '07:30', 'אימון גופני', 'מגרש המסדרים', ids.s1],
  ['08:00', '08:45', 'מסדר בוקר ופתיחת יום', 'רחבת הפלוגה', ids.s3],
  ['09:00', '10:45', 'שיעור: עקרונות התקפה', 'כיתה 2', ids.s1],
  ['11:00', '12:45', 'תרגיל כיתה בשטח', 'שטח אימונים צפוני', ids.s3],
  ['13:00', '13:45', 'ארוחת צהריים', 'חדר אוכל'],
  ['14:00', '17:30', 'תרגיל מחלקה', 'שטח אימונים צפוני', ids.s2],
  ['18:00', '19:00', 'סיכום יום', 'כיתה 2', ids.s3],
  ['20:00', '21:00', "ח' ערכים", 'מועדון', ids.s4],
];
for (const off of [0, 1]) {
  for (const [s, e, title, loc, owner] of day) {
    at(d(-3, '12:00'), () => createEvent(cmd, { date: addDays(today, off), startTime: s, endTime: e, title: off === 1 && title.startsWith('שיעור') ? 'שיעור: קרב בשטח בנוי' : title, location: loc, ownerId: owner ?? null }));
  }
}

// ---------------- recurring tasks (section 15) ----------------
at(d(-20, '10:00'), () => {
  saveRule(cmd, { title: 'עדכון לו"ז למחר', frequency: 'daily', time: '20:00', assignee: 'week_lead', domain: 'לו"ז' });
  saveRule(cmd, { title: "ח' ערכים", frequency: 'daily', time: '21:00', assignee: 'week_lead', domain: 'צוערים' });
  saveRule(cmd, { title: 'פתיחת שבוע', frequency: 'weekly', weekdays: [0], time: '08:00', assignee: 'week_lead', priority: 'high', domain: 'לו"ז' });
  saveRule(cmd, { title: 'סיכום שבוע ותחקיר', frequency: 'weekly', weekdays: [4], time: '14:00', assignee: 'all', domain: 'הערכה' });
});
// rules were created "in the past" - only keep today's instance, not three weeks of history
db().run('DELETE FROM tasks WHERE recurring_rule_id IS NOT NULL');
db().run('DELETE FROM recurring_instances');
db().run('UPDATE recurring_rules SET start_date = ?', today);

// ---------------- a past staff meeting (sections 68-69) ----------------
const meeting = at(d(-2, '19:00'), () => startMeeting(cmd, 'ישיבת סגל שבועית'));
at(d(-2, '19:20'), () => createTasks(cmd, { title: 'בדיקת אפשרות להקדים את המטווח', ownerIds: [ids.s4], deadline: d(-1, '10:00'), meetingId: meeting }));
at(d(-2, '19:40'), () => updateMeeting(meeting, { decisions: 'מטווח הפעלת כוח נשאר ביום רביעי\nמפק"צ 2 אחראי על שבוע התקפה\nתדריך בטיחות יועבר על ידי קצין הבטיחות', followUps: 'אישור שטח לתרגיל התקפה\nתשובת המרפאה' }));
at(d(-2, '20:00'), () => endMeeting(cmd, meeting));

// apply the activity template to the exercise for a realistic event page
at(d(-6, '14:00'), () => applyTemplate(cmd, db().get<{ id: number }>("SELECT id FROM templates WHERE kind = 'activity'")!.id, { eventId: exercise, itemIndexes: [1, 2, 4, 6] }));

// ---------------- let the automation catch up to "now" ----------------
db().run('UPDATE notifications SET read_at = created_at WHERE created_at < ?', d(-1, '00:00'));
runAutomation();

const counts = db().get<{ t: number; w: number; e: number }>('SELECT (SELECT count(*) FROM tasks) AS t, (SELECT count(*) FROM weeks) AS w, (SELECT count(*) FROM events) AS e')!;
console.log(`Seeded demo course: ${counts.t} tasks, ${counts.w} weeks, ${counts.e} schedule events.`);
console.log(`Log in as "mefaked" (commander) or "mefakatz1".."mefakatz5" (staff), password "${PASSWORD}".`);

// Demo data: a course in progress, built through the real services so the
// activity log, notifications and readiness all look like real usage.
// Used by the seed script and by the in-browser demo.

import { addDays, startOfWeek, zonedIso, localDateKey } from '../../shared/dates';
import { createUser, getUserRow, type UserRow } from './auth';
import { runAutomation } from './automation';
import { clock, getSettings, updateSettings } from './core';
import { db } from './db';
import { endMeeting, startMeeting, updateMeeting } from './meetings';
import { saveRule } from './recurring';
import { createEvent } from './schedule';
import { addDependency, addUpdate, createRequest, createTasks, respondOverdue, transition } from './taskService';
import { saveTemplate, applyTemplate } from './templates';
import { addLesson, approveWeek, closeWeek, generateWeeks, openWeek } from './weeks';
import { addRecord, createExperience, giveFeedback, saveTeam } from './cadets';
import { demoStep, linkLetters, saveGuide } from './discipline';
import { addItem, createDebrief, itemToTask, updateDebrief } from './debriefs';
import { createLinkDocument } from './documents';

/** Fills an empty database with the demo course. Dates are relative to today. */
export function seedDemoData(PASSWORD = 'kks12345'): { tasks: number; weeks: number; events: number } {
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

  // ---------------- version 3: teams, cadets, experiences, debriefs, documents ----------------
  const teamIds = at(d(-20, '11:00'), () =>
    [ids.s1, ids.s2, ids.s3, ids.s4].map((cmdr, i) => saveTeam(cmd, { name: `צוות ${i + 1}`, commanderId: cmdr })),
  );
  const names = [
    ['דניאל', 'כהן'], ['מאיה', 'לוי'], ['יונתן', 'מזרחי'], ['נועה', 'פרידמן'], ['איתי', 'אברהם'], ['שירה', 'גולן'],
    ['עומר', 'ביטון'], ['תמר', 'שפירא'], ['אורי', 'דהן'], ['רוני', 'אזולאי'], ['אלון', 'ברגר'], ['ליה', 'חדד'],
    ['גיא', 'וקנין'], ['הילה', 'רוזנברג'], ['עידו', 'פרץ'], ['יעל', 'נחום'], ['אביב', 'שטרן'], ['מיכל', 'אוחנה'],
    ['רועי', 'קפלן'], ['נוי', 'סעדה'], ['טל', 'יוסף'], ['אדם', 'גבאי'], ['ענבר', 'לנדאו'], ['בן', 'אלמוג'],
  ];
  const cadetIds = names.map(([first, last], i) => {
    const at0 = nowFor(-19);
    clock.set(new Date(at0));
    const id = db().run(
      'INSERT INTO cadets(first_name, last_name, personal_number, team_id, phone, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      first, last, String(8_200_100 + i * 37), teamIds[i % 4], `05${(i % 9) + 1}-${String(2_000_000 + i * 4111).slice(0, 7)}`, i === 23 ? 'dropped' : 'active', at0, at0,
    ).id;
    clock.set(null);
    return id;
  });
  function nowFor(offset: number) {
    return d(offset, '12:00');
  }
  // evaluations over the course - development tracking
  const criteria = ['פיקוד והובלה', 'מקצועיות', 'ערכים ודוגמה אישית', 'עבודת צוות', 'יוזמה'];
  cadetIds.slice(0, 16).forEach((cid, i) => {
    const lead = u([ids.s1, ids.s2, ids.s3, ids.s4][i % 4]);
    const base = 2 + (i % 3);
    [-14, -9, -4, -1].forEach((off, k) => {
      const score = Math.max(1, Math.min(5, base + (k >= 2 ? 1 : 0) - (i % 5 === 0 && k === 1 ? 1 : 0)));
      at(d(off, '19:00'), () => addRecord(lead, cid, { kind: 'evaluation', category: criteria[(i + k) % criteria.length], score, body: k === 3 ? 'שיפור ניכר בהובלת הכיתה בשטח' : 'הערכה שבועית', occurredOn: addDays(today, off) }));
    });
  });
  // personal talks, discipline and notes
  at(d(-13, '20:00'), () => addRecord(u(ids.s1), cadetIds[0], { kind: 'talk', category: 'שיחת היכרות', body: 'מגיע ממשפחה תומכת, מוטיבציה גבוהה מאוד. רוצה לפקד על צוות בתרגיל המסכם.', followUp: 'לתת לו הובלה בשבוע השטח' }));
  at(d(-6, '21:00'), () =>
    addRecord(u(ids.s2), cadetIds[1], {
      kind: 'talk',
      category: 'שיחת אמצע',
      body: 'מרגישה עומס בשבוע האחרון, קושי בשינה. סיכמנו על תוכנית קצרה.',
      followUp: 'שיחה חוזרת בעוד שבוע, עדכון מפקד הקורס',
      followUpTask: { title: 'שיחה חוזרת עם מאיה לוי', deadline: d(1, '20:00') },
    }),
  );
  // a short sample enforcement ladder (a real course imports its own document in the settings)
  at(d(-12, '09:00'), () =>
    saveGuide(
      cmd,
      linkLetters({
        offenses: [
          { key: 'זמנים · איחור למסדר', category: 'זמנים', name: 'איחור למסדר', definition: [], steps: ['הערה במקום', 'שיחת אזהרה עם מפקד הצוות', 'שעה ביציאה', 'הערת משמעת'].map(demoStep) },
          { key: 'טלפונים · שימוש בטלפון בשיעור', category: 'טלפונים', name: 'שימוש בטלפון בשיעור', definition: ['הודעות, משחקים, גלישה'], steps: ['הערה במקום', 'שיחת אזהרה עם מפקד הצוות', 'הערת משמעת'].map(demoStep) },
          { key: 'ציוד · שכחת ציוד אישי', category: 'ציוד', name: 'שכחת ציוד אישי', definition: [], steps: ['הערה במקום', 'השלמת הציוד ושיחה עם מפקד הצוות'].map(demoStep) },
        ],
        letters: [
          { title: 'שימוש בטלפון בשיעור - פעם שלישית', body: '1. המעשה: שימוש בטלפון בשיעור, בפעם השלישית.\n2. ההשלכות: שלוש הערות משמעת מובילות להדחה מהקורס.\n3. הציפייה: להקפיד על הנוהל מעכשיו.' },
          { title: 'איחור למסדר - פעם רביעית', body: '1. המעשה: איחור חוזר למסדר.\n2. ההשלכות: שלוש הערות משמעת מובילות להדחה מהקורס.\n3. הציפייה: להגיע בזמן, בלי תזכורות.' },
        ],
      }),
      'דוגמה',
    ),
  );
  at(d(-9, '08:30'), () => addRecord(u(ids.s3), cadetIds[2], { kind: 'discipline', offense: 'זמנים · איחור למסדר', body: 'איחור של 5 דקות למסדר בוקר.', occurredOn: addDays(today, -9) }));
  at(d(-3, '08:30'), () => addRecord(u(ids.s3), cadetIds[2], { kind: 'discipline', offense: 'זמנים · איחור למסדר', category: 'קלה', body: 'איחור של 10 דקות למסדר בוקר. שיחת בירור ואזהרה.' }));
  at(d(-8, '11:00'), () => addRecord(u(ids.s3), cadetIds[6], { kind: 'discipline', offense: 'טלפונים · שימוש בטלפון בשיעור', body: 'הודעות בטלפון באמצע שיעור.', occurredOn: addDays(today, -8) }));
  at(d(-6, '10:00'), () => addRecord(u(ids.s3), cadetIds[6], { kind: 'discipline', formal: true, title: 'הערת משמעת - ציוד אישי בשטח', body: 'השאיר ציוד אישי ללא השגחה בשטח אחרי שתי אזהרות.', occurredOn: addDays(today, -6) }));
  at(d(-5, '14:00'), () => addRecord(u(ids.s3), cadetIds[6], { kind: 'discipline', offense: 'טלפונים · שימוש בטלפון בשיעור', body: 'שוב טלפון בשיעור. שיחת אזהרה.', occurredOn: addDays(today, -5) }));
  at(d(-2, '22:00'), () => addRecord(u(ids.s3), cadetIds[6], { kind: 'discipline', offense: 'טלפונים · שימוש בטלפון בשיעור', formal: true, category: 'בינונית', body: 'שימוש בטלפון בזמן שיעור לאחר אזהרה. ריתוק לסוף השבוע.' }));
  at(d(-1, '17:00'), () => addRecord(u(ids.s4), cadetIds[3], { kind: 'note', body: 'בלטה בתדריך הבטיחות - שאלות חכמות והכנה מעולה.' }));
  at(d(-1, '18:00'), () => addRecord(u(ids.s5), cadetIds[0], { kind: 'note', body: 'עזר לצוער אחר עם הציוד בניווט בלי שהתבקש.' }));

  // experiences: done with feedback, running now, planned for attack week, awaiting feedback
  const exps: [number, string, number, number, number, string][] = [
    [cadetIds[0], 'מ"כ בתרגיל כיתה', -8, -7, ids.s2, 'קבלת החלטות, מתן פקודות'],
    [cadetIds[4], 'סמל תורן', -3, -1, ids.s1, 'סדר יום, אחריות על הצוות'],
    [cadetIds[1], 'מ"מ בתרגיל מחלקה', 0, 0, ids.s3, 'שליטה בקשר, הובלה תחת לחץ'],
    [cadetIds[8], 'מ"מ בתרגיל התקפה', 11, 11, ids.s2, 'תכנון התקפה, ניהול אש'],
    [cadetIds[5], 'סמ"פ בשבוע התקפה', 7, 10, ids.s4, 'ניהול לוגיסטיקה ולו"ז מחלקתי'],
  ];
  const expIds = exps.map(([cid, role, s0, e0, mentor, goals]) =>
    at(d(-10, '10:00'), () => createExperience(cmd, { cadetId: cid, role, startDate: addDays(today, s0), endDate: addDays(today, e0), mentorId: mentor, goals })),
  );
  at(d(-7, '20:00'), () => giveFeedback(u(ids.s2), expIds[0], { strengths: 'החלטיות, קול פיקודי ברור', improvements: 'לשתף את הסגנים בתכנון', feedback: 'התנסות מוצלחת מאוד', score: 4 }));

  // debriefs (section 57)
  const range0 = db().get<{ id: number }>("SELECT id FROM events WHERE title = 'תרגיל כיתה בשטח' ORDER BY date LIMIT 1")?.id ?? null;
  const deb = at(d(-1, '19:30'), () => createDebrief(u(ids.s3), { title: 'תחקיר תרגיל כיתה בשטח', occurredOn: addDays(today, -1), eventId: range0, participants: 'סגל צוות 3, מדריכי שטח', summary: 'תרגיל כיתה בשטח הצפוני. התרגיל התחיל באיחור של 40 דקות בגלל המתנה למדריך ולהסעה.' }));
  const debItems: [string, string][] = [
    ['fact', 'ההסעה הגיעה 25 דקות אחרי השעה שנקבעה'],
    ['fact', 'מדריך השטח לא ידע על שינוי בשעת ההתחלה'],
    ['finding', 'לא בוצע וידוא אחרון עם ההסעות והמדריך ערב לפני'],
    ['finding', 'הצוערים ניצלו את זמן ההמתנה לחזרה על הפקודה - עבד טוב'],
    ['conclusion', 'חסר תיאום מוקדם בין המדריך לבין מפק"צ השבוע'],
    ['lesson', 'לקיים שיחת תיאום עם המדריך 48 שעות לפני כל פעילות'],
    ['lesson', 'וידוא הסעות טלפוני ערב לפני כל יציאה לשטח'],
  ];
  const itemIds = debItems.map(([kind, body]) => at(d(-1, '20:00'), () => addItem(u(ids.s3), deb, { kind: kind as 'fact', body })));
  at(d(-1, '20:15'), () => itemToTask(u(ids.s3), itemIds[6], { title: 'וידוא הסעות לתרגיל התקפה ערב לפני', ownerIds: [ids.s5], deadline: d(4, '20:00'), priority: 'high' }));
  at(d(-1, '20:20'), () => updateDebrief(u(ids.s3), deb, { status: 'final' }));
  at(d(-8, '18:00'), () => createDebrief(u(ids.s2), { title: 'תחקיר ניווט בסיסי', occurredOn: addDays(today, -8), summary: 'ניווט בסיסי ראשון. שתי חוליות טעו בנקודה 3.' }));

  // documents
  const docs: [string, string, string, string][] = [
    ['נוהל בטיחות במטווחים', 'נהלים', 'https://drive.google.com/file/d/safety-range', 'גרסה מעודכנת לשנת 2026'],
    ['פקודת הקורס', 'פקודות', 'https://drive.google.com/file/d/course-order', 'כולל לו"ז מסגרת וחלוקת אחריות'],
    ['מצגת עקרונות ההתקפה', 'מצגות', 'https://docs.google.com/presentation/d/attack', 'לשיעור בשבוע התקפה'],
    ['חוברת ניווט לצוער', 'חומרי הדרכה', 'https://drive.google.com/file/d/nav-booklet', ''],
    ['טופס בקשת שטח אש', 'קישורים', 'https://forms.gle/firing-area', 'להגשה 10 ימים מראש'],
  ];
  docs.forEach(([title, category, url, description], i) =>
    at(d(-15 + i, '12:00'), () => createLinkDocument(i < 2 ? cmd : u(S[i % 5]), { title, category, url, description, pinned: i === 1, weekId: i === 2 ? weekIds[3] : null })),
  );

  // ---------------- let the automation catch up to "now" ----------------
  db().run('UPDATE notifications SET read_at = created_at WHERE created_at < ?', d(-1, '00:00'));
  runAutomation();

  const counts = db().get<{ t: number; w: number; e: number }>('SELECT (SELECT count(*) FROM tasks) AS t, (SELECT count(*) FROM weeks) AS w, (SELECT count(*) FROM events) AS e')!;
  return { tasks: counts.t, weeks: counts.w, events: counts.e };
}

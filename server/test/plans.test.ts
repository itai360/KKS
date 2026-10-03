// Plan approval: a document for every week, drafted from the schedule and the course's state,
// rewritten by the commander, approved by the commander above - and what changed since.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanDocument, PlansOverview } from '../../shared/types';
import { classify, joinHe, readEvents } from '../src/plans';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
const weekIds: number[] = [];
const eventIds: Record<string, number> = {};

async function week(name: string, startDate: string, endDate: string, extra: Record<string, unknown> = {}) {
  const res = await c.cmd.post('/api/weeks', { name, startDate, endDate, ...extra });
  expect(res.status).toBe(200);
  weekIds.push(res.body.id);
}

async function event(title: string, date: string, startTime: string, endTime: string | null, ownerId: number | null = null) {
  const res = await c.cmd.post('/api/events', { title, date, startTime, endTime, ownerId, location: 'שטח אימונים' });
  expect(res.status).toBe(200);
  eventIds[title] = res.body.event.id;
}

beforeEach(async () => {
  c = await setup();
  weekIds.length = 0;
  await week('שבוע התקפה', '2026-10-04', '2026-10-08', { topic: 'התקפה בשטח פתוח', leadId: c.ids.s1 });
  await week('שבוע הגנה', '2026-10-11', '2026-10-15');
  await week('שבוע שטח', '2026-10-18', '2026-10-22');
  await week('שבוע מבחנים', '2026-10-25', '2026-10-29');
  await week('שבוע סיום', '2026-11-01', '2026-11-05');
  for (const d of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
    await event('אימון גופני', d, '06:30', '07:30', c.ids.s1);
    await event('ארוחת צהריים', d, '13:00', '13:45');
  }
  await event('שיעור: עקרונות התקפה', '2026-10-04', '09:00', '11:00', c.ids.s1);
  await event('ניווט לילה', '2026-10-05', '20:00', '02:00', c.ids.s1);
  await event('מטווח הפעלת כוח', '2026-10-06', '10:00', '15:00', c.ids.s2);
  await event('תרגיל התקפה', '2026-10-07', '06:00', '22:00', c.ids.s3);
  await event('מבחן עקרונות', '2026-10-08', '09:00', '10:00');
  await event('טקס אמצע קורס', '2026-10-20', '18:00', '20:00', c.ids.s2);
  await event('מבחן מסכם', '2026-10-27', '09:00', '12:00', c.ids.s1);
  // the owner of the exercise is away that day, and the range is not ready
  await c.s3.post('/api/absences', { startDate: '2026-10-07', endDate: '2026-10-07', reason: 'leave' });
  await newTask(c.cmd, { title: 'תיאום רפואה למטווח', ownerIds: [c.ids.s2], eventId: eventIds['מטווח הפעלת כוח'], deadline: at('2026-10-05') });
});

const doc = async (i = 0) => (await c.cmd.get(`/api/plans/${weekIds[i]}`)).body as PlanDocument;

describe('reading the schedule', () => {
  it('tells activities apart by their names, and leaves the routine out', () => {
    expect(classify('שיעור: קרב בשטח בנוי')).toBe('learning');
    expect(classify('תרגיל כיתה בשטח')).toBe('field');
    expect(classify('מסדר בוקר ופתיחת יום')).toBe('routine');
    expect(classify('מסדר סיום הקורס')).toBe('ceremony');
    expect(classify('תחקיר תרגיל התקפה')).toBe('staff');
    expect(classify("ח' ערכים")).toBe('values');
    expect(joinHe(['מטווח', 'תרגיל התקפה'])).toBe('מטווח ותרגיל התקפה');
    expect(joinHe(['א', 'ב', '"ג"'])).toBe('א, ב ו-"ג"');
    // the same title on consecutive days is one activity
    const raw = (date: string) => ({ date, startTime: '06:00', endTime: '20:00', title: 'שבוע שטח מסכם', location: '', ownerName: null, notes: '', prep: null, source: 'course' as const });
    const [one] = readEvents([raw('2026-10-18'), raw('2026-10-19'), raw('2026-10-20')]);
    expect(one).toMatchObject({ date: '2026-10-18', endDate: '2026-10-20', kind: 'field', weight: 5 });
  });
});

describe('plan approval', () => {
  it('is the commander\'s only', async () => {
    expect((await c.s1.get('/api/plans')).status).toBe(403);
    expect((await c.s1.get(`/api/plans/${weekIds[0]}`)).status).toBe(403);
    expect((await c.s1.patch(`/api/plans/${weekIds[0]}`, { goals: ['x'] })).status).toBe(403);
    expect((await c.s1.post(`/api/plans/${weekIds[0]}/approve`, { by: 'מח"ט', on: '2026-10-01' })).status).toBe(403);
  });

  it('drafts the week from the schedule: key activities, the three weeks after, goals, achievements, emphases, risks', async () => {
    const d = await doc();
    expect(d.position).toMatchObject({ index: 1, total: 5, phase: 'opening' });
    const titles = d.horizon[0].events.map((e) => e.title);
    expect(titles).toEqual(['ניווט לילה', 'מטווח הפעלת כוח', 'תרגיל התקפה', 'מבחן עקרונות']);
    expect(titles).not.toContain('אימון גופני');
    expect(d.horizon.map((w) => w.name)).toEqual(['שבוע התקפה', 'שבוע הגנה', 'שבוע שטח', 'שבוע מבחנים']);
    expect(d.horizon[2].events.map((e) => e.title)).toEqual(['טקס אמצע קורס']);
    expect(d.horizon[0].events.find((e) => e.title === 'מטווח הפעלת כוח')?.prep).toEqual({ done: 0, total: 1 });

    const all = (k: keyof PlanDocument['sections']) => d.sections[k].items.join('\n');
    expect(all('goals')).toContain('להקנות ולתרגל: התקפה בשטח פתוח');
    expect(all('goals')).toContain('תרגיל התקפה');
    expect(all('goals')).toContain('עקרונות התקפה');
    expect(all('achievements')).toContain('כל הצוערים נבחנו במבחן עקרונות');
    expect(all('emphases')).toContain('בטיחות');
    expect(all('emphases')).toContain('פעילות לילה (ניווט לילה)');
    expect(all('emphases')).toContain('להתחיל כבר השבוע את ההכנות לטקס אמצע קורס');
    expect(all('emphases')).toContain('קליטה ותיאום ציפיות');
    expect(all('requests')).toContain('אישור תוכניות האימון');
    expect(all('requests')).toContain('הזמנה לטקס אמצע קורס');

    const risks = d.risks.map((r) => `${r.level}: ${r.text}`);
    expect(risks).toContain('high: מפק"צ 3, האחראי על תרגיל התקפה, בהיעדרות ב-7.10');
    expect(risks).toContain('medium: למבחן עקרונות אין אחראי');
    expect(risks).toContain('high: מוכנות מטווח הפעלת כוח: 0/1 משימות הכנה');
    expect(d.visit?.title).toBe('תרגיל התקפה');
    expect(d.bluf.text).toContain('שבוע התקפה - שבוע 1 מתוך 5 בקורס.');
    expect(d.bluf.text).toContain('בהמשך: טקס אמצע קורס (20.10).');
    expect(d.status).toBe('draft');
  });

  it('the commander rewrites any part, and can go back to the draft', async () => {
    let d = (await c.cmd.patch(`/api/plans/${weekIds[0]}`, { goals: ['מטרה שלי', 'עוד מטרה'], bluf: 'שורה תחתונה שלי' })).body as PlanDocument;
    expect(d.sections.goals).toMatchObject({ items: ['מטרה שלי', 'עוד מטרה'], edited: true });
    expect(d.sections.goals.auto.length).toBeGreaterThan(0);
    expect(d.bluf).toMatchObject({ text: 'שורה תחתונה שלי', edited: true });
    d = (await c.cmd.patch(`/api/plans/${weekIds[0]}`, { goals: null, bluf: null })).body as PlanDocument;
    expect(d.sections.goals.edited).toBe(false);
    expect(d.bluf.edited).toBe(false);
    expect((await c.cmd.patch(`/api/plans/${weekIds[0]}`, { goals: ['x'.repeat(501)] })).status).toBe(400);
  });

  it('records the approval, and shows what changed in the week since', async () => {
    expect((await c.cmd.post(`/api/plans/${weekIds[0]}/approve`, { by: 'מח"ט', on: '2026-10-09' })).status).toBe(400); // not yet
    const res = await c.cmd.post(`/api/plans/${weekIds[0]}/approve`, { by: 'אל"ם ישראלי, מפקד בה"ד', on: '2026-10-01', notes: 'לחזק את הבטיחות במטווח' });
    expect(res.body).toMatchObject({ status: 'approved', approval: { by: 'אל"ם ישראלי, מפקד בה"ד', on: '2026-10-01', notes: 'לחזק את הבטיחות במטווח' }, changes: [] });

    expect((await c.cmd.patch(`/api/events/${eventIds['מטווח הפעלת כוח']}`, { date: '2026-10-08' })).status).toBe(200);
    await event('מבחן ירי', '2026-10-06', '16:00', '17:00', c.ids.s2);
    expect((await c.cmd.post(`/api/events/${eventIds['מבחן עקרונות']}/cancel`, { taskAction: 'keep' })).status).toBe(200);
    const d = await doc();
    expect(d.changes).toEqual(['הוזז: מטווח הפעלת כוח - משלישי 6.10 10:00 לחמישי 8.10 10:00', 'ירד מהתוכנית: מבחן עקרונות (חמישי 8.10 09:00)', 'נוסף: מבחן ירי (שלישי 6.10 16:00)']);
    const list = (await c.cmd.get('/api/plans')).body as PlansOverview;
    expect(list.weeks[0]).toMatchObject({ status: 'approved', changed: true, approval: { by: 'אל"ם ישראלי, מפקד בה"ד' } });
    expect(list.weeks[1]).toMatchObject({ status: 'draft', changed: false });
    expect(list.currentWeekId).toBe(weekIds[0]);

    // back to ready: the approval no longer stands
    const back = (await c.cmd.patch(`/api/plans/${weekIds[0]}`, { status: 'ready' })).body as PlanDocument;
    expect(back).toMatchObject({ status: 'ready', approval: null, changes: [] });
  });
});

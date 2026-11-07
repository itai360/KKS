import { beforeEach, describe, expect, it } from 'vitest';
import { setPushSender } from '../src/push';
import { headline, type PushNote } from '../src/pushText';
import { at, newTask, setup, type Ctx } from './helpers';

let c: Ctx;
/** what reached each phone, in order */
const sent: { to: string; title: string; body: string }[] = [];
const phone = (who: string) => sent.filter((s) => s.to === who).map(({ title, body }) => ({ title, body }));
const settle = () => new Promise((r) => setTimeout(r, 20));
const keys = { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' };

beforeEach(async () => {
  c = await setup();
  sent.length = 0;
  setPushSender(async (target, payload) => {
    const p = JSON.parse(payload) as { title: string; body: string };
    sent.push({ to: target.endpoint.split('/').pop()!, title: p.title, body: p.body });
    return { statusCode: 201 };
  });
  for (const [who, agent] of [['cmd', c.cmd], ['s1', c.s1]] as const) {
    await agent.post('/api/push/subscribe', { endpoint: `https://fcm.googleapis.com/fcm/send/${who}`, keys });
  }
});

describe('on the phone, the thing itself first', () => {
  it('a new task: its name is the title and its deadline the first line - no "נוספה לך משימה חדשה"', async () => {
    await newTask(c.cmd, { title: 'תיאום מטווח', description: 'להזמין את המטווח', ownerIds: [c.ids.s1], deadline: at('2026-10-02', '14:00') });
    await settle();
    expect(phone('s1')).toEqual([{ title: 'תיאום מטווח', body: 'דד-ליין: מחר 14:00 (נותרו יום)\nמאת מפקד הקורס\nפירוט: להזמין את המטווח' }]);
  });

  it('what happened to a task comes first under its name: an instruction, a new deadline, a cancellation, done', async () => {
    const id = await newTask(c.cmd, { title: 'דוח ציוד', ownerIds: [c.ids.s1], deadline: at('2026-10-02', '14:00') });
    await c.cmd.post(`/api/tasks/${id}/updates`, { body: 'לצרף את רשימת הנשק', kind: 'instruction' });
    await settle();
    expect(phone('s1').at(-1)).toEqual({ title: 'דוח ציוד', body: 'הנחיה חדשה · מפקד הקורס: לצרף את רשימת הנשק\nדד-ליין: מחר 14:00 (נותרו יום)' });

    await c.cmd.patch(`/api/tasks/${id}`, { deadline: at('2026-10-02', '18:00') });
    await settle();
    expect(phone('s1').at(-1)).toEqual({ title: 'דוח ציוד', body: 'דד-ליין חדש: מחר 18:00 (נותרו יום)' });

    await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'cancel', reason: 'כבר לא נדרש' });
    await settle();
    expect(phone('s1').at(-1)).toEqual({ title: 'דוח ציוד', body: 'המשימה בוטלה · כבר לא נדרש' });

    const done = await newTask(c.cmd, { title: 'הזמנת הסעה', ownerIds: [c.ids.s1], priority: 'high' });
    await c.s1.post(`/api/tasks/${done}/transition`, { action: 'complete' });
    await settle();
    expect(phone('cmd').at(-1)).toEqual({ title: 'הזמנת הסעה', body: 'מפק"צ 1 השלים את המשימה' });
  });

  it('an invitation is the event itself; an announcement is its message', async () => {
    await c.cmd.post('/api/events', { date: '2026-10-07', startTime: '08:00', title: 'ישיבת תכנון', guests: [{ userId: c.ids.s1 }] });
    await settle();
    const invite = phone('s1').at(-1)!;
    expect(invite.title).toBe('ישיבת תכנון');
    expect(invite.body).toMatch(/08:00.* · מאת מפקד הקורס$/);
    expect(invite.body).not.toContain('הוזמנת');

    await c.cmd.post('/api/announcements', { title: 'מסדר מפקד ביום חמישי 07:00', body: 'כל הסגל במדים א', urgent: true });
    await settle();
    expect(phone('s1').at(-1)).toEqual({ title: 'מסדר מפקד ביום חמישי 07:00', body: 'דחוף · כל הסגל במדים א' });
  });

  it('every kind: the name of the thing, and the news only when there is more to say than "new for you"', () => {
    // [the type, the title in the app, the task's name now (a task's), the phone's title, the line of news]
    const cases: [string, string, string | null, string, string][] = [
      ['task_assigned', 'נוספה לך משימה חדשה: "תיאום עם רס"ר"', 'תיאום עם רס"ר', 'תיאום עם רס"ר', ''],
      ['task_assigned', 'צורפת למשימה: "תרגיל"', 'תרגיל', 'תרגיל', ''],
      ['task_assigned', 'הועברה אליך משימה: "תרגיל"', 'תרגיל', 'תרגיל', ''],
      // the commander attached to oversee it: not his - so it says so
      ['task_assigned', 'לבקרה שלך: "תרגיל"', 'תרגיל', 'תרגיל', 'לבקרה שלך'],
      ['task_assigned', 'מפק"צ 1 מבקש/ת להטיל עליך משימה: "תרגיל"', 'תרגיל', 'תרגיל', 'מפק"צ 1 מבקש/ת להטיל עליך משימה'],
      ['reminder_24h', 'נותרו 24 שעות לסיום המשימה "תרגיל"', 'תרגיל', 'תרגיל', ''],
      ['overdue', 'המשימה "תרגיל" עברה את הדד-ליין', 'תרגיל', 'תרגיל', ''],
      ['critical_overdue', 'משימה קריטית באיחור: "תרגיל"', 'תרגיל', 'תרגיל', ''],
      ['blocked', 'חסם במשימה "תרגיל" - נדרשת התערבות', 'תרגיל', 'תרגיל', 'חסם - נדרשת התערבות'],
      ['unblocked', 'החסם במשימה "תרגיל" טופל', 'תרגיל', 'תרגיל', 'החסם טופל'],
      ['escalated', 'נדרשת החלטה במשימה באיחור "תרגיל"', 'תרגיל', 'תרגיל', 'נדרשת החלטה באיחור'],
      ['group_done', 'כל הסגל השלים את "תרגיל"', 'תרגיל', 'תרגיל', 'כל הסגל השלים את המשימה'],
      ['dependency_done', '"הזמנת שטח" הושלמה - אפשר להתקדם ב"תרגיל"', 'תרגיל', 'תרגיל', '"הזמנת שטח" הושלמה - אפשר להתקדם'],
      ['request', 'בקשת שינוי דד-ליין: "תרגיל"', 'תרגיל', 'תרגיל', 'בקשת שינוי דד-ליין'],
      ['request_decided', 'בקשת העברת אחריות נדחתה: "תרגיל"', 'תרגיל', 'תרגיל', 'בקשת העברת אחריות נדחתה'],
      ['owner_changed', 'המשימה "תרגיל" הועברה למפק"צ 2', 'תרגיל', 'תרגיל', 'המשימה הועברה למפק"צ 2'],
      ['carried', 'המשימה "תרגיל" עברה לשבוע 4', 'תרגיל', 'תרגיל', 'המשימה עברה לשבוע 4'],
      // renamed since: called as it is now
      ['cancelled', 'המשימה "שם ישן" בוטלה', 'שם חדש', 'שם חדש', 'המשימה בוטלה'],
      // deleted: only the notification knows its name
      ['deleted', 'המשימה "תרגיל" נמחקה', null, 'תרגיל', 'המשימה נמחקה'],
      ['event_reminder', 'בעוד 30 דקות: ישיבת סגל', null, 'ישיבת סגל', 'בעוד 30 דקות'],
      ['event_changed', 'שינוי בלו"ז: "ישיבת סגל" (3 אירועים בסדרה)', null, 'ישיבת סגל', 'שינוי בלו"ז (3 אירועים בסדרה)'],
      ['event_cancelled', 'הפעילות "מטווח" בוטלה', null, 'מטווח', 'הפעילות בוטלה'],
      ['event_cancelled', 'בוטל: מטווח', null, 'מטווח', 'בוטל'],
      ['event_owner', 'מונית לאחראי על "מטווח"', null, 'מטווח', 'מונית לאחראי'],
      ['announcement', 'הודעה לסגל: נוהל שטח', null, 'נוהל שטח', ''],
      ['announcement', 'תזכורת: נא לאשר קריאה - נוהל שטח', null, 'נוהל שטח', 'נא לאשר קריאה'],
      ['debrief', 'הגיע זמן התחקיר השבועי: שבוע 3', null, 'שבוע 3', 'הגיע זמן התחקיר השבועי'],
      ['debrief', 'תחקיר "מטווח לילה" סוכם', null, 'מטווח לילה', 'התחקיר סוכם'],
      ['lessons', '2 לקחים ממופעים קודמים: מטווח', null, 'מטווח', '2 לקחים ממופעים קודמים'],
      ['weekly_closure', 'סגירה מקצועית לשבועי: ציוד לשטח', null, 'ציוד לשטח', 'סגירה מקצועית לשבועי'],
      ['week_lead', 'מונית לאחראי על שבוע 3', null, 'שבוע 3', 'מונית לאחראי'],
      ['week_lead', 'מונית למפק"צ אחראי על שבוע 3', null, 'שבוע 3', 'מונית למפק"צ אחראי'],
      ['track_lead', 'מונית לאחראי על ציר שטח', null, 'ציר שטח', 'מונית לאחראי'],
      ['entry', 'אישור כניסה: ישראל ישראלי', null, 'ישראל ישראלי', 'אישור כניסה'],
      ['brief', 'בוקר טוב - משימה אחת להיום, 1 באיחור', null, 'משימה אחת להיום, 1 באיחור', ''],
      // already the thing itself: as it is
      ['absence', 'מפק"צ 1 - חופשה 3.10-5.10', null, 'מפק"צ 1 - חופשה 3.10-5.10', ''],
      ['event_response', 'מפק"צ 1: מגיע/ה', null, 'מפק"צ 1: מגיע/ה', ''],
    ];
    for (const [type, title, name, shown, lead] of cases) {
      const n: PushNote = { id: 1, type, title, body: '', link: null, category: 'info', ...(name ? { taskId: 1 } : {}) };
      expect([type, headline(n, name ?? undefined)]).toEqual([type, { title: shown, lead }]);
    }
  });
});

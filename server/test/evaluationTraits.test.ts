// The evaluation traits (shared/evaluationTraits.ts): the catalog exactly as the course wrote it - four axes,
// their sub-axes (none under חוסן) and 154 traits, each in its own place - and remarks in the evaluation file
// that name them: only the catalog's own combinations are taken, they come back in order, are edited and
// deleted with their history, and only by those who open the file.

import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_TRAITS, groupProblem, TRAIT_AXES, traitsUnder } from '../../shared/evaluationTraits';
import { FEEDBACK_AXES } from '../../shared/experienceFeedback';
import type { EvaluationChange, EvaluationFile } from '../../shared/types';
import { setup, type Ctx } from './helpers';

/** the catalog as the course wrote it: each sub-axis (or axis) and its traits, in order */
const EXPECTED: Record<string, Record<string, string[]>> = {
  'המקצוע הצבאי': {
    להוביל: ['יציאה מאזור הנוחות', 'מיקוד במסרים', 'וידוא ההבנה', 'תשדורת סמכותית', 'קריאת הקהל', 'כושר ביטוי', 'האצלת סמכויות', 'מיקום המפקד'],
    להחליט: ['הפעלת שיקול דעת', 'הבחנה בין עיקר לטפל', 'פרואקטיביות', 'חשיבה ביקורתית', 'קביעת סדרי עדיפויות', 'קפדנות'],
    ליזום: ['חשיבה מחוץ לקופסה', 'תכנון משימה לאור המטרה', 'מקוריות', 'גזירת משמעויות', 'הגדלת ראש', 'יצירתיות', 'תכנון מול ביצוע', 'יעילות', 'ראייה כוללת'],
    להכין: ['יסודיות וירידה לפרטים', 'סדר וארגון', 'בקיאות', 'אבחון סיטואציות', 'היערכות מקדימה'],
    לבצע: ['עשייה שקטה', 'ביצוע מעקב ובקרה', 'רצינות והשקעה', 'עבודה במקביל', 'ניסוח', 'תחבולנות', 'ניהול זמנים', 'עבודה מול רמה ממונה', 'מוסר עבודה'],
    ללמוד: ['ניסוח בכתב', 'חתירה ללמידה ושיפור מתמיד', 'יכולת ניתוח והבנה', 'תחקיר אפקטיבי', 'גמישות מחשבתית', 'הפקת לקחים', 'דקדקנות'],
  },
  ערכים: {
    'דבקות במשימה וחתירה לניצחון': ['חתירה לידע', 'אפקטיביות', 'להט בעשייה', 'סקרנות', 'שאיפה למצוינות', 'חתירה למגע', 'חדשנות'],
    אמינות: ['דיוק', 'הוגנות', 'יושרה', 'אותנטיות', 'נאמנות'],
    אחריות: ['עבודת צוות', 'התמדה', 'מעורבות', 'מקצועיות', 'עצמאות', 'ראייה מערכתית', 'דוגמה אישית'],
    שליחות: ['נאמנות', 'מסירות', 'חיבור למשימה', 'ייצוגיות'],
    משמעת: ['קיום נהלים', 'תקיפות', 'הצבת סטנדרט', 'בקיאות', 'ממלכתיות', 'הצבת גבולות', 'פזיזות'],
    רעות: ['סובלנות', 'עזרה הדדית', 'כבוד האדם', 'יחסי אנוש', 'הקשבה'],
    'חיי אדם': ['אנושיות', 'בקרה על כוח האדם', 'ביקורתיות', 'אופטימיות', 'רגישות', 'טוהר הנשק', 'קשיחות'],
  },
  מנהיגות: {
    'להכיר את עצמו ולהיות מודע לחוזקותיו וחולשותיו': ['עמידה מול קהל', 'דומיננטיות', 'צניעות', 'מודעות עצמית', 'ביטחון עצמי', 'תשדורת', 'ביקורת עצמית'],
    'יגבש תפיסה פיקודית': ['פתיחות', 'פועל לאור התפיסה הפיקודית', 'פשטות', 'העברת מסרים', 'פן אישי'],
    'יעורר מוטיבציה': ['יחס מכבד', 'איזון בין דרישה להכלה', 'ריכוזיות', 'עירור עניין', 'אכיפת משמעת', 'הנעת פקודים', 'רתימת עמיתים', 'אסרטיביות', 'כריזמטיות', 'שיתוף הקהל'],
    'ייצור יציבות ובהירות': ['יצירת תמונת מצב', 'אסרטיביות', 'זמינות', 'מתן רציונל', 'תושייה', 'שקיפות', 'נוכחות'],
    'פיתוח פקודיו': ['ניהול דיון מעמיק', 'ניצול הזדמנויות חינוכיות', 'אתגור מחשבתי', 'ותרנות', 'פיתוח תחושת מסוגלות', 'יחס אישי', 'פיתוח פקודים', 'דאגה לפרט', 'יכולת חניכה'],
    'יקבל החלטות': ['בחירת נקודת התערבות', 'קריאת סיטואציות חברתיות', 'התאמה לקהל היעד', 'דעתנות', 'ביצוע הערכת מצב', 'אומץ פיקודי'],
  },
  חוסן: {
    '': [
      'התמודדות עם אתגרים',
      'קור רוח',
      'רציפות תפקודית',
      'שליטה ואיפוק',
      'יכולת מתן וקבלת ביקורת',
      'התמודדות עם בלת״מים',
      'חוסן פיזי',
      'הפרדה בין אישי למקצועי',
      'הסתגלתנות',
      'תעוזה',
      'ייחודיות',
      'נחישות',
      'מסוגלות',
      'חוסן מנטלי',
      'הבעת עמדה',
      'פרופורציות',
      'תפקוד בתנאי לחץ',
      'איתנות',
      'פתיחות לשינויים',
      'משמעת עצמית',
      'אינטליגנציה רגשית',
      'חשיבה רעננה',
      'לכידות',
      'תעצומות נפש',
    ],
  },
};

describe('the catalog of evaluation traits', () => {
  it('has the four axes, their sub-axes and 154 traits - each in its place, in the order written', () => {
    expect(TRAIT_AXES.map((a) => a.name)).toEqual(['המקצוע הצבאי', 'ערכים', 'מנהיגות', 'חוסן']);
    expect(TRAIT_AXES.map((a) => a.subAxes.length)).toEqual([6, 7, 6, 0]);
    const count = (name: string) => ALL_TRAITS.filter((t) => t.axis.name === name).length;
    expect(['המקצוע הצבאי', 'ערכים', 'מנהיגות', 'חוסן'].map(count)).toEqual([44, 42, 44, 24]);
    expect(ALL_TRAITS).toHaveLength(154);
    // as written, sub-axis by sub-axis
    const actual = Object.fromEntries(TRAIT_AXES.map((a) => [a.name, a.subAxes.length ? Object.fromEntries(a.subAxes.map((s) => [s.name, s.traits.map((t) => t.name)])) : { '': a.traits.map((t) => t.name) }]));
    expect(actual).toEqual(EXPECTED);
  });

  it('gives every axis, sub-axis and trait an id of its own; the same words in two places are two traits', () => {
    const ids = [...TRAIT_AXES.map((a) => a.id), ...TRAIT_AXES.flatMap((a) => a.subAxes.map((s) => s.id)), ...ALL_TRAITS.map((t) => t.trait.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const [name, n] of [['אסרטיביות', 2], ['נאמנות', 2], ['בקיאות', 2]] as const) {
      const places = ALL_TRAITS.filter((t) => t.trait.name === name);
      expect(places, name).toHaveLength(n);
      expect(new Set(places.map((p) => p.sub?.id)).size, name).toBe(n);
    }
    // one trait, not two
    expect(ALL_TRAITS.filter((t) => t.trait.name.startsWith('יסודיות')).map((t) => t.trait.name)).toEqual(['יסודיות וירידה לפרטים']);
  });

  it('takes only the combinations it has', () => {
    const lead = 'military.lead';
    expect(groupProblem({ axis: 'military', sub: lead, traits: ['military.lead.2'] })).toBeNull();
    expect(groupProblem({ axis: 'resilience', sub: null, traits: ['resilience.2', 'resilience.24'] })).toBeNull();
    expect(groupProblem({ axis: 'military', sub: null, traits: ['military.lead.2'] })).toBe('בחרו תת ציר בהמקצוע הצבאי');
    expect(groupProblem({ axis: 'military', sub: 'values.reliability', traits: ['values.reliability.1'] })).toBe('תת הציר לא שייך לציר המקצוע הצבאי');
    expect(groupProblem({ axis: 'military', sub: lead, traits: ['military.decide.1'] })).toBe('מאפיין שלא שייך להמקצוע הצבאי · להוביל');
    expect(groupProblem({ axis: 'resilience', sub: 'resilience.x', traits: ['resilience.1'] })).toBe('לציר חוסן אין תתי צירים');
    expect(groupProblem({ axis: 'military', sub: lead, traits: [] })).toBe('בחרו לפחות מאפיין אחד בהמקצוע הצבאי · להוביל');
    expect(groupProblem({ axis: 'nothing', sub: null, traits: ['x'] })).toBe('ציר לא מוכר');
    expect(traitsUnder('resilience', null)).toHaveLength(24);
    expect(traitsUnder('military', null)).toEqual([]);
  });

  it('is where the feedback after an experience takes its axes from', () => {
    expect(FEEDBACK_AXES).toEqual([...TRAIT_AXES.flatMap((a) => (a.subAxes.length ? a.subAxes.map((s) => `${a.name} - ${s.name}`) : [a.name]))]);
  });
});

describe('remarks in the evaluation file that name traits', () => {
  let c: Ctx;
  let cadet: number;
  beforeEach(async () => {
    c = await setup();
    const team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
    cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'לוי', teamId: team })).body.cadet.id;
  });
  const file = async (agent: Ctx['cmd'] = c.cmd) => (await agent.get(`/api/evaluations/${cadet}`)).body as EvaluationFile;
  const add = (agent: Ctx['cmd'], body: object) => agent.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-10-05', ...body });

  it('are kept with their axis, sub-axis, traits and words - in the catalog\'s order - with or without a remark of their own', async () => {
    const res = await add(c.s1, {
      body: '',
      traits: [
        { axis: 'resilience', sub: null, traits: ['resilience.2'], text: 'שמר על קור רוח בתרגיל הלילה' },
        { axis: 'military', sub: 'military.lead', traits: ['military.lead.6', 'military.lead.2'], text: 'התקשה למקד את המסרים בתדריך' },
      ],
    });
    expect(res.status).toBe(200);
    const note = (await file(c.s1)).notes[0];
    expect(note.body).toBe('');
    expect(note.traits).toEqual([
      {
        axis: 'military',
        sub: 'military.lead',
        traits: [
          { id: 'military.lead.6', name: 'כושר ביטוי' },
          { id: 'military.lead.2', name: 'מיקוד במסרים' },
        ],
        text: 'התקשה למקד את המסרים בתדריך',
      },
      { axis: 'resilience', sub: null, traits: [{ id: 'resilience.2', name: 'קור רוח' }], text: 'שמר על קור רוח בתרגיל הלילה' },
    ]);
    // the same words in two places: each kept in its own
    await add(c.cmd, { traits: [{ axis: 'leadership', sub: 'leadership.motivate', traits: ['leadership.motivate.8'] }, { axis: 'leadership', sub: 'leadership.stability', traits: ['leadership.stability.2'] }] });
    const both = (await file()).notes[1].traits;
    expect(both.map((g) => [g.sub, g.traits[0].name])).toEqual([
      ['leadership.motivate', 'אסרטיביות'],
      ['leadership.stability', 'אסרטיביות'],
    ]);
  });

  it('refuse what the catalog does not have, and a remark with nothing in it', async () => {
    const bad: [object, string][] = [
      [{ traits: [{ axis: 'military', sub: 'values.reliability', traits: ['values.reliability.1'] }] }, 'תת הציר לא שייך לציר המקצוע הצבאי'],
      [{ traits: [{ axis: 'military', sub: 'military.lead', traits: ['military.decide.1'] }] }, 'מאפיין שלא שייך להמקצוע הצבאי · להוביל'],
      [{ traits: [{ axis: 'military', traits: ['military.lead.1'] }] }, 'בחרו תת ציר בהמקצוע הצבאי'],
      [{ traits: [{ axis: 'resilience', sub: 'military.lead', traits: ['resilience.1'] }] }, 'לציר חוסן אין תתי צירים'],
      [{ traits: [{ axis: 'values', sub: 'values.calling', traits: [] }] }, 'בחרו לפחות מאפיין אחד בערכים · שליחות'],
      [
        {
          traits: [
            { axis: 'values', sub: 'values.calling', traits: ['values.calling.1'] },
            { axis: 'values', sub: 'values.calling', traits: ['values.calling.2'] },
          ],
        },
        'אותו תת ציר נבחר פעמיים - בחרו את המאפיינים באותה קבוצה',
      ],
      [{ body: '  ', traits: [] }, 'בחרו מאפיינים או כתבו את ההתייחסות'],
    ];
    for (const [body, message] of bad) {
      const res = await add(c.s1, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe(message);
    }
    expect((await file()).notes).toEqual([]);
    // a remark of words alone, as before
    expect((await add(c.s1, { body: 'רק מילים' })).status).toBe(200);
    expect((await file()).notes[0]).toMatchObject({ body: 'רק מילים', traits: [] });
  });

  it('are edited and deleted with the file\'s history, by whom may - and only those who open the file', async () => {
    await add(c.s1, { traits: [{ axis: 'values', sub: 'values.reliability', traits: ['values.reliability.1'] }] });
    const note = (await file(c.s1)).notes[0];
    // another team's commander, or the staff, do not open the file at all
    expect((await c.s2.post(`/api/evaluations/${cadet}/notes`, { occurredOn: '2026-10-05', traits: [{ axis: 'resilience', traits: ['resilience.1'] }] })).status).toBe(403);
    expect((await c.s2.patch(`/api/evaluations/notes/${note.id}`, { traits: [], body: 'x', version: 1 })).status).toBe(403);
    // the writer swaps the traits and adds words
    const edited = (await c.s1.patch(`/api/evaluations/notes/${note.id}`, { traits: [{ axis: 'values', sub: 'values.reliability', traits: ['values.reliability.3', 'values.reliability.5'], text: 'עמד במילה' }], version: note.version })).body as EvaluationFile;
    expect(edited.notes[0]).toMatchObject({ version: 2, edited: true });
    expect(edited.notes[0].traits[0].traits.map((t) => t.name)).toEqual(['יושרה', 'נאמנות']);
    // a combination the catalog lacks is refused on edit too
    expect((await c.s1.patch(`/api/evaluations/notes/${note.id}`, { traits: [{ axis: 'values', sub: 'values.reliability', traits: ['values.calling.1'] }], version: 2 })).status).toBe(400);
    // reloaded, it is as saved
    expect((await file()).notes[0].traits[0].text).toBe('עמד במילה');
    const history = (await c.cmd.get(`/api/evaluations/${cadet}/history`)).body as EvaluationChange[];
    expect(history.find((h) => h.label === 'מאפייני התייחסות עודכנה')).toMatchObject({ userName: 'מפק"צ 1', oldValue: 'ערכים · אמינות: דיוק', newValue: 'ערכים · אמינות: יושרה, נאמנות\nעמד במילה' });
    // deleted: gone from the file, kept in its history
    expect((await c.cmd.del(`/api/evaluations/notes/${note.id}`)).status).toBe(200);
    expect((await file()).notes).toEqual([]);
    const after = (await c.cmd.get(`/api/evaluations/${cadet}/history`)).body as EvaluationChange[];
    expect(after.find((h) => h.label === 'התייחסות נמחקה')?.oldValue).toBe('2026-10-05: ערכים · אמינות: יושרה, נאמנות\nעמד במילה');
  });

  it('go with the file to a committee', async () => {
    await add(c.s1, { traits: [{ axis: 'resilience', sub: null, traits: ['resilience.12'] }] });
    const referred = (await c.cmd.post(`/api/evaluations/${cadet}/committees`, { kind: 'ועדת הדחה', reason: 'בדיקה' })).body as EvaluationFile;
    const detail = (await c.cmd.get(`/api/evaluations/committees/${referred.committees[0].id}`)).body;
    expect(detail.file.notes[0].traits[0].traits[0].name).toBe('נחישות');
  });
});

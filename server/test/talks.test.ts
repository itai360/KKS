// Personal talks filled in as forms: who writes them, who sees them, completing them later.

import { beforeEach, describe, expect, it } from 'vitest';
import type { CadetDetail } from '../../shared/types';
import { talkText } from '../../shared/talks';
import { at, setup, type Ctx } from './helpers';

let c: Ctx;
let cadetId = 0;

beforeEach(async () => {
  c = await setup();
  const teamId = (await c.cmd.post('/api/teams', { name: 'צוות א', commanderId: c.ids.s1 })).body.find((t: { name: string }) => t.name === 'צוות א').id as number;
  const r = await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'לוי', teamId });
  cadetId = (r.body.cadet?.id ?? r.body.id) as number;
});

const intro = {
  kind: 'talk',
  category: 'שיחת היכרות',
  occurredOn: '2026-09-30',
  answers: { opening: 'שיחה קצרה בחדר הצוות', home: 'גר עם ההורים', motive: 'רוצה להוביל אנשים', strength: 'לומד מהר', remember: 'מנגן בגיטרה', focus: 'ניהול זמן', next: 'שיחת מעקב בעוד שבועיים', unknown: 'לא נשמר' },
};

describe('personal talks as forms', () => {
  it('the team commander fills one in; it reads as text too, and what comes next is kept', async () => {
    const res = await c.s1.post(`/api/cadets/${cadetId}/records`, intro);
    expect(res.status).toBe(200);
    const talk = (res.body as CadetDetail).records[0];
    expect(talk).toMatchObject({ kind: 'talk', category: 'שיחת היכרות', occurredOn: '2026-09-30', followUp: 'שיחת מעקב בעוד שבועיים', canEdit: true });
    expect(talk.talk).toEqual({ opening: 'שיחה קצרה בחדר הצוות', home: 'גר עם ההורים', motive: 'רוצה להוביל אנשים', strength: 'לומד מהר', remember: 'מנגן בגיטרה', focus: 'ניהול זמן', next: 'שיחת מעקב בעוד שבועיים' });
    expect(talk.body).toContain('1. האדם שמחוץ למדים\nמגורים ומשפחה: גר עם ההורים');
    expect(talk.body).toContain('2. הדרך לקצונה\nמניע אישי לקצונה: רוצה להוביל אנשים');
    expect(talk.body).toContain('רישום קצר מיד בסיום\nפרט אישי לזכור: מנגן בגיטרה');
    expect(talk.body).not.toContain('לא נשמר');
  });

  it('only the cadet\'s commanders write and see talks', async () => {
    expect((await c.s2.post(`/api/cadets/${cadetId}/records`, intro)).status).toBe(403);
    await c.s1.post(`/api/cadets/${cadetId}/records`, intro);
    expect(((await c.s2.get(`/api/cadets/${cadetId}`)).body as CadetDetail).records).toHaveLength(0);
    expect(((await c.cmd.get(`/api/cadets/${cadetId}`)).body as CadetDetail).records[0].talk?.remember).toBe('מנגן בגיטרה');
  });

  it('a talk needs its type and at least one answer', async () => {
    expect((await c.s1.post(`/api/cadets/${cadetId}/records`, { ...intro, category: 'סתם' })).body.error).toContain('סוג השיחה');
    expect((await c.s1.post(`/api/cadets/${cadetId}/records`, { ...intro, answers: { opening: '  ' } })).body.error).toContain('השיחה ריקה');
  });

  it('is completed later by its writer or the course commander, not by others', async () => {
    const talk = ((await c.s1.post(`/api/cadets/${cadetId}/records`, intro)).body as CadetDetail).records[0];
    const more = { category: 'שיחת היכרות', answers: { ...talk.talk, summary: 'תמונה טובה', next: 'בדיקה בעוד שבוע' } };
    const done = (await c.s1.patch(`/api/records/${talk.id}`, more)).body as CadetDetail;
    expect(done.records[0]).toMatchObject({ followUp: 'בדיקה בעוד שבוע' });
    expect(done.records[0].body).toBe(talkText('שיחת היכרות', { ...talk.talk, summary: 'תמונה טובה', next: 'בדיקה בעוד שבוע' }));
    expect((await c.cmd.patch(`/api/records/${talk.id}`, { ...more, occurredOn: '2026-10-01' })).body.records[0].occurredOn).toBe('2026-10-01');
    expect((await c.s2.patch(`/api/records/${talk.id}`, more)).status).toBe(403);
    // a note is not a talk
    const note = ((await c.s1.post(`/api/cadets/${cadetId}/records`, { kind: 'note', body: 'הערה' })).body as CadetDetail).records.find((r) => r.kind === 'note')!;
    expect((await c.s1.patch(`/api/records/${note.id}`, more)).status).toBe(404);
  });

  it('can open a follow-up task, private like the talk', async () => {
    const res = await c.s1.post(`/api/cadets/${cadetId}/records`, { ...intro, followUpTask: { title: 'שיחת מעקב עם נועם', deadline: at('2026-10-12') } });
    const detail = res.body as CadetDetail;
    expect(detail.records[0].taskTitle).toBe('שיחת מעקב עם נועם');
    expect(detail.tasks.find((t) => t.title === 'שיחת מעקב עם נועם')?.visibility).toBe('private');
  });
});

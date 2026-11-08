// A cadet's exceptional-weapon form: anyone on the staff fills it in, the team's commander and the course
// commander are told and see it (as the cadet's discipline), the course commander decides and closes it.

import { beforeEach, describe, expect, it } from 'vitest';
import type { CadetDetail, WeaponForm } from '../../shared/types';
import { notificationsOf, setup, type Ctx } from './helpers';

let c: Ctx;
let cadet: number;
beforeEach(async () => {
  c = await setup();
  // s1 commands the team; s2 and s3 are others on the staff
  const team = (await c.cmd.post('/api/teams', { name: 'צוות א', commanderId: c.ids.s1 })).body[0].id;
  await c.cmd.post('/api/cadets', { firstName: 'פלוני', lastName: 'אלמוני', teamId: team });
  cadet = (await c.cmd.get('/api/cadets')).body[0].id;
});

const form = (body: Record<string, unknown> = {}) => ({
  occurredOn: '2026-09-30',
  occurredAt: '06:40',
  place: 'חדר האוכל',
  kind: 'abandoned',
  weaponType: 'M16',
  weaponNumber: '1234567',
  description: 'הנשק נמצא על הכיסא בחדר האוכל, בלי הצוער לידו',
  cadetVersion: 'הלך להביא מים לשנייה',
  ...body,
});

describe('exceptional-weapon form', () => {
  it('anyone on the staff fills it in; the team commander and the course commander are told', async () => {
    const r = await c.s2.post(`/api/cadets/${cadet}/weapon-forms`, form());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const f = r.body as WeaponForm;
    expect(f).toMatchObject({
      cadetName: 'פלוני אלמוני',
      teamName: 'צוות א',
      teamCommanderName: 'מפק"צ 1',
      kind: 'abandoned',
      kindText: 'הפקרת נשק',
      weaponNumber: '1234567',
      foundBy: 'מפק"צ 2',
      decided: false,
      canEdit: true,
      canDecide: false,
      canDelete: true,
    });
    for (const who of [c.ids.s1, c.ids.cmd])
      expect(notificationsOf(who).at(-1)).toMatchObject({ type: 'weapon_form', category: 'exception', title: 'טופס נשק חריג: פלוני אלמוני', link: `/cadets/${cadet}/weapon/${f.id}` });
    expect(notificationsOf(c.ids.s2).filter((n) => n.type === 'weapon_form')).toEqual([]);
  });

  it("is seen as the cadet's discipline is: the team commander, the course commander, whoever wrote it", async () => {
    const f = (await c.s2.post(`/api/cadets/${cadet}/weapon-forms`, form())).body as WeaponForm;
    for (const [who, sees] of [
      [c.s1, true],
      [c.cmd, true],
      [c.s2, true],
      [c.s3, false],
    ] as const) {
      expect((await who.get(`/api/weapon-forms/${f.id}`)).status).toBe(sees ? 200 : 403);
      expect(((await who.get(`/api/cadets/${cadet}`)).body as CadetDetail).weaponForms.map((x) => x.kindText)).toEqual(sees ? ['הפקרת נשק'] : []);
    }
  });

  it('"אחר" says what it was; a description is a must', async () => {
    expect((await c.s1.post(`/api/cadets/${cadet}/weapon-forms`, form({ kind: 'other' }))).status).toBe(400);
    expect((await c.s1.post(`/api/cadets/${cadet}/weapon-forms`, form({ description: '' }))).status).toBe(400);
    const f = (await c.s1.post(`/api/cadets/${cadet}/weapon-forms`, form({ kind: 'other', kindOther: 'נשק בלי רצועה' }))).body as WeaponForm;
    expect(f.kindText).toBe('נשק בלי רצועה');
  });

  it('the team commander adds the handling; the course commander decides, and it is closed', async () => {
    const f = (await c.s2.post(`/api/cadets/${cadet}/weapon-forms`, form())).body as WeaponForm;
    let out = (await c.s1.patch(`/api/weapon-forms/${f.id}`, form({ handling: 'שיחה עם הצוער ורישום הערה' }))).body as WeaponForm;
    expect(out.handling).toBe('שיחה עם הצוער ורישום הערה');
    expect((await c.s1.post(`/api/weapon-forms/${f.id}/decision`, { decision: 'ריתוק' })).status).toBe(403);
    out = (await c.cmd.post(`/api/weapon-forms/${f.id}/decision`, { decision: 'ריתוק לסוף שבוע' })).body as WeaponForm;
    expect(out).toMatchObject({ decided: true, decision: 'ריתוק לסוף שבוע', decidedByName: 'מפקד הקורס' });
    expect(notificationsOf(c.ids.s2).at(-1)).toMatchObject({ type: 'weapon_form_decided', title: 'החלטה בטופס נשק חריג: פלוני אלמוני' });
    // closed: only the course commander changes it now
    expect((await c.s1.patch(`/api/weapon-forms/${f.id}`, form())).status).toBe(403);
    expect((await c.s2.del(`/api/weapon-forms/${f.id}`)).status).toBe(403);
    expect((await c.cmd.patch(`/api/weapon-forms/${f.id}`, form({ place: 'המגורים' }))).body.place).toBe('המגורים');
    // the decision cleared: open again
    expect(((await c.cmd.post(`/api/weapon-forms/${f.id}/decision`, { decision: '' })).body as WeaponForm).decided).toBe(false);
  });

  it('is deleted by whoever wrote it, before the decision', async () => {
    const f = (await c.s2.post(`/api/cadets/${cadet}/weapon-forms`, form())).body as WeaponForm;
    expect((await c.s3.del(`/api/weapon-forms/${f.id}`)).status).toBe(403);
    expect((await c.s2.del(`/api/weapon-forms/${f.id}`)).body).toEqual({ ok: true, cadetId: cadet });
    expect(((await c.cmd.get(`/api/cadets/${cadet}`)).body as CadetDetail).weaponForms).toEqual([]);
  });
});

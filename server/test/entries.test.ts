// Visitors' entry to the base (אישור כניסה): anyone on the staff asks, the commander hears at once and sends
// it on in the base's format - no dates; the details are seen by the one who asked and the commander alone,
// and go a week after they were sent to the base (a month after they were written, if never sent).

import { beforeEach, describe, expect, it } from 'vitest';
import { entryMessage, entryMissing } from '../../shared/entry';
import type { EntryRequest, Notification } from '../../shared/types';
import { housekeeping } from '../src/automation';
import { db } from '../src/db';
import { notificationsOf, setup, type Agent, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup(); // the clock stands on 2026-10-01
});

const visitor = {
  fullName: 'דנה כהן',
  phone: '050-1234567',
  visitorKind: 'civilian',
  idNumber: '123456782',
  reason: 'הרצאה לצוערים',
};
const list = async (agent: Agent) => (await agent.get('/api/entries')).body as EntryRequest[];
const bell = async (agent: Agent) => (await agent.get('/api/notifications')).body as Notification[];

describe('entry requests', () => {
  it('go to the commander at once, are seen only by whoever asked and the commander, and are marked sent', async () => {
    const r = await c.s1.post('/api/entries', visitor);
    expect(r.status).toBe(200);
    const id = r.body.id as number;
    // the commander's bell: what the phone shows says who and why - not the visitor's numbers
    const [n] = await bell(c.cmd);
    expect(n).toMatchObject({ type: 'entry', category: 'action', title: 'אישור כניסה: דנה כהן', link: `/entries#entry-${id}` });
    expect(n.body).not.toContain('123456782');
    expect(n.body).not.toContain('050');

    expect((await list(c.s1)).map((e) => [e.fullName, e.status, e.canEdit])).toEqual([['דנה כהן', 'pending', true]]);
    expect(await list(c.s2)).toEqual([]);
    expect((await list(c.cmd)).map((e) => e.createdByName)).toEqual(['מפק"צ 1']);
    // not another's to change, mark or delete
    expect((await c.s2.patch(`/api/entries/${id}`, { reason: 'x' })).status).toBe(403);
    expect((await c.s2.del(`/api/entries/${id}`)).status).toBe(403);
    expect((await c.s1.post(`/api/entries/${id}/sent`, {})).status).toBe(403);

    // sent on: out of the commander's bell; the one who asked hears it
    expect((await c.cmd.post(`/api/entries/${id}/sent`, {})).status).toBe(200);
    expect(await bell(c.cmd)).toEqual([]);
    expect(notificationsOf(c.ids.s1).map((x) => [x.type, x.title])).toEqual([['entry_sent', 'אישור הכניסה של דנה כהן נשלח לבסיס']]);
    expect(await bell(c.s1)).toEqual([]);
    // sent, it is no longer theirs to change - the commander's still
    expect((await list(c.s1))[0]).toMatchObject({ status: 'sent', canEdit: false });
    expect((await c.s1.patch(`/api/entries/${id}`, { reason: 'x' })).status).toBe(403);
    expect((await c.cmd.patch(`/api/entries/${id}`, { reason: 'הרצאה וסיור' })).status).toBe(200);
    // taken back: waiting again, and back in the commander's bell
    await c.cmd.post(`/api/entries/${id}/sent`, { sent: false });
    expect((await list(c.cmd))[0].status).toBe('pending');
    expect((await bell(c.cmd)).map((x) => x.type)).toEqual(['entry']);
  });

  it('ask for what the base needs: a soldier\'s rank, a car\'s number and make - and no date', async () => {
    expect((await c.s1.post('/api/entries', { ...visitor, visitorKind: 'soldier' })).body.error).toBe('לחייל צריך דרגה');
    expect((await c.s1.post('/api/entries', { ...visitor, byCar: true, carKind: 'לבנה' })).body.error).toBe('מגיע ברכב - חסר מספר הרכב');
    expect((await c.s1.post('/api/entries', { ...visitor, idNumber: '12-34' })).status).toBe(400);
    // a civilian keeps no rank, one on foot no car
    const id = (await c.s1.post('/api/entries', { ...visitor, rank: 'סרן', carNumber: '12-345-67' })).body.id;
    expect((await list(c.cmd)).find((e) => e.id === id)).toMatchObject({ rank: '', carNumber: '' });
    // changed by its writer while it waits
    expect((await c.s1.patch(`/api/entries/${id}`, { visitorKind: 'soldier', rank: 'סרן', byCar: true, carNumber: '12-345-67', carKind: 'מאזדה לבנה' })).status).toBe(200);
    expect((await list(c.s1))[0]).toMatchObject({ visitorKind: 'soldier', rank: 'סרן', byCar: true, carNumber: '12-345-67' });
    expect((await c.s1.del(`/api/entries/${id}`)).status).toBe(200);
    expect(await list(c.cmd)).toEqual([]);
    // deleted, it leaves the commander's bell too - and does not come back with the next request
    expect(await bell(c.cmd)).toEqual([]);
    await c.s2.post('/api/entries', { ...visitor, fullName: 'יואב לוי' });
    expect((await bell(c.cmd)).map((n) => n.title)).toEqual(['אישור כניסה: יואב לוי']);
  });

  it('are gone a week after they were sent to the base, and a month after they were written if never sent', async () => {
    await c.s1.post('/api/entries', visitor);
    const sent = (await c.s1.post('/api/entries', { ...visitor, fullName: 'יואב לוי' })).body.id as number;
    await c.cmd.post(`/api/entries/${sent}/sent`, {});
    housekeeping(new Date('2026-10-07T08:00:00Z'));
    expect((await list(c.cmd)).map((e) => e.fullName).sort()).toEqual(['דנה כהן', 'יואב לוי']);
    housekeeping(new Date('2026-10-09T08:00:00Z'));
    expect((await list(c.cmd)).map((e) => e.fullName)).toEqual(['דנה כהן']);
    housekeeping(new Date('2026-10-30T08:00:00Z'));
    expect(await list(c.cmd)).toHaveLength(1);
    // (a month on, the sign-ins have expired too: the table itself is read)
    housekeeping(new Date('2026-11-01T08:00:00Z'));
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM entry_requests')!.n).toBe(0);
  });
});

describe('the base format\'s fields', () => {
  it('keeps a military car, and the unit and camp a pasted format gave; a date sent by an older page is left out', async () => {
    const id = (await c.s1.post('/api/entries', { ...visitor, visitDate: '2026-09-30', byCar: true, carMilitary: true, carNumber: '123-456', carKind: 'סופה ירוקה', unit: 'יחידה אחרת', camp: 'מחנה אחר' })).body.id;
    const kept = (await list(c.cmd)).find((e) => e.id === id)!;
    expect(kept).toMatchObject({ carMilitary: true, unit: 'יחידה אחרת', camp: 'מחנה אחר' });
    expect(kept).not.toHaveProperty('visitDate');
    // the commander's notification says why and who asked
    expect((await bell(c.cmd))[0].body).toBe('הרצאה לצוערים · ביקש/ה: מפק"צ 1');
    // on foot, no car of any kind
    await c.s1.patch(`/api/entries/${id}`, { byCar: false });
    expect((await list(c.s1))[0]).toMatchObject({ byCar: false, carMilitary: false, carNumber: '' });
  });

  it('the message is written from what is kept, as the base writes it - with no date', async () => {
    await c.s1.post('/api/entries', { ...visitor, unit: 'יחידה אחרת' });
    const [e] = await list(c.cmd);
    const lines = entryMessage(e, { camp: 'מחנה הבדיקה', unit: 'יחידת הבדיקה' }).split('\n');
    expect(lines.slice(0, 5)).toEqual(['*🔵פורמט אישור כניסה למחנה הבדיקה 🔵*', '', '*יחידה אליה המבקר מגיע:* יחידה אחרת', '*שם מלא:* דנה כהן', "*מס' טלפון:* 050-1234567"]);
    expect(lines.some((l) => l.includes('תאריך'))).toBe(false);
    expect(entryMissing({ ...e, fullName: '', byCar: true, carNumber: '', carKind: '' })).toEqual(['שם מלא', 'מספר רכב', 'סוג וצבע רכב']);
  });
});

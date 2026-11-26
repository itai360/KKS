// A PATCH changes only the fields it carries. zod 4's .partial() keeps field
// defaults, which used to reset every optional field a patch left out.

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { setup, type Ctx } from './helpers';

let c: Ctx;
beforeEach(async () => {
  c = await setup();
});

describe('partial updates keep the fields they do not mention', () => {
  it('moving an event keeps its location and notes', async () => {
    const ev = await c.cmd.post('/api/events', { date: '2026-10-07', startTime: '10:00', title: 'מטווח', location: 'מטווח 3', notes: 'להביא אטמי אוזניים' });
    const id = ev.body.event.id;
    expect((await c.cmd.patch(`/api/events/${id}`, { startTime: '11:00' })).status).toBe(200);
    expect(db().get('SELECT start_time, location, notes FROM events WHERE id = ?', id)).toEqual({ start_time: '11:00', location: 'מטווח 3', notes: 'להביא אטמי אוזניים' });
  });

  it('a week lead can update goals without touching the lead, topic or dates', async () => {
    const w = await c.cmd.post('/api/weeks', { name: 'שבוע התקפה', topic: 'התקפה', startDate: '2026-10-04', endDate: '2026-10-10', leadId: c.ids.s1 });
    const id = w.body.id;
    expect((await c.s1.patch(`/api/weeks/${id}`, { goals: 'תרגיל פלוגתי' })).status).toBe(200);
    expect(db().get('SELECT topic, goals, lead_id FROM weeks WHERE id = ?', id)).toEqual({ topic: 'התקפה', goals: 'תרגיל פלוגתי', lead_id: c.ids.s1 });
    expect((await c.cmd.patch(`/api/weeks/${id}`, { name: 'שבוע התקפה 2' })).status).toBe(200);
    expect(db().get('SELECT topic, lead_id FROM weeks WHERE id = ?', id)).toEqual({ topic: 'התקפה', lead_id: c.ids.s1 });
  });

  it('changing a cadet status keeps the rest of the profile', async () => {
    const teamId = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
    const id = (await c.cmd.post('/api/cadets', { firstName: 'דניאל', lastName: 'כהן', personalNumber: '8200100', phone: '050-1', teamId, notes: 'אלרגיה לבוטנים' })).body.cadet.id;
    expect((await c.s1.patch(`/api/cadets/${id}`, { status: 'dropped' })).status).toBe(200);
    expect(db().get('SELECT last_name, personal_number, phone, team_id, notes, status FROM cadets WHERE id = ?', id)).toEqual({
      last_name: 'כהן',
      personal_number: '8200100',
      phone: '050-1',
      team_id: teamId,
      notes: 'אלרגיה לבוטנים',
      status: 'dropped',
    });
  });

  it('renaming a document keeps its description, pin and restriction', async () => {
    const d = await c.cmd.post('/api/documents', { title: 'פקודה', category: 'פקודות', url: 'https://a.b/c', description: 'גרסה 2', restricted: true, pinned: true });
    expect(d.status).toBe(200);
    const id = db().get<{ id: number }>('SELECT max(id) AS id FROM documents')!.id;
    expect((await c.cmd.patch(`/api/documents/${id}`, { title: 'פקודת הקורס' })).status).toBe(200);
    expect(db().get('SELECT title, description, restricted, pinned FROM documents WHERE id = ?', id)).toEqual({ title: 'פקודת הקורס', description: 'גרסה 2', restricted: 1, pinned: 1 });
  });

  it('changing a user role keeps their title and phone', async () => {
    await c.cmd.patch(`/api/users/${c.ids.s2}`, { title: 'סגן נועה', phone: '050-2' });
    expect((await c.cmd.patch(`/api/users/${c.ids.s2}`, { role: 'commander' })).status).toBe(200);
    expect(db().get('SELECT title, phone, role FROM users WHERE id = ?', c.ids.s2)).toEqual({ title: 'סגן נועה', phone: '050-2', role: 'commander' });
  });

  it('finalizing a debrief keeps its event, facilitator and summary', async () => {
    const ev = await c.cmd.post('/api/events', { date: '2026-10-01', startTime: '08:00', title: 'ניווט' });
    const eventId = ev.body.event.id;
    const d = await c.s1.post('/api/debriefs', { title: 'תחקיר ניווט', occurredOn: '2026-10-01', eventId, summary: 'ניווט לילה ראשון', participants: 'צוות 1' });
    const id = d.body.debrief.id;
    expect((await c.s1.patch(`/api/debriefs/${id}`, { status: 'final' })).status).toBe(200);
    expect(db().get('SELECT event_id, facilitator_id, summary, participants, status FROM debriefs WHERE id = ?', id)).toEqual({
      event_id: eventId,
      facilitator_id: c.ids.s1,
      summary: 'ניווט לילה ראשון',
      participants: 'צוות 1',
      status: 'final',
    });
    expect((await c.cmd.get(`/api/events/${eventId}`)).body.debriefs.map((x: { id: number }) => x.id)).toEqual([id]);
  });

  it('a debrief about an activity in the synced Google calendar keeps its name; a schedule event replaces it', async () => {
    const d = await c.s1.post('/api/debriefs', { title: 'תחקיר מטווח', occurredOn: '2026-10-01', activity: 'מטווח 25 מ׳' });
    const id = d.body.debrief.id;
    expect(d.body.debrief).toMatchObject({ eventId: null, eventTitle: 'מטווח 25 מ׳' });
    const ev = await c.cmd.post('/api/events', { date: '2026-10-01', startTime: '08:00', title: 'מטווח' });
    await c.s1.patch(`/api/debriefs/${id}`, { eventId: ev.body.event.id, activity: 'מטווח 25 מ׳' });
    expect(db().get('SELECT event_id, activity FROM debriefs WHERE id = ?', id)).toEqual({ event_id: ev.body.event.id, activity: '' });
    await c.s1.patch(`/api/debriefs/${id}`, { eventId: null, activity: 'מטווח לילה' });
    expect((await c.s1.get(`/api/debriefs/${id}`)).body.debrief).toMatchObject({ eventId: null, eventTitle: 'מטווח לילה' });
    expect((await c.s1.patch(`/api/debriefs/${id}`, { eventId: 99999 })).status).toBe(400);
  });
});

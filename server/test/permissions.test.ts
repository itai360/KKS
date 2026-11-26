// What the staff may do (settings - permissions, shared/permissions.ts): by default nearly everything the
// commander does; the system's dangerous actions and the final approvals stay the commander's whatever is
// set; and each switch the commander turns off closes its part again.

import { beforeEach, describe, expect, it } from 'vitest';
import { at, newTask, setup, staffMay, type Ctx } from './helpers';

let c: Ctx;
let week = 0;
let team = 0;
let cadet = 0;

beforeEach(async () => {
  c = await setup();
  week = (await c.cmd.post('/api/weeks', { name: 'שבוע שטח', startDate: '2026-09-27', endDate: '2026-10-03', leadId: c.ids.s1 })).body.id;
  team = (await c.cmd.post('/api/teams', { name: 'צוות 1', commanderId: c.ids.s1 })).body[0].id;
  cadet = (await c.cmd.post('/api/cadets', { firstName: 'נועם', lastName: 'לוי', teamId: team })).body.cadet.id;
});

describe('by default the staff do nearly everything', () => {
  it('weeks, the schedule, tracks, templates, plans, the weekly, teams, cadets, imports and announcements', async () => {
    // s2 leads nothing and commands no team
    const s = c.s2;
    expect((await s.post('/api/weeks', { name: 'שבוע ניווטים', startDate: '2026-10-04', endDate: '2026-10-10' })).status).toBe(200);
    expect((await s.patch(`/api/weeks/${week}`, { name: 'שבוע שטח וניווט' })).status).toBe(200);
    expect((await s.post('/api/events', { date: '2026-09-29', startTime: '10:00', title: 'מטווח' })).status).toBe(200);
    expect((await s.post('/api/tracks', { name: 'טקסים' })).status).toBe(200);
    expect((await s.post('/api/templates', { name: 'פתיחת שבוע', kind: 'week', items: [{ title: 'לו"ז מאושר', offsetDays: -3 }] })).status).toBe(200);
    expect((await s.post('/api/recurring', { title: 'דוח בוקר', frequency: 'daily', time: '08:00', assignee: 'all' })).status).toBe(200);
    expect((await s.patch(`/api/plans/${week}`, { goals: ['ניווט יום'] })).status).toBe(200);
    // a topic of a weekly whose week s2 does not lead: settled by s2 too
    const topic = (await c.s1.post('/api/weekly/items', { weekId: week, kind: 'topic', title: 'עומס שמירות' })).body.id;
    expect((await s.patch(`/api/weekly/items/${topic}`, { done: true, outcome: 'פיצול השמירות' })).status).toBe(200);
    expect((await s.post('/api/teams', { name: 'צוות 2' })).status).toBe(200);
    expect((await s.post('/api/cadets', { firstName: 'אורי', teamId: team })).status).toBe(200);
    expect((await s.post('/api/cadets/import', { text: 'שם פרטי\tשם משפחה\nיהב\tגור' })).status).toBe(200);
    expect((await s.post('/api/announcements', { title: 'מסדר ביום חמישי' })).status).toBe(200);
    // every task in sight, and a task for anyone - the commander too, outside their week
    expect((await s.post('/api/tasks', { title: 'למפקד', ownerIds: [c.ids.cmd], deadline: at('2026-10-20') })).status).toBe(200);
    const s1s = await newTask(c.cmd, { title: 'של מפק"צ 1', ownerIds: [c.ids.s1] });
    expect((await s.get(`/api/tasks/${s1s}`)).status).toBe(200);
  });

  it("but not another team's personal files - until the commander opens them", async () => {
    expect((await c.s2.get(`/api/evaluations/${cadet}`)).status).toBe(403);
    const card = (await c.s2.get(`/api/cadets/${cadet}`)).body.cadet as { canManage: boolean; canEdit: boolean };
    expect(card).toMatchObject({ canManage: false, canEdit: true });
    await staffMay(c, { cadetFiles: true });
    expect((await c.s2.get(`/api/evaluations/${cadet}`)).status).toBe(200);
    expect((await c.s2.get(`/api/cadets/${cadet}`)).body.cadet).toMatchObject({ canManage: true });
  });

  it('the notes of a file they do not see are not theirs to overwrite', async () => {
    await c.cmd.patch(`/api/cadets/${cadet}`, { notes: 'הערה של המפקדים' });
    expect((await c.s2.patch(`/api/cadets/${cadet}`, { phone: '0501234567', notes: '' })).status).toBe(200);
    const now = (await c.cmd.get(`/api/cadets/${cadet}`)).body.cadet as { phone: string; notes: string };
    expect(now).toMatchObject({ phone: '0501234567', notes: 'הערה של המפקדים' });
  });
});

describe("the commander's alone, whatever is set", () => {
  it('the final approvals', async () => {
    expect((await c.s1.post(`/api/weeks/${week}/approve`)).status).toBe(403);
    expect((await c.s1.post(`/api/plans/${week}/approve`, { by: 'מח"ט', on: '2026-10-01' })).status).toBe(403);
    expect((await c.s1.post(`/api/three-week/${week}/approve`, { by: 'מח"ט', on: '2026-10-01' })).status).toBe(403);
    expect((await c.s1.post(`/api/weekly/${week}/hold`, {})).status).toBe(403);
    expect((await c.s1.post(`/api/evaluations/${cadet}/committees`, { kind: 'discipline' })).status).toBe(403);
    // a task the commander marked as closing with his approval
    const id = await newTask(c.cmd, { title: 'סגירת שטח', ownerIds: [c.ids.s1], requiresApproval: true });
    await c.s1.post(`/api/tasks/${id}/transition`, { action: 'complete' });
    expect((await c.s1.get(`/api/tasks/${id}`)).body.task.status).toBe('pending_approval');
    expect((await c.s2.post(`/api/tasks/${id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await c.s1.post(`/api/tasks/${id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await c.cmd.post(`/api/tasks/${id}/transition`, { action: 'approve' })).status).toBe(200);
    // and the staff do not take the approval mark off it
    const other = await newTask(c.cmd, { title: 'הזמנת הסעות', ownerIds: [c.ids.s1], requiresApproval: true });
    expect((await c.s1.patch(`/api/tasks/${other}`, { requiresApproval: false })).status).toBe(403);
  });

  it("the system's dangerous actions", async () => {
    expect((await c.s1.patch('/api/settings', { courseName: 'x' })).status).toBe(403);
    expect((await c.s1.patch('/api/settings', { staffPermissions: { cadetFiles: true } })).status).toBe(403);
    expect((await c.s1.post('/api/users', { username: 'x1', password: 'secret123', displayName: 'x', role: 'staff' })).status).toBe(403);
    expect((await c.s1.get('/api/admin/snapshots')).status).toBe(403);
    expect((await c.s1.get('/api/courses')).status).toBe(403);
    expect((await c.s1.post('/api/calendar/sources', { name: 'x', url: 'https://calendar.google.com/x.ics' })).status).toBe(403);
    expect((await c.s1.del(`/api/weeks/${week}`)).status).toBe(403);
    expect((await c.s1.del(`/api/teams/${team}`)).status).toBe(403);
    expect((await c.s1.del(`/api/cadets/${cadet}`)).status).toBe(403);
  });
});

describe('each switch closes its part', () => {
  it('turned off, the staff are back to their own work', async () => {
    await staffMay(c, { weeks: false, schedule: false, tracks: false, templates: false, plans: false, meetings: false, teams: false, cadets: false, imports: false, announcements: false, alignment: false, tasks: false });
    const s = c.s2;
    expect((await s.post('/api/weeks', { name: 'x', startDate: '2026-10-04', endDate: '2026-10-10' })).status).toBe(403);
    expect((await s.patch(`/api/weeks/${week}`, { name: 'x' })).status).toBe(403);
    expect((await s.post('/api/events', { date: '2026-09-29', startTime: '10:00', title: 'x' })).status).toBe(403);
    expect((await s.post('/api/tracks', { name: 'x' })).status).toBe(403);
    expect((await s.post('/api/templates', { name: 'x', kind: 'week', items: [{ title: 'x', offsetDays: 0 }] })).status).toBe(403);
    expect((await s.get('/api/plans')).status).toBe(403);
    const topic = (await c.s1.post('/api/weekly/items', { weekId: week, kind: 'topic', title: 'x' })).body.id;
    expect((await s.patch(`/api/weekly/items/${topic}`, { done: true })).status).toBe(403);
    expect((await s.post('/api/teams', { name: 'x' })).status).toBe(403);
    expect((await s.post('/api/cadets', { firstName: 'x', teamId: team })).status).toBe(403);
    expect((await s.post('/api/cadets/import', { text: 'שם פרטי\nx' })).status).toBe(403);
    expect((await s.post('/api/announcements', { title: 'x' })).status).toBe(403);
    expect((await s.post('/api/tasks', { title: 'x', ownerIds: [c.ids.cmd], deadline: at('2026-10-20') })).status).toBe(403);
    // what is theirs stays theirs: the week s1 leads, the team s1 commands
    expect((await c.s1.patch(`/api/weeks/${week}`, { goals: 'ניווט' })).status).toBe(200);
    expect((await c.s1.post('/api/cadets', { firstName: 'אורי', teamId: team })).status).toBe(200);
  });

  it('only known switches are kept', async () => {
    expect((await c.cmd.patch('/api/settings', { staffPermissions: { users: true } })).status).toBe(400);
    expect((await c.cmd.patch('/api/settings', { staffPermissions: { weeks: 'yes' } })).status).toBe(400);
    await staffMay(c, { weeks: false });
    expect((await c.s1.get('/api/settings')).body.staffPermissions).toEqual({ weeks: false });
  });
});

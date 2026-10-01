// Sections 68-69: tasks opened during a staff meeting and the meeting summary.

import { z } from 'zod';
import type { Meeting, MeetingSummary } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, nowIso } from './core';
import { db } from './db';
import { changed, logActivity } from './journal';
import { queryTasks } from './taskRepo';

interface MeetingRow {
  id: number;
  title: string;
  started_at: string;
  ended_at: string | null;
  decisions: string;
  follow_ups: string;
  summary: string | null;
  created_by: number;
  created_by_name: string;
}

const BASE = 'SELECT m.*, u.display_name AS created_by_name FROM meetings m JOIN users u ON u.id = m.created_by';

function toMeeting(r: MeetingRow): Meeting {
  return {
    id: r.id,
    title: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    decisions: r.decisions,
    followUps: r.follow_ups,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    summary: r.summary ? (JSON.parse(r.summary) as MeetingSummary) : liveSummary(r),
  };
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/^[\s\-*•\d.]+/, '').trim())
    .filter(Boolean);

function liveSummary(r: MeetingRow, until = nowIso()): MeetingSummary {
  return {
    newTasks: queryTasks('t.meeting_id = ?', r.id).map((t) => ({ id: t.id, title: t.title, ownerName: t.owner_name, deadline: t.deadline })),
    closedTasks: queryTasks("t.status = 'done' AND t.completed_at >= ? AND t.completed_at <= ?", r.started_at, until).map((t) => ({
      id: t.id,
      title: t.title,
      ownerName: t.owner_name,
    })),
    decisions: lines(r.decisions),
    followUps: lines(r.follow_ups),
  };
}

export function listMeetings(): Meeting[] {
  return db().all<MeetingRow>(`${BASE} ORDER BY m.started_at DESC LIMIT 50`).map(toMeeting);
}

export function activeMeeting(): Meeting | null {
  const r = db().get<MeetingRow>(`${BASE} WHERE m.ended_at IS NULL ORDER BY m.started_at DESC LIMIT 1`);
  return r ? toMeeting(r) : null;
}

export function getMeeting(id: number): Meeting {
  const r = db().get<MeetingRow>(`${BASE} WHERE m.id = ?`, id);
  if (!r) throw badRequest('הישיבה לא נמצאה');
  return toMeeting(r);
}

export function startMeeting(actor: UserRow, title?: string): number {
  const open = activeMeeting();
  if (open) return open.id;
  const id = db().run(
    'INSERT INTO meetings(title, started_at, created_by) VALUES (?, ?, ?)',
    title?.trim() || 'ישיבת סגל',
    nowIso(),
    actor.id,
  ).id;
  changed('meetings');
  return id;
}

export const meetingPatchSchema = z
  .object({ title: z.string().trim().min(1).max(120), decisions: z.string().max(10000), followUps: z.string().max(10000) })
  .partial();

export function updateMeeting(id: number, raw: z.input<typeof meetingPatchSchema>): void {
  const p = meetingPatchSchema.parse(raw);
  const m = getMeeting(id);
  db().run(
    'UPDATE meetings SET title = ?, decisions = ?, follow_ups = ? WHERE id = ?',
    p.title ?? m.title,
    p.decisions ?? m.decisions,
    p.followUps ?? m.followUps,
    id,
  );
  changed('meetings');
}

export function endMeeting(actor: UserRow, id: number): Meeting {
  const r = db().get<MeetingRow>(`${BASE} WHERE m.id = ?`, id);
  if (!r) throw badRequest('הישיבה לא נמצאה');
  if (r.ended_at) return toMeeting(r);
  const ended = nowIso();
  const summary = liveSummary(r, ended);
  db().tx(() => {
    db().run('UPDATE meetings SET ended_at = ?, summary = ? WHERE id = ?', ended, JSON.stringify(summary), id);
    logActivity({
      userId: actor.id,
      action: 'meeting_summary',
      text: `${actor.display_name} סיכם את "${r.title}": ${summary.decisions.length} החלטות, ${summary.newTasks.length} משימות חדשות, ${summary.closedTasks.length} נסגרו, ${summary.followUps.length} נקודות למעקב`,
    });
  });
  changed('meetings');
  return getMeeting(id);
}

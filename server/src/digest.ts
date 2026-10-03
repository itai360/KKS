// The morning brief: once a day from 07:00, everyone on the staff who has something today
// gets one notification on the phone - what is due today, what is late, the activities they
// run - so the day starts without opening anything. Nobody away that day gets one.

import { dayRange, localDateKey, localTime } from '../../shared/dates';
import { awayOn } from './absences';
import { tz } from './core';
import { db } from './db';
import { firstTime, notify } from './journal';

let briefedOn = '';

export function morningBrief(now: Date): number {
  const zone = tz();
  const today = localDateKey(now, zone);
  const time = localTime(now, zone);
  // from seven; a server first woken in the afternoon sends no "morning" brief
  if (time < '07:00' || time >= '11:00' || briefedOn === today) return 0;
  briefedOn = today;
  const to = dayRange(today, zone)[1].toISOString();
  const nowIso = now.toISOString();
  const away = awayOn(today);
  const users = db().all<{ id: number; role: string }>('SELECT id, role FROM users WHERE active = 1');
  let sent = 0;
  for (const u of users) {
    if (away.has(u.id)) continue;
    const c = db().get<{ today: number; overdue: number }>(
      `SELECT sum(CASE WHEN deadline >= ? AND deadline < ? THEN 1 ELSE 0 END) AS today, sum(CASE WHEN deadline < ? THEN 1 ELSE 0 END) AS overdue
       FROM tasks WHERE owner_id = ? AND status NOT IN ('done', 'cancelled')`,
      nowIso,
      to,
      nowIso,
      u.id,
    )!;
    const events = db().all<{ start_time: string; title: string }>(
      'SELECT start_time, title FROM events WHERE owner_id = ? AND date = ? AND cancelled = 0 ORDER BY start_time',
      u.id,
      today,
    );
    const dueToday = c.today ?? 0;
    const overdue = c.overdue ?? 0;
    if (!dueToday && !overdue && !events.length) continue;
    if (!firstTime(`brief:${today}:${u.id}`)) continue;
    const parts = [
      dueToday ? (dueToday === 1 ? 'משימה אחת' : `${dueToday} משימות`) : '',
      overdue ? `${overdue} באיחור` : '',
      events.length ? (events.length === 1 ? 'פעילות אחת באחריותך' : `${events.length} פעילויות באחריותך`) : '',
    ].filter(Boolean);
    notify([u.id], {
      type: 'brief',
      category: overdue ? 'action' : 'info',
      title: `בוקר טוב - היום: ${parts.join(', ')}`,
      body: events
        .slice(0, 3)
        .map((e) => `${e.start_time} ${e.title}`)
        .join(' · '),
      link: u.role === 'commander' ? '/briefing' : '/my',
    });
    sent++;
  }
  return sent;
}

/** tests: a new day in memory */
export function resetMorningBrief(): void {
  briefedOn = '';
}

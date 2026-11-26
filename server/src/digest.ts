// The morning brief: once a day from 07:00, everyone on the staff with open tasks gets one notification on the
// phone that lists them - what is late, what is due today, tomorrow and in the coming week, each with its
// deadline - and the activities they run today, so the day starts without opening anything. Nobody away that
// day gets one. On the serverless deployment a daily scheduled call wakes the server for it (vercel-output.mjs),
// so it comes even when nobody opened the app yet.

import { addDays, dayRange, formatDeadline, localDateKey, localTime } from '../../shared/dates';
import { awayOn } from './absences';
import { tz } from './core';
import { db } from './db';
import { firstTime, notify } from './journal';
import { THEIRS } from './taskRepo';

/** how far ahead the brief lists: the coming week */
const AHEAD_DAYS = 7;
/** a phone shows a handful of lines: the tasks past these are counted, not listed */
const TASK_LINES = 6;

let briefedOn = '';

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const tasksWord = (n: number) => (n === 1 ? 'משימה אחת' : `${n} משימות`);

interface BriefTask {
  title: string;
  deadline: string;
}

export function morningBrief(now: Date): number {
  const zone = tz();
  const today = localDateKey(now, zone);
  const time = localTime(now, zone);
  // from seven; a server first woken in the afternoon sends no "morning" brief
  if (time < '07:00' || time >= '11:00' || briefedOn === today) return 0;
  briefedOn = today;
  const nowIso = now.toISOString();
  const endOfToday = dayRange(today, zone)[1].toISOString();
  const endOfWeek = dayRange(addDays(today, AHEAD_DAYS - 1), zone)[1].toISOString();
  const away = awayOn(today);
  const users = db().all<{ id: number; role: string }>('SELECT id, role FROM users WHERE active = 1');
  let sent = 0;
  for (const u of users) {
    if (away.has(u.id)) continue;
    // the tasks that are theirs or that they are on - the same the reminders go to (not the ones a commander oversees)
    const open = db().all<BriefTask>(
      `SELECT t.title, t.deadline FROM tasks t
       WHERE t.status NOT IN ('done', 'cancelled') AND ${THEIRS}
       ORDER BY t.deadline, t.id`,
      u.id,
      u.id,
    );
    // a commander's oversight (בבקרה): what of it is late or due today - counted, not listed as his
    const watched =
      u.role === 'commander'
        ? db().all<{ deadline: string }>(
            `SELECT t.deadline FROM tasks t JOIN task_participants p ON p.task_id = t.id AND p.user_id = ?
             WHERE t.owner_id <> ? AND t.status NOT IN ('done', 'cancelled') AND t.deadline < ?`,
            u.id,
            u.id,
            endOfToday,
          )
        : [];
    const watchedLate = watched.filter((t) => t.deadline < nowIso).length;
    const watchedToday = watched.length - watchedLate;
    const late = open.filter((t) => t.deadline < nowIso);
    const dueToday = open.filter((t) => t.deadline >= nowIso && t.deadline < endOfToday);
    const thisWeek = open.filter((t) => t.deadline >= endOfToday && t.deadline < endOfWeek);
    const later = open.length - late.length - dueToday.length - thisWeek.length;
    const events = db().all<{ start_time: string | null; title: string }>(
      'SELECT start_time, title FROM events WHERE owner_id = ? AND date = ? AND cancelled = 0 AND deleted_at IS NULL ORDER BY start_time',
      u.id,
      today,
    );
    if (!late.length && !dueToday.length && !thisWeek.length && !events.length && !watched.length) continue;
    if (!firstTime(`brief:${today}:${u.id}`)) continue;

    const parts = [
      dueToday.length ? `${tasksWord(dueToday.length)} להיום` : '',
      late.length ? `${late.length} באיחור` : '',
      thisWeek.length ? `${thisWeek.length} השבוע` : '',
      events.length ? (events.length === 1 ? 'פעילות אחת באחריותך' : `${events.length} פעילויות באחריותך`) : '',
      // nothing of his own: the title says the oversight
      !open.length && !events.length && watched.length ? `${tasksWord(watched.length)} בבקרה שלך` : '',
    ].filter(Boolean);
    // one line a task, the most pressing first: late, today, then the week by its deadline
    const listed = [
      ...late.map((t) => `באיחור · ${clip(t.title, 40)} (${formatDeadline(t.deadline, now, zone)})`),
      ...dueToday.map((t) => `היום ${localTime(t.deadline, zone)} · ${clip(t.title, 40)}`),
      ...thisWeek.map((t) => `${formatDeadline(t.deadline, now, zone)} · ${clip(t.title, 40)}`),
    ];
    // past the lines a phone shows, and further than the week: counted
    const hidden = Math.max(0, listed.length - TASK_LINES) + later;
    const lines = [
      ...listed.slice(0, TASK_LINES),
      hidden ? (hidden === 1 ? 'ועוד משימה פתוחה אחת' : `ועוד ${hidden} משימות פתוחות`) : '',
      watched.length ? `בבקרה שלך: ${[watchedLate ? `${watchedLate} באיחור` : '', watchedToday ? `${watchedToday} להיום` : ''].filter(Boolean).join(', ')}` : '',
      events.length
        ? `בלו"ז היום: ${events
            .slice(0, 3)
            .map((e) => `${e.start_time ? `${e.start_time} ` : ''}${clip(e.title, 30)}`)
            .join(' · ')}`
        : '',
    ].filter(Boolean);
    notify([u.id], {
      type: 'brief',
      category: late.length || watchedLate ? 'action' : 'info',
      title: `בוקר טוב - ${parts.join(', ')}`,
      body: lines.join('\n'),
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

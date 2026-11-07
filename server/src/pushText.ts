// What a phone notification says. In the app a notification sits in its list, where "נוספה לך משימה חדשה: ..."
// reads well; on a phone there are only a title and a few lines - so the title is the thing itself (the task, the
// event, the announcement), and the first line under it says what happened to it - unless it is simply new for
// you, which the thing itself says. A push about a task then says it whole: when it is due, in plain words, and
// what it is about (the note or instruction that came with it, the task's own description).

import { formatDeadline, formatTimeLeft } from '../../shared/dates';
import type { Notification } from '../../shared/types';
import { clock, tz } from './core';
import { db } from './db';

export type PushNote = Pick<Notification, 'id' | 'title' | 'body' | 'link' | 'category'> & Partial<Pick<Notification, 'type' | 'taskId' | 'courseSlot'>>;

/** the phone's title - the thing itself - and the news of it, when there is more to say than "new for you" */
export interface Headline {
  title: string;
  lead: string;
}

/** the news of something finished: when it was due no longer matters */
const DONE_NEWS = new Set(['task_done', 'group_done', 'approved', 'cancelled', 'deleted']);

/** said of a task that is simply new for you: on the phone the task itself says it */
const NEW_FOR_YOU = new Set(['נוספה לך משימה חדשה', 'צורפת למשימה', 'הועברה אליך משימה']);

/** what the line of the deadline says anyway: a reminder, the deadline passed, the deadline moved */
const SAID_BY_DEADLINE = new Set(['reminder_24h', 'reminder_2h', 'overdue', 'critical_overdue', 'deadline_changed']);

/** the other notifications that open with what kind they are - [their type, their title, what the phone shows] */
const OPENERS: [string, RegExp, (m: RegExpExecArray) => Headline][] = [
  ['event_invite', /^הוזמנת: (.+)$/, (m) => ({ title: m[1], lead: '' })],
  ['event_owner', /^(מונית לאחראי) על "(.+)"$/, (m) => ({ title: m[2], lead: m[1] })],
  ['event_changed', /^שינוי בלו"ז: "(.+)"( \(.+\))?$/, (m) => ({ title: m[1], lead: `שינוי בלו"ז${m[2] ?? ''}` })],
  ['event_cancelled', /^הפעילות "(.+)" בוטלה$/, (m) => ({ title: m[1], lead: 'הפעילות בוטלה' })],
  ['event_cancelled', /^(בוטל): (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  // "בעוד 30 דקות: ישיבת סגל"
  ['event_reminder', /^(.+?): (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['announcement', /^(דחוף - )?הודעה לסגל: (.+)$/, (m) => ({ title: m[2], lead: m[1] ? 'דחוף' : '' })],
  ['announcement', /^תזכורת: (נא לאשר קריאה) - (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['debrief', /^(התחקיר השבועי מחכה לאישורך|הגיע זמן התחקיר השבועי|אירוע בטיחות במופע): (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['debrief', /^תחקיר "(.+)" סוכם$/, (m) => ({ title: m[1], lead: 'התחקיר סוכם' })],
  ['lessons', /^(.+ ממופעים קודמים|הכנת סגל): (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['weekly_closure', /^(סגירה מקצועית לשבועי): (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['week_lead', /^(מונית למפק"צ אחראי) על (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['track_lead', /^(מונית לאחראי) על (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['entry', /^(אישור כניסה): (.+)$/, (m) => ({ title: m[2], lead: m[1] })],
  ['experience_feedback', /^התקבל (משוב .+)$/, (m) => ({ title: m[1], lead: '' })],
  ['brief', /^בוקר טוב - (.+)$/, (m) => ({ title: m[1], lead: '' })],
];

/** a phone shows a few hundred characters at most; past that it cuts on its own, mid-word */
const BODY_MAX = 360;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "דד-ליין 6.11 14:00" as some notifications already say it: the line of its own says it better */
const SAID_DEADLINE = /דד-ליין(?: חדש)?:?\s*\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2}/g;

function withoutDeadline(body: string): string {
  return body
    .replace(SAID_DEADLINE, '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ');
}

/** "דד-ליין: מחר 14:00 (נותרו 20 שעות) · עדיפות גבוהה" */
export function deadlineLine(deadline: string, priority: string, now: Date = clock.now(), label = 'דד-ליין'): string {
  const urgent = priority === 'critical' ? ' · עדיפות קריטית' : priority === 'high' ? ' · עדיפות גבוהה' : '';
  return `${label}: ${formatDeadline(deadline, now, tz())} (${formatTimeLeft(deadline, now)})${urgent}`;
}

/** A task's notification: the task's name first, and what the app says of it besides - if it is news. */
function taskHeadline(n: PushNote, current: string | undefined): Headline | null {
  const said = oneLine(n.title);
  const name = current === undefined ? undefined : oneLine(current);
  // the name as the notification has it: as the task is called now - or, renamed since or deleted, in quotes
  const quoted = name && said.includes(`"${name}"`) ? name : /"(.+)"/.exec(said)?.[1];
  if (!quoted) return null;
  const at = said.indexOf(`"${quoted}"`);
  let before = said.slice(0, at).trim();
  const after = said.slice(at + quoted.length + 2).trim();
  // "אפשר להתקדם ב"X"": the letter joined to the name goes with it
  if (/(^|\s)ב$/.test(before)) before = before.slice(0, -1).trim();
  // "כל הסגל השלים את "X"": the task, its name being above
  if (/(^|\s)את$/.test(before) && !after) before += ' המשימה';
  const lead = `${before} ${after}`
    .replace(/\sבמשימה(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:·-]+|[\s:·-]+$/g, '');
  return { title: name ?? quoted, lead: NEW_FOR_YOU.has(lead) || SAID_BY_DEADLINE.has(n.type ?? '') ? '' : lead };
}

/** What a phone's title says - the thing itself - and the news of it under it. */
export function headline(n: PushNote, taskName?: string): Headline {
  if (n.taskId || n.type === 'deleted') {
    const h = taskHeadline(n, taskName);
    if (h) return h;
  }
  const said = oneLine(n.title);
  for (const [type, pattern, shown] of OPENERS) {
    const m = type === n.type ? pattern.exec(said) : null;
    if (m) return shown(m);
  }
  return { title: said, lead: '' };
}

interface TaskBits {
  title: string;
  description: string;
  deadline: string;
  priority: string;
  status: string;
  owner_id: number;
  owner_name: string;
}

/** The title and the lines a phone shows for a notification to this person. */
export function pushContent(userId: number, n: PushNote, now: Date = clock.now()): { title: string; body: string } {
  const own = (n.body ?? '').trim();
  const t = n.taskId
    ? db().get<TaskBits>(
        'SELECT t.title, t.description, t.deadline, t.priority, t.status, t.owner_id, u.display_name AS owner_name FROM tasks t JOIN users u ON u.id = t.owner_id WHERE t.id = ?',
        n.taskId,
      )
    : undefined;
  const { title, lead } = headline(n, t?.title);
  if (!t) return { title, body: clip([lead, own].filter(Boolean).join(' · '), BODY_MAX) };

  const open = !['done', 'cancelled'].includes(t.status) && !DONE_NEWS.has(n.type ?? '');
  const said = open ? withoutDeadline(own) : own;
  const lines: string[] = [];
  // what happened first, with what came with it; a task simply new for you: when it is due, first
  if (lead) lines.push([lead, said].filter(Boolean).join(' · '));
  if (open) lines.push(deadlineLine(t.deadline, t.priority, now, n.type === 'deadline_changed' ? 'דד-ליין חדש' : 'דד-ליין'));
  if (!lead && said) lines.push(said);
  // what the task is: its description, unless the notification already says it
  const description = oneLine(t.description);
  if (open && description && !said.includes(description.slice(0, 40))) lines.push(`פירוט: ${clip(description, said ? 110 : 180)}`);
  // to someone not on it (the commander, a participant): whose it is
  if (open && t.owner_id !== userId && !`${lead} ${said}`.includes(t.owner_name)) lines.push(`אחראי: ${t.owner_name}`);
  return { title, body: clip(lines.join('\n'), BODY_MAX) };
}

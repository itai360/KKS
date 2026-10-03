import { randomUUID } from 'node:crypto';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { isOpenStatus, ROLES } from '../../shared/constants';
import { addDays, dayRange, isDateKey, localDateKey } from '../../shared/dates';
import type { Task } from '../../shared/types';
import {
  clearSessionCookie,
  createSession,
  createUser,
  destroySession,
  dummyHash,
  endOtherSessions,
  getUserRow,
  hashPassword,
  loginFailed,
  loginSucceeded,
  loginThrottle,
  requireAuth,
  requireCommander,
  sessionToken,
  setSessionCookie,
  toUser,
  verifyPassword,
  NAME_LIMIT,
  type UserRow,
} from './auth';
import { badRequest, clock, config, forbidden, getSettings, HttpError, notFound, nowIso, patchSchema, tz, updateSettings } from './core';
import { db } from './db';
import { getFile, putFile, removeFile, sendStoredFile, uploadName } from './files';
import { changed, logActivity, snoozeNotification, toNotification } from './journal';
import { activeMeeting, endMeeting, getMeeting, listMeetings, startMeeting, updateMeeting } from './meetings';
import { deleteRule, listRules, saveRule } from './recurring';
import { briefing, dashboard, dayEnd, lookAhead, myTasks, search, staffPage, team, weeklyReport } from './reports';
import { streamHandler } from './realtime';
import { v3Router } from './api3';
import { newPassword } from './netguard';
import { shareTarget } from './alignment';
import { setCourseCookie, viewingName } from './courses';
import {
  addCalendarSource,
  applyCalendarWeeks,
  calendarFeed,
  externalEvents,
  listCalendarSources,
  previewCalendarWeeks,
  removeCalendarSource,
  scheduleIcs,
  userForFeedToken,
  weeksCalendarUrl,
} from './calendar';
import { googleClientId, verifyGoogleIdToken } from './google';
import {
  cancelEvent,
  canManageEvent,
  createEvent,
  deleteEvent,
  eventDetail,
  listEvents,
  restoreEvent,
  shiftEventTasks,
  updateEvent,
} from './schedule';
import { canEdit, canView, getTaskRow, isCommander, mustTaskRow, visibleTasks } from './taskRepo';
import {
  isoDateTime,
  addDependency,
  addUpdate,
  createRequest,
  createTasks,
  decideRequest,
  deleteTask,
  groupProgress,
  listActivity,
  listRequests,
  removeDependency,
  respondOverdue,
  taskDetail,
  transition,
  updateTask,
} from './taskService';
import { applyTemplate, deleteTemplate, getTemplate, listTemplates, saveTemplate } from './templates';
import { matchesSearch } from '../../shared/search';
import {
  addLesson,
  approveWeek,
  closeCheck,
  closeWeek,
  createWeek,
  deleteLesson,
  deleteWeek,
  generateWeeks,
  getWeek,
  listWeeks,
  openWeek,
  updateWeek,
  weekDetail,
} from './weeks';

/** The address the app is reached at, for links that leave it (calendar feeds). */
const origin = (req: Request) => `${req.protocol}://${req.host}`;

const id = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('מזהה לא תקין');
  return n;
};
const me = (req: Request): UserRow => req.user!;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);

export function apiRouter(): Router {
  const r = Router();

  // ---------------- public & auth ----------------

  r.get('/public/info', (_req, res) => {
    const s = getSettings();
    const users = db().get<{ n: number }>('SELECT count(*) AS n FROM users')!.n;
    res.json({
      courseName: s.courseName,
      courseSymbol: s.courseSymbol,
      needsSetup: users === 0,
      googleClientId: googleClientId() || null,
      // the serverless deployment has no long-lived connections: the app asks for changes instead
      realtime: process.env.KKS_REALTIME === 'poll' ? 'poll' : 'stream',
    });
  });

  // a screen that failed to draw in someone's browser: written to the server log so it can be fixed
  let clientErrors = { minute: 0, count: 0 };
  r.post('/client-error', (req, res) => {
    const e = z.object({ path: z.string().max(300), message: z.string().max(500), stack: z.string().max(2000).optional() }).parse(req.body);
    const minute = Math.floor(Date.now() / 60_000);
    if (clientErrors.minute !== minute) clientErrors = { minute, count: 0 };
    // anyone can send this: control characters are taken out so a line in the log cannot be faked
    const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
    if (++clientErrors.count <= 20) console.error(`[client] ${clean(e.path)}: ${clean(e.message)}\n${clean(e.stack ?? '')}`);
    res.json({ ok: true });
  });

  // the schedule for calendar apps: Google Calendar subscribes to this link, and the token in it is the permission
  r.get('/ics/:file', (req, res) => {
    if (!userForFeedToken(String(req.params.file).replace(/\.ics$/, ''))) throw notFound('הקישור ליומן אינו בתוקף');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="schedule.ics"');
    res.send(scheduleIcs(origin(req)));
  });

  const setupSchema = z.object({
    courseName: z.string().trim().min(1).max(120),
    courseSymbol: z.string().trim().max(12).optional(),
    username: z.string().trim().min(2).max(40),
    password: newPassword,
    displayName: z.string().trim().min(1).max(80),
  });
  r.post('/setup', (req, res) => {
    const input = setupSchema.parse(req.body);
    const created = db().tx(() => {
      if (db().get<{ n: number }>('SELECT count(*) AS n FROM users')!.n > 0) throw forbidden('המערכת כבר הוקמה');
      updateSettings({ courseName: input.courseName, courseSymbol: input.courseSymbol || input.courseName.slice(0, 6) });
      return createUser({ username: input.username, password: input.password, displayName: input.displayName, title: 'מפקד הקורס', role: 'commander' });
    });
    setSessionCookie(res, createSession(created));
    setCourseCookie(res, null);
    res.json({ user: toUser(getUserRow(created)!) });
  });

  r.post('/auth/login', (req, res) => {
    const { username, password } = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
    const key = `${req.ip}|${username.toLowerCase()}`;
    const nameKey = `name|${username.toLowerCase()}`; // the same name tried from many addresses
    loginThrottle(key);
    loginThrottle(nameKey, NAME_LIMIT);
    const u = db().get<UserRow>('SELECT * FROM users WHERE username = ? AND active = 1', username);
    let valid = false;
    if (u) valid = verifyPassword(password, u.password_hash);
    else verifyPassword(password, dummyHash()); // a name that does not exist takes as long as a wrong password
    if (!u || !valid) {
      loginFailed(key);
      loginFailed(nameKey, NAME_LIMIT);
      throw new HttpError(401, 'שם משתמש או סיסמה שגויים');
    }
    loginSucceeded(key);
    loginSucceeded(nameKey);
    setSessionCookie(res, createSession(u.id));
    setCourseCookie(res, null);
    res.json({ user: toUser(u) });
  });

  r.post('/auth/google', async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(20).max(5000) }).parse(req.body);
    const key = `${req.ip}|google`;
    loginThrottle(key);
    let identity;
    try {
      identity = await verifyGoogleIdToken(credential);
    } catch (e) {
      loginFailed(key);
      throw e;
    }
    const u = db().get<UserRow>('SELECT * FROM users WHERE email = ? AND active = 1', identity.email);
    if (!u) {
      loginFailed(key);
      throw new HttpError(403, `החשבון ${identity.email} לא מוגדר במערכת. פנה למפקד הקורס.`);
    }
    loginSucceeded(key);
    setSessionCookie(res, createSession(u.id));
    setCourseCookie(res, null);
    res.json({ user: toUser(u) });
  });

  r.post('/auth/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) destroySession(token);
    clearSessionCookie(res);
    setCourseCookie(res, null);
    res.json({ ok: true });
  });

  // WhatsApp's "share" into the app (alignment.ts): signed in or not, it ends on the page
  r.post('/share-target', express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), shareTarget);

  r.use(requireAuth);

  r.get('/auth/me', (req, res) => {
    const unread = db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me(req).id)!.n;
    res.json({ user: toUser(me(req)), settings: getSettings(), unread, serverTime: nowIso(), mustChangePassword: !!me(req).must_change_password, course: viewingName(req) });
  });

  r.post('/auth/password', (req, res) => {
    const { current, next } = z
      .object({ current: z.string().min(1), next: newPassword })
      .parse(req.body);
    // the current password is guessed no faster here than at sign-in
    const key = `password|${me(req).id}`;
    loginThrottle(key);
    if (!verifyPassword(current, me(req).password_hash)) {
      loginFailed(key);
      throw badRequest('הסיסמה הנוכחית שגויה');
    }
    loginSucceeded(key);
    db().run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), me(req).id);
    // whoever knew the old password is signed out on their devices; this one stays in
    const others = endOtherSessions(me(req).id, sessionToken(req));
    res.json({ ok: true, others });
  });

  // first sign-in with a password someone else chose: pick a personal one. Signing in with
  // that password just now is the proof, so the current one is not asked again.
  r.post('/auth/password/first', (req, res) => {
    const u = me(req);
    if (!u.must_change_password) throw badRequest('הסיסמה כבר אישית');
    const { next } = z.object({ next: newPassword }).parse(req.body);
    if (verifyPassword(next, u.password_hash)) throw badRequest('בחרו סיסמה שונה מהסיסמה שקיבלתם');
    db().run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), u.id);
    endOtherSessions(u.id, sessionToken(req));
    res.json({ ok: true });
  });

  r.get('/auth/sessions', (req, res) => {
    const n = db().get<{ n: number }>('SELECT count(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', me(req).id, nowIso())!.n;
    res.json({ others: Math.max(0, n - 1) });
  });

  r.post('/auth/sessions/end-others', (req, res) => {
    res.json({ others: endOtherSessions(me(req).id, sessionToken(req)) });
  });

  r.get('/stream', streamHandler);

  // ---------------- users & settings ----------------

  r.get('/users', (req, res) => {
    const all = req.query.all === '1' && isCommander(me(req));
    const rows = db().all<UserRow>(`SELECT * FROM users ${all ? '' : 'WHERE active = 1'} ORDER BY role, display_name`);
    res.json(rows.map(toUser));
  });

  const userSchema = z.object({
    username: z.string().trim().min(2, 'שם משתמש קצר מדי').max(40).regex(/^[\w.\-@]+$/, 'שם משתמש באותיות לועזיות, ספרות ו-._-'),
    password: newPassword,
    displayName: z.string().trim().min(1, 'חובה למלא שם').max(80),
    title: z.string().trim().max(80).optional().default(''),
    role: z.enum(ROLES),
    phone: z.string().trim().max(30).optional().default(''),
    email: z.string().trim().email('כתובת מייל לא תקינה').max(120).optional().or(z.literal('')),
  });

  r.post('/users', requireCommander, (req, res) => {
    const input = userSchema.parse(req.body);
    if (db().get('SELECT 1 FROM users WHERE username = ?', input.username)) throw badRequest('שם המשתמש תפוס');
    if (input.email && db().get('SELECT 1 FROM users WHERE email = ?', input.email.toLowerCase())) throw badRequest('כתובת המייל כבר משויכת למשתמש אחר');
    const newId = createUser({ ...input, mustChangePassword: true });
    changed('users');
    res.json(toUser(getUserRow(newId)!));
  });

  // my own phone and email, for the directory (the rest of a user is the commander's)
  r.patch('/me/contact', (req, res) => {
    const p = z
      .object({
        phone: z.string().trim().max(30).optional(),
        email: z.string().trim().email('כתובת מייל לא תקינה').max(120).optional().or(z.literal('')),
      })
      .parse(req.body);
    if (p.phone !== undefined) db().run('UPDATE users SET phone = ? WHERE id = ?', p.phone, me(req).id);
    if (p.email !== undefined) {
      const email = p.email.toLowerCase() || null; // cleared: none
      if (email && db().get('SELECT 1 FROM users WHERE email = ? AND id <> ?', email, me(req).id)) throw badRequest('כתובת המייל כבר משויכת למשתמש אחר');
      db().run('UPDATE users SET email = ? WHERE id = ?', email, me(req).id);
    }
    changed('users');
    res.json(toUser(getUserRow(me(req).id)!));
  });

  r.patch('/users/:id', requireCommander, (req, res) => {
    const uid = id(req.params.id);
    const cur = getUserRow(uid);
    if (!cur) throw notFound('המשתמש לא נמצא');
    const p = patchSchema(userSchema).extend({ active: z.boolean().optional() }).parse(req.body);
    const willBeCommander = (p.role ?? cur.role) === 'commander' && (p.active ?? !!cur.active);
    if (cur.role === 'commander' && cur.active && !willBeCommander) {
      const others = db().get<{ n: number }>("SELECT count(*) AS n FROM users WHERE role = 'commander' AND active = 1 AND id <> ?", uid)!.n;
      if (others === 0) throw badRequest('חייב להישאר לפחות מפקד קורס פעיל אחד');
    }
    if (p.username && p.username.toLowerCase() !== cur.username.toLowerCase() && db().get('SELECT 1 FROM users WHERE username = ?', p.username)) {
      throw badRequest('שם המשתמש תפוס');
    }
    const email = p.email === undefined ? cur.email : p.email ? p.email.toLowerCase() : null;
    if (email && email !== cur.email && db().get('SELECT 1 FROM users WHERE email = ? AND id <> ?', email, uid)) {
      throw badRequest('כתובת המייל כבר משויכת למשתמש אחר');
    }
    db().run(
      'UPDATE users SET username = ?, display_name = ?, title = ?, role = ?, phone = ?, email = ?, active = ? WHERE id = ?',
      p.username ?? cur.username,
      p.displayName ?? cur.display_name,
      p.title ?? cur.title,
      p.role ?? cur.role,
      p.phone ?? cur.phone,
      email,
      p.active === undefined ? cur.active : p.active ? 1 : 0,
      uid,
    );
    if (p.password) {
      db().run('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?', hashPassword(p.password), uid === me(req).id ? 0 : 1, uid);
      db().run('DELETE FROM sessions WHERE user_id = ? ', uid);
    }
    if (p.active === false) db().run('DELETE FROM sessions WHERE user_id = ?', uid);
    changed('users', 'tasks');
    res.json(toUser(getUserRow(uid)!));
  });

  r.get('/settings', (_req, res) => res.json(getSettings()));

  const settingsSchema = z
    .object({
      courseName: z.string().trim().min(1).max(120),
      courseSymbol: z.string().trim().max(12),
      startDate: z.string().refine(isDateKey).nullable(),
      endDate: z.string().refine(isDateKey).nullable(),
      timezone: z.string().refine((t) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: t });
          return true;
        } catch {
          return false;
        }
      }, 'אזור זמן לא תקין'),
      staleDays: z.number().int().min(0).max(30),
      defaultDeadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      overloadThreshold: z.number().int().min(1).max(200),
      readinessWarnThreshold: z.number().int().min(0).max(100),
      domains: z.array(z.string().trim().min(1).max(60)).min(1).max(40),
    })
    .partial();

  r.patch('/settings', requireCommander, (req, res) => {
    const s = updateSettings(settingsSchema.parse(req.body));
    changed('settings');
    res.json(s);
  });

  // ---------------- tasks ----------------

  r.get('/tasks', (req, res) => {
    const u = me(req);
    const q = req.query;
    let list = visibleTasks(u);
    const today = localDateKey(clock.now(), tz());
    const [dayStart, dayEnd] = dayRange(today, tz()).map((d) => d.getTime());
    const ownerF = str(q.owner);
    if (ownerF) {
      const oid = ownerF === 'me' ? u.id : Number(ownerF);
      list = list.filter((t) => t.ownerId === oid || t.participantIds.includes(oid));
    }
    const weekF = str(q.week);
    if (weekF) list = list.filter((t) => (weekF === 'none' ? t.weekId === null : t.weekId === Number(weekF)));
    const domainF = str(q.domain);
    if (domainF) list = list.filter((t) => t.domain === domainF);
    const statusF = str(q.status);
    if (statusF) {
      const set = new Set(statusF.split(','));
      list = list.filter((t) => set.has(t.status) || (set.has('overdue') && t.overdue));
    }
    const prioF = str(q.priority);
    if (prioF) {
      const set = new Set(prioF.split(','));
      list = list.filter((t) => set.has(t.priority));
    }
    const createdByF = str(q.createdBy);
    if (createdByF) list = list.filter((t) => t.createdBy === Number(createdByF));
    const eventF = str(q.event);
    if (eventF) list = list.filter((t) => t.eventId === Number(eventF));
    const parentF = str(q.parent);
    if (parentF) list = list.filter((t) => (parentF === 'none' ? t.parentId === null : t.parentId === Number(parentF)));
    const recurringF = str(q.recurring);
    if (recurringF === '0') list = list.filter((t) => !t.recurringRuleId);
    switch (str(q.scope)) {
      case 'open':
        list = list.filter((t) => isOpenStatus(t.status));
        break;
      case 'overdue':
        list = list.filter((t) => t.overdue);
        break;
      case 'today':
        list = list.filter((t) => isOpenStatus(t.status) && Date.parse(t.deadline) >= dayStart && Date.parse(t.deadline) < dayEnd);
        break;
      case 'week': {
        const end = dayRange(addDays(today, 7), tz())[1].getTime();
        list = list.filter((t) => isOpenStatus(t.status) && Date.parse(t.deadline) < end);
        break;
      }
      case 'attention':
        list = list.filter((t) => isOpenStatus(t.status) && (t.needsCommander || t.overdue || t.status === 'waiting' || t.status === 'pending_approval'));
        break;
      case 'done':
        list = list.filter((t) => t.status === 'done');
        break;
    }
    const text = str(q.q);
    if (text) list = list.filter((t) => matchesSearch(text, t.title, t.description, t.domain, t.weekName, t.ownerName));
    if (q.hideClosed === '1') list = list.filter((t) => isOpenStatus(t.status));
    // deadlines between two days, by the course's time zone (the calendar views of the schedule)
    if (isDateKey(q.from) && isDateKey(q.to)) {
      const [from, to, zone] = [q.from, q.to, tz()];
      list = list.filter((t) => {
        const d = localDateKey(t.deadline, zone);
        return d >= from && d <= to;
      });
    }
    res.json(list);
  });

  r.post('/tasks', (req, res) => {
    const ids = createTasks(me(req), req.body);
    res.json({ ids });
  });

  r.get('/tasks/:id', (req, res) => res.json(taskDetail(me(req), id(req.params.id))));

  r.patch('/tasks/:id', (req, res) => {
    updateTask(me(req), id(req.params.id), req.body);
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.delete('/tasks/:id', (req, res) => {
    deleteTask(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  r.post('/tasks/:id/transition', (req, res) => {
    transition(me(req), id(req.params.id), req.body);
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.post('/tasks/:id/updates', (req, res) => {
    const { body, kind } = z.object({ body: z.string().trim().min(1, 'העדכון ריק').max(5000), kind: z.enum(['comment', 'instruction']).optional() }).parse(req.body);
    addUpdate(me(req), id(req.params.id), body, kind);
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.post('/tasks/:id/overdue-response', (req, res) => {
    respondOverdue(me(req), id(req.params.id), req.body);
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.post('/tasks/:id/requests', (req, res) => {
    createRequest(me(req), id(req.params.id), req.body);
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.post('/tasks/:id/dependencies', (req, res) => {
    const { dependsOnId } = z.object({ dependsOnId: z.number().int().positive() }).parse(req.body);
    addDependency(me(req), id(req.params.id), dependsOnId);
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.delete('/tasks/:id/dependencies/:depId', (req, res) => {
    removeDependency(me(req), id(req.params.id), id(req.params.depId));
    res.json(taskDetail(me(req), id(req.params.id)));
  });

  r.get('/groups/:groupId', (req, res) => {
    const g = groupProgress(String(req.params.groupId));
    if (!g.members.length) throw notFound();
    const first = getTaskRow(g.members[0].taskId)!;
    if (!isCommander(me(req)) && first.created_by !== me(req).id) throw forbidden();
    res.json(g);
  });

  // ---------------- attachments ----------------

  const linkBody = z.object({
    url: z.string().trim().url('קישור לא תקין').refine((u) => /^https?:\/\//i.test(u), 'קישור חייב להתחיל ב-http'),
    title: z.string().trim().max(200).optional(),
  });

  const assertTaskAttachable = (u: UserRow, taskId: number) => {
    const t = mustTaskRow(taskId);
    if (!canView(u, t)) throw notFound('המשימה לא נמצאה');
    return t;
  };
  const assertEventAttachable = (u: UserRow, eventId: number) => {
    const e = db().get<{ id: number; date: string; owner_id: number | null; created_by: number | null; title: string }>(
      'SELECT id, date, owner_id, created_by, title FROM events WHERE id = ?',
      eventId,
    );
    if (!e) throw notFound('הפעילות לא נמצאה');
    if (!canManageEvent(u, e)) throw forbidden();
    return e;
  };

  const addLink = (u: UserRow, target: { taskId?: number; eventId?: number }, body: unknown) => {
    const { url, title } = linkBody.parse(body);
    db().tx(() => {
      db().run(
        "INSERT INTO attachments(task_id, event_id, user_id, kind, title, url, created_at) VALUES (?, ?, ?, 'link', ?, ?, ?)",
        target.taskId ?? null,
        target.eventId ?? null,
        u.id,
        title || url,
        url,
        nowIso(),
      );
      logActivity({ taskId: target.taskId, eventId: target.eventId, userId: u.id, action: 'attachment', text: `${u.display_name} הוסיף קישור: ${title || url}` });
    });
    changed(target.taskId ? 'tasks' : 'events');
  };

  const rawBody = express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` });
  const addFile = async (u: UserRow, target: { taskId?: number; eventId?: number }, req: Request) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('הקובץ ריק');
    const name = uploadName(req.headers['x-filename']);
    const stored = randomUUID();
    await putFile(stored, buf);
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream').slice(0, 100);
    db().tx(() => {
      db().run(
        "INSERT INTO attachments(task_id, event_id, user_id, kind, title, url, file_name, mime, size, created_at) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?)",
        target.taskId ?? null,
        target.eventId ?? null,
        u.id,
        name,
        stored,
        name,
        mime,
        buf.length,
        nowIso(),
      );
      logActivity({ taskId: target.taskId, eventId: target.eventId, userId: u.id, action: 'attachment', text: `${u.display_name} צירף קובץ: ${name}` });
    });
    changed(target.taskId ? 'tasks' : 'events');
  };

  r.post('/tasks/:id/links', (req, res) => {
    const tid = id(req.params.id);
    assertTaskAttachable(me(req), tid);
    addLink(me(req), { taskId: tid }, req.body);
    res.json(taskDetail(me(req), tid));
  });
  r.post('/tasks/:id/files', rawBody, async (req, res) => {
    const tid = id(req.params.id);
    assertTaskAttachable(me(req), tid);
    await addFile(me(req), { taskId: tid }, req);
    res.json(taskDetail(me(req), tid));
  });
  r.post('/events/:id/links', (req, res) => {
    const eid = id(req.params.id);
    assertEventAttachable(me(req), eid);
    addLink(me(req), { eventId: eid }, req.body);
    res.json(eventDetail(me(req), eid));
  });
  r.post('/events/:id/files', rawBody, async (req, res) => {
    const eid = id(req.params.id);
    assertEventAttachable(me(req), eid);
    await addFile(me(req), { eventId: eid }, req);
    res.json(eventDetail(me(req), eid));
  });

  interface AttRow {
    id: number;
    task_id: number | null;
    event_id: number | null;
    user_id: number | null;
    kind: 'link' | 'file';
    url: string | null;
    file_name: string | null;
    mime: string | null;
    title: string;
  }

  r.get('/files/:id', async (req, res) => {
    const a = db().get<AttRow>('SELECT * FROM attachments WHERE id = ?', id(req.params.id));
    if (!a || a.kind !== 'file' || !a.url) throw notFound();
    if (a.task_id) {
      const t = getTaskRow(a.task_id);
      if (!t || !canView(me(req), t)) throw notFound();
    }
    const data = await getFile(a.url);
    if (!data) throw notFound('הקובץ לא נמצא');
    sendStoredFile(res, data, a.mime, a.file_name);
  });

  r.delete('/attachments/:id', (req, res) => {
    const a = db().get<AttRow>('SELECT * FROM attachments WHERE id = ?', id(req.params.id));
    if (!a) throw notFound();
    const u = me(req);
    let allowed = isCommander(u) || a.user_id === u.id;
    if (!allowed && a.task_id) {
      const t = getTaskRow(a.task_id);
      allowed = !!t && canEdit(u, t);
    }
    if (!allowed) throw forbidden();
    db().tx(() => {
      db().run('DELETE FROM attachments WHERE id = ?', a.id);
      logActivity({ taskId: a.task_id, eventId: a.event_id, userId: u.id, action: 'attachment_removed', text: `${u.display_name} הסיר את "${a.title}"` });
    });
    if (a.kind === 'file' && a.url) void removeFile(a.url);
    changed('tasks', 'events');
    res.json({ ok: true });
  });

  // ---------------- requests ----------------

  r.get('/requests', (req, res) => {
    const status = str(req.query.status);
    res.json(status === 'all' ? listRequests(me(req)) : listRequests(me(req), "r.status = 'pending'"));
  });

  r.post('/requests/:id/decide', (req, res) => {
    decideRequest(me(req), id(req.params.id), req.body);
    res.json({ ok: true });
  });

  // ---------------- weeks & lessons ----------------

  r.get('/weeks', (_req, res) => res.json(listWeeks()));
  r.post('/weeks', requireCommander, (req, res) => res.json(getWeek(createWeek(me(req), req.body))));
  r.post('/weeks/generate', requireCommander, (req, res) => {
    generateWeeks(me(req), req.body);
    res.json(listWeeks());
  });
  // course weeks from a Google calendar: preview first, then create / update the chosen ones
  const calendarUrl = z.string().trim().min(8, 'הדביקו את כתובת היומן').max(2000);
  r.get('/weeks/calendar', requireCommander, (_req, res) => res.json({ url: weeksCalendarUrl() }));
  r.post('/weeks/calendar/preview', requireCommander, async (req, res) => {
    res.json(await previewCalendarWeeks(z.object({ url: calendarUrl }).parse(req.body).url));
  });
  r.post('/weeks/calendar/apply', requireCommander, async (req, res) => {
    const dateKey = z.string().refine(isDateKey, 'תאריך לא תקין');
    const body = z
      .object({
        url: calendarUrl,
        items: z
          .array(
            z.object({
              uid: z.string().min(1).max(500),
              name: z.string().trim().min(1).max(80),
              startDate: dateKey,
              endDate: dateKey,
              number: z.number().int().min(0).max(100).nullable(),
              weekId: z.number().int().positive().nullable(),
            }),
          )
          .max(60),
        showInSchedule: z.boolean().optional(),
      })
      .parse(req.body);
    const weeks = applyCalendarWeeks(me(req), body.url, body.items);
    // optionally the calendar's events also appear in the schedule (already connected: nothing to do)
    if (body.showInSchedule) await addCalendarSource(me(req), 'יומן הקורס', body.url).catch(() => undefined);
    res.json(weeks);
  });
  r.get('/weeks/:id', (req, res) => res.json(weekDetail(me(req), id(req.params.id))));
  r.patch('/weeks/:id', (req, res) => {
    updateWeek(me(req), id(req.params.id), req.body);
    res.json(getWeek(id(req.params.id)));
  });
  r.delete('/weeks/:id', requireCommander, (req, res) => {
    deleteWeek(id(req.params.id));
    res.json({ ok: true });
  });
  r.post('/weeks/:id/open', (req, res) => {
    const ids = openWeek(me(req), id(req.params.id), req.body);
    res.json({ ids });
  });
  r.post('/weeks/:id/approve', requireCommander, (req, res) => {
    approveWeek(me(req), id(req.params.id));
    res.json(getWeek(id(req.params.id)));
  });
  r.get('/weeks/:id/close-check', (req, res) => res.json(closeCheck(me(req), id(req.params.id))));
  r.post('/weeks/:id/close', (req, res) => {
    closeWeek(me(req), id(req.params.id), req.body);
    res.json(getWeek(id(req.params.id)));
  });
  r.post('/weeks/:id/lessons', (req, res) => {
    addLesson(me(req), id(req.params.id), req.body);
    res.json(weekDetail(me(req), id(req.params.id)));
  });
  r.delete('/lessons/:id', (req, res) => {
    deleteLesson(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- templates & recurring ----------------

  r.get('/templates', (req, res) => res.json(listTemplates(str(req.query.kind))));
  r.get('/templates/:id', (req, res) => res.json(getTemplate(id(req.params.id))));
  r.post('/templates', requireCommander, (req, res) => res.json(getTemplate(saveTemplate(me(req), req.body))));
  r.put('/templates/:id', requireCommander, (req, res) => res.json(getTemplate(saveTemplate(me(req), req.body, id(req.params.id)))));
  r.delete('/templates/:id', requireCommander, (req, res) => {
    deleteTemplate(id(req.params.id));
    res.json({ ok: true });
  });
  r.post('/templates/:id/apply', (req, res) => res.json({ ids: applyTemplate(me(req), id(req.params.id), req.body) }));

  r.get('/recurring', (_req, res) => res.json(listRules()));
  r.post('/recurring', requireCommander, (req, res) => {
    saveRule(me(req), req.body);
    res.json(listRules());
  });
  r.put('/recurring/:id', requireCommander, (req, res) => {
    saveRule(me(req), req.body, id(req.params.id));
    res.json(listRules());
  });
  r.delete('/recurring/:id', requireCommander, (req, res) => {
    deleteRule(id(req.params.id));
    res.json(listRules());
  });

  // ---------------- schedule ----------------

  r.get('/events', (req, res) => {
    const today = localDateKey(clock.now(), tz());
    const from = isDateKey(req.query.from) ? req.query.from : today;
    const to = isDateKey(req.query.to) ? req.query.to : from;
    res.json(listEvents(from, to));
  });
  r.post('/events', (req, res) => res.json(eventDetail(me(req), createEvent(me(req), req.body))));
  r.get('/events/:id', (req, res) => res.json(eventDetail(me(req), id(req.params.id))));
  r.patch('/events/:id', (req, res) => {
    const out = updateEvent(me(req), id(req.params.id), req.body);
    res.json({ ...eventDetail(me(req), id(req.params.id)), ...out });
  });
  r.post('/events/:id/shift-tasks', (req, res) => res.json({ shifted: shiftEventTasks(me(req), id(req.params.id), req.body) }));
  r.post('/events/:id/cancel', (req, res) => {
    cancelEvent(me(req), id(req.params.id), req.body);
    res.json(eventDetail(me(req), id(req.params.id)));
  });
  r.post('/events/:id/restore', (req, res) => {
    restoreEvent(me(req), id(req.params.id));
    res.json(eventDetail(me(req), id(req.params.id)));
  });
  r.delete('/events/:id', (req, res) => {
    deleteEvent(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- Google Calendar ----------------

  r.get('/calendar/feed', (req, res) => res.json(calendarFeed(me(req).id, origin(req))));
  r.post('/calendar/feed/rotate', (req, res) => res.json(calendarFeed(me(req).id, origin(req), true)));
  r.get('/calendar/sources', (req, res) => res.json(listCalendarSources(isCommander(me(req)))));
  r.post('/calendar/sources', requireCommander, async (req, res) => {
    const { name, url } = z.object({ name: z.string().trim().max(60).default(''), url: z.string().trim().min(8, 'הדביקו את כתובת היומן').max(2000) }).parse(req.body);
    await addCalendarSource(me(req), name, url);
    changed('events');
    res.json(listCalendarSources(true));
  });
  r.delete('/calendar/sources/:id', requireCommander, (req, res) => {
    removeCalendarSource(id(req.params.id));
    changed('events');
    res.json(listCalendarSources(true));
  });
  r.get('/calendar/external', async (req, res) => {
    const today = localDateKey(clock.now(), tz());
    const from = isDateKey(req.query.from) ? req.query.from : today;
    const to = isDateKey(req.query.to) && req.query.to >= from ? req.query.to : from;
    res.json(await externalEvents(from, to));
  });

  // ---------------- meetings ----------------

  r.get('/meetings', (_req, res) => res.json(listMeetings()));
  r.get('/meetings/active', (_req, res) => res.json(activeMeeting()));
  r.post('/meetings', requireCommander, (req, res) => {
    const title = z.object({ title: z.string().max(120).optional() }).parse(req.body ?? {}).title;
    res.json(getMeeting(startMeeting(me(req), title)));
  });
  r.get('/meetings/:id', (req, res) => res.json(getMeeting(id(req.params.id))));
  r.patch('/meetings/:id', requireCommander, (req, res) => {
    updateMeeting(id(req.params.id), req.body);
    res.json(getMeeting(id(req.params.id)));
  });
  r.post('/meetings/:id/end', requireCommander, (req, res) => res.json(endMeeting(me(req), id(req.params.id))));

  // ---------------- views & reports ----------------

  r.get('/dashboard', requireCommander, (req, res) => res.json(dashboard(me(req))));
  r.get('/my', (req, res) => res.json(myTasks(me(req))));
  r.get('/team', requireCommander, (req, res) => res.json(team(me(req))));
  r.get('/team/:id', (req, res) => res.json(staffPage(me(req), id(req.params.id))));
  r.get('/briefing', (req, res) => res.json(briefing(me(req))));
  r.get('/reports/weekly', (req, res) => res.json(weeklyReport(me(req), isDateKey(req.query.from) ? req.query.from : undefined)));
  r.get('/reports/lookahead', (req, res) => res.json(lookAhead(me(req))));
  r.get('/reports/day-end', (req, res) => res.json(dayEnd(me(req))));
  r.get('/search', (req, res) => res.json(search(me(req), str(req.query.q) ?? '')));

  r.get('/activity', (req, res) => {
    const u = me(req);
    const limit = Math.min(300, Number(req.query.limit) || 80);
    const rows = listActivity('1=1', [], isCommander(u) ? limit : 500);
    if (isCommander(u)) return res.json(rows);
    const visible = new Set<number>(visibleTasks(u).map((t: Task) => t.id));
    res.json(rows.filter((a) => a.taskId && visible.has(a.taskId)).slice(0, limit));
  });

  // ---------------- notifications ----------------

  r.get('/notifications', (req, res) => {
    const u = me(req);
    const cat = str(req.query.category);
    // put off for later: only in their own list ("נדחו")
    const snoozed = req.query.snoozed === '1';
    const rows = db().all<Parameters<typeof toNotification>[0]>(
      `SELECT * FROM notifications WHERE user_id = ? AND ${snoozed ? 'snoozed_until IS NOT NULL' : 'snoozed_until IS NULL'} ${cat ? 'AND category = ?' : ''}
       ORDER BY ${snoozed ? 'snoozed_until' : 'created_at DESC'}, id DESC LIMIT 200`,
      ...(cat ? [u.id, cat] : [u.id]),
    );
    res.json(rows.map(toNotification));
  });

  r.post('/notifications/:id/snooze', (req, res) => {
    const { until } = z.object({ until: isoDateTime.nullable() }).parse(req.body);
    if (until && Date.parse(until) <= clock.now().getTime()) throw badRequest('הזמן שנבחר כבר עבר');
    if (!snoozeNotification(me(req).id, id(req.params.id), until)) throw notFound('ההתראה לא נמצאה');
    const unread = db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me(req).id)!.n;
    res.json({ unread });
  });

  r.post('/notifications/read', (req, res) => {
    const { ids, all } = z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() }).parse(req.body);
    const u = me(req);
    if (all) db().run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), u.id);
    else for (const n of ids ?? []) db().run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), n, u.id);
    const unread = db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', u.id)!.n;
    res.json({ unread });
  });

  r.use(v3Router());

  r.use((_req, _res, next) => next(notFound('נתיב לא קיים')));
  return r;
}

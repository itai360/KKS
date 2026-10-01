import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  type UserRow,
} from './auth';
import { badRequest, clock, config, forbidden, getSettings, HttpError, notFound, nowIso, tz, updateSettings } from './core';
import { db } from './db';
import { changed, logActivity, toNotification } from './journal';
import { activeMeeting, endMeeting, getMeeting, listMeetings, startMeeting, updateMeeting } from './meetings';
import { deleteRule, listRules, saveRule } from './recurring';
import { briefing, dashboard, dayEnd, lookAhead, myTasks, search, staffPage, team, weeklyReport } from './reports';
import { streamHandler } from './realtime';
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
    res.json({ courseName: s.courseName, courseSymbol: s.courseSymbol, needsSetup: users === 0 });
  });

  const setupSchema = z.object({
    courseName: z.string().trim().min(1).max(120),
    courseSymbol: z.string().trim().max(12).optional(),
    username: z.string().trim().min(2).max(40),
    password: z.string().min(6, 'הסיסמה חייבת להכיל לפחות 6 תווים').max(200),
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
    res.json({ user: toUser(getUserRow(created)!) });
  });

  r.post('/auth/login', (req, res) => {
    const { username, password } = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
    const key = `${req.ip}|${username.toLowerCase()}`;
    loginThrottle(key);
    const u = db().get<UserRow>('SELECT * FROM users WHERE username = ? AND active = 1', username);
    if (!u || !verifyPassword(password, u.password_hash)) {
      loginFailed(key);
      throw new HttpError(401, 'שם משתמש או סיסמה שגויים');
    }
    loginSucceeded(key);
    setSessionCookie(res, createSession(u.id));
    res.json({ user: toUser(u) });
  });

  r.post('/auth/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.use(requireAuth);

  r.get('/auth/me', (req, res) => {
    const unread = db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', me(req).id)!.n;
    res.json({ user: toUser(me(req)), settings: getSettings(), unread, serverTime: nowIso() });
  });

  r.post('/auth/password', (req, res) => {
    const { current, next } = z
      .object({ current: z.string().min(1), next: z.string().min(6, 'הסיסמה החדשה חייבת להכיל לפחות 6 תווים').max(200) })
      .parse(req.body);
    if (!verifyPassword(current, me(req).password_hash)) throw badRequest('הסיסמה הנוכחית שגויה');
    db().run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), me(req).id);
    res.json({ ok: true });
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
    password: z.string().min(6, 'הסיסמה חייבת להכיל לפחות 6 תווים').max(200),
    displayName: z.string().trim().min(1, 'חובה למלא שם').max(80),
    title: z.string().trim().max(80).optional().default(''),
    role: z.enum(ROLES),
    phone: z.string().trim().max(30).optional().default(''),
  });

  r.post('/users', requireCommander, (req, res) => {
    const input = userSchema.parse(req.body);
    if (db().get('SELECT 1 FROM users WHERE username = ?', input.username)) throw badRequest('שם המשתמש תפוס');
    const newId = createUser(input);
    changed('users');
    res.json(toUser(getUserRow(newId)!));
  });

  r.patch('/users/:id', requireCommander, (req, res) => {
    const uid = id(req.params.id);
    const cur = getUserRow(uid);
    if (!cur) throw notFound('המשתמש לא נמצא');
    const p = userSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const willBeCommander = (p.role ?? cur.role) === 'commander' && (p.active ?? !!cur.active);
    if (cur.role === 'commander' && cur.active && !willBeCommander) {
      const others = db().get<{ n: number }>("SELECT count(*) AS n FROM users WHERE role = 'commander' AND active = 1 AND id <> ?", uid)!.n;
      if (others === 0) throw badRequest('חייב להישאר לפחות מפקד קורס פעיל אחד');
    }
    if (p.username && p.username.toLowerCase() !== cur.username.toLowerCase() && db().get('SELECT 1 FROM users WHERE username = ?', p.username)) {
      throw badRequest('שם המשתמש תפוס');
    }
    db().run(
      'UPDATE users SET username = ?, display_name = ?, title = ?, role = ?, phone = ?, active = ? WHERE id = ?',
      p.username ?? cur.username,
      p.displayName ?? cur.display_name,
      p.title ?? cur.title,
      p.role ?? cur.role,
      p.phone ?? cur.phone,
      p.active === undefined ? cur.active : p.active ? 1 : 0,
      uid,
    );
    if (p.password) {
      db().run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(p.password), uid);
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
    const text = str(q.q)?.toLowerCase();
    if (text) {
      list = list.filter((t) =>
        [t.title, t.description, t.domain, t.weekName, t.ownerName].some((f) => f && f.toLowerCase().includes(text)),
      );
    }
    if (q.hideClosed === '1') list = list.filter((t) => isOpenStatus(t.status));
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

  const uploadsDir = () => {
    const dir = join(config.dataDir, 'uploads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  };

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
  const addFile = (u: UserRow, target: { taskId?: number; eventId?: number }, req: Request) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('הקובץ ריק');
    let name = 'file';
    try {
      name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file')).replace(/[\\/\0]/g, '_').slice(0, 200) || 'file';
    } catch {
      /* keep default */
    }
    const stored = randomUUID();
    writeFileSync(join(uploadsDir(), stored), buf);
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
  r.post('/tasks/:id/files', rawBody, (req, res) => {
    const tid = id(req.params.id);
    assertTaskAttachable(me(req), tid);
    addFile(me(req), { taskId: tid }, req);
    res.json(taskDetail(me(req), tid));
  });
  r.post('/events/:id/links', (req, res) => {
    const eid = id(req.params.id);
    assertEventAttachable(me(req), eid);
    addLink(me(req), { eventId: eid }, req.body);
    res.json(eventDetail(me(req), eid));
  });
  r.post('/events/:id/files', rawBody, (req, res) => {
    const eid = id(req.params.id);
    assertEventAttachable(me(req), eid);
    addFile(me(req), { eventId: eid }, req);
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

  r.get('/files/:id', (req, res) => {
    const a = db().get<AttRow>('SELECT * FROM attachments WHERE id = ?', id(req.params.id));
    if (!a || a.kind !== 'file' || !a.url) throw notFound();
    if (a.task_id) {
      const t = getTaskRow(a.task_id);
      if (!t || !canView(me(req), t)) throw notFound();
    }
    const path = join(uploadsDir(), a.url);
    if (!existsSync(path)) throw notFound('הקובץ לא נמצא');
    const mime = a.mime ?? 'application/octet-stream';
    const inline = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i.test(mime);
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
    res.setHeader('Content-Length', String(statSync(path).size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.file_name ?? 'file')}`);
    createReadStream(path).pipe(res);
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
    if (a.kind === 'file' && a.url) {
      try {
        unlinkSync(join(uploadsDir(), a.url));
      } catch {
        /* already gone */
      }
    }
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
    const rows = db().all<Parameters<typeof toNotification>[0]>(
      `SELECT * FROM notifications WHERE user_id = ? ${cat ? 'AND category = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT 200`,
      ...(cat ? [u.id, cat] : [u.id]),
    );
    res.json(rows.map(toNotification));
  });

  r.post('/notifications/read', (req, res) => {
    const { ids, all } = z.object({ ids: z.array(z.number().int()).optional(), all: z.boolean().optional() }).parse(req.body);
    const u = me(req);
    if (all) db().run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), u.id);
    else for (const n of ids ?? []) db().run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), n, u.id);
    const unread = db().get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', u.id)!.n;
    res.json({ unread });
  });

  r.use((_req, _res, next) => next(notFound('נתיב לא קיים')));
  return r;
}

// Routes for version 3 (cadets, experiences, debriefs, documents), push and backup.
// Mounted inside the authenticated API router.

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { requireCommander, type UserRow } from './auth';
import { isCommander } from './taskRepo';
import {
  addExemption,
  addRecord,
  cadetDetail,
  createCadet,
  createExperience,
  deleteCadet,
  deleteExemption,
  deleteExperience,
  deleteRecord,
  updateTalk,
  deleteTeam,
  giveFeedback,
  importCadets,
  listCadets,
  listExemptions,
  listExperiences,
  listTeams,
  saveTeam,
  updateCadet,
  updateExperience,
} from './cadets';
import { badRequest, clock, config, notFound, tz } from './core';
import { db } from './db';
import {
  addItem,
  createDebrief,
  debriefDetail,
  lessonBank,
  reviewLesson,
  deleteDebrief,
  deleteItem,
  itemToRecurring,
  itemToTask,
  itemToTemplate,
  listDebriefs,
  updateDebrief,
  updateItem,
} from './debriefs';
import {
  addDynamics,
  addExamTest,
  addNote,
  addPoint,
  cancelCommittee,
  committeeDetail,
  decideCommittee,
  deleteDynamics,
  deleteNote,
  deletePoint,
  evaluationFile,
  evaluationHistory,
  listEvaluations,
  referToCommittee,
  refreshCommitteeVersion,
  removeExamTest,
  updateEvaluationFields,
  updateNote,
  updatePoint,
} from './evaluations';
import { importGrades, previewGrades, readGradeSheets, removeGradeItem } from './grades';
import { createFileDocument, createLinkDocument, deleteDocument, documentRow, listDocuments, updateDocument } from './documents';
import { getFile, sendStoredFile, uploadName } from './files';
import { cadetsFromSpreadsheet, downloadGoogleSheet, downloadGoogleSheetNamed } from './sheets';
import { deleteSocioRound, importSocio, previewSocio, readSocioSheets, socioOfCadet, socioRound, updateSocioRound } from './sociometric';
import { deleteGuide, disciplineLog, disciplineOverview, getGuide, guideFromFile, guideFromLink, saveGuide } from './discipline';
import { bulkSchema, runBulk } from './bulk';
import { addAbsence, deleteAbsence, listAbsences, staffLoad } from './absences';
import { attendanceHistory, markAttendance, rollCall } from './attendance';
import { deleteAnnouncement, listAnnouncements, markAnnouncement, postAnnouncement, remindAnnouncement } from './announcements';
import { listSnapshots, restoreSnapshot, snapshotBefore, takeSnapshot } from './snapshots';
import { copyPreviousCycleTasks, coursesOverview, previousCycleWeek, startNewCourse, viewCourse, viewingCourse } from './courses';
import { isPushEndpoint } from './netguard';
import { alignmentFeed, deleteMessage, exportText, importAlignment, markSeen, pinMessage, unseenCount } from './alignment';
import { sendPush, subscribe, subscriptionCount, unsubscribe, vapidPublicKey } from './push';
import { isDateKey, localDateKey } from '../../shared/dates';
import { approvePlan, planDocument, plansOverview, savePlan } from './plans';

const id = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('מזהה לא תקין');
  return n;
};
const me = (req: Request): UserRow => req.user!;
const num = (v: unknown): number | undefined => (v === undefined || v === '' ? undefined : Number(v) || undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);

export function v3Router(): Router {
  const r = Router();

  // ---------------- teams & cadets ----------------

  r.get('/teams', (_req, res) => res.json(listTeams()));
  r.post('/teams', requireCommander, (req, res) => {
    saveTeam(me(req), req.body);
    res.json(listTeams());
  });
  r.put('/teams/:id', requireCommander, (req, res) => {
    saveTeam(me(req), req.body, id(req.params.id));
    res.json(listTeams());
  });
  r.delete('/teams/:id', requireCommander, (req, res) => {
    deleteTeam(id(req.params.id));
    res.json(listTeams());
  });

  r.get('/cadets', (req, res) =>
    res.json(listCadets(me(req), { teamId: num(req.query.team), status: str(req.query.status) ?? 'active', q: str(req.query.q) })),
  );
  r.post('/cadets', (req, res) => res.json(cadetDetail(me(req), createCadet(me(req), req.body))));
  r.post('/cadets/import', requireCommander, (req, res) => res.json(importCadets(me(req), req.body)));
  // a spreadsheet becomes the text of the paste import, which the commander reviews before importing
  r.post('/cadets/import/file', requireCommander, express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('לא התקבל קובץ');
    res.json(cadetsFromSpreadsheet(req.body));
  });
  r.post('/cadets/import/link', requireCommander, async (req, res) => {
    const { url } = z.object({ url: z.string().trim().min(10, 'הדביקו קישור').max(2000) }).parse(req.body);
    res.json(cadetsFromSpreadsheet(await downloadGoogleSheet(url, config.maxUploadMb * 1024 * 1024)));
  });
  r.get('/cadets/:id', (req, res) => res.json(cadetDetail(me(req), id(req.params.id))));
  r.patch('/cadets/:id', (req, res) => {
    updateCadet(me(req), id(req.params.id), req.body);
    res.json(cadetDetail(me(req), id(req.params.id)));
  });
  r.delete('/cadets/:id', requireCommander, (req, res) => {
    deleteCadet(id(req.params.id));
    res.json({ ok: true });
  });
  r.post('/cadets/:id/records', (req, res) => {
    addRecord(me(req), id(req.params.id), req.body);
    res.json(cadetDetail(me(req), id(req.params.id)));
  });
  r.get('/exemptions', (req, res) => res.json(listExemptions(me(req))));
  r.post('/cadets/:id/exemptions', (req, res) => {
    addExemption(me(req), id(req.params.id), req.body);
    res.json(cadetDetail(me(req), id(req.params.id)));
  });
  r.delete('/exemptions/:id', (req, res) => res.json(cadetDetail(me(req), deleteExemption(me(req), id(req.params.id)))));
  r.patch('/records/:id', (req, res) => res.json(cadetDetail(me(req), updateTalk(me(req), id(req.params.id), req.body))));
  r.delete('/records/:id', (req, res) => {
    deleteRecord(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- enforcement ladder (from the course's document) ----------------

  r.get('/discipline/guide', (_req, res) => res.json(getGuide()));
  r.get('/discipline/overview', (req, res) => res.json(disciplineOverview(me(req))));
  r.get('/discipline/log', (req, res) => {
    const day = (v: unknown) => (isDateKey(v) ? v : undefined);
    res.json(disciplineLog(me(req), day(req.query.from), day(req.query.to)));
  });
  r.post('/discipline/guide/link', requireCommander, async (req, res) => {
    const { url } = z.object({ url: z.string().trim().min(10, 'הדביקו קישור').max(2000) }).parse(req.body);
    res.json(saveGuide(me(req), await guideFromLink(url, config.maxUploadMb * 1024 * 1024), url));
  });
  // a Word file, or the document pasted (its HTML)
  r.post('/discipline/guide/file', requireCommander, express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('לא התקבל קובץ');
    const name = req.headers['x-filename'] ? uploadName(req.headers['x-filename']) : '';
    res.json(saveGuide(me(req), guideFromFile(req.body), name && name !== 'pasted.html' ? `קובץ: ${name}` : 'הדבקה מהמסמך'));
  });
  r.delete('/discipline/guide', requireCommander, (req, res) => {
    deleteGuide(me(req));
    res.json({ ok: true });
  });

  // ---------------- many items at once ----------------

  r.post('/bulk', async (req, res) => {
    // deleting many items at once can be undone from a snapshot taken just before
    const parsed = bulkSchema.safeParse(req.body);
    if (parsed.success && parsed.data.action === 'delete' && new Set(parsed.data.ids).size >= 5) await snapshotBefore('before_delete');
    res.json(runBulk(me(req), req.body));
  });

  // ---------------- evaluation files ----------------
  // every change answers with the cadet's file as the user may see it

  r.get('/evaluations', (req, res) => res.json(listEvaluations(me(req))));
  // the grade sheet, after an exam or a fitness test: read it, see what it changes, import it
  r.post('/evaluations/grades/file', requireCommander, express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('לא התקבל קובץ');
    res.json(readGradeSheets(me(req), req.body));
  });
  r.post('/evaluations/grades/link', requireCommander, async (req, res) => {
    const { url } = z.object({ url: z.string().trim().min(10, 'הדביקו קישור').max(2000) }).parse(req.body);
    res.json(readGradeSheets(me(req), await downloadGoogleSheet(url, config.maxUploadMb * 1024 * 1024)));
  });
  r.post('/evaluations/grades/preview', requireCommander, (req, res) => res.json(previewGrades(me(req), req.body)));
  r.post('/evaluations/grades/import', requireCommander, (req, res) => res.json(importGrades(me(req), req.body)));
  r.delete('/evaluations/grade-items/:id', requireCommander, (req, res) => {
    removeGradeItem(me(req), id(req.params.id));
    res.json({ ok: true });
  });
  // ---------------- the sociometric ----------------
  // each team's sheet into a round; the results for the commander, a team's for its commander
  r.get('/sociometric', (req, res) => res.json(socioRound(me(req), req.query.round ? id(String(req.query.round)) : undefined)));
  r.post('/sociometric/file', requireCommander, express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('לא התקבל קובץ');
    res.json(readSocioSheets(me(req), req.body));
  });
  r.post('/sociometric/link', requireCommander, async (req, res) => {
    const { url } = z.object({ url: z.string().trim().min(10, 'הדביקו קישור').max(2000) }).parse(req.body);
    const { buf, name } = await downloadGoogleSheetNamed(url, config.maxUploadMb * 1024 * 1024);
    res.json({ name, sheets: readSocioSheets(me(req), buf) });
  });
  r.post('/sociometric/preview', requireCommander, (req, res) => res.json(previewSocio(me(req), req.body)));
  r.post('/sociometric/import', requireCommander, (req, res) => res.json(importSocio(me(req), req.body)));
  r.patch('/sociometric/rounds/:id', requireCommander, (req, res) => {
    updateSocioRound(me(req), id(req.params.id), req.body);
    res.json({ ok: true });
  });
  r.delete('/sociometric/rounds/:id', requireCommander, (req, res) => {
    deleteSocioRound(me(req), id(req.params.id));
    res.json({ ok: true });
  });
  r.get('/cadets/:id/sociometric', (req, res) => res.json(socioOfCadet(me(req), id(req.params.id))));

  r.get('/evaluations/committees/:id', (req, res) => res.json(committeeDetail(me(req), id(req.params.id))));
  r.post('/evaluations/committees/:id/refresh', requireCommander, (req, res) => res.json(evaluationFile(me(req), refreshCommitteeVersion(me(req), id(req.params.id)))));
  r.post('/evaluations/committees/:id/decision', requireCommander, (req, res) => res.json(evaluationFile(me(req), decideCommittee(me(req), id(req.params.id), req.body))));
  r.delete('/evaluations/committees/:id', requireCommander, (req, res) => res.json(evaluationFile(me(req), cancelCommittee(me(req), id(req.params.id)))));
  r.get('/evaluations/:cadetId', (req, res) => res.json(evaluationFile(me(req), id(req.params.cadetId))));
  r.get('/evaluations/:cadetId/history', (req, res) => res.json(evaluationHistory(me(req), id(req.params.cadetId))));
  r.patch('/evaluations/:cadetId', (req, res) => {
    updateEvaluationFields(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  // a test added (or taken away) from one file is in the files of the whole course
  r.post('/evaluations/:cadetId/tests', (req, res) => {
    addExamTest(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  r.delete('/evaluations/:cadetId/tests/:test', (req, res) => {
    removeExamTest(me(req), id(req.params.cadetId), String(req.params.test));
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  r.post('/evaluations/:cadetId/dynamics', (req, res) => {
    addDynamics(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  r.delete('/evaluations/dynamics/:id', (req, res) => res.json(evaluationFile(me(req), deleteDynamics(me(req), id(req.params.id)))));
  r.post('/evaluations/:cadetId/notes', (req, res) => {
    addNote(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  r.patch('/evaluations/notes/:id', (req, res) => res.json(evaluationFile(me(req), updateNote(me(req), id(req.params.id), req.body))));
  r.delete('/evaluations/notes/:id', (req, res) => res.json(evaluationFile(me(req), deleteNote(me(req), id(req.params.id)))));
  r.post('/evaluations/:cadetId/points', (req, res) => {
    addPoint(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  r.patch('/evaluations/points/:id', (req, res) => res.json(evaluationFile(me(req), updatePoint(me(req), id(req.params.id), req.body))));
  r.delete('/evaluations/points/:id', (req, res) => res.json(evaluationFile(me(req), deletePoint(me(req), id(req.params.id)))));
  r.post('/evaluations/:cadetId/committees', requireCommander, (req, res) => {
    referToCommittee(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });

  // ---------------- experiences ----------------

  r.get('/experiences', (req, res) =>
    res.json(
      listExperiences(me(req), {
        cadetId: num(req.query.cadet),
        mentorId: req.query.mine === '1' ? me(req).id : num(req.query.mentor),
        weekId: num(req.query.week),
      }),
    ),
  );
  r.post('/experiences', (req, res) => {
    const newId = createExperience(me(req), req.body);
    res.json(listExperiences(me(req)).find((x) => x.id === newId));
  });
  r.patch('/experiences/:id', (req, res) => {
    updateExperience(me(req), id(req.params.id), req.body);
    res.json(listExperiences(me(req)).find((x) => x.id === id(req.params.id)));
  });
  r.post('/experiences/:id/feedback', (req, res) => {
    giveFeedback(me(req), id(req.params.id), req.body);
    res.json(listExperiences(me(req)).find((x) => x.id === id(req.params.id)));
  });
  r.delete('/experiences/:id', (req, res) => {
    deleteExperience(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- announcements to the staff ----------------

  r.get('/announcements', (req, res) => res.json(listAnnouncements(me(req), { pending: req.query.pending === '1' })));
  r.post('/announcements', (req, res) => {
    postAnnouncement(me(req), req.body);
    res.json(listAnnouncements(me(req)));
  });
  r.post('/announcements/:id/read', (req, res) => {
    markAnnouncement(me(req), id(req.params.id), req.body?.ack === true);
    res.json(listAnnouncements(me(req)));
  });
  r.post('/announcements/:id/remind', (req, res) => res.json({ reminded: remindAnnouncement(me(req), id(req.params.id)) }));
  r.delete('/announcements/:id', (req, res) => {
    deleteAnnouncement(me(req), id(req.params.id));
    res.json(listAnnouncements(me(req)));
  });

  // ---------------- the daily roll call ----------------

  r.get('/attendance', (req, res) => res.json(rollCall(isDateKey(req.query.date) ? req.query.date : localDateKey(clock.now(), tz()), num(req.query.team))));
  r.put('/attendance', (req, res) => {
    markAttendance(me(req), req.body);
    const date = String(req.body?.date ?? '');
    res.json(rollCall(isDateKey(date) ? date : localDateKey(clock.now(), tz()), num(req.query.team)));
  });
  r.get('/cadets/:id/attendance', (req, res) => res.json(attendanceHistory(id(req.params.id))));

  // ---------------- availability ----------------

  r.get('/absences', (req, res) =>
    res.json(
      // who is away is for everyone; what they wrote about it is for them and the commander
      listAbsences({ userId: num(req.query.user), from: isDateKey(req.query.from) ? req.query.from : undefined, to: isDateKey(req.query.to) ? req.query.to : undefined }).map((a) =>
        isCommander(me(req)) || a.userId === me(req).id ? a : { ...a, note: '' },
      ),
    ),
  );
  r.post('/absences', (req, res) => res.json(addAbsence(me(req), req.body)));
  r.delete('/absences/:id', (req, res) => {
    deleteAbsence(me(req), id(req.params.id));
    res.json({ ok: true });
  });
  // who to give a task to: everyone's load, and who is away on its day
  r.get('/load', (req, res) => res.json(staffLoad(isDateKey(req.query.date) ? req.query.date : undefined)));

  // ---------------- debriefs ----------------

  r.get('/debriefs', (req, res) => res.json(listDebriefs(me(req), { weekId: num(req.query.week), eventId: num(req.query.event) })));
  r.post('/debriefs', (req, res) => res.json(debriefDetail(me(req), createDebrief(me(req), req.body))));
  r.get('/debriefs/:id', (req, res) => res.json(debriefDetail(me(req), id(req.params.id))));
  r.patch('/debriefs/:id', (req, res) => {
    updateDebrief(me(req), id(req.params.id), req.body);
    res.json(debriefDetail(me(req), id(req.params.id)));
  });
  r.delete('/debriefs/:id', (req, res) => {
    deleteDebrief(me(req), id(req.params.id));
    res.json({ ok: true });
  });
  r.post('/debriefs/:id/items', (req, res) => {
    addItem(me(req), id(req.params.id), req.body);
    res.json(debriefDetail(me(req), id(req.params.id)));
  });

  const itemDebrief = (itemId: number) => {
    const row = db().get<{ debrief_id: number }>('SELECT debrief_id FROM debrief_items WHERE id = ?', itemId);
    if (!row) throw notFound('הפריט לא נמצא');
    return row.debrief_id;
  };
  r.patch('/debrief-items/:id', (req, res) => {
    const did = itemDebrief(id(req.params.id));
    updateItem(me(req), id(req.params.id), req.body);
    res.json(debriefDetail(me(req), did));
  });
  // lessons kept for the next cycle: all, or those for a week or an event
  r.get('/lessons', (req, res) => res.json(lessonBank({ weekId: num(req.query.week), eventId: num(req.query.event) })));
  // on its week or event: a task, applied, or not relevant
  r.post('/lessons/:id/review', (req, res) => {
    reviewLesson(me(req), id(req.params.id), req.body);
    res.json(lessonBank({ weekId: req.body?.weekId, eventId: req.body?.eventId }));
  });
  r.delete('/debrief-items/:id', (req, res) => {
    const did = itemDebrief(id(req.params.id));
    deleteItem(me(req), id(req.params.id));
    res.json(debriefDetail(me(req), did));
  });
  r.post('/debrief-items/:id/task', (req, res) => {
    const did = itemDebrief(id(req.params.id));
    itemToTask(me(req), id(req.params.id), req.body);
    res.json(debriefDetail(me(req), did));
  });
  r.post('/debrief-items/:id/recurring', (req, res) => {
    const did = itemDebrief(id(req.params.id));
    itemToRecurring(me(req), id(req.params.id), req.body);
    res.json(debriefDetail(me(req), did));
  });
  r.post('/debrief-items/:id/template', (req, res) => {
    const did = itemDebrief(id(req.params.id));
    itemToTemplate(me(req), id(req.params.id), req.body);
    res.json(debriefDetail(me(req), did));
  });

  // ---------------- documents ----------------

  r.get('/documents', (req, res) => res.json(listDocuments(me(req), { category: str(req.query.category), weekId: num(req.query.week), q: str(req.query.q) })));
  r.post('/documents', (req, res) => {
    createLinkDocument(me(req), req.body);
    res.json(listDocuments(me(req)));
  });
  r.post('/documents/file', express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), async (req, res) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf)) throw badRequest('הקובץ ריק');
    const name = uploadName(req.headers['x-filename']);
    const q = req.query;
    await createFileDocument(
      me(req),
      {
        title: str(q.title) ?? name,
        category: str(q.category) ?? 'אחר',
        description: str(q.description) ?? '',
        weekId: num(q.weekId) ?? null,
        restricted: q.restricted === '1',
        pinned: q.pinned === '1',
      },
      { buf, name, mime: String(req.headers['content-type'] ?? 'application/octet-stream').slice(0, 100) },
    );
    res.json(listDocuments(me(req)));
  });
  r.patch('/documents/:id', (req, res) => {
    updateDocument(me(req), id(req.params.id), req.body);
    res.json(listDocuments(me(req)));
  });
  r.delete('/documents/:id', (req, res) => {
    deleteDocument(me(req), id(req.params.id));
    res.json({ ok: true });
  });
  r.get('/documents/:id/file', async (req, res) => {
    const d = documentRow(me(req), id(req.params.id));
    if (d.kind !== 'file' || !d.url) throw notFound();
    const data = await getFile(d.url);
    if (!data) throw notFound('הקובץ לא נמצא');
    sendStoredFile(res, data, d.mime, d.file_name);
  });

  // ---------------- push ----------------

  const subSchema = z.object({
    endpoint: z.string().url().max(2000).refine(isPushEndpoint, 'כתובת התראות לא מוכרת'),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  });
  r.get('/push/key', (req, res) => res.json({ publicKey: vapidPublicKey(), subscriptions: subscriptionCount(me(req).id) }));
  r.post('/push/subscribe', (req, res) => {
    subscribe(me(req).id, subSchema.parse(req.body), String(req.headers['user-agent'] ?? ''));
    res.json({ subscriptions: subscriptionCount(me(req).id) });
  });
  r.post('/push/unsubscribe', (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
    unsubscribe(me(req).id, endpoint);
    res.json({ subscriptions: subscriptionCount(me(req).id) });
  });
  r.post('/push/test', async (req, res) => {
    const sent = await sendPush(me(req).id, { id: 0, title: 'התראת בדיקה', body: 'ההתראות לטלפון פועלות', link: '/notifications', category: 'action' }, true);
    res.json({ sent });
  });

  // ---------------- "יישור קו" (the staff's WhatsApp group) ----------------

  r.get('/alignment', (req, res) =>
    res.json(alignmentFeed({ q: typeof req.query.q === 'string' ? req.query.q : undefined, before: typeof req.query.before === 'string' ? req.query.before : undefined, beforeId: num(req.query.id) })),
  );
  r.get('/alignment/unseen', (req, res) => res.json({ n: unseenCount(me(req).id) }));
  r.post('/alignment/seen', (req, res) => {
    markSeen(me(req).id);
    res.json({ ok: true });
  });
  r.post('/alignment/import', (req, res) => {
    const { text } = z.object({ text: z.string().min(1, 'הדביקו את ההודעות').max(900_000) }).parse(req.body);
    res.json(importAlignment(me(req), text));
  });
  r.post('/alignment/import/file', express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('לא התקבל קובץ');
    res.json(importAlignment(me(req), exportText(req.body)));
  });
  r.post('/alignment/:id/pin', requireCommander, (req, res) => {
    pinMessage(id(req.params.id), req.body);
    res.json({ ok: true });
  });
  r.delete('/alignment/:id', requireCommander, (req, res) => {
    deleteMessage(id(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- previous courses ----------------

  r.get('/courses', requireCommander, (req, res) => res.json(coursesOverview(viewingCourse(req))));
  // the same week in the previous course: what was done, and repeating it here
  r.get('/weeks/:id/previous-cycle', async (req, res) => res.json(await previousCycleWeek(id(req.params.id), me(req))));
  r.post('/weeks/:id/previous-cycle/copy', async (req, res) => res.json(await copyPreviousCycleTasks(me(req), id(req.params.id), req.body)));
  r.post('/courses/new', requireCommander, async (req, res) => {
    const archive = await startNewCourse(me(req), req.body);
    viewCourse(res, null);
    res.json(archive);
  });
  r.post('/courses/view', requireCommander, (req, res) => {
    const { id } = z.object({ id: z.number().int().positive().nullable() }).parse(req.body);
    viewCourse(res, id);
    res.json({ ok: true });
  });

  // ---------------- plan approval: the commander's documents for the commander above ----------------

  r.get('/plans', requireCommander, async (_req, res) => res.json(await plansOverview()));
  r.get('/plans/:weekId', requireCommander, async (req, res) => res.json(await planDocument(id(req.params.weekId))));
  r.patch('/plans/:weekId', requireCommander, async (req, res) => {
    savePlan(me(req), id(req.params.weekId), req.body);
    res.json(await planDocument(id(req.params.weekId)));
  });
  r.post('/plans/:weekId/approve', requireCommander, async (req, res) => {
    await approvePlan(me(req), id(req.params.weekId), req.body);
    res.json(await planDocument(id(req.params.weekId)));
  });

  // ---------------- backup ----------------

  r.get('/admin/snapshots', requireCommander, async (_req, res) => res.json(await listSnapshots()));
  r.post('/admin/snapshots', requireCommander, async (_req, res) => {
    await takeSnapshot('manual');
    res.json({ ok: true });
  });
  r.post('/admin/snapshots/:id/restore', requireCommander, async (req, res) => {
    await restoreSnapshot(String(req.params.id));
    res.json({ ok: true });
  });

  r.get('/admin/backup', requireCommander, (_req, res) => {
    const file = join(config.dataDir, `backup-${Date.now()}.db`);
    db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const name = `kks-backup-${localDateKey(clock.now(), tz())}.db`;
    res.download(file, name, () => {
      try {
        unlinkSync(file);
      } catch {
        /* ignore */
      }
    });
  });

  return r;
}

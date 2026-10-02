// Routes for version 3 (cadets, experiences, debriefs, documents), push and backup.
// Mounted inside the authenticated API router.

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { requireCommander, type UserRow } from './auth';
import {
  addRecord,
  cadetDetail,
  createCadet,
  createExperience,
  deleteCadet,
  deleteExperience,
  deleteRecord,
  deleteTeam,
  giveFeedback,
  importCadets,
  listCadets,
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
  addEvaluationEntry,
  cancelCommittee,
  committeeDetail,
  decideCommittee,
  deleteEvaluationEntry,
  evaluationFile,
  listEvaluations,
  referToCommittee,
  refreshCommitteeVersion,
  setEntryShown,
  updateEvaluationEntry,
  updateEvaluationFile,
} from './evaluations';
import { createFileDocument, createLinkDocument, deleteDocument, documentRow, listDocuments, updateDocument } from './documents';
import { getFile, sendStoredFile, uploadName } from './files';
import { cadetsFromSpreadsheet, downloadGoogleSheet } from './sheets';
import { deleteGuide, disciplineOverview, getGuide, guideFromFile, guideFromLink, saveGuide } from './discipline';
import { bulkSchema, runBulk } from './bulk';
import { listSnapshots, restoreSnapshot, snapshotBefore, takeSnapshot } from './snapshots';
import { sendPush, subscribe, subscriptionCount, unsubscribe, vapidPublicKey } from './push';
import { localDateKey } from '../../shared/dates';

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
  r.delete('/records/:id', (req, res) => {
    deleteRecord(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  // ---------------- enforcement ladder (from the course's document) ----------------

  r.get('/discipline/guide', (_req, res) => res.json(getGuide()));
  r.get('/discipline/overview', (req, res) => res.json(disciplineOverview(me(req))));
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
  r.get('/evaluations/committees/:id', (req, res) => res.json(committeeDetail(me(req), id(req.params.id))));
  r.post('/evaluations/committees/:id/refresh', requireCommander, (req, res) => res.json(evaluationFile(me(req), refreshCommitteeVersion(me(req), id(req.params.id)))));
  r.post('/evaluations/committees/:id/decision', requireCommander, (req, res) => res.json(evaluationFile(me(req), decideCommittee(me(req), id(req.params.id), req.body))));
  r.delete('/evaluations/committees/:id', requireCommander, (req, res) => res.json(evaluationFile(me(req), cancelCommittee(me(req), id(req.params.id)))));
  r.patch('/evaluations/entries/:id', (req, res) => res.json(evaluationFile(me(req), updateEvaluationEntry(me(req), id(req.params.id), req.body))));
  r.post('/evaluations/entries/:id/shown', (req, res) => {
    const { shownOn } = z.object({ shownOn: z.string().nullable() }).parse(req.body);
    res.json(evaluationFile(me(req), setEntryShown(me(req), id(req.params.id), shownOn)));
  });
  r.delete('/evaluations/entries/:id', (req, res) => res.json(evaluationFile(me(req), deleteEvaluationEntry(me(req), id(req.params.id)))));
  r.get('/evaluations/:cadetId', (req, res) => res.json(evaluationFile(me(req), id(req.params.cadetId))));
  r.patch('/evaluations/:cadetId', (req, res) => {
    updateEvaluationFile(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
  r.post('/evaluations/:cadetId/entries', (req, res) => {
    addEvaluationEntry(me(req), id(req.params.cadetId), req.body);
    res.json(evaluationFile(me(req), id(req.params.cadetId)));
  });
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
    const { body } = z.object({ body: z.string().max(3000) }).parse(req.body);
    const did = itemDebrief(id(req.params.id));
    updateItem(me(req), id(req.params.id), body);
    res.json(debriefDetail(me(req), did));
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
    endpoint: z.string().url().max(2000),
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

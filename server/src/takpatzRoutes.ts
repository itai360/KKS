// The takpatz's routes (takpatz.ts). Every one goes through the checks there - the team of the cadet,
// the placement or the row it touches - so a team commander reaches their own team's takpatz only, by
// any address; the export and the save to Google Drive too.

import { Router, type Request, type Response } from 'express';
import { TAKPATZ_BOARDS, takpatzFileName } from '../../shared/takpatz';
import { fileName } from '../../shared/docx';
import { badRequest, HttpError } from './core';
import { driveFailure, driveSignInUrl, driveToken, revokeDriveToken, takeDriveRequest, uploadToDrive } from './googleDrive';
import {
  addCatalogItem,
  copyBoard,
  copyPlacement,
  createPlacement,
  createTracking,
  deleteCatalogItem,
  deletePlacement,
  deleteTracking,
  overview,
  requireTeam,
  saveProfile,
  setStage,
  teamView,
  updateCatalogItem,
  updatePlacement,
  updateTracking,
} from './takpatz';
import { exportProblems, takpatzXlsx, XLSX_TYPE } from './takpatzXlsx';
import { getUserRow, type UserRow } from './auth';

const id = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('מזהה לא תקין');
  return n;
};
const me = (req: Request): UserRow => req.user!;
const board = (v: unknown) => {
  if (!(TAKPATZ_BOARDS as readonly unknown[]).includes(v)) throw badRequest('תכנון לא מוכר');
  return v as (typeof TAKPATZ_BOARDS)[number];
};
const origin = (req: Request) => `${req.protocol}://${req.host}`;

/** the team's file, for whoever may keep its takpatz - or why it cannot be written yet */
function teamFile(actor: UserRow, teamId: number): { name: string; data: Uint8Array } {
  const view = teamView(actor, teamId);
  const problems = exportProblems(view);
  if (problems.length) throw new HttpError(409, `לפני הייצוא צריך להפריד בין התנסויות שחופפות באותו שבוע:\n${problems.join('\n')}`);
  return { name: fileName(takpatzFileName(view.team.name, view.courseName), 'xlsx'), data: takpatzXlsx(view) };
}

export function takpatzRouter(): Router {
  const r = Router();
  r.get('/takpatz', (req, res) => res.json(overview(me(req))));
  r.get('/takpatz/teams/:id', (req, res) => res.json(teamView(me(req), id(req.params.id))));
  r.patch('/takpatz/cadets/:id', (req, res) => res.json(saveProfile(me(req), id(req.params.id), req.body)));

  r.post('/takpatz/placements', (req, res) => res.json(createPlacement(me(req), req.body)));
  r.patch('/takpatz/placements/:id', (req, res) => res.json(updatePlacement(me(req), id(req.params.id), req.body)));
  r.delete('/takpatz/placements/:id', (req, res) => {
    deletePlacement(me(req), id(req.params.id));
    res.json({ ok: true });
  });
  r.post('/takpatz/placements/:id/copy', (req, res) => res.json(copyPlacement(me(req), id(req.params.id), board(req.body?.to))));
  r.post('/takpatz/teams/:id/copy-board', (req, res) => res.json({ copied: copyBoard(me(req), id(req.params.id), board(req.body?.from), board(req.body?.to)) }));

  r.put('/takpatz/stages', (req, res) => res.json(setStage(me(req), req.body)));
  r.post('/takpatz/tracking', (req, res) => res.json({ id: createTracking(me(req), req.body) }));
  r.patch('/takpatz/tracking/:id', (req, res) => {
    updateTracking(me(req), id(req.params.id), req.body);
    res.json({ ok: true });
  });
  r.delete('/takpatz/tracking/:id', (req, res) => {
    deleteTracking(me(req), id(req.params.id));
    res.json({ ok: true });
  });

  r.post('/takpatz/catalog', (req, res) => res.json(addCatalogItem(me(req), req.body)));
  r.patch('/takpatz/catalog/:id', (req, res) => res.json(updateCatalogItem(me(req), id(req.params.id), req.body)));
  r.delete('/takpatz/catalog/:id', (req, res) => res.json(deleteCatalogItem(me(req), id(req.params.id))));

  // the spreadsheet, made now from what is kept - no address of it stays behind
  r.get('/takpatz/teams/:id/export', (req, res) => {
    const f = teamFile(me(req), id(req.params.id));
    res.setHeader('Content-Type', XLSX_TYPE);
    res.setHeader('Content-Length', String(f.data.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.end(Buffer.from(f.data));
  });

  // saving to Google Drive starts at Google's sign-in (googleDrive.ts); the file is checked as writable first
  r.post('/takpatz/teams/:id/drive', (req, res) => {
    const teamId = id(req.params.id);
    requireTeam(me(req), teamId);
    teamFile(me(req), teamId);
    res.json({ url: driveSignInUrl(me(req), teamId, origin(req)) });
  });
  return r;
}

/**
 * Google sends the browser back here after its sign-in (a plain GET, with the sign-in cookie): the save
 * it belongs to is matched to the person signed in, the file is made and uploaded, and the takpatz opens
 * again - saying it was saved only when it was.
 */
export async function driveCallback(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const pending = takeDriveRequest(String(q.state ?? ''));
  const back = (teamId: number | null, result: string, link?: string) =>
    res.redirect(303, `/takpatz${teamId ? `/${teamId}` : ''}?drive=${result}${link ? `&link=${encodeURIComponent(link)}` : ''}`);
  if (!pending) return back(null, 'expired');
  const actor = req.user;
  if (!actor || actor.id !== pending.userId) return back(pending.teamId, 'denied');
  if (q.error || !q.code) return back(pending.teamId, 'cancelled');
  let token = '';
  try {
    const f = teamFile(getUserRow(actor.id) ?? actor, pending.teamId);
    token = await driveToken(String(q.code), pending.verifier, origin(req));
    const link = await uploadToDrive(token, f.name, XLSX_TYPE, f.data);
    back(pending.teamId, 'ok', link);
  } catch (e) {
    if (e instanceof HttpError) return back(pending.teamId, e.status === 403 ? 'denied' : 'failed');
    console.error('drive save failed:', (e as Error).message);
    back(pending.teamId, driveFailure((e as Error).message));
  } finally {
    if (token) revokeDriveToken(token);
  }
}

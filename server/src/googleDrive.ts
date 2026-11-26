// Saving a team's takpatz into the Google Drive of the one who saves it, as the same Excel file the
// download gives (not turned into a Google Sheets file, so nothing of its look changes on the way).
// Enabled by setting GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, with this server's
// /api/google/drive/callback as an authorized redirect address of that Google client.
//
// The browser never holds a Google token: it is sent to Google's sign-in, Google sends it back here
// with a one-time code, and the server turns the code into an access token, uploads the file, and lets
// the token go (revoked, never stored). The access asked for is "drive.file" - only the files this app
// itself creates - and a file it creates is the owner's alone, shared with nobody.

import { createHash, randomBytes } from 'node:crypto';
import type { UserRow } from './auth';
import { clock, HttpError, nowIso } from './core';
import { db } from './db';

export const driveAvailable = (): boolean => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'תקפ״צ';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const WAIT_MS = 10 * 60_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let http: Fetch = (url, init) => fetch(url, init);
/** the tests stand in for Google */
export function setDriveFetch(f: Fetch | null): void {
  http = f ?? ((url, init) => fetch(url, init));
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const driveRedirectUri = (origin: string) => `${origin}/api/google/drive/callback`;

/** the address of Google's sign-in for this save; what comes back is matched to this person and team */
export function driveSignInUrl(actor: UserRow, teamId: number, origin: string): string {
  if (!driveAvailable()) throw new HttpError(503, 'השמירה ב-Google Drive עוד לא הוגדרה בשרת. בינתיים אפשר להוריד את הקובץ ולהעלות אותו ל-Drive.');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  db().run('DELETE FROM google_drive_requests WHERE expires_at < ?', nowIso());
  db().run(
    'INSERT INTO google_drive_requests(state_hash, user_id, team_id, verifier, expires_at) VALUES (?, ?, ?, ?, ?)',
    hash(state),
    actor.id,
    teamId,
    verifier,
    new Date(clock.now().getTime() + WAIT_MS).toISOString(),
  );
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: driveRedirectUri(origin),
    response_type: 'code',
    scope: SCOPE,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    access_type: 'online',
    include_granted_scopes: 'true',
  });
  if (actor.email) q.set('login_hint', actor.email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface DriveRequest {
  userId: number;
  teamId: number;
  verifier: string;
}

/** the save this answer from Google belongs to - once, while it is fresh */
export function takeDriveRequest(state: string): DriveRequest | null {
  if (!state) return null;
  const r = db().get<{ user_id: number; team_id: number; verifier: string; expires_at: string }>('SELECT * FROM google_drive_requests WHERE state_hash = ?', hash(state));
  if (!r) return null;
  db().run('DELETE FROM google_drive_requests WHERE state_hash = ?', hash(state));
  if (r.expires_at < nowIso()) return null;
  return { userId: r.user_id, teamId: r.team_id, verifier: r.verifier };
}

/** Google's answer, or what went wrong in Google's own words (an error code, never a token) */
async function ok(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
  throw new Error(`${what}: ${res.status} ${body}`);
}

/** which part of the setup a failure points at, for the person saving and for the log */
export type DriveFailure = 'client' | 'api' | 'redirect' | 'failed';
export function driveFailure(message: string): DriveFailure {
  if (/redirect_uri_mismatch/.test(message)) return 'redirect';
  if (/invalid_client|unauthorized_client/.test(message)) return 'client';
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(message)) return 'api';
  return 'failed';
}

/** Google's one-time code for an access token, used for this save only */
export async function driveToken(code: string, verifier: string, origin: string): Promise<string> {
  const res = await ok(
    await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: driveRedirectUri(origin),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
    }),
    'token',
  );
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('token: none');
  return body.access_token;
}

/** the access is given back at once - nothing is kept */
export function revokeDriveToken(token: string): void {
  void http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

/** the app's folder in the person's Drive (one the app made before, or a new one) */
async function folderId(token: string): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const q = `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_TYPE}' and trashed = false`;
  const found = await ok(await http(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`, { headers: auth }), 'folder');
  const id = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (id) return id;
  const made = await ok(
    await http('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_TYPE }) }),
    'folder',
  );
  return ((await made.json()) as { id: string }).id;
}

/** the file into the folder, as it is: its link to open it */
export async function uploadToDrive(token: string, name: string, type: string, data: Uint8Array): Promise<string> {
  const parent = await folderId(token);
  const boundary = `kks${randomBytes(12).toString('hex')}`;
  const head = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: type, parents: [parent] })}\r\n--${boundary}\r\ncontent-type: ${type}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(data), Buffer.from(`\r\n--${boundary}--`, 'utf8')]);
  const res = await ok(
    await http('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    }),
    'upload',
  );
  const file = (await res.json()) as { id: string; webViewLink?: string };
  return file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
}

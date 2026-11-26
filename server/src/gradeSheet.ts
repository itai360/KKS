// The course's grade sheet in Google (גליון הציונים): a grade the staff's checklist gives (staffChecks.ts) is
// written into it - into the cadet's row, under the grade's column. The commander sets the sheet's link and
// someone whose Google account may edit it connects it once; from then on the server writes there with that
// account. What Google gives back to keep - its refresh token - is kept sealed, as for the calendar.
//
// The access asked for is all of Drive ("drive"): the sheet is an existing file, often someone else's, and an
// Excel file kept in Drive is written by downloading it, changing the one cell and uploading it back (a Google
// Sheets file is written straight through its own API).

import { createHash, randomBytes } from 'node:crypto';
import type { GradeSheetStatus } from '../../shared/types';
import type { UserRow } from './auth';
import { badRequest, clock, HttpError, nowIso } from './core';
import { currentSlot, db } from './db';
import { seal, unseal } from './gcalSync';
import { driveAvailable, driveRedirectUri } from './googleDrive';
import { locate, colName, writeGradeXlsx, type GridRow, type Who } from './xlsxPatch';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive'];
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const WAIT_MS = 10 * 60_000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET = 'application/vnd.google-apps.spreadsheet';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
let http: Fetch = (url, init) => fetch(url, init);
/** the tests stand in for Google */
export function setSheetFetch(f: Fetch | null): void {
  http = f ?? ((url, init) => fetch(url, init));
  token = null;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

interface SheetRow {
  url: string;
  file_id: string;
  file_name: string;
  user_id: number | null;
  email: string;
  refresh_token: string;
  connected_at: string | null;
  last_error: string;
}

const row = () => db().get<SheetRow>('SELECT * FROM grade_sheet WHERE id = 1');

/** the file's id in a link to it (a sheet, a file in Drive) - or the id itself */
export function fileIdOf(link: string): string | null {
  const t = link.trim();
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(t) ?? /[?&]id=([A-Za-z0-9_-]{20,})/.exec(t) ?? /^([A-Za-z0-9_-]{20,})$/.exec(t);
  return m?.[1] ?? null;
}

export function gradeSheetStatus(actor: UserRow): GradeSheetStatus {
  const r = row();
  return {
    url: r?.url ?? '',
    fileName: r?.file_name ?? '',
    connected: !!r?.refresh_token,
    email: r?.email ?? '',
    lastError: r?.last_error ?? '',
    canManage: actor.role === 'commander' && !currentSlot(),
    available: driveAvailable(),
  };
}

/** the sheet's link (empty: none) - the connection stays */
export function setGradeSheetLink(link: string): void {
  const t = link.trim();
  const id = t ? fileIdOf(t) : '';
  if (t && !id) throw badRequest('זה לא נראה כמו קישור לגליון ב-Google');
  db().run(
    `INSERT INTO grade_sheet(id, url, file_id, file_name, last_error) VALUES (1, ?, ?, '', '')
     ON CONFLICT(id) DO UPDATE SET url = excluded.url, file_id = excluded.file_id, file_name = CASE WHEN grade_sheet.file_id = excluded.file_id THEN grade_sheet.file_name ELSE '' END, last_error = ''`,
    t,
    id ?? '',
  );
}

// ---------------- connecting ----------------

/** the address of Google's sign-in for connecting the sheet; what comes back is matched to this person */
export function gradeSheetConnectUrl(actor: UserRow, origin: string): string {
  if (!driveAvailable()) throw new HttpError(503, 'החיבור ל-Google עוד לא הוגדר בשרת (GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET).');
  if (!row()?.file_id) throw badRequest('קודם מדביקים את הקישור לגליון הציונים');
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  db().run('DELETE FROM grade_sheet_requests WHERE expires_at < ?', nowIso());
  db().run('INSERT INTO grade_sheet_requests(state_hash, user_id, verifier, expires_at) VALUES (?, ?, ?, ?)', sha(state), actor.id, verifier, new Date(clock.now().getTime() + WAIT_MS).toISOString());
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: driveRedirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    // a token that lasts (the grades are written later, by whoever marks them), and the account chosen each
    // time - the one that may edit the sheet
    access_type: 'offline',
    prompt: 'consent select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export function sheetRequestWaiting(state: string): boolean {
  return !!state && !!db().get('SELECT 1 FROM grade_sheet_requests WHERE state_hash = ?', sha(state));
}

export function takeSheetRequest(state: string): { userId: number; verifier: string } | null {
  if (!state) return null;
  const r = db().get<{ user_id: number; verifier: string; expires_at: string }>('SELECT * FROM grade_sheet_requests WHERE state_hash = ?', sha(state));
  if (!r) return null;
  db().run('DELETE FROM grade_sheet_requests WHERE state_hash = ?', sha(state));
  if (r.expires_at < nowIso()) return null;
  return { userId: r.user_id, verifier: r.verifier };
}

const emailOf = (idToken: string | undefined): string => {
  try {
    return String((JSON.parse(Buffer.from((idToken ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string }).email ?? '').slice(0, 200);
  } catch {
    return '';
  }
};

/** the one-time code for a lasting token, kept sealed - then a look at the sheet: is it there, may it be edited */
export async function finishSheetConnect(userId: number, code: string, verifier: string, origin: string): Promise<'ok' | 'scope' | 'failed'> {
  const res = await http('https://oauth2.googleapis.com/token', {
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
  });
  if (!res.ok) return 'failed';
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
  if (!(body.scope ?? '').split(' ').includes(DRIVE_SCOPE)) return 'scope';
  if (!body.refresh_token) return 'failed';
  db().run(
    `INSERT INTO grade_sheet(id, user_id, email, refresh_token, connected_at, last_error) VALUES (1, ?, ?, ?, ?, '')
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email, refresh_token = excluded.refresh_token, connected_at = excluded.connected_at, last_error = ''`,
    userId,
    emailOf(body.id_token),
    seal(body.refresh_token),
    nowIso(),
  );
  if (body.access_token) token = { value: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000 };
  await checkSheet();
  return 'ok';
}

/** the sheet let go: Google's permission given back, nothing kept */
export function disconnectGradeSheet(): void {
  const r = row();
  if (!r?.refresh_token) return;
  const t = unseal(r.refresh_token);
  if (t) void http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => undefined);
  db().run("UPDATE grade_sheet SET refresh_token = '', user_id = NULL, email = '', connected_at = NULL, last_error = '' WHERE id = 1");
  token = null;
}

// ---------------- writing ----------------

let token: { value: string; until: number } | null = null;

async function accessToken(r: SheetRow): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const refresh = unseal(r.refresh_token);
  if (!refresh) throw new SheetError('החיבור ל-Google לא תקף - צריך לחבר מחדש');
  const res = await http('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
  });
  if (!res.ok) throw new SheetError('החיבור ל-Google בוטל או פג - צריך לחבר מחדש');
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  token = { value: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000 };
  return token.value;
}

class SheetError extends Error {}

async function google(r: SheetRow, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await http(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await accessToken(r)}` } });
  if (res.ok) return res;
  if (res.status === 404) throw new SheetError('הגליון לא נמצא - אולי הקישור השתנה, או שלחשבון המחובר אין גישה אליו');
  if (res.status === 403) throw new SheetError('לחשבון המחובר אין הרשאה לערוך את הגליון');
  if (res.status === 401) throw new SheetError('החיבור ל-Google פג - צריך לחבר מחדש');
  throw new SheetError(`Google לא אפשר לכתוב כרגע (${res.status}) - אפשר לנסות שוב`);
}

interface FileMeta {
  id: string;
  name: string;
  mimeType: string;
  capabilities?: { canEdit?: boolean };
}

const meta = async (r: SheetRow): Promise<FileMeta> =>
  (await (await google(r, `https://www.googleapis.com/drive/v3/files/${r.file_id}?fields=id,name,mimeType,capabilities(canEdit)&supportsAllDrives=true`)).json()) as FileMeta;

/** the sheet as the connected account sees it: its name kept; what is wrong (not there, not editable) said */
async function checkSheet(): Promise<void> {
  const r = row();
  if (!r?.refresh_token || !r.file_id) return;
  try {
    const m = await meta(r);
    const problem = m.capabilities?.canEdit === false ? `לחשבון ${r.email || 'המחובר'} אין הרשאת עריכה לגליון - בקשו מבעלי הגליון לשתף אותו לעריכה` : m.mimeType !== XLSX && m.mimeType !== GSHEET ? 'הקובץ בקישור אינו גליון (Excel או Google Sheets)' : '';
    db().run('UPDATE grade_sheet SET file_name = ?, last_error = ? WHERE id = 1', m.name.slice(0, 200), problem);
  } catch (e) {
    db().run('UPDATE grade_sheet SET last_error = ? WHERE id = 1', (e as Error).message);
  }
}

const quoted = (title: string) => `'${title.replace(/'/g, "''")}'`;

/**
 * A grade into the sheet: the cadet's row (by personal number, or by name), the column by its header.
 * Resolves to where it was written, or throws what went wrong in words the staff can act on.
 */
async function write(r: SheetRow, who: Who, column: string, value: number): Promise<string> {
  const m = await meta(r);
  if (m.capabilities?.canEdit === false) throw new SheetError(`לחשבון ${r.email || 'המחובר'} אין הרשאת עריכה לגליון`);
  if (m.mimeType === GSHEET) {
    const sheets = (await (await google(r, `https://sheets.googleapis.com/v4/spreadsheets/${m.id}?fields=sheets.properties.title`)).json()) as { sheets?: { properties: { title: string } }[] };
    let firstError = '';
    for (const s of sheets.sheets ?? []) {
      const title = s.properties.title;
      const values = (await (await google(r, `https://sheets.googleapis.com/v4/spreadsheets/${m.id}/values/${encodeURIComponent(`${quoted(title)}!A1:AZ3000`)}`)).json()) as { values?: string[][] };
      const grid: GridRow[] = (values.values ?? []).map((cells, i) => ({ row: i + 1, cells: cells.map((c) => String(c ?? '')) }));
      const at = locate(grid, who, column);
      if ('error' in at) {
        firstError ||= at.error;
        if (!at.error.startsWith('לא נמצאה בגליון עמודה')) throw new SheetError(at.error);
        continue;
      }
      const cell = `${colName(at.col)}${at.row}`;
      await google(r, `https://sheets.googleapis.com/v4/spreadsheets/${m.id}/values/${encodeURIComponent(`${quoted(title)}!${cell}`)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: [[value]] }),
      });
      return `${title} ${cell}`;
    }
    throw new SheetError(firstError || 'הגליון ריק');
  }
  if (m.mimeType !== XLSX) throw new SheetError('הקובץ בקישור אינו גליון (Excel או Google Sheets)');
  const file = Buffer.from(await (await google(r, `https://www.googleapis.com/drive/v3/files/${m.id}?alt=media&supportsAllDrives=true`)).arrayBuffer());
  const done = writeGradeXlsx(file, who, column, value);
  if ('error' in done) throw new SheetError(done.error);
  await google(r, `https://www.googleapis.com/upload/drive/v3/files/${m.id}?uploadType=media&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'content-type': XLSX },
    body: new Uint8Array(done.file),
  });
  return `${done.sheet} ${done.cell}`;
}

/**
 * The cadet's grade into the course's grade sheet, when there is one connected: 'off' without it (or in a
 * course beside the current one); otherwise written, or what went wrong.
 */
export async function writeGradeToSheet(cadetId: number, column: string, value: number): Promise<{ state: 'written' | 'error' | 'off'; note: string }> {
  if (currentSlot()) return { state: 'off', note: '' };
  const r = row();
  if (!r?.refresh_token || !r.file_id) return { state: 'off', note: '' };
  const c = db().get<{ personal_number: string; first_name: string; last_name: string }>('SELECT personal_number, first_name, last_name FROM cadets WHERE id = ?', cadetId);
  if (!c) return { state: 'error', note: 'הצוער לא נמצא' };
  try {
    const where = await write(r, { pn: c.personal_number, first: c.first_name, last: c.last_name }, column, value);
    if (r.last_error) db().run("UPDATE grade_sheet SET last_error = '' WHERE id = 1");
    return { state: 'written', note: where };
  } catch (e) {
    const note = e instanceof SheetError ? e.message : 'לא הצלחנו להגיע ל-Google - אפשר לנסות שוב';
    if (!(e instanceof SheetError)) console.error('[grade sheet] write failed', e);
    return { state: 'error', note };
  }
}

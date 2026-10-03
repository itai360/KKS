// Two-step sign-in: after the password, a 6-digit code from an authenticator app (Google
// Authenticator, Microsoft Authenticator...) - the standard time-based code (TOTP, RFC 6238),
// new every 30 seconds. Each code works once. Ten one-time backup codes cover a lost phone,
// and the commander can turn it off for someone who lost theirs.
//
// Signing in with a password then gives a short-lived ticket (5 minutes, 5 tries), not a
// session; the session comes only with the code.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createSession, getUserRow, loginFailed, loginSucceeded, loginThrottle, NAME_LIMIT, verifyPassword, type UserRow } from './auth';
import { badRequest, clock, getSettings, HttpError, nowIso } from './core';
import { db } from './db';
import { notify } from './journal';

const STEP_S = 30;
const DIGITS = 6;
const TICKET_MS = 5 * 60_000;
const TICKET_TRIES = 5;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** the code of a 30-second step (RFC 6238, HMAC-SHA1) */
export function totp(secret: Buffer, step: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  msg.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** digits;
  return String(n).padStart(digits, '0');
}

const stepNow = () => Math.floor(clock.now().getTime() / 1000 / STEP_S);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** the step a code belongs to (this one, or the one before or after for a clock a little off), or null */
export function matchStep(secretB32: string, code: string, after = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = stepNow();
  for (const step of [now, now - 1, now + 1]) if (step > after && same(totp(secret, step), code)) return step;
  return null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const normCode = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------- setting it up ----------------

interface TwoFactorRow {
  totp_secret: string | null;
  totp_pending: string | null;
  totp_last_step: number;
}
const row = (userId: number) => db().get<TwoFactorRow>('SELECT totp_secret, totp_pending, totp_last_step FROM users WHERE id = ?', userId)!;

export const isEnabled = (userId: number) => !!row(userId).totp_secret;

function requirePassword(user: UserRow, password: unknown): void {
  const key = `password|${user.id}`;
  loginThrottle(key);
  if (typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
    loginFailed(key);
    throw badRequest('הסיסמה שגויה');
  }
  loginSucceeded(key);
}

/** step 1: a new secret for the app (kept aside until a first code proves it was added) */
export function startSetup(user: UserRow, raw: unknown): { secret: string; uri: string } {
  const { password } = z.object({ password: z.string().max(500) }).parse(raw);
  requirePassword(user, password);
  if (isEnabled(user.id)) throw badRequest('אימות דו-שלבי כבר מופעל');
  const secret = base32Encode(randomBytes(20));
  db().run('UPDATE users SET totp_pending = ? WHERE id = ?', secret, user.id);
  const issuer = getSettings().courseSymbol || 'KKS';
  const label = encodeURIComponent(`${issuer}:${user.username}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}` };
}

/** step 2: the first code from the app turns it on; the backup codes are shown this once */
export function enable(user: UserRow, raw: unknown, keepToken: string | undefined): { recoveryCodes: string[]; others: number } {
  const { code } = z.object({ code: z.string().trim().max(20) }).parse(raw);
  const r = row(user.id);
  if (r.totp_secret) throw badRequest('אימות דו-שלבי כבר מופעל');
  if (!r.totp_pending) throw badRequest('התחילו מחדש את ההפעלה');
  const step = matchStep(r.totp_pending, code.replace(/\s/g, ''));
  if (step === null) throw badRequest('הקוד שגוי. בדקו שהשעה בטלפון מדויקת ונסו את הקוד הבא.');
  const codes = db().tx(() => {
    db().run('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE id = ?', step, user.id);
    return newRecoveryCodes(user.id);
  });
  // whoever is signed in elsewhere with just the password is signed out
  const others = db().run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, keepToken ? sha256(keepToken) : '').changes;
  return { recoveryCodes: codes, others };
}

/** turning it off: the password and a current code (or a backup code) */
export function disable(user: UserRow, raw: unknown): void {
  const { password, code } = z.object({ password: z.string().max(500), code: z.string().trim().max(40) }).parse(raw);
  requirePassword(user, password);
  if (!isEnabled(user.id)) throw badRequest('אימות דו-שלבי לא מופעל');
  if (!checkSecondFactor(user.id, code)) throw badRequest('הקוד שגוי');
  turnOff(user.id);
}

/** new backup codes (the old ones stop working) */
export function regenerateRecovery(user: UserRow, raw: unknown): { recoveryCodes: string[] } {
  const { password, code } = z.object({ password: z.string().max(500), code: z.string().trim().max(40) }).parse(raw);
  requirePassword(user, password);
  if (!isEnabled(user.id)) throw badRequest('אימות דו-שלבי לא מופעל');
  if (!checkSecondFactor(user.id, code)) throw badRequest('הקוד שגוי');
  return { recoveryCodes: newRecoveryCodes(user.id) };
}

/** off - by the person, or by the commander for someone who lost their phone */
export function turnOff(userId: number): void {
  db().run('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last_step = 0 WHERE id = ?', userId);
  db().run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
}

export const recoveryLeft = (userId: number) => db().get<{ n: number }>('SELECT count(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', userId)!.n;

function newRecoveryCodes(userId: number): string[] {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789'; // nothing that looks like another character
  const codes = Array.from({ length: 10 }, () => {
    const b = randomBytes(10);
    const s = [...b].map((x) => letters[x % letters.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  db().run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  for (const c of codes) db().run('INSERT INTO recovery_codes(user_id, code_hash) VALUES (?, ?)', userId, sha256(normCode(c)));
  return codes;
}

/** a current code from the app (each works once) or an unused backup code */
function checkSecondFactor(userId: number, raw: string): boolean {
  const r = row(userId);
  if (!r.totp_secret) return false;
  const code = raw.replace(/\s/g, '');
  const step = matchStep(r.totp_secret, code, r.totp_last_step);
  if (step !== null) {
    db().run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, userId);
    return true;
  }
  const backup = normCode(raw);
  if (backup.length !== 10) return false;
  return db().run('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', nowIso(), userId, sha256(backup)).changes === 1;
}

// ---------------- signing in ----------------

/** the password was right and the account has two-step sign-in: a ticket for the code step */
export function issueTicket(userId: number): string {
  const ticket = randomBytes(32).toString('base64url');
  db().run('DELETE FROM login_challenges WHERE expires_at < ?', nowIso());
  db().run('INSERT INTO login_challenges(token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(ticket), userId, new Date(clock.now().getTime() + TICKET_MS).toISOString());
  return ticket;
}

/** the code step: a session for a right code, within the ticket's time and tries */
export function completeSignIn(raw: unknown): { user: UserRow; token: string } {
  const { ticket, code } = z.object({ ticket: z.string().min(20).max(200), code: z.string().trim().min(1).max(40) }).parse(raw);
  const c = db().get<{ user_id: number; expires_at: string; attempts: number }>('SELECT user_id, expires_at, attempts FROM login_challenges WHERE token_hash = ?', sha256(ticket));
  if (!c || c.expires_at < nowIso() || c.attempts >= TICKET_TRIES) {
    if (c) db().run('DELETE FROM login_challenges WHERE token_hash = ?', sha256(ticket));
    throw new HttpError(401, 'פג תוקף הכניסה. התחברו שוב עם הסיסמה.');
  }
  const user = getUserRow(c.user_id);
  if (!user || !user.active) throw new HttpError(401, 'פג תוקף הכניסה. התחברו שוב עם הסיסמה.');
  // whoever has the password can ask for new tickets: the misses are counted for the person too
  const key = `2fa|${user.id}`;
  loginThrottle(key, NAME_LIMIT);
  if (!checkSecondFactor(user.id, code)) {
    db().run('UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?', sha256(ticket));
    loginFailed(key, NAME_LIMIT);
    // wrong codes after a right password: someone else may know it
    if (c.attempts + 1 === 3) {
      notify([user.id], {
        type: 'security',
        category: 'exception',
        title: 'ניסיון כניסה לחשבון שלך נכשל בשלב הקוד',
        body: 'מישהו הזין את הסיסמה הנכונה שלך אבל לא את הקוד מהאפליקציה. אם זה לא היית אתה - החליפו את הסיסמה עכשיו.',
        link: '/settings#security',
      });
    }
    throw new HttpError(401, c.attempts + 1 >= TICKET_TRIES ? 'יותר מדי ניסיונות. התחברו שוב עם הסיסמה.' : 'הקוד שגוי. נסו את הקוד שמופיע עכשיו באפליקציה.');
  }
  loginSucceeded(key);
  db().run('DELETE FROM login_challenges WHERE token_hash = ?', sha256(ticket));
  return { user, token: createSession(user.id) };
}

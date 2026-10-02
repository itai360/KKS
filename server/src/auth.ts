import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../shared/constants';
import type { User } from '../../shared/types';
import { clock, config, forbidden, HttpError, nowIso } from './core';
import { db } from './db';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  title: string;
  role: Role;
  phone: string;
  email: string | null;
  active: number;
  created_at: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

export const COOKIE = 'kks_session';

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    title: r.title,
    role: r.role,
    active: !!r.active,
    phone: r.phone,
    email: r.email ?? '',
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(clock.now().getTime() + config.sessionDays * 86_400_000).toISOString();
  db().run('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), userId, nowIso(), expires);
  return token;
}

export function destroySession(token: string): void {
  db().run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function userForToken(token: string | undefined): UserRow | undefined {
  if (!token) return undefined;
  return db().get<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    sha256(token),
    nowIso(),
  );
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[COOKIE];
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 86_400_000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attaches req.user for any valid session. */
export function loadUser(req: Request, _res: Response, next: NextFunction): void {
  req.user = userForToken(sessionToken(req));
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, 'נדרשת התחברות'));
  next();
}

export function requireCommander(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, 'נדרשת התחברות'));
  if (req.user.role !== 'commander') return next(forbidden('פעולה זו שמורה למפקד הקורס'));
  next();
}

/**
 * CSRF guard: state-changing requests must carry a custom header, which a
 * cross-site form or image cannot set. Combined with SameSite=Lax cookies.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-kks'] !== '1') return next(forbidden('בקשה לא תקינה'));
  next();
}

// Brute-force protection for the login endpoint: failed attempts are counted
// in memory; the fifth within a minute locks the name for a minute, and the
// lock is kept in the database so every instance of a serverless deployment
// honours it (one write per lock, not per attempt).
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;
const failures = new Map<string, { count: number; until: number }>();
export function loginThrottle(key: string): void {
  const f = failures.get(key);
  const locked = (f && f.count >= MAX_FAILURES && f.until > Date.now()) || (db().get<{ until: number }>('SELECT until FROM login_lockouts WHERE key = ?', key)?.until ?? 0) > Date.now();
  if (locked) throw new HttpError(429, 'יותר מדי ניסיונות כניסה. נסה שוב בעוד דקה.');
}
export function loginFailed(key: string): void {
  const f = failures.get(key);
  const count = f && f.until > Date.now() ? f.count + 1 : 1;
  failures.set(key, { count, until: Date.now() + LOCK_MS });
  if (count === MAX_FAILURES) {
    db().run('DELETE FROM login_lockouts WHERE until < ?', Date.now());
    db().run('INSERT INTO login_lockouts(key, until) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET until = excluded.until', key, Date.now() + LOCK_MS);
  }
}
export function loginSucceeded(key: string): void {
  failures.delete(key);
  db().run('DELETE FROM login_lockouts WHERE key = ?', key); // writes only when there was a lock
}
/** forgets the attempts counted by this instance (tests) */
export function resetLoginThrottle(): void {
  failures.clear();
}

export function getUserRow(id: number): UserRow | undefined {
  return db().get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function activeUsers(): UserRow[] {
  return db().all<UserRow>('SELECT * FROM users WHERE active = 1 ORDER BY role, display_name');
}

export function commanderIds(): number[] {
  return db()
    .all<{ id: number }>("SELECT id FROM users WHERE role = 'commander' AND active = 1")
    .map((r) => r.id);
}

export function staffIds(): number[] {
  return db()
    .all<{ id: number }>("SELECT id FROM users WHERE role = 'staff' AND active = 1 ORDER BY display_name")
    .map((r) => r.id);
}

export function createUser(input: {
  username: string;
  password: string;
  displayName: string;
  title?: string;
  role: Role;
  phone?: string;
  email?: string;
}): number {
  return db().run(
    'INSERT INTO users(username, password_hash, display_name, title, role, phone, email, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
    input.username.trim(),
    hashPassword(input.password),
    input.displayName.trim(),
    input.title?.trim() ?? '',
    input.role,
    input.phone?.trim() ?? '',
    input.email?.trim().toLowerCase() || null,
    nowIso(),
  ).id;
}

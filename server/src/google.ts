// Section 3 - "later, allow signing in with Google or an organisational account".
// Enabled by setting GOOGLE_CLIENT_ID. The browser gets an ID token from Google;
// we verify its signature against Google's published keys and match the e-mail
// to an existing, active user (nobody gets in without the commander adding them).

import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { HttpError } from './core';

interface Jwk extends JsonWebKey {
  kid: string;
}

type JwksFetcher = () => Promise<{ keys: Jwk[] }>;

let fetcher: JwksFetcher = async () => {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  return (await res.json()) as { keys: Jwk[] };
};
let cache: { keys: Jwk[]; until: number } | null = null;

export function setJwksFetcher(fn: JwksFetcher): void {
  fetcher = fn;
  cache = null;
}

export const googleClientId = (): string => process.env.GOOGLE_CLIENT_ID ?? '';

async function keys(): Promise<Jwk[]> {
  if (cache && cache.until > Date.now()) return cache.keys;
  const { keys } = await fetcher();
  cache = { keys, until: Date.now() + 3600_000 };
  return keys;
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface GoogleIdentity {
  email: string;
  name: string;
  sub: string;
}

export async function verifyGoogleIdToken(token: string, now = Date.now()): Promise<GoogleIdentity> {
  const clientId = googleClientId();
  if (!clientId) throw new HttpError(404, 'כניסה עם Google אינה מופעלת');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'אסימון Google לא תקין');
  let header: { alg?: string; kid?: string };
  let payload: { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean | string; name?: string; sub?: string; hd?: string };
  try {
    header = JSON.parse(b64(parts[0]).toString('utf8'));
    payload = JSON.parse(b64(parts[1]).toString('utf8'));
  } catch {
    throw new HttpError(401, 'אסימון Google לא תקין');
  }
  if (header.alg !== 'RS256') throw new HttpError(401, 'אסימון Google לא תקין');
  let jwk = (await keys()).find((k) => k.kid === header.kid);
  if (!jwk) {
    cache = null; // Google rotated its keys
    jwk = (await keys()).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, 'אסימון Google לא תקין');
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), b64(parts[2]));
  if (!ok) throw new HttpError(401, 'אסימון Google לא תקין');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new HttpError(401, 'אסימון Google לא תקין');
  if (payload.aud !== clientId) throw new HttpError(401, 'אסימון Google לא תקין');
  if (!payload.exp || payload.exp * 1000 < now - 60_000) throw new HttpError(401, 'פג תוקף הכניסה עם Google, נסה שוב');
  if (!payload.email || !(payload.email_verified === true || payload.email_verified === 'true')) throw new HttpError(401, 'כתובת המייל בחשבון Google לא מאומתת');
  const domain = process.env.GOOGLE_HOSTED_DOMAIN;
  if (domain && payload.hd !== domain) throw new HttpError(403, `ניתן להיכנס רק עם חשבון ${domain}`);
  return { email: payload.email.toLowerCase(), name: payload.name ?? '', sub: payload.sub ?? '' };
}

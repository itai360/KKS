// Guards for what comes from outside: addresses the server is asked to fetch (an external
// calendar), push-service addresses a browser registers, and new passwords.
//
// An address someone else supplies must not let them reach the server's own network (SSRF):
// it must be https, its name must resolve only to public addresses, and every redirect is
// checked the same way before it is followed.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { badRequest } from './core';

const toInt = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** loopback, private, link-local, carrier, documentation, multicast and reserved ranges */
export function isPrivateAddress(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(a) === 4) {
    const n = toInt(a);
    return PRIVATE_V4.some(([net, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(toInt(net) / 2 ** (32 - bits)));
  }
  if (isIP(a) !== 6) return true; // not an address at all: refuse
  const v4 = /(?:^::ffff:|^64:ff9b::|^::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4) return isPrivateAddress(v4[1]);
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || /^2001:db8/.test(a) || /^100::/.test(a);
}

/** an https address that leads only to public servers */
export async function assertPublicUrl(raw: string, message = 'הכתובת צריכה להיות כתובת אינטרנט ציבורית'): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest('הכתובת אינה תקינה');
  }
  if (u.protocol !== 'https:' || u.username || u.password) throw badRequest(message);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw badRequest('לא ניתן להגיע לכתובת');
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw badRequest(message);
  return u;
}

/** fetch for an address someone supplied: public addresses only, redirects checked one by one */
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let url = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) return res;
    url = new URL(next, url).toString();
  }
  throw badRequest('יותר מדי הפניות בכתובת');
}

/**
 * The body of a download, stopping as soon as it passes the limit: a server that leaves out the
 * length (or gives a false one) cannot fill the memory.
 */
export async function readLimited(res: Response, maxBytes: number, tooBig: () => Error): Promise<Buffer> {
  if (Number(res.headers.get('content-length')) > maxBytes) throw tooBig();
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

// ---------------- phone notifications ----------------

/** the push services of the browsers: a registered address must be one of them */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^(.+\.)?push\.apple\.com$/, /^(.+\.)?notify\.windows\.com$/];

export function isPushEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

// ---------------- passwords ----------------

const COMMON = new Set(
  [
    '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344', 'password', 'password1', 'password123',
    'passw0rd', 'qwerty123', 'qwertyui', 'qwerty12', 'abcd1234', 'abc12345', '1q2w3e4r', '1qaz2wsx', 'iloveyou', 'welcome1', 'admin123',
    'letmein1', 'zaq12wsx', 'asdf1234', 'a1234567', 'aa123456', 'q1w2e3r4', 'shalom123', 'israel123', 'tzahal123', 'idf12345',
  ].map((p) => p.toLowerCase()),
);

/** a new password: 8 characters or more, a letter and a digit or sign, not one of the most common */
export const newPassword = z
  .string()
  .min(8, 'הסיסמה חייבת להכיל לפחות 8 תווים')
  .max(200)
  .refine((p) => /\p{L}/u.test(p) && /[^\p{L}]/u.test(p), 'הסיסמה צריכה לכלול גם אותיות וגם ספרה או סימן')
  .refine((p) => !COMMON.has(p.toLowerCase()) && !/^(.)\1+$/.test(p), 'הסיסמה נפוצה מדי - בחרו סיסמה אחרת');

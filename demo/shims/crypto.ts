// node:crypto for the browser: the hashing and random helpers the server uses.

import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';

const enc = new TextEncoder();
const bytesOf = (v: string | Uint8Array) => (typeof v === 'string' ? enc.encode(v) : v);

export function randomBytes(n: number): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

export function randomUUID(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createHash(algo: string) {
  if (algo !== 'sha256') throw new Error(`hash ${algo} is not available in the browser demo`);
  const parts: Uint8Array[] = [];
  const h = {
    update(v: string | Uint8Array) {
      parts.push(bytesOf(v));
      return h;
    },
    digest(encoding?: 'hex' | 'base64') {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) (all.set(p, o), (o += p.length));
      const out = Buffer.from(sha256(all));
      return encoding ? out.toString(encoding) : out;
    },
  };
  return h;
}

/** HMAC-SHA1 for two-step sign-in codes */
export function createHmac(algo: string, key: Uint8Array | string) {
  if (algo !== 'sha1') throw new Error(`hmac ${algo} is not available in the browser demo`);
  const parts: Uint8Array[] = [];
  const h = {
    update(v: string | Uint8Array) {
      parts.push(bytesOf(v));
      return h;
    },
    digest() {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) (all.set(p, o), (o += p.length));
      return Buffer.from(hmac(sha1, bytesOf(key), all));
    },
  };
  return h;
}

// The demo keeps its data in this browser only, so a light work factor keeps
// sign-in instant while still never storing plain passwords.
export function scryptSync(password: string | Uint8Array, salt: string | Uint8Array, keylen: number): Buffer {
  return Buffer.from(scrypt(bytesOf(password), bytesOf(salt), { N: 1024, r: 8, p: 1, dkLen: keylen }));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function createPublicKey(): never {
  throw new Error('Google sign-in is not available in the browser demo');
}
export function verify(): never {
  throw new Error('Google sign-in is not available in the browser demo');
}
export type JsonWebKey = Record<string, unknown>;

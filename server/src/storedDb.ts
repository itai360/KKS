// How a copy of the database is written as text for storage (the shared copy
// of the serverless deployment and its snapshots): base64 of the SQLite file,
// or "gz:" and base64 of the file compressed - about nine times smaller, so
// each save and load moves far less. Reading accepts both, so copies written
// by either form of the code stay readable.

import { gunzipSync, gzipSync } from 'node:zlib';

const GZ = 'gz:';

/** On since every deployment from "step 1 of 2" reads it; one before that cannot (README, rolling back). */
export const WRITE_COMPRESSED = true;

export function encodeDb(file: Buffer): string {
  return WRITE_COMPRESSED ? GZ + gzipSync(file, { level: 6 }).toString('base64') : file.toString('base64');
}

export function decodeDb(text: string): Buffer {
  return text.startsWith(GZ) ? gunzipSync(Buffer.from(text.slice(GZ.length), 'base64')) : Buffer.from(text, 'base64');
}

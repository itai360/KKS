import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeDb, encodeDb } from '../src/storedDb';

describe('stored database copies', () => {
  const file = Buffer.concat([Buffer.from('SQLite format 3\0'), randomBytes(64), Buffer.alloc(4096)]);

  it('reads the plain form written before compression', () => {
    expect(decodeDb(file.toString('base64')).equals(file)).toBe(true);
  });

  it('reads the compressed form', () => {
    expect(decodeDb('gz:' + gzipSync(file).toString('base64')).equals(file)).toBe(true);
  });

  it('reads back what it writes', () => {
    expect(decodeDb(encodeDb(file)).equals(file)).toBe(true);
  });
});

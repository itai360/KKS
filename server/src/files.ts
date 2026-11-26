// Uploaded files (task and event attachments, the documents library).
// On a server they live in DATA_DIR/uploads; the cloud deployment swaps in a
// store kept next to the database (see cloud.ts).

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { config } from './core';

export interface FileStore {
  put(name: string, data: Buffer): Promise<void>;
  get(name: string): Promise<Buffer | null>;
  remove(name: string): Promise<void>;
}

export const uploadsDir = (): string => {
  const dir = join(config.dataDir, 'uploads');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};

const localStore: FileStore = {
  async put(name, data) {
    writeFileSync(join(uploadsDir(), name), data);
  },
  async get(name) {
    const path = join(uploadsDir(), name);
    return existsSync(path) ? readFileSync(path) : null;
  },
  async remove(name) {
    try {
      unlinkSync(join(uploadsDir(), name));
    } catch {
      /* already gone */
    }
  },
};

let store: FileStore = localStore;

export function setFileStore(s: FileStore): void {
  store = s;
}

export const putFile = (name: string, data: Buffer) => store.put(name, data);
export const getFile = (name: string) => store.get(name);
/** Never fails the request: a file that cannot be removed is only wasted space. */
export const removeFile = (name: string) => store.remove(name).catch(() => undefined);

/** The uploaded file's name from the x-filename header, made safe. */
export function uploadName(header: unknown): string {
  try {
    return decodeURIComponent(String(header ?? 'file')).replace(/[\\/\0]/g, '_').slice(0, 200) || 'file';
  } catch {
    return 'file';
  }
}

/** Images and PDFs open in the browser; anything else downloads. */
export function sendStoredFile(res: Response, data: Buffer, mime: string | null, fileName: string | null): void {
  const type = mime ?? 'application/octet-stream';
  const inline = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/i.test(type);
  res.setHeader('Content-Type', inline ? type : 'application/octet-stream');
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName ?? 'file')}`);
  res.end(data);
}

import { crc32 } from 'node:zlib';
import request from 'supertest';
import type { Express } from 'express';
import { zonedIso } from '../../shared/dates';
import { createApp } from '../src/app';
import { createUser, resetLoginThrottle } from '../src/auth';
import { clock, resetSettingsCache } from '../src/core';
import { db, openDb } from '../src/db';

export const TZ = 'Asia/Jerusalem';
/** Thursday 1.10.2026 10:00 Israel time */
export const NOW = new Date(zonedIso('2026-10-01', '10:00', TZ));
export const at = (date: string, time = '18:00') => zonedIso(date, time, TZ);

export interface Ctx {
  app: Express;
  ids: { cmd: number; s1: number; s2: number; s3: number };
  cmd: Agent;
  s1: Agent;
  s2: Agent;
  s3: Agent;
}

export type Agent = {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
};

export async function login(app: Express, username: string, password = 'secret123'): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('x-kks', '1').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    get: (url) => agent.get(url),
    post: (url, body) => (body === undefined ? agent.post(url).set('x-kks', '1') : agent.post(url).set('x-kks', '1').send(body)),
    patch: (url, body = {}) => agent.patch(url).set('x-kks', '1').send(body),
    put: (url, body = {}) => agent.put(url).set('x-kks', '1').send(body),
    del: (url) => agent.delete(url).set('x-kks', '1'),
  };
}

export async function setup(): Promise<Ctx> {
  openDb(':memory:');
  resetSettingsCache();
  resetLoginThrottle();
  clock.set(NOW);
  const cmd = createUser({ username: 'cmd', password: 'secret123', displayName: 'מפקד הקורס', title: 'מפקד הקורס', role: 'commander' });
  const s1 = createUser({ username: 's1', password: 'secret123', displayName: 'מפק"צ 1', role: 'staff' });
  const s2 = createUser({ username: 's2', password: 'secret123', displayName: 'מפק"צ 2', role: 'staff' });
  const s3 = createUser({ username: 's3', password: 'secret123', displayName: 'מפק"צ 3', role: 'staff' });
  const app = createApp();
  return {
    app,
    ids: { cmd, s1, s2, s3 },
    cmd: await login(app, 'cmd'),
    s1: await login(app, 's1'),
    s2: await login(app, 's2'),
    s3: await login(app, 's3'),
  };
}

export async function newTask(agent: Agent, body: Record<string, unknown>): Promise<number> {
  const res = await agent.post('/api/tasks', { deadline: at('2026-10-05'), ...body });
  if (res.status !== 200) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.ids[0];
}

export function notificationsOf(userId: number): { title: string; type: string; category: string }[] {
  return db().all('SELECT title, type, category FROM notifications WHERE user_id = ? ORDER BY id', userId);
}

/** A zip archive of stored (uncompressed) entries - enough for test .xlsx and .docx files. */
export function zip(files: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

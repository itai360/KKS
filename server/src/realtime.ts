// Section 14/51 - real-time updates over Server-Sent Events. Clients receive a
// lightweight "something changed" signal and refetch through the normal,
// permission-checked endpoints, so no data leaks through the stream.

import type { Request, Response } from 'express';
import type { Notification } from '../../shared/types';

export type Topic = 'tasks' | 'weeks' | 'events' | 'templates' | 'recurring' | 'users' | 'settings' | 'meetings' | 'requests';

const clients = new Map<number, Set<Response>>();
let pending = new Set<Topic>();
let flushTimer: NodeJS.Timeout | null = null;

function write(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function streamHandler(req: Request, res: Response): void {
  const userId = req.user!.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  write(res, { type: 'hello' });
  let set = clients.get(userId);
  if (!set) clients.set(userId, (set = new Set()));
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    set!.delete(res);
    if (set!.size === 0) clients.delete(userId);
  });
}

/** Debounced broadcast so a burst of writes produces a single refetch. */
export function broadcast(...topics: Topic[]): void {
  for (const t of topics) pending.add(t);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const list = [...pending];
    pending = new Set();
    for (const set of clients.values()) for (const res of set) write(res, { type: 'change', topics: list });
  }, 150);
  flushTimer.unref?.();
}

export function pushNotification(userId: number, notification: Notification): void {
  const set = clients.get(userId);
  if (!set) return;
  for (const res of set) write(res, { type: 'notification', notification });
}

export function connectedUserIds(): number[] {
  return [...clients.keys()];
}

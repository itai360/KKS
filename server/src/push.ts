// Web Push: notifications reach the phone even when the app is closed.
// VAPID keys are generated on first use and kept in the database, so a deployment
// needs no extra configuration. Only "action" and "exception" notifications are
// pushed - information stays inside the app (section 74, not too many alerts).

import webpush from 'web-push';
import type { Notification } from '../../shared/types';
import { nowIso } from './core';
import { db } from './db';
import { isPushEndpoint } from './netguard';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function vapidKeys(): VapidKeys {
  const row = db().get<{ value: string }>("SELECT value FROM meta WHERE key = 'vapid_keys'");
  if (row) return JSON.parse(row.value) as VapidKeys;
  const keys = webpush.generateVAPIDKeys();
  db().run("INSERT INTO meta(key, value) VALUES ('vapid_keys', ?) ON CONFLICT(key) DO NOTHING", JSON.stringify(keys));
  return JSON.parse(db().get<{ value: string }>("SELECT value FROM meta WHERE key = 'vapid_keys'")!.value) as VapidKeys;
}

export function vapidPublicKey(): string {
  return vapidKeys().publicKey;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

type Sender = (target: PushTarget, payload: string, options: webpush.RequestOptions) => Promise<{ statusCode: number }>;

let sender: Sender = (target, payload, options) => webpush.sendNotification(target, payload, options);

/** Tests replace the network call. */
export function setPushSender(fn: Sender): void {
  sender = fn;
}

export function subscribe(userId: number, target: PushTarget, userAgent = ''): void {
  db().run(
    `INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`,
    userId,
    target.endpoint,
    target.keys.p256dh,
    target.keys.auth,
    userAgent.slice(0, 300),
    nowIso(),
  );
}

export function unsubscribe(userId: number, endpoint: string): void {
  db().run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', userId, endpoint);
}

export function subscriptionCount(userId: number): number {
  return db().get<{ n: number }>('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?', userId)!.n;
}

const inFlight = new Set<Promise<number>>();

/** Settles when the pushes sent so far are done (a serverless function must not stop before). */
export function pushesSettled(): Promise<unknown> {
  return Promise.allSettled([...inFlight]);
}

export function sendPush(userId: number, n: Pick<Notification, 'id' | 'title' | 'body' | 'link' | 'category'>, force = false): Promise<number> {
  const p = deliver(userId, n, force);
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p)).catch(() => undefined);
  return p;
}

async function deliver(userId: number, n: Pick<Notification, 'id' | 'title' | 'body' | 'link' | 'category'>, force: boolean): Promise<number> {
  if (!force && n.category === 'info') return 0;
  // only to a browser's push service - never to an address of someone's choosing
  const subs = db()
    .all<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', userId)
    .filter((s) => isPushEndpoint(s.endpoint));
  if (!subs.length) return 0;
  const keys = vapidKeys();
  const payload = JSON.stringify({ title: n.title, body: n.body, link: n.link, tag: `kks-${n.id}`, category: n.category });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: process.env.PUSH_CONTACT || 'mailto:admin@example.com', publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 24 * 3600,
          urgency: n.category === 'exception' ? 'high' : 'normal',
        });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // the browser unsubscribed or the subscription expired
        if (status === 404 || status === 410) db().run('DELETE FROM push_subscriptions WHERE endpoint = ?', s.endpoint);
        else console.error('[push] send failed', status ?? e);
      }
    }),
  );
  return sent;
}

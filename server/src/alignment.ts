// "יישור קו": the messages of the staff's WhatsApp group in one place, with search. WhatsApp offers
// no way for another system to read an ordinary group, so they come from WhatsApp's own chat
// export: shared from WhatsApp straight to the installed app (Android), uploaded as a file
// (.txt, or the .zip an iPhone makes) or pasted. Every update adds only what is new.

import type { Request, Response } from 'express';
import { z } from 'zod';
import { matchesSearch, searchKey } from '../../shared/search';
import type { AlignmentFeed, AlignmentImport, AlignmentMessage } from '../../shared/types';
import { userForToken, sessionToken, type UserRow } from './auth';
import { badRequest, notFound, nowIso, tz } from './core';
import { db } from './db';
import { changed } from './journal';
import { unzip } from './sheets';
import { messageFingerprint, parseWhatsAppChat } from './whatsapp';

const PAGE = 300;

interface Row {
  id: number;
  sent_at: string;
  sender: string;
  user_id: number | null;
  user_name: string | null;
  body: string;
  media: number;
  pinned: number;
}

const SELECT = 'SELECT m.id, m.sent_at, m.sender, m.user_id, u.display_name AS user_name, m.body, m.media, m.pinned FROM alignment_messages m LEFT JOIN users u ON u.id = m.user_id';

const toMessage = (r: Row): AlignmentMessage => ({
  id: r.id,
  sentAt: r.sent_at,
  sender: r.sender,
  userId: r.user_id,
  userName: r.user_name,
  body: r.body,
  media: !!r.media,
  pinned: !!r.pinned,
});

/** the newest messages (or those matching the search), and older ones page by page */
export function alignmentFeed(f: { q?: string; before?: string; beforeId?: number } = {}): AlignmentFeed {
  const q = f.q?.trim() ?? '';
  let rows: Row[];
  if (q) {
    rows = db()
      .all<Row>(`${SELECT} ORDER BY m.sent_at DESC, m.id DESC`)
      .filter((r) => matchesSearch(q, r.sender, r.user_name, r.body));
  } else {
    // older than the oldest shown: by time, then by order within the same minute
    rows = f.before
      ? db().all<Row>(`${SELECT} WHERE m.sent_at < ? OR (m.sent_at = ? AND m.id < ?) ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`, f.before, f.before, f.beforeId ?? 0, PAGE + 1)
      : db().all<Row>(`${SELECT} ORDER BY m.sent_at DESC, m.id DESC LIMIT ?`, PAGE + 1);
  }
  const more = rows.length > PAGE;
  const last = db().get<{ at: string; added: number; name: string | null }>(
    'SELECT i.at, i.added, u.display_name AS name FROM alignment_imports i LEFT JOIN users u ON u.id = i.user_id ORDER BY i.at DESC, i.id DESC LIMIT 1',
  );
  return {
    messages: rows.slice(0, PAGE).map(toMessage).reverse(),
    pinned: f.before || q ? [] : db().all<Row>(`${SELECT} WHERE m.pinned = 1 ORDER BY m.sent_at DESC`).map(toMessage),
    more,
    total: db().get<{ n: number }>('SELECT count(*) AS n FROM alignment_messages')!.n,
    lastImport: last ? { at: last.at, added: last.added, byName: last.name } : null,
  };
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** who in the system a WhatsApp name or number is */
function senderMatcher(): (sender: string) => number | null {
  const users = db().all<{ id: number; display_name: string; phone: string | null }>('SELECT id, display_name, phone FROM users');
  const byName = new Map(users.map((u) => [searchKey(u.display_name), u.id]));
  const byPhone = new Map(users.filter((u) => digits(u.phone).length >= 9).map((u) => [digits(u.phone).slice(-9), u.id]));
  return (sender) => {
    const d = digits(sender);
    if (d.length >= 9 && d.length >= sender.replace(/\s/g, '').length - 3) return byPhone.get(d.slice(-9)) ?? null;
    return byName.get(searchKey(sender)) ?? null;
  };
}

/** a chat export (or pasted messages) into the page: only the new ones are added */
export function importAlignment(actor: UserRow, text: string): AlignmentImport {
  const messages = parseWhatsAppChat(text, tz());
  if (!messages.length) throw badRequest('לא נמצאו הודעות. בוואטסאפ: בקבוצה ← ⋮ ← עוד ← ייצוא צ׳אט ← ללא מדיה, ואז לשתף לכאן או להעלות את הקובץ.');
  if (messages.length > 100_000) throw badRequest('הקובץ גדול מדי');
  const who = senderMatcher();
  const now = nowIso();
  let added = 0;
  db().tx(() => {
    for (const m of messages) {
      const userId = who(m.sender);
      const fp = messageFingerprint(m, userId ? `u${userId}` : searchKey(m.sender));
      added += db().run(
        'INSERT OR IGNORE INTO alignment_messages(sent_at, sender, user_id, body, media, fingerprint, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        m.sentAt,
        m.sender.slice(0, 120),
        userId,
        m.body.slice(0, 20_000),
        m.media,
        fp,
        now,
      ).changes;
    }
    db().run('INSERT INTO alignment_imports(at, user_id, added, found) VALUES (?, ?, ?, ?)', now, actor.id, added, messages.length);
  });
  if (added) changed('alignment');
  const sorted = messages.map((m) => m.sentAt).sort();
  return { found: messages.length, added, existing: messages.length - added, from: sorted[0], to: sorted[sorted.length - 1] };
}

/** the text of an uploaded export: a .txt, or the .zip an iPhone (or "with media") makes */
export function exportText(buf: Buffer): string {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const files = unzip(buf, 'הקובץ אינו ייצוא צ׳אט תקין');
    const names = [...files.keys()].filter((n) => /\.txt$/i.test(n));
    const name = names.find((n) => /_chat\.txt$/i.test(n)) ?? names.find((n) => /whatsapp|צ.?אט/i.test(n)) ?? names[0];
    if (!name) throw badRequest('בקובץ ה-zip אין ייצוא צ׳אט (קובץ txt)');
    return files.get(name)!.toString('utf8');
  }
  return buf.toString('utf8');
}

export const pinSchema = z.object({ pinned: z.boolean() });

export function pinMessage(id: number, raw: unknown): void {
  const { pinned } = pinSchema.parse(raw);
  if (!db().run('UPDATE alignment_messages SET pinned = ? WHERE id = ?', pinned, id).changes) throw notFound('ההודעה לא נמצאה');
  changed('alignment');
}

export function deleteMessage(id: number): void {
  if (!db().run('DELETE FROM alignment_messages WHERE id = ?', id).changes) throw notFound('ההודעה לא נמצאה');
  changed('alignment');
}

// ---------------- sharing from WhatsApp (Android) ----------------

/** the parts of a multipart/form-data body */
export function multipartParts(body: Buffer, contentType: string): { name: string; filename: string | null; data: Buffer }[] {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return [];
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const parts: { name: string; filename: string | null; data: Buffer }[] = [];
  let at = body.indexOf(boundary);
  while (at !== -1) {
    const start = at + boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(boundary, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2); // past the CRLF after the boundary, before the one ending the part
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = part.subarray(0, split).toString('utf8');
      const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? '';
      const filename = /filename\*?="?([^";\r\n]*)"?/i.exec(headers)?.[1] ?? null;
      parts.push({ name, filename, data: part.subarray(split + 4) });
    }
    at = next;
  }
  return parts;
}

/**
 * WhatsApp's "share" sends the export here as a form (the app's share target, see the manifest).
 * The phone opens it like a link, so the sign-in cookie comes along; a form sent from another
 * site does not carry it (SameSite=Lax), so nothing can be slipped in from outside.
 */
export function shareTarget(req: Request, res: Response): void {
  const back = (q: string) => res.redirect(303, `/alignment?${q}`);
  const user = req.user ?? userForToken(sessionToken(req));
  if (!user) return back('share=login');
  try {
    const parts = Buffer.isBuffer(req.body) ? multipartParts(req.body, String(req.headers['content-type'] ?? '')) : [];
    const file = parts.find((p) => p.filename && /\.(txt|zip)$/i.test(p.filename)) ?? parts.find((p) => p.filename);
    const text = file ? exportText(file.data) : parts.filter((p) => p.name === 'text').map((p) => p.data.toString('utf8')).join('\n');
    const r = importAlignment(user, text);
    back(`share=ok&added=${r.added}&found=${r.found}`);
  } catch (e) {
    back(`share=error&msg=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}

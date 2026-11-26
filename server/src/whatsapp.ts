// Reads a WhatsApp chat export ("ייצוא צ'אט") into messages. The layout depends on the phone and
// its language, so every common one is read:
//   Android:  3.10.2026, 14:05 - דנה כהן: טקסט          (also 03/10/26, and 10/3/26, 2:05 PM)
//   iPhone:   [3.10.2026, 14:05:22] דנה כהן: טקסט
//   copied from WhatsApp on a computer:  [14:05, 3.10.2026] דנה כהן: טקסט
// A message may run over several lines. Lines from WhatsApp itself (someone joined, the encryption
// notice) and deleted messages are left out; a photo or file the export left out is marked as such.

import { zonedToUtc } from '../../shared/dates';

export interface ChatMessage {
  /** to the minute (an export from another phone may lack the seconds) */
  sentAt: string;
  sender: string;
  body: string;
  /** had a photo, video or file that the export did not include */
  media: boolean;
}

const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;
const SPACES = /[   ]/g;
const D = '(\\d{1,4})[./-](\\d{1,2})[./-](\\d{2,4})';
const T = '(\\d{1,2}):(\\d{2})(?::\\d{2})?(?:\\s?([AaPp])\\.?\\s?[Mm]\\.?)?';
const IPHONE = new RegExp(`^\\[${D},?\\s+${T}\\]\\s?(.*)$`);
const DESKTOP = new RegExp(`^\\[${T},?\\s+${D}\\]\\s?(.*)$`);
const ANDROID = new RegExp(`^${D},?\\s+${T}\\s+[-–]\\s(.*)$`);

const MEDIA = [
  /^<?(המדיה לא נכללה|המדיה הושמטה|Media omitted)>?$/i,
  /^(image|video|audio|sticker|GIF|document|photo|Contact card) omitted$/i,
  /^(התמונה|הסרטון|השמע|ההקלטה|קובץ השמע|המדבקה|המסמך|ה-?GIF|איש הקשר|כרטיס איש הקשר)\s+הושמט(ה)?$/,
  /^null$/,
];
const ATTACHED = /^<(מצורף|attached):\s*[^>]*>\s*/i;
const DELETED = /^(ההודעה נמחקה|הודעה זו נמחקה|מחקת את ההודעה הזאת|מחקת הודעה זו|This message was deleted|You deleted this message)\.?$/i;
const EDITED = /\s*<(ההודעה נערכה|This message was edited)>$/i;

interface Head {
  a: number;
  b: number;
  c: number;
  h: number;
  m: number;
  ampm: string | undefined;
  rest: string;
}

function head(line: string): Head | null {
  let x = IPHONE.exec(line);
  if (x) return { a: +x[1], b: +x[2], c: +x[3], h: +x[4], m: +x[5], ampm: x[6], rest: x[7] };
  x = ANDROID.exec(line);
  if (x) return { a: +x[1], b: +x[2], c: +x[3], h: +x[4], m: +x[5], ampm: x[6], rest: x[7] };
  x = DESKTOP.exec(line);
  if (x) return { h: +x[1], m: +x[2], ampm: x[3], a: +x[4], b: +x[5], c: +x[6], rest: x[7] };
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function parseWhatsAppChat(text: string, tz: string): ChatMessage[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const clean = (l: string) => l.replace(INVISIBLE, '').replace(SPACES, ' ');
  // day before month (Israel) unless the file shows otherwise; a 4-digit first part is year-first
  const heads = lines.map((l) => head(clean(l)));
  let monthFirst = false;
  const dated = heads.filter((h): h is Head => !!h && h.a < 1000);
  if (!dated.some((h) => h.a > 12) && dated.some((h) => h.b > 12)) monthFirst = true;

  const out: ChatMessage[] = [];
  let current: ChatMessage | null = null;
  const flush = () => {
    if (!current) return;
    let body = current.body.replace(EDITED, '').trim();
    if (ATTACHED.test(body)) {
      current.media = true;
      body = body.replace(ATTACHED, '').trim();
    } else if (MEDIA.some((r) => r.test(body))) {
      current.media = true;
      body = '';
    }
    if (!DELETED.test(body) && (body || current.media)) out.push({ ...current, body });
    current = null;
  };

  lines.forEach((raw, i) => {
    const h = heads[i];
    if (!h) {
      // the next line of the message above (a line of WhatsApp's own is not continued)
      if (current) current.body += `\n${clean(raw)}`;
      return;
    }
    flush();
    const colon = h.rest.indexOf(': ');
    if (colon <= 0) return; // WhatsApp's own line: someone joined, left, changed the name
    // on an iPhone WhatsApp's own lines and left-out files start with a direction mark
    const rawBody = raw.slice(raw.indexOf(': ') + 2);
    const sender = h.rest.slice(0, colon).trim();
    const body = h.rest.slice(colon + 2);
    if (rawBody.startsWith('‎') && !MEDIA.some((r) => r.test(body.trim())) && !ATTACHED.test(body.trim())) return;
    const [y, mo, d] = h.a >= 1000 ? [h.a, h.b, h.c] : monthFirst ? [h.c, h.a, h.b] : [h.c, h.b, h.a];
    const year = y < 100 ? 2000 + y : y;
    let hour = h.h;
    if (h.ampm) hour = (hour % 12) + (/p/i.test(h.ampm) ? 12 : 0);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hour > 23 || h.m > 59) return;
    const sentAt = zonedToUtc(`${year}-${pad(mo)}-${pad(d)}`, `${pad(hour)}:${pad(h.m)}`, tz).toISOString();
    current = { sentAt, sender, body, media: false };
  });
  flush();
  return out;
}

/** a short, stable fingerprint: the same message from two exports (or two phones) is kept once */
export function messageFingerprint(m: ChatMessage, senderKey: string): string {
  const body = m.body.replace(/\s+/g, ' ').trim();
  // a very short message ("👍", "כן") may well repeat in the same minute: who sent it tells them apart
  const key = `${m.sentAt.slice(0, 16)}|${body}${body.length < 6 ? `|${senderKey}` : ''}${m.media ? '|media' : ''}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

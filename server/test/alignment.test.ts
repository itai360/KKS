// "יישור קו": WhatsApp chat exports (Android, iPhone, copied from a computer) into the page,
// each message once, with search, pins - and sharing straight from WhatsApp.

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AlignmentFeed, AlignmentImport } from '../../shared/types';
import { db } from '../src/db';
import { multipartParts } from '../src/alignment';
import { parseWhatsAppChat } from '../src/whatsapp';
import { setup, TZ, zip, type Ctx } from './helpers';

const LRM = '‎';
const RLM = '‏';

const ANDROID = [
  '3.10.2026, 08:01 - ההודעות והשיחות מוצפנות מקצה לקצה. אף אחד מחוץ לצ׳אט לא יכול לקרוא אותן.',
  '3.10.2026, 08:02 - מפקד הקורס יצר/ה את הקבוצה "יישור קו"',
  '3.10.2026, 08:05 - מפקד הקורס: בוקר טוב לכולם',
  'מחר מסדר ב-06:30',
  `3.10.2026, 08:07 - ${RLM}+972 54-123-4567: קיבלתי`,
  '3.10.2026, 08:09 - מפק"צ 2: <המדיה לא נכללה>',
  '3.10.2026, 08:10 - מפק"צ 2: ההודעה נמחקה',
  '3.10.2026, 08:11 - מפק"צ 2: עדכון ללו"ז של מחר <ההודעה נערכה>',
].join('\n');

const IPHONE = [
  `[3.10.2026, 08:05:13] מפקד הקורס: בוקר טוב לכולם`,
  'מחר מסדר ב-06:30',
  `[3.10.2026, 09:00:00] יישור קו: ${LRM}ההודעות והשיחות מוצפנות מקצה לקצה.`,
  `${LRM}[3.10.2026, 09:01:44] דנה: ${LRM}image omitted`,
  `[3.10.2026, 09:02:00] דנה: שאלה על הלו"ז`,
].join('\r\n');

describe('reading a WhatsApp chat export', () => {
  it('reads Android lines, joins a message over several lines, and leaves out WhatsApp\'s own and deleted ones', () => {
    const m = parseWhatsAppChat(ANDROID, TZ);
    expect(m.map((x) => [x.sender, x.body, x.media])).toEqual([
      ['מפקד הקורס', 'בוקר טוב לכולם\nמחר מסדר ב-06:30', false],
      ['+972 54-123-4567', 'קיבלתי', false],
      ['מפק"צ 2', '', true],
      ['מפק"צ 2', 'עדכון ללו"ז של מחר', false],
    ]);
    expect(m[0].sentAt).toBe('2026-10-03T05:05:00.000Z'); // 08:05 in Israel
  });

  it('reads iPhone exports, copied messages and the other date orders', () => {
    const m = parseWhatsAppChat(IPHONE, TZ);
    expect(m.map((x) => [x.sender, x.body, x.media])).toEqual([
      ['מפקד הקורס', 'בוקר טוב לכולם\nמחר מסדר ב-06:30', false],
      ['דנה', '', true],
      ['דנה', 'שאלה על הלו"ז', false],
    ]);
    expect(m[0].sentAt).toBe('2026-10-03T05:05:00.000Z'); // to the minute, as on Android
    expect(parseWhatsAppChat('[10:15, 4.10.2026] מפקד הקורס: תזכורת - דוח בוקר', TZ)[0]).toMatchObject({ sentAt: '2026-10-04T07:15:00.000Z', body: 'תזכורת - דוח בוקר' });
    // month first (an English phone), 12-hour clock
    const us = parseWhatsAppChat('10/13/26, 9:00 AM - Dana: hello\n10/4/26, 2:05 PM - Dana: later', TZ);
    expect(us.map((x) => x.sentAt)).toEqual(['2026-10-13T06:00:00.000Z', '2026-10-04T11:05:00.000Z']);
    expect(parseWhatsAppChat('just some text\nwith no messages', TZ)).toEqual([]);
  });
});

describe('the יישור קו page', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
    db().run("UPDATE users SET phone = '054-1234567' WHERE id = ?", c.ids.s1);
  });
  const feed = async (q = '') => (await c.s2.get(`/api/alignment${q}`)).body as AlignmentFeed;

  it('anyone on the staff updates it; each message is added once, from any phone', async () => {
    const first = (await c.s1.post('/api/alignment/import', { text: ANDROID })).body as AlignmentImport;
    expect(first).toMatchObject({ found: 4, added: 4, existing: 0 });
    // the same messages exported again from an iPhone: only what is new
    const again = await c.s2.post('/api/alignment/import/file').set('content-type', 'application/zip').send(zip([['_chat.txt', IPHONE]]));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ found: 3, added: 2, existing: 1 });

    const f = await feed();
    expect(f.total).toBe(6);
    expect(f.messages.map((m) => m.body)).toEqual(['בוקר טוב לכולם\nמחר מסדר ב-06:30', 'קיבלתי', '', 'עדכון ללו"ז של מחר', '', 'שאלה על הלו"ז']);
    // a phone number is matched to the staff member who has it
    expect(f.messages[1]).toMatchObject({ sender: '+972 54-123-4567', userId: c.ids.s1, userName: 'מפק"צ 1' });
    expect(f.messages[3].userName).toBe('מפק"צ 2');
    expect(f.lastImport).toMatchObject({ added: 2, byName: 'מפק"צ 2' });
    expect((await feed('?q=מסדר')).messages).toHaveLength(1);
    expect((await c.s1.post('/api/alignment/import', { text: 'סתם טקסט בלי הודעות' })).body.error).toContain('ייצוא צ׳אט');
  });

  it('the commander pins and removes messages', async () => {
    await c.s1.post('/api/alignment/import', { text: ANDROID });
    const [msg] = (await feed()).messages;
    expect((await c.s1.post(`/api/alignment/${msg.id}/pin`, { pinned: true })).status).toBe(403);
    await c.cmd.post(`/api/alignment/${msg.id}/pin`, { pinned: true });
    expect((await feed()).pinned.map((m) => m.id)).toEqual([msg.id]);
    expect((await c.s1.del(`/api/alignment/${msg.id}`)).status).toBe(403);
    await c.cmd.del(`/api/alignment/${msg.id}`);
    expect((await feed()).total).toBe(3);
  });

  it('sharing from WhatsApp lands on the page - signed in only', async () => {
    const shared = await c.s1.post('/api/share-target').attach('file', Buffer.from(ANDROID), 'WhatsApp Chat - יישור קו.txt').field('title', 'WhatsApp');
    expect(shared.status).toBe(303);
    expect(shared.headers.location).toBe('/alignment?share=ok&added=4&found=4');
    // a form from anywhere else carries no sign-in: nothing is added
    const outside = await request(c.app).post('/api/share-target').attach('file', Buffer.from(IPHONE), 'chat.txt');
    expect(outside.headers.location).toBe('/alignment?share=login');
    expect((await feed()).total).toBe(4);
    const bad = await c.s1.post('/api/share-target').attach('file', Buffer.from('not a chat'), 'x.txt');
    expect(bad.headers.location).toMatch(/^\/alignment\?share=error&msg=/);
  });

  it('reads the parts of a shared form', () => {
    const body = Buffer.from('--b1\r\nContent-Disposition: form-data; name="title"\r\n\r\nWhatsApp\r\n--b1\r\nContent-Disposition: form-data; name="file"; filename="c.txt"\r\nContent-Type: text/plain\r\n\r\nline1\r\nline2\r\n--b1--\r\n');
    expect(multipartParts(body, 'multipart/form-data; boundary=b1').map((p) => [p.name, p.filename, p.data.toString()])).toEqual([
      ['title', null, 'WhatsApp'],
      ['file', 'c.txt', 'line1\r\nline2'],
    ]);
  });
});

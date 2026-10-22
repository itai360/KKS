// Visitors' entry to the base (אישור כניסה): anyone on the staff asks for one, and the commander gets it at
// once - in the app and on the phone - with the message ready in the base's format, sends it on and marks it
// sent. Personal details: each request is seen only by its writer and the commander, and is gone a week
// after the visit (housekeeping, automation.ts).

import { z } from 'zod';
import { isDateKey, localDateKey } from '../../shared/dates';
import { fullDate, VISITOR_KINDS, type EntryFields } from '../../shared/entry';
import type { EntryRequest } from '../../shared/types';
import { commanderIds, type UserRow } from './auth';
import { badRequest, clock, forbidden, notFound, nowIso, patchSchema, tz } from './core';
import { db } from './db';
import { changed, finishNotifications, notify } from './journal';
import { isCommander } from './taskRepo';

/** a request's details are kept until this many days after the visit */
export const ENTRY_KEEP_DAYS = 7;

interface Row {
  id: number;
  visit_date: string;
  full_name: string;
  phone: string;
  visitor_kind: EntryFields['visitorKind'];
  rank: string;
  clearance: string;
  id_number: string;
  escort: number;
  by_car: number;
  car_number: string;
  car_kind: string;
  reason: string;
  status: EntryRequest['status'];
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  sent_at: string | null;
  sent_by_name: string | null;
}

const BASE = `SELECT e.*, cu.display_name AS created_by_name, su.display_name AS sent_by_name
FROM entry_requests e LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users su ON su.id = e.sent_by`;

const canEdit = (actor: UserRow, r: Pick<Row, 'created_by' | 'status'>) => isCommander(actor) || (r.created_by === actor.id && r.status === 'pending');

const fieldsOf = (r: Row): EntryFields => ({
  visitDate: r.visit_date,
  fullName: r.full_name,
  phone: r.phone,
  visitorKind: r.visitor_kind,
  rank: r.rank,
  clearance: r.clearance,
  idNumber: r.id_number,
  escort: !!r.escort,
  byCar: !!r.by_car,
  carNumber: r.car_number,
  carKind: r.car_kind,
  reason: r.reason,
});

function toEntry(actor: UserRow, r: Row): EntryRequest {
  return {
    id: r.id,
    ...fieldsOf(r),
    status: r.status,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    sentByName: r.sent_by_name,
    canEdit: canEdit(actor, r),
  };
}

/** the commander's: all of them; anyone else's: their own. Those still to send first, by the visit's date */
export function listEntries(actor: UserRow): EntryRequest[] {
  const all = isCommander(actor);
  return db()
    .all<Row>(`${BASE} ${all ? '' : 'WHERE e.created_by = ?'} ORDER BY e.status = 'sent', e.visit_date, e.id`, ...(all ? [] : [actor.id]))
    .map((r) => toEntry(actor, r));
}

function entryRow(id: number): Row {
  const r = db().get<Row>(`${BASE} WHERE e.id = ?`, id);
  if (!r) throw notFound('הבקשה לא נמצאה - אולי כבר נמחקה');
  return r;
}

const text = (max: number) => z.string().trim().max(max);

export const entrySchema = z.object({
  visitDate: z.string().refine(isDateKey, 'תאריך לא תקין'),
  fullName: z.string().trim().min(2, 'חובה לכתוב את השם המלא').max(80),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{9,20}$/, 'מספר הטלפון לא תקין'),
  visitorKind: z.enum(VISITOR_KINDS),
  rank: text(30).optional().default(''),
  clearance: text(30).optional().default(''),
  idNumber: z.string().trim().regex(/^[0-9]{5,10}$/, 'מספר אישי או ת"ז - ספרות בלבד'),
  escort: z.boolean().optional().default(false),
  byCar: z.boolean().optional().default(false),
  carNumber: text(20).optional().default(''),
  carKind: text(60).optional().default(''),
  reason: z.string().trim().min(2, 'חובה לכתוב את סיבת ההגעה').max(300),
});
const entryPatch = patchSchema(entrySchema);

const today = () => localDateKey(clock.now(), tz());

/** what one field says about another: a soldier's rank, a car's number and make */
function check(e: EntryFields): void {
  if (e.visitorKind === 'soldier' && !e.rank.trim()) throw badRequest('לחייל צריך דרגה');
  if (e.byCar && !e.carNumber.trim()) throw badRequest('מגיע ברכב - חסר מספר הרכב');
  if (e.byCar && !e.carKind.trim()) throw badRequest('מגיע ברכב - חסרים סוג וצבע הרכב');
}

/** what is kept: a civilian has no rank, one on foot no car */
const tidy = (e: EntryFields): EntryFields => ({
  ...e,
  rank: e.visitorKind === 'soldier' ? e.rank : '',
  carNumber: e.byCar ? e.carNumber : '',
  carKind: e.byCar ? e.carKind : '',
});

export function createEntry(actor: UserRow, raw: unknown): number {
  const e = tidy(entrySchema.parse(raw));
  check(e);
  if (e.visitDate < today()) throw badRequest('תאריך הביקור כבר עבר');
  const id = db().tx(() => {
    const id = db().run(
      `INSERT INTO entry_requests(visit_date, full_name, phone, visitor_kind, rank, clearance, id_number, escort, by_car, car_number, car_kind, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.visitDate,
      e.fullName,
      e.phone,
      e.visitorKind,
      e.rank,
      e.clearance,
      e.idNumber,
      e.escort ? 1 : 0,
      e.byCar ? 1 : 0,
      e.carNumber,
      e.carKind,
      e.reason,
      actor.id,
      nowIso(),
    ).id;
    // to the commander at once - what the phone shows says who and when, not the visitor's numbers
    notify(
      commanderIds(),
      {
        type: 'entry',
        category: 'action',
        title: `אישור כניסה: ${e.fullName}`,
        body: `${fullDate(e.visitDate)} · ${e.reason} · ביקש/ה: ${actor.display_name}`,
        link: `/entries#entry-${id}`,
        ref: `entry:${id}`,
      },
      actor.id,
    );
    return id;
  });
  changed('entries');
  return id;
}

export function updateEntry(actor: UserRow, id: number, raw: unknown): void {
  const r = entryRow(id);
  if (!canEdit(actor, r)) throw forbidden(r.created_by === actor.id ? 'האישור כבר נשלח לבסיס - לשינוי פנו למפקד הקורס' : 'אפשר לשנות רק בקשה שכתבת');
  const p = entryPatch.parse(raw);
  const given = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<EntryFields>;
  const e = tidy({ ...fieldsOf(r), ...given });
  check(e);
  if (e.visitDate !== r.visit_date && e.visitDate < today()) throw badRequest('תאריך הביקור כבר עבר');
  db().run(
    `UPDATE entry_requests SET visit_date = ?, full_name = ?, phone = ?, visitor_kind = ?, rank = ?, clearance = ?, id_number = ?, escort = ?, by_car = ?,
       car_number = ?, car_kind = ?, reason = ? WHERE id = ?`,
    e.visitDate,
    e.fullName,
    e.phone,
    e.visitorKind,
    e.rank,
    e.clearance,
    e.idNumber,
    e.escort ? 1 : 0,
    e.byCar ? 1 : 0,
    e.carNumber,
    e.carKind,
    e.reason,
    id,
  );
  changed('entries');
}

/** the commander sent it on to the base (or takes that back); the one who asked hears it was sent */
export function markEntrySent(actor: UserRow, id: number, sent: boolean): void {
  if (!isCommander(actor)) throw forbidden('את אישורי הכניסה שולח לבסיס מפקד הקורס');
  const r = entryRow(id);
  if (sent === (r.status === 'sent')) return;
  db().tx(() => {
    if (sent) {
      db().run("UPDATE entry_requests SET status = 'sent', sent_at = ?, sent_by = ? WHERE id = ?", nowIso(), actor.id, id);
      notify(
        [r.created_by],
        { type: 'entry_sent', category: 'info', title: `אישור הכניסה של ${r.full_name} נשלח לבסיס`, body: fullDate(r.visit_date), link: '/entries', ref: `entry:${id}` },
        actor.id,
      );
    } else {
      db().run("UPDATE entry_requests SET status = 'pending', sent_at = NULL, sent_by = NULL WHERE id = ?", id);
    }
  });
  changed('entries');
}

export function deleteEntry(actor: UserRow, id: number): void {
  const r = entryRow(id);
  if (!canEdit(actor, r)) throw forbidden(r.created_by === actor.id ? 'האישור כבר נשלח לבסיס - לביטול פנו למפקד הקורס' : 'אפשר למחוק רק בקשה שכתבת');
  db().tx(() => {
    db().run('DELETE FROM entry_requests WHERE id = ?', id);
    finishNotifications(true, 'ref = ?', `entry:${id}`);
  });
  changed('entries');
}

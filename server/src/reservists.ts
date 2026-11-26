// The reservists (מילואים) in the contacts: people who come to the course from time to time - a name, a number to
// call or message, what they do here. Not a course's own: one list in the current course's database, the same
// while working in a course opened beside it, and going on to the next course. Everyone on the staff sees it and
// adds to it; the commander, and whoever added someone, removes them.

import { z } from 'zod';
import type { Reservist } from '../../shared/types';
import type { UserRow } from './auth';
import { forbidden, notFound, nowIso } from './core';
import { homeDb } from './db';
import { changed, logActivity } from './journal';

interface Row {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  role: string;
  notes: string;
  created_by: number | null;
  created_by_name: string | null;
}

const SELECT = 'SELECT r.*, u.display_name AS created_by_name FROM reservists r LEFT JOIN users u ON u.id = r.created_by';

const toReservist = (r: Row, actor: UserRow): Reservist => ({
  id: r.id,
  fullName: r.full_name,
  phone: r.phone,
  email: r.email,
  role: r.role,
  notes: r.notes,
  createdByName: r.created_by_name,
  canDelete: actor.role === 'commander' || r.created_by === actor.id,
});

export function listReservists(actor: UserRow): Reservist[] {
  return homeDb()
    .all<Row>(`${SELECT} ORDER BY r.full_name COLLATE NOCASE`)
    .map((r) => toReservist(r, actor));
}

export const reservistSchema = z.object({
  fullName: z.string().trim().min(1, 'חסר שם').max(80),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().email('כתובת מייל לא תקינה').max(120)]).optional().default(''),
  role: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

function rowOf(id: number): Row {
  const r = homeDb().get<Row>(`${SELECT} WHERE r.id = ?`, id);
  if (!r) throw notFound('איש המילואים לא נמצא');
  return r;
}

export function addReservist(actor: UserRow, raw: unknown): Reservist {
  const p = reservistSchema.parse(raw);
  const now = nowIso();
  const id = homeDb().run(
    'INSERT INTO reservists(full_name, phone, email, role, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    p.fullName,
    p.phone,
    p.email,
    p.role,
    p.notes,
    actor.id,
    now,
    now,
  ).id;
  logActivity({ userId: actor.id, action: 'reservist', text: `${actor.display_name} הוסיף את ${p.fullName} לאנשי הקשר של המילואים` });
  changed('users');
  return toReservist(rowOf(id), actor);
}

export function updateReservist(actor: UserRow, id: number, raw: unknown): Reservist {
  rowOf(id);
  const p = reservistSchema.parse(raw);
  homeDb().run('UPDATE reservists SET full_name = ?, phone = ?, email = ?, role = ?, notes = ?, updated_at = ? WHERE id = ?', p.fullName, p.phone, p.email, p.role, p.notes, nowIso(), id);
  changed('users');
  return toReservist(rowOf(id), actor);
}

export function deleteReservist(actor: UserRow, id: number): void {
  const r = rowOf(id);
  if (actor.role !== 'commander' && r.created_by !== actor.id) throw forbidden('מסירים מהרשימה מפקד הקורס ומי שהוסיף');
  homeDb().run('DELETE FROM reservists WHERE id = ?', id);
  changed('users');
}

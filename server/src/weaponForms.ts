// A cadet's exceptional-weapon form (טופס נשק חריג): when and where, what the exception was (an abandoned
// weapon, a discharge, a lost part...), the weapon itself, what happened, who found it, the cadet's version, how
// the team commander handled it - and the course commander's decision, which closes it.
//
// Anyone on the staff fills one in (whoever caught it); it is seen, as the cadet's discipline is, by the team's
// commander, the course commander and whoever wrote it - and the first two are told of it at once.

import { z } from 'zod';
import { isDateKey, isTimeString, shortDate } from '../../shared/dates';
import type { WeaponForm, WeaponFormSummary } from '../../shared/types';
import { WEAPON_EXCEPTIONS, weaponExceptionText, type WeaponException } from '../../shared/weaponForms';
import { commanderIds, type UserRow } from './auth';
import { cadetRow, canManageCadet, type CadetRow } from './cadets';
import { forbidden, notFound, nowIso } from './core';
import { db } from './db';
import { changed, logActivity, notify } from './journal';
import { isCommander } from './taskRepo';

interface Row {
  id: number;
  cadet_id: number;
  occurred_on: string;
  occurred_at: string | null;
  place: string;
  kind: WeaponException;
  kind_other: string;
  weapon_type: string;
  weapon_number: string;
  description: string;
  found_by: string;
  cadet_version: string;
  handling: string;
  decision: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  author_id: number | null;
  author_name: string | null;
  created_at: string;
}

const BASE = `SELECT f.*, a.display_name AS author_name, d.display_name AS decided_by_name
  FROM weapon_forms f LEFT JOIN users a ON a.id = f.author_id LEFT JOIN users d ON d.id = f.decided_by`;

const cadetName = (c: CadetRow) => `${c.first_name} ${c.last_name}`.trim();

/** seen by the team's commander, the course commander (and the staff the files were opened to) and its writer */
const mayView = (me: UserRow, r: Pick<Row, 'author_id'>, c: CadetRow) => canManageCadet(me, c) || r.author_id === me.id;
/** changed by its writer and the cadet's commanders - once decided, by the course commander alone */
const mayEdit = (me: UserRow, r: Pick<Row, 'author_id' | 'decided_at'>, c: CadetRow) => (r.decided_at ? isCommander(me) : canManageCadet(me, c) || r.author_id === me.id);

const toSummary = (r: Row): WeaponFormSummary => ({
  id: r.id,
  cadetId: r.cadet_id,
  occurredOn: r.occurred_on,
  occurredAt: r.occurred_at,
  kind: r.kind,
  kindText: weaponExceptionText(r.kind, r.kind_other),
  authorName: r.author_name,
  decided: !!r.decided_at,
});

/** the cadet's forms the person may see, newest first (the cadet's file) */
export function weaponFormsOf(me: UserRow, c: CadetRow): WeaponFormSummary[] {
  return db()
    .all<Row>(`${BASE} WHERE f.cadet_id = ? ORDER BY f.occurred_on DESC, f.id DESC`, c.id)
    .filter((r) => mayView(me, r, c))
    .map(toSummary);
}

function row(id: number): Row {
  const r = db().get<Row>(`${BASE} WHERE f.id = ?`, id);
  if (!r) throw notFound('הטופס לא נמצא');
  return r;
}

export function weaponForm(me: UserRow, id: number): WeaponForm {
  const r = row(id);
  const c = cadetRow(r.cadet_id);
  if (!mayView(me, r, c)) throw forbidden('טופס נשק חריג רואים מפקד הצוות, מפקד הקורס ומי שמילא אותו');
  const teamCommander = c.team_commander_id ? (db().get<{ n: string }>('SELECT display_name AS n FROM users WHERE id = ?', c.team_commander_id)?.n ?? null) : null;
  return {
    ...toSummary(r),
    cadetName: cadetName(c),
    personalNumber: c.personal_number,
    teamName: c.team_name,
    teamCommanderName: teamCommander,
    place: r.place,
    kindOther: r.kind_other,
    weaponType: r.weapon_type,
    weaponNumber: r.weapon_number,
    description: r.description,
    foundBy: r.found_by,
    cadetVersion: r.cadet_version,
    handling: r.handling,
    decision: r.decision,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at,
    authorId: r.author_id,
    createdAt: r.created_at,
    canEdit: mayEdit(me, r, c),
    canDecide: isCommander(me),
    canDelete: isCommander(me) || (r.author_id === me.id && !r.decided_at),
  };
}

const text = (max: number) => z.string().trim().max(max);

export const weaponFormSchema = z
  .object({
    occurredOn: z.string().refine(isDateKey, 'תאריך לא תקין'),
    occurredAt: z
      .string()
      .refine(isTimeString, 'שעה לא תקינה')
      .nullable()
      .optional()
      .transform((v) => v || null),
    place: text(200).optional().default(''),
    kind: z.enum(WEAPON_EXCEPTIONS),
    kindOther: text(200).optional().default(''),
    weaponType: text(60).optional().default(''),
    weaponNumber: text(60).optional().default(''),
    description: text(5000).min(1, 'חסר תיאור של מה שקרה'),
    foundBy: text(120).optional().default(''),
    cadetVersion: text(5000).optional().default(''),
    handling: text(5000).optional().default(''),
  })
  .refine((v) => v.kind !== 'other' || !!v.kindOther, { message: 'מה היה החריג? (נבחר "אחר")', path: ['kindOther'] });

export function createWeaponForm(me: UserRow, cadetId: number, raw: unknown): number {
  const c = cadetRow(cadetId);
  const p = weaponFormSchema.parse(raw);
  const at = nowIso();
  const id = db().tx(() => {
    const id = db().run(
      `INSERT INTO weapon_forms(cadet_id, occurred_on, occurred_at, place, kind, kind_other, weapon_type, weapon_number, description, found_by, cadet_version, handling, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.id,
      p.occurredOn,
      p.occurredAt,
      p.place,
      p.kind,
      p.kind === 'other' ? p.kindOther : '',
      p.weaponType,
      p.weaponNumber,
      p.description,
      p.foundBy || me.display_name,
      p.cadetVersion,
      p.handling,
      me.id,
      at,
      at,
    ).id;
    logActivity({ userId: me.id, action: 'weapon_form', text: `${me.display_name} מילא טופס נשק חריג לצוער ${cadetName(c)}` });
    return id;
  });
  const kind = weaponExceptionText(p.kind, p.kindOther);
  notify(
    [c.team_commander_id, ...commanderIds()],
    {
      type: 'weapon_form',
      category: 'exception',
      title: `טופס נשק חריג: ${cadetName(c)}`,
      body: `${kind} · ${shortDate(p.occurredOn)}${p.place ? ` · ${p.place}` : ''} · מאת ${me.display_name}`,
      link: `/cadets/${c.id}/weapon/${id}`,
      ref: `weapon:${id}`,
    },
    me.id,
  );
  changed('cadets');
  return id;
}

export function updateWeaponForm(me: UserRow, id: number, raw: unknown): void {
  const r = row(id);
  const c = cadetRow(r.cadet_id);
  if (!mayEdit(me, r, c)) throw forbidden(r.decided_at ? 'על הטופס כבר הוחלט - רק מפקד הקורס משנה אותו' : 'את הטופס משנים מי שמילא אותו, מפקד הצוות ומפקד הקורס');
  const p = weaponFormSchema.parse(raw);
  db().run(
    `UPDATE weapon_forms SET occurred_on = ?, occurred_at = ?, place = ?, kind = ?, kind_other = ?, weapon_type = ?, weapon_number = ?, description = ?, found_by = ?, cadet_version = ?, handling = ?, updated_at = ?
     WHERE id = ?`,
    p.occurredOn,
    p.occurredAt,
    p.place,
    p.kind,
    p.kind === 'other' ? p.kindOther : '',
    p.weaponType,
    p.weaponNumber,
    p.description,
    p.foundBy,
    p.cadetVersion,
    p.handling,
    nowIso(),
    id,
  );
  changed('cadets');
}

/** the course commander's decision - it closes the form; cleared, the form is open again */
export function decideWeaponForm(me: UserRow, id: number, raw: unknown): void {
  if (!isCommander(me)) throw forbidden('על טופס נשק חריג מחליט מפקד הקורס');
  const r = row(id);
  const c = cadetRow(r.cadet_id);
  const { decision } = z.object({ decision: text(5000) }).parse(raw);
  const at = nowIso();
  db().run('UPDATE weapon_forms SET decision = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?', decision, decision ? me.id : null, decision ? at : null, at, id);
  if (decision && !r.decided_at) {
    notify(
      [c.team_commander_id, r.author_id],
      {
        type: 'weapon_form_decided',
        category: 'info',
        title: `החלטה בטופס נשק חריג: ${cadetName(c)}`,
        body: decision.length > 160 ? `${decision.slice(0, 159)}…` : decision,
        link: `/cadets/${c.id}/weapon/${id}`,
        ref: `weapon:${id}`,
      },
      me.id,
    );
    logActivity({ userId: me.id, action: 'weapon_form', text: `${me.display_name} החליט בטופס נשק חריג של ${cadetName(c)}` });
  }
  changed('cadets');
}

export function deleteWeaponForm(me: UserRow, id: number): number {
  const r = row(id);
  if (!isCommander(me) && !(r.author_id === me.id && !r.decided_at)) throw forbidden('טופס מוחקים מי שמילא אותו (לפני ההחלטה) או מפקד הקורס');
  db().run('DELETE FROM weapon_forms WHERE id = ?', id);
  changed('cadets');
  return r.cadet_id;
}

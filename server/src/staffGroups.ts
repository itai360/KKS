// The course's staff groups with their people worked out (shared/staffGroups.ts): all the active
// staff, the active commanders of the teams, or the people the commander chose who are still active.

import { groupOf, type StaffGroup } from '../../shared/staffGroups';
import { getSettings } from './core';
import { db } from './db';

function resolve(): StaffGroup[] {
  const active = new Set(db().all<{ id: number }>('SELECT id FROM users WHERE active = 1').map((r) => r.id));
  const staff = db()
    .all<{ id: number }>("SELECT id FROM users WHERE role = 'staff' AND active = 1 ORDER BY display_name")
    .map((r) => r.id);
  const teamCommanders = db()
    .all<{ id: number }>('SELECT DISTINCT u.id FROM teams t JOIN users u ON u.id = t.commander_id WHERE u.active = 1 ORDER BY u.display_name')
    .map((r) => r.id);
  return getSettings().staffGroups.map((g) => ({
    id: g.id,
    name: g.name,
    rule: g.rule,
    memberIds: g.rule === 'staff' ? staff : g.rule === 'teamCommanders' ? teamCommanders : g.memberIds.filter((id) => active.has(id)),
  }));
}

// worked out once for everything one request reads (a list of tasks names each one's group)
let memo: { db: unknown; groups: StaffGroup[] } | null = null;

export function staffGroups(): StaffGroup[] {
  if (memo && memo.db === db()) return memo.groups;
  const groups = resolve();
  memo = { db: db(), groups };
  queueMicrotask(() => {
    memo = null;
  });
  return groups;
}

/** people, teams or the groups changed: the next read works them out again */
export function forgetStaffGroups(): void {
  memo = null;
}

/** the name of the group these people are, if they are one */
export function groupNameOf(people: number[], creator: number | null): string | null {
  return groupOf(people, creator, staffGroups())?.name ?? null;
}

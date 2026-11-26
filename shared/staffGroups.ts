// Groups of staff that tasks go to together - "סגל", "מפק"צים", "פורום מוביל". A task given to
// several people (a copy for each, or one task they share) is shown once, under the group it went to,
// instead of once per person. A group is either worked out from the course (all the staff, the
// commanders of the teams) or a list of people the commander chose.

export type StaffGroupRule = 'staff' | 'teamCommanders' | 'custom';

export interface StaffGroupDef {
  id: string;
  name: string;
  rule: StaffGroupRule;
  /** the people of a chosen group (rule 'custom'); unused for the others */
  memberIds: number[];
}

/** a group with its people worked out: who is in it now */
export interface StaffGroup {
  id: string;
  name: string;
  rule: StaffGroupRule;
  memberIds: number[];
}

export const STAFF_GROUP_RULE_LABELS: Record<StaffGroupRule, string> = {
  staff: 'כל אנשי הסגל הפעילים',
  teamCommanders: 'מפקדי הצוותים (לפי מסך הצוותים)',
  custom: 'אנשים שבחרת',
};

export const DEFAULT_STAFF_GROUPS: StaffGroupDef[] = [
  { id: 'staff', name: 'סגל', rule: 'staff', memberIds: [] },
  { id: 'teamCommanders', name: 'מפק"צים', rule: 'teamCommanders', memberIds: [] },
  { id: 'forum', name: 'פורום מוביל', rule: 'custom', memberIds: [] },
];

/**
 * The group these people are, when they are exactly one of the groups. Whoever opened the task may or
 * may not have given a copy to themselves (all the staff, opened by one of them, leaves them out), so
 * the opener counts either way. One person is never a group; the first group that fits wins.
 */
export function groupOf(people: readonly number[], creator: number | null, groups: readonly StaffGroup[]): StaffGroup | null {
  const set = new Set(people);
  if (set.size < 2) return null;
  const strip = (ids: Iterable<number>) => {
    const s = new Set(ids);
    if (creator !== null) s.delete(creator);
    return s;
  };
  const p = strip(set);
  for (const g of groups) {
    const m = strip(g.memberIds);
    if (m.size !== p.size || m.size === 0) continue;
    if ([...p].every((id) => m.has(id))) return g;
  }
  return null;
}

/** a few names for people who are not one group: "דנה, יואב +3" */
export function namesOf(names: readonly string[], shown = 2): string {
  const list = names.filter(Boolean);
  if (list.length <= shown + 1) return list.join(', ');
  return `${list.slice(0, shown).join(', ')} +${list.length - shown}`;
}

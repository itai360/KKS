// Every field that offers options lists them alphabetically (א-ב); the catch-all choice ("אחר") last.

import { describe, expect, it } from 'vitest';
import { ABSENCE_REASON_LABELS, ABSENCE_REASONS, BLOCK_REASONS, COMMITTEE_DECISION_LABELS, COMMITTEE_DECISIONS, COMMITTEE_KINDS, DEFAULT_DOMAINS, DOCUMENT_CATEGORIES, EVALUATION_CRITERIA, TALK_TYPES } from '../constants';
import { BROAD_EXPERIENCES } from '../experiences';
import { byHe, byTeamAndName, sortHe } from '../sort';

/** alphabetical, with the catch-all choice (if given) at the end */
const alphabetical = (list: readonly string[], last?: string) => {
  const rest = list.filter((x) => x !== last);
  expect(rest, list.join(' | ')).toEqual(sortHe(rest));
  if (last && list.includes(last)) expect(list[list.length - 1]).toBe(last);
};

describe('alphabetical order', () => {
  it('compares as Hebrew readers expect: quote marks ignored, numbers in their order', () => {
    expect(sortHe(['צוות 10', 'צוות 2', 'מפק"צ 3', 'אחר', 'ביטחון', 'חסר ציוד', 'חסרה החלטה', 'חסר כוח אדם'])).toEqual(['ביטחון', 'חסר כוח אדם', 'חסר ציוד', 'חסרה החלטה', 'מפק"צ 3', 'צוות 2', 'צוות 10', 'אחר']);
    expect(byHe('קב"ט', 'קה"ד')).toBeLessThan(0);
    expect(byTeamAndName({ team: null, last: 'א', first: 'א' }, { team: 'צוות 1', last: 'ת', first: 'ת' })).toBeGreaterThan(0);
  });

  it('every fixed list of choices is in it', () => {
    alphabetical(BROAD_EXPERIENCES);
    expect(BROAD_EXPERIENCES).toEqual(['א"ג', 'ניווטים', 'ס\' מ"פ', 'קב"ט', 'קה"ד', 'קחו"ם', 'קל"ג', 'שטח']);
    alphabetical(BLOCK_REASONS, 'אחר');
    alphabetical(COMMITTEE_KINDS, 'אחר');
    alphabetical(DOCUMENT_CATEGORIES, 'אחר');
    alphabetical(DEFAULT_DOMAINS, 'אחר');
    alphabetical(EVALUATION_CRITERIA);
    alphabetical(TALK_TYPES);
    alphabetical(COMMITTEE_DECISIONS.map((d) => COMMITTEE_DECISION_LABELS[d]), 'אחר');
    // the general absence is the catch-all here
    alphabetical(ABSENCE_REASONS.map((r) => ABSENCE_REASON_LABELS[r]), ABSENCE_REASON_LABELS.other);
  });
});

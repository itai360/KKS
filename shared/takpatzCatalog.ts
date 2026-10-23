// The course's catalog of experiences as its planning sheet lists them ("תכנון התנסויות צוותיות"): by
// half and kind, in its order, and the roles a broad company experience can take in each half. A new
// course starts with it; the commander adds, renames and removes from there (takpatz.ts).

import type { CatalogKind, TakpatzHalf } from './takpatz';

const of = (half: TakpatzHalf, kind: CatalogKind, names: string[]) => names.map((name) => ({ half, kind, name }));

export const DEFAULT_TAKPATZ_CATALOG: { half: TakpatzHalf; kind: CatalogKind; name: string }[] = [
  ...of(1, 'broad_company', ['תפקידן רוחב X', 'תפקידן רוחב Y']),
  ...of(1, 'broad_team', ['קה"ד', 'א. סימולציות', 'קחו"ם']),
  ...of(1, 'command_team', ['ממ"ש היסוד', 'ממ"ש שטח', 'מ"כ שטח', 'ממ"ש המקצוע', 'ממ"ש צה"ל']),
  ...of(1, 'instruct_team', ['סק"ן כוכבים', 'סק"ם מלחמה X', 'סק"ם מלחמה Y']),
  ...of(1, 'instruct_company', ['קרוסלת כלים', "התנסות אוכ'"]),
  ...of(1, 'role', ['סמפ', 'קלג', 'קאג', 'קהד', 'ק. אקדמיה', 'קחום', 'ק שטח', 'ק ניווטים']),
  ...of(2, 'broad_company', ['תפקידן רוחב X', 'תפקידן רוחב Y']),
  ...of(2, 'broad_team', ['קה"ד', 'א. סימולציות', 'קחו"ם']),
  ...of(2, 'command_team', ['ממ"ש פרט', 'ממ"ש מנהיגות + זהות', 'ממ"ש סד"ח', 'ממ"ש סיום']),
  ...of(2, 'instruct_team', ['סיור קריית הלאום', 'סיור הר הרצל', 'סיור הרובע היהודי']),
  ...of(2, 'role', ['סמפ', 'קלג', 'קאג', 'קהד', 'ק. אקדמיה', 'קחום', 'ק פרט']),
];

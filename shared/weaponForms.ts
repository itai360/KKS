// The exceptional-weapon form (טופס נשק חריג) of a cadet: what happened with the weapon, the weapon itself, the
// cadet's version, how the team commander handled it and the course commander's decision
// (server/src/weaponForms.ts, client/src/pages/WeaponFormPage.tsx).

export const WEAPON_EXCEPTIONS = ['abandoned', 'unattached', 'discharge', 'lost', 'unsafe', 'ammo', 'other'] as const;
export type WeaponException = (typeof WEAPON_EXCEPTIONS)[number];

export const WEAPON_EXCEPTION_LABELS: Record<WeaponException, string> = {
  abandoned: 'הפקרת נשק',
  unattached: 'נשק לא צמוד',
  discharge: 'פליטת כדור',
  lost: 'אובדן נשק או חלק ממנו',
  unsafe: 'טיפול לא בטוח בנשק',
  ammo: 'מחסנית או תחמושת שלא כנוהל',
  other: 'אחר',
};

/** offered as the weapon's type - anything else can be written */
export const WEAPON_TYPES = ['M16', 'M4', 'תבור', 'מיקרו תבור', 'נגב', 'מאג', 'אקדח'];

export const isWeaponException = (v: unknown): v is WeaponException => typeof v === 'string' && (WEAPON_EXCEPTIONS as readonly string[]).includes(v);

/** what the form says the exception was: its kind, or what was written for "אחר" */
export const weaponExceptionText = (kind: WeaponException, other: string) => (kind === 'other' && other.trim() ? other.trim() : WEAPON_EXCEPTION_LABELS[kind]);

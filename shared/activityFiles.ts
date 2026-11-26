// An activity file (תיק פעילות): the file of a week's activity, built by the one who looks after the activity
// files (chosen in the course) with the week's lead, and on its way: built, waiting for the company commander's
// approval, sent on to headquarters, approved.

export const ACTIVITY_FILE_STATUSES = ['building', 'awaiting', 'sent', 'approved'] as const;
export type ActivityFileStatus = (typeof ACTIVITY_FILE_STATUSES)[number];

export const ACTIVITY_FILE_STATUS_LABELS: Record<ActivityFileStatus, string> = {
  building: 'בבנייה',
  awaiting: 'ממתין לאישור מ"פ',
  sent: 'נשלח למטה',
  approved: 'אושר',
};

/** its badge's tone, where it is only seen */
export const ACTIVITY_FILE_STATUS_TONES: Record<ActivityFileStatus, string> = {
  building: 't-gray',
  awaiting: 't-purple',
  sent: 't-blue',
  approved: 't-green',
};

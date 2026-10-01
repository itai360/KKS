import {
  addDays,
  DEFAULT_TZ,
  formatAgo,
  formatDateTime,
  formatDeadline,
  formatTimeLeft,
  localDateKey,
  localTime,
  longDate,
  shortDate,
  zonedIso,
} from '@shared/dates';

let tz = DEFAULT_TZ;
export function setTimezone(t: string): void {
  tz = t || DEFAULT_TZ;
}
export const getTz = () => tz;

export const todayKey = () => localDateKey(new Date(), tz);
export const fmtDeadline = (iso: string) => formatDeadline(iso, new Date(), tz);
export const fmtDateTime = (iso: string) => formatDateTime(iso, tz);
export const fmtAgo = (iso: string) => formatAgo(iso, new Date());
export const fmtTimeLeft = (iso: string) => formatTimeLeft(iso, new Date());
export const fmtTime = (iso: string) => localTime(iso, tz);
export const fmtDate = (iso: string) => shortDate(localDateKey(iso, tz));
export const fmtLongDate = (key: string) => longDate(key);
export const dateKeyOf = (iso: string) => localDateKey(iso, tz);
export const isoAt = (dateKey: string, time: string) => zonedIso(dateKey, time, tz);
export const tomorrowKey = () => addDays(todayKey(), 1);

export function greeting(): string {
  const h = Number(localTime(new Date(), tz).slice(0, 2));
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

export function fileSize(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "בוקר טוב, מפק"צ 2" - short display names are used whole, long ones by first word. */
export function greetName(displayName: string): string {
  return displayName.length <= 14 ? displayName : displayName.split(' ')[0];
}

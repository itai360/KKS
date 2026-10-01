// Small cross-cutting helpers: clock, config, errors, settings.

import { DEFAULT_DOMAINS } from '../../shared/constants';
import { DEFAULT_TZ } from '../../shared/dates';
import type { CourseSettings } from '../../shared/types';
import { db } from './db';

// ---- clock (overridable in tests) ----
let fixedNow: Date | null = null;
export const clock = {
  now(): Date {
    return fixedNow ? new Date(fixedNow) : new Date();
  },
  set(d: Date | null): void {
    fixedNow = d;
  },
};
export const nowIso = () => clock.now().toISOString();

// ---- config ----
export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? 'data',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 25),
};

// ---- errors ----
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'אין לך הרשאה לפעולה זו') => new HttpError(403, m);
export const notFound = (m = 'לא נמצא') => new HttpError(404, m);

// ---- settings ----
const DEFAULT_SETTINGS: CourseSettings = {
  courseName: 'קורס קק"ס',
  courseSymbol: 'קק"ס',
  startDate: null,
  endDate: null,
  timezone: DEFAULT_TZ,
  staleDays: 3,
  defaultDeadlineTime: '18:00',
  overloadThreshold: 12,
  readinessWarnThreshold: 70,
  domains: DEFAULT_DOMAINS,
};

let settingsCache: CourseSettings | null = null;

export function getSettings(): CourseSettings {
  if (settingsCache) return settingsCache;
  const rows = db().all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore malformed */
    }
  }
  settingsCache = s as unknown as CourseSettings;
  return settingsCache;
}

export function updateSettings(patch: Partial<CourseSettings>): CourseSettings {
  db().tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !(k in DEFAULT_SETTINGS)) continue;
      db().run(
        'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        k,
        JSON.stringify(v),
      );
    }
  });
  settingsCache = null;
  return getSettings();
}

export function resetSettingsCache(): void {
  settingsCache = null;
}

export const tz = () => getSettings().timezone;

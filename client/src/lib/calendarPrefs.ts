// How the person left the calendar: which layers are shown, which deadlines, only their own events,
// the side panel, the rows above the hours opened up. Kept on this device - a convenience, so storage
// that is missing or blocked only means the defaults. The view and the day are in the address
// (calendarBar.ts and the calendar page), not here.

import { useSyncExternalStore } from 'react';
import { NO_TASK_FILTER, type TaskFilter } from '@shared/calendarLayers';

/** what the side panel beside the calendar shows (null: closed) */
export type PanelTab = 'day' | 'week' | 'tasks' | 'approvals';

export interface CalendarPrefs {
  /** layers set by the person; the rest are at their default (shared/calendarLayers.ts layerShown) */
  layers: Partial<Record<string, boolean>>;
  taskFilter: TaskFilter;
  /** only the events the person runs or prepares for, and no shared Google calendars */
  onlyMine: boolean;
  panel: PanelTab | null;
  /** the rows above the hours opened up to show everything */
  allDayOpen: boolean;
  /** the "היומנים שלי" / "יומנים נוספים" lists folded in the side bar */
  folded: Partial<Record<'mine' | 'other', boolean>>;
}

const KEY = 'kks.calendar';

/** what the schedule remembered before (its deadlines and "only mine" choices) carries over */
function fromBefore(): CalendarPrefs {
  const prefs: CalendarPrefs = { layers: {}, taskFilter: NO_TASK_FILTER, onlyMine: false, panel: null, allDayOpen: false, folded: {} };
  try {
    const tasks = localStorage.getItem('kks.scheduleTasks');
    if (tasks === 'none') prefs.layers.myTasks = false;
    if (tasks === 'all') prefs.layers.staffTasks = true;
    prefs.onlyMine = localStorage.getItem('kks.scheduleMine') === '1';
  } catch {
    /* the defaults */
  }
  return prefs;
}

/** what is kept on this device, read afresh (exported for tests) */
export function readCalendarPrefs(): CalendarPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fromBefore();
    const v = JSON.parse(raw) as Partial<CalendarPrefs>;
    const base = fromBefore();
    return {
      layers: v.layers && typeof v.layers === 'object' ? v.layers : base.layers,
      taskFilter: { ...NO_TASK_FILTER, ...(v.taskFilter ?? {}) },
      onlyMine: !!v.onlyMine,
      panel: v.panel === 'day' || v.panel === 'week' || v.panel === 'tasks' || v.panel === 'approvals' ? v.panel : null,
      allDayOpen: !!v.allDayOpen,
      folded: v.folded && typeof v.folded === 'object' ? v.folded : {},
    };
  } catch {
    return fromBefore();
  }
}

let current: CalendarPrefs | null = null;
const listeners = new Set<() => void>();

function get(): CalendarPrefs {
  if (!current) current = readCalendarPrefs();
  return current;
}

export function setCalendarPrefs(patch: Partial<CalendarPrefs> | ((p: CalendarPrefs) => Partial<CalendarPrefs>)): void {
  const prev = get();
  current = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* this visit only */
  }
  listeners.forEach((l) => l());
}

export function useCalendarPrefs(): CalendarPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    get,
  );
}

/** a layer shown or hidden */
export const setLayer = (id: string, on: boolean) => setCalendarPrefs((p) => ({ layers: { ...p.layers, [id]: on } }));

/** tests start from nothing */
export function resetCalendarPrefs(): void {
  current = null;
}

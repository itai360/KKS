import { beforeEach, describe, expect, it } from 'vitest';

// the browser's storage, as the calendar's preferences see it
const store = new Map<string, string>();
let blocked = false;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => {
    if (blocked) throw new Error('blocked');
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (blocked) throw new Error('blocked');
    store.set(k, v);
  },
};
const { readCalendarPrefs, setCalendarPrefs } = await import('../src/lib/calendarPrefs');
const { VIEW_KEYS, DESK_VIEWS, PHONE_VIEWS, VIEW_LABELS } = await import('../src/lib/calendarBar');

describe("the calendar's preferences on this device", () => {
  beforeEach(() => {
    store.clear();
    blocked = false;
  });

  it('start from the defaults, carrying over what the old schedule remembered', () => {
    expect(readCalendarPrefs()).toMatchObject({ layers: {}, onlyMine: false, panel: null, allDayOpen: false });
    store.set('kks.scheduleTasks', 'all');
    store.set('kks.scheduleMine', '1');
    expect(readCalendarPrefs()).toMatchObject({ layers: { staffTasks: true }, onlyMine: true });
    store.set('kks.scheduleTasks', 'none');
    expect(readCalendarPrefs().layers).toEqual({ myTasks: false });
  });

  it('read what was kept, and drop what is not theirs to hold', () => {
    store.set('kks.calendar', JSON.stringify({ layers: { debriefs: true }, panel: 'tasks', onlyMine: true, taskFilter: { scope: 'urgent' } }));
    const p = readCalendarPrefs();
    expect(p.layers).toEqual({ debriefs: true });
    expect(p.panel).toBe('tasks');
    expect(p.onlyMine).toBe(true);
    expect(p.taskFilter.scope).toBe('urgent');
    // a panel that does not exist, or a broken record: the defaults
    store.set('kks.calendar', JSON.stringify({ panel: 'secret' }));
    expect(readCalendarPrefs().panel).toBeNull();
    store.set('kks.calendar', '{not json');
    expect(readCalendarPrefs()).toMatchObject({ layers: {}, panel: null });
  });

  it('keep a change, and keep working when storage is blocked', () => {
    setCalendarPrefs({ panel: 'week' });
    setCalendarPrefs((p) => ({ layers: { ...p.layers, absences: true } }));
    expect(JSON.parse(store.get('kks.calendar')!)).toMatchObject({ panel: 'week', layers: { absences: true } });
    blocked = true;
    expect(() => setCalendarPrefs({ allDayOpen: true })).not.toThrow();
    expect(readCalendarPrefs()).toMatchObject({ layers: {}, panel: null });
  });
});

describe("the calendar's keys", () => {
  it('give each view its own letter and number, none of them taken by the keys of the whole site', () => {
    const keys = Object.values(VIEW_KEYS).flat();
    expect(new Set(keys).size).toBe(keys.length);
    // N: a new task, T: today, J/K: next/previous, C: a new event, G: go to a day
    for (const taken of ['N', 'T', 'J', 'K', 'C', 'G']) expect(keys).not.toContain(taken);
    expect(Object.values(VIEW_KEYS).map(([, n]) => n).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it("offer a computer every view that has keys, and a phone only views that fit it", () => {
    for (const v of Object.keys(VIEW_KEYS)) expect(DESK_VIEWS).toContain(v);
    expect(PHONE_VIEWS).not.toContain('week');
    expect(PHONE_VIEWS).not.toContain('year');
    for (const v of [...DESK_VIEWS, ...PHONE_VIEWS]) expect(VIEW_LABELS[v]).toBeTruthy();
  });
});

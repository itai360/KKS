// The side bar's calendar parts, as Google Calendar has them under its month: "יצירה", and the layers -
// "היומנים שלי" (the course's events, the deadlines, the weeks, the experiences, the debriefs, who is
// away) and "יומנים נוספים" (the connected Google calendars) - each with a box in its colour to show or
// hide it. What is shown is remembered on this device (lib/calendarPrefs.ts); the calendar loads only
// the layers that are on.

import { useState } from 'react';
import { CORE_LAYERS, externalColor, isTaskFilterSet, layerShown, NO_TASK_FILTER, type CalColor, type TaskFilter } from '@shared/calendarLayers';
import type { CalendarSource } from '@shared/types';
import { setCalendarPrefs, setLayer, useCalendarPrefs } from '../lib/calendarPrefs';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { GoogleCalendarModal } from './GoogleCalendar';
import { Icon } from './Icon';
import { Select } from './pickers';
import { Seg } from './ui';

function LayerRow({ id, label, color, hint, on }: { id: string; label: string; color: CalColor; hint: string; on: boolean }) {
  return (
    <label className={`layer-row c-${color}`} title={hint}>
      <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setLayer(id, e.target.checked)} />
      <span className="layer-box" aria-hidden="true">
        <Icon name="check" size={13} />
      </span>
      <span className="layer-label">{label}</span>
    </label>
  );
}

/** the words of a filter that is set: "באיחור · לוגיסטיקה" */
function filterSummary(f: TaskFilter, names: { week: (id: number) => string; track: (id: number) => string; person: (id: number) => string }): string {
  return [
    f.scope === 'overdue' ? 'באיחור' : f.scope === 'urgent' ? 'דחופות' : '',
    f.linked ? 'משימות הכנה' : '',
    f.domain,
    f.weekId ? names.week(f.weekId) : '',
    f.trackId ? names.track(f.trackId) : '',
    f.ownerId ? names.person(f.ownerId) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function TaskFilterBox({ filter, staff }: { filter: TaskFilter; staff: boolean }) {
  const { settings, weeks, tracks, staff: people } = useSession();
  const set = (patch: Partial<TaskFilter>) => setCalendarPrefs((p) => ({ taskFilter: { ...p.taskFilter, ...patch } }));
  return (
    <div className="layer-filter col gap-6">
      <Seg
        value={filter.scope}
        onChange={(v) => set({ scope: v })}
        options={[
          { value: 'open', label: 'כל הפתוחות' },
          { value: 'urgent', label: 'דחופות' },
          { value: 'overdue', label: 'באיחור' },
        ]}
      />
      <label className="check small">
        <input type="checkbox" checked={filter.linked} onChange={(e) => set({ linked: e.target.checked })} /> רק משימות הכנה לאירועים
      </label>
      <Select className="select select-sm" value={filter.domain} onChange={(e) => set({ domain: e.target.value })} aria-label="תחום">
        <option value="">כל התחומים</option>
        {settings.domains.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Select>
      <Select className="select select-sm" value={filter.weekId ?? ''} onChange={(e) => set({ weekId: e.target.value ? Number(e.target.value) : null })} aria-label="שבוע">
        <option value="">כל השבועות</option>
        {weeks.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
      {tracks.length > 0 && (
        <Select className="select select-sm" value={filter.trackId ?? ''} onChange={(e) => set({ trackId: e.target.value ? Number(e.target.value) : null })} aria-label="ציר">
          <option value="">כל הצירים</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
      {staff && (
        <Select className="select select-sm" value={filter.ownerId ?? ''} onChange={(e) => set({ ownerId: e.target.value ? Number(e.target.value) : null })} aria-label="אחראי במשימות הסגל" searchable>
          <option value="">כל האחראים</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </Select>
      )}
      {isTaskFilterSet(filter) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCalendarPrefs({ taskFilter: NO_TASK_FILTER })}>
          ניקוי הסינון
        </button>
      )}
    </div>
  );
}

function Section({ id, title, children, action }: { id: 'mine' | 'other'; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const prefs = useCalendarPrefs();
  const open = !prefs.folded[id];
  const bodyId = `layers-${id}`;
  return (
    <section className={`layers${open ? ' open' : ''}`}>
      <div className="layers-head">
        <button
          type="button"
          className="layers-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setCalendarPrefs((p) => ({ folded: { ...p.folded, [id]: open } }))}
        >
          <span className="grow">{title}</span>
          <Icon name="chevronDown" size={16} className="layers-chev" />
        </button>
        {action}
      </div>
      <div className="layers-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** The calendar's layers in the side bar. */
export function CalendarLayers() {
  const { can, isCommander, weeks, tracks, users } = useSession();
  const prefs = useCalendarPrefs();
  const sources = useApi<CalendarSource[]>('/api/calendar/sources', ['events']);
  const [google, setGoogle] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // the staff's deadlines: for whoever may see all the tasks
  const layers = CORE_LAYERS.filter((l) => l.id !== 'staffTasks' || can('tasks'));
  const tasksOn = layerShown(prefs.layers, 'myTasks') || layerShown(prefs.layers, 'staffTasks');
  const summary = filterSummary(prefs.taskFilter, {
    week: (id) => weeks.find((w) => w.id === id)?.name ?? '',
    track: (id) => tracks.find((t) => t.id === id)?.name ?? '',
    person: (id) => users.find((u) => u.id === id)?.displayName ?? '',
  });

  return (
    <div className="side-layers">
      <Section id="mine" title="היומנים שלי">
        {layers.map((l) => (
          <div key={l.id}>
            <LayerRow id={l.id} label={l.label} color={l.color} hint={l.hint} on={layerShown(prefs.layers, l.id)} />
            {l.id === 'events' && layerShown(prefs.layers, 'events') && (
              <label className="layer-sub check small" title="רק האירועים שאתה אחראי עליהם או שיש לך בהם משימת הכנה">
                <input type="checkbox" checked={prefs.onlyMine} onChange={(e) => setCalendarPrefs({ onlyMine: e.target.checked })} /> רק האירועים שלי
              </label>
            )}
          </div>
        ))}
        {tasksOn && (
          <div className="layer-sub">
            <button type="button" className={`layer-filter-btn${summary ? ' is-set' : ''}`} aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
              <Icon name="filter" size={14} />
              <span className="grow">{summary || 'סינון הדד-ליינים'}</span>
              <Icon name="chevronDown" size={14} className="layers-chev" />
            </button>
            {filterOpen && <TaskFilterBox filter={prefs.taskFilter} staff={layerShown(prefs.layers, 'staffTasks') && can('tasks')} />}
          </div>
        )}
      </Section>
      <Section
        id="other"
        title="יומנים נוספים"
        action={
          <button
            type="button"
            className="icon-btn layers-add"
            onClick={() => setGoogle(true)}
            aria-label={isCommander ? 'חיבור יומן Google, או הוספת הלו"ז ליומן Google שלך' : 'הוספת הלו"ז ליומן Google שלך'}
            title={isCommander ? 'חיבור יומן Google / הוספה ליומן שלי' : 'הוספת הלו"ז ליומן Google שלך'}
          >
            <Icon name="plus" size={18} />
          </button>
        }
      >
        {(sources.data ?? []).map((s, i) => (
          <div key={s.id} className="layer-ext">
            <LayerRow id={`ext:${s.id}`} label={s.name} color={externalColor(i)} hint={s.calendarName && s.calendarName !== s.name ? `ב-Google: ${s.calendarName} · לקריאה בלבד` : 'יומן Google מחובר - לקריאה בלבד'} on={layerShown(prefs.layers, `ext:${s.id}`)} />
            {s.error && (
              <span className="layer-warn" title={s.error} aria-label={`שגיאה ביומן: ${s.error}`}>
                <Icon name="alert" size={14} />
              </span>
            )}
          </div>
        ))}
        {sources.data && sources.data.length === 0 && <p className="tiny muted layer-empty">{isCommander ? 'עדיין לא חובר יומן Google. + מחבר יומן לקריאה.' : 'עדיין לא חובר יומן Google.'}</p>}
        <button type="button" className="layer-link" onClick={() => setGoogle(true)}>
          <Icon name="share" size={14} /> הלו"ז ביומן Google שלי
        </button>
      </Section>
      {google && <GoogleCalendarModal onClose={() => setGoogle(false)} />}
    </div>
  );
}

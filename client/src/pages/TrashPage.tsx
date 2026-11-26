// The calendar's trash, as Google Calendar's: what was deleted in the last 30 days - an event, or the days
// of a series deleted together - each brought back, or deleted for good; and the trash emptied at once.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { shortDate, weekdayName } from '@shared/dates';
import type { TrashedEvent } from '@shared/types';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';

export function TrashPage() {
  const trash = useApi<TrashedEvent[]>('/api/events/trash', ['events']);
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const items = trash.data ?? [];

  const restore = async (t: TrashedEvent) => {
    try {
      const r = await api.post<{ restored: number }>(`/api/events/${t.id}/untrash`);
      emitLocalChange('events', 'tasks');
      toast({ title: r.restored > 1 ? `${r.restored} אירועים שוחזרו` : 'האירוע שוחזר', body: t.title, tone: 'green', action: { label: 'ליומן', run: () => navigate(`/?date=${t.date}`) } });
      void trash.reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const purge = async (list: TrashedEvent[]) => {
    const n = list.reduce((s, t) => s + t.count, 0);
    if (!(await ask({ title: list.length > 1 ? 'לרוקן את האשפה?' : 'למחוק לצמיתות?', body: `${n > 1 ? `${n} אירועים יימחקו` : 'האירוע יימחק'} ולא יהיה אפשר לשחזר.`, confirm: 'מחיקה לצמיתות', danger: true }))) return;
    setBusy(true);
    try {
      for (const t of list) await api.del(`/api/events/${t.id}/forever`);
      toast({ title: list.length > 1 ? 'האשפה רוקנה' : 'נמחק לצמיתות', tone: 'green' });
      emitLocalChange('events');
      void trash.reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow g-trash">
      <PageHead
        title="אשפה"
        sub="אירועים שנמחקו נשמרים כאן 30 יום, ואז נמחקים לצמיתות."
        actions={
          items.length > 0 && (
            <button type="button" className="btn" onClick={() => void purge(items)} disabled={busy}>
              <Icon name="trash" /> ריקון האשפה
            </button>
          )
        }
      />
      <ErrorBox error={trash.error} />
      {trash.loading && !trash.data ? (
        <Loading rows={4} />
      ) : !items.length ? (
        <Empty icon="trash" title="האשפה ריקה" text="אירוע שתמחק מהיומן יגיע לכאן, ואפשר יהיה להחזיר אותו." />
      ) : (
        <ul className="g-trash-list">
          {items.map((t) => (
            <li key={t.id} className="g-trash-row">
              <span className={`g-dot c-${t.calendar === 'personal' ? 'teal' : 'blue'}`} aria-hidden="true" />
              <span className="g-trash-when">
                {weekdayName(t.date)} {shortDate(t.date)}
                <span className="muted">{t.allDay ? ' · כל היום' : ` · ${t.startTime}`}</span>
              </span>
              <span className="grow g-trash-title">
                {t.title}
                <span className="tiny muted g-trash-by">
                  {t.count > 1 ? `${t.count} אירועים בסדרה · ` : ''}נמחק {fmtDateTime(t.deletedAt)}
                  {t.deletedByName ? ` · ${t.deletedByName}` : ''}
                </span>
              </span>
              <button type="button" className="icon-btn" onClick={() => void restore(t)} aria-label={`שחזור ${t.title}`} title="שחזור">
                <Icon name="history" />
              </button>
              <button type="button" className="icon-btn" onClick={() => void purge([t])} aria-label={`מחיקה לצמיתות של ${t.title}`} title="מחיקה לצמיתות" disabled={busy}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

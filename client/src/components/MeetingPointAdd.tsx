// A point for the next staff meeting (נקודה לישב"ס) from anywhere - the "+", the command palette: what
// one wants raised at the meeting. It waits on the meeting screen until the commander ticks it there.

import { useEffect, useState } from 'react';
import type { MeetingPoint } from '@shared/types';
import { api } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal } from './ui';

let openHost: (() => void) | null = null;

/** Opens the dialog (the host is mounted once, beside the screens) */
export function addMeetingPoint(): void {
  openHost?.();
}

export function MeetingPointAddHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openHost = () => setOpen(true);
    return () => {
      openHost = null;
    };
  }, []);
  return open ? <MeetingPointModal onClose={() => setOpen(false)} /> : null;
}

function MeetingPointModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { user, can } = useSession();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // what one already put in, still waiting: to see it is there, or take it back
  const points = useApi<MeetingPoint[]>('/api/meeting-points', ['meetings']);
  const mine = (points.data ?? []).filter((p) => !p.raisedAt && p.authorId === user.id);
  const remove = async (id: number) => {
    try {
      points.setData(await api.del<MeetingPoint[]>(`/api/meeting-points/${id}`));
      emitLocalChange('meetings');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    if (!body.trim()) return setError('מה להעלות בישיבת הסגל?');
    setBusy(true);
    setError(null);
    try {
      const list = await api.post<MeetingPoint[]>('/api/meeting-points', { body: body.trim() });
      emitLocalChange('meetings');
      const waiting = list.filter((p) => !p.raisedAt).length;
      toast({ title: 'הנקודה נוספה לישב"ס הבא', body: waiting > 1 ? `${waiting} נקודות מחכות לישיבה` : body.trim(), tone: 'green', link: can('meetings') ? '/meeting' : undefined });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title='נקודה לישב"ס'
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !body.trim()}>
            <Icon name="plus" /> הוספה לישיבה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <form
        className="col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="מה להעלות בישיבת הסגל" hint="הנקודה מחכה במסך ישיבת הסגל, ומפקד הקורס מסמן אותה כשהיא עולה בישיבה.">
          <textarea
            className="textarea"
            rows={3}
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="לדוגמה: תיאום הסעות לתרגיל של שבוע הבא"
            data-autofocus
          />
        </Field>
        <ErrorBox error={error} />
        {mine.length > 0 && (
          <div className="col gap-6">
            <span className="label-caps">שלך, מחכות לישיבה</span>
            {mine.map((p) => (
              <div key={p.id} className="row gap-6 small meeting-point-mine">
                <span className="grow">{p.body}</span>
                <span className="tiny muted">{fmtAgo(p.createdAt)}</span>
                <button type="button" className="icon-btn" onClick={() => void remove(p.id)} aria-label={`מחיקת הנקודה: ${p.body}`} title="מחיקה">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
    </Modal>
  );
}

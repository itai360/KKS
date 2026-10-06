// Status flow actions (section 47) with the dialogs each step needs:
// blockers (43, 80), approval (45-46), overdue response (61), requests (62-63).

import { useState, type ReactNode } from 'react';
import { BLOCK_REASONS, isOpenStatus, OTHER_DOMAIN, OVERDUE_RESPONSE_LABELS, OVERDUE_RESPONSES, PRIORITIES, PRIORITY_LABELS, VISIBILITIES, VISIBILITY_LABELS, type OverdueResponse, type Priority, type Visibility } from '@shared/constants';
import type { TaskDetail } from '@shared/types';
import { api } from '../lib/api';
import { dateKeyOf, fmtTime, isoAt } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { Icon } from './Icon';
import { DateTimeInputs, UserPicker } from './NewTask';
import { useToast } from './Toasts';
import { ErrorBox, Field, Modal, Seg, Select } from './ui';

type Dialog =
  | null
  | 'block'
  | 'complete'
  | 'return'
  | 'cancel'
  | 'reopen'
  | 'escalate'
  | 'deadline'
  | 'transfer'
  | 'edit'
  | 'delete'
  | 'clear'
  | 'unblock'
  | { overdue: OverdueResponse };

export function useTaskMutation(taskId: number, onDone: (d: TaskDetail) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<TaskDetail | void>, success?: string) => {
    setBusy(true);
    setError(null);
    try {
      const d = await fn();
      if (d) onDone(d);
      if (success) toast({ title: success, tone: 'green' });
      emitLocalChange('tasks');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run, taskId };
}

export function TaskActions({ detail, onChange, onDeleted }: { detail: TaskDetail; onChange: (d: TaskDetail) => void; onDeleted: () => void }) {
  const { task, permissions: p } = detail;
  const { isCommander, user } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const m = useTaskMutation(task.id, onChange);
  const open = isOpenStatus(task.status);
  const involved = task.ownerId === user.id || task.participantIds.includes(user.id);
  const needsApprovalToClose = task.requiresApproval && !p.canApprove;

  const transition = (body: object, success?: string) =>
    m.run(() => api.post<TaskDetail>(`/api/tasks/${task.id}/transition`, body), success).then((ok) => ok && setDialog(null));

  const buttons: ReactNode[] = [];
  if (p.canUpdateStatus && open) {
    if (task.status === 'todo')
      buttons.push(
        <button key="start" className="btn btn-primary" onClick={() => void transition({ action: 'start' }, 'הסטטוס עודכן ל"בטיפול"')} disabled={m.busy}>
          <Icon name="play" /> התחל טיפול
        </button>,
      );
    if (task.status !== 'pending_approval')
      buttons.push(
        <button key="complete" className={`btn ${task.status === 'todo' ? '' : 'btn-primary'}`} onClick={() => setDialog('complete')} disabled={m.busy}>
          <Icon name="check" /> {needsApprovalToClose ? 'בקש אישור סגירה' : 'הושלם'}
        </button>,
      );
    if (task.status === 'waiting')
      buttons.push(
        <button key="unblock" className="btn" onClick={() => setDialog('unblock')}>
          <Icon name="play" /> החסם טופל - חזרה לטיפול
        </button>,
      );
    if (task.status === 'todo' || task.status === 'in_progress' || task.status === 'waiting')
      buttons.push(
        <button key="block" className="btn" onClick={() => setDialog('block')}>
          <Icon name="pause" /> {task.status === 'waiting' ? 'עדכון חסם' : 'ממתין / חסום'}
        </button>,
      );
  }
  if (p.canApprove && task.status === 'pending_approval') {
    buttons.push(
      <button key="approve" className="btn btn-primary" onClick={() => void transition({ action: 'approve' }, 'המשימה אושרה ונסגרה')} disabled={m.busy}>
        <Icon name="check" /> אשר סגירה
      </button>,
      <button key="return" className="btn" onClick={() => setDialog('return')}>
        <Icon name="repeat" /> החזר להשלמה
      </button>,
    );
  }
  if (isCommander && task.status === 'waiting' && !p.canUpdateStatus) {
    buttons.push(
      <button key="unblock-c" className="btn" onClick={() => setDialog('unblock')}>
        סמן שהחסם טופל
      </button>,
    );
  }

  const secondary: ReactNode[] = [];
  if (p.canEdit) secondary.push(<button key="edit" className="btn btn-sm" onClick={() => setDialog('edit')}><Icon name="edit" /> עריכה</button>);
  else if (p.canChangeDeadline || p.canChangeOwner) secondary.push(<button key="edit" className="btn btn-sm" onClick={() => setDialog('edit')}><Icon name="edit" /> שינוי</button>);
  if (p.canRequestDeadline) secondary.push(<button key="dl" className="btn btn-sm" onClick={() => setDialog('deadline')}><Icon name="clock" /> בקש שינוי דד-ליין</button>);
  if (p.canRequestTransfer) secondary.push(<button key="tr" className="btn btn-sm" onClick={() => setDialog('transfer')}><Icon name="users" /> בקש העברת אחריות</button>);
  if (open && involved && !task.needsCommander && !isCommander) secondary.push(<button key="esc" className="btn btn-sm" onClick={() => setDialog('escalate')}><Icon name="hand" /> נדרשת החלטת מפקד</button>);
  if (isCommander && task.needsCommander) secondary.push(<button key="clear" className="btn btn-sm" onClick={() => setDialog('clear')}><Icon name="check" /> סמן שהטיפול שלי הסתיים</button>);
  if (p.canCancel && open) secondary.push(<button key="cancel" className="btn btn-sm btn-danger" onClick={() => setDialog('cancel')}>ביטול משימה</button>);
  if ((p.canEdit || p.canApprove) && !open) secondary.push(<button key="reopen" className="btn btn-sm" onClick={() => setDialog('reopen')}><Icon name="repeat" /> פתח מחדש</button>);
  if (p.canDelete) secondary.push(<button key="del" className="btn btn-sm btn-ghost text-red" onClick={() => setDialog('delete')}><Icon name="trash" /> מחיקה</button>);

  return (
    <>
      {task.overdue && involved && (
        <div className="card card-pad t-red" style={{ borderColor: 'var(--red)', marginBottom: 14 }}>
          <div className="row wrap">
            <Icon name="alert" className="text-red" />
            <div className="grow">
              <div className="strong text-red">המשימה באיחור</div>
              <div className="small muted">
                {task.overdueResponse ? `דיווחת: ${OVERDUE_RESPONSE_LABELS[task.overdueResponse]}. אפשר לעדכן:` : 'מה המצב? בחר אחת מהאפשרויות:'}
              </div>
            </div>
          </div>
          <div className="chips mt-12">
            {OVERDUE_RESPONSES.map((r) => (
              <button
                key={r}
                className={`chip${task.overdueResponse === r ? ' on' : ''}`}
                onClick={() => {
                  if (r === 'new_deadline' && p.canRequestDeadline) setDialog('deadline');
                  else if (r === 'new_deadline' && p.canChangeDeadline) setDialog('edit');
                  else if (r === 'blocked') setDialog('block');
                  else setDialog({ overdue: r });
                }}
              >
                {OVERDUE_RESPONSE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      )}
      {buttons.length > 0 && <div className="row wrap gap-6">{buttons}</div>}
      {secondary.length > 0 && <div className="row wrap gap-6 mt-12">{secondary}</div>}
      {!dialog && <ErrorBox error={m.error} />}

      {dialog === 'block' && <BlockDialog detail={detail} m={m} onClose={() => setDialog(null)} onSubmit={(body) => transition({ action: 'block', ...body }, 'החסם נרשם')} />}
      {dialog === 'complete' && (
        <NoteDialog
          title={needsApprovalToClose ? 'בקשת אישור סגירה' : 'סימון המשימה כהושלמה'}
          label="הערת סיום (לא חובה)"
          placeholder="מה בוצע, איפה נמצא התוצר..."
          submitLabel={needsApprovalToClose ? 'שלח לאישור' : 'הושלם'}
          m={m}
          onClose={() => setDialog(null)}
          onSubmit={(note) => transition({ action: 'complete', note: note || undefined }, needsApprovalToClose ? 'נשלח לאישור מפקד' : 'המשימה הושלמה')}
          extra={detail.task.openDependencies > 0 ? <div className="info-box">שים לב: המשימה תלויה ב-{detail.task.openDependencies} משימות שעדיין פתוחות.</div> : undefined}
        />
      )}
      {dialog === 'unblock' && (
        <NoteDialog title="החסם טופל" label="מה השתנה? (לא חובה)" submitLabel="חזרה לטיפול" m={m} onClose={() => setDialog(null)} onSubmit={(note) => transition({ action: 'unblock', note: note || undefined }, 'המשימה חזרה לטיפול')} />
      )}
      {dialog === 'return' && (
        <NoteDialog title="החזרה להשלמה" label="מה חסר?" required placeholder="לדוגמה: חסר תיאום רפואה. לאחר עדכון ניתן לסגור." submitLabel="החזר להשלמה" m={m} onClose={() => setDialog(null)} onSubmit={(note) => transition({ action: 'return', note }, 'המשימה הוחזרה להשלמה')} />
      )}
      {dialog === 'cancel' && (
        <NoteDialog title="ביטול משימה" label="סיבת ביטול" required submitLabel="בטל משימה" danger m={m} onClose={() => setDialog(null)} onSubmit={(reason) => transition({ action: 'cancel', reason }, 'המשימה בוטלה')} />
      )}
      {dialog === 'reopen' && (
        <NoteDialog title="פתיחה מחדש" label="הערה (לא חובה)" submitLabel="פתח מחדש" m={m} onClose={() => setDialog(null)} onSubmit={(note) => transition({ action: 'reopen', note: note || undefined }, 'המשימה נפתחה מחדש')} />
      )}
      {dialog === 'escalate' && (
        <NoteDialog title="נדרשת החלטת מפקד" label="איזו החלטה נדרשת?" required submitLabel="שלח למפקד" m={m} onClose={() => setDialog(null)} onSubmit={(note) => transition({ action: 'escalate', note }, 'הבקשה הועברה למפקד הקורס')} />
      )}
      {dialog === 'clear' && (
        <NoteDialog title="סיום טיפול מפקד" label="הנחיה לאחראי (לא חובה)" submitLabel="סמן כמטופל" m={m} onClose={() => setDialog(null)} onSubmit={(note) => transition({ action: 'clear_attention', note: note || undefined }, 'סומן כמטופל')} />
      )}
      {typeof dialog === 'object' && dialog && 'overdue' in dialog && (
        <NoteDialog
          title={OVERDUE_RESPONSE_LABELS[dialog.overdue]}
          label={dialog.overdue === 'decision' ? 'איזו החלטה נדרשת?' : 'הערה (לא חובה)'}
          required={dialog.overdue === 'decision'}
          submitLabel="עדכן"
          m={m}
          onClose={() => setDialog(null)}
          onSubmit={(note) =>
            m
              .run(() => api.post<TaskDetail>(`/api/tasks/${task.id}/overdue-response`, { response: dialog.overdue, note: note || undefined }), 'העדכון נשמר')
              .then((ok) => ok && setDialog(null))
          }
        />
      )}
      {dialog === 'deadline' && <DeadlineRequestDialog detail={detail} m={m} onClose={() => setDialog(null)} />}
      {dialog === 'transfer' && <TransferRequestDialog detail={detail} m={m} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditTaskDialog detail={detail} m={m} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <Modal
          title="מחיקת משימה"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button
                className="btn btn-danger"
                disabled={m.busy}
                onClick={() =>
                  void m
                    .run(async () => {
                      await api.del(`/api/tasks/${task.id}`);
                    }, 'המשימה נמחקה')
                    .then((ok) => ok && onDeleted())
                }
              >
                מחק לצמיתות
              </button>
              <button className="btn btn-ghost" onClick={() => setDialog(null)}>
                ביטול
              </button>
            </>
          }
        >
          <p>
            למחוק את "<b>{task.title}</b>"? הפעולה תירשם ביומן. אם המשימה פשוט לא נדרשת - עדיף <b>לבטל</b> אותה עם סיבה.
          </p>
          <ErrorBox error={m.error} />
        </Modal>
      )}
    </>
  );
}

type Mut = ReturnType<typeof useTaskMutation>;

export function NoteDialog({
  title,
  label,
  required,
  placeholder,
  submitLabel,
  danger,
  m,
  onClose,
  onSubmit,
  extra,
}: {
  title: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  submitLabel: string;
  danger?: boolean;
  m: { busy: boolean; error: string | null };
  onClose: () => void;
  onSubmit: (note: string) => void;
  extra?: ReactNode;
}) {
  const [note, setNote] = useState('');
  const ok = !required || note.trim().length >= 2;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ok || m.busy} onClick={() => onSubmit(note.trim())}>
            {submitLabel}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col">
        {extra}
        <Field label={label} required={required}>
          <textarea
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={placeholder}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) onSubmit(note.trim());
            }}
          />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function BlockDialog({ detail, m, onClose, onSubmit }: { detail: TaskDetail; m: Mut; onClose: () => void; onSubmit: (b: object) => void }) {
  const t = detail.task;
  const [reason, setReason] = useState<string>(t.blockReason ?? '');
  const [waitingFor, setWaitingFor] = useState(t.blockWaitingFor ?? '');
  const [nextStep, setNextStep] = useState(t.blockNextStep ?? '');
  const [needsCommander, setNeedsCommander] = useState<'yes' | 'no'>(t.needsCommander ? 'yes' : 'no');
  const ok = reason && waitingFor.trim().length >= 2 && nextStep.trim().length >= 2;
  return (
    <Modal
      title="ממתין / חסום"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!ok || m.busy} onClick={() => onSubmit({ reason, waitingFor: waitingFor.trim(), nextStep: nextStep.trim(), needsCommander: needsCommander === 'yes' })}>
            שמור חסם
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="info-box">אין חסם בלי הסבר: למה, למי ממתינים ומה הצעד הבא.</div>
        <Field label="סיבה" required>
          <div className="chips">
            {BLOCK_REASONS.map((r) => (
              <button key={r} type="button" className={`chip${reason === r ? ' on' : ''}`} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        </Field>
        <Field label="למי ממתינים?" required>
          <input className="input" value={waitingFor} onChange={(e) => setWaitingFor(e.target.value)} placeholder="לדוגמה: מדריך ירי / המרפאה / מדור תחמושת" />
        </Field>
        <Field label="מה הצעד הבא?" required>
          <input className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="לדוגמה: תזכורת טלפונית מחר ב-09:00" />
        </Field>
        <Field label="נדרשת התערבות מפקד הקורס?">
          <Seg value={needsCommander} onChange={setNeedsCommander} options={[{ value: 'no', label: 'לא' }, { value: 'yes', label: 'כן - להציף למפקד' }]} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function DeadlineRequestDialog({ detail, m, onClose }: { detail: TaskDetail; m: Mut; onClose: () => void }) {
  const t = detail.task;
  const [date, setDate] = useState(dateKeyOf(t.deadline));
  const [time, setTime] = useState(fmtTime(t.deadline));
  const [reason, setReason] = useState('');
  const ok = date && time && reason.trim().length >= 2;
  return (
    <Modal
      title="בקשת שינוי דד-ליין"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={!ok || m.busy}
            onClick={() =>
              void m
                .run(() => api.post<TaskDetail>(`/api/tasks/${t.id}/requests`, { type: 'deadline', newDeadline: isoAt(date, time), reason: reason.trim() }), 'הבקשה נשלחה לאישור')
                .then((r) => r && onClose())
            }
          >
            שלח בקשה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="דד-ליין חדש" required>
          <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
        </Field>
        <Field label="סיבה" required>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למה נדרשת הארכה?" />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function TransferRequestDialog({ detail, m, onClose }: { detail: TaskDetail; m: Mut; onClose: () => void }) {
  const t = detail.task;
  const [owner, setOwner] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const ok = owner.length === 1 && owner[0] !== t.ownerId && reason.trim().length >= 2;
  return (
    <Modal
      title="בקשת העברת אחריות"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={!ok || m.busy}
            onClick={() =>
              void m
                .run(() => api.post<TaskDetail>(`/api/tasks/${t.id}/requests`, { type: 'transfer', newOwnerId: owner[0], reason: reason.trim() }), 'הבקשה נשלחה לאישור')
                .then((r) => r && onClose())
            }
          >
            שלח בקשה
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="להעביר אל" required>
          <UserPicker value={owner} onChange={setOwner} multiple={false} date={dateKeyOf(t.deadline)} />
        </Field>
        <Field label="סיבה" required>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function EditTaskDialog({ detail, m, onClose }: { detail: TaskDetail; m: Mut; onClose: () => void }) {
  const { task: t, permissions: p } = detail;
  const { settings, weeks, tracks } = useSession();
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [owner, setOwner] = useState<number[]>([t.ownerId]);
  const [participants, setParticipants] = useState<number[]>(t.participantIds);
  const [date, setDate] = useState(dateKeyOf(t.deadline));
  const [time, setTime] = useState(fmtTime(t.deadline));
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [domain, setDomain] = useState(t.domain);
  const [domainNote, setDomainNote] = useState(t.domainNote);
  const [weekId, setWeekId] = useState(t.weekId ? String(t.weekId) : '');
  const [trackId, setTrackId] = useState(t.trackId ? String(t.trackId) : '');
  const [visibility, setVisibility] = useState<Visibility>(t.visibility);
  const [requiresApproval, setRequiresApproval] = useState(t.requiresApproval);

  const save = () => {
    const patch: Record<string, unknown> = {};
    if (p.canEdit) {
      if (title.trim() !== t.title) patch.title = title.trim();
      if (description !== t.description) patch.description = description;
      if (priority !== t.priority) patch.priority = priority;
      if (domain !== t.domain) patch.domain = domain;
      const note = domain === OTHER_DOMAIN ? domainNote.trim() : '';
      if (note !== t.domainNote) patch.domainNote = note;
      const w = weekId ? Number(weekId) : null;
      if (w !== t.weekId) patch.weekId = w;
      const tr = trackId ? Number(trackId) : null;
      if (tr !== t.trackId) patch.trackId = tr;
      if (visibility !== t.visibility) patch.visibility = visibility;
      if (requiresApproval !== t.requiresApproval) patch.requiresApproval = requiresApproval;
      const parts = participants.filter((x) => x !== owner[0]);
      if (parts.join(',') !== t.participantIds.join(',')) patch.participantIds = parts;
    }
    if (p.canChangeDeadline) {
      if (!date || !time) return m.setError('יש לבחור תאריך ושעה לדד-ליין');
      const iso = isoAt(date, time);
      if (iso !== t.deadline) patch.deadline = iso;
    }
    if (p.canChangeOwner && owner[0] && owner[0] !== t.ownerId) patch.ownerId = owner[0];
    if (!Object.keys(patch).length) return onClose();
    void m.run(() => api.patch<TaskDetail>(`/api/tasks/${t.id}`, patch), 'השינויים נשמרו').then((ok) => ok && onClose());
  };

  return (
    <Modal
      title="עריכת משימה"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-primary" onClick={save} disabled={m.busy}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        {p.canEdit && (
          <>
            <Field label="שם המשימה" required className="span-2">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="פירוט" className="span-2">
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </>
        )}
        {p.canChangeOwner && (
          <Field label="אחראי ראשי" className="span-2" hint="השינוי יירשם: מי היה האחראי, מי החדש, מי שינה ומתי">
            <UserPicker value={owner} onChange={setOwner} multiple={false} date={date} />
          </Field>
        )}
        {p.canEdit && (
          <Field label="משתתפים נוספים" className="span-2">
            <UserPicker value={participants.filter((x) => x !== owner[0])} onChange={setParticipants} />
          </Field>
        )}
        {p.canChangeDeadline && (
          <Field label="דד-ליין" required>
            <DateTimeInputs date={date} time={time} onDate={setDate} onTime={setTime} />
          </Field>
        )}
        {p.canEdit && (
          <>
            <Field label="עדיפות">
              <Select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {PRIORITY_LABELS[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="תחום">
              <Select className="select" value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="">ללא</option>
                {settings.domains.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            {domain === OTHER_DOMAIN && (
              <Field label="איזה תחום?">
                <input className="input" value={domainNote} onChange={(e) => setDomainNote(e.target.value)} maxLength={120} placeholder="לדוגמה: תקשוב, טקסים, רווחה" />
              </Field>
            )}
            <Field label="שבוע בקורס">
              <Select className="select" value={weekId} onChange={(e) => setWeekId(e.target.value)}>
                <option value="">ללא שבוע</option>
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ציר בקורס">
              <Select className="select" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
                <option value="">ללא ציר</option>
                {tracks.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="נראות">
              <Select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="check span-2">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
              נדרש אישור מפקד לסגירה
            </label>
          </>
        )}
      </div>
      <div className="mt-12">
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

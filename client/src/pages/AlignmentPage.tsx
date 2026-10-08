// "יישור קו": the staff's WhatsApp group inside the system - every message, searchable, the
// important ones pinned. WhatsApp lets no other system read a group, so the messages come from
// its own chat export: shared from WhatsApp straight here (Android, with the app installed),
// uploaded as a file, or pasted. Only new messages are added (server/src/alignment.ts).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { longDate } from '@shared/dates';
import type { AlignmentFeed, AlignmentImport, AlignmentMessage } from '@shared/types';
import { ask } from '../components/Confirm';
import { Highlight } from '../components/Highlight';
import { useNewTask } from '../components/NewTask';
import { Icon } from '../components/Icon';
import { useRowMenu, type RowMenuItem } from '../components/RowMenu';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Loading, Modal, PageHead, initials } from '../components/ui';
import { api } from '../lib/api';
import { dateKeyOf, fmtAgo, fmtTime, todayKey } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** the text with its links clickable - and what was searched for marked */
function linkify(text: string, q = ''): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" dir="ltr">
        {part}
      </a>
    ) : (
      <Highlight key={i} text={part} q={q} />
    ),
  );
}

const newCount = (n: number) => (n === 1 ? 'נוספה הודעה חדשה אחת' : `נוספו ${n} הודעות חדשות`);
const added = (r: AlignmentImport) => (r.added ? `${newCount(r.added)}${r.existing ? ` (${r.existing} כבר היו)` : ''}` : 'כל ההודעות כבר היו כאן');

export function AlignmentPage() {
  const { isCommander, viewing } = useSession();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading } = useApi<AlignmentFeed>(`/api/alignment${query ? `?q=${encodeURIComponent(query)}` : ''}`, ['alignment', 'users']);
  const [older, setOlder] = useState<AlignmentMessage[]>([]);
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null);
  const [busyOlder, setBusyOlder] = useState(false);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const newTask = useNewTask();
  const canManage = isCommander && !viewing;
  // an instruction in the group becomes a task: the message is read like a typed task (who, by when)
  const toTask = (m: AlignmentMessage) =>
    newTask({
      heading: 'משימה מיישור קו',
      text: m.body.replace(/\s+/g, ' ').trim().slice(0, 300),
      description: `מתוך "יישור קו" - ${m.userName ?? m.sender}, ${longDate(dateKeyOf(m.sentAt))} ${fmtTime(m.sentAt)}:\n${m.body}`,
    });

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setOlder([]);
    setMoreOlder(null);
  }, [query]);

  // back from sharing the chat from WhatsApp
  const shareSeen = useRef(false);
  useEffect(() => {
    const s = params.get('share');
    if (!s || shareSeen.current) return;
    shareSeen.current = true;
    if (s === 'ok') {
      const n = Number(params.get('added'));
      toast({ title: n ? `${newCount(n)} מהוואטסאפ` : 'כל ההודעות כבר היו כאן', tone: 'green' });
    } else if (s === 'login') toast({ title: 'כדי לשתף צריך להיות מחוברים. אחרי ההתחברות - שתפו שוב מהוואטסאפ.', tone: 'red' });
    else toast({ title: params.get('msg') || 'השיתוף לא הצליח', tone: 'red' });
    setParams({}, { replace: true });
  }, [params, setParams, toast]);

  // on screen counts as seen: the menu's count of new messages clears
  const seenAt = useRef('');
  useEffect(() => {
    const mark = data?.lastImport?.at ?? '';
    if (!data || viewing || query || seenAt.current === mark) return;
    seenAt.current = mark;
    void api
      .post('/api/alignment/seen', {})
      .then(() => emitLocalChange('alignment-seen'))
      .catch(() => (seenAt.current = ''));
  }, [data, viewing, query]);

  const all = [...older, ...(data?.messages ?? [])];
  const hasMore = !query && (moreOlder ?? data?.more ?? false);
  const loadOlder = async () => {
    const first = all[0];
    if (!first) return;
    setBusyOlder(true);
    try {
      const r = await api.get<AlignmentFeed>(`/api/alignment?before=${encodeURIComponent(first.sentAt)}&id=${first.id}`);
      setOlder((o) => [...r.messages, ...o]);
      setMoreOlder(r.more);
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusyOlder(false);
    }
  };

  // newest day first; within a day, in the order they were written
  const days: [string, AlignmentMessage[]][] = [];
  for (const m of all) {
    const key = dateKeyOf(m.sentAt);
    const last = days[days.length - 1];
    if (last && last[0] === key) last[1].push(m);
    else days.push([key, [m]]);
  }
  days.reverse();

  const pin = async (m: AlignmentMessage) => {
    try {
      await api.post(`/api/alignment/${m.id}/pin`, { pinned: !m.pinned });
      emitLocalChange('alignment');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const remove = async (m: AlignmentMessage) => {
    if (!(await ask({ title: 'להסיר את ההודעה מהדף?', body: 'היא תישאר בוואטסאפ. בעדכון הבא מהוואטסאפ היא תתווסף שוב.', confirm: 'הסרה', danger: true }))) return;
    try {
      await api.del(`/api/alignment/${m.id}`);
      setOlder((o) => o.filter((x) => x.id !== m.id));
      emitLocalChange('alignment');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };

  const today = todayKey();
  return (
    <div className="page narrow">
      <PageHead
        title="יישור קו"
        sub="ההודעות מקבוצת הוואטסאפ של הסגל - במקום אחד, עם חיפוש."
        actions={
          !viewing && (
            <button className="btn btn-primary" onClick={() => setImporting(true)}>
              <Icon name="download" /> עדכון מהוואטסאפ
            </button>
          )
        }
      />
      {data?.lastImport && (
        <div className="tiny muted mb-12">
          {data.total} הודעות · עודכן {fmtAgo(data.lastImport.at)}
          {data.lastImport.byName && ` על ידי ${data.lastImport.byName}`}
        </div>
      )}
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading rows={4} />
      ) : !data?.total ? (
        <Empty
          icon="message"
          title="עוד אין הודעות"
          text={'כאן יופיעו ההודעות מקבוצת "יישור קו" בוואטסאפ. בוואטסאפ: בקבוצה ← ⋮ ← עוד ← ייצוא צ׳אט ← ללא מדיה, ולשתף לכאן - או "עדכון מהוואטסאפ" למעלה.'}
        />
      ) : (
        <div className="col gap-16">
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בהודעות או לפי שם..." aria-label="חיפוש בהודעות" />
          {!query && data.pinned.length > 0 && (
            <section className="card" aria-label="הודעות מוצמדות">
              <div className="card-head">
                <Icon name="pin" />
                <h3 className="grow">מוצמדות</h3>
              </div>
              {data.pinned.map((m) => (
                <Message key={m.id} m={m} withDay canManage={canManage} q={query} onTask={viewing ? undefined : () => toTask(m)} onPin={() => void pin(m)} onRemove={() => void remove(m)} />
              ))}
            </section>
          )}
          {query && !all.length && <Empty icon="search" title="לא נמצאו הודעות" />}
          {days.map(([day, list]) => (
            <section key={day} className="card" aria-label={longDate(day)}>
              <div className="card-head">
                <h3 className="grow">{day === today ? 'היום' : longDate(day)}</h3>
                <span className="tiny mono muted">{list.length}</span>
              </div>
              {list.map((m) => (
                <Message key={m.id} m={m} canManage={canManage} q={query} onTask={viewing ? undefined : () => toTask(m)} onPin={() => void pin(m)} onRemove={() => void remove(m)} />
              ))}
            </section>
          ))}
          {hasMore && (
            <button className="btn" onClick={() => void loadOlder()} disabled={busyOlder}>
              {busyOlder ? 'טוען...' : 'הודעות קודמות'}
            </button>
          )}
        </div>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(r) => toast({ title: added(r), tone: 'green' })} />}
    </div>
  );
}

function Message({ m, withDay, canManage, q, onTask, onPin, onRemove }: { m: AlignmentMessage; withDay?: boolean; canManage: boolean; q: string; onTask?: () => void; onPin: () => void; onRemove: () => void }) {
  const name = m.userName ?? m.sender;
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.body);
      toast({ title: 'ההודעה הועתקה', tone: 'green' });
    } catch {
      toast({ title: 'לא ניתן להעתיק כאן - אפשר לסמן את הטקסט ולהעתיק', tone: 'gray' });
    }
  };
  // held (a phone) or right-clicked (a computer): what is done with a message, without hunting for its small buttons
  const items: RowMenuItem[] = [
    ...(onTask && m.body ? [{ key: 'task', label: 'משימה מההודעה', icon: 'tasks', primary: true, run: onTask }] : []),
    ...(m.body ? [{ key: 'copy', label: 'העתקת ההודעה', icon: 'copy', run: () => void copy() }] : []),
    ...(canManage ? [{ key: 'pin', label: m.pinned ? 'ביטול הצמדה' : 'הצמדה למעלה', icon: 'pin', run: onPin }] : []),
    ...(canManage ? [{ key: 'remove', label: 'הסרה מהדף', icon: 'trash', run: onRemove }] : []),
  ];
  const menu = useRowMenu({ title: `${name}, ${fmtTime(m.sentAt)}`, items, disabled: !items.length, links: false });
  return (
    <div className={`al-msg holdable${menu.lifted ? ' is-lifted' : ''}`} {...menu.bind}>
      <span className="avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="al-meta">
          <span className="strong small">
            <Highlight text={name} q={q} />
          </span>
          <span className="tiny muted mono">
            {withDay ? `${longDate(dateKeyOf(m.sentAt))} ` : ''}
            {fmtTime(m.sentAt)}
          </span>
        </div>
        {m.body && <div className="al-body">{linkify(m.body, q)}</div>}
        {m.media && (
          <div className="tiny muted al-media">
            <Icon name="clip" size={12} /> קובץ או תמונה (לא נכללו בייצוא מהוואטסאפ)
          </div>
        )}
      </div>
      {(onTask || canManage) && (
        <div className="al-actions">
          {onTask && m.body && (
            <button className="icon-btn" onClick={onTask} aria-label="משימה מההודעה" title="משימה מההודעה">
              <Icon name="tasks" size={15} />
            </button>
          )}
          {canManage && (
            <>
              <button className={`icon-btn${m.pinned ? ' on' : ''}`} onClick={onPin} aria-pressed={m.pinned} aria-label={m.pinned ? 'ביטול הצמדה' : 'הצמדה למעלה'} title={m.pinned ? 'ביטול הצמדה' : 'הצמדה למעלה'}>
                <Icon name="pin" size={15} />
              </button>
              <button className="icon-btn" onClick={onRemove} aria-label="הסרה מהדף" title="הסרה מהדף">
                <Icon name="trash" size={15} />
              </button>
            </>
          )}
        </div>
      )}
      {menu.menu}
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: AlignmentImport) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<AlignmentImport>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      emitLocalChange('alignment');
      onDone(r);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="עדכון מהוואטסאפ" onClose={onClose}>
      <div className="col gap-16">
        <ol className="al-steps small">
          <li>
            <b>אנדרואיד:</b> בקבוצה בוואטסאפ ← ⋮ ← עוד ← ייצוא צ׳אט ← ללא מדיה ← לבחור באפליקציה של הקורס (כשהיא מותקנת במסך הבית). ההודעות נכנסות לבד.
          </li>
          <li>
            <b>אייפון:</b> בקבוצה ← שם הקבוצה למעלה ← ייצוא צ׳אט ← ללא מדיה ← שמירה ב&quot;קבצים&quot;, ואז להעלות כאן.
          </li>
          <li>
            <b>מחשב:</b> לסמן הודעות בוואטסאפ, להעתיק ולהדביק כאן.
          </li>
        </ol>
        <p className="tiny muted">נוספות רק הודעות חדשות, אז אפשר לייצא בכל פעם את כל הצ׳אט.</p>
        <div>
          <input
            ref={file}
            type="file"
            accept=".txt,.zip,text/plain,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run(() => api.upload<AlignmentImport>('/api/alignment/import/file', f));
            }}
          />
          <button className="btn" onClick={() => file.current?.click()} disabled={busy}>
            <Icon name="upload" /> העלאת קובץ הייצוא (txt או zip)
          </button>
        </div>
        <label className="col gap-6">
          <span className="small strong">או הדבקת הודעות</span>
          <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="[14:05, 3.10.2026] דנה: ..." dir="auto" />
        </label>
        <ErrorBox error={error} />
        <div className="row gap-6">
          <button className="btn btn-primary" onClick={() => void run(() => api.post<AlignmentImport>('/api/alignment/import', { text }))} disabled={busy || !text.trim()}>
            {busy ? 'מעדכן...' : 'הוספת ההודעות'}
          </button>
        </div>
      </div>
    </Modal>
  );
}


// Section 31 - documents: procedures, orders, presentations, training material, links.

import { useRef, useState } from 'react';
import { DOCUMENT_CATEGORIES } from '@shared/constants';
import type { CourseDocument } from '@shared/types';
import { BulkCheck, BulkScope, BulkToggle, SwipeRow, useBulk } from '../components/Bulk';
import { Icon } from '../components/Icon';
import { useRowMenu, type RowMenuItem } from '../components/RowMenu';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, Select } from '../components/ui';
import { api, qs } from '../lib/api';
import { fileSize, fmtAgo } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { safeUrl } from '../lib/safeUrl';
import { ask } from '../components/Confirm';

/** the documents this person opened last, on this device - the first ones back at the top of the library */
const recentKey = (userId: number) => `kks.docs.recent.${userId}`;
function readRecent(userId: number): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}
function noteOpened(userId: number, id: number): void {
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify([id, ...readRecent(userId).filter((x) => x !== id)].slice(0, 6)));
  } catch {
    /* not kept */
  }
}
/** a document's address to share: a file's is the app's own */
const shareUrl = (d: CourseDocument) => (d.url.startsWith('/') ? `${location.origin}${d.url}` : d.url);

export function DocumentsPage() {
  const { user } = useSession();
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi<CourseDocument[]>(`/api/documents${qs({ category, q })}`, ['documents']);
  // the whole library: how many in each category, and what was opened last
  const all = useApi<CourseDocument[]>('/api/documents', ['documents']).data;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CourseDocument | null>(null);
  const [recentIds, setRecentIds] = useState(() => readRecent(user.id));
  const opened = (d: CourseDocument) => {
    noteOpened(user.id, d.id);
    setRecentIds(readRecent(user.id));
  };
  const recent = recentIds.map((id) => all?.find((d) => d.id === id)).filter((d): d is CourseDocument => !!d).slice(0, 4);
  const count = (c: string) => (all ?? []).filter((d) => d.category === c).length;
  const pinned = (data ?? []).filter((d) => d.pinned);
  const rest = (data ?? []).filter((d) => !d.pinned);

  return (
    <BulkScope
      entity="documents"
      noun="מסמכים"
      topics={['documents']}
      ids={(data ?? []).filter((d) => d.canEdit).map((d) => d.id)}
      actions={[
        { key: 'category', label: 'קטגוריה', ask: { title: 'העברה לקטגוריה', label: 'קטגוריה', options: DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: c })) } },
        { key: 'pin', label: 'הצמדה', icon: 'pin', value: true },
        { key: 'pin', label: 'ביטול הצמדה', value: false },
        { key: 'delete', label: 'מחיקה', icon: 'trash', danger: true, confirm: 'למחוק {n} מסמכים?' },
      ]}
    >
    <div className="page">
      <PageHead
        title="מסמכים"
        sub="נהלים, פקודות, מצגות, חומרי הדרכה וקישורים - במקום אחד, בלי לחפש בקבוצות וואטסאפ."
        actions={
          <>
            <BulkToggle />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> מסמך
            </button>
          </>
        }
      />
      <div className="chips chips-scroll mb-12">
        <button className={`chip${!category ? ' on' : ''}`} onClick={() => setCategory('')}>
          הכל {all && <span className="mono tiny">{all.length}</span>}
        </button>
        {DOCUMENT_CATEGORIES.map((c) => (
          <button key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
            {c} {all && <span className="mono tiny">{count(c)}</span>}
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="input" placeholder="חיפוש מסמך..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      {/* opened lately: one tap back to them */}
      {!category && !q && recent.length > 0 && (
        <div className="doc-recent" aria-label="פתחת לאחרונה">
          <span className="label-caps">פתחת לאחרונה</span>
          <div className="chips">
            {recent.map((d) => (
              <a key={d.id} className="chip doc-recent-chip" href={safeUrl(d.url)} target="_blank" rel="noreferrer noopener" onClick={() => opened(d)}>
                <Icon name={d.kind === 'file' ? 'file' : 'link'} size={14} />
                <span className="clip-text">{d.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}
      {loading && !data ? (
        <Loading rows={3} />
      ) : !data?.length ? (
        <Empty icon="file" title="אין מסמכים" text="העלו קבצים או הוסיפו קישורים לדרייב." />
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <div className="group-title">
                <Icon name="pin" size={14} />
                <span>מוצמדים</span>
                <span className="line" />
              </div>
              <DocGrid docs={pinned} onEdit={setEditing} onOpened={opened} />
            </>
          )}
          {rest.length > 0 && (
            <>
              {pinned.length > 0 && (
                <div className="group-title">
                  <span>כל המסמכים</span>
                  <span className="line" />
                </div>
              )}
              <DocGrid docs={rest} onEdit={setEditing} onOpened={opened} />
            </>
          )}
        </>
      )}
      {adding && <DocForm onClose={() => setAdding(false)} />}
      {editing && <DocForm doc={editing} onClose={() => setEditing(null)} />}
    </div>
    </BulkScope>
  );
}

function DocGrid({ docs, onEdit, onOpened }: { docs: CourseDocument[]; onEdit: (d: CourseDocument) => void; onOpened: (d: CourseDocument) => void }) {
  return (
    <div className="grid-3">
      {docs.map((d) => (
        <SwipeRow key={d.id} itemId={d.id} label={d.title}>
          <DocCard d={d} onEdit={() => onEdit(d)} onOpened={() => onOpened(d)} />
        </SwipeRow>
      ))}
    </div>
  );
}

/** A document: the whole card opens it; held or right-clicked - open, copy its link, pin, edit, delete. */
function DocCard({ d, onEdit, onOpened }: { d: CourseDocument; onEdit: () => void; onOpened: () => void }) {
  const { isCommander } = useSession();
  const toast = useToast();
  const bulk = useBulk();
  const open = () => {
    onOpened();
    window.open(safeUrl(d.url), '_blank', 'noopener');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(d));
      toast({ title: 'הקישור הועתק', tone: 'green' });
    } catch {
      toast({ title: shareUrl(d), tone: 'gray' });
    }
  };
  const pin = async () => {
    try {
      await api.patch(`/api/documents/${d.id}`, { pinned: !d.pinned });
      emitLocalChange('documents');
      toast({ title: d.pinned ? 'ההצמדה בוטלה' : 'הוצמד לראש הספרייה', tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const remove = async () => {
    if (!(await ask({ title: `למחוק את "${d.title}"?`, confirm: 'מחיקה', danger: true }))) return;
    try {
      await api.del(`/api/documents/${d.id}`);
      emitLocalChange('documents');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const items: RowMenuItem[] = [
    { key: 'open', label: 'פתיחה', icon: 'external', primary: true, run: open },
    { key: 'copy', label: 'העתקת קישור', icon: 'link', run: () => void copy() },
    ...(d.canEdit && isCommander ? [{ key: 'pin', label: d.pinned ? 'ביטול הצמדה' : 'הצמדה לראש הספרייה', icon: 'pin', run: () => void pin() }] : []),
    ...(d.canEdit ? [{ key: 'edit', label: 'עריכה', icon: 'edit', run: onEdit }] : []),
    ...(d.canEdit ? [{ key: 'delete', label: 'מחיקה', icon: 'trash', run: () => void remove() }] : []),
  ];
  const menu = useRowMenu({ title: d.title, items, disabled: bulk?.active, links: true });
  return (
    <div className={`card card-pad col gap-6 doc-card holdable${menu.lifted ? ' is-lifted' : ''}`} style={{ padding: 14 }} {...menu.bind}>
      <div className="row gap-6">
        {d.canEdit && <BulkCheck id={d.id} />}
        <Icon name={d.kind === 'file' ? 'file' : 'link'} className="muted" />
        <span className="badge">{d.category}</span>
        {d.restricted && (
          <span className="badge t-orange">
            <Icon name="lock" size={11} /> למפקד בלבד
          </span>
        )}
        <span className="grow" />
        {d.canEdit && (
          <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="עריכה" onClick={onEdit}>
            <Icon name="edit" size={14} />
          </button>
        )}
      </div>
      {/* the title is the link; its reach is the whole card (the buttons stay on top) */}
      <a href={safeUrl(d.url)} target="_blank" rel="noreferrer noopener" className="strong doc-link" style={{ fontSize: 15.5 }} onClick={(e) => {
          // while selecting, the card selects
          if (bulk?.active) {
            e.preventDefault();
            bulk.toggle(d.id);
          } else onOpened();
        }}
      >
        {d.title}
      </a>
      {d.description && <p className="small muted">{d.description}</p>}
      <div className="tiny muted mt-8">
        {[d.fileName && `${d.fileName} · ${fileSize(d.size)}`, d.weekName, d.uploadedByName, fmtAgo(d.createdAt)].filter(Boolean).join(' · ')}
      </div>
      {menu.menu}
    </div>
  );
}

function DocForm({ doc, onClose }: { doc?: CourseDocument; onClose: () => void }) {
  const { isCommander, weeks } = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<'file' | 'link'>(doc?.kind ?? 'file');
  const [title, setTitle] = useState(doc?.title ?? '');
  const [category, setCategory] = useState<string>(doc?.category ?? 'נהלים');
  const [description, setDescription] = useState(doc?.description ?? '');
  const [url, setUrl] = useState(doc?.kind === 'link' ? doc.url : '');
  const [weekId, setWeekId] = useState<string>(doc?.weekId ? String(doc.weekId) : '');
  const [restricted, setRestricted] = useState(doc?.restricted ?? false);
  const [pinned, setPinned] = useState(doc?.pinned ?? false);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    const meta = { title: title.trim() || file?.name || '', category, description, weekId: weekId ? Number(weekId) : null, restricted, pinned };
    try {
      if (doc) await api.patch(`/api/documents/${doc.id}`, meta);
      else if (kind === 'link') await api.post('/api/documents', { ...meta, url });
      else {
        if (!file) throw new Error('יש לבחור קובץ');
        await api.upload(
          `/api/documents/file${qs({ title: meta.title, category, description, weekId: meta.weekId ?? undefined, restricted: restricted ? 1 : undefined, pinned: pinned ? 1 : undefined })}`,
          file,
        );
      }
      toast({ title: 'המסמך נשמר', tone: 'green' });
      emitLocalChange('documents');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!doc || !(await ask({ title: `למחוק את "${doc.title}"?`, confirm: 'מחיקה', danger: true }))) return;
    await api.del(`/api/documents/${doc.id}`);
    emitLocalChange('documents');
    onClose();
  };

  return (
    <Modal
      title={doc ? 'עריכת מסמך' : 'מסמך חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          {doc && (
            <button className="btn btn-danger" style={{ marginInlineStart: 'auto' }} onClick={() => void remove()}>
              מחיקה
            </button>
          )}
        </>
      }
    >
      <div className="col gap-16">
        {!doc && <Seg value={kind} onChange={setKind} options={[{ value: 'file', label: 'העלאת קובץ', icon: 'upload' }, { value: 'link', label: 'קישור', icon: 'link' }]} />}
        {!doc && kind === 'file' && (
          <div>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> {file ? file.name : 'בחירת קובץ'}
            </button>
            <input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        )}
        {!doc && kind === 'link' && (
          <Field label="קישור" required>
            <input className="input" dir="ltr" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/..." />
          </Field>
        )}
        <div className="form-grid">
          <Field label="שם המסמך" required={kind === 'link' || !!doc}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name} />
          </Field>
          <Field label="קטגוריה">
            <Select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="שבוע (לא חובה)">
            <Select className="select" value={weekId} onChange={(e) => setWeekId(e.target.value)}>
              <option value="">ללא</option>
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="תיאור" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {isCommander && (
          <div className="row wrap">
            <label className="check small">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              הצמד לראש הספרייה
            </label>
            <label className="check small">
              <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} />
              גלוי למפקד הקורס בלבד
            </label>
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

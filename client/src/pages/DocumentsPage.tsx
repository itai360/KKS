// Section 31 - documents: procedures, orders, presentations, training material, links.

import { useRef, useState } from 'react';
import { DOCUMENT_CATEGORIES } from '@shared/constants';
import type { CourseDocument } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg } from '../components/ui';
import { api, qs } from '../lib/api';
import { fileSize, fmtAgo } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function DocumentsPage() {
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi<CourseDocument[]>(`/api/documents${qs({ category, q })}`, ['documents']);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CourseDocument | null>(null);
  const pinned = (data ?? []).filter((d) => d.pinned);
  const rest = (data ?? []).filter((d) => !d.pinned);

  return (
    <div className="page">
      <PageHead
        title="מסמכים"
        sub="נהלים, פקודות, מצגות, חומרי הדרכה וקישורים - במקום אחד, בלי לחפש בקבוצות וואטסאפ."
        actions={
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> מסמך
          </button>
        }
      />
      <div className="chips chips-scroll mb-12">
        <button className={`chip${!category ? ' on' : ''}`} onClick={() => setCategory('')}>
          הכל
        </button>
        {DOCUMENT_CATEGORIES.map((c) => (
          <button key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="filters">
        <input className="input" placeholder="חיפוש מסמך..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
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
              <DocGrid docs={pinned} onEdit={setEditing} />
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
              <DocGrid docs={rest} onEdit={setEditing} />
            </>
          )}
        </>
      )}
      {adding && <DocForm onClose={() => setAdding(false)} />}
      {editing && <DocForm doc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DocGrid({ docs, onEdit }: { docs: CourseDocument[]; onEdit: (d: CourseDocument) => void }) {
  return (
    <div className="grid-3">
      {docs.map((d) => (
        <div key={d.id} className="card card-pad col gap-6" style={{ padding: 14 }}>
          <div className="row gap-6">
            <Icon name={d.kind === 'file' ? 'file' : 'link'} className="muted" />
            <span className="badge">{d.category}</span>
            {d.restricted && (
              <span className="badge t-orange">
                <Icon name="lock" size={11} /> למפקד בלבד
              </span>
            )}
            <span className="grow" />
            {d.canEdit && (
              <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="עריכה" onClick={() => onEdit(d)}>
                <Icon name="edit" size={14} />
              </button>
            )}
          </div>
          <a href={d.url} target="_blank" rel="noreferrer noopener" className="strong" style={{ fontSize: 15.5 }}>
            {d.title}
          </a>
          {d.description && <p className="small muted">{d.description}</p>}
          <div className="tiny muted mt-8">
            {[d.fileName && `${d.fileName} · ${fileSize(d.size)}`, d.weekName, d.uploadedByName, fmtAgo(d.createdAt)].filter(Boolean).join(' · ')}
          </div>
        </div>
      ))}
    </div>
  );
}

function DocForm({ doc, onClose }: { doc?: CourseDocument; onClose: () => void }) {
  const { isCommander, weeks } = useSession();
  const toast = useToast();
  const [kind, setKind] = useState<'file' | 'link'>(doc?.kind ?? 'file');
  const [title, setTitle] = useState(doc?.title ?? '');
  const [category, setCategory] = useState(doc?.category ?? DOCUMENT_CATEGORIES[0]);
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
    if (!doc || !confirm(`למחוק את "${doc.title}"?`)) return;
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
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="שבוע (לא חובה)">
            <select className="select" value={weekId} onChange={(e) => setWeekId(e.target.value)}>
              <option value="">ללא</option>
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
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

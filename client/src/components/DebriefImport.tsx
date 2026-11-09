// A debrief filled in a file. Any debrief: its template ("תבנית למילוי" - the debrief as a Word file, each part
// with a box to write in) filled in Word or Google Docs and uploaded back - each part goes to its own place on
// the server, and a moment's "ביטול" puts the debrief back as it was. A company debrief also takes the
// company's own document (סיכום תחק"ש פלוגתי - the lessons table and the sections after it): read on the
// server and added here to what the form holds. Either as a Word file, the link of a shared Google Docs
// document, or the document pasted.

import { useRef, useState, type ClipboardEvent } from 'react';
import { withImported, DEBRIEF_KIND_LABELS, ownerNames, type DebriefAnswers, type DebriefImport } from '@shared/debriefForms';
import { debriefTemplateDocx, DOCX_TYPE, type TemplateResult } from '@shared/debriefTemplate';
import { shortDate } from '@shared/dates';
import type { DebriefDetail } from '@shared/types';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Modal } from './ui';
import { api } from '../lib/api';
import { shareOrSave } from '../lib/download';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';

/** the questions a company document fills, each empty as it starts */
const EMPTY: Record<keyof DebriefImport['answers'], unknown> = { company: [], staffGeneral: [], mood: [], unsolved: [], staffPoints: '', more: '' };

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** what came in from a company document, in a line: "7 נושאים מול הפלוגה · נושא אחד מול הסגל · הלך הרוח" */
export function importSummary(r: DebriefImport): string {
  const a = r.answers;
  const parts = [
    a.company?.length ? `${count(a.company.length, 'נושא אחד', 'נושאים')} מול הפלוגה` : '',
    a.staffGeneral?.length ? `${count(a.staffGeneral.length, 'נושא אחד', 'נושאים')} מול הסגל` : '',
    a.mood?.length ? 'הלך הרוח' : '',
    a.unsolved?.length ? 'מסרים ופערים בלי פתרון' : '',
    a.staffPoints ? 'נקודות הסגל' : '',
    a.more ? 'דברי המ״פ' : '',
  ].filter(Boolean);
  const asWritten = r.owners.asWritten ? ` ${count(r.owners.asWritten, 'אחראי אחד נשמר', 'אחראים נשמרו')} כפי שנכתב - אפשר לבחור מהרשימה.` : '';
  return `${parts.join(' · ')}.${asWritten}`;
}

/** what a template put where, in a line: "מטרות, ציון לשבוע, מה עבד ועוד 3 · 2 לקחים נוספו" */
export function placedSummary(p: TemplateResult['placed'], lessons: boolean): string {
  const shown = p.parts.slice(0, 3).join(', ');
  const more = p.parts.length > 3 ? ` ועוד ${p.parts.length - 3}` : '';
  // a form's are lessons; an activity debrief's are facts, findings, conclusions and lessons
  const items = !p.items ? '' : lessons ? count(p.items, 'לקח אחד נוסף', 'לקחים נוספו') : count(p.items, 'פריט אחד נוסף', 'פריטים נוספו');
  return [p.parts.length ? `${shown}${more}` : '', items].filter(Boolean).join(' · ');
}

/** The debrief as a Word file to fill in - what it holds already written in (shared/debriefTemplate.ts). */
export function downloadTemplate(data: DebriefDetail): void {
  const d = data.debrief;
  const about = data.week ? `שבוע ${data.week.number} · ${data.week.name}` : (d.weekName ?? d.eventTitle ?? '');
  const { data: file, name } = debriefTemplateDocx({
    kind: d.kind,
    title: d.title,
    when: shortDate(d.occurredOn),
    about,
    participants: d.participants,
    summary: d.summary,
    answers: d.answers,
    items: data.items.map((i) => ({ kind: i.kind, body: i.body, horizon: i.horizon, ownerName: i.owners.length ? ownerNames(i.owners) : i.ownerName, dueDate: i.dueDate })),
    weekGoals: data.week?.goals,
  });
  void shareOrSave(name, new Blob([file as BlobPart], { type: DOCX_TYPE }));
}

export function TemplateButton({ data }: { data: DebriefDetail }) {
  return (
    <button type="button" className="btn" onClick={() => downloadTemplate(data)} title="התחקיר כקובץ Word למילוי - כל חלק במסגרת משלו. ממלאים ב-Word או ב-Google Docs ומעלים בחזרה ב'ייבוא מקובץ'.">
      <Icon name="download" /> תבנית למילוי
    </button>
  );
}

export function DebriefImportDialog({
  data,
  answers,
  set,
  flush,
  onApplied,
  onClose,
}: {
  data: DebriefDetail;
  /** the form as it is on the screen (a company document is added to it here) */
  answers: DebriefAnswers;
  set: (key: string, value: unknown) => void;
  flush: () => Promise<void>;
  /** the debrief after a template was put in it (or taken out again) */
  onApplied: (d: DebriefDetail) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const debriefId = data.debrief.id;
  const company = data.debrief.kind === 'company';
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /** a template put into the debrief: shown, with a moment to take it back */
  const placed = (t: TemplateResult) => {
    onApplied(t.detail);
    emitLocalChange('debriefs');
    haptic('success');
    const undo = async () => {
      const u = t.undo;
      let last: DebriefDetail | null = null;
      const back = {
        ...(Object.keys(u.answers).length ? { answers: u.answers } : {}),
        ...(u.participants !== undefined ? { participants: u.participants } : {}),
        ...(u.summary !== undefined ? { summary: u.summary } : {}),
      };
      if (Object.keys(back).length) last = await api.patch<DebriefDetail>(`/api/debriefs/${debriefId}`, back);
      for (const itemId of u.itemIds) last = await api.del<DebriefDetail>(`/api/debrief-items/${itemId}`);
      if (last) onApplied(last);
      emitLocalChange('debriefs');
    };
    toast({ title: 'הקובץ נכנס לתחקיר - כל חלק במקומו', body: placedSummary(t.placed, data.debrief.kind !== 'general'), tone: 'green', action: { label: 'ביטול', run: () => void undo() } });
  };

  /** a company's own document: added to the form here, with a moment to take it back */
  const added = (read: DebriefImport) => {
    const changes = withImported(answers, read.answers);
    const keys = Object.keys(changes) as (keyof DebriefImport['answers'])[];
    if (!keys.length) {
      toast({ title: 'הכל כבר בטופס', body: 'כל מה שבמסמך כבר נמצא בתחקיר.' });
      return;
    }
    // as the form was, for "ביטול"
    const before = Object.fromEntries(keys.map((k) => [k, answers[k] ?? EMPTY[k]]));
    for (const k of keys) set(k, changes[k]);
    void flush();
    haptic('success');
    toast({
      title: 'סיכום התחק"ש נכנס לטופס',
      body: importSummary(read),
      tone: 'green',
      action: {
        label: 'ביטול',
        run: () => {
          for (const k of keys) set(k, before[k]);
          void flush();
        },
      },
    });
  };

  const load = async (send: () => Promise<DebriefImport | { template: TemplateResult }>) => {
    setBusy(true);
    setError(null);
    try {
      // what was typed reaches the server first: the file is put in on top of it
      await flush();
      const read = await send();
      if ('template' in read) placed(read.template);
      else added(read);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fromFile = (f: File) => void load(() => api.upload<DebriefImport | { template: TemplateResult }>(`/api/debriefs/${debriefId}/import/file`, f));
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text.trim()) return;
    // the structure is what matters (the tables, the titles): the styling is most of the size
    const lean = html.replace(/\s(style|class|id|dir|role|aria-[a-z-]+)="[^"]*"/g, '');
    fromFile(html ? new File([lean], 'pasted.html', { type: 'text/html' }) : new File([text], 'pasted.txt', { type: 'text/plain' }));
  };

  return (
    <Modal title="ייבוא מקובץ" onClose={onClose}>
      <div className="col gap-12">
        <div className="dimport-steps small">
          <div>
            <b>1.</b> מורידים את התבנית של {company ? 'התחק"ש' : 'התחקיר'} -{' '}
            <button type="button" className="link-btn" onClick={() => downloadTemplate(data)}>
              <Icon name="download" size={14} /> תבנית למילוי ({DEBRIEF_KIND_LABELS[data.debrief.kind]})
            </button>
          </div>
          <div>
            <b>2.</b> ממלאים בתוך המסגרות והטבלאות - ב-Word או ב-Google Docs. את הכותרות לא משנים.
          </div>
          <div>
            <b>3.</b> מעלים כאן את הקובץ, או מדביקים את הקישור שלו. כל חלק נכנס למקומו בתחקיר - ומה שכבר כתוב בו נשאר.
          </div>
          {company && <div className="muted">אפשר גם להעלות את קובץ סיכום התחק"ש של הפלוגה עצמה (טבלת הלקחים והסעיפים שאחריה) - הוא נקרא לטופס כפי שהוא.</div>}
        </div>
        <button type="button" className="btn btn-primary dimport-file" disabled={busy} onClick={() => file.current?.click()}>
          <Icon name="upload" /> בחירת קובץ Word
        </button>
        <input
          ref={file}
          type="file"
          accept=".docx,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) fromFile(f);
          }}
        />
        <div className="dimport-or small muted">או</div>
        <div className="row wrap gap-6">
          <input
            className="input grow"
            dir={link ? 'ltr' : undefined}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="קישור למסמך משותף ב-Google Docs"
            style={{ minWidth: 200 }}
            aria-label="קישור למסמך"
          />
          <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void load(() => api.post<DebriefImport | { template: TemplateResult }>(`/api/debriefs/${debriefId}/import/link`, { url: link.trim() }))}>
            טעינה מקישור
          </button>
        </div>
        <textarea
          className="textarea"
          onPaste={onPaste}
          value=""
          onChange={() => undefined}
          placeholder="או להדביק את המסמך: לפתוח אותו, לסמן הכל (Ctrl+A), להעתיק (Ctrl+C) ולהדביק כאן (Ctrl+V)"
          style={{ minHeight: 64 }}
          disabled={busy}
          aria-label="הדבקת המסמך"
        />
        {busy && <div className="small muted">קורא את המסמך...</div>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

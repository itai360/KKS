// A company debrief written in the company's own document (סיכום תחק"ש פלוגתי - the lessons table and the
// sections after it) brought into its form: a Word file, the link of a shared Google Docs document, or the
// document pasted. The server reads it; here it is added to what the form holds - nothing in the form is
// taken out - and a moment's "ביטול" puts the form back as it was.

import { useRef, useState, type ClipboardEvent } from 'react';
import { withImported, type DebriefAnswers, type DebriefImport } from '@shared/debriefForms';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Modal } from './ui';
import { api } from '../lib/api';
import { haptic } from '../lib/haptics';

/** the questions a document fills, each empty as it starts */
const EMPTY: Record<keyof DebriefImport['answers'], unknown> = { company: [], staffGeneral: [], mood: [], unsolved: [], staffPoints: '', more: '' };

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** what came in, in a line: "7 נושאים מול הפלוגה · נושא אחד מול הסגל · הלך הרוח" */
export function importSummary(r: DebriefImport): string {
  const a = r.answers;
  const parts = [
    a.company?.length ? `${count(a.company.length, 'נושא אחד', 'נושאים')} מול הפלוגה` : '',
    a.staffGeneral?.length ? `${count(a.staffGeneral.length, 'נושא אחד', 'נושאים')} מול הסגל` : '',
    a.mood?.length ? 'הלך הרוח' : '',
    a.unsolved?.length ? 'מסרים ופערים בלי פתרון' : '',
    a.staffPoints ? 'נקודות הסגל' : '',
    a.more ? 'נקודות נוספות' : '',
  ].filter(Boolean);
  const asWritten = r.owners.asWritten ? ` ${count(r.owners.asWritten, 'אחראי אחד נשמר', 'אחראים נשמרו')} כפי שנכתב - אפשר לבחור מהרשימה.` : '';
  return `${parts.join(' · ')}.${asWritten}`;
}

export function DebriefImportDialog({
  debriefId,
  answers,
  set,
  flush,
  onClose,
}: {
  debriefId: number;
  answers: DebriefAnswers;
  set: (key: string, value: unknown) => void;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = async (send: () => Promise<DebriefImport>) => {
    setBusy(true);
    setError(null);
    try {
      const read = await send();
      const changes = withImported(answers, read.answers);
      const keys = Object.keys(changes) as (keyof DebriefImport['answers'])[];
      if (!keys.length) {
        toast({ title: 'הכל כבר בטופס', body: 'כל מה שבמסמך כבר נמצא בתחקיר.' });
        onClose();
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
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fromFile = (f: File) => void load(() => api.upload<DebriefImport>(`/api/debriefs/${debriefId}/import/file`, f));
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (!html && !text.trim()) return;
    // the structure is what matters (the table, the titles): the styling is most of the size
    const lean = html.replace(/\s(style|class|id|dir|role|aria-[a-z-]+)="[^"]*"/g, '');
    fromFile(html ? new File([lean], 'pasted.html', { type: 'text/html' }) : new File([text], 'pasted.txt', { type: 'text/plain' }));
  };

  return (
    <Modal title='ייבוא סיכום התחק"ש' onClose={onClose}>
      <div className="col gap-12">
        <p className="small muted dimport-intro">
          קובץ Word של סיכום התחק"ש הפלוגתי: טבלת הלקחים (פער, לקח + פתרון, אחראי, תיעוד התקדמות) והסעיפים שאחריה. הכל נכנס לטופס - ומה שכבר כתוב בו נשאר.
        </p>
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
          <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void load(() => api.post<DebriefImport>(`/api/debriefs/${debriefId}/import/link`, { url: link.trim() }))}>
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

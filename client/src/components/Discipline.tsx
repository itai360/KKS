// Discipline notes (הערות משמעת) and the course's enforcement ladder (מדרג
// אכיפה): the count a cadet has, the ladder as staff read it, and the card the
// commander imports it with (server/src/discipline.ts).

import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { COMMITTEE_DECISION_LABELS, committeeTo, DISCIPLINE_COMMITTEE_KIND, DISCIPLINE_NOTE_LIMIT } from '@shared/constants';
import type { Cadet, CadetRecord, DisciplineGuide, DisciplineOffense } from '@shared/types';
import { api } from '../lib/api';
import { shortDate } from '@shared/dates';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { noteTone } from './DisciplineCard';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { ErrorBox, Modal } from './ui';
import { matchesSearch } from '@shared/search';
import { ask } from './Confirm';

export { NotesBadge, noteTone } from './DisciplineCard';

export const useGuide = (enabled = true) => useApi<DisciplineGuide>(enabled ? '/api/discipline/guide' : null, ['settings']);

const ORDINALS = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית', 'שביעית', 'שמינית', 'תשיעית', 'עשירית'];
/** "פעם שלישית" */
export const timeLabel = (n: number) => `פעם ${ORDINALS[n - 1] ?? n}`;

/** The offense's own name, without its category. */
export const offenseName = (key: string) => key.split(' · ').pop() ?? key;

/** "2/3" as filled dots, for the cadet page. */
export function NoteDots({ count }: { count: number }) {
  return (
    <span className="note-dots" role="img" aria-label={`${count} מתוך ${DISCIPLINE_NOTE_LIMIT} הערות משמעת`}>
      {Array.from({ length: DISCIPLINE_NOTE_LIMIT }, (_, i) => (
        <i key={i} className={i < count ? 'on' : ''} />
      ))}
    </span>
  );
}

/** The cadet page card: how many notes, how many are left, the committee they opened, and each note. */
export function DisciplineSummary({ count, committee, notes }: { count: number; committee: Cadet['notesCommittee']; notes: CadetRecord[] }) {
  const left = DISCIPLINE_NOTE_LIMIT - count;
  return (
    <div className={`card card-pad col gap-6 discipline-card${count ? ` ${noteTone(count)}` : ''}`}>
      <div className="row">
        <Icon name="shield" />
        <h3 className="grow" style={{ margin: 0 }}>
          הערות משמעת
        </h3>
        <NoteDots count={count} />
        <span className="mono strong">
          {count}/{DISCIPLINE_NOTE_LIMIT}
        </span>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {count === 0
          ? `אין הערות משמעת. בהערה ה-${DISCIPLINE_NOTE_LIMIT} הצוער עולה ${committeeTo(DISCIPLINE_COMMITTEE_KIND)}.`
          : left > 0
            ? left === 1
              ? `הערת משמעת נוספת תעלה אותו ${committeeTo(DISCIPLINE_COMMITTEE_KIND)}.`
              : `עוד ${left} הערות עד ${DISCIPLINE_COMMITTEE_KIND}.`
            : !committee
              ? `קיבל ${count} הערות משמעת.`
              : committee.decision
                ? `${DISCIPLINE_COMMITTEE_KIND} החליטה: ${COMMITTEE_DECISION_LABELS[committee.decision]}.`
                : `עלה ${committeeTo(DISCIPLINE_COMMITTEE_KIND)} וממתין להחלטה. מחיקה של הערה לפני ההחלטה מבטלת את ההעברה.`}
        {committee && left <= 0 && (
          <>
            {' '}
            <Link to={`/evaluations/committee/${committee.id}`}>לוועדה</Link>
          </>
        )}
      </p>
      {notes.length > 0 && (
        <div className="col gap-4">
          {notes.map((r) => (
            <div key={r.id} className="small row gap-6">
              <span className="mono muted">{shortDate(r.occurredOn)}</span>
              <span className="grow">{r.title || r.category || 'הערת משמעת'}</span>
              {r.noteNumber && <span className="tiny muted">#{r.noteNumber}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OffenseSteps({ offense }: { offense: DisciplineOffense }) {
  return (
    <ol className="guide-steps">
      {offense.steps.map((s, i) => (
        <li key={i} className={s?.note ? 'note' : ''}>
          <span className="guide-time">{timeLabel(i + 1)}</span>
          <span className="grow" style={{ whiteSpace: 'pre-wrap' }}>
            {s?.text ?? '-'}
          </span>
          {s?.note && <span className="badge t-red">הערת משמעת</span>}
          {s?.committee && <span className="badge t-orange">ועדה</span>}
        </li>
      ))}
    </ol>
  );
}

/** The ladder as staff read it: by category, what to do each time; and the wording of the notes. */
export function GuideView({ guide }: { guide: DisciplineGuide }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const offenses = guide.offenses.filter((o) => matchesSearch(term, o.key, o.category, ...o.definition));
  const categories = [...new Set(offenses.map((o) => o.category))];
  return (
    <div className="col gap-16">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מקרה..." aria-label="חיפוש מקרה" data-transient />
      {categories.map((cat) => (
        <section key={cat || '-'} className="col gap-6">
          {cat && <div className="label-caps">{cat}</div>}
          {offenses
            .filter((o) => o.category === cat)
            .map((o) => (
              <div key={o.key} className="guide-offense">
                <div className="strong">{o.name}</div>
                {o.definition.length > 0 && <div className="tiny muted">{o.definition.join(' · ')}</div>}
                <OffenseSteps offense={o} />
              </div>
            ))}
        </section>
      ))}
      {offenses.length === 0 && <div className="small muted">לא נמצא מקרה כזה.</div>}
      {guide.letters.length > 0 && !term && (
        <section className="col gap-6">
          <div className="label-caps">נוסחי הערות משמעת</div>
          {guide.letters.map((l, i) => (
            <details key={i} className="guide-letter">
              <summary>{l.title}</summary>
              <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                {l.body}
              </p>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

export function GuideModal({ guide, onClose }: { guide: DisciplineGuide; onClose: () => void }) {
  return (
    <Modal title="מדרג אכיפה" onClose={onClose} wide>
      <GuideView guide={guide} />
    </Modal>
  );
}

/** Settings: the commander loads the ladder from the course's document - a link, a paste, or a Word file. */
export function GuideImportCard() {
  const toast = useToast();
  const guide = useGuide();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const g = guide.data;

  const load = async (send: () => Promise<DisciplineGuide>) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await send();
      toast({ title: 'מדרג האכיפה נטען', body: `${saved.offenses.length} מקרים, ${saved.letters.length} נוסחי הערות משמעת`, tone: 'green' });
      setLink('');
      emitLocalChange('settings');
      await guide.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    e.preventDefault();
    if (!html) {
      setError('כדי שהטבלה תישמר צריך להעתיק מתוך המסמך עצמו: לפתוח אותו ב-Google Docs, לסמן הכל (Ctrl+A), להעתיק (Ctrl+C) ולהדביק כאן.');
      return;
    }
    // only the structure matters: the styling is most of the size
    const lean = html.replace(/\s(style|class|id|dir|role|aria-[a-z-]+)="[^"]*"/g, '');
    void load(() => api.upload<DisciplineGuide>('/api/discipline/guide/file', new File([lean], 'pasted.html', { type: 'text/html' })));
  };
  const remove = async () => {
    if (!(await ask({ title: 'להסיר את מדרג האכיפה?', body: 'הרישומים בתיקי הצוערים נשארים. אפשר לטעון את המסמך שוב בכל עת.', confirm: 'הסרה', danger: true }))) return;
    await api.del('/api/discipline/guide');
    emitLocalChange('settings');
    await guide.reload();
  };

  return (
    <div className="card">
      <div className="card-head">
        <Icon name="shield" />
        <h3 className="grow">מדרג אכיפה והערות משמעת</h3>
        {g && g.offenses.length > 0 && (
          <button className="btn btn-sm" onClick={() => setShow(true)}>
            הצגה
          </button>
        )}
      </div>
      <div className="card-body col">
        <p className="small muted" style={{ margin: 0 }}>
          המדרג מהמסמך של הקורס: מה עושים בפעם הראשונה, השנייה וכן הלאה בכל מקרה, ונוסחי הערות המשמעת. כשרושמים משמעת לצוער המערכת מראה איזו פעם זו ומה הצעד לפי המדרג, ומסמנת הערת משמעת כשהמדרג קובע.
          בהערת המשמעת ה-
          {DISCIPLINE_NOTE_LIMIT} הצוער עולה {committeeTo(DISCIPLINE_COMMITTEE_KIND)}. המדרג נשמר במערכת בלבד; כשהמסמך משתנה - טוענים אותו שוב.
        </p>
        {g?.importedAt ? (
          <div className="small">
            <b>
              {g.offenses.length} מקרים · {g.letters.length} נוסחים
            </b>{' '}
            <span className="muted">
              · נטען {fmtAgo(g.importedAt)} ({fmtDateTime(g.importedAt)}){g.importedByName && ` על ידי ${g.importedByName}`}
            </span>
            {g.source && (
              <div className="tiny muted" style={{ overflowWrap: 'anywhere' }}>
                מקור: {g.source}
              </div>
            )}
          </div>
        ) : (
          guide.data && <div className="small muted">עדיין לא נטען מדרג.</div>
        )}
        <div className="col gap-6">
          <span className="small strong">הדבקה מהמסמך (המסמך נשאר פרטי)</span>
          <textarea
            className="textarea"
            onPaste={onPaste}
            value=""
            onChange={() => undefined}
            placeholder="פותחים את המסמך ב-Google Docs, מסמנים הכל (Ctrl+A), מעתיקים (Ctrl+C) ומדביקים כאן (Ctrl+V)"
            style={{ minHeight: 64 }}
            disabled={busy}
            aria-label="הדבקת המסמך"
          />
        </div>
        <div className="row wrap gap-6">
          <input
            className="input grow"
            dir={link ? 'ltr' : undefined}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="או קישור למסמך משותף ב-Google Docs"
            style={{ minWidth: 220 }}
            aria-label="קישור למסמך"
          />
          <button className="btn" disabled={busy || link.trim().length < 10} onClick={() => void load(() => api.post<DisciplineGuide>('/api/discipline/guide/link', { url: link.trim() }))}>
            טעינה מקישור
          </button>
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>
            <Icon name="upload" /> קובץ Word
          </button>
          <input
            ref={file}
            type="file"
            accept=".docx,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void load(() => api.upload<DisciplineGuide>('/api/discipline/guide/file', f));
            }}
          />
        </div>
        {busy && <div className="small muted">קורא את המסמך...</div>}
        <ErrorBox error={error ?? guide.error} />
        {g?.importedAt && (
          <button className="btn btn-ghost btn-sm text-red" style={{ alignSelf: 'flex-start' }} onClick={() => void remove()}>
            הסרת המדרג
          </button>
        )}
      </div>
      {show && g && <GuideModal guide={g} onClose={() => setShow(false)} />}
    </div>
  );
}

// The staff from cycle to cycle (server/src/courseStaff.ts): who goes on in a course, who does not, and who takes
// their place - someone of the staff, or someone new. In the next course (opened beside the current one) it is
// that course's alone; in the current course, whoever leaves it - their account closes.

import { useMemo, useState } from 'react';
import type { CourseStaffPerson, StaffMoved } from '@shared/types';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useApi } from '../lib/useApi';
import { ask } from './Confirm';
import { Icon } from './Icon';
import { useToast } from './Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, Seg, Select } from './ui';

interface Change {
  inCourse: boolean;
  replacedBy: number | null;
}

/** a temporary password: letters and digits, easy to read out (asked to be changed on first sign-in) */
function tempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const r = crypto.getRandomValues(new Uint32Array(8));
  const word = Array.from(r.slice(0, 5), (n) => letters[n % letters.length]).join('');
  const digits = Array.from(r.slice(5), (n) => String(n % 10)).join('');
  return `Kks-${word}-${digits}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** what is theirs in the course: what moves to whoever takes their place */
function RoleChips({ p }: { p: CourseStaffPerson }) {
  const chips = [
    ...p.teams.map((t) => ({ icon: 'users', text: t })),
    ...p.tracks.map((t) => ({ icon: 'flag', text: `ציר ${t}` })),
    ...(p.weeks ? [{ icon: 'calendar', text: plural(p.weeks, 'שבוע אחד בהובלתו', 'שבועות בהובלתו') }] : []),
    ...(p.tasks ? [{ icon: 'check', text: plural(p.tasks, 'משימה פתוחה', 'משימות פתוחות') }] : []),
    ...(p.recurring ? [{ icon: 'repeat', text: plural(p.recurring, 'משימה חוזרת', 'משימות חוזרות') }] : []),
  ];
  if (!chips.length) return <span className="tiny muted">אין עליו תפקידים בקורס</span>;
  return (
    <span className="staffx-chips">
      {chips.map((c, i) => (
        <span key={i} className="staffx-chip">
          <Icon name={c.icon} size={12} /> {c.text}
        </span>
      ))}
    </span>
  );
}

export function StaffChanges({ courseId, courseName, onClose }: { courseId: number | null; courseName: string; onClose: () => void }) {
  const base = courseId === null ? '/api/courses/staff' : `/api/courses/parallel/${courseId}/staff`;
  const beside = courseId !== null;
  const { data, error, loading, reload } = useApi<CourseStaffPerson[]>(base, ['users']);
  const [list, setList] = useState<CourseStaffPerson[] | null>(null);
  const [pending, setPending] = useState<Record<number, Change>>({});
  const [adding, setAdding] = useState<{ forUser: number | null } | null>(null);
  const [created, setCreated] = useState<{ name: string; username: string; password: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const people = list ?? data ?? null;

  const stateOf = (p: CourseStaffPerson): Change => pending[p.id] ?? { inCourse: p.inCourse, replacedBy: p.replacedBy };
  const set = (p: CourseStaffPerson, c: Change) =>
    setPending((all) => {
      const n = { ...all };
      if (c.inCourse === p.inCourse && (c.inCourse || c.replacedBy === p.replacedBy)) delete n[p.id];
      else n[p.id] = c;
      // whoever was taking someone's place and now leaves too: that place is no one's
      if (!c.inCourse) for (const [k, v] of Object.entries(n)) if (v.replacedBy === p.id) n[Number(k)] = { ...v, replacedBy: null };
      return n;
    });
  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  const changes = Object.entries(pending).map(([id, c]) => ({ userId: Number(id), inCourse: c.inCourse, replacedBy: c.inCourse ? null : c.replacedBy }));
  // the current course: those waiting for the next one are apart
  const waiting = !beside ? (people ?? []).filter((p) => p.newcomer) : [];
  const shown = (people ?? []).filter((p) => beside || !p.newcomer);
  const groups = [
    { label: 'מפקדים', rows: shown.filter((p) => p.role === 'commander') },
    { label: 'סגל', rows: shown.filter((p) => p.role !== 'commander') },
  ].filter((g) => g.rows.length);

  const save = async () => {
    const leaving = changes.filter((c) => !c.inCourse);
    const names = (ids: number[]) => ids.map((id) => byId.get(id)?.name ?? '').join(', ');
    if (leaving.length) {
      const ok = await ask({
        title: beside ? `לעדכן את הסגל של ${courseName}?` : `לסגור את החשבונות של ${names(leaving.map((c) => c.userId))}?`,
        body: beside
          ? `${names(leaving.map((c) => c.userId))} לא ימשיכו ב${courseName} - בקורס הנוכחי הכל נשאר כמו שהוא. כשהקורס יהפוך לקורס הנוכחי, החשבונות שלהם ייסגרו.`
          : 'הם לא יוכלו להיכנס יותר למערכת. מה שהיה שלהם בקורס - הצוותים, השבועות הבאים, הצירים והמשימות הפתוחות - עובר למי שנכנס במקומם (או נשאר פנוי).',
        confirm: beside ? 'עדכון הסגל' : 'סגירת החשבונות',
        danger: !beside,
      });
      if (!ok) return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ moved: StaffMoved; staff: CourseStaffPerson[] }>(base, { changes });
      const m = r.moved;
      const parts = [
        m.teams && plural(m.teams, 'צוות', 'צוותים'),
        m.weeks && plural(m.weeks, 'שבוע', 'שבועות'),
        m.tracks && plural(m.tracks, 'ציר', 'צירים'),
        m.tasks && plural(m.tasks, 'משימה', 'משימות'),
        m.recurring && plural(m.recurring, 'משימה חוזרת', 'משימות חוזרות'),
        m.templates && plural(m.templates, 'תבנית', 'תבניות'),
      ].filter(Boolean);
      toast({ title: 'הסגל עודכן', body: parts.length ? `עברו למחליפים: ${parts.join(', ')}` : undefined, tone: 'green' });
      setList(r.staff);
      setPending({});
      emitLocalChange('users');
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  const close = async () => {
    if (changes.length && !(await ask({ title: 'לצאת בלי לשמור?', body: 'השינויים שסימנת לא יישמרו.', confirm: 'יציאה בלי שמירה', danger: true }))) return;
    onClose();
  };

  return (
    <Modal
      wide
      title={`הסגל ב${courseName}`}
      onClose={() => void close()}
      footer={
        <>
          <button className="btn" onClick={() => void close()} disabled={busy}>
            סגירה
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !changes.length}>
            {busy ? 'שומר...' : changes.length ? `שמירת השינויים (${changes.length})` : 'שמירת השינויים'}
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <p className="small muted">
          {beside
            ? `מי ממשיך ל${courseName} ומי לא. מי שלא ממשיך יוצא מהקורס הזה בלבד - בקורס הנוכחי הכל נשאר כמו שהוא. מי שנכנס במקומו מקבל את מה שהיה שלו כאן: הצוות, השבועות, הצירים, המשימות הפתוחות והחוזרות. כשהקורס יהפוך לקורס הנוכחי, החשבונות של מי שלא ממשיך ייסגרו.`
            : 'מי שלא ממשיך בקורס - החשבון שלו נסגר. מי שנכנס במקומו מקבל את מה שהיה שלו: הצוות, השבועות הבאים, הצירים, המשימות הפתוחות והחוזרות.'}
        </p>
        {created.map((c) => (
          <div key={c.username} className="staffx-created" role="status">
            <Icon name="lock" size={16} />
            <span className="grow small">
              <b>{c.name}</b> נוסף/ה. פרטי הכניסה למסירה: שם משתמש{' '}
              <bdi className="mono" dir="ltr">
                {c.username}
              </bdi>
              {c.password && (
                <>
                  , סיסמה זמנית{' '}
                  <bdi className="mono" dir="ltr">
                    {c.password}
                  </bdi>{' '}
                  (בכניסה הראשונה תתבקש סיסמה אישית)
                </>
              )}
              {!c.password && ' - כניסה עם חשבון Google של המייל'}
            </span>
            <button
              className="btn btn-sm"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(`שם משתמש: ${c.username}${c.password ? `\nסיסמה זמנית: ${c.password}` : ''}`)
                  .then(() => toast({ title: 'הועתק', tone: 'green' }))
              }
            >
              <Icon name="copy" size={14} /> העתקה
            </button>
          </div>
        ))}
        <ErrorBox error={error ?? err} />
        {loading && !people ? (
          <Loading rows={4} />
        ) : !people?.length ? (
          <Empty icon="users" title="אין אנשי סגל" />
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.label} className="staffx-group" aria-label={g.label}>
                <div className="staffx-group-head tiny muted strong">{g.label}</div>
                {g.rows.map((p) => {
                  const s = stateOf(p);
                  const changed = !!pending[p.id];
                  const candidates = (people ?? []).filter((x) => x.id !== p.id && stateOf(x).inCourse && (beside || !x.newcomer || pending[x.id]?.inCourse));
                  return (
                    <div key={p.id} className={`staffx-row${s.inCourse ? '' : ' is-out'}${changed ? ' is-changed' : ''}`}>
                      <div className="staffx-who">
                        <div className="row wrap gap-6">
                          <b>{p.name}</b>
                          {p.title && <span className="small muted">{p.title}</span>}
                          {beside && p.newcomer && <span className="badge t-purple">חדש בסגל</span>}
                          {changed && <span className="badge t-orange">לא נשמר</span>}
                        </div>
                        <RoleChips p={p} />
                      </div>
                      <div className="staffx-choice">
                        <Seg
                          value={s.inCourse ? 'in' : 'out'}
                          onChange={(v) => set(p, { inCourse: v === 'in', replacedBy: v === 'in' ? null : s.replacedBy })}
                          options={[
                            { value: 'in', label: 'ממשיך' },
                            { value: 'out', label: 'לא ממשיך' },
                          ]}
                        />
                        {!s.inCourse && (
                          <Field label="מי נכנס במקומו">
                            <Select
                              value={s.replacedBy === null ? '' : String(s.replacedBy)}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === 'new') setAdding({ forUser: p.id });
                                else set(p, { inCourse: false, replacedBy: v ? Number(v) : null });
                              }}
                            >
                              <option value="">אף אחד - התפקידים נשארים פנויים</option>
                              {candidates.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                  {x.title ? ` - ${x.title}` : ''}
                                </option>
                              ))}
                              <option value="new">+ איש סגל חדש...</option>
                            </Select>
                          </Field>
                        )}
                        {!s.inCourse && !changed && p.replacedBy === null && p.tasks + p.recurring > 0 && (
                          <span className="tiny muted">עדיין רשום עליו מה שלא עבר - אפשר לבחור מחליף</span>
                        )}
                        {s.inCourse && changed && beside && <span className="tiny muted">מה שעבר למחליף נשאר אצל המחליף</span>}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
            {waiting.length > 0 && (
              <section className="staffx-group" aria-label="ממתינים לקורס הבא">
                <div className="staffx-group-head tiny muted strong">ממתינים לקורס הבא - עוד לא בקורס הנוכחי</div>
                {waiting.map((p) => {
                  const joining = !!pending[p.id]?.inCourse;
                  return (
                    <div key={p.id} className={`staffx-row${joining ? ' is-changed' : ''}`}>
                      <div className="staffx-who">
                        <div className="row wrap gap-6">
                          <b>{p.name}</b>
                          {p.title && <span className="small muted">{p.title}</span>}
                          <span className="badge t-purple">לקורס הבא</span>
                        </div>
                      </div>
                      <div className="staffx-choice">
                        <label className="check">
                          <input type="checkbox" checked={joining} onChange={(e) => set(p, { inCourse: e.target.checked, replacedBy: null })} />
                          <span className="small">לצרף כבר עכשיו לקורס הנוכחי</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
            <div>
              <button className="btn btn-sm" onClick={() => setAdding({ forUser: null })}>
                <Icon name="plus" size={15} /> איש סגל חדש
              </button>
            </div>
          </>
        )}
      </div>
      {adding && (
        <NewStaff
          base={base}
          courseName={courseName}
          beside={beside}
          replacing={adding.forUser === null ? null : (byId.get(adding.forUser) ?? null)}
          onClose={() => setAdding(null)}
          onDone={(id, staff, login) => {
            setList(staff);
            setCreated((c) => [...c, login]);
            const was = adding.forUser === null ? null : staff.find((x) => x.id === adding.forUser);
            if (was) set(was, { inCourse: false, replacedBy: id });
            emitLocalChange('users');
            setAdding(null);
          }}
        />
      )}
    </Modal>
  );
}

function NewStaff({
  base,
  courseName,
  beside,
  replacing,
  onClose,
  onDone,
}: {
  base: string;
  courseName: string;
  beside: boolean;
  replacing: CourseStaffPerson | null;
  onClose: () => void;
  onDone: (id: number, staff: CourseStaffPerson[], login: { name: string; username: string; password: string }) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState(replacing?.title ?? '');
  const [role, setRole] = useState<'staff' | 'commander'>(replacing?.role ?? 'staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(tempPassword);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ id: number; staff: CourseStaffPerson[] }>(`${base}/new`, { displayName, title, role, username, password, phone, email });
      onDone(r.id, r.staff, { name: displayName.trim(), username: username.trim(), password });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={replacing ? `איש סגל חדש במקום ${replacing.name}` : 'איש סגל חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !displayName.trim() || !username.trim() || (!password && !email.trim())}>
            {busy ? 'מוסיף...' : 'הוספה'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <p className="small muted span-2">
          {beside
            ? `החשבון ייפתח עכשיו: ייכנס ויעבוד ב${courseName}. בקורס הנוכחי לא יופיע עד ש${courseName} יהפוך לקורס הנוכחי.`
            : 'החשבון ייפתח עכשיו, בקורס הנוכחי.'}
          {replacing && ` מה שהיה של ${replacing.name} יעבור אליו כששומרים את השינויים.`}
        </p>
        <Field label="שם" required hint="כך יופיע במערכת">
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} data-autofocus />
        </Field>
        <Field label="תפקיד / כינוי" hint='לדוגמה: מפק"צ צוות 2'>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </Field>
        <Field label="שם משתמש" required hint="אותיות באנגלית וספרות">
          <input className="input" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" maxLength={40} />
        </Field>
        <Field label="סיסמה זמנית" required={!email.trim()} hint={email.trim() ? 'אפשר להשאיר ריק: הכניסה תהיה עם חשבון Google של המייל' : 'בכניסה הראשונה יתבקש לבחור סיסמה אישית'}>
          <input className="input" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="טלפון">
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </Field>
        <Field label="מייל">
          <input className="input" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
        </Field>
        <Field label="הרשאה">
          <Seg
            value={role}
            onChange={setRole}
            options={[
              { value: 'staff', label: 'איש סגל' },
              { value: 'commander', label: 'מפקד הקורס' },
            ]}
          />
        </Field>
        <div className="span-2">
          <ErrorBox error={err} />
        </div>
      </div>
    </Modal>
  );
}

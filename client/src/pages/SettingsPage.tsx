// Section 36 - setting up the course (dates, weeks, staff, domains, templates,
// recurring tasks, permissions) and personal settings.

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ROLE_LABELS, type Role } from '@shared/constants';
import type { CourseSettings, RecurringRule, Template, User } from '@shared/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { ErrorBox, Field, Modal, PageHead, Seg } from '../components/ui';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { GenerateWeeks } from './WeeksPage';

export function SettingsPage() {
  const { isCommander } = useSession();
  return (
    <div className="page narrow">
      <PageHead title={isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'} />
      <div className="col gap-16">
        {isCommander && (
          <>
            <SetupChecklist />
            <CourseSettingsCard />
            <StaffCard />
            <DomainsCard />
            <PermissionsCard />
          </>
        )}
        <BrowserNotificationsCard />
        <PasswordCard />
      </div>
    </div>
  );
}

function SetupChecklist() {
  const { settings, weeks, staff } = useSession();
  const templates = useApi<Template[]>('/api/templates', ['templates']);
  const recurring = useApi<RecurringRule[]>('/api/recurring', ['recurring']);
  const [gen, setGen] = useState(false);
  const steps = [
    { done: true, label: 'יצירת הקורס', hint: settings.courseName },
    { done: !!settings.startDate && !!settings.endDate, label: 'תאריכי התחלה וסיום', hint: settings.startDate ? `${settings.startDate} - ${settings.endDate ?? '?'}` : 'בכרטיס פרטי הקורס' },
    { done: weeks.length > 0, label: 'רשימת שבועות הקורס', hint: weeks.length ? `${weeks.length} שבועות` : undefined, action: () => setGen(true), actionLabel: 'יצירת שבועות' },
    { done: weeks.length > 0 && weeks.every((w) => w.leadId), label: 'מפק"צ אחראי לכל שבוע', hint: weeks.length ? `${weeks.filter((w) => w.leadId).length}/${weeks.length}` : undefined, link: '/weeks' },
    { done: staff.length > 0, label: 'אנשי הסגל', hint: staff.length ? `${staff.length} אנשי סגל` : 'בכרטיס אנשי סגל' },
    { done: settings.domains.length > 0, label: 'תחומי אחריות', hint: `${settings.domains.length} תחומים` },
    { done: (templates.data?.length ?? 0) > 0, label: 'תבניות בסיסיות', hint: templates.data?.length ? `${templates.data.length} תבניות` : undefined, link: '/templates' },
    { done: (recurring.data?.length ?? 0) > 0, label: 'משימות חוזרות', hint: recurring.data?.length ? `${recurring.data.length} משימות` : undefined, link: '/recurring' },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="flag" />
        <h3 className="grow">הקמת הקורס</h3>
        <span className="mono small">
          {done}/{steps.length}
        </span>
      </div>
      <div className="card-body col gap-6">
        {steps.map((s) => (
          <div key={s.label} className="row small">
            <span className={`task-check${s.done ? ' checked' : ''}`} style={{ width: 22, height: 22, cursor: 'default' }}>
              <Icon name="check" />
            </span>
            <span className={`grow ${s.done ? '' : 'strong'}`}>{s.label}</span>
            {s.hint && <span className="tiny muted">{s.hint}</span>}
            {!s.done && s.link && (
              <Link to={s.link} className="btn btn-sm">
                להגדרה
              </Link>
            )}
            {!s.done && s.action && (
              <button className="btn btn-sm" onClick={s.action}>
                {s.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
      {gen && <GenerateWeeks onClose={() => setGen(false)} />}
    </div>
  );
}

function CourseSettingsCard() {
  const { settings } = useSession();
  const toast = useToast();
  const [s, setS] = useState<CourseSettings>(settings);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setS(settings), [settings]);
  const save = async () => {
    setError(null);
    try {
      await api.patch('/api/settings', {
        courseName: s.courseName,
        courseSymbol: s.courseSymbol,
        startDate: s.startDate || null,
        endDate: s.endDate || null,
        timezone: s.timezone,
        staleDays: Number(s.staleDays),
        defaultDeadlineTime: s.defaultDeadlineTime,
        overloadThreshold: Number(s.overloadThreshold),
        readinessWarnThreshold: Number(s.readinessWarnThreshold),
      });
      toast({ title: 'ההגדרות נשמרו', tone: 'green' });
      emitLocalChange('settings');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card" id="course">
      <div className="card-head">
        <h3 className="grow">פרטי הקורס</h3>
        <button className="btn btn-sm btn-primary" onClick={() => void save()}>
          שמור
        </button>
      </div>
      <div className="card-body">
        <div className="form-grid">
          <Field label="שם הקורס">
            <input className="input" value={s.courseName} onChange={(e) => setS({ ...s, courseName: e.target.value })} />
          </Field>
          <Field label="סמל הקורס" hint="מופיע בכניסה ובתפריט (עד 12 תווים)">
            <input className="input" value={s.courseSymbol} maxLength={12} onChange={(e) => setS({ ...s, courseSymbol: e.target.value })} />
          </Field>
          <Field label="תאריך התחלה">
            <input className="input" type="date" value={s.startDate ?? ''} onChange={(e) => setS({ ...s, startDate: e.target.value || null })} />
          </Field>
          <Field label="תאריך סיום">
            <input className="input" type="date" value={s.endDate ?? ''} onChange={(e) => setS({ ...s, endDate: e.target.value || null })} />
          </Field>
          <Field label="שעת דד-ליין ברירת מחדל">
            <input className="input" type="time" value={s.defaultDeadlineTime} onChange={(e) => setS({ ...s, defaultDeadlineTime: e.target.value })} />
          </Field>
          <Field label="אזור זמן">
            <input className="input" dir="ltr" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
          </Field>
          <Field label='"לא עודכן" אחרי (ימים)' hint="משימה פתוחה בלי עדכון תופיע בצהוב">
            <input className="input" type="number" min={0} max={30} value={s.staleDays} onChange={(e) => setS({ ...s, staleDays: Number(e.target.value) })} />
          </Field>
          <Field label="סף עומס (משימות בשבוע)" hint="מעל המספר - התראת עומס על איש הסגל">
            <input className="input" type="number" min={1} value={s.overloadThreshold} onChange={(e) => setS({ ...s, overloadThreshold: Number(e.target.value) })} />
          </Field>
          <Field label="סף מוכנות נמוכה (%)" hint="שבוע שמתחיל בשבועיים הקרובים מתחת לסף יוצף">
            <input className="input" type="number" min={0} max={100} value={s.readinessWarnThreshold} onChange={(e) => setS({ ...s, readinessWarnThreshold: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-12">
          <ErrorBox error={error} />
        </div>
      </div>
    </div>
  );
}

function StaffCard() {
  const { data } = useApi<User[]>('/api/users?all=1', ['users']);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  return (
    <div className="card" id="staff">
      <div className="card-head">
        <Icon name="users" />
        <h3 className="grow">אנשי סגל ומשתמשים</h3>
        <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> משתמש
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>שם</th>
              <th>תפקיד</th>
              <th>שם משתמש</th>
              <th>הרשאה</th>
              <th>טלפון</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.id} className="click" style={{ opacity: u.active ? 1 : 0.5 }} onClick={() => setEditing(u)}>
                <td className="strong">{u.displayName}</td>
                <td className="small">{u.title || '-'}</td>
                <td className="mono small" dir="ltr" style={{ textAlign: 'right' }}>
                  {u.username}
                </td>
                <td>
                  <span className={`badge${u.role === 'commander' ? ' t-blue' : ''}`}>{ROLE_LABELS[u.role]}</span>
                  {!u.active && <span className="badge t-red" style={{ marginInlineStart: 4 }}>לא פעיל</span>}
                </td>
                <td className="mono small">{u.phone}</td>
                <td>
                  <Icon name="edit" size={16} className="muted" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserEditor user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserEditor({ user, onClose }: { user: User | null; onClose: () => void }) {
  const toast = useToast();
  const { staff } = useSession();
  const [displayName, setDisplayName] = useState(user?.displayName ?? `מפק"צ ${staff.length + 1}`);
  const [title, setTitle] = useState(user?.title ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'staff');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      if (user) await api.patch(`/api/users/${user.id}`, { displayName, title, username, role, phone, active, ...(password ? { password } : {}) });
      else await api.post('/api/users', { displayName, title, username, password, role, phone });
      toast({ title: user ? 'המשתמש עודכן' : 'המשתמש נוסף', body: user ? undefined : `שם משתמש: ${username}`, tone: 'green' });
      emitLocalChange('users');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={user ? `עריכת ${user.displayName}` : 'משתמש חדש'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()}>
            שמור
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="שם תצוגה" required hint='כך יופיע במערכת ובזיהוי טקסט חופשי, לדוגמה: מפק"צ 2'>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="תפקיד / כינוי" hint="לדוגמה: מפק״צ צוות 2 או שם מלא">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="שם משתמש" required hint="אותיות לועזיות וספרות">
          <input className="input" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={user ? 'סיסמה חדשה (לאיפוס)' : 'סיסמה'} required={!user}>
          <input className="input" dir="ltr" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={user ? 'השאר ריק ללא שינוי' : 'לפחות 6 תווים'} />
        </Field>
        <Field label="טלפון">
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="הרשאה">
          <Seg value={role} onChange={setRole} options={[{ value: 'staff', label: 'איש סגל' }, { value: 'commander', label: 'מפקד הקורס' }]} />
        </Field>
        {user && (
          <label className="check span-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            משתמש פעיל (משתמש לא פעיל לא יכול להיכנס ולא מופיע בבחירת אחראי)
          </label>
        )}
      </div>
      <div className="mt-12">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function DomainsCard() {
  const { settings } = useSession();
  const toast = useToast();
  const [domains, setDomains] = useState(settings.domains);
  const [add, setAdd] = useState('');
  useEffect(() => setDomains(settings.domains), [settings.domains]);
  const save = async (list: string[]) => {
    setDomains(list);
    try {
      await api.patch('/api/settings', { domains: list });
      emitLocalChange('settings');
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">תחומי אחריות</h3>
      </div>
      <div className="card-body">
        <div className="chips">
          {domains.map((d) => (
            <span key={d} className="chip" style={{ cursor: 'default' }}>
              {d}
              <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`הסר ${d}`} onClick={() => void save(domains.filter((x) => x !== d))}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
        <form
          className="row mt-12"
          onSubmit={(e) => {
            e.preventDefault();
            const v = add.trim();
            if (v && !domains.includes(v)) void save([...domains, v]);
            setAdd('');
          }}
        >
          <input className="input" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="תחום חדש (לדוגמה: רפואה)" style={{ maxWidth: 260 }} />
          <button className="btn" disabled={!add.trim()}>
            <Icon name="plus" /> הוסף
          </button>
        </form>
      </div>
    </div>
  );
}

function PermissionsCard() {
  const rows: [string, boolean, boolean][] = [
    ['יצירת משימות לכל אחד ולכל הסגל', true, false],
    ['יצירת משימות לעצמו', true, true],
    ['פתיחת משימות לאחרים בשבוע שבאחריותו', true, true],
    ['צפייה בכל המשימות', true, false],
    ['צפייה במשימות שלו, הכלליות ומשימות השבוע שלו', true, true],
    ['עדכון סטטוס, עדכונים, קבצים וסימון הושלם', true, true],
    ['שינוי דד-ליין שקבע מפקד הקורס', true, false],
    ['העברת משימה לאחר ללא אישור', true, false],
    ['מחיקת משימה שהמפקד הקצה', true, false],
    ['אישור סגירה, הארכות והעברות', true, false],
    ['שבועות, תבניות, משימות חוזרות והגדרות', true, false],
  ];
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="lock" />
        <h3>הרשאות</h3>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>פעולה</th>
            <th className="num-cell">מפקד הקורס</th>
            <th className="num-cell">מפק"צ / איש סגל</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, c, s]) => (
            <tr key={label}>
              <td className="small">{label}</td>
              <td className="num-cell">{c ? <Icon name="check" size={16} className="text-green" /> : '-'}</td>
              <td className="num-cell">{s ? <Icon name="check" size={16} className="text-green" /> : <span className="muted tiny">בבקשה / לא</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrowserNotificationsCard() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported');
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="bell" />
        <h3 className="grow">התראות בדפדפן</h3>
      </div>
      <div className="card-body row wrap">
        <p className="small grow">
          {perm === 'granted'
            ? 'פעיל: כשהמערכת פתוחה ברקע תקבל התראת מערכת על משימות חדשות, חריגות ובקשות.'
            : perm === 'denied'
              ? 'ההתראות חסומות בדפדפן. ניתן לאפשר אותן בהגדרות האתר בדפדפן.'
              : perm === 'unsupported'
                ? 'הדפדפן הזה לא תומך בהתראות. התראות ימשיכו להופיע בתוך המערכת.'
                : 'קבל התראת מערכת גם כשהמערכת פתוחה בלשונית אחרת.'}
        </p>
        {perm === 'default' && (
          <button className="btn" onClick={() => void Notification.requestPermission().then(setPerm)}>
            הפעל התראות
          </button>
        )}
      </div>
    </div>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/auth/password', { current, next });
      toast({ title: 'הסיסמה עודכנה', tone: 'green' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="card" onSubmit={save}>
      <div className="card-head">
        <h3 className="grow">החשבון שלי - שינוי סיסמה</h3>
      </div>
      <div className="card-body form-grid">
        <Field label="סיסמה נוכחית">
          <input className="input" dir="ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="סיסמה חדשה">
          <input className="input" dir="ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="span-2 row">
          <button className="btn" disabled={!current || next.length < 6}>
            עדכן סיסמה
          </button>
          <ErrorBox error={error} />
        </div>
      </div>
    </form>
  );
}

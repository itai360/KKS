// Section 36 - setting up the course (dates, weeks, staff, domains, templates,
// recurring tasks, permissions) and personal settings.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ROLE_LABELS, type Role } from '@shared/constants';
import type { CourseSettings, RecurringRule, SnapshotInfo, SnapshotLabel, Template, User } from '@shared/types';
import { BulkCheck, bulkClick, BulkScope, BulkToggle, useBulk } from '../components/Bulk';
import { GuideImportCard } from '../components/Discipline';
import { AbsencesCard } from '../components/Absences';
import { DoneDrawer } from '../components/DoneDrawer';
import { Icon } from '../components/Icon';
import { SectionRail, type RailItem } from '../components/SectionRail';
import { useToast } from '../components/Toasts';
import { DateInput, ErrorBox, Field, Modal, openable, PageHead, Seg, TimeInput } from '../components/ui';
import { api } from '../lib/api';
import { demoHooks, IS_DEMO } from '../lib/demo';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useHashScroll } from '../lib/hashScroll';
import { onThemeChange, setThemePref, themePref, type ThemePref } from '../lib/theme';
import { GenerateWeeks } from './WeeksPage';
import { currentSubscription, disablePush, enablePush, needsHomeScreen, pushSupported } from '../lib/push';
import { ask } from '../components/Confirm';
import { TwoFactorSettings } from '../components/TwoFactor';
import { STAFF_GROUP_RULE_LABELS, type StaffGroupDef } from '@shared/staffGroups';
import { useStaffGroups } from '../lib/taskGroups';

export function SettingsPage() {
  const { isCommander, user } = useSession();
  // the page's parts, in order - each one a stop on the floating strip once the page is scrolled
  const parts: { key: string; label: string; node: ReactNode }[] = [
    ...(isCommander
      ? [
          { key: 'setup', label: 'הקמת הקורס', node: <SetupChecklist /> },
          { key: 'course', label: 'פרטי הקורס', node: <CourseSettingsCard /> },
          { key: 'staff', label: 'סגל ומשתמשים', node: <StaffCard /> },
          { key: 'domains', label: 'תחומים', node: <DomainsCard /> },
          { key: 'groups', label: 'קבוצות סגל', node: <StaffGroupsCard /> },
          { key: 'permissions', label: 'הרשאות', node: <PermissionsCard /> },
          { key: 'guide', label: 'מדרג אכיפה', node: <GuideImportCard /> },
          { key: 'backups', label: 'גיבויים', node: <BackupCard /> },
        ]
      : []),
    { key: 'contact', label: 'פרטי קשר', node: <ContactCard /> },
    { key: 'absences', label: 'היעדרויות', node: <AbsencesCard userId={user.id} mine canEdit /> },
    { key: 'appearance', label: 'מראה', node: <AppearanceCard /> },
    { key: 'push', label: 'התראות', node: <BrowserNotificationsCard /> },
    { key: 'password', label: 'סיסמה', node: <PasswordCard /> },
    { key: 'twofactor', label: 'אימות דו-שלבי', node: <TwoFactorSettings /> },
  ];
  const rail: RailItem[] = parts.map((p, i) => ({ id: `part-${p.key}`, n: i + 1, label: p.label }));
  return (
    <div className="page narrow">
      <PageHead title={isCommander ? 'הגדרות והקמת קורס' : 'הגדרות'} />
      <SectionRail label="חלקי ההגדרות" items={rail} />
      <div className="col gap-16">
        {parts.map((p) => (
          <div key={p.key} id={`part-${p.key}`} className="settings-part">
            {p.node}
          </div>
        ))}
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

const COURSE_FIELDS = ['courseName', 'courseSymbol', 'startDate', 'endDate', 'timezone', 'staleDays', 'defaultDeadlineTime', 'overloadThreshold', 'readinessWarnThreshold'] as const;
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

function CourseSettingsCard() {
  const { settings } = useSession();
  const toast = useToast();
  const [s, setS] = useState<CourseSettings>(settings);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // what the form started from: a change made elsewhere (another card, someone else) comes in to the fields
  // not touched here - never over what is being typed
  const base = useRef(settings);
  useEffect(() => {
    setS((cur) => {
      const next = { ...settings };
      for (const k of COURSE_FIELDS) if (!same(cur[k], base.current[k])) (next as Record<string, unknown>)[k] = cur[k];
      return next;
    });
    base.current = settings;
  }, [settings]);
  const dirty = COURSE_FIELDS.some((k) => !same(s[k], base.current[k]));
  const undo = () => setS(base.current);
  // Ctrl+S / ⌘S saves, while there is something to save
  const saveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [dirty]);
  const save = async () => {
    setError(null);
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => void save();
  return (
    <div className="card" id="course">
      <div className="card-head">
        <h3 className="grow">פרטי הקורס</h3>
        {dirty && <span className="badge t-orange">לא נשמר</span>}
        <button className={`btn btn-sm${dirty ? ' btn-primary' : ''}`} onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'שומר...' : dirty ? 'שמור' : 'נשמר'}
        </button>
      </div>
      {/* while something here is not saved: a bar in sight wherever the page is, to save it or put it back */}
      {dirty &&
        createPortal(
          <div className="save-bar no-print" role="status">
            <span className="small">שינויים בפרטי הקורס שלא נשמרו</span>
            <button type="button" className="btn btn-sm save-bar-undo" onClick={undo}>
              ביטול
            </button>
            <button type="button" className="btn btn-sm save-bar-save" onClick={() => void save()} disabled={saving}>
              {saving ? 'שומר...' : 'שמירה'}
            </button>
          </div>,
          document.body,
        )}
      <div className="card-body">
        <div className="form-grid">
          <Field label="שם הקורס">
            <input className="input" value={s.courseName} onChange={(e) => setS({ ...s, courseName: e.target.value })} />
          </Field>
          <Field label="סמל הקורס" hint="מופיע בכניסה ובתפריט (עד 12 תווים)">
            <input className="input" value={s.courseSymbol} maxLength={12} onChange={(e) => setS({ ...s, courseSymbol: e.target.value })} />
          </Field>
          <Field label="תאריך התחלה">
            <DateInput value={s.startDate ?? ''} onChange={(v) => setS({ ...s, startDate: v || null })} />
          </Field>
          <Field label="תאריך סיום">
            <DateInput value={s.endDate ?? ''} onChange={(v) => setS({ ...s, endDate: v || null })} />
          </Field>
          <Field label="שעת דד-ליין ברירת מחדל">
            <TimeInput value={s.defaultDeadlineTime} onChange={(v) => setS({ ...s, defaultDeadlineTime: v })} />
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
  // the ones who can sign in; the ones turned off are out of the way, in a drawer under them
  const active = (data ?? []).filter((u) => u.active);
  const inactive = (data ?? []).filter((u) => !u.active);
  const table = (list: User[]) => (
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
          {list.map((u) => (
            <StaffRow key={u.id} u={u} onOpen={() => setEditing(u)}>
              <td className="strong">
                <span className="row gap-6">
                  <BulkCheck id={u.id} />
                  {u.displayName}
                </span>
              </td>
              <td className="small">{u.title || '-'}</td>
              <td className="mono small" dir="ltr" style={{ textAlign: 'right' }}>
                {u.username}
              </td>
              <td>
                <span className={`badge${u.role === 'commander' ? ' t-blue' : ''}`}>{ROLE_LABELS[u.role]}</span>
                {!u.active && (
                  <span className="badge t-red" style={{ marginInlineStart: 4 }}>
                    לא פעיל
                  </span>
                )}
              </td>
              <td className="mono small">{u.phone}</td>
              <td>
                <Icon name="edit" size={16} className="muted" />
              </td>
            </StaffRow>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <BulkScope
      entity="users"
      noun="משתמשים"
      topics={['users']}
      ids={(data ?? []).map((u) => u.id)}
      actions={[
        { key: 'active', label: 'השבתה', value: false, confirm: 'להשבית {n} משתמשים? הם ינותקו ולא יוכלו להיכנס עד שיופעלו מחדש.' },
        { key: 'active', label: 'הפעלה', value: true },
      ]}
    >
    <div className="card" id="staff">
      <div className="card-head">
        <Icon name="users" />
        <h3 className="grow">אנשי סגל ומשתמשים</h3>
        <BulkToggle />
        <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> משתמש
        </button>
      </div>
      {table(active)}
      {inactive.length > 0 && (
        <div className="card-body">
          <DoneDrawer id="users-inactive" count={inactive.length} label="לא פעילים">
            {table(inactive)}
          </DoneDrawer>
        </div>
      )}
      {editing && <UserEditor user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
    </BulkScope>
  );
}

function StaffRow({ u, onOpen, children }: { u: User; onOpen: () => void; children: ReactNode }) {
  const bulk = useBulk();
  return (
    <tr className={`click${bulk?.selected.has(u.id) ? ' selected' : ''}`} {...openable(bulkClick(bulk, u.id, onOpen), { role: false })}>
      {children}
    </tr>
  );
}

function UserEditor({ user, onClose }: { user: User | null; onClose: () => void }) {
  const toast = useToast();
  const { staff, user: self } = useSession();
  const [displayName, setDisplayName] = useState(user?.displayName ?? `מפק"צ ${staff.length + 1}`);
  const [title, setTitle] = useState(user?.title ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'staff');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      if (user) await api.patch(`/api/users/${user.id}`, { displayName, title, username, role, phone, email, active, ...(password ? { password } : {}) });
      else await api.post('/api/users', { displayName, title, username, password, role, phone, email });
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
        <Field label={user ? 'סיסמה חדשה (לאיפוס)' : 'סיסמה זמנית'} required={!user} hint="בכניסה הראשונה המשתמש יתבקש לבחור סיסמה אישית">
          <input className="input" dir="ltr" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={user ? 'השאר ריק ללא שינוי' : 'לפחות 8 תווים, אותיות וספרה'} />
        </Field>
        <Field label="טלפון">
          <input className="input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="מייל" hint="לכניסה עם חשבון Google (אם הופעלה)">
          <input className="input" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
        {user?.twoFactor && user.id !== self.id && (
          <div className="span-2 row wrap gap-6 two-step-reset">
            <Icon name="shield" size={16} />
            <span className="small grow">אימות דו-שלבי פעיל. אם הטלפון אבד ואין קודי גיבוי - אפשר לבטל, והמשתמש יפעיל מחדש.</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                if (!(await ask({ title: `לבטל את האימות הדו-שלבי של ${user.displayName}?`, body: 'עד שיפעיל אותו מחדש, הכניסה תהיה בסיסמה בלבד.', confirm: 'ביטול האימות', danger: true }))) return;
                try {
                  await api.patch(`/api/users/${user.id}`, { resetTwoFactor: true });
                  toast({ title: 'האימות הדו-שלבי בוטל', tone: 'green' });
                  emitLocalChange('users');
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              ביטול האימות
            </button>
          </div>
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
  useEffect(() => {
    setDomains(settings.domains);
  }, [settings.domains]);
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

/** The groups tasks go to together: a task given to one of them shows once, under its name. */
function StaffGroupsCard() {
  const { settings, users, user } = useSession();
  const toast = useToast();
  const resolved = useStaffGroups();
  const [groups, setGroups] = useState<StaffGroupDef[]>(settings.staffGroups);
  const [add, setAdd] = useState('');
  useEffect(() => {
    setGroups(settings.staffGroups);
  }, [settings.staffGroups]);
  const people = users.filter((u) => u.active);
  const save = async (list: StaffGroupDef[]) => {
    const before = groups;
    setGroups(list);
    try {
      await api.patch('/api/settings', { staffGroups: list });
      emitLocalChange('settings');
    } catch (e) {
      setGroups(before);
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const change = (id: string, patch: Partial<StaffGroupDef>) => void save(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const rename = (g: StaffGroupDef, name: string) => {
    const v = name.trim();
    if (!v || v === g.name) return;
    if (groups.some((x) => x.id !== g.id && x.name === v)) return toast({ title: 'כבר יש קבוצה בשם הזה', tone: 'red' });
    change(g.id, { name: v });
  };
  return (
    <div className="card" id="groups">
      <div className="card-head">
        <Icon name="users" />
        <h3 className="grow">קבוצות סגל</h3>
      </div>
      <div className="card-body col gap-16">
        <p className="small muted" style={{ margin: 0 }}>
          משימה שניתנה לכמה אנשים מופיעה ברשימות פעם אחת, עם שם הקבוצה שלה בעמודה &quot;קבוצה&quot; - ולא כשורה לכל אחד. בחלון משימה חדשה אפשר לבחור קבוצה בלחיצה.
        </p>
        {groups.map((g) => {
          const members = resolved.find((r) => r.id === g.id)?.memberIds ?? [];
          return (
            <div key={g.id} className="col gap-6 group-def">
              <div className="row gap-8 wrap">
                <input
                  className="input"
                  defaultValue={g.name}
                  key={g.name}
                  aria-label="שם הקבוצה"
                  maxLength={40}
                  style={{ maxWidth: 220, fontWeight: 600 }}
                  onBlur={(e) => rename(g, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="small muted grow">{STAFF_GROUP_RULE_LABELS[g.rule]}</span>
                {g.rule === 'custom' && (
                  <button
                    className="icon-btn"
                    aria-label={`מחיקת הקבוצה ${g.name}`}
                    title="מחיקת הקבוצה"
                    onClick={async () => {
                      if (await ask({ title: `למחוק את הקבוצה "${g.name}"?`, body: 'המשימות עצמן לא נמחקות - הן פשוט יוצגו עם שמות האנשים.', confirm: 'מחיקה', danger: true })) void save(groups.filter((x) => x.id !== g.id));
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
              {g.rule === 'custom' ? (
                <div className="chips">
                  {people.map((u) => {
                    const on = g.memberIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={`chip${on ? ' on' : ''}`}
                        aria-pressed={on}
                        onClick={() => change(g.id, { memberIds: on ? g.memberIds.filter((x) => x !== u.id) : [...g.memberIds, u.id] })}
                      >
                        {u.id === user.id ? `אני (${u.displayName})` : u.displayName}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="small">
                  {members.length ? members.map((id) => users.find((u) => u.id === id)?.displayName ?? '').join(', ') : <span className="muted">{g.rule === 'teamCommanders' ? 'אין עדיין צוות עם מפקד - מגדירים במסך הצוערים' : 'אין אנשי סגל פעילים'}</span>}
                </div>
              )}
              {g.rule === 'custom' && g.memberIds.length < 2 && <span className="tiny text-orange">בחר לפחות שני אנשים כדי שמשימות יופיעו תחת הקבוצה</span>}
            </div>
          );
        })}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const v = add.trim();
            if (!v) return;
            if (groups.some((g) => g.name === v)) return toast({ title: 'כבר יש קבוצה בשם הזה', tone: 'red' });
            void save([...groups, { id: `g${Date.now().toString(36)}`, name: v, rule: 'custom', memberIds: [] }]);
            setAdd('');
          }}
        >
          <input className="input" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="קבוצה חדשה (לדוגמה: צוות הדרכה)" maxLength={40} style={{ maxWidth: 260 }} />
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
    ['יצירת משימות לעצמו ולשאר הסגל', true, true],
    ['פתיחת משימה למפקד הקורס בשבוע שבאחריותו', true, true],
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
      <div className="table-wrap">
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
    </div>
  );
}

function BrowserNotificationsCard() {
  const toast = useToast();
  const supported = !IS_DEMO && pushSupported();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'denied'>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supported) return;
    void currentSubscription().then((sub) => setState(Notification.permission === 'denied' ? 'denied' : sub ? 'on' : 'off'));
  }, [supported]);
  const act = async (fn: () => Promise<unknown>, ok: string, next: typeof state) => {
    setBusy(true);
    try {
      await fn();
      setState(next);
      toast({ title: ok, tone: 'green' });
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
      if (Notification.permission === 'denied') setState('denied');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="bell" />
        <h3 className="grow">התראות לטלפון ולמחשב</h3>
        {state === 'on' && <span className="badge t-green">פעיל במכשיר הזה</span>}
      </div>
      <div className="card-body col gap-6">
        <p className="small">
          התראה תגיע גם כשהאפליקציה סגורה: משימה חדשה, תזכורות לפני דד-ליין, איחורים, חסמים ובקשות שמחכות לך. עדכוני מידע נשארים בתוך המערכת.
        </p>
        {IS_DEMO ? (
          <p className="small muted">בגרסת ההדגמה ההתראות מופיעות בתוך המערכת. התראות לטלפון פועלות במערכת המותקנת על שרת עם HTTPS.</p>
        ) : !supported ? (
          <p className="small muted">הדפדפן הזה לא תומך בהתראות. התראות ימשיכו להופיע בתוך המערכת.</p>
        ) : needsHomeScreen() ? (
          <div className="info-box">באייפון: פתחו את האתר בספארי, לחצו על כפתור השיתוף ואז "הוסף למסך הבית". פתחו את האפליקציה מהמסך הראשי והפעילו כאן את ההתראות.</div>
        ) : state === 'denied' ? (
          <p className="small text-red">ההתראות חסומות בדפדפן. אפשרו אותן בהגדרות האתר (סמל המנעול ליד הכתובת) ונסו שוב.</p>
        ) : (
          <div className="row wrap gap-6">
            {state !== 'on' ? (
              <button className="btn btn-primary" disabled={busy || state === 'loading'} onClick={() => void act(enablePush, 'ההתראות הופעלו במכשיר הזה', 'on')}>
                הפעל התראות במכשיר הזה
              </button>
            ) : (
              <>
                <button className="btn" disabled={busy} onClick={() => void act(() => api.post('/api/push/test'), 'נשלחה התראת בדיקה', 'on')}>
                  שלח התראת בדיקה
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => void act(disablePush, 'ההתראות כובו במכשיר הזה', 'off')}>
                  כבה במכשיר הזה
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DemoDataCard() {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    await demoHooks.reset?.();
  };
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">נתוני ההדגמה</h3>
      </div>
      <div className="card-body row wrap">
        <p className="small grow">זו גרסת הדגמה: כל הנתונים נשמרים רק בדפדפן הזה ואינם משותפים עם אנשים אחרים. איפוס מוחק את השינויים ומחזיר את קורס הדוגמה עם תאריכים של היום.</p>
        <button className={`btn${armed ? ' btn-danger' : ''}`} disabled={busy} onClick={() => void reset()} onBlur={() => setArmed(false)}>
          {armed ? 'לחצו שוב לאישור האיפוס' : 'איפוס נתוני ההדגמה'}
        </button>
      </div>
    </div>
  );
}

function BackupCard() {
  return IS_DEMO ? <DemoDataCard /> : <Backups />;
}

const SNAPSHOT_LABELS: Record<SnapshotLabel, string> = {
  auto: 'אוטומטי',
  manual: 'ידני',
  before_delete: 'לפני מחיקה מרוכזת',
  before_restore: 'לפני שחזור',
  archive: 'קורס קודם',
};
const ALL_TOPICS = ['tasks', 'weeks', 'events', 'templates', 'recurring', 'users', 'settings', 'meetings', 'requests', 'cadets', 'debriefs', 'documents', 'announcements', 'alignment', 'plans'];

/** Snapshots of the whole database: taken automatically, and restored from here (server/src/snapshots.ts). */
function Backups() {
  const toast = useToast();
  const list = useApi<SnapshotInfo[]>('/api/admin/snapshots', ['settings']);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const snaps = list.data ?? [];
  const shown = all ? snaps : snaps.slice(0, 8);

  const take = async () => {
    setBusy('take');
    try {
      await api.post('/api/admin/snapshots', {});
      toast({ title: 'נשמר גיבוי של המצב הנוכחי', tone: 'green' });
      await list.reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(null);
    }
  };
  const restore = async (s: SnapshotInfo) => {
    const when = `${fmtDateTime(s.savedAt)} (${fmtAgo(s.savedAt)})`;
    const ok = await ask({
      title: `לשחזר את המערכת למצב של ${when}?`,
      body: 'כל מה שנוסף או שונה מאז יבוטל, לכל המשתמשים. המצב הנוכחי נשמר כגיבוי "לפני שחזור", כך שאפשר לחזור אליו.',
      confirm: 'שחזור',
      danger: true,
    });
    if (!ok) return;
    setBusy(s.id);
    try {
      await api.post(`/api/admin/snapshots/${encodeURIComponent(s.id)}/restore`, {});
      emitLocalChange(...ALL_TOPICS);
      toast({ title: 'המערכת שוחזרה', body: `למצב של ${when}`, tone: 'green' });
      await list.reload();
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <Icon name="history" />
        <h3 className="grow">גיבויים ושחזור</h3>
        <button className="btn btn-sm" onClick={() => void take()} disabled={!!busy}>
          גיבוי עכשיו
        </button>
        {/* the server sends it as an attachment, so following the link saves the file */}
        <a className="btn btn-sm" href="/api/admin/backup">
          <Icon name="download" /> הורדת עותק
        </a>
      </div>
      <div className="card-body">
        <p className="small muted" style={{ marginTop: 0 }}>
          המערכת שומרת גיבוי של כל הנתונים כל חצי שעה של עבודה, גיבוי אחד לכל יום במשך חודש, וגם רגע לפני מחיקה של הרבה פריטים יחד. אם משהו נמחק או השתבש - אפשר להחזיר מכאן את המצב מכל אחת מהנקודות האלה.
        </p>
        <ErrorBox error={list.error} />
        {list.data && snaps.length === 0 && <div className="small muted">עדיין אין גיבויים - הראשון יישמר אחרי השינוי הבא, או בלחיצה על "גיבוי עכשיו".</div>}
      </div>
      {shown.length > 0 && (
        <div className="list-plain">
          {shown.map((s) => (
            <div key={s.id} className="row snapshot-row">
              <div className="grow">
                <div className="strong small">{fmtDateTime(s.savedAt)}</div>
                <div className="tiny muted">
                  {fmtAgo(s.savedAt)} · {SNAPSHOT_LABELS[s.label] ?? s.label} · {Math.max(1, Math.round(s.bytes / 1024))} KB
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => void restore(s)} disabled={!!busy}>
                {busy === s.id ? 'משחזר...' : 'שחזור'}
              </button>
            </div>
          ))}
          {snaps.length > shown.length && (
            <button className="btn btn-ghost btn-sm snapshot-more" onClick={() => setAll(true)}>
              כל הגיבויים ({snaps.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** my phone and email - for the directory and the call buttons */
function ContactCard() {
  const { user } = useSession();
  const toast = useToast();
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email);
  const [error, setError] = useState<string | null>(null);
  useHashScroll('contact');
  const dirty = phone !== user.phone || email !== user.email;
  const save = async () => {
    setError(null);
    try {
      await api.patch('/api/me/contact', { phone, email });
      emitLocalChange('users');
      toast({ title: 'פרטי הקשר נשמרו', tone: 'green' });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card" id="contact">
      <div className="card-head">
        <Icon name="phone" />
        <h3 className="grow">פרטי הקשר שלי</h3>
      </div>
      <form
        className="card-body col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <span className="small muted">מופיעים באנשי הקשר של הקורס, עם חיוג ווואטסאפ בלחיצה.</span>
        <div className="form-grid">
          <Field label="טלפון">
            <input className="input" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} placeholder="050-0000000" autoComplete="tel" />
          </Field>
          <Field label="מייל">
            <input className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} autoComplete="email" />
          </Field>
        </div>
        <ErrorBox error={error} />
        <div>
          <button className="btn btn-primary btn-sm" disabled={!dirty}>
            שמירה
          </button>
        </div>
      </form>
    </div>
  );
}

function AppearanceCard() {
  const [pref, setPref] = useState<ThemePref>(themePref);
  // the button in the top bar changes it too
  useEffect(() => onThemeChange(() => setPref(themePref())), []);
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">מראה</h3>
      </div>
      <div className="card-body row wrap">
        <span className="grow small muted">בהיר, כהה (נוח בלילה ובשטח), או לפי ההגדרה של המכשיר. נשמר במכשיר הזה.</span>
        <Seg<ThemePref>
          value={pref}
          onChange={(v) => {
            setPref(v);
            setThemePref(v);
          }}
          options={[
            { value: 'auto', label: 'לפי המכשיר' },
            { value: 'light', label: 'בהיר' },
            { value: 'dark', label: 'כהה' },
          ]}
        />
      </div>
    </div>
  );
}

const inDevices = (n: number) => (n === 1 ? 'במכשיר אחד נוסף' : `ב-${n} מכשירים נוספים`);

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessions = useApi<{ others: number }>('/api/auth/sessions');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ others: number }>('/api/auth/password', { current, next });
      toast({ title: 'הסיסמה עודכנה', body: r.others ? `החשבון נותק ${inDevices(r.others)} - שם צריך להתחבר עם הסיסמה החדשה.` : undefined, tone: 'green' });
      setCurrent('');
      setNext('');
      sessions.setData({ others: 0 });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const endOthers = async () => {
    if (!(await ask({ title: 'להתנתק בכל המכשירים האחרים?', body: 'החיבור במכשיר הזה נשאר. בשאר המכשירים צריך יהיה להתחבר מחדש.', confirm: 'ניתוק', danger: true }))) return;
    try {
      const r = await api.post<{ others: number }>('/api/auth/sessions/end-others');
      toast({ title: r.others ? `החשבון נותק ${inDevices(r.others)}` : 'לא היו מכשירים נוספים מחוברים', tone: 'green' });
      sessions.setData({ others: 0 });
    } catch (err) {
      toast({ title: (err as Error).message, tone: 'red' });
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
          <button className="btn" disabled={!current || next.length < 8}>
            עדכן סיסמה
          </button>
          <ErrorBox error={error} />
        </div>
        <div className="span-2 row wrap small" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <span className="grow muted">
            {sessions.data?.others ? `החשבון מחובר גם ${inDevices(sessions.data.others)}.` : 'החשבון מחובר רק במכשיר הזה.'} מכשיר שאבד או מחשב משותף? אפשר לנתק אותו מכאן.
          </span>
          <button type="button" className="btn btn-sm" disabled={!sessions.data?.others} onClick={() => void endOthers()}>
            ניתוק המכשירים האחרים
          </button>
        </div>
      </div>
    </form>
  );
}

// The course directory: the staff, the cadets and the reservists (מילואים) in one searchable list, with call and
// WhatsApp in a tap - and all of them into the phone's contacts as one file. The reservists are a list of the
// course's own (server/src/reservists.ts): anyone on the staff adds to it.

import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ROLE_LABELS } from '@shared/constants';
import { matchesSearch } from '@shared/search';
import type { Cadet, Reservist, Team } from '@shared/types';
import { ContactButtons } from '../components/ContactButtons';
import { Highlight } from '../components/Highlight';
import { Icon } from '../components/Icon';
import { useRowMenu, type RowMenuItem } from '../components/RowMenu';
import { useToast } from '../components/Toasts';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Seg, initials } from '../components/ui';
import { ask } from '../components/Confirm';
import { api } from '../lib/api';
import { emitLocalChange } from '../lib/realtime';
import { telHref, vcard, waHref } from '../lib/contact';
import { saveFile } from '../lib/download';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { SearchInput } from '../components/SearchInput';

export function DirectoryPage() {
  const { users, settings, user, isCommander } = useSession();
  const cadets = useApi<Cadet[]>('/api/cadets?status=active', ['cadets']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']).data ?? [];
  const reserve = useApi<Reservist[]>('/api/reservists', ['users']);
  const [tab, setTab] = useState<'staff' | 'cadets' | 'reserve'>('staff');
  const [q, setQ] = useState('');
  // a reservist being added (null) or edited
  const [editing, setEditing] = useState<Reservist | null | undefined>(undefined);

  const staff = users.filter((u) => matchesSearch(q, u.displayName, u.title, u.phone, u.email));
  const cadetList = (cadets.data ?? []).filter((c) => matchesSearch(q, c.fullName, c.teamName, c.phone, c.personalNumber));
  const reserveList = (reserve.data ?? []).filter((r) => matchesSearch(q, r.fullName, r.role, r.phone, r.notes));
  const byTeam = new Map<string, Cadet[]>();
  for (const c of cadetList) byTeam.set(c.teamName ?? 'ללא צוות', [...(byTeam.get(c.teamName ?? 'ללא צוות') ?? []), c]);

  const exportContacts = () => {
    const file =
      tab === 'staff'
        ? vcard(users.filter((u) => u.phone || u.email).map((u) => ({ name: u.displayName, phone: u.phone, email: u.email, org: settings.courseName, title: u.title || ROLE_LABELS[u.role] })))
        : tab === 'reserve'
          ? vcard((reserve.data ?? []).filter((r) => r.phone || r.email).map((r) => ({ name: r.fullName, phone: r.phone, email: r.email, org: settings.courseName, title: r.role ? `מילואים - ${r.role}` : 'מילואים' })))
          : vcard((cadets.data ?? []).filter((c) => c.phone).map((c) => ({ name: c.fullName, phone: c.phone, org: settings.courseName, title: c.teamName ? `צוער - ${c.teamName}` : 'צוער' })));
    void saveFile(tab === 'staff' ? 'סגל-הקורס.vcf' : tab === 'reserve' ? 'מילואים-הקורס.vcf' : 'צוערי-הקורס.vcf', new Blob([file], { type: 'text/vcard;charset=utf-8' }));
  };
  const missingMine = !user.phone;

  return (
    <div className="page narrow">
      <PageHead
        title="אנשי קשר"
        sub="הסגל, הצוערים והמילואים - חיוג ווואטסאפ בלחיצה."
        actions={
          <button className="btn" onClick={exportContacts} title="קובץ אחד שמוסיף את כולם לאנשי הקשר בטלפון">
            <Icon name="download" /> לאנשי הקשר בטלפון
          </button>
        }
      />
      {missingMine && (
        <div className="info-box mb-12">
          המספר שלך עוד לא מופיע כאן. <Link to="/settings#contact">הוספת טלפון</Link>
        </div>
      )}
      <div className="row wrap gap-6 mb-12">
        <Seg
          value={tab}
          onChange={setTab}
          options={[
            { value: 'staff', label: `סגל (${users.length})` },
            { value: 'cadets', label: `צוערים (${cadets.data?.length ?? '...'})` },
            { value: 'reserve', label: `מילואים (${reserve.data?.length ?? '...'})` },
          ]}
        />
        <SearchInput className="input grow" value={q} placeholder={tab === 'reserve' ? 'חיפוש שם, תפקיד או מספר...' : 'חיפוש שם, צוות או מספר...'} aria-label="חיפוש איש קשר" style={{ maxWidth: 320 }} onValue={setQ} />
      </div>

      {q.trim() && (
        <div className="tiny muted mb-12" role="status">
          {tab === 'staff' ? (staff.length ? `${staff.length} בסגל` : '') : tab === 'reserve' ? (reserveList.length ? `${reserveList.length} במילואים` : '') : cadetList.length ? `${cadetList.length} צוערים` : ''}
        </div>
      )}
      {tab === 'reserve' ? (
        <ReserveList list={reserveList} all={reserve.data} loading={reserve.loading} q={q} onAdd={() => setEditing(null)} onEdit={setEditing} />
      ) : tab === 'staff' ? (
        !staff.length ? (
          <Empty icon="search" title="לא נמצא" />
        ) : (
          <div className="card">
            {staff.map((u) => (
              <Contact key={u.id} name={u.displayName} phone={u.phone} email={u.email} open={isCommander ? `/team/${u.id}` : undefined} openLabel="דף איש הסגל">
                <div className="strong">
                  <Highlight text={u.displayName} q={q} />
                </div>
                <div className="tiny muted">
                  {[u.title || ROLE_LABELS[u.role], teams.filter((t) => t.commanderId === u.id).map((t) => `מפקד ${t.name}`).join(', '), u.phone].filter(Boolean).join(' · ')}
                </div>
              </Contact>
            ))}
          </div>
        )
      ) : cadets.loading && !cadets.data ? (
        <Loading rows={4} />
      ) : !cadetList.length ? (
        <Empty icon="search" title={cadets.data?.length ? 'לא נמצא' : 'אין צוערים'} />
      ) : (
        <div className="col gap-12">
          {[...byTeam].map(([team, list]) => (
            <div key={team} className="card">
              <div className="card-head">
                <Icon name="users" />
                <h3 className="grow">{team}</h3>
                <span className="mono tiny muted">{list.length}</span>
              </div>
              {list.map((c) => (
                <Contact key={c.id} name={c.fullName} phone={c.phone} open={`/cadets/${c.id}`} openLabel="תיק הצוער">
                  <Link to={`/cadets/${c.id}`} className="strong">
                    <Highlight text={c.fullName} q={q} />
                  </Link>
                  <div className="tiny muted">{[c.personalNumber, c.phone || 'אין מספר'].filter(Boolean).join(' · ')}</div>
                </Contact>
              ))}
            </div>
          ))}
        </div>
      )}
      {editing !== undefined && <ReservistDialog reservist={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

/** the reservists: who they are and what they do here, a tap to call - and to add one, or fix a number */
function ReserveList({ list, all, loading, q, onAdd, onEdit }: { list: Reservist[]; all?: Reservist[]; loading: boolean; q: string; onAdd: () => void; onEdit: (r: Reservist) => void }) {
  if (loading && !all) return <Loading rows={3} />;
  return (
    <div className="col gap-12">
      <div>
        <button type="button" className="btn" onClick={onAdd}>
          <Icon name="plus" /> איש מילואים
        </button>
      </div>
      {!list.length ? (
        <Empty icon={all?.length ? 'search' : 'users'} title={all?.length ? 'לא נמצא' : 'אין עדיין אנשי מילואים'} text={all?.length ? undefined : 'מי שמגיע לקורס במילואים - מספר הטלפון שלו כאן, לחיוג ולוואטסאפ בלחיצה.'} />
      ) : (
        <div className="card">
          {list.map((r) => (
            <Contact
              key={r.id}
              name={r.fullName}
              phone={r.phone}
              email={r.email || undefined}
              openLabel="עריכה"
              extra={[{ key: 'edit', label: 'עריכה', icon: 'edit', run: () => onEdit(r) }]}
              onEdit={() => onEdit(r)}
            >
              <div className="strong">
                <Highlight text={r.fullName} q={q} />
              </div>
              <div className="tiny muted">
                <Highlight text={r.role || 'מילואים'} q={q} />
                {' · '}
                {/* a number reads left to right, whole, inside the Hebrew line */}
                {r.phone ? (
                  <bdi className="phone-ltr" dir="ltr">
                    {r.phone}
                  </bdi>
                ) : (
                  'אין מספר'
                )}
                {r.notes && (
                  <>
                    {' · '}
                    <Highlight text={r.notes} q={q} />
                  </>
                )}
              </div>
            </Contact>
          ))}
        </div>
      )}
    </div>
  );
}

/** a reservist added, or their details fixed (and removed - by the commander or whoever added them) */
function ReservistDialog({ reservist, onClose }: { reservist: Reservist | null; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ fullName: reservist?.fullName ?? '', phone: reservist?.phone ?? '', email: reservist?.email ?? '', role: reservist?.role ?? '', notes: reservist?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const done = (title: string) => {
    emitLocalChange('users');
    toast({ title, tone: 'green' });
    onClose();
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (reservist) await api.patch(`/api/reservists/${reservist.id}`, form);
      else await api.post('/api/reservists', form);
      done(reservist ? 'נשמר' : `${form.fullName.trim()} נוסף למילואים`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!reservist || !(await ask({ title: `להסיר את ${reservist.fullName}?`, body: 'הוא יוסר מאנשי הקשר של המילואים.', confirm: 'הסרה', danger: true }))) return;
    try {
      await api.del(`/api/reservists/${reservist.id}`);
      done(`${reservist.fullName} הוסר`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={reservist ? reservist.fullName : 'איש מילואים'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !form.fullName.trim()}>
            <Icon name="check" /> שמירה
          </button>
          {reservist?.canDelete && (
            <button className="btn btn-ghost" onClick={() => void remove()} disabled={busy}>
              <Icon name="trash" /> הסרה
            </button>
          )}
        </>
      }
    >
      <form
        className="col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.fullName.trim()) void save();
        }}
      >
        <Field label="שם מלא" required>
          <input className="input" value={form.fullName} onChange={set('fullName')} maxLength={80} autoFocus={!reservist} />
        </Field>
        <Field label="טלפון">
          <input className="input" type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={set('phone')} maxLength={30} placeholder="050-0000000" />
        </Field>
        <Field label="תפקיד / מה עושה בקורס" hint="למשל: מדריך ירי, נהג, חובש">
          <input className="input" value={form.role} onChange={set('role')} maxLength={80} />
        </Field>
        <Field label="מייל">
          <input className="input" type="email" inputMode="email" dir="ltr" value={form.email} onChange={set('email')} maxLength={120} />
        </Field>
        <Field label="הערות">
          <input className="input" value={form.notes} onChange={set('notes')} maxLength={500} placeholder="מתי מגיע, יחידה, זמינות" />
        </Field>
        <button type="submit" hidden />
      </form>
      <ErrorBox error={error} />
    </Modal>
  );
}

/** one person: call and WhatsApp at hand; held or right-clicked, also the number to copy, a mail, their page */
function Contact({
  name,
  phone,
  email,
  open,
  openLabel,
  extra = [],
  onEdit,
  children,
}: {
  name: string;
  phone: string;
  email?: string;
  open?: string;
  openLabel: string;
  /** more in its menu (a reservist: edit) */
  extra?: RowMenuItem[];
  /** a button of its own to edit it */
  onEdit?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const tel = telHref(phone);
  const wa = waHref(phone);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      toast({ title: 'המספר הועתק', body: `${name} · ${phone}`, tone: 'green' });
    } catch {
      toast({ title: phone, tone: 'gray' });
    }
  };
  const items: RowMenuItem[] = [
    ...(tel ? [{ key: 'call', label: 'חיוג', icon: 'phone', primary: true, run: () => void (location.href = tel) }] : []),
    ...(wa ? [{ key: 'wa', label: 'וואטסאפ', icon: 'message', run: () => void window.open(wa, '_blank', 'noopener') }] : []),
    ...(phone ? [{ key: 'copy', label: 'העתקת המספר', icon: 'copy', run: () => void copy() }] : []),
    ...(email ? [{ key: 'mail', label: 'מייל', icon: 'mail', run: () => void (location.href = `mailto:${email}`) }] : []),
    ...(open ? [{ key: 'open', label: openLabel, icon: 'chevronLeft', run: () => navigate(open) }] : []),
    ...extra,
  ];
  const menu = useRowMenu({ title: name, items, disabled: items.length < 2, links: true });
  return (
    <div className={`contact-row holdable${menu.lifted ? ' is-lifted' : ''}`} {...menu.bind}>
      <span className="avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        {children}
      </div>
      {email && (
        <a className="icon-btn" href={`mailto:${email}`} aria-label={`מייל ל${name}`} title={email}>
          <Icon name="mail" size={16} />
        </a>
      )}
      <ContactButtons phone={phone} name={name} compact />
      {onEdit && (
        <button type="button" className="icon-btn" aria-label={`עריכת ${name}`} title="עריכה" onClick={onEdit}>
          <Icon name="edit" size={16} />
        </button>
      )}
      {menu.menu}
    </div>
  );
}

// The course directory: the staff and the cadets in one searchable list, with call and
// WhatsApp in a tap - and all of them into the phone's contacts as one file.

import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ROLE_LABELS } from '@shared/constants';
import { matchesSearch } from '@shared/search';
import type { Cadet, Team } from '@shared/types';
import { ContactButtons } from '../components/ContactButtons';
import { Highlight } from '../components/Highlight';
import { Icon } from '../components/Icon';
import { useRowMenu, type RowMenuItem } from '../components/RowMenu';
import { useToast } from '../components/Toasts';
import { Empty, Loading, PageHead, Seg, initials } from '../components/ui';
import { telHref, vcard, waHref } from '../lib/contact';
import { saveFile } from '../lib/download';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function DirectoryPage() {
  const { users, settings, user, isCommander } = useSession();
  const cadets = useApi<Cadet[]>('/api/cadets?status=active', ['cadets']);
  const teams = useApi<Team[]>('/api/teams', ['cadets']).data ?? [];
  const [tab, setTab] = useState<'staff' | 'cadets'>('staff');
  const [q, setQ] = useState('');

  const staff = users.filter((u) => matchesSearch(q, u.displayName, u.title, u.phone, u.email));
  const cadetList = (cadets.data ?? []).filter((c) => matchesSearch(q, c.fullName, c.teamName, c.phone, c.personalNumber));
  const byTeam = new Map<string, Cadet[]>();
  for (const c of cadetList) byTeam.set(c.teamName ?? 'ללא צוות', [...(byTeam.get(c.teamName ?? 'ללא צוות') ?? []), c]);

  const exportContacts = () => {
    const file =
      tab === 'staff'
        ? vcard(users.filter((u) => u.phone || u.email).map((u) => ({ name: u.displayName, phone: u.phone, email: u.email, org: settings.courseName, title: u.title || ROLE_LABELS[u.role] })))
        : vcard((cadets.data ?? []).filter((c) => c.phone).map((c) => ({ name: c.fullName, phone: c.phone, org: settings.courseName, title: c.teamName ? `צוער - ${c.teamName}` : 'צוער' })));
    void saveFile(tab === 'staff' ? 'סגל-הקורס.vcf' : 'צוערי-הקורס.vcf', new Blob([file], { type: 'text/vcard;charset=utf-8' }));
  };
  const missingMine = !user.phone;

  return (
    <div className="page narrow">
      <PageHead
        title="אנשי קשר"
        sub="הסגל והצוערים - חיוג ווואטסאפ בלחיצה."
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
          ]}
        />
        <input className="input grow" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש שם, צוות או מספר..." aria-label="חיפוש איש קשר" style={{ maxWidth: 320 }} />
      </div>

      {q.trim() && (
        <div className="tiny muted mb-12" role="status">
          {tab === 'staff' ? (staff.length ? `${staff.length} בסגל` : '') : cadetList.length ? `${cadetList.length} צוערים` : ''}
        </div>
      )}
      {tab === 'staff' ? (
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
    </div>
  );
}

/** one person: call and WhatsApp at hand; held or right-clicked, also the number to copy, a mail, their page */
function Contact({ name, phone, email, open, openLabel, children }: { name: string; phone: string; email?: string; open?: string; openLabel: string; children: ReactNode }) {
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
      {menu.menu}
    </div>
  );
}

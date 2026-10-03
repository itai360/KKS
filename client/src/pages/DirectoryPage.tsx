// The course directory: the staff and the cadets in one searchable list, with call and
// WhatsApp in a tap - and all of them into the phone's contacts as one file.

import { useState } from 'react';
import { Link } from 'react-router';
import { ROLE_LABELS } from '@shared/constants';
import { matchesSearch } from '@shared/search';
import type { Cadet, Team } from '@shared/types';
import { ContactButtons } from '../components/ContactButtons';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead, Seg, initials } from '../components/ui';
import { vcard } from '../lib/contact';
import { saveFile } from '../lib/download';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

export function DirectoryPage() {
  const { users, settings, user } = useSession();
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

      {tab === 'staff' ? (
        !staff.length ? (
          <Empty icon="search" title="לא נמצא" />
        ) : (
          <div className="card">
            {staff.map((u) => (
              <div key={u.id} className="contact-row">
                <span className="avatar" aria-hidden="true">
                  {initials(u.displayName)}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="strong">{u.displayName}</div>
                  <div className="tiny muted">
                    {[u.title || ROLE_LABELS[u.role], teams.filter((t) => t.commanderId === u.id).map((t) => `מפקד ${t.name}`).join(', '), u.phone].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {u.email && (
                  <a className="icon-btn" href={`mailto:${u.email}`} aria-label={`מייל ל${u.displayName}`} title={u.email}>
                    <Icon name="mail" size={16} />
                  </a>
                )}
                <ContactButtons phone={u.phone} name={u.displayName} compact />
              </div>
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
                <div key={c.id} className="contact-row">
                  <span className="avatar" aria-hidden="true">
                    {initials(c.fullName)}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link to={`/cadets/${c.id}`} className="strong">
                      {c.fullName}
                    </Link>
                    <div className="tiny muted">{[c.personalNumber, c.phone || 'אין מספר'].filter(Boolean).join(' · ')}</div>
                  </div>
                  <ContactButtons phone={c.phone} name={c.fullName} compact />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

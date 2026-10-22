// Plan approval (server/src/plans.ts): a document for every course week that the commander
// presents to the commander above them. It starts as a draft written from the course's data;
// any part can be rewritten, the approval is recorded, and the document prints as is.

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { shortDate } from '@shared/dates';
import type { PlanDocument, PlanSectionKey, PlansOverview, PlanStatus } from '@shared/types';
import { DocPager, ShareButton, useDocNav, type DocLink } from '../components/DocNav';
import { ApproveDialog, dateRange as range, EditButton, EditDialog, KIND_LABELS, PLAN_STATUS as STATUS, Prep, StatusSteps, whenOf as when, Wording } from '../components/PlanParts';
import { Icon } from '../components/Icon';
import { SectionRail, type RailItem } from '../components/SectionRail';
import { useToast } from '../components/Toasts';
import { Empty, Loading, openable, PageError, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { todayKey } from '../lib/format';
import { haptic } from '../lib/haptics';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { usePageTitle } from '../lib/title';
import { useApi } from '../lib/useApi';

const SECTION_TITLES: Record<PlanSectionKey, string> = {
  goals: 'מטרות השבוע',
  achievements: 'הישגים נדרשים',
  emphases: 'דגשים',
  requests: 'בקשות מהמפקד הממונה',
};

const AHEAD = ['שבוע התוכנית', 'שבוע אחרי', 'שבועיים אחרי', 'שלושה שבועות אחרי'];
const TOPICS = ['plans', 'weeks', 'events', 'tasks', 'users', 'cadets', 'debriefs'];

// ---------------- the weeks ----------------

export function PlansPage() {
  const navigate = useNavigate();
  const { data, error, status, loading } = useApi<PlansOverview>('/api/plans', TOPICS);

  if (loading && !data)
    return (
      <div className="page">
        <PageHead title="אישור תוכניות" />
        <Loading rows={5} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageHead title="אישור תוכניות" />
        <PageError error={error} status={status} what="אישור התוכניות" back="/" backLabel="לדף הבית" />
      </div>
    );

  const at = data.weeks.findIndex((w) => w.week.id === data.currentWeekId);
  const today = todayKey();
  const past = data.weeks.filter((w) => w.week.endDate < today);
  const ahead = data.weeks.filter((w) => w.week.endDate >= today);
  // the next one to present: from this week on, the first that is not approved as it stands
  const next = data.weeks.slice(Math.max(0, at)).find((w) => w.status !== 'approved' || w.changed);
  const count = (s: PlanStatus) => data.weeks.filter((w) => w.status === s).length;

  return (
    <div className="page">
      <PageHead
        title="אישור תוכניות"
        sub="מסמך לכל שבוע בקורס, להצגה למפקד הממונה: אירועי המפתח וארבעה שבועות קדימה, מטרות, הישגים נדרשים, דגשים, סיכונים ומה נדרש ממנו."
        actions={
          <>
            <button className="btn" onClick={() => navigate('/three-week')}>
              <Icon name="threeWeeks" /> תלת שבועי
            </button>
            {next && (
              <button className="btn btn-primary" onClick={() => navigate(`/plans/${next.week.id}`)}>
                הבא להצגה: {next.week.name} <Icon name="chevronLeft" />
              </button>
            )}
          </>
        }
      />
      {data.weeks.length === 0 ? (
        <Empty
          icon="layers"
          title="אין עדיין שבועות בקורס"
          text={
            <>
              המסמכים נבנים לפי שבועות הקורס. <Link to="/weeks">להגדרת השבועות</Link>
            </>
          }
        />
      ) : (
        <>
          <div className="plan-progress-all" role="img" aria-label={`${count('approved')} מתוך ${data.weeks.length} אושרו, ${count('ready')} מוכנים להצגה, ${count('draft')} בטיוטה`}>
            {(['approved', 'ready', 'draft'] as const).map((st) =>
              count(st) ? <span key={st} className={`is-${st}`} style={{ flexGrow: count(st) }} /> : null,
            )}
          </div>
          <div className="row wrap gap-6 small muted plan-counts">
            <span className="badge t-green">{count('approved')} אושרו</span>
            <span className="badge t-blue">{count('ready')} מוכנים להצגה</span>
            <span className="badge t-gray">{count('draft')} בטיוטה</span>
            {data.weeks.some((w) => w.changed) && <span className="badge t-yellow">{data.weeks.filter((w) => w.changed).length} השתנו מאז האישור</span>}
          </div>
          {/* what is over folds into a row of small links, as on the weeks page: the week now and the ones to come lead */}
          {past.length > 0 && (
            <section className="weeks-past" aria-label="שבועות שעברו">
              <span className="label-caps">שבועות שעברו</span>
              <div className="weeks-past-list">
                {past.map(({ week: w, status: s }) => (
                  <Link key={w.id} to={`/plans/${w.id}`} className={`week-pill${s !== 'approved' ? ' is-open' : ''}`}>
                    <span className="week-pill-num">{w.number}</span>
                    <span className="week-pill-name">{w.name}</span>
                    <span className={`week-pill-pct ${STATUS[s].tone}`}>{STATUS[s].label}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <div className="weeks-track fade-in">
            {ahead.map(({ week: w, status: s, approval, changed, edited }) => {
              const current = w.id === data.currentWeekId;
              return (
                <div key={w.id} className={`card week-card plan-card${current ? ' current' : ''}`} {...openable(() => navigate(`/plans/${w.id}`))} aria-label={`אישור תוכנית - ${w.name}`}>
                  <span className="week-num">{w.number}</span>
                  <div style={{ position: 'relative' }}>
                    <div className="row gap-6 wrap">
                      {current && <span className="badge t-orange">השבוע</span>}
                      <span className={`badge ${STATUS[s].tone}`}>{STATUS[s].label}</span>
                      {changed && <span className="badge t-yellow">השתנה מאז האישור</span>}
                      {edited && <span className="badge">נערך</span>}
                    </div>
                    <div className="strong mt-8" style={{ fontSize: 19 }}>
                      {w.name}
                    </div>
                    {w.topic && <div className="small muted">{w.topic}</div>}
                    <div className="tiny muted mt-8">
                      <span className="mono">{range(w.startDate, w.endDate)}</span>
                    </div>
                  </div>
                  <div className="small">
                    {approval ? (
                      <>
                        <Icon name="check" size={14} /> אושר ע"י {approval.by} ב-<span className="mono">{shortDate(approval.on)}</span>
                      </>
                    ) : (
                      <span className="muted">{s === 'ready' ? 'מוכן, ממתין להצגה' : 'טיוטה אוטומטית מהלו"ז'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- one week's document ----------------

function Horizon({ doc }: { doc: PlanDocument }) {
  return (
    <div className="plan-horizon">
      {doc.horizon.map((w, i) => (
        <div key={w.weekId ?? i} className={`plan-week${i === 0 ? ' this' : ''}`}>
          <div className="tiny muted">{AHEAD[i]}</div>
          <div className="strong">{w.name}</div>
          <div className="tiny muted mono">{range(w.startDate, w.endDate)}</div>
          {w.events.length ? (
            <ul>
              {w.events.map((e) => (
                <li key={e.key}>
                  <span className="mono tiny">{e.endDate !== e.date ? range(e.date, e.endDate) : shortDate(e.date)}</span> {e.title} <span className={`plan-kind k-${e.kind}`}>{KIND_LABELS[e.kind]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="small muted mt-8">אין עדיין אירועי מפתח</div>
          )}
          {w.more > 0 && <div className="tiny muted">ועוד {w.more} פעילויות</div>}
        </div>
      ))}
      {doc.horizon.length < 4 && (
        <div className="plan-week end">
          <div className="strong">סיום הקורס</div>
        </div>
      )}
    </div>
  );
}

export function PlanPage() {
  const { id } = useParams();
  const toast = useToast();
  const { settings, weeks, viewing, isCommander } = useSession();
  const { data: doc, error, status, loading, setData } = useApi<PlanDocument>(`/api/plans/${id}`, TOPICS);
  const [editing, setEditing] = useState<PlanSectionKey | 'bluf' | null>(null);
  const [approving, setApproving] = useState(false);
  // the approval just recorded: its line at the foot of the document comes in, stamped
  const [justApproved, setJustApproved] = useState(false);
  useEffect(() => {
    if (!justApproved) return;
    document.querySelector('.plan-approval')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    const t = setTimeout(() => setJustApproved(false), 2200);
    return () => clearTimeout(t);
  }, [justApproved]);
  usePageTitle(doc ? `אישור תוכנית - ${doc.week.name}` : 'אישור תוכנית');
  // the week before and after: by name, the arrows, a swipe on a phone
  const page = useRef<HTMLDivElement>(null);
  const at = weeks.findIndex((x) => x.id === Number(id));
  const link = (i: number): DocLink | null => {
    const x = weeks[i];
    return x ? { to: `/plans/${x.id}`, label: `שבוע ${x.number} · ${x.name}`, api: `/api/plans/${x.id}` } : null;
  };
  const prev = at > 0 ? link(at - 1) : null;
  const next = at >= 0 ? link(at + 1) : null;
  useDocNav({ prev, next, swipe: page });

  if (loading && !doc)
    return (
      <div className="page" ref={page}>
        <Loading rows={7} />
      </div>
    );
  if (!doc)
    return (
      <div className="page" ref={page}>
        <PageError error={error} status={status} what="השבוע" back="/plans" backLabel="לאישור תוכניות" />
      </div>
    );

  const w = doc.week;
  const keyEvents = doc.horizon[0]?.events ?? [];
  const canEdit = !viewing;

  const save = async (body: Record<string, unknown>, done?: string) => {
    const d = await api.patch<PlanDocument>(`/api/plans/${w.id}`, body);
    setData(d);
    emitLocalChange('plans');
    if (done) toast({ title: done, tone: 'green' });
  };
  const saveSection = (k: PlanSectionKey | 'bluf') => async (value: string | null) => {
    if (k === 'bluf') return save({ bluf: value === null ? null : value.trim() });
    const items = value === null ? null : value.split('\n').map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    return save({ [k]: items });
  };
  const setStatus = (s: 'draft' | 'ready', done: string) => void save({ status: s }, done).catch((e: Error) => toast({ title: e.message, tone: 'red' }));

  const section = (k: PlanSectionKey, n: number, ordered = true) => {
    const s = doc.sections[k];
    const List = ordered ? 'ol' : 'ul';
    return (
      <section id={`plan-${k}`}>
        <div className="plan-h2">
          <h2>
            {n}. {SECTION_TITLES[k]}
          </h2>
          <Wording edited={s.edited} />
          {canEdit && <EditButton label={SECTION_TITLES[k]} onClick={() => setEditing(k)} />}
        </div>
        {s.items.length ? (
          <List className="doc-list">
            {s.items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </List>
        ) : (
          <p className="muted">אין סעיפים.</p>
        )}
        {k === 'requests' && doc.visit && (
          <div className="plan-visit">
            <Icon name="flag" size={16} />
            <span>
              <b>הזמן הטוב לבקר בקורס:</b> {doc.visit.title}, {doc.visit.endDate !== doc.visit.date ? '' : 'יום '}
              {when(doc.visit)}
              {doc.visit.startTime && doc.visit.endDate === doc.visit.date && `, ${doc.visit.startTime}${doc.visit.endTime ? `-${doc.visit.endTime}` : ''}`}
              {doc.visit.location && `, ${doc.visit.location}`}
            </span>
          </div>
        )}
      </section>
    );
  };

  const parts: RailItem[] = [
    ['plan-bluf', 'השורה התחתונה'],
    ['plan-horizon', 'ארבעה שבועות'],
    ['plan-events', 'אירועי המפתח'],
    ['plan-goals', 'מטרות'],
    ['plan-achievements', 'הישגים'],
    ['plan-emphases', 'דגשים'],
    ['plan-risks', 'סיכונים'],
    ['plan-picture', 'תמונת מצב'],
    ...(doc.lessons.length ? [['plan-lessons', 'לקחים']] : []),
    ['plan-requests', 'בקשות'],
  ].map(([id, label], i) => ({ id, label, n: i + 1 }));

  return (
    <div className="page doc-page" ref={page}>
      <div className="doc-toolbar no-print">
        <DocPager prev={prev} next={next} noun="מסמכי אישור התוכנית" position={at >= 0 ? `${at + 1} מתוך ${weeks.length}` : undefined} />
        <StatusSteps status={doc.status} />
        {doc.changes.length > 0 && <span className="badge t-yellow">השתנה מאז האישור</span>}
        <span className="grow" />
        {canEdit && doc.status === 'draft' && (
          <button className="btn" onClick={() => setStatus('ready', 'המסמך מסומן כמוכן להצגה')}>
            <Icon name="check" /> מוכן להצגה
          </button>
        )}
        {canEdit && doc.status === 'ready' && (
          <button className="btn btn-ghost" onClick={() => setStatus('draft', 'המסמך חזר לטיוטה')}>
            חזרה לטיוטה
          </button>
        )}
        {/* approving - and taking an approval back - is the commander's */}
        {canEdit && isCommander && doc.status === 'approved' && (
          <button className="btn btn-ghost" onClick={() => setStatus('ready', 'האישור בוטל')}>
            ביטול האישור
          </button>
        )}
        {canEdit && isCommander && (
          <button className="btn" onClick={() => setApproving(true)}>
            <Icon name="shield" /> {doc.status === 'approved' ? 'עדכון האישור' : 'רישום אישור'}
          </button>
        )}
        <ShareButton title={`אישור תוכנית - ${w.name}`} />
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" /> הדפסה / PDF
        </button>
      </div>

      <SectionRail label="חלקי המסמך" items={parts} />
      <article className="doc plan-doc" aria-label={`אישור תוכנית - ${w.name}`}>
        <header className="doc-head">
          <div className="doc-kicker">{settings.courseName}</div>
          <h1 data-bar-title={`אישור תוכנית - שבוע ${w.number}`}>אישור תוכנית</h1>
          <div className="doc-title">
            שבוע {w.number} · {w.name}
          </div>
          <table className="doc-meta">
            <tbody>
              <tr>
                <th>תאריכים</th>
                <td className="mono">{range(w.startDate, w.endDate)}</td>
                <th>מפק"צ השבוע</th>
                <td>{w.leadName ?? '-'}</td>
              </tr>
              <tr>
                <th>מיקום בקורס</th>
                <td>
                  שבוע {doc.position.index} מתוך {doc.position.total}
                  {doc.position.daysLeft !== null && ` · ${doc.position.daysLeft} ימים לסיום`}
                </td>
                <th>מוכנות</th>
                <td>{w.totalTasks ? `${w.readiness}% (${w.doneTasks}/${w.totalTasks} משימות)` : 'אין משימות הכנה'}</td>
              </tr>
            </tbody>
          </table>
          <div className="plan-progress" role="img" aria-label={`שבוע ${doc.position.index} מתוך ${doc.position.total}`}>
            {Array.from({ length: doc.position.total }, (_, i) => (
              <span key={i} className={i + 1 < doc.position.index ? 'past' : i + 1 === doc.position.index ? 'now' : ''} />
            ))}
          </div>
        </header>

        {doc.changes.length > 0 && (
          <div className="plan-changes" role="note">
            <b>השתנה מאז האישור ב-{doc.approval ? shortDate(doc.approval.on) : ''}:</b>
            <ul>
              {doc.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        <section id="plan-bluf">
          <div className="plan-h2">
            <h2>1. השורה התחתונה</h2>
            <Wording edited={doc.bluf.edited} />
            {canEdit && <EditButton label="השורה התחתונה" onClick={() => setEditing('bluf')} />}
          </div>
          <p className="plan-bluf">{doc.bluf.text}</p>
        </section>

        <section id="plan-horizon">
          <h2>2. מבט על ארבעה שבועות</h2>
          <Horizon doc={doc} />
        </section>

        <section id="plan-events">
          <h2>3. אירועי המפתח השבוע</h2>
          {keyEvents.length ? (
            <table className="doc-table plan-events">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>מתי</th>
                  <th>פעילות</th>
                  <th style={{ width: '18%' }}>מקום</th>
                  <th style={{ width: '16%' }}>אחראי</th>
                  <th style={{ width: 110 }}>הכנות</th>
                </tr>
              </thead>
              <tbody>
                {keyEvents.map((e) => (
                  <tr key={e.key}>
                    <td className="mono">
                      {when(e)}
                      {e.startTime && e.endDate === e.date && (
                        <div className="tiny muted">
                          {e.startTime}
                          {e.endTime ? `-${e.endTime}` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      {e.title} <span className={`plan-kind k-${e.kind}`}>{KIND_LABELS[e.kind]}</span>
                      {e.night && <span className="plan-kind k-night">לילה</span>}
                    </td>
                    <td>{e.location || '-'}</td>
                    <td>{e.ownerName ?? '-'}</td>
                    <td>
                      <Prep e={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              אין עדיין אירועי מפתח בלו"ז של השבוע. <Link className="no-print" to="/schedule">ללו"ז</Link>
            </p>
          )}
        </section>

        {section('goals', 4)}
        {section('achievements', 5)}
        {section('emphases', 6, false)}

        <section id="plan-risks">
          <h2>7. סיכונים ומענה</h2>
          {doc.risks.length ? (
            <table className="doc-table plan-risks">
              <thead>
                <tr>
                  <th>נקודה</th>
                  <th style={{ width: '42%' }}>מענה</th>
                </tr>
              </thead>
              <tbody>
                {doc.risks.map((r, i) => (
                  <tr key={i} className={r.level}>
                    <td>
                      <span className={`plan-level ${r.level}`}>{r.level === 'high' ? 'גבוה' : 'בינוני'}</span> {r.text}
                    </td>
                    <td>{r.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">לא זוהו נקודות שדורשות מענה מיוחד.</p>
          )}
        </section>

        <section id="plan-picture">
          <h2>8. תמונת מצב</h2>
          <div className="plan-kpis">
            <div>
              <b>{doc.cadets.active}</b>
              <span>צוערים פעילים</span>
            </div>
            <div>
              <b>{doc.cadets.dropped}</b>
              <span>הודחו / פרשו</span>
            </div>
            <div className={doc.cadets.watch ? 'warn' : ''}>
              <b>{doc.cadets.watch}</b>
              <span>במעקב</span>
            </div>
            <div className={doc.cadets.risk ? 'bad' : ''}>
              <b>{doc.cadets.risk}</b>
              <span>בסיכון</span>
            </div>
            <div className={doc.cadets.committees ? 'warn' : ''}>
              <b>{doc.cadets.committees}</b>
              <span>בוועדת הערכה</span>
            </div>
            <div className={doc.cadets.twoNotes ? 'warn' : ''}>
              <b>{doc.cadets.twoNotes}</b>
              <span>עם 2 הערות משמעת</span>
            </div>
          </div>
          {doc.absences.length > 0 && (
            <>
              <h3>היעדרויות סגל בשבוע</h3>
              <ul className="doc-list">
                {doc.absences.map((a) => (
                  <li key={a.id}>
                    <b>{a.userName}</b> <span className="mono">{range(a.startDate, a.endDate)}</span>
                    {a.note && ` - ${a.note}`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {doc.lessons.length > 0 && (
          <section id="plan-lessons">
            {/* a week of the staff's preparation after the closing week: every lesson kept for the next cycle */}
            <h2>{w.staffPrep ? '9. כל הלקחים שנשמרו למחזור הבא' : '9. לקחים מהמחזור הקודם לשבוע הזה'}</h2>
            <ul className="doc-list">
              {doc.lessons.map((l) => (
                <li key={l.id}>
                  {l.body}
                  <span className="muted small"> · {l.review ? (l.review.decision === 'task' ? 'הפך למשימה' : l.review.decision === 'applied' ? 'יושם' : 'לא רלוונטי') : 'ממתין להחלטה'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {section('requests', doc.lessons.length > 0 ? 10 : 9)}

        <footer className="doc-foot">
          {doc.approval ? (
            <div className={`plan-approval${justApproved ? ' just-approved' : ''}`}>
              <div>
                <Icon name="check" size={16} /> <b>אושר</b> ע"י {doc.approval.by}, ב-<span className="mono">{shortDate(doc.approval.on)}</span>
              </div>
              {doc.approval.notes && (
                <div className="mt-8">
                  <b>הערות והנחיות המאשר:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{doc.approval.notes}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="doc-sign">
              <div>
                <span>מאשר (דרגה, שם ותפקיד)</span>
                <span className="line" />
              </div>
              <div>
                <span>תאריך וחתימה</span>
                <span className="line" />
              </div>
              <div className="span-2">
                <span>הערות והנחיות המאשר</span>
                <span className="line" />
                <span className="line" />
              </div>
            </div>
          )}
          <div className="tiny muted">
            הופק ב-{shortDate(todayKey())} ממערכת ניהול הקורס
            {doc.updatedByName && doc.updatedAt && ` · נערך לאחרונה ע"י ${doc.updatedByName}`}
          </div>
        </footer>
      </article>

      {editing && (
        <EditDialog
          title={editing === 'bluf' ? 'השורה התחתונה' : SECTION_TITLES[editing]}
          initial={editing === 'bluf' ? doc.bluf.text : doc.sections[editing].items.join('\n')}
          edited={editing === 'bluf' ? doc.bluf.edited : doc.sections[editing].edited}
          single={editing === 'bluf'}
          onSave={saveSection(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {approving && (
        <ApproveDialog<PlanDocument>
          name={w.name}
          approval={doc.approval}
          url={`/api/plans/${w.id}/approve`}
          scope="של השבוע"
          onClose={() => setApproving(false)}
          onDone={(d) => {
            setData(d);
            setApproving(false);
            emitLocalChange('plans');
            haptic('success');
            setJustApproved(true);
            toast({ title: 'האישור נרשם', tone: 'green' });
          }}
        />
      )}
    </div>
  );
}

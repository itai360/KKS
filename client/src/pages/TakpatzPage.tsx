// The takpatz (תקפ"צ) of a team (server/src/takpatz.ts): the team commander's work tool for the whole
// course - goals, the plans week by week, the tracking of each experience, the team's planning by
// halves and the thirds - and the course commander's view of every team. Everything is kept as it is
// written; the spreadsheet is made from it on the way out ("ייצוא לאקסל"), or saved to Google Drive.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { formatAgo } from '@shared/dates';
import { BOARD_LABELS, CATEGORY_INFO, TAKPATZ_CATEGORIES, type TakpatzBoard, type TakpatzCadet, type TakpatzMetrics, type TakpatzOverview, type TakpatzPlacement, type TakpatzTeamView } from '@shared/takpatz';
import { ask } from '../components/Confirm';
import { Icon } from '../components/Icon';
import { BoardCards, BoardTable, type BoardMode } from '../components/takpatz/Board';
import { CadetCard } from '../components/takpatz/CadetCard';
import { CategoryDot, SaveState } from '../components/takpatz/common';
import { PlacementEditor, type PlacementDraft } from '../components/takpatz/PlacementEditor';
import { Planning } from '../components/takpatz/Planning';
import { Thirds } from '../components/takpatz/Thirds';
import { Tracking, type TrackFilter } from '../components/takpatz/Tracking';
import { useToast } from '../components/Toasts';
import { Empty, Loading, Modal, openable, PageError, PageHead, Seg, Select } from '../components/ui';
import { api, fetchFile } from '../lib/api';
import { BOTTOM_BAR_MEDIA } from '../lib/bottomBar';
import { shareOrSave } from '../lib/download';
import { useMedia } from '../lib/media';
import { emitLocalChange } from '../lib/realtime';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

type Tab = 'board' | 'tracking' | 'planning' | 'thirds' | 'history';
const TABS: { value: Tab; label: string }[] = [
  { value: 'board', label: 'תקפ״צ' },
  { value: 'tracking', label: 'מעקב ומשובים' },
  { value: 'planning', label: 'תכנון צוותי' },
  { value: 'thirds', label: 'שלישים' },
  { value: 'history', label: 'שינויים' },
];

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** the team's numbers: each one opens what it counts */
function Metrics({ m, onOpen }: { m: TakpatzMetrics; onOpen: (tab: Tab, filter?: TrackFilter) => void }) {
  const items: { label: string; value: string; hint?: string; tone?: string; tab: Tab; filter?: TrackFilter }[] = [
    { label: 'התנסויות מתוכננות', value: String(m.planned), hint: m.unscheduled ? `${m.unscheduled} מחוץ לשבועות` : undefined, tab: 'board' },
    { label: 'בוצעו', value: String(m.executed), tab: 'tracking', filter: 'all' },
    { label: 'משובים לכתיבה', value: String(m.feedbackToWrite), tone: m.feedbackToWrite ? 'orange' : undefined, tab: 'tracking', filter: 'write' },
    { label: 'משובים להעברה', value: String(m.feedbackToDeliver), tone: m.feedbackToDeliver ? 'orange' : undefined, tab: 'tracking', filter: 'deliver' },
    { label: 'צוערים עם יעדים', value: `${m.withGoals}/${m.cadets}`, tab: 'board' },
    { label: 'ממופים לשלישים', value: `${m.mapped}/${m.cadets}`, tab: 'thirds' },
  ];
  return (
    <div className="tk-metrics" role="list">
      {items.map((x) => (
        <div key={x.label} role="listitem" className={`card tk-metric${x.tone ? ` t-${x.tone}` : ''}`} {...openable(() => onOpen(x.tab, x.filter))} aria-label={`${x.label}: ${x.value}`}>
          <span className="tk-metric-value">{x.value}</span>
          <span className="tk-metric-label">{x.label}</span>
          {x.hint && <span className="tiny muted">{x.hint}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------- the company (the commander's) ----------------

export function TakpatzHome() {
  const { data, error, loading, status } = useApi<TakpatzOverview>('/api/takpatz', ['takpatz', 'cadets']);
  const navigate = useNavigate();
  if (loading && !data)
    return (
      <div className="page">
        <Loading rows={4} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <PageError error={error} status={status} what="התקפ״צ" back="/cadets" backLabel="לצוערים" />
      </div>
    );
  if (data.scope === 'team' && data.teams.length === 1) return <Navigate to={`/takpatz/${data.teams[0].id}`} replace />;
  return (
    <div className="page">
      <PageHead
        title="תקפ״צ"
        sub={data.scope === 'all' ? 'התקפ״צ של כל הצוותים: התנסויות, ביצוע, משובים, יעדים ושלישים - צוות לצוות.' : 'התקפ״צ של הצוותים שלך.'}
      />
      {data.scope === 'none' ? (
        <Empty icon="board" title="אין צוות שבאחריותך" text="התקפ״צ פתוח למפקד הקורס ולכל מפקד צוות - לצוות שלו בלבד." />
      ) : !data.teams.length ? (
        <Empty icon="board" title="עוד אין צוותים" text="אחרי שמוסיפים צוותים ומפקדים בדף הצוערים, התקפ״צ של כל צוות נפתח כאן." />
      ) : (
        <div className="table-wrap fade-in">
          <table className="table tk-company">
            <thead>
              <tr>
                <th scope="col">צוות</th>
                <th scope="col">מפק״צ</th>
                <th scope="col">צוערים</th>
                <th scope="col">מתוכננות</th>
                <th scope="col">בוצעו</th>
                <th scope="col">משובים לכתיבה</th>
                <th scope="col">משובים להעברה</th>
                <th scope="col">יעדים</th>
                <th scope="col">שלישים</th>
                <th scope="col">עדכון אחרון</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={t.id} className="click" {...openable(() => navigate(`/takpatz/${t.id}`))}>
                  <td className="strong">{t.name}</td>
                  <td>{t.commanderName ?? <span className="muted">-</span>}</td>
                  <td>{t.metrics.cadets}</td>
                  <td>
                    {t.metrics.planned}
                    {t.metrics.withoutExperience > 0 && <span className="tiny muted"> · {t.metrics.withoutExperience} בלי התנסות</span>}
                  </td>
                  <td>{t.metrics.executed}</td>
                  <td className={t.metrics.feedbackToWrite ? 'tk-warn' : ''}>{t.metrics.feedbackToWrite}</td>
                  <td className={t.metrics.feedbackToDeliver ? 'tk-warn' : ''}>{t.metrics.feedbackToDeliver}</td>
                  <td>
                    <span className="tk-mini-bar" style={{ ['--p' as string]: `${pct(t.metrics.withGoals, t.metrics.cadets)}%` }} aria-hidden="true" />
                    {t.metrics.withGoals}/{t.metrics.cadets}
                  </td>
                  <td>
                    <span className="tk-mini-bar" style={{ ['--p' as string]: `${pct(t.metrics.mapped, t.metrics.cadets)}%` }} aria-hidden="true" />
                    {t.metrics.mapped}/{t.metrics.cadets}
                  </td>
                  <td className="muted small">{t.updatedAt ? formatAgo(t.updatedAt) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- a team ----------------

const DRIVE_RESULTS: Record<string, { title: string; tone: 'green' | 'red' | 'gray' }> = {
  ok: { title: 'התקפ״צ נשמר ב-Google Drive, בתיקייה "תקפ״צ"', tone: 'green' },
  cancelled: { title: 'השמירה ב-Google Drive בוטלה. לא נשמר קובץ.', tone: 'gray' },
  expired: { title: 'עבר יותר מדי זמן מהכניסה ל-Google. לא נשמר קובץ - נסו שוב.', tone: 'red' },
  denied: { title: 'אין הרשאה לשמור את התקפ״צ הזה. לא נשמר קובץ.', tone: 'red' },
  failed: { title: 'השמירה ב-Google Drive לא הצליחה. לא נשמר קובץ - אפשר להוריד אותו ולהעלות ידנית.', tone: 'red' },
  client: { title: 'Google לא אישר את מפתחות האתר, ולא נשמר קובץ. כדאי לבדוק ש-GOOGLE_CLIENT_SECRET ב-Vercel הועתק נכון מאותו לקוח OAuth.', tone: 'red' },
  api: { title: 'ה-Google Drive API לא מופעל בפרויקט ב-Google Cloud, ולא נשמר קובץ. מפעילים אותו ב-APIs & Services ומנסים שוב.', tone: 'red' },
  redirect: { title: 'כתובת החזרה לא רשומה בלקוח ה-OAuth ב-Google Cloud, ולא נשמר קובץ.', tone: 'red' },
};

export function TakpatzTeamPage() {
  const { teamId } = useParams();
  const id = Number(teamId);
  const { isCommander } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const phone = useMedia(BOTTOM_BAR_MEDIA);
  const [params, setParams] = useSearchParams();
  const url = `/api/takpatz/teams/${id}`;
  const { data: view, error, loading, status, reload } = useApi<TakpatzTeamView>(url, ['takpatz', 'cadets']);
  const overview = useApi<TakpatzOverview>(isCommander ? '/api/takpatz' : null, ['takpatz']);
  const tab = (params.get('tab') as Tab) || 'board';
  const board = (params.get('board') as TakpatzBoard) || 'main';
  const mode = (params.get('view') as BoardMode) || 'all';
  const [filter, setFilter] = useState<TrackFilter>('all');
  const [saving, setSaving] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlacementDraft | null>(null);
  const [cadetOpen, setCadetOpen] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [driveInfo, setDriveInfo] = useState(false);
  const set = useCallback(
    (k: string, v: string | null) => {
      const next = new URLSearchParams(params);
      if (v) next.set(k, v);
      else next.delete(k);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // back from Google's sign-in: what happened, said once
  useEffect(() => {
    const result = params.get('drive');
    if (!result) return;
    const r = DRIVE_RESULTS[result] ?? DRIVE_RESULTS.failed;
    const link = params.get('link');
    toast({ title: r.title, tone: r.tone, action: result === 'ok' && link?.startsWith('https://') ? { label: 'פתיחה', run: () => window.open(link, '_blank', 'noopener') } : undefined });
    const next = new URLSearchParams(params);
    next.delete('drive');
    next.delete('link');
    setParams(next, { replace: true });
    // once, as the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** a change: saved, the screen brought up to date, and "נשמר" said - or why not */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setSaving((n) => n + 1);
      try {
        await fn();
        setSavedAt(new Date().toISOString());
        await reload();
        emitLocalChange('takpatz');
        return true;
      } catch (e) {
        toast({ title: (e as Error).message, tone: 'red' });
        return false;
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [reload, toast],
  );
  const saveProfile = useCallback((c: TakpatzCadet, patch: Record<string, unknown>) => mutate(() => api.patch(`/api/takpatz/cadets/${c.id}`, patch)), [mutate]);

  const exportFile = async () => {
    setExporting(true);
    try {
      const f = await fetchFile(`/api/takpatz/teams/${id}/export`);
      await shareOrSave(f.name, f.data);
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    } finally {
      setExporting(false);
    }
  };
  const saveToDrive = async () => {
    if (!view?.driveAvailable) return setDriveInfo(true);
    try {
      const { url: signIn } = await api.post<{ url: string }>(`/api/takpatz/teams/${id}/drive`);
      window.location.assign(signIn);
    } catch (e) {
      toast({ title: (e as Error).message, tone: 'red' });
    }
  };
  const copyBoard = async (from: TakpatzBoard, to: TakpatzBoard) => {
    if (!(await ask({ title: `להחליף את ה${BOARD_LABELS[to]} בהעתק של ה${BOARD_LABELS[from]}?`, body: `כל ההתנסויות שב${BOARD_LABELS[to]} עכשיו יימחקו, ובמקומן יבואו אלה שב${BOARD_LABELS[from]}.`, confirm: 'העתקה', danger: true }))) return;
    await mutate(() => api.post(`/api/takpatz/teams/${id}/copy-board`, { from, to }));
  };

  const editPlacement = useCallback((p: TakpatzPlacement) => setDraft({ placement: p, board: p.board }), []);
  const lastChange = view?.history[0];
  const teams = overview.data?.teams ?? [];
  const boardCount = useMemo(() => (b: TakpatzBoard) => view?.placements.filter((p) => p.board === b).length ?? 0, [view]);

  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/takpatz" replace />;
  if (loading && !view)
    return (
      <div className="page">
        <Loading rows={6} />
      </div>
    );
  if (!view)
    return (
      <div className="page">
        <PageError error={error} status={status} what="התקפ״צ" back="/takpatz" backLabel="לתקפ״צ" />
      </div>
    );

  const openMetric = (t: Tab, f?: TrackFilter) => {
    if (f) setFilter(f);
    set('tab', t === 'board' ? null : t);
  };

  return (
    <div className="page tk-page">
      <PageHead
        eyebrow={view.courseName}
        title={`תקפ״צ - ${view.team.name}`}
        docTitle={`תקפ״צ - ${view.team.name}`}
        sub={
          <span className="tk-sub">
            <span>{view.team.commanderName ?? 'אין מפק״צ'}</span>
            <span>· {view.cadets.length} צוערים</span>
            {lastChange && (
              <span>
                · עודכן {formatAgo(lastChange.at)}
                {lastChange.who && ` על ידי ${lastChange.who}`}
              </span>
            )}
            <SaveState saving={saving} savedAt={savedAt} />
          </span>
        }
        actions={
          <>
            {isCommander && teams.length > 1 && (
              <Select value={id} onChange={(e) => navigate(`/takpatz/${e.target.value}`)} aria-label="צוות" fit data-keep>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            {isCommander && (
              <Link className="btn btn-ghost" to="/takpatz">
                <Icon name="chart" /> כל הצוותים
              </Link>
            )}
            <button type="button" className="btn" onClick={() => void saveToDrive()}>
              <Icon name="upload" /> שמירה ב-Google Drive
            </button>
            <button type="button" className="btn btn-primary" disabled={exporting} onClick={() => void exportFile()}>
              <Icon name="download" /> {exporting ? 'מכין...' : 'ייצוא לאקסל'}
            </button>
          </>
        }
      />
      <Metrics m={view.metrics} onOpen={openMetric} />
      <div className="tk-tabs">
        <Seg value={tab} onChange={(v) => set('tab', v === 'board' ? null : v)} options={TABS} />
      </div>

      {tab === 'board' && (
        <div className="tk-board-area fade-in">
          <div className="tk-toolbar-row">
            <Seg
              value={board}
              onChange={(v) => set('board', v === 'main' ? null : v)}
              options={[
                { value: 'main', label: `${BOARD_LABELS.main} ${boardCount('main')}` },
                { value: 'alt', label: `${BOARD_LABELS.alt} ${boardCount('alt')}` },
              ]}
            />
            {!phone && (
              <Seg
                value={mode}
                onChange={(v) => set('view', v === 'all' ? null : v)}
                options={[
                  { value: 'all', label: 'הכול' },
                  { value: 'weeks', label: 'שבועות' },
                  { value: 'goals', label: 'יעדים' },
                ]}
              />
            )}
            <span className="grow" />
            <button type="button" className="btn btn-ghost" onClick={() => void copyBoard(board === 'main' ? 'main' : 'alt', board === 'main' ? 'alt' : 'main')}>
              <Icon name="copy" /> {board === 'main' ? 'העתקה לתכנון הנוסף' : 'העתקה לתכנון הראשי'}
            </button>
            <button type="button" className="btn" onClick={() => setDraft({ board })}>
              <Icon name="plus" /> שיבוץ
            </button>
          </div>
          {board === 'alt' && <p className="muted small tk-note">תכנון נוסף לצד הראשי, עם אותם צוערים ויעדים. שינוי כאן לא משנה את התכנון הראשי, והמעקב נשאר על התכנון הראשי.</p>}
          {!view.cadets.length ? (
            <Empty icon="users" title="אין צוערים בצוות" text="צוערים שמשויכים לצוות בדף הצוערים מופיעים כאן מעצמם." />
          ) : phone ? (
            <BoardCards view={view} board={board} onOpenCadet={setCadetOpen} onAdd={setDraft} onEdit={editPlacement} />
          ) : (
            <BoardTable view={view} board={board} mode={mode} onOpenCadet={setCadetOpen} onAdd={setDraft} onEdit={editPlacement} onSaveProfile={saveProfile} />
          )}
          <Legend />
        </div>
      )}
      {tab === 'tracking' && <Tracking view={view} filter={filter} setFilter={setFilter} mutate={mutate} />}
      {tab === 'planning' && <Planning view={view} onPlan={setDraft} mutate={mutate} />}
      {tab === 'thirds' && <Thirds view={view} mutate={mutate} />}
      {tab === 'history' && (
        <div className="card tk-history fade-in">
          {!view.history.length ? (
            <Empty icon="history" title="עוד אין שינויים" />
          ) : (
            <ul>
              {view.history.map((h, i) => (
                <li key={i}>
                  <span>{h.text}</span>
                  <span className="muted tiny">
                    {h.who ?? ''} · {formatAgo(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draft && <PlacementEditor view={view} draft={draft} onClose={() => setDraft(null)} onSaved={() => void mutate(async () => undefined)} />}
      {cadetOpen !== null && (
        <CadetCard
          view={view}
          cadetId={cadetOpen}
          onClose={() => setCadetOpen(null)}
          mutate={mutate}
          onAdd={(d) => setDraft(d)}
          onEdit={(p) => setDraft({ placement: p, board: p.board })}
        />
      )}
      {driveInfo && (
        <Modal
          narrow
          title="שמירה ב-Google Drive"
          onClose={() => setDriveInfo(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDriveInfo(false)}>
                סגירה
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setDriveInfo(false);
                  void exportFile();
                }}
              >
                <Icon name="download" /> ייצוא לאקסל
              </button>
            </>
          }
        >
          <p>השמירה הישירה ל-Google Drive תופעל אחרי חיבור חשבון Google של האתר - הגדרה חד-פעמית בשרת.</p>
          <p className="muted">בינתיים: "ייצוא לאקסל" ואז העלאה ל-Drive. בטלפון, הקובץ נפתח בתפריט השיתוף - ושם בוחרים Drive.</p>
        </Modal>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="tk-legend" aria-label="מקרא">
      {TAKPATZ_CATEGORIES.map((k) => (
        <span key={k} className="tk-legend-item">
          <CategoryDot category={k} />
          {CATEGORY_INFO[k].label}
        </span>
      ))}
    </div>
  );
}

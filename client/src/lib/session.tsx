import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { sortHe } from '@shared/sort';
import type { CourseSettings, Track, User, Week } from '@shared/types';
import { api, setReauthHandler, setUnauthorizedHandler } from './api';
import { setTimezone } from './format';
import { setTitleCount, setTitleSuffix } from './title';
import { connectRealtime, disconnectRealtime, onNotification } from './realtime';
import { clearApiCache, setApiCacheOwner, useApi } from './useApi';
import { ReauthDialog } from '../components/Reauth';
import { FirstPasswordDialog } from '../components/FirstPassword';
import { clearDrafts } from './draft';

interface MeResponse {
  user: User;
  settings: CourseSettings;
  unread: number;
  /** signed in with a password someone else chose */
  mustChangePassword?: boolean;
  /** a previous course open for reading (the commander) */
  course?: { id: number; name: string } | null;
  /** backup codes left, with two-step sign-in on */
  recoveryLeft?: number | null;
}

export interface Session {
  user: User;
  settings: CourseSettings;
  users: User[];
  staff: User[];
  weeks: Week[];
  /** the course's tracks (צירים), in alphabetical order */
  tracks: Track[];
  isCommander: boolean;
  /** a previous course open for reading: every screen shows it, and nothing can be changed */
  viewing: { id: number; name: string } | null;
  /** backup codes left for two-step sign-in (null: it is off) */
  recoveryLeft: number | null;
  unread: number;
  setUnread: (n: number) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  userName: (id: number | null | undefined) => string;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside provider');
  return s;
}

type State = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; me: MeResponse };

export function SessionGate({ anon, children }: { anon: (onLogin: () => void) => ReactNode; children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/api/auth/me');
      // what screens kept from another person (or another course) is not shown to this one
      setApiCacheOwner(`${me.user.id}:${me.course?.id ?? ''}`);
      setTimezone(me.settings.timezone);
      setState({ status: 'authed', me });
    } catch {
      setState({ status: 'anon' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => {
      disconnectRealtime();
      clearApiCache();
      setState({ status: 'anon' });
    });
  }, [refresh]);

  if (state.status === 'loading') return <div className="boot" aria-busy="true" />;
  if (state.status === 'anon') return <>{anon(() => void refresh())}</>;
  return (
    <AuthedProvider
      me={state.me}
      refresh={refresh}
      onLogout={() => {
        disconnectRealtime();
        clearDrafts();
        clearApiCache();
        setState({ status: 'anon' });
      }}
    >
      {children}
    </AuthedProvider>
  );
}

function AuthedProvider({ me, refresh, onLogout, children }: { me: MeResponse; refresh: () => Promise<void>; onLogout: () => void; children: ReactNode }) {
  const [unread, setUnread] = useState(me.unread);
  const [reauth, setReauth] = useState<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setReauthHandler(() => new Promise<boolean>((resolve) => setReauth(() => resolve)));
    return () => setReauthHandler(null);
  }, []);
  const reauthDone = (ok: boolean) => {
    reauth?.(ok);
    setReauth(null);
    if (!ok) onLogout();
  };
  const users = useApi<User[]>('/api/users', ['users']);
  const weeks = useApi<Week[]>('/api/weeks', ['weeks', 'tasks']);
  const tracks = useApi<Track[]>('/api/tracks', ['weeks', 'tasks']);
  const settings = useApi<CourseSettings>('/api/settings', ['settings']);

  useEffect(() => {
    connectRealtime();
    return onNotification(() => setUnread((n) => n + 1));
  }, []);

  useEffect(() => {
    setUnread(me.unread);
  }, [me.unread]);

  const currentSettings = settings.data ?? me.settings;
  useEffect(() => {
    setTimezone(currentSettings.timezone);
  }, [currentSettings.timezone]);
  useEffect(() => {
    setTitleSuffix(currentSettings.courseSymbol || currentSettings.courseName);
  }, [currentSettings.courseSymbol, currentSettings.courseName]);
  useEffect(() => {
    setTitleCount(unread);
    return () => setTitleCount(0);
  }, [unread]);

  const value = useMemo<Session>(() => {
    // people and areas are offered in alphabetical order on every screen
    const list = sortHe(users.data ?? [me.user], (u) => u.displayName);
    const byId = new Map(list.map((u) => [u.id, u]));
    return {
      user: me.user,
      settings: { ...currentSettings, domains: sortHe(currentSettings.domains) },
      users: list,
      staff: list.filter((u) => u.role === 'staff'),
      weeks: weeks.data ?? [],
      tracks: tracks.data ?? [],
      isCommander: me.user.role === 'commander',
      viewing: me.course ?? null,
      recoveryLeft: me.recoveryLeft ?? null,
      unread,
      setUnread,
      refresh,
      logout: async () => {
        await api.post('/api/auth/logout').catch(() => undefined);
        onLogout();
      },
      userName: (id) => (id ? (byId.get(id)?.displayName ?? '') : ''),
    };
  }, [me, users.data, weeks.data, tracks.data, currentSettings, unread, refresh, onLogout]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {reauth && <ReauthDialog user={me.user} onDone={reauthDone} />}
      {me.mustChangePassword && !reauth && <FirstPasswordDialog user={me.user} onDone={() => void refresh()} onLogout={() => void value.logout()} />}
    </Ctx.Provider>
  );
}

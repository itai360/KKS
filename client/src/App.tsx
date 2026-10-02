import { Suspense, useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { NewTaskProvider } from './components/NewTask';
import { ToastProvider } from './components/Toasts';
import { Empty, Loading } from './components/ui';
import { SessionGate, useSession } from './lib/session';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { lazyPage, prefetchPages } from './lib/lazyPage';
import { ConfirmHost } from './components/Confirm';
import { usePageTitle } from './lib/title';

// The first screens come with the app; every other screen loads when it is
// first opened, so a phone downloads far less up front (and after an update).
const BriefingPage = lazyPage(() => import('./pages/BriefingPage'), 'BriefingPage');
const CadetPage = lazyPage(() => import('./pages/CadetsPage'), 'CadetPage');
const CadetsPage = lazyPage(() => import('./pages/CadetsPage'), 'CadetsPage');
const DebriefPage = lazyPage(() => import('./pages/DebriefsPage'), 'DebriefPage');
const DebriefsPage = lazyPage(() => import('./pages/DebriefsPage'), 'DebriefsPage');
const DocumentsPage = lazyPage(() => import('./pages/DocumentsPage'), 'DocumentsPage');
const CommitteePage = lazyPage(() => import('./pages/EvaluationsPage'), 'CommitteePage');
const EvaluationFilePage = lazyPage(() => import('./pages/EvaluationsPage'), 'EvaluationFilePage');
const EvaluationsPage = lazyPage(() => import('./pages/EvaluationsPage'), 'EvaluationsPage');
const ExperiencesPage = lazyPage(() => import('./pages/ExperiencesPage'), 'ExperiencesPage');
const CommandPage = lazyPage(() => import('./pages/CommandPage'), 'CommandPage');
const MeetingPage = lazyPage(() => import('./pages/MeetingPage'), 'MeetingPage');
const MorePage = lazyPage(() => import('./pages/MorePage'), 'MorePage');
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const RecurringPage = lazyPage(() => import('./pages/RecurringPage'), 'RecurringPage');
const ActivityPage = lazyPage(() => import('./pages/ReportsPage'), 'ActivityPage');
const DayEndPage = lazyPage(() => import('./pages/ReportsPage'), 'DayEndPage');
const LookAheadPage = lazyPage(() => import('./pages/ReportsPage'), 'LookAheadPage');
const WeeklyReportPage = lazyPage(() => import('./pages/ReportsPage'), 'WeeklyReportPage');
const RequestsPage = lazyPage(() => import('./pages/RequestsPage'), 'RequestsPage');
const SchedulePage = lazyPage(() => import('./pages/SchedulePage'), 'SchedulePage');
const SearchPage = lazyPage(() => import('./pages/SearchPage'), 'SearchPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const TaskPage = lazyPage(() => import('./pages/TaskPage'), 'TaskPage');
const TasksPage = lazyPage(() => import('./pages/TasksPage'), 'TasksPage');
const StaffPage = lazyPage(() => import('./pages/TeamPage'), 'StaffPage');
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage');
const TemplatesPage = lazyPage(() => import('./pages/TemplatesPage'), 'TemplatesPage');
const WeekPage = lazyPage(() => import('./pages/WeeksPage'), 'WeekPage');
const WeeksPage = lazyPage(() => import('./pages/WeeksPage'), 'WeeksPage');

/** An address that isn't a screen - say so, rather than silently landing on the home page. */
function NotFound() {
  usePageTitle('הדף לא נמצא');
  return (
    <div className="page">
      <Empty
        icon="search"
        title="הדף לא נמצא"
        text={
          <>
            הכתובת שגויה, או שהדף הועבר. <Link to="/">לדף הבית</Link>
          </>
        }
      />
    </div>
  );
}

function AuthedRoutes() {
  const { isCommander } = useSession();
  useEffect(() => {
    prefetchPages();
  }, []);
  return (
    <ToastProvider>
      <NewTaskProvider>
        <Layout>
          {/* while a screen's code arrives */}
          <Suspense
            fallback={
              <div className="page">
                <Loading rows={5} />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={isCommander ? <DashboardPage /> : <MyTasksPage />} />
              <Route path="/my" element={<MyTasksPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/tasks/:id" element={<TaskPage />} />
              <Route path="/weeks" element={<WeeksPage />} />
              <Route path="/weeks/:id" element={<WeekPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/team" element={isCommander ? <TeamPage /> : <Navigate to="/" />} />
              <Route path="/team/:id" element={<StaffPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/briefing" element={<BriefingPage />} />
              <Route path="/reports/weekly" element={<WeeklyReportPage />} />
              <Route path="/lookahead" element={<LookAheadPage />} />
              <Route path="/day-end" element={<DayEndPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/command" element={<CommandPage />} />
              <Route path="/meeting" element={isCommander ? <MeetingPage /> : <Navigate to="/" />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/recurring" element={<RecurringPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/cadets" element={<CadetsPage />} />
              <Route path="/cadets/:id" element={<CadetPage />} />
              <Route path="/experiences" element={<ExperiencesPage />} />
              <Route path="/evaluations" element={<EvaluationsPage />} />
              <Route path="/evaluations/committee/:id" element={<CommitteePage />} />
              <Route path="/evaluations/:cadetId" element={<EvaluationFilePage />} />
              <Route path="/debriefs" element={<DebriefsPage />} />
              <Route path="/debriefs/:id" element={<DebriefPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </NewTaskProvider>
    </ToastProvider>
  );
}

/** The app without a router, so the demo build can use an in-memory one. */
export function AppShell() {
  return (
    <>
      <SessionGate anon={(onLogin) => <LoginPage onLogin={onLogin} />}>
        <AuthedRoutes />
      </SessionGate>
      <ConfirmHost />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { NewTaskProvider } from './components/NewTask';
import { ToastProvider } from './components/Toasts';
import { SessionGate, useSession } from './lib/session';
import { BriefingPage } from './pages/BriefingPage';
import { CadetPage, CadetsPage } from './pages/CadetsPage';
import { DebriefPage, DebriefsPage } from './pages/DebriefsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { ExperiencesPage } from './pages/ExperiencesPage';
import { CommandPage } from './pages/CommandPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MeetingPage } from './pages/MeetingPage';
import { MorePage } from './pages/MorePage';
import { MyTasksPage } from './pages/MyTasksPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { RecurringPage } from './pages/RecurringPage';
import { ActivityPage, DayEndPage, LookAheadPage, WeeklyReportPage } from './pages/ReportsPage';
import { RequestsPage } from './pages/RequestsPage';
import { SchedulePage } from './pages/SchedulePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TaskPage } from './pages/TaskPage';
import { TasksPage } from './pages/TasksPage';
import { StaffPage, TeamPage } from './pages/TeamPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { WeekPage, WeeksPage } from './pages/WeeksPage';

function AuthedRoutes() {
  const { isCommander } = useSession();
  return (
    <ToastProvider>
      <NewTaskProvider>
        <Layout>
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
            <Route path="/debriefs" element={<DebriefsPage />} />
            <Route path="/debriefs/:id" element={<DebriefPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Layout>
      </NewTaskProvider>
    </ToastProvider>
  );
}

/** The app without a router, so the demo build can use an in-memory one. */
export function AppShell() {
  return (
    <SessionGate anon={(onLogin) => <LoginPage onLogin={onLogin} />}>
      <AuthedRoutes />
    </SessionGate>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

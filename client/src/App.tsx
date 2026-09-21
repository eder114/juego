import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { homeFor } from './lib/routes';
import { LoadingBlock } from './components/ui';
import AppLayout from './components/layout/AppLayout';
import AdminLayout from './components/layout/AdminLayout';

const Landing = lazy(() => import('./pages/auth/Landing'));
const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Market = lazy(() => import('./pages/Market'));
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'));
const Compare = lazy(() => import('./pages/Compare'));
const Team = lazy(() => import('./pages/Team'));
const Cards = lazy(() => import('./pages/Cards'));
const Challenges = lazy(() => import('./pages/Challenges'));
const Economy = lazy(() => import('./pages/Economy'));
const Lineup = lazy(() => import('./pages/Lineup'));
const Leagues = lazy(() => import('./pages/Leagues'));
const LeagueDetail = lazy(() => import('./pages/LeagueDetail'));
const Rankings = lazy(() => import('./pages/Rankings'));
const Fixtures = lazy(() => import('./pages/Fixtures'));
const FixtureDetail = lazy(() => import('./pages/FixtureDetail'));
const Clubs = lazy(() => import('./pages/Clubs'));
const ClubDetail = lazy(() => import('./pages/ClubDetail'));
const Stats = lazy(() => import('./pages/Stats'));
const NewsPage = lazy(() => import('./pages/News'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const ManagerTeam = lazy(() => import('./pages/ManagerTeam'));
const NotFound = lazy(() => import('./pages/NotFound'));

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminPlayers = lazy(() => import('./pages/admin/AdminPlayers'));
const AdminClubs = lazy(() => import('./pages/admin/AdminClubs'));
const AdminGameweeks = lazy(() => import('./pages/admin/AdminGameweeks'));
const AdminFixtures = lazy(() => import('./pages/admin/AdminFixtures'));
const AdminScoring = lazy(() => import('./pages/admin/AdminScoring'));
const AdminLeagues = lazy(() => import('./pages/admin/AdminLeagues'));
const AdminNews = lazy(() => import('./pages/admin/AdminNews'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminEconomy = lazy(() => import('./pages/admin/AdminEconomy'));
const AdminImport = lazy(() => import('./pages/admin/AdminImport'));

function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <LoadingBlock label="Preparando el vestuario…" />
    </div>
  );
}

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/" element={<PublicOnly><Landing /></PublicOnly>} />
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        {/* El registro gestiona su propia sesión: tras la fase 1 el usuario ya ha iniciado sesión y continúa el onboarding */}
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/team" element={<Team />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/challenges" element={<Challenges />} />
          <Route path="/economy" element={<Economy />} />
          <Route path="/lineup" element={<Lineup />} />
          <Route path="/market" element={<Market />} />
          <Route path="/players/:id" element={<PlayerDetail />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/leagues" element={<Leagues />} />
          <Route path="/leagues/:id" element={<LeagueDetail />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/fixtures" element={<Fixtures />} />
          <Route path="/fixtures/:id" element={<FixtureDetail />} />
          <Route path="/clubs" element={<Clubs />} />
          <Route path="/clubs/:id" element={<ClubDetail />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/managers/:teamId" element={<ManagerTeam />} />

          <Route path="/admin" element={<RequireAuth admin><AdminLayout /></RequireAuth>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="players" element={<AdminPlayers />} />
            <Route path="clubs" element={<AdminClubs />} />
            <Route path="gameweeks" element={<AdminGameweeks />} />
            <Route path="fixtures" element={<AdminFixtures />} />
            <Route path="scoring" element={<AdminScoring />} />
            <Route path="leagues" element={<AdminLeagues />} />
            <Route path="news" element={<AdminNews />} />
            <Route path="economy" element={<AdminEconomy />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="import" element={<AdminImport />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

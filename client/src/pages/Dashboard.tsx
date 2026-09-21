import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, CreditCard, Menu as ListIcon, Target, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { money, moneyK } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/ui';
import { MovementIndicator } from '../components/sport';
import { DashEmpty, DashError } from '../components/dashboard/DashCard';
import { AlertBanners, NextLineup, TeamSummary } from '../components/dashboard/DashboardHero';
import { FeaturedPlayersPanel, HistoryPanel, LeadersPanel, NewsPanel, NextFixturePanel } from '../components/dashboard/DashboardPanels';
import { DashboardSkeleton } from '../components/dashboard/DashboardSkeleton';
import type { DashboardData } from '../components/dashboard/types';

/** Inicio del área privada (referencia visual: design/dashboard.webp). Todos los datos vienen de GET /api/dashboard. */
export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });

  if (isLoading) return <DashboardSkeleton />;
  // Si falla una recarga en segundo plano se siguen mostrando los últimos datos válidos
  if (!data) return <DashError error={error} onRetry={() => void refetch()} retrying={isRefetching} />;

  if (!data.team)
    return (
      <div className="dash-card mx-auto max-w-xl p-5 sm:p-8">
        <DashEmpty
          title="Aún no tienes equipo"
          description="Completa el registro creando tu equipo Fantasy para empezar a competir."
          action={
            <Link to="/register" className="btn-go h-11 px-6">
              Crear equipo
            </Link>
          }
        />
      </div>
    );

  const last = data.history.at(-1);
  const fmtMoney = data.economyVersion === 2 ? moneyK : money;
  return (
    <div className="space-y-5 sm:space-y-7">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <TeamSummary data={data} managerName={user?.managerName} className={data.editableGameweek ? undefined : 'xl:col-span-2'} />
        {data.editableGameweek && <NextLineup gameweek={data.editableGameweek} />}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          variant="outline"
          label={data.lastGameweekId ? `Puntos J${data.lastGameweekId}` : 'Puntos jornada'}
          value={data.lastGameweekPoints}
          icon={<Target />}
          sub={last ? `Media: ${last.average} · Máx: ${last.highest}` : 'Sin jornadas disputadas'}
        />
        <StatCard variant="outline" label="Puntos totales" value={data.totalPoints} icon={<TrendingUp />} sub={`${data.history.length} ${data.history.length === 1 ? 'jornada' : 'jornadas'}`} />
        <StatCard
          variant="outline"
          label="Posición global"
          value={data.globalRank ? `#${data.globalRank.toLocaleString('es-ES')}` : '—'}
          icon={<ListIcon />}
          sub={
            <span className="flex items-center gap-1.5">
              <MovementIndicator movement={data.globalMovement} /> de {data.totalManagers.toLocaleString('es-ES')} mánagers
            </span>
          }
        />
        <StatCard variant="outline" label="Valor del equipo" value={fmtMoney(data.teamValue)} icon={<CreditCard />} sub={data.economyLeague ? `Liga «${data.economyLeague.name}»` : 'Precio actual de la plantilla'} />
        <StatCard
          variant="outline"
          label="Presupuesto"
          value={fmtMoney(data.budget)}
          icon={<CircleDollarSign />}
          className="max-md:col-span-2"
          sub={
            <Link to="/market" className="dash-link text-[0.8125rem]">
              Ir al mercado →
            </Link>
          }
        />
      </div>

      <AlertBanners alerts={data.alerts} />

      <div className="grid gap-5 lg:grid-cols-3">
        <HistoryPanel history={data.history} />
        <NextFixturePanel next={data.nextFixture} upcoming={data.upcomingFixtures} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <FeaturedPlayersPanel players={data.featuredPlayers} />
        <LeadersPanel data={data} userId={user?.id} managerName={user?.managerName} />
        <NewsPanel notifications={data.notifications} news={data.news} className="md:max-xl:col-span-2" />
      </div>
    </div>
  );
}

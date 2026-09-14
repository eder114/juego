import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, Crown, Info, ListOrdered, Newspaper, PiggyBank, ShieldAlert, Sparkles, Target, TrendingUp, Trophy, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { countdown, dateTime, money, relativeTime } from '../lib/format';
import type { AppNotification, Fixture, News, Player, StandingRow } from '../types';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, StatCard } from '../components/ui';
import { ClubCrest, MovementIndicator, TeamCrest } from '../components/sport';
import { PlayerRow } from '../components/PlayerCard';
import { PointsHistoryChart } from '../components/charts';

interface DashboardData {
  team: { id: number; name: string; crest: Record<string, string> } | null;
  lastGameweekPoints: number;
  lastGameweekId: number | null;
  totalPoints: number;
  globalRank: number | null;
  globalMovement: 'up' | 'down' | 'same' | 'new';
  totalManagers: number;
  teamValue: number;
  budget: number;
  squadCount: number;
  squadSize: number;
  currentGameweek: { id: number; name: string; status: string; deadline: string } | null;
  nextGameweek: { id: number; name: string; deadline: string } | null;
  editableGameweek: { id: number; name: string; deadline: string } | null;
  nextFixture: Fixture | null;
  upcomingFixtures: Fixture[];
  featuredPlayers: Player[];
  history: { gameweek: number; points: number; average: number; highest: number }[];
  news: News[];
  notifications: AppNotification[];
  alerts: { level: 'danger' | 'warning' | 'info'; title: string; message: string; link: string }[];
  leaders: StandingRow[];
}

const ALERT_STYLE = {
  danger: { icon: ShieldAlert, cls: 'border-red-500/30 bg-red-500/[0.07] text-red-300' },
  warning: { icon: AlertTriangle, cls: 'border-amber-500/30 bg-amber-500/[0.07] text-amber-300' },
  info: { icon: Info, cls: 'border-sky-500/30 bg-sky-500/[0.07] text-sky-300' },
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-36" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );

  if (!data.team)
    return (
      <Card>
        <EmptyState icon={<Trophy className="size-6" />} title="Aún no tienes equipo" description="Crea tu equipo Fantasy desde tu perfil para empezar a competir." action={<Link to="/profile"><Button>Crear equipo</Button></Link>} />
      </Card>
    );

  const gw = data.editableGameweek;
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Cabecera */}
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <div className="pitch-bg absolute inset-0 opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-800 via-ink-800/90 to-ink-800/40" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <TeamCrest crest={data.team.crest} name={data.team.name} size={68} />
            <div className="min-w-0">
              <p className="label text-pitch-400">Hola, {user?.managerName}</p>
              <h1 className="truncate text-3xl font-extrabold uppercase sm:text-4xl">{data.team.name}</h1>
              <p className="text-sm text-slate-400">
                {data.squadCount}/{data.squadSize} jugadores · {data.currentGameweek ? `${data.currentGameweek.name} ${data.currentGameweek.status === 'LIVE' ? 'en curso' : ''}` : 'Pretemporada'}
              </p>
            </div>
          </div>
          {gw && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/70 p-3 sm:p-4">
              <CalendarClock className="size-8 shrink-0 text-pitch-400" />
              <div className="min-w-0">
                <p className="label">Próxima alineación · {gw.name}</p>
                <p className="font-display text-2xl font-bold text-white">{countdown(gw.deadline) === 'Cerrada' ? 'Partidos en juego' : `Cierre en ${countdown(gw.deadline)}`}</p>
                <p className="text-xs text-slate-400">{dateTime(gw.deadline)}</p>
              </div>
              <Link to="/lineup" className="ml-auto">
                <Button size="sm" icon={<ArrowRight className="size-4" />}>Alinear</Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Tarjetas principales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard accent label={data.lastGameweekId ? `Puntos J${data.lastGameweekId}` : 'Puntos jornada'} value={data.lastGameweekPoints} icon={<Target className="size-5" />} sub={data.history.at(-1) ? `Media: ${data.history.at(-1)!.average} · Máx: ${data.history.at(-1)!.highest}` : 'Sin jornadas disputadas'} />
        <StatCard label="Puntos totales" value={data.totalPoints} icon={<TrendingUp className="size-5" />} sub={`${data.history.length} jornadas`} />
        <StatCard
          label="Posición global"
          value={data.globalRank ? `#${data.globalRank.toLocaleString('es-ES')}` : '—'}
          icon={<ListOrdered className="size-5" />}
          sub={
            <span className="flex items-center gap-1.5">
              <MovementIndicator movement={data.globalMovement} /> de {data.totalManagers.toLocaleString('es-ES')} mánagers
            </span>
          }
        />
        <StatCard label="Valor del equipo" value={money(data.teamValue)} icon={<Wallet className="size-5" />} sub="Precio actual de la plantilla" />
        <StatCard label="Presupuesto" value={money(data.budget)} icon={<PiggyBank className="size-5" />} sub={<Link to="/market" className="font-semibold text-pitch-400 hover:text-pitch-300">Ir al mercado →</Link>} className="col-span-2 lg:col-span-1" />
      </div>

      {data.alerts.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {data.alerts.map((a, i) => {
            const { icon: Icon, cls } = ALERT_STYLE[a.level];
            return (
              <Link key={i} to={a.link} className={clsx('flex items-start gap-3 rounded-2xl border px-4 py-3 transition hover:brightness-125', cls)}>
                <Icon className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{a.title}</p>
                  <p className="truncate text-xs opacity-90">{a.message}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Evolución por jornada" subtitle="Tus puntos frente a la media y el máximo" icon={<TrendingUp className="size-5" />} />
          <div className="p-3 sm:p-5">
            {data.history.length ? <PointsHistoryChart data={data.history} height={240} /> : <EmptyState title="Sin datos todavía" description="Tus puntos aparecerán cuando empiece la primera jornada." />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Próximo partido" icon={<CalendarClock className="size-5" />} action={<Link to="/fixtures" className="text-xs font-semibold text-pitch-400">Calendario</Link>} />
          {data.nextFixture ? (
            <div className="p-5">
              <Link to={`/fixtures/${data.nextFixture.id}`} className="block rounded-2xl border border-white/[0.06] bg-ink-900/50 p-4 hover:border-pitch-500/30">
                <p className="label text-center">Jornada {data.nextFixture.gameweekId}</p>
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <ClubCrest club={data.nextFixture.homeClub} size={52} />
                    <span className="text-sm font-semibold text-white">{data.nextFixture.homeClub.commonName ?? data.nextFixture.homeClub.name}</span>
                  </div>
                  <span className="font-display text-2xl font-bold text-slate-500">VS</span>
                  <div className="flex flex-col items-center gap-2">
                    <ClubCrest club={data.nextFixture.awayClub} size={52} />
                    <span className="text-sm font-semibold text-white">{data.nextFixture.awayClub.commonName ?? data.nextFixture.awayClub.name}</span>
                  </div>
                </div>
                <p className="mt-3 text-center text-sm text-slate-300">{dateTime(data.nextFixture.kickoff)}</p>
              </Link>
              <div className="mt-3 space-y-1">
                {data.upcomingFixtures.slice(0, 4).filter((f) => f.id !== data.nextFixture?.id).slice(0, 3).map((f) => (
                  <Link key={f.id} to={`/fixtures/${f.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/[0.04]">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                      <ClubCrest club={f.homeClub} size={16} /> {f.homeClub.shortName} <span className="text-slate-500">v</span> {f.awayClub.shortName} <ClubCrest club={f.awayClub} size={16} />
                    </span>
                    <span className="text-slate-400">{dateTime(f.kickoff)}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title="Sin partidos programados" />
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Jugadores destacados" subtitle="Tu plantilla en la última jornada" icon={<Sparkles className="size-5" />} />
          <div className="divide-y divide-white/[0.05]">
            {data.featuredPlayers.length ? (
              data.featuredPlayers.map((p, i) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  right={
                    <div className="text-right">
                      <p className="stat-number text-2xl">{p.stats.lastPoints}</p>
                      <p className="text-[10px] font-semibold uppercase text-slate-500">{i === 0 ? <Crown className="ml-auto size-3 text-gold" /> : 'pts'}</p>
                    </div>
                  }
                />
              ))
            ) : (
              <EmptyState title="Plantilla vacía" description="Ficha jugadores para verlos aquí." action={<Link to="/market"><Button size="sm">Ir al mercado</Button></Link>} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Líderes globales" icon={<Trophy className="size-5" />} action={<Link to="/rankings" className="text-xs font-semibold text-pitch-400">Ver todo</Link>} />
          <div className="divide-y divide-white/[0.05]">
            {data.leaders.map((r) => (
              <Link key={r.teamId} to={`/managers/${r.teamId}`} className={clsx('flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]', r.userId === user?.id && 'bg-pitch-500/[0.07]')}>
                <span className={clsx('w-6 text-center font-display text-lg font-bold', r.rank === 1 ? 'text-gold' : 'text-slate-400')}>{r.rank}</span>
                <TeamCrest crest={r.crest} name={r.teamName} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{r.teamName}</p>
                  <p className="truncate text-xs text-slate-400">{r.managerName}</p>
                </div>
                <span className="stat-number text-xl">{r.points}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Noticias y alertas" icon={<Newspaper className="size-5" />} action={<Link to="/news" className="text-xs font-semibold text-pitch-400">Ver todo</Link>} />
          <div className="divide-y divide-white/[0.05]">
            {data.notifications.slice(0, 2).map((n) => (
              <Link key={`n${n.id}`} to={n.link ?? '/notifications'} className="block px-4 py-3 hover:bg-white/[0.03]">
                <Badge tone="green">Aviso</Badge>
                <p className="mt-1 text-sm font-semibold text-white">{n.title}</p>
                <p className="line-clamp-1 text-xs text-slate-400">{n.message}</p>
              </Link>
            ))}
            {data.news.slice(0, 4).map((n) => (
              <Link key={n.id} to={`/news?id=${n.id}`} className="block px-4 py-3 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <Badge tone={n.category === 'INJURY' ? 'red' : n.category === 'GAMEWEEK' ? 'sky' : 'slate'}>{{ INJURY: 'Lesiones', GAMEWEEK: 'Jornada', TRANSFER: 'Fichajes', MARKET: 'Mercado' }[n.category] ?? 'General'}</Badge>
                  <span className="text-[11px] text-slate-500">{relativeTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm font-semibold text-white">{n.title}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

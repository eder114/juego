import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, GitCompareArrows, Heart, HeartPulse, History, Minus, Plus, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { dateShort, dateTime, money, POSITION_LABEL } from '../lib/format';
import type { ClubLite, Player } from '../types';
import { useTransferActions } from '../hooks/useTransferActions';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock } from '../components/ui';
import { ClubCrest, DifficultyPill, PlayerPhoto, PositionBadge, PriceChange, StatusBadge } from '../components/sport';
import { PointsHistoryChart, PriceChart } from '../components/charts';

interface PlayerDetailData extends Player {
  priceHistory: { price: number; change: number; reason: string; createdAt: string; gameweekId: number | null }[];
  pointsHistory: { gameweek: number; points: number; played: boolean }[];
  matches: {
    fixtureId: number;
    gameweek: number;
    kickoff: string | null;
    home: boolean;
    opponent: ClubLite;
    result: string | null;
    minutes: number;
    goals: number;
    assists: number;
    cleanSheet: boolean;
    goalsConceded: number;
    yellowCards: number;
    redCards: number;
    saves: number;
    bonus: number;
    points: number;
    breakdown: { label: string; value: number; points: number }[];
  }[];
  injuries: { id: number; type: string; description: string; startDate: string; expectedReturn: string | null; isActive: boolean }[];
  upcoming: { id: number; gameweekId: number; kickoff: string | null; home: boolean; opponent: ClubLite; difficulty: number | null }[];
  purchasePrice: number | null;
}

export default function PlayerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['player', id], queryFn: () => api.get<PlayerDetailData>(`/players/${id}`) });
  const { buy, sell, favorite } = useTransferActions();

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !p) return <LoadingBlock />;

  const stats = [
    ['Puntos', p.stats.totalPoints],
    ['Forma', p.stats.form.toFixed(1)],
    ['Goles', p.stats.goals],
    ['Asistencias', p.stats.assists],
    ['Minutos', p.stats.minutes.toLocaleString('es-ES')],
    ['Partidos', p.stats.appearances],
    ['Porterías a cero', p.stats.cleanSheets],
    ['Paradas', p.stats.saves],
    ['Amarillas', p.stats.yellowCards],
    ['Rojas', p.stats.redCards],
    ['Bonus', p.stats.bonus],
    ['% Selección', `${p.stats.selectedBy}%`],
  ];

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" /> Volver
      </button>

      <div className="card relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `radial-gradient(800px 300px at 15% 0%, ${p.club.primaryColor}55, transparent 70%)` }} />
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:p-7">
          <PlayerPhoto player={p} size={160} className="mx-auto sm:mx-0" rounded="rounded-3xl" />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <PositionBadge position={p.position} />
              <Link to={`/clubs/${p.club.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-white">
                <ClubCrest club={p.club} size={20} /> {p.club.name}
              </Link>
              <StatusBadge status={p.status} chance={p.chanceOfPlaying} />
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {p.firstName} {p.lastName}
            </p>
            <h1 className="text-5xl font-extrabold uppercase leading-none sm:text-6xl">{p.displayName}</h1>
            <p className="mt-2 text-sm text-slate-400">
              {POSITION_LABEL[p.position]}
              {p.age ? ` · ${p.age} años` : ''}
              {p.nationality ? ` · ${p.nationality}` : ''}
              {p.squadNumber ? ` · Dorsal ${p.squadNumber}` : ''}
            </p>
            {p.news && <p className="mt-2 text-sm text-amber-300">{p.news}</p>}
          </div>
          <div className="flex flex-col items-center gap-3 sm:items-end">
            <div className="text-center sm:text-right">
              <p className="label">Precio actual</p>
              <p className="stat-number text-5xl text-pitch-300">{money(p.price)}</p>
              <div className="mt-1 flex items-center justify-center gap-3 sm:justify-end">
                <span className="text-xs text-slate-400">
                  Semana <PriceChange value={p.stats.weeklyChange} />
                </span>
                <span className="text-xs text-slate-400">
                  Temporada <PriceChange value={p.stats.seasonChange} />
                </span>
              </div>
              {p.purchasePrice !== null && <p className="mt-1 text-xs text-slate-400">Lo compraste por {money(p.purchasePrice)}</p>}
            </div>
            <div className="flex gap-2">
              {p.inSquad ? (
                <Button variant="danger" onClick={() => sell.mutate(p)} loading={sell.isPending} icon={<Minus className="size-4" />}>
                  Vender
                </Button>
              ) : (
                <Button onClick={() => buy.mutate(p)} loading={buy.isPending} icon={<Plus className="size-4" />}>
                  Fichar
                </Button>
              )}
              <Button variant="secondary" className="px-3" onClick={() => favorite.mutate({ id: p.id, value: !p.isFavorite })} aria-label="Favorito">
                <Heart className={clsx('size-4', p.isFavorite && 'fill-rose-400 text-rose-400')} />
              </Button>
              <Link to={`/compare?ids=${p.id}`}>
                <Button variant="secondary" className="px-3" aria-label="Comparar">
                  <GitCompareArrows className="size-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="card p-3 text-center">
            <p className="stat-number text-2xl sm:text-3xl">{value}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Puntos por jornada" icon={<TrendingUp className="size-5" />} />
          <div className="p-3 sm:p-5">{p.pointsHistory.length ? <PointsHistoryChart data={p.pointsHistory} /> : <EmptyState title="Sin jornadas disputadas" />}</div>
        </Card>
        <Card>
          <CardHeader title="Evolución de precio" icon={<TrendingUp className="size-5" />} />
          <div className="p-3 sm:p-5">{p.priceHistory.length ? <PriceChart data={p.priceHistory} /> : <EmptyState title="Sin historial" />}</div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Historial de partidos" icon={<History className="size-5" />} />
          {p.matches.length === 0 ? (
            <EmptyState title="Aún no ha disputado minutos" />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2">J</th>
                      <th className="px-2 py-2">Rival</th>
                      <th className="px-2 py-2 text-center">Res.</th>
                      <th className="px-2 py-2 text-center">Min</th>
                      <th className="px-2 py-2 text-center">G</th>
                      <th className="px-2 py-2 text-center">A</th>
                      <th className="px-2 py-2 text-center">PaC</th>
                      <th className="px-2 py-2 text-center">TA</th>
                      <th className="px-2 py-2 text-center">TR</th>
                      <th className="px-4 py-2 text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {p.matches.map((m) => (
                      <tr key={m.fixtureId} className="hover:bg-white/[0.02]" title={m.breakdown.map((b) => `${b.label}: ${b.points > 0 ? '+' : ''}${b.points}`).join('\n')}>
                        <td className="px-4 py-2.5 text-slate-400">{m.gameweek}</td>
                        <td className="px-2 py-2.5">
                          <Link to={`/fixtures/${m.fixtureId}`} className="flex items-center gap-2 font-semibold text-white hover:text-pitch-300">
                            <ClubCrest club={m.opponent} size={18} /> {m.opponent.shortName} <span className="text-xs text-slate-500">({m.home ? 'L' : 'V'})</span>
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 text-center text-slate-300">{m.result ?? '—'}</td>
                        <td className="px-2 py-2.5 text-center tabular-nums">{m.minutes}</td>
                        <td className="px-2 py-2.5 text-center tabular-nums">{m.goals || '·'}</td>
                        <td className="px-2 py-2.5 text-center tabular-nums">{m.assists || '·'}</td>
                        <td className="px-2 py-2.5 text-center">{m.cleanSheet ? '✓' : '·'}</td>
                        <td className="px-2 py-2.5 text-center">{m.yellowCards ? <span className="inline-block h-3.5 w-2.5 rounded-sm bg-yellow-400" /> : '·'}</td>
                        <td className="px-2 py-2.5 text-center">{m.redCards ? <span className="inline-block h-3.5 w-2.5 rounded-sm bg-red-500" /> : '·'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={clsx('stat-number text-lg', m.points >= 8 ? 'text-pitch-300' : m.points < 0 ? 'text-red-400' : '')}>{m.points}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-white/[0.05] md:hidden">
                {p.matches.map((m) => (
                  <div key={m.fixtureId} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-7 font-display text-sm font-bold text-slate-500">J{m.gameweek}</span>
                    <ClubCrest club={m.opponent} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {m.home ? 'vs' : 'en'} {m.opponent.shortName} <span className="text-slate-400">{m.result}</span>
                      </p>
                      <p className="truncate text-xs text-slate-400">{m.breakdown.map((b) => `${b.label} ${b.points > 0 ? '+' : ''}${b.points}`).join(' · ') || `${m.minutes} min`}</p>
                    </div>
                    <span className="stat-number text-2xl">{m.points}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Próximos partidos" icon={<CalendarDays className="size-5" />} />
            <div className="divide-y divide-white/[0.05]">
              {p.upcoming.length ? (
                p.upcoming.map((f) => (
                  <Link key={f.id} to={`/fixtures/${f.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]">
                    <span className="w-8 font-display text-sm font-bold text-slate-500">J{f.gameweekId}</span>
                    <ClubCrest club={f.opponent} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {f.opponent.commonName ?? f.opponent.name} <span className="text-xs text-slate-400">({f.home ? 'Local' : 'Visitante'})</span>
                      </p>
                      <p className="text-xs text-slate-400">{dateTime(f.kickoff)}</p>
                    </div>
                    <DifficultyPill value={f.difficulty}>{f.difficulty ?? '–'}</DifficultyPill>
                  </Link>
                ))
              ) : (
                <EmptyState title="Sin partidos próximos" />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Estado físico" icon={<HeartPulse className="size-5" />} />
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <StatusBadge status={p.status} chance={p.chanceOfPlaying} />
                {p.chanceOfPlaying != null && <span className="text-xs text-slate-400">{p.chanceOfPlaying}% de jugar</span>}
              </div>
              {p.injuries.length === 0 && <p className="text-sm text-slate-400">Sin incidencias registradas esta temporada.</p>}
              {p.injuries.map((i) => (
                <div key={i.id} className="rounded-xl bg-ink-900/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={i.isActive ? 'red' : 'slate'}>{{ INJURY: 'Lesión', SUSPENSION: 'Sanción', ILLNESS: 'Enfermedad', OTHER: 'Otro' }[i.type] ?? i.type}</Badge>
                    <span className="text-[11px] text-slate-500">{dateShort(i.startDate)}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-200">{i.description}</p>
                  {i.expectedReturn && <p className="text-xs text-slate-400">Regreso estimado: {dateShort(i.expectedReturn)}</p>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

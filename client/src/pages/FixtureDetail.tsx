import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Goal, Hand, MapPin } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { dateTime, FIXTURE_STATUS } from '../lib/format';
import type { ClubLite, Fixture, Position } from '../types';
import { Badge, Card, CardHeader, EmptyState, ErrorState, LoadingBlock } from '../components/ui';
import { ClubCrest, PositionBadge } from '../components/sport';

interface PlayerLite {
  id: number;
  displayName: string;
  position: Position;
  photoUrl: string | null;
  club: ClubLite;
}
interface FixtureDetailData extends Fixture {
  homeClub: ClubLite & { stadium?: string };
  gameweek: { id: number; name: string };
  events: { type: string; side: 'home' | 'away'; player: PlayerLite }[];
  summary: { key: string; home: number; away: number }[];
  players: {
    id: number;
    side: 'home' | 'away';
    minutes: number;
    goals: number;
    assists: number;
    yellowCards: number;
    redCards: number;
    saves: number;
    bonus: number;
    points: number;
    player: PlayerLite;
  }[];
}

const EVENT_LABEL: Record<string, string> = { GOAL: 'Gol', OWN_GOAL: 'Gol en propia', ASSIST: 'Asistencia', YELLOW: 'Amarilla', RED: 'Roja', PEN_SAVED: 'Penalti atajado', PEN_MISSED: 'Penalti fallado' };
const SUMMARY_LABEL: Record<string, string> = { goals: 'Goles', assists: 'Asistencias', saves: 'Paradas', yellowCards: 'Amarillas', redCards: 'Rojas' };

function EventIcon({ type }: { type: string }) {
  if (type === 'YELLOW') return <span className="inline-block h-3.5 w-2.5 rounded-sm bg-yellow-400" />;
  if (type === 'RED') return <span className="inline-block h-3.5 w-2.5 rounded-sm bg-red-500" />;
  if (type === 'GOAL') return <Goal className="size-4 text-pitch-400" />;
  if (type === 'OWN_GOAL') return <Goal className="size-4 text-red-400" />;
  if (type === 'PEN_SAVED') return <Hand className="size-4 text-sky-400" />;
  return <span className="font-display text-xs font-bold text-slate-400">A</span>;
}

export default function FixtureDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: f, isLoading, error, refetch } = useQuery({ queryKey: ['fixture', id], queryFn: () => api.get<FixtureDetailData>(`/fixtures/${id}`) });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !f) return <LoadingBlock />;

  const played = f.status === 'FINISHED' || f.status === 'LIVE';
  const order = ['GOAL', 'OWN_GOAL', 'ASSIST', 'PEN_SAVED', 'PEN_MISSED', 'YELLOW', 'RED'];
  const events = [...f.events].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" /> Volver
      </button>

      <div className="card relative overflow-hidden p-5 sm:p-8">
        <div className="absolute inset-0 opacity-40" style={{ background: `linear-gradient(90deg, ${f.homeClub.primaryColor}40, transparent 40%, transparent 60%, ${f.awayClub.primaryColor}40)` }} />
        <div className="relative">
          <div className="flex items-center justify-center gap-2">
            <Badge tone={f.status === 'LIVE' ? 'green' : 'slate'}>{FIXTURE_STATUS[f.status]}</Badge>
            <span className="text-xs text-slate-400">{f.gameweek.name}</span>
          </div>
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <Link to={`/clubs/${f.homeClub.id}`} className="flex flex-col items-center gap-2 text-center">
              <ClubCrest club={f.homeClub} size={84} className="sm:size-28!" />
              <span className="font-display text-xl font-bold uppercase text-white sm:text-3xl">{f.homeClub.commonName ?? f.homeClub.name}</span>
            </Link>
            <div className="text-center">
              {played ? <p className="stat-number text-6xl sm:text-8xl">{f.homeScore}<span className="mx-2 text-slate-600">–</span>{f.awayScore}</p> : <p className="font-display text-4xl font-bold text-slate-400">VS</p>}
            </div>
            <Link to={`/clubs/${f.awayClub.id}`} className="flex flex-col items-center gap-2 text-center">
              <ClubCrest club={f.awayClub} size={84} className="sm:size-28!" />
              <span className="font-display text-xl font-bold uppercase text-white sm:text-3xl">{f.awayClub.commonName ?? f.awayClub.name}</span>
            </Link>
          </div>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 text-sm text-slate-300">
            <span className="capitalize">{dateTime(f.kickoff)}</span>
            {f.homeClub.stadium && (
              <span className="flex items-center gap-1 text-slate-400">
                <MapPin className="size-3.5" /> {f.homeClub.stadium}
              </span>
            )}
          </p>
        </div>
      </div>

      {!played ? (
        <Card>
          <EmptyState title="El partido aún no ha comenzado" description="Aquí verás goles, asistencias, tarjetas y estadísticas de cada jugador." />
        </Card>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Incidencias" />
              {events.length ? (
                <div className="grid grid-cols-2 divide-x divide-white/[0.05]">
                  {(['home', 'away'] as const).map((side) => (
                    <div key={side} className="space-y-1.5 p-4">
                      {events
                        .filter((e) => e.side === side)
                        .map((e, i) => (
                          <Link key={i} to={`/players/${e.player.id}`} className={clsx('flex items-center gap-2 text-sm', side === 'away' && 'flex-row-reverse text-right')}>
                            <EventIcon type={e.type} />
                            <span className="truncate text-slate-200 hover:text-white">{e.player.displayName}</span>
                            <span className="text-[11px] text-slate-500">{EVENT_LABEL[e.type]}</span>
                          </Link>
                        ))}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Sin incidencias registradas" />
              )}
            </Card>
            <Card>
              <CardHeader title="Estadísticas" />
              <div className="space-y-3 p-5">
                {f.summary.map((s) => {
                  const total = s.home + s.away || 1;
                  return (
                    <div key={s.key}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-bold tabular-nums text-white">{s.home}</span>
                        <span className="text-xs text-slate-400">{SUMMARY_LABEL[s.key]}</span>
                        <span className="font-bold tabular-nums text-white">{s.away}</span>
                      </div>
                      <div className="flex h-1.5 gap-1 overflow-hidden rounded-full">
                        <div className="rounded-full" style={{ width: `${(s.home / total) * 100}%`, background: f.homeClub.primaryColor }} />
                        <div className="flex-1 rounded-full bg-white/10" />
                        <div className="rounded-full" style={{ width: `${(s.away / total) * 100}%`, background: f.awayClub.primaryColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {(['home', 'away'] as const).map((side) => {
              const club = side === 'home' ? f.homeClub : f.awayClub;
              const list = f.players.filter((p) => p.side === side);
              return (
                <Card key={side} className="overflow-hidden">
                  <CardHeader title={club.commonName ?? club.name} subtitle="Jugadores participantes" icon={<ClubCrest club={club} size={22} />} />
                  <div className="grid grid-cols-[1fr_repeat(4,34px)_44px] gap-1 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <span>Jugador</span>
                    <span className="text-center">Min</span>
                    <span className="text-center">G</span>
                    <span className="text-center">A</span>
                    <span className="text-center">T</span>
                    <span className="text-right">Pts</span>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {list.map((p) => (
                      <Link key={p.id} to={`/players/${p.player.id}`} className="grid grid-cols-[1fr_repeat(4,34px)_44px] items-center gap-1 px-4 py-2 text-sm hover:bg-white/[0.03]">
                        <span className="flex min-w-0 items-center gap-2">
                          <PositionBadge position={p.player.position} />
                          <span className="truncate text-slate-200">{p.player.displayName}</span>
                        </span>
                        <span className="text-center tabular-nums text-slate-400">{p.minutes}</span>
                        <span className="text-center tabular-nums">{p.goals || '·'}</span>
                        <span className="text-center tabular-nums">{p.assists || '·'}</span>
                        <span className="flex justify-center gap-0.5">
                          {p.yellowCards > 0 && <span className="inline-block h-3 w-2 rounded-sm bg-yellow-400" />}
                          {p.redCards > 0 && <span className="inline-block h-3 w-2 rounded-sm bg-red-500" />}
                          {!p.yellowCards && !p.redCards && '·'}
                        </span>
                        <span className={clsx('text-right font-display text-lg font-bold', p.points >= 8 ? 'text-pitch-300' : p.points < 0 ? 'text-red-400' : 'text-white')}>{p.points}</span>
                      </Link>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

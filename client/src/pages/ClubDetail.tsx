import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import { api } from '../lib/api';
import { money, POSITION_PLURAL, POSITIONS } from '../lib/format';
import type { Club, Fixture, Player } from '../types';
import { Card, CardHeader, ErrorState, LoadingBlock, StatCard, Tabs } from '../components/ui';
import { ClubCrest } from '../components/sport';
import { PlayerRow } from '../components/PlayerCard';
import { FixtureRow } from '../components/FixtureRow';
import { FormDots, type TableRow } from './Clubs';
import { useState } from 'react';

interface ClubDetailData {
  club: Club;
  standing: TableRow | null;
  players: Player[];
  fixtures: Fixture[];
  fantasyPoints: number;
  topScorer: Player | null;
  topFantasy: Player | null;
}

export default function ClubDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState<'squad' | 'fixtures'>('squad');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['club', id], queryFn: () => api.get<ClubDetailData>(`/clubs/${id}`) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  const { club, standing } = data;
  const results = data.fixtures.filter((f) => f.status === 'FINISHED' || f.status === 'LIVE');
  const upcoming = data.fixtures.filter((f) => f.status === 'SCHEDULED' || f.status === 'POSTPONED');

  return (
    <div className="space-y-5">
      <div className="card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-0" style={{ background: `radial-gradient(700px 300px at 0% 0%, ${club.primaryColor}55, transparent 70%)` }} />
        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <ClubCrest club={club} size={110} />
          <div className="flex-1">
            <p className="label text-pitch-400">{club.shortName}</p>
            <h1 className="text-5xl font-extrabold uppercase leading-none">{club.name}</h1>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-slate-300 sm:justify-start">
              <MapPin className="size-4" /> {club.stadium} · {club.city}
            </p>
          </div>
          {standing && (
            <div className="flex gap-4 text-center">
              <div>
                <p className="label">Posición</p>
                <p className="stat-number text-5xl">{standing.position}º</p>
              </div>
              <div>
                <p className="label">Puntos</p>
                <p className="stat-number text-5xl text-pitch-300">{standing.points}</p>
                <div className="mt-1 flex justify-center">
                  <FormDots form={standing.form} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Puntos Fantasy" value={data.fantasyPoints} sub="Suma de su plantilla" />
        <StatCard label="Balance" value={standing ? `${standing.won}-${standing.drawn}-${standing.lost}` : '—'} sub={standing ? `${standing.goalsFor} GF · ${standing.goalsAgainst} GC` : undefined} />
        <StatCard label="Máximo goleador" value={data.topScorer?.stats.goals ?? 0} sub={data.topScorer?.displayName} />
        <StatCard label="Mejor Fantasy" value={data.topFantasy?.stats.totalPoints ?? 0} sub={data.topFantasy?.displayName} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'squad', label: 'Plantilla', count: data.players.length }, { value: 'fixtures', label: 'Partidos' }]} />

      {tab === 'squad' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {POSITIONS.map((pos) => (
            <Card key={pos} className="overflow-hidden">
              <CardHeader title={POSITION_PLURAL[pos]} icon={<Users className="size-5" />} />
              <div className="divide-y divide-white/[0.05]">
                {data.players
                  .filter((p) => p.position === pos)
                  .map((p) => (
                    <PlayerRow
                      key={p.id}
                      player={p}
                      sub={<span className="ml-1">· {money(p.price)}</span>}
                      right={
                        <div className="text-right">
                          <p className="stat-number text-xl">{p.stats.totalPoints}</p>
                          <p className="text-[10px] text-slate-500">
                            {p.stats.goals}G · {p.stats.assists}A
                          </p>
                        </div>
                      }
                    />
                  ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'fixtures' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Resultados" icon={<CalendarDays className="size-5" />} />
            <div className="divide-y divide-white/[0.05]">
              {results.length ? results.map((f) => <FixtureRow key={f.id} fixture={f} />) : <p className="p-4 text-sm text-slate-400">Sin partidos disputados</p>}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Próximos partidos" icon={<CalendarDays className="size-5" />} />
            <div className="max-h-[640px] divide-y divide-white/[0.05] overflow-y-auto">
              {upcoming.map((f) => (
                <div key={f.id}>
                  <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Jornada {f.gameweekId}</p>
                  <FixtureRow fixture={f} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

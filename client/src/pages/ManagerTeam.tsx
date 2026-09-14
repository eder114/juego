import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { GW_STATUS } from '../lib/format';
import type { Crest, Gameweek, LineupView } from '../types';
import { Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, StatCard } from '../components/ui';
import { TeamCrest } from '../components/sport';
import { Pitch } from '../components/Pitch';
import { PointsHistoryChart } from '../components/charts';

interface TeamProfile {
  id: number;
  name: string;
  crest: Crest;
  totalPoints: number;
  globalRank: number | null;
  user: { id: string; managerName: string; avatarUrl: string | null; favoriteClub: { name: string } | null };
  history: { gameweek: number; points: number; average: number; highest: number }[];
}

export default function ManagerTeam() {
  const { teamId } = useParams();
  const { data: team, isLoading, error } = useQuery({ queryKey: ['manager', teamId], queryFn: () => api.get<TeamProfile>(`/teams/${teamId}`) });
  const { data: gws } = useQuery({ queryKey: ['gameweeks'], queryFn: () => api.get<{ currentId: number | null; gameweeks: Gameweek[] }>('/gameweeks') });
  const [gw, setGw] = useState<number | null>(null);
  const selectedGw = gw ?? gws?.currentId ?? null;
  const lineup = useQuery({
    queryKey: ['lineup', 'public', teamId, selectedGw],
    queryFn: () => api.get<LineupView>(`/teams/${teamId}/lineup/${selectedGw}`),
    enabled: !!selectedGw,
    retry: false,
  });
  const entries = useMemo(() => new Map((lineup.data?.players ?? []).map((e) => [e.player.id, e])), [lineup.data]);

  if (error) return <ErrorState error={error} />;
  if (isLoading || !team) return <LoadingBlock />;
  const best = team.history.reduce((m, h) => Math.max(m, h.points), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Mánager: ${team.user.managerName}`}
        title={
          <span className="flex items-center gap-3">
            <TeamCrest crest={team.crest} name={team.name} size={52} /> {team.name}
          </span>
        }
        subtitle={team.user.favoriteClub ? `Aficionado de ${team.user.favoriteClub.name}` : undefined}
      />
      <div className="grid grid-cols-3 gap-3">
        <StatCard accent label="Puntos" value={team.totalPoints} />
        <StatCard label="Posición global" value={team.globalRank ? `#${team.globalRank}` : '—'} />
        <StatCard label="Mejor jornada" value={best} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold uppercase">Alineación</h2>
            <Select className="w-48" value={selectedGw ?? ''} onChange={(e) => setGw(Number(e.target.value))}>
              {gws?.gameweeks
                .filter((g) => g.status !== 'UPCOMING')
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {GW_STATUS[g.status]}
                  </option>
                ))}
            </Select>
          </div>
          {lineup.isLoading ? (
            <LoadingBlock />
          ) : lineup.error ? (
            <Card>
              <EmptyState icon={<Lock className="size-6" />} title="Alineación no visible" description={(lineup.error as Error).message} />
            </Card>
          ) : lineup.data ? (
            <Pitch
              entries={entries}
              editable={false}
              showPoints
              activeCaptainId={lineup.data.activeCaptainId}
              state={{
                formation: lineup.data.formation,
                starters: lineup.data.players.filter((p) => p.role === 'STARTER').sort((a, b) => a.order - b.order).map((p) => p.player.id),
                bench: lineup.data.players.filter((p) => p.role === 'BENCH').sort((a, b) => a.order - b.order).map((p) => p.player.id),
                captainId: lineup.data.captainId,
                viceCaptainId: lineup.data.viceCaptainId,
              }}
              benchExtra={<span className="text-xs text-slate-400">{lineup.data.points} pts</span>}
            />
          ) : null}
        </div>
        <Card>
          <CardHeader title="Puntos por jornada" icon={<TrendingUp className="size-5" />} />
          <div className="p-3">{team.history.length ? <PointsHistoryChart data={team.history} /> : <EmptyState title="Sin jornadas" />}</div>
        </Card>
      </div>
    </div>
  );
}

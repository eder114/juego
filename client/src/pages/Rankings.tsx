import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ListOrdered } from 'lucide-react';
import { api, qs } from '../lib/api';
import { monthLabel } from '../lib/format';
import type { Gameweek, StandingRow } from '../types';
import { useAuth } from '../context/AuthContext';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, Select, Tabs } from '../components/ui';
import { MovementIndicator, TeamCrest } from '../components/sport';
import { StandingsTable } from '../components/StandingsTable';

interface RankingsResponse {
  rows: StandingRow[];
  total: number;
  page: number;
  pageSize: number;
  me: StandingRow | null;
  gameweekIds?: number[];
}

export default function Rankings() {
  const { user } = useAuth();
  const [type, setType] = useState<'season' | 'weekly' | 'monthly'>('season');
  const [gameweek, setGameweek] = useState<number | undefined>();
  const [month, setMonth] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const gws = useQuery({ queryKey: ['gameweeks'], queryFn: () => api.get<{ currentId: number | null; gameweeks: Gameweek[] }>('/gameweeks') });
  const months = useQuery({ queryKey: ['rankings', 'months'], queryFn: () => api.get<string[]>('/rankings/months') });
  const params = { type, gameweek: type === 'weekly' ? gameweek : undefined, month: type === 'monthly' ? (month ?? months.data?.at(-1)) : undefined, page, pageSize: 50 };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rankings', params],
    queryFn: () => api.get<RankingsResponse>(`/rankings${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled: type !== 'monthly' || !!params.month,
  });

  const played = gws.data?.gameweeks.filter((g) => g.status !== 'UPCOMING') ?? [];
  const me = data?.me;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Clasificación global" title="Clasificación" subtitle="Todos los mánagers de Premier Fantasy." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={type}
          onChange={(t) => {
            setType(t);
            setPage(1);
          }}
          tabs={[
            { value: 'season', label: 'Temporada' },
            { value: 'weekly', label: 'Semanal' },
            { value: 'monthly', label: 'Mensual' },
          ]}
        />
        {type === 'weekly' && (
          <Select className="sm:w-52" value={gameweek ?? played.at(-1)?.id ?? ''} onChange={(e) => setGameweek(Number(e.target.value))}>
            {played.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        )}
        {type === 'monthly' && (
          <Select className="capitalize sm:w-52" value={params.month ?? ''} onChange={(e) => setMonth(e.target.value)}>
            {months.data?.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        )}
      </div>

      {me && (
        <Card className="flex items-center gap-4 border-pitch-500/30 bg-gradient-to-r from-pitch-600/20 to-transparent p-4">
          <div className="text-center">
            <p className="label">Tu posición</p>
            <p className="stat-number text-4xl">#{me.rank.toLocaleString('es-ES')}</p>
          </div>
          {user?.team && <TeamCrest crest={user.team.crest} name={user.team.name} size={44} />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-white">{me.teamName}</p>
            <p className="flex items-center gap-2 text-xs text-slate-400">
              de {data?.total.toLocaleString('es-ES')} mánagers {type === 'season' && <MovementIndicator movement={me.movement} delta={me.previousRank !== null ? me.previousRank - me.rank : null} />}
            </p>
          </div>
          <div className="text-right">
            <p className="label">Puntos</p>
            <p className="stat-number text-4xl text-pitch-300">{me.points}</p>
          </div>
        </Card>
      )}

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <LoadingBlock />
      ) : data?.rows.length ? (
        <Card className="overflow-hidden">
          <StandingsTable rows={data.rows.map((r) => ({ ...r, isMe: r.userId === user?.id }))} pointsLabel={type === 'season' ? 'Total' : 'Puntos'} showLast={type === 'season'} />
          <div className="border-t border-white/[0.06] px-4 pb-4">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<ListOrdered className="size-6" />} title="Sin clasificación todavía" description="Aparecerá cuando se disputen partidos." />
        </Card>
      )}
    </div>
  );
}

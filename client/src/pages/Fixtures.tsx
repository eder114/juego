import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, qs } from '../lib/api';
import { dateLong, dateTime, dayKey, GW_STATUS } from '../lib/format';
import type { Club, Fixture, Gameweek } from '../types';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select } from '../components/ui';
import { FixtureRow } from '../components/FixtureRow';

export default function Fixtures() {
  const gws = useQuery({ queryKey: ['gameweeks'], queryFn: () => api.get<{ currentId: number | null; nextId: number | null; gameweeks: Gameweek[] }>('/gameweeks') });
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });
  const [selected, setSelected] = useState<number | null>(null);
  const [club, setClub] = useState('');
  const gwId = selected ?? gws.data?.currentId ?? gws.data?.nextId ?? 1;
  const params = club ? { club } : { gameweek: gwId };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['fixtures', params], queryFn: () => api.get<Fixture[]>(`/fixtures${qs(params)}`), enabled: !!gws.data });

  const gameweek = gws.data?.gameweeks.find((g) => g.id === gwId);
  const groups = useMemo(() => {
    const map = new Map<string, Fixture[]>();
    for (const f of data ?? []) {
      const key = club ? `J${f.gameweekId}|${dayKey(f.kickoff)}` : dayKey(f.kickoff);
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()];
  }, [data, club]);
  const total = gws.data?.gameweeks.length ?? 38;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Premier League 2026/27" title="Calendario" subtitle="Horarios en tu zona horaria local." />

      <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        {!club ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="size-10 p-0!" disabled={gwId <= 1} onClick={() => setSelected(gwId - 1)} aria-label="Jornada anterior">
              <ChevronLeft className="size-5" />
            </Button>
            <Select value={gwId} onChange={(e) => setSelected(Number(e.target.value))} className="w-44">
              {gws.data?.gameweeks.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" className="size-10 p-0!" disabled={gwId >= total} onClick={() => setSelected(gwId + 1)} aria-label="Jornada siguiente">
              <ChevronRight className="size-5" />
            </Button>
            {gameweek && (
              <div className="ml-2 hidden sm:block">
                <Badge tone={gameweek.status === 'LIVE' ? 'green' : gameweek.status === 'FINISHED' ? 'slate' : 'sky'}>{GW_STATUS[gameweek.status]}</Badge>
                <p className="mt-0.5 text-xs text-slate-400">Cierre de alineaciones: {dateTime(gameweek.deadline)}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-300">Todos los partidos del club en la temporada</p>
        )}
        <Select value={club} onChange={(e) => setClub(e.target.value)} className="sm:w-60">
          <option value="">Todos los clubes (por jornada)</option>
          {clubs?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || gws.isLoading ? (
        <LoadingBlock />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarX2 className="size-6" />} title="Sin partidos" />
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([key, fixtures]) => (
            <Card key={key} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
                <p className="text-sm font-semibold capitalize text-slate-200">{dateLong(fixtures[0].kickoff)}</p>
                {club && <Badge>Jornada {fixtures[0].gameweekId}</Badge>}
              </div>
              <div className="divide-y divide-white/[0.05]">
                {fixtures.map((f) => (
                  <FixtureRow key={f.id} fixture={f} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

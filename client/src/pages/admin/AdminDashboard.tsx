import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, CloudDownload, XCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTime, GW_STATUS, relativeTime } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, CardHeader, ErrorState, LoadingBlock, StatCard } from '../../components/ui';

interface Overview {
  counts: { users: number; teams: number; leagues: number; players: number; clubs: number; stats: number; transfers: number };
  fixtures: Record<string, number>;
  gameweeks: { id: number; name: string; status: string; isProcessed: boolean; pricesUpdated: boolean; deadline: string }[];
  recentUsers: { id: string; managerName: string; email: string; createdAt: string; role: string }[];
  lastSync: { at: string; ok: boolean; message: string } | null;
  settings: { market_open: boolean; provider_auto_sync: boolean; season: string };
}

export default function AdminDashboard() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview') });
  const sync = useMutation({
    mutationFn: () => api.post<{ playersUpdated: number; stats: number }>('/admin/sync'),
    onSuccess: (r) => {
      toast.push('success', `Sincronizado: ${r.playersUpdated} jugadores, ${r.stats} estadísticas`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  const current = data.gameweeks.find((g) => g.status === 'LIVE') ?? data.gameweeks.find((g) => g.status === 'UPCOMING');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent label="Usuarios" value={data.counts.users} sub={`${data.counts.teams} equipos`} />
        <StatCard label="Ligas" value={data.counts.leagues} />
        <StatCard label="Jugadores activos" value={data.counts.players} sub={`${data.counts.clubs} clubes`} />
        <StatCard label="Fichajes" value={data.counts.transfers} sub={`${data.counts.stats} estadísticas`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Estado de la temporada" subtitle={`Temporada ${data.settings.season}`} action={<Link to="/admin/gameweeks" className="text-xs font-semibold text-violet-300">Gestionar</Link>} />
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            {['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED'].map((s) => (
              <div key={s} className="rounded-xl bg-ink-900/60 p-3 text-center">
                <p className="stat-number text-3xl">{data.fixtures[s] ?? 0}</p>
                <p className="label mt-1">{{ SCHEDULED: 'Programados', LIVE: 'En vivo', FINISHED: 'Finalizados', POSTPONED: 'Aplazados' }[s]}</p>
              </div>
            ))}
          </div>
          <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 pb-4">
            {data.gameweeks.map((g) => (
              <span key={g.id} title={`${g.name} · ${GW_STATUS[g.status]}${g.isProcessed ? ' · procesada' : ''}`} className={`grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold ${g.isProcessed ? 'bg-pitch-500/25 text-pitch-300' : g.status === 'LIVE' ? 'animate-pulse bg-amber-500/25 text-amber-300' : 'bg-white/[0.05] text-slate-500'}`}>
                {g.id}
              </span>
            ))}
          </div>
          {current && (
            <p className="border-t border-white/[0.06] px-4 py-3 text-sm text-slate-300">
              {current.name}: <Badge tone={current.status === 'LIVE' ? 'amber' : 'sky'}>{GW_STATUS[current.status]}</Badge> · cierre {dateTime(current.deadline)}
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Fuente de datos" subtitle="API oficial de Fantasy Premier League" />
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Sincronización automática</span>
              <Badge tone={data.settings.provider_auto_sync ? 'green' : 'slate'}>{data.settings.provider_auto_sync ? 'Activada' : 'Desactivada'}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Mercado</span>
              <Badge tone={data.settings.market_open ? 'green' : 'red'}>{data.settings.market_open ? 'Abierto' : 'Cerrado'}</Badge>
            </div>
            {data.lastSync && (
              <p className="flex items-start gap-2 rounded-xl bg-ink-900/60 p-3 text-xs text-slate-300">
                {data.lastSync.ok ? <CheckCircle2 className="size-4 shrink-0 text-pitch-400" /> : <XCircle className="size-4 shrink-0 text-red-400" />}
                <span>
                  {relativeTime(data.lastSync.at)} — {data.lastSync.message}
                </span>
              </p>
            )}
            <Button className="w-full" icon={<CloudDownload className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>
              Sincronizar ahora
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Últimos registros" action={<Link to="/admin/users" className="text-xs font-semibold text-violet-300">Ver usuarios</Link>} />
        <div className="divide-y divide-white/[0.05]">
          {data.recentUsers.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-white">{u.managerName}</span> <span className="text-slate-400">{u.email}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {u.role === 'ADMIN' && <Badge tone="violet">Admin</Badge>}
                <span className="text-xs text-slate-500">{relativeTime(u.createdAt)}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

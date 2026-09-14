import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { CartesianGrid, Legend, Line, LineChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../lib/api';
import { money } from '../lib/format';
import type { Paginated, Player } from '../types';
import { Card, CardHeader, EmptyState, PageHeader } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge } from '../components/sport';
import { CHART_COLORS, tooltipStyle } from '../components/charts';

type ComparePlayer = Player & { history: { gameweek: number; points: number }[] };

const ROWS: { label: string; get: (p: ComparePlayer) => number; format?: (v: number) => string; lowerIsBetter?: boolean }[] = [
  { label: 'Precio', get: (p) => p.price, format: money, lowerIsBetter: true },
  { label: 'Puntos totales', get: (p) => p.stats.totalPoints },
  { label: 'Forma', get: (p) => p.stats.form, format: (v) => v.toFixed(1) },
  { label: 'Puntos / £M', get: (p) => Math.round((p.stats.totalPoints / (p.price / 10)) * 10) / 10, format: (v) => v.toFixed(1) },
  { label: 'Goles', get: (p) => p.stats.goals },
  { label: 'Asistencias', get: (p) => p.stats.assists },
  { label: 'Minutos', get: (p) => p.stats.minutes },
  { label: 'Porterías a cero', get: (p) => p.stats.cleanSheets },
  { label: 'Bonus', get: (p) => p.stats.bonus },
  { label: 'Amarillas', get: (p) => p.stats.yellowCards, lowerIsBetter: true },
  { label: 'Rojas', get: (p) => p.stats.redCards, lowerIsBetter: true },
  { label: '% Selección', get: (p) => p.stats.selectedBy, format: (v) => `${v}%` },
];

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).map(Number);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: players } = useQuery({
    queryKey: ['compare', ids.join(',')],
    queryFn: () => api.get<ComparePlayer[]>(`/players/compare?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
  });
  const { data: results } = useQuery({
    queryKey: ['players', 'compare-search', debounced],
    queryFn: () => api.get<Paginated<Player>>(`/players${qs({ search: debounced, pageSize: 6 })}`),
    enabled: debounced.length >= 2,
  });

  const setIds = (next: number[]) => setParams(next.length ? { ids: next.join(',') } : {});
  const list = players ?? [];

  const radarKeys = [
    { key: 'Puntos', get: (p: ComparePlayer) => p.stats.totalPoints },
    { key: 'Forma', get: (p: ComparePlayer) => p.stats.form },
    { key: 'Goles', get: (p: ComparePlayer) => p.stats.goals },
    { key: 'Asist.', get: (p: ComparePlayer) => p.stats.assists },
    { key: 'Minutos', get: (p: ComparePlayer) => p.stats.minutes },
    { key: 'Bonus', get: (p: ComparePlayer) => p.stats.bonus },
  ];
  const radarData = radarKeys.map((k) => {
    const max = Math.max(1, ...list.map(k.get));
    return { metric: k.key, ...Object.fromEntries(list.map((p) => [p.displayName, Math.round((k.get(p) / max) * 100)])) };
  });
  const gws = [...new Set(list.flatMap((p) => p.history.map((h) => h.gameweek)))].sort((a, b) => a - b);
  const lineData = gws.map((gw) => ({ gameweek: gw, ...Object.fromEntries(list.map((p) => [p.displayName, p.history.find((h) => h.gameweek === gw)?.points ?? 0])) }));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Análisis" title="Comparar jugadores" subtitle="Compara hasta 4 jugadores lado a lado." />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {list.map((p, i) => (
            <span key={p.id} className="flex items-center gap-2 rounded-xl border px-2 py-1.5 text-sm" style={{ borderColor: `${CHART_COLORS[i]}66` }}>
              <span className="size-2.5 rounded-full" style={{ background: CHART_COLORS[i] }} />
              <span className="font-semibold text-white">{p.displayName}</span>
              <button onClick={() => setIds(ids.filter((x) => x !== p.id))} className="text-slate-400 hover:text-white" aria-label={`Quitar ${p.displayName}`}>
                <X className="size-4" />
              </button>
            </span>
          ))}
          {ids.length < 4 && (
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Añadir jugador…" />
              {debounced.length >= 2 && results && (
                <div className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-2xl">
                  {results.items.filter((r) => !ids.includes(r.id)).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setIds([...ids, r.id]);
                        setSearch('');
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.05]"
                    >
                      <PlayerPhoto player={r} size={32} rounded="rounded-lg" />
                      <span className="flex-1 text-sm font-semibold text-white">{r.displayName}</span>
                      <PositionBadge position={r.position} />
                      <ClubCrest club={r.club} size={18} />
                      <Plus className="size-4 text-pitch-400" />
                    </button>
                  ))}
                  {results.items.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">Sin resultados</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Search className="size-6" />} title="Elige jugadores" description="Busca jugadores arriba o selecciónalos desde el mercado." />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr>
                    <th className="w-40 px-4 py-3" />
                    {list.map((p, i) => (
                      <th key={p.id} className="px-3 py-4 text-center">
                        <Link to={`/players/${p.id}`} className="inline-flex flex-col items-center gap-2">
                          <PlayerPhoto player={p} size={64} className="ring-2" />
                          <span className="font-display text-lg font-bold uppercase text-white" style={{ color: CHART_COLORS[i] }}>
                            {p.displayName}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <PositionBadge position={p.position} /> <ClubCrest club={p.club} size={14} /> {p.club.shortName}
                          </span>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {ROWS.map((row) => {
                    const values = list.map(row.get);
                    const best = row.lowerIsBetter ? Math.min(...values) : Math.max(...values);
                    return (
                      <tr key={row.label}>
                        <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{row.label}</td>
                        {values.map((v, i) => (
                          <td key={i} className="px-3 py-2.5 text-center">
                            <span className={clsx('font-display text-lg font-bold tabular-nums', list.length > 1 && v === best ? 'text-pitch-300' : 'text-slate-200')}>{row.format ? row.format(v) : v}</span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Perfil de rendimiento" subtitle="Relativo al mejor de la comparación" />
              <div className="p-3">
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="rgba(255,255,255,0.1)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    {list.map((p, i) => (
                      <Radar key={p.id} name={p.displayName} dataKey={p.displayName} stroke={CHART_COLORS[i]} fill={CHART_COLORS[i]} fillOpacity={0.15} strokeWidth={2} />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip {...tooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Puntos por jornada" />
              <div className="p-3">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={lineData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="gameweek" tickFormatter={(v) => `J${v}`} stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} labelFormatter={(v) => `Jornada ${v}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {list.map((p, i) => (
                      <Line key={p.id} dataKey={p.displayName} stroke={CHART_COLORS[i]} strokeWidth={2.5} dot={{ r: 3 }} type="monotone" />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

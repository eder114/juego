import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, GitCompareArrows, Heart, Lock, Search, SlidersHorizontal, X } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../lib/api';
import { money, POSITION_PLURAL, POSITION_SHORT, POSITIONS } from '../lib/format';
import type { Club, Paginated, Player, Position, Squad } from '../types';
import { useTransferActions } from '../hooks/useTransferActions';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Select, Skeleton, Tabs, Toggle } from '../components/ui';
import { PlayerMarketCard } from '../components/PlayerCard';
import { ClubCrest, PlayerPhoto, PositionBadge, StatusBadge } from '../components/sport';

const SORTS = [
  { value: 'points', label: 'Puntos totales' },
  { value: 'price', label: 'Precio' },
  { value: 'form', label: 'Rendimiento (forma)' },
  { value: 'goals', label: 'Goles' },
  { value: 'assists', label: 'Asistencias' },
  { value: 'lastPoints', label: 'Puntos última jornada' },
  { value: 'minutes', label: 'Minutos' },
  { value: 'selected', label: '% Selección' },
  { value: 'priceChange', label: 'Variación de precio' },
  { value: 'name', label: 'Nombre' },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Market() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [club, setClub] = useState('');
  const [sort, setSort] = useState('points');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [favorites, setFavorites] = useState(false);
  const [maxPrice, setMaxPrice] = useState(160);
  const [page, setPage] = useState(1);
  const [compare, setCompare] = useState<number[]>([]);
  const [confirm, setConfirm] = useState<{ player: Player; action: 'buy' | 'sell' } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedSearch = useDebounced(search);
  const { buy, sell, favorite } = useTransferActions();

  useEffect(() => setPage(1), [debouncedSearch, position, club, sort, order, onlyAvailable, favorites, maxPrice]);

  const params = { search: debouncedSearch, position: position === 'ALL' ? undefined : position, club, sort, order, onlyAvailable: onlyAvailable || undefined, favorites: favorites || undefined, maxPrice: maxPrice < 160 ? maxPrice : undefined, page, pageSize: 24 };
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['players', params],
    queryFn: () => api.get<Paginated<Player>>(`/players${qs(params)}`),
    placeholderData: keepPreviousData,
  });
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });
  const { data: squad } = useQuery({ queryKey: ['team'], queryFn: () => api.get<Squad>('/team') });

  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;
  const busyId = (buy.isPending && buy.variables?.id) || (sell.isPending && sell.variables?.id);

  const confirmInfo = useMemo(() => {
    if (!confirm || !squad) return null;
    const p = confirm.player;
    if (confirm.action === 'sell') {
      const entry = squad.players.find((x) => x.id === p.id);
      return { after: squad.budget + (entry?.salePrice ?? p.price), problems: [] as string[], entry };
    }
    const problems: string[] = [];
    if (!squad.marketOpen) problems.push('El mercado está cerrado');
    if (squad.counts[p.position] >= squad.requirements[p.position]) problems.push(`Ya tienes ${squad.requirements[p.position]} ${POSITION_PLURAL[p.position].toLowerCase()}`);
    if ((squad.clubCounts[p.club.shortName] ?? 0) >= squad.maxPerClub) problems.push(`Máximo ${squad.maxPerClub} jugadores de ${p.club.name}`);
    if (squad.budget < p.price) problems.push(`Presupuesto insuficiente (te faltan ${money(p.price - squad.budget)})`);
    return { after: squad.budget - p.price, problems, entry: undefined };
  }, [confirm, squad]);

  const toggleCompare = (id: number) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 4 ? c : [...c, id]));

  const filters = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select value={club} onChange={(e) => setClub(e.target.value)} aria-label="Club">
        <option value="">Todos los clubes</option>
        {clubs?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar por">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <button onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 text-slate-300 hover:text-white" title={order === 'desc' ? 'Descendente' : 'Ascendente'}>
          {order === 'desc' ? <ArrowDownWideNarrow className="size-4" /> : <ArrowUpWideNarrow className="size-4" />}
        </button>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-white/10 px-3.5">
        <span className="label shrink-0">Hasta</span>
        <input type="range" min={40} max={160} step={5} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-full accent-pitch-500" />
        <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-white">{maxPrice >= 160 ? 'Todo' : money(maxPrice)}</span>
      </label>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3.5 py-2">
        <span className="flex items-center gap-2 text-sm text-slate-300">
          <Toggle checked={onlyAvailable} onChange={setOnlyAvailable} label="Solo disponibles" /> Disponibles
        </span>
        <span className="flex items-center gap-2 text-sm text-slate-300">
          <Toggle checked={favorites} onChange={setFavorites} label="Solo favoritos" /> <Heart className="size-4" />
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Mercado de fichajes"
        title="Mercado"
        subtitle="Jugadores reales de la Premier League. Máximo 3 por club."
        actions={
          squad && (
            <div className="flex flex-wrap items-center gap-2">
              {!squad.marketOpen && (
                <Badge tone="red">
                  <Lock className="size-3" /> Mercado cerrado
                </Badge>
              )}
              <div className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-right">
                <p className="label">Presupuesto</p>
                <p className="stat-number text-xl text-pitch-300">{money(squad.budget)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-right">
                <p className="label">Plantilla</p>
                <p className="stat-number text-xl">
                  {squad.players.length}/{squad.squadSize}
                </p>
              </div>
            </div>
          )
        }
      />

      {squad && (
        <div className="scrollbar-none mb-4 flex gap-2 overflow-x-auto">
          {POSITIONS.map((pos) => {
            const full = squad.counts[pos] >= squad.requirements[pos];
            return (
              <div key={pos} className={clsx('flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-sm', full ? 'border-pitch-500/30 bg-pitch-500/10' : 'border-white/10 bg-white/[0.03]')}>
                <PositionBadge position={pos} />
                <span className="font-semibold tabular-nums text-white">
                  {squad.counts[pos]}/{squad.requirements[pos]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Card className="mb-5 p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input className="input pl-10" placeholder="Buscar jugador por nombre…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar jugador" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Limpiar búsqueda">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Button variant="secondary" className="size-11 p-0! lg:hidden" onClick={() => setFiltersOpen((o) => !o)} aria-label="Filtros">
              <SlidersHorizontal className="size-4" />
            </Button>
          </div>
          <Tabs
            value={position}
            onChange={setPosition}
            tabs={[{ value: 'ALL' as const, label: 'Todos' }, ...POSITIONS.map((p) => ({ value: p, label: POSITION_SHORT[p] }))]}
          />
          <div className={clsx(filtersOpen ? 'block' : 'hidden', 'lg:block')}>{filters}</div>
        </div>
      </Card>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<Search className="size-6" />} title="Sin resultados" description="Prueba con otros filtros o un nombre distinto." />
        </Card>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-400">
            {data?.total} jugadores {isFetching && '· actualizando…'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data?.items.map((p) => (
              <PlayerMarketCard
                key={p.id}
                player={p}
                busy={busyId === p.id}
                onBuy={() => setConfirm({ player: p, action: 'buy' })}
                onSell={() => setConfirm({ player: p, action: 'sell' })}
                onFavorite={() => favorite.mutate({ id: p.id, value: !p.isFavorite })}
                onCompare={() => toggleCompare(p.id)}
                comparing={compare.includes(p.id)}
              />
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span className="text-sm text-slate-400">
                Página {page} de {pages}
              </span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}

      {compare.length > 0 && (
        <div className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-sky-400/30 bg-ink-800/95 p-3 shadow-2xl backdrop-blur lg:bottom-6">
          <GitCompareArrows className="size-5 shrink-0 text-sky-300" />
          <p className="flex-1 text-sm text-white">
            {compare.length} jugador{compare.length > 1 ? 'es' : ''} para comparar <span className="text-slate-400">(máx. 4)</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setCompare([])}>
            Limpiar
          </Button>
          <Button size="sm" disabled={compare.length < 2} onClick={() => navigate(`/compare?ids=${compare.join(',')}`)}>
            Comparar
          </Button>
        </div>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action === 'buy' ? 'Confirmar fichaje' : 'Confirmar venta'}
        size="sm"
        footer={
          confirm && (
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancelar
              </Button>
              <Button
                variant={confirm.action === 'buy' ? 'primary' : 'danger'}
                disabled={!!confirmInfo?.problems.length}
                loading={buy.isPending || sell.isPending}
                onClick={() => {
                  const mutation = confirm.action === 'buy' ? buy : sell;
                  mutation.mutate(confirm.player, { onSuccess: () => setConfirm(null) });
                }}
              >
                {confirm.action === 'buy' ? `Fichar por ${money(confirm.player.price)}` : `Vender por ${money(confirmInfo?.entry?.salePrice ?? confirm.player.price)}`}
              </Button>
            </>
          )
        }
      >
        {confirm && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <PlayerPhoto player={confirm.player} size={64} />
              <div>
                <p className="font-display text-2xl font-bold uppercase text-white">{confirm.player.displayName}</p>
                <p className="flex items-center gap-1.5 text-sm text-slate-400">
                  <PositionBadge position={confirm.player.position} /> <ClubCrest club={confirm.player.club} size={16} /> {confirm.player.club.name}
                </p>
                {confirm.player.status !== 'AVAILABLE' && (
                  <div className="mt-1">
                    <StatusBadge status={confirm.player.status} chance={confirm.player.chanceOfPlaying} />
                  </div>
                )}
              </div>
            </div>
            {confirmInfo && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-ink-900/60 p-3">
                  <p className="label">Presupuesto actual</p>
                  <p className="stat-number mt-1 text-xl">{money(squad?.budget)}</p>
                </div>
                <div className="rounded-xl bg-ink-900/60 p-3">
                  <p className="label">Tras la operación</p>
                  <p className={clsx('stat-number mt-1 text-xl', confirmInfo.after < 0 ? 'text-red-400' : 'text-pitch-300')}>{money(confirmInfo.after)}</p>
                </div>
                {confirmInfo.entry && (
                  <p className="col-span-2 text-xs text-slate-400">
                    Comprado por {money(confirmInfo.entry.purchasePrice)} · Precio actual {money(confirmInfo.entry.price)}
                  </p>
                )}
              </div>
            )}
            {confirmInfo?.problems.map((p) => (
              <p key={p} className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {p}
              </p>
            ))}
            {confirm.player.news && <p className="text-xs text-amber-300">{confirm.player.news}</p>}
            <Link to={`/players/${confirm.player.id}`} className="block text-xs font-semibold text-pitch-400">
              Ver ficha completa →
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}

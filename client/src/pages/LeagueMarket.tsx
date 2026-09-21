import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Info, Lock, ShoppingCart, Trophy, Users, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { moneyFull, moneyK, POSITION_LABEL } from '../lib/format';
import type { LeagueMarket as LeagueMarketData, MarketListing } from '../types';
import { useLeagueEconomy } from '../hooks/useLeagueEconomy';
import { useEconomyTerms } from '../hooks/usePublicConfig';
import { Button, Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, StatusBadge } from '../components/sport';
import { CoachPhoto, RarityBadge, useServerCountdown, ValueTrendBadge } from '../components/economy';

const STATUS_CHIP = {
  AVAILABLE: { label: 'Disponible', cls: 'bg-pitch-500/15 text-pitch-300 ring-pitch-500/35' },
  SOLD: { label: 'Vendido', cls: 'bg-red-500/15 text-red-300 ring-red-500/35' },
  UNAVAILABLE: { label: 'No disponible', cls: 'bg-white/10 text-white/60 ring-white/20' },
} as const;

/**
 * Mercado compartido de la liga: todos sus mánagers ven los mismos anuncios. Se actualiza solo cada
 * `pollSeconds` mientras la pestaña está visible y al terminar el ciclo (hora del servidor).
 */
export default function LeagueMarket() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['league-market'],
    queryFn: () => api.get<LeagueMarketData>('/market/league'),
    refetchInterval: (q) => (q.state.data?.mode === 'LEAGUE' ? q.state.data.pollSeconds * 1000 : false),
  });
  const { buy, join } = useLeagueEconomy();
  const terms = useEconomyTerms();
  const [confirm, setConfirm] = useState<MarketListing | null>(null);

  const league = data?.mode === 'LEAGUE' ? data : null;
  const countdown = useServerCountdown(league?.cycle.endsAt, league?.serverTime);
  // Al terminar el ciclo el servidor ya tiene el mercado nuevo: se pide al momento
  useEffect(() => {
    if (countdown.done) void qc.invalidateQueries({ queryKey: ['league-market'] });
  }, [countdown.done, qc]);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      </div>
    );

  if (data.mode === 'NO_LEAGUE')
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Mercado de la liga" title="Aún no juegas en ninguna liga" subtitle={`El mercado es compartido por liga: al entrar en una recibes ${terms.players} y ${terms.budget}.`} />
        <Card>
          <EmptyState
            icon={<Trophy className="size-6" />}
            title="Crea una liga o únete con un código"
            description="Invita a tus amigos: todos veréis el mismo mercado cada día y cada jugador solo puede tener un dueño en la liga."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {data.eligibleLeagues.map((l) => (
                  <Button key={l.id} loading={join.isPending && join.variables?.leagueId === l.id} onClick={() => join.mutate({ leagueId: l.id })}>
                    Jugar en «{l.name}»
                  </Button>
                ))}
                <Link to="/leagues">
                  <Button variant={data.eligibleLeagues.length ? 'secondary' : 'primary'}>Ir a Ligas</Button>
                </Link>
              </div>
            }
          />
        </Card>
      </div>
    );

  if (data.mode !== 'LEAGUE') return null;
  const availablePlayers = data.players.filter((p) => p.status === 'AVAILABLE').length;
  const availableCoaches = data.coaches.filter((c) => c.status === 'AVAILABLE').length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={`Liga · ${data.league.name}`}
        title="Mercado de la liga"
        subtitle={`Mercado compartido: los ${data.league.participants} mánagers de la liga ven exactamente estos jugadores. Cuando alguien compra uno, se agota para todos.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Actualiza en" value={<span className="font-mono tabular-nums">{countdown.label}</span>} icon={<Clock />} sub={`Cada día a las ${data.league.resetTime} (${data.league.timezone.replace('_', ' ')})`} />
        <StatCard label="Presupuesto" value={moneyK(data.wallet)} icon={<Wallet />} sub={moneyFull(data.wallet)} accent />
        <StatCard label="Jugadores disponibles" value={`${availablePlayers}/${data.players.length}`} icon={<Users />} sub={`Tu plantilla: ${data.squadCount}/${data.limits.maxSquad}`} />
        <StatCard label="Entrenadores disponibles" value={`${availableCoaches}/${data.coaches.length}`} icon={<Trophy />} sub={data.coachCount ? 'Ya tienes entrenador' : 'Aún no tienes entrenador'} />
      </div>

      {!data.marketOpen && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-400/50 bg-[#23272c]/85 px-4 py-3 text-sm text-amber-200">
          <Lock aria-hidden className="size-5 shrink-0" /> El mercado está cerrado temporalmente por la administración.
        </div>
      )}

      <section aria-labelledby="mk-players">
        <h2 id="mk-players" className="mb-3 font-display text-2xl font-bold uppercase text-white">Jugadores de hoy</h2>
        {data.players.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.players.map((l) => (
              <li key={l.id}>
                <ListingCard listing={l} marketOpen={data.marketOpen} busy={buy.isPending && buy.variables?.id === l.id} onBuy={() => setConfirm(l)} />
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <EmptyState title="Sin jugadores hoy" description="No quedan jugadores libres que cumplan las condiciones del mercado." />
          </Card>
        )}
      </section>

      <section aria-labelledby="mk-coaches">
        <h2 id="mk-coaches" className="mb-3 font-display text-2xl font-bold uppercase text-white">Entrenadores</h2>
        {data.coaches.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.coaches.map((l) => (
              <li key={l.id}>
                <ListingCard listing={l} marketOpen={data.marketOpen} busy={buy.isPending && buy.variables?.id === l.id} onBuy={() => setConfirm(l)} />
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <EmptyState title="Sin entrenadores hoy" description="Mañana llegan nuevos entrenadores al mercado." />
          </Card>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs text-white/60">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        El precio de cada anuncio se fija al generar el mercado y no cambia durante el día. Los valores se actualizan tras cada jornada según el rendimiento real.
      </p>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirmar fichaje"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button
              icon={<ShoppingCart className="size-4" />}
              loading={buy.isPending}
              onClick={() =>
                confirm &&
                buy.mutate({ id: confirm.id, name: confirm.player?.displayName ?? confirm.coach?.displayName ?? '' }, { onSettled: () => setConfirm(null) })
              }
            >
              Fichar por {confirm ? moneyK(confirm.listingPrice) : ''}
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-300">
              Vas a fichar a <strong className="text-white">{confirm.player?.displayName ?? confirm.coach?.displayName}</strong>. En cuanto se confirme, nadie más de la liga podrá comprarlo.
            </p>
            <dl className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.05] p-3">
              <dt className="text-slate-400">Precio</dt>
              <dd className="text-right font-semibold text-white">{moneyFull(confirm.listingPrice)}</dd>
              <dt className="text-slate-400">Presupuesto actual</dt>
              <dd className="text-right text-white">{moneyFull(data.wallet)}</dd>
              <dt className="text-slate-400">Después del fichaje</dt>
              <dd className="text-right font-semibold text-pitch-300">{moneyFull(data.wallet - confirm.listingPrice)}</dd>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ListingCard({ listing: l, marketOpen, busy, onBuy }: { listing: MarketListing; marketOpen: boolean; busy: boolean; onBuy: () => void }) {
  const chip = STATUS_CHIP[l.status];
  const sold = l.status === 'SOLD';
  const p = l.player;
  const c = l.coach;
  return (
    <article className={clsx('card flex h-full flex-col gap-3 p-4 transition', sold ? 'opacity-70' : 'hover:border-white/25')} aria-label={p?.displayName ?? c?.displayName}>
      <div className="flex items-start gap-3">
        {p ? <PlayerPhoto player={p} size={60} rounded="rounded-xl" /> : <CoachPhoto url={c?.photoUrl ?? null} name={c?.displayName ?? ''} size={60} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <RarityBadge rarity={l.rarity} />
            <span className={clsx('rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset', chip.cls)}>{chip.label}</span>
          </div>
          {p ? (
            <Link to={`/players/${p.id}`} className="mt-1 block truncate text-base font-bold text-white hover:text-pitch-300">{p.displayName}</Link>
          ) : (
            <p className="mt-1 truncate text-base font-bold text-white">{c?.displayName}</p>
          )}
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-300">
            {p && <PositionBadge position={p.position} />}
            {!p && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase">Entrenador</span>}
            {(p?.club ?? c?.club) && <ClubCrest club={p?.club ?? c!.club!} size={14} />}
            <span className="truncate">{p?.club.name ?? c?.club?.name}</span>
          </p>
        </div>
      </div>

      {p && (
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-center">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Última</dt>
            <dd className="font-bold tabular-nums text-white">{p.stats.lastPoints} pts</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Forma</dt>
            <dd className="font-bold tabular-nums text-white">{p.stats.form}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Tendencia</dt>
            <dd><ValueTrendBadge trend={l.trend} /></dd>
          </div>
        </dl>
      )}
      {p && p.status !== 'AVAILABLE' && (
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <StatusBadge status={p.status} chance={p.chanceOfPlaying} compact /> <span className="truncate">{p.news ?? POSITION_LABEL[p.position]}</span>
        </div>
      )}

      <div className="mt-auto flex items-end justify-between gap-3 pt-1">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Precio</p>
          <p className="text-xl font-extrabold tabular-nums text-white">{moneyK(l.listingPrice)}</p>
        </div>
        {sold ? (
          <p className="text-right text-xs text-slate-300">
            {l.boughtByMe ? <span className="font-semibold text-pitch-300">¡Es tuyo!</span> : <>Comprado por <span className="font-semibold text-white">{l.buyer?.teamName ?? 'otro mánager'}</span></>}
          </p>
        ) : (
          <Button size="sm" disabled={!l.canBuy || !marketOpen} loading={busy} onClick={onBuy} icon={<ShoppingCart className="size-3.5" />}>
            Fichar
          </Button>
        )}
      </div>
      {!sold && l.blockReason && <p className="-mt-1 text-right text-[11px] text-amber-200/90">{l.blockReason}</p>}
    </article>
  );
}

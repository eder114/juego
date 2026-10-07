import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Crown, Gavel, History, Info, Lock, Trophy, Users, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import { dateTime, moneyFull, moneyK, POSITION_LABEL, timeOnly } from '../lib/format';
import type { AuctionBidHistory, LeagueMarket as LeagueMarketData, MarketListing, MarketPulse } from '../types';
import { useLeagueEconomy } from '../hooks/useLeagueEconomy';
import { useEconomyTerms } from '../hooks/usePublicConfig';
import { useLeague } from '../context/LeagueContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, StatCard } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, StatusBadge } from '../components/sport';
import { CoachPhoto, RarityBadge, useServerCountdown, ValueTrendBadge } from '../components/economy';

/** Estado visible de cada subasta. */
const AUCTION_CHIP = {
  LEADING: { label: 'Vas ganando', cls: 'bg-pitch-500/15 text-pitch-300 ring-pitch-500/35' },
  OUTBID: { label: 'Oferta superada', cls: 'bg-amber-500/15 text-amber-200 ring-amber-400/40' },
  OPEN: { label: 'Subasta activa', cls: 'bg-sky-500/15 text-sky-200 ring-sky-400/35' },
  NO_BIDS: { label: 'Sin ofertas', cls: 'bg-white/10 text-white/70 ring-white/20' },
  SOLD: { label: 'Subasta finalizada', cls: 'bg-violet-500/15 text-violet-200 ring-violet-400/35' },
  UNSOLD: { label: 'Desierta', cls: 'bg-white/10 text-white/60 ring-white/20' },
  UNAVAILABLE: { label: 'No disponible', cls: 'bg-white/10 text-white/60 ring-white/20' },
} as const;

type ChipKey = keyof typeof AUCTION_CHIP;

function chipFor(l: MarketListing): ChipKey {
  if (l.status === 'SOLD') return 'SOLD';
  if (l.status === 'UNSOLD') return 'UNSOLD';
  if (l.status === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (l.leading) return 'LEADING';
  if (l.outbid) return 'OUTBID';
  return l.topBid === null ? 'NO_BIDS' : 'OPEN';
}

/**
 * Mercado de subastas de la liga: todos sus mánagers pujan por los mismos jugadores y todas las subastas
 * cierran a la vez con el ciclo. El estado de las pujas se refresca solo cada pocos segundos (`pulse`),
 * y el contador usa siempre la hora del servidor.
 */
export default function LeagueMarket() {
  const qc = useQueryClient();
  const toast = useToast();
  const { activeLeagueId, withLeague } = useLeague();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['league-market', activeLeagueId],
    queryFn: () => api.get<LeagueMarketData>(withLeague('/market/league')),
    refetchInterval: (q) => (q.state.data?.mode === 'LEAGUE' ? q.state.data.pollSeconds * 1000 : false),
  });
  const league = data?.mode === 'LEAGUE' ? data : null;

  // Latido de las subastas: mucho más ligero que la vista completa, así las pujas ajenas aparecen solas
  const pulse = useQuery({
    queryKey: ['market-pulse', activeLeagueId],
    queryFn: () => api.get<MarketPulse>(withLeague('/market/league/pulse')),
    refetchInterval: 5000,
    // Una subasta avanza aunque la pestaña no tenga el foco: la petición es mínima y evita ver precios viejos
    refetchIntervalInBackground: true,
    enabled: !!league,
  });

  const { bid, join } = useLeagueEconomy();
  const terms = useEconomyTerms();
  const [bidFor, setBidFor] = useState<MarketListing | null>(null);
  const [historyFor, setHistoryFor] = useState<MarketListing | null>(null);

  // Las subastas de la vista, actualizadas con el último latido
  const live = useMemo(() => {
    const byId = new Map((pulse.data?.auctions ?? []).map((a) => [a.id, a]));
    const merge = (l: MarketListing): MarketListing => {
      const a = byId.get(l.id);
      if (!a) return l;
      return {
        ...l,
        status: l.status === 'UNAVAILABLE' ? l.status : a.status,
        topBid: a.topBid,
        myBid: a.myBid,
        leading: a.status === 'OPEN' && a.leading,
        outbid: a.status === 'OPEN' && a.myBid !== null && !a.leading,
        bidCount: a.bidCount,
        bidderCount: a.bidderCount,
        minNextBid: a.minNextBid,
        finalPrice: a.finalPrice,
        wonByMe: a.wonByMe,
      };
    };
    return { players: (league?.players ?? []).map(merge), coaches: (league?.coaches ?? []).map(merge) };
  }, [league, pulse.data]);

  const available = pulse.data?.available ?? league?.available ?? 0;
  const reserved = pulse.data?.reserved ?? league?.reserved ?? 0;

  // Aviso en cuanto otro mánager supera una de tus pujas
  const outbidSeen = useRef<Set<number>>(new Set());
  useEffect(() => {
    const all = [...live.players, ...live.coaches];
    for (const l of all) {
      if (l.outbid && !outbidSeen.current.has(l.id)) {
        outbidSeen.current.add(l.id);
        toast.push('info', `Te han superado la puja por ${l.player?.displayName ?? l.coach?.displayName}: ahora va por ${moneyK(l.topBid ?? 0)}`);
      }
      if (!l.outbid) outbidSeen.current.delete(l.id);
    }
  }, [live, toast]);

  const countdown = useServerCountdown(league?.cycle.endsAt, pulse.data?.serverTime ?? league?.serverTime);
  // Al cerrar el mercado el servidor liquida las subastas y genera el siguiente: se pide el estado nuevo
  useEffect(() => {
    if (!countdown.done) return;
    const id = window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['league-market'] });
      void qc.invalidateQueries({ queryKey: ['market-pulse'] });
      void qc.invalidateQueries({ queryKey: ['team'] });
    }, 2500);
    return () => window.clearTimeout(id);
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
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
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
            description="Invita a tus amigos: cada día saldrán a subasta los mismos jugadores para todos y gana quien más ofrezca al cerrar el mercado."
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
  const openPlayers = live.players.filter((p) => p.status === 'OPEN').length;
  const openCoaches = live.coaches.filter((c) => c.status === 'OPEN').length;
  const leadingCount = [...live.players, ...live.coaches].filter((l) => l.leading).length;
  const outbidCount = [...live.players, ...live.coaches].filter((l) => l.outbid).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={`Liga · ${data.league.name}`}
        title="Subastas del mercado"
        subtitle={`Los ${data.league.participants} mánagers de la liga pujan por los mismos jugadores. Todas las subastas cierran a la vez y se lleva el jugador quien más ofrezca.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="El mercado termina en"
          value={<span className="font-mono tabular-nums">{countdown.label}</span>}
          icon={<Clock />}
          sub={`Cierra a las ${data.league.resetTime} (${data.league.timezone.replace('_', ' ')})`}
        />
        <StatCard label="Disponible para pujar" value={moneyK(available)} icon={<Wallet />} sub={reserved ? `${moneyK(reserved)} comprometidos en pujas` : 'Sin dinero comprometido'} accent />
        <StatCard label="Subastas abiertas" value={`${openPlayers + openCoaches}/${live.players.length + live.coaches.length}`} icon={<Gavel />} sub={`Tu plantilla: ${data.squadCount}/${data.limits.maxSquad}`} />
        <StatCard
          label="Vas ganando"
          value={`${leadingCount}`}
          icon={<Crown />}
          sub={outbidCount ? `${outbidCount} puja${outbidCount === 1 ? '' : 's'} superada${outbidCount === 1 ? '' : 's'}` : 'Ninguna puja superada'}
        />
      </div>

      {outbidCount > 0 && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-400/50 bg-[#23272c]/85 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle aria-hidden className="size-5 shrink-0" />
          Te han superado en {outbidCount} subasta{outbidCount === 1 ? '' : 's'}. Tu dinero ya está libre: puedes volver a pujar antes del cierre.
        </div>
      )}

      {!data.marketOpen && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-400/50 bg-[#23272c]/85 px-4 py-3 text-sm text-amber-200">
          <Lock aria-hidden className="size-5 shrink-0" /> El mercado está cerrado temporalmente por la administración.
        </div>
      )}

      <section aria-labelledby="mk-players">
        <h2 id="mk-players" className="mb-3 font-display text-2xl font-bold uppercase text-white">Jugadores en subasta</h2>
        {live.players.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {live.players.map((l) => (
              <li key={l.id}>
                <AuctionCard listing={l} countdown={countdown.label} onBid={() => setBidFor(l)} onHistory={() => setHistoryFor(l)} />
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
        <h2 id="mk-coaches" className="mb-3 font-display text-2xl font-bold uppercase text-white">Entrenadores en subasta</h2>
        {live.coaches.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {live.coaches.map((l) => (
              <li key={l.id}>
                <AuctionCard listing={l} countdown={countdown.label} onBid={() => setBidFor(l)} onHistory={() => setHistoryFor(l)} />
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <EmptyState title="Sin entrenadores hoy" description="Mañana saldrán a subasta nuevos entrenadores." />
          </Card>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs text-white/60">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        El precio de salida se fija con el valor del jugador, pero el precio final lo decide la puja más alta al cerrar el mercado. El dinero de tu puja
        queda retenido mientras vas ganando y vuelve a tu presupuesto en cuanto alguien te supera.
      </p>

      <BidModal listing={bidFor} available={available} minIncrement={data.minIncrement} closesIn={countdown.label} onClose={() => setBidFor(null)} bid={bid} />
      <HistoryModal listing={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function AuctionCard({ listing: l, countdown, onBid, onHistory }: { listing: MarketListing; countdown: string; onBid: () => void; onHistory: () => void }) {
  const key = chipFor(l);
  const chip = AUCTION_CHIP[key];
  const closed = l.status === 'SOLD' || l.status === 'UNSOLD';
  const p = l.player;
  const c = l.coach;
  return (
    <article
      className={clsx(
        'card flex h-full flex-col gap-3 p-4 transition',
        closed && 'opacity-80',
        l.leading && 'border-pitch-500/45 shadow-[0_0_24px_-12px_rgb(3_255_136/0.8)]',
        l.outbid && 'border-amber-400/45',
        !closed && !l.leading && !l.outbid && 'hover:border-white/25',
      )}
      aria-label={p?.displayName ?? c?.displayName}
    >
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

      {/* Precios de la subasta: salida, puja actual y la tuya */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-white/[0.04] px-3 py-2">
        <dt className="text-[10px] uppercase tracking-wide text-slate-400">{closed ? 'Precio final' : l.topBid !== null ? 'Oferta actual' : 'Precio de salida'}</dt>
        <dd className="text-right text-lg font-extrabold tabular-nums text-white">
          {closed ? (l.finalPrice !== null ? moneyK(l.finalPrice) : '—') : l.topBid !== null ? moneyK(l.topBid) : moneyK(l.startingPrice)}
        </dd>
        <dt className="text-[10px] uppercase tracking-wide text-slate-400">Tu oferta</dt>
        <dd className={clsx('text-right text-sm font-bold tabular-nums', l.leading ? 'text-pitch-300' : l.outbid ? 'text-amber-200' : 'text-white/60')}>
          {l.myBid !== null ? moneyK(l.myBid) : 'Sin pujar'}
        </dd>
        <dt className="text-[10px] uppercase tracking-wide text-slate-400">Pujas</dt>
        <dd className="text-right text-xs text-slate-300">
          {l.bidCount ? `${l.bidCount} de ${l.bidderCount} mánager${l.bidderCount === 1 ? '' : 's'}` : `Ninguna · salida ${moneyK(l.startingPrice)}`}
        </dd>
      </dl>

      {l.outbid && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" /> Oferta superada por {l.topBidder?.teamName ?? 'otro mánager'}
        </p>
      )}
      {l.leading && !closed && <p className="text-xs font-semibold text-pitch-300">Vas ganando esta subasta</p>}

      {!closed && (
        <p className="text-[11px] text-slate-400">
          El mercado termina en <span className="font-mono tabular-nums text-white/80">{countdown}</span>
        </p>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <button type="button" onClick={onHistory} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white">
          <History aria-hidden className="size-3.5" /> Historial
        </button>
        {closed ? (
          <p className="text-right text-xs text-slate-300">
            {l.status === 'UNSOLD' ? (
              'Nadie pujó: vuelve a salir otro día'
            ) : l.wonByMe ? (
              <span className="font-semibold text-pitch-300">¡La has ganado!</span>
            ) : (
              <>Ganada por <span className="font-semibold text-white">{l.winner?.teamName ?? 'otro mánager'}</span></>
            )}
          </p>
        ) : (
          <Button size="sm" disabled={!l.canBid} onClick={onBid} icon={<Gavel className="size-3.5" />}>
            {l.leading ? 'Subir oferta' : l.myBid !== null ? 'Aumentar oferta' : 'Pujar'}
          </Button>
        )}
      </div>
      {!closed && l.blockReason && <p className="-mt-1 text-right text-[11px] text-amber-200/90">{l.blockReason}</p>}
    </article>
  );
}

/**
 * Modal de puja. Valida en el navegador para ayudar, pero la decisión real siempre es del servidor:
 * si otro mánager puja a la vez, la respuesta lo dice y el mercado se actualiza.
 */
function BidModal({
  listing: l,
  available,
  minIncrement,
  closesIn,
  onClose,
  bid,
}: {
  listing: MarketListing | null;
  available: number;
  minIncrement: number;
  closesIn: string;
  onClose: () => void;
  bid: ReturnType<typeof useLeagueEconomy>['bid'];
}) {
  const [value, setValue] = useState('');
  const minimum = l?.minNextBid ?? 0;
  // Lo que ya tienes retenido en esta subasta cuenta: solo se te pide la diferencia
  const held = l?.leading ? (l.myBid ?? 0) : 0;
  const max = available + held;
  // Se redondea hacia arriba: una cantidad por debajo del mínimo nunca sería válida
  const toMillions = (k: number) => Math.ceil(k / 100) / 10;
  useEffect(() => {
    if (l) setValue(String(toMillions(minimum)));
  }, [l, minimum]);

  const amount = Math.round(Number(value.replace(',', '.')) * 1000);
  const valid = Number.isFinite(amount) && amount >= minimum && amount <= max;
  const error = !value
    ? null
    : !Number.isFinite(amount)
      ? 'Escribe una cantidad en millones, por ejemplo 12,5'
      : amount < minimum
        ? `La puja mínima es ${moneyK(minimum)}`
        : amount > max
          ? `Solo puedes comprometer ${moneyK(max)}`
          : null;

  return (
    <Modal
      open={!!l}
      onClose={onClose}
      title="Hacer una oferta"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            icon={<Gavel className="size-4" />}
            loading={bid.isPending}
            disabled={!valid}
            onClick={() =>
              l && valid && bid.mutate({ id: l.id, name: l.player?.displayName ?? l.coach?.displayName ?? '', amount }, { onSuccess: onClose })
            }
          >
            Ofertar {valid ? moneyK(amount) : ''}
          </Button>
        </>
      }
    >
      {l && (
        <div className="space-y-3 text-sm">
          <p className="text-lg font-bold text-white">{l.player?.displayName ?? l.coach?.displayName}</p>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.05] p-3">
            <dt className="text-slate-400">{l.topBid !== null ? 'Oferta actual' : 'Precio de salida'}</dt>
            <dd className="text-right font-semibold text-white">{moneyK(l.topBid ?? l.startingPrice)}</dd>
            <dt className="text-slate-400">Tu dinero disponible</dt>
            <dd className="text-right text-white">{moneyFull(max)}</dd>
            <dt className="text-slate-400">Oferta mínima</dt>
            <dd className="text-right font-semibold text-pitch-300">{moneyK(minimum)}</dd>
            {held > 0 && (
              <>
                <dt className="text-slate-400">Ya tienes retenido aquí</dt>
                <dd className="text-right text-white">{moneyK(held)}</dd>
              </>
            )}
          </dl>
          <label className="block">
            <span className="label mb-1 block text-slate-400">Tu oferta (en millones de £)</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">£</span>
              <Input
                autoFocus
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={!!error}
                className="flex-1 text-lg font-bold tabular-nums"
              />
              <span className="text-lg font-bold text-white">M</span>
            </div>
          </label>
          <div className="flex flex-wrap gap-2">
            {[0, minIncrement, minIncrement * 2, minIncrement * 10].map((extra, i) => {
              const quick = minimum + extra;
              if (quick > max) return null;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setValue(String(toMillions(quick)))}
                  className="rounded-lg border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.12] hover:text-white"
                >
                  {moneyK(quick)}
                </button>
              );
            })}
          </div>
          {error && <p className="text-xs text-amber-200">{error}</p>}
          <p className="text-xs text-slate-400">
            El dinero queda retenido mientras vayas ganando y se libera solo si alguien te supera. La subasta cierra con el mercado, dentro de{' '}
            <span className="font-mono tabular-nums text-white/80">{closesIn}</span>.
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Historial completo de una subasta: cada puja queda registrada y nunca se sobrescribe. */
function HistoryModal({ listing: l, onClose }: { listing: MarketListing | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['auction-bids', l?.id],
    queryFn: () => api.get<AuctionBidHistory>(`/market/league/listings/${l!.id}/bids`),
    enabled: !!l,
    refetchInterval: 8000,
  });
  return (
    <Modal open={!!l} onClose={onClose} title={`Historial · ${l?.player?.displayName ?? l?.coach?.displayName ?? ''}`}>
      {error ? (
        <ErrorState error={error} />
      ) : isLoading || !data ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : data.bids.length ? (
        <ol className="space-y-1.5">
          {data.bids.map((b) => (
            <li
              key={b.id}
              className={clsx(
                'flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1 ring-inset',
                b.status === 'ACTIVE' || b.status === 'WON' ? 'bg-pitch-500/10 ring-pitch-500/30' : 'bg-white/[0.04] ring-white/[0.08]',
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{b.teamName}</p>
                <p className="truncate text-xs text-slate-400" title={dateTime(b.createdAt)}>
                  {b.managerName} · {timeOnly(b.createdAt)}
                </p>
              </div>
              <p className="shrink-0 text-right font-bold tabular-nums text-white">{moneyK(b.amount)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon={<Users className="size-6" />} title="Todavía no hay pujas" description={`La subasta empieza en ${moneyK(data.listing.startingPrice)}.`} />
      )}
    </Modal>
  );
}

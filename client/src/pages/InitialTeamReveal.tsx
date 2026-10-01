import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Sparkles, Star, Users, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { moneyFull, moneyK, POSITION_LABEL } from '../lib/format';
import type { Player } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, ErrorState, LoadingBlock } from '../components/ui';
import { ClubCrest, PlayerPhoto, PositionBadge, TeamCrest } from '../components/sport';
import { RarityBadge } from '../components/economy';

interface RevealEntry {
  order: number;
  role: 'STARTER' | 'BENCH';
  player: Player;
}

interface RevealData {
  leagueId: number;
  league: { id: number; name: string } | null;
  status: 'NOT_ASSIGNED' | 'PENDING' | 'COMPLETED';
  formation: string | null;
  players: RevealEntry[];
  starters: number;
  bench: number;
  wallet: number;
  squadValue: number;
  team?: { id: number; name: string; crest: Record<string, string> };
}

/** Ritmo de la presentación (ms). */
const STEP_MS = 1700;
const BENCH_PAUSE_MS = 1400;

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Presentación del equipo inicial: revela uno a uno los jugadores que el backend ya asignó.
 * No asigna ni modifica nada; solo muestra el reparto real y, al terminar, lo marca como visto.
 */
export default function InitialTeamReveal() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user, refresh } = useAuth();
  const leagueId = user?.team?.economyLeague?.id ?? null;
  const [reduced] = useState(prefersReducedMotion);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['initial-team', leagueId],
    queryFn: () => api.get<RevealData>(`/leagues/${leagueId}/initial-team`),
    enabled: !!leagueId,
    retry: 1,
  });

  // Índice del jugador que se está revelando. Con movimiento reducido se muestran todos desde el principio.
  const [index, setIndex] = useState(0);
  const [benchBreak, setBenchBreak] = useState(false);
  const [finished, setFinished] = useState(false);
  // La transición «Suplentes» se muestra una sola vez: si no, al terminar su pausa volvería a dispararse
  const benchShown = useRef(false);
  // Su temporizador vive fuera del efecto: el re-render no debe cancelarlo
  const pause = useRef(0);
  const total = data?.players.length ?? 0;
  const startersCount = data?.starters ?? 0;

  const complete = useMutation({
    mutationFn: () => api.post(`/leagues/${leagueId}/initial-team/complete`),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['initial-team'] });
      await refresh();
      navigate('/team', { replace: true });
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  });

  const finish = useCallback(() => {
    window.clearTimeout(pause.current);
    setIndex(total);
    setBenchBreak(false);
    setFinished(true);
  }, [total]);

  // Reparto ya visto o inexistente: no se repite la presentación
  useEffect(() => {
    if (data?.status === 'COMPLETED') navigate('/team', { replace: true });
    if (data?.status === 'NOT_ASSIGNED') navigate('/leagues', { replace: true });
  }, [data?.status, navigate]);

  useEffect(() => {
    if (!data || data.status !== 'PENDING' || finished) return;
    if (reduced) {
      finish();
      return;
    }
    if (index >= total) {
      setFinished(true);
      return;
    }
    // Pequeña transición antes del primer suplente (solo la primera vez que se llega al banquillo)
    if (index === startersCount && startersCount > 0 && !benchShown.current) {
      benchShown.current = true;
      setBenchBreak(true);
      pause.current = window.setTimeout(() => setBenchBreak(false), BENCH_PAUSE_MS);
      return;
    }
    if (benchBreak) return;
    const step = window.setTimeout(() => setIndex((i) => i + 1), STEP_MS);
    return () => window.clearTimeout(step);
  }, [data, index, total, startersCount, benchBreak, finished, reduced, finish]);

  useEffect(() => () => window.clearTimeout(pause.current), []);

  // Un jugador muy por encima del resto del reparto merece una revelación destacada
  const standoutId = useMemo(() => {
    const values = (data?.players ?? []).map((p) => p.player.marketValue ?? 0).sort((a, b) => a - b);
    if (values.length < 3) return null;
    const median = values[Math.floor(values.length / 2)];
    const best = [...(data?.players ?? [])].sort((a, b) => (b.player.marketValue ?? 0) - (a.player.marketValue ?? 0))[0];
    return (best?.player.marketValue ?? 0) >= median * 1.6 ? best.player.id : null;
  }, [data]);

  if (!leagueId) {
    navigate('/leagues', { replace: true });
    return null;
  }
  // Nunca se deja al usuario en una espera infinita: sin datos y sin petición en curso se ofrece reintentar
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) {
    if (isLoading || isFetching) return <LoadingBlock label="Preparando tu equipo…" />;
    return <ErrorState error={new Error('No se pudo cargar tu equipo inicial. Tus jugadores ya están asignados: vuelve a intentarlo.')} onRetry={() => void refetch()} />;
  }
  if (data.status !== 'PENDING' && !finished) return <LoadingBlock />;

  const current = data.players[Math.min(index, total - 1)];
  const revealed = data.players.slice(0, Math.min(index + 1, total));
  const showingFinal = finished || index >= total;
  const benchIndex = Math.max(0, index - startersCount) + 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-4">
      <header className="text-center">
        <p className="label text-pitch-300">{data.league ? `Bienvenido a «${data.league.name}»` : 'Tu nueva partida'}</p>
        <h1 className="font-headline text-4xl uppercase leading-none text-white sm:text-6xl">
          {showingFinal ? '¡Tu equipo está listo!' : 'Este es tu equipo'}
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-300 sm:text-base">
          {showingFinal ? 'Ya tienes tu plantilla inicial. Ahora comienza tu temporada.' : 'Estos son los jugadores que fueron asignados a tu plantilla inicial.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="glass-card flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-white">
            <Users aria-hidden className="size-4 text-pitch-300" /> {total} jugadores
          </span>
          <span className="glass-card flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-white">
            <Wallet aria-hidden className="size-4 text-pitch-300" /> {moneyK(data.wallet)}
          </span>
          {data.formation && <span className="glass-card px-3 py-1.5 text-sm font-semibold text-white">{data.formation}</span>}
        </div>
      </header>

      {showingFinal ? (
        <FinalPanel data={data} onContinue={() => complete.mutate()} loading={complete.isPending} />
      ) : (
        <>
          <div aria-live="polite" className="space-y-2">
            <div className="flex items-center justify-between text-sm font-semibold text-slate-300">
              <span>
                {current?.role === 'BENCH' ? `Suplente ${benchIndex} de ${data.bench}` : `Jugador ${Math.min(index + 1, startersCount)} de ${startersCount}`}
              </span>
              <span className="tabular-nums text-white">
                {Math.min(index + 1, total)}/{total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[image:var(--gradient-cta)] transition-[width] duration-500" style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
          </div>

          <div className="relative min-h-[22rem] sm:min-h-[26rem]">
            {benchBreak ? (
              <div className="animate-rise-in flex min-h-[22rem] flex-col items-center justify-center gap-3 text-center sm:min-h-[26rem]">
                <Sparkles aria-hidden className="size-10 text-pitch-300" />
                <p className="font-headline text-5xl uppercase text-white">Suplentes</p>
                <p className="text-sm text-slate-300">Los {data.bench} jugadores que esperan su oportunidad en el banquillo.</p>
              </div>
            ) : (
              current && <RevealCard key={current.player.id} entry={current} standout={current.player.id === standoutId} />
            )}
          </div>

          <RevealedStrip entries={revealed} currentId={current?.player.id} />

          <div className="flex flex-col items-center gap-2">
            <Button variant="secondary" onClick={() => setIndex((i) => Math.min(total, i + 1))} className="sm:hidden">
              Siguiente jugador
            </Button>
            <button
              type="button"
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
              className="text-sm font-semibold text-slate-400 underline underline-offset-4 transition hover:text-white disabled:opacity-60"
            >
              Saltar presentación · los jugadores ya son tuyos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RevealCard({ entry, standout }: { entry: RevealEntry; standout: boolean }) {
  const p = entry.player;
  return (
    <article className={clsx('animate-card-reveal glass-card relative mx-auto max-w-md overflow-hidden p-5 text-center sm:p-7', standout && 'ring-2 ring-gold/70')}>
      {standout && <span aria-hidden className="animate-halo pointer-events-none absolute -inset-10 bg-[radial-gradient(circle,rgb(245_197_66/0.25),transparent_65%)]" />}
      <span aria-hidden className="animate-card-shine pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative">
        <div className="flex items-center justify-center gap-2">
          <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]', entry.role === 'STARTER' ? 'bg-pitch-500/20 text-pitch-200' : 'bg-white/10 text-slate-200')}>
            {entry.role === 'STARTER' ? 'Titular' : 'Suplente'}
          </span>
          <RarityBadge rarity={p.rarity} />
          {standout && (
            <span className="animate-badge-pop flex items-center gap-1 rounded-md bg-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-gold">
              <Star aria-hidden className="size-3" /> Joya del reparto
            </span>
          )}
        </div>
        <PlayerPhoto player={p} size={160} rounded="rounded-3xl" className="mx-auto mt-4" />
        <h2 className="mt-4 font-headline text-4xl uppercase leading-none text-white sm:text-5xl">{p.displayName}</h2>
        {(p.firstName || p.lastName) && (
          <p className="mt-1 text-sm text-slate-400">
            {p.firstName} {p.lastName}
          </p>
        )}
        <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-200">
          <PositionBadge position={p.position} />
          <span>{POSITION_LABEL[p.position]}</span>
          <span aria-hidden className="text-slate-600">·</span>
          <ClubCrest club={p.club} size={20} />
          <span>{p.club.name}</span>
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/[0.06] py-3">
            <dt className="label">Valor</dt>
            <dd className="stat-number mt-1 text-2xl text-pitch-300">{moneyK(p.marketValue)}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.06] py-3">
            <dt className="label">Puntos</dt>
            <dd className="stat-number mt-1 text-2xl">{p.stats.totalPoints}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

function RevealedStrip({ entries, currentId }: { entries: RevealEntry[]; currentId?: number }) {
  if (!entries.length) return null;
  return (
    <section aria-label="Jugadores asignados">
      <p className="label mb-2 text-center">Jugadores asignados</p>
      <ul className="flex flex-wrap justify-center gap-2">
        {entries.map((e) => (
          <li
            key={e.player.id}
            className={clsx('animate-rise-in flex w-[6.5rem] flex-col items-center gap-1 rounded-xl border p-2 text-center', e.player.id === currentId ? 'border-pitch-500/50 bg-pitch-500/10' : 'border-white/10 bg-white/[0.04]')}
          >
            <PlayerPhoto player={e.player} size={40} rounded="rounded-lg" />
            <span className="w-full truncate text-[11px] font-semibold text-white">{e.player.displayName}</span>
            <span className="text-[10px] text-slate-400">{moneyK(e.player.marketValue)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FinalPanel({ data, onContinue, loading }: { data: RevealData; onContinue: () => void; loading: boolean }) {
  return (
    <div className="animate-rise-in space-y-5">
      <div className="glass-card flex flex-col items-center gap-4 p-6 text-center">
        {data.team && <TeamCrest crest={data.team.crest} name={data.team.name} size={72} />}
        <dl className="grid w-full max-w-lg grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-white/[0.06] py-3">
            <dt className="label">Titulares</dt>
            <dd className="stat-number mt-1 text-2xl">{data.starters}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.06] py-3">
            <dt className="label">Suplentes</dt>
            <dd className="stat-number mt-1 text-2xl">{data.bench}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.06] py-3">
            <dt className="label">Presupuesto</dt>
            <dd className="stat-number mt-1 text-2xl text-pitch-300">{moneyK(data.wallet)}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.06] py-3">
            <dt className="label">Valor del equipo</dt>
            <dd className="stat-number mt-1 text-2xl">{moneyK(data.squadValue)}</dd>
          </div>
        </dl>
        <p className="text-sm text-slate-400">Presupuesto exacto: {moneyFull(data.wallet)}</p>
        <Button size="lg" loading={loading} onClick={onContinue} icon={<ArrowRight className="size-4" />}>
          Ver mi equipo
        </Button>
      </div>
      <RevealedStrip entries={data.players} />
    </div>
  );
}

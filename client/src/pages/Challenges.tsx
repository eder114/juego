import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Flame, Gift, Send, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { money, moneyFull, moneyIn, moneyK } from '../lib/format';
import type { LetterState, WordleState } from '../types';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, LoadingBlock, PageHeader } from '../components/ui';
import { useServerCountdown } from '../components/economy';
import { ClubCrest, PlayerPhoto, PositionBadge } from '../components/sport';

interface ChallengesData {
  wordle: WordleState;
  history: { date: string; type: string; attemptsUsed: number; completed: boolean; won: boolean; reward: { amount: number; currency: 'K' | 'TENTHS'; streakBonus: number; cardCode: string | null } | null }[];
}

const TILE: Record<LetterState | 'empty' | 'typing', string> = {
  correct: 'border-pitch-500 bg-pitch-600 text-white',
  present: 'border-amber-400 bg-amber-500 text-ink-950',
  absent: 'border-white/10 bg-white/[0.12] text-white/70',
  empty: 'border-white/15 bg-white/[0.03] text-white',
  typing: 'border-white/60 bg-white/[0.06] text-white',
};

/** Lo que se escribe: mayúsculas, sin tildes y solo letras (igual que normaliza el servidor). */
const clean = (raw: string) =>
  raw
    .normalize('NFC')
    .toUpperCase()
    .replace(/Ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0001/g, 'Ñ')
    .replace(/[^A-ZÑ]/g, '');

/**
 * Desafío diario: un Wordle clásico en el que la palabra a adivinar es el apellido de un futbolista real.
 * Como intento vale cualquier palabra de esa longitud. Todo el estado (intentos, fecha, victoria, premio,
 * racha) lo decide el servidor: el navegador solo muestra lo que recibe y envía lo que se escribe.
 */
export default function Challenges() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  // El premio se abona al equipo de la liga activa
  const { activeLeagueId, withLeague } = useLeague();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['challenges', activeLeagueId], queryFn: () => api.get<ChallengesData>(withLeague('/challenges')) });
  const [playing, setPlaying] = useState(false);
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const wordle = data?.wordle;
  const countdown = useServerCountdown(wordle?.nextResetAt, wordle?.serverTime);

  // Nuevo día según el servidor: se recarga el desafío
  useEffect(() => {
    if (countdown.done) void qc.invalidateQueries({ queryKey: ['challenges'] });
  }, [countdown.done, qc]);

  const guess = useMutation({
    mutationFn: (word: string) => api.post<WordleState>('/challenges/wordle/guess', { guess: word, league: activeLeagueId ?? undefined }),
    onSuccess: (state) => {
      qc.setQueryData<ChallengesData>(['challenges', activeLeagueId], (prev) => (prev ? { ...prev, wordle: state } : prev));
      setInput('');
      if (state.completed) {
        void qc.invalidateQueries({ queryKey: ['challenges'] });
        for (const key of ['dashboard', 'team', 'economy-tx', 'cards', 'league-market']) void qc.invalidateQueries({ queryKey: [key] });
        void refresh();
        if (state.won) toast.push('success', `¡Acertaste en ${state.attemptsUsed} intento${state.attemptsUsed === 1 ? '' : 's'}!`);
      }
    },
    onError: (e) => {
      // Un nombre que no es de un jugador no gasta intento: el servidor lo rechaza antes de registrarlo
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      toast.push('error', errorMessage(e));
      field.current?.focus();
    },
  });

  const canType = !!wordle && playing && !wordle.completed && !guess.isPending && wordle.enabled;

  // Al empezar (o tras cada intento) el cursor vuelve al campo para seguir escribiendo
  useEffect(() => {
    if (canType) field.current?.focus();
  }, [canType, wordle?.attemptsUsed]);

  const send = () => {
    if (!wordle || !canType) return;
    if (input.length !== wordle.wordLength) {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      return;
    }
    guess.mutate(input);
  };

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data || !wordle) return <LoadingBlock />;
  const fmt = (k: number) => (wordle.rewardCurrency === 'K' ? moneyFull(k) : money(Math.floor(k / 100)));
  const best = Math.max(...wordle.rewards);
  const showBoard = playing || wordle.attemptsUsed > 0 || wordle.completed;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cada día" title="Desafíos diarios" subtitle="Una oportunidad al día para ganar dinero extra para tu equipo. El desafío se reinicia a medianoche (hora del servidor)." />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
            <div>
              <p className="label">Desafío de hoy</p>
              <h2 className="font-headline text-3xl uppercase tracking-wide text-white">Wordle</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="gold"><Flame className="size-3.5" /> Racha: {wordle.streak.current} {wordle.streak.current === 1 ? 'día' : 'días'}</Badge>
              <Badge tone="green"><Gift className="size-3.5" /> Hasta {fmt(best)}</Badge>
              <Badge tone="slate">Intentos: {wordle.maxAttempts}</Badge>
            </div>
          </div>

          <div className="p-5">
            {!wordle.enabled ? (
              <EmptyState title="Desafío en pausa" description="La administración ha desactivado el Wordle temporalmente." />
            ) : wordle.completed ? (
              <CompletedPanel wordle={wordle} countdown={countdown.label} fmt={fmt} />
            ) : !showBoard ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <p className="max-w-md text-sm text-slate-300">
                  Adivina el futbolista del día en {wordle.maxAttempts} intentos. Escribe cualquier palabra de {wordle.wordLength} letras: verde, letra en su
                  sitio · amarillo, está en otra posición · gris, no está. Todos los mánagers juegan el mismo jugador.
                </p>
                {!wordle.hasTeam && <p className="text-sm text-amber-200">Crea tu equipo para cobrar el premio.</p>}
                <Button size="lg" onClick={() => setPlaying(true)}>Jugar</Button>
              </div>
            ) : null}

            {showBoard && (
              <div className="mx-auto mt-2 flex max-w-sm flex-col items-center gap-5">
                <Board wordle={wordle} input={wordle.completed ? '' : input} shake={shake} />
                {!wordle.completed && (
                  <>
                    <p className="text-xs text-slate-400" aria-live="polite">
                      Intentos restantes: <b className="text-white">{wordle.maxAttempts - wordle.attemptsUsed}</b> · premio si aciertas ahora: <b className="text-pitch-300">{fmt(wordle.rewards[Math.min(wordle.attemptsUsed, wordle.rewards.length - 1)] ?? 0)}</b>
                    </p>
                    {!playing && <Button onClick={() => setPlaying(true)}>Continuar</Button>}
                    {playing && (
                      <form
                        className="flex w-full flex-col items-stretch gap-2 sm:flex-row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          send();
                        }}
                      >
                        <Input
                          ref={field}
                          value={input}
                          onChange={(e) => setInput(clean(e.target.value).slice(0, wordle.wordLength))}
                          disabled={!canType}
                          placeholder="Escribe una palabra..."
                          aria-label={`Escribe una palabra de ${wordle.wordLength} letras`}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          enterKeyHint="send"
                          className="flex-1 text-center font-headline text-xl uppercase tracking-[0.2em]"
                        />
                        <Button type="submit" loading={guess.isPending} disabled={!canType || input.length !== wordle.wordLength} icon={<Send className="size-4" />}>
                          Intentar
                        </Button>
                      </form>
                    )}
                    {playing && <p className="-mt-2 text-center text-xs text-slate-500">Vale cualquier palabra de {wordle.wordLength} letras; la solución es el apellido de un futbolista.</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Premios" icon={<Trophy className="size-5" />} />
            <ul className="divide-y divide-white/[0.05] text-sm">
              {wordle.rewards.map((r, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2">
                  <span className="text-slate-300">{i + 1}.º intento</span>
                  <span className="font-semibold tabular-nums text-white">{fmt(r)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between px-4 py-2">
                <span className="text-slate-300">No acierta</span>
                <span className="font-semibold tabular-nums text-white/60">£0</span>
              </li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Racha" subtitle={wordle.streak.requiresWin ? 'Cuenta los días que aciertas' : 'Cuenta los días que juegas'} icon={<Flame className="size-5" />} />
            <div className="px-4 pb-2 pt-3 text-sm text-slate-300">
              Actual: <b className="text-white">{wordle.streak.current}</b> · Mejor: <b className="text-white">{wordle.streak.best}</b>
            </div>
            <ul className="divide-y divide-white/[0.05] text-sm">
              {wordle.milestones.map((m) => (
                <li key={m.days} className={clsx('flex items-center justify-between gap-2 px-4 py-2', wordle.streak.current >= m.days && 'text-pitch-300')}>
                  <span>{m.days} días</span>
                  <span className="text-right font-semibold">
                    {m.money > 0 && fmt(m.money)}
                    {m.money > 0 && m.card && ' + '}
                    {m.card && <Link to="/cards" className="underline decoration-white/30 underline-offset-2">carta</Link>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="px-4 pb-3 pt-2 text-xs text-slate-500">Si te saltas un día, la racha vuelve a empezar.</p>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Tus últimos desafíos" icon={<CalendarCheck className="size-5" />} />
        {data.history.length ? (
          <ul className="divide-y divide-white/[0.05]">
            {data.history.map((h) => (
              <li key={h.date + h.type} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-slate-300">{new Date(`${h.date}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className={clsx('font-semibold', h.won ? 'text-pitch-300' : h.completed ? 'text-red-300' : 'text-slate-400')}>
                  {h.won ? `Acertado en ${h.attemptsUsed}` : h.completed ? 'No acertado' : `En curso (${h.attemptsUsed})`}
                </span>
                <span className="w-28 text-right tabular-nums text-white">{h.reward ? moneyIn(h.reward.amount + h.reward.streakBonus, h.reward.currency) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Aún no has jugado ningún desafío" />
        )}
      </Card>
    </div>
  );
}

function Board({ wordle, input, shake }: { wordle: WordleState; input: string; shake: boolean }) {
  const rows = Array.from({ length: wordle.maxAttempts }, (_, r) => {
    const g = wordle.guesses[r];
    if (g) return { letters: [...g.word], states: g.result as (LetterState | 'empty' | 'typing')[], done: true };
    if (r === wordle.guesses.length && !wordle.completed)
      return { letters: [...input.padEnd(wordle.wordLength, ' ')], states: [...input.padEnd(wordle.wordLength, ' ')].map((c) => (c === ' ' ? 'empty' : 'typing')) as ('empty' | 'typing')[], done: false, current: true };
    return { letters: Array(wordle.wordLength).fill(' '), states: Array(wordle.wordLength).fill('empty') as 'empty'[], done: false };
  });
  return (
    <div className="grid w-full gap-1.5" role="grid" aria-label="Tablero del Wordle">
      {rows.map((row, r) => (
        <div key={r} role="row" className={clsx('grid gap-1.5', 'current' in row && row.current && shake && 'animate-shake')} style={{ gridTemplateColumns: `repeat(${wordle.wordLength}, minmax(0, 1fr))` }}>
          {row.letters.map((ch, i) => (
            <div
              key={i}
              role="gridcell"
              aria-label={ch.trim() ? `${ch} ${row.done ? { correct: 'correcta', present: 'en otra posición', absent: 'no está' }[row.states[i] as LetterState] : ''}` : 'vacía'}
              className={clsx('grid aspect-square place-items-center rounded-lg border-2 font-headline text-2xl uppercase sm:text-3xl', TILE[row.states[i]], row.done && 'animate-flip')}
              style={row.done ? { animationDelay: `${i * 90}ms` } : undefined}
            >
              {ch.trim()}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CompletedPanel({ wordle, countdown, fmt }: { wordle: WordleState; countdown: string; fmt: (k: number) => string }) {
  const reward = wordle.reward;
  return (
    <div className="mb-6 flex flex-col items-center gap-2 text-center">
      <p className="label text-pitch-300">Desafío completado</p>
      <p className="font-headline text-4xl uppercase text-white">{wordle.won ? '¡Acertaste!' : 'No lo acertaste'}</p>
      {wordle.answer && (
        <p className="text-sm text-slate-300">
          El jugador era <b className="text-white">{wordle.answer}</b>
        </p>
      )}
      {wordle.player && (
        <Link
          to={`/players/${wordle.player.id}`}
          className="mt-1 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-left transition hover:border-white/20"
        >
          <PlayerPhoto player={{ photoUrl: wordle.player.photoUrl, displayName: wordle.player.displayName }} size={44} rounded="rounded-xl" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-white">{wordle.player.displayName}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <PositionBadge position={wordle.player.position} />
              {wordle.player.club?.crestUrl && <ClubCrest club={wordle.player.club} size={14} />}
              <span className="truncate">{wordle.player.club?.name}</span>
            </span>
          </span>
        </Link>
      )}
      <p className="mt-2 text-sm text-slate-300">
        Premio obtenido: <b className="text-lg text-pitch-300">{reward ? (reward.currency === 'K' ? moneyFull(reward.amount) : money(reward.amount)) : '£0'}</b>
        {reward && reward.streakBonus > 0 && <> + bonus de racha {reward.currency === 'K' ? moneyK(reward.streakBonus) : money(reward.streakBonus)}</>}
      </p>
      {reward?.cardCode && (
        <Link to="/cards" className="text-sm font-semibold text-pitch-300 underline underline-offset-4">¡Has ganado una carta! Ver mis cartas</Link>
      )}
      <p className="mt-2 text-sm text-slate-400">
        Próximo desafío en <span className="font-mono font-bold text-white">{countdown}</span>
      </p>
      {!reward && wordle.won && <p className="text-xs text-slate-500">Sin equipo no se pudo abonar premio. Hasta {fmt(Math.max(...wordle.rewards))} al día.</p>}
    </div>
  );
}

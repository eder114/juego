import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Delete, Flame, Gift, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage } from '../lib/api';
import { money, moneyFull, moneyIn, moneyK } from '../lib/format';
import type { LetterState, WordleState } from '../types';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { useServerCountdown } from '../components/economy';

interface ChallengesData {
  wordle: WordleState;
  history: { date: string; type: string; attemptsUsed: number; completed: boolean; won: boolean; reward: { amount: number; currency: 'K' | 'TENTHS'; streakBonus: number; cardCode: string | null } | null }[];
}

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM'];
const TILE: Record<LetterState | 'empty' | 'typing', string> = {
  correct: 'border-pitch-500 bg-pitch-600 text-white',
  present: 'border-amber-400 bg-amber-500 text-ink-950',
  absent: 'border-white/10 bg-white/[0.12] text-white/70',
  empty: 'border-white/15 bg-white/[0.03] text-white',
  typing: 'border-white/60 bg-white/[0.06] text-white',
};
const KEY: Record<LetterState | 'idle', string> = {
  correct: 'bg-pitch-600 text-white',
  present: 'bg-amber-500 text-ink-950',
  absent: 'bg-white/[0.06] text-white/35',
  idle: 'bg-white/[0.14] text-white hover:bg-white/[0.22]',
};
const RANK: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 };

/**
 * Desafíos diarios. Todo el estado (intentos, fecha, victoria, premio, racha) lo decide el servidor:
 * el navegador solo muestra lo que recibe y envía la palabra escrita.
 */
export default function Challenges() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['challenges'], queryFn: () => api.get<ChallengesData>('/challenges') });
  const [playing, setPlaying] = useState(false);
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const wordle = data?.wordle;
  const countdown = useServerCountdown(wordle?.nextResetAt, wordle?.serverTime);

  // Nuevo día según el servidor: se recarga el desafío
  useEffect(() => {
    if (countdown.done) void qc.invalidateQueries({ queryKey: ['challenges'] });
  }, [countdown.done, qc]);

  const guess = useMutation({
    mutationFn: (word: string) => api.post<WordleState>('/challenges/wordle/guess', { guess: word }),
    onSuccess: (state) => {
      qc.setQueryData<ChallengesData>(['challenges'], (prev) => (prev ? { ...prev, wordle: state } : prev));
      setInput('');
      if (state.completed) {
        void qc.invalidateQueries({ queryKey: ['challenges'] });
        for (const key of ['dashboard', 'team', 'economy-tx', 'cards', 'league-market']) void qc.invalidateQueries({ queryKey: [key] });
        void refresh();
        if (state.won) toast.push('success', `¡Acertaste en ${state.attemptsUsed} intento${state.attemptsUsed === 1 ? '' : 's'}!`);
      }
    },
    onError: (e) => {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      toast.push('error', errorMessage(e));
      void qc.invalidateQueries({ queryKey: ['challenges'] });
    },
  });

  const canType = !!wordle && playing && !wordle.completed && !guess.isPending && wordle.enabled;
  const press = useCallback(
    (key: string) => {
      if (!wordle || !canType) return;
      if (key === 'ENTER') {
        if (input.length !== wordle.wordLength) {
          setShake(true);
          window.setTimeout(() => setShake(false), 450);
          return;
        }
        guess.mutate(input);
      } else if (key === 'BACKSPACE') setInput((v) => v.slice(0, -1));
      else if (/^[A-ZÑ]$/.test(key)) setInput((v) => (v.length < wordle.wordLength ? v + key : v));
    },
    [wordle, canType, input, guess],
  );

  useEffect(() => {
    if (!canType) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (k === 'ENTER' || k === 'BACKSPACE' || /^[A-ZÑ]$/.test(k)) {
        e.preventDefault();
        press(k);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canType, press]);

  const keyStates = useMemo(() => {
    const map = new Map<string, LetterState>();
    for (const g of wordle?.guesses ?? [])
      [...g.word].forEach((ch, i) => {
        const prev = map.get(ch);
        if (!prev || RANK[g.result[i]] > RANK[prev]) map.set(ch, g.result[i]);
      });
    return map;
  }, [wordle?.guesses]);

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
                  Adivina la palabra futbolística del día en {wordle.maxAttempts} intentos. Verde: letra en su sitio · Amarillo: está en otra posición · Gris: no está. Todos los mánagers juegan la misma palabra.
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
                    {playing && <Keyboard onKey={press} states={keyStates} disabled={!canType} />}
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

function Keyboard({ onKey, states, disabled }: { onKey: (k: string) => void; states: Map<string, LetterState>; disabled: boolean }) {
  return (
    <div className="w-full select-none space-y-1.5" aria-label="Teclado">
      {KEY_ROWS.map((row, r) => (
        <div key={row} className="flex justify-center gap-1">
          {r === 2 && (
            <button type="button" disabled={disabled} onClick={() => onKey('ENTER')} className="h-12 rounded-md bg-pitch-600 px-2 text-[11px] font-bold uppercase text-white transition hover:bg-pitch-500 disabled:opacity-50 sm:px-3">
              Enviar
            </button>
          )}
          {[...row].map((k) => (
            <button key={k} type="button" disabled={disabled} onClick={() => onKey(k)} className={clsx('h-12 min-w-0 flex-1 rounded-md text-sm font-bold transition disabled:opacity-50 sm:max-w-10', KEY[states.get(k) ?? 'idle'])}>
              {k}
            </button>
          ))}
          {r === 2 && (
            <button type="button" disabled={disabled} onClick={() => onKey('BACKSPACE')} aria-label="Borrar" className="grid h-12 place-items-center rounded-md bg-white/[0.14] px-2.5 text-white transition hover:bg-white/[0.22] disabled:opacity-50">
              <Delete className="size-5" />
            </button>
          )}
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
          La palabra era <b className="text-white">{wordle.answer}</b>
        </p>
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

import { useEffect, useMemo, useState } from 'react';
import { TrendingDown, TrendingUp, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { moneyK, RARITY_META } from '../lib/format';
import type { ValueTrend } from '../types';

/** Insignia de rareza (jugadores, entrenadores y cartas). */
export function RarityBadge({ rarity, className }: { rarity: string; className?: string }) {
  const meta = RARITY_META[rarity] ?? RARITY_META.COMMON;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ring-1 ring-inset', meta.chip, className)}>
      {rarity === 'STAR' || rarity === 'LEGENDARY' ? '★ ' : ''}
      {meta.label}
    </span>
  );
}

/** Última variación de valor tras la jornada (▲ / ▼ con porcentaje). */
export function ValueTrendBadge({ trend, className }: { trend: ValueTrend | null | undefined; className?: string }) {
  if (!trend || trend.change === 0) return <span className={clsx('text-xs text-white/45', className)}>Sin cambios</span>;
  const up = trend.change > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold', up ? 'text-pitch-300' : 'text-red-300', className)} title={`${up ? '+' : '−'}${moneyK(Math.abs(trend.change))} en la última jornada`}>
      <Icon aria-hidden className="size-3.5" />
      {up ? '+' : '−'}
      {(Math.abs(trend.variationBp) / 100).toFixed(1)}%
    </span>
  );
}

export function CoachPhoto({ url, name, size = 56, className }: { url: string | null; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={clsx('grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.08]', className)} style={{ width: size, height: size }}>
      {url && !failed ? <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover object-top" /> : <UserRound aria-hidden className="size-1/2 text-white/60" />}
    </span>
  );
}

/**
 * Cuenta atrás hasta un instante decidido por el servidor. El desfase con el reloj del dispositivo se
 * corrige con la hora del servidor recibida en la misma respuesta: cambiar la hora del PC no altera nada.
 */
export function useServerCountdown(target: string | null | undefined, serverTime: string | null | undefined) {
  const offset = useMemo(() => (serverTime ? Date.parse(serverTime) - Date.now() : 0), [serverTime]);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);
  const ms = target ? Math.max(0, Date.parse(target) - now) : 0;
  return { ms, done: !!target && ms === 0, label: formatDuration(ms) };
}

export function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

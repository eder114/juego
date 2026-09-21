import type { PlayerStatus, Position } from '../types';

export const money = (tenths: number | null | undefined) => `£${((tenths ?? 0) / 10).toFixed(1)}M`;
export const signedMoney = (tenths: number) =>
  tenths === 0 ? '£0.0M' : `${tenths > 0 ? '+' : '−'}£${(Math.abs(tenths) / 10).toFixed(1)}M`;
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Economía de liga: importes en miles de £ (100000 = £100M, 750 = £750K). */
export const moneyK = (k: number | null | undefined) => {
  const v = k ?? 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : abs % 100 === 0 ? 1 : 2)}M`;
  return `${sign}£${abs}K`;
};
export const signedMoneyK = (k: number) => (k === 0 ? '£0' : `${k > 0 ? '+' : '−'}${moneyK(Math.abs(k))}`);
/** Importe completo con separador de miles: £74.500.000 */
export const moneyFull = (k: number) => `£${(k * 1000).toLocaleString('es-ES')}`;
/** Formatea un movimiento según su moneda (clásico en décimas, liga en miles). */
export const moneyIn = (amount: number, currency: 'TENTHS' | 'K') => (currency === 'K' ? moneyK(amount) : money(amount));

export const RARITY_META: Record<string, { label: string; chip: string; ring: string; text: string }> = {
  COMMON: { label: 'Común', chip: 'bg-slate-400/15 text-slate-200 ring-slate-300/30', ring: 'ring-slate-300/40', text: 'text-slate-200' },
  UNCOMMON: { label: 'Poco común', chip: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/35', ring: 'ring-emerald-300/50', text: 'text-emerald-200' },
  RARE: { label: 'Rara', chip: 'bg-sky-400/15 text-sky-200 ring-sky-300/40', ring: 'ring-sky-300/60', text: 'text-sky-200' },
  EPIC: { label: 'Épica', chip: 'bg-fuchsia-400/20 text-fuchsia-200 ring-fuchsia-300/45', ring: 'ring-fuchsia-300/70', text: 'text-fuchsia-200' },
  STAR: { label: 'Estrella', chip: 'bg-amber-300/20 text-amber-200 ring-amber-300/60', ring: 'ring-amber-300/80', text: 'text-amber-200' },
  LEGENDARY: { label: 'Legendaria', chip: 'bg-amber-300/20 text-amber-200 ring-amber-300/60', ring: 'ring-amber-300/80', text: 'text-amber-200' },
};

export const TX_LABEL: Record<string, string> = {
  INITIAL_BUDGET: 'Presupuesto inicial',
  PURCHASE: 'Fichaje',
  SALE: 'Venta',
  ADJUSTMENT: 'Ajuste',
  REWARD: 'Premio',
  PLAYER_PURCHASE: 'Fichaje',
  PLAYER_SALE: 'Venta',
  COACH_PURCHASE: 'Fichaje de entrenador',
  COACH_SALE: 'Venta de entrenador',
  DAILY_CHALLENGE_REWARD: 'Desafío diario',
  STREAK_REWARD: 'Premio por racha',
  CARD_REWARD: 'Premio de carta',
  ADMIN_ADJUSTMENT: 'Ajuste de administración',
  ECONOMY_RESET: 'Reinicio de partida',
  OTHER_REWARD: 'Premio',
};

export const POSITION_LABEL: Record<Position, string> = { GK: 'Portero', DEF: 'Defensa', MID: 'Centrocampista', FWD: 'Delantero' };
export const POSITION_PLURAL: Record<Position, string> = { GK: 'Porteros', DEF: 'Defensas', MID: 'Centrocampistas', FWD: 'Delanteros' };
export const POSITION_SHORT: Record<Position, string> = { GK: 'POR', DEF: 'DEF', MID: 'MED', FWD: 'DEL' };
export const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

export const POSITION_STYLE: Record<Position, string> = {
  GK: 'bg-amber-400/15 text-amber-300 ring-amber-400/30',
  DEF: 'bg-sky-400/15 text-sky-300 ring-sky-400/30',
  MID: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
  FWD: 'bg-rose-400/15 text-rose-300 ring-rose-400/30',
};

export const STATUS_META: Record<PlayerStatus, { label: string; dot: string; text: string; chip: string }> = {
  AVAILABLE: { label: 'Disponible', dot: 'bg-emerald-400', text: 'text-emerald-300', chip: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25' },
  DOUBTFUL: { label: 'Duda', dot: 'bg-amber-400', text: 'text-amber-300', chip: 'bg-amber-400/10 text-amber-300 ring-amber-400/25' },
  INJURED: { label: 'Lesionado', dot: 'bg-red-500', text: 'text-red-300', chip: 'bg-red-500/10 text-red-300 ring-red-500/25' },
  SUSPENDED: { label: 'Sancionado', dot: 'bg-orange-500', text: 'text-orange-300', chip: 'bg-orange-500/10 text-orange-300 ring-orange-500/25' },
  UNAVAILABLE: { label: 'No disponible', dot: 'bg-slate-500', text: 'text-slate-400', chip: 'bg-slate-500/10 text-slate-300 ring-slate-500/25' },
};

export const FIXTURE_STATUS: Record<string, string> = { SCHEDULED: 'Programado', LIVE: 'En vivo', FINISHED: 'Finalizado', POSTPONED: 'Aplazado' };
export const GW_STATUS: Record<string, string> = { UPCOMING: 'Próxima', LIVE: 'En curso', FINISHED: 'Finalizada' };

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-ES', { timeZone: TZ, ...opts });

export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : 'Por confirmar';
export const dateLong = (iso: string | Date | null | undefined) =>
  iso ? fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)) : 'Fecha por confirmar';
export const dateShort = (iso: string | Date | null | undefined) => (iso ? fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');
export const timeOnly = (iso: string | Date | null | undefined) => (iso ? fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '--:--');
export const dayKey = (iso: string | null) => (iso ? fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : 'tbd');

export function relativeTime(iso: string | Date) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return dateShort(iso);
}

export function countdown(iso: string | Date) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Cerrada';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

export const DIFFICULTY_STYLE: Record<number, string> = {
  1: 'bg-emerald-500 text-emerald-950',
  2: 'bg-emerald-400/80 text-emerald-950',
  3: 'bg-slate-400/70 text-slate-950',
  4: 'bg-rose-500/80 text-white',
  5: 'bg-rose-700 text-white',
};

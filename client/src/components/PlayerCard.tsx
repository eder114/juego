import { Link } from 'react-router-dom';
import { Check, GitCompareArrows, Heart, Minus, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { Player } from '../types';
import { money } from '../lib/format';
import { ClubCrest, PlayerPhoto, PositionBadge, PriceChange, StatusBadge } from './sport';
import { Button } from './ui';

interface Props {
  player: Player;
  onBuy?: () => void;
  onSell?: () => void;
  onFavorite?: () => void;
  onCompare?: () => void;
  comparing?: boolean;
  busy?: boolean;
}

/** Tarjeta de jugador estilo videojuego de gestión (mercado). */
export function PlayerMarketCard({ player: p, onBuy, onSell, onFavorite, onCompare, comparing, busy }: Props) {
  return (
    <div className={clsx('card group relative flex flex-col overflow-hidden transition hover:border-white/15', p.inSquad && 'border-pitch-500/40')}>
      <div className="absolute inset-x-0 top-0 h-28 opacity-60" style={{ background: `linear-gradient(135deg, ${p.club.primaryColor}40, transparent 70%)` }} />
      <div className="relative flex gap-3 p-3.5 sm:flex-col sm:gap-0 sm:p-4">
        <div className="relative sm:mx-auto">
          <Link to={`/players/${p.id}`}>
            <PlayerPhoto player={p} size={76} className="sm:size-[104px]!" />
          </Link>
          {p.inSquad && (
            <span className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full bg-pitch-500 text-ink-950 shadow" title="En tu plantilla">
              <Check className="size-3.5" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 sm:mt-3">
          <div className="flex items-center gap-1.5 sm:justify-center">
            <PositionBadge position={p.position} />
            <ClubCrest club={p.club} size={18} />
            <span className="text-xs font-semibold text-slate-400">{p.club.shortName}</span>
          </div>
          <Link to={`/players/${p.id}`} className="mt-1 block truncate font-display text-xl font-bold uppercase leading-tight text-white hover:text-pitch-300 sm:text-center sm:text-2xl">
            {p.displayName}
          </Link>
          <div className="mt-1 flex items-center gap-2 sm:justify-center">
            <span className="stat-number text-2xl text-pitch-300">{money(p.price)}</span>
            <PriceChange value={p.stats.weeklyChange} />
          </div>
          {p.status !== 'AVAILABLE' && (
            <div className="mt-1.5 sm:flex sm:justify-center">
              <StatusBadge status={p.status} chance={p.chanceOfPlaying} />
            </div>
          )}
        </div>
      </div>

      <div className="relative mx-3.5 grid grid-cols-4 divide-x divide-white/[0.06] rounded-xl bg-ink-900/60 py-2 text-center sm:mx-4">
        {[
          ['PTS', p.stats.totalPoints],
          ['FORMA', p.stats.form.toFixed(1)],
          ['G/A', `${p.stats.goals}/${p.stats.assists}`],
          ['SEL', `${p.stats.selectedBy}%`],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="font-display text-lg font-bold leading-none text-white tabular-nums">{value}</p>
            <p className="mt-0.5 text-[9px] font-semibold tracking-wider text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="relative mt-auto flex items-center gap-1.5 p-3.5 sm:p-4">
        {p.inSquad ? (
          <Button variant="danger" className="flex-1" onClick={onSell} loading={busy} icon={<Minus className="size-4" />}>
            Vender
          </Button>
        ) : (
          <Button className="flex-1" onClick={onBuy} loading={busy} icon={<Plus className="size-4" />}>
            Fichar
          </Button>
        )}
        {onCompare && (
          <button onClick={onCompare} aria-pressed={comparing} className={clsx('grid size-10 place-items-center rounded-xl border transition', comparing ? 'border-sky-400/50 bg-sky-400/15 text-sky-300' : 'border-white/10 text-slate-400 hover:text-white')} title="Comparar">
            <GitCompareArrows className="size-4" />
          </button>
        )}
        {onFavorite && (
          <button onClick={onFavorite} aria-pressed={p.isFavorite} className={clsx('grid size-10 place-items-center rounded-xl border transition', p.isFavorite ? 'border-rose-400/50 bg-rose-400/15 text-rose-300' : 'border-white/10 text-slate-400 hover:text-white')} title={p.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}>
            <Heart className={clsx('size-4', p.isFavorite && 'fill-current')} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Fila compacta para listados (plantilla, rankings de jugadores). */
export function PlayerRow({ player: p, right, sub }: { player: Player; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link to={`/players/${p.id}`}>
        <PlayerPhoto player={p} size={44} rounded="rounded-xl" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link to={`/players/${p.id}`} className="truncate font-semibold text-white hover:text-pitch-300">
            {p.displayName}
          </Link>
          {p.status !== 'AVAILABLE' && <StatusBadge status={p.status} compact />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
          <PositionBadge position={p.position} />
          <ClubCrest club={p.club} size={14} />
          {p.club.shortName}
          {sub}
        </div>
      </div>
      {right}
    </div>
  );
}

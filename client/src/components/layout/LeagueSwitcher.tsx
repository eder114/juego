import { Link } from 'react-router-dom';
import { Check, Plus, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { useLeague } from '../../context/LeagueContext';
import { money, moneyK } from '../../lib/format';
import type { TeamSummary } from '../../types';

/** Nombre con el que se muestra una liga en el menú. */
export const leagueLabel = (t: TeamSummary) => (t.league?.type === 'GLOBAL' ? 'Liga global' : (t.league?.name ?? t.name));

/** Dinero disponible del equipo en esa liga (lo reservado en pujas no se puede gastar). */
const available = (t: TeamSummary) => (t.economyVersion === 2 ? moneyK(t.wallet - t.reserved) : money(t.budget));

/**
 * «Mis ligas»: las ligas en las que el mánager tiene equipo, para cambiar de una a otra con un clic.
 * Cada liga tiene su propio equipo, presupuesto, plantilla y mercado, así que al elegir una se descarta
 * la caché (lo hace `setActiveLeague`) y todas las pantallas vuelven a pedir los datos de esa liga.
 */
export function LeagueSwitcher({ onPick, className }: { onPick?: () => void; className?: string }) {
  const { activeLeagueId, teams, setActiveLeague } = useLeague();
  if (!teams.length) return null;

  return (
    <section aria-label="Mis ligas" className={className}>
      <p className="label mb-1.5 px-1 text-white/70">Mis ligas</p>
      <ul className="scrollbar-none max-h-56 space-y-1 overflow-y-auto">
        {teams.map((t) => {
          const active = t.leagueId === activeLeagueId;
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  if (t.leagueId) setActiveLeague(t.leagueId);
                  onPick?.();
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-xl border-l-[3px] px-3 py-2 text-left text-sm transition',
                  active
                    ? 'border-lime-glow/80 bg-white/[0.2] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]'
                    : 'border-white/20 bg-white/[0.06] font-semibold text-white/85 hover:border-white/45 hover:bg-white/[0.12] hover:text-white',
                )}
              >
                <Trophy aria-hidden className={clsx('size-4 shrink-0', active ? 'text-lime-glow' : 'text-white/50')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{leagueLabel(t)}</span>
                  <span className="block truncate text-[11px] font-medium tabular-nums text-white/55">{available(t)}</span>
                </span>
                {active && <Check aria-label="Liga activa" className="size-4 shrink-0 text-lime-glow" />}
              </button>
            </li>
          );
        })}
      </ul>
      <Link
        to="/leagues"
        onClick={onPick}
        className="mt-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08] hover:text-white"
      >
        <Plus aria-hidden className="size-3.5" />
        {teams.length > 1 ? 'Crear o unirse a otra liga' : 'Crear o unirse a una liga'}
      </Link>
    </section>
  );
}

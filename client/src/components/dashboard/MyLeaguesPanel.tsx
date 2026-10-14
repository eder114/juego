import { Link } from 'react-router-dom';
import { Check, Plus, Trophy } from 'lucide-react';
import clsx from 'clsx';
import { useLeague } from '../../context/LeagueContext';
import { leagueLabel, money, moneyK } from '../../lib/format';
import { DashCard } from './DashCard';

/**
 * «Mis ligas» en la pantalla de Inicio: las ligas en las que el mánager tiene equipo, para saltar de una
 * a otra sin buscar en el menú. Es el mismo cambio de liga que el del menú lateral (`setActiveLeague`),
 * así que al elegir una se descarta la caché y todas las pantallas cargan los datos de ESA liga.
 */
export function MyLeaguesPanel({ className }: { className?: string }) {
  const { activeLeagueId, teams, setActiveLeague } = useLeague();
  if (!teams.length) return null;

  return (
    <DashCard
      title="Mis ligas"
      icon={Trophy}
      subtitle={teams.length > 1 ? 'Cada liga tiene su propio equipo: toca una para jugar en ella' : 'Tu liga actual'}
      className={className}
      action={
        <Link to="/leagues" className="dash-link inline-flex items-center gap-1.5 text-[0.8125rem]">
          <Plus aria-hidden className="size-3.5" />
          {teams.length > 1 ? 'Otra liga' : 'Unirse a una liga'}
        </Link>
      }
      // Una liga por fila: la tarjeta vive en una columna estrecha y los nombres largos tienen que leerse
      bodyClassName="grid gap-2.5 2xl:grid-cols-2"
    >
      {teams.map((t) => {
        const active = t.leagueId === activeLeagueId;
        const v2 = t.economyVersion === 2;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => t.leagueId && setActiveLeague(t.leagueId)}
            className={clsx(
              'dash-inner flex items-center gap-3 p-3 text-left transition',
              active ? 'border-lime-glow/70 bg-lime-glow/[0.08] shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]' : 'hover:border-white/25 hover:bg-white/[0.06]',
            )}
          >
            <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl', active ? 'bg-lime-glow/20 text-lime-glow' : 'bg-white/[0.08] text-white/60')}>
              <Trophy aria-hidden className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-white">{leagueLabel(t)}</span>
              <span className="block truncate text-xs text-white/60">
                {v2 ? `${moneyK(t.wallet - t.reserved)} disponibles` : `${money(t.budget)} de presupuesto`}
                {v2 && t.reserved > 0 && ` · ${moneyK(t.reserved)} en pujas`}
              </span>
            </span>
            {active ? (
              <span className="flex shrink-0 items-center gap-1 rounded-lg bg-lime-glow/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-lime-glow">
                <Check aria-hidden className="size-3" /> Activa
              </span>
            ) : (
              <span className="shrink-0 text-[11px] font-semibold text-white/50">Jugar →</span>
            )}
          </button>
        );
      })}
    </DashCard>
  );
}

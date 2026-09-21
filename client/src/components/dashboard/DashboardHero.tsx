import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarDays, Info, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { countdown, dateTime } from '../../lib/format';
import { TeamCrest } from '../sport';
import type { DashboardAlert, DashboardData } from './types';

/** Fuerza un nuevo render cada `ms` para que las cuentas atrás no se queden congeladas. */
function useTick(ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Resumen del equipo: escudo, saludo al mánager, nombre del equipo y estado de la plantilla. */
export function TeamSummary({ data, managerName, className }: { data: DashboardData; managerName?: string; className?: string }) {
  const team = data.team!;
  const gw = data.currentGameweek;
  return (
    <section aria-label="Tu equipo" className={clsx('dash-card flex items-center gap-4 p-5 sm:gap-6 sm:px-8 sm:py-7', className)}>
      <Link to="/team" className="shrink-0 rounded-xl transition hover:scale-[1.04]" title="Ver mi equipo">
        <TeamCrest crest={team.crest} name={team.name} size={72} className="size-14 sm:size-[4.5rem]" />
      </Link>
      <div className="min-w-0">
        {managerName && <p className="truncate text-sm font-bold uppercase tracking-[0.06em] text-lime-glow">Hola, {managerName}</p>}
        <h1 className="truncate font-sans text-[1.75rem] font-extrabold uppercase leading-tight tracking-[0.02em] text-white sm:text-[2.25rem]">{team.name}</h1>
        <p className="text-sm text-white/90 sm:text-base">
          {data.squadCount}/{data.squadSize} jugadores · {gw ? `${gw.name}${gw.status === 'LIVE' ? ' en curso' : ''}` : 'Pretemporada'}
        </p>
      </div>
    </section>
  );
}

/** Próxima alineación: jornada editable, cuenta atrás hasta el cierre y acceso directo a alinear. */
export function NextLineup({ gameweek }: { gameweek: NonNullable<DashboardData['editableGameweek']> }) {
  useTick();
  const left = countdown(gameweek.deadline);
  return (
    <section aria-label="Próxima alineación" className="dash-card flex flex-wrap items-center gap-4 p-5 sm:px-7 sm:py-6">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#0c141b]/85 text-white">
        <CalendarDays aria-hidden className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-white">Próxima alineación · {gameweek.name}</p>
        <p className="mt-0.5 text-xl font-bold text-white sm:text-[1.4rem]">{left === 'Cerrada' ? 'Partidos en juego' : `Cierre en ${left}`}</p>
        <p className="text-sm text-white/85">{dateTime(gameweek.deadline)}</p>
      </div>
      <Link to="/lineup" className="btn-go group h-11 px-5 text-base max-sm:w-full">
        <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" /> Alinear
      </Link>
    </section>
  );
}

const ALERT_STYLE = {
  danger: { icon: ShieldAlert, border: 'border-red-400/60', tone: 'text-red-300' },
  warning: { icon: AlertTriangle, border: 'border-amber-400/60', tone: 'text-amber-300' },
  info: { icon: Info, border: 'border-sky-300/60', tone: 'text-sky-200' },
} as const;

/** Avisos calculados por el servidor (plantilla incompleta, lesionados, alineación sin guardar…). */
export function AlertBanners({ alerts }: { alerts: DashboardAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2.5" role="region" aria-label="Avisos">
      {alerts.map((a) => {
        const s = ALERT_STYLE[a.level];
        const Icon = s.icon;
        return (
          <Link
            key={`${a.level}-${a.title}`}
            to={a.link}
            className={clsx('group flex items-center gap-3 rounded-xl border-[1.5px] bg-[#23272c]/85 px-4 py-3.5 transition hover:bg-[#2b3036]/90 sm:gap-4 sm:px-6', s.border)}
          >
            <Icon aria-hidden className={clsx('size-5 shrink-0 sm:size-6', s.tone)} />
            <p className="min-w-0 flex-1 text-sm sm:text-base">
              <span className={clsx('font-bold', s.tone)}>{a.title}</span>
              <span className="ml-3 text-white/80 max-sm:ml-0 max-sm:block max-sm:truncate">{a.message}</span>
            </p>
            <ArrowRight aria-hidden className="size-4 shrink-0 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white/80" />
          </Link>
        );
      })}
    </div>
  );
}

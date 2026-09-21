import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RotateCw, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

/** Tarjeta del dashboard: borde claro sobre el fondo degradado, título en mayúsculas, icono y acción opcional. */
export function DashCard({
  title,
  subtitle,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx('dash-card flex flex-col p-4 sm:p-6', className)} aria-label={title}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 font-display text-[1.45rem] font-medium uppercase leading-tight tracking-[0.04em] text-white sm:text-[1.6rem]">
            {Icon && <Icon aria-hidden className="size-5 shrink-0 text-lime-glow" />}
            <span className="truncate">{title}</span>
          </h2>
          {subtitle && <p className="mt-0.5 text-sm text-white/85">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0 pt-1.5">{action}</div>}
      </header>
      <div className={clsx('mt-4 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Enlace verde de las cabeceras («Ver todo», «Calendario»). */
export function DashLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="dash-link">
      {children}
    </Link>
  );
}

/** Estado vacío en panel oscuro, como «Sin datos todavía» o «Plantilla vacía» del diseño. */
export function DashEmpty({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('dash-inner flex h-full min-h-44 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center', className)}>
      <p className="font-display text-xl font-semibold uppercase tracking-[0.04em] text-white">{title}</p>
      {description && <p className="max-w-sm text-sm text-white/70">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Error de carga con reintento real (vuelve a pedir los datos al servidor). */
export function DashError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="dash-card mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl border border-amber-400/40 bg-amber-400/10 text-amber-300">
        <AlertTriangle aria-hidden className="size-7" />
      </span>
      <p className="font-display text-2xl font-semibold uppercase tracking-[0.04em] text-white">No se pudo cargar tu resumen</p>
      <p className="text-sm text-white/75">{error instanceof Error ? error.message : 'Comprueba tu conexión e inténtalo de nuevo.'}</p>
      <button type="button" onClick={onRetry} disabled={retrying} className="btn-go mt-2 h-10 px-5 text-sm disabled:opacity-60">
        <RotateCw aria-hidden className={clsx('size-4', retrying && 'animate-spin')} /> Reintentar
      </button>
    </div>
  );
}

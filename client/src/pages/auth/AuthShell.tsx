import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../components/layout/AppLayout';

export default function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden lg:block">
        <div className="pitch-bg absolute inset-0 opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-transparent" />
        <svg className="absolute inset-0 size-full opacity-25" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <g fill="none" stroke="white" strokeWidth="3">
            <rect x="40" y="40" width="520" height="720" />
            <line x1="40" y1="400" x2="560" y2="400" />
            <circle cx="300" cy="400" r="80" />
            <rect x="170" y="40" width="260" height="120" />
            <rect x="170" y="640" width="260" height="120" />
          </g>
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo />
          <div className="max-w-md">
            <p className="label mb-3 text-pitch-300">Temporada 2026/27</p>
            <h2 className="text-6xl font-extrabold uppercase leading-[0.9]">Tu equipo. Tus reglas. La Premier League.</h2>
            <p className="mt-4 text-slate-300">Ficha a jugadores reales, elige a tu capitán y gana a tus amigos cada jornada con puntos basados en partidos reales.</p>
          </div>
          <p className="text-xs text-slate-400">Datos de jugadores y partidos: Fantasy Premier League</p>
        </div>
      </div>
      <div className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-4xl font-extrabold uppercase">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-400">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-slate-400">{footer}</div>}
          <p className="mt-10 text-center text-xs text-slate-600">
            <Link to="/" className="hover:text-slate-400">
              Volver al inicio
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

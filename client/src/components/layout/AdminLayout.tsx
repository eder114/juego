import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, CalendarRange, Database, Gauge, Newspaper, Settings, Shield, Swords, Trophy, UserCog, Users } from 'lucide-react';
import clsx from 'clsx';

const LINKS = [
  { to: '/admin', label: 'Resumen', icon: Gauge, end: true },
  { to: '/admin/users', label: 'Usuarios', icon: UserCog },
  { to: '/admin/players', label: 'Jugadores', icon: Users },
  { to: '/admin/clubs', label: 'Clubes', icon: Shield },
  { to: '/admin/gameweeks', label: 'Jornadas', icon: CalendarRange },
  { to: '/admin/fixtures', label: 'Partidos', icon: Swords },
  { to: '/admin/scoring', label: 'Puntuación', icon: BarChart3 },
  { to: '/admin/leagues', label: 'Ligas', icon: Trophy },
  { to: '/admin/news', label: 'Noticias', icon: Newspaper },
  { to: '/admin/import', label: 'Datos', icon: Database },
  { to: '/admin/settings', label: 'Configuración', icon: Settings },
];

export default function AdminLayout() {
  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-violet-300 ring-1 ring-inset ring-violet-500/30">Admin</span>
        <span className="text-sm text-slate-400">Panel de administración</span>
      </div>
      <nav className="scrollbar-none -mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx('flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition', isActive ? 'bg-violet-500/20 text-white ring-1 ring-inset ring-violet-400/30' : 'bg-white/[0.04] text-slate-400 hover:text-white')
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

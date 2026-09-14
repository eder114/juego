import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  CalendarDays,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Newspaper,
  Settings2,
  Shield,
  Shirt,
  ShoppingBag,
  Trophy,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { money, relativeTime } from '../../lib/format';
import type { AppNotification } from '../../types';
import { Avatar, TeamCrest } from '../sport';
import { LoadingBlock } from '../ui';
const NAV = [
  { to: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { to: '/team', label: 'Mi equipo', icon: Shirt },
  { to: '/lineup', label: 'Alineación', icon: Users },
  { to: '/market', label: 'Mercado', icon: ShoppingBag },
  { to: '/leagues', label: 'Ligas', icon: Trophy },
  { to: '/rankings', label: 'Clasificación', icon: ListOrdered },
  { to: '/fixtures', label: 'Calendario', icon: CalendarDays },
  { to: '/stats', label: 'Estadísticas', icon: BarChart3 },
  { to: '/clubs', label: 'Clubes', icon: Shield },
  { to: '/news', label: 'Noticias', icon: Newspaper },
];
const MOBILE_NAV = [NAV[0], NAV[2], NAV[3], NAV[4]];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/dashboard" className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-pitch-400 to-pitch-700 shadow-glow">
        <svg viewBox="0 0 24 24" className="size-5 text-ink-950" fill="currentColor" aria-hidden>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2 2.9 2.1-1.1 3.4h-3.6L9.1 7.3 12 5.2Zm-6.6 4 2.4.3 1.2 3.5-2 2.7-2.5-.9a7.9 7.9 0 0 1 .9-5.6Zm13.2 0a7.9 7.9 0 0 1 .9 5.6l-2.5.9-2-2.7 1.2-3.5 2.4-.3ZM10.2 16h3.6l1.3 2.6a7.9 7.9 0 0 1-6.2 0l1.3-2.6Z" />
        </svg>
      </span>
      {!compact && (
        <span className="font-display text-xl font-extrabold uppercase leading-none tracking-wide text-white">
          Premier<span className="text-pitch-400">Fantasy</span>
        </span>
      )}
    </Link>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => api.get<{ items: AppNotification[]; unreadCount: number }>('/notifications'),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid size-10 place-items-center rounded-xl text-slate-300 hover:bg-white/[0.07] hover:text-white" aria-label={`Notificaciones (${unread} sin leer)`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4.5 place-items-center rounded-full bg-pitch-500 px-1 text-[10px] font-bold text-ink-950">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,380px)] animate-pop overflow-hidden rounded-2xl border border-white/10 bg-ink-800 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <p className="font-display text-lg font-bold uppercase text-white">Notificaciones</p>
            {unread > 0 && (
              <button onClick={() => readAll.mutate()} className="text-xs font-semibold text-pitch-400 hover:text-pitch-300">
                Marcar todo como leído
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(data?.items ?? []).slice(0, 8).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false);
                  if (!n.isRead) api.post(`/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                  if (n.link) navigate(n.link);
                }}
                className={clsx('flex w-full gap-3 border-b border-white/[0.04] px-4 py-3 text-left hover:bg-white/[0.04]', !n.isRead && 'bg-pitch-500/[0.05]')}
              >
                <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-pitch-400')} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{n.title}</span>
                  <span className="line-clamp-2 block text-xs text-slate-400">{n.message}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">{relativeTime(n.createdAt)}</span>
                </span>
              </button>
            ))}
            {data?.items.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No tienes notificaciones</p>}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-white/[0.06] py-2.5 text-center text-sm font-semibold text-pitch-400 hover:bg-white/[0.04]">
            Ver todas
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const doLogout = () => {
    logout();
    navigate('/login');
  };
  const navItems = user?.role === 'ADMIN' ? [...NAV, { to: '/admin', label: 'Administración', icon: Settings2 }] : NAV;

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Barra lateral (escritorio) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/[0.06] bg-ink-850/90 backdrop-blur-xl lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive ? 'bg-pitch-500/15 text-white ring-1 ring-inset ring-pitch-500/25' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('size-[18px]', isActive ? 'text-pitch-400' : 'text-slate-500 group-hover:text-slate-300')} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="m-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
            <Link to="/profile" className="flex items-center gap-3">
              {user.team ? <TeamCrest crest={user.team.crest} name={user.team.name} size={38} /> : <Avatar name={user.managerName} url={user.avatarUrl} />}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{user.team?.name ?? user.managerName}</p>
                <p className="truncate text-xs text-slate-400">{user.managerName}</p>
              </div>
            </Link>
            <button onClick={doLogout} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold text-slate-400 hover:bg-white/[0.06] hover:text-white">
              <LogOut className="size-3.5" /> Cerrar sesión
            </button>
          </div>
        )}
      </aside>

      {/* Barra superior */}
      <header className="safe-top sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden text-sm text-slate-400 lg:block">
            Temporada <span className="font-semibold text-white">2026/27</span> · Premier League
          </div>
          <div className="flex items-center gap-1.5">
            {user?.team && (
              <Link to="/team" className="mr-1 hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm sm:flex">
                <Wallet className="size-4 text-pitch-400" />
                <span className="font-semibold tabular-nums text-white">{money(user.team.budget)}</span>
              </Link>
            )}
            <NotificationBell />
            <Link to="/profile" className="rounded-full" aria-label="Mi perfil">
              <Avatar name={user?.managerName ?? '?'} url={user?.avatarUrl} size={34} />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-8 lg:pb-12">
        <Suspense fallback={<LoadingBlock />}>
          <div key={location.pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </Suspense>
      </main>

      {/* Navegación inferior (móvil) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-ink-850/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => clsx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-pitch-400' : 'text-slate-400')}>
              <Icon className="size-[22px]" />
              {label}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-slate-400">
            <Menu className="size-[22px]" />
            Más
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 animate-fade-up rounded-t-3xl border-t border-white/10 bg-ink-800 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-xl font-bold uppercase text-white">Menú</p>
              <button onClick={() => setMoreOpen(false)} className="grid size-10 place-items-center rounded-xl text-slate-400 hover:bg-white/10" aria-label="Cerrar menú">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[...navItems, { to: '/profile', label: 'Perfil', icon: User }].map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => clsx('flex flex-col items-center gap-2 rounded-2xl border p-3 text-center text-xs font-semibold', isActive ? 'border-pitch-500/40 bg-pitch-500/10 text-pitch-300' : 'border-white/[0.06] bg-white/[0.03] text-slate-300')}>
                  <Icon className="size-6" />
                  {label}
                </NavLink>
              ))}
            </div>
            <button onClick={doLogout} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.06] py-3 text-sm font-semibold text-slate-300">
              <LogOut className="size-4" /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

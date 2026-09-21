import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  CalendarDays,
  Flame,
  House,
  Layers,
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
import { initials, money, moneyK, relativeTime } from '../../lib/format';
import { usePublicConfig } from '../../hooks/usePublicConfig';
import type { AppNotification } from '../../types';
import { LoadingBlock } from '../ui';
import { BrandLogo } from '../brand/BrandLogo';

const NAV = [
  { to: '/dashboard', label: 'Inicio', icon: House },
  { to: '/team', label: 'Mi equipo', icon: Shirt },
  { to: '/lineup', label: 'Alineación', icon: Users },
  { to: '/market', label: 'Mercado', icon: ShoppingBag },
  { to: '/challenges', label: 'Desafíos', icon: Flame },
  { to: '/cards', label: 'Cartas', icon: Layers },
  { to: '/leagues', label: 'Ligas', icon: Trophy },
  { to: '/rankings', label: 'Clasificación', icon: ListOrdered },
  { to: '/fixtures', label: 'Calendario', icon: CalendarDays },
  { to: '/stats', label: 'Estadísticas', icon: BarChart3 },
  { to: '/clubs', label: 'Clubes', icon: Shield },
  { to: '/news', label: 'Noticias', icon: Newspaper },
];
const MOBILE_NAV = ['/dashboard', '/lineup', '/market', '/leagues'].map((to) => NAV.find((n) => n.to === to)!);

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/dashboard" aria-label="Premier Fantasy · Inicio" className="inline-flex">
      <BrandLogo className={className ?? 'h-9'} />
    </Link>
  );
}

/** Avatar de la cabecera: foto del mánager o sus iniciales con el anillo verde del diseño. */
function HeaderAvatar({ name, url }: { name: string; url?: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="grid size-10 place-items-center overflow-hidden rounded-full bg-[#0c1a20] ring-2 ring-lime-glow transition group-hover:shadow-[0_0_18px_-2px_rgb(3_255_136/0.7)]">
      {url && !failed ? (
        <img src={url} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <span className="text-sm font-extrabold text-lime-glow">{initials(name)}</span>
      )}
    </span>
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
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-xl text-white/85 transition hover:bg-white/[0.08] hover:text-white"
        aria-label={`Notificaciones (${unread} sin leer)`}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span aria-hidden className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-lime-glow px-1 text-[10px] font-extrabold leading-none text-ink-950 ring-2 ring-[#10222b]">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
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
  const { data: config } = usePublicConfig();
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
      <div aria-hidden className="scene-app" />

      {/* Barra lateral (escritorio) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/40 bg-[#051a2a]/15 lg:flex">
        <div className="flex justify-center px-6 pb-6 pt-7">
          <Logo className="h-[3.25rem]" />
        </div>
        <nav aria-label="Principal" className="scrollbar-none flex-1 space-y-2.5 overflow-y-auto px-5 pb-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3.5 rounded-xl border-l-[3px] px-4 py-3 text-[0.95rem] font-semibold text-white transition duration-200',
                  isActive
                    ? 'border-lime-glow/80 bg-white/[0.2] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]'
                    : 'border-white/25 bg-white/[0.08] hover:translate-x-0.5 hover:border-white/50 hover:bg-white/[0.14]',
                )
              }
            >
              <Icon aria-hidden className="size-[1.35rem] shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="mx-5 mb-5 flex items-center gap-2 rounded-2xl border-l-[3px] border-white/25 bg-white/[0.12] py-3 pl-3 pr-2">
            <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3" title="Mi perfil">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span aria-hidden className="size-10 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#7dfcc4_0%,#12c77f_45%,#0b3d4a_100%)] shadow-[0_0_16px_-4px_rgb(3_255_136/0.8)]" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-display text-lg font-bold uppercase leading-tight text-white">{user.team?.name ?? user.managerName}</span>
                <span className="block truncate text-sm font-medium uppercase text-lime-glow">{user.managerName}</span>
              </span>
            </Link>
            <button onClick={doLogout} title="Cerrar sesión" aria-label="Cerrar sesión" className="grid size-9 shrink-0 place-items-center rounded-lg text-white/70 transition hover:bg-white/[0.1] hover:text-white">
              <LogOut className="size-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Barra superior */}
      <header className="safe-top sticky top-0 z-30 border-b border-white/50 bg-[#0b2a3a]/35 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:h-[4.75rem] lg:px-8">
          <div className="lg:hidden">
            <Logo className="h-8" />
          </div>
          <p className="hidden items-baseline gap-5 lg:flex">
            <span className="text-lg font-bold text-white">Temporada {config?.season ?? '—'}</span>
            <span className="text-sm text-white/80">Premier League</span>
          </p>
          <div className="flex items-center gap-2 sm:gap-3">
            {user?.team && (
              <Link
                to={user.team.economyVersion === 2 ? '/economy' : '/team'}
                title={user.team.economyLeague ? `Presupuesto en «${user.team.economyLeague.name}»` : 'Presupuesto disponible'}
                className="hidden h-10 items-center gap-2.5 rounded-lg bg-[#101d25]/90 px-4 text-sm shadow-[0_6px_18px_-8px_rgb(0_0_0/0.6)] transition hover:bg-[#15272f] sm:flex"
              >
                <Wallet aria-hidden className="size-4 text-white/80" />
                <span className="font-bold tabular-nums text-white">{user.team.economyVersion === 2 ? moneyK(user.team.wallet) : money(user.team.budget)}</span>
              </Link>
            )}
            <NotificationBell />
            <Link to="/profile" className="group rounded-full" aria-label="Mi perfil">
              <HeaderAvatar name={user?.managerName ?? '?'} url={user?.avatarUrl} />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
        <Suspense fallback={<LoadingBlock />}>
          <div key={location.pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </Suspense>
      </main>

      {/* Navegación inferior (móvil) */}
      <nav aria-label="Principal móvil" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.12] bg-[#1c0c35]/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => clsx('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', isActive ? 'text-lime-glow' : 'text-white/70')}>
              <Icon className="size-[22px]" />
              {label}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-white/70">
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

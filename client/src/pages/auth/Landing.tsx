import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Crown, LineChart, ShoppingBag, Trophy, Users } from 'lucide-react';
import { api } from '../../lib/api';
import type { Club } from '../../types';
import { Logo } from '../../components/layout/AppLayout';
import { ClubCrest } from '../../components/sport';
import { InstallPrompt } from '../../components/InstallPrompt';

const FEATURES = [
  { icon: ShoppingBag, title: 'Mercado de fichajes', text: 'Jugadores reales de la Premier League con precios que suben y bajan según rendimiento y demanda.' },
  { icon: Users, title: 'Alineación táctica', text: 'Siete formaciones, campo visual con arrastrar y soltar, capitán, vicecapitán y banquillo.' },
  { icon: Trophy, title: 'Ligas privadas', text: 'Crea ligas con código, contraseña o invitación y compite con tus amigos toda la temporada.' },
  { icon: LineChart, title: 'Puntos reales', text: 'Goles, asistencias, porterías a cero y tarjetas de los partidos oficiales, jornada a jornada.' },
];

export default function Landing() {
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <Link to="/login" className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white">
            Entrar
          </Link>
          <Link to="/register" className="rounded-xl bg-pitch-500 px-4 py-2 text-sm font-bold text-ink-950 hover:bg-pitch-400">
            Crear equipo
          </Link>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-2 lg:pt-16">
        <div>
          <p className="label mb-4 inline-flex items-center gap-2 rounded-full border border-pitch-500/30 bg-pitch-500/10 px-3 py-1 text-pitch-300">
            <span className="size-1.5 animate-pulse rounded-full bg-pitch-400" /> Temporada 2026/27 en juego
          </p>
          <h1 className="text-6xl font-extrabold uppercase leading-[0.88] sm:text-7xl xl:text-8xl">
            Sé el mánager
            <br />
            de la <span className="bg-gradient-to-r from-pitch-400 to-lime-glow bg-clip-text text-transparent">Premier</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-300">£100 millones, 15 jugadores y 38 jornadas. Ficha a las estrellas de la liga más competitiva del mundo y demuestra quién sabe más de fútbol.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="inline-flex h-12 items-center gap-2 rounded-xl bg-pitch-500 px-6 font-bold text-ink-950 shadow-glow hover:bg-pitch-400">
              Empezar gratis <ArrowRight className="size-4" />
            </Link>
            <Link to="/login" className="inline-flex h-12 items-center rounded-xl border border-white/15 px-6 font-semibold text-white hover:bg-white/5">
              Ya tengo cuenta
            </Link>
          </div>
        </div>

        <div className="relative">
          <div className="pitch-bg relative mx-auto aspect-[4/5] max-w-md overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl">
            <svg className="absolute inset-0 size-full opacity-30" viewBox="0 0 400 500" aria-hidden>
              <g fill="none" stroke="white" strokeWidth="2.5">
                <rect x="20" y="20" width="360" height="460" rx="6" />
                <line x1="20" y1="250" x2="380" y2="250" />
                <circle cx="200" cy="250" r="50" />
                <rect x="110" y="20" width="180" height="80" />
                <rect x="110" y="400" width="180" height="80" />
              </g>
            </svg>
            <div className="absolute inset-x-6 bottom-6 rounded-2xl border border-white/10 bg-ink-900/85 p-4 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="label">Puntos esta jornada</p>
                  <p className="stat-number text-5xl">72</p>
                </div>
                <div className="text-right">
                  <p className="label">Capitán</p>
                  <p className="flex items-center justify-end gap-1 font-display text-2xl font-bold text-gold">
                    <Crown className="size-5" /> x2
                  </p>
                </div>
              </div>
            </div>
            <div className="absolute left-1/2 top-[18%] -translate-x-1/2 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full border-2 border-gold bg-ink-900/80 font-display text-xl font-bold text-gold">C</div>
            </div>
          </div>
        </div>
      </section>

      {clubs && clubs.length > 0 && (
        <section className="border-y border-white/[0.06] bg-ink-850/60 py-6">
          <div className="scrollbar-none mx-auto flex max-w-7xl items-center gap-8 overflow-x-auto px-5 sm:justify-between sm:px-8">
            {clubs.map((c) => (
              <ClubCrest key={c.id} club={c} size={40} className="opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0" />
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-16 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card card-hover p-6">
            <span className="grid size-11 place-items-center rounded-xl bg-pitch-500/15 text-pitch-400">
              <Icon className="size-5" />
            </span>
            <h3 className="mt-4 text-2xl font-bold uppercase">{title}</h3>
            <p className="mt-2 text-sm text-slate-400">{text}</p>
          </div>
        ))}
      </section>

      <div className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md lg:hidden">
        <InstallPrompt />
      </div>

      <footer className="border-t border-white/[0.06] py-8 text-center text-xs text-slate-500">Premier Fantasy · Datos de la Premier League vía Fantasy Premier League API</footer>
    </div>
  );
}

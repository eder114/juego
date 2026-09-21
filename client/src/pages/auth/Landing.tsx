import { Link } from 'react-router-dom';
import { ArrowRight, LineChart, ShoppingBag, Trophy, Users } from 'lucide-react';
import AuthLayout from '../../components/auth/AuthLayout';
import { FormHeader } from '../../components/auth/FormHeader';
import { GlassPanel } from '../../components/brand/GlassPanel';
import { seasonCode, usePublicConfig } from '../../hooks/usePublicConfig';

const FEATURES = [
  { icon: ShoppingBag, title: 'Mercado de fichajes', text: 'Jugadores reales de la Premier League con precios que cambian según rendimiento y demanda.' },
  { icon: Users, title: 'Alineación táctica', text: 'Siete formaciones, capitán, vicecapitán y banquillo sobre un campo visual.' },
  { icon: Trophy, title: 'Ligas privadas', text: 'Crea ligas con código, contraseña o invitación y compite con tus amigos.' },
  { icon: LineChart, title: 'Puntos reales', text: 'Goles, asistencias, porterías a cero y tarjetas de los partidos oficiales de cada jornada.' },
];

/** Portada pública: misma identidad visual que el registro, con acceso a crear cuenta o iniciar sesión. */
export default function Landing() {
  const { data: config } = usePublicConfig();
  return (
    <AuthLayout
      title={['Crea tu equipo.', 'Compite con', 'tus amigos.']}
      subtitle="Ficha a jugadores reales de la Premier League, elige a tu capitán y suma puntos con los partidos de cada jornada."
    >
      <GlassPanel className="px-5 py-7 sm:p-10">
        <FormHeader
          step={config ? `Temporada ${config.season} en juego` : 'Temporada en juego'}
          chip={config ? `ID: ${seasonCode(config.season)}` : undefined}
          title="Premier Fantasy"
          subtitle="El Fantasy de la Premier League para jugar con tus amigos."
        />
        <ul className="mt-8 space-y-5">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.07] text-pitch-400">
                <Icon aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">{title}</p>
                <p className="text-sm leading-relaxed text-brand-lilac/80">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-9 space-y-3">
          <Link to="/register" className="btn-cta group">
            <span>Crear mi equipo</span>
            <ArrowRight aria-hidden strokeWidth={2.5} className="size-6 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
          <Link
            to="/login"
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-white/20 font-semibold text-white/90 transition hover:bg-white/[0.08] hover:text-white"
          >
            Ya tengo cuenta · Iniciar sesión
          </Link>
        </div>
      </GlassPanel>
    </AuthLayout>
  );
}

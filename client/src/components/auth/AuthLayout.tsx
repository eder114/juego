import type { ReactNode } from 'react';
import { CircleDollarSign, Loader2, ScrollText, UsersRound } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import { StatCard } from '../ui';
import { ServerStatus } from './ServerStatus';
import { LegalProvider, useLegal } from './LegalModal';
import { formatBudget, usePublicConfig } from '../../hooks/usePublicConfig';

/** Titular en tres líneas: blanco, plateado y degradado de marca (como en el diseño). */
export type HeroTitle = [string, string, string];

interface AuthLayoutProps {
  title: HeroTitle;
  subtitle: ReactNode;
  /** Progreso del onboarding (solo en el registro). */
  onboarding?: ReactNode;
  children: ReactNode;
}

/**
 * Plantilla de las pantallas de acceso.
 * Escritorio: panel izquierdo (marca y datos del juego) + formulario a la derecha.
 * Móvil/tablet: una columna reordenada (estado → titular → progreso → formulario → datos → pie).
 * Las columnas usan `contents` en móvil para que sus bloques se intercalen con `order`.
 */
export default function AuthLayout(props: AuthLayoutProps) {
  return (
    <LegalProvider>
      <AuthScene {...props} />
    </LegalProvider>
  );
}

function AuthScene({ title, subtitle, onboarding, children }: AuthLayoutProps) {
  const openLegal = useLegal();
  const { data: cfg } = usePublicConfig();

  return (
    <div className="scene-auth relative min-h-dvh overflow-x-hidden text-white">
      <div aria-hidden className="scene-auth-left" />
      <div className="relative flex min-h-dvh flex-col gap-7 pb-8 lg:flex-row lg:gap-0 lg:pb-0">
        {/* ───── Columna izquierda: marca, titular, datos del juego y onboarding ───── */}
        <div className="contents lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:gap-12 lg:px-[4.5%] lg:py-[clamp(2.5rem,8vh,6.5rem)]">
          <header className="order-2 flex flex-col items-center px-5 text-center lg:order-none lg:px-0">
            <BrandLogo className="h-16 sm:h-20 lg:h-[clamp(5.5rem,11vh,7.75rem)]" />
            <h1 className="mt-7 font-headline text-[clamp(2.6rem,11.5vw,3.25rem)] font-normal uppercase leading-[1.02] tracking-[0.01em] sm:text-[3.4rem] lg:mt-[clamp(2rem,7vh,4.5rem)] lg:text-[clamp(2.9rem,3.9vw,3.6rem)]">
              <span className="block">{title[0]}</span>
              <span className="text-gradient-silver block">{title[1]}</span>
              <span className="text-gradient-highlight block">{title[2]}</span>
            </h1>
            <p className="mt-5 max-w-[34rem] text-base leading-relaxed text-brand-mist/85 sm:text-lg lg:mt-10 lg:text-[1.3rem]">{subtitle}</p>
          </header>

          <section aria-label="Datos del juego" className="order-5 px-5 lg:order-none lg:px-0">
            <div className="mx-auto grid max-w-[34rem] grid-cols-2 gap-3 sm:gap-5 lg:max-w-none">
              <StatCard
                label="Presupuesto inicial"
                value={cfg ? formatBudget(cfg.initialBudget) : '—'}
                icon={<CircleDollarSign />}
                dot="mint"
                sub="Tope salarial de tu plantilla"
              />
              <StatCard
                label="Jugadores"
                value={cfg?.squadSize ?? '—'}
                unit="Plantilla"
                icon={<UsersRound />}
                dot="violet"
                sub={cfg ? `${cfg.starters} Titulares + ${cfg.squadSize - cfg.starters} Suplentes` : 'Cargando…'}
              />
            </div>
            <div className="mx-auto mt-4 max-w-[34rem] rounded-xl border border-white/[0.06] bg-brand-night/70 px-4 py-3.5 text-center shadow-card lg:mt-5 lg:max-w-none">
              <p className="text-[0.95rem] text-white sm:text-base">Ligas privadas con amigos y colegas</p>
              <p className="mt-0.5 text-sm text-brand-mist/80">Clasificaciones en vivo durante cada jornada</p>
            </div>
          </section>

          {onboarding && (
            <div className="order-3 px-5 lg:order-none lg:px-0">
              <div className="mx-auto max-w-[34rem] lg:max-w-none">{onboarding}</div>
            </div>
          )}
        </div>

        {/* ───── Columna derecha: estado, formulario y pie ───── */}
        <div className="contents lg:flex lg:w-[54%] lg:flex-col lg:px-[5%] lg:py-[clamp(1.5rem,4vh,2.75rem)]">
          <div className="safe-top order-1 px-5 pt-5 lg:order-none lg:px-0 lg:pt-0">
            <div className="mx-auto flex w-full max-w-[34rem] items-center justify-between gap-3">
              <ServerStatus />
              <div className="flex shrink-0 items-center gap-3 text-sm text-white/75 sm:text-[0.95rem]">
                <button type="button" onClick={() => openLegal('rules')} className="flex items-center gap-1.5 transition hover:text-white" aria-label="Reglamento">
                  <ScrollText aria-hidden className="size-4" />
                  <span className="hidden sm:inline">Reglamento</span>
                </button>
                <span aria-hidden className="h-4 w-px bg-white/25" />
                <span className="font-semibold text-white/90" title="Idioma: español">
                  ES
                </span>
              </div>
            </div>
          </div>

          <main className="order-4 px-4 sm:px-5 lg:order-none lg:flex lg:flex-1 lg:items-center lg:px-0 lg:py-10">
            <div className="mx-auto w-full max-w-[34rem] animate-fade-up">{children}</div>
          </main>

          <footer className="order-6 px-5 text-center text-[0.8125rem] text-white/40 lg:order-none lg:px-0">
            <p>© {new Date().getFullYear()} Premier Fantasy · Datos de jugadores y partidos: Fantasy Premier League</p>
            <p className="mt-1.5 flex items-center justify-center gap-2">
              <button type="button" onClick={() => openLegal('rules')} className="transition hover:text-white/80">
                Reglamento
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => openLegal('scoring')} className="transition hover:text-white/80">
                Puntuación
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => openLegal('privacy')} className="transition hover:text-white/80">
                Privacidad
              </button>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export function AuthLoading() {
  return (
    <div className="scene-auth grid min-h-dvh place-items-center">
      <Loader2 aria-label="Cargando" className="size-8 animate-spin text-pitch-400" />
    </div>
  );
}

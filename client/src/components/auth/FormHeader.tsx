import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Cabecera del formulario: indicador de paso, identificador, título y subtítulo. */
export function FormHeader({ step, chip, title, subtitle }: { step: string; chip?: string; title: string; subtitle?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="label-tech flex items-center gap-2 text-pitch-400">
          <span aria-hidden className="size-2 rounded-full bg-pitch-400 shadow-[0_0_10px_#61fab1]" />
          {step}
        </p>
        {chip && <span className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 font-tech text-xs font-semibold text-white/60">{chip}</span>}
      </div>
      <h2 className="mt-5 font-headline text-[2rem] font-normal uppercase leading-none tracking-[0.02em] sm:text-[2.2rem]">{title}</h2>
      {subtitle && <p className="mt-3 text-base text-brand-lilac/85 sm:text-[1.0625rem]">{subtitle}</p>}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
      {children}
    </p>
  );
}

/** Separador y enlace para cambiar entre registro e inicio de sesión. */
export function AuthSwitch({ question, to, label }: { question: string; to: string; label: string }) {
  return (
    <div className="mt-8 border-t border-[rgb(20_4_30/0.55)] pt-6 text-center">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.95rem] text-brand-lilac/75">
        {question}
        <Link to={to} className="label-tech inline-flex items-center gap-1 text-[#2fc3b0] transition hover:text-pitch-300">
          {label} <ChevronRight aria-hidden className="size-4" />
        </Link>
      </p>
    </div>
  );
}

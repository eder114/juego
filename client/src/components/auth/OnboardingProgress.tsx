import { Check, CheckCircle2, CircleDashed, Lock } from 'lucide-react';
import clsx from 'clsx';

export interface OnboardingStep {
  title: string;
  hint: string;
}

/** Progreso del onboarding del mánager (fases del registro). */
export function OnboardingProgress({ steps, current }: { steps: OnboardingStep[]; current: number }) {
  return (
    <div className="lg:border-t lg:border-white/[0.09] lg:pt-8">
      <div className="flex items-center justify-between gap-3">
        <p className="label-tech text-brand-lilac/80">Onboarding del mánager</p>
        <p className="label-tech shrink-0 text-pitch-400">
          Fase {current + 1} de {steps.length}
        </p>
      </div>
      <ol className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        {steps.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'pending';
          return (
            <li
              key={step.title}
              aria-current={state === 'active' ? 'step' : undefined}
              className={clsx(
                'min-w-0 rounded-2xl border p-2.5 transition duration-300 sm:p-4',
                state === 'active' && 'border-pitch-500/70 bg-white/[0.09] shadow-[0_0_28px_-10px_rgb(44_229_153/0.6)]',
                state === 'done' && 'border-pitch-500/25 bg-white/[0.06]',
                state === 'pending' && 'border-transparent bg-white/[0.045]',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={clsx(
                    'grid size-7 shrink-0 place-items-center rounded-md font-tech text-[0.8125rem] font-bold sm:size-8 sm:text-sm',
                    state === 'pending' ? 'bg-white/[0.07] text-white/40' : 'bg-lime-glow text-ink-950',
                  )}
                >
                  {state === 'done' ? <Check aria-label="Completada" strokeWidth={3.5} className="size-4" /> : String(i + 1).padStart(2, '0')}
                </span>
                <span className={clsx('truncate font-headline text-base font-normal uppercase tracking-[0.04em] sm:text-lg', state === 'pending' ? 'text-white/40' : 'text-white')}>
                  {step.title}
                </span>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-black/25">
                <div className={clsx('h-full rounded-full bg-lime-glow transition-all duration-500', state === 'pending' ? 'w-0' : 'w-full')} />
              </div>
              <p className={clsx('mt-2.5 hidden items-center gap-1.5 text-[0.8125rem] sm:flex', state === 'pending' ? 'text-white/35' : 'text-pitch-400')}>
                {state === 'active' ? (
                  <>
                    <CircleDashed aria-hidden className="size-3.5 shrink-0" /> En progreso
                  </>
                ) : state === 'done' ? (
                  <>
                    <CheckCircle2 aria-hidden className="size-3.5 shrink-0" /> Completado
                  </>
                ) : (
                  <>
                    <Lock aria-hidden className="size-3.5 shrink-0" /> <span className="truncate">{step.hint}</span>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

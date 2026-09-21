import type { ButtonHTMLAttributes } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; arrow?: boolean };

/** Botón principal del diseño (degradado violeta → turquesa) con estados hover, active, disabled y loading. */
export function PrimaryButton({ loading, arrow = true, disabled, className, children, ...props }: Props) {
  return (
    <button {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={clsx('btn-cta group', className)}>
      {loading && <Loader2 aria-hidden className="size-6 animate-spin" />}
      <span>{children}</span>
      {arrow && !loading && <ArrowRight aria-hidden strokeWidth={2.5} className="size-6 transition-transform duration-200 group-hover:translate-x-1" />}
    </button>
  );
}

import type { ReactNode } from 'react';
import clsx from 'clsx';

/** Panel con efecto cristal del diseño: transparencia, desenfoque, borde translúcido y línea de luz superior. */
export function GlassPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('glass-panel', className)}>{children}</div>;
}

import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[image:var(--gradient-cta)] text-white shadow-cta hover:brightness-110',
  secondary: 'bg-white/[0.07] text-white hover:bg-white/[0.12] border border-white/10',
  ghost: 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
  danger: 'bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25',
  outline: 'border border-pitch-500/40 text-pitch-300 hover:bg-pitch-500/10',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center rounded-xl font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children, hover }: { className?: string; children: ReactNode; hover?: boolean }) {
  return <div className={clsx('card', hover && 'card-hover', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-pitch-400">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold uppercase">{title}</h3>
          {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="label mb-1 text-pitch-400">{eyebrow}</p>}
        <h1 className="font-headline text-3xl font-normal uppercase leading-none tracking-[0.02em] sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, className, tone = 'slate' }: { children: ReactNode; className?: string; tone?: 'slate' | 'green' | 'red' | 'amber' | 'sky' | 'violet' | 'gold' }) {
  const tones = {
    slate: 'bg-white/[0.06] text-slate-300 ring-white/10',
    green: 'bg-pitch-500/15 text-pitch-300 ring-pitch-500/30',
    red: 'bg-red-500/15 text-red-300 ring-red-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
    violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
    gold: 'bg-gold/15 text-gold ring-gold/40',
  };
  return <span className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="block text-xs text-red-400">{error}</span> : hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx('input appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50', checked ? 'bg-pitch-500' : 'bg-white/15')}
    >
      <span className={clsx('inline-block size-5 rounded-full bg-white shadow transition', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-6 animate-spin text-pitch-400', className)} />;
}

export function LoadingBlock({ label = 'Cargando…', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-400', className)}>
      <Spinner />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-white/[0.05]', className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-white/[0.05] text-slate-400">{icon}</div>}
      <p className="font-display text-xl font-bold uppercase text-white">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-red-300">{error instanceof Error ? error.message : 'No se pudieron cargar los datos'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}

const DOTS = { mint: 'bg-pitch-500', violet: 'bg-brand-orchid', gold: 'bg-gold', red: 'bg-red-400' };

/** Tarjeta de dato del diseño: etiqueta, icono en recuadro, cifra grande (+unidad) y línea con punto de color. */
export function StatCard({
  label,
  value,
  unit,
  sub,
  dot,
  icon,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  dot?: keyof typeof DOTS;
  icon?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('glass-card relative overflow-hidden p-4 sm:p-5', accent && 'border-pitch-500/35 bg-[linear-gradient(145deg,rgb(44_229_153/0.16),rgb(255_255_255/0.06)_60%)]', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[0.75rem] font-medium uppercase tracking-[0.04em] text-brand-lilac sm:text-[0.8125rem]">{label}</p>
        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-brand-magenta [&_svg]:size-[1.125rem]">{icon}</span>}
      </div>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
        <span className="stat-number text-[2rem] sm:text-[2.6rem]">{value}</span>
        {unit && <span className="text-xs font-medium uppercase text-brand-lilac sm:text-sm">{unit}</span>}
      </p>
      {sub && (
        <div className="mt-2 flex items-center gap-2 font-tech text-xs font-medium text-brand-lilac/90 sm:text-[0.8125rem]">
          {dot && <span aria-hidden className={clsx('size-2 shrink-0 rounded-full', DOTS[dot])} />}
          <span className="min-w-0">{sub}</span>
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition',
            value === t.value ? 'bg-[image:var(--gradient-cta)] text-white shadow-cta' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={clsx('rounded-md px-1.5 text-[11px]', value === t.value ? 'bg-ink-950/20' : 'bg-white/10')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative flex max-h-[92dvh] w-full animate-fade-up flex-col rounded-t-3xl border border-white/10 bg-ink-800 shadow-2xl sm:rounded-3xl', widths[size])}>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-xl font-bold uppercase">{title}</h2>
          <button onClick={onClose} className="grid size-9 place-items-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom flex flex-wrap justify-end gap-2 border-t border-white/[0.06] px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmar', danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-300">{message}</div>
    </Modal>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-slate-400">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} de {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={clsx('h-1.5 overflow-hidden rounded-full bg-white/10', className)}>
      <div className="h-full rounded-full bg-gradient-to-r from-pitch-600 to-lime-glow transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

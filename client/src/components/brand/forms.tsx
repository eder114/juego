import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, CheckCircle2, CircleDashed, Eye, EyeOff, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: LucideIcon;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
}

/** Campo de texto del diseño: etiqueta técnica, icono, borde claro y mensajes accesibles. */
export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  { label, icon: Icon, hint, error, trailing, required, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="label-tech text-brand-lilac">
          {label}
          {required && (
            <span aria-hidden className="ml-1 text-pitch-400">
              *
            </span>
          )}
        </label>
        {hint && <span className="text-xs text-brand-lilac/60">{hint}</span>}
      </div>
      <div className="relative">
        {Icon && <Icon aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-white" />}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={clsx('field-brand', Icon ? 'pl-12' : 'pl-4', trailing ? 'pr-12' : 'pr-4', className)}
          {...props}
        />
        {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {error && (
        <p id={errorId} className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
});

/** Campo de contraseña con botón para mostrar u ocultar el texto. */
export function PasswordField(props: Omit<InputFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <InputField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          className="grid size-10 place-items-center rounded-xl text-white/70 transition hover:bg-white/[0.08] hover:text-white"
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      }
    />
  );
}

export const passwordRules = (password: string) => [
  { label: '8+ caracteres', ok: password.length >= 8 },
  { label: 'Una letra', ok: /[A-Za-z]/.test(password) },
  { label: 'Un número', ok: /\d/.test(password) },
];

/** Indicador de requisitos: cada requisito se ilumina al cumplirse. */
export function PasswordRequirements({ password }: { password: string }) {
  const rules = passwordRules(password);
  const allOk = rules.every((r) => r.ok);
  const Icon = allOk ? CheckCircle2 : CircleDashed;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-tech text-sm font-medium" aria-live="polite">
      <Icon aria-hidden className={clsx('size-4', allOk ? 'text-pitch-500' : 'text-pitch-500/60')} />
      {rules.map((r, i) => (
        <span key={r.label} className={r.ok ? 'text-pitch-500' : 'text-brand-lilac/60'}>
          {i > 0 && (
            <span aria-hidden className="mr-1.5 text-brand-lilac/40">
              ·
            </span>
          )}
          {r.label}
          <span className="sr-only">{r.ok ? ' (cumplido)' : ' (pendiente)'}</span>
        </span>
      ))}
    </p>
  );
}

/** Casilla de verificación real (input checkbox) con el aspecto del diseño. */
export function CheckboxField({
  checked,
  onChange,
  error,
  accessibleLabel,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  error?: string;
  /** Nombre completo para lectores de pantalla cuando la etiqueta contiene enlaces o botones. */
  accessibleLabel?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={error ? true : undefined}
            aria-label={accessibleLabel}
            className="peer size-6 cursor-pointer appearance-none rounded-md border-[1.5px] border-white/60 bg-white/[0.05] transition checked:border-brand-check checked:bg-brand-check hover:border-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pitch-400"
          />
          <Check aria-hidden strokeWidth={3.5} className="pointer-events-none absolute size-4 text-white opacity-0 transition peer-checked:opacity-100" />
        </span>
        <label htmlFor={id} className="text-sm leading-snug text-brand-lilac/85">
          {children}
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}

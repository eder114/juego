import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError, errorMessage } from '../../lib/api';
import type { Club, Crest } from '../../types';
import { Button, Field, Input } from '../../components/ui';
import { ClubCrest } from '../../components/sport';
import { CrestEditor, DEFAULT_CREST } from '../../components/CrestEditor';
import AuthShell from './AuthShell';

const passwordChecks = (p: string) => [
  { ok: p.length >= 8, label: '8+ caracteres' },
  { ok: /[A-Za-z]/.test(p), label: 'Una letra' },
  { ok: /\d/.test(p), label: 'Un número' },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ email: '', password: '', managerName: '', teamName: '', favoriteClubId: null as number | null });
  const [crest, setCrest] = useState<Crest>(DEFAULT_CREST);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });

  const checks = useMemo(() => passwordChecks(form.password), [form.password]);
  const set = (k: keyof typeof form, v: string | number | null) => setForm((f) => ({ ...f, [k]: v }));

  const validateStep = () => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Introduce un email válido';
      if (!checks.every((c) => c.ok)) e.password = 'La contraseña no cumple los requisitos';
      if (form.managerName.trim().length < 3) e.managerName = 'Mínimo 3 caracteres';
    }
    if (step === 1 && form.teamName.trim().length < 3) e.teamName = 'Mínimo 3 caracteres';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validateStep()) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setLoading(true);
    try {
      await register({ ...form, crest: { ...crest, initials: crest.initials || undefined } as Crest });
      navigate('/market', { replace: true });
    } catch (err) {
      const fields = err instanceof ApiError && Array.isArray(err.details) ? (err.details as { field: string; message: string }[]) : [];
      if (fields.length) setErrors(Object.fromEntries(fields.map((f) => [f.field, f.message])));
      setErrors((prev) => ({ ...prev, form: errorMessage(err) }));
      if (fields.some((f) => ['email', 'password', 'managerName'].includes(f.field)) || /email|mánager/i.test(errorMessage(err))) setStep(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Crea tu equipo"
      subtitle="Recibirás £100M para fichar tu plantilla de 15 jugadores."
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-semibold text-pitch-400 hover:text-pitch-300">
            Inicia sesión
          </Link>
        </>
      }
    >
      <div className="mb-6 flex items-center gap-2">
        {['Cuenta', 'Equipo', 'Escudo'].map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span className={clsx('grid size-7 place-items-center rounded-full text-xs font-bold', i < step ? 'bg-pitch-500 text-ink-950' : i === step ? 'bg-white text-ink-950' : 'bg-white/10 text-slate-400')}>
              {i < step ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={clsx('text-xs font-semibold', i === step ? 'text-white' : 'text-slate-500')}>{label}</span>
            {i < 2 && <span className="h-px flex-1 bg-white/10" />}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        {step === 0 && (
          <>
            <Field label="Email" error={errors.email}>
              <Input type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="tu@email.com" />
            </Field>
            <Field label="Nombre de mánager" error={errors.managerName}>
              <Input autoComplete="nickname" value={form.managerName} onChange={(e) => set('managerName', e.target.value)} placeholder="Pep Guardiola" maxLength={30} />
            </Field>
            <Field label="Contraseña" error={errors.password}>
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
            </Field>
            <div className="flex flex-wrap gap-2">
              {checks.map((c) => (
                <span key={c.label} className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold', c.ok ? 'bg-pitch-500/15 text-pitch-300' : 'bg-white/[0.05] text-slate-500')}>
                  <Check className="size-3" /> {c.label}
                </span>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Nombre del equipo" error={errors.teamName}>
              <Input value={form.teamName} onChange={(e) => set('teamName', e.target.value)} placeholder="Real Sofá FC" maxLength={30} />
            </Field>
            <div>
              <p className="label mb-2">Club favorito (opcional)</p>
              <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                {clubs?.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => set('favoriteClubId', form.favoriteClubId === c.id ? null : c.id)}
                    className={clsx('flex flex-col items-center gap-1 rounded-xl border p-2 transition', form.favoriteClubId === c.id ? 'border-pitch-500 bg-pitch-500/10' : 'border-white/[0.06] bg-white/[0.03] hover:border-white/20')}
                    title={c.name}
                  >
                    <ClubCrest club={c} size={32} />
                    <span className="text-[10px] font-bold text-slate-300">{c.shortName}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && <CrestEditor value={crest} onChange={setCrest} teamName={form.teamName} />}

        {errors.form && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errors.form}</p>}

        <div className="flex gap-2 pt-2">
          {step > 0 && (
            <Button type="button" variant="secondary" size="lg" onClick={() => setStep(step - 1)} icon={<ChevronLeft className="size-4" />}>
              Atrás
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" loading={loading}>
            {step < 2 ? (
              <>
                Continuar <ChevronRight className="size-4" />
              </>
            ) : (
              'Crear mi equipo'
            )}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

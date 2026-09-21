import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, AtSign, LockKeyhole, Shield, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiError, errorMessage } from '../../lib/api';
import type { Club, Crest } from '../../types';
import { ClubCrest } from '../../components/sport';
import { CrestEditor, DEFAULT_CREST } from '../../components/CrestEditor';
import AuthLayout, { AuthLoading } from '../../components/auth/AuthLayout';
import { AuthSwitch, FormError, FormHeader } from '../../components/auth/FormHeader';
import { OnboardingProgress, type OnboardingStep } from '../../components/auth/OnboardingProgress';
import { TermsCheckbox } from '../../components/auth/TermsCheckbox';
import { GlassPanel } from '../../components/brand/GlassPanel';
import { InputField, PasswordField, PasswordRequirements, passwordRules } from '../../components/brand/forms';
import { PrimaryButton } from '../../components/brand/PrimaryButton';
import { seasonCode, usePublicConfig } from '../../hooks/usePublicConfig';

const STEPS: OnboardingStep[] = [
  { title: 'Cuenta', hint: 'Email y contraseña' },
  { title: 'Equipo', hint: 'Nombre y club' },
  { title: 'Escudo', hint: 'Colores e iniciales' },
];

type FieldErrors = Record<string, string>;

const fieldErrorsFrom = (err: unknown): FieldErrors =>
  err instanceof ApiError && Array.isArray(err.details)
    ? Object.fromEntries((err.details as { field: string; message: string }[]).map((f) => [f.field, f.message]))
    : {};

/**
 * Registro en 3 fases (diseño de Figma "Crear cuenta"):
 * 1. Cuenta → POST /auth/register (crea la cuenta e inicia sesión)
 * 2. Equipo → nombre y club favorito
 * 3. Escudo → POST /team + PATCH /users/me
 * Si el usuario abandona tras la fase 1, al volver continúa en la fase 2.
 */
export default function Register() {
  const { user, loading, register, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: config } = usePublicConfig();
  const { data: clubs } = useQuery({ queryKey: ['clubs'], queryFn: () => api.get<Club[]>('/clubs') });

  const [step, setStep] = useState(0);
  const [account, setAccount] = useState({ email: '', managerName: '', password: '' });
  const [accepted, setAccepted] = useState(false);
  const [team, setTeam] = useState({ name: '', favoriteClubId: null as number | null });
  const [crest, setCrest] = useState<Crest>(DEFAULT_CREST);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);

  /** Al corregir un campo desaparece su error (y el error general del formulario). */
  const clearError = (...keys: string[]) =>
    setErrors((prev) => {
      if (!keys.some((k) => k in prev) && !prev.form) return prev;
      const next = { ...prev };
      for (const k of [...keys, 'form']) delete next[k];
      return next;
    });
  const updateAccount = (key: keyof typeof account, value: string) => {
    setAccount((a) => ({ ...a, [key]: value }));
    clearError(key);
  };

  if (loading) return <AuthLoading />;
  if (user?.team && !finishing) return <Navigate to="/dashboard" replace />;

  // Con sesión iniciada y sin equipo, el onboarding continúa desde la fase 2
  const current = user ? Math.max(step, 1) : 0;
  const chip = config ? `ID: ${seasonCode(config.season)}` : undefined;
  const registrationClosed = config?.registrationOpen === false && !user;

  const submitAccount = async (e: FormEvent) => {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(account.email.trim())) next.email = 'Introduce un email válido';
    if (account.managerName.trim().length < 3) next.managerName = 'Mínimo 3 caracteres';
    if (!passwordRules(account.password).every((r) => r.ok)) next.password = 'La contraseña no cumple los requisitos';
    if (!accepted) next.terms = 'Debes aceptar las reglas del torneo y la política de privacidad';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await register({ email: account.email.trim(), managerName: account.managerName.trim(), password: account.password });
      setStep(1);
      toast.push('success', '¡Cuenta creada! Ahora crea tu equipo.');
    } catch (err) {
      setErrors({ ...fieldErrorsFrom(err), form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submitTeam = (e: FormEvent) => {
    e.preventDefault();
    if (team.name.trim().length < 3) {
      setErrors({ teamName: 'El nombre del equipo debe tener al menos 3 caracteres' });
      return;
    }
    setErrors({});
    setStep(2);
  };

  const submitCrest = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFinishing(true);
    try {
      const created = await api.post<{ economyVersion: number }>('/team', { name: team.name.trim(), crest: { ...crest, initials: crest.initials || undefined } });
      if (team.favoriteClubId) await api.patch('/users/me', { favoriteClubId: team.favoriteClubId });
      // Economía de liga: el equipo inicial llega al crear o unirse a una liga
      navigate(created.economyVersion === 2 ? '/leagues' : '/market', { replace: true });
      toast.push(
        'success',
        created.economyVersion === 2
          ? `¡${team.name.trim()} está listo! Crea una liga o únete a una para recibir tu equipo inicial.`
          : `¡${team.name.trim()} está listo! ${config ? `Ficha a tus ${config.squadSize} jugadores.` : 'Ficha a tu plantilla.'}`,
      );
      void refresh();
    } catch (err) {
      setFinishing(false);
      const fields = fieldErrorsFrom(err);
      setErrors({ ...fields, form: errorMessage(err) });
      if (fields.name) setStep(1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={['Crea tu equipo.', 'Compite con', 'tus amigos.']}
      subtitle="Construye tu plantilla, consigue puntos cada jornada y demuestra quién domina tu liga."
      onboarding={<OnboardingProgress steps={STEPS} current={current} />}
    >
      <GlassPanel className="px-5 py-7 sm:p-10">
        {current === 0 && (
          <>
            <FormHeader step="Paso 01 / Registro" chip={chip} title="Crea tu cuenta" subtitle="Empieza tu camino hacia la cima." />
            {registrationClosed ? (
              <div className="mt-8">
                <FormError>El registro de nuevos mánagers está cerrado temporalmente. Vuelve a intentarlo más tarde.</FormError>
              </div>
            ) : (
              <form onSubmit={submitAccount} className="mt-8 space-y-5" noValidate>
                <InputField
                  label="Email"
                  icon={AtSign}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  placeholder="manager@ejemplo.com"
                  value={account.email}
                  onChange={(e) => updateAccount('email', e.target.value)}
                  error={errors.email}
                />
                <InputField
                  label="Nombre de mánager"
                  hint="Visible en tu liga"
                  icon={UserRound}
                  autoComplete="nickname"
                  required
                  maxLength={30}
                  placeholder="Ej. KloppTactics o PepMaster"
                  value={account.managerName}
                  onChange={(e) => updateAccount('managerName', e.target.value)}
                  error={errors.managerName}
                />
                <div className="space-y-3">
                  <PasswordField
                    label="Contraseña"
                    icon={LockKeyhole}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••"
                    value={account.password}
                    onChange={(e) => updateAccount('password', e.target.value)}
                    error={errors.password}
                  />
                  <PasswordRequirements password={account.password} />
                </div>
                <div className="pt-1">
                  <TermsCheckbox
                    checked={accepted}
                    onChange={(v) => {
                      setAccepted(v);
                      clearError('terms');
                    }}
                    error={errors.terms}
                  />
                </div>
                {errors.form && <FormError>{errors.form}</FormError>}
                <div className="pt-2">
                  <PrimaryButton type="submit" loading={busy}>
                    Crear cuenta
                  </PrimaryButton>
                </div>
              </form>
            )}
            <AuthSwitch question="¿Ya tienes cuenta?" to="/login" label="Inicia sesión" />
          </>
        )}

        {current === 1 && (
          <>
            <FormHeader step="Paso 02 / Equipo" chip={chip} title="Crea tu equipo" subtitle={`Hola, ${user?.managerName ?? 'mánager'}. Ponle nombre a tu equipo y elige tu club favorito.`} />
            <form onSubmit={submitTeam} className="mt-8 space-y-6" noValidate>
              <InputField
                label="Nombre del equipo"
                hint="Visible en las clasificaciones"
                icon={Shield}
                required
                maxLength={30}
                placeholder="Ej. Real Sofá FC"
                value={team.name}
                onChange={(e) => {
                  setTeam({ ...team, name: e.target.value });
                  clearError('teamName', 'name');
                }}
                error={errors.teamName ?? errors.name}
              />
              <fieldset>
                <legend className="label-tech text-brand-lilac">
                  Club favorito <span className="normal-case tracking-normal text-brand-lilac/60">(opcional)</span>
                </legend>
                <div className="mt-3 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                  {clubs?.map((c) => {
                    const selected = team.favoriteClubId === c.id;
                    return (
                      <button
                        type="button"
                        key={c.id}
                        aria-pressed={selected}
                        title={c.name}
                        onClick={() => setTeam({ ...team, favoriteClubId: selected ? null : c.id })}
                        className={clsx(
                          'flex flex-col items-center gap-1 rounded-xl border p-2 transition',
                          selected ? 'border-pitch-400 bg-pitch-500/15 shadow-[0_0_18px_-6px_rgb(44_229_153/0.7)]' : 'border-white/10 bg-white/[0.04] hover:border-white/30',
                        )}
                      >
                        <ClubCrest club={c} size={32} />
                        <span className="font-tech text-[10px] font-bold text-white/80">{c.shortName}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {errors.form && <FormError>{errors.form}</FormError>}
              <PrimaryButton type="submit">Continuar</PrimaryButton>
            </form>
          </>
        )}

        {current === 2 && (
          <>
            <FormHeader step="Paso 03 / Escudo" chip={chip} title="Diseña tu escudo" subtitle="Así te verán tus rivales en las ligas y la clasificación." />
            <form onSubmit={submitCrest} className="mt-8 space-y-6" noValidate>
              <CrestEditor value={crest} onChange={setCrest} teamName={team.name} />
              {errors.form && <FormError>{errors.form}</FormError>}
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex h-[3.6rem] items-center justify-center gap-2 rounded-2xl border border-white/20 px-5 font-semibold text-white/85 transition hover:bg-white/[0.08] sm:h-[3.75rem]"
                >
                  <ArrowLeft aria-hidden className="size-4" /> Atrás
                </button>
                <PrimaryButton type="submit" loading={busy} className="sm:flex-1">
                  Crear mi equipo
                </PrimaryButton>
              </div>
            </form>
          </>
        )}
      </GlassPanel>
    </AuthLayout>
  );
}

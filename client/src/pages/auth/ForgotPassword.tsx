import { useState, type FormEvent } from 'react';
import { AtSign, MailCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import AuthLayout from '../../components/auth/AuthLayout';
import { AuthSwitch, FormError, FormHeader } from '../../components/auth/FormHeader';
import { GlassPanel } from '../../components/brand/GlassPanel';
import { InputField } from '../../components/brand/forms';
import { PrimaryButton } from '../../components/brand/PrimaryButton';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={['Recupera', 'tu acceso', 'en segundos.']} subtitle="Te enviaremos un enlace seguro para crear una contraseña nueva y volver a tu equipo.">
      <GlassPanel className="px-5 py-7 sm:p-10">
        <FormHeader step="Acceso / Recuperación" title="Recuperar contraseña" subtitle="Escribe el email con el que te registraste." />
        {sent ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-pitch-500/30 bg-pitch-500/10 p-6 text-center" role="status">
            <MailCheck aria-hidden className="size-10 text-pitch-400" />
            <p className="font-semibold text-white">Revisa tu bandeja de entrada</p>
            <p className="text-sm text-brand-lilac">Si {email} está registrado, recibirás un enlace válido durante 1 hora.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <InputField
              label="Email"
              icon={AtSign}
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="manager@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <FormError>{error}</FormError>}
            <div className="pt-2">
              <PrimaryButton type="submit" loading={loading} disabled={!email}>
                Enviar enlace
              </PrimaryButton>
            </div>
          </form>
        )}
        <AuthSwitch question="¿Ya la recordaste?" to="/login" label="Inicia sesión" />
      </GlassPanel>
    </AuthLayout>
  );
}

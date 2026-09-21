import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import AuthLayout from '../../components/auth/AuthLayout';
import { AuthSwitch, FormError, FormHeader } from '../../components/auth/FormHeader';
import { GlassPanel } from '../../components/brand/GlassPanel';
import { PasswordField, PasswordRequirements, passwordRules } from '../../components/brand/forms';
import { PrimaryButton } from '../../components/brand/PrimaryButton';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordRules(password).every((r) => r.ok)) return setError('La contraseña no cumple los requisitos');
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      toast.push('success', 'Contraseña actualizada. Ya puedes iniciar sesión.');
      navigate('/login');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={['Nueva', 'contraseña,', 'mismo equipo.']} subtitle="Elige una contraseña segura y vuelve a competir con tus amigos.">
      <GlassPanel className="px-5 py-7 sm:p-10">
        <FormHeader step="Acceso / Nueva contraseña" title="Nueva contraseña" subtitle="Mínimo 8 caracteres, con al menos una letra y un número." />
        {!token ? (
          <div className="mt-8">
            <FormError>El enlace no es válido. Solicita uno nuevo desde «¿Olvidaste tu contraseña?».</FormError>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <div className="space-y-3">
              <PasswordField label="Nueva contraseña" icon={LockKeyhole} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <PasswordRequirements password={password} />
            </div>
            <PasswordField label="Repite la contraseña" icon={LockKeyhole} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <FormError>{error}</FormError>}
            <div className="pt-2">
              <PrimaryButton type="submit" loading={loading} disabled={!password || !confirm}>
                Guardar contraseña
              </PrimaryButton>
            </div>
          </form>
        )}
        <AuthSwitch question="¿Recordaste tu contraseña?" to="/login" label="Inicia sesión" />
      </GlassPanel>
    </AuthLayout>
  );
}

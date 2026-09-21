import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AtSign, LockKeyhole } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api';
import { homeFor } from '../../lib/routes';
import AuthLayout from '../../components/auth/AuthLayout';
import { AuthSwitch, FormError, FormHeader } from '../../components/auth/FormHeader';
import { GlassPanel } from '../../components/brand/GlassPanel';
import { InputField, PasswordField } from '../../components/brand/forms';
import { PrimaryButton } from '../../components/brand/PrimaryButton';
import { seasonCode, usePublicConfig } from '../../hooks/usePublicConfig';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: config } = usePublicConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(user.team && from ? from : homeFor(user), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title={['Vuelve al', 'campo,', 'mánager.']} subtitle="Revisa tu alineación, ficha en el mercado y sigue en directo la clasificación de tus ligas.">
      <GlassPanel className="px-5 py-7 sm:p-10">
        <FormHeader step="Acceso / Iniciar sesión" chip={config ? `ID: ${seasonCode(config.season)}` : undefined} title="Inicia sesión" subtitle="Tu equipo te está esperando." />
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
          <div>
            <PasswordField
              label="Contraseña"
              icon={LockKeyhole}
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <Link to="/forgot-password" className="font-tech text-sm font-semibold text-pitch-400 transition hover:text-pitch-300">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          </div>
          {error && <FormError>{error}</FormError>}
          <div className="pt-2">
            <PrimaryButton type="submit" loading={loading} disabled={!email || !password}>
              Entrar
            </PrimaryButton>
          </div>
        </form>
        <AuthSwitch question="¿Aún no tienes equipo?" to="/register" label="Crea tu cuenta" />
      </GlassPanel>
    </AuthLayout>
  );
}

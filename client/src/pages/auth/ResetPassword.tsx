import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input } from '../../components/ui';
import AuthShell from './AuthShell';

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
    <AuthShell title="Nueva contraseña" subtitle="Mínimo 8 caracteres, con al menos una letra y un número." footer={<Link to="/login" className="font-semibold text-pitch-400">Volver a iniciar sesión</Link>}>
      {!token ? (
        <p className="text-sm text-red-400">El enlace no es válido. Solicita uno nuevo desde «¿Olvidaste tu contraseña?».</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nueva contraseña">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Repite la contraseña">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!password || !confirm}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Button, Field, Input } from '../../components/ui';
import AuthShell from './AuthShell';

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
    <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una nueva contraseña." footer={<Link to="/login" className="font-semibold text-pitch-400">Volver a iniciar sesión</Link>}>
      {sent ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <MailCheck className="size-10 text-pitch-400" />
          <p className="font-semibold text-white">Revisa tu bandeja de entrada</p>
          <p className="text-sm text-slate-400">Si {email} está registrado, recibirás un enlace válido durante 1 hora.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!email}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

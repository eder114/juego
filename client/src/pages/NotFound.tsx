import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <p className="stat-number text-8xl text-pitch-400">404</p>
      <h1 className="mt-2 text-3xl font-extrabold uppercase">Fuera de juego</h1>
      <p className="mt-2 text-slate-400">La página que buscas no existe.</p>
      <Link to="/dashboard" className="mt-6">
        <Button>Volver al inicio</Button>
      </Link>
    </div>
  );
}

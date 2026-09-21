import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../../lib/api';

const STATES = {
  checking: { dot: 'bg-white/40 animate-pulse', text: 'Comprobando servidores…' },
  up: { dot: 'bg-pitch-500 shadow-[0_0_10px_#2ce599]', text: 'Servidores Fantasy Activos' },
  seeding: { dot: 'bg-amber-400 animate-pulse', text: 'Cargando la temporada…' },
  down: { dot: 'bg-red-500', text: 'Servidores sin conexión' },
};

/** Estado real del servidor (consulta /api/health). */
export function ServerStatus() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string; seeding: boolean }>('/health'),
    refetchInterval: 60_000,
    retry: 1,
  });
  const state = STATES[isLoading ? 'checking' : isError ? 'down' : data?.seeding ? 'seeding' : 'up'];
  return (
    <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-white/90 sm:text-[0.95rem]">
      <span aria-hidden className={clsx('size-2.5 shrink-0 rounded-full', state.dot)} />
      <span className="truncate">{state.text}</span>
    </p>
  );
}

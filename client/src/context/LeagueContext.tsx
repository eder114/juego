import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import type { TeamSummary } from '../types';

const STORAGE_KEY = 'pf_active_league';

interface LeagueState {
  /** Liga con la que trabaja la aplicación en este momento */
  activeLeagueId: number | null;
  /** Equipo del mánager en esa liga */
  activeTeam: TeamSummary | null;
  teams: TeamSummary[];
  setActiveLeague: (leagueId: number) => void;
  /** Añade ?league= a una ruta de la API */
  withLeague: (path: string) => string;
}

const LeagueContext = createContext<LeagueState | null>(null);

const readStored = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
};

/**
 * Liga activa de la aplicación. Cada liga tiene su propio equipo, así que todas las pantallas piden
 * los datos de la liga seleccionada; al cambiarla se descarta la caché para no mostrar datos de la anterior.
 */
export function LeagueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [stored, setStored] = useState<number | null>(readStored);
  const teams = useMemo(() => user?.teams ?? [], [user]);

  // La liga guardada solo vale si el mánager sigue teniendo equipo en ella
  const activeTeam = useMemo(() => teams.find((t) => t.leagueId === stored) ?? teams[0] ?? null, [teams, stored]);
  const activeLeagueId = activeTeam?.leagueId ?? null;

  useEffect(() => {
    try {
      if (activeLeagueId) localStorage.setItem(STORAGE_KEY, String(activeLeagueId));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [activeLeagueId]);

  const setActiveLeague = useCallback(
    (leagueId: number) => {
      if (leagueId === activeLeagueId) return;
      setStored(leagueId);
      // Los datos de la liga anterior no deben verse ni un instante
      qc.removeQueries();
    },
    [activeLeagueId, qc],
  );

  const withLeague = useCallback(
    (path: string) => (activeLeagueId ? `${path}${path.includes('?') ? '&' : '?'}league=${activeLeagueId}` : path),
    [activeLeagueId],
  );

  const value = useMemo(
    () => ({ activeLeagueId, activeTeam, teams, setActiveLeague, withLeague }),
    [activeLeagueId, activeTeam, teams, setActiveLeague, withLeague],
  );
  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague() {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error('useLeague debe usarse dentro de LeagueProvider');
  return ctx;
}

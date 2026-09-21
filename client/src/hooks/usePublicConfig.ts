import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Position } from '../types';

/** Configuración pública del juego (valores reales definidos por el administrador). */
export interface PublicConfig {
  season: string;
  initialBudget: number;
  squad: Record<Position, number>;
  squadSize: number;
  starters: number;
  maxPerClub: number;
  captainMultiplier: number;
  viceCaptainEnabled: boolean;
  autoSubs: boolean;
  lockMode: 'PER_MATCH' | 'DEADLINE';
  registrationOpen: boolean;
  /** Economía de liga (importes en miles de £) */
  economy: {
    enabled: boolean;
    initialBudgetK: number;
    starterPlayers: number;
    starterBench: number;
    maxSquad: number;
    playersPerMarket: number;
    coachesMin: number;
    coachesMax: number;
    sellPercent: number;
  };
  scoring: { position: Position; action: string; label: string; mode: string; points: number; threshold: number }[];
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/config'), staleTime: 5 * 60_000 });
}

/** Condiciones de entrada en una liga según la configuración vigente (se muestran en los textos de ayuda). */
export function useEconomyTerms() {
  const { data } = usePublicConfig();
  const k = data?.economy.initialBudgetK;
  return {
    players: data ? `${data.economy.starterPlayers} jugadores reales` : 'tu equipo inicial',
    budget: k !== undefined ? (k % 1000 === 0 ? `£${k / 1000}M` : `£${(k / 1000).toFixed(1)}M`) : 'tu presupuesto inicial',
  };
}

/** £100M en lugar de £100.0M cuando la cifra es redonda. */
export const formatBudget = (tenths: number) => (tenths % 10 === 0 ? `£${tenths / 10}M` : `£${(tenths / 10).toFixed(1)}M`);

/** "2026/27" → "PL-2627" */
export const seasonCode = (season: string) => `PL-${season.replace(/\D/g, '').slice(2)}`;

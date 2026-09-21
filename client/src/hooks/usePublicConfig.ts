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
  scoring: { position: Position; action: string; label: string; mode: string; points: number; threshold: number }[];
}

export function usePublicConfig() {
  return useQuery({ queryKey: ['public-config'], queryFn: () => api.get<PublicConfig>('/config'), staleTime: 5 * 60_000 });
}

/** £100M en lugar de £100.0M cuando la cifra es redonda. */
export const formatBudget = (tenths: number) => (tenths % 10 === 0 ? `£${tenths / 10}M` : `£${(tenths / 10).toFixed(1)}M`);

/** "2026/27" → "PL-2627" */
export const seasonCode = (season: string) => `PL-${season.replace(/\D/g, '').slice(2)}`;

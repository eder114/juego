import type { AppNotification, Crest, Fixture, News, Player, StandingRow } from '../../types';

/** Respuesta de GET /api/dashboard (server/src/services/stats.service.ts → dashboard). */
export interface DashboardData {
  team: { id: number; name: string; crest: Crest } | null;
  lastGameweekPoints: number;
  lastGameweekId: number | null;
  totalPoints: number;
  globalRank: number | null;
  globalMovement: 'up' | 'down' | 'same' | 'new';
  totalManagers: number;
  teamValue: number;
  /** Clásico: décimas de millón · economía de liga: miles de £ (monedero) */
  budget: number;
  economyVersion: 1 | 2;
  economyLeague: { id: number; name: string } | null;
  squadCount: number;
  squadSize: number;
  currentGameweek: { id: number; name: string; status: string; deadline: string } | null;
  nextGameweek: { id: number; name: string; deadline: string } | null;
  editableGameweek: { id: number; name: string; deadline: string } | null;
  nextFixture: Fixture | null;
  upcomingFixtures: Fixture[];
  featuredPlayers: Player[];
  history: { gameweek: number; points: number; average: number; highest: number }[];
  news: News[];
  notifications: AppNotification[];
  alerts: DashboardAlert[];
  leaders: StandingRow[];
}

export interface DashboardAlert {
  level: 'danger' | 'warning' | 'info';
  title: string;
  message: string;
  link: string;
}

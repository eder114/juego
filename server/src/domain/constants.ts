export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  GK: 'Portero',
  DEF: 'Defensa',
  MID: 'Centrocampista',
  FWD: 'Delantero',
};

export const FORMATIONS = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'] as const;
export type Formation = (typeof FORMATIONS)[number];

export const PLAYER_STATUSES = ['AVAILABLE', 'DOUBTFUL', 'INJURED', 'SUSPENDED', 'UNAVAILABLE'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];
/** Estados que impiden alinear a un jugador como titular. */
export const BLOCKING_STATUSES: PlayerStatus[] = ['INJURED', 'SUSPENDED', 'UNAVAILABLE'];

export const GAMEWEEK_STATUSES = ['UPCOMING', 'LIVE', 'FINISHED'] as const;
export const FIXTURE_STATUSES = ['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED'] as const;
export const LEAGUE_TYPES = ['GLOBAL', 'PUBLIC', 'PRIVATE', 'FRIENDS', 'INVITE'] as const;
export type LeagueType = (typeof LEAGUE_TYPES)[number];
export const INJURY_TYPES = ['INJURY', 'SUSPENSION', 'ILLNESS', 'OTHER'] as const;
export const NEWS_CATEGORIES = ['GENERAL', 'INJURY', 'TRANSFER', 'GAMEWEEK', 'MARKET'] as const;
export const PRICE_REASONS = ['INITIAL', 'PERFORMANCE', 'DEMAND', 'ADMIN', 'IMPORT', 'SYNC'] as const;

/** Estadísticas objetivas de un jugador en un partido. */
export interface StatLine {
  minutes: number;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
}

export type ScoringMode = 'appearance' | 'minutes_threshold' | 'per_unit' | 'clean_sheet';

export interface ScoringActionDef {
  label: string;
  mode: ScoringMode;
  stat?: keyof StatLine;
  /** Qué significa `threshold` para esta acción (se muestra en el panel admin). */
  thresholdHint?: string;
  defaultThreshold: number;
}

/**
 * Catálogo de acciones puntuables. Las reglas concretas (puntos, umbral, activa)
 * viven en la tabla scoring_rules y se editan desde el panel de administración.
 */
export const SCORING_ACTIONS: Record<string, ScoringActionDef> = {
  minutes_played: { label: 'Partido jugado', mode: 'appearance', defaultThreshold: 1, thresholdHint: 'Minutos mínimos' },
  minutes_60: { label: 'Jugó 60 minutos o más', mode: 'minutes_threshold', defaultThreshold: 60, thresholdHint: 'Minutos mínimos' },
  goal: { label: 'Gol', mode: 'per_unit', stat: 'goals', defaultThreshold: 1, thresholdHint: 'Goles por bloque' },
  assist: { label: 'Asistencia', mode: 'per_unit', stat: 'assists', defaultThreshold: 1, thresholdHint: 'Asistencias por bloque' },
  clean_sheet: { label: 'Portería a cero', mode: 'clean_sheet', defaultThreshold: 60, thresholdHint: 'Minutos mínimos jugados' },
  goals_conceded: { label: 'Gol recibido', mode: 'per_unit', stat: 'goalsConceded', defaultThreshold: 1, thresholdHint: 'Goles recibidos por bloque' },
  penalty_saved: { label: 'Penalti atajado', mode: 'per_unit', stat: 'penaltiesSaved', defaultThreshold: 1, thresholdHint: 'Penaltis por bloque' },
  penalty_missed: { label: 'Penalti fallado', mode: 'per_unit', stat: 'penaltiesMissed', defaultThreshold: 1, thresholdHint: 'Penaltis por bloque' },
  saves: { label: 'Paradas', mode: 'per_unit', stat: 'saves', defaultThreshold: 3, thresholdHint: 'Paradas por bloque' },
  yellow_card: { label: 'Tarjeta amarilla', mode: 'per_unit', stat: 'yellowCards', defaultThreshold: 1, thresholdHint: 'Tarjetas por bloque' },
  red_card: { label: 'Tarjeta roja', mode: 'per_unit', stat: 'redCards', defaultThreshold: 1, thresholdHint: 'Tarjetas por bloque' },
  own_goal: { label: 'Gol en propia puerta', mode: 'per_unit', stat: 'ownGoals', defaultThreshold: 1, thresholdHint: 'Autogoles por bloque' },
  bonus: { label: 'Bonus de rendimiento', mode: 'per_unit', stat: 'bonus', defaultThreshold: 1, thresholdHint: 'Puntos bonus por bloque' },
};

export interface DefaultRule {
  position: Position;
  action: string;
  points: number;
  isActive: boolean;
  threshold?: number;
}

const r = (position: Position, action: string, points: number, isActive = true, threshold?: number): DefaultRule => ({
  position,
  action,
  points,
  isActive,
  threshold,
});

/** Reglas por defecto (las del enunciado activas; extras desactivadas para que el admin decida). */
export const DEFAULT_SCORING_RULES: DefaultRule[] = [
  // Porteros
  r('GK', 'minutes_60', 2),
  r('GK', 'minutes_played', 1, false),
  r('GK', 'clean_sheet', 4),
  r('GK', 'goals_conceded', -1),
  r('GK', 'penalty_saved', 5),
  r('GK', 'assist', 3),
  r('GK', 'goal', 10),
  r('GK', 'yellow_card', -1),
  r('GK', 'red_card', -3),
  r('GK', 'own_goal', -2),
  r('GK', 'saves', 1, false, 3),
  r('GK', 'penalty_missed', -2, false),
  r('GK', 'bonus', 1, false),
  // Defensas
  r('DEF', 'minutes_played', 2),
  r('DEF', 'minutes_60', 1, false),
  r('DEF', 'clean_sheet', 4),
  r('DEF', 'goal', 6),
  r('DEF', 'assist', 3),
  r('DEF', 'yellow_card', -1),
  r('DEF', 'red_card', -3),
  r('DEF', 'own_goal', -2),
  r('DEF', 'goals_conceded', -1, false, 2),
  r('DEF', 'penalty_missed', -2, false),
  r('DEF', 'bonus', 1, false),
  // Centrocampistas
  r('MID', 'minutes_played', 2),
  r('MID', 'minutes_60', 1, false),
  r('MID', 'goal', 5),
  r('MID', 'assist', 3),
  r('MID', 'clean_sheet', 1),
  r('MID', 'yellow_card', -1),
  r('MID', 'red_card', -3),
  r('MID', 'own_goal', -2, false),
  r('MID', 'penalty_missed', -2, false),
  r('MID', 'bonus', 1, false),
  // Delanteros
  r('FWD', 'minutes_played', 2),
  r('FWD', 'minutes_60', 1, false),
  r('FWD', 'goal', 4),
  r('FWD', 'assist', 3),
  r('FWD', 'yellow_card', -1),
  r('FWD', 'red_card', -3),
  r('FWD', 'own_goal', -2, false),
  r('FWD', 'penalty_missed', -2, false),
  r('FWD', 'bonus', 1, false),
];

export type SettingType = 'number' | 'boolean' | 'string' | 'select' | 'money';

export interface SettingDef {
  value: unknown;
  label: string;
  group: 'Temporada' | 'Plantilla' | 'Alineación' | 'Mercado' | 'Precios' | 'Datos' | 'Usuarios';
  type: SettingType;
  options?: string[];
  min?: number;
  max?: number;
}

/** Configuración general editable desde el panel de administración. */
export const SETTINGS_DEFS = {
  season: { value: '2026/27', label: 'Temporada activa', group: 'Temporada', type: 'string' },
  initial_budget: { value: 1000, label: 'Presupuesto inicial', group: 'Plantilla', type: 'money', min: 100, max: 5000 },
  squad_gk: { value: 2, label: 'Porteros en plantilla', group: 'Plantilla', type: 'number', min: 1, max: 5 },
  squad_def: { value: 5, label: 'Defensas en plantilla', group: 'Plantilla', type: 'number', min: 3, max: 8 },
  squad_mid: { value: 5, label: 'Centrocampistas en plantilla', group: 'Plantilla', type: 'number', min: 3, max: 8 },
  squad_fwd: { value: 3, label: 'Delanteros en plantilla', group: 'Plantilla', type: 'number', min: 1, max: 6 },
  max_players_per_club: { value: 3, label: 'Máximo de jugadores por club', group: 'Plantilla', type: 'number', min: 1, max: 15 },
  captain_multiplier: { value: 2, label: 'Multiplicador del capitán', group: 'Alineación', type: 'number', min: 1, max: 3 },
  vice_captain_enabled: { value: true, label: 'El vicecapitán hereda el multiplicador si el capitán no juega', group: 'Alineación', type: 'boolean' },
  auto_subs_enabled: { value: true, label: 'Sustituciones automáticas', group: 'Alineación', type: 'boolean' },
  lock_mode: {
    value: 'PER_MATCH',
    label: 'Bloqueo de alineaciones',
    group: 'Alineación',
    type: 'select',
    options: ['PER_MATCH', 'DEADLINE'],
  },
  market_open: { value: true, label: 'Mercado abierto', group: 'Mercado', type: 'boolean' },
  sell_at_purchase_price: { value: false, label: 'Vender al precio de compra (en lugar del precio actual)', group: 'Mercado', type: 'boolean' },
  auto_price_update: { value: true, label: 'Actualizar precios al cerrar cada jornada', group: 'Precios', type: 'boolean' },
  price_rise_points: { value: 6, label: 'Puntos para subida (+£0.1M)', group: 'Precios', type: 'number', min: 1, max: 30 },
  price_rise_points_high: { value: 10, label: 'Puntos para subida fuerte (+£0.2M)', group: 'Precios', type: 'number', min: 1, max: 40 },
  price_fall_points: { value: 1, label: 'Puntos o menos para bajada (-£0.1M)', group: 'Precios', type: 'number', min: -10, max: 10 },
  price_demand_ratio: { value: 0.1, label: 'Ratio de demanda (fichajes netos / equipos) para ±£0.1M', group: 'Precios', type: 'number', min: 0.01, max: 1 },
  price_max_change: { value: 3, label: 'Cambio máximo por jornada (décimas)', group: 'Precios', type: 'number', min: 1, max: 10 },
  price_min: { value: 35, label: 'Precio mínimo', group: 'Precios', type: 'money', min: 10, max: 100 },
  price_max: { value: 200, label: 'Precio máximo', group: 'Precios', type: 'money', min: 50, max: 400 },
  provider_auto_sync: { value: false, label: 'Sincronización automática con la API de FPL (cada 15 min)', group: 'Datos', type: 'boolean' },
  registration_open: { value: true, label: 'Registro de usuarios abierto', group: 'Usuarios', type: 'boolean' },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS_DEFS;
export type Settings = { [K in SettingKey]: (typeof SETTINGS_DEFS)[K]['value'] };

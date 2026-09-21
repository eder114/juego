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

/**
 * Tipos de ajuste: money = décimas de millón (sistema clásico) · moneyk = miles de £ (economía de liga)
 * text = lista multilínea · json = estructura validada por el servidor · timezone = zona IANA.
 */
export type SettingType = 'number' | 'boolean' | 'string' | 'select' | 'money' | 'moneyk' | 'text' | 'json' | 'timezone';

export interface SettingDef {
  value: unknown;
  label: string;
  group:
    | 'Temporada'
    | 'Plantilla'
    | 'Alineación'
    | 'Mercado'
    | 'Precios'
    | 'Datos'
    | 'Usuarios'
    | 'Economía de liga'
    | 'Equipo inicial'
    | 'Mercado de liga'
    | 'Rareza'
    | 'Valoración'
    | 'Entrenadores'
    | 'Cartas'
    | 'Desafíos diarios';
  type: SettingType;
  options?: string[];
  min?: number;
  max?: number;
  hint?: string;
}

export const PLAYER_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'STAR'] as const;
export type PlayerRarity = (typeof PLAYER_RARITIES)[number];
export const CARD_RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];
export const CARD_EFFECTS = ['DOUBLE_POINTS', 'WEAKEN'] as const;
export type CardEffect = (typeof CARD_EFFECTS)[number];
export const CHALLENGE_TYPES = ['WORDLE'] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

/** Palabras iniciales del Wordle (5 letras, vocabulario futbolístico). Editables desde administración. */
export const DEFAULT_WORDLE_WORDS = [
  'BALON', 'CAMPO', 'FALTA', 'PENAL', 'GOLES', 'TIROS', 'PASES', 'CRACK', 'JUEGO', 'DUELO',
  'RIVAL', 'LIDER', 'MARCA', 'DERBI', 'FINAL', 'GRADA', 'SOCIO', 'FICHA', 'VENTA', 'CARTA',
  'BANCO', 'PUNTO', 'TABLA', 'CHUTE', 'TOQUE', 'AMAGO', 'ZURDO', 'MEDIO', 'NUEVE', 'BOTAS',
  'GANAR', 'JUGAR', 'SAQUE', 'BANDA', 'LINEA', 'FORMA', 'RACHA', 'TACOS', 'HIMNO', 'PRIMA',
  'TRATO', 'FIRMA', 'PUJAR', 'VALLA', 'VELOZ', 'EXITO', 'HEROE', 'ASTRO', 'IDOLO', 'LIGAS',
  'COPAS', 'ARCOS', 'CORTO', 'LARGO', 'PALCO', 'PRESA', 'TECHO', 'MOVER', 'ROBAR', 'CESTA',
];

/** Hitos de racha por defecto (dinero en miles de £; card = código de carta del catálogo). */
export const DEFAULT_STREAK_MILESTONES = [
  { days: 3, money: 250, card: null },
  { days: 7, money: 500, card: 'DOUBLE_POINTS' },
  { days: 14, money: 750, card: null },
  { days: 30, money: 1000, card: 'PRESSURE' },
];

/** Catálogo inicial de cartas (el administrador puede editarlas o desactivarlas). */
export const DEFAULT_CARDS = [
  {
    code: 'DOUBLE_POINTS',
    name: 'Doble puntos',
    description: 'Elige un jugador de tu plantilla antes del cierre: sus puntos Fantasy de la jornada se multiplican por 2.',
    effect: 'DOUBLE_POINTS',
    rarity: 'RARE',
    effectValue: 200,
    target: 'OWN_PLAYER',
  },
  {
    code: 'PRESSURE',
    name: 'Presión',
    description: 'Elige un jugador de un rival de tu liga antes del cierre: pierde un porcentaje de sus puntos Fantasy positivos de la jornada. Sus estadísticas reales no cambian.',
    effect: 'WEAKEN',
    rarity: 'EPIC',
    effectValue: 20,
    target: 'RIVAL_PLAYER',
  },
] as const;

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

  // ─────────────── Economía de liga (v2) ───────────────
  economy_v2_new_leagues: { value: true, label: 'Las ligas nuevas usan la economía de liga (mercado compartido)', group: 'Economía de liga', type: 'boolean' },
  economy_v2_new_teams: { value: true, label: 'Los equipos nuevos juegan la economía de liga (reciben equipo inicial al entrar en una liga)', group: 'Economía de liga', type: 'boolean' },
  v2_initial_budget: { value: 100000, label: 'Presupuesto inicial', group: 'Economía de liga', type: 'moneyk', min: 0, max: 2000000 },
  v2_max_squad: { value: 18, label: 'Máximo de jugadores en plantilla', group: 'Economía de liga', type: 'number', min: 11, max: 30 },
  v2_max_gk: { value: 3, label: 'Máximo de porteros', group: 'Economía de liga', type: 'number', min: 1, max: 6 },
  v2_max_def: { value: 7, label: 'Máximo de defensas', group: 'Economía de liga', type: 'number', min: 5, max: 12 },
  v2_max_mid: { value: 7, label: 'Máximo de centrocampistas', group: 'Economía de liga', type: 'number', min: 5, max: 12 },
  v2_max_fwd: { value: 5, label: 'Máximo de delanteros', group: 'Economía de liga', type: 'number', min: 3, max: 10 },
  v2_sell_percent: { value: 100, label: 'Venta: % del valor actual que recibe el vendedor', group: 'Economía de liga', type: 'number', min: 10, max: 100 },

  v2_starter_bench: { value: 2, label: 'Suplentes del equipo inicial (los titulares son siempre 11)', group: 'Equipo inicial', type: 'number', min: 0, max: 4 },
  v2_starter_formation: { value: 'RANDOM', label: 'Formación del equipo inicial', group: 'Equipo inicial', type: 'select', options: ['RANDOM', ...FORMATIONS] },
  v2_starter_w_common: { value: 60, label: 'Peso de rareza COMMON', group: 'Equipo inicial', type: 'number', min: 0, max: 100 },
  v2_starter_w_uncommon: { value: 28, label: 'Peso de rareza UNCOMMON', group: 'Equipo inicial', type: 'number', min: 0, max: 100 },
  v2_starter_w_rare: { value: 10, label: 'Peso de rareza RARE', group: 'Equipo inicial', type: 'number', min: 0, max: 100 },
  v2_starter_w_epic: { value: 2, label: 'Peso de rareza EPIC', group: 'Equipo inicial', type: 'number', min: 0, max: 100 },
  v2_starter_w_star: { value: 0, label: 'Peso de rareza STAR (0 = excluidas)', group: 'Equipo inicial', type: 'number', min: 0, max: 100 },

  market_players_per_cycle: { value: 10, label: 'Jugadores por mercado diario', group: 'Mercado de liga', type: 'number', min: 1, max: 30 },
  market_coaches_min: { value: 1, label: 'Entrenadores por mercado (mínimo)', group: 'Mercado de liga', type: 'number', min: 0, max: 5 },
  market_coaches_max: { value: 2, label: 'Entrenadores por mercado (máximo)', group: 'Mercado de liga', type: 'number', min: 0, max: 5 },
  market_default_timezone: { value: 'Europe/London', label: 'Zona horaria por defecto de las ligas nuevas', group: 'Mercado de liga', type: 'timezone' },
  market_max_same_position: { value: 5, label: 'Máximo de jugadores de la misma posición por mercado (diversidad)', group: 'Mercado de liga', type: 'number', min: 1, max: 30 },
  market_cooldown_hours: { value: 48, label: 'Horas hasta que un jugador vendido puede volver al mercado', group: 'Mercado de liga', type: 'number', min: 0, max: 720 },
  market_w_common: { value: 45, label: 'Probabilidad COMMON (%)', group: 'Mercado de liga', type: 'number', min: 0, max: 100 },
  market_w_uncommon: { value: 30, label: 'Probabilidad UNCOMMON (%)', group: 'Mercado de liga', type: 'number', min: 0, max: 100 },
  market_w_rare: { value: 18, label: 'Probabilidad RARE (%)', group: 'Mercado de liga', type: 'number', min: 0, max: 100 },
  market_w_epic: { value: 6, label: 'Probabilidad EPIC (%)', group: 'Mercado de liga', type: 'number', min: 0, max: 100 },
  market_w_star: { value: 1, label: 'Probabilidad STAR (%)', group: 'Mercado de liga', type: 'number', min: 0, max: 100 },
  pity_min_rarity: { value: 'EPIC', label: 'Pity: rareza que cuenta como «alta»', group: 'Mercado de liga', type: 'select', options: ['RARE', 'EPIC', 'STAR'] },
  pity_step_percent: { value: 25, label: 'Pity: aumento por cada día sin rareza alta (%)', group: 'Mercado de liga', type: 'number', min: 0, max: 200 },
  pity_max_multiplier: { value: 4, label: 'Pity: multiplicador máximo', group: 'Mercado de liga', type: 'number', min: 1, max: 20 },
  pity_hard_days: { value: 7, label: 'Pity: días para garantizar un jugador de rareza alta (0 = nunca)', group: 'Mercado de liga', type: 'number', min: 0, max: 60 },

  rarity_pct_star: { value: 3, label: 'STAR: % superior de jugadores', group: 'Rareza', type: 'number', min: 0, max: 50 },
  rarity_pct_epic: { value: 9, label: 'EPIC: % siguiente', group: 'Rareza', type: 'number', min: 0, max: 50 },
  rarity_pct_rare: { value: 18, label: 'RARE: % siguiente', group: 'Rareza', type: 'number', min: 0, max: 60 },
  rarity_pct_uncommon: { value: 30, label: 'UNCOMMON: % siguiente (el resto es COMMON)', group: 'Rareza', type: 'number', min: 0, max: 80 },
  rarity_w_value: { value: 50, label: 'Peso del valor de mercado', group: 'Rareza', type: 'number', min: 0, max: 100 },
  rarity_w_points: { value: 30, label: 'Peso de los puntos Fantasy de la temporada', group: 'Rareza', type: 'number', min: 0, max: 100 },
  rarity_w_form: { value: 20, label: 'Peso del rendimiento reciente', group: 'Rareza', type: 'number', min: 0, max: 100 },

  valuation_base: { value: 10000, label: 'Valor inicial de un jugador de £4.0M en FPL', group: 'Valoración', type: 'moneyk', min: 100, max: 100000, hint: 'Valor inicial = base × (precio FPL / 4.0)^exponente' },
  valuation_exponent: { value: 2.5, label: 'Exponente de la curva de valor inicial', group: 'Valoración', type: 'number', min: 1, max: 5 },
  value_min: { value: 500, label: 'Valor mínimo', group: 'Valoración', type: 'moneyk', min: 0, max: 100000 },
  value_max: { value: 250000, label: 'Valor máximo', group: 'Valoración', type: 'moneyk', min: 1000, max: 5000000 },
  valuation_sensitivity: { value: 4, label: 'Sensibilidad (% por cada desviación de rendimiento)', group: 'Valoración', type: 'number', min: 0, max: 50 },
  valuation_var_min: { value: -8, label: 'Variación mínima por jornada (%)', group: 'Valoración', type: 'number', min: -50, max: 0 },
  valuation_var_max: { value: 8, label: 'Variación máxima por jornada (%)', group: 'Valoración', type: 'number', min: 0, max: 50 },
  valuation_w_last: { value: 40, label: 'Peso de la última jornada', group: 'Valoración', type: 'number', min: 0, max: 100 },
  valuation_w_avg: { value: 40, label: 'Peso del promedio reciente', group: 'Valoración', type: 'number', min: 0, max: 100 },
  valuation_w_trend: { value: 20, label: 'Peso de la tendencia', group: 'Valoración', type: 'number', min: 0, max: 100 },
  valuation_window: { value: 5, label: 'Jornadas del promedio reciente', group: 'Valoración', type: 'number', min: 2, max: 10 },
  valuation_scale_points: { value: 6, label: 'Puntos que equivalen a una desviación de rendimiento', group: 'Valoración', type: 'number', min: 1, max: 30 },
  valuation_consistency: { value: 0.5, label: 'Amortiguación por irregularidad (0 = sin efecto)', group: 'Valoración', type: 'number', min: 0, max: 5 },
  valuation_elasticity: { value: 0.15, label: 'Elasticidad del valor (valores altos cambian menos en %)', group: 'Valoración', type: 'number', min: 0, max: 1 },
  valuation_min_change: { value: 0.3, label: 'Cambio mínimo para aplicar (%)', group: 'Valoración', type: 'number', min: 0, max: 5 },

  coach_value_factor: { value: 60, label: 'Valor inicial del entrenador (% del valor medio del once de su club)', group: 'Entrenadores', type: 'number', min: 1, max: 300 },
  coach_max_per_team: { value: 1, label: 'Entrenador por equipo (0 = desactivado)', group: 'Entrenadores', type: 'number', min: 0, max: 1 },
  coach_points_win: { value: 3, label: 'Puntos por victoria', group: 'Entrenadores', type: 'number', min: -10, max: 20 },
  coach_points_draw: { value: 1, label: 'Puntos por empate', group: 'Entrenadores', type: 'number', min: -10, max: 20 },
  coach_points_loss: { value: -1, label: 'Puntos por derrota', group: 'Entrenadores', type: 'number', min: -10, max: 20 },
  coach_points_clean_sheet: { value: 1, label: 'Puntos por portería a cero', group: 'Entrenadores', type: 'number', min: -10, max: 20 },
  coach_points_goal: { value: 0, label: 'Puntos por gol a favor', group: 'Entrenadores', type: 'number', min: -5, max: 5 },

  card_captain_stacking: {
    value: 'MAX',
    label: 'Doble puntos sobre el capitán',
    group: 'Cartas',
    type: 'select',
    options: ['MAX', 'STACK'],
    hint: 'MAX: se aplica el mayor multiplicador (sin acumular) · STACK: se multiplican',
  },
  card_max_active_per_gameweek: { value: 2, label: 'Cartas activas por equipo y jornada', group: 'Cartas', type: 'number', min: 0, max: 10 },
  card_weaken_max_per_target: { value: 1, label: 'Cartas de presión por jugador rival y jornada', group: 'Cartas', type: 'number', min: 1, max: 5 },

  challenge_timezone: { value: 'Europe/London', label: 'Zona horaria del reinicio diario', group: 'Desafíos diarios', type: 'timezone' },
  wordle_enabled: { value: true, label: 'Wordle diario activo', group: 'Desafíos diarios', type: 'boolean' },
  wordle_max_attempts: { value: 6, label: 'Intentos del Wordle', group: 'Desafíos diarios', type: 'number', min: 1, max: 10 },
  wordle_reward_1: { value: 1000, label: 'Premio acertando en el 1.er intento', group: 'Desafíos diarios', type: 'moneyk', min: 0, max: 100000 },
  wordle_reward_2: { value: 1000, label: 'Premio en el 2.º intento', group: 'Desafíos diarios', type: 'moneyk', min: 0, max: 100000 },
  wordle_reward_3: { value: 750, label: 'Premio en el 3.er intento', group: 'Desafíos diarios', type: 'moneyk', min: 0, max: 100000 },
  wordle_reward_4: { value: 750, label: 'Premio en el 4.º intento', group: 'Desafíos diarios', type: 'moneyk', min: 0, max: 100000 },
  wordle_reward_5: { value: 600, label: 'Premio en el 5.º intento', group: 'Desafíos diarios', type: 'moneyk', min: 0, max: 100000 },
  wordle_reward_6: { value: 500, label: 'Premio en el 6.º intento o posteriores', group: 'Desafíos diarios', type: 'moneyk', min: 0, max: 100000 },
  wordle_words: { value: DEFAULT_WORDLE_WORDS.join('\n'), label: 'Palabras del Wordle (una por línea, 5 letras)', group: 'Desafíos diarios', type: 'text' },
  streak_requires_win: { value: true, label: 'La racha solo cuenta los desafíos ganados', group: 'Desafíos diarios', type: 'boolean' },
  streak_milestones: {
    value: JSON.stringify(DEFAULT_STREAK_MILESTONES),
    label: 'Premios por racha',
    group: 'Desafíos diarios',
    type: 'json',
    hint: '[{"days":3,"money":250,"card":null}] · money en miles de £ · card = código de carta',
  },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS_DEFS;
export type Settings = { [K in SettingKey]: (typeof SETTINGS_DEFS)[K]['value'] };

/**
 * Fantasy Cards: catálogo y reglas
 * ────────────────────────────────
 * Aquí viven las definiciones de las cartas y la política de acumulación de sus efectos. Todo lo que
 * decide «cuánto suma o resta una carta» es una función pura de este módulo, para que el resultado sea
 * determinista y reproducible: a partir de los puntos oficiales y los modificadores registrados siempre
 * se puede reconstruir la puntuación.
 *
 * Las cartas pertenecen al EQUIPO, y un equipo es un (usuario, liga): el inventario, las activaciones y
 * los efectos nunca se mezclan entre ligas.
 */

export const CARD_CATEGORIES = ['BOOST', 'WEAKEN', 'DEFENSE', 'ECONOMY', 'TACTIC', 'LEGENDARY'] as const;
export type CardCategory = (typeof CARD_CATEGORIES)[number];

export const CARD_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
export type CardRarity = (typeof CARD_RARITIES)[number];

/** Cuándo se resuelve la carta. */
export const CARD_ACTIVATIONS = [
  'INSTANT', // al activarla (dinero)
  'PRE_GAMEWEEK', // queda ligada a la jornada y se resuelve al puntuar
  'REACTIVE', // espera a un evento compatible (escudos)
  'POST_SCORING', // se evalúa con los puntos ya calculados (apuestas, bonos por rendimiento)
] as const;
export type CardActivationType = (typeof CARD_ACTIVATIONS)[number];

/** A quién apunta la carta. Determina qué pide la interfaz y qué valida el servidor. */
export const CARD_TARGETS = [
  'NONE', // no necesita objetivo (dinero, escudos de equipo)
  'OWN_PLAYER',
  'OWN_GK',
  'OWN_FWD',
  'OWN_TEAM',
  'RIVAL_PLAYER',
  'RIVAL_FWD',
  'RIVAL_TEAM',
  'RIVAL_CAPTAIN',
] as const;
export type CardTarget = (typeof CARD_TARGETS)[number];

/** Efectos que el motor sabe resolver. Añadir uno exige implementarlo en el motor y en la puntuación. */
export const CARD_EFFECTS = [
  'DOUBLE_POINTS', // multiplica los puntos del jugador (effectValue = % , 200 = x2)
  'FLAT_BONUS', // suma effectValue puntos al jugador
  'TEAM_BONUS', // suma effectValue puntos a cada titular propio
  'WEAKEN', // resta un % de los puntos positivos del jugador rival
  'FLAT_PENALTY', // resta effectValue puntos a un jugador rival
  'TEAM_PENALTY', // resta effectValue puntos a cada titular rival
  'POSITION_PENALTY', // resta effectValue puntos a cada titular rival de una posición (config.position)
  'CAPTAIN_PENALTY', // reduce un % el extra de capitanía del rival
  'SHIELD', // reactiva: bloquea el siguiente ataque al equipo
  'IMMUNITY', // reactiva: protege a un jugador propio
  'CAPTAIN_SHIELD', // reactiva: protege al capitán propio
  'ANTIDOTE', // cancela un efecto negativo ya activo sobre el equipo
  'MONEY', // instantánea: abona effectValue k£
  'SCORE_BET', // post-puntuación: bonus si el jugador llega a config.threshold
  'TEAM_THRESHOLD_MONEY', // post-puntuación: dinero si el equipo llega a config.threshold
  'PLAYER_PERFORMANCE_MONEY', // post-puntuación: dinero proporcional a los puntos del jugador
  'RECOVER_POINTS', // post-puntuación: recupera puntos perdidos por cartas rivales
] as const;
export type CardEffect = (typeof CARD_EFFECTS)[number];

/** Efectos que un escudo o una inmunidad pueden bloquear (ataques dirigidos). */
export const ATTACK_EFFECTS: CardEffect[] = ['WEAKEN', 'FLAT_PENALTY', 'TEAM_PENALTY', 'POSITION_PENALTY', 'CAPTAIN_PENALTY'];
export const isAttack = (effect: string) => ATTACK_EFFECTS.includes(effect as CardEffect);

export interface CardDefinition {
  code: string;
  name: string;
  description: string;
  category: CardCategory;
  effect: CardEffect;
  rarity: CardRarity;
  effectValue: number;
  activation: CardActivationType;
  target: CardTarget;
  /** Parámetros extra del efecto (umbrales, posiciones, límites). */
  config?: Record<string, number | string>;
  maxPerGameweek?: number;
  /** false = la carta existe en el catálogo pero no se puede activar todavía. */
  isActive?: boolean;
  obtainable?: boolean;
  /** Motivo por el que está desactivada, visible en la interfaz y en la administración. */
  unavailableReason?: string;
}

/**
 * Catálogo inicial. Los valores son de equilibrio y se editan desde Administración → Economía → Cartas;
 * lo que aquí se define es el alta inicial de cada carta, no su configuración definitiva.
 */
export const CARD_CATALOG: CardDefinition[] = [
  // ───────────── Potenciadoras ─────────────
  {
    code: 'DOUBLE_POINTS',
    name: 'Doble impacto',
    description: 'Elige un jugador de tu plantilla antes del cierre: sus puntos Fantasy de la jornada se multiplican por 2.',
    category: 'BOOST',
    effect: 'DOUBLE_POINTS',
    rarity: 'RARE',
    effectValue: 200,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_PLAYER',
  },
  {
    code: 'HOT_STREAK',
    name: 'Jugador en racha',
    description: 'Suma 3 puntos a un jugador de tu plantilla al terminar la jornada. No cambia sus estadísticas reales.',
    category: 'BOOST',
    effect: 'FLAT_BONUS',
    rarity: 'UNCOMMON',
    effectValue: 3,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_PLAYER',
  },
  {
    code: 'DREAM_ELEVEN',
    name: 'Once de gala',
    description: 'Suma 1 punto a cada uno de tus titulares de la jornada. No afecta a los suplentes que no lleguen a jugar.',
    category: 'BOOST',
    effect: 'TEAM_BONUS',
    rarity: 'LEGENDARY',
    effectValue: 1,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_TEAM',
  },
  {
    code: 'HIDDEN_TALENT',
    name: 'Talento oculto',
    description: 'Duplica los puntos de un jugador tuyo cuyo valor de mercado esté por debajo del límite configurado.',
    category: 'BOOST',
    effect: 'DOUBLE_POINTS',
    rarity: 'RARE',
    effectValue: 200,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_PLAYER',
    config: { maxValueK: 30000 },
  },
  {
    code: 'GOLDEN_GLOVE',
    name: 'Guante de oro',
    description: 'Suma 4 puntos a tu portero titular en la jornada.',
    category: 'BOOST',
    effect: 'FLAT_BONUS',
    rarity: 'UNCOMMON',
    effectValue: 4,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_GK',
  },
  {
    code: 'LETHAL_STRIKER',
    name: 'Delantero letal',
    description: 'Suma 3 puntos a uno de tus delanteros titulares en la jornada.',
    category: 'BOOST',
    effect: 'FLAT_BONUS',
    rarity: 'RARE',
    effectValue: 3,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_FWD',
  },

  // ───────────── Debilitadoras ─────────────
  {
    code: 'BAD_RUN',
    name: 'Mala racha',
    description: 'Resta 3 puntos a un jugador de un rival de tu liga en la jornada.',
    category: 'WEAKEN',
    effect: 'FLAT_PENALTY',
    rarity: 'RARE',
    effectValue: 3,
    activation: 'PRE_GAMEWEEK',
    target: 'RIVAL_PLAYER',
  },
  {
    code: 'BLACKOUT',
    name: 'Apagón',
    description: 'Un jugador rival pierde la mitad de sus puntos Fantasy positivos de la jornada. Sus estadísticas reales no cambian.',
    category: 'WEAKEN',
    effect: 'WEAKEN',
    rarity: 'EPIC',
    effectValue: 50,
    activation: 'PRE_GAMEWEEK',
    target: 'RIVAL_PLAYER',
  },
  {
    code: 'PRESSURE',
    name: 'Presión total',
    description: 'Resta 1 punto a cada defensa titular de un rival de tu liga.',
    category: 'WEAKEN',
    effect: 'POSITION_PENALTY',
    rarity: 'UNCOMMON',
    effectValue: 1,
    activation: 'PRE_GAMEWEEK',
    target: 'RIVAL_TEAM',
    config: { position: 'DEF' },
  },
  {
    code: 'CURSED_CAPTAIN',
    name: 'Capitán maldito',
    description: 'El capitán de un rival pierde la mitad del extra que le da la capitanía en esa jornada.',
    category: 'WEAKEN',
    effect: 'CAPTAIN_PENALTY',
    rarity: 'EPIC',
    effectValue: 50,
    activation: 'PRE_GAMEWEEK',
    target: 'RIVAL_CAPTAIN',
  },
  {
    code: 'STRIKER_DOWN',
    name: 'Delantero neutralizado',
    description: 'Resta 3 puntos a un delantero titular de un rival de tu liga.',
    category: 'WEAKEN',
    effect: 'FLAT_PENALTY',
    rarity: 'RARE',
    effectValue: 3,
    activation: 'PRE_GAMEWEEK',
    target: 'RIVAL_FWD',
  },
  {
    code: 'CHAOS_ROUND',
    name: 'Jornada caótica',
    description: 'Resta 1 punto a cada titular de un rival de tu liga. Solo una por jornada.',
    category: 'WEAKEN',
    effect: 'TEAM_PENALTY',
    rarity: 'LEGENDARY',
    effectValue: 1,
    activation: 'PRE_GAMEWEEK',
    target: 'RIVAL_TEAM',
    maxPerGameweek: 1,
  },

  // ───────────── Defensivas ─────────────
  {
    code: 'SHIELD',
    name: 'Escudo',
    description: 'Bloquea el próximo ataque de carta que recibas en la jornada. Se gasta al bloquear.',
    category: 'DEFENSE',
    effect: 'SHIELD',
    rarity: 'UNCOMMON',
    effectValue: 1,
    activation: 'REACTIVE',
    target: 'NONE',
  },
  {
    code: 'ANTIDOTE',
    name: 'Antídoto',
    description: 'Cancela un ataque de carta que ya tengas encima en la jornada. Eliges cuál al activarla.',
    category: 'DEFENSE',
    effect: 'ANTIDOTE',
    rarity: 'UNCOMMON',
    effectValue: 1,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_TEAM',
  },
  {
    code: 'IMMUNITY',
    name: 'Inmunidad',
    description: 'Un jugador tuyo queda a salvo de los ataques de carta durante toda la jornada.',
    category: 'DEFENSE',
    effect: 'IMMUNITY',
    rarity: 'EPIC',
    effectValue: 1,
    activation: 'REACTIVE',
    target: 'OWN_PLAYER',
  },
  {
    code: 'TOTAL_ARMOR',
    name: 'Blindaje total',
    description: 'Bloquea por completo los dos próximos ataques de carta que reciba tu equipo en la jornada.',
    category: 'DEFENSE',
    effect: 'SHIELD',
    rarity: 'LEGENDARY',
    effectValue: 2,
    activation: 'REACTIVE',
    target: 'NONE',
  },
  {
    code: 'CAPTAIN_INSURANCE',
    name: 'Seguro de capitán',
    description: 'Tu capitán queda a salvo de las cartas que penalizan la capitanía en esa jornada.',
    category: 'DEFENSE',
    effect: 'CAPTAIN_SHIELD',
    rarity: 'RARE',
    effectValue: 1,
    activation: 'REACTIVE',
    target: 'NONE',
  },

  // ───────────── Económicas ─────────────
  {
    code: 'SPONSOR',
    name: 'Patrocinador',
    description: 'Ingresa £500.000 en el presupuesto de tu equipo en esta liga, al instante.',
    category: 'ECONOMY',
    effect: 'MONEY',
    rarity: 'UNCOMMON',
    effectValue: 500,
    activation: 'INSTANT',
    target: 'NONE',
  },
  {
    code: 'BIG_SPONSOR',
    name: 'Gran patrocinador',
    description: 'Ingresa £1.500.000 en el presupuesto de tu equipo en esta liga, al instante.',
    category: 'ECONOMY',
    effect: 'MONEY',
    rarity: 'EPIC',
    effectValue: 1500,
    activation: 'INSTANT',
    target: 'NONE',
  },
  {
    code: 'WIN_BONUS',
    name: 'Bono por victoria',
    description: 'Si tu equipo llega a 60 puntos en la jornada, ingresas £750.000 al cerrarse.',
    category: 'ECONOMY',
    effect: 'TEAM_THRESHOLD_MONEY',
    rarity: 'RARE',
    effectValue: 750,
    activation: 'POST_SCORING',
    target: 'NONE',
    config: { threshold: 60 },
  },
  {
    code: 'SMART_INVESTMENT',
    name: 'Inversión inteligente',
    description: 'Elige un jugador tuyo: al cerrar la jornada ingresas £100.000 por cada punto que consiga, hasta £1.000.000.',
    category: 'ECONOMY',
    effect: 'PLAYER_PERFORMANCE_MONEY',
    rarity: 'RARE',
    effectValue: 100,
    activation: 'POST_SCORING',
    target: 'OWN_PLAYER',
    config: { maxMoney: 1000 },
  },
  {
    code: 'MARKET_DISCOUNT',
    name: 'Descuento de mercado',
    description: 'Descuento en una compra del mercado.',
    category: 'ECONOMY',
    effect: 'MONEY',
    rarity: 'EPIC',
    effectValue: 0,
    activation: 'INSTANT',
    target: 'NONE',
    isActive: false,
    obtainable: false,
    unavailableReason:
      'El mercado de la liga se resuelve por subasta a sobre cerrado: un descuento alteraría una puja ya hecha y perjudicaría al resto. Queda pendiente de una mecánica compatible.',
  },

  // ───────────── Tácticas ─────────────
  {
    code: 'LAST_MINUTE_CHANGE',
    name: 'Cambio de última hora',
    description: 'Un cambio extra de alineación antes del cierre.',
    category: 'TACTIC',
    effect: 'TEAM_BONUS',
    rarity: 'UNCOMMON',
    effectValue: 0,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_TEAM',
    isActive: false,
    obtainable: false,
    unavailableReason: 'La alineación ya se puede modificar sin límite hasta el cierre de la jornada, así que la carta no añadiría nada.',
  },
  {
    code: 'GOLDEN_BENCH',
    name: 'Banquillo de oro',
    description: 'Suma 2 puntos por cada suplente tuyo que acabe entrando en el once por una sustitución automática.',
    category: 'TACTIC',
    effect: 'RECOVER_POINTS',
    rarity: 'RARE',
    effectValue: 2,
    activation: 'POST_SCORING',
    target: 'OWN_TEAM',
    isActive: false,
    obtainable: false,
    unavailableReason: 'Pendiente de exponer las sustituciones automáticas al motor de cartas.',
  },
  {
    code: 'RISKY_BET',
    name: 'Apuesta arriesgada',
    description: 'Elige un jugador tuyo antes del cierre: si llega a 8 puntos, suma 6 más. Si no, no pasa nada.',
    category: 'TACTIC',
    effect: 'SCORE_BET',
    rarity: 'EPIC',
    effectValue: 6,
    activation: 'POST_SCORING',
    target: 'OWN_PLAYER',
    config: { threshold: 8 },
  },
  {
    code: 'MASTER_PLAN',
    name: 'Plan maestro',
    description: 'Dos modificaciones tácticas en la misma jornada.',
    category: 'TACTIC',
    effect: 'TEAM_BONUS',
    rarity: 'LEGENDARY',
    effectValue: 0,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_TEAM',
    isActive: false,
    obtainable: false,
    unavailableReason: 'Depende de las cartas tácticas de cambio de alineación, que todavía no tienen efecto real.',
  },

  // ───────────── Legendarias ─────────────
  {
    code: 'GOLDEN_DESTINY',
    name: 'Destino dorado',
    description: 'Si tu equipo llega a 50 puntos en la jornada, suma 10 puntos más.',
    category: 'LEGENDARY',
    effect: 'SCORE_BET',
    rarity: 'LEGENDARY',
    effectValue: 10,
    activation: 'POST_SCORING',
    target: 'OWN_TEAM',
    config: { threshold: 50 },
    maxPerGameweek: 1,
  },
  {
    code: 'RESURGENCE',
    name: 'Resurgimiento',
    description: 'Recupera hasta 8 de los puntos que te hayan quitado las cartas rivales en la jornada.',
    category: 'LEGENDARY',
    effect: 'RECOVER_POINTS',
    rarity: 'LEGENDARY',
    effectValue: 8,
    activation: 'POST_SCORING',
    target: 'OWN_TEAM',
    maxPerGameweek: 1,
  },
  {
    code: 'ECONOMIC_EMPIRE',
    name: 'Imperio económico',
    description: 'Ingresa £5.000.000 de una sola vez. Como mucho una por temporada.',
    category: 'LEGENDARY',
    effect: 'MONEY',
    rarity: 'LEGENDARY',
    effectValue: 5000,
    activation: 'INSTANT',
    target: 'NONE',
    config: { maxPerSeason: 1 },
    maxPerGameweek: 1,
  },
  {
    code: 'THE_STRATEGIST',
    name: 'El estratega',
    description: 'Una modificación táctica adicional antes del cierre.',
    category: 'LEGENDARY',
    effect: 'TEAM_BONUS',
    rarity: 'LEGENDARY',
    effectValue: 0,
    activation: 'PRE_GAMEWEEK',
    target: 'OWN_TEAM',
    isActive: false,
    obtainable: false,
    unavailableReason: 'Depende de las cartas tácticas de cambio de alineación, que todavía no tienen efecto real.',
  },
];

// ───────────────────────────── Política de acumulación ─────────────────────────────

/**
 * Un modificador ya resuelto que afecta a un jugador concreto. El motor de cartas los calcula y la
 * puntuación los aplica; separarlos permite reconstruir siempre los puntos oficiales.
 */
export interface PlayerModifier {
  /** ADD: puntos planos · PENALTY_PCT: % de los puntos positivos · MULTIPLY: % (200 = x2) · CAPTAIN_PCT: % del extra de capitán */
  kind: 'ADD' | 'PENALTY_PCT' | 'MULTIPLY' | 'CAPTAIN_PCT';
  value: number;
  /** Activación de la que procede, para poder atribuir el delta. */
  activationId?: number;
}

export interface ModifierOutcome {
  /** Puntos que contarían sin ninguna carta (incluye capitanía). */
  base: number;
  /** Puntos definitivos con las cartas aplicadas. */
  total: number;
  /** total − base. */
  delta: number;
}

/**
 * Aplica los modificadores de un jugador en un orden FIJO y documentado. Sin este orden, combinar un
 * doble de puntos con una penalización y la capitanía daría resultados distintos según el azar:
 *
 *   1. Puntos oficiales del jugador.
 *   2. Sumas y restas planas (ADD), que pueden dejar el total en negativo.
 *   3. Penalizaciones porcentuales (PENALTY_PCT), solo sobre puntos positivos y acumuladas hasta el 100 %.
 *   4. El mejor multiplicador (MULTIPLY): los multiplicadores NO se acumulan entre sí, se toma el mayor.
 *   5. La capitanía, según `stacking`:
 *        · MAX   → se aplica el mayor entre el multiplicador de la carta y el del capitán.
 *        · STACK → se multiplican ambos.
 *      CAPTAIN_PCT reduce únicamente el EXTRA que aporta la capitanía, nunca los puntos del jugador.
 *
 * Todos los redondeos son `Math.round` y se hacen en el mismo punto, así que el resultado es reproducible.
 */
export function applyPlayerModifiers(points: number, captainMultiplier: number, mods: PlayerModifier[], stacking: 'MAX' | 'STACK'): ModifierOutcome {
  const base = points * captainMultiplier;
  // Un jugador que no juega (multiplicador 0) no recibe ni bonus ni castigo
  if (!mods.length || captainMultiplier <= 0) return { base, total: base, delta: 0 };

  const sum = (kind: PlayerModifier['kind']) => mods.filter((m) => m.kind === kind).reduce((acc, m) => acc + m.value, 0);

  // (2) Sumas y restas planas
  const flat = points + sum('ADD');
  // (3) Penalizaciones porcentuales, solo si quedan puntos positivos
  const penalty = Math.min(100, Math.max(0, sum('PENALTY_PCT')));
  const afterPenalty = flat > 0 && penalty > 0 ? Math.round(flat * (1 - penalty / 100)) : flat;
  // (4) El mejor multiplicador, nunca el producto de varios
  const boost = Math.max(1, ...mods.filter((m) => m.kind === 'MULTIPLY').map((m) => m.value / 100));

  // (5) Capitanía, con su posible penalización sobre el extra
  const captainCut = Math.min(100, Math.max(0, sum('CAPTAIN_PCT')));
  const effectiveCaptain = captainMultiplier > 1 ? 1 + (captainMultiplier - 1) * (1 - captainCut / 100) : captainMultiplier;

  const total =
    stacking === 'STACK' ? Math.round(Math.round(afterPenalty * boost) * effectiveCaptain) : Math.round(afterPenalty * Math.max(boost, effectiveCaptain));
  return { base, total, delta: total - base };
}

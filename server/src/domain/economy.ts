/**
 * Economía de liga (v2): lógica pura, sin acceso a base de datos, para poder probarla de forma aislada.
 *
 * Unidad monetaria: miles de libras (k£). 100000 = £100M · 750 = £750.000.
 * El sistema clásico sigue usando décimas de millón en sus propias columnas (budget, price).
 */
import { FORMATIONS, PLAYER_RARITIES, type Formation, type PlayerRarity, type Position } from './constants';
import { parseFormation, type FormationShape } from './lineup';

// ───────────────────────────── Dinero ─────────────────────────────

export const formatK = (k: number) => {
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(k);
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : abs % 100 === 0 ? 1 : 2)}M`;
  return `${sign}£${abs}K`;
};

/** Conversión desde el precio oficial de FPL (décimas de millón) al valor inicial de la economía de liga. */
export function initialValueFromFpl(fplPriceTenths: number, cfg: { base: number; exponent: number; min: number; max: number }) {
  const ratio = Math.max(0.1, fplPriceTenths / 40);
  const raw = cfg.base * Math.pow(ratio, cfg.exponent);
  return clampValue(roundValue(raw), cfg.min, cfg.max);
}

/** Redondeo «de mercado»: a £50K por debajo de £10M y a £100K por encima. */
export function roundValue(k: number) {
  const step = k < 10000 ? 50 : 100;
  return Math.max(step, Math.round(k / step) * step);
}

export const clampValue = (k: number, min: number, max: number) => Math.max(min, Math.min(max, k));

// ───────────────────────────── Aleatoriedad ─────────────────────────────

export type Rng = () => number;

/** Generador determinista (mulberry32) para pruebas reproducibles. */
export function seededRng(seed: string | number): Rng {
  let h = typeof seed === 'number' ? seed >>> 0 : 2166136261;
  if (typeof seed === 'string') for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedPick<T>(entries: { item: T; weight: number }[], rng: Rng): T | null {
  const valid = entries.filter((e) => e.weight > 0);
  const total = valid.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const e of valid) {
    r -= e.weight;
    if (r < 0) return e.item;
  }
  return valid[valid.length - 1].item;
}

const pickOne = <T>(items: T[], rng: Rng): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

// ───────────────────────────── Rareza ─────────────────────────────

export const RARITY_RANK: Record<PlayerRarity, number> = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, STAR: 4 };
export const rarityAtLeast = (r: string, min: string) => (RARITY_RANK[r as PlayerRarity] ?? 0) >= (RARITY_RANK[min as PlayerRarity] ?? 0);
export type RarityWeights = Record<PlayerRarity, number>;

export interface RarityInput {
  id: number;
  value: number;
  seasonPoints: number;
  recentForm: number;
}

export interface RarityConfig {
  pctStar: number;
  pctEpic: number;
  pctRare: number;
  pctUncommon: number;
  wValue: number;
  wPoints: number;
  wForm: number;
}

/** Percentil (0..1) de cada valor dentro del conjunto; los empates comparten percentil. */
function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return values.map((v) => {
    if (n <= 1) return 1;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / (n - 1);
  });
}

/**
 * Rareza según datos reales: valor de mercado, puntos de la temporada y forma reciente.
 * Se combina el percentil de cada métrica y se reparten los niveles por tramos (el mejor x % es STAR…).
 */
export function classifyRarities(inputs: RarityInput[], cfg: RarityConfig): Map<number, PlayerRarity> {
  const result = new Map<number, PlayerRarity>();
  if (!inputs.length) return result;
  const pv = percentiles(inputs.map((i) => i.value));
  const pp = percentiles(inputs.map((i) => i.seasonPoints));
  const pf = percentiles(inputs.map((i) => i.recentForm));
  const wSum = cfg.wValue + cfg.wPoints + cfg.wForm || 1;
  const scored = inputs
    .map((input, i) => ({ id: input.id, value: input.value, score: (pv[i] * cfg.wValue + pp[i] * cfg.wPoints + pf[i] * cfg.wForm) / wSum }))
    .sort((a, b) => b.score - a.score || b.value - a.value || a.id - b.id);
  const n = scored.length;
  const cut = (pct: number) => Math.round((n * pct) / 100);
  const star = cut(cfg.pctStar);
  const epic = star + cut(cfg.pctEpic);
  const rare = epic + cut(cfg.pctRare);
  const uncommon = rare + cut(cfg.pctUncommon);
  scored.forEach((s, idx) => {
    const r: PlayerRarity = idx < star ? 'STAR' : idx < epic ? 'EPIC' : idx < rare ? 'RARE' : idx < uncommon ? 'UNCOMMON' : 'COMMON';
    result.set(s.id, r);
  });
  return result;
}

// ───────────────────────────── Valoración dinámica ─────────────────────────────

export interface ValuationConfig {
  sensitivity: number; // % por desviación
  varMin: number; // %
  varMax: number; // %
  wLast: number;
  wAvg: number;
  wTrend: number;
  scalePoints: number;
  consistency: number;
  elasticity: number;
  minChange: number; // %
  min: number;
  max: number;
  referenceValue: number; // k£: valor en el que la elasticidad es neutra
}

export interface ValuationInput {
  value: number;
  /** Puntos de la jornada; null si su club no jugó (no hay cambio). */
  lastPoints: number | null;
  /** Puntos de las últimas jornadas disputadas por su club, en orden cronológico (incluye la última). */
  recent: number[];
  /** Puntos esperados por jornada para su nivel (media real de su rareza). */
  expected: number;
}

export interface ValuationResult {
  newValue: number;
  change: number;
  variation: number; // fracción: 0.05 = +5 %
  factors: Record<string, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/**
 * nuevoValor = valorActual × (1 + variación)
 * variación = sensibilidad × (wÚltima·zÚltima + wPromedio·zPromedio + wTendencia·zTendencia)
 *             × amortiguación por irregularidad × elasticidad del valor, limitada a [varMin, varMax].
 * z = (puntos − esperados) / escala. Un único partido pesa solo wÚltima: el resto suaviza.
 */
export function computeValuation(input: ValuationInput, cfg: ValuationConfig): ValuationResult | null {
  if (input.lastPoints === null) return null;
  const scale = Math.max(1, cfg.scalePoints);
  const recent = input.recent.length ? input.recent : [input.lastPoints];
  const avg = mean(recent);
  const half = Math.floor(recent.length / 2);
  const trend = recent.length >= 2 ? mean(recent.slice(half)) - mean(recent.slice(0, half || 1)) : 0;
  const zLast = (input.lastPoints - input.expected) / scale;
  const zAvg = (avg - input.expected) / scale;
  const zTrend = trend / scale;
  const wSum = cfg.wLast + cfg.wAvg + cfg.wTrend || 1;
  const performance = (cfg.wLast * zLast + cfg.wAvg * zAvg + cfg.wTrend * zTrend) / wSum;
  const damping = 1 / (1 + cfg.consistency * (stdev(recent) / scale));
  const elasticity = Math.pow(Math.max(1, cfg.referenceValue) / Math.max(1, input.value), cfg.elasticity);
  let variation = (cfg.sensitivity / 100) * performance * damping * elasticity;
  variation = Math.max(cfg.varMin / 100, Math.min(cfg.varMax / 100, variation));
  if (Math.abs(variation) * 100 < cfg.minChange) return null;
  const newValue = clampValue(roundValue(input.value * (1 + variation)), cfg.min, cfg.max);
  const change = newValue - input.value;
  if (change === 0) return null;
  return {
    newValue,
    change,
    variation,
    factors: {
      last: input.lastPoints,
      average: Number(avg.toFixed(2)),
      trend: Number(trend.toFixed(2)),
      expected: Number(input.expected.toFixed(2)),
      performance: Number(performance.toFixed(3)),
      damping: Number(damping.toFixed(3)),
      elasticity: Number(elasticity.toFixed(3)),
    },
  };
}

// ───────────────────────────── Mercado diario ─────────────────────────────

export interface MarketCandidate {
  id: number;
  position: string;
  rarity: PlayerRarity;
}

export interface PityState {
  counter: number;
  stepPercent: number;
  maxMultiplier: number;
  minRarity: PlayerRarity;
  hardDays: number;
}

/** Pesos de rareza con la protección contra mala suerte: cada día sin rareza alta los niveles altos pesan más. */
export function pityWeights(base: RarityWeights, pity: PityState): RarityWeights {
  const mult = Math.min(pity.maxMultiplier, 1 + (pity.counter * pity.stepPercent) / 100);
  const out = { ...base };
  for (const r of PLAYER_RARITIES) if (rarityAtLeast(r, pity.minRarity)) out[r] = base[r] * mult;
  return out;
}

export const pityGuaranteed = (pity: PityState) => pity.hardDays > 0 && pity.counter + 1 >= pity.hardDays;

/**
 * Elige `count` jugadores distintos: primero la rareza (ponderada), después un jugador al azar de esa rareza.
 * La diversidad limita cuántos pueden compartir posición, sin eliminar el azar; si no hay alternativa se relaja.
 */
export function selectMarketPlayers(
  candidates: MarketCandidate[],
  count: number,
  cfg: { weights: RarityWeights; maxSamePosition: number; guaranteeRarity?: PlayerRarity | null },
  rng: Rng,
): MarketCandidate[] {
  const pool = [...candidates];
  const chosen: MarketCandidate[] = [];
  const posCount = new Map<string, number>();
  const take = (c: MarketCandidate) => {
    pool.splice(pool.indexOf(c), 1);
    chosen.push(c);
    posCount.set(c.position, (posCount.get(c.position) ?? 0) + 1);
  };
  const posOk = (c: MarketCandidate) => (posCount.get(c.position) ?? 0) < cfg.maxSamePosition;

  if (cfg.guaranteeRarity) {
    const high = pool.filter((c) => rarityAtLeast(c.rarity, cfg.guaranteeRarity!));
    if (high.length) {
      const rarity = weightedPick(
        [...new Set(high.map((c) => c.rarity))].map((r) => ({ item: r, weight: cfg.weights[r] || 1 })),
        rng,
      );
      take(pickOne(high.filter((c) => c.rarity === rarity), rng));
    }
  }

  while (chosen.length < count && pool.length) {
    const eligible = pool.filter(posOk);
    const source = eligible.length ? eligible : pool;
    const rarities = [...new Set(source.map((c) => c.rarity))];
    let rarity = weightedPick(rarities.map((r) => ({ item: r, weight: cfg.weights[r] })), rng);
    // Si todas las rarezas disponibles tienen peso 0, se elige entre ellas de forma uniforme
    if (!rarity) rarity = pickOne(rarities, rng);
    take(pickOne(source.filter((c) => c.rarity === rarity), rng));
  }
  return chosen;
}

/** Entre min y max entrenadores, ponderados por rareza como los jugadores. */
export function selectMarketCoaches<T extends { id: number; rarity: PlayerRarity }>(
  candidates: T[],
  cfg: { min: number; max: number; weights: RarityWeights },
  rng: Rng,
): T[] {
  const lo = Math.max(0, Math.min(cfg.min, cfg.max));
  const hi = Math.max(lo, cfg.max);
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const pool = [...candidates];
  const out: T[] = [];
  while (out.length < count && pool.length) {
    const picked = weightedPick(pool.map((c) => ({ item: c, weight: cfg.weights[c.rarity] || 0.5 })), rng) ?? pickOne(pool, rng);
    pool.splice(pool.indexOf(picked), 1);
    out.push(picked);
  }
  return out;
}

// ───────────────────────────── Equipo inicial ─────────────────────────────

export interface StarterCandidate {
  id: number;
  position: Position;
  rarity: PlayerRarity;
  clubId: number;
}

export function resolveFormation(setting: string, rng: Rng): Formation {
  if ((FORMATIONS as readonly string[]).includes(setting)) return setting as Formation;
  return pickOne([...FORMATIONS], rng);
}

/**
 * 11 titulares según la formación + `bench` suplentes de cualquier posición.
 * Selección ponderada por rareza (las estrellas pueden quedar excluidas con peso 0) y límite por club.
 */
export function buildStarterSquad(
  candidates: StarterCandidate[],
  cfg: { formation: Formation; bench: number; weights: RarityWeights; maxPerClub: number },
  rng: Rng,
): { starters: StarterCandidate[]; bench: StarterCandidate[] } {
  const shape = parseFormation(cfg.formation) as FormationShape;
  const used = new Set<number>();
  const perClub = new Map<number, number>();
  const pick = (filter: (c: StarterCandidate) => boolean): StarterCandidate => {
    const ok = candidates.filter((c) => !used.has(c.id) && filter(c) && (perClub.get(c.clubId) ?? 0) < cfg.maxPerClub);
    if (!ok.length) throw new Error('No hay jugadores suficientes para completar el equipo inicial');
    const rarities = [...new Set(ok.map((c) => c.rarity))];
    let rarity = weightedPick(rarities.map((r) => ({ item: r, weight: cfg.weights[r] })), rng);
    if (!rarity) {
      // Solo quedan rarezas con peso 0 (p. ej. estrellas excluidas): se usa la más baja disponible
      rarity = rarities.sort((a, b) => RARITY_RANK[a] - RARITY_RANK[b])[0];
    }
    const c = pickOne(ok.filter((x) => x.rarity === rarity), rng);
    used.add(c.id);
    perClub.set(c.clubId, (perClub.get(c.clubId) ?? 0) + 1);
    return c;
  };
  const starters: StarterCandidate[] = [];
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as Position[]) {
    for (let i = 0; i < shape[pos]; i++) starters.push(pick((c) => c.position === pos));
  }
  const bench: StarterCandidate[] = [];
  for (let i = 0; i < cfg.bench; i++) bench.push(pick(() => true));
  return { starters, bench };
}

/** ¿Puede la plantilla formar un once válido con alguna formación permitida? */
export function canFieldEleven(counts: FormationShape) {
  return FORMATIONS.some((f) => {
    const s = parseFormation(f)!;
    return counts.GK >= s.GK && counts.DEF >= s.DEF && counts.MID >= s.MID && counts.FWD >= s.FWD;
  });
}

// ───────────────────────────── Fechas por zona horaria ─────────────────────────────

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Instante UTC de una hora local de pared en `tz` (tiene en cuenta el horario de verano). */
export function zonedTimeToUtc(year: number, month: number, day: number, minutesOfDay: number, tz: string): Date {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, h, m);
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(ts), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    ts += guess - asUtc;
  }
  return new Date(ts);
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function shiftDate(key: string, days: number) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function localDateKey(now: Date, tz: string) {
  const p = zonedParts(now, tz);
  return dateKey(p.year, p.month, p.day);
}

export function minutesOfDayIn(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** Ventana del mercado vigente: empieza a la hora de reinicio local más reciente y dura hasta la siguiente. */
export function marketCycleWindow(now: Date, tz: string, resetMinute: number) {
  const p = zonedParts(now, tz);
  let key = dateKey(p.year, p.month, p.day);
  if (p.hour * 60 + p.minute < resetMinute) key = shiftDate(key, -1);
  const [y, m, d] = key.split('-').map(Number);
  const startsAt = zonedTimeToUtc(y, m, d, resetMinute, tz);
  const [ny, nm, nd] = shiftDate(key, 1).split('-').map(Number);
  const endsAt = zonedTimeToUtc(ny, nm, nd, resetMinute, tz);
  return { cycleDate: key, startsAt, endsAt };
}

/** Inicio del siguiente día local (reinicio de los desafíos diarios). */
export function nextLocalMidnight(now: Date, tz: string) {
  const [y, m, d] = shiftDate(localDateKey(now, tz), 1).split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 0, tz);
}

// ───────────────────────────── Wordle ─────────────────────────────

export type LetterState = 'correct' | 'present' | 'absent';

/** Mayúsculas y sin tildes (la Ñ se conserva). */
export function normalizeWord(raw: string) {
  return raw
    .trim()
    .toUpperCase()
    .replace(/Ñ/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ /g, 'Ñ');
}

export const isPlayableWord = (w: string, length: number) => w.length === length && /^[A-ZÑ]+$/.test(w);

export function parseWordList(text: string, length: number) {
  return [...new Set(text.split(/[\s,;]+/).map(normalizeWord).filter((w) => isPlayableWord(w, length)))];
}

/** Evaluación estándar en dos pasadas (las letras repetidas se cuentan correctamente). */
export function evaluateGuess(guess: string, answer: string): LetterState[] {
  const g = [...guess];
  const a = [...answer];
  const result: LetterState[] = g.map(() => 'absent');
  const remaining = new Map<string, number>();
  g.forEach((ch, i) => {
    if (a[i] === ch) result[i] = 'correct';
    else remaining.set(a[i], (remaining.get(a[i]) ?? 0) + 1);
  });
  g.forEach((ch, i) => {
    if (result[i] === 'correct') return;
    const left = remaining.get(ch) ?? 0;
    if (left > 0) {
      result[i] = 'present';
      remaining.set(ch, left - 1);
    }
  });
  return result;
}

/** Premio según el intento en que se acierta (1-indexado). Los intentos por encima de la tabla usan el último valor. */
export function wordleReward(attempt: number, rewards: number[]) {
  if (attempt < 1 || !rewards.length) return 0;
  return rewards[Math.min(attempt, rewards.length) - 1];
}

// ───────────────────────────── Rachas ─────────────────────────────

export interface StreakState {
  current: number;
  best: number;
  lastDate: string | null;
}

export interface StreakMilestone {
  days: number;
  money: number;
  card: string | null;
}

/**
 * Racha diaria: continúa si el día anterior también contó; si se salta un día (o se pierde, cuando la
 * racha exige victoria) vuelve a empezar. Registrar dos veces el mismo día no cambia nada.
 */
export function nextStreak(prev: StreakState | null, date: string, counts: boolean): StreakState {
  const base: StreakState = prev ?? { current: 0, best: 0, lastDate: null };
  if (base.lastDate === date) return base;
  if (!counts) return { current: 0, best: base.best, lastDate: date };
  const current = base.lastDate === shiftDate(date, -1) && base.current > 0 ? base.current + 1 : 1;
  return { current, best: Math.max(base.best, current), lastDate: date };
}

/** Racha visible hoy: si el último día que contó no es hoy ni ayer, la racha ya se ha perdido. */
export function effectiveStreak(state: StreakState | null, today: string) {
  if (!state?.lastDate) return 0;
  return state.lastDate === today || state.lastDate === shiftDate(today, -1) ? state.current : 0;
}

export const milestoneFor = (days: number, milestones: StreakMilestone[]) => milestones.find((m) => m.days === days) ?? null;

// ───────────────────────────── Cartas: motor de modificadores ─────────────────────────────

export interface CardModifier {
  effect: 'DOUBLE_POINTS' | 'WEAKEN';
  /** DOUBLE_POINTS: multiplicador en % (200 = x2) · WEAKEN: % que se resta de los puntos positivos */
  value: number;
}

/**
 * Orden de aplicación (documentado y probado):
 *   1. Puntos base del jugador (motor de puntuación, estadísticas reales)
 *   2. Cartas de penalización (WEAKEN): restan un % solo de puntos positivos, acumuladas hasta un 100 %
 *   3. Cartas de potenciación (DOUBLE_POINTS): se aplica el mayor multiplicador (no se acumulan entre sí)
 *   4. Capitán / reglas existentes: con stacking MAX se usa el mayor entre capitán y carta; con STACK se multiplican
 * Un suplente que no entra (multiplicador 0) no suma, tenga o no cartas.
 */
export function applyCardModifiers(points: number, multiplier: number, mods: CardModifier[], stacking: 'MAX' | 'STACK') {
  const base = points * multiplier;
  if (!mods.length || multiplier <= 0) return { total: base, base, delta: 0 };
  const weaken = Math.min(100, mods.filter((m) => m.effect === 'WEAKEN').reduce((s, m) => s + m.value, 0));
  const afterPenalty = points > 0 && weaken > 0 ? Math.round(points * (1 - weaken / 100)) : points;
  const boost = Math.max(1, ...mods.filter((m) => m.effect === 'DOUBLE_POINTS').map((m) => m.value / 100));
  const total = stacking === 'STACK' ? Math.round(afterPenalty * boost) * multiplier : Math.round(afterPenalty * Math.max(boost, multiplier));
  return { total, base, delta: total - base };
}

// ───────────────────────────── Entrenadores ─────────────────────────────

export interface CoachScoringConfig {
  win: number;
  draw: number;
  loss: number;
  cleanSheet: number;
  goal: number;
}

/** Puntos del entrenador en un partido terminado, a partir del resultado real de su club. */
export function coachMatchPoints(goalsFor: number, goalsAgainst: number, cfg: CoachScoringConfig) {
  let pts = goalsFor > goalsAgainst ? cfg.win : goalsFor === goalsAgainst ? cfg.draw : cfg.loss;
  if (goalsAgainst === 0) pts += cfg.cleanSheet;
  pts += goalsFor * cfg.goal;
  return pts;
}

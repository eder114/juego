import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { SETTINGS_DEFS, type SettingKey, type Settings } from '../domain/constants';
import { isValidTimeZone, parseWordList, type RarityWeights, type StreakMilestone } from '../domain/economy';

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 5_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const rows = await prisma.setting.findMany();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const value = {} as Record<string, unknown>;
  for (const [key, def] of Object.entries(SETTINGS_DEFS)) {
    const raw = stored.get(key);
    value[key] = raw === undefined ? def.value : safeJson(raw, def.value);
  }
  cache = { value: value as Settings, at: Date.now() };
  return cache.value;
}

function safeJson(raw: string, fallback: unknown) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function invalidateSettings() {
  cache = null;
}

export function describeSettings(values: Settings) {
  return Object.entries(SETTINGS_DEFS).map(([key, def]) => ({
    key,
    ...def,
    default: def.value,
    value: values[key as SettingKey],
  }));
}

export async function updateSettings(patch: Record<string, unknown>) {
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    const def = (SETTINGS_DEFS as Record<string, (typeof SETTINGS_DEFS)[SettingKey]>)[key];
    if (!def) throw badRequest(`Configuración desconocida: ${key}`);
    const d = def as { type: string; min?: number; max?: number; options?: string[] };
    if (d.type === 'boolean' && typeof value !== 'boolean') throw badRequest(`${def.label}: debe ser verdadero/falso`);
    if ((d.type === 'number' || d.type === 'money' || d.type === 'moneyk') && (typeof value !== 'number' || Number.isNaN(value)))
      throw badRequest(`${def.label}: debe ser numérico`);
    if (typeof value === 'number' && ((d.min !== undefined && value < d.min) || (d.max !== undefined && value > d.max)))
      throw badRequest(`${def.label}: fuera de rango (${d.min} – ${d.max})`);
    if (d.type === 'select' && !d.options?.includes(String(value))) throw badRequest(`${def.label}: opción inválida`);
    if (['string', 'text', 'json', 'timezone'].includes(d.type) && (typeof value !== 'string' || !value.trim())) throw badRequest(`${def.label}: requerido`);
    if (d.type === 'timezone' && !isValidTimeZone(String(value))) throw badRequest(`${def.label}: zona horaria no válida (usa el formato IANA, p. ej. Europe/London)`);
    if (d.type === 'moneyk' && !Number.isInteger(value)) throw badRequest(`${def.label}: debe ser un importe entero en miles de £`);
  }
  const values = await getSettings();
  const next = { ...values, ...patch } as Settings;
  if (next.price_min >= next.price_max) throw badRequest('El precio mínimo debe ser menor que el máximo');
  if (next.price_rise_points > next.price_rise_points_high) throw badRequest('La subida fuerte requiere más puntos que la subida normal');
  if (next.squad_gk + next.squad_def + next.squad_mid + next.squad_fwd < 11) throw badRequest('La plantilla debe tener al menos 11 jugadores');
  validateEconomySettings(next);

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      }),
    ),
  );
  invalidateSettings();
  return getSettings();
}

export function squadRequirements(s: Settings) {
  return { GK: s.squad_gk, DEF: s.squad_def, MID: s.squad_mid, FWD: s.squad_fwd } as const;
}

/** Reglas cruzadas de la economía de liga (se comprueban antes de guardar). */
function validateEconomySettings(s: Settings) {
  if (s.value_min >= s.value_max) throw badRequest('El valor mínimo debe ser menor que el máximo');
  if (s.market_coaches_min > s.market_coaches_max) throw badRequest('El mínimo de entrenadores por mercado no puede superar el máximo');
  if (s.rarity_pct_star + s.rarity_pct_epic + s.rarity_pct_rare + s.rarity_pct_uncommon > 100)
    throw badRequest('Los tramos de rareza suman más del 100 %');
  if (s.rarity_w_value + s.rarity_w_points + s.rarity_w_form <= 0) throw badRequest('Algún criterio de rareza debe tener peso');
  if (s.valuation_w_last + s.valuation_w_avg + s.valuation_w_trend <= 0) throw badRequest('Algún factor de valoración debe tener peso');
  if (Object.values(marketWeights(s)).every((w) => w <= 0)) throw badRequest('Las probabilidades de rareza del mercado no pueden ser todas 0');
  if (Object.values(starterWeights(s)).every((w) => w <= 0)) throw badRequest('Los pesos del equipo inicial no pueden ser todos 0');
  if (s.v2_max_gk + s.v2_max_def + s.v2_max_mid + s.v2_max_fwd < 11 + s.v2_starter_bench)
    throw badRequest('Los máximos por posición no permiten el equipo inicial');
  if (parseWordList(s.wordle_words, 5).length < 1) throw badRequest('El Wordle necesita al menos una palabra válida de 5 letras');
  streakMilestones(s);
}

export const marketWeights = (s: Settings): RarityWeights => ({
  COMMON: s.market_w_common,
  UNCOMMON: s.market_w_uncommon,
  RARE: s.market_w_rare,
  EPIC: s.market_w_epic,
  STAR: s.market_w_star,
});

export const starterWeights = (s: Settings): RarityWeights => ({
  COMMON: s.v2_starter_w_common,
  UNCOMMON: s.v2_starter_w_uncommon,
  RARE: s.v2_starter_w_rare,
  EPIC: s.v2_starter_w_epic,
  STAR: s.v2_starter_w_star,
});

/** Hitos de racha validados (lanza 400 si el JSON no es correcto). */
export function streakMilestones(s: Settings): StreakMilestone[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.streak_milestones);
  } catch {
    throw badRequest('Premios por racha: JSON no válido');
  }
  if (!Array.isArray(parsed)) throw badRequest('Premios por racha: debe ser una lista');
  return parsed.map((m, i) => {
    const days = Number(m?.days);
    const money = Number(m?.money ?? 0);
    const card = m?.card == null || m.card === '' ? null : String(m.card);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw badRequest(`Premios por racha #${i + 1}: días inválidos`);
    if (!Number.isInteger(money) || money < 0 || money > 100000) throw badRequest(`Premios por racha #${i + 1}: importe inválido (0 – 100000 miles de £)`);
    return { days, money, card };
  });
}

export const wordleRewards = (s: Settings) => [s.wordle_reward_1, s.wordle_reward_2, s.wordle_reward_3, s.wordle_reward_4, s.wordle_reward_5, s.wordle_reward_6];

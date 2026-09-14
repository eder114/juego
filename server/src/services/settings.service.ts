import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { SETTINGS_DEFS, type SettingKey, type Settings } from '../domain/constants';

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
    if ((d.type === 'number' || d.type === 'money') && (typeof value !== 'number' || Number.isNaN(value)))
      throw badRequest(`${def.label}: debe ser numérico`);
    if (typeof value === 'number' && ((d.min !== undefined && value < d.min) || (d.max !== undefined && value > d.max)))
      throw badRequest(`${def.label}: fuera de rango (${d.min} – ${d.max})`);
    if (d.type === 'select' && !d.options?.includes(String(value))) throw badRequest(`${def.label}: opción inválida`);
    if (d.type === 'string' && (typeof value !== 'string' || !value.trim())) throw badRequest(`${def.label}: requerido`);
  }
  const values = await getSettings();
  const next = { ...values, ...patch } as Settings;
  if (next.price_min >= next.price_max) throw badRequest('El precio mínimo debe ser menor que el máximo');
  if (next.price_rise_points > next.price_rise_points_high) throw badRequest('La subida fuerte requiere más puntos que la subida normal');
  if (next.squad_gk + next.squad_def + next.squad_mid + next.squad_fwd < 11) throw badRequest('La plantilla debe tener al menos 11 jugadores');

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

import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import type { PlayerRarity, Settings } from '../domain/constants';
import {
  classifyRarities,
  clampValue,
  coachMatchPoints,
  computeValuation,
  formatK,
  initialValueFromFpl,
  roundValue,
  type CoachScoringConfig,
  type ValuationConfig,
} from '../domain/economy';
import { getSettings } from './settings.service';
import { getPlayerAggregates, invalidatePlayerAggregates } from './player-stats.service';
import { notifyMany, type NotificationInput } from './notification.service';

/**
 * Valoración de la economía de liga (k£).
 * - Valor inicial: curva sobre el precio oficial de FPL (dato real) → las estrellas valen £100M–£200M.
 * - Tras cada jornada: fórmula de rendimiento configurable (domain/economy.ts → computeValuation).
 * - Rareza: percentiles de valor, puntos de temporada y forma reciente.
 * Los valores son globales (iguales en todas las ligas); el precio de cada anuncio se fija al generar el mercado.
 */

export function valuationConfig(s: Settings, scalePoints = s.valuation_scale_points): ValuationConfig {
  return {
    sensitivity: s.valuation_sensitivity,
    varMin: s.valuation_var_min,
    varMax: s.valuation_var_max,
    wLast: s.valuation_w_last,
    wAvg: s.valuation_w_avg,
    wTrend: s.valuation_w_trend,
    scalePoints,
    consistency: s.valuation_consistency,
    elasticity: s.valuation_elasticity,
    minChange: s.valuation_min_change,
    min: s.value_min,
    max: s.value_max,
    // Referencia neutra de la elasticidad: el valor inicial de un jugador de £6.0M en FPL
    referenceValue: initialValueFromFpl(60, { base: s.valuation_base, exponent: s.valuation_exponent, min: s.value_min, max: s.value_max }),
  };
}

export const coachScoring = (s: Settings): CoachScoringConfig => ({
  win: s.coach_points_win,
  draw: s.coach_points_draw,
  loss: s.coach_points_loss,
  cleanSheet: s.coach_points_clean_sheet,
  goal: s.coach_points_goal,
});

const initialCfg = (s: Settings) => ({ base: s.valuation_base, exponent: s.valuation_exponent, min: s.value_min, max: s.value_max });

/** Asigna valor inicial a los jugadores que aún no lo tienen (nuevos fichajes de la Premier o primera ejecución). */
export async function ensurePlayerValuations() {
  const s = await getSettings();
  const missing = await prisma.player.findMany({ where: { marketValue: null }, select: { id: true, price: true } });
  for (let i = 0; i < missing.length; i += 200) {
    const chunk = missing.slice(i, i + 200).map((p) => ({ id: p.id, value: initialValueFromFpl(p.price, initialCfg(s)) }));
    await prisma.$transaction([
      ...chunk.map((c) => prisma.player.update({ where: { id: c.id }, data: { marketValue: c.value } })),
      prisma.playerValuation.createMany({ data: chunk.map((c) => ({ playerId: c.id, value: c.value, reason: 'INITIAL', factors: JSON.stringify({ source: 'FPL_PRICE' }) })) }),
    ]);
  }
  if (missing.length) await recomputeRarities();
  return { initialized: missing.length };
}

/** Valor inicial de los entrenadores: % del valor medio del once más valioso de su club (datos reales). */
export async function ensureCoachValuations(force = false) {
  const s = await getSettings();
  const coaches = await prisma.coach.findMany({ where: force ? {} : { marketValue: 0 }, select: { id: true, clubId: true, marketValue: true } });
  if (!coaches.length) return { initialized: 0 };
  const players = await prisma.player.findMany({ where: { isActive: true, marketValue: { not: null } }, select: { clubId: true, marketValue: true } });
  const byClub = new Map<number, number[]>();
  for (const p of players) byClub.set(p.clubId, [...(byClub.get(p.clubId) ?? []), p.marketValue!]);
  const updates = coaches.map((c) => {
    const values = (byClub.get(c.clubId ?? -1) ?? []).sort((a, b) => b - a).slice(0, 11);
    const avg = values.length ? values.reduce((x, y) => x + y, 0) / values.length : s.valuation_base;
    return { id: c.id, previous: c.marketValue, value: clampValue(roundValue((avg * s.coach_value_factor) / 100), s.value_min, s.value_max) };
  });
  await prisma.$transaction([
    ...updates.map((u) => prisma.coach.update({ where: { id: u.id }, data: { marketValue: u.value } })),
    prisma.coachValuation.createMany({
      data: updates.map((u) => ({ coachId: u.id, value: u.value, previousValue: u.previous || null, change: u.previous ? u.value - u.previous : 0, reason: 'INITIAL', factors: JSON.stringify({ source: 'CLUB_SQUAD_VALUE' }) })),
    }),
  ]);
  await recomputeCoachRarities();
  return { initialized: updates.length };
}

/** Puntos por jornada de cada jugador en las jornadas indicadas (solo jornadas en las que jugó su club). */
async function recentPointsByPlayer(gameweekIds: number[]) {
  const [stats, fixtures] = await Promise.all([
    prisma.playerStatistic.groupBy({ by: ['playerId', 'gameweekId'], where: { gameweekId: { in: gameweekIds } }, _sum: { points: true } }),
    prisma.fixture.findMany({ where: { gameweekId: { in: gameweekIds }, status: { not: 'POSTPONED' } }, select: { gameweekId: true, homeClubId: true, awayClubId: true } }),
  ]);
  const clubPlayed = new Set(fixtures.flatMap((f) => [`${f.homeClubId}:${f.gameweekId}`, `${f.awayClubId}:${f.gameweekId}`]));
  const pts = new Map<string, number>();
  for (const s of stats) pts.set(`${s.playerId}:${s.gameweekId}`, s._sum.points ?? 0);
  return { clubPlayed, pts };
}

export async function recomputeRarities() {
  const s = await getSettings();
  const [players, { map }, lastGws] = await Promise.all([
    prisma.player.findMany({ where: { isActive: true, marketValue: { not: null } }, select: { id: true, marketValue: true, rarity: true } }),
    getPlayerAggregates(),
    prisma.gameweek.findMany({ where: { status: { not: 'UPCOMING' } }, orderBy: { id: 'desc' }, take: s.valuation_window, select: { id: true } }),
  ]);
  const gwIds = lastGws.map((g) => g.id);
  const recent = gwIds.length
    ? await prisma.playerStatistic.groupBy({ by: ['playerId'], where: { gameweekId: { in: gwIds } }, _sum: { points: true } })
    : [];
  const form = new Map(recent.map((r) => [r.playerId, (r._sum.points ?? 0) / Math.max(1, gwIds.length)]));
  const rarities = classifyRarities(
    players.map((p) => ({ id: p.id, value: p.marketValue!, seasonPoints: map.get(p.id)?.totalPoints ?? 0, recentForm: form.get(p.id) ?? 0 })),
    rarityCfg(s),
  );
  const changed = players.filter((p) => rarities.get(p.id) !== p.rarity);
  for (let i = 0; i < changed.length; i += 200) {
    await prisma.$transaction(changed.slice(i, i + 200).map((p) => prisma.player.update({ where: { id: p.id }, data: { rarity: rarities.get(p.id)! } })));
  }
  invalidatePlayerAggregates();
  await recomputeCoachRarities();
  return { players: players.length, changed: changed.length };
}

const rarityCfg = (s: Settings) => ({
  pctStar: s.rarity_pct_star,
  pctEpic: s.rarity_pct_epic,
  pctRare: s.rarity_pct_rare,
  pctUncommon: s.rarity_pct_uncommon,
  wValue: s.rarity_w_value,
  wPoints: s.rarity_w_points,
  wForm: s.rarity_w_form,
});

/** Entrenadores: la rareza depende de su valor (que refleja la calidad real de su plantilla y sus resultados). */
async function recomputeCoachRarities() {
  const s = await getSettings();
  const coaches = await prisma.coach.findMany({ where: { isActive: true }, select: { id: true, marketValue: true, rarity: true } });
  const rarities = classifyRarities(
    coaches.map((c) => ({ id: c.id, value: c.marketValue, seasonPoints: c.marketValue, recentForm: c.marketValue })),
    rarityCfg(s),
  );
  const changed = coaches.filter((c) => rarities.get(c.id) !== c.rarity);
  if (changed.length) await prisma.$transaction(changed.map((c) => prisma.coach.update({ where: { id: c.id }, data: { rarity: rarities.get(c.id)! } })));
}

/**
 * Actualiza los valores tras cerrar una jornada. Idempotente: marca la jornada (valuationsUpdated) y el
 * historial tiene clave única (jugador, jornada, motivo).
 */
export async function updateValuationsForGameweek(gameweekId: number) {
  const s = await getSettings();
  const gw = await prisma.gameweek.findUnique({ where: { id: gameweekId } });
  if (!gw) throw notFound('Jornada no encontrada');
  if (gw.valuationsUpdated) return { skipped: true, changed: 0 };
  await ensurePlayerValuations();

  const window = await prisma.gameweek.findMany({ where: { id: { lte: gameweekId } }, orderBy: { id: 'desc' }, take: s.valuation_window, select: { id: true } });
  const gwIds = window.map((g) => g.id).sort((a, b) => a - b);
  const { clubPlayed, pts } = await recentPointsByPlayer(gwIds);
  const players = await prisma.player.findMany({ where: { isActive: true, marketValue: { not: null } }, select: { id: true, clubId: true, marketValue: true, rarity: true, displayName: true } });

  const recentOf = (p: { id: number; clubId: number }) => gwIds.filter((g) => clubPlayed.has(`${p.clubId}:${g}`)).map((g) => pts.get(`${p.id}:${g}`) ?? 0);
  // Rendimiento esperado = media real de los jugadores de su misma rareza en la ventana reciente
  const byRarity = new Map<string, number[]>();
  for (const p of players) {
    const r = recentOf(p);
    if (r.length) byRarity.set(p.rarity, [...(byRarity.get(p.rarity) ?? []), r.reduce((a, b) => a + b, 0) / r.length]);
  }
  const expected = new Map([...byRarity].map(([r, xs]) => [r, xs.reduce((a, b) => a + b, 0) / xs.length]));

  const cfg = valuationConfig(s);
  const changes: { id: number; name: string; value: number; previous: number; change: number; variation: number; factors: object }[] = [];
  for (const p of players) {
    const played = clubPlayed.has(`${p.clubId}:${gameweekId}`);
    const result = computeValuation(
      { value: p.marketValue!, lastPoints: played ? (pts.get(`${p.id}:${gameweekId}`) ?? 0) : null, recent: recentOf(p), expected: expected.get(p.rarity) ?? 2 },
      cfg,
    );
    if (result) changes.push({ id: p.id, name: p.displayName, value: result.newValue, previous: p.marketValue!, change: result.change, variation: result.variation, factors: result.factors });
  }
  for (let i = 0; i < changes.length; i += 200) {
    const chunk = changes.slice(i, i + 200);
    await prisma.$transaction([
      ...chunk.map((c) => prisma.player.update({ where: { id: c.id }, data: { marketValue: c.value } })),
      prisma.playerValuation.createMany({
        data: chunk.map((c) => ({
          playerId: c.id,
          gameweekId,
          value: c.value,
          previousValue: c.previous,
          change: c.change,
          variationBp: Math.round(c.variation * 10000),
          reason: 'PERFORMANCE',
          factors: JSON.stringify(c.factors),
        })),
      }),
    ]);
  }
  const coaches = await updateCoachValuations(gameweekId, gwIds, s);
  await prisma.gameweek.update({ where: { id: gameweekId }, data: { valuationsUpdated: true } });
  await recomputeRarities();
  await notifyValueChanges(changes);
  return { changed: changes.length, rises: changes.filter((c) => c.change > 0).length, falls: changes.filter((c) => c.change < 0).length, coaches };
}

/** Puntos de entrenador de cada club en una jornada (a partir de los resultados reales terminados). */
export async function coachPointsByClub(gameweekId: number, s: Settings) {
  const fixtures = await prisma.fixture.findMany({ where: { gameweekId, status: 'FINISHED' }, select: { homeClubId: true, awayClubId: true, homeScore: true, awayScore: true } });
  const points = new Map<number, number>();
  for (const f of fixtures) {
    if (f.homeScore === null || f.awayScore === null) continue;
    points.set(f.homeClubId, (points.get(f.homeClubId) ?? 0) + coachMatchPoints(f.homeScore, f.awayScore, coachScoring(s)));
    points.set(f.awayClubId, (points.get(f.awayClubId) ?? 0) + coachMatchPoints(f.awayScore, f.homeScore, coachScoring(s)));
  }
  return points;
}

async function updateCoachValuations(gameweekId: number, gwIds: number[], s: Settings) {
  const coaches = await prisma.coach.findMany({ where: { isActive: true, clubId: { not: null }, marketValue: { gt: 0 } } });
  if (!coaches.length) return 0;
  const perGw = new Map<number, Map<number, number>>();
  for (const g of gwIds) perGw.set(g, await coachPointsByClub(g, s));
  const recentOf = (clubId: number) => gwIds.filter((g) => perGw.get(g)!.has(clubId)).map((g) => perGw.get(g)!.get(clubId)!);
  const all = coaches.flatMap((c) => recentOf(c.clubId!));
  const expected = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 1;
  // La escala de puntos de un entrenador es la de una victoria (sus puntos por jornada son mucho menores que los de un jugador)
  const cfg = valuationConfig(s, Math.max(1, Math.abs(s.coach_points_win) + Math.abs(s.coach_points_clean_sheet)));
  let changed = 0;
  for (const c of coaches) {
    const last = perGw.get(gameweekId)!.get(c.clubId!);
    const result = computeValuation({ value: c.marketValue, lastPoints: last ?? null, recent: recentOf(c.clubId!), expected }, cfg);
    if (!result) continue;
    await prisma.$transaction([
      prisma.coach.update({ where: { id: c.id }, data: { marketValue: result.newValue } }),
      prisma.coachValuation.create({
        data: {
          coachId: c.id,
          gameweekId,
          value: result.newValue,
          previousValue: c.marketValue,
          change: result.change,
          variationBp: Math.round(result.variation * 10000),
          reason: 'PERFORMANCE',
          factors: JSON.stringify(result.factors),
        },
      }),
    ]);
    changed++;
  }
  return changed;
}

/** Avisa a los dueños (economía de liga) de los cambios de valor de sus jugadores. */
async function notifyValueChanges(changes: { id: number; name: string; change: number; value: number }[]) {
  if (!changes.length) return;
  const byId = new Map(changes.map((c) => [c.id, c]));
  const owned = await prisma.leaguePlayerOwnership.findMany({ where: { playerId: { in: [...byId.keys()] } }, select: { playerId: true, team: { select: { userId: true } } } });
  const byUser = new Map<string, typeof changes>();
  for (const o of owned) byUser.set(o.team.userId, [...(byUser.get(o.team.userId) ?? []), byId.get(o.playerId)!]);
  const notifications: NotificationInput[] = [];
  for (const [userId, list] of byUser) {
    const up = list.filter((c) => c.change > 0).length;
    notifications.push({
      userId,
      type: 'PRICE_CHANGE',
      title: list.length === 1 ? `El valor de ${list[0].name} ${list[0].change > 0 ? 'subió' : 'bajó'}` : `Cambios de valor en tu plantilla (${up}↑ ${list.length - up}↓)`,
      message: list.slice(0, 8).map((c) => `${c.name} ${c.change > 0 ? '+' : ''}${formatK(c.change)} → ${formatK(c.value)}`).join(' · '),
      link: '/team',
    });
  }
  await notifyMany(notifications);
}

/** Ajuste manual del valor (administración), con historial. */
export async function setPlayerValue(playerId: number, value: number) {
  const s = await getSettings();
  if (!Number.isInteger(value) || value < s.value_min || value > s.value_max) throw badRequest(`El valor debe estar entre ${formatK(s.value_min)} y ${formatK(s.value_max)}`);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound('Jugador no encontrado');
  await prisma.$transaction([
    prisma.player.update({ where: { id: playerId }, data: { marketValue: value } }),
    prisma.playerValuation.create({ data: { playerId, value, previousValue: player.marketValue, change: value - (player.marketValue ?? value), reason: 'ADMIN' } }),
  ]);
  invalidatePlayerAggregates();
  return { id: playerId, marketValue: value };
}

/** Recalibración completa (tras cambiar la curva inicial en administración). Conserva el historial. */
export async function recalibrateAllValues() {
  const s = await getSettings();
  const players = await prisma.player.findMany({ select: { id: true, price: true, marketValue: true } });
  const updates = players
    .map((p) => ({ id: p.id, previous: p.marketValue, value: initialValueFromFpl(p.price, initialCfg(s)) }))
    .filter((u) => u.value !== u.previous);
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    await prisma.$transaction([
      ...chunk.map((u) => prisma.player.update({ where: { id: u.id }, data: { marketValue: u.value } })),
      prisma.playerValuation.createMany({ data: chunk.map((u) => ({ playerId: u.id, value: u.value, previousValue: u.previous, change: u.value - (u.previous ?? u.value), reason: 'RECALIBRATION' })) }),
    ]);
  }
  await ensureCoachValuations(true);
  await recomputeRarities();
  return { players: updates.length };
}

export async function valuationHistory(playerId: number) {
  return prisma.playerValuation.findMany({
    where: { playerId },
    orderBy: { createdAt: 'asc' },
    select: { gameweekId: true, value: true, change: true, variationBp: true, reason: true, createdAt: true },
  });
}

export type { PlayerRarity };

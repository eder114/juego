import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { scorePerformance, type RuleLike } from '../domain/scoring';
import { scoreLineup, type ScoringEntry } from '../domain/lineup';
import type { Position } from '../domain/constants';
import { getSettings } from './settings.service';
import { getGameweekLocks } from './gameweek.service';
import { ensureLineup } from './lineup.service';
import { invalidatePlayerAggregates } from './player-stats.service';
import { invalidateRankings } from './ranking.service';
import { notifyMany } from './notification.service';
import { evaluateGameweekAchievements, unlock } from './achievement.service';
import { updatePricesForGameweek } from './price.service';

export async function loadRules(): Promise<RuleLike[]> {
  return prisma.scoringRule.findMany();
}

async function runChunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Recalcula puntos y desglose de las estadísticas de partido con las reglas vigentes. */
export async function recalculateStatistics(where: { gameweekId?: number; playerIds?: number[]; fixtureId?: number } = {}) {
  const rules = await loadRules();
  const rows = await prisma.playerStatistic.findMany({
    where: {
      gameweekId: where.gameweekId,
      fixtureId: where.fixtureId,
      playerId: where.playerIds ? { in: where.playerIds } : undefined,
    },
    include: { player: { select: { position: true } } },
  });
  const updates = rows
    .map((row) => {
      const { points, breakdown } = scorePerformance(row.player.position as Position, row, rules);
      const json = JSON.stringify(breakdown);
      return points !== row.points || json !== row.breakdown ? { id: row.id, points, breakdown: json } : null;
    })
    .filter((u): u is { id: number; points: number; breakdown: string } => u !== null);

  await runChunked(updates, 200, (chunk) =>
    prisma.$transaction(chunk.map((u) => prisma.playerStatistic.update({ where: { id: u.id }, data: { points: u.points, breakdown: u.breakdown } }))),
  );
  invalidatePlayerAggregates();
  return { scanned: rows.length, updated: updates.length };
}

/**
 * Procesa una jornada: puntos de jugadores, alineaciones (sustituciones automáticas y capitanía),
 * totales de equipos. Con `final` cierra la jornada, notifica, evalúa logros y actualiza precios.
 * Es idempotente: puede ejecutarse varias veces (p. ej. tras corregir un resultado).
 */
export async function processGameweek(gameweekId: number, opts: { final: boolean; notify?: boolean } = { final: false }) {
  const settings = await getSettings();
  const locks = await getGameweekLocks(gameweekId);
  if (!locks) throw notFound('Jornada no encontrada');
  const wasProcessed = locks.gameweek.isProcessed;

  await recalculateStatistics({ gameweekId });

  if (locks.anyLocked || opts.final) {
    const teams = await prisma.fantasyTeam.findMany({ select: { id: true } });
    for (const t of teams) await ensureLineup(t.id, gameweekId);
  }

  const stats = await prisma.playerStatistic.groupBy({
    by: ['playerId'],
    where: { gameweekId },
    _sum: { points: true, minutes: true },
  });
  const statMap = new Map(stats.map((s) => [s.playerId, { points: s._sum.points ?? 0, minutes: s._sum.minutes ?? 0 }]));

  const lineups = await prisma.lineup.findMany({
    where: { gameweekId },
    include: { players: { include: { player: { select: { position: true, clubId: true } } } }, team: { select: { userId: true } } },
  });

  const totalsByLineup = new Map<number, number>();
  for (const lineup of lineups) {
    const entries: ScoringEntry[] = lineup.players.map((lp) => ({
      playerId: lp.playerId,
      position: lp.player.position as Position,
      role: lp.role as 'STARTER' | 'BENCH',
      order: lp.order,
      points: statMap.get(lp.playerId)?.points ?? 0,
      minutes: statMap.get(lp.playerId)?.minutes ?? 0,
      done: opts.final || locks.clubDone(lp.player.clubId),
    }));
    const result = scoreLineup(entries, {
      captainId: lineup.captainId,
      viceCaptainId: lineup.viceCaptainId,
      captainMultiplier: settings.captain_multiplier,
      viceCaptainEnabled: settings.vice_captain_enabled,
      autoSubsEnabled: settings.auto_subs_enabled,
    });
    totalsByLineup.set(lineup.id, result.total);
    await prisma.$transaction([
      ...result.entries.map((e) =>
        prisma.lineupPlayer.update({
          where: { lineupId_playerId: { lineupId: lineup.id, playerId: e.playerId } },
          data: { points: e.points, multiplier: e.multiplier, autoSubIn: e.autoSubIn, autoSubOut: e.autoSubOut },
        }),
      ),
      prisma.lineup.update({
        where: { id: lineup.id },
        data: { points: result.total, benchPoints: result.benchPoints, isFinal: opts.final },
      }),
    ]);
  }

  // Totales de temporada
  const totals = await prisma.lineup.groupBy({ by: ['teamId'], _sum: { points: true } });
  await runChunked(totals, 200, (chunk) =>
    prisma.$transaction(chunk.map((t) => prisma.fantasyTeam.update({ where: { id: t.teamId }, data: { totalPoints: t._sum.points ?? 0 } }))),
  );
  invalidateRankings();

  if (opts.final) {
    await prisma.gameweek.update({ where: { id: gameweekId }, data: { isProcessed: true, status: 'FINISHED' } });
    if (!wasProcessed && opts.notify !== false) {
      await notifyMany(
        lineups.map((l) => ({
          userId: l.team.userId,
          type: 'GAMEWEEK_RESULT' as const,
          title: `Resultado de la ${locks.gameweek.name}: ${totalsByLineup.get(l.id) ?? 0} puntos`,
          message: 'Ya están disponibles los puntos definitivos de tu equipo. ¡Consulta tu clasificación!',
          link: `/lineup?gw=${gameweekId}`,
        })),
      );
      await evaluateGameweekAchievements(gameweekId, settings.captain_multiplier);
      await evaluateLeagueLeaders();
    }
    if (settings.auto_price_update && !locks.gameweek.pricesUpdated) await updatePricesForGameweek(gameweekId);
  }

  return { gameweekId, lineups: lineups.length, final: opts.final };
}

async function evaluateLeagueLeaders() {
  const leagues = await prisma.league.findMany({
    where: { isSystem: false },
    include: { members: { select: { userId: true, user: { select: { team: { select: { totalPoints: true } } } } } } },
  });
  for (const league of leagues) {
    if (league.members.length < 3) continue;
    const sorted = [...league.members].sort((a, b) => (b.user.team?.totalPoints ?? 0) - (a.user.team?.totalPoints ?? 0));
    if ((sorted[0].user.team?.totalPoints ?? 0) > (sorted[1].user.team?.totalPoints ?? 0)) await unlock(sorted[0].userId, 'LEAGUE_LEADER');
  }
}

/** Tras cambiar reglas de puntuación: recalcula todo manteniendo el estado de cada jornada. */
export async function recalculateSeason() {
  await recalculateStatistics();
  const gameweeks = await prisma.gameweek.findMany({ where: { lineups: { some: {} } }, orderBy: { id: 'asc' } });
  for (const gw of gameweeks) await processGameweek(gw.id, { final: gw.isProcessed, notify: false });
  return { gameweeks: gameweeks.length };
}

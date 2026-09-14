import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { computePriceChange } from '../domain/pricing';
import { getSettings } from './settings.service';
import { invalidatePlayerAggregates } from './player-stats.service';
import { notifyMany, type NotificationInput } from './notification.service';

const money = (t: number) => `£${(t / 10).toFixed(1)}M`;
const signed = (t: number) => `${t > 0 ? '+' : '-'}£${(Math.abs(t) / 10).toFixed(1)}M`;

/** Aplica el sistema de precios al cerrar una jornada (rendimiento + demanda). */
export async function updatePricesForGameweek(gameweekId: number) {
  const settings = await getSettings();
  const gw = await prisma.gameweek.findUnique({ where: { id: gameweekId }, include: { fixtures: true } });
  if (!gw) throw notFound('Jornada no encontrada');

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [players, stats, transfers, activeTeams] = await Promise.all([
    prisma.player.findMany({ where: { isActive: true }, select: { id: true, price: true, clubId: true, displayName: true } }),
    prisma.playerStatistic.groupBy({ by: ['playerId'], where: { gameweekId }, _sum: { points: true, minutes: true } }),
    prisma.transfer.groupBy({ by: ['playerId', 'type'], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.fantasyTeam.count({ where: { players: { some: {} } } }),
  ]);
  const clubsPlaying = new Set(gw.fixtures.filter((f) => f.status !== 'POSTPONED').flatMap((f) => [f.homeClubId, f.awayClubId]));
  const statMap = new Map(stats.map((s) => [s.playerId, s._sum]));
  const net = new Map<number, number>();
  for (const t of transfers) net.set(t.playerId, (net.get(t.playerId) ?? 0) + (t.type === 'BUY' ? 1 : -1) * t._count._all);

  const changes: { id: number; name: string; price: number; change: number; reason: string }[] = [];
  for (const p of players) {
    const s = statMap.get(p.id);
    const decision = computePriceChange(
      {
        price: p.price,
        points: clubsPlaying.has(p.clubId) ? (s?.points ?? 0) : null,
        minutes: s?.minutes ?? 0,
        netTransfers: net.get(p.id) ?? 0,
        activeTeams,
      },
      settings,
    );
    if (decision) changes.push({ id: p.id, name: p.displayName, price: decision.newPrice, change: decision.change, reason: decision.reason });
  }

  for (let i = 0; i < changes.length; i += 200) {
    const chunk = changes.slice(i, i + 200);
    await prisma.$transaction([
      ...chunk.map((c) => prisma.player.update({ where: { id: c.id }, data: { price: c.price } })),
      prisma.playerPrice.createMany({
        data: chunk.map((c) => ({ playerId: c.id, gameweekId, price: c.price, change: c.change, reason: c.reason })),
      }),
    ]);
  }
  await prisma.gameweek.update({ where: { id: gameweekId }, data: { pricesUpdated: true } });
  invalidatePlayerAggregates();
  await notifyPriceChanges(changes);
  return { changed: changes.length, rises: changes.filter((c) => c.change > 0).length, falls: changes.filter((c) => c.change < 0).length };
}

async function notifyPriceChanges(changes: { id: number; name: string; change: number; price: number }[]) {
  if (changes.length === 0) return;
  const changeMap = new Map(changes.map((c) => [c.id, c]));
  const owned = await prisma.fantasyTeamPlayer.findMany({
    where: { playerId: { in: [...changeMap.keys()] } },
    select: { playerId: true, team: { select: { userId: true } } },
  });
  const byUser = new Map<string, typeof changes>();
  for (const o of owned) {
    const list = byUser.get(o.team.userId) ?? [];
    list.push(changeMap.get(o.playerId)!);
    byUser.set(o.team.userId, list);
  }
  const notifications: NotificationInput[] = [];
  for (const [userId, list] of byUser) {
    const up = list.filter((c) => c.change > 0);
    const title =
      list.length === 1
        ? `El precio de ${list[0].name} ${list[0].change > 0 ? 'aumentó' : 'bajó'}`
        : `Cambios de precio en tu plantilla (${up.length}↑ ${list.length - up.length}↓)`;
    notifications.push({
      userId,
      type: 'PRICE_CHANGE',
      title,
      message: list.map((c) => `${c.name} ${signed(c.change)} → ${money(c.price)}`).join(' · '),
      link: '/team',
    });
  }
  await notifyMany(notifications);
}

export async function setPlayerPrice(playerId: number, price: number) {
  const settings = await getSettings();
  if (!Number.isInteger(price) || price < settings.price_min || price > settings.price_max)
    throw badRequest(`El precio debe estar entre ${money(settings.price_min)} y ${money(settings.price_max)}`);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw notFound('Jugador no encontrado');
  if (player.price === price) return player;
  const change = price - player.price;
  const [updated] = await prisma.$transaction([
    prisma.player.update({ where: { id: playerId }, data: { price } }),
    prisma.playerPrice.create({ data: { playerId, price, change, reason: 'ADMIN' } }),
  ]);
  invalidatePlayerAggregates();
  await notifyPriceChanges([{ id: playerId, name: player.displayName, change, price }]);
  return updated;
}

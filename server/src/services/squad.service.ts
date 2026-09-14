import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { playerSelect } from '../lib/dto';
import { getSettings, squadRequirements } from './settings.service';
import { getGameweekContext, getGameweekLocks } from './gameweek.service';
import { aggFor, getPlayerAggregates, invalidatePlayerAggregates, toPlayerDTO } from './player-stats.service';
import { ensureLineup } from './lineup.service';
import { evaluateMarketAchievements } from './achievement.service';
import type { Position } from '../domain/constants';

export const formatMoney = (tenths: number) => `£${(tenths / 10).toFixed(1)}M`;

export async function getTeamByUser(userId: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId } });
  if (!team) throw notFound('Aún no has creado tu equipo Fantasy');
  return team;
}

export async function createTeam(userId: string, data: { name: string; crest?: object }) {
  const existing = await prisma.fantasyTeam.findUnique({ where: { userId } });
  if (existing) throw conflict('Ya tienes un equipo Fantasy');
  const settings = await getSettings();
  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.fantasyTeam.create({
      data: { userId, name: data.name, crest: JSON.stringify(data.crest ?? {}), budget: settings.initial_budget },
    });
    await tx.transaction.create({
      data: {
        teamId: t.id,
        type: 'INITIAL_BUDGET',
        amount: settings.initial_budget,
        balanceAfter: settings.initial_budget,
        description: `Presupuesto inicial de temporada ${settings.season}`,
      },
    });
    const global = await tx.league.findFirst({ where: { type: 'GLOBAL', isSystem: true } });
    if (global) {
      await tx.leagueMember.upsert({
        where: { leagueId_userId: { leagueId: global.id, userId } },
        create: { leagueId: global.id, userId },
        update: {},
      });
    }
    return t;
  });
  return team;
}

export async function updateTeam(userId: string, data: { name?: string; crest?: object }) {
  const team = await getTeamByUser(userId);
  return prisma.fantasyTeam.update({
    where: { id: team.id },
    data: { name: data.name, crest: data.crest ? JSON.stringify(data.crest) : undefined },
  });
}

export async function getSquad(userId: string) {
  const team = await getTeamByUser(userId);
  const settings = await getSettings();
  const [entries, { map }] = await Promise.all([
    prisma.fantasyTeamPlayer.findMany({
      where: { teamId: team.id },
      include: { player: { select: playerSelect } },
      orderBy: { acquiredAt: 'asc' },
    }),
    getPlayerAggregates(),
  ]);
  const req = squadRequirements(settings);
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubCounts: Record<string, number> = {};
  let teamValue = 0;
  const players = entries.map((e) => {
    counts[e.player.position as Position] += 1;
    clubCounts[e.player.club.shortName] = (clubCounts[e.player.club.shortName] ?? 0) + 1;
    teamValue += e.player.price;
    return {
      ...toPlayerDTO(e.player, aggFor(map, e.player.id)),
      purchasePrice: e.purchasePrice,
      acquiredAt: e.acquiredAt,
      priceDelta: e.player.price - e.purchasePrice,
      salePrice: settings.sell_at_purchase_price ? e.purchasePrice : e.player.price,
    };
  });
  const size = req.GK + req.DEF + req.MID + req.FWD;
  return {
    team: { id: team.id, name: team.name, crest: JSON.parse(team.crest || '{}'), totalPoints: team.totalPoints },
    budget: team.budget,
    teamValue,
    totalValue: teamValue + team.budget,
    players,
    counts,
    requirements: req,
    squadSize: size,
    isComplete: players.length === size && (Object.keys(req) as Position[]).every((p) => counts[p] === req[p]),
    maxPerClub: settings.max_players_per_club,
    clubCounts,
    marketOpen: settings.market_open,
    sellAtPurchasePrice: settings.sell_at_purchase_price,
  };
}

/** Si la jornada en curso ya ha empezado, congela la alineación antes de tocar la plantilla. */
async function snapshotCurrentLineup(teamId: number) {
  const { current } = await getGameweekContext();
  if (!current || current.isProcessed) return null;
  const locks = await getGameweekLocks(current.id);
  if (!locks?.anyLocked) return null;
  await ensureLineup(teamId, current.id);
  return locks;
}

export async function buyPlayer(userId: string, playerId: number) {
  const settings = await getSettings();
  if (!settings.market_open) throw badRequest('El mercado está cerrado');
  const team = await getTeamByUser(userId);
  const player = await prisma.player.findUnique({ where: { id: playerId }, include: { club: true } });
  if (!player || !player.isActive) throw notFound('Jugador no disponible en el mercado');
  if (!player.club.isActive) throw badRequest('El club del jugador no participa en la temporada activa');

  await snapshotCurrentLineup(team.id);
  const { next, current } = await getGameweekContext();
  const req = squadRequirements(settings);

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: team.id } });
    const squad = await tx.fantasyTeamPlayer.findMany({
      where: { teamId: team.id },
      select: { playerId: true, player: { select: { position: true, clubId: true } } },
    });
    if (squad.some((s) => s.playerId === playerId)) throw conflict(`${player.displayName} ya está en tu plantilla`);
    const pos = player.position as Position;
    const inPosition = squad.filter((s) => s.player.position === pos).length;
    if (inPosition >= req[pos]) throw badRequest(`Ya tienes los ${req[pos]} jugadores permitidos en la posición ${pos}`);
    const fromClub = squad.filter((s) => s.player.clubId === player.clubId).length;
    if (fromClub >= settings.max_players_per_club)
      throw badRequest(`Máximo ${settings.max_players_per_club} jugadores del mismo club (${player.club.name})`);
    if (fresh.budget < player.price)
      throw badRequest(`Presupuesto insuficiente: necesitas ${formatMoney(player.price)} y tienes ${formatMoney(fresh.budget)}`);

    const balance = fresh.budget - player.price;
    await tx.fantasyTeam.update({ where: { id: team.id }, data: { budget: balance } });
    await tx.fantasyTeamPlayer.create({ data: { teamId: team.id, playerId, purchasePrice: player.price } });
    const transfer = await tx.transfer.create({
      data: { teamId: team.id, playerId, type: 'BUY', price: player.price, gameweekId: (next ?? current)?.id },
    });
    await tx.transaction.create({
      data: {
        teamId: team.id,
        transferId: transfer.id,
        type: 'PURCHASE',
        amount: -player.price,
        balanceAfter: balance,
        description: `Fichaje de ${player.displayName} (${player.club.shortName})`,
      },
    });
    return { budget: balance, transferId: transfer.id };
  });

  invalidatePlayerAggregates();
  await evaluateMarketAchievements(userId, team.id);
  return { ...result, player: { id: player.id, displayName: player.displayName, price: player.price } };
}

export async function sellPlayer(userId: string, playerId: number) {
  const settings = await getSettings();
  if (!settings.market_open) throw badRequest('El mercado está cerrado');
  const team = await getTeamByUser(userId);
  const entry = await prisma.fantasyTeamPlayer.findUnique({
    where: { teamId_playerId: { teamId: team.id, playerId } },
    include: { player: { include: { club: true } } },
  });
  if (!entry) throw notFound('Ese jugador no está en tu plantilla');

  const locks = await snapshotCurrentLineup(team.id);
  if (locks && locks.clubLocked(entry.player.clubId)) {
    const inLineup = await prisma.lineupPlayer.findFirst({
      where: { playerId, lineup: { teamId: team.id, gameweekId: locks.gameweek.id } },
    });
    if (inLineup) throw badRequest(`${entry.player.displayName} está bloqueado: su partido de la ${locks.gameweek.name} ya ha comenzado`);
  }

  const salePrice = settings.sell_at_purchase_price ? entry.purchasePrice : entry.player.price;
  const { next, current } = await getGameweekContext();

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: team.id } });
    const balance = fresh.budget + salePrice;
    await tx.fantasyTeamPlayer.delete({ where: { id: entry.id } });
    // Se retira de las alineaciones aún no cerradas
    await tx.lineupPlayer.deleteMany({
      where: { playerId, lineup: { teamId: team.id, isFinal: false, gameweek: { isProcessed: false } } },
    });
    await tx.fantasyTeam.update({ where: { id: team.id }, data: { budget: balance } });
    const transfer = await tx.transfer.create({
      data: { teamId: team.id, playerId, type: 'SELL', price: salePrice, gameweekId: (next ?? current)?.id },
    });
    await tx.transaction.create({
      data: {
        teamId: team.id,
        transferId: transfer.id,
        type: 'SALE',
        amount: salePrice,
        balanceAfter: balance,
        description: `Venta de ${entry.player.displayName} (${entry.player.club.shortName})`,
      },
    });
    const profit = salePrice - entry.purchasePrice;
    return { budget: balance, salePrice, profit };
  });

  invalidatePlayerAggregates();
  await evaluateMarketAchievements(userId, team.id);
  return { ...result, player: { id: entry.player.id, displayName: entry.player.displayName } };
}

export async function getTransferHistory(userId: string) {
  const team = await getTeamByUser(userId);
  const [transfers, transactions] = await Promise.all([
    prisma.transfer.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: 'desc' },
      include: { player: { select: playerSelect }, gameweek: { select: { id: true, name: true } } },
      take: 200,
    }),
    prisma.transaction.findMany({ where: { teamId: team.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  return { transfers, transactions };
}

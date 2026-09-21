import { prisma, type Tx } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { playerSelect, parseCrest } from '../lib/dto';
import { DEFAULT_CARDS } from '../domain/constants';
import type { CardModifier } from '../domain/economy';
import { getSettings } from './settings.service';
import { getGameweekContext } from './gameweek.service';
import { aggFor, getPlayerAggregates, toPlayerDTO } from './player-stats.service';
import { notify, notifyMany, type NotificationInput } from './notification.service';
import { isUniqueViolation } from './economy.service';

/**
 * Cartas potenciadoras
 * ────────────────────
 * - Cada carta del inventario es de un solo uso (TeamCard). Se activa para la próxima jornada, antes de su cierre.
 * - Activación idempotente: `requestId` único + paso AVAILABLE → ACTIVE condicional (un doble clic no gasta dos cartas).
 * - Hasta el cierre se puede cancelar (la carta vuelve al inventario); después queda bloqueada.
 * - El efecto se aplica en el motor de puntuación (domain/economy.ts → applyCardModifiers): nunca toca estadísticas reales.
 * - Se obtienen como recompensa (rachas, desafíos, eventos, administración): no hay compra con dinero real.
 */

export async function ensureCardCatalog() {
  for (const c of DEFAULT_CARDS) {
    const exists = await prisma.powerUpCard.findUnique({ where: { code: c.code } });
    if (!exists) await prisma.powerUpCard.create({ data: { ...c } });
  }
}

async function log(db: Tx, teamId: number, teamCardId: number | null, action: string, details: object = {}) {
  await db.cardUsageLog.create({ data: { teamId, teamCardId, action, details: JSON.stringify(details) } });
}

/**
 * Concede una carta. `sourceRef` hace la concesión idempotente (la misma recompensa nunca da dos cartas).
 * Devuelve null si la carta no existe o no se puede conseguir.
 */
export async function grantCard(db: Tx, input: { teamId: number; cardCode: string; source: string; sourceRef?: string | null }) {
  const card = await db.powerUpCard.findUnique({ where: { code: input.cardCode } });
  if (!card || !card.obtainable) return null;
  if (input.sourceRef && (await db.teamCard.findUnique({ where: { sourceRef: input.sourceRef } }))) return null;
  const tc = await db.teamCard.create({ data: { teamId: input.teamId, cardId: card.id, source: input.source, sourceRef: input.sourceRef ?? null } });
  await log(db, input.teamId, tc.id, 'GRANTED', { card: card.code, source: input.source, sourceRef: input.sourceRef });
  return { id: tc.id, code: card.code, name: card.name };
}

/** Jornada sobre la que se activan cartas: la próxima cuyo cierre aún no ha llegado (según el reloj del servidor). */
async function cardGameweek() {
  const { next } = await getGameweekContext();
  return next;
}

async function teamOf(userId: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId } });
  if (!team) throw notFound('Aún no has creado tu equipo Fantasy');
  return team;
}

export async function getCards(userId: string) {
  const team = await teamOf(userId);
  const gw = await cardGameweek();
  const [inventory, activations, received, catalog] = await Promise.all([
    prisma.teamCard.findMany({ where: { teamId: team.id }, include: { card: true }, orderBy: { acquiredAt: 'desc' } }),
    prisma.cardActivation.findMany({
      where: { teamId: team.id, status: { not: 'CANCELLED' } },
      include: { card: true, targetTeam: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.cardActivation.findMany({
      where: { targetTeamId: team.id, teamId: { not: team.id }, status: 'APPLIED' },
      include: { card: true, team: { select: { id: true, name: true } } },
      orderBy: { appliedAt: 'desc' },
      take: 20,
    }),
    prisma.powerUpCard.findMany({ orderBy: { id: 'asc' } }),
  ]);
  const playerIds = [...new Set([...activations, ...received].map((a) => a.targetPlayerId))];
  const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, displayName: true, photoUrl: true, position: true, club: { select: { shortName: true } } } });
  const playerById = new Map(players.map((p) => [p.id, p]));
  return {
    gameweek: gw ? { id: gw.id, name: gw.name, deadline: gw.deadline } : null,
    serverTime: new Date().toISOString(),
    inventory: inventory.map((t) => ({ id: t.id, status: t.status, source: t.source, acquiredAt: t.acquiredAt, usedAt: t.usedAt, card: publicCard(t.card) })),
    activations: activations.map((a) => ({
      id: a.id,
      teamCardId: a.teamCardId,
      gameweekId: a.gameweekId,
      status: a.status,
      effect: a.effect,
      effectValue: a.effectValue,
      pointsDelta: a.pointsDelta,
      card: publicCard(a.card),
      targetPlayer: playerById.get(a.targetPlayerId) ?? null,
      targetTeam: a.targetTeam,
      cancellable: a.status === 'ACTIVE' && !!gw && a.gameweekId === gw.id && gw.deadline > new Date(),
      createdAt: a.createdAt,
    })),
    received: received.map((a) => ({ id: a.id, gameweekId: a.gameweekId, pointsDelta: a.pointsDelta, card: publicCard(a.card), fromTeam: a.team, targetPlayer: playerById.get(a.targetPlayerId) ?? null })),
    catalog: catalog.map(publicCard),
  };
}

function publicCard(c: { id: number; code: string; name: string; description: string; effect: string; rarity: string; effectValue: number; target: string; isActive: boolean; obtainable: boolean; maxPerGameweek: number }) {
  return { id: c.id, code: c.code, name: c.name, description: c.description, effect: c.effect, rarity: c.rarity, effectValue: c.effectValue, target: c.target, isActive: c.isActive, obtainable: c.obtainable, maxPerGameweek: c.maxPerGameweek };
}

/** Rivales a los que se puede aplicar una carta de presión: equipos con los que compartes una liga (sin contar la global). */
export async function rivalTargets(userId: string) {
  const team = await teamOf(userId);
  const leagues = await prisma.leagueMember.findMany({ where: { userId, league: { type: { not: 'GLOBAL' } } }, select: { leagueId: true, league: { select: { name: true } } } });
  const members = await prisma.leagueMember.findMany({
    where: { leagueId: { in: leagues.map((l) => l.leagueId) }, userId: { not: userId } },
    select: { leagueId: true, user: { select: { managerName: true, team: { select: { id: true, name: true, crest: true } } } } },
  });
  const byTeam = new Map<number, { teamId: number; teamName: string; managerName: string; crest: unknown; leagues: string[] }>();
  for (const m of members) {
    const t = m.user.team;
    if (!t || t.id === team.id) continue;
    const entry = byTeam.get(t.id) ?? { teamId: t.id, teamName: t.name, managerName: m.user.managerName, crest: parseCrest(t.crest), leagues: [] as string[] };
    entry.leagues.push(leagues.find((l) => l.leagueId === m.leagueId)!.league.name);
    byTeam.set(t.id, entry);
  }
  return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
}

async function sharesLeague(userA: string, teamIdB: number) {
  const b = await prisma.fantasyTeam.findUnique({ where: { id: teamIdB }, select: { userId: true } });
  if (!b) return false;
  const shared = await prisma.leagueMember.count({ where: { userId: userA, league: { type: { not: 'GLOBAL' }, members: { some: { userId: b.userId } } } } });
  return shared > 0;
}

export async function targetSquad(userId: string, teamId: number) {
  const own = await teamOf(userId);
  if (teamId !== own.id && !(await sharesLeague(userId, teamId))) throw forbidden('Solo puedes elegir jugadores de rivales de tus ligas');
  const [entries, { map }] = await Promise.all([
    prisma.fantasyTeamPlayer.findMany({ where: { teamId }, include: { player: { select: playerSelect } } }),
    getPlayerAggregates(),
  ]);
  return entries.map((e) => toPlayerDTO(e.player, aggFor(map, e.playerId)));
}

export interface ActivateInput {
  teamCardId: number;
  targetPlayerId: number;
  targetTeamId?: number | null;
  requestId: string;
}

export async function activateCard(userId: string, input: ActivateInput) {
  const s = await getSettings();
  const team = await teamOf(userId);

  // Idempotencia: el mismo requestId devuelve la activación ya creada
  const previous = await prisma.cardActivation.findUnique({ where: { requestId: input.requestId } });
  if (previous) {
    if (previous.teamId !== team.id) throw conflict('Identificador de petición ya utilizado');
    return { activationId: previous.id, status: previous.status, duplicate: true };
  }

  const teamCard = await prisma.teamCard.findUnique({ where: { id: input.teamCardId }, include: { card: true } });
  if (!teamCard || teamCard.teamId !== team.id) throw notFound('Esa carta no está en tu inventario');
  if (teamCard.status !== 'AVAILABLE') throw conflict('Esta carta ya se ha usado o está activada');
  if (!teamCard.card.isActive) throw badRequest('Esta carta está desactivada temporalmente');

  const gw = await cardGameweek();
  if (!gw || gw.deadline <= new Date()) throw badRequest('No hay ninguna jornada abierta para activar cartas');

  const effect = teamCard.card.effect;
  let targetTeamId = team.id;
  if (teamCard.card.target === 'OWN_PLAYER') {
    const inSquad = await prisma.fantasyTeamPlayer.findUnique({ where: { teamId_playerId: { teamId: team.id, playerId: input.targetPlayerId } } });
    if (!inSquad) throw badRequest('Elige un jugador de tu plantilla');
  } else {
    if (!input.targetTeamId || input.targetTeamId === team.id) throw badRequest('Elige un equipo rival');
    if (!(await sharesLeague(userId, input.targetTeamId))) throw forbidden('Solo puedes usar esta carta contra rivales de tus ligas');
    const inSquad = await prisma.fantasyTeamPlayer.findUnique({ where: { teamId_playerId: { teamId: input.targetTeamId, playerId: input.targetPlayerId } } });
    if (!inSquad) throw badRequest('Ese jugador no está en la plantilla del rival');
    targetTeamId = input.targetTeamId;
  }

  try {
    const activation = await prisma.$transaction(async (tx) => {
      // Serializa las activaciones del equipo (y del rival afectado) para que los límites se cumplan con peticiones simultáneas
      await tx.fantasyTeam.update({ where: { id: team.id }, data: { updatedAt: new Date() } });
      if (targetTeamId !== team.id) await tx.fantasyTeam.update({ where: { id: targetTeamId }, data: { updatedAt: new Date() } });

      const claimed = await tx.teamCard.updateMany({ where: { id: teamCard.id, status: 'AVAILABLE' }, data: { status: 'ACTIVE' } });
      if (claimed.count === 0) throw conflict('Esta carta ya se ha usado o está activada');

      const mine = await tx.cardActivation.findMany({ where: { teamId: team.id, gameweekId: gw.id, status: 'ACTIVE' }, select: { effect: true, targetPlayerId: true, targetTeamId: true } });
      if (mine.length >= s.card_max_active_per_gameweek) throw badRequest(`Máximo ${s.card_max_active_per_gameweek} cartas activas por jornada`);
      if (mine.filter((a) => a.effect === effect).length >= teamCard.card.maxPerGameweek) throw badRequest(`Ya has activado ${teamCard.card.maxPerGameweek} carta(s) de este tipo en la ${gw.name}`);
      if (mine.some((a) => a.effect === effect && a.targetPlayerId === input.targetPlayerId && a.targetTeamId === targetTeamId)) throw badRequest('Ese jugador ya tiene esta carta en la jornada');
      if (effect === 'WEAKEN') {
        const onTarget = await tx.cardActivation.count({ where: { gameweekId: gw.id, status: 'ACTIVE', effect: 'WEAKEN', targetTeamId, targetPlayerId: input.targetPlayerId } });
        if (onTarget >= s.card_weaken_max_per_target) throw badRequest('Ese jugador ya está bajo presión esta jornada');
      }
      const created = await tx.cardActivation.create({
        data: {
          teamCardId: teamCard.id,
          teamId: team.id,
          cardId: teamCard.cardId,
          gameweekId: gw.id,
          effect,
          effectValue: teamCard.card.effectValue,
          targetPlayerId: input.targetPlayerId,
          targetTeamId,
          requestId: input.requestId,
        },
      });
      await log(tx, team.id, teamCard.id, 'ACTIVATED', { gameweekId: gw.id, effect, targetPlayerId: input.targetPlayerId, targetTeamId });
      return created;
    });
    return { activationId: activation.id, status: activation.status, gameweekId: gw.id, duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await prisma.cardActivation.findUnique({ where: { requestId: input.requestId } });
      if (again && again.teamId === team.id) return { activationId: again.id, status: again.status, duplicate: true };
    }
    await log(prisma, team.id, teamCard.id, 'REJECTED', { reason: err instanceof Error ? err.message : 'error' });
    throw err;
  }
}

export async function cancelActivation(userId: string, activationId: number) {
  const team = await teamOf(userId);
  const activation = await prisma.cardActivation.findUnique({ where: { id: activationId }, include: { card: true } });
  if (!activation || activation.teamId !== team.id) throw notFound('Activación no encontrada');
  const gw = await prisma.gameweek.findUnique({ where: { id: activation.gameweekId } });
  if (!gw || gw.deadline <= new Date()) throw badRequest('La jornada ya ha cerrado: la carta no se puede modificar');
  await prisma.$transaction(async (tx) => {
    const done = await tx.cardActivation.updateMany({ where: { id: activationId, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (done.count === 0) throw conflict('Esta activación ya no se puede cancelar');
    await tx.teamCard.update({ where: { id: activation.teamCardId }, data: { status: 'AVAILABLE' } });
    await log(tx, team.id, activation.teamCardId, 'CANCELLED', { activationId });
  });
  return { cancelled: true };
}

/**
 * Modificadores de cartas por equipo y jugador para una jornada.
 * DOUBLE_POINTS afecta al equipo que la usa; WEAKEN al equipo rival elegido.
 */
export async function cardModifiersForGameweek(gameweekId: number) {
  const activations = await prisma.cardActivation.findMany({ where: { gameweekId, status: { in: ['ACTIVE', 'APPLIED'] } } });
  const byTeam = new Map<number, Map<number, CardModifier[]>>();
  for (const a of activations) {
    const teamId = a.effect === 'WEAKEN' ? a.targetTeamId : a.teamId;
    const players = byTeam.get(teamId) ?? new Map<number, CardModifier[]>();
    players.set(a.targetPlayerId, [...(players.get(a.targetPlayerId) ?? []), { effect: a.effect as CardModifier['effect'], value: a.effectValue }]);
    byTeam.set(teamId, players);
  }
  return { byTeam, activations };
}

/** Al cerrar la jornada: las cartas activas pasan a aplicadas (definitivo) y se avisa a los rivales afectados. */
export async function finalizeCardsForGameweek(gameweekId: number, deltas: Map<string, number>) {
  const active = await prisma.cardActivation.findMany({ where: { gameweekId, status: 'ACTIVE' }, include: { card: true, team: { select: { name: true } }, targetTeam: { select: { userId: true } } } });
  const notifications: NotificationInput[] = [];
  for (const a of active) {
    const affectedTeam = a.effect === 'WEAKEN' ? a.targetTeamId : a.teamId;
    const delta = deltas.get(`${affectedTeam}:${a.targetPlayerId}`) ?? 0;
    await prisma.$transaction(async (tx) => {
      const done = await tx.cardActivation.updateMany({ where: { id: a.id, status: 'ACTIVE' }, data: { status: 'APPLIED', appliedAt: new Date(), pointsDelta: delta } });
      if (done.count === 0) return;
      await tx.teamCard.update({ where: { id: a.teamCardId }, data: { status: 'USED', usedAt: new Date() } });
      await log(tx, a.teamId, a.teamCardId, 'APPLIED', { gameweekId, pointsDelta: delta });
    });
    if (a.effect === 'WEAKEN') {
      notifications.push({
        userId: a.targetTeam.userId,
        type: 'SYSTEM',
        title: `${a.team.name} usó «${a.card.name}» contra tu equipo`,
        message: `Efecto en la jornada ${gameweekId}: ${delta} puntos.`,
        link: '/cards',
      });
    }
  }
  await notifyMany(notifications);
  return { applied: active.length };
}

/** Concesión manual desde administración (eventos, compensaciones). */
export async function adminGrantCard(teamId: number, cardCode: string, adminId: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { id: teamId } });
  if (!team) throw notFound('Equipo no encontrado');
  const granted = await prisma.$transaction((tx) => grantCard(tx, { teamId, cardCode, source: 'ADMIN', sourceRef: `admin:${adminId}:${Date.now()}:${teamId}` }));
  if (!granted) throw badRequest('Esa carta no existe o no se puede conceder (revisa que esté marcada como obtenible)');
  await notify({ userId: team.userId, type: 'SYSTEM', title: `Has recibido la carta «${granted.name}»`, message: 'Actívala antes del cierre de la jornada desde «Cartas».', link: '/cards' });
  return granted;
}

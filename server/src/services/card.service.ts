import { prisma, type Tx } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { playerSelect, parseCrest } from '../lib/dto';
import { CARD_CATALOG, isAttack, type CardEffect, type CardTarget, type PlayerModifier } from '../domain/cards';
import { assertLimits, needsPlayer, needsRival, parseConfig, resolveDefense, resolveTarget, type CardSpec } from './card-engine';
import { changeWallet } from './economy.service';
import { getSettings } from './settings.service';
import { getGameweekContext } from './gameweek.service';
import { aggFor, getPlayerAggregates, toPlayerDTO } from './player-stats.service';
import { notify, notifyMany, type NotificationInput } from './notification.service';
import { isUniqueViolation } from './economy.service';
import { resolveTeam } from './team.service';

/**
 * Fantasy Cards
 * ─────────────
 * - El inventario es del EQUIPO, y un equipo es un (usuario, liga): las cartas de una liga nunca se ven
 *   ni se usan en otra, y el objetivo de un ataque tiene que ser de la misma liga.
 * - Cada carta del inventario es de un solo uso (TeamCard). Según su tipo se resuelve al instante
 *   (dinero), antes del cierre de la jornada, al recibir un ataque (escudos) o con los puntos ya
 *   calculados (apuestas y bonos por rendimiento).
 * - Activación idempotente: `requestId` único + paso AVAILABLE → ACTIVE condicional (un doble clic no
 *   gasta dos cartas). Si algo falla, la transacción se deshace y la carta sigue en el inventario.
 * - Los efectos nunca tocan las estadísticas reales: se guardan como modificadores aparte y la
 *   puntuación oficial siempre se puede reconstruir (ver domain/cards.ts → applyPlayerModifiers).
 * - Se obtienen como recompensa (rachas, desafíos, eventos, administración): no hay compra con dinero real.
 */

/** Alta y actualización del catálogo. Respeta los valores que la administración haya editado. */
export async function ensureCardCatalog() {
  for (const c of CARD_CATALOG) {
    const data = {
      name: c.name,
      description: c.description,
      category: c.category,
      effect: c.effect,
      rarity: c.rarity,
      effectValue: c.effectValue,
      activation: c.activation,
      target: c.target,
      config: JSON.stringify(c.config ?? {}),
      maxPerGameweek: c.maxPerGameweek ?? 1,
      isActive: c.isActive ?? true,
      obtainable: c.obtainable ?? true,
    };
    const exists = await prisma.powerUpCard.findUnique({ where: { code: c.code } });
    if (!exists) {
      await prisma.powerUpCard.create({ data: { code: c.code, ...data } });
      continue;
    }
    // Si el catálogo ha redefinido la carta (otro efecto), se reescribe entera: mantener el valor viejo
    // dejaría combinaciones imposibles, como un efecto de jugador con un objetivo de equipo.
    const redefined = exists.effect !== data.effect || exists.target !== data.target;
    await prisma.powerUpCard.update({
      where: { code: c.code },
      data: {
        // La identidad y la mecánica las manda siempre el catálogo
        name: data.name,
        description: data.description,
        category: data.category,
        effect: data.effect,
        activation: data.activation,
        target: data.target,
        config: data.config,
        // El equilibrio lo puede ajustar la administración, salvo que la carta se haya redefinido
        ...(redefined ? { effectValue: data.effectValue, maxPerGameweek: data.maxPerGameweek, rarity: data.rarity } : {}),
        ...(c.isActive === false ? { isActive: false, obtainable: false } : {}),
      },
    });
  }
}

const specOf = (c: { code: string; effect: string; target: string; category: string; rarity: string; effectValue: number; maxPerGameweek: number; config: string }): CardSpec => ({
  code: c.code,
  effect: c.effect as CardEffect,
  target: c.target as CardTarget,
  category: c.category,
  rarity: c.rarity,
  effectValue: c.effectValue,
  maxPerGameweek: c.maxPerGameweek,
  config: parseConfig(c.config),
});

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

/** Equipo del usuario en la liga activa: las cartas y sus activaciones son propias de cada liga. */
async function teamOf(userId: string, leagueId?: number | null) {
  return resolveTeam(userId, leagueId);
}

export async function getCards(userId: string, leagueId?: number | null) {
  const team = await teamOf(userId, leagueId);
  const gw = await cardGameweek();
  const [inventory, activations, received, catalog] = await Promise.all([
    prisma.teamCard.findMany({ where: { teamId: team.id }, include: { card: true }, orderBy: { acquiredAt: 'desc' } }),
    prisma.cardActivation.findMany({
      where: { teamId: team.id, status: { not: 'CANCELLED' } },
      include: { card: true, targetTeam: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // Ataques recibidos: también los que siguen vivos y los bloqueados, para poder verlos y anularlos
    prisma.cardActivation.findMany({
      where: { targetTeamId: team.id, teamId: { not: team.id }, status: { in: ['ACTIVE', 'BLOCKED', 'APPLIED'] } },
      include: { card: true, team: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
      take: 30,
    }),
    prisma.powerUpCard.findMany({ orderBy: { id: 'asc' } }),
  ]);
  const playerIds = [...new Set([...activations, ...received].map((a) => a.targetPlayerId).filter((id): id is number => id !== null))];
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
      targetPlayer: a.targetPlayerId ? (playerById.get(a.targetPlayerId) ?? null) : null,
      targetTeam: a.targetTeam,
      moneyDelta: a.moneyDelta,
      blocked: a.status === 'BLOCKED',
      cancellable: a.status === 'ACTIVE' && !!gw && a.gameweekId === gw.id && gw.deadline > new Date(),
      createdAt: a.createdAt,
    })),
    received: received.map((a) => ({
      id: a.id,
      gameweekId: a.gameweekId,
      pointsDelta: a.pointsDelta,
      blocked: a.status === 'BLOCKED',
      status: a.status,
      card: publicCard(a.card),
      fromTeam: a.team,
      targetPlayer: a.targetPlayerId ? (playerById.get(a.targetPlayerId) ?? null) : null,
    })),
    catalog: catalog.map(publicCard),
  };
}

/** Ficha de carta que ve el navegador: todo lo que necesita para explicarla y pedir su objetivo. */
function publicCard(c: {
  id: number;
  code: string;
  name: string;
  description: string;
  category: string;
  effect: string;
  rarity: string;
  effectValue: number;
  activation: string;
  target: string;
  config: string;
  isActive: boolean;
  obtainable: boolean;
  maxPerGameweek: number;
}) {
  const catalog = CARD_CATALOG.find((d) => d.code === c.code);
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    category: c.category,
    effect: c.effect,
    rarity: c.rarity,
    effectValue: c.effectValue,
    activation: c.activation,
    target: c.target,
    config: parseConfig(c.config),
    isActive: c.isActive,
    obtainable: c.obtainable,
    maxPerGameweek: c.maxPerGameweek,
    needsPlayer: needsPlayer(c.target as CardTarget),
    needsRival: needsRival(c.target as CardTarget),
    unavailableReason: c.isActive ? null : (catalog?.unavailableReason ?? 'Carta desactivada por la administración'),
  };
}

/** Rivales de la carta de presión: los demás equipos de la misma liga que el equipo que la usa. */
export async function rivalTargets(userId: string, leagueId?: number | null) {
  const team = await teamOf(userId, leagueId);
  if (!team.leagueId || team.league?.type === 'GLOBAL') return [];
  const rivals = await prisma.fantasyTeam.findMany({
    where: { leagueId: team.leagueId, id: { not: team.id } },
    select: { id: true, name: true, crest: true, user: { select: { managerName: true } }, league: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return rivals.map((r) => ({ teamId: r.id, teamName: r.name, managerName: r.user.managerName, crest: parseCrest(r.crest), leagues: [r.league?.name ?? ''] }));
}

/** Dos equipos son rivales si pertenecen a la misma liga (y no es la global). */
async function sameLeague(teamIdA: number, teamIdB: number) {
  const [a, b] = await Promise.all([
    prisma.fantasyTeam.findUnique({ where: { id: teamIdA }, include: { league: true } }),
    prisma.fantasyTeam.findUnique({ where: { id: teamIdB }, select: { leagueId: true } }),
  ]);
  return !!a?.leagueId && a.league?.type !== 'GLOBAL' && a.leagueId === b?.leagueId;
}

export async function targetSquad(userId: string, teamId: number, leagueId?: number | null) {
  const own = await teamOf(userId, leagueId);
  if (teamId !== own.id && !(await sameLeague(own.id, teamId))) throw forbidden('Solo puedes elegir jugadores de rivales de tu liga');
  const [entries, { map }] = await Promise.all([
    prisma.fantasyTeamPlayer.findMany({ where: { teamId }, include: { player: { select: playerSelect } } }),
    getPlayerAggregates(),
  ]);
  return entries.map((e) => toPlayerDTO(e.player, aggFor(map, e.playerId)));
}

export interface ActivateInput {
  teamCardId: number;
  targetPlayerId?: number | null;
  targetTeamId?: number | null;
  /** Para el antídoto: qué ataque recibido se quiere anular. */
  targetActivationId?: number | null;
  requestId: string;
}

/**
 * Activa una carta. Todo ocurre en una transacción: validar el objetivo, reservar la carta
 * (AVAILABLE → ACTIVE, condicional), comprobar los límites, registrar la activación y resolver su
 * efecto inmediato. Si cualquier paso falla no se consume nada.
 */
export async function activateCard(userId: string, input: ActivateInput, leagueId?: number | null) {
  const team = await teamOf(userId, leagueId);

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

  const spec = specOf(teamCard.card);
  const gw = await cardGameweek();
  if (!gw || gw.deadline <= new Date()) throw badRequest('No hay ninguna jornada abierta para activar cartas');
  if (needsRival(spec.target) && (!team.leagueId || team.league?.type === 'GLOBAL')) {
    throw badRequest('Esta carta solo se puede usar en una liga con rivales');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serializa las activaciones de los equipos implicados: los límites se cumplen aunque lleguen a la vez
      await tx.fantasyTeam.update({ where: { id: team.id }, data: { updatedAt: new Date() } });
      const target = await resolveTarget(tx, spec, team.id, input, sameLeague);
      if (target.targetTeamId !== team.id) await tx.fantasyTeam.update({ where: { id: target.targetTeamId }, data: { updatedAt: new Date() } });

      const claimed = await tx.teamCard.updateMany({ where: { id: teamCard.id, status: 'AVAILABLE' }, data: { status: 'ACTIVE' } });
      if (claimed.count === 0) throw conflict('Esta carta ya se ha usado o está activada');

      await assertLimits(tx, spec, { gameweekId: gw.id, ownTeamId: team.id, targetTeamId: target.targetTeamId, targetPlayerId: target.targetPlayerId });

      const activation = await tx.cardActivation.create({
        data: {
          teamCardId: teamCard.id,
          teamId: team.id,
          cardId: teamCard.cardId,
          gameweekId: gw.id,
          effect: spec.effect,
          effectValue: teamCard.card.effectValue,
          targetPlayerId: target.targetPlayerId,
          targetTeamId: target.targetTeamId,
          requestId: input.requestId,
        },
      });

      // ── Efectos que se resuelven en el acto
      let blocked: Awaited<ReturnType<typeof resolveDefense>> = null;
      let money = 0;

      if (spec.effect === 'MONEY') {
        money = await payCard(tx, team, activation.id, teamCard.card.name, teamCard.card.effectValue);
      } else if (spec.effect === 'ANTIDOTE') {
        await applyAntidote(tx, team.id, gw.id, activation.id, input.targetActivationId ?? null);
      } else if (isAttack(spec.effect)) {
        // Un escudo del rival puede parar el ataque nada más lanzarlo
        blocked = await resolveDefense(tx, { id: activation.id, effect: spec.effect, targetTeamId: target.targetTeamId, targetPlayerId: target.targetPlayerId, gameweekId: gw.id });
      }

      // Las cartas instantáneas quedan cerradas aquí mismo
      if (spec.effect === 'MONEY') {
        await tx.cardActivation.update({ where: { id: activation.id }, data: { status: 'APPLIED', appliedAt: new Date(), moneyDelta: money } });
        await tx.teamCard.update({ where: { id: teamCard.id }, data: { status: 'USED', usedAt: new Date() } });
      }

      await log(tx, team.id, teamCard.id, 'ACTIVATED', {
        gameweekId: gw.id,
        effect: spec.effect,
        targetPlayerId: target.targetPlayerId,
        targetTeamId: target.targetTeamId,
        blocked: !!blocked,
        money,
      });
      return { activation, target, blocked, money };
    });

    await notifyActivation(team, teamCard.card, result);
    invalidateNothing();
    return {
      activationId: result.activation.id,
      status: result.blocked ? 'BLOCKED' : result.activation.status,
      gameweekId: gw.id,
      blocked: !!result.blocked,
      money: result.money,
      duplicate: false,
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await prisma.cardActivation.findUnique({ where: { requestId: input.requestId } });
      if (again && again.teamId === team.id) return { activationId: again.id, status: again.status, duplicate: true };
    }
    await log(prisma, team.id, teamCard.id, 'REJECTED', { reason: err instanceof Error ? err.message : 'error' });
    throw err;
  }
}

/** Marcador vacío: las cartas no invalidan cachés de jugadores, pero deja el punto de extensión claro. */
const invalidateNothing = () => undefined;

/** Abona el dinero de una carta económica, con tope por jornada y clave de idempotencia. */
async function payCard(tx: Tx, team: { id: number; leagueId: number | null; economyVersion: number }, activationId: number, cardName: string, amount: number) {
  if (team.economyVersion !== 2) throw badRequest('Las cartas económicas solo funcionan en una liga con economía propia');
  const s = await getSettings();
  const gw = await cardGameweek();
  const already = await tx.cardActivation.aggregate({
    where: { teamId: team.id, gameweekId: gw?.id ?? 0, status: 'APPLIED', effect: 'MONEY' },
    _sum: { moneyDelta: true },
  });
  const paid = already._sum.moneyDelta ?? 0;
  const left = Math.max(0, s.card_money_cap_per_gameweek - paid);
  const credit = Math.min(amount, left);
  if (credit <= 0) throw badRequest('Ya has alcanzado el máximo de dinero por cartas en esta jornada');
  await changeWallet(tx, {
    teamId: team.id,
    amount: credit,
    type: 'CARD_REWARD',
    description: `Carta «${cardName}»`,
    leagueId: team.leagueId,
    reference: `card-activation:${activationId}`,
    operationId: `card:money:${activationId}`,
  });
  return credit;
}

/** El antídoto anula un ataque que el equipo ya tiene encima en la jornada. */
async function applyAntidote(tx: Tx, teamId: number, gameweekId: number, activationId: number, targetActivationId: number | null) {
  const where = { targetTeamId: teamId, gameweekId, status: 'ACTIVE' as const, NOT: { teamId } };
  const attacks = await tx.cardActivation.findMany({ where, orderBy: { id: 'asc' } });
  const victim = targetActivationId ? attacks.find((a) => a.id === targetActivationId) : attacks.find((a) => isAttack(a.effect));
  if (!victim) throw badRequest('No tienes ningún ataque activo que anular en esta jornada');
  if (!isAttack(victim.effect)) throw badRequest('Ese efecto no se puede anular con un antídoto');
  await tx.cardActivation.update({ where: { id: victim.id }, data: { status: 'BLOCKED', blockedById: activationId, result: JSON.stringify({ blockedBy: 'ANTIDOTE' }) } });
  await tx.cardActivation.update({ where: { id: activationId }, data: { status: 'CONSUMED', appliedAt: new Date(), result: JSON.stringify({ cancelled: victim.id }) } });
  await tx.teamCard.updateMany({ where: { id: (await tx.cardActivation.findUniqueOrThrow({ where: { id: activationId }, select: { teamCardId: true } })).teamCardId }, data: { status: 'USED', usedAt: new Date() } });
}

/** Avisos a quien ataca, a quien lo recibe y a quien lo bloquea. */
async function notifyActivation(
  team: { id: number; userId: string; name: string },
  card: { name: string },
  result: { activation: { id: number }; target: { targetTeamId: number; targetPlayerId: number | null }; blocked: { shieldEffect: string } | null; money: number },
) {
  if (result.target.targetTeamId === team.id) return;
  const rival = await prisma.fantasyTeam.findUnique({ where: { id: result.target.targetTeamId }, select: { userId: true, name: true } });
  if (!rival) return;
  const player = result.target.targetPlayerId ? await prisma.player.findUnique({ where: { id: result.target.targetPlayerId }, select: { displayName: true } }) : null;
  const sobre = player ? ` sobre ${player.displayName}` : '';
  const inputs: NotificationInput[] = [
    {
      userId: rival.userId,
      type: 'LEAGUE',
      title: result.blocked ? 'Has bloqueado un ataque' : 'Te han atacado con una carta',
      message: result.blocked
        ? `${team.name} usó «${card.name}»${sobre} y tu defensa lo paró.`
        : `${team.name} ha usado «${card.name}»${sobre} contra tu equipo.`,
      link: '/cards',
    },
  ];
  if (result.blocked) {
    inputs.push({ userId: team.userId, type: 'LEAGUE', title: 'Tu carta fue neutralizada', message: `${rival.name} bloqueó tu «${card.name}»${sobre}.`, link: '/cards' });
  }
  await notifyMany(inputs);
}

export async function cancelActivation(userId: string, activationId: number, leagueId?: number | null) {
  const team = await teamOf(userId, leagueId);
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
 * Modificadores de cartas de una jornada, ya desplegados por jugador.
 *
 * Aquí se traduce cada activación a los modificadores concretos que aplicará la puntuación: las cartas
 * de equipo (bonus al once, castigo a todos los titulares, castigo por posición) se expanden jugador a
 * jugador leyendo la alineación, y las de capitán localizan al capitán del rival. Las activaciones
 * bloqueadas por un escudo o un antídoto no producen ningún modificador.
 */
export async function cardModifiersForGameweek(gameweekId: number) {
  const activations = await prisma.cardActivation.findMany({
    where: { gameweekId, status: { in: ['ACTIVE', 'APPLIED'] } },
    include: { card: { select: { config: true, activation: true } } },
  });
  const byTeam = new Map<number, Map<number, PlayerModifier[]>>();
  if (!activations.length) return { byTeam, activations };

  // Alineaciones de los equipos afectados: hacen falta para las cartas de equipo y de capitán
  const teamIds = [...new Set(activations.flatMap((a) => [a.teamId, a.targetTeamId]))];
  const lineups = await prisma.lineup.findMany({
    where: { gameweekId, teamId: { in: teamIds } },
    select: { teamId: true, captainId: true, players: { where: { role: 'STARTER' }, select: { playerId: true, player: { select: { position: true } } } } },
  });
  const lineupOf = new Map(lineups.map((l) => [l.teamId, l]));

  const add = (teamId: number, playerId: number, mod: PlayerModifier) => {
    const players = byTeam.get(teamId) ?? new Map<number, PlayerModifier[]>();
    players.set(playerId, [...(players.get(playerId) ?? []), mod]);
    byTeam.set(teamId, players);
  };

  for (const a of activations) {
    // Solo las cartas de jornada modifican puntos; las instantáneas y las de post-cálculo van aparte
    if (a.card.activation !== 'PRE_GAMEWEEK') continue;
    const affected = isAttack(a.effect) ? a.targetTeamId : a.teamId;
    const lineup = lineupOf.get(affected);
    const starters = lineup?.players ?? [];

    switch (a.effect as CardEffect) {
      case 'DOUBLE_POINTS':
        if (a.targetPlayerId) add(affected, a.targetPlayerId, { kind: 'MULTIPLY', value: a.effectValue, activationId: a.id });
        break;
      case 'FLAT_BONUS':
        if (a.targetPlayerId) add(affected, a.targetPlayerId, { kind: 'ADD', value: a.effectValue, activationId: a.id });
        break;
      case 'FLAT_PENALTY':
        if (a.targetPlayerId) add(affected, a.targetPlayerId, { kind: 'ADD', value: -a.effectValue, activationId: a.id });
        break;
      case 'WEAKEN':
        if (a.targetPlayerId) add(affected, a.targetPlayerId, { kind: 'PENALTY_PCT', value: a.effectValue, activationId: a.id });
        break;
      case 'TEAM_BONUS':
        for (const p of starters) add(affected, p.playerId, { kind: 'ADD', value: a.effectValue, activationId: a.id });
        break;
      case 'TEAM_PENALTY':
        for (const p of starters) add(affected, p.playerId, { kind: 'ADD', value: -a.effectValue, activationId: a.id });
        break;
      case 'POSITION_PENALTY': {
        const position = String(parseConfig(a.card.config).position ?? 'DEF');
        for (const p of starters.filter((x) => x.player.position === position)) add(affected, p.playerId, { kind: 'ADD', value: -a.effectValue, activationId: a.id });
        break;
      }
      case 'CAPTAIN_PENALTY':
        if (lineup?.captainId) add(affected, lineup.captainId, { kind: 'CAPTAIN_PCT', value: a.effectValue, activationId: a.id });
        break;
      default:
        break; // escudos, antídotos, dinero y post-cálculo no entran aquí
    }
  }
  return { byTeam, activations };
}

export interface PostScoringContext {
  /** Puntos del equipo con las cartas de jornada ya aplicadas, antes de los efectos de post-cálculo. */
  teamTotal: number;
  /** Puntos definitivos de cada jugador de la alineación. */
  playerPoints: Map<number, number>;
  /** Puntos que le han quitado las cartas rivales (valor positivo). */
  pointsLost: number;
}

export interface PostScoringOutcome {
  activationId: number;
  points: number;
  money: number;
}

/** Activaciones de post-cálculo de la jornada, agrupadas por equipo. */
export async function postScoringActivations(gameweekId: number) {
  const rows = await prisma.cardActivation.findMany({
    where: { gameweekId, status: { in: ['ACTIVE', 'APPLIED'] }, card: { activation: 'POST_SCORING' } },
    include: { card: { select: { config: true } } },
  });
  const byTeam = new Map<number, typeof rows>();
  for (const a of rows) byTeam.set(a.teamId, [...(byTeam.get(a.teamId) ?? []), a]);
  return byTeam;
}

/**
 * Resuelve una carta de post-cálculo con los puntos ya conocidos. Es una función pura respecto a la base
 * de datos: devuelve cuántos puntos y cuánto dinero genera, y quien la llama decide cuándo abonarlos.
 */
export function evaluatePostScoring(
  a: { id: number; effect: string; effectValue: number; targetPlayerId: number | null; card: { config: string } },
  ctx: PostScoringContext,
): PostScoringOutcome {
  const config = parseConfig(a.card.config);
  const none = { activationId: a.id, points: 0, money: 0 };
  switch (a.effect as CardEffect) {
    case 'SCORE_BET': {
      const threshold = Number(config.threshold ?? 0);
      // Sobre un jugador concreto o sobre el total del equipo, según a qué apunte la carta
      const value = a.targetPlayerId ? (ctx.playerPoints.get(a.targetPlayerId) ?? 0) : ctx.teamTotal;
      return value >= threshold ? { ...none, points: a.effectValue } : none;
    }
    case 'TEAM_THRESHOLD_MONEY':
      return ctx.teamTotal >= Number(config.threshold ?? 0) ? { ...none, money: a.effectValue } : none;
    case 'PLAYER_PERFORMANCE_MONEY': {
      const points = Math.max(0, a.targetPlayerId ? (ctx.playerPoints.get(a.targetPlayerId) ?? 0) : 0);
      const cap = Number(config.maxMoney ?? Number.MAX_SAFE_INTEGER);
      return { ...none, money: Math.min(cap, points * a.effectValue) };
    }
    case 'RECOVER_POINTS':
      return { ...none, points: Math.min(a.effectValue, Math.max(0, ctx.pointsLost)) };
    default:
      return none;
  }
}

/**
 * Cierre de la jornada: las cartas vivas pasan a aplicadas con su resultado definitivo, se abona el
 * dinero de las cartas de post-cálculo (una sola vez, con clave de idempotencia) y se avisa a los
 * afectados. Repetir el cierre no vuelve a pagar ni a duplicar nada.
 */
export async function finalizeCardsForGameweek(gameweekId: number, deltas: Map<string, number>, money: Map<number, number> = new Map()) {
  const pending = await prisma.cardActivation.findMany({
    where: { gameweekId, status: { in: ['ACTIVE', 'BLOCKED'] } },
    include: { card: true, team: { select: { name: true, id: true, leagueId: true, economyVersion: true } }, targetTeam: { select: { userId: true, name: true } } },
  });
  const notifications: NotificationInput[] = [];

  for (const a of pending) {
    const affectedTeam = isAttack(a.effect) ? a.targetTeamId : a.teamId;
    const delta = a.status === 'BLOCKED' ? 0 : (deltas.get(`${affectedTeam}:${a.targetPlayerId ?? 0}`) ?? 0);
    const reward = money.get(a.id) ?? 0;

    await prisma.$transaction(async (tx) => {
      const done = await tx.cardActivation.updateMany({
        where: { id: a.id, status: a.status },
        data: { status: 'APPLIED', appliedAt: new Date(), pointsDelta: delta, moneyDelta: reward },
      });
      if (done.count === 0) return; // otra pasada ya la cerró
      await tx.teamCard.update({ where: { id: a.teamCardId }, data: { status: 'USED', usedAt: new Date() } });
      if (reward > 0 && a.team.economyVersion === 2) {
        await changeWallet(tx, {
          teamId: a.teamId,
          amount: reward,
          type: 'CARD_REWARD',
          description: `Carta «${a.card.name}» (jornada ${gameweekId})`,
          leagueId: a.team.leagueId,
          reference: `card-activation:${a.id}`,
          operationId: `card:post:${a.id}`,
        });
      }
      await log(tx, a.teamId, a.teamCardId, 'APPLIED', { gameweekId, pointsDelta: delta, moneyDelta: reward, blocked: a.status === 'BLOCKED' });
    });

    if (isAttack(a.effect) && a.status !== 'BLOCKED') {
      notifications.push({
        userId: a.targetTeam.userId,
        type: 'LEAGUE',
        title: `${a.team.name} usó «${a.card.name}» contra tu equipo`,
        message: `Efecto en la jornada ${gameweekId}: ${delta} puntos.`,
        link: '/cards',
      });
    }
  }
  await notifyMany(notifications);
  return { applied: pending.length };
}

/**
 * Carta al azar entre las obtenibles, ponderada por rareza (las raras caen menos). La elección la hace
 * el servidor y la concesión es idempotente gracias a `sourceRef`.
 */
export async function grantRandomCard(db: Tx, input: { teamId: number; source: string; sourceRef: string }) {
  const pool = await db.powerUpCard.findMany({ where: { obtainable: true, isActive: true } });
  if (!pool.length) return null;
  const weightOf = (rarity: string) => ({ COMMON: 50, UNCOMMON: 28, RARE: 14, EPIC: 6, LEGENDARY: 2 })[rarity] ?? 10;
  const total = pool.reduce((sum, c) => sum + weightOf(c.rarity), 0);
  let pick = Math.random() * total;
  const chosen = pool.find((c) => (pick -= weightOf(c.rarity)) <= 0) ?? pool[0];
  return grantCard(db, { teamId: input.teamId, cardCode: chosen.code, source: input.source, sourceRef: input.sourceRef });
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

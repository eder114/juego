import type { Tx } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { isAttack, type CardEffect, type CardTarget } from '../domain/cards';
import type { Position } from '../domain/constants';
import { getSettings } from './settings.service';

/**
 * Motor de cartas: validación del objetivo y de los límites
 * ─────────────────────────────────────────────────────────
 * Todo lo que decide si una activación es legal vive aquí, nunca en el navegador. El servicio de cartas
 * llama a estas funciones DENTRO de la transacción que consume la carta, de modo que dos peticiones
 * simultáneas no puedan saltarse un límite.
 */

export interface CardSpec {
  code: string;
  effect: CardEffect;
  target: CardTarget;
  category: string;
  rarity: string;
  effectValue: number;
  maxPerGameweek: number;
  config: Record<string, number | string>;
}

export const parseConfig = (raw: string): Record<string, number | string> => {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** ¿La carta necesita que el usuario elija un jugador? */
export const needsPlayer = (target: CardTarget) => ['OWN_PLAYER', 'OWN_GK', 'OWN_FWD', 'RIVAL_PLAYER', 'RIVAL_FWD'].includes(target);
/** ¿La carta necesita que el usuario elija un equipo rival? */
export const needsRival = (target: CardTarget) => target.startsWith('RIVAL');

const POSITION_OF_TARGET: Partial<Record<CardTarget, Position>> = { OWN_GK: 'GK', OWN_FWD: 'FWD', RIVAL_FWD: 'FWD' };

export interface ResolvedTarget {
  targetTeamId: number;
  targetPlayerId: number | null;
}

/**
 * Comprueba que el objetivo elegido es válido para la carta y devuelve el objetivo ya normalizado.
 * Un objetivo inválido nunca llega a consumir la carta: esto se ejecuta antes de marcarla como usada.
 */
export async function resolveTarget(
  db: Tx,
  spec: CardSpec,
  ownTeamId: number,
  input: { targetPlayerId?: number | null; targetTeamId?: number | null },
  sameLeague: (a: number, b: number) => Promise<boolean>,
): Promise<ResolvedTarget> {
  // Cartas sin objetivo: dinero, escudos de equipo, bonos del propio equipo
  if (!needsPlayer(spec.target) && !needsRival(spec.target)) return { targetTeamId: ownTeamId, targetPlayerId: null };

  let targetTeamId = ownTeamId;
  if (needsRival(spec.target)) {
    if (!input.targetTeamId || input.targetTeamId === ownTeamId) throw badRequest('Elige un equipo rival de tu liga');
    if (!(await sameLeague(ownTeamId, input.targetTeamId))) throw forbidden('Solo puedes usar esta carta contra rivales de tu liga');
    targetTeamId = input.targetTeamId;
  }

  // Cartas que apuntan al equipo entero o al capitán: no hace falta jugador
  if (!needsPlayer(spec.target)) {
    if (spec.target === 'RIVAL_CAPTAIN') {
      const lineup = await db.lineup.findFirst({ where: { teamId: targetTeamId }, orderBy: { gameweekId: 'desc' }, select: { captainId: true } });
      if (!lineup?.captainId) throw badRequest('Ese rival todavía no tiene capitán designado');
    }
    return { targetTeamId, targetPlayerId: null };
  }

  if (!input.targetPlayerId) throw badRequest('Elige un jugador');
  const owned = await db.fantasyTeamPlayer.findUnique({
    where: { teamId_playerId: { teamId: targetTeamId, playerId: input.targetPlayerId } },
    include: { player: { select: { position: true, marketValue: true, displayName: true } } },
  });
  if (!owned) throw badRequest(targetTeamId === ownTeamId ? 'Elige un jugador de tu plantilla' : 'Ese jugador no está en la plantilla del rival');

  // Cartas restringidas a una posición
  const required = POSITION_OF_TARGET[spec.target];
  if (required && owned.player.position !== required) {
    const label = required === 'GK' ? 'un portero' : 'un delantero';
    throw badRequest(`Esta carta solo se puede usar sobre ${label}`);
  }

  // Límite de valor de mercado (Talento oculto): se comprueba y se deja registrado al activar
  const maxValue = Number(spec.config.maxValueK ?? 0);
  if (maxValue > 0 && (owned.player.marketValue ?? 0) > maxValue) {
    throw badRequest(`${owned.player.displayName} vale más del límite de esta carta`);
  }

  return { targetTeamId, targetPlayerId: input.targetPlayerId };
}

export interface LimitContext {
  gameweekId: number;
  ownTeamId: number;
  targetTeamId: number;
  targetPlayerId: number | null;
}

/**
 * Límites de equilibrio, todos configurables. Se evalúan dentro de la transacción, con las filas de los
 * equipos implicados ya bloqueadas, así que no hay forma de superarlos con peticiones simultáneas.
 */
export async function assertLimits(db: Tx, spec: CardSpec, ctx: LimitContext) {
  const s = await getSettings();
  const mine = await db.cardActivation.findMany({
    where: { teamId: ctx.ownTeamId, gameweekId: ctx.gameweekId, status: 'ACTIVE' },
    select: { effect: true, targetPlayerId: true, targetTeamId: true, cardId: true, card: { select: { category: true, rarity: true } } },
  });

  if (mine.length >= s.card_max_active_per_gameweek) throw badRequest(`Máximo ${s.card_max_active_per_gameweek} cartas por jornada`);
  if (mine.filter((a) => a.effect === spec.effect).length >= spec.maxPerGameweek) {
    throw badRequest(`Ya has usado el máximo de cartas de este tipo en esta jornada`);
  }
  if (spec.rarity === 'LEGENDARY' && mine.filter((a) => a.card.rarity === 'LEGENDARY').length >= s.card_max_legendary_per_gameweek) {
    throw badRequest(`Máximo ${s.card_max_legendary_per_gameweek} carta(s) legendaria(s) por jornada`);
  }

  // Una misma carta no se repite sobre el mismo objetivo
  if (mine.some((a) => a.effect === spec.effect && a.targetPlayerId === ctx.targetPlayerId && a.targetTeamId === ctx.targetTeamId)) {
    throw badRequest('Ya has usado esta carta sobre ese objetivo en esta jornada');
  }

  if (isAttack(spec.effect)) {
    // Cuántos ataques aguanta un equipo por jornada
    const received = await db.cardActivation.count({
      where: { targetTeamId: ctx.targetTeamId, gameweekId: ctx.gameweekId, status: { in: ['ACTIVE', 'BLOCKED'] }, NOT: { teamId: ctx.targetTeamId } },
    });
    if (received >= s.card_max_attacks_received) throw badRequest('Ese rival ya ha recibido todos los ataques que admite esta jornada');

    // Y cuántos sobre el mismo jugador
    if (ctx.targetPlayerId) {
      const onPlayer = await db.cardActivation.count({
        where: { gameweekId: ctx.gameweekId, status: 'ACTIVE', targetTeamId: ctx.targetTeamId, targetPlayerId: ctx.targetPlayerId, effect: { in: ['WEAKEN', 'FLAT_PENALTY'] } },
      });
      if (onPlayer >= s.card_weaken_max_per_target) throw badRequest('Ese jugador ya está bajo los efectos de un ataque esta jornada');
    }
  }

  // Potenciadores sobre un mismo jugador propio
  if (['DOUBLE_POINTS', 'FLAT_BONUS'].includes(spec.effect) && ctx.targetPlayerId) {
    const boosts = mine.filter((a) => ['DOUBLE_POINTS', 'FLAT_BONUS'].includes(a.effect) && a.targetPlayerId === ctx.targetPlayerId).length;
    if (boosts >= s.card_max_boost_per_player) throw badRequest('Ese jugador ya tiene un potenciador en esta jornada');
  }

  // Cartas limitadas por temporada (Imperio económico)
  const maxSeason = Number(spec.config.maxPerSeason ?? 0);
  if (maxSeason > 0) {
    const used = await db.cardActivation.count({ where: { teamId: ctx.ownTeamId, cardId: mine[0]?.cardId ?? -1, status: { in: ['ACTIVE', 'APPLIED'] } } });
    if (used >= maxSeason) throw badRequest('Esta carta solo se puede usar una vez por temporada');
  }
}

/**
 * Resolución ataque ↔ defensa. Al recibir un ataque se busca una protección compatible del defensor:
 * inmunidad del jugador, seguro del capitán o escudo de equipo (en ese orden, de la más específica a la
 * más general). Si hay una, el ataque queda BLOCKED y la protección se gasta.
 */
export async function resolveDefense(db: Tx, attack: { id: number; effect: string; targetTeamId: number; targetPlayerId: number | null; gameweekId: number }) {
  if (!isAttack(attack.effect)) return null;

  const shields = await db.cardActivation.findMany({
    where: { teamId: attack.targetTeamId, gameweekId: attack.gameweekId, status: 'ACTIVE', effect: { in: ['IMMUNITY', 'CAPTAIN_SHIELD', 'SHIELD'] } },
    orderBy: { id: 'asc' },
  });

  const match = shields.find((sh) => {
    if (sh.effect === 'IMMUNITY') return attack.targetPlayerId !== null && sh.targetPlayerId === attack.targetPlayerId;
    if (sh.effect === 'CAPTAIN_SHIELD') return attack.effect === 'CAPTAIN_PENALTY';
    return true; // SHIELD: cualquier ataque al equipo
  });
  if (!match) return null;

  // El escudo puede tener varias cargas (Blindaje total): se gasta una
  const chargesLeft = match.effectValue - 1;
  await db.cardActivation.update({
    where: { id: match.id },
    data: chargesLeft > 0 ? { effectValue: chargesLeft } : { status: 'CONSUMED', appliedAt: new Date() },
  });
  await db.cardActivation.update({ where: { id: attack.id }, data: { status: 'BLOCKED', blockedById: match.id, result: JSON.stringify({ blockedBy: match.effect }) } });
  return { shieldActivationId: match.id, shieldEffect: match.effect, chargesLeft: Math.max(0, chargesLeft) };
}

/** Comprueba que los dos equipos están en la misma liga (y que ninguno es el otro). */
export async function teamsInSameLeague(db: Tx, a: number, b: number) {
  if (a === b) return false;
  const [one, two] = await Promise.all([
    db.fantasyTeam.findUnique({ where: { id: a }, select: { leagueId: true } }),
    db.fantasyTeam.findUnique({ where: { id: b }, select: { leagueId: true } }),
  ]);
  return !!one?.leagueId && one.leagueId === two?.leagueId;
}

export { notFound, conflict };

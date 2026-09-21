import crypto from 'node:crypto';
import { prisma, type Tx } from '../lib/prisma';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { playerSelect } from '../lib/dto';
import type { PlayerRarity, Position } from '../domain/constants';
import { countPositions } from '../domain/lineup';
import {
  buildStarterSquad,
  canFieldEleven,
  formatK,
  isValidTimeZone,
  localDateKey,
  marketCycleWindow,
  minutesOfDayIn,
  pityGuaranteed,
  pityWeights,
  rarityAtLeast,
  resolveFormation,
  selectMarketCoaches,
  selectMarketPlayers,
  type Rng,
} from '../domain/economy';
import { getSettings, marketWeights, starterWeights } from './settings.service';
import { aggFor, getPlayerAggregates, invalidatePlayerAggregates, toPlayerDTO } from './player-stats.service';
import { audit, changeWallet, isUniqueViolation } from './economy.service';
import { coachSelect } from './coach.service';
import { snapshotCurrentLineup } from './squad.service';
import { notify } from './notification.service';

/**
 * Mercado global por liga (economía v2)
 * ─────────────────────────────────────
 * - Un ciclo diario por liga (MarketCycle) con N jugadores y 1–2 entrenadores, iguales para todos sus miembros.
 * - El servidor decide el ciclo vigente (UTC en BD, hora local de la liga para el reinicio); nunca el navegador.
 * - Compra atómica: marcar el anuncio como vendido (compare-and-set), cobrar (saldo condicional), validar la
 *   plantilla y crear la propiedad (única por liga + jugador) ocurren en una sola transacción.
 */

export const cryptoRng: Rng = () => crypto.randomBytes(4).readUInt32BE() / 4294967296;

const STALE_AVAILABLE = ['UNAVAILABLE'];

export function leagueResetMinute(league: { marketResetMinute: number | null; createdAt: Date; marketTimezone: string }) {
  return league.marketResetMinute ?? minutesOfDayIn(league.createdAt, league.marketTimezone);
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// ───────────────────────────── Ciclos ─────────────────────────────

/** Devuelve el ciclo vigente de la liga, generándolo si todavía no existe (seguro frente a llamadas simultáneas). */
export async function getCurrentCycle(leagueId: number, now = new Date(), rng: Rng = cryptoRng) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  if (league.economyVersion !== 2) throw badRequest('Esta liga no usa la economía de liga');

  const latest = await prisma.marketCycle.findFirst({ where: { leagueId }, orderBy: { startsAt: 'desc' } });
  if (latest && latest.startsAt <= now && now < latest.endsAt) return latest;

  const window = marketCycleWindow(now, league.marketTimezone, leagueResetMinute(league));
  // Si se cambió la hora de reinicio, el nuevo horario empieza donde terminó el ciclo anterior
  const startsAt = latest && latest.endsAt > window.startsAt ? latest.endsAt : window.startsAt;
  const endsAt = window.endsAt > startsAt ? window.endsAt : new Date(startsAt.getTime() + 24 * 3600 * 1000);
  try {
    return await generateCycle(league, { startsAt, endsAt, cycleDate: localDateKey(startsAt, league.marketTimezone) }, now, rng);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Otra petición generó el mismo ciclo a la vez: se usa el suyo
    return prisma.marketCycle.findUniqueOrThrow({ where: { leagueId_startsAt: { leagueId, startsAt } } });
  }
}

async function generateCycle(
  league: { id: number; marketPityCounter: number },
  window: { startsAt: Date; endsAt: Date; cycleDate: string },
  now: Date,
  rng: Rng,
) {
  const s = await getSettings();
  const [owned, ownedCoaches, cooldowns] = await Promise.all([
    prisma.leaguePlayerOwnership.findMany({ where: { leagueId: league.id }, select: { playerId: true } }),
    prisma.leagueCoachOwnership.findMany({ where: { leagueId: league.id }, select: { coachId: true } }),
    prisma.leagueAssetCooldown.findMany({ where: { leagueId: league.id, availableAt: { gt: now } }, select: { assetType: true, assetId: true } }),
  ]);
  const blockedPlayers = new Set([...owned.map((o) => o.playerId), ...cooldowns.filter((c) => c.assetType === 'PLAYER').map((c) => c.assetId)]);
  const blockedCoaches = new Set([...ownedCoaches.map((o) => o.coachId), ...cooldowns.filter((c) => c.assetType === 'COACH').map((c) => c.assetId)]);

  const [players, coaches] = await Promise.all([
    prisma.player.findMany({
      where: { isActive: true, marketValue: { not: null }, status: { notIn: STALE_AVAILABLE }, club: { isActive: true } },
      select: { id: true, position: true, rarity: true, marketValue: true },
    }),
    prisma.coach.findMany({ where: { isActive: true, clubId: { not: null }, marketValue: { gt: 0 } }, select: { id: true, rarity: true, marketValue: true } }),
  ]);
  const candidates = players.filter((p) => !blockedPlayers.has(p.id)).map((p) => ({ ...p, rarity: p.rarity as PlayerRarity }));
  const coachCandidates = coaches.filter((c) => !blockedCoaches.has(c.id)).map((c) => ({ ...c, rarity: c.rarity as PlayerRarity }));

  const pity = {
    counter: league.marketPityCounter,
    stepPercent: s.pity_step_percent,
    maxMultiplier: s.pity_max_multiplier,
    minRarity: s.pity_min_rarity as PlayerRarity,
    hardDays: s.pity_hard_days,
  };
  const weights = pityWeights(marketWeights(s), pity);
  const selected = selectMarketPlayers(
    candidates,
    s.market_players_per_cycle,
    { weights, maxSamePosition: s.market_max_same_position, guaranteeRarity: pityGuaranteed(pity) ? pity.minRarity : null },
    rng,
  );
  const selectedCoaches = selectMarketCoaches(coachCandidates, { min: s.market_coaches_min, max: s.market_coaches_max, weights: marketWeights(s) }, rng);
  const highArrived = selected.some((p) => rarityAtLeast(p.rarity, pity.minRarity));
  const valueOf = new Map(players.map((p) => [p.id, p.marketValue!]));
  const coachValue = new Map(coaches.map((c) => [c.id, c.marketValue]));

  return prisma.$transaction(async (tx) => {
    const cycle = await tx.marketCycle.create({
      data: {
        leagueId: league.id,
        cycleDate: window.cycleDate,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        pityBefore: league.marketPityCounter,
        listings: {
          create: [
            ...selected.map((p, i) => ({ leagueId: league.id, assetType: 'PLAYER', playerId: p.id, rarity: p.rarity, listingPrice: valueOf.get(p.id)!, slot: i })),
            ...selectedCoaches.map((c, i) => ({ leagueId: league.id, assetType: 'COACH', coachId: c.id, rarity: c.rarity, listingPrice: coachValue.get(c.id)!, slot: selected.length + i })),
          ],
        },
      },
    });
    await tx.league.update({ where: { id: league.id }, data: { marketPityCounter: highArrived ? 0 : league.marketPityCounter + 1 } });
    await audit(tx, {
      leagueId: league.id,
      cycleId: cycle.id,
      action: 'CYCLE_GENERATED',
      details: {
        players: selected.map((p) => ({ id: p.id, rarity: p.rarity })),
        coaches: selectedCoaches.map((c) => c.id),
        pityBefore: league.marketPityCounter,
        pityAfter: highArrived ? 0 : league.marketPityCounter + 1,
        guaranteed: pityGuaranteed(pity),
        candidates: candidates.length,
      },
    });
    return cycle;
  });
}

/** Genera los mercados de todas las ligas con economía activa (tarea periódica del servidor). */
export async function tickMarkets(now = new Date()) {
  const leagues = await prisma.league.findMany({ where: { economyVersion: 2, economyTeams: { some: {} } }, select: { id: true } });
  let generated = 0;
  for (const l of leagues) {
    const before = await prisma.marketCycle.count({ where: { leagueId: l.id } });
    await getCurrentCycle(l.id, now);
    if ((await prisma.marketCycle.count({ where: { leagueId: l.id } })) > before) generated++;
  }
  return { leagues: leagues.length, generated };
}

// ───────────────────────────── Equipo del usuario ─────────────────────────────

async function economyTeam(userId: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId }, include: { economyLeague: true } });
  if (!team) throw notFound('Aún no has creado tu equipo Fantasy');
  return team;
}

interface SquadLimits {
  maxSquad: number;
  perPosition: Record<Position, number>;
  maxPerClub: number;
  maxCoaches: number;
}

async function squadLimits(): Promise<SquadLimits> {
  const s = await getSettings();
  return {
    maxSquad: s.v2_max_squad,
    perPosition: { GK: s.v2_max_gk, DEF: s.v2_max_def, MID: s.v2_max_mid, FWD: s.v2_max_fwd },
    maxPerClub: s.max_players_per_club,
    maxCoaches: s.coach_max_per_team,
  };
}

/** Motivo por el que una plantilla no puede incorporar un jugador (null si puede). */
function squadBlockReason(squad: { position: string; clubId: number }[], player: { position: string; clubId: number; clubName?: string }, limits: SquadLimits) {
  if (squad.length >= limits.maxSquad) return `Tu plantilla está completa (${limits.maxSquad} jugadores): vende a alguien primero`;
  const pos = player.position as Position;
  if (squad.filter((p) => p.position === pos).length >= limits.perPosition[pos]) return `Ya tienes el máximo de ${limits.perPosition[pos]} jugadores en la posición ${pos}`;
  if (squad.filter((p) => p.clubId === player.clubId).length >= limits.maxPerClub) return `Máximo ${limits.maxPerClub} jugadores del mismo club${player.clubName ? ` (${player.clubName})` : ''}`;
  return null;
}

// ───────────────────────────── Vista del mercado ─────────────────────────────

export async function getMarketView(userId: string) {
  const team = await economyTeam(userId);
  if (team.economyVersion !== 2) return { mode: 'CLASSIC' as const };
  if (!team.economyLeagueId || !team.economyLeague) {
    const leagues = await prisma.league.findMany({
      where: { economyVersion: 2, members: { some: { userId } } },
      select: { id: true, name: true },
    });
    return { mode: 'NO_LEAGUE' as const, wallet: team.wallet, eligibleLeagues: leagues };
  }
  const league = team.economyLeague;
  const now = new Date();
  const s = await getSettings();
  const cycle = await getCurrentCycle(league.id, now);
  const [listings, { map }, squad, coachCount, buyers, participants] = await Promise.all([
    prisma.marketListing.findMany({
      where: { cycleId: cycle.id },
      orderBy: { slot: 'asc' },
      include: { player: { select: playerSelect }, coach: { select: coachSelect } },
    }),
    getPlayerAggregates(),
    prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id }, select: { player: { select: { position: true, clubId: true } } } }),
    prisma.leagueCoachOwnership.count({ where: { teamId: team.id } }),
    prisma.fantasyTeam.findMany({ where: { economyLeagueId: league.id }, select: { id: true, name: true, user: { select: { managerName: true } } } }),
    prisma.fantasyTeam.count({ where: { economyLeagueId: league.id } }),
  ]);
  const buyerName = new Map(buyers.map((b) => [b.id, { teamName: b.name, managerName: b.user.managerName }]));
  const limits = await squadLimits();
  const squadLite = squad.map((x) => x.player);
  const lastChanges = await latestValueChanges(listings.filter((l) => l.playerId).map((l) => l.playerId!));

  const items = listings.map((l) => {
    const base = { id: l.id, assetType: l.assetType, rarity: l.rarity, listingPrice: l.listingPrice, slot: l.slot, soldAt: l.soldAt, buyer: l.buyerTeamId ? (buyerName.get(l.buyerTeamId) ?? null) : null, boughtByMe: l.buyerTeamId === team.id };
    if (l.assetType === 'PLAYER' && l.player) {
      const unavailable = !l.player.isActive || STALE_AVAILABLE.includes(l.player.status);
      const status = l.status === 'SOLD' ? 'SOLD' : unavailable ? 'UNAVAILABLE' : 'AVAILABLE';
      const block = status !== 'AVAILABLE' ? null : l.listingPrice > team.wallet ? `Te faltan ${formatK(l.listingPrice - team.wallet)}` : squadBlockReason(squadLite, { position: l.player.position, clubId: l.player.clubId, clubName: l.player.club.name }, limits);
      return { ...base, status, canBuy: status === 'AVAILABLE' && !block, blockReason: block, player: toPlayerDTO(l.player, aggFor(map, l.player.id)), trend: lastChanges.get(l.player.id) ?? null, coach: null };
    }
    const status = l.status === 'SOLD' ? 'SOLD' : l.coach?.isActive ? 'AVAILABLE' : 'UNAVAILABLE';
    const block = status !== 'AVAILABLE' ? null : l.listingPrice > team.wallet ? `Te faltan ${formatK(l.listingPrice - team.wallet)}` : coachCount >= limits.maxCoaches ? `Ya tienes ${limits.maxCoaches} entrenador${limits.maxCoaches === 1 ? '' : 'es'}: vende el tuyo primero` : null;
    return { ...base, status, canBuy: status === 'AVAILABLE' && !block, blockReason: block, player: null, trend: null, coach: l.coach };
  });

  const resetMinute = leagueResetMinute(league);
  return {
    mode: 'LEAGUE' as const,
    serverTime: now.toISOString(),
    league: { id: league.id, name: league.name, timezone: league.marketTimezone, resetTime: hhmm(resetMinute), participants, pityCounter: league.marketPityCounter },
    cycle: { id: cycle.id, cycleDate: cycle.cycleDate, startsAt: cycle.startsAt, endsAt: cycle.endsAt },
    wallet: team.wallet,
    marketOpen: s.market_open,
    squadCount: squad.length,
    limits,
    coachCount,
    players: items.filter((i) => i.assetType === 'PLAYER'),
    coaches: items.filter((i) => i.assetType === 'COACH'),
    pollSeconds: 15,
  };
}

/** Última variación de valor por jugador (tendencia que se muestra en el mercado). */
export async function latestValueChanges(playerIds: number[]) {
  if (!playerIds.length) return new Map<number, { change: number; variationBp: number; gameweekId: number | null }>();
  const rows = await prisma.playerValuation.findMany({
    where: { playerId: { in: playerIds }, reason: 'PERFORMANCE' },
    orderBy: { createdAt: 'desc' },
    select: { playerId: true, change: true, variationBp: true, gameweekId: true },
  });
  const map = new Map<number, { change: number; variationBp: number; gameweekId: number | null }>();
  for (const r of rows) if (!map.has(r.playerId)) map.set(r.playerId, { change: r.change, variationBp: r.variationBp, gameweekId: r.gameweekId });
  return map;
}

// ───────────────────────────── Compra ─────────────────────────────

export const SOLD_MESSAGE = 'Este jugador acaba de ser comprado por otro usuario.';

/**
 * Compra de un anuncio del mercado. Todas las comprobaciones y escrituras van en una transacción:
 *  1. el usuario pertenece a la liga · 2. el mercado está activo · 3. el anuncio sigue disponible (compare-and-set)
 *  4. el jugador no tiene dueño en la liga (restricción única liga+jugador) · 5. saldo suficiente (débito condicional)
 *  6. reglas de plantilla · 7. registro (propiedad, plantilla, movimiento, auditoría).
 * Con dos compras simultáneas solo una consigue el anuncio; la otra recibe SOLD_MESSAGE y no se le cobra nada.
 */
export async function buyListing(userId: string, listingId: number) {
  const s = await getSettings();
  if (!s.market_open) throw badRequest('El mercado está cerrado');
  const team = await economyTeam(userId);
  if (team.economyVersion !== 2 || !team.economyLeagueId) throw badRequest('Tu equipo no juega la economía de ninguna liga');
  const listing = await prisma.marketListing.findUnique({ where: { id: listingId }, include: { cycle: true, player: { include: { club: true } }, coach: true } });
  if (!listing || listing.leagueId !== team.economyLeagueId) throw notFound('Ese anuncio no pertenece al mercado de tu liga');
  const member = await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: listing.leagueId, userId } } });
  if (!member) throw forbidden('No perteneces a esta liga');
  const now = new Date();
  if (now < listing.cycle.startsAt || now >= listing.cycle.endsAt) throw badRequest('Este mercado ya ha terminado: recarga para ver el nuevo');
  if (listing.status !== 'AVAILABLE') throw conflict(SOLD_MESSAGE);
  if (listing.assetType === 'PLAYER' && (!listing.player?.isActive || !listing.player.club.isActive)) throw badRequest('Este jugador no está disponible');
  if (listing.assetType === 'COACH' && !listing.coach?.isActive) throw badRequest('Este entrenador no está disponible');

  if (listing.assetType === 'PLAYER') await snapshotCurrentLineup(team.id);
  const limits = await squadLimits();
  const name = listing.player?.displayName ?? listing.coach?.displayName ?? 'Jugador';

  try {
    const result = await prisma.$transaction(async (tx) => {
      // (3) Compare-and-set: solo una transacción puede pasar el anuncio de AVAILABLE a SOLD
      const claimed = await tx.marketListing.updateMany({
        where: { id: listing.id, status: 'AVAILABLE' },
        data: { status: 'SOLD', buyerTeamId: team.id, soldAt: new Date() },
      });
      if (claimed.count === 0) throw conflict(SOLD_MESSAGE);

      // (5) Débito condicional (bloquea la fila del equipo hasta el final de la transacción)
      const wallet = await changeWallet(tx, {
        teamId: team.id,
        amount: -listing.listingPrice,
        type: listing.assetType === 'PLAYER' ? 'PLAYER_PURCHASE' : 'COACH_PURCHASE',
        description: `Fichaje de ${name}${listing.player ? ` (${listing.player.club.shortName})` : ''} en el mercado de la liga`,
        userId,
        leagueId: listing.leagueId,
        reference: `listing:${listing.id}`,
        operationId: `buy:listing:${listing.id}`,
      });

      if (listing.assetType === 'PLAYER') {
        const p = listing.player!;
        // (6) Reglas de plantilla, con los datos ya bloqueados por esta transacción
        const squad = await tx.fantasyTeamPlayer.findMany({ where: { teamId: team.id }, select: { player: { select: { position: true, clubId: true } } } });
        const block = squadBlockReason(squad.map((x) => x.player), { position: p.position, clubId: p.clubId, clubName: p.club.name }, limits);
        if (block) throw badRequest(block);
        // (4) Propiedad única por liga
        await tx.leaguePlayerOwnership.create({ data: { leagueId: listing.leagueId, playerId: p.id, teamId: team.id, purchasePrice: listing.listingPrice, source: 'MARKET' } });
        await tx.fantasyTeamPlayer.create({ data: { teamId: team.id, playerId: p.id, purchasePrice: p.price } });
      } else {
        const coaches = await tx.leagueCoachOwnership.count({ where: { teamId: team.id } });
        if (coaches >= limits.maxCoaches) throw badRequest(`Ya tienes ${limits.maxCoaches} entrenador${limits.maxCoaches === 1 ? '' : 'es'}: vende el tuyo primero`);
        await tx.leagueCoachOwnership.create({ data: { leagueId: listing.leagueId, coachId: listing.coachId!, teamId: team.id, purchasePrice: listing.listingPrice } });
      }
      await audit(tx, { leagueId: listing.leagueId, cycleId: listing.cycleId, teamId: team.id, userId, action: 'PURCHASE', details: { listingId: listing.id, assetType: listing.assetType, assetId: listing.playerId ?? listing.coachId, price: listing.listingPrice } });
      return { wallet };
    });
    invalidatePlayerAggregates();
    return { ...result, listingId: listing.id, name, price: listing.listingPrice };
  } catch (err) {
    const reason = err instanceof AppError ? err.message : isUniqueViolation(err) ? SOLD_MESSAGE : 'error';
    await audit(prisma, { leagueId: listing.leagueId, cycleId: listing.cycleId, teamId: team.id, userId, action: 'PURCHASE_REJECTED', details: { listingId: listing.id, reason } });
    if (isUniqueViolation(err)) throw conflict(SOLD_MESSAGE);
    throw err;
  }
}

// ───────────────────────────── Venta ─────────────────────────────

async function lockedInLineup(teamId: number, playerId: number, clubId: number) {
  const locks = await snapshotCurrentLineup(teamId);
  if (!locks || !locks.clubLocked(clubId)) return false;
  return !!(await prisma.lineupPlayer.findFirst({ where: { playerId, lineup: { teamId, gameweekId: locks.gameweek.id } } }));
}

/** Venta al banco al valor actual (× % configurable). El jugador vuelve al mercado de la liga tras el cooldown. */
export async function sellPlayerV2(userId: string, playerId: number) {
  const s = await getSettings();
  if (!s.market_open) throw badRequest('El mercado está cerrado');
  const team = await economyTeam(userId);
  if (team.economyVersion !== 2 || !team.economyLeagueId) throw badRequest('Tu equipo no juega la economía de ninguna liga');
  const ownership = await prisma.leaguePlayerOwnership.findUnique({ where: { teamId_playerId: { teamId: team.id, playerId } }, include: { player: { include: { club: true } } } });
  if (!ownership) throw notFound('Ese jugador no está en tu plantilla');
  const p = ownership.player;
  if (await lockedInLineup(team.id, playerId, p.clubId)) throw badRequest(`${p.displayName} está bloqueado: su partido de esta jornada ya ha comenzado`);

  const squad = await prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id, playerId: { not: playerId } }, select: { player: { select: { position: true } } } });
  if (!canFieldEleven(countPositions(squad.map((x) => ({ position: x.player.position as Position })))))
    throw badRequest('No puedes quedarte sin un once válido: ficha un sustituto antes de vender');

  const salePrice = Math.round(((p.marketValue ?? ownership.purchasePrice) * s.v2_sell_percent) / 100);
  const leagueId = team.economyLeagueId;
  const result = await prisma.$transaction(async (tx) => {
    // Borrado condicional: una doble venta simultánea solo cobra una vez
    const removed = await tx.leaguePlayerOwnership.deleteMany({ where: { id: ownership.id, teamId: team.id } });
    if (removed.count === 0) throw conflict('Ese jugador ya se ha vendido');
    await tx.fantasyTeamPlayer.deleteMany({ where: { teamId: team.id, playerId } });
    await tx.lineupPlayer.deleteMany({ where: { playerId, lineup: { teamId: team.id, isFinal: false, gameweek: { isProcessed: false } } } });
    const wallet = await changeWallet(tx, {
      teamId: team.id,
      amount: salePrice,
      type: 'PLAYER_SALE',
      description: `Venta de ${p.displayName} (${p.club.shortName})`,
      userId,
      leagueId,
      reference: `ownership:${ownership.id}`,
      operationId: `sell:ownership:${ownership.id}`,
    });
    await setCooldown(tx, leagueId, 'PLAYER', playerId, s.market_cooldown_hours);
    await audit(tx, { leagueId, teamId: team.id, userId, action: 'SALE', details: { playerId, salePrice, purchasePrice: ownership.purchasePrice } });
    return { wallet };
  });
  invalidatePlayerAggregates();
  return { ...result, salePrice, profit: salePrice - ownership.purchasePrice, player: { id: p.id, displayName: p.displayName } };
}

export async function sellCoach(userId: string, coachId: number) {
  const s = await getSettings();
  if (!s.market_open) throw badRequest('El mercado está cerrado');
  const team = await economyTeam(userId);
  const ownership = await prisma.leagueCoachOwnership.findFirst({ where: { teamId: team.id, coachId }, include: { coach: true } });
  if (!ownership) throw notFound('Ese entrenador no es tuyo');
  const salePrice = Math.round((ownership.coach.marketValue * s.v2_sell_percent) / 100);
  const result = await prisma.$transaction(async (tx) => {
    const removed = await tx.leagueCoachOwnership.deleteMany({ where: { id: ownership.id } });
    if (removed.count === 0) throw conflict('Ese entrenador ya se ha vendido');
    const wallet = await changeWallet(tx, {
      teamId: team.id,
      amount: salePrice,
      type: 'COACH_SALE',
      description: `Venta del entrenador ${ownership.coach.displayName}`,
      userId,
      leagueId: ownership.leagueId,
      reference: `coach-ownership:${ownership.id}`,
      operationId: `sell:coach-ownership:${ownership.id}`,
    });
    await setCooldown(tx, ownership.leagueId, 'COACH', coachId, s.market_cooldown_hours);
    await audit(tx, { leagueId: ownership.leagueId, teamId: team.id, userId, action: 'SALE', details: { coachId, salePrice } });
    return { wallet };
  });
  return { ...result, salePrice };
}

async function setCooldown(tx: Tx, leagueId: number, assetType: 'PLAYER' | 'COACH', assetId: number, hours: number) {
  const availableAt = new Date(Date.now() + hours * 3600 * 1000);
  await tx.leagueAssetCooldown.upsert({
    where: { leagueId_assetType_assetId: { leagueId, assetType, assetId } },
    create: { leagueId, assetType, assetId, availableAt },
    update: { availableAt },
  });
}

// ───────────────────────────── Entrar / salir de la economía de una liga ─────────────────────────────

/** Equipo inicial aleatorio y ponderado (13 por defecto: 11 titulares + 2 suplentes) con jugadores reales libres en la liga. */
async function dealStarterSquad(tx: Tx, teamId: number, leagueId: number, rng: Rng) {
  const s = await getSettings();
  const owned = await tx.leaguePlayerOwnership.findMany({ where: { leagueId }, select: { playerId: true } });
  const taken = new Set(owned.map((o) => o.playerId));
  const players = await tx.player.findMany({
    where: { isActive: true, marketValue: { not: null }, status: { notIn: STALE_AVAILABLE }, club: { isActive: true } },
    select: { id: true, position: true, rarity: true, clubId: true, price: true, marketValue: true },
  });
  const candidates = players.filter((p) => !taken.has(p.id)).map((p) => ({ ...p, position: p.position as Position, rarity: p.rarity as PlayerRarity }));
  const { starters, bench } = buildStarterSquad(
    candidates,
    { formation: resolveFormation(s.v2_starter_formation, rng), bench: s.v2_starter_bench, weights: starterWeights(s), maxPerClub: s.max_players_per_club },
    rng,
  );
  const byId = new Map(players.map((p) => [p.id, p]));
  const all = [...starters, ...bench];
  await tx.leaguePlayerOwnership.createMany({ data: all.map((c) => ({ leagueId, playerId: c.id, teamId, purchasePrice: byId.get(c.id)!.marketValue!, source: 'STARTER' })) });
  await tx.fantasyTeamPlayer.createMany({ data: all.map((c) => ({ teamId, playerId: c.id, purchasePrice: byId.get(c.id)!.price })) });
  return { starters: starters.map((c) => c.id), bench: bench.map((c) => c.id) };
}

/** Borra las alineaciones de jornadas que aún no han empezado (la plantilla va a cambiar por completo). */
async function clearFutureLineups(tx: Tx, teamId: number) {
  await tx.lineup.deleteMany({ where: { teamId, isFinal: false, gameweek: { deadline: { gt: new Date() } } } });
}

async function squadSnapshot(tx: Tx, teamId: number) {
  const [team, players, coaches] = await Promise.all([
    tx.fantasyTeam.findUnique({ where: { id: teamId }, select: { budget: true, wallet: true, economyVersion: true, economyLeagueId: true } }),
    tx.fantasyTeamPlayer.findMany({ where: { teamId }, select: { playerId: true, purchasePrice: true } }),
    tx.leagueCoachOwnership.findMany({ where: { teamId }, select: { coachId: true, purchasePrice: true } }),
  ]);
  return { ...team, players, coaches };
}

/**
 * El equipo empieza a jugar la economía de una liga: plantilla inicial aleatoria + presupuesto inicial.
 * Si el equipo venía del sistema clásico, su plantilla anterior se guarda en la auditoría y se sustituye
 * (solo con confirmación explícita). Protegido frente a dobles envíos: el cambio de economyLeagueId es condicional.
 */
export async function joinEconomy(userId: string, leagueId: number, opts: { confirmReplaceSquad?: boolean; actor?: string } = {}) {
  const s = await getSettings();
  const team = await economyTeam(userId);
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  if (league.economyVersion !== 2) throw badRequest('Esta liga no usa la economía de liga');
  if (!(await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } } }))) throw forbidden('Debes pertenecer a la liga');
  if (team.economyLeagueId === leagueId) throw conflict('Tu equipo ya juega la economía de esta liga');
  if (team.economyLeagueId) throw conflict(`Tu equipo ya juega la economía de «${team.economyLeague?.name}». Un equipo solo puede jugar el mercado de una liga.`);
  const hasSquad = (await prisma.fantasyTeamPlayer.count({ where: { teamId: team.id } })) > 0;
  if (team.economyVersion === 1 && hasSquad && !opts.confirmReplaceSquad)
    throw badRequest('Tu plantilla actual del sistema clásico se sustituirá por un equipo inicial de la liga. Confirma para continuar.', { requiresConfirmation: true });

  let lastError: unknown;
  // Si otro equipo se une a la vez y elige algún jugador en común, la restricción única lo detecta y se reintenta
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const dealt = await prisma.$transaction(async (tx) => {
        const bound = await tx.fantasyTeam.updateMany({ where: { id: team.id, economyLeagueId: null }, data: { economyLeagueId: leagueId, economyVersion: 2 } });
        if (bound.count === 0) throw conflict('Tu equipo ya juega la economía de una liga');
        const snapshot = await squadSnapshot(tx, team.id);
        await tx.fantasyTeamPlayer.deleteMany({ where: { teamId: team.id } });
        await clearFutureLineups(tx, team.id);
        const squad = await dealStarterSquad(tx, team.id, leagueId, cryptoRng);
        // El monedero empieza exactamente en el presupuesto inicial
        const current = (await tx.fantasyTeam.findUniqueOrThrow({ where: { id: team.id }, select: { wallet: true } })).wallet;
        if (current !== 0) await changeWallet(tx, { teamId: team.id, amount: -current, type: 'ECONOMY_RESET', description: 'Saldo anterior retirado al empezar una nueva partida', userId, leagueId, allowNegative: true });
        await changeWallet(tx, { teamId: team.id, amount: s.v2_initial_budget, type: 'INITIAL_BUDGET', description: `Presupuesto inicial de la liga «${league.name}»`, userId, leagueId });
        await audit(tx, { leagueId, teamId: team.id, userId: opts.actor ?? userId, action: 'ECONOMY_JOINED', details: { previous: snapshot, starters: squad.starters, bench: squad.bench } });
        return squad;
      });
      invalidatePlayerAggregates();
      await notify({
        userId,
        type: 'MARKET',
        title: `¡Tu equipo para «${league.name}» está listo!`,
        message: `Has recibido ${dealt.starters.length + dealt.bench.length} jugadores y ${formatK(s.v2_initial_budget)} para el mercado diario de la liga.`,
        link: '/team',
      });
      return { joined: true, leagueId, players: dealt.starters.length + dealt.bench.length, wallet: s.v2_initial_budget };
    } catch (err) {
      lastError = err;
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw lastError;
}

/** Libera la plantilla del equipo en su liga (al abandonar o ser expulsado, o al reiniciar la economía). */
export async function leaveEconomy(teamId: number, reason: string, actor?: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { id: teamId } });
  if (!team?.economyLeagueId) return { left: false };
  const leagueId = team.economyLeagueId;
  await prisma.$transaction(async (tx) => {
    const snapshot = await squadSnapshot(tx, teamId);
    const owned = await tx.leaguePlayerOwnership.findMany({ where: { teamId, leagueId }, select: { playerId: true } });
    await tx.leaguePlayerOwnership.deleteMany({ where: { teamId, leagueId } });
    await tx.leagueCoachOwnership.deleteMany({ where: { teamId, leagueId } });
    await tx.fantasyTeamPlayer.deleteMany({ where: { teamId, playerId: { in: owned.map((o) => o.playerId) } } });
    await clearFutureLineups(tx, teamId);
    const { wallet } = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: teamId }, select: { wallet: true } });
    if (wallet !== 0) await changeWallet(tx, { teamId, amount: -wallet, type: 'ECONOMY_RESET', description: `Fin de la partida en la liga (${reason})`, leagueId, allowNegative: true });
    await tx.fantasyTeam.update({ where: { id: teamId }, data: { economyLeagueId: null } });
    await audit(tx, { leagueId, teamId, userId: actor ?? team.userId, action: 'ECONOMY_LEFT', details: { reason, snapshot } });
  });
  invalidatePlayerAggregates();
  return { left: true };
}

/**
 * REINICIALIZAR ECONOMÍA DE LIGA (acción administrativa explícita). Guarda una instantánea completa en la
 * auditoría, libera todas las plantillas, borra el mercado vigente y reparte equipos iniciales nuevos.
 * Las jornadas, puntos y mercados de días anteriores se conservan.
 */
export async function resetLeagueEconomy(leagueId: number, actorId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  if (league.economyVersion !== 2) throw badRequest('Esta liga no usa la economía de liga');
  const teams = await prisma.fantasyTeam.findMany({ where: { economyLeagueId: leagueId }, select: { id: true, userId: true } });
  const snapshot = await Promise.all(teams.map(async (t) => ({ teamId: t.id, ...(await squadSnapshot(prisma, t.id)) })));
  await audit(prisma, { leagueId, userId: actorId, action: 'ECONOMY_RESET', details: { teams: snapshot } });
  for (const t of teams) await leaveEconomy(t.id, 'reinicio de la economía de la liga', actorId);
  await prisma.$transaction([
    prisma.marketCycle.deleteMany({ where: { leagueId, endsAt: { gt: new Date() } } }),
    prisma.leagueAssetCooldown.deleteMany({ where: { leagueId } }),
    prisma.league.update({ where: { id: leagueId }, data: { marketPityCounter: 0, economyStartedAt: new Date() } }),
  ]);
  let rejoined = 0;
  for (const t of teams) {
    await joinEconomy(t.userId, leagueId, { confirmReplaceSquad: true, actor: actorId });
    rejoined++;
  }
  return { teams: rejoined };
}

/**
 * Migración controlada de una liga existente al nuevo sistema. Solo se incorporan a su economía los miembros
 * cuyo equipo no juega ya la economía de otra liga; al resto se les informa. Nunca se ejecuta automáticamente.
 */
export async function migrateLeagueToV2(leagueId: number, actorId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { members: { select: { userId: true } } } });
  if (!league) throw notFound('Liga no encontrada');
  if (league.type === 'GLOBAL') throw badRequest('La liga global reúne a todos los mánagers y se mantiene como clasificación general');
  if (league.economyVersion === 2) throw conflict('La liga ya usa la economía de liga');
  const s = await getSettings();
  await prisma.league.update({ where: { id: leagueId }, data: { economyVersion: 2, economyStartedAt: new Date(), marketTimezone: league.marketTimezone || s.market_default_timezone } });
  await audit(prisma, { leagueId, userId: actorId, action: 'LEAGUE_MIGRATED', details: { members: league.members.length } });
  const results: { userId: string; joined: boolean; reason?: string }[] = [];
  for (const m of league.members) {
    try {
      await joinEconomy(m.userId, leagueId, { confirmReplaceSquad: true, actor: actorId });
      results.push({ userId: m.userId, joined: true });
    } catch (err) {
      results.push({ userId: m.userId, joined: false, reason: err instanceof Error ? err.message : 'error' });
    }
  }
  return { migrated: true, joined: results.filter((r) => r.joined).length, skipped: results.filter((r) => !r.joined) };
}

/** Hora y zona horaria del reinicio diario (administrador de la liga o del sitio). Se aplica desde el siguiente ciclo. */
export async function updateMarketSchedule(leagueId: number, patch: { timezone?: string; resetTime?: string }) {
  const data: { marketTimezone?: string; marketResetMinute?: number } = {};
  if (patch.timezone !== undefined) {
    if (!isValidTimeZone(patch.timezone)) throw badRequest('Zona horaria no válida (formato IANA, p. ej. Europe/London)');
    data.marketTimezone = patch.timezone;
  }
  if (patch.resetTime !== undefined) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(patch.resetTime);
    if (!m) throw badRequest('Hora de reinicio no válida (HH:MM)');
    data.marketResetMinute = Number(m[1]) * 60 + Number(m[2]);
  }
  const league = await prisma.league.update({ where: { id: leagueId }, data });
  return { timezone: league.marketTimezone, resetTime: hhmm(leagueResetMinute(league)) };
}

/** Resumen de la economía de una liga para su página (participantes, horario, estado del usuario). */
export async function leagueEconomySummary(leagueId: number, userId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league || league.economyVersion !== 2) return null;
  const [team, participants] = await Promise.all([
    prisma.fantasyTeam.findUnique({ where: { userId }, select: { id: true, economyVersion: true, economyLeagueId: true, economyLeague: { select: { name: true } }, _count: { select: { players: true } } } }),
    prisma.fantasyTeam.findMany({
      where: { economyLeagueId: leagueId },
      select: { id: true, name: true, wallet: true, user: { select: { managerName: true } }, _count: { select: { playerOwnerships: true } } },
    }),
  ]);
  const values = await prisma.leaguePlayerOwnership.findMany({ where: { leagueId }, select: { teamId: true, player: { select: { marketValue: true } } } });
  const teamValue = new Map<number, number>();
  for (const v of values) teamValue.set(v.teamId, (teamValue.get(v.teamId) ?? 0) + (v.player.marketValue ?? 0));
  return {
    timezone: league.marketTimezone,
    resetTime: hhmm(leagueResetMinute(league)),
    startedAt: league.economyStartedAt ?? league.createdAt,
    pityCounter: league.marketPityCounter,
    myStatus: !team ? 'NO_TEAM' : team.economyLeagueId === leagueId ? 'PLAYING' : team.economyLeagueId ? 'OTHER_LEAGUE' : team.economyVersion === 1 && team._count.players > 0 ? 'CLASSIC_SQUAD' : 'CAN_JOIN',
    otherLeagueName: team?.economyLeagueId && team.economyLeagueId !== leagueId ? (team.economyLeague?.name ?? null) : null,
    participants: participants
      .map((p) => ({ teamId: p.id, teamName: p.name, managerName: p.user.managerName, players: p._count.playerOwnerships, squadValue: teamValue.get(p.id) ?? 0 }))
      .sort((a, b) => b.squadValue - a.squadValue),
  };
}

export async function marketAuditLog(leagueId: number, take = 100) {
  return prisma.marketAuditLog.findMany({ where: { leagueId }, orderBy: { id: 'desc' }, take });
}

/** Mercado activo de una liga para el panel de administración (sin datos del usuario). */
export async function adminCurrentMarket(leagueId: number) {
  const cycle = await getCurrentCycle(leagueId);
  const listings = await prisma.marketListing.findMany({
    where: { cycleId: cycle.id },
    orderBy: { slot: 'asc' },
    include: { player: { select: { id: true, displayName: true, position: true, club: { select: { shortName: true } } } }, coach: { select: { id: true, displayName: true } } },
  });
  return { cycle, listings };
}

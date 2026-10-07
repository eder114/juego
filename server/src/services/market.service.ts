import crypto from 'node:crypto';
import { prisma, type Tx } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
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
import { createTeamForLeague, resolveTeam, teamIdentity } from './team.service';
import { notify } from './notification.service';
import { leadingBids, minNextBid, placeBid, settleCycle, withdrawTeamFromAuctions, type AuctionListing, type BidContext } from './auction.service';

/**
 * Mercado de subastas por liga (economía v2)
 * ──────────────────────────────────────────
 * - Un ciclo diario por liga (MarketCycle) con N jugadores y 1–2 entrenadores, iguales para todos sus miembros.
 * - Cada anuncio es una SUBASTA que abre y cierra exactamente con el ciclo: no se compra directamente.
 * - El servidor decide el ciclo vigente (UTC en BD, hora local de la liga para el reinicio); nunca el navegador.
 * - Al vencer el ciclo se liquidan todas las subastas (ver `auction.service`) y solo entonces se genera el
 *   mercado siguiente, de modo que el dinero retenido se resuelve antes de que empiecen las pujas nuevas.
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

  // El ciclo anterior ha vencido: se liquidan sus subastas (adjudicaciones y devoluciones) antes de abrir otro
  if (latest && now >= latest.endsAt && !latest.settledAt) await settleCycle(latest.id, settleHooks, now);

  const hours = (await getSettings()).market_cycle_hours;
  const window = marketCycleWindow(now, league.marketTimezone, leagueResetMinute(league), hours);
  // Si se cambió la hora de reinicio, el nuevo horario empieza donde terminó el ciclo anterior
  const startsAt = latest && latest.endsAt > window.startsAt ? latest.endsAt : window.startsAt;
  const endsAt = window.endsAt > startsAt ? window.endsAt : new Date(startsAt.getTime() + hours * 3600 * 1000);
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
  // Precio de SALIDA de la subasta: un porcentaje del valor del jugador, acotado por los límites configurados.
  // No es el precio final: lo decide la puja más alta al cerrar el mercado.
  const startingPrice = (value: number) => Math.min(s.market_start_max, Math.max(s.market_start_min, Math.round((value * s.market_start_percent) / 100)));
  const valueOf = new Map(players.map((p) => [p.id, startingPrice(p.marketValue!)]));
  const coachValue = new Map(coaches.map((c) => [c.id, startingPrice(c.marketValue)]));

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

/** Equipo del usuario en la liga indicada (cada liga tiene el suyo). */
async function economyTeam(userId: string, leagueId?: number | null) {
  return resolveTeam(userId, leagueId);
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

export async function getMarketView(userId: string, leagueId?: number | null) {
  const team = await economyTeam(userId, leagueId);
  // El equipo de la liga global juega el mercado libre clásico
  if (team.economyVersion !== 2 || !team.league || team.league.economyVersion !== 2) {
    const leagues = await prisma.league.findMany({
      where: { economyVersion: 2, members: { some: { userId } } },
      select: { id: true, name: true },
    });
    return { mode: 'CLASSIC' as const, budget: team.budget, eligibleLeagues: leagues };
  }
  const league = team.league;
  const now = new Date();
  const s = await getSettings();
  const cycle = await getCurrentCycle(league.id, now);
  const [listings, { map }, squad, coachCount, teams, myBids] = await Promise.all([
    prisma.marketListing.findMany({
      where: { cycleId: cycle.id },
      orderBy: { slot: 'asc' },
      include: { player: { select: playerSelect }, coach: { select: coachSelect } },
    }),
    getPlayerAggregates(),
    prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id }, select: { player: { select: { position: true, clubId: true } } } }),
    prisma.leagueCoachOwnership.count({ where: { teamId: team.id } }),
    prisma.fantasyTeam.findMany({ where: { leagueId: league.id }, select: { id: true, name: true, user: { select: { managerName: true } } } }),
    prisma.marketBid.findMany({ where: { teamId: team.id, listing: { cycleId: cycle.id } }, orderBy: { amount: 'desc' }, select: { listingId: true, amount: true } }),
  ]);
  const teamName = new Map(teams.map((b) => [b.id, { teamName: b.name, managerName: b.user.managerName }]));
  const limits = await squadLimits();
  const squadLite = squad.map((x) => x.player);
  const lastChanges = await latestValueChanges(listings.filter((l) => l.playerId).map((l) => l.playerId!));
  // Puja mas alta de este equipo en cada subasta (el historial completo se consulta aparte)
  const mine = new Map<number, number>();
  for (const b of myBids) if (!mine.has(b.listingId)) mine.set(b.listingId, b.amount);
  // Lo que el equipo va ganando ocupa hueco en su plantilla: no puede liderar mas pujas de las que cabrian
  const leading = listings.filter((l) => l.topBidTeamId === team.id && l.status === 'AVAILABLE');
  const virtualSquad = [...squadLite, ...leading.filter((l) => l.player).map((l) => ({ position: l.player!.position, clubId: l.player!.clubId }))];
  const virtualCoaches = coachCount + leading.filter((l) => l.assetType === 'COACH').length;
  const available = team.wallet - team.reserved;

  const items = listings.map((l) => {
    const myBid = mine.get(l.id) ?? null;
    const leader = l.topBidTeamId === team.id;
    const open = l.status === 'AVAILABLE';
    const minNext = minNextBid(l, s.market_min_increment);
    const base = {
      id: l.id,
      assetType: l.assetType,
      rarity: l.rarity,
      startingPrice: l.listingPrice,
      slot: l.slot,
      topBid: l.topBid,
      topBidder: l.topBidTeamId ? (teamName.get(l.topBidTeamId) ?? null) : null,
      leading: open && leader,
      outbid: open && myBid !== null && !leader,
      myBid,
      bidCount: l.bidCount,
      bidderCount: l.bidderCount,
      minNextBid: minNext,
      finalPrice: l.finalPrice,
      soldAt: l.soldAt,
      winner: l.buyerTeamId ? (teamName.get(l.buyerTeamId) ?? null) : null,
      wonByMe: l.buyerTeamId === team.id,
    };
    // Lo que falta para pujar el minimo, descontando lo que este equipo ya tiene retenido aqui
    const needed = minNext - (leader ? (myBid ?? 0) : 0);
    const noMoney = needed > available ? `Te faltan ${formatK(needed - available)} disponibles` : null;
    if (l.assetType === 'PLAYER' && l.player) {
      const unavailable = !l.player.isActive || STALE_AVAILABLE.includes(l.player.status);
      const status = !open ? (l.status === 'SOLD' ? 'SOLD' : 'UNSOLD') : unavailable ? 'UNAVAILABLE' : 'OPEN';
      // Si ya es el lider, el jugador ya cuenta en su plantilla virtual: no se le bloquea por su propia puja
      const fit = leader ? null : squadBlockReason(virtualSquad, { position: l.player.position, clubId: l.player.clubId, clubName: l.player.club.name }, limits);
      const block = status !== 'OPEN' ? null : (fit ?? noMoney);
      return { ...base, status, canBid: status === 'OPEN' && !block && s.market_open, blockReason: block, player: toPlayerDTO(l.player, aggFor(map, l.player.id)), trend: lastChanges.get(l.player.id) ?? null, coach: null };
    }
    const status = !open ? (l.status === 'SOLD' ? 'SOLD' : 'UNSOLD') : l.coach?.isActive ? 'OPEN' : 'UNAVAILABLE';
    const fit = leader || virtualCoaches < limits.maxCoaches ? null : `Ya tienes ${limits.maxCoaches} entrenador${limits.maxCoaches === 1 ? '' : 'es'} (contando tus pujas ganadoras)`;
    const block = status !== 'OPEN' ? null : (fit ?? noMoney);
    return { ...base, status, canBid: status === 'OPEN' && !block && s.market_open, blockReason: block, player: null, trend: null, coach: l.coach };
  });

  const resetMinute = leagueResetMinute(league);
  return {
    mode: 'LEAGUE' as const,
    serverTime: now.toISOString(),
    league: { id: league.id, name: league.name, timezone: league.marketTimezone, resetTime: hhmm(resetMinute), participants: teams.length, pityCounter: league.marketPityCounter },
    cycle: { id: cycle.id, cycleDate: cycle.cycleDate, startsAt: cycle.startsAt, endsAt: cycle.endsAt },
    wallet: team.wallet,
    reserved: team.reserved,
    available,
    minIncrement: s.market_min_increment,
    marketOpen: s.market_open,
    squadCount: squad.length,
    leadingCount: leading.length,
    limits,
    coachCount,
    players: items.filter((i) => i.assetType === 'PLAYER'),
    coaches: items.filter((i) => i.assetType === 'COACH'),
    pollSeconds: 15,
  };
}

/**
 * Estado ligero de las subastas: solo lo que cambia mientras el usuario mira la pagina. Se consulta cada
 * pocos segundos (mucho mas barato que la vista completa) para que las pujas de los demas aparezcan solas,
 * sin recargar. La hora la marca siempre el servidor.
 */
export async function getMarketPulse(userId: string, leagueId?: number | null) {
  const team = await economyTeam(userId, leagueId);
  const now = new Date();
  if (team.economyVersion !== 2 || !team.leagueId) return { mode: 'CLASSIC' as const, serverTime: now.toISOString() };
  const cycle = await prisma.marketCycle.findFirst({ where: { leagueId: team.leagueId }, orderBy: { startsAt: 'desc' } });
  const base = { mode: 'LEAGUE' as const, serverTime: now.toISOString(), wallet: team.wallet, reserved: team.reserved, available: team.wallet - team.reserved };
  if (!cycle) return { ...base, cycleId: null, endsAt: null, settled: false, auctions: [] };
  const [listings, myBids, s] = await Promise.all([
    prisma.marketListing.findMany({ where: { cycleId: cycle.id }, orderBy: { slot: 'asc' }, select: { id: true, status: true, listingPrice: true, topBid: true, topBidTeamId: true, bidCount: true, bidderCount: true, finalPrice: true, buyerTeamId: true } }),
    prisma.marketBid.findMany({ where: { teamId: team.id, listing: { cycleId: cycle.id } }, orderBy: { amount: 'desc' }, select: { listingId: true, amount: true } }),
    getSettings(),
  ]);
  const mine = new Map<number, number>();
  for (const b of myBids) if (!mine.has(b.listingId)) mine.set(b.listingId, b.amount);
  return {
    ...base,
    cycleId: cycle.id,
    endsAt: cycle.endsAt,
    settled: !!cycle.settledAt,
    auctions: listings.map((l) => ({
      id: l.id,
      status: l.status === 'AVAILABLE' ? ('OPEN' as const) : l.status === 'SOLD' ? ('SOLD' as const) : ('UNSOLD' as const),
      topBid: l.topBid,
      leading: l.topBidTeamId === team.id,
      myBid: mine.get(l.id) ?? null,
      bidCount: l.bidCount,
      bidderCount: l.bidderCount,
      minNextBid: minNextBid(l, s.market_min_increment),
      finalPrice: l.finalPrice,
      wonByMe: l.buyerTeamId === team.id,
    })),
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

// ───────────────────────────── Pujas y liquidación ─────────────────────────────

/**
 * Contexto que necesita una puja para saber si el jugador cabría en la plantilla del equipo. Cuenta como
 * ocupadas las subastas que ese equipo ya va ganando, de modo que nadie puede liderar más pujas de las que
 * podría llegar a fichar.
 */
async function bidContext(teamId: number, listing: AuctionListing): Promise<BidContext> {
  const [squad, coachCount, leading, limits] = await Promise.all([
    prisma.fantasyTeamPlayer.findMany({ where: { teamId }, select: { player: { select: { position: true, clubId: true } } } }),
    prisma.leagueCoachOwnership.count({ where: { teamId } }),
    leadingBids(teamId, listing.cycleId),
    squadLimits(),
  ]);
  const virtual = [
    ...squad.map((x) => x.player),
    ...leading.filter((l) => l.id !== listing.id && l.player).map((l) => ({ position: l.player!.position, clubId: l.player!.clubId })),
  ];
  return {
    squad: virtual,
    coachCount: coachCount + leading.filter((l) => l.id !== listing.id && l.assetType === 'COACH').length,
    limits,
    blockReason: squadBlockReason,
  };
}

/** Puja por un anuncio del mercado de la liga. Toda la validación real está en `auction.service`. */
export async function bidOnListing(userId: string, listingId: number, amount: number) {
  const result = await placeBid(userId, listingId, amount, { squadContext: bidContext });
  invalidatePlayerAggregates();
  return result;
}

/** Comprobación que se repite al adjudicar: el ganador debe seguir teniendo hueco para el jugador. */
export const settleHooks = {
  async assignBlock(tx: Tx, teamId: number, listing: { assetType: string; playerId: number | null; coachId: number | null }) {
    const limits = await squadLimits();
    if (listing.assetType === 'COACH') {
      const coaches = await tx.leagueCoachOwnership.count({ where: { teamId } });
      return coaches >= limits.maxCoaches ? `Ya tienes ${limits.maxCoaches} entrenador${limits.maxCoaches === 1 ? '' : 'es'}` : null;
    }
    const player = await tx.player.findUnique({ where: { id: listing.playerId! }, include: { club: true } });
    if (!player) return 'El jugador ya no existe';
    const squad = await tx.fantasyTeamPlayer.findMany({ where: { teamId }, select: { player: { select: { position: true, clubId: true } } } });
    return squadBlockReason(squad.map((x) => x.player), { position: player.position, clubId: player.clubId, clubName: player.club.name }, limits);
  },
};

/** Liquida los mercados vencidos de todas las ligas (también lo hace el ciclo al generarse el siguiente). */
export async function settleDueCycles(now = new Date()) {
  const due = await prisma.marketCycle.findMany({ where: { endsAt: { lte: now }, settledAt: null }, select: { id: true }, orderBy: { endsAt: 'asc' } });
  let sold = 0;
  let unsold = 0;
  for (const c of due) {
    const r = await settleCycle(c.id, settleHooks, now);
    sold += r.sold;
    unsold += r.unsold;
  }
  return { cycles: due.length, sold, unsold };
}

// ───────────────────────────── Venta ─────────────────────────────

async function lockedInLineup(teamId: number, playerId: number, clubId: number) {
  const locks = await snapshotCurrentLineup(teamId);
  if (!locks || !locks.clubLocked(clubId)) return false;
  return !!(await prisma.lineupPlayer.findFirst({ where: { playerId, lineup: { teamId, gameweekId: locks.gameweek.id } } }));
}

/** Venta al banco al valor actual (× % configurable). El jugador vuelve al mercado de la liga tras el cooldown. */
export async function sellPlayerV2(userId: string, playerId: number, leagueId?: number | null) {
  const s = await getSettings();
  if (!s.market_open) throw badRequest('El mercado está cerrado');
  const team = await economyTeam(userId, leagueId);
  if (team.economyVersion !== 2 || !team.leagueId) throw badRequest('Tu equipo no juega la economía de ninguna liga');
  const ownership = await prisma.leaguePlayerOwnership.findUnique({ where: { teamId_playerId: { teamId: team.id, playerId } }, include: { player: { include: { club: true } } } });
  if (!ownership) throw notFound('Ese jugador no está en tu plantilla');
  const p = ownership.player;
  if (await lockedInLineup(team.id, playerId, p.clubId)) throw badRequest(`${p.displayName} está bloqueado: su partido de esta jornada ya ha comenzado`);

  const squad = await prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id, playerId: { not: playerId } }, select: { player: { select: { position: true } } } });
  if (!canFieldEleven(countPositions(squad.map((x) => ({ position: x.player.position as Position })))))
    throw badRequest('No puedes quedarte sin un once válido: ficha un sustituto antes de vender');

  const salePrice = Math.round(((p.marketValue ?? ownership.purchasePrice) * s.v2_sell_percent) / 100);
  const league = team.leagueId;
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
      leagueId: league,
      reference: `ownership:${ownership.id}`,
      operationId: `sell:ownership:${ownership.id}`,
    });
    await setCooldown(tx, league, 'PLAYER', playerId, s.market_cooldown_hours);
    await audit(tx, { leagueId: league, teamId: team.id, userId, action: 'SALE', details: { playerId, salePrice, purchasePrice: ownership.purchasePrice } });
    return { wallet };
  });
  invalidatePlayerAggregates();
  return { ...result, salePrice, profit: salePrice - ownership.purchasePrice, player: { id: p.id, displayName: p.displayName } };
}

export async function sellCoach(userId: string, coachId: number, leagueId?: number | null) {
  const s = await getSettings();
  if (!s.market_open) throw badRequest('El mercado está cerrado');
  const team = await economyTeam(userId, leagueId);
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
  const formation = resolveFormation(s.v2_starter_formation, rng);
  const { starters, bench } = buildStarterSquad(
    candidates,
    { formation, bench: s.v2_starter_bench, weights: starterWeights(s), maxPerClub: s.max_players_per_club },
    rng,
  );
  const byId = new Map(players.map((p) => [p.id, p]));
  const all = [...starters, ...bench];
  await tx.leaguePlayerOwnership.createMany({ data: all.map((c) => ({ leagueId, playerId: c.id, teamId, purchasePrice: byId.get(c.id)!.marketValue!, source: 'STARTER' })) });
  await tx.fantasyTeamPlayer.createMany({ data: all.map((c) => ({ teamId, playerId: c.id, purchasePrice: byId.get(c.id)!.price })) });
  return { formation, starters: starters.map((c) => c.id), bench: bench.map((c) => c.id) };
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
 * Crea el equipo del usuario en una liga con economía: plantilla inicial aleatoria y presupuesto inicial.
 * Cada liga tiene su propio equipo, así que esto no toca los equipos del usuario en otras ligas.
 * Protegido frente a dobles envíos por la restricción única (usuario, liga).
 */
export async function joinEconomy(userId: string, leagueId: number, opts: { actor?: string } = {}) {
  const s = await getSettings();
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  if (league.economyVersion !== 2) throw badRequest('Esta liga no usa la economía de liga');
  if (!(await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } } }))) throw forbidden('Debes pertenecer a la liga');
  const existing = await prisma.fantasyTeam.findFirst({ where: { userId, leagueId } });
  if (existing) throw conflict('Ya tienes equipo en esta liga');
  const identity = await teamIdentity(userId);

  let lastError: unknown;
  // Si otro mánager entra a la vez y le tocan jugadores en común, la restricción única lo detecta y se reintenta
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const dealt = await prisma.$transaction(async (tx) => {
        const team = await createTeamForLeague(tx, { userId, leagueId, name: identity.name, crest: identity.crest, economyVersion: 2 });
        const squad = await dealStarterSquad(tx, team.id, leagueId, cryptoRng);
        // El reparto queda guardado para poder presentárselo al usuario (una sola vez)
        await tx.fantasyTeam.update({
          where: { id: team.id },
          data: { initialSquad: JSON.stringify({ ...squad, assignedAt: new Date().toISOString() }), initialRevealedAt: null },
        });
        await changeWallet(tx, { teamId: team.id, amount: s.v2_initial_budget, type: 'INITIAL_BUDGET', description: `Presupuesto inicial de la liga «${league.name}»`, userId, leagueId });
        await audit(tx, { leagueId, teamId: team.id, userId: opts.actor ?? userId, action: 'ECONOMY_JOINED', details: { starters: squad.starters, bench: squad.bench } });
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

/**
 * El equipo deja la liga (al abandonarla, al ser expulsado o al reiniciar su economía): se libera su
 * plantilla para los demás y el equipo desaparece con ella. Antes se guarda una instantánea en la auditoría.
 * Los equipos del usuario en otras ligas no se tocan.
 */
export async function leaveEconomy(teamId: number, reason: string, actor?: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { id: teamId }, include: { league: true } });
  if (!team?.leagueId || team.league?.type === 'GLOBAL') return { left: false };
  const leagueId = team.leagueId;
  await prisma.$transaction(async (tx) => {
    const snapshot = await squadSnapshot(tx, teamId);
    await audit(tx, { leagueId, teamId, userId: actor ?? team.userId, action: 'ECONOMY_LEFT', details: { reason, snapshot } });
    // Sus pujas vivas se cancelan y las subastas que lideraba vuelven a quedar libres para los demás
    await withdrawTeamFromAuctions(tx, teamId);
    // Al borrar el equipo se liberan en cascada su plantilla, propiedades, alineaciones y cartas
    await tx.fantasyTeam.delete({ where: { id: teamId } });
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
  const teams = await prisma.fantasyTeam.findMany({ where: { leagueId }, select: { id: true, userId: true } });
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
    await joinEconomy(t.userId, leagueId, { actor: actorId });
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
      await joinEconomy(m.userId, leagueId, { actor: actorId });
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
    prisma.fantasyTeam.findFirst({ where: { userId, leagueId }, select: { id: true } }),
    prisma.fantasyTeam.findMany({
      where: { leagueId },
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
    // En este modelo, o tienes equipo en la liga o puedes crearlo entrando en ella
    myStatus: team ? ('PLAYING' as const) : ('CAN_JOIN' as const),
    participants: participants
      .map((p) => ({ teamId: p.id, teamName: p.name, managerName: p.user.managerName, players: p._count.playerOwnerships, squadValue: teamValue.get(p.id) ?? 0 }))
      .sort((a, b) => b.squadValue - a.squadValue),
  };
}

/**
 * Presentación del equipo inicial. El reparto lo hace `joinEconomy` dentro de una transacción; aquí solo se
 * consulta lo ya guardado (nunca se asignan jugadores) y se marca la presentación como vista.
 * Estados: NOT_ASSIGNED (aún sin partida) · PENDING (repartido, sin ver) · COMPLETED (ya visto).
 */
export async function getInitialTeamReveal(userId: string, leagueId: number) {
  const team = await prisma.fantasyTeam.findFirst({ where: { userId, leagueId }, include: { league: true } });
  const base = { leagueId, league: team?.league ? { id: team.league.id, name: team.league.name } : null };
  if (!team || !team.initialSquad) return { ...base, status: 'NOT_ASSIGNED' as const, players: [], starters: 0, bench: 0, wallet: team?.wallet ?? 0, squadValue: 0, formation: null };

  const squad = JSON.parse(team.initialSquad) as { formation: string; starters: number[]; bench: number[]; assignedAt: string };
  const ids = [...squad.starters, ...squad.bench];
  const [rows, { map }] = await Promise.all([
    prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id, playerId: { in: ids } }, include: { player: { select: playerSelect } } }),
    getPlayerAggregates(),
  ]);
  const byId = new Map(rows.map((r) => [r.playerId, r.player]));
  // Orden de revelación: titulares (por línea) y después suplentes. Solo jugadores que siguen en la plantilla.
  const players = ids
    .filter((id) => byId.has(id))
    .map((id, index) => ({
      order: index,
      role: squad.starters.includes(id) ? ('STARTER' as const) : ('BENCH' as const),
      player: toPlayerDTO(byId.get(id)!, aggFor(map, id)),
    }));
  return {
    ...base,
    status: team.initialRevealedAt ? ('COMPLETED' as const) : ('PENDING' as const),
    formation: squad.formation,
    assignedAt: squad.assignedAt,
    revealedAt: team.initialRevealedAt,
    players,
    starters: players.filter((p) => p.role === 'STARTER').length,
    bench: players.filter((p) => p.role === 'BENCH').length,
    wallet: team.wallet,
    squadValue: players.reduce((sum, p) => sum + (p.player.marketValue ?? 0), 0),
    team: { id: team.id, name: team.name, crest: JSON.parse(team.crest || '{}') },
  };
}

/** Marca la presentación como vista (idempotente: repetirla no cambia nada ni reparte jugadores). */
export async function completeInitialReveal(userId: string, leagueId: number) {
  const team = await prisma.fantasyTeam.findFirst({ where: { userId, leagueId } });
  if (!team) throw badRequest('Todavía no tienes equipo en esta liga');
  await prisma.fantasyTeam.updateMany({ where: { id: team.id, initialRevealedAt: null }, data: { initialRevealedAt: new Date() } });
  return { completed: true };
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
    include: {
      player: { select: { id: true, displayName: true, position: true, club: { select: { shortName: true } } } },
      coach: { select: { id: true, displayName: true } },
    },
  });
  const teams = await prisma.fantasyTeam.findMany({ where: { leagueId }, select: { id: true, name: true } });
  const name = new Map(teams.map((t) => [t.id, t.name]));
  return {
    cycle,
    listings: listings.map((l) => ({ ...l, topBidTeam: l.topBidTeamId ? (name.get(l.topBidTeamId) ?? null) : null, buyerTeam: l.buyerTeamId ? (name.get(l.buyerTeamId) ?? null) : null })),
  };
}

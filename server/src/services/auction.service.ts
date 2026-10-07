import { prisma, type Tx } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { formatK } from '../domain/economy';
import type { Position } from '../domain/constants';
import { audit, changeReserved, changeWallet, isUniqueViolation } from './economy.service';
import { getSettings } from './settings.service';
import { notify, notifyMany } from './notification.service';
import { resolveTeam } from './team.service';
import { invalidatePlayerAggregates } from './player-stats.service';

/**
 * Subastas del mercado de liga
 * ────────────────────────────
 * Cada anuncio del mercado (`market_listings`) es una subasta que abre y cierra EXACTAMENTE con su ciclo:
 * no hay temporizadores por jugador. Mientras el ciclo está abierto los mánagers se superan unos a otros;
 * al vencer `cycle.endsAt` el servidor liquida todas las subastas de ese ciclo a la vez.
 *
 * Reglas que garantiza el backend (nunca el navegador):
 *  - una puja debe superar a la actual en al menos la subida mínima configurada;
 *  - el dinero de la puja líder queda retenido (`fantasy_teams.reserved`) y no se puede gastar en nada más;
 *  - al ser superado, el mánager recupera su dinero al instante;
 *  - al cerrar, la puja más alta gana, se cobra y se adjudica el jugador dentro de esa liga;
 *  - todo el cierre es idempotente: nunca se cobra ni se adjudica dos veces.
 */

export const OUTBID_MESSAGE = 'Alguien ha pujado más alto: actualiza el mercado para ver la oferta actual.';

export type AuctionListing = {
  id: number;
  leagueId: number;
  cycleId: number;
  assetType: string;
  playerId: number | null;
  coachId: number | null;
  listingPrice: number;
  status: string;
  topBid: number | null;
  topBidTeamId: number | null;
};

/** Puja mínima admisible: el precio de salida si no hay pujas, o la actual más la subida mínima. */
export function minNextBid(listing: { listingPrice: number; topBid: number | null }, increment: number) {
  return listing.topBid === null ? listing.listingPrice : listing.topBid + increment;
}

/** Pujas de una subasta, de la más reciente a la más antigua. Nunca se modifican las anteriores. */
export async function listingBids(listingId: number, viewerUserId?: string) {
  const listing = await prisma.marketListing.findUnique({
    where: { id: listingId },
    select: { id: true, leagueId: true, listingPrice: true, topBid: true, status: true, finalPrice: true },
  });
  if (!listing) throw notFound('Esa subasta no existe');
  if (viewerUserId) {
    const member = await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: listing.leagueId, userId: viewerUserId } } });
    if (!member) throw forbidden('No perteneces a esta liga');
  }
  const bids = await prisma.marketBid.findMany({
    where: { listingId },
    orderBy: [{ amount: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    select: { id: true, amount: true, status: true, createdAt: true, teamId: true, team: { select: { name: true, user: { select: { managerName: true } } } } },
  });
  return {
    listing: { id: listing.id, startingPrice: listing.listingPrice, topBid: listing.topBid, status: listing.status, finalPrice: listing.finalPrice },
    bids: bids.map((b) => ({ id: b.id, amount: b.amount, status: b.status, createdAt: b.createdAt, teamId: b.teamId, teamName: b.team.name, managerName: b.team.user.managerName })),
  };
}

export interface BidContext {
  /** Plantilla actual del equipo, para comprobar que el jugador cabe si gana la subasta. */
  squad: { position: string; clubId: number }[];
  coachCount: number;
  limits: { maxSquad: number; perPosition: Record<Position, number>; maxPerClub: number; maxCoaches: number };
  blockReason: (squad: { position: string; clubId: number }[], player: { position: string; clubId: number; clubName?: string }, limits: BidContext['limits']) => string | null;
}

/**
 * Registra una puja. Todo ocurre en una sola transacción:
 *  1. la subasta sigue abierta y el ciclo no ha vencido · 2. nadie ha pujado por encima entre la lectura y
 *  la escritura (comparación condicional con la puja esperada) · 3. el importe supera el mínimo ·
 *  4. el equipo tiene dinero DISPONIBLE suficiente (saldo − ya reservado) · 5. se retiene la diferencia y
 *  se libera al líder anterior · 6. se guarda la puja en el historial.
 */
export async function placeBid(
  userId: string,
  listingId: number,
  amount: number,
  ctx: { leagueId?: number | null; squadContext: (teamId: number, listing: AuctionListing) => Promise<BidContext> },
) {
  const s = await getSettings();
  if (!s.market_open) throw badRequest('El mercado está cerrado');
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('La puja no es válida');

  const listing = await prisma.marketListing.findUnique({
    where: { id: listingId },
    include: { cycle: true, player: { include: { club: true } }, coach: true },
  });
  if (!listing) throw notFound('Esa subasta no existe');
  // La subasta define la liga: se usa el equipo del usuario en ESA liga
  const team = await resolveTeam(userId, listing.leagueId);
  if (team.economyVersion !== 2 || team.leagueId !== listing.leagueId) throw badRequest('Tu equipo no juega la economía de esta liga');
  const member = await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: listing.leagueId, userId } } });
  if (!member) throw forbidden('No perteneces a esta liga');

  const now = new Date();
  if (now < listing.cycle.startsAt) throw badRequest('Este mercado todavía no ha abierto');
  if (now >= listing.cycle.endsAt) throw badRequest('El mercado ha cerrado: ya no se admiten pujas');
  if (listing.status !== 'AVAILABLE') throw badRequest('Esta subasta ya ha terminado');
  if (listing.assetType === 'PLAYER' && (!listing.player?.isActive || !listing.player.club.isActive)) throw badRequest('Este jugador no está disponible');
  if (listing.assetType === 'COACH' && !listing.coach?.isActive) throw badRequest('Este entrenador no está disponible');

  const name = listing.player?.displayName ?? listing.coach?.displayName ?? 'Jugador';
  const increment = s.market_min_increment;

  // El hueco en la plantilla se comprueba contando también las subastas que el equipo va ganando:
  // así nadie puede liderar más pujas de las que podría llegar a fichar.
  const context = await ctx.squadContext(team.id, listing);
  if (listing.assetType === 'PLAYER') {
    const p = listing.player!;
    const block = context.blockReason(context.squad, { position: p.position, clubId: p.clubId, clubName: p.club.name }, context.limits);
    if (block) throw badRequest(block);
  } else if (context.coachCount >= context.limits.maxCoaches) {
    throw badRequest(`Ya tienes ${context.limits.maxCoaches} entrenador${context.limits.maxCoaches === 1 ? '' : 'es'} (contando tus pujas ganadoras)`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // (1-2) Estado real de la subasta y comparación condicional con él
      const fresh = await tx.marketListing.findUniqueOrThrow({ where: { id: listing.id }, select: { status: true, topBid: true, topBidTeamId: true, listingPrice: true } });
      if (fresh.status !== 'AVAILABLE') throw badRequest('Esta subasta ya ha terminado');
      const minimum = minNextBid(fresh, increment);
      // (3) Importe mínimo
      if (amount < minimum) {
        throw badRequest(
          fresh.topBid === null
            ? `La puja mínima es ${formatK(minimum)} (precio de salida)`
            : `La puja actual es ${formatK(fresh.topBid)}: tienes que ofrecer al menos ${formatK(minimum)}`,
        );
      }
      const claimed = await tx.marketListing.updateMany({
        where: { id: listing.id, status: 'AVAILABLE', topBid: fresh.topBid, topBidTeamId: fresh.topBidTeamId },
        data: { topBid: amount, topBidTeamId: team.id, bidCount: { increment: 1 }, lastBidAt: now },
      });
      if (claimed.count === 0) throw conflict(OUTBID_MESSAGE);

      // (4-5) Dinero: solo se retiene la diferencia respecto a lo que este equipo ya tenía comprometido aquí
      const mine = await tx.budgetReservation.findUnique({ where: { teamId_listingId: { teamId: team.id, listingId: listing.id } } });
      const held = mine && mine.status === 'HELD' ? mine.amount : 0;
      const ok = await changeReserved(tx, team.id, amount - held);
      if (!ok) {
        const t = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: team.id }, select: { wallet: true, reserved: true } });
        throw badRequest(`Te faltan ${formatK(amount - held - (t.wallet - t.reserved))}: tienes ${formatK(t.wallet - t.reserved)} disponibles y ${formatK(t.reserved)} comprometidos en otras pujas`);
      }
      if (mine) await tx.budgetReservation.update({ where: { id: mine.id }, data: { amount, status: 'HELD', releasedAt: null } });
      else await tx.budgetReservation.create({ data: { teamId: team.id, listingId: listing.id, leagueId: listing.leagueId, amount, status: 'HELD' } });

      // El líder anterior recupera su dinero al instante
      let outbid: { teamId: number; amount: number } | null = null;
      if (fresh.topBidTeamId && fresh.topBidTeamId !== team.id) {
        const prev = await tx.budgetReservation.findUnique({ where: { teamId_listingId: { teamId: fresh.topBidTeamId, listingId: listing.id } } });
        if (prev && prev.status === 'HELD') {
          await changeReserved(tx, prev.teamId, -prev.amount);
          await tx.budgetReservation.update({ where: { id: prev.id }, data: { status: 'RELEASED', releasedAt: now } });
          outbid = { teamId: prev.teamId, amount: prev.amount };
        }
      }

      // (6) Historial: las pujas anteriores se marcan como superadas, nunca se borran
      const first = (await tx.marketBid.count({ where: { listingId: listing.id, teamId: team.id } })) === 0;
      await tx.marketBid.updateMany({ where: { listingId: listing.id, status: 'ACTIVE' }, data: { status: 'OUTBID' } });
      await tx.marketBid.create({ data: { listingId: listing.id, leagueId: listing.leagueId, teamId: team.id, userId, amount, status: 'ACTIVE' } });
      if (first) await tx.marketListing.update({ where: { id: listing.id }, data: { bidderCount: { increment: 1 } } });

      await audit(tx, { leagueId: listing.leagueId, cycleId: listing.cycleId, teamId: team.id, userId, action: 'BID', details: { listingId: listing.id, amount, previous: fresh.topBid } });
      const t = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: team.id }, select: { wallet: true, reserved: true } });
      return { wallet: t.wallet, reserved: t.reserved, available: t.wallet - t.reserved, outbid };
    });

    if (result.outbid) await notifyOutbid(result.outbid.teamId, { listingId: listing.id, name, amount, previous: result.outbid.amount });
    return { listingId: listing.id, name, amount, wallet: result.wallet, reserved: result.reserved, available: result.available, minNext: amount + increment };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Ya has pujado esa cantidad por este jugador');
    throw err;
  }
}

async function notifyOutbid(teamId: number, info: { listingId: number; name: string; amount: number; previous: number }) {
  const team = await prisma.fantasyTeam.findUnique({ where: { id: teamId }, select: { userId: true } });
  if (!team) return;
  await notify({
    userId: team.userId,
    type: 'MARKET',
    title: 'Tu puja ha sido superada',
    message: `${info.name}: la puja actual es ${formatK(info.amount)} y la tuya era ${formatK(info.previous)}. Tu dinero ya está libre.`,
    link: '/market',
  });
}

// ───────────────────────────── Liquidación ─────────────────────────────

export interface SettleHooks {
  /** Comprueba si el ganador puede incorporar el jugador; devuelve el motivo si no cabe. */
  assignBlock: (tx: Tx, teamId: number, listing: { assetType: string; playerId: number | null; coachId: number | null }) => Promise<string | null>;
}

/**
 * Liquida todas las subastas de un ciclo vencido. Cada subasta se cierra en su propia transacción
 * (un problema puntual no bloquea al resto) y es idempotente: el cambio de estado es condicional y el
 * cobro lleva clave de idempotencia, así que repetir la liquidación no cobra ni adjudica dos veces.
 */
export async function settleCycle(cycleId: number, hooks: SettleHooks, now = new Date()) {
  const cycle = await prisma.marketCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw notFound('Ese mercado no existe');
  if (now < cycle.endsAt) return { settled: 0, sold: 0, unsold: 0, alreadySettled: true as const };

  const listings = await prisma.marketListing.findMany({ where: { cycleId, status: 'AVAILABLE' }, orderBy: { slot: 'asc' } });
  let sold = 0;
  let unsold = 0;
  for (const listing of listings) {
    const result = await settleListing(listing.id, hooks, now);
    if (result === 'SOLD') sold++;
    else if (result === 'UNSOLD') unsold++;
  }
  await prisma.marketCycle.updateMany({ where: { id: cycleId, settledAt: null }, data: { settledAt: now } });
  if (sold || unsold) invalidatePlayerAggregates();
  return { settled: sold + unsold, sold, unsold, alreadySettled: false as const };
}

/** Cierra una subasta: adjudica al mejor postor, cobra su puja y libera el dinero de los demás. */
async function settleListing(listingId: number, hooks: SettleHooks, now: Date): Promise<'SOLD' | 'UNSOLD' | 'SKIPPED'> {
  try {
    return await prisma.$transaction(async (tx) => {
      const listing = await tx.marketListing.findUniqueOrThrow({ where: { id: listingId }, include: { player: { include: { club: true } }, coach: true } });
      if (listing.status !== 'AVAILABLE') return 'SKIPPED';
      const finalPrice = listing.topBid;
      const name = listing.player?.displayName ?? listing.coach?.displayName ?? 'Jugador';
      // El líder podría haber dejado la liga: en ese caso la subasta queda desierta
      const winnerTeamId = listing.topBidTeamId && (await tx.fantasyTeam.count({ where: { id: listing.topBidTeamId } })) > 0 ? listing.topBidTeamId : null;

      // Sin pujas: la subasta se cierra desierta y el jugador podrá volver a salir en otro mercado
      if (!winnerTeamId || finalPrice === null) {
        const closed = await tx.marketListing.updateMany({ where: { id: listing.id, status: 'AVAILABLE' }, data: { status: 'UNSOLD', settledAt: now } });
        if (closed.count === 0) return 'SKIPPED';
        await audit(tx, { leagueId: listing.leagueId, cycleId: listing.cycleId, action: 'AUCTION_UNSOLD', details: { listingId: listing.id, assetType: listing.assetType } });
        return 'UNSOLD';
      }

      // El ganador debe seguir teniendo hueco: si entretanto llenó su plantilla, no se le adjudica ni se le cobra
      const block = await hooks.assignBlock(tx, winnerTeamId, listing);
      const claimed = await tx.marketListing.updateMany({
        where: { id: listing.id, status: 'AVAILABLE' },
        data: block
          ? { status: 'UNSOLD', settledAt: now }
          : { status: 'SOLD', settledAt: now, soldAt: now, finalPrice, buyerTeamId: winnerTeamId },
      });
      if (claimed.count === 0) return 'SKIPPED';

      if (block) {
        await releaseAll(tx, listing.id, now);
        await tx.marketBid.updateMany({ where: { listingId: listing.id }, data: { status: 'LOST' } });
        await audit(tx, { leagueId: listing.leagueId, cycleId: listing.cycleId, teamId: winnerTeamId, action: 'AUCTION_VOID', details: { listingId: listing.id, reason: block, amount: finalPrice } });
        await notifyTeam(tx, winnerTeamId, {
          title: 'Subasta anulada',
          message: `Ganaste la puja por ${name} (${formatK(finalPrice)}) pero ya no cabía en tu plantilla: ${block.toLowerCase()}. No se te ha cobrado nada.`,
        });
        return 'UNSOLD';
      }

      // Cobro del dinero que ya estaba retenido por su puja ganadora
      await changeWallet(tx, {
        teamId: winnerTeamId,
        amount: -finalPrice,
        fromReserved: true,
        type: listing.assetType === 'PLAYER' ? 'PLAYER_PURCHASE' : 'COACH_PURCHASE',
        description: `Subasta ganada: ${name}${listing.player ? ` (${listing.player.club.shortName})` : ''}`,
        leagueId: listing.leagueId,
        reference: `listing:${listing.id}`,
        operationId: `auction:${listing.id}`,
      });
      await tx.budgetReservation.updateMany({ where: { listingId: listing.id, teamId: winnerTeamId }, data: { status: 'SPENT', releasedAt: now } });

      if (listing.assetType === 'PLAYER') {
        const p = listing.player!;
        await tx.leaguePlayerOwnership.create({ data: { leagueId: listing.leagueId, playerId: p.id, teamId: winnerTeamId, purchasePrice: finalPrice, source: 'MARKET' } });
        await tx.fantasyTeamPlayer.create({ data: { teamId: winnerTeamId, playerId: p.id, purchasePrice: p.price } });
      } else {
        await tx.leagueCoachOwnership.create({ data: { leagueId: listing.leagueId, coachId: listing.coachId!, teamId: winnerTeamId, purchasePrice: finalPrice } });
      }

      // Los demás recuperan su dinero (si alguno seguía reteniéndolo) y sus pujas quedan como perdidas
      await releaseAll(tx, listing.id, now, winnerTeamId);
      await tx.marketBid.updateMany({ where: { listingId: listing.id, NOT: { teamId: winnerTeamId } }, data: { status: 'LOST' } });
      await tx.marketBid.updateMany({ where: { listingId: listing.id, teamId: winnerTeamId, amount: finalPrice }, data: { status: 'WON' } });
      await tx.marketBid.updateMany({ where: { listingId: listing.id, teamId: winnerTeamId, amount: { not: finalPrice } }, data: { status: 'LOST' } });

      await audit(tx, {
        leagueId: listing.leagueId,
        cycleId: listing.cycleId,
        teamId: winnerTeamId,
        action: 'AUCTION_WON',
        details: { listingId: listing.id, assetType: listing.assetType, assetId: listing.playerId ?? listing.coachId, finalPrice, startingPrice: listing.listingPrice, bids: listing.bidCount, bidders: listing.bidderCount },
      });

      await notifyTeam(tx, winnerTeamId, { title: '¡Has ganado la subasta!', message: `${name} es tuyo por ${formatK(finalPrice)}.` });
      const losers = await tx.marketBid.findMany({ where: { listingId: listing.id, NOT: { teamId: winnerTeamId } }, distinct: ['teamId'], select: { teamId: true, team: { select: { userId: true } } } });
      const winnerName = (await tx.fantasyTeam.findUniqueOrThrow({ where: { id: winnerTeamId }, select: { name: true } })).name;
      await notifyMany(
        losers.map((l) => ({
          userId: l.team.userId,
          type: 'MARKET' as const,
          title: 'Subasta perdida',
          message: `${winnerName} se ha llevado a ${name} por ${formatK(finalPrice)}. Tu dinero reservado está libre.`,
          link: '/market',
        })),
        tx,
      );
      return 'SOLD';
    });
  } catch (err) {
    // Una subasta problemática no debe impedir el cierre de las demás: queda registrada y se reintenta
    await audit(prisma, { action: 'AUCTION_SETTLE_FAILED', details: { listingId, reason: (err as Error).message } });
    return 'SKIPPED';
  }
}

/** Devuelve el dinero retenido por las pujas perdedoras de una subasta. */
async function releaseAll(tx: Tx, listingId: number, now: Date, exceptTeamId?: number) {
  const held = await tx.budgetReservation.findMany({ where: { listingId, status: 'HELD', NOT: exceptTeamId ? { teamId: exceptTeamId } : undefined } });
  for (const r of held) {
    await changeReserved(tx, r.teamId, -r.amount);
    await tx.budgetReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: now } });
  }
}

async function notifyTeam(tx: Tx, teamId: number, input: { title: string; message: string }) {
  const team = await tx.fantasyTeam.findUnique({ where: { id: teamId }, select: { userId: true } });
  if (team) await notify({ userId: team.userId, type: 'MARKET', title: input.title, message: input.message, link: '/market' }, tx);
}

/**
 * Saca a un equipo de todas las subastas vivas de su liga (abandona la liga o se reinicia la economía).
 * Sus pujas quedan en el historial como canceladas y las subastas que lideraba vuelven a su precio de
 * salida, de modo que el resto de mánagers puede volver a pujar sin que el dinero de nadie quede retenido.
 */
export async function withdrawTeamFromAuctions(tx: Tx, teamId: number, now = new Date()) {
  const held = await tx.budgetReservation.findMany({ where: { teamId, status: 'HELD' } });
  for (const r of held) {
    await changeReserved(tx, teamId, -r.amount);
    await tx.budgetReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: now } });
  }
  const led = await tx.marketListing.findMany({ where: { topBidTeamId: teamId, status: 'AVAILABLE' }, select: { id: true } });
  if (led.length) {
    await tx.marketListing.updateMany({ where: { id: { in: led.map((l) => l.id) } }, data: { topBid: null, topBidTeamId: null } });
  }
  await tx.marketBid.updateMany({ where: { teamId, status: { in: ['ACTIVE', 'OUTBID'] } }, data: { status: 'CANCELLED' } });
  return { released: held.length, auctions: led.length };
}

/** Subastas que un equipo va ganando ahora mismo (reservan dinero y ocupan hueco en su plantilla). */
export async function leadingBids(teamId: number, cycleId?: number) {
  return prisma.marketListing.findMany({
    where: { topBidTeamId: teamId, status: 'AVAILABLE', cycleId },
    select: { id: true, assetType: true, topBid: true, player: { select: { position: true, clubId: true } } },
  });
}

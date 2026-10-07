import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import { formatK } from '../domain/economy';

/**
 * Libro de movimientos de la economía de liga. Toda modificación del monedero pasa por aquí:
 * el cambio de saldo y su registro (saldo anterior/posterior, motivo, referencia) van en la misma transacción.
 */
export type EconomyTxType =
  | 'INITIAL_BUDGET'
  | 'PLAYER_PURCHASE'
  | 'PLAYER_SALE'
  | 'COACH_PURCHASE'
  | 'COACH_SALE'
  | 'DAILY_CHALLENGE_REWARD'
  | 'STREAK_REWARD'
  | 'CARD_REWARD'
  | 'ADMIN_ADJUSTMENT'
  | 'ECONOMY_RESET'
  | 'OTHER_REWARD';

export interface WalletChange {
  teamId: number;
  /** k£ con signo */
  amount: number;
  /** El cargo sale de dinero ya reservado en una subasta: se descuenta a la vez de `reserved`. */
  fromReserved?: boolean;
  type: EconomyTxType;
  description: string;
  userId?: string | null;
  leagueId?: number | null;
  reference?: string | null;
  /** Clave de idempotencia: si ya existe un movimiento con ella, la operación falla (P2002) sin tocar el saldo. */
  operationId?: string | null;
  /** Permite dejar el saldo en negativo (solo ajustes de administración). */
  allowNegative?: boolean;
}

/** Reserva la clave de idempotencia: si ya existe, lanza P2002 y la transacción completa se deshace. */
export async function claimOperation(tx: Tx, operationId: string | null | undefined) {
  if (operationId) await tx.economyOperationKey.create({ data: { key: operationId } });
}

/**
 * Cargo condicional contra el dinero DISPONIBLE (saldo − reservado en subastas). La comparación la hace
 * la base de datos en la misma sentencia, así que dos cargos simultáneos nunca pueden sobregirar la cuenta.
 * Devuelve false si no había disponible suficiente.
 */
async function debitAvailable(tx: Tx, teamId: number, amount: number) {
  const n = await tx.$executeRaw`UPDATE fantasy_teams SET wallet = wallet - ${amount} WHERE id = ${teamId} AND wallet - reserved >= ${amount}`;
  return n > 0;
}

/** Cargo de dinero ya retenido por una puja ganadora: baja saldo y reserva a la vez. */
async function debitReserved(tx: Tx, teamId: number, amount: number) {
  const n = await tx.$executeRaw`UPDATE fantasy_teams SET wallet = wallet - ${amount}, reserved = reserved - ${amount} WHERE id = ${teamId} AND wallet >= ${amount} AND reserved >= ${amount}`;
  return n > 0;
}

/**
 * Retiene dinero para una puja (delta positivo) o libera lo retenido (delta negativo), siempre contra el
 * disponible real. Devuelve false si el equipo no tiene bastante dinero libre.
 */
export async function changeReserved(tx: Tx, teamId: number, delta: number) {
  if (delta === 0) return true;
  const n =
    delta > 0
      ? await tx.$executeRaw`UPDATE fantasy_teams SET reserved = reserved + ${delta} WHERE id = ${teamId} AND wallet - reserved >= ${delta}`
      : await tx.$executeRaw`UPDATE fantasy_teams SET reserved = reserved - ${-delta} WHERE id = ${teamId} AND reserved >= ${-delta}`;
  return n > 0;
}

/** Aplica un cambio al monedero (k£) de forma atómica. Debe llamarse dentro de una transacción. */
export async function changeWallet(tx: Tx, change: WalletChange) {
  await claimOperation(tx, change.operationId);
  if (change.amount < 0 && !change.allowNegative) {
    const ok = change.fromReserved ? await debitReserved(tx, change.teamId, -change.amount) : await debitAvailable(tx, change.teamId, -change.amount);
    if (!ok) {
      const team = await tx.fantasyTeam.findUnique({ where: { id: change.teamId }, select: { wallet: true, reserved: true } });
      const available = (team?.wallet ?? 0) - (team?.reserved ?? 0);
      const held = team?.reserved ? ` (tienes ${formatK(team.reserved)} comprometidos en pujas)` : '';
      throw badRequest(`Presupuesto insuficiente: necesitas ${formatK(-change.amount)} y tienes ${formatK(available)} disponibles${held}`);
    }
  } else {
    await tx.fantasyTeam.update({ where: { id: change.teamId }, data: { wallet: { increment: change.amount } } });
  }
  const team = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: change.teamId }, select: { wallet: true, userId: true } });
  // `debitAvailable` escribe con SQL directo, así que el saldo posterior se lee de la fila ya actualizada
  await tx.transaction.create({
    data: {
      teamId: change.teamId,
      type: change.type,
      amount: change.amount,
      balanceBefore: team.wallet - change.amount,
      balanceAfter: team.wallet,
      currency: 'K',
      description: change.description,
      userId: change.userId ?? team.userId,
      leagueId: change.leagueId ?? null,
      reference: change.reference ?? null,
      operationId: change.operationId ?? null,
    },
  });
  return team.wallet;
}

/**
 * Premio para equipos que aún juegan el sistema clásico (presupuesto en décimas de millón):
 * se abona redondeado a la baja a £0.1M. Devuelve el importe abonado en décimas.
 */
export async function creditClassicBudget(tx: Tx, input: { teamId: number; amountK: number; type: EconomyTxType; description: string; reference?: string; operationId?: string }) {
  const tenths = Math.floor(input.amountK / 100);
  if (tenths <= 0) return 0;
  await claimOperation(tx, input.operationId);
  const team = await tx.fantasyTeam.update({ where: { id: input.teamId }, data: { budget: { increment: tenths } }, select: { budget: true, userId: true } });
  await tx.transaction.create({
    data: {
      teamId: input.teamId,
      type: input.type,
      amount: tenths,
      balanceBefore: team.budget - tenths,
      balanceAfter: team.budget,
      currency: 'TENTHS',
      description: input.description,
      userId: team.userId,
      reference: input.reference ?? null,
      operationId: input.operationId ?? null,
    },
  });
  return tenths;
}

export async function audit(
  db: Tx,
  entry: { leagueId?: number | null; cycleId?: number | null; teamId?: number | null; userId?: string | null; action: string; details?: object },
) {
  await db.marketAuditLog.create({
    data: {
      leagueId: entry.leagueId ?? null,
      cycleId: entry.cycleId ?? null,
      teamId: entry.teamId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      details: JSON.stringify(entry.details ?? {}),
    },
  });
}

export const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Historial económico de un equipo (ambas monedas, más reciente primero). */
export async function listTransactions(teamId: number, opts: { take?: number; cursor?: number } = {}) {
  const take = Math.min(100, opts.take ?? 50);
  const rows = await prisma.transaction.findMany({
    where: { teamId, id: opts.cursor ? { lt: opts.cursor } : undefined },
    orderBy: { id: 'desc' },
    take: take + 1,
  });
  return { items: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id : null };
}

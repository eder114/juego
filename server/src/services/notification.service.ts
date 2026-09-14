import { prisma, type Tx } from '../lib/prisma';

export type NotificationType =
  | 'GAMEWEEK_REMINDER'
  | 'INJURY'
  | 'LINEUP_INCOMPLETE'
  | 'PRICE_CHANGE'
  | 'CAPTAIN_UNAVAILABLE'
  | 'MARKET'
  | 'GAMEWEEK_RESULT'
  | 'LEAGUE'
  | 'ACHIEVEMENT'
  | 'SYSTEM';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

export async function notify(input: NotificationInput, db: Tx = prisma) {
  return db.notification.create({ data: input });
}

export async function notifyMany(inputs: NotificationInput[], db: Tx = prisma) {
  if (inputs.length === 0) return;
  // SQLite limita variables por consulta: se insertan en bloques
  for (let i = 0; i < inputs.length; i += 500) {
    await db.notification.createMany({ data: inputs.slice(i, i + 500) });
  }
}

/** Notifica a los mánagers que tienen a un jugador en plantilla. */
export async function notifyOwners(playerId: number, build: (userId: string) => Omit<NotificationInput, 'userId'>) {
  const owners = await prisma.fantasyTeamPlayer.findMany({
    where: { playerId },
    select: { team: { select: { userId: true } } },
  });
  await notifyMany(owners.map((o) => ({ userId: o.team.userId, ...build(o.team.userId) })));
}

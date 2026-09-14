import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

export const isPostgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '');

/** Búsqueda de texto sin distinguir mayúsculas (SQLite ya lo hace; PostgreSQL necesita mode). */
export function icontains(value: string) {
  return (isPostgres ? { contains: value, mode: 'insensitive' } : { contains: value }) as { contains: string };
}

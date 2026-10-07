import { prisma, type Tx } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { parseCrest } from '../lib/dto';

/**
 * Identidad del equipo: USUARIO + LIGA.
 * Un mánager tiene un equipo independiente en cada liga (plantilla, presupuesto, alineación, cartas
 * e historial propios) y como máximo uno por liga (restricción única userId + leagueId).
 * Los equipos del sistema clásico pertenecen a la liga global.
 */

export async function getGlobalLeagueId() {
  const global = await prisma.league.findFirst({ where: { type: 'GLOBAL', isSystem: true }, select: { id: true } });
  if (!global) throw badRequest('Todavía no existe la liga global del sistema');
  return global.id;
}

const TEAM_SUMMARY = {
  id: true,
  name: true,
  crest: true,
  leagueId: true,
  budget: true,
  wallet: true,
  reserved: true,
  totalPoints: true,
  economyVersion: true,
  initialSquad: true,
  initialRevealedAt: true,
  createdAt: true,
  league: { select: { id: true, name: true, type: true, economyVersion: true } },
} as const;

type TeamRow = Awaited<ReturnType<typeof prisma.fantasyTeam.findMany<{ select: typeof TEAM_SUMMARY }>>>[number];

function toTeamSummary({ initialSquad, initialRevealedAt, crest, ...rest }: TeamRow) {
  return {
    ...rest,
    crest: parseCrest(crest),
    // La presentación del equipo inicial es propia de cada liga
    initialRevealPending: !!initialSquad && !initialRevealedAt,
  };
}

/** Todos los equipos del usuario, uno por liga (el de la liga global primero). */
export async function listMyTeams(userId: string) {
  const teams = await prisma.fantasyTeam.findMany({
    where: { userId },
    select: TEAM_SUMMARY,
    orderBy: { createdAt: 'asc' },
  });
  return teams
    .map(toTeamSummary)
    .sort((a, b) => Number((b.league?.type ?? '') === 'GLOBAL') - Number((a.league?.type ?? '') === 'GLOBAL'));
}

/** Equipo por defecto cuando la petición no indica liga: el de la liga global y, si no, el más antiguo. */
export async function primaryTeam(userId: string) {
  const teams = await prisma.fantasyTeam.findMany({ where: { userId }, include: { league: true }, orderBy: { createdAt: 'asc' } });
  return teams.find((t) => t.league?.type === 'GLOBAL') ?? teams[0] ?? null;
}

/**
 * Equipo del usuario en la liga indicada. Sin liga se usa el equipo por defecto, de modo que las
 * pantallas que aún no envían el contexto de liga siguen funcionando.
 */
export async function resolveTeam(userId: string, leagueId?: number | null) {
  if (leagueId) {
    const team = await prisma.fantasyTeam.findFirst({ where: { userId, leagueId }, include: { league: true } });
    if (!team) throw notFound('Todavía no tienes equipo en esta liga');
    return team;
  }
  const team = await primaryTeam(userId);
  if (!team) throw notFound('Aún no has creado tu equipo Fantasy');
  return team;
}

export type ResolvedTeam = Awaited<ReturnType<typeof resolveTeam>>;

/** Como `resolveTeam`, pero devuelve null en lugar de lanzar error (para pantallas que funcionan sin equipo). */
export async function findTeam(userId: string, leagueId?: number | null) {
  if (leagueId) return prisma.fantasyTeam.findFirst({ where: { userId, leagueId }, include: { league: true } });
  return primaryTeam(userId);
}

/** Crea el equipo del usuario en una liga (la plantilla y el presupuesto los asigna quien corresponda). */
export async function createTeamForLeague(
  tx: Tx,
  input: { userId: string; leagueId: number; name: string; crest?: string; economyVersion: number; budget?: number },
) {
  return tx.fantasyTeam.create({
    data: {
      userId: input.userId,
      leagueId: input.leagueId,
      name: input.name,
      crest: input.crest ?? '{}',
      economyVersion: input.economyVersion,
      budget: input.budget ?? 0,
    },
  });
}

/** Nombre y escudo con los que se crea el equipo de una liga nueva: los del equipo que ya tenga el usuario. */
export async function teamIdentity(userId: string) {
  const team = await primaryTeam(userId);
  if (team) return { name: team.name, crest: team.crest };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { managerName: true } });
  return { name: user?.managerName ?? 'Mi equipo', crest: '{}' };
}

/**
 * Migración: los equipos creados antes de que existieran los equipos por liga se asignan a su liga
 * (la de su economía si jugaban una, o la liga global) y se garantiza que el usuario sea miembro.
 */
export async function ensureTeamLeagues() {
  const pending = await prisma.fantasyTeam.findMany({ where: { leagueId: null }, select: { id: true, userId: true, economyLeagueId: true } });
  if (!pending.length) return { migrated: 0 };
  const globalId = await getGlobalLeagueId();
  for (const team of pending) {
    const leagueId = team.economyLeagueId ?? globalId;
    await prisma.$transaction(async (tx) => {
      await tx.leagueMember.upsert({
        where: { leagueId_userId: { leagueId, userId: team.userId } },
        create: { leagueId, userId: team.userId },
        update: {},
      });
      await tx.fantasyTeam.update({ where: { id: team.id }, data: { leagueId } });
    });
  }
  console.log(`✔ ${pending.length} equipo(s) asignados a su liga`);
  return { migrated: pending.length };
}

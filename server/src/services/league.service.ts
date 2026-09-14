import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { icontains, prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { userPublicSelect } from '../lib/dto';
import type { LeagueType } from '../domain/constants';
import { computeStandings } from './ranking.service';
import { notify } from './notification.service';
import { evaluateLeagueAchievements } from './achievement.service';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (!(await prisma.league.findUnique({ where: { code } }))) return code;
  }
  throw new Error('No se pudo generar un código de liga único');
}

export const LEAGUE_TYPE_INFO: Record<LeagueType, { label: string; description: string }> = {
  GLOBAL: { label: 'Liga global', description: 'Todos los mánagers compiten automáticamente' },
  PUBLIC: { label: 'Liga pública', description: 'Cualquiera puede unirse desde el buscador' },
  PRIVATE: { label: 'Liga privada', description: 'Acceso con código (y contraseña opcional)' },
  FRIENDS: { label: 'Liga entre amigos', description: 'Código compartido; cualquier miembro puede invitar' },
  INVITE: { label: 'Liga por invitación', description: 'Solo pueden entrar mánagers invitados por el administrador' },
};

async function requireTeam(userId: string) {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId } });
  if (!team) throw badRequest('Crea tu equipo Fantasy antes de unirte a ligas');
  return team;
}

async function getMembership(leagueId: number, userId: string) {
  return prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } } });
}

async function requireLeagueAdmin(leagueId: number, userId: string, isSiteAdmin = false) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  if (isSiteAdmin) return league;
  const m = await getMembership(leagueId, userId);
  if (!m || m.role !== 'ADMIN') throw forbidden('Solo el administrador de la liga puede hacer esto');
  return league;
}

function serializeLeague(l: { id: number; name: string; description: string | null; type: string; maxMembers: number; startGameweek: number; createdAt: Date; passwordHash: string | null; isSystem: boolean; owner?: { id: string; managerName: string; avatarUrl: string | null } | null }, memberCount: number) {
  return {
    id: l.id,
    name: l.name,
    description: l.description,
    type: l.type,
    typeLabel: LEAGUE_TYPE_INFO[l.type as LeagueType]?.label ?? l.type,
    maxMembers: l.maxMembers,
    startGameweek: l.startGameweek,
    createdAt: l.createdAt,
    hasPassword: !!l.passwordHash,
    isSystem: l.isSystem,
    owner: l.owner ?? null,
    memberCount,
  };
}

export async function listMyLeagues(userId: string) {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    include: { league: { include: { owner: { select: userPublicSelect }, _count: { select: { members: true } } } } },
    orderBy: { joinedAt: 'asc' },
  });
  const result = [];
  for (const m of memberships) {
    const members = await prisma.leagueMember.findMany({ where: { leagueId: m.leagueId }, select: { userId: true } });
    const { rows } = await computeStandings({
      userIds: m.league.type === 'GLOBAL' ? undefined : members.map((x) => x.userId),
      fromGameweek: m.league.startGameweek,
    });
    const mine = rows.find((r) => r.userId === userId);
    result.push({
      ...serializeLeague(m.league, m.league._count.members),
      code: m.league.code,
      role: m.role,
      myRank: mine?.rank ?? null,
      myPoints: mine?.points ?? 0,
      movement: mine?.movement ?? 'same',
      leader: rows[0] ? { managerName: rows[0].managerName, teamName: rows[0].teamName, points: rows[0].points } : null,
    });
  }
  return result;
}

export async function listPublicLeagues(userId: string, search?: string) {
  const leagues = await prisma.league.findMany({
    where: {
      type: 'PUBLIC',
      name: search ? icontains(search) : undefined,
      members: { none: { userId } },
    },
    include: { owner: { select: userPublicSelect }, _count: { select: { members: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return leagues.map((l) => serializeLeague(l, l._count.members));
}

export interface CreateLeagueInput {
  name: string;
  description?: string | null;
  type: Exclude<LeagueType, 'GLOBAL'>;
  password?: string | null;
  maxMembers: number;
  startGameweek?: number;
}

export async function createLeague(userId: string, input: CreateLeagueInput) {
  await requireTeam(userId);
  const owned = await prisma.league.count({ where: { ownerId: userId } });
  if (owned >= 20) throw badRequest('Has alcanzado el máximo de 20 ligas creadas');
  const league = await prisma.league.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      maxMembers: input.maxMembers,
      startGameweek: input.startGameweek ?? 1,
      code: await generateCode(),
      passwordHash: input.password && input.type !== 'PUBLIC' ? await bcrypt.hash(input.password, 10) : null,
      ownerId: userId,
      members: { create: { userId, role: 'ADMIN' } },
    },
  });
  await evaluateLeagueAchievements(userId);
  return league;
}

async function addMember(leagueId: number, userId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { _count: { select: { members: true } } } });
  if (!league) throw notFound('Liga no encontrada');
  if (await getMembership(leagueId, userId)) throw conflict('Ya perteneces a esta liga');
  if (league._count.members >= league.maxMembers) throw badRequest('La liga está completa');
  await prisma.leagueMember.create({ data: { leagueId, userId } });
  await prisma.leagueInvite.updateMany({ where: { leagueId, receiverId: userId, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { managerName: true } });
  if (league.ownerId && league.ownerId !== userId) {
    await notify({
      userId: league.ownerId,
      type: 'LEAGUE',
      title: `Nuevo mánager en ${league.name}`,
      message: `${user?.managerName ?? 'Un mánager'} se ha unido a tu liga`,
      link: `/leagues/${leagueId}`,
    });
  }
  await evaluateLeagueAchievements(userId);
  return league;
}

export async function joinByCode(userId: string, code: string, password?: string | null) {
  await requireTeam(userId);
  const league = await prisma.league.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!league || league.type === 'GLOBAL') throw notFound('No existe ninguna liga con ese código');
  if (league.type === 'INVITE') {
    const invite = await prisma.leagueInvite.findUnique({ where: { leagueId_receiverId: { leagueId: league.id, receiverId: userId } } });
    if (!invite || invite.status !== 'PENDING') throw forbidden('Esta liga es solo por invitación');
  }
  if (league.passwordHash) {
    if (!password) throw badRequest('Esta liga requiere contraseña', { requiresPassword: true });
    if (!(await bcrypt.compare(password, league.passwordHash))) throw forbidden('Contraseña de liga incorrecta');
  }
  return addMember(league.id, userId);
}

export async function joinPublic(userId: string, leagueId: number) {
  await requireTeam(userId);
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league || league.type !== 'PUBLIC') throw notFound('Liga pública no encontrada');
  return addMember(leagueId, userId);
}

export async function leaveLeague(userId: string, leagueId: number) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  if (league.type === 'GLOBAL') throw badRequest('No puedes abandonar la liga global');
  const membership = await getMembership(leagueId, userId);
  if (!membership) throw notFound('No perteneces a esta liga');

  await prisma.$transaction(async (tx) => {
    await tx.leagueMember.delete({ where: { id: membership.id } });
    const remaining = await tx.leagueMember.findMany({ where: { leagueId }, orderBy: { joinedAt: 'asc' } });
    if (remaining.length === 0) {
      await tx.league.delete({ where: { id: leagueId } });
      return;
    }
    if (membership.role === 'ADMIN' && !remaining.some((m) => m.role === 'ADMIN')) {
      await tx.leagueMember.update({ where: { id: remaining[0].id }, data: { role: 'ADMIN' } });
      await tx.league.update({ where: { id: leagueId }, data: { ownerId: remaining[0].userId } });
    }
  });
  return { left: true };
}

export async function getLeagueDetail(userId: string, leagueId: number, isSiteAdmin = false) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { owner: { select: userPublicSelect }, members: { select: { userId: true, role: true, joinedAt: true } } },
  });
  if (!league) throw notFound('Liga no encontrada');
  const membership = league.members.find((m) => m.userId === userId);
  if (!membership && !isSiteAdmin && !['PUBLIC', 'GLOBAL'].includes(league.type)) throw forbidden('Esta liga es privada');

  const isGlobal = league.type === 'GLOBAL';
  const userIds = isGlobal ? undefined : league.members.map((m) => m.userId);
  const { rows, lastGameweekId } = await computeStandings({ userIds, fromGameweek: league.startGameweek });
  const standings = (isGlobal ? rows.slice(0, 100) : rows).map((r) => ({
    ...r,
    role: league.members.find((m) => m.userId === r.userId)?.role ?? 'MEMBER',
    isMe: r.userId === userId,
  }));
  if (isGlobal) {
    const mine = rows.find((r) => r.userId === userId);
    if (mine && !standings.some((s) => s.userId === userId)) standings.push({ ...mine, role: 'MEMBER', isMe: true });
  }

  // Historial por jornada (puntos de cada participante)
  const teamIds = standings.map((s) => s.teamId);
  const lineups = await prisma.lineup.findMany({
    where: { teamId: { in: teamIds }, gameweekId: { gte: league.startGameweek }, gameweek: { status: { not: 'UPCOMING' } } },
    select: { teamId: true, gameweekId: true, points: true },
    orderBy: { gameweekId: 'asc' },
  });
  const gameweekIds = [...new Set(lineups.map((l) => l.gameweekId))].sort((a, b) => a - b);
  const history = gameweekIds.map((gw) => {
    const entry: Record<string, number> = { gameweek: gw };
    for (const l of lineups.filter((x) => x.gameweekId === gw)) entry[String(l.teamId)] = l.points;
    return entry;
  });

  const invites =
    membership?.role === 'ADMIN'
      ? await prisma.leagueInvite.findMany({
          where: { leagueId, status: 'PENDING' },
          include: { receiver: { select: userPublicSelect } },
        })
      : [];

  return {
    ...serializeLeague(league, league.members.length),
    code: membership || isSiteAdmin ? league.code : null,
    myRole: membership?.role ?? null,
    isMember: !!membership,
    standings,
    totalParticipants: rows.length,
    lastGameweekId,
    history,
    invites,
    canInvite: !!membership && !isGlobal && (league.type !== 'INVITE' || membership.role === 'ADMIN'),
  };
}

export async function updateLeague(userId: string, leagueId: number, patch: { name?: string; description?: string | null; maxMembers?: number; password?: string | null }, isSiteAdmin = false) {
  const league = await requireLeagueAdmin(leagueId, userId, isSiteAdmin);
  if (league.type === 'GLOBAL' && !isSiteAdmin) throw forbidden();
  if (patch.maxMembers !== undefined) {
    const count = await prisma.leagueMember.count({ where: { leagueId } });
    if (patch.maxMembers < count) throw badRequest(`La liga ya tiene ${count} miembros`);
  }
  return prisma.league.update({
    where: { id: leagueId },
    data: {
      name: patch.name,
      description: patch.description,
      maxMembers: patch.maxMembers,
      passwordHash: patch.password === undefined ? undefined : patch.password ? await bcrypt.hash(patch.password, 10) : null,
    },
  });
}

export async function deleteLeague(userId: string, leagueId: number, isSiteAdmin = false) {
  const league = await requireLeagueAdmin(leagueId, userId, isSiteAdmin);
  if (league.isSystem) throw badRequest('La liga global del sistema no se puede eliminar');
  await prisma.league.delete({ where: { id: leagueId } });
  return { deleted: true };
}

export async function removeMember(userId: string, leagueId: number, memberUserId: string, isSiteAdmin = false) {
  const league = await requireLeagueAdmin(leagueId, userId, isSiteAdmin);
  if (league.type === 'GLOBAL') throw badRequest('No se pueden expulsar mánagers de la liga global');
  if (memberUserId === userId) throw badRequest('Para salir de la liga usa "Abandonar liga"');
  const m = await getMembership(leagueId, memberUserId);
  if (!m) throw notFound('Ese mánager no pertenece a la liga');
  await prisma.leagueMember.delete({ where: { id: m.id } });
  await notify({ userId: memberUserId, type: 'LEAGUE', title: `Has sido retirado de ${league.name}`, message: 'El administrador de la liga te ha retirado.' });
  return { removed: true };
}

export async function inviteToLeague(userId: string, leagueId: number, identifier: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  const membership = await getMembership(leagueId, userId);
  if (!membership) throw forbidden('Debes ser miembro para invitar');
  if (league.type === 'GLOBAL') throw badRequest('La liga global no admite invitaciones');
  if (league.type === 'INVITE' && membership.role !== 'ADMIN') throw forbidden('Solo el administrador puede invitar en esta liga');

  const target = await prisma.user.findFirst({
    where: { OR: [{ email: identifier.trim().toLowerCase() }, { managerName: identifier.trim() }], isActive: true },
  });
  if (!target) throw notFound('No existe ningún mánager con ese email o nombre');
  if (target.id === userId) throw badRequest('No puedes invitarte a ti mismo');
  if (await getMembership(leagueId, target.id)) throw conflict('Ese mánager ya está en la liga');

  const invite = await prisma.leagueInvite.upsert({
    where: { leagueId_receiverId: { leagueId, receiverId: target.id } },
    create: { leagueId, senderId: userId, receiverId: target.id },
    update: { status: 'PENDING', senderId: userId },
  });
  const sender = await prisma.user.findUnique({ where: { id: userId }, select: { managerName: true } });
  await notify({
    userId: target.id,
    type: 'LEAGUE',
    title: `Invitación a ${league.name}`,
    message: `${sender?.managerName} te invita a su liga. Código: ${league.code}`,
    link: '/leagues?tab=invites',
  });
  return { invited: true, inviteId: invite.id, managerName: target.managerName };
}

export async function listMyInvites(userId: string) {
  return prisma.leagueInvite.findMany({
    where: { receiverId: userId, status: 'PENDING' },
    include: {
      league: { select: { id: true, name: true, type: true, _count: { select: { members: true } }, maxMembers: true } },
      sender: { select: userPublicSelect },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function respondInvite(userId: string, inviteId: number, accept: boolean) {
  const invite = await prisma.leagueInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.receiverId !== userId || invite.status !== 'PENDING') throw notFound('Invitación no encontrada');
  if (!accept) {
    await prisma.leagueInvite.update({ where: { id: inviteId }, data: { status: 'DECLINED' } });
    return { accepted: false };
  }
  await requireTeam(userId);
  await addMember(invite.leagueId, userId);
  return { accepted: true, leagueId: invite.leagueId };
}

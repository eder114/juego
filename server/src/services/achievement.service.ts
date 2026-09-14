import { prisma } from '../lib/prisma';
import { notify } from './notification.service';

export const ACHIEVEMENTS = {
  FIRST_SIGNING: { title: 'Primer fichaje', description: 'Ficha a tu primer jugador', icon: 'shopping-cart' },
  FULL_SQUAD: { title: 'Plantilla completa', description: 'Completa una plantilla de 15 jugadores', icon: 'users' },
  LEAGUE_FOUNDER: { title: 'Fundador', description: 'Crea tu propia liga', icon: 'flag' },
  SOCIAL: { title: 'Sociable', description: 'Participa en 3 ligas o más', icon: 'handshake' },
  TRADER: { title: 'Director deportivo', description: 'Realiza 20 operaciones de mercado', icon: 'repeat' },
  FIFTY_GAMEWEEK: { title: 'Jornada de 50', description: 'Consigue 50 puntos o más en una jornada', icon: 'flame' },
  EIGHTY_GAMEWEEK: { title: 'Jornada histórica', description: 'Consigue 80 puntos o más en una jornada', icon: 'zap' },
  CENTURY: { title: 'Centenario', description: 'Alcanza 100 puntos totales', icon: 'trophy' },
  CAPTAIN_HAUL: { title: 'Capitán de oro', description: 'Tu capitán suma 20 puntos o más', icon: 'crown' },
  LEAGUE_LEADER: { title: 'Líder de liga', description: 'Termina una jornada primero en una liga con 3+ mánagers', icon: 'medal' },
} as const;

export type AchievementCode = keyof typeof ACHIEVEMENTS;

export async function unlock(userId: string, code: AchievementCode) {
  const existing = await prisma.userAchievement.findUnique({ where: { userId_code: { userId, code } } });
  if (existing) return false;
  await prisma.userAchievement.create({ data: { userId, code } });
  const a = ACHIEVEMENTS[code];
  await notify({ userId, type: 'ACHIEVEMENT', title: `🏅 Logro desbloqueado: ${a.title}`, message: a.description, link: '/profile' });
  return true;
}

export async function evaluateMarketAchievements(userId: string, teamId: number) {
  const [buys, squadSize, ops] = await Promise.all([
    prisma.transfer.count({ where: { teamId, type: 'BUY' } }),
    prisma.fantasyTeamPlayer.count({ where: { teamId } }),
    prisma.transfer.count({ where: { teamId } }),
  ]);
  if (buys >= 1) await unlock(userId, 'FIRST_SIGNING');
  if (squadSize >= 15) await unlock(userId, 'FULL_SQUAD');
  if (ops >= 20) await unlock(userId, 'TRADER');
}

export async function evaluateLeagueAchievements(userId: string) {
  const [owned, memberships] = await Promise.all([
    prisma.league.count({ where: { ownerId: userId, isSystem: false } }),
    prisma.leagueMember.count({ where: { userId } }),
  ]);
  if (owned >= 1) await unlock(userId, 'LEAGUE_FOUNDER');
  if (memberships >= 3) await unlock(userId, 'SOCIAL');
}

export async function evaluateGameweekAchievements(gameweekId: number, captainMultiplier: number) {
  const lineups = await prisma.lineup.findMany({
    where: { gameweekId },
    select: {
      points: true,
      team: { select: { userId: true, totalPoints: true } },
      players: { where: { multiplier: { gt: 1 } }, select: { points: true, multiplier: true } },
    },
  });
  for (const l of lineups) {
    const userId = l.team.userId;
    if (l.points >= 50) await unlock(userId, 'FIFTY_GAMEWEEK');
    if (l.points >= 80) await unlock(userId, 'EIGHTY_GAMEWEEK');
    if (l.team.totalPoints >= 100) await unlock(userId, 'CENTURY');
    if (l.players.some((p) => p.points * Math.max(p.multiplier, captainMultiplier) >= 20)) await unlock(userId, 'CAPTAIN_HAUL');
  }
}

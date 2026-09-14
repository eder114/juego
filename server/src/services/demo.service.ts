/**
 * Datos de demostración (opcionales): mánagers de prueba con plantillas válidas fichadas en el mercado,
 * alineaciones de las jornadas ya disputadas (puntuadas con estadísticas reales) y ligas de ejemplo.
 * Los jugadores, clubes y resultados siguen siendo reales; solo los usuarios son ficticios.
 */
import { prisma } from '../lib/prisma';
import { hashPassword } from './auth.service';
import { buyPlayer, createTeam } from './squad.service';
import { persistLineup } from './lineup.service';
import { processGameweek } from './scoring.service';
import { getPlayerAggregates } from './player-stats.service';
import { syncGameweekStatuses } from './gameweek.service';
import { normalizeLineup, pickBestLineup } from '../domain/lineup';
import { BLOCKING_STATUSES, type PlayerStatus, type Position } from '../domain/constants';

export const DEMO_EMAIL = 'demo@premierfantasy.local';
export const DEMO_PASSWORD = 'Demo12345!';

const MANAGERS = [
  { managerName: 'Demo Manager', teamName: 'Demo United', email: DEMO_EMAIL, crest: { shape: 'shield', pattern: 'stripes', primary: '#16a34a', secondary: '#0f172a', initials: 'DU' } },
  { managerName: 'Lucía Torres', teamName: 'Atlético Tapas', crest: { shape: 'round', pattern: 'hoops', primary: '#dc2626', secondary: '#fbbf24', initials: 'AT' } },
  { managerName: 'Carlos Méndez', teamName: 'Real Sofá CF', crest: { shape: 'classic', pattern: 'plain', primary: '#2563eb', secondary: '#ffffff', initials: 'RS' } },
  { managerName: 'Andrea Ruiz', teamName: 'Los Galácticos', crest: { shape: 'diamond', pattern: 'sash', primary: '#7c3aed', secondary: '#f5f5f5', initials: 'LG' } },
  { managerName: 'Javier Blanco', teamName: 'Deportivo Lunes', crest: { shape: 'shield', pattern: 'half', primary: '#0891b2', secondary: '#111827', initials: 'DL' } },
  { managerName: 'Sofía Navarro', teamName: 'Inter de Barrio', crest: { shape: 'round', pattern: 'stripes', primary: '#1d4ed8', secondary: '#000000', initials: 'IB' } },
  { managerName: 'Miguel Ortega', teamName: 'Sporting Café', crest: { shape: 'classic', pattern: 'chevron', primary: '#15803d', secondary: '#fef08a', initials: 'SC' } },
  { managerName: 'Paula Castro', teamName: 'Racing Siesta', crest: { shape: 'shield', pattern: 'hoops', primary: '#ea580c', secondary: '#1e293b', initials: 'RS' } },
  { managerName: 'Diego Romero', teamName: 'Olympique Pisto', crest: { shape: 'diamond', pattern: 'plain', primary: '#be123c', secondary: '#fde68a', initials: 'OP' } },
  { managerName: 'Elena Vidal', teamName: 'Unión Parrilla', crest: { shape: 'round', pattern: 'half', primary: '#4d7c0f', secondary: '#ffffff', initials: 'UP' } },
  { managerName: 'Raúl Serrano', teamName: 'Balón Dorado FC', crest: { shape: 'shield', pattern: 'sash', primary: '#ca8a04', secondary: '#111827', initials: 'BD' } },
  { managerName: 'Marta Gil', teamName: 'Estrella Roja Norte', crest: { shape: 'classic', pattern: 'stripes', primary: '#b91c1c', secondary: '#f8fafc', initials: 'ER' } },
];

// Generador pseudoaleatorio determinista para resultados reproducibles
let seed = 20262027;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

async function buildSquad(userId: string) {
  const need: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const { map } = await getPlayerAggregates();
  const players = await prisma.player.findMany({ where: { isActive: true, status: 'AVAILABLE' }, select: { id: true, position: true, price: true, clubId: true } });
  const score = (p: (typeof players)[number]) => (map.get(p.id)?.totalPoints ?? 0) + p.price / 8 + rand() * 12;
  const order: Position[] = ['FWD', 'MID', 'DEF', 'GK'];
  let budget = 1000;
  const clubCount = new Map<number, number>();
  const chosen = new Set<number>();
  const slotsLeft = () => Object.values(need).reduce((a, b) => a + b, 0);

  for (const pos of order) {
    while (need[pos] > 0) {
      const reserve = (slotsLeft() - 1) * 42;
      const pool = players
        .filter((p) => p.position === pos && !chosen.has(p.id) && (clubCount.get(p.clubId) ?? 0) < 3 && p.price <= budget - reserve)
        .sort((a, b) => score(b) - score(a))
        .slice(0, 12);
      if (pool.length === 0) break;
      const pick = pool[Math.floor(rand() * pool.length)];
      await buyPlayer(userId, pick.id);
      chosen.add(pick.id);
      budget -= pick.price;
      clubCount.set(pick.clubId, (clubCount.get(pick.clubId) ?? 0) + 1);
      need[pos] -= 1;
    }
  }
}

export async function seedDemo(log: (msg: string) => void = console.log) {
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    log('ℹ Los datos de demostración ya existen');
    return;
  }
  await syncGameweekStatuses();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const clubs = await prisma.club.findMany({ select: { id: true } });
  const userIds: string[] = [];

  for (const [i, m] of MANAGERS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: m.email ?? `manager${i}@premierfantasy.local`,
        passwordHash,
        managerName: m.managerName,
        favoriteClubId: clubs[Math.floor(rand() * clubs.length)].id,
        createdAt: new Date(Date.now() - (30 - i) * 24 * 3600 * 1000),
      },
    });
    await createTeam(user.id, { name: m.teamName, crest: m.crest });
    await buildSquad(user.id);
    userIds.push(user.id);
    log(`  ✔ ${m.managerName} — ${m.teamName}`);
  }

  // Alineaciones de las jornadas disputadas (con variación por mánager)
  const gameweeks = await prisma.gameweek.findMany({ where: { deadline: { lte: new Date() } }, orderBy: { id: 'asc' } });
  const { map } = await getPlayerAggregates();
  const teams = await prisma.fantasyTeam.findMany({ include: { players: { include: { player: { select: { position: true, status: true, price: true } } } } } });
  for (const gw of gameweeks) {
    for (const team of teams) {
      const members = team.players.map((e) => ({
        id: e.playerId,
        position: e.player.position as Position,
        score: (map.get(e.playerId)?.form ?? 0) * 3 + e.player.price / 10 + rand() * 10,
        available: !BLOCKING_STATUSES.includes(e.player.status as PlayerStatus),
      }));
      const best = pickBestLineup(members);
      if (!best) continue;
      await persistLineup(team.id, gw.id, normalizeLineup(best, members));
    }
    await processGameweek(gw.id, { final: gw.status === 'FINISHED', notify: false });
    log(`  ✔ ${gw.name} procesada (${gw.status})`);
  }

  // Ligas de ejemplo
  const [demo, ...others] = userIds;
  const leagues = [
    { name: 'Liga de los Viernes', type: 'PRIVATE', members: others.slice(0, 6), description: 'La liga de toda la vida', code: 'VIERNE' },
    { name: 'Premier Fans ES', type: 'PUBLIC', members: others.slice(3, 10), description: 'Liga abierta para fans hispanohablantes de la Premier', code: 'PREMES' },
    { name: 'Amigos del Norte', type: 'FRIENDS', members: others.slice(6, 11), description: 'Solo para la cuadrilla', code: 'NORTE7' },
    { name: 'Invitación VIP', type: 'INVITE', members: others.slice(0, 3), description: 'Solo con invitación del administrador', code: 'VIP777' },
  ];
  for (const [i, l] of leagues.entries()) {
    await prisma.league.create({
      data: {
        name: l.name,
        description: l.description,
        type: l.type,
        code: l.code,
        maxMembers: 20,
        ownerId: i === 0 ? demo : l.members[0],
        members: {
          create: [
            ...(i === 0 || i === 1 ? [{ userId: demo, role: i === 0 ? 'ADMIN' : 'MEMBER' }] : []),
            ...l.members.map((userId, idx) => ({ userId, role: i !== 0 && idx === 0 ? 'ADMIN' : 'MEMBER' })),
          ],
        },
      },
    });
  }
  const vip = await prisma.league.findUniqueOrThrow({ where: { code: 'VIP777' } });
  await prisma.leagueInvite.create({ data: { leagueId: vip.id, senderId: others[0], receiverId: demo } });
  await prisma.notification.create({
    data: { userId: demo, type: 'LEAGUE', title: 'Invitación a Invitación VIP', message: `${MANAGERS[1].managerName} te invita a su liga.`, link: '/leagues?tab=invites' },
  });

  log(`✔ Demo lista. Usuario: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

import { prisma } from '../lib/prisma';
import { clubLiteSelect, playerSelect } from '../lib/dto';
import { pickBestLineup } from '../domain/lineup';
import { BLOCKING_STATUSES, type PlayerStatus, type Position } from '../domain/constants';
import { aggFor, getPlayerAggregates, toPlayerDTO } from './player-stats.service';
import { computeStandings, getUserGlobalPosition } from './ranking.service';
import { getEditableGameweek, getGameweekContext, fixtureInclude } from './gameweek.service';
import { getSettings, squadRequirements } from './settings.service';

/** Equipo y jugador de la jornada: mejor once posible según los puntos reales. */
export async function teamOfTheWeek(gameweekId?: number) {
  const gwId = gameweekId ?? (await prisma.playerStatistic.aggregate({ _max: { gameweekId: true } }))._max.gameweekId;
  if (!gwId) return null;
  const sums = await prisma.playerStatistic.groupBy({ by: ['playerId'], where: { gameweekId: gwId }, _sum: { points: true } });
  const ids = sums.map((s) => s.playerId);
  const players = await prisma.player.findMany({ where: { id: { in: ids } }, select: playerSelect });
  const points = new Map(sums.map((s) => [s.playerId, s._sum.points ?? 0]));
  const best = pickBestLineup(players.map((p) => ({ id: p.id, position: p.position as Position, score: points.get(p.id) ?? 0 })));
  if (!best) return null;
  const { map } = await getPlayerAggregates();
  const byId = new Map(players.map((p) => [p.id, p]));
  const starters = best.starters.map((id) => ({ ...toPlayerDTO(byId.get(id)!, aggFor(map, id)), gameweekPoints: points.get(id) ?? 0 }));
  const top = [...starters].sort((a, b) => b.gameweekPoints - a.gameweekPoints)[0];
  const gameweek = await prisma.gameweek.findUnique({ where: { id: gwId }, select: { id: true, name: true, status: true } });
  return { gameweek, formation: best.formation, total: best.total, players: starters, playerOfTheWeek: top };
}

export async function marketTrends(limit = 10) {
  const { map } = await getPlayerAggregates();
  const players = await prisma.player.findMany({ where: { isActive: true }, select: playerSelect });
  const dto = players.map((p) => toPlayerDTO(p, aggFor(map, p.id)));
  const season = await prisma.transfer.groupBy({ by: ['playerId', 'type'], _count: { _all: true } });
  const soldSeason = new Map(season.filter((s) => s.type === 'SELL').map((s) => [s.playerId, s._count._all]));
  const boughtSeason = new Map(season.filter((s) => s.type === 'BUY').map((s) => [s.playerId, s._count._all]));
  const take = <T>(arr: T[]) => arr.slice(0, limit);
  return {
    mostSelected: take(dto.filter((p) => p.stats.ownersCount > 0).sort((a, b) => b.stats.ownersCount - a.stats.ownersCount)),
    mostBought: take(dto.filter((p) => boughtSeason.has(p.id)).sort((a, b) => boughtSeason.get(b.id)! - boughtSeason.get(a.id)!)).map((p) => ({ ...p, count: boughtSeason.get(p.id) })),
    mostSold: take(dto.filter((p) => soldSeason.has(p.id)).sort((a, b) => soldSeason.get(b.id)! - soldSeason.get(a.id)!)).map((p) => ({ ...p, count: soldSeason.get(p.id) })),
    risers: take(dto.filter((p) => p.stats.weeklyChange > 0).sort((a, b) => b.stats.weeklyChange - a.stats.weeklyChange)),
    fallers: take(dto.filter((p) => p.stats.weeklyChange < 0).sort((a, b) => a.stats.weeklyChange - b.stats.weeklyChange)),
    inForm: take([...dto].sort((a, b) => b.stats.form - a.stats.form)),
    topScorers: take([...dto].sort((a, b) => b.stats.goals - a.stats.goals || b.stats.assists - a.stats.assists)),
  };
}

/** Tabla de la Premier League calculada a partir de los resultados. */
export async function leagueTable() {
  const [clubs, fixtures] = await Promise.all([
    prisma.club.findMany({ where: { isActive: true }, select: clubLiteSelect }),
    prisma.fixture.findMany({ where: { status: 'FINISHED' }, orderBy: { kickoff: 'asc' } }),
  ]);
  const table = new Map(clubs.map((c) => [c.id, { club: c, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: [] as string[] }]));
  for (const f of fixtures) {
    if (f.homeScore === null || f.awayScore === null) continue;
    const home = table.get(f.homeClubId);
    const away = table.get(f.awayClubId);
    if (!home || !away) continue;
    const apply = (row: typeof home, gf: number, ga: number) => {
      row.played += 1;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      const r = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      if (r === 'W') { row.won += 1; row.points += 3; }
      else if (r === 'D') { row.drawn += 1; row.points += 1; }
      else row.lost += 1;
      row.form = [...row.form, r].slice(-5);
    };
    apply(home, f.homeScore, f.awayScore);
    apply(away, f.awayScore, f.homeScore);
  }
  return [...table.values()]
    .map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.club.name.localeCompare(b.club.name))
    .map((r, i) => ({ position: i + 1, ...r }));
}

export async function clubDetail(clubId: number) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) return null;
  const [players, fixtures, table, { map }] = await Promise.all([
    prisma.player.findMany({ where: { clubId, isActive: true }, select: playerSelect, orderBy: [{ position: 'asc' }, { price: 'desc' }] }),
    prisma.fixture.findMany({
      where: { OR: [{ homeClubId: clubId }, { awayClubId: clubId }] },
      include: fixtureInclude,
      orderBy: [{ kickoff: 'asc' }],
    }),
    leagueTable(),
    getPlayerAggregates(),
  ]);
  const squad = players.map((p) => toPlayerDTO(p, aggFor(map, p.id)));
  return {
    club,
    standing: table.find((r) => r.club.id === clubId) ?? null,
    players: squad,
    fixtures,
    fantasyPoints: squad.reduce((s, p) => s + p.stats.totalPoints, 0),
    topScorer: [...squad].sort((a, b) => b.stats.goals - a.stats.goals)[0] ?? null,
    topFantasy: [...squad].sort((a, b) => b.stats.totalPoints - a.stats.totalPoints)[0] ?? null,
  };
}

export async function pointsHistory(teamId: number) {
  const [mine, all] = await Promise.all([
    prisma.lineup.findMany({ where: { teamId, gameweek: { status: { not: 'UPCOMING' } } }, select: { gameweekId: true, points: true, benchPoints: true }, orderBy: { gameweekId: 'asc' } }),
    prisma.lineup.groupBy({ by: ['gameweekId'], where: { gameweek: { status: { not: 'UPCOMING' } } }, _avg: { points: true }, _max: { points: true } }),
  ]);
  const allMap = new Map(all.map((a) => [a.gameweekId, a]));
  let cumulative = 0;
  return mine.map((l) => {
    cumulative += l.points;
    return {
      gameweek: l.gameweekId,
      points: l.points,
      benchPoints: l.benchPoints,
      cumulative,
      average: Math.round(allMap.get(l.gameweekId)?._avg.points ?? 0),
      highest: allMap.get(l.gameweekId)?._max.points ?? 0,
    };
  });
}

export async function dashboard(userId: string) {
  const team = await prisma.fantasyTeam.findUnique({
    where: { userId },
    include: { players: { include: { player: { select: playerSelect } } } },
  });
  const settings = await getSettings();
  const { current, next } = await getGameweekContext();
  const editable = await getEditableGameweek();
  const { map, lastGameweekId } = await getPlayerAggregates();
  const now = new Date();

  const [position, news, nextFixtures, notifications, history] = await Promise.all([
    getUserGlobalPosition(userId),
    prisma.news.findMany({ where: { published: true }, orderBy: { createdAt: 'desc' }, take: 5, include: { club: { select: clubLiteSelect } } }),
    prisma.fixture.findMany({ where: { kickoff: { gte: now }, status: 'SCHEDULED' }, include: fixtureInclude, orderBy: { kickoff: 'asc' }, take: 6 }),
    prisma.notification.findMany({ where: { userId, isRead: false }, orderBy: { createdAt: 'desc' }, take: 5 }),
    team ? pointsHistory(team.id) : Promise.resolve([]),
  ]);

  const squad = (team?.players ?? []).map((e) => toPlayerDTO(e.player, aggFor(map, e.playerId)));
  const squadClubIds = new Set(squad.map((p) => p.club.id));
  const myNextFixture = nextFixtures.find((f) => squadClubIds.has(f.homeClubId) || squadClubIds.has(f.awayClubId)) ?? nextFixtures[0] ?? null;

  // Alertas calculadas en el momento
  const alerts: { level: 'danger' | 'warning' | 'info'; title: string; message: string; link: string }[] = [];
  const req = squadRequirements(settings);
  const size = req.GK + req.DEF + req.MID + req.FWD;
  if (team && squad.length < size) alerts.push({ level: 'warning', title: 'Plantilla incompleta', message: `Tienes ${squad.length}/${size} jugadores`, link: '/market' });
  const unavailable = squad.filter((p) => BLOCKING_STATUSES.includes(p.status as PlayerStatus));
  if (unavailable.length) alerts.push({ level: 'danger', title: 'Tienes jugadores no disponibles', message: unavailable.map((p) => p.displayName).join(', '), link: '/lineup' });
  const doubtful = squad.filter((p) => p.status === 'DOUBTFUL');
  if (doubtful.length) alerts.push({ level: 'warning', title: 'Jugadores en duda', message: doubtful.map((p) => p.displayName).join(', '), link: '/lineup' });
  if (team && editable) {
    const lineup = await prisma.lineup.findUnique({ where: { teamId_gameweekId: { teamId: team.id, gameweekId: editable.id } } });
    if (!lineup && squad.length > 0) alerts.push({ level: 'info', title: `Alineación de la ${editable.name} sin confirmar`, message: 'Se usará tu última alineación si no la guardas', link: '/lineup' });
    if (lineup?.captainId) {
      const cap = squad.find((p) => p.id === lineup.captainId);
      if (cap && cap.status !== 'AVAILABLE') alerts.push({ level: 'danger', title: 'Tu capitán no está disponible', message: `${cap.displayName}: ${cap.news ?? 'estado dudoso'}`, link: '/lineup' });
    }
  }
  if (!settings.market_open) alerts.push({ level: 'info', title: 'Mercado cerrado', message: 'No se pueden fichar ni vender jugadores ahora', link: '/market' });

  const lastLineup = team && lastGameweekId ? history.find((h) => h.gameweek === (current?.id ?? lastGameweekId)) ?? history[history.length - 1] : null;
  const featured = [...squad].sort((a, b) => b.stats.lastPoints - a.stats.lastPoints).slice(0, 3);

  const top = await computeStandings();
  return {
    team: team ? { id: team.id, name: team.name, crest: JSON.parse(team.crest || '{}') } : null,
    lastGameweekPoints: lastLineup?.points ?? 0,
    lastGameweekId: lastLineup?.gameweek ?? null,
    totalPoints: team?.totalPoints ?? 0,
    globalRank: position.row?.rank ?? null,
    globalMovement: position.row?.movement ?? 'same',
    totalManagers: position.total,
    teamValue: squad.reduce((s, p) => s + p.price, 0),
    budget: team?.budget ?? 0,
    squadCount: squad.length,
    squadSize: size,
    currentGameweek: current ? { id: current.id, name: current.name, status: current.status, deadline: current.deadline } : null,
    nextGameweek: next ? { id: next.id, name: next.name, deadline: next.deadline } : null,
    editableGameweek: editable ? { id: editable.id, name: editable.name, deadline: editable.deadline } : null,
    nextFixture: myNextFixture,
    upcomingFixtures: nextFixtures,
    featuredPlayers: featured,
    history,
    news,
    notifications,
    alerts,
    leaders: top.rows.slice(0, 5),
  };
}

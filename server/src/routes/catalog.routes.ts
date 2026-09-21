import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { icontains, prisma } from '../lib/prisma';
import { intParam, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { clubLiteSelect, playerSelect } from '../lib/dto';
import { requireAuth } from '../middleware/auth';
import { FIXTURE_STATUSES, NEWS_CATEGORIES, PLAYER_STATUSES, POSITIONS, SCORING_ACTIONS } from '../domain/constants';
import { getSettings } from '../services/settings.service';
import { aggFor, getPlayerAggregates, toPlayerDTO } from '../services/player-stats.service';
import { fixtureInclude, getGameweekContext } from '../services/gameweek.service';
import { clubDetail, leagueTable, marketTrends, teamOfTheWeek } from '../services/stats.service';

export const catalogRouter = Router();

// ─────────────── Clubes (listado público: lo usa el registro) ───────────────
catalogRouter.get('/clubs', async (_req, res) => {
  res.json(await prisma.club.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
});

// ─────────────── Configuración pública del juego (pantallas de acceso y reglamento) ───────────────
catalogRouter.get('/config', async (_req, res) => {
  const s = await getSettings();
  const rules = await prisma.scoringRule.findMany({ where: { isActive: true }, orderBy: [{ position: 'asc' }, { points: 'desc' }] });
  const squad = { GK: s.squad_gk, DEF: s.squad_def, MID: s.squad_mid, FWD: s.squad_fwd };
  const v2 = s.economy_v2_new_teams;
  res.json({
    season: s.season,
    // Con la economía de liga los equipos nuevos reciben el presupuesto de liga (miles de £ → décimas)
    initialBudget: v2 ? Math.round(s.v2_initial_budget / 100) : s.initial_budget,
    squad,
    squadSize: v2 ? 11 + s.v2_starter_bench : squad.GK + squad.DEF + squad.MID + squad.FWD,
    economy: {
      enabled: v2,
      initialBudgetK: s.v2_initial_budget,
      starterPlayers: 11 + s.v2_starter_bench,
      starterBench: s.v2_starter_bench,
      maxSquad: s.v2_max_squad,
      playersPerMarket: s.market_players_per_cycle,
      coachesMin: s.market_coaches_min,
      coachesMax: s.market_coaches_max,
      sellPercent: s.v2_sell_percent,
    },
    starters: 11,
    maxPerClub: s.max_players_per_club,
    captainMultiplier: s.captain_multiplier,
    viceCaptainEnabled: s.vice_captain_enabled,
    autoSubs: s.auto_subs_enabled,
    lockMode: s.lock_mode,
    registrationOpen: s.registration_open,
    scoring: rules.map((r) => ({
      position: r.position,
      action: r.action,
      label: SCORING_ACTIONS[r.action]?.label ?? r.action,
      mode: SCORING_ACTIONS[r.action]?.mode ?? 'per_unit',
      points: r.points,
      threshold: r.threshold,
    })),
  });
});

catalogRouter.use(requireAuth);

catalogRouter.get('/clubs/table', async (_req, res) => {
  res.json(await leagueTable());
});

catalogRouter.get('/clubs/:id', async (req, res) => {
  const detail = await clubDetail(intParam(req.params.id));
  if (!detail) throw notFound('Club no encontrado');
  res.json(detail);
});

// ─────────────── Jugadores / mercado ───────────────
const SORTS = ['price', 'points', 'goals', 'assists', 'form', 'minutes', 'selected', 'name', 'lastPoints', 'priceChange'] as const;

catalogRouter.get('/players', async (req, res) => {
  const q = parse(
    z.object({
      search: z.string().trim().max(50).optional(),
      position: z.enum(POSITIONS).optional(),
      club: z.coerce.number().int().optional(),
      status: z.enum(PLAYER_STATUSES).optional(),
      sort: z.enum(SORTS).default('points'),
      order: z.enum(['asc', 'desc']).default('desc'),
      minPrice: z.coerce.number().int().optional(),
      maxPrice: z.coerce.number().int().optional(),
      onlyAvailable: z.enum(['true', 'false']).optional(),
      favorites: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(24),
    }),
    req.query,
  );
  const where: Prisma.PlayerWhereInput = {
    isActive: true,
    club: { isActive: true },
    position: q.position,
    clubId: q.club,
    status: q.onlyAvailable === 'true' ? 'AVAILABLE' : q.status,
    price: { gte: q.minPrice, lte: q.maxPrice },
  };
  if (q.search) {
    where.OR = [{ displayName: icontains(q.search) }, { firstName: icontains(q.search) }, { lastName: icontains(q.search) }];
  }
  if (q.favorites === 'true') where.favorites = { some: { userId: req.user!.id } };

  const [players, { map }, team, favorites] = await Promise.all([
    prisma.player.findMany({ where, select: playerSelect }),
    getPlayerAggregates(),
    prisma.fantasyTeam.findUnique({ where: { userId: req.user!.id }, select: { players: { select: { playerId: true } } } }),
    prisma.favoritePlayer.findMany({ where: { userId: req.user!.id }, select: { playerId: true } }),
  ]);
  const squadIds = new Set(team?.players.map((p) => p.playerId) ?? []);
  const favIds = new Set(favorites.map((f) => f.playerId));

  const key: Record<(typeof SORTS)[number], (p: ReturnType<typeof toPlayerDTO>) => number | string> = {
    price: (p) => p.price,
    points: (p) => p.stats.totalPoints,
    goals: (p) => p.stats.goals,
    assists: (p) => p.stats.assists,
    form: (p) => p.stats.form,
    minutes: (p) => p.stats.minutes,
    selected: (p) => p.stats.selectedBy,
    name: (p) => p.displayName,
    lastPoints: (p) => p.stats.lastPoints,
    priceChange: (p) => p.stats.weeklyChange,
  };
  const dir = q.order === 'asc' ? 1 : -1;
  const items = players
    .map((p) => toPlayerDTO(p, aggFor(map, p.id)))
    .sort((a, b) => {
      const ka = key[q.sort](a);
      const kb = key[q.sort](b);
      const cmp = typeof ka === 'string' ? ka.localeCompare(kb as string) : ka - (kb as number);
      return cmp * dir || b.stats.totalPoints - a.stats.totalPoints || b.price - a.price;
    });
  const start = (q.page - 1) * q.pageSize;
  res.json({
    items: items.slice(start, start + q.pageSize).map((p) => ({ ...p, inSquad: squadIds.has(p.id), isFavorite: favIds.has(p.id) })),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
  });
});

catalogRouter.get('/players/compare', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.string().regex(/^\d+(,\d+){0,3}$/, 'Indica entre 1 y 4 jugadores') }), req.query);
  const idList = ids.split(',').map(Number);
  const [players, { map }, perGw] = await Promise.all([
    prisma.player.findMany({ where: { id: { in: idList } }, select: playerSelect }),
    getPlayerAggregates(),
    prisma.playerStatistic.groupBy({ by: ['playerId', 'gameweekId'], where: { playerId: { in: idList } }, _sum: { points: true } }),
  ]);
  res.json(
    idList
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        ...toPlayerDTO(p, aggFor(map, p.id)),
        history: perGw.filter((g) => g.playerId === p.id).map((g) => ({ gameweek: g.gameweekId, points: g._sum.points ?? 0 })).sort((a, b) => a.gameweek - b.gameweek),
      })),
  );
});

catalogRouter.get('/players/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const player = await prisma.player.findUnique({ where: { id }, select: playerSelect });
  if (!player) throw notFound('Jugador no encontrado');
  const now = new Date();
  const [{ map }, prices, statistics, injuries, upcoming, team, favorite] = await Promise.all([
    getPlayerAggregates(),
    prisma.playerPrice.findMany({ where: { playerId: id }, orderBy: { createdAt: 'asc' }, select: { price: true, change: true, reason: true, createdAt: true, gameweekId: true } }),
    prisma.playerStatistic.findMany({
      where: { playerId: id },
      include: { fixture: { include: fixtureInclude } },
      orderBy: [{ gameweekId: 'asc' }],
    }),
    prisma.playerInjury.findMany({ where: { playerId: id }, orderBy: { startDate: 'desc' }, take: 10 }),
    prisma.fixture.findMany({
      where: { OR: [{ homeClubId: player.clubId }, { awayClubId: player.clubId }], status: { in: ['SCHEDULED', 'POSTPONED'] }, kickoff: { gte: now } },
      include: fixtureInclude,
      orderBy: { kickoff: 'asc' },
      take: 6,
    }),
    prisma.fantasyTeam.findUnique({ where: { userId: req.user!.id }, select: { players: { where: { playerId: id }, select: { purchasePrice: true } } } }),
    prisma.favoritePlayer.findUnique({ where: { userId_playerId: { userId: req.user!.id, playerId: id } } }),
  ]);

  const matches = statistics.map((s) => {
    const home = s.fixture.homeClubId === s.clubId;
    return {
      fixtureId: s.fixtureId,
      gameweek: s.gameweekId,
      kickoff: s.fixture.kickoff,
      home,
      opponent: home ? s.fixture.awayClub : s.fixture.homeClub,
      result: s.fixture.homeScore !== null ? `${s.fixture.homeScore}-${s.fixture.awayScore}` : null,
      minutes: s.minutes,
      goals: s.goals,
      assists: s.assists,
      cleanSheet: s.cleanSheet,
      goalsConceded: s.goalsConceded,
      yellowCards: s.yellowCards,
      redCards: s.redCards,
      saves: s.saves,
      bonus: s.bonus,
      points: s.points,
      breakdown: JSON.parse(s.breakdown),
    };
  });
  const byGw = new Map<number, number>();
  for (const m of matches) byGw.set(m.gameweek, (byGw.get(m.gameweek) ?? 0) + m.points);
  const { gameweeks } = await getGameweekContext();
  const played = gameweeks.filter((g) => g.status !== 'UPCOMING');

  res.json({
    ...toPlayerDTO(player, aggFor(map, id)),
    priceHistory: prices,
    pointsHistory: played.map((g) => ({ gameweek: g.id, points: byGw.get(g.id) ?? 0, played: byGw.has(g.id) })),
    matches: matches.reverse(),
    injuries,
    upcoming: upcoming.map((f) => {
      const home = f.homeClubId === player.clubId;
      return { id: f.id, gameweekId: f.gameweekId, kickoff: f.kickoff, home, opponent: home ? f.awayClub : f.homeClub, difficulty: home ? f.homeDifficulty : f.awayDifficulty };
    }),
    inSquad: (team?.players.length ?? 0) > 0,
    purchasePrice: team?.players[0]?.purchasePrice ?? null,
    isFavorite: !!favorite,
  });
});

catalogRouter.get('/favorites', async (req, res) => {
  const [favorites, { map }] = await Promise.all([
    prisma.favoritePlayer.findMany({ where: { userId: req.user!.id }, include: { player: { select: playerSelect } }, orderBy: { createdAt: 'desc' } }),
    getPlayerAggregates(),
  ]);
  res.json(favorites.map((f) => ({ ...toPlayerDTO(f.player, aggFor(map, f.playerId)), isFavorite: true })));
});

catalogRouter.post('/players/:id/favorite', async (req, res) => {
  const playerId = intParam(req.params.id);
  if (!(await prisma.player.findUnique({ where: { id: playerId } }))) throw notFound('Jugador no encontrado');
  const count = await prisma.favoritePlayer.count({ where: { userId: req.user!.id } });
  if (count >= 100) throw badRequest('Máximo 100 favoritos');
  await prisma.favoritePlayer.upsert({
    where: { userId_playerId: { userId: req.user!.id, playerId } },
    create: { userId: req.user!.id, playerId },
    update: {},
  });
  res.json({ isFavorite: true });
});

catalogRouter.delete('/players/:id/favorite', async (req, res) => {
  await prisma.favoritePlayer.deleteMany({ where: { userId: req.user!.id, playerId: intParam(req.params.id) } });
  res.json({ isFavorite: false });
});

// ─────────────── Jornadas y calendario ───────────────
catalogRouter.get('/gameweeks', async (_req, res) => {
  const { gameweeks, current, next } = await getGameweekContext();
  const counts = await prisma.fixture.groupBy({ by: ['gameweekId'], _count: { _all: true } });
  res.json({
    currentId: current?.id ?? null,
    nextId: next?.id ?? null,
    gameweeks: gameweeks.map((g) => ({ ...g, fixtures: counts.find((c) => c.gameweekId === g.id)?._count._all ?? 0 })),
  });
});

catalogRouter.get('/fixtures', async (req, res) => {
  const q = parse(
    z.object({
      gameweek: z.coerce.number().int().optional(),
      club: z.coerce.number().int().optional(),
      status: z.enum(FIXTURE_STATUSES).optional(),
    }),
    req.query,
  );
  res.json(
    await prisma.fixture.findMany({
      where: {
        gameweekId: q.gameweek,
        status: q.status,
        OR: q.club ? [{ homeClubId: q.club }, { awayClubId: q.club }] : undefined,
      },
      include: fixtureInclude,
      orderBy: [{ kickoff: 'asc' }, { id: 'asc' }],
    }),
  );
});

catalogRouter.get('/fixtures/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const fixture = await prisma.fixture.findUnique({ where: { id }, include: { ...fixtureInclude, gameweek: true } });
  if (!fixture) throw notFound('Partido no encontrado');
  const stats = await prisma.playerStatistic.findMany({
    where: { fixtureId: id },
    include: { player: { select: { id: true, displayName: true, position: true, photoUrl: true, club: { select: clubLiteSelect } } } },
    orderBy: [{ points: 'desc' }],
  });
  const side = (clubId: number) => (clubId === fixture.homeClubId ? 'home' : 'away');
  const events = stats.flatMap((s) => [
    ...Array.from({ length: s.goals }, () => ({ type: 'GOAL', side: side(s.clubId), player: s.player })),
    ...Array.from({ length: s.ownGoals }, () => ({ type: 'OWN_GOAL', side: side(s.clubId), player: s.player })),
    ...Array.from({ length: s.assists }, () => ({ type: 'ASSIST', side: side(s.clubId), player: s.player })),
    ...Array.from({ length: s.yellowCards }, () => ({ type: 'YELLOW', side: side(s.clubId), player: s.player })),
    ...Array.from({ length: s.redCards }, () => ({ type: 'RED', side: side(s.clubId), player: s.player })),
    ...Array.from({ length: s.penaltiesSaved }, () => ({ type: 'PEN_SAVED', side: side(s.clubId), player: s.player })),
    ...Array.from({ length: s.penaltiesMissed }, () => ({ type: 'PEN_MISSED', side: side(s.clubId), player: s.player })),
  ]);
  const totals = (key: 'goals' | 'assists' | 'yellowCards' | 'redCards' | 'saves', clubId: number) =>
    stats.filter((s) => s.clubId === clubId).reduce((sum, s) => sum + s[key], 0);
  res.json({
    ...fixture,
    events,
    summary: (['goals', 'assists', 'saves', 'yellowCards', 'redCards'] as const).map((k) => ({
      key: k,
      home: totals(k, fixture.homeClubId),
      away: totals(k, fixture.awayClubId),
    })),
    players: stats.map((s) => ({ ...s, side: side(s.clubId), breakdown: JSON.parse(s.breakdown) })),
  });
});

// ─────────────── Noticias ───────────────
catalogRouter.get('/news', async (req, res) => {
  const q = parse(z.object({ category: z.enum(NEWS_CATEGORIES).optional(), take: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
  res.json(
    await prisma.news.findMany({
      where: { published: true, category: q.category },
      include: { club: { select: clubLiteSelect }, player: { select: { id: true, displayName: true, photoUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: q.take,
    }),
  );
});

catalogRouter.get('/news/:id', async (req, res) => {
  const news = await prisma.news.findFirst({
    where: { id: intParam(req.params.id), published: true },
    include: { club: { select: clubLiteSelect }, player: { select: { id: true, displayName: true, photoUrl: true } }, author: { select: { managerName: true } } },
  });
  if (!news) throw notFound('Noticia no encontrada');
  res.json(news);
});

// ─────────────── Estadísticas ───────────────
catalogRouter.get('/stats/team-of-the-week', async (req, res) => {
  const { gameweek } = parse(z.object({ gameweek: z.coerce.number().int().optional() }), req.query);
  res.json(await teamOfTheWeek(gameweek));
});

catalogRouter.get('/stats/trends', async (_req, res) => {
  res.json(await marketTrends(10));
});

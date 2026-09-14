import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { icontains, prisma } from '../lib/prisma';
import { intParam, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { clubLiteSelect, playerSelect } from '../lib/dto';
import { requireAdmin, requireAuth } from '../middleware/auth';
import {
  DEFAULT_SCORING_RULES,
  FIXTURE_STATUSES,
  INJURY_TYPES,
  NEWS_CATEGORIES,
  PLAYER_STATUSES,
  POSITIONS,
  SCORING_ACTIONS,
} from '../domain/constants';
import { scorePerformance, EMPTY_STATS } from '../domain/scoring';
import { describeSettings, getSettings, updateSettings } from '../services/settings.service';
import { setPlayerPrice, updatePricesForGameweek } from '../services/price.service';
import { handleStatusChanges, importPlayers, lastSync, parseCsv, syncFromProvider } from '../services/import.service';
import { processGameweek, recalculateSeason, recalculateStatistics } from '../services/scoring.service';
import { fixtureInclude, syncGameweekStatuses } from '../services/gameweek.service';
import { invalidatePlayerAggregates, aggFor, getPlayerAggregates, toPlayerDTO } from '../services/player-stats.service';
import { notifyMany } from '../services/notification.service';
import * as leagues from '../services/league.service';
import { hashPassword } from '../services/auth.service';
import { invalidateRankings } from '../services/ranking.service';
import { paginationSchema, passwordSchema, statLineSchema } from './validators';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

// ─────────────── Resumen ───────────────
adminRouter.get('/overview', async (_req, res) => {
  const [users, teams, leaguesCount, players, clubs, gameweeks, fixtures, stats, transfers, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.fantasyTeam.count(),
    prisma.league.count(),
    prisma.player.count({ where: { isActive: true } }),
    prisma.club.count({ where: { isActive: true } }),
    prisma.gameweek.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, status: true, isProcessed: true, pricesUpdated: true, deadline: true } }),
    prisma.fixture.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.playerStatistic.count(),
    prisma.transfer.count(),
    prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, managerName: true, email: true, createdAt: true, role: true } }),
  ]);
  res.json({
    counts: { users, teams, leagues: leaguesCount, players, clubs, stats, transfers },
    fixtures: Object.fromEntries(fixtures.map((f) => [f.status, f._count._all])),
    gameweeks,
    recentUsers,
    lastSync,
    settings: await getSettings(),
  });
});

// ─────────────── Usuarios ───────────────
adminRouter.get('/users', async (req, res) => {
  const q = parse(paginationSchema.extend({ search: z.string().trim().max(60).optional() }), req.query);
  const where: Prisma.UserWhereInput = q.search ? { OR: [{ email: icontains(q.search) }, { managerName: icontains(q.search) }] } : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, email: true, managerName: true, role: true, isActive: true, createdAt: true, lastLoginAt: true, team: { select: { id: true, name: true, budget: true, totalPoints: true, _count: { select: { players: true } } } } },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pageSize: q.pageSize });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = parse(z.string().min(10), req.params.id);
  const body = parse(z.object({ role: z.enum(['USER', 'ADMIN']).optional(), isActive: z.boolean().optional(), password: passwordSchema.optional() }), req.body);
  if (id === req.user!.id && (body.role === 'USER' || body.isActive === false)) throw badRequest('No puedes quitarte permisos ni desactivarte a ti mismo');
  const user = await prisma.user.update({
    where: { id },
    data: { role: body.role, isActive: body.isActive, passwordHash: body.password ? await hashPassword(body.password) : undefined },
    select: { id: true, email: true, managerName: true, role: true, isActive: true },
  });
  res.json(user);
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = parse(z.string().min(10), req.params.id);
  if (id === req.user!.id) throw badRequest('No puedes eliminar tu propia cuenta desde el panel');
  await prisma.user.delete({ where: { id } });
  invalidateRankings();
  res.json({ deleted: true });
});

adminRouter.post('/users/:id/budget', async (req, res) => {
  const id = parse(z.string().min(10), req.params.id);
  const body = parse(z.object({ amount: z.number().int().min(-2000).max(2000), description: z.string().trim().min(3).max(120) }), req.body);
  const team = await prisma.fantasyTeam.findUnique({ where: { userId: id } });
  if (!team) throw notFound('El usuario no tiene equipo');
  if (team.budget + body.amount < 0) throw badRequest('El presupuesto no puede quedar negativo');
  const balance = team.budget + body.amount;
  await prisma.$transaction([
    prisma.fantasyTeam.update({ where: { id: team.id }, data: { budget: balance } }),
    prisma.transaction.create({ data: { teamId: team.id, type: body.amount >= 0 ? 'REWARD' : 'ADJUSTMENT', amount: body.amount, balanceAfter: balance, description: body.description } }),
  ]);
  res.json({ budget: balance });
});

// ─────────────── Clubes ───────────────
const clubSchema = z.object({
  name: z.string().trim().min(2).max(60),
  shortName: z.string().trim().min(3).max(3).transform((s) => s.toUpperCase()),
  commonName: z.string().trim().max(40).nullish(),
  city: z.string().trim().min(2).max(60),
  stadium: z.string().trim().min(2).max(80),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  crestUrl: z.string().url().nullish(),
  isActive: z.boolean().default(true),
});

adminRouter.get('/clubs', async (_req, res) => {
  res.json(await prisma.club.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { _count: { select: { players: true } } } }));
});
adminRouter.post('/clubs', async (req, res) => {
  res.status(201).json(await prisma.club.create({ data: parse(clubSchema, req.body) }));
});
adminRouter.patch('/clubs/:id', async (req, res) => {
  res.json(await prisma.club.update({ where: { id: intParam(req.params.id) }, data: parse(clubSchema.partial(), req.body) }));
});
adminRouter.delete('/clubs/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const [players, fixtures] = await Promise.all([prisma.player.count({ where: { clubId: id } }), prisma.fixture.count({ where: { OR: [{ homeClubId: id }, { awayClubId: id }] } })]);
  if (players || fixtures) throw conflict('El club tiene jugadores o partidos: desactívalo en lugar de eliminarlo');
  await prisma.club.delete({ where: { id } });
  res.json({ deleted: true });
});

// ─────────────── Jugadores ───────────────
const playerSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  displayName: z.string().trim().min(1).max(40),
  position: z.enum(POSITIONS),
  clubId: z.number().int().positive(),
  birthDate: z.string().date().nullish(),
  nationality: z.string().trim().max(60).nullish(),
  photoUrl: z.string().url().nullish(),
  squadNumber: z.number().int().min(1).max(99).nullish(),
  price: z.number().int().min(10).max(400),
  status: z.enum(PLAYER_STATUSES).default('AVAILABLE'),
  chanceOfPlaying: z.number().int().min(0).max(100).nullish(),
  news: z.string().trim().max(250).nullish(),
  isActive: z.boolean().default(true),
});

adminRouter.get('/players', async (req, res) => {
  const q = parse(
    paginationSchema.extend({
      search: z.string().trim().max(50).optional(),
      club: z.coerce.number().int().optional(),
      position: z.enum(POSITIONS).optional(),
      includeInactive: z.enum(['true', 'false']).optional(),
    }),
    req.query,
  );
  const where: Prisma.PlayerWhereInput = {
    clubId: q.club,
    position: q.position,
    isActive: q.includeInactive === 'true' ? undefined : true,
    OR: q.search ? [{ displayName: icontains(q.search) }, { lastName: icontains(q.search) }, { firstName: icontains(q.search) }] : undefined,
  };
  const [items, total, { map }] = await Promise.all([
    prisma.player.findMany({ where, select: playerSelect, orderBy: [{ price: 'desc' }, { displayName: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.player.count({ where }),
    getPlayerAggregates(),
  ]);
  res.json({ items: items.map((p) => toPlayerDTO(p, aggFor(map, p.id))), total, page: q.page, pageSize: q.pageSize });
});

adminRouter.post('/players', async (req, res) => {
  const body = parse(playerSchema, req.body);
  const player = await prisma.player.create({ data: { ...body, birthDate: body.birthDate ? new Date(body.birthDate) : null } });
  await prisma.playerPrice.create({ data: { playerId: player.id, price: player.price, reason: 'ADMIN' } });
  invalidatePlayerAggregates();
  res.status(201).json(player);
});

adminRouter.patch('/players/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const body = parse(playerSchema.omit({ price: true }).partial(), req.body);
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) throw notFound('Jugador no encontrado');
  if (body.position && body.position !== player.position) {
    const owners = await prisma.fantasyTeamPlayer.count({ where: { playerId: id } });
    if (owners > 0) throw conflict(`No se puede cambiar la posición: está en ${owners} plantilla(s)`);
  }
  const updated = await prisma.player.update({
    where: { id },
    data: { ...body, birthDate: body.birthDate === undefined ? undefined : body.birthDate ? new Date(body.birthDate) : null },
  });
  if (body.status && body.status !== player.status) {
    await handleStatusChanges([{ id, name: updated.displayName, status: body.status, news: updated.news }]);
  }
  invalidatePlayerAggregates();
  res.json(updated);
});

adminRouter.put('/players/:id/price', async (req, res) => {
  const { price } = parse(z.object({ price: z.number().int() }), req.body);
  res.json(await setPlayerPrice(intParam(req.params.id), price));
});

adminRouter.delete('/players/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const [owners, stats, lineupsCount, transfers] = await Promise.all([
    prisma.fantasyTeamPlayer.count({ where: { playerId: id } }),
    prisma.playerStatistic.count({ where: { playerId: id } }),
    prisma.lineupPlayer.count({ where: { playerId: id } }),
    prisma.transfer.count({ where: { playerId: id } }),
  ]);
  if (owners || stats || lineupsCount || transfers) {
    await prisma.player.update({ where: { id }, data: { isActive: false } });
    invalidatePlayerAggregates();
    res.json({ deleted: false, deactivated: true, message: 'El jugador tiene historial: se ha desactivado para conservar la integridad de los datos' });
    return;
  }
  await prisma.player.delete({ where: { id } });
  invalidatePlayerAggregates();
  res.json({ deleted: true });
});

adminRouter.post('/players/:id/injuries', async (req, res) => {
  const id = intParam(req.params.id);
  const body = parse(
    z.object({
      type: z.enum(INJURY_TYPES),
      description: z.string().trim().min(3).max(250),
      expectedReturn: z.string().date().nullish(),
      status: z.enum(['DOUBTFUL', 'INJURED', 'SUSPENDED', 'UNAVAILABLE']),
      chanceOfPlaying: z.number().int().min(0).max(100).nullish(),
    }),
    req.body,
  );
  const player = await prisma.player.update({ where: { id }, data: { status: body.status, news: body.description, chanceOfPlaying: body.chanceOfPlaying ?? null } });
  await handleStatusChanges([{ id, name: player.displayName, status: body.status, news: body.description }]);
  if (body.expectedReturn) {
    const latest = await prisma.playerInjury.findFirst({ where: { playerId: id, isActive: true }, orderBy: { createdAt: 'desc' } });
    if (latest) await prisma.playerInjury.update({ where: { id: latest.id }, data: { type: body.type, expectedReturn: new Date(body.expectedReturn) } });
  }
  invalidatePlayerAggregates();
  res.status(201).json({ ok: true });
});

adminRouter.post('/players/:id/recover', async (req, res) => {
  const id = intParam(req.params.id);
  await prisma.player.update({ where: { id }, data: { status: 'AVAILABLE', news: null, chanceOfPlaying: null } });
  await prisma.playerInjury.updateMany({ where: { playerId: id, isActive: true }, data: { isActive: false } });
  invalidatePlayerAggregates();
  res.json({ ok: true });
});

// ─────────────── Importación y sincronización ───────────────
adminRouter.post('/import/players', async (req, res) => {
  const body = parse(z.object({ format: z.enum(['json', 'csv']), content: z.string().min(2).max(5_000_000), dryRun: z.boolean().default(false) }), req.body);
  let rows: Record<string, unknown>[];
  if (body.format === 'csv') rows = parseCsv(body.content);
  else {
    try {
      const data = JSON.parse(body.content);
      rows = Array.isArray(data) ? data : data.players;
    } catch {
      throw badRequest('JSON inválido');
    }
  }
  res.json(await importPlayers(rows, { dryRun: body.dryRun }));
});

adminRouter.get('/import/template', (req, res) => {
  const format = req.query.format === 'json' ? 'json' : 'csv';
  const example = {
    externalId: '',
    firstName: 'Bukayo',
    lastName: 'Saka',
    displayName: 'Saka',
    position: 'MID',
    club: 'ARS',
    birthDate: '2001-09-05',
    nationality: 'England',
    photoUrl: '',
    squadNumber: 7,
    price: 9.5,
    status: 'AVAILABLE',
    isActive: true,
  };
  if (format === 'json') {
    res.json([example]);
    return;
  }
  res.type('text/csv').send(`${Object.keys(example).join(',')}\n${Object.values(example).join(',')}\n`);
});

adminRouter.post('/sync', async (_req, res) => {
  res.json(await syncFromProvider());
});

adminRouter.get('/sync/status', (_req, res) => {
  res.json(lastSync);
});

// ─────────────── Jornadas ───────────────
adminRouter.get('/gameweeks', async (_req, res) => {
  res.json(await prisma.gameweek.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { fixtures: true, lineups: true } } } }));
});

adminRouter.post('/gameweeks', async (req, res) => {
  const body = parse(z.object({ number: z.number().int().min(1).max(60), name: z.string().trim().min(3).max(40).optional(), deadline: z.string().datetime({ offset: true }) }), req.body);
  const settings = await getSettings();
  res.status(201).json(await prisma.gameweek.create({ data: { id: body.number, name: body.name ?? `Jornada ${body.number}`, deadline: new Date(body.deadline), season: settings.season } }));
});

adminRouter.patch('/gameweeks/:id', async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(3).max(40).optional(), deadline: z.string().datetime({ offset: true }).optional() }), req.body);
  res.json(await prisma.gameweek.update({ where: { id: intParam(req.params.id) }, data: { name: body.name, deadline: body.deadline ? new Date(body.deadline) : undefined } }));
});

adminRouter.delete('/gameweeks/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const [fixtures, lineupsCount] = await Promise.all([prisma.fixture.count({ where: { gameweekId: id } }), prisma.lineup.count({ where: { gameweekId: id } })]);
  if (fixtures || lineupsCount) throw conflict('La jornada tiene partidos o alineaciones asociadas');
  await prisma.gameweek.delete({ where: { id } });
  res.json({ deleted: true });
});

adminRouter.post('/gameweeks/:id/process', async (req, res) => {
  const { final } = parse(z.object({ final: z.boolean().default(false) }), req.body ?? {});
  res.json(await processGameweek(intParam(req.params.id), { final }));
});

adminRouter.post('/gameweeks/:id/prices', async (req, res) => {
  res.json(await updatePricesForGameweek(intParam(req.params.id)));
});

adminRouter.post('/gameweeks/sync-statuses', async (_req, res) => {
  res.json({ finishedPending: await syncGameweekStatuses() });
});

// ─────────────── Partidos y estadísticas ───────────────
const fixtureSchema = z.object({
  gameweekId: z.number().int().positive(),
  homeClubId: z.number().int().positive(),
  awayClubId: z.number().int().positive(),
  kickoff: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(FIXTURE_STATUSES).default('SCHEDULED'),
  homeScore: z.number().int().min(0).max(20).nullable().default(null),
  awayScore: z.number().int().min(0).max(20).nullable().default(null),
  minute: z.number().int().min(0).max(130).default(0),
});

adminRouter.get('/fixtures', async (req, res) => {
  const { gameweek } = parse(z.object({ gameweek: z.coerce.number().int().optional() }), req.query);
  res.json(await prisma.fixture.findMany({ where: { gameweekId: gameweek }, include: { ...fixtureInclude, _count: { select: { statistics: true } } }, orderBy: [{ kickoff: 'asc' }] }));
});

adminRouter.post('/fixtures', async (req, res) => {
  const body = parse(fixtureSchema, req.body);
  if (body.homeClubId === body.awayClubId) throw badRequest('Un club no puede jugar contra sí mismo');
  res.status(201).json(await prisma.fixture.create({ data: { ...body, kickoff: body.kickoff ? new Date(body.kickoff) : null } }));
});

adminRouter.patch('/fixtures/:id', async (req, res) => {
  const id = intParam(req.params.id);
  const body = parse(fixtureSchema.partial(), req.body);
  if (body.status === 'FINISHED' && (body.homeScore === null || body.awayScore === null)) throw badRequest('Indica el resultado para finalizar el partido');
  const fixture = await prisma.fixture.update({
    where: { id },
    data: { ...body, kickoff: body.kickoff === undefined ? undefined : body.kickoff ? new Date(body.kickoff) : null },
  });
  await afterFixtureChange(fixture.gameweekId);
  res.json(fixture);
});

adminRouter.delete('/fixtures/:id', async (req, res) => {
  const id = intParam(req.params.id);
  if (await prisma.playerStatistic.count({ where: { fixtureId: id } })) throw conflict('El partido tiene estadísticas registradas');
  await prisma.fixture.delete({ where: { id } });
  res.json({ deleted: true });
});

adminRouter.get('/fixtures/:id/stats', async (req, res) => {
  const id = intParam(req.params.id);
  const fixture = await prisma.fixture.findUnique({ where: { id }, include: fixtureInclude });
  if (!fixture) throw notFound('Partido no encontrado');
  const [players, stats] = await Promise.all([
    prisma.player.findMany({
      where: { clubId: { in: [fixture.homeClubId, fixture.awayClubId] }, isActive: true },
      select: { id: true, displayName: true, position: true, clubId: true, squadNumber: true, club: { select: clubLiteSelect } },
      orderBy: [{ clubId: 'asc' }, { position: 'asc' }, { displayName: 'asc' }],
    }),
    prisma.playerStatistic.findMany({ where: { fixtureId: id } }),
  ]);
  res.json({ fixture, players, stats });
});

/** Registro manual de resultados: estadísticas de jugadores y cierre del partido. */
adminRouter.put('/fixtures/:id/stats', async (req, res) => {
  const id = intParam(req.params.id);
  const body = parse(
    z.object({
      homeScore: z.number().int().min(0).max(20),
      awayScore: z.number().int().min(0).max(20),
      status: z.enum(['LIVE', 'FINISHED']),
      stats: z.array(statLineSchema).max(60),
    }),
    req.body,
  );
  const fixture = await prisma.fixture.findUnique({ where: { id } });
  if (!fixture) throw notFound('Partido no encontrado');
  const players = await prisma.player.findMany({ where: { id: { in: body.stats.map((s) => s.playerId) } }, select: { id: true, clubId: true } });
  const clubOf = new Map(players.map((p) => [p.id, p.clubId]));

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.fixture.update({ where: { id }, data: { homeScore: body.homeScore, awayScore: body.awayScore, status: body.status, minute: body.status === 'FINISHED' ? 90 : fixture.minute } }),
  ];
  const keep: number[] = [];
  for (const s of body.stats) {
    const clubId = clubOf.get(s.playerId);
    if (!clubId || ![fixture.homeClubId, fixture.awayClubId].includes(clubId)) throw badRequest(`El jugador ${s.playerId} no pertenece a ninguno de los dos clubes`);
    if (s.minutes === 0) continue;
    keep.push(s.playerId);
    const conceded = clubId === fixture.homeClubId ? body.awayScore : body.homeScore;
    const line = {
      minutes: s.minutes,
      goals: s.goals,
      assists: s.assists,
      goalsConceded: s.goalsConceded ?? conceded,
      cleanSheet: s.cleanSheet ?? (conceded === 0 && s.minutes >= 60),
      ownGoals: s.ownGoals,
      penaltiesSaved: s.penaltiesSaved,
      penaltiesMissed: s.penaltiesMissed,
      yellowCards: s.yellowCards,
      redCards: s.redCards,
      saves: s.saves,
      bonus: s.bonus,
    };
    ops.push(
      prisma.playerStatistic.upsert({
        where: { playerId_fixtureId: { playerId: s.playerId, fixtureId: id } },
        create: { ...line, playerId: s.playerId, fixtureId: id, gameweekId: fixture.gameweekId, clubId },
        update: { ...line, gameweekId: fixture.gameweekId, clubId },
      }),
    );
  }
  ops.push(prisma.playerStatistic.deleteMany({ where: { fixtureId: id, playerId: { notIn: keep } } }));
  await prisma.$transaction(ops);
  await recalculateStatistics({ fixtureId: id });
  await afterFixtureChange(fixture.gameweekId);
  res.json({ saved: keep.length });
});

async function afterFixtureChange(gameweekId: number) {
  const finishedPending = await syncGameweekStatuses();
  const gw = await prisma.gameweek.findUnique({ where: { id: gameweekId } });
  if (!gw) return;
  if (finishedPending.includes(gameweekId)) await processGameweek(gameweekId, { final: true });
  else if (gw.status !== 'UPCOMING') await processGameweek(gameweekId, { final: gw.isProcessed });
}

// ─────────────── Reglas de puntuación ───────────────
adminRouter.get('/scoring-rules', async (_req, res) => {
  res.json({
    actions: SCORING_ACTIONS,
    positions: POSITIONS,
    rules: await prisma.scoringRule.findMany({ orderBy: [{ position: 'asc' }, { action: 'asc' }] }),
  });
});

adminRouter.put('/scoring-rules', async (req, res) => {
  const body = parse(
    z.object({
      rules: z
        .array(
          z.object({
            position: z.enum(POSITIONS),
            action: z.string().refine((a) => a in SCORING_ACTIONS, 'Acción desconocida'),
            points: z.number().int().min(-20).max(30),
            threshold: z.number().int().min(1).max(120),
            isActive: z.boolean(),
          }),
        )
        .min(1)
        .max(200),
      recalculate: z.boolean().default(true),
    }),
    req.body,
  );
  await prisma.$transaction(
    body.rules.map((r) =>
      prisma.scoringRule.upsert({
        where: { position_action: { position: r.position, action: r.action } },
        create: r,
        update: { points: r.points, threshold: r.threshold, isActive: r.isActive },
      }),
    ),
  );
  const result = body.recalculate ? await recalculateSeason() : null;
  res.json({ saved: body.rules.length, recalculated: result });
});

adminRouter.post('/scoring-rules/reset', async (_req, res) => {
  await prisma.$transaction([
    prisma.scoringRule.deleteMany(),
    prisma.scoringRule.createMany({
      data: DEFAULT_SCORING_RULES.map((r) => ({ ...r, threshold: r.threshold ?? SCORING_ACTIONS[r.action].defaultThreshold })),
    }),
  ]);
  res.json({ reset: true, recalculated: await recalculateSeason() });
});

adminRouter.post('/scoring-rules/preview', async (req, res) => {
  const body = parse(z.object({ position: z.enum(POSITIONS), stats: statLineSchema.omit({ playerId: true }).partial() }), req.body);
  const rules = await prisma.scoringRule.findMany();
  res.json(scorePerformance(body.position, { ...EMPTY_STATS, ...body.stats }, rules));
});

// ─────────────── Ligas ───────────────
adminRouter.get('/leagues', async (_req, res) => {
  res.json(
    await prisma.league.findMany({
      include: { owner: { select: { id: true, managerName: true } }, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
});
adminRouter.patch('/leagues/:id', async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(3).max(40).optional(), maxMembers: z.number().int().min(2).max(100000).optional() }), req.body);
  res.json(await leagues.updateLeague(req.user!.id, intParam(req.params.id), body, true));
});
adminRouter.delete('/leagues/:id', async (req, res) => {
  res.json(await leagues.deleteLeague(req.user!.id, intParam(req.params.id), true));
});

// ─────────────── Noticias ───────────────
const newsSchema = z.object({
  title: z.string().trim().min(5).max(120),
  summary: z.string().trim().min(5).max(300),
  content: z.string().trim().min(5).max(10000),
  category: z.enum(NEWS_CATEGORIES).default('GENERAL'),
  imageUrl: z.string().url().nullish(),
  clubId: z.number().int().positive().nullish(),
  playerId: z.number().int().positive().nullish(),
  published: z.boolean().default(true),
});
adminRouter.get('/news', async (_req, res) => {
  res.json(await prisma.news.findMany({ orderBy: { createdAt: 'desc' }, include: { club: { select: clubLiteSelect }, author: { select: { managerName: true } } } }));
});
adminRouter.post('/news', async (req, res) => {
  res.status(201).json(await prisma.news.create({ data: { ...parse(newsSchema, req.body), authorId: req.user!.id } }));
});
adminRouter.patch('/news/:id', async (req, res) => {
  res.json(await prisma.news.update({ where: { id: intParam(req.params.id) }, data: parse(newsSchema.partial(), req.body) }));
});
adminRouter.delete('/news/:id', async (req, res) => {
  await prisma.news.delete({ where: { id: intParam(req.params.id) } });
  res.json({ deleted: true });
});

// ─────────────── Configuración y avisos ───────────────
adminRouter.get('/settings', async (_req, res) => {
  res.json(describeSettings(await getSettings()));
});

adminRouter.patch('/settings', async (req, res) => {
  const body = parse(z.record(z.string(), z.unknown()), req.body);
  const before = await getSettings();
  const after = await updateSettings(body);
  if (before.market_open !== after.market_open) {
    const users = await prisma.user.findMany({ where: { isActive: true, team: { isNot: null } }, select: { id: true } });
    await notifyMany(
      users.map((u) => ({
        userId: u.id,
        type: 'MARKET' as const,
        title: after.market_open ? 'Se abrió el mercado' : 'Se cerró el mercado',
        message: after.market_open ? 'Ya puedes fichar y vender jugadores.' : 'Las operaciones de fichajes quedan suspendidas temporalmente.',
        link: '/market',
      })),
    );
  }
  res.json(describeSettings(after));
});

adminRouter.post('/notifications', async (req, res) => {
  const body = parse(z.object({ title: z.string().trim().min(3).max(100), message: z.string().trim().min(3).max(500), link: z.string().max(200).nullish() }), req.body);
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  await notifyMany(users.map((u) => ({ userId: u.id, type: 'SYSTEM' as const, title: body.title, message: body.message, link: body.link ?? undefined })));
  res.json({ sent: users.length });
});

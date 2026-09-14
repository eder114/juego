import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { intParam, parse } from '../lib/http';
import { notFound } from '../lib/errors';
import { parseCrest, userPublicSelect } from '../lib/dto';
import { requireAuth } from '../middleware/auth';
import { FORMATIONS, LEAGUE_TYPES } from '../domain/constants';
import * as squad from '../services/squad.service';
import * as lineups from '../services/lineup.service';
import * as leagues from '../services/league.service';
import { computeStandings, monthGameweekIds } from '../services/ranking.service';
import { dashboard, pointsHistory } from '../services/stats.service';
import { crestSchema, teamNameSchema } from './validators';

export const gameRouter = Router();
gameRouter.use(requireAuth);

// ─────────────── Dashboard ───────────────
gameRouter.get('/dashboard', async (req, res) => {
  res.json(await dashboard(req.user!.id));
});

// ─────────────── Equipo y mercado ───────────────
gameRouter.get('/team', async (req, res) => {
  res.json(await squad.getSquad(req.user!.id));
});

gameRouter.post('/team', async (req, res) => {
  const body = parse(z.object({ name: teamNameSchema, crest: crestSchema.optional() }), req.body);
  res.status(201).json(await squad.createTeam(req.user!.id, body));
});

gameRouter.patch('/team', async (req, res) => {
  const body = parse(z.object({ name: teamNameSchema.optional(), crest: crestSchema.optional() }), req.body);
  const team = await squad.updateTeam(req.user!.id, body);
  res.json({ ...team, crest: parseCrest(team.crest) });
});

gameRouter.post('/team/players/:playerId', async (req, res) => {
  res.status(201).json(await squad.buyPlayer(req.user!.id, intParam(req.params.playerId, 'playerId')));
});

gameRouter.delete('/team/players/:playerId', async (req, res) => {
  res.json(await squad.sellPlayer(req.user!.id, intParam(req.params.playerId, 'playerId')));
});

gameRouter.get('/team/transfers', async (req, res) => {
  res.json(await squad.getTransferHistory(req.user!.id));
});

gameRouter.get('/team/history', async (req, res) => {
  const team = await squad.getTeamByUser(req.user!.id);
  res.json(await pointsHistory(team.id));
});

// ─────────────── Alineación ───────────────
gameRouter.get('/team/lineup', async (req, res) => {
  const { gameweek } = parse(z.object({ gameweek: z.coerce.number().int().positive().optional() }), req.query);
  res.json(await lineups.getLineupView(req.user!.id, gameweek));
});

gameRouter.put('/team/lineup/:gameweekId', async (req, res) => {
  const body = parse(
    z.object({
      formation: z.enum(FORMATIONS),
      starters: z.array(z.number().int().positive()).length(11, 'Debes alinear 11 titulares'),
      bench: z.array(z.number().int().positive()).max(4),
      captainId: z.number().int().positive({ message: 'Debes elegir un capitán' }),
      viceCaptainId: z.number().int().positive().nullable(),
    }),
    req.body,
  );
  res.json(await lineups.saveLineup(req.user!.id, intParam(req.params.gameweekId, 'gameweekId'), body));
});

// Perfil público de un equipo y su alineación (visible cuando empieza la jornada)
gameRouter.get('/teams/:teamId', async (req, res) => {
  const teamId = intParam(req.params.teamId, 'teamId');
  const team = await prisma.fantasyTeam.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, crest: true, totalPoints: true, createdAt: true, user: { select: { ...userPublicSelect, favoriteClub: { select: { id: true, name: true, crestUrl: true } } } } },
  });
  if (!team) throw notFound('Equipo no encontrado');
  const { rows } = await computeStandings();
  res.json({ ...team, crest: parseCrest(team.crest), globalRank: rows.find((r) => r.teamId === teamId)?.rank ?? null, history: await pointsHistory(teamId) });
});

gameRouter.get('/teams/:teamId/lineup/:gameweekId', async (req, res) => {
  res.json(await lineups.getPublicLineupView(intParam(req.params.teamId, 'teamId'), intParam(req.params.gameweekId, 'gameweekId')));
});

// ─────────────── Clasificaciones ───────────────
gameRouter.get('/rankings', async (req, res) => {
  const q = parse(
    z.object({
      type: z.enum(['season', 'weekly', 'monthly']).default('season'),
      gameweek: z.coerce.number().int().positive().optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      leagueId: z.coerce.number().int().positive().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(50),
    }),
    req.query,
  );
  let userIds: string[] | undefined;
  let fromGameweek: number | undefined;
  if (q.leagueId) {
    const detail = await leagues.getLeagueDetail(req.user!.id, q.leagueId, req.user!.role === 'ADMIN');
    fromGameweek = detail.startGameweek;
    if (detail.type !== 'GLOBAL') {
      const members = await prisma.leagueMember.findMany({ where: { leagueId: q.leagueId }, select: { userId: true } });
      userIds = members.map((m) => m.userId);
    }
  }
  let gameweekIds: number[] | undefined;
  if (q.type === 'weekly') {
    const gw = q.gameweek ?? (await prisma.lineup.aggregate({ where: { gameweek: { status: { not: 'UPCOMING' } } }, _max: { gameweekId: true } }))._max.gameweekId;
    gameweekIds = gw ? [gw] : [];
  } else if (q.type === 'monthly') {
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    gameweekIds = await monthGameweekIds(month);
  }
  const { rows, lastGameweekId } = await computeStandings({ userIds, fromGameweek: gameweekIds ? undefined : fromGameweek, gameweekIds });
  const start = (q.page - 1) * q.pageSize;
  const me = rows.find((r) => r.userId === req.user!.id) ?? null;
  res.json({
    type: q.type,
    gameweekIds,
    lastGameweekId,
    total: rows.length,
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.slice(start, start + q.pageSize).map((r) => (q.type === 'season' ? r : { ...r, movement: 'same', previousRank: null })),
    me,
  });
});

gameRouter.get('/rankings/months', async (_req, res) => {
  const gws = await prisma.gameweek.findMany({ where: { status: { not: 'UPCOMING' } }, select: { deadline: true }, orderBy: { id: 'asc' } });
  res.json([...new Set(gws.map((g) => g.deadline.toISOString().slice(0, 7)))]);
});

// ─────────────── Ligas ───────────────
gameRouter.get('/leagues', async (req, res) => {
  res.json(await leagues.listMyLeagues(req.user!.id));
});

gameRouter.get('/leagues/public', async (req, res) => {
  const { search } = parse(z.object({ search: z.string().trim().max(50).optional() }), req.query);
  res.json(await leagues.listPublicLeagues(req.user!.id, search));
});

gameRouter.get('/leagues/types', (_req, res) => {
  res.json(leagues.LEAGUE_TYPE_INFO);
});

gameRouter.get('/leagues/invites', async (req, res) => {
  res.json(await leagues.listMyInvites(req.user!.id));
});

gameRouter.post('/leagues/invites/:id', async (req, res) => {
  const { accept } = parse(z.object({ accept: z.boolean() }), req.body);
  res.json(await leagues.respondInvite(req.user!.id, intParam(req.params.id), accept));
});

gameRouter.post('/leagues', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres').max(40),
      description: z.string().trim().max(200).nullish(),
      type: z.enum(LEAGUE_TYPES).exclude(['GLOBAL']),
      password: z.string().min(4, 'La contraseña de liga debe tener al menos 4 caracteres').max(50).nullish(),
      maxMembers: z.number().int().min(2).max(500).default(20),
      startGameweek: z.number().int().min(1).max(38).optional(),
    }),
    req.body,
  );
  res.status(201).json(await leagues.createLeague(req.user!.id, body));
});

gameRouter.post('/leagues/join', async (req, res) => {
  const body = parse(z.object({ code: z.string().trim().min(4).max(12), password: z.string().max(50).nullish() }), req.body);
  res.json(await leagues.joinByCode(req.user!.id, body.code, body.password));
});

gameRouter.post('/leagues/:id/join', async (req, res) => {
  res.json(await leagues.joinPublic(req.user!.id, intParam(req.params.id)));
});

gameRouter.get('/leagues/:id', async (req, res) => {
  res.json(await leagues.getLeagueDetail(req.user!.id, intParam(req.params.id), req.user!.role === 'ADMIN'));
});

gameRouter.patch('/leagues/:id', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(3).max(40).optional(),
      description: z.string().trim().max(200).nullish(),
      maxMembers: z.number().int().min(2).max(500).optional(),
      password: z.string().min(4).max(50).nullable().optional(),
    }),
    req.body,
  );
  res.json(await leagues.updateLeague(req.user!.id, intParam(req.params.id), body));
});

gameRouter.delete('/leagues/:id', async (req, res) => {
  res.json(await leagues.deleteLeague(req.user!.id, intParam(req.params.id), req.user!.role === 'ADMIN'));
});

gameRouter.post('/leagues/:id/leave', async (req, res) => {
  res.json(await leagues.leaveLeague(req.user!.id, intParam(req.params.id)));
});

gameRouter.post('/leagues/:id/invite', async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(3).max(120) }), req.body);
  res.json(await leagues.inviteToLeague(req.user!.id, intParam(req.params.id), identifier));
});

gameRouter.delete('/leagues/:id/members/:userId', async (req, res) => {
  const memberId = parse(z.string().min(10).max(40), req.params.userId);
  res.json(await leagues.removeMember(req.user!.id, intParam(req.params.id), memberId, req.user!.role === 'ADMIN'));
});

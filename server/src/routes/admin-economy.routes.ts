import { Router } from 'express';
import { z } from 'zod';
import { icontains, prisma } from '../lib/prisma';
import { intParam, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { CARD_RARITIES } from '../domain/constants';
import { formatK } from '../domain/economy';
import * as market from '../services/market.service';
import { adminGrantCard, ensureCardCatalog } from '../services/card.service';
import { listCoaches, syncCoaches } from '../services/coach.service';
import { ensureCoachValuations, ensurePlayerValuations, recalibrateAllValues, recomputeRarities, setPlayerValue } from '../services/valuation.service';
import { challengeStats } from '../services/challenge.service';
import { changeWallet } from '../services/economy.service';

/** Administración de la economía de liga, cartas, entrenadores y desafíos. */
export const adminEconomyRouter = Router();
adminEconomyRouter.use(requireAuth, requireAdmin);

adminEconomyRouter.get('/overview', async (_req, res) => {
  const [leagues, teams, classicTeams, cards, teamCards, coaches, activeCoaches, valued, wordle, audit] = await Promise.all([
    prisma.league.findMany({
      where: { type: { not: 'GLOBAL' } },
      select: { id: true, name: true, type: true, economyVersion: true, marketTimezone: true, marketResetMinute: true, marketPityCounter: true, createdAt: true, _count: { select: { members: true, economyTeams: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.fantasyTeam.count({ where: { economyLeagueId: { not: null } } }),
    prisma.fantasyTeam.count({ where: { economyVersion: 1 } }),
    prisma.powerUpCard.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { inventory: true } } } }),
    prisma.teamCard.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.coach.count(),
    prisma.coach.count({ where: { isActive: true } }),
    prisma.player.count({ where: { marketValue: { not: null } } }),
    challengeStats(),
    prisma.marketAuditLog.findMany({ orderBy: { id: 'desc' }, take: 30 }),
  ]);
  res.json({
    leagues: leagues.map((l) => ({ ...l, resetTime: market.leagueResetMinute(l) })),
    teams: { inLeagueEconomy: teams, classic: classicTeams },
    cards,
    teamCards: Object.fromEntries(teamCards.map((t) => [t.status, t._count._all])),
    coaches: { total: coaches, active: activeCoaches },
    playersValued: valued,
    wordle,
    audit,
  });
});

// ─────────────── Ligas ───────────────
adminEconomyRouter.get('/leagues/:id', async (req, res) => {
  const leagueId = intParam(req.params.id);
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) throw notFound('Liga no encontrada');
  const [summary, current, audit] = await Promise.all([
    market.leagueEconomySummary(leagueId, req.user!.id),
    league.economyVersion === 2 ? market.adminCurrentMarket(leagueId) : null,
    market.marketAuditLog(leagueId, 80),
  ]);
  res.json({ league: { id: league.id, name: league.name, economyVersion: league.economyVersion }, summary, current, audit });
});

adminEconomyRouter.post('/leagues/:id/migrate', async (req, res) => {
  parse(z.object({ confirm: z.literal(true, { errorMap: () => ({ message: 'Confirma la migración' }) }) }), req.body);
  res.json(await market.migrateLeagueToV2(intParam(req.params.id), req.user!.id));
});

adminEconomyRouter.post('/leagues/:id/reset', async (req, res) => {
  parse(z.object({ confirm: z.literal('REINICIALIZAR', { errorMap: () => ({ message: 'Escribe REINICIALIZAR para confirmar' }) }) }), req.body);
  res.json(await market.resetLeagueEconomy(intParam(req.params.id), req.user!.id));
});

adminEconomyRouter.patch('/leagues/:id/schedule', async (req, res) => {
  const body = parse(z.object({ timezone: z.string().trim().min(3).max(60).optional(), resetTime: z.string().trim().optional() }), req.body);
  res.json(await market.updateMarketSchedule(intParam(req.params.id), body));
});

// ─────────────── Monederos ───────────────
adminEconomyRouter.post('/teams/:id/wallet', async (req, res) => {
  const teamId = intParam(req.params.id);
  const body = parse(z.object({ amount: z.number().int().min(-500000).max(500000).refine((n) => n !== 0, 'El importe no puede ser 0'), description: z.string().trim().min(3).max(120) }), req.body);
  const team = await prisma.fantasyTeam.findUnique({ where: { id: teamId } });
  if (!team) throw notFound('Equipo no encontrado');
  if (team.economyVersion !== 2) throw badRequest('Este equipo usa el sistema clásico: ajusta su presupuesto desde Usuarios');
  const wallet = await prisma.$transaction((tx) =>
    changeWallet(tx, { teamId, amount: body.amount, type: 'ADMIN_ADJUSTMENT', description: `${body.description} (administración)`, userId: req.user!.id, leagueId: team.economyLeagueId, reference: `admin:${req.user!.id}` }),
  );
  res.json({ wallet, formatted: formatK(wallet) });
});

// ─────────────── Valores y rareza ───────────────
adminEconomyRouter.put('/players/:id/value', async (req, res) => {
  const body = parse(z.object({ value: z.number().int().positive() }), req.body);
  res.json(await setPlayerValue(intParam(req.params.id), body.value));
});

adminEconomyRouter.post('/valuations/recalibrate', async (_req, res) => {
  res.json(await recalibrateAllValues());
});

adminEconomyRouter.post('/valuations/rarities', async (_req, res) => {
  await ensurePlayerValuations();
  await ensureCoachValuations();
  res.json(await recomputeRarities());
});

// ─────────────── Entrenadores ───────────────
adminEconomyRouter.get('/coaches', async (_req, res) => {
  res.json(await listCoaches());
});

adminEconomyRouter.post('/coaches/sync', async (_req, res) => {
  res.json(await syncCoaches());
});

// ─────────────── Cartas ───────────────
adminEconomyRouter.patch('/cards/:id', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(3).max(40).optional(),
      description: z.string().trim().min(10).max(400).optional(),
      rarity: z.enum(CARD_RARITIES).optional(),
      effectValue: z.number().int().min(1).max(500).optional(),
      maxPerGameweek: z.number().int().min(1).max(5).optional(),
      isActive: z.boolean().optional(),
      obtainable: z.boolean().optional(),
    }),
    req.body,
  );
  const card = await prisma.powerUpCard.findUnique({ where: { id: intParam(req.params.id) } });
  if (!card) throw notFound('Carta no encontrada');
  if (body.effectValue !== undefined) {
    if (card.effect === 'DOUBLE_POINTS' && (body.effectValue < 101 || body.effectValue > 300)) throw badRequest('Doble puntos: el multiplicador debe estar entre 101 % y 300 %');
    if (card.effect === 'WEAKEN' && (body.effectValue < 1 || body.effectValue > 100)) throw badRequest('Presión: el porcentaje debe estar entre 1 y 100');
  }
  res.json(await prisma.powerUpCard.update({ where: { id: card.id }, data: body }));
});

adminEconomyRouter.post('/cards/restore-defaults', async (_req, res) => {
  await ensureCardCatalog();
  res.json(await prisma.powerUpCard.findMany({ orderBy: { id: 'asc' } }));
});

adminEconomyRouter.post('/cards/grant', async (req, res) => {
  const body = parse(z.object({ teamId: z.number().int().positive(), cardCode: z.string().trim().min(2).max(40) }), req.body);
  res.status(201).json(await adminGrantCard(body.teamId, body.cardCode, req.user!.id));
});

adminEconomyRouter.get('/teams', async (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(60).optional() }), req.query);
  res.json(
    await prisma.fantasyTeam.findMany({
      where: q.search ? { OR: [{ name: icontains(q.search) }, { user: { managerName: icontains(q.search) } }] } : {},
      select: { id: true, name: true, economyVersion: true, wallet: true, budget: true, economyLeague: { select: { id: true, name: true } }, user: { select: { managerName: true } } },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  );
});

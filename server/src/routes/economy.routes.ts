import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { intParam, parse } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import * as market from '../services/market.service';
import * as cards from '../services/card.service';
import * as challenges from '../services/challenge.service';
import { listTransactions } from '../services/economy.service';
import { valuationHistory } from '../services/valuation.service';
import { getTeamByUser } from '../services/squad.service';
import { requireLeagueAdmin } from '../services/league.service';

/** Economía de liga: mercado compartido, cartas, desafíos diarios y movimientos. */
export const economyRouter = Router();
economyRouter.use(requireAuth);

// Límite adicional para acciones sensibles (compras, cartas, intentos): evita ráfagas automatizadas
const actionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiadas acciones seguidas. Espera un momento.' } },
});

// ─────────────── Mercado de la liga ───────────────
economyRouter.get('/market/league', async (req, res) => {
  res.json(await market.getMarketView(req.user!.id));
});

economyRouter.post('/market/league/listings/:listingId/buy', actionLimiter, async (req, res) => {
  res.status(201).json(await market.buyListing(req.user!.id, intParam(req.params.listingId, 'listingId')));
});

economyRouter.post('/market/league/players/:playerId/sell', actionLimiter, async (req, res) => {
  res.json(await market.sellPlayerV2(req.user!.id, intParam(req.params.playerId, 'playerId')));
});

economyRouter.post('/market/league/coaches/:coachId/sell', actionLimiter, async (req, res) => {
  res.json(await market.sellCoach(req.user!.id, intParam(req.params.coachId, 'coachId')));
});

economyRouter.post('/leagues/:id/economy/join', actionLimiter, async (req, res) => {
  const body = parse(z.object({ confirmReplaceSquad: z.boolean().optional() }), req.body ?? {});
  res.status(201).json(await market.joinEconomy(req.user!.id, intParam(req.params.id), body));
});

economyRouter.patch('/leagues/:id/economy/schedule', async (req, res) => {
  const leagueId = intParam(req.params.id);
  await requireLeagueAdmin(leagueId, req.user!.id, req.user!.role === 'ADMIN');
  const body = parse(z.object({ timezone: z.string().trim().min(3).max(60).optional(), resetTime: z.string().trim().optional() }), req.body);
  res.json(await market.updateMarketSchedule(leagueId, body));
});

// ─────────────── Movimientos económicos y valores ───────────────
economyRouter.get('/economy/transactions', async (req, res) => {
  const q = parse(z.object({ cursor: z.coerce.number().int().positive().optional(), take: z.coerce.number().int().min(1).max(100).optional() }), req.query);
  const team = await getTeamByUser(req.user!.id);
  res.json({ economyVersion: team.economyVersion, wallet: team.wallet, budget: team.budget, ...(await listTransactions(team.id, q)) });
});

economyRouter.get('/players/:id/valuations', async (req, res) => {
  res.json(await valuationHistory(intParam(req.params.id)));
});

// ─────────────── Cartas ───────────────
economyRouter.get('/cards', async (req, res) => {
  res.json(await cards.getCards(req.user!.id));
});

economyRouter.get('/cards/rivals', async (req, res) => {
  res.json(await cards.rivalTargets(req.user!.id));
});

economyRouter.get('/cards/teams/:teamId/players', async (req, res) => {
  res.json(await cards.targetSquad(req.user!.id, intParam(req.params.teamId, 'teamId')));
});

economyRouter.post('/cards/activate', actionLimiter, async (req, res) => {
  const body = parse(
    z.object({
      teamCardId: z.number().int().positive(),
      targetPlayerId: z.number().int().positive({ message: 'Elige un jugador' }),
      targetTeamId: z.number().int().positive().nullable().optional(),
      requestId: z.string().uuid('Identificador de petición no válido'),
    }),
    req.body,
  );
  res.status(201).json(await cards.activateCard(req.user!.id, body));
});

economyRouter.post('/cards/activations/:id/cancel', actionLimiter, async (req, res) => {
  res.json(await cards.cancelActivation(req.user!.id, intParam(req.params.id)));
});

// ─────────────── Desafíos diarios ───────────────
economyRouter.get('/challenges', async (req, res) => {
  const [wordle, history] = await Promise.all([challenges.getWordleState(req.user!.id), challenges.challengeHistory(req.user!.id)]);
  res.json({ wordle, history });
});

economyRouter.post('/challenges/wordle/guess', actionLimiter, async (req, res) => {
  const body = parse(z.object({ guess: z.string().trim().min(1).max(12) }), req.body);
  res.json(await challenges.submitWordleGuess(req.user!.id, body.guess));
});

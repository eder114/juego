/**
 * Pruebas de integración de la economía de liga contra una COPIA de la base de datos real de desarrollo
 * (jugadores, clubes, jornadas y entrenadores reales). La base original no se modifica.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../prisma/dev.db');
const tmpDir = path.resolve(here, '.tmp');
const dbFile = path.join(tmpDir, `economy-${process.pid}.db`);
const hasDb = existsSync(source);

if (hasDb) {
  mkdirSync(tmpDir, { recursive: true });
  copyFileSync(source, dbFile);
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, '/')}`;
  process.env.NODE_ENV = 'test';
}

type Mods = {
  prisma: typeof import('../src/lib/prisma')['prisma'];
  market: typeof import('../src/services/market.service');
  leagues: typeof import('../src/services/league.service');
  squad: typeof import('../src/services/squad.service');
  cards: typeof import('../src/services/card.service');
  challenges: typeof import('../src/services/challenge.service');
  valuation: typeof import('../src/services/valuation.service');
  settings: typeof import('../src/services/settings.service');
  economy: typeof import('../src/domain/economy');
};
let m: Mods;
const users: { id: string; name: string }[] = [];
let leagueId = 0;
let leagueCode = '';

async function createUser(label: string) {
  const id = crypto.randomUUID().slice(0, 8);
  const user = await m.prisma.user.create({ data: { email: `qa-${label}-${id}@test.local`, passwordHash: 'x', managerName: `QA ${label} ${id}` } });
  await m.squad.createTeam(user.id, { name: `QA ${label}` });
  return { id: user.id, name: label };
}

const teamOf = (userId: string) => m.prisma.fantasyTeam.findUniqueOrThrow({ where: { userId } });

describe.skipIf(!hasDb)('economía de liga (integración)', () => {
  beforeAll(async () => {
    m = {
      prisma: (await import('../src/lib/prisma')).prisma,
      market: await import('../src/services/market.service'),
      leagues: await import('../src/services/league.service'),
      squad: await import('../src/services/squad.service'),
      cards: await import('../src/services/card.service'),
      challenges: await import('../src/services/challenge.service'),
      valuation: await import('../src/services/valuation.service'),
      settings: await import('../src/services/settings.service'),
      economy: await import('../src/domain/economy'),
    };
    await m.cards.ensureCardCatalog();
    await m.valuation.ensurePlayerValuations();
    for (const label of ['A', 'B', 'C', 'D']) users.push(await createUser(label));
    const league = await m.leagues.createLeague(users[0].id, { name: 'QA Liga Economía', type: 'PRIVATE', maxMembers: 10 });
    leagueId = league.id;
    leagueCode = league.code;
    for (const u of users.slice(1)) await m.leagues.joinByCode(u.id, leagueCode);
  }, 120_000);

  afterAll(async () => {
    await m?.prisma.$disconnect();
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-journal`, { force: true });
  });

  describe('equipo inicial', () => {
    it('cada mánager recibe 13 jugadores reales (11 + 2), sin repetidos en la liga, y £100M', async () => {
      const all: number[] = [];
      for (const u of users) {
        const team = await teamOf(u.id);
        expect(team.economyVersion).toBe(2);
        expect(team.economyLeagueId).toBe(leagueId);
        expect(team.wallet).toBe(100000);
        const squad = await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id }, include: { player: true } });
        expect(squad).toHaveLength(13);
        const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<string, number>;
        for (const s of squad) counts[s.player.position]++;
        expect(m.economy.canFieldEleven(counts as never)).toBe(true);
        expect(squad.every((s) => s.player.isActive && s.player.marketValue !== null)).toBe(true);
        all.push(...squad.map((s) => s.playerId));
        const initial = await m.prisma.transaction.findFirst({ where: { teamId: team.id, type: 'INITIAL_BUDGET', currency: 'K' } });
        expect(initial?.amount).toBe(100000);
        expect(initial?.balanceBefore).toBe(0);
        expect(initial?.balanceAfter).toBe(100000);
      }
      expect(new Set(all).size).toBe(all.length);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId } })).toBe(52);
    });

    it('la restricción única liga + jugador impide dos dueños', async () => {
      const own = await m.prisma.leaguePlayerOwnership.findFirstOrThrow({ where: { leagueId } });
      const other = await teamOf(users[1].id);
      await expect(
        m.prisma.leaguePlayerOwnership.create({ data: { leagueId, playerId: own.playerId, teamId: other.id, purchasePrice: 1, source: 'MARKET' } }),
      ).rejects.toThrow();
    });

    it('el mercado libre clásico está bloqueado para equipos de la economía de liga', async () => {
      await expect(m.squad.buyPlayer(users[0].id, 1)).rejects.toThrow(/economía de liga/);
    });
  });

  describe('mercado diario compartido', () => {
    it('un único ciclo con 10 jugadores y 1–2 entrenadores, igual para todos', async () => {
      const cycles = await Promise.all([1, 2, 3, 4, 5].map(() => m.market.getCurrentCycle(leagueId)));
      expect(new Set(cycles.map((c) => c.id)).size).toBe(1);
      expect(await m.prisma.marketCycle.count({ where: { leagueId } })).toBe(1);
      const listings = await m.prisma.marketListing.findMany({ where: { cycleId: cycles[0].id } });
      const players = listings.filter((l) => l.assetType === 'PLAYER');
      const coaches = listings.filter((l) => l.assetType === 'COACH');
      expect(players).toHaveLength(10);
      expect(new Set(players.map((p) => p.playerId)).size).toBe(10);
      const availableCoaches = await m.prisma.coach.count({ where: { isActive: true, marketValue: { gt: 0 } } });
      if (availableCoaches > 0) {
        expect(coaches.length).toBeGreaterThanOrEqual(1);
        expect(coaches.length).toBeLessThanOrEqual(2);
      }
      const owned = new Set((await m.prisma.leaguePlayerOwnership.findMany({ where: { leagueId } })).map((o) => o.playerId));
      expect(players.some((p) => owned.has(p.playerId!))).toBe(false);
      const [a, b] = await Promise.all([m.market.getMarketView(users[0].id), m.market.getMarketView(users[1].id)]);
      if (a.mode !== 'LEAGUE' || b.mode !== 'LEAGUE') throw new Error('modo inesperado');
      expect(a.players.map((p) => p.id)).toEqual(b.players.map((p) => p.id));
    });

    it('el contador de pity se actualiza según la rareza aparecida', async () => {
      const cycle = await m.market.getCurrentCycle(leagueId);
      const listings = await m.prisma.marketListing.findMany({ where: { cycleId: cycle.id, assetType: 'PLAYER' } });
      const league = await m.prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
      const high = listings.some((l) => m.economy.rarityAtLeast(l.rarity, 'EPIC'));
      expect(league.marketPityCounter).toBe(high ? 0 : cycle.pityBefore + 1);
    });

    it('compra simultánea: solo un usuario consigue el jugador y al otro no se le cobra', async () => {
      const cycle = await m.market.getCurrentCycle(leagueId);
      const [tb, tc] = [await teamOf(users[1].id), await teamOf(users[2].id)];
      const listings = await m.prisma.marketListing.findMany({ where: { cycleId: cycle.id, assetType: 'PLAYER', status: 'AVAILABLE' }, include: { player: true }, orderBy: { listingPrice: 'asc' } });
      // Un anuncio que ambos pueden comprar según su plantilla
      const squadOf = async (teamId: number) => (await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId }, include: { player: true } })).map((s) => s.player);
      const [sb, sc] = [await squadOf(tb.id), await squadOf(tc.id)];
      const fits = (squad: { clubId: number; position: string }[], p: { clubId: number; position: string }) =>
        squad.filter((x) => x.clubId === p.clubId).length < 3 && squad.filter((x) => x.position === p.position).length < 5;
      const target = listings.find((l) => l.listingPrice <= 100000 && fits(sb, l.player!) && fits(sc, l.player!));
      expect(target).toBeTruthy();

      const results = await Promise.allSettled([m.market.buyListing(users[1].id, target!.id), m.market.buyListing(users[2].id, target!.id)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason.message).toBe(m.market.SOLD_MESSAGE);

      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: target!.id } });
      expect(listing.status).toBe('SOLD');
      const winnerTeam = listing.buyerTeamId === tb.id ? tb : tc;
      const loserTeam = winnerTeam.id === tb.id ? tc : tb;
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: winnerTeam.id } })).wallet).toBe(100000 - target!.listingPrice);
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: loserTeam.id } })).wallet).toBe(100000);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId, playerId: target!.playerId! } })).toBe(1);
      expect(await m.prisma.transaction.count({ where: { reference: `listing:${target!.id}` } })).toBe(1);
      const rejected = await m.prisma.marketAuditLog.count({ where: { leagueId, action: 'PURCHASE_REJECTED' } });
      expect(rejected).toBeGreaterThanOrEqual(1);
      // Un tercer intento sobre el anuncio vendido también falla con el mensaje claro
      await expect(m.market.buyListing(users[3].id, target!.id)).rejects.toThrow(m.market.SOLD_MESSAGE);
    });

    it('sin presupuesto la compra se rechaza y el anuncio sigue disponible (la transacción se deshace)', async () => {
      const cycle = await m.market.getCurrentCycle(leagueId);
      const td = await teamOf(users[3].id);
      await m.prisma.fantasyTeam.update({ where: { id: td.id }, data: { wallet: 100 } });
      const listing = await m.prisma.marketListing.findFirstOrThrow({ where: { cycleId: cycle.id, status: 'AVAILABLE', listingPrice: { gt: 100 } } });
      await expect(m.market.buyListing(users[3].id, listing.id)).rejects.toThrow(/Presupuesto insuficiente/);
      expect((await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('AVAILABLE');
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: td.id } })).wallet).toBe(100);
      await m.prisma.fantasyTeam.update({ where: { id: td.id }, data: { wallet: 100000 } });
    });

    it('venta: devuelve el valor al monedero, libera al jugador y aplica el cooldown', async () => {
      const buyer = await m.prisma.leaguePlayerOwnership.findFirstOrThrow({ where: { leagueId, source: 'MARKET' }, include: { team: true, player: true } });
      const before = buyer.team.wallet;
      const result = await m.market.sellPlayerV2(buyer.team.userId, buyer.playerId);
      expect(result.salePrice).toBe(buyer.player.marketValue);
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: buyer.teamId } })).wallet).toBe(before + result.salePrice);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId, playerId: buyer.playerId } })).toBe(0);
      const cooldown = await m.prisma.leagueAssetCooldown.findFirstOrThrow({ where: { leagueId, assetType: 'PLAYER', assetId: buyer.playerId } });
      expect(cooldown.availableAt.getTime()).toBeGreaterThan(Date.now());
      await expect(m.market.sellPlayerV2(buyer.team.userId, buyer.playerId)).rejects.toThrow();
      // El ciclo siguiente no puede incluir al jugador en cooldown
      const next = await m.market.getCurrentCycle(leagueId, new Date(Date.now() + 26 * 3600 * 1000));
      const nextListings = await m.prisma.marketListing.findMany({ where: { cycleId: next.id } });
      expect(nextListings.some((l) => l.playerId === buyer.playerId)).toBe(false);
      expect(next.startsAt.getTime()).toBeGreaterThan(Date.now());
      await m.prisma.marketCycle.delete({ where: { id: next.id } });
    });
  });

  describe('Wordle diario', () => {
    const answerOf = async () => {
      const s = await m.settings.getSettings();
      const date = m.economy.localDateKey(new Date(), s.challenge_timezone);
      const ch = await m.prisma.dailyChallenge.findUniqueOrThrow({ where: { type_challengeDate: { type: 'WORDLE', challengeDate: date } } });
      return { answer: JSON.parse(ch.secret).word as string, challengeId: ch.id };
    };
    const wrongWord = (answer: string) => (answer === 'CAMPO' ? 'BALON' : 'CAMPO');

    it('la palabra no se revela antes de terminar y todos juegan la misma', async () => {
      const state = await m.challenges.getWordleState(users[0].id);
      expect(state.answer).toBeNull();
      expect(state.maxAttempts).toBe(6);
      const first = await m.challenges.submitWordleGuess(users[0].id, 'LIDER');
      expect(first.answer === null || first.completed).toBe(true);
      const { challengeId } = await answerOf();
      await m.challenges.submitWordleGuess(users[1].id, 'LIDER').catch(() => undefined);
      const attempts = await m.prisma.dailyChallengeAttempt.findMany({ where: { userId: { in: [users[0].id, users[1].id] } } });
      expect(attempts.every((a) => a.challengeId === challengeId)).toBe(true);
    });

    it('peticiones simultáneas no cuentan intentos de más; 6 intentos como máximo; recargar no reinicia', async () => {
      const { answer } = await answerOf();
      const user = users[0].id;
      const already = (await m.challenges.getWordleState(user)).attemptsUsed;
      const burst = await Promise.allSettled(Array.from({ length: 4 }, () => m.challenges.submitWordleGuess(user, wrongWord(answer))));
      const accepted = burst.filter((r) => r.status === 'fulfilled').length;
      const after = await m.challenges.getWordleState(user);
      expect(after.attemptsUsed).toBe(Math.min(6, already + accepted));
      expect(after.guesses).toHaveLength(after.attemptsUsed);
      while (!(await m.challenges.getWordleState(user)).completed) await m.challenges.submitWordleGuess(user, wrongWord(answer));
      const done = await m.challenges.getWordleState(user);
      expect(done.attemptsUsed).toBe(6);
      expect(done.won).toBe(false);
      expect(done.answer).toBe(answer);
      await expect(m.challenges.submitWordleGuess(user, answer)).rejects.toThrow(/Ya has jugado/);
      // Nueva lectura (equivale a recargar o volver a iniciar sesión): el estado viene de la base de datos
      expect((await m.challenges.getWordleState(user)).completed).toBe(true);
    });

    it('acertar en el 3.er intento paga £750.000 una sola vez aunque se repitan peticiones', async () => {
      const { answer } = await answerOf();
      const user = users[2].id;
      const team = await teamOf(user);
      await m.challenges.submitWordleGuess(user, wrongWord(answer));
      await m.challenges.submitWordleGuess(user, wrongWord(answer));
      const results = await Promise.allSettled([m.challenges.submitWordleGuess(user, answer), m.challenges.submitWordleGuess(user, answer), m.challenges.submitWordleGuess(user, answer)]);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const state = await m.challenges.getWordleState(user);
      expect(state.won).toBe(true);
      expect(state.attemptsUsed).toBe(3);
      expect(state.reward?.amount).toBe(750);
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: team.id } })).wallet).toBe(team.wallet + 750);
      expect(await m.prisma.transaction.count({ where: { teamId: team.id, type: 'DAILY_CHALLENGE_REWARD' } })).toBe(1);
      expect(await m.prisma.dailyChallengeReward.count({ where: { userId: user } })).toBe(1);
      expect(state.streak.current).toBe(1);
    });
  });

  describe('cartas', () => {
    let gwId = 0;
    it('activación antes del cierre, idempotente y de un solo uso', async () => {
      const a = await teamOf(users[0].id);
      const granted = await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: a.id, cardCode: 'DOUBLE_POINTS', source: 'EVENT', sourceRef: `qa:${a.id}:double` }));
      expect(granted).toBeTruthy();
      // La misma concesión no duplica la carta
      expect(await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: a.id, cardCode: 'DOUBLE_POINTS', source: 'EVENT', sourceRef: `qa:${a.id}:double` }))).toBeNull();
      const own = await m.prisma.fantasyTeamPlayer.findFirstOrThrow({ where: { teamId: a.id } });
      const requestId = crypto.randomUUID();
      const first = await m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId });
      gwId = first.gameweekId!;
      const repeat = await m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId });
      expect(repeat.duplicate).toBe(true);
      expect(repeat.activationId).toBe(first.activationId);
      await expect(m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId: crypto.randomUUID() })).rejects.toThrow(/ya se ha usado/);

      // Cancelar devuelve la carta; dos activaciones simultáneas con distinto requestId → solo una prospera
      await m.cards.cancelActivation(users[0].id, first.activationId);
      const race = await Promise.allSettled([
        m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId: crypto.randomUUID() }),
        m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId: crypto.randomUUID() }),
      ]);
      expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await m.prisma.cardActivation.count({ where: { teamCardId: granted!.id, status: 'ACTIVE' } })).toBe(1);
    });

    it('presión contra un rival de la liga y límite por jugador objetivo', async () => {
      const [a, b, c] = [await teamOf(users[0].id), await teamOf(users[1].id), await teamOf(users[2].id)];
      const target = await m.prisma.fantasyTeamPlayer.findFirstOrThrow({ where: { teamId: a.id }, orderBy: { playerId: 'desc' } });
      const cardB = await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: b.id, cardCode: 'PRESSURE', source: 'EVENT', sourceRef: `qa:${b.id}:pressure` }));
      const cardC = await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: c.id, cardCode: 'PRESSURE', source: 'EVENT', sourceRef: `qa:${c.id}:pressure` }));
      await m.cards.activateCard(users[1].id, { teamCardId: cardB!.id, targetPlayerId: target.playerId, targetTeamId: a.id, requestId: crypto.randomUUID() });
      await expect(m.cards.activateCard(users[2].id, { teamCardId: cardC!.id, targetPlayerId: target.playerId, targetTeamId: a.id, requestId: crypto.randomUUID() })).rejects.toThrow(/bajo presión/);
      const { byTeam } = await m.cards.cardModifiersForGameweek(gwId);
      expect(byTeam.get(a.id)?.get(target.playerId)).toEqual([{ effect: 'WEAKEN', value: 20 }]);
    });

    it('tras el cierre de la jornada la carta ya no se puede modificar', async () => {
      const a = await teamOf(users[0].id);
      const act = await m.prisma.cardActivation.findFirstOrThrow({ where: { teamId: a.id, status: 'ACTIVE' } });
      const gw = await m.prisma.gameweek.findUniqueOrThrow({ where: { id: act.gameweekId } });
      await m.prisma.gameweek.update({ where: { id: gw.id }, data: { deadline: new Date(Date.now() - 60_000) } });
      try {
        await expect(m.cards.cancelActivation(users[0].id, act.id)).rejects.toThrow(/cerrado/);
      } finally {
        await m.prisma.gameweek.update({ where: { id: gw.id }, data: { deadline: gw.deadline } });
      }
    });
  });

  describe('cartas en el motor de puntuación', () => {
    it('doble puntos suma exactamente los puntos del jugador al total de la jornada y queda aplicada', async () => {
      const scoring = await import('../src/services/scoring.service');
      const gw = await m.prisma.gameweek.findFirstOrThrow({ where: { isProcessed: true }, orderBy: { id: 'desc' } });
      // Alineación real ya puntuada con un titular que sumó puntos y sin capitanía (multiplicador 1)
      const lp = await m.prisma.lineupPlayer.findFirstOrThrow({ where: { lineup: { gameweekId: gw.id }, role: 'STARTER', multiplier: 1, points: { gt: 0 } }, include: { lineup: true } });
      const teamCard = await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: lp.lineup.teamId, cardCode: 'DOUBLE_POINTS', source: 'EVENT', sourceRef: `qa:scoring:${lp.id}` }));
      await m.prisma.teamCard.update({ where: { id: teamCard!.id }, data: { status: 'ACTIVE' } });
      const card = await m.prisma.powerUpCard.findUniqueOrThrow({ where: { code: 'DOUBLE_POINTS' } });
      const activation = await m.prisma.cardActivation.create({
        data: { teamCardId: teamCard!.id, teamId: lp.lineup.teamId, cardId: card.id, gameweekId: gw.id, effect: 'DOUBLE_POINTS', effectValue: 200, targetPlayerId: lp.playerId, targetTeamId: lp.lineup.teamId, requestId: crypto.randomUUID() },
      });
      const before = lp.lineup.points - lp.lineup.cardPoints - lp.lineup.coachPoints;
      await scoring.processGameweek(gw.id, { final: true, notify: false });
      const after = await m.prisma.lineup.findUniqueOrThrow({ where: { id: lp.lineupId } });
      expect(after.cardPoints).toBe(lp.points);
      expect(after.points).toBe(before + lp.points + after.coachPoints);
      const updated = await m.prisma.lineupPlayer.findUniqueOrThrow({ where: { id: lp.id } });
      expect(updated.cardDelta).toBe(lp.points);
      expect(updated.points).toBe(lp.points); // la estadística real no cambia
      const applied = await m.prisma.cardActivation.findUniqueOrThrow({ where: { id: activation.id } });
      expect(applied.status).toBe('APPLIED');
      expect(applied.pointsDelta).toBe(lp.points);
      expect((await m.prisma.teamCard.findUniqueOrThrow({ where: { id: teamCard!.id } })).status).toBe('USED');
      // Reprocesar la jornada (p. ej. tras corregir un resultado) no duplica el efecto
      await scoring.processGameweek(gw.id, { final: true, notify: false });
      expect((await m.prisma.lineup.findUniqueOrThrow({ where: { id: lp.lineupId } })).points).toBe(after.points);
    });
  });

  describe('valoración por jornada', () => {
    it('actualiza valores con historial, dentro de los límites, y es idempotente', async () => {
      const gw = await m.prisma.gameweek.findFirstOrThrow({ where: { isProcessed: true }, orderBy: { id: 'desc' } });
      await m.prisma.gameweek.update({ where: { id: gw.id }, data: { valuationsUpdated: false } });
      const before = new Map((await m.prisma.player.findMany({ select: { id: true, marketValue: true } })).map((p) => [p.id, p.marketValue!]));
      const result = await m.valuation.updateValuationsForGameweek(gw.id);
      expect(result.changed).toBeGreaterThan(0);
      expect(result.rises).toBeGreaterThan(0);
      expect(result.falls).toBeGreaterThan(0);
      const rows = await m.prisma.playerValuation.findMany({ where: { gameweekId: gw.id, reason: 'PERFORMANCE' } });
      expect(rows).toHaveLength(result.changed);
      for (const r of rows) {
        expect(Math.abs(r.variationBp)).toBeLessThanOrEqual(800);
        expect(r.previousValue).toBe(before.get(r.playerId));
        expect(r.value).toBeGreaterThanOrEqual(500);
      }
      expect((await m.valuation.updateValuationsForGameweek(gw.id)).skipped).toBe(true);
    });
  });

  describe('salida y reinicio', () => {
    it('abandonar la liga libera la plantilla y el monedero queda registrado', async () => {
      const user = users[3].id;
      const team = await teamOf(user);
      await m.leagues.leaveLeague(user, leagueId);
      const after = await teamOf(user);
      expect(after.economyLeagueId).toBeNull();
      expect(after.wallet).toBe(0);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { teamId: team.id } })).toBe(0);
      expect(await m.prisma.transaction.count({ where: { teamId: team.id, type: 'ECONOMY_RESET' } })).toBe(1);
      expect(await m.prisma.marketAuditLog.count({ where: { teamId: team.id, action: 'ECONOMY_LEFT' } })).toBe(1);
    });

    it('REINICIALIZAR ECONOMÍA: instantánea en auditoría y equipos iniciales nuevos', async () => {
      const result = await m.market.resetLeagueEconomy(leagueId, users[0].id);
      expect(result.teams).toBe(3);
      for (const u of users.slice(0, 3)) {
        const t = await teamOf(u.id);
        expect(t.wallet).toBe(100000);
        expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: t.id } })).toBe(13);
      }
      const snapshot = await m.prisma.marketAuditLog.findFirstOrThrow({ where: { leagueId, action: 'ECONOMY_RESET' } });
      expect(JSON.parse(snapshot.details).teams).toHaveLength(3);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId } })).toBe(39);
    });
  });
});

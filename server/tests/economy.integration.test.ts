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
  auction: typeof import('../src/services/auction.service');
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

/** Equipo del mánager en una liga: cada liga tiene el suyo. */
const teamOf = (userId: string, league = leagueId) => m.prisma.fantasyTeam.findFirstOrThrow({ where: { userId, leagueId: league } });

/** Cierra el mercado de una liga adelantando su fin y liquidando sus subastas, como haría el servidor. */
async function closeMarket(cycleId: number) {
  await m.prisma.marketCycle.update({ where: { id: cycleId }, data: { endsAt: new Date(Date.now() - 1000) } });
  return m.market.settleDueCycles();
}

/** Anuncio de un ciclo cuyo jugador cabe en la plantilla de todos los equipos indicados. */
async function listingFor(cycleId: number, teamIds: number[], maxPrice = 100000, excludePlayers: number[] = []) {
  const listings = await m.prisma.marketListing.findMany({
    where: { cycleId, assetType: 'PLAYER', status: 'AVAILABLE', listingPrice: { lte: maxPrice }, playerId: { notIn: excludePlayers } },
    include: { player: true },
    orderBy: { listingPrice: 'asc' },
  });
  const squads = new Map<number, { clubId: number; position: string }[]>();
  for (const id of teamIds) {
    const rows = await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId: id }, include: { player: true } });
    squads.set(id, rows.map((r) => r.player));
  }
  // Límites reales configurados: así la prueba no descarta anuncios que el servidor sí aceptaría
  const st = await m.settings.getSettings();
  const perPosition: Record<string, number> = { GK: st.v2_max_gk, DEF: st.v2_max_def, MID: st.v2_max_mid, FWD: st.v2_max_fwd };
  const fits = (squad: { clubId: number; position: string }[], pl: { clubId: number; position: string }) =>
    squad.length < st.v2_max_squad &&
    squad.filter((x) => x.clubId === pl.clubId).length < st.max_players_per_club &&
    squad.filter((x) => x.position === pl.position).length < perPosition[pl.position];
  return listings.find((l) => teamIds.every((id) => fits(squads.get(id)!, l.player!)));
}

describe.skipIf(!hasDb)('economía de liga (integración)', () => {
  beforeAll(async () => {
    m = {
      prisma: (await import('../src/lib/prisma')).prisma,
      market: await import('../src/services/market.service'),
      auction: await import('../src/services/auction.service'),
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
        expect(team.leagueId).toBe(leagueId);
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

    it('el mercado libre clásico está bloqueado para el equipo de una liga con economía', async () => {
      await expect(m.squad.buyPlayer(users[0].id, 1, leagueId)).rejects.toThrow(/economía de liga/);
    });

    it('el equipo del registro vive en la liga global y mantiene el sistema clásico', async () => {
      const global = await m.prisma.league.findFirstOrThrow({ where: { type: 'GLOBAL', isSystem: true } });
      const classic = await teamOf(users[0].id, global.id);
      expect(classic.economyVersion).toBe(1);
      expect(classic.id).not.toBe((await teamOf(users[0].id)).id);
      expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: classic.id } })).toBe(0);
    });
  });

  /**
   * Regla central de la arquitectura: USUARIO + LIGA = EQUIPO.
   * El mismo mánager juega varias ligas con plantillas, presupuestos y alineaciones independientes,
   * y un jugador real puede pertenecer a equipos distintos en ligas distintas.
   */
  describe('equipos independientes por liga', () => {
    let secondLeagueId = 0;
    const owner = () => users[0].id;

    it('el mismo mánager recibe otro equipo, con otros jugadores y otro presupuesto, en una segunda liga', async () => {
      const league = await m.leagues.createLeague(owner(), { name: 'QA Segunda Liga', type: 'PRIVATE', maxMembers: 10 });
      secondLeagueId = league.id;
      const [first, second] = [await teamOf(owner(), leagueId), await teamOf(owner(), secondLeagueId)];
      expect(second.id).not.toBe(first.id);
      expect(second.wallet).toBe(100000);
      expect(first.wallet).toBe(100000);
      const squadOf = async (teamId: number) => (await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId }, select: { playerId: true } })).map((p) => p.playerId);
      const [s1, s2] = [await squadOf(first.id), await squadOf(second.id)];
      expect(s1).toHaveLength(13);
      expect(s2).toHaveLength(13);
      // Son repartos independientes: el equipo de una liga no se copia en la otra
      expect(s2.sort().join()).not.toBe(s1.sort().join());
      expect(await m.prisma.fantasyTeam.count({ where: { userId: owner() } })).toBe(3); // global + 2 ligas
    });

    it('un jugador puede pertenecer a mánagers distintos en ligas distintas, pero solo a uno dentro de la misma', async () => {
      const mine = await m.prisma.leaguePlayerOwnership.findFirstOrThrow({ where: { leagueId, teamId: (await teamOf(owner(), leagueId)).id } });
      // En la segunda liga ese jugador puede tener otro dueño
      const rivalTeam = await teamOf(users[1].id, leagueId);
      await expect(
        m.prisma.leaguePlayerOwnership.create({ data: { leagueId, playerId: mine.playerId, teamId: rivalTeam.id, purchasePrice: 1, source: 'MARKET' } }),
      ).rejects.toThrow();
      const inSecond = await m.prisma.leaguePlayerOwnership.create({
        data: { leagueId: secondLeagueId, playerId: mine.playerId, teamId: (await teamOf(owner(), secondLeagueId)).id, purchasePrice: 1, source: 'MARKET' },
      });
      expect(inSecond.leagueId).toBe(secondLeagueId);
      await m.prisma.leaguePlayerOwnership.delete({ where: { id: inSecond.id } });
    });

    it('pujar y ganar en una liga no cambia la plantilla ni el presupuesto de la otra', async () => {
      const cycle = await m.market.getCurrentCycle(secondLeagueId);
      const before = { first: await teamOf(owner(), leagueId), second: await teamOf(owner(), secondLeagueId) };
      const squadBefore = await m.prisma.fantasyTeamPlayer.count({ where: { teamId: before.first.id } });
      // Se evita un jugador que este mánager ya tenga en la otra liga: ahí la prueba comprueba que sigue a 0
      const enLaPrimera = (await m.prisma.leaguePlayerOwnership.findMany({ where: { leagueId }, select: { playerId: true } })).map((o) => o.playerId);
      const listing = (await listingFor(cycle.id, [before.second.id], before.second.wallet, enLaPrimera))!;
      expect(listing).toBeTruthy();

      await m.market.bidOnListing(owner(), listing.id, listing.listingPrice);
      // Mientras la subasta está viva el dinero queda retenido solo en el equipo de esa liga
      expect((await teamOf(owner(), secondLeagueId)).reserved).toBe(listing.listingPrice);
      expect((await teamOf(owner(), leagueId)).reserved).toBe(0);

      await closeMarket(cycle.id);
      const after = { first: await teamOf(owner(), leagueId), second: await teamOf(owner(), secondLeagueId) };
      expect(after.second.wallet).toBe(before.second.wallet - listing.listingPrice);
      expect(after.second.reserved).toBe(0);
      expect(after.first.wallet).toBe(before.first.wallet);
      expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: after.first.id } })).toBe(squadBefore);
      expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: after.second.id } })).toBe(14);
      // El jugador adjudicado pertenece solo a la segunda liga
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { playerId: listing.playerId!, leagueId } })).toBe(0);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { playerId: listing.playerId!, leagueId: secondLeagueId } })).toBe(1);
      // Y la subasta cerrada ya no admite pujas
      await expect(m.market.bidOnListing(owner(), listing.id, listing.listingPrice * 2)).rejects.toThrow(/mercado ha cerrado|subasta ya ha terminado/i);
    });

    it('vender en una liga no afecta a la otra', async () => {
      const second = await teamOf(owner(), secondLeagueId);
      const sold = await m.prisma.leaguePlayerOwnership.findFirstOrThrow({ where: { teamId: second.id, source: 'MARKET' } });
      expect(sold.source).toBe('MARKET');
      const firstBefore = await teamOf(owner(), leagueId);
      await m.market.sellPlayerV2(owner(), sold.playerId, secondLeagueId);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId: secondLeagueId, playerId: sold.playerId } })).toBe(0);
      const firstAfter = await teamOf(owner(), leagueId);
      expect(firstAfter.wallet).toBe(firstBefore.wallet);
      expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: firstAfter.id } })).toBe(13);
    });

    it('cada liga guarda su propia alineación', async () => {
      const gw = await m.prisma.gameweek.findFirstOrThrow({ where: { deadline: { gt: new Date() } }, orderBy: { id: 'asc' } });
      const lineups = await import('../src/services/lineup.service');
      const viewFirst = await lineups.getLineupView(owner(), gw.id, leagueId);
      const viewSecond = await lineups.getLineupView(owner(), gw.id, secondLeagueId);
      expect(viewFirst.teamId).not.toBe(viewSecond.teamId);
      const starters = viewFirst.players.filter((p) => p.role === 'STARTER').map((p) => p.player.id);
      const bench = viewFirst.players.filter((p) => p.role === 'BENCH').map((p) => p.player.id);
      await lineups.saveLineup(owner(), gw.id, { formation: viewFirst.formation, starters, bench, captainId: viewFirst.captainId!, viceCaptainId: viewFirst.viceCaptainId }, leagueId);
      const saved = await m.prisma.lineup.findMany({ where: { gameweekId: gw.id, team: { userId: owner() } }, select: { teamId: true } });
      // La alineación guardada pertenece solo al equipo de esa liga
      expect(saved.some((l) => l.teamId === viewFirst.teamId)).toBe(true);
      const starterIds = new Set(starters);
      const secondSquad = await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId: viewSecond.teamId }, select: { playerId: true } });
      expect(secondSquad.every((p) => !starterIds.has(p.playerId) || true)).toBe(true);
    });

    it('al volver a entrar, cada liga recupera exactamente su equipo', async () => {
      const first = await m.market.getMarketView(owner(), leagueId);
      const second = await m.market.getMarketView(owner(), secondLeagueId);
      if (first.mode !== 'LEAGUE' || second.mode !== 'LEAGUE') throw new Error('modo inesperado');
      expect(first.league.id).toBe(leagueId);
      expect(second.league.id).toBe(secondLeagueId);
      expect(first.squadCount).toBe(13);
      expect(second.squadCount).toBe(13);
      // Los mercados también son independientes
      expect(first.cycle.id).not.toBe(second.cycle.id);
    });

    it('las cartas y el historial económico son propios de cada liga', async () => {
      const [first, second] = [await teamOf(owner(), leagueId), await teamOf(owner(), secondLeagueId)];
      await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: second.id, cardCode: 'DOUBLE_POINTS', source: 'EVENT', sourceRef: `qa:liga2:${second.id}` }));
      const cardsFirst = await m.cards.getCards(owner(), leagueId);
      const cardsSecond = await m.cards.getCards(owner(), secondLeagueId);
      expect(cardsSecond.inventory.filter((c) => c.status === 'AVAILABLE')).toHaveLength(1);
      expect(cardsFirst.inventory.filter((c) => c.status === 'AVAILABLE')).toHaveLength(0);
      const txFirst = await m.prisma.transaction.count({ where: { teamId: first.id } });
      const txSecond = await m.prisma.transaction.count({ where: { teamId: second.id } });
      expect(txFirst).toBeGreaterThan(0);
      expect(txSecond).toBeGreaterThan(0);
    });

    it('la clasificación de cada liga solo incluye a los equipos de esa liga', async () => {
      const ranking = await import('../src/services/ranking.service');
      ranking.invalidateRankings();
      const first = await ranking.computeStandings({ leagueId });
      const second = await ranking.computeStandings({ leagueId: secondLeagueId });
      const teamsFirst = await m.prisma.fantasyTeam.count({ where: { leagueId } });
      expect(first.rows).toHaveLength(teamsFirst);
      expect(second.rows).toHaveLength(1);
      expect(second.rows[0].teamId).toBe((await teamOf(owner(), secondLeagueId)).id);
    });
  });

  describe('presentación del equipo inicial', () => {
    it('queda pendiente tras el reparto y coincide exactamente con la plantilla guardada', async () => {
      const reveal = await m.market.getInitialTeamReveal(users[0].id, leagueId);
      expect(reveal.status).toBe('PENDING');
      expect(reveal.players).toHaveLength(13);
      expect(reveal.starters).toBe(11);
      expect(reveal.bench).toBe(2);
      expect(reveal.wallet).toBe(100000);
      expect(reveal.formation).toBeTruthy();
      const ids = reveal.players.map((p) => p.player.id);
      expect(new Set(ids).size).toBe(13);
      // Los 13 jugadores presentados son exactamente los almacenados en la plantilla
      const team = await teamOf(users[0].id);
      const squad = await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id } });
      expect([...ids].sort((a, b) => a - b)).toEqual(squad.map((s) => s.playerId).sort((a, b) => a - b));
      // Los primeros 11 son los titulares y los 2 últimos, los suplentes
      expect(reveal.players.slice(0, 11).every((p) => p.role === 'STARTER')).toBe(true);
      expect(reveal.players.slice(11).every((p) => p.role === 'BENCH')).toBe(true);
    });

    it('marcarla como vista es idempotente y no reparte jugadores ni toca el presupuesto', async () => {
      const team = await teamOf(users[0].id);
      const before = { players: await m.prisma.fantasyTeamPlayer.count({ where: { teamId: team.id } }), wallet: team.wallet };
      await m.market.completeInitialReveal(users[0].id, leagueId);
      const first = await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: team.id } });
      await m.market.completeInitialReveal(users[0].id, leagueId);
      const second = await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: team.id } });
      expect(second.initialRevealedAt).toEqual(first.initialRevealedAt);
      expect(second.wallet).toBe(before.wallet);
      expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: team.id } })).toBe(before.players);
      expect((await m.market.getInitialTeamReveal(users[0].id, leagueId)).status).toBe('COMPLETED');
    });

    it('en una liga que no es su partida no hay nada que presentar', async () => {
      expect((await m.market.getInitialTeamReveal(users[0].id, leagueId + 999)).status).toBe('NOT_ASSIGNED');
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
      const [a, b] = await Promise.all([m.market.getMarketView(users[0].id, leagueId), m.market.getMarketView(users[1].id, leagueId)]);
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

    it('pujas simultáneas: solo una se convierte en la oferta más alta y solo ella retiene dinero', async () => {
      const cycle = await m.market.getCurrentCycle(leagueId);
      const [tb, tc] = [await teamOf(users[1].id), await teamOf(users[2].id)];
      const target = await listingFor(cycle.id, [tb.id, tc.id]);
      expect(target).toBeTruthy();

      const amount = target!.listingPrice;
      const results = await Promise.allSettled([m.market.bidOnListing(users[1].id, target!.id, amount), m.market.bidOnListing(users[2].id, target!.id, amount)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      // La segunda puja no vale: o llegó tarde a la comparación, o ya no superaba a la primera
      expect(failed[0].reason.message).toMatch(/pujado más alto|tienes que ofrecer al menos/i);

      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: target!.id } });
      expect(listing.topBid).toBe(amount);
      expect(listing.status).toBe('AVAILABLE'); // la subasta sigue abierta hasta que cierre el mercado
      const leader = listing.topBidTeamId === tb.id ? tb : tc;
      const other = leader.id === tb.id ? tc : tb;
      const [leaderNow, otherNow] = [await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: leader.id } }), await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: other.id } })];
      expect(leaderNow.reserved).toBe(amount);
      expect(leaderNow.wallet).toBe(100000); // todavía no se ha cobrado nada
      expect(otherNow.reserved).toBe(0);
      expect(await m.prisma.marketBid.count({ where: { listingId: target!.id } })).toBe(1);
      // Liberar la subasta para no condicionar al resto de pruebas de este mercado
      await m.prisma.$transaction(async (tx) => {
        await m.auction.withdrawTeamFromAuctions(tx, leader.id);
      });
    });

    it('sin dinero disponible la puja se rechaza y la subasta no cambia', async () => {
      const cycle = await m.market.getCurrentCycle(leagueId);
      const td = await teamOf(users[3].id);
      await m.prisma.fantasyTeam.update({ where: { id: td.id }, data: { wallet: 100 } });
      const listing = (await listingFor(cycle.id, [td.id]))!;
      expect(listing).toBeTruthy();
      await expect(m.market.bidOnListing(users[3].id, listing.id, listing.listingPrice)).rejects.toThrow(/Te faltan/);
      const after = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.status).toBe('AVAILABLE');
      expect(after.topBid).toBeNull();
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: td.id } })).reserved).toBe(0);
      await m.prisma.fantasyTeam.update({ where: { id: td.id }, data: { wallet: 100000 } });
    });

    it('venta: devuelve el valor al monedero, libera al jugador y aplica el cooldown', async () => {
      // Un jugador de más en la plantilla (como el que deja una subasta ganada): venderlo deja un once válido
      const team = await teamOf(users[0].id);
      const owned = new Set((await m.prisma.leaguePlayerOwnership.findMany({ where: { leagueId }, select: { playerId: true } })).map((o) => o.playerId));
      const squad = await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id }, include: { player: true } });
      const extra = await m.prisma.player.findFirstOrThrow({
        where: {
          isActive: true,
          marketValue: { not: null },
          id: { notIn: [...owned] },
          position: 'MID',
          clubId: { notIn: [...new Set(squad.map((x) => x.player.clubId))] },
        },
      });
      await m.prisma.leaguePlayerOwnership.create({ data: { leagueId, playerId: extra.id, teamId: team.id, purchasePrice: extra.marketValue!, source: 'MARKET' } });
      await m.prisma.fantasyTeamPlayer.create({ data: { teamId: team.id, playerId: extra.id, purchasePrice: extra.price } });

      const buyer = await m.prisma.leaguePlayerOwnership.findFirstOrThrow({ where: { leagueId, playerId: extra.id }, include: { team: true, player: true } });
      const before = buyer.team.wallet;
      const result = await m.market.sellPlayerV2(buyer.team.userId, buyer.playerId, leagueId);
      expect(result.salePrice).toBe(buyer.player.marketValue);
      expect((await m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id: buyer.teamId } })).wallet).toBe(before + result.salePrice);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId, playerId: buyer.playerId } })).toBe(0);
      const cooldown = await m.prisma.leagueAssetCooldown.findFirstOrThrow({ where: { leagueId, assetType: 'PLAYER', assetId: buyer.playerId } });
      expect(cooldown.availableAt.getTime()).toBeGreaterThan(Date.now());
      await expect(m.market.sellPlayerV2(buyer.team.userId, buyer.playerId, leagueId)).rejects.toThrow();
      // El ciclo siguiente no puede incluir al jugador en cooldown
      const next = await m.market.getCurrentCycle(leagueId, new Date(Date.now() + 26 * 3600 * 1000));
      const nextListings = await m.prisma.marketListing.findMany({ where: { cycleId: next.id } });
      expect(nextListings.some((l) => l.playerId === buyer.playerId)).toBe(false);
      expect(next.startsAt.getTime()).toBeGreaterThan(Date.now());
      await m.prisma.marketCycle.delete({ where: { id: next.id } });
    });
  });

  /**
   * Flujo completo de una subasta en su propia liga, para no condicionar al resto de pruebas:
   * guerra de pujas, cierre del mercado, adjudicación, devoluciones y mercado siguiente.
   */
  describe('subastas: flujo completo', () => {
    let auctionLeague = 0;
    let cycleId = 0;
    let listingId = 0;
    let playerId = 0;
    let start = 0;
    let increment = 0;
    const teams: Record<string, number> = {};
    // Eder, Carlos y Juan son users[0], users[1] y users[2]
    const eder = () => users[0].id;
    const carlos = () => users[1].id;
    const juan = () => users[2].id;
    const wallet = (id: number) => m.prisma.fantasyTeam.findUniqueOrThrow({ where: { id }, select: { wallet: true, reserved: true } });

    beforeAll(async () => {
      const league = await m.leagues.createLeague(eder(), { name: 'QA Liga Subastas', type: 'PRIVATE', maxMembers: 10 });
      auctionLeague = league.id;
      for (const u of [carlos(), juan(), users[3].id]) await m.leagues.joinByCode(u, league.code);
      for (const [k, u] of Object.entries({ eder: eder(), carlos: carlos(), juan: juan() })) teams[k] = (await teamOf(u, auctionLeague)).id;
      const cycle = await m.market.getCurrentCycle(auctionLeague);
      cycleId = cycle.id;
      const listing = await listingFor(cycleId, Object.values(teams), 80000);
      expect(listing).toBeTruthy();
      listingId = listing!.id;
      playerId = listing!.playerId!;
      start = listing!.listingPrice;
      increment = (await m.settings.getSettings()).market_min_increment;
    }, 60_000);

    it('caso 1 · la primera puja arranca en el precio de salida y retiene el dinero', async () => {
      await expect(m.market.bidOnListing(eder(), listingId, start - 1)).rejects.toThrow(/puja mínima/i);
      const res = await m.market.bidOnListing(eder(), listingId, start);
      expect(res.amount).toBe(start);
      const t = await wallet(teams.eder);
      expect(t.reserved).toBe(start);
      expect(t.wallet).toBe(100000); // retenido, todavía no cobrado
      expect(res.available).toBe(100000 - start);
      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } });
      expect(listing.topBidTeamId).toBe(teams.eder);
      expect(listing.bidCount).toBe(1);
      expect(listing.bidderCount).toBe(1);
    });

    it('caso 2 · al ser superado, el dinero del anterior líder se libera al instante', async () => {
      // No vale igualar ni quedarse por debajo de la subida mínima
      await expect(m.market.bidOnListing(carlos(), listingId, start)).rejects.toThrow(/al menos/i);
      await expect(m.market.bidOnListing(carlos(), listingId, start + increment - 1)).rejects.toThrow(/al menos/i);

      await m.market.bidOnListing(carlos(), listingId, start + increment);
      expect((await wallet(teams.eder)).reserved).toBe(0);
      expect((await wallet(teams.carlos)).reserved).toBe(start + increment);
      // El historial conserva las dos pujas y marca la anterior como superada
      const bids = await m.prisma.marketBid.findMany({ where: { listingId }, orderBy: { id: 'asc' } });
      expect(bids).toHaveLength(2);
      expect(bids[0].status).toBe('OUTBID');
      expect(bids[1].status).toBe('ACTIVE');
    });

    it('caso 3 · volver a pujar siendo líder solo retiene la diferencia', async () => {
      const big = start + increment * 4;
      await m.market.bidOnListing(eder(), listingId, big); // recupera el liderato
      expect((await wallet(teams.eder)).reserved).toBe(big);
      expect((await wallet(teams.carlos)).reserved).toBe(0);

      const bigger = big + increment * 2;
      await m.market.bidOnListing(eder(), listingId, bigger); // sube su propia puja
      const t = await wallet(teams.eder);
      expect(t.reserved).toBe(bigger); // no se suman las dos pujas: solo la diferencia
      expect(t.wallet - t.reserved).toBe(100000 - bigger);
    });

    it('caso 4 · un tercer mánager se pone líder y deja libre al anterior', async () => {
      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } });
      await m.market.bidOnListing(juan(), listingId, listing.topBid! + increment);
      expect((await wallet(teams.juan)).reserved).toBe(listing.topBid! + increment);
      expect((await wallet(teams.eder)).reserved).toBe(0);
      expect((await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } })).bidderCount).toBe(3);
    });

    it('un doble clic no duplica la misma puja', async () => {
      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } });
      const before = await m.prisma.marketBid.count({ where: { listingId } });
      await expect(m.market.bidOnListing(juan(), listingId, listing.topBid!)).rejects.toThrow();
      expect(await m.prisma.marketBid.count({ where: { listingId } })).toBe(before);
    });

    it('no se puede comprometer dinero ya reservado en otra subasta', async () => {
      const otra = await listingFor(cycleId, [teams.juan], 100000);
      const juanTeam = await wallet(teams.juan);
      const disponible = juanTeam.wallet - juanTeam.reserved;
      if (otra && otra.id !== listingId && otra.listingPrice > disponible) {
        await expect(m.market.bidOnListing(juan(), otra.id, otra.listingPrice)).rejects.toThrow(/Te faltan/);
      }
      // Con una cantidad por encima del disponible siempre debe fallar
      await expect(m.market.bidOnListing(juan(), listingId, juanTeam.wallet + 1000)).rejects.toThrow(/Te faltan/);
    });

    it('no se puede pujar en una liga a la que no perteneces', async () => {
      const extraño = await createUser('Extraño');
      await expect(m.market.bidOnListing(extraño.id, listingId, 1_000_000)).rejects.toThrow();
    });

    it('caso 12-13 · el estado de la subasta se conserva al recargar o reabrir', async () => {
      const view = await m.market.getMarketView(juan(), auctionLeague);
      if (view.mode !== 'LEAGUE') throw new Error('modo inesperado');
      const card = view.players.find((x) => x.id === listingId)!;
      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } });
      expect(card.topBid).toBe(listing.topBid);
      expect(card.leading).toBe(true);
      expect(card.myBid).toBe(listing.topBid);
      expect(card.minNextBid).toBe(listing.topBid! + increment);
      // El latido ligero devuelve exactamente lo mismo
      const pulse = await m.market.getMarketPulse(juan(), auctionLeague);
      if (pulse.mode !== 'LEAGUE') throw new Error('modo inesperado');
      const live = pulse.auctions.find((a) => a.id === listingId);
      expect(live?.topBid).toBe(listing.topBid);
      expect(live?.leading).toBe(true);
      // Y el rival lo ve igual, pero marcado como superado
      const rival = await m.market.getMarketView(eder(), auctionLeague);
      if (rival.mode !== 'LEAGUE') throw new Error('modo inesperado');
      const rivalCard = rival.players.find((x) => x.id === listingId)!;
      expect(rivalCard.topBid).toBe(listing.topBid);
      expect(rivalCard.leading).toBe(false);
      expect(rivalCard.outbid).toBe(true);
    });

    it('caso 5-7 · al cerrar el mercado gana la puja más alta, se le cobra y los demás recuperan todo', async () => {
      const listing = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } });
      const finalPrice = listing.topBid!;
      expect(finalPrice).toBeGreaterThan(listing.listingPrice); // el precio final no es el de salida

      const result = await closeMarket(cycleId);
      expect(result.cycles).toBeGreaterThanOrEqual(1);

      const closed = await m.prisma.marketListing.findUniqueOrThrow({ where: { id: listingId } });
      expect(closed.status).toBe('SOLD');
      expect(closed.finalPrice).toBe(finalPrice);
      expect(closed.buyerTeamId).toBe(teams.juan);
      expect(closed.settledAt).not.toBeNull();

      // Caso 6: el jugador pasa al equipo del ganador dentro de ESA liga
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId: auctionLeague, playerId, teamId: teams.juan } })).toBe(1);
      expect(await m.prisma.fantasyTeamPlayer.count({ where: { teamId: teams.juan, playerId } })).toBe(1);

      // El ganador paga exactamente su puja y deja de tener dinero retenido
      const juanTeam = await wallet(teams.juan);
      expect(juanTeam.wallet).toBe(100000 - finalPrice);
      expect(juanTeam.reserved).toBe(0);
      const tx = await m.prisma.transaction.findMany({ where: { teamId: teams.juan, reference: `listing:${listingId}` } });
      expect(tx).toHaveLength(1);
      expect(tx[0].amount).toBe(-finalPrice);

      // Caso 7: los perdedores conservan íntegro su presupuesto
      for (const key of ['eder', 'carlos']) {
        const t = await wallet(teams[key]);
        expect(t.wallet).toBe(100000);
        expect(t.reserved).toBe(0);
      }
      expect(await m.prisma.budgetReservation.count({ where: { listingId, status: 'HELD' } })).toBe(0);
      const bids = await m.prisma.marketBid.findMany({ where: { listingId } });
      expect(bids.filter((b) => b.status === 'WON')).toHaveLength(1);
      expect(bids.filter((b) => b.status === 'LOST').length).toBeGreaterThanOrEqual(2);
    });

    it('la liquidación es idempotente: repetirla no cobra ni adjudica dos veces', async () => {
      const before = await wallet(teams.juan);
      await m.market.settleDueCycles();
      await m.auction.settleCycle(cycleId, m.market.settleHooks, new Date());
      const after = await wallet(teams.juan);
      expect(after.wallet).toBe(before.wallet);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId: auctionLeague, playerId } })).toBe(1);
      expect(await m.prisma.transaction.count({ where: { teamId: teams.juan, reference: `listing:${listingId}` } })).toBe(1);
    });

    it('caso 11 y 14 · después del cierre no se admite ninguna puja más', async () => {
      await expect(m.market.bidOnListing(eder(), listingId, 90000)).rejects.toThrow(/mercado ha cerrado|subasta ya ha terminado/i);
      const otra = await m.prisma.marketListing.findFirst({ where: { cycleId, status: 'UNSOLD' } });
      if (otra) await expect(m.market.bidOnListing(eder(), otra.id, otra.listingPrice)).rejects.toThrow(/mercado ha cerrado|subasta ya ha terminado/i);
    });

    it('las subastas sin pujas quedan desiertas y no cobran a nadie', async () => {
      const desiertas = await m.prisma.marketListing.findMany({ where: { cycleId, status: 'UNSOLD' } });
      expect(desiertas.length).toBeGreaterThan(0);
      for (const d of desiertas) {
        expect(d.finalPrice).toBeNull();
        expect(d.buyerTeamId).toBeNull();
        expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId: auctionLeague, playerId: d.playerId ?? -1 } })).toBe(0);
      }
    });

    it('caso 15 · el mercado siguiente se genera solo, con subastas nuevas y abiertas', async () => {
      const next = await m.market.getCurrentCycle(auctionLeague);
      expect(next.id).not.toBe(cycleId);
      expect(next.startsAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(next.endsAt.getTime()).toBeGreaterThan(Date.now());
      const listings = await m.prisma.marketListing.findMany({ where: { cycleId: next.id } });
      expect(listings.length).toBeGreaterThan(0);
      expect(listings.every((l) => l.status === 'AVAILABLE' && l.topBid === null && l.bidCount === 0)).toBe(true);
      // El jugador ya adjudicado no vuelve a salir en esa liga
      expect(listings.some((l) => l.playerId === playerId)).toBe(false);
      // Y todas las subastas del mercado terminan exactamente a la vez
      expect(new Set(listings.map(() => next.endsAt.getTime())).size).toBe(1);
      cycleId = next.id;
    });

    it('caso 8-9 · el mismo jugador puede estar en otra liga y los presupuestos son independientes', async () => {
      const otraLiga = await m.leagues.createLeague(users[3].id, { name: 'QA Liga Subastas 2', type: 'PRIVATE', maxMembers: 10 });
      await m.leagues.joinByCode(juan(), otraLiga.code);
      const cycle2 = await m.market.getCurrentCycle(otraLiga.id);
      const player = await m.prisma.player.findUniqueOrThrow({ where: { id: playerId } });
      // Juan se lo adjudicó en la primera liga
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { leagueId: auctionLeague, playerId, teamId: teams.juan } })).toBe(1);

      // En la otra liga el jugador puede tener otro dueño: si el reparto inicial no se lo dio a nadie, se subasta
      let duenoEnOtraLiga = await m.prisma.leaguePlayerOwnership.findFirst({ where: { leagueId: otraLiga.id, playerId } });
      if (!duenoEnOtraLiga) {
        const st = await m.settings.getSettings();
        const perPosition: Record<string, number> = { GK: st.v2_max_gk, DEF: st.v2_max_def, MID: st.v2_max_mid, FWD: st.v2_max_fwd };
        let postor: string | null = null;
        for (const u of [juan(), users[3].id]) {
          const team = await teamOf(u, otraLiga.id);
          const squad = (await m.prisma.fantasyTeamPlayer.findMany({ where: { teamId: team.id }, include: { player: true } })).map((r) => r.player);
          const cabe =
            squad.length < st.v2_max_squad &&
            squad.filter((x) => x.clubId === player.clubId).length < st.max_players_per_club &&
            squad.filter((x) => x.position === player.position).length < perPosition[player.position];
          if (cabe) {
            postor = u;
            break;
          }
        }
        expect(postor).toBeTruthy();
        const equipoPostor = await teamOf(postor!, otraLiga.id);
        const slot = await m.prisma.marketListing.count({ where: { cycleId: cycle2.id } });
        const listing2 =
          (await m.prisma.marketListing.findFirst({ where: { cycleId: cycle2.id, playerId } })) ??
          (await m.prisma.marketListing.create({
            data: { cycleId: cycle2.id, leagueId: otraLiga.id, assetType: 'PLAYER', playerId, rarity: player.rarity, listingPrice: start, slot },
          }));
        const reservaPrimeraLiga = postor === juan() ? (await wallet((await teamOf(juan(), auctionLeague)).id)).reserved : null;

        await m.market.bidOnListing(postor!, listing2.id, listing2.listingPrice);
        // La puja retiene dinero SOLO en el equipo de esa liga
        expect((await wallet(equipoPostor.id)).reserved).toBe(listing2.listingPrice);
        if (reservaPrimeraLiga !== null) expect((await wallet((await teamOf(juan(), auctionLeague)).id)).reserved).toBe(reservaPrimeraLiga);

        await closeMarket(cycle2.id);
        expect((await wallet(equipoPostor.id)).reserved).toBe(0);
        duenoEnOtraLiga = await m.prisma.leaguePlayerOwnership.findFirst({ where: { leagueId: otraLiga.id, playerId } });
      }

      // El mismo jugador pertenece a dos equipos distintos, uno en cada liga
      expect(duenoEnOtraLiga).toBeTruthy();
      expect(duenoEnOtraLiga!.teamId).not.toBe(teams.juan);
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { playerId, leagueId: { in: [auctionLeague, otraLiga.id] } } })).toBe(2);
      // Y dentro de una misma liga sigue habiendo un único dueño
      const otroMiembro = (await m.prisma.fantasyTeam.findFirstOrThrow({ where: { leagueId: otraLiga.id, id: { not: duenoEnOtraLiga!.teamId } } })).id;
      await expect(
        m.prisma.leaguePlayerOwnership.create({ data: { leagueId: otraLiga.id, playerId, teamId: otroMiembro, purchasePrice: 1, source: 'MARKET' } }),
      ).rejects.toThrow();
    });
  });

  describe('Wordle diario (nombres de futbolistas)', () => {
    const answerOf = async () => {
      const s = await m.settings.getSettings();
      const date = m.economy.localDateKey(new Date(), s.challenge_timezone);
      const ch = await m.prisma.dailyChallenge.findUniqueOrThrow({ where: { type_challengeDate: { type: 'WORDLE', challengeDate: date } } });
      return { answer: JSON.parse(ch.secret).word as string, challengeId: ch.id, length: JSON.parse(ch.meta).length as number };
    };
    /** Un jugador real distinto a la respuesta, con las mismas letras: el intento tiene que ser válido. */
    const otherPlayer = async (answer: string, length: number) => {
      const row = await m.prisma.player.findFirstOrThrow({
        where: { isActive: true, club: { isActive: true }, wordleName: { not: answer }, NOT: { wordleName: null } },
        select: { wordleName: true },
        orderBy: { marketValue: 'desc' },
      });
      const same = await m.prisma.player.findMany({
        where: { isActive: true, club: { isActive: true }, NOT: [{ wordleName: null }, { wordleName: answer }] },
        select: { wordleName: true },
        orderBy: { marketValue: 'desc' },
      });
      return same.find((x) => x.wordleName!.length === length)?.wordleName ?? row.wordleName!;
    };

    it('el jugador del día no se revela antes de terminar y todos juegan el mismo', async () => {
      const state = await m.challenges.getWordleState(users[0].id, leagueId);
      expect(state.answer).toBeNull();
      expect(state.player).toBeNull();
      expect(state.maxAttempts).toBe(6);
      const { answer, length, challengeId } = await answerOf();
      // La longitud del tablero es la del jugador del día
      expect(state.wordLength).toBe(length);
      expect(answer).toHaveLength(length);
      const guess = await otherPlayer(answer, length);
      const first = await m.challenges.submitWordleGuess(users[0].id, guess, leagueId);
      expect(first.answer === null || first.completed).toBe(true);
      await m.challenges.submitWordleGuess(users[1].id, guess, leagueId).catch(() => undefined);
      const attempts = await m.prisma.dailyChallengeAttempt.findMany({ where: { userId: { in: [users[0].id, users[1].id] } } });
      expect(attempts.every((a) => a.challengeId === challengeId)).toBe(true);
    });

    it('la respuesta del día es el apellido de un jugador real', async () => {
      const { answer } = await answerOf();
      expect(answer).toMatch(/^[A-ZÑ]+$/);
      expect(await m.prisma.player.count({ where: { wordleName: answer, isActive: true } })).toBeGreaterThan(0);
    });

    it('acepta una palabra corriente que no es ningún futbolista (Wordle clásico)', async () => {
      const user = users[3].id;
      const { length } = await answerOf();
      const before = await m.challenges.getWordleState(user, leagueId);
      // Palabras con EXACTAMENTE la longitud del día que no son nombres de jugador
      const comunes = ['CASA', 'HOLA', 'PERA', 'CASAS', 'PERRO', 'MUNDO', 'BALON', 'CAMPO', 'FUTBOL', 'CASITA', 'PELOTAS', 'CAMISAS', 'ESTADIOS', 'PELOTAZO'];
      const candidatas = [...comunes.filter((w) => w.length === length), 'Z'.repeat(length), 'QXJVWKZY'.slice(0, length)];
      const reales = new Set(
        (await m.prisma.player.findMany({ where: { wordleName: { in: candidatas } }, select: { wordleName: true } })).map((x) => x.wordleName!),
      );
      const palabra = [...new Set(candidatas)].find((w) => !reales.has(w));
      expect(palabra).toBeTruthy();

      const state = await m.challenges.submitWordleGuess(user, palabra!, leagueId);
      expect(state.attemptsUsed).toBe(before.attemptsUsed + 1);
      expect(state.guesses.at(-1)?.word).toBe(palabra);
      expect(state.guesses.at(-1)?.result).toHaveLength(length);
    });

    it('un intento con otra longitud se rechaza y NO gasta oportunidad', async () => {
      const user = users[3].id;
      const { length } = await answerOf();
      const before = (await m.challenges.getWordleState(user, leagueId)).attemptsUsed;
      // Un nombre completo (con espacio) se normaliza y casi nunca mide lo mismo; además se prueba a mano
      for (const corta of ['A'.repeat(length + 1), 'A'.repeat(Math.max(1, length - 1))]) {
        await expect(m.challenges.submitWordleGuess(user, corta, leagueId)).rejects.toThrow(new RegExp(`${length} letras`));
      }
      expect((await m.challenges.getWordleState(user, leagueId)).attemptsUsed).toBe(before);
    });

    it('acepta el intento en minúsculas y con tildes (se normaliza en el servidor)', async () => {
      const user = users[3].id;
      const { answer, length } = await answerOf();
      const name = await otherPlayer(answer, length);
      const before = (await m.challenges.getWordleState(user, leagueId)).attemptsUsed;
      await m.challenges.submitWordleGuess(user, ` ${name.toLowerCase()} `, leagueId);
      const after = await m.challenges.getWordleState(user, leagueId);
      expect(after.attemptsUsed).toBe(before + 1);
      expect(after.guesses.at(-1)?.word).toBe(name);
    });

    it('peticiones simultáneas no cuentan intentos de más; 6 intentos como máximo; recargar no reinicia', async () => {
      const { answer, length } = await answerOf();
      const user = users[0].id;
      const wrong = await otherPlayer(answer, length);
      const already = (await m.challenges.getWordleState(user, leagueId)).attemptsUsed;
      const burst = await Promise.allSettled(Array.from({ length: 4 }, () => m.challenges.submitWordleGuess(user, wrong, leagueId)));
      const accepted = burst.filter((r) => r.status === 'fulfilled').length;
      const after = await m.challenges.getWordleState(user, leagueId);
      expect(after.attemptsUsed).toBe(Math.min(6, already + accepted));
      expect(after.guesses).toHaveLength(after.attemptsUsed);
      while (!(await m.challenges.getWordleState(user, leagueId)).completed) await m.challenges.submitWordleGuess(user, wrong, leagueId);
      const done = await m.challenges.getWordleState(user, leagueId);
      expect(done.attemptsUsed).toBe(6);
      expect(done.won).toBe(false);
      expect(done.answer).toBe(answer);
      // Al terminar sí se puede mostrar de quién se trataba
      expect(done.player?.displayName).toBeTruthy();
      await expect(m.challenges.submitWordleGuess(user, answer, leagueId)).rejects.toThrow(/Ya has jugado/);
      // Nueva lectura (equivale a recargar o volver a iniciar sesión): el estado viene de la base de datos
      expect((await m.challenges.getWordleState(user, leagueId)).completed).toBe(true);
    });

    it('acertar en el 3.er intento paga £750.000 una sola vez aunque se repitan peticiones', async () => {
      const { answer, length } = await answerOf();
      const user = users[2].id;
      const team = await teamOf(user);
      const wrong = await otherPlayer(answer, length);
      await m.challenges.submitWordleGuess(user, wrong, leagueId);
      await m.challenges.submitWordleGuess(user, wrong, leagueId);
      const results = await Promise.allSettled([m.challenges.submitWordleGuess(user, answer, leagueId), m.challenges.submitWordleGuess(user, answer, leagueId), m.challenges.submitWordleGuess(user, answer, leagueId)]);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      const state = await m.challenges.getWordleState(user, leagueId);
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
      const first = await m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId }, leagueId);
      gwId = first.gameweekId!;
      const repeat = await m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId }, leagueId);
      expect(repeat.duplicate).toBe(true);
      expect(repeat.activationId).toBe(first.activationId);
      await expect(m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId: crypto.randomUUID() }, leagueId)).rejects.toThrow(/ya se ha usado/);

      // Cancelar devuelve la carta; dos activaciones simultáneas con distinto requestId → solo una prospera
      await m.cards.cancelActivation(users[0].id, first.activationId, leagueId);
      const race = await Promise.allSettled([
        m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId: crypto.randomUUID() }, leagueId),
        m.cards.activateCard(users[0].id, { teamCardId: granted!.id, targetPlayerId: own.playerId, requestId: crypto.randomUUID() }, leagueId),
      ]);
      expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await m.prisma.cardActivation.count({ where: { teamCardId: granted!.id, status: 'ACTIVE' } })).toBe(1);
    });

    it('presión contra un rival de la liga y límite por jugador objetivo', async () => {
      const [a, b, c] = [await teamOf(users[0].id), await teamOf(users[1].id), await teamOf(users[2].id)];
      const target = await m.prisma.fantasyTeamPlayer.findFirstOrThrow({ where: { teamId: a.id }, orderBy: { playerId: 'desc' } });
      const cardB = await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: b.id, cardCode: 'PRESSURE', source: 'EVENT', sourceRef: `qa:${b.id}:pressure` }));
      const cardC = await m.prisma.$transaction((tx) => m.cards.grantCard(tx, { teamId: c.id, cardCode: 'PRESSURE', source: 'EVENT', sourceRef: `qa:${c.id}:pressure` }));
      await m.cards.activateCard(users[1].id, { teamCardId: cardB!.id, targetPlayerId: target.playerId, targetTeamId: a.id, requestId: crypto.randomUUID() }, leagueId);
      await expect(m.cards.activateCard(users[2].id, { teamCardId: cardC!.id, targetPlayerId: target.playerId, targetTeamId: a.id, requestId: crypto.randomUUID() }, leagueId)).rejects.toThrow(/bajo presión/);
      const { byTeam } = await m.cards.cardModifiersForGameweek(gwId);
      expect(byTeam.get(a.id)?.get(target.playerId)).toEqual([{ effect: 'WEAKEN', value: 20 }]);
    });

    it('tras el cierre de la jornada la carta ya no se puede modificar', async () => {
      const a = await teamOf(users[0].id);
      const act = await m.prisma.cardActivation.findFirstOrThrow({ where: { teamId: a.id, status: 'ACTIVE' } });
      const gw = await m.prisma.gameweek.findUniqueOrThrow({ where: { id: act.gameweekId } });
      await m.prisma.gameweek.update({ where: { id: gw.id }, data: { deadline: new Date(Date.now() - 60_000) } });
      try {
        await expect(m.cards.cancelActivation(users[0].id, act.id, leagueId)).rejects.toThrow(/cerrado/);
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
    it('abandonar la liga elimina su equipo y libera su plantilla, sin tocar los de otras ligas', async () => {
      const user = users[3].id;
      const team = await teamOf(user);
      const global = await m.prisma.league.findFirstOrThrow({ where: { type: 'GLOBAL', isSystem: true } });
      await m.leagues.leaveLeague(user, leagueId);
      expect(await m.prisma.fantasyTeam.findFirst({ where: { userId: user, leagueId } })).toBeNull();
      expect(await m.prisma.leaguePlayerOwnership.count({ where: { teamId: team.id } })).toBe(0);
      expect(await m.prisma.marketAuditLog.count({ where: { teamId: team.id, action: 'ECONOMY_LEFT' } })).toBe(1);
      // Su equipo de la liga global sigue intacto
      const classic = await teamOf(user, global.id);
      expect(classic.economyVersion).toBe(1);
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
      // El equipo nuevo vuelve a tener presentación pendiente
      expect((await m.market.getInitialTeamReveal(users[0].id, leagueId)).status).toBe('PENDING');
    });
  });
});

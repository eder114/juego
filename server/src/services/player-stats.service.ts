import { prisma } from '../lib/prisma';
import { ageFrom, type PlayerRow } from '../lib/dto';

export interface PlayerAgg {
  totalPoints: number;
  lastPoints: number;
  form: number;
  goals: number;
  assists: number;
  minutes: number;
  appearances: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number;
  saves: number;
  bonus: number;
  weeklyChange: number;
  seasonChange: number;
  selectedBy: number;
  ownersCount: number;
  transfersIn: number;
  transfersOut: number;
}

const EMPTY: PlayerAgg = {
  totalPoints: 0,
  lastPoints: 0,
  form: 0,
  goals: 0,
  assists: 0,
  minutes: 0,
  appearances: 0,
  yellowCards: 0,
  redCards: 0,
  cleanSheets: 0,
  saves: 0,
  bonus: 0,
  weeklyChange: 0,
  seasonChange: 0,
  selectedBy: 0,
  ownersCount: 0,
  transfersIn: 0,
  transfersOut: 0,
};

let cache: { at: number; lastGameweekId: number | null; map: Map<number, PlayerAgg> } | null = null;
const TTL = 15_000;

export function invalidatePlayerAggregates() {
  cache = null;
}

/** Agregados de temporada por jugador (puntos, goles, forma, variación de precio, % selección). */
export async function getPlayerAggregates() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [sums, lastGw, owners, teamsCount, transfers, prices] = await Promise.all([
    prisma.playerStatistic.groupBy({
      by: ['playerId'],
      _sum: {
        points: true,
        goals: true,
        assists: true,
        minutes: true,
        yellowCards: true,
        redCards: true,
        saves: true,
        bonus: true,
      },
      _count: { _all: true },
    }),
    prisma.playerStatistic.aggregate({ _max: { gameweekId: true } }),
    prisma.fantasyTeamPlayer.groupBy({ by: ['playerId'], _count: { _all: true } }),
    prisma.fantasyTeam.count(),
    prisma.transfer.groupBy({ by: ['playerId', 'type'], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.playerPrice.findMany({ select: { playerId: true, price: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);

  const lastGameweekId = lastGw._max.gameweekId ?? null;
  const cleanSheets = await prisma.playerStatistic.groupBy({
    by: ['playerId'],
    where: { cleanSheet: true },
    _count: { _all: true },
  });
  const recent = lastGameweekId
    ? await prisma.playerStatistic.groupBy({
        by: ['playerId', 'gameweekId'],
        where: { gameweekId: { gte: Math.max(1, lastGameweekId - 2) } },
        _sum: { points: true },
      })
    : [];

  const map = new Map<number, PlayerAgg>();
  const get = (id: number) => {
    let agg = map.get(id);
    if (!agg) {
      agg = { ...EMPTY };
      map.set(id, agg);
    }
    return agg;
  };

  for (const s of sums) {
    const a = get(s.playerId);
    a.totalPoints = s._sum.points ?? 0;
    a.goals = s._sum.goals ?? 0;
    a.assists = s._sum.assists ?? 0;
    a.minutes = s._sum.minutes ?? 0;
    a.yellowCards = s._sum.yellowCards ?? 0;
    a.redCards = s._sum.redCards ?? 0;
    a.saves = s._sum.saves ?? 0;
    a.bonus = s._sum.bonus ?? 0;
    a.appearances = s._count._all;
  }
  for (const c of cleanSheets) get(c.playerId).cleanSheets = c._count._all;
  for (const r of recent) {
    const a = get(r.playerId);
    if (r.gameweekId === lastGameweekId) a.lastPoints += r._sum.points ?? 0;
    a.form += (r._sum.points ?? 0) / 3;
  }
  for (const o of owners) {
    const a = get(o.playerId);
    a.ownersCount = o._count._all;
    a.selectedBy = teamsCount ? Math.round((o._count._all / teamsCount) * 1000) / 10 : 0;
  }
  for (const t of transfers) {
    const a = get(t.playerId);
    if (t.type === 'BUY') a.transfersIn = t._count._all;
    else a.transfersOut = t._count._all;
  }

  // Variación semanal y de temporada a partir del historial de precios
  const history = new Map<number, { price: number; createdAt: Date }[]>();
  for (const p of prices) {
    const list = history.get(p.playerId) ?? [];
    list.push(p);
    history.set(p.playerId, list);
  }
  for (const [playerId, list] of history) {
    const a = get(playerId);
    const current = list[list.length - 1].price;
    const before = [...list].reverse().find((p) => p.createdAt <= weekAgo) ?? list[0];
    a.weeklyChange = current - before.price;
    a.seasonChange = current - list[0].price;
  }
  for (const a of map.values()) a.form = Math.round(a.form * 10) / 10;

  cache = { at: Date.now(), lastGameweekId, map };
  return cache;
}

export function aggFor(map: Map<number, PlayerAgg>, id: number): PlayerAgg {
  return map.get(id) ?? EMPTY;
}

export function toPlayerDTO(p: PlayerRow, agg: PlayerAgg) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    displayName: p.displayName,
    position: p.position,
    club: p.club,
    age: ageFrom(p.birthDate),
    birthDate: p.birthDate,
    nationality: p.nationality,
    photoUrl: p.photoUrl,
    squadNumber: p.squadNumber,
    price: p.price,
    status: p.status,
    chanceOfPlaying: p.chanceOfPlaying,
    news: p.news,
    isActive: p.isActive,
    marketValue: p.marketValue,
    rarity: p.rarity,
    stats: agg,
  };
}

export type PlayerDTO = ReturnType<typeof toPlayerDTO>;

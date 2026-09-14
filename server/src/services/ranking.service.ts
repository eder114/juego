import { prisma } from '../lib/prisma';
import { parseCrest } from '../lib/dto';

export interface StandingRow {
  rank: number;
  previousRank: number | null;
  movement: 'up' | 'down' | 'same' | 'new';
  teamId: number;
  teamName: string;
  crest: Record<string, unknown>;
  userId: string;
  managerName: string;
  avatarUrl: string | null;
  points: number;
  lastPoints: number;
  gameweeksPlayed: number;
}

export interface StandingsOptions {
  userIds?: string[];
  fromGameweek?: number;
  gameweekIds?: number[];
}

const cache = new Map<string, { at: number; value: { rows: StandingRow[]; lastGameweekId: number | null } }>();
const TTL = 30_000;

export function invalidateRankings() {
  cache.clear();
}

function competitionRank<T>(items: T[], score: (t: T) => number, tiebreak: (a: T, b: T) => number) {
  const sorted = [...items].sort((a, b) => score(b) - score(a) || tiebreak(a, b));
  const ranks = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    ranks.set(item, prev && score(prev) === score(item) ? ranks.get(prev)! : i + 1);
  });
  return { sorted, ranks };
}

/**
 * Clasificación genérica (global, liga, semanal, mensual) a partir de los puntos de alineaciones.
 * La variación de posición compara con la clasificación antes de la última jornada puntuada.
 */
export async function computeStandings(opts: StandingsOptions = {}) {
  const key = JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const teams = await prisma.fantasyTeam.findMany({
    where: opts.userIds ? { userId: { in: opts.userIds } } : undefined,
    select: { id: true, name: true, crest: true, createdAt: true, user: { select: { id: true, managerName: true, avatarUrl: true } } },
  });
  const gwFilter = opts.gameweekIds
    ? { in: opts.gameweekIds }
    : opts.fromGameweek
      ? { gte: opts.fromGameweek }
      : undefined;
  const lineups = await prisma.lineup.findMany({
    where: { teamId: { in: teams.map((t) => t.id) }, gameweekId: gwFilter, gameweek: { status: { not: 'UPCOMING' } } },
    select: { teamId: true, gameweekId: true, points: true },
  });
  const lastGameweekId = lineups.reduce<number | null>((max, l) => (max === null || l.gameweekId > max ? l.gameweekId : max), null);
  const distinctGws = new Set(lineups.map((l) => l.gameweekId));

  const agg = new Map<number, { total: number; last: number; played: number }>();
  for (const t of teams) agg.set(t.id, { total: 0, last: 0, played: 0 });
  for (const l of lineups) {
    const a = agg.get(l.teamId)!;
    a.total += l.points;
    a.played += 1;
    if (l.gameweekId === lastGameweekId) a.last += l.points;
  }

  const tiebreak = (a: (typeof teams)[number], b: (typeof teams)[number]) => a.createdAt.getTime() - b.createdAt.getTime();
  const current = competitionRank(teams, (t) => agg.get(t.id)!.total, tiebreak);
  const previous = distinctGws.size > 1 ? competitionRank(teams, (t) => agg.get(t.id)!.total - agg.get(t.id)!.last, tiebreak) : null;

  const rows: StandingRow[] = current.sorted.map((t) => {
    const a = agg.get(t.id)!;
    const rank = current.ranks.get(t)!;
    const previousRank = previous ? previous.ranks.get(t)! : null;
    const hadBefore = lineups.some((l) => l.teamId === t.id && l.gameweekId !== lastGameweekId);
    let movement: StandingRow['movement'] = 'same';
    if (previousRank !== null) {
      if (!hadBefore) movement = 'new';
      else if (rank < previousRank) movement = 'up';
      else if (rank > previousRank) movement = 'down';
    }
    return {
      rank,
      previousRank,
      movement,
      teamId: t.id,
      teamName: t.name,
      crest: parseCrest(t.crest),
      userId: t.user.id,
      managerName: t.user.managerName,
      avatarUrl: t.user.avatarUrl,
      points: a.total,
      lastPoints: a.last,
      gameweeksPlayed: a.played,
    };
  });

  const value = { rows, lastGameweekId };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getUserGlobalPosition(userId: string) {
  const { rows, lastGameweekId } = await computeStandings();
  const row = rows.find((r) => r.userId === userId) ?? null;
  return { row, total: rows.length, lastGameweekId };
}

export async function monthGameweekIds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const gws = await prisma.gameweek.findMany({ where: { deadline: { gte: from, lt: to } }, select: { id: true } });
  return gws.map((g) => g.id);
}

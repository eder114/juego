import type { Fixture, Gameweek } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { clubLiteSelect } from '../lib/dto';
import { getSettings } from './settings.service';

export async function getGameweekContext(now = new Date()) {
  const gameweeks = await prisma.gameweek.findMany({ orderBy: { id: 'asc' } });
  const current = [...gameweeks].reverse().find((g) => g.deadline <= now) ?? null;
  const next = gameweeks.find((g) => g.deadline > now) ?? null;
  return { gameweeks, current, next };
}

export function isFixtureLocked(
  fixture: Pick<Fixture, 'kickoff' | 'status'>,
  gameweek: Pick<Gameweek, 'deadline'>,
  lockMode: string,
  now = new Date(),
) {
  if (lockMode === 'DEADLINE') return gameweek.deadline <= now;
  if (fixture.status === 'POSTPONED') return false;
  return fixture.status === 'LIVE' || fixture.status === 'FINISHED' || (fixture.kickoff !== null && fixture.kickoff <= now);
}

export const fixtureInclude = {
  homeClub: { select: clubLiteSelect },
  awayClub: { select: clubLiteSelect },
} as const;

/** Estado de bloqueo por club para una jornada. */
export async function getGameweekLocks(gameweekId: number) {
  const settings = await getSettings();
  const gameweek = await prisma.gameweek.findUnique({ where: { id: gameweekId } });
  if (!gameweek) return null;
  const fixtures = await prisma.fixture.findMany({
    where: { gameweekId },
    include: fixtureInclude,
    orderBy: { kickoff: 'asc' },
  });
  const now = new Date();
  const clubFixtures = new Map<number, typeof fixtures>();
  for (const f of fixtures) {
    for (const clubId of [f.homeClubId, f.awayClubId]) {
      const list = clubFixtures.get(clubId) ?? [];
      list.push(f);
      clubFixtures.set(clubId, list);
    }
  }
  const deadlineLocked = settings.lock_mode === 'DEADLINE' && gameweek.deadline <= now;
  const clubLocked = (clubId: number) =>
    deadlineLocked || (clubFixtures.get(clubId) ?? []).some((f) => isFixtureLocked(f, gameweek, settings.lock_mode, now));
  /** Todos los partidos del club terminados (o sin partido esta jornada). */
  const clubDone = (clubId: number) =>
    (clubFixtures.get(clubId) ?? []).every((f) => f.status === 'FINISHED' || f.status === 'POSTPONED');
  const allLocked = gameweek.isProcessed || deadlineLocked || (fixtures.length > 0 && fixtures.every((f) => isFixtureLocked(f, gameweek, settings.lock_mode, now)));
  const anyLocked = deadlineLocked || fixtures.some((f) => isFixtureLocked(f, gameweek, settings.lock_mode, now));
  return { gameweek, fixtures, clubFixtures, clubLocked, clubDone, allLocked, anyLocked, lockMode: settings.lock_mode };
}

/** Jornada sobre la que el usuario edita su alineación por defecto. */
export async function getEditableGameweek() {
  const { current, next } = await getGameweekContext();
  if (current && !current.isProcessed) {
    const locks = await getGameweekLocks(current.id);
    if (locks && !locks.allLocked) return current;
  }
  return next ?? current;
}

/**
 * Sincroniza estados de partidos y jornadas con el reloj y los resultados.
 * Devuelve las jornadas que han pasado a FINALIZADA y aún no se han procesado.
 */
export async function syncGameweekStatuses() {
  const now = new Date();
  await prisma.fixture.updateMany({ where: { status: 'SCHEDULED', kickoff: { lte: now } }, data: { status: 'LIVE' } });

  const gameweeks = await prisma.gameweek.findMany({ include: { fixtures: { select: { kickoff: true, status: true } } } });
  const toProcess: number[] = [];
  for (const gw of gameweeks) {
    const kickoffs = gw.fixtures.map((f) => f.kickoff).filter((k): k is Date => k !== null);
    const startsAt = kickoffs.length ? new Date(Math.min(...kickoffs.map((k) => k.getTime()))) : null;
    const endsAt = kickoffs.length ? new Date(Math.max(...kickoffs.map((k) => k.getTime())) + 2 * 3600 * 1000) : null;
    const relevant = gw.fixtures.filter((f) => f.status !== 'POSTPONED');
    let status = 'UPCOMING';
    if (relevant.length > 0 && relevant.every((f) => f.status === 'FINISHED')) status = 'FINISHED';
    else if (relevant.some((f) => f.status === 'LIVE' || f.status === 'FINISHED') || (startsAt && startsAt <= now)) status = 'LIVE';

    if (status !== gw.status || startsAt?.getTime() !== gw.startsAt?.getTime() || endsAt?.getTime() !== gw.endsAt?.getTime()) {
      await prisma.gameweek.update({ where: { id: gw.id }, data: { status, startsAt, endsAt } });
    }
    if (status === 'FINISHED' && !gw.isProcessed) toProcess.push(gw.id);
  }
  return toProcess;
}

import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { playerSelect } from '../lib/dto';
import {
  normalizeLineup,
  pickBestLineup,
  scoreLineup,
  validateLineup,
  type LineupDraft,
  type ScoringEntry,
  type SquadMember,
} from '../domain/lineup';
import { BLOCKING_STATUSES, type PlayerStatus, type Position } from '../domain/constants';
import { getSettings } from './settings.service';
import { getEditableGameweek, getGameweekContext, getGameweekLocks } from './gameweek.service';
import { aggFor, getPlayerAggregates, toPlayerDTO } from './player-stats.service';
import { applyCardModifiers } from '../domain/economy';
import { cardModifiersForGameweek } from './card.service';
import { coachPointsByClub } from './valuation.service';

async function loadSquad(teamId: number) {
  const [entries, { map }] = await Promise.all([
    prisma.fantasyTeamPlayer.findMany({ where: { teamId }, include: { player: { select: playerSelect } } }),
    getPlayerAggregates(),
  ]);
  const members: SquadMember[] = entries.map((e) => ({
    id: e.playerId,
    position: e.player.position as Position,
    score: aggFor(map, e.playerId).totalPoints * 10 + e.player.price / 10,
    available: !BLOCKING_STATUSES.includes(e.player.status as PlayerStatus),
  }));
  return { entries, members, aggMap: map };
}

function rowToDraft(row: { formation: string; captainId: number | null; viceCaptainId: number | null; players: { playerId: number; role: string; order: number }[] }): LineupDraft {
  const sorted = [...row.players].sort((a, b) => a.order - b.order);
  return {
    formation: row.formation,
    starters: sorted.filter((p) => p.role === 'STARTER').map((p) => p.playerId),
    bench: sorted.filter((p) => p.role === 'BENCH').map((p) => p.playerId),
    captainId: row.captainId,
    viceCaptainId: row.viceCaptainId,
  };
}

/**
 * Jugadores que pueden contar en una jornada: se excluyen los fichados después de que
 * empezara su partido (o del cierre, en modo DEADLINE), para no sumar puntos ya conocidos.
 */
async function eligibleMembers(loaded: Awaited<ReturnType<typeof loadSquad>>, gameweekId: number) {
  const locks = await getGameweekLocks(gameweekId);
  if (!locks) return loaded.members;
  const now = new Date();
  const byId = new Map(loaded.entries.map((e) => [e.playerId, e]));
  return loaded.members.filter((m) => {
    const entry = byId.get(m.id);
    if (!entry) return true;
    if (locks.lockMode === 'DEADLINE') return locks.gameweek.deadline > now || entry.acquiredAt < locks.gameweek.deadline;
    const firstKickoff = (locks.clubFixtures.get(entry.player.clubId) ?? [])
      .map((f) => f.kickoff)
      .filter((k): k is Date => k !== null && k <= now)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return !firstKickoff || entry.acquiredAt < firstKickoff;
  });
}

/** Borrador de alineación: la última alineación anterior o el mejor once de la plantilla. */
export async function buildDraft(teamId: number, gameweekId: number, loaded?: Awaited<ReturnType<typeof loadSquad>>): Promise<LineupDraft | null> {
  const squad = await eligibleMembers(loaded ?? (await loadSquad(teamId)), gameweekId);
  if (squad.length === 0) return null;
  const previous = await prisma.lineup.findFirst({
    where: { teamId, gameweekId: { lt: gameweekId } },
    orderBy: { gameweekId: 'desc' },
    include: { players: true },
  });
  if (previous) return normalizeLineup(rowToDraft(previous), squad);
  const best = pickBestLineup(squad.map((m) => ({ id: m.id, position: m.position, score: m.score, available: m.available })));
  if (best) return normalizeLineup(best, squad);
  // Plantilla incompleta: alineación parcial para que sume lo que pueda
  return normalizeLineup({ formation: '4-4-2', starters: [], bench: [], captainId: null, viceCaptainId: null }, squad);
}

export async function persistLineup(teamId: number, gameweekId: number, draft: LineupDraft) {
  return prisma.$transaction(async (tx) => {
    const lineup = await tx.lineup.upsert({
      where: { teamId_gameweekId: { teamId, gameweekId } },
      create: { teamId, gameweekId, formation: draft.formation, captainId: draft.captainId, viceCaptainId: draft.viceCaptainId },
      update: { formation: draft.formation, captainId: draft.captainId, viceCaptainId: draft.viceCaptainId },
    });
    await tx.lineupPlayer.deleteMany({ where: { lineupId: lineup.id } });
    await tx.lineupPlayer.createMany({
      data: [
        ...draft.starters.map((playerId, order) => ({ lineupId: lineup.id, playerId, role: 'STARTER', order })),
        ...draft.bench.map((playerId, order) => ({ lineupId: lineup.id, playerId, role: 'BENCH', order })),
      ],
    });
    return lineup;
  });
}

/** Garantiza que exista una alineación persistida (se congela al empezar la jornada). */
export async function ensureLineup(teamId: number, gameweekId: number) {
  const existing = await prisma.lineup.findUnique({ where: { teamId_gameweekId: { teamId, gameweekId } } });
  if (existing) return existing;
  const draft = await buildDraft(teamId, gameweekId);
  if (!draft) return null;
  return persistLineup(teamId, gameweekId, draft);
}

export async function getLineupView(userId: string, gameweekId?: number) {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId } });
  if (!team) throw notFound('Aún no has creado tu equipo Fantasy');
  const gw = gameweekId ? await prisma.gameweek.findUnique({ where: { id: gameweekId } }) : await getEditableGameweek();
  if (!gw) throw notFound('Jornada no encontrada');
  return buildLineupView(team.id, gw.id, true);
}

/** Alineación de otro mánager: solo visible cuando la jornada ya ha empezado. */
export async function getPublicLineupView(teamId: number, gameweekId: number) {
  const locks = await getGameweekLocks(gameweekId);
  if (!locks) throw notFound('Jornada no encontrada');
  if (!locks.anyLocked) throw forbidden('Las alineaciones rivales se muestran cuando empieza la jornada');
  return buildLineupView(teamId, gameweekId, false);
}

async function buildLineupView(teamId: number, gameweekId: number, isOwner: boolean) {
  const settings = await getSettings();
  const locks = (await getGameweekLocks(gameweekId))!;
  const { entries, members, aggMap } = await loadSquad(teamId);
  const row = await prisma.lineup.findUnique({
    where: { teamId_gameweekId: { teamId, gameweekId } },
    include: { players: { include: { player: { select: playerSelect } } }, coach: { select: { id: true, displayName: true, photoUrl: true, clubId: true, club: { select: { shortName: true, name: true, crestUrl: true } } } } },
  });
  const cardMods = (await cardModifiersForGameweek(gameweekId)).byTeam.get(teamId);

  let draft: LineupDraft | null;
  if (row) {
    const stored = rowToDraft(row);
    // En jornadas ya iniciadas no se reordena automáticamente (respetar bloqueos)
    draft = locks.anyLocked || row.isFinal ? stored : normalizeLineup(stored, members);
  } else {
    draft = await buildDraft(teamId, gameweekId, { entries, members, aggMap });
  }

  // Jugadores relevantes: plantilla actual + los que figuran en la alineación guardada
  const playerMap = new Map(entries.map((e) => [e.playerId, e.player]));
  for (const lp of row?.players ?? []) if (!playerMap.has(lp.playerId)) playerMap.set(lp.playerId, lp.player);

  const stats = await prisma.playerStatistic.groupBy({
    by: ['playerId'],
    where: { gameweekId, playerId: { in: [...playerMap.keys()] } },
    _sum: { points: true, minutes: true },
  });
  const statMap = new Map(stats.map((s) => [s.playerId, { points: s._sum.points ?? 0, minutes: s._sum.minutes ?? 0 }]));

  const roleOf = (id: number): 'STARTER' | 'BENCH' | 'OUT' =>
    draft?.starters.includes(id) ? 'STARTER' : draft?.bench.includes(id) ? 'BENCH' : 'OUT';
  const orderOf = (id: number) => {
    const s = draft?.starters.indexOf(id) ?? -1;
    return s >= 0 ? s : (draft?.bench.indexOf(id) ?? -1);
  };

  // Puntuación: definitiva si está cerrada, provisional (en vivo) si la jornada ha empezado
  let scoring: ReturnType<typeof scoreLineup> | null = null;
  if (draft && locks.anyLocked && !row?.isFinal) {
    const scoringEntries: ScoringEntry[] = [...draft.starters, ...draft.bench].map((id) => {
      const p = playerMap.get(id)!;
      return {
        playerId: id,
        position: p.position as Position,
        role: roleOf(id) as 'STARTER' | 'BENCH',
        order: orderOf(id),
        points: statMap.get(id)?.points ?? 0,
        minutes: statMap.get(id)?.minutes ?? 0,
        done: locks.clubDone(p.clubId),
      };
    });
    scoring = scoreLineup(scoringEntries, {
      captainId: draft.captainId,
      viceCaptainId: draft.viceCaptainId,
      captainMultiplier: settings.captain_multiplier,
      viceCaptainEnabled: settings.vice_captain_enabled,
      autoSubsEnabled: settings.auto_subs_enabled,
    });
  }
  const storedById = new Map((row?.players ?? []).map((p) => [p.playerId, p]));
  // Efecto de las cartas en vivo (misma función que la puntuación definitiva)
  const liveCardDelta = new Map<number, number>();
  if (scoring && cardMods) {
    for (const e of scoring.entries) {
      const m = cardMods.get(e.playerId);
      if (m?.length) liveCardDelta.set(e.playerId, applyCardModifiers(e.points, e.multiplier, m, settings.card_captain_stacking as 'MAX' | 'STACK').delta);
    }
  }
  const liveCardPoints = [...liveCardDelta.values()].reduce((a, b) => a + b, 0);
  const liveCoachPoints = row?.coach?.clubId && !row.isFinal ? ((await coachPointsByClub(gameweekId, settings)).get(row.coach.clubId) ?? 0) : 0;

  const players = [...playerMap.values()].map((p) => {
    const fixtures = (locks.clubFixtures.get(p.clubId) ?? []).map((f) => {
      const home = f.homeClubId === p.clubId;
      return {
        id: f.id,
        home,
        opponent: home ? f.awayClub : f.homeClub,
        kickoff: f.kickoff,
        status: f.status,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        difficulty: home ? f.homeDifficulty : f.awayDifficulty,
      };
    });
    const scored = scoring?.entries.find((e) => e.playerId === p.id);
    const stored = storedById.get(p.id);
    const inSquad = entries.some((e) => e.playerId === p.id);
    return {
      player: toPlayerDTO(p, aggFor(aggMap, p.id)),
      role: roleOf(p.id),
      order: orderOf(p.id),
      inSquad,
      locked: locks.gameweek.isProcessed || locks.clubLocked(p.clubId),
      fixtures,
      minutes: statMap.get(p.id)?.minutes ?? 0,
      points: statMap.get(p.id)?.points ?? 0,
      multiplier: row?.isFinal ? (stored?.multiplier ?? 0) : (scored?.multiplier ?? (roleOf(p.id) === 'STARTER' ? 1 : 0)),
      autoSubIn: row?.isFinal ? !!stored?.autoSubIn : !!scored?.autoSubIn,
      autoSubOut: row?.isFinal ? !!stored?.autoSubOut : !!scored?.autoSubOut,
      cards: (cardMods?.get(p.id) ?? []).map((m) => m.effect),
      cardDelta: row?.isFinal ? (stored?.cardDelta ?? 0) : (liveCardDelta.get(p.id) ?? 0),
    };
  });

  const validation = draft
    ? validateLineup({
        formation: draft.formation,
        starters: draft.starters.map((id) => liteOf(playerMap.get(id)!)),
        bench: draft.bench.map((id) => liteOf(playerMap.get(id)!)),
        captainId: draft.captainId,
        viceCaptainId: draft.viceCaptainId,
        squad: entries.map((e) => liteOf(e.player)),
      })
    : { valid: false, errors: ['Tu plantilla está vacía: ficha jugadores en el mercado'], warnings: [] };

  const { gameweeks } = await getGameweekContext();
  const teamLineups = await prisma.lineup.findMany({ where: { teamId }, select: { gameweekId: true, points: true } });
  const editableGw = await getEditableGameweek();

  return {
    teamId,
    isOwner,
    gameweek: {
      id: locks.gameweek.id,
      name: locks.gameweek.name,
      deadline: locks.gameweek.deadline,
      status: locks.gameweek.status,
      isProcessed: locks.gameweek.isProcessed,
    },
    lockMode: locks.lockMode,
    editable: isOwner && !locks.allLocked && !row?.isFinal,
    isSaved: !!row,
    isFinal: !!row?.isFinal,
    formation: draft?.formation ?? '4-4-2',
    captainId: draft?.captainId ?? null,
    viceCaptainId: draft?.viceCaptainId ?? null,
    activeCaptainId: scoring?.activeCaptainId ?? null,
    points: row?.isFinal ? row.points : scoring ? scoring.total + liveCardPoints + liveCoachPoints : (row?.points ?? 0),
    cardPoints: row?.isFinal ? row.cardPoints : liveCardPoints,
    coach: row?.coach
      ? { id: row.coach.id, displayName: row.coach.displayName, photoUrl: row.coach.photoUrl, club: row.coach.club, points: row.isFinal ? row.coachPoints : liveCoachPoints }
      : null,
    benchPoints: row?.isFinal ? row.benchPoints : (scoring?.benchPoints ?? 0),
    players,
    validation,
    gameweeks: gameweeks
      .filter((g) => teamLineups.some((l) => l.gameweekId === g.id) || (editableGw && g.id >= editableGw.id && g.id <= editableGw.id + 3))
      .map((g) => ({ id: g.id, name: g.name, status: g.status, points: teamLineups.find((l) => l.gameweekId === g.id)?.points ?? null })),
  };
}

function liteOf(p: { id: number; position: string; status: string; displayName: string }) {
  return { id: p.id, position: p.position as Position, status: p.status, name: p.displayName };
}

export interface SaveLineupInput {
  formation: string;
  starters: number[];
  bench: number[];
  captainId: number;
  viceCaptainId: number | null;
}

export async function saveLineup(userId: string, gameweekId: number, input: SaveLineupInput) {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId } });
  if (!team) throw notFound('Aún no has creado tu equipo Fantasy');
  const locks = await getGameweekLocks(gameweekId);
  if (!locks) throw notFound('Jornada no encontrada');
  if (locks.gameweek.isProcessed || locks.allLocked) throw badRequest(`La ${locks.gameweek.name} está cerrada: ya no se pueden hacer cambios`);

  const { entries } = await loadSquad(team.id);
  const byId = new Map(entries.map((e) => [e.playerId, e.player]));
  for (const id of [...input.starters, ...input.bench]) {
    if (!byId.has(id)) throw badRequest('La alineación contiene jugadores que no están en tu plantilla');
  }

  const validation = validateLineup({
    formation: input.formation,
    starters: input.starters.map((id) => liteOf(byId.get(id)!)),
    bench: input.bench.map((id) => liteOf(byId.get(id)!)),
    captainId: input.captainId,
    viceCaptainId: input.viceCaptainId,
    squad: entries.map((e) => liteOf(e.player)),
  });
  if (!validation.valid) throw badRequest(validation.errors[0], validation);

  // Reglas de bloqueo frente a la alineación vigente
  const existing = await prisma.lineup.findUnique({ where: { teamId_gameweekId: { teamId: team.id, gameweekId } }, include: { players: true } });
  const current = existing ? rowToDraft(existing) : await buildDraft(team.id, gameweekId);
  if (current && locks.anyLocked) {
    const roleIn = (d: LineupDraft, id: number) => (d.starters.includes(id) ? 'STARTER' : d.bench.includes(id) ? `BENCH${d.bench.indexOf(id)}` : 'OUT');
    const next: LineupDraft = { ...input };
    for (const [id, p] of byId) {
      if (!locks.clubLocked(p.clubId)) continue;
      const before = roleIn(current, id);
      const after = roleIn(next, id);
      if (before !== after) throw badRequest(`${p.displayName} está bloqueado: su partido ya ha comenzado`);
    }
    const lockedId = (id: number | null) => (id ? locks.clubLocked(byId.get(id)?.clubId ?? -1) : false);
    if (current.captainId !== input.captainId && (lockedId(current.captainId) || lockedId(input.captainId)))
      throw badRequest('No puedes cambiar el capitán: uno de los jugadores implicados ya ha jugado');
    if (current.viceCaptainId !== input.viceCaptainId && (lockedId(current.viceCaptainId) || lockedId(input.viceCaptainId)))
      throw badRequest('No puedes cambiar el vicecapitán: uno de los jugadores implicados ya ha jugado');
  }

  await persistLineup(team.id, gameweekId, input);
  return { saved: true, warnings: validation.warnings };
}

export async function listTeamsWithoutValidLineup(gameweekId: number) {
  const teams = await prisma.fantasyTeam.findMany({
    select: { id: true, userId: true, _count: { select: { players: true } }, lineups: { where: { gameweekId }, select: { id: true } } },
  });
  return teams;
}

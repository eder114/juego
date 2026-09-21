import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/errors';
import {
  DATASET_FILES,
  datasetClubSchema,
  datasetFixtureSchema,
  datasetGameweekSchema,
  datasetPlayerSchema,
  datasetPriceSchema,
  datasetStatSchema,
  type DatasetPlayer,
  type SeasonDataset,
} from '../providers/dataset';
import { fetchFplDataset } from '../providers/fpl.provider';
import { BLOCKING_STATUSES, type PlayerStatus, type Position } from '../domain/constants';
import { scorePerformance } from '../domain/scoring';
import { invalidatePlayerAggregates } from './player-stats.service';
import { notifyOwners } from './notification.service';
import { syncGameweekStatuses } from './gameweek.service';
import { loadRules, recalculateStatistics } from './scoring.service';
import { ensurePlayerValuations } from './valuation.service';

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

export async function loadDatasetFromDir(dir: string): Promise<SeasonDataset> {
  const read = async (file: string, fallback: unknown = []) => {
    try {
      return JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw err;
    }
  };
  return {
    meta: await read(DATASET_FILES.meta, { season: '2026/27', source: 'local', fetchedAt: new Date().toISOString() }),
    clubs: datasetClubSchema.array().parse(await read(DATASET_FILES.clubs)),
    players: datasetPlayerSchema.array().parse(await read(DATASET_FILES.players)),
    gameweeks: datasetGameweekSchema.array().parse(await read(DATASET_FILES.gameweeks)),
    fixtures: datasetFixtureSchema.array().parse(await read(DATASET_FILES.fixtures)),
    stats: datasetStatSchema.array().parse(await read(DATASET_FILES.stats)),
    prices: datasetPriceSchema.array().parse(await read(DATASET_FILES.prices)),
  };
}

export interface ImportSummary {
  clubs: number;
  playersCreated: number;
  playersUpdated: number;
  gameweeks: number;
  fixtures: number;
  stats: number;
  statusChanges: number;
}

function playerData(p: DatasetPlayer, clubId: number) {
  return {
    code: p.code ?? null,
    firstName: p.firstName,
    lastName: p.lastName,
    displayName: p.displayName,
    position: p.position,
    clubId,
    birthDate: p.birthDate ? new Date(p.birthDate) : null,
    nationality: p.nationality ?? null,
    photoUrl: p.photoUrl ?? null,
    squadNumber: p.squadNumber ?? null,
    status: p.status,
    chanceOfPlaying: p.chanceOfPlaying ?? null,
    news: p.news ?? null,
    isActive: p.isActive,
  };
}

/**
 * Carga un dataset normalizado en la base de datos.
 * - seed: carga inicial completa (precios e historial desde la fuente).
 * - sync: actualización periódica; los precios de jugadores existentes los gestiona el motor propio.
 * Con tablas vacías se usan inserciones masivas (mucho más rápido contra una BD remota).
 */
export async function importDataset(ds: SeasonDataset, mode: 'seed' | 'sync'): Promise<ImportSummary> {
  const summary: ImportSummary = { clubs: 0, playersCreated: 0, playersUpdated: 0, gameweeks: 0, fixtures: 0, stats: 0, statusChanges: 0 };

  // Clubes
  for (const c of ds.clubs) {
    const data = {
      externalId: c.externalId ?? null,
      code: c.code ?? null,
      name: c.name,
      shortName: c.shortName,
      commonName: c.commonName ?? null,
      city: c.city,
      stadium: c.stadium,
      primaryColor: c.primaryColor,
      secondaryColor: c.secondaryColor,
      crestUrl: c.crestUrl ?? null,
      isActive: true,
    };
    await prisma.club.upsert({ where: { shortName: c.shortName }, create: data, update: data });
    summary.clubs += 1;
  }
  if (mode === 'seed' || ds.clubs.length >= 20) {
    await prisma.club.updateMany({ where: { shortName: { notIn: ds.clubs.map((c) => c.shortName) } }, data: { isActive: false } });
  }
  const clubs = await prisma.club.findMany();
  const clubByShort = new Map(clubs.map((c) => [c.shortName, c]));

  // Jornadas
  await chunked(ds.gameweeks, 100, (chunk) =>
    prisma.$transaction(
      chunk.map((g) =>
        prisma.gameweek.upsert({
          where: { id: g.number },
          create: { id: g.number, name: g.name, deadline: new Date(g.deadline), season: ds.meta.season },
          update: { name: g.name, deadline: new Date(g.deadline), season: ds.meta.season },
        }),
      ),
    ),
  );
  summary.gameweeks = ds.gameweeks.length;
  const gwDeadline = new Map(ds.gameweeks.map((g) => [g.number, new Date(g.deadline)]));

  // Jugadores
  const existing = await prisma.player.findMany({ select: { id: true, externalId: true, status: true } });
  const byExternal = new Map(existing.filter((p) => p.externalId !== null).map((p) => [p.externalId!, p]));
  const pricesByPlayer = new Map<number, { gameweek: number; price: number }[]>();
  for (const p of ds.prices) {
    const list = pricesByPlayer.get(p.player) ?? [];
    list.push(p);
    pricesByPlayer.set(p.player, list);
  }
  const firstGw = ds.gameweeks[0]?.number ?? 1;
  const priceRowsFor = (playerId: number, externalId: number | null | undefined, price: number) => {
    const history = (externalId ? pricesByPlayer.get(externalId) : undefined) ?? [];
    const points = history.length ? history : [{ gameweek: firstGw, price }];
    const rows = points.map((h, i) => ({
      playerId,
      gameweekId: gwDeadline.has(h.gameweek) ? h.gameweek : null,
      price: h.price,
      change: i === 0 ? 0 : h.price - points[i - 1].price,
      reason: i === 0 ? 'INITIAL' : 'SYNC',
      createdAt: new Date((gwDeadline.get(h.gameweek) ?? new Date()).getTime() - 3600 * 1000),
    }));
    const last = points[points.length - 1].price;
    if (last !== price) rows.push({ playerId, gameweekId: null, price, change: price - last, reason: 'SYNC', createdAt: new Date() });
    return rows;
  };
  const statusAlerts: { id: number; name: string; status: string; news: string | null }[] = [];

  if (existing.length === 0) {
    const rows = ds.players.filter((p) => clubByShort.has(p.club)).map((p) => ({ ...playerData(p, clubByShort.get(p.club)!.id), externalId: p.externalId ?? null, price: p.price }));
    await chunked(rows, 500, (chunk) => prisma.player.createMany({ data: chunk }));
    summary.playersCreated = rows.length;
    const created = await prisma.player.findMany({ select: { id: true, externalId: true, price: true } });
    const priceRows = created.flatMap((p) => priceRowsFor(p.id, p.externalId, p.price));
    await chunked(priceRows, 1000, (chunk) => prisma.playerPrice.createMany({ data: chunk }));
  } else {
    for (const p of ds.players) {
      const club = clubByShort.get(p.club);
      if (!club) continue;
      const found = p.externalId ? byExternal.get(p.externalId) : undefined;
      const base = playerData(p, club.id);
      if (found) {
        await prisma.player.update({ where: { id: found.id }, data: mode === 'seed' ? { ...base, price: p.price } : base });
        summary.playersUpdated += 1;
        if (found.status !== p.status) {
          summary.statusChanges += 1;
          statusAlerts.push({ id: found.id, name: p.displayName, status: p.status, news: p.news ?? null });
        }
      } else {
        const created = await prisma.player.create({ data: { ...base, externalId: p.externalId ?? null, price: p.price } });
        await prisma.playerPrice.createMany({ data: priceRowsFor(created.id, p.externalId, p.price) });
        summary.playersCreated += 1;
      }
    }
  }

  // Partidos
  const fixtureRow = (f: SeasonDataset['fixtures'][number]) => {
    const home = clubByShort.get(f.home);
    const away = clubByShort.get(f.away);
    if (!home || !away || !gwDeadline.has(f.gameweek)) return null;
    return {
      gameweekId: f.gameweek,
      homeClubId: home.id,
      awayClubId: away.id,
      kickoff: f.kickoff ? new Date(f.kickoff) : null,
      status: f.status,
      homeScore: f.homeScore ?? null,
      awayScore: f.awayScore ?? null,
      minute: f.minute,
      homeDifficulty: f.homeDifficulty ?? null,
      awayDifficulty: f.awayDifficulty ?? null,
    };
  };
  const fixturesExisting = await prisma.fixture.findMany({ select: { id: true, externalId: true } });
  if (fixturesExisting.length === 0) {
    const rows = ds.fixtures.map((f) => ({ f, row: fixtureRow(f) })).filter((x) => x.row).map((x) => ({ ...x.row!, externalId: x.f.externalId ?? null }));
    await chunked(rows, 500, (chunk) => prisma.fixture.createMany({ data: chunk }));
    summary.fixtures = rows.length;
  } else {
    const fixtureByExternal = new Map(fixturesExisting.filter((f) => f.externalId !== null).map((f) => [f.externalId!, f.id]));
    for (const f of ds.fixtures) {
      const data = fixtureRow(f);
      if (!data) continue;
      const id = f.externalId ? fixtureByExternal.get(f.externalId) : undefined;
      if (id) await prisma.fixture.update({ where: { id }, data });
      else await prisma.fixture.create({ data: { ...data, externalId: f.externalId ?? null } });
      summary.fixtures += 1;
    }
  }

  // Estadísticas por partido
  if (ds.stats.length) {
    const players = await prisma.player.findMany({ select: { id: true, externalId: true, clubId: true, position: true } });
    const playerByExternal = new Map(players.filter((p) => p.externalId !== null).map((p) => [p.externalId!, p]));
    const fixtures = await prisma.fixture.findMany({ select: { id: true, externalId: true, gameweekId: true, homeClubId: true, awayClubId: true } });
    const fixtureMeta = new Map(fixtures.filter((f) => f.externalId !== null).map((f) => [f.externalId!, f]));
    const lines = ds.stats
      .map((s) => {
        const player = playerByExternal.get(s.player);
        const fixture = fixtureMeta.get(s.fixture);
        if (!player || !fixture) return null;
        const clubId = [fixture.homeClubId, fixture.awayClubId].includes(player.clubId) ? player.clubId : fixture.homeClubId;
        const { player: _p, fixture: _f, ...line } = s;
        void _p;
        void _f;
        return { line, player, fixture, clubId };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if ((await prisma.playerStatistic.count()) === 0) {
      const rules = await loadRules();
      const rows = lines.map(({ line, player, fixture, clubId }) => {
        const { points, breakdown } = scorePerformance(player.position as Position, line, rules);
        return { ...line, playerId: player.id, fixtureId: fixture.id, gameweekId: fixture.gameweekId, clubId, points, breakdown: JSON.stringify(breakdown) };
      });
      await chunked(rows, 500, (chunk) => prisma.playerStatistic.createMany({ data: chunk }));
    } else {
      const ops = lines.map(({ line, player, fixture, clubId }) =>
        prisma.playerStatistic.upsert({
          where: { playerId_fixtureId: { playerId: player.id, fixtureId: fixture.id } },
          create: { ...line, playerId: player.id, fixtureId: fixture.id, gameweekId: fixture.gameweekId, clubId },
          update: { ...line, gameweekId: fixture.gameweekId, clubId },
        }),
      );
      await chunked(ops, 250, (chunk) => prisma.$transaction(chunk));
    }
    summary.stats = lines.length;
  }

  if (mode === 'sync') await handleStatusChanges(statusAlerts);
  await recalculateStatistics();
  await syncGameweekStatuses();
  invalidatePlayerAggregates();
  return summary;
}

/** Registra lesiones/sanciones y avisa a los mánagers afectados. */
export async function handleStatusChanges(changes: { id: number; name: string; status: string; news: string | null }[]) {
  for (const c of changes) {
    if (BLOCKING_STATUSES.includes(c.status as PlayerStatus) || c.status === 'DOUBTFUL') {
      await prisma.playerInjury.updateMany({ where: { playerId: c.id, isActive: true }, data: { isActive: false } });
      await prisma.playerInjury.create({
        data: {
          playerId: c.id,
          type: c.status === 'SUSPENDED' ? 'SUSPENSION' : c.status === 'UNAVAILABLE' ? 'OTHER' : 'INJURY',
          description: c.news || (c.status === 'DOUBTFUL' ? 'Duda para el próximo partido' : 'No disponible'),
        },
      });
      await notifyOwners(c.id, () => ({
        type: 'INJURY',
        title: c.status === 'SUSPENDED' ? `${c.name} está sancionado` : c.status === 'DOUBTFUL' ? `${c.name} es duda` : `Tienes jugadores lesionados: ${c.name}`,
        message: c.news || 'Revisa tu alineación antes del cierre de la jornada.',
        link: '/lineup',
      }));
    } else if (c.status === 'AVAILABLE') {
      await prisma.playerInjury.updateMany({ where: { playerId: c.id, isActive: true }, data: { isActive: false } });
    }
  }
}

// ─────────────────────── Importación de jugadores JSON / CSV ───────────────────────

export function parseCsv(text: string): Record<string, string>[] {
  try {
    return parseCsvSync(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, delimiter: [',', ';'] });
  } catch (err) {
    throw badRequest(`CSV inválido: ${(err as Error).message}`);
  }
}

const POSITION_ALIASES: Record<string, string> = {
  GK: 'GK', GKP: 'GK', POR: 'GK', PORTERO: 'GK', GOALKEEPER: 'GK',
  DEF: 'DEF', DF: 'DEF', DEFENSA: 'DEF', DEFENDER: 'DEF',
  MID: 'MID', MC: 'MID', CENTROCAMPISTA: 'MID', MIDFIELDER: 'MID',
  FWD: 'FWD', DEL: 'FWD', DELANTERO: 'FWD', FORWARD: 'FWD', ST: 'FWD',
};

function normalizeRow(raw: Record<string, unknown>, clubs: { name: string; shortName: string; commonName: string | null }[]) {
  const get = (k: string) => {
    const v = raw[k];
    return v === '' || v === undefined ? undefined : v;
  };
  const clubRaw = String(get('club') ?? '').trim();
  const club = clubs.find((c) => [c.shortName, c.name, c.commonName ?? ''].some((n) => n.toLowerCase() === clubRaw.toLowerCase()));
  const priceRaw = Number(String(get('price') ?? '').replace(',', '.'));
  // Se aceptan millones (13.0) o décimas (130)
  const price = Number.isFinite(priceRaw) ? (priceRaw < 30 ? Math.round(priceRaw * 10) : Math.round(priceRaw)) : NaN;
  const isActiveRaw = get('isActive');
  return {
    externalId: get('externalId'),
    code: get('code'),
    firstName: get('firstName'),
    lastName: get('lastName'),
    displayName: get('displayName') ?? get('lastName'),
    position: POSITION_ALIASES[String(get('position') ?? '').toUpperCase()] ?? get('position'),
    club: club?.shortName ?? clubRaw,
    birthDate: get('birthDate') ?? null,
    nationality: get('nationality') ?? null,
    photoUrl: get('photoUrl') ?? null,
    squadNumber: get('squadNumber') ?? null,
    price,
    status: get('status') ? String(get('status')).toUpperCase() : undefined,
    chanceOfPlaying: get('chanceOfPlaying') ?? null,
    news: get('news') ?? null,
    isActive: isActiveRaw === undefined ? true : ['true', '1', 'si', 'sí', 'yes'].includes(String(isActiveRaw).toLowerCase()) || isActiveRaw === true,
  };
}

export async function importPlayers(rows: Record<string, unknown>[], opts: { dryRun?: boolean } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw badRequest('El archivo no contiene jugadores');
  if (rows.length > 2000) throw badRequest('Máximo 2000 jugadores por importación');
  const clubs = await prisma.club.findMany({ select: { id: true, name: true, shortName: true, commonName: true } });
  const clubIds = new Set(clubs.map((c) => c.shortName));
  const valid: DatasetPlayer[] = [];
  const errors: { row: number; message: string }[] = [];

  rows.forEach((raw, i) => {
    const normalized = normalizeRow(raw, clubs);
    const parsed = datasetPlayerSchema.safeParse(normalized);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ row: i + 1, message: `${issue.path.join('.') || 'fila'}: ${issue.message}` });
    } else if (!clubIds.has(parsed.data.club)) {
      errors.push({ row: i + 1, message: `Club desconocido: ${normalized.club}` });
    } else valid.push(parsed.data);
  });

  let created = 0;
  let updated = 0;
  if (!opts.dryRun) {
    const clubByShort = new Map(clubs.map((c) => [c.shortName, c.id]));
    for (const p of valid) {
      const clubId = clubByShort.get(p.club)!;
      const match =
        (p.externalId ? await prisma.player.findUnique({ where: { externalId: p.externalId } }) : null) ??
        (await prisma.player.findFirst({ where: { firstName: p.firstName, lastName: p.lastName, clubId } }));
      const { code: _code, ...data } = playerData(p, clubId);
      void _code;
      if (match) {
        await prisma.player.update({ where: { id: match.id }, data: { ...data, price: p.price } });
        if (match.price !== p.price) {
          await prisma.playerPrice.create({ data: { playerId: match.id, price: p.price, change: p.price - match.price, reason: 'IMPORT' } });
        }
        updated += 1;
      } else {
        const player = await prisma.player.create({ data: { ...data, price: p.price, externalId: p.externalId ?? null, code: p.code ?? null } });
        await prisma.playerPrice.create({ data: { playerId: player.id, price: p.price, reason: 'IMPORT' } });
        created += 1;
      }
    }
    invalidatePlayerAggregates();
  }
  return { total: rows.length, valid: valid.length, created, updated, errors: errors.slice(0, 100), dryRun: !!opts.dryRun };
}

// ─────────────────────── Sincronización con la API ───────────────────────

let syncing: Promise<unknown> | null = null;
export let lastSync: { at: Date; ok: boolean; message: string } | null = null;

export async function syncFromProvider() {
  if (syncing) throw badRequest('Ya hay una sincronización en curso');
  const run = (async () => {
    try {
      const clubsMeta = await prisma.club.findMany();
      const now = new Date();
      const recentGws = await prisma.gameweek.findMany({
        where: { deadline: { lte: now }, OR: [{ isProcessed: false }, { endsAt: { gte: new Date(now.getTime() - 3 * 24 * 3600 * 1000) } }] },
        select: { id: true },
      });
      const ds = await fetchFplDataset({ history: false, liveGameweeks: recentGws.map((g) => g.id), clubsMeta });
      const summary = await importDataset(ds, 'sync');
      // Jugadores nuevos en la Premier: reciben su valor inicial en la economía de liga
      await ensurePlayerValuations();
      lastSync = { at: new Date(), ok: true, message: `${summary.playersUpdated} jugadores, ${summary.fixtures} partidos, ${summary.stats} estadísticas` };
      return summary;
    } catch (err) {
      lastSync = { at: new Date(), ok: false, message: (err as Error).message };
      throw err;
    }
  })();
  syncing = run;
  try {
    return await run;
  } finally {
    syncing = null;
  }
}

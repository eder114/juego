/**
 * Carga inicial de datos reales: configuración, reglas de puntuación, clubes, jugadores, jornadas,
 * calendario, estadísticas por partido e historial de precios (DATA_DIR), administrador y liga global.
 * Se ejecuta con `npm run db:seed` o automáticamente al arrancar con una base de datos vacía.
 */
import path from 'node:path';
import { env, isProd } from '../config/env';
import { prisma } from '../lib/prisma';
import { DEFAULT_SCORING_RULES, SCORING_ACTIONS, SETTINGS_DEFS } from '../domain/constants';
import { importDataset, loadDatasetFromDir } from './import.service';
import { hashPassword } from './auth.service';
import { invalidateSettings } from './settings.service';
import { seedDemo } from './demo.service';

export const bootstrapState = { seeding: false, error: null as string | null };
const BOOTSTRAP_MARKER = 'bootstrap_completed';

export async function ensureAdminAndGlobalLeague() {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  const admin = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', isActive: true } })
    : await prisma.user.create({ data: { email, passwordHash: await hashPassword(env.ADMIN_PASSWORD), managerName: 'Administrador', role: 'ADMIN' } });

  const global = await prisma.league.upsert({
    where: { code: 'GLOBAL' },
    create: { name: 'Liga Global Premier Fantasy', description: 'Todos los mánagers compiten aquí', code: 'GLOBAL', type: 'GLOBAL', maxMembers: 1_000_000, isSystem: true, ownerId: admin.id },
    update: {},
  });
  const teams = await prisma.fantasyTeam.findMany({ where: { user: { memberships: { none: { leagueId: global.id } } } }, select: { userId: true } });
  if (teams.length) await prisma.leagueMember.createMany({ data: teams.map((t) => ({ leagueId: global.id, userId: t.userId })) });
  return admin;
}

export async function seedDatabase(log: (msg: string) => void = console.log) {
  const started = Date.now();
  const dataset = await loadDatasetFromDir(path.resolve(env.DATA_DIR));
  log(`📦 Dataset ${dataset.meta.season} (${dataset.meta.source}, ${dataset.meta.fetchedAt})`);

  // Configuración
  for (const [key, def] of Object.entries(SETTINGS_DEFS)) {
    let value: unknown = def.value;
    if (key === 'season') value = dataset.meta.season;
    if (key === 'provider_auto_sync' && env.AUTO_SYNC !== undefined) value = env.AUTO_SYNC === 'true';
    await prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value), description: def.label }, update: {} });
  }
  invalidateSettings();

  // Reglas de puntuación
  const rules = await prisma.scoringRule.count();
  if (rules === 0) {
    await prisma.scoringRule.createMany({
      data: DEFAULT_SCORING_RULES.map((r) => ({ position: r.position, action: r.action, points: r.points, isActive: r.isActive, threshold: r.threshold ?? SCORING_ACTIONS[r.action].defaultThreshold })),
    });
  }

  const summary = await importDataset(dataset, 'seed');
  log(`✔ Datos importados: ${JSON.stringify(summary)}`);

  // Los precios de jornadas ya disputadas vienen de la fuente real: no se recalculan
  await prisma.gameweek.updateMany({ where: { deadline: { lte: new Date() } }, data: { pricesUpdated: true, reminderSent: true } });

  // Registro de lesiones a partir de los partes médicos reales
  const unavailable = await prisma.player.findMany({ where: { status: { not: 'AVAILABLE' }, news: { not: null }, injuries: { none: { isActive: true } } } });
  if (unavailable.length) {
    await prisma.playerInjury.createMany({
      data: unavailable.map((p) => ({
        playerId: p.id,
        type: p.status === 'SUSPENDED' ? 'SUSPENSION' : p.status === 'UNAVAILABLE' ? 'OTHER' : 'INJURY',
        description: p.news ?? 'No disponible',
      })),
    });
  }

  const admin = await ensureAdminAndGlobalLeague();

  // Noticias generadas a partir de datos reales (resultados y partes médicos)
  if ((await prisma.news.count()) === 0) {
    const finished = await prisma.gameweek.findMany({
      where: { status: 'FINISHED' },
      include: { fixtures: { include: { homeClub: true, awayClub: true }, orderBy: { kickoff: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 3,
    });
    for (const gw of finished.reverse()) {
      const lines = gw.fixtures.filter((f) => f.homeScore !== null).map((f) => `${f.homeClub.name} ${f.homeScore}-${f.awayScore} ${f.awayClub.name}`);
      await prisma.news.create({
        data: {
          title: `Resultados de la ${gw.name}`,
          summary: `Así terminaron los ${lines.length} partidos de la ${gw.name} de la Premier League.`,
          content: lines.join('\n'),
          category: 'GAMEWEEK',
          authorId: admin.id,
          createdAt: gw.endsAt ?? gw.deadline,
        },
      });
    }
    const injured = await prisma.player.findMany({
      where: { status: { in: ['INJURED', 'SUSPENDED', 'DOUBTFUL'] }, news: { not: null }, isActive: true },
      orderBy: { price: 'desc' },
      take: 6,
      include: { club: true },
    });
    for (const p of injured) {
      await prisma.news.create({
        data: {
          title: `Parte médico: ${p.displayName} (${p.club.commonName ?? p.club.name})`,
          summary: p.news!,
          content: `${p.firstName} ${p.lastName} — ${p.news}. Revisa tu alineación si lo tienes en plantilla.`,
          category: 'INJURY',
          clubId: p.clubId,
          playerId: p.id,
          authorId: admin.id,
        },
      });
    }
    await prisma.news.create({
      data: {
        title: `Arranca Premier Fantasy ${dataset.meta.season}`,
        summary: 'Crea tu equipo con £100M, ficha a las estrellas de la Premier League y compite con tus amigos.',
        content: 'Bienvenido a Premier Fantasy. Cada jornada suma puntos según el rendimiento real de los futbolistas. Elige bien a tu capitán: sus puntos valen el doble.',
        category: 'GENERAL',
        authorId: admin.id,
        createdAt: new Date(dataset.gameweeks[0]?.deadline ?? Date.now()),
      },
    });
  }

  await prisma.setting.upsert({
    where: { key: BOOTSTRAP_MARKER },
    create: { key: BOOTSTRAP_MARKER, value: JSON.stringify(new Date().toISOString()), description: 'Carga inicial completada' },
    update: {},
  });
  log(`✔ Seed completado en ${((Date.now() - started) / 1000).toFixed(1)}s · Admin: ${env.ADMIN_EMAIL}`);
}

/** Al arrancar: si la base de datos está vacía, carga la temporada (y la demo si SEED_DEMO=true). */
export async function bootstrapOnBoot() {
  // Solo se considera cargada si la carga terminó (marcador o noticias, que se crean al final):
  // una carga interrumpida se reintenta en el siguiente arranque
  const marker = await prisma.setting.findUnique({ where: { key: BOOTSTRAP_MARKER } });
  const completed = !!marker || (await prisma.news.count()) > 0;
  if (completed) {
    await ensureAdminAndGlobalLeague();
    return;
  }
  bootstrapState.seeding = true;
  console.log('🌱 Base de datos vacía: cargando la temporada…');
  try {
    await seedDatabase();
    if (env.SEED_DEMO) await seedDemo(console.log);
  } catch (err) {
    bootstrapState.error = (err as Error).message;
    console.error('❌ Error en la carga inicial', err);
  } finally {
    bootstrapState.seeding = false;
  }
  if (isProd && bootstrapState.error) console.error('La app arranca, pero sin datos completos. Revisa los logs.');
}

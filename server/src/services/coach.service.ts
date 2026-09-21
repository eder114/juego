import { prisma } from '../lib/prisma';
import { clubLiteSelect } from '../lib/dto';
import { getSettings } from './settings.service';
import { ensureCoachValuations } from './valuation.service';

/**
 * Entrenadores reales. La API de Fantasy Premier League no incluye entrenadores, así que se usan los datos
 * oficiales de la Premier League (footballapi.pulselive.com): el «Manager» activo de cada club de la temporada.
 * Los clubes se enlazan por el código Opta (t3 = Arsenal), el mismo `code` que usa FPL.
 */
const BASE = 'https://footballapi.pulselive.com/football';
const HEADERS = { Origin: 'https://www.premierleague.com', Referer: 'https://www.premierleague.com/', Accept: 'application/json', 'User-Agent': 'PremierFantasy/1.0 (+data sync)' };

export const coachPhotoUrl = (optaId: string) => `https://resources.premierleague.com/premierleague/photos/managers/250x250/${optaId}.png`;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function getJson(path: string, attempt = 1): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return getJson(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`API oficial de la Premier League ${path} respondió ${res.status}`);
  return res.json();
}

/** "2026/27" → id de temporada de la API oficial ("English Premier League Season 2026/2027"). */
async function findCompSeason(season: string) {
  const startYear = season.slice(0, 4);
  const data = await getJson('/competitions/1/compseasons?page=0&pageSize=40');
  const match = (data.content as any[]).find((c) => typeof c.label === 'string' && (c.label.includes(`${startYear}/${Number(startYear) + 1}`) || c.label.includes(`${startYear}/${String(Number(startYear) + 1).slice(2)}`)));
  if (!match) throw new Error(`La API oficial no tiene la temporada ${season}`);
  return Number(match.id);
}

export async function syncCoaches(log: (msg: string) => void = () => {}) {
  const settings = await getSettings();
  const compSeason = await findCompSeason(settings.season);
  const teams = await getJson(`/teams?pageSize=40&compSeasons=${compSeason}&comps=1&altIds=true&page=0`);
  const clubs = await prisma.club.findMany({ where: { code: { not: null } }, select: { id: true, code: true, name: true } });
  const clubByOpta = new Map(clubs.map((c) => [`t${c.code}`, c]));

  const seen = new Set<number>();
  let created = 0;
  let updated = 0;
  for (const t of teams.content as any[]) {
    const club = clubByOpta.get(t.altIds?.opta);
    if (!club) continue;
    const staff = await getJson(`/teams/${Number(t.id)}/compseasons/${compSeason}/staff?pageSize=100&altIds=true&page=0&type=player`);
    const manager = (staff.officials as any[] | undefined)?.find((o) => o.role === 'Manager' && o.active !== false);
    if (!manager) {
      log(`Sin entrenador publicado para ${club.name}`);
      continue;
    }
    const externalId = Number(manager.officialId);
    const optaId: string | null = manager.altIds?.opta ?? null;
    seen.add(externalId);
    const data = {
      optaId,
      firstName: manager.name?.first ?? '',
      lastName: manager.name?.last ?? '',
      displayName: manager.name?.display ?? `${manager.name?.first ?? ''} ${manager.name?.last ?? ''}`.trim(),
      clubId: club.id,
      nationality: manager.birth?.country?.country ?? null,
      birthDate: manager.birth?.date?.millis ? new Date(manager.birth.date.millis) : null,
      photoUrl: optaId ? coachPhotoUrl(optaId) : null,
      isActive: true,
    };
    const existing = await prisma.coach.findUnique({ where: { externalId } });
    if (existing) {
      await prisma.coach.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      // Un club solo tiene un entrenador activo: el anterior deja de estar activo
      await prisma.coach.updateMany({ where: { clubId: club.id, isActive: true }, data: { isActive: false } });
      await prisma.coach.create({ data: { ...data, externalId } });
      created++;
    }
  }
  // Entrenadores que ya no dirigen a ningún club de la temporada
  const deactivated = await prisma.coach.updateMany({ where: { externalId: { notIn: [...seen] }, isActive: true }, data: { isActive: false } });
  const valuations = await ensureCoachValuations();
  const summary = { created, updated, deactivated: deactivated.count, valued: valuations.initialized };
  log(`Entrenadores sincronizados: ${JSON.stringify(summary)}`);
  return summary;
}

export const coachSelect = {
  id: true,
  displayName: true,
  firstName: true,
  lastName: true,
  nationality: true,
  photoUrl: true,
  marketValue: true,
  rarity: true,
  isActive: true,
  club: { select: clubLiteSelect },
} as const;

export async function listCoaches() {
  return prisma.coach.findMany({ select: coachSelect, orderBy: [{ isActive: 'desc' }, { marketValue: 'desc' }] });
}

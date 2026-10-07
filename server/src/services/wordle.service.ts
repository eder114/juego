import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { clubLiteSelect } from '../lib/dto';
import { isPlayableWord, normalizeWord, wordleNameFrom } from '../domain/economy';
import { getSettings } from './settings.service';

/**
 * Diccionario del Wordle: nombres de futbolistas reales
 * ─────────────────────────────────────────────────────
 * El juego sigue siendo un Wordle clásico (verde / amarillo / gris); lo único que cambia es que las
 * palabras admitidas son EXCLUSIVAMENTE apellidos futbolísticos de jugadores de la base de datos, en una
 * sola palabra (`Player.wordleName`). Nunca se aceptan palabras corrientes ni nombres completos, y la
 * comprobación vive solo en el servidor: da igual lo que envíe el navegador.
 */

/** Jugadores que pueden entrar en el Wordle: reales, en activo y de un club de la temporada. */
const ELIGIBLE = { isActive: true, club: { isActive: true }, wordleName: { not: null } } as const;

/** Rellena `wordleName` en los jugadores que aún no lo tengan (arranque y tras cada importación). */
export async function ensurePlayerWordleNames() {
  const pending = await prisma.player.findMany({ where: { wordleName: null }, select: { id: true, displayName: true } });
  if (!pending.length) return { updated: 0 };
  let updated = 0;
  for (const p of pending) {
    const name = wordleNameFrom(p.displayName);
    if (!name) continue;
    await prisma.player.update({ where: { id: p.id }, data: { wordleName: name } });
    updated++;
  }
  if (updated) console.log(`✔ Wordle: ${updated} jugador(es) con nombre de juego`);
  return { updated };
}

/** Recalcula el nombre de Wordle de todos los jugadores (si cambia la regla o se corrigen nombres). */
export async function rebuildPlayerWordleNames() {
  const all = await prisma.player.findMany({ select: { id: true, displayName: true, wordleName: true } });
  let updated = 0;
  for (const p of all) {
    const name = wordleNameFrom(p.displayName);
    if ((name ?? null) === p.wordleName) continue;
    await prisma.player.update({ where: { id: p.id }, data: { wordleName: name } });
    updated++;
  }
  return { players: all.length, updated };
}

/**
 * ¿Es este texto el nombre de un jugador válido para el Wordle? Se compara ya normalizado (mayúsculas,
 * sin tildes ni signos), así que «mbappé», «MBAPPE» y «Mbappe» son la misma entrada.
 */
export async function isPlayerWord(word: string) {
  if (!word) return false;
  return (await prisma.player.count({ where: { ...ELIGIBLE, wordleName: word } })) > 0;
}

/** Cuántos nombres distintos hay para cada longitud (lo usa la administración y la elección del día). */
export async function dictionarySizes() {
  const rows = await prisma.player.findMany({ where: ELIGIBLE, select: { wordleName: true }, distinct: ['wordleName'] });
  const sizes = new Map<number, number>();
  for (const r of rows) sizes.set(r.wordleName!.length, (sizes.get(r.wordleName!.length) ?? 0) + 1);
  return { total: rows.length, byLength: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([length, words]) => ({ length, words })) };
}

export interface DailyWord {
  word: string;
  length: number;
  playerId: number;
}

/**
 * Elige el jugador del día. La respuesta sale de los jugadores más conocidos (los de mayor valor de
 * mercado, hasta `wordle_answer_pool`) para que el desafío sea adivinable, pero como intento se admite
 * cualquier jugador de la misma longitud. La longitud del día es la del jugador elegido.
 */
export async function pickDailyWord(exclude: Set<string>): Promise<DailyWord | null> {
  const s = await getSettings();
  const candidates = await prisma.player.findMany({
    where: { ...ELIGIBLE, marketValue: { not: null } },
    select: { id: true, wordleName: true },
    orderBy: { marketValue: 'desc' },
    take: Math.max(1, s.wordle_answer_pool),
  });
  const valid = candidates.filter((p) => {
    const w = p.wordleName!;
    return w.length >= s.wordle_min_length && w.length <= s.wordle_max_length && isPlayableWord(w, w.length);
  });
  if (!valid.length) return null;
  // Se evitan las palabras de los últimos días mientras queden alternativas
  const fresh = valid.filter((p) => !exclude.has(p.wordleName!));
  const pool = fresh.length ? fresh : valid;
  const chosen = pool[crypto.randomInt(pool.length)];
  return { word: chosen.wordleName!, length: chosen.wordleName!.length, playerId: chosen.id };
}

/** Datos del jugador que se revelan SOLO cuando la partida ha terminado. */
export async function revealPlayer(word: string, playerId?: number | null) {
  const club = { select: clubLiteSelect };
  const player = playerId
    ? await prisma.player.findUnique({ where: { id: playerId }, include: { club } })
    : await prisma.player.findFirst({ where: { ...ELIGIBLE, wordleName: word }, include: { club } });
  if (!player) return null;
  return { id: player.id, displayName: player.displayName, position: player.position, club: player.club, photoUrl: player.photoUrl };
}

/** Normaliza lo que escribe el usuario antes de cualquier comparación. */
export const normalizeGuess = (raw: string) => normalizeWord(raw).replace(/[^A-ZÑ]/g, '');

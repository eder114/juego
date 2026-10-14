import { prisma } from '../lib/prisma';
import { badRequest, conflict } from '../lib/errors';
import type { ChallengeType } from '../domain/constants';
import {
  effectiveStreak,
  evaluateGuess,
  isPlayableWord,
  localDateKey,
  milestoneFor,
  nextLocalMidnight,
  nextStreak,
  wordleReward,
  type LetterState,
} from '../domain/economy';
import { dictionarySizes, normalizeGuess, pickDailyWord, revealPlayer } from './wordle.service';
import { getSettings, streakMilestones, wordleRewards } from './settings.service';
import { changeWallet, creditClassicBudget, isUniqueViolation } from './economy.service';
import { grantCard, grantRandomCard } from './card.service';
import { findTeam } from './team.service';

/**
 * Desafíos diarios
 * ────────────────
 * Arquitectura común (DailyChallenge / DailyChallengeAttempt / DailyChallengeReward / DailyStreak) para cualquier
 * tipo de desafío; hoy existe WORDLE: un Wordle clásico en el que la RESPUESTA del día es el apellido de
 * un futbolista real (ver `wordle.service`), mientras que como intento vale cualquier palabra de esa misma
 * longitud. Reglas que garantiza el servidor:
 *  - La fecha del desafío la calcula el servidor en la zona horaria configurada (el reloj del navegador no cuenta).
 *  - Una partida por usuario, fecha y tipo (restricción única). Recargar, cerrar sesión o repetir peticiones no la reinicia.
 *  - Un intento debe tener exactamente las letras del día; si no, se rechaza y NO gasta oportunidad.
 *    La comprobación es del servidor: el navegador no decide nada.
 *  - Cada intento se registra con compare-and-set sobre el nº de intentos: dos peticiones simultáneas no cuentan doble.
 *  - La palabra solo se envía al cliente cuando la partida termina. La recompensa es única por partida.
 */
const TYPE: ChallengeType = 'WORDLE';
const STREAK_TYPE = 'DAILY_CHALLENGE';

interface GuessRow {
  word: string;
  result: LetterState[];
}

function todayKey(tz: string, now = new Date()) {
  return { date: localDateKey(now, tz), nextResetAt: nextLocalMidnight(now, tz) };
}

interface Secret {
  word: string;
  playerId?: number;
}

const secretOf = (challenge: { secret: string }) => JSON.parse(challenge.secret) as Secret;
const lengthOf = (challenge: { meta: string; secret: string }) => (JSON.parse(challenge.meta) as { length?: number }).length ?? secretOf(challenge).word.length;

/** Desafío del día: un jugador real, el mismo para todos los mánagers, elegido por el servidor. */
async function getOrCreateChallenge(date: string, tz: string) {
  const existing = await prisma.dailyChallenge.findUnique({ where: { type_challengeDate: { type: TYPE, challengeDate: date } } });
  if (existing) return existing;
  // Se evitan los jugadores de los últimos días mientras queden alternativas
  const recent = await prisma.dailyChallenge.findMany({ where: { type: TYPE }, orderBy: { challengeDate: 'desc' }, take: 60, select: { secret: true } });
  const daily = await pickDailyWord(new Set(recent.map((r) => secretOf(r).word)));
  if (!daily) throw badRequest('El Wordle no tiene jugadores disponibles');
  try {
    return await prisma.dailyChallenge.create({
      data: {
        type: TYPE,
        challengeDate: date,
        timezone: tz,
        secret: JSON.stringify({ word: daily.word, playerId: daily.playerId } satisfies Secret),
        meta: JSON.stringify({ length: daily.length }),
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.dailyChallenge.findUniqueOrThrow({ where: { type_challengeDate: { type: TYPE, challengeDate: date } } });
  }
}

async function streakState(userId: string) {
  const row = await prisma.dailyStreak.findUnique({ where: { userId_type: { userId, type: STREAK_TYPE } } });
  return row ? { current: row.current, best: row.best, lastDate: row.lastDate } : null;
}

/**
 * Estado del desafío de hoy para el usuario. El desafío del día se crea aquí si aún no existe (la partida
 * del usuario no: esa nace con su primer intento), porque el tablero necesita saber cuántas letras tiene.
 */
export async function getWordleState(userId: string, leagueId?: number | null) {
  const s = await getSettings();
  const now = new Date();
  const { date, nextResetAt } = todayKey(s.challenge_timezone, now);
  const [challenge, attempt, streak, team] = await Promise.all([
    s.wordle_enabled ? getOrCreateChallenge(date, s.challenge_timezone) : null,
    prisma.dailyChallengeAttempt.findUnique({ where: { userId_challengeDate_type: { userId, challengeDate: date, type: TYPE } }, include: { reward: true, challenge: true } }),
    streakState(userId),
    findTeam(userId, leagueId),
  ]);
  const today = attempt?.challenge ?? challenge;
  const guesses: GuessRow[] = attempt ? JSON.parse(attempt.guesses) : [];
  const answer = attempt?.completed ? secretOf(attempt.challenge).word : null;
  return {
    type: TYPE,
    enabled: s.wordle_enabled,
    date,
    serverTime: now.toISOString(),
    nextResetAt: nextResetAt.toISOString(),
    timezone: s.challenge_timezone,
    wordLength: today ? lengthOf(today) : 0,
    maxAttempts: attempt?.maxAttempts ?? s.wordle_max_attempts,
    rewards: wordleRewards(s).slice(0, s.wordle_max_attempts),
    rewardCurrency: team?.economyVersion === 2 ? 'K' : 'TENTHS',
    hasTeam: !!team,
    streak: { current: effectiveStreak(streak, date), best: streak?.best ?? 0, requiresWin: s.streak_requires_win },
    milestones: streakMilestones(s),
    attemptsUsed: attempt?.attemptsUsed ?? 0,
    guesses,
    completed: attempt?.completed ?? false,
    won: attempt?.won ?? false,
    // La solución y el jugador solo se revelan cuando la partida ha terminado
    answer,
    player: answer ? await revealPlayer(answer, secretOf(attempt!.challenge).playerId) : null,
    reward: attempt?.reward
      ? { amount: attempt.reward.amount, currency: attempt.reward.currency, streakBonus: attempt.reward.streakBonus, streakDays: attempt.reward.streakDays, cardCode: attempt.reward.cardCode }
      : null,
  };
}

export async function submitWordleGuess(userId: string, rawGuess: string, leagueId?: number | null) {
  const s = await getSettings();
  if (!s.wordle_enabled) throw badRequest('El Wordle está desactivado temporalmente');
  const guess = normalizeGuess(rawGuess);

  const { date } = todayKey(s.challenge_timezone);
  const challenge = await getOrCreateChallenge(date, s.challenge_timezone);
  const answer = secretOf(challenge).word;
  const length = lengthOf(challenge);

  // Wordle clásico: vale CUALQUIER palabra de la longitud del día, sea o no un futbolista. El catálogo
  // de jugadores solo decide la respuesta. La comprobación va antes de tocar la partida, así que un
  // intento con la longitud equivocada no gasta oportunidades.
  if (!isPlayableWord(guess, length)) throw badRequest(`La palabra de hoy tiene ${length} letras`);

  let attempt = await prisma.dailyChallengeAttempt.findUnique({ where: { userId_challengeDate_type: { userId, challengeDate: date, type: TYPE } } });
  if (!attempt) {
    try {
      attempt = await prisma.dailyChallengeAttempt.create({ data: { challengeId: challenge.id, userId, type: TYPE, challengeDate: date, maxAttempts: s.wordle_max_attempts } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      attempt = await prisma.dailyChallengeAttempt.findUniqueOrThrow({ where: { userId_challengeDate_type: { userId, challengeDate: date, type: TYPE } } });
    }
  }
  if (attempt.completed) throw conflict('Ya has jugado el desafío de hoy. ¡Vuelve mañana!');

  const guesses: GuessRow[] = JSON.parse(attempt.guesses);
  const result = evaluateGuess(guess, answer);
  const won = result.every((r) => r === 'correct');
  const used = attempt.attemptsUsed + 1;
  const completed = won || used >= attempt.maxAttempts;
  const current = attempt;

  await prisma.$transaction(async (tx) => {
    // Compare-and-set: el intento solo cuenta si nadie ha registrado otro en paralelo
    const saved = await tx.dailyChallengeAttempt.updateMany({
      where: { id: current.id, attemptsUsed: current.attemptsUsed, completed: false },
      data: { attemptsUsed: used, guesses: JSON.stringify([...guesses, { word: guess, result }]), completed, won, completedAt: completed ? new Date() : null },
    });
    if (saved.count === 0) throw conflict('Ya se registró otro intento a la vez. Recarga el desafío.');
    if (!completed) return;

    // Racha
    const prev = await tx.dailyStreak.findUnique({ where: { userId_type: { userId, type: STREAK_TYPE } } });
    const counts = won || !s.streak_requires_win;
    const next = nextStreak(prev ? { current: prev.current, best: prev.best, lastDate: prev.lastDate } : null, date, counts);
    await tx.dailyStreak.upsert({
      where: { userId_type: { userId, type: STREAK_TYPE } },
      create: { userId, type: STREAK_TYPE, current: next.current, best: next.best, lastDate: next.lastDate },
      update: { current: next.current, best: next.best, lastDate: next.lastDate },
    });

    // Recompensa (única por partida: attemptId es único en daily_challenge_rewards)
    const base = won ? wordleReward(used, wordleRewards(s)) : 0;
    const milestone = counts ? milestoneFor(next.current, streakMilestones(s)) : null;
    // El premio se abona al equipo de la liga activa: cada liga tiene su propia economía
    const team = await findTeam(userId, leagueId);
    let credited = 0;
    let bonus = 0;
    let currency = 'K';
    let cardCode: string | null = null;
    if (team) {
      if (team.economyVersion === 2) {
        if (base > 0)
          await changeWallet(tx, { teamId: team.id, amount: base, type: 'DAILY_CHALLENGE_REWARD', description: `Wordle del ${date} acertado en ${used} intento${used === 1 ? '' : 's'}`, userId, leagueId: team.leagueId, reference: `challenge-attempt:${current.id}`, operationId: `challenge:${current.id}` });
        if (milestone?.money)
          await changeWallet(tx, { teamId: team.id, amount: milestone.money, type: 'STREAK_REWARD', description: `Racha de ${next.current} días`, userId, leagueId: team.leagueId, reference: `challenge-attempt:${current.id}`, operationId: `streak:${current.id}` });
        credited = base;
        bonus = milestone?.money ?? 0;
      } else {
        currency = 'TENTHS';
        if (base > 0) credited = await creditClassicBudget(tx, { teamId: team.id, amountK: base, type: 'DAILY_CHALLENGE_REWARD', description: `Wordle del ${date} acertado en ${used} intento${used === 1 ? '' : 's'}`, reference: `challenge-attempt:${current.id}`, operationId: `challenge:${current.id}` });
        if (milestone?.money) bonus = await creditClassicBudget(tx, { teamId: team.id, amountK: milestone.money, type: 'STREAK_REWARD', description: `Racha de ${next.current} días`, reference: `challenge-attempt:${current.id}`, operationId: `streak:${current.id}` });
      }
      if (milestone?.card) {
        const card = await grantCard(tx, { teamId: team.id, cardCode: milestone.card, source: 'STREAK', sourceRef: `streak:${userId}:${date}:${next.current}` });
        cardCode = card?.code ?? null;
      }
      // Acertar puede dejar caer además una carta al azar; el premio en dinero no cambia
      if (won && !cardCode && s.wordle_card_chance > 0 && Math.random() * 100 < s.wordle_card_chance) {
        const drop = await grantRandomCard(tx, { teamId: team.id, source: 'CHALLENGE', sourceRef: `wordle:${userId}:${date}` });
        cardCode = drop?.code ?? null;
      }
    }
    await tx.dailyChallengeReward.create({
      data: { attemptId: current.id, userId, teamId: team?.id ?? null, amount: credited, currency, streakBonus: bonus, streakDays: next.current, cardCode },
    });
  });

  return getWordleState(userId, leagueId);
}

/** Historial del usuario (últimos desafíos jugados). */
export async function challengeHistory(userId: string) {
  const rows = await prisma.dailyChallengeAttempt.findMany({ where: { userId }, orderBy: { challengeDate: 'desc' }, take: 30, include: { reward: true } });
  return rows.map((r) => ({ date: r.challengeDate, type: r.type, attemptsUsed: r.attemptsUsed, completed: r.completed, won: r.won, reward: r.reward ? { amount: r.reward.amount, currency: r.reward.currency, streakBonus: r.reward.streakBonus, cardCode: r.reward.cardCode } : null }));
}

export async function challengeStats() {
  const s = await getSettings();
  const { date } = todayKey(s.challenge_timezone);
  const [challenge, dictionary] = await Promise.all([
    prisma.dailyChallenge.findUnique({ where: { type_challengeDate: { type: TYPE, challengeDate: date } } }),
    dictionarySizes(),
  ]);
  if (!challenge) return { date, players: 0, won: 0, length: 0, dictionary: dictionary.total };
  const [players, won] = await Promise.all([
    prisma.dailyChallengeAttempt.count({ where: { challengeId: challenge.id } }),
    prisma.dailyChallengeAttempt.count({ where: { challengeId: challenge.id, won: true } }),
  ]);
  return { date, players, won, length: lengthOf(challenge), dictionary: dictionary.total };
}


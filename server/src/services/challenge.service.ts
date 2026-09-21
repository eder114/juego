import crypto from 'node:crypto';
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
  normalizeWord,
  parseWordList,
  wordleReward,
  type LetterState,
} from '../domain/economy';
import { getSettings, streakMilestones, wordleRewards } from './settings.service';
import { changeWallet, creditClassicBudget, isUniqueViolation } from './economy.service';
import { grantCard } from './card.service';

/**
 * Desafíos diarios
 * ────────────────
 * Arquitectura común (DailyChallenge / DailyChallengeAttempt / DailyChallengeReward / DailyStreak) para cualquier
 * tipo de desafío; hoy existe WORDLE. Reglas que garantiza el servidor:
 *  - La fecha del desafío la calcula el servidor en la zona horaria configurada (el reloj del navegador no cuenta).
 *  - Una partida por usuario, fecha y tipo (restricción única). Recargar, cerrar sesión o repetir peticiones no la reinicia.
 *  - Cada intento se registra con compare-and-set sobre el nº de intentos: dos peticiones simultáneas no cuentan doble.
 *  - La palabra solo se envía al cliente cuando la partida termina. La recompensa es única por partida.
 */
const TYPE: ChallengeType = 'WORDLE';
const WORD_LENGTH = 5;
const STREAK_TYPE = 'DAILY_CHALLENGE';

interface GuessRow {
  word: string;
  result: LetterState[];
}

function todayKey(tz: string, now = new Date()) {
  return { date: localDateKey(now, tz), nextResetAt: nextLocalMidnight(now, tz) };
}

async function getOrCreateChallenge(date: string, tz: string) {
  const existing = await prisma.dailyChallenge.findUnique({ where: { type_challengeDate: { type: TYPE, challengeDate: date } } });
  if (existing) return existing;
  const s = await getSettings();
  const words = parseWordList(s.wordle_words, WORD_LENGTH);
  if (!words.length) throw badRequest('El Wordle no tiene palabras configuradas');
  // Evita repetir palabras de los últimos días mientras haya alternativas
  const recent = await prisma.dailyChallenge.findMany({ where: { type: TYPE }, orderBy: { challengeDate: 'desc' }, take: Math.min(60, Math.max(0, words.length - 1)), select: { secret: true } });
  const used = new Set(recent.map((r) => (JSON.parse(r.secret) as { word: string }).word));
  const pool = words.filter((w) => !used.has(w));
  const word = (pool.length ? pool : words)[crypto.randomInt((pool.length ? pool : words).length)];
  try {
    return await prisma.dailyChallenge.create({
      data: { type: TYPE, challengeDate: date, timezone: tz, secret: JSON.stringify({ word }), meta: JSON.stringify({ length: WORD_LENGTH }) },
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

/** Estado del desafío de hoy para el usuario. No crea la partida (se crea con el primer intento). */
export async function getWordleState(userId: string) {
  const s = await getSettings();
  const now = new Date();
  const { date, nextResetAt } = todayKey(s.challenge_timezone, now);
  const [attempt, streak, team] = await Promise.all([
    prisma.dailyChallengeAttempt.findUnique({ where: { userId_challengeDate_type: { userId, challengeDate: date, type: TYPE } }, include: { reward: true, challenge: true } }),
    streakState(userId),
    prisma.fantasyTeam.findUnique({ where: { userId }, select: { id: true, economyVersion: true } }),
  ]);
  const guesses: GuessRow[] = attempt ? JSON.parse(attempt.guesses) : [];
  return {
    type: TYPE,
    enabled: s.wordle_enabled,
    date,
    serverTime: now.toISOString(),
    nextResetAt: nextResetAt.toISOString(),
    timezone: s.challenge_timezone,
    wordLength: WORD_LENGTH,
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
    // La solución solo se revela cuando la partida ha terminado
    answer: attempt?.completed ? (JSON.parse(attempt.challenge.secret) as { word: string }).word : null,
    reward: attempt?.reward
      ? { amount: attempt.reward.amount, currency: attempt.reward.currency, streakBonus: attempt.reward.streakBonus, streakDays: attempt.reward.streakDays, cardCode: attempt.reward.cardCode }
      : null,
  };
}

export async function submitWordleGuess(userId: string, rawGuess: string) {
  const s = await getSettings();
  if (!s.wordle_enabled) throw badRequest('El Wordle está desactivado temporalmente');
  const guess = normalizeWord(rawGuess);
  if (!isPlayableWord(guess, WORD_LENGTH)) throw badRequest(`Escribe una palabra de ${WORD_LENGTH} letras`);

  const { date } = todayKey(s.challenge_timezone);
  const challenge = await getOrCreateChallenge(date, s.challenge_timezone);
  const answer = (JSON.parse(challenge.secret) as { word: string }).word;

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
    const team = await tx.fantasyTeam.findUnique({ where: { userId }, select: { id: true, economyVersion: true, economyLeagueId: true } });
    let credited = 0;
    let bonus = 0;
    let currency = 'K';
    let cardCode: string | null = null;
    if (team) {
      if (team.economyVersion === 2) {
        if (base > 0)
          await changeWallet(tx, { teamId: team.id, amount: base, type: 'DAILY_CHALLENGE_REWARD', description: `Wordle del ${date} acertado en ${used} intento${used === 1 ? '' : 's'}`, userId, leagueId: team.economyLeagueId, reference: `challenge-attempt:${current.id}`, operationId: `challenge:${current.id}` });
        if (milestone?.money)
          await changeWallet(tx, { teamId: team.id, amount: milestone.money, type: 'STREAK_REWARD', description: `Racha de ${next.current} días`, userId, leagueId: team.economyLeagueId, reference: `challenge-attempt:${current.id}`, operationId: `streak:${current.id}` });
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
    }
    await tx.dailyChallengeReward.create({
      data: { attemptId: current.id, userId, teamId: team?.id ?? null, amount: credited, currency, streakBonus: bonus, streakDays: next.current, cardCode },
    });
  });

  return getWordleState(userId);
}

/** Historial del usuario (últimos desafíos jugados). */
export async function challengeHistory(userId: string) {
  const rows = await prisma.dailyChallengeAttempt.findMany({ where: { userId }, orderBy: { challengeDate: 'desc' }, take: 30, include: { reward: true } });
  return rows.map((r) => ({ date: r.challengeDate, type: r.type, attemptsUsed: r.attemptsUsed, completed: r.completed, won: r.won, reward: r.reward ? { amount: r.reward.amount, currency: r.reward.currency, streakBonus: r.reward.streakBonus, cardCode: r.reward.cardCode } : null }));
}

export async function challengeStats() {
  const s = await getSettings();
  const { date } = todayKey(s.challenge_timezone);
  const challenge = await prisma.dailyChallenge.findUnique({ where: { type_challengeDate: { type: TYPE, challengeDate: date } } });
  if (!challenge) return { date, players: 0, won: 0 };
  const [players, won] = await Promise.all([
    prisma.dailyChallengeAttempt.count({ where: { challengeId: challenge.id } }),
    prisma.dailyChallengeAttempt.count({ where: { challengeId: challenge.id, won: true } }),
  ]);
  return { date, players, won };
}


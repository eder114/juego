import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors';
import { clubLiteSelect, parseCrest } from '../lib/dto';
import { signToken } from '../middleware/auth';
import { env } from '../config/env';
import { getSettings } from './settings.service';
import { createTeam } from './squad.service';
import { notify } from './notification.service';
import { sendMail } from './mail.service';

const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 60 * 60 * 1000;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      managerName: true,
      role: true,
      avatarUrl: true,
      createdAt: true,
      favoriteClub: { select: clubLiteSelect },
      team: { select: { id: true, name: true, crest: true, budget: true, totalPoints: true, createdAt: true } },
    },
  });
  if (!user) throw notFound('Usuario no encontrado');
  return { ...user, team: user.team ? { ...user.team, crest: parseCrest(user.team.crest) } : null };
}

export async function register(input: {
  email: string;
  password: string;
  managerName: string;
  /** Opcional: el onboarding crea la cuenta en la fase 1 y el equipo en las fases 2 y 3. */
  teamName?: string;
  favoriteClubId?: number | null;
  crest?: object;
}) {
  const settings = await getSettings();
  if (!settings.registration_open) throw forbidden('El registro de nuevos mánagers está cerrado temporalmente');
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('Ya existe una cuenta con ese email');
  if (await prisma.user.findFirst({ where: { managerName: input.managerName } })) throw conflict('Ese nombre de mánager ya está en uso');
  if (input.favoriteClubId && !(await prisma.club.findUnique({ where: { id: input.favoriteClubId } }))) throw badRequest('Club favorito inválido');

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(input.password),
      managerName: input.managerName,
      favoriteClubId: input.favoriteClubId ?? null,
    },
  });
  if (input.teamName) await createTeam(user.id, { name: input.teamName, crest: input.crest });
  await notify({
    userId: user.id,
    type: 'SYSTEM',
    title: '¡Bienvenido a Premier Fantasy!',
    message: `Tienes £${(settings.initial_budget / 10).toFixed(1)}M para fichar 15 jugadores. Visita el mercado para empezar.`,
    link: '/market',
  });
  return { token: signToken(user), user: await getMe(user.id) };
}

export async function login(emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Comparación siempre ejecutada para no revelar si el email existe por diferencia de tiempos
  const ok = await bcrypt.compare(password, user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok) throw unauthorized('Email o contraseña incorrectos');
  if (!user.isActive) throw forbidden('Tu cuenta está desactivada. Contacta con el administrador');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { token: signToken(user), user: await getMe(user.id) };
}

export async function requestPasswordReset(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return; // Respuesta idéntica exista o no la cuenta
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  const link = `${env.CLIENT_URL}/reset-password?token=${token}`;
  await sendMail(
    user.email,
    'Recupera tu contraseña de Premier Fantasy',
    `Hola ${user.managerName},\n\nPara crear una nueva contraseña abre este enlace (válido 1 hora):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
  );
}

export async function resetPassword(token: string, password: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw badRequest('El enlace de recuperación no es válido o ha caducado');
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  return { reset: true };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('La contraseña actual no es correcta');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  return { changed: true };
}

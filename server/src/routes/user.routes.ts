import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { intParam, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { clubLiteSelect, parseCrest, userPublicSelect } from '../lib/dto';
import { requireAuth } from '../middleware/auth';
import { ACHIEVEMENTS } from '../services/achievement.service';
import { getUserGlobalPosition } from '../services/ranking.service';
import { getMe } from '../services/auth.service';
import { managerNameSchema } from './validators';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
// La imagen se guarda en la BD (el cliente la reduce antes de subirla)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(badRequest('Formato no permitido: usa PNG, JPG o WEBP'));
  },
});

/** Sirve la foto de perfil (pública: se usa en etiquetas <img>). */
export async function avatarHandler(req: Request, res: Response) {
  const avatar = await prisma.userAvatar.findUnique({ where: { userId: String(req.params.userId) } });
  if (!avatar) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', avatar.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(avatar.data));
}

export const userRouter = Router();
userRouter.use(requireAuth);

userRouter.patch('/users/me', async (req, res) => {
  const body = parse(z.object({ managerName: managerNameSchema.optional(), favoriteClubId: z.number().int().positive().nullable().optional() }), req.body);
  if (body.managerName) {
    const taken = await prisma.user.findFirst({ where: { managerName: body.managerName, NOT: { id: req.user!.id } } });
    if (taken) throw conflict('Ese nombre de mánager ya está en uso');
  }
  if (body.favoriteClubId && !(await prisma.club.findUnique({ where: { id: body.favoriteClubId } }))) throw badRequest('Club inválido');
  await prisma.user.update({ where: { id: req.user!.id }, data: body });
  res.json(await getMe(req.user!.id));
});

userRouter.post('/users/me/avatar', upload.single('avatar'), async (req, res) => {
  if (!req.file) throw badRequest('Adjunta una imagen');
  const userId = req.user!.id;
  await prisma.userAvatar.upsert({
    where: { userId },
    create: { userId, mimeType: req.file.mimetype, data: new Uint8Array(req.file.buffer) },
    update: { mimeType: req.file.mimetype, data: new Uint8Array(req.file.buffer) },
  });
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: `/api/avatars/${userId}?v=${Date.now()}` } });
  res.json(await getMe(userId));
});

userRouter.delete('/users/me/avatar', async (req, res) => {
  await prisma.userAvatar.deleteMany({ where: { userId: req.user!.id } });
  await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl: null } });
  res.json(await getMe(req.user!.id));
});

userRouter.get('/users/me/achievements', async (req, res) => {
  const unlocked = await prisma.userAchievement.findMany({ where: { userId: req.user!.id } });
  res.json(
    Object.entries(ACHIEVEMENTS).map(([code, a]) => ({
      code,
      ...a,
      unlockedAt: unlocked.find((u) => u.code === code)?.unlockedAt ?? null,
    })),
  );
});

/** Estadísticas personales del mánager. */
userRouter.get('/users/me/stats', async (req, res) => {
  const team = await prisma.fantasyTeam.findUnique({ where: { userId: req.user!.id } });
  if (!team) {
    res.json(null);
    return;
  }
  const [lineups, transfers, leaguesCount, position, captainRows] = await Promise.all([
    prisma.lineup.findMany({ where: { teamId: team.id, gameweek: { status: { not: 'UPCOMING' } } }, select: { gameweekId: true, points: true, benchPoints: true } }),
    prisma.transfer.findMany({ where: { teamId: team.id }, select: { type: true, price: true, playerId: true } }),
    prisma.leagueMember.count({ where: { userId: req.user!.id } }),
    getUserGlobalPosition(req.user!.id),
    prisma.lineupPlayer.findMany({ where: { lineup: { teamId: team.id }, multiplier: { gt: 1 } }, select: { points: true, multiplier: true } }),
  ]);
  const best = lineups.reduce<(typeof lineups)[number] | null>((b, l) => (!b || l.points > b.points ? l : b), null);
  const played = lineups.length;
  res.json({
    totalPoints: team.totalPoints,
    gameweeksPlayed: played,
    averagePoints: played ? Math.round((team.totalPoints / played) * 10) / 10 : 0,
    bestGameweek: best ? { gameweek: best.gameweekId, points: best.points } : null,
    benchPointsLost: lineups.reduce((s, l) => s + l.benchPoints, 0),
    captainPoints: captainRows.reduce((s, c) => s + c.points * c.multiplier, 0),
    purchases: transfers.filter((t) => t.type === 'BUY').length,
    sales: transfers.filter((t) => t.type === 'SELL').length,
    leagues: leaguesCount,
    globalRank: position.row?.rank ?? null,
    totalManagers: position.total,
  });
});

userRouter.get('/users/:id', async (req, res) => {
  const id = parse(z.string().min(10).max(40), req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { ...userPublicSelect, createdAt: true, favoriteClub: { select: clubLiteSelect }, team: { select: { id: true, name: true, crest: true, totalPoints: true } }, achievements: true },
  });
  if (!user) throw notFound('Mánager no encontrado');
  res.json({ ...user, team: user.team ? { ...user.team, crest: parseCrest(user.team.crest) } : null });
});

// ─────────────── Notificaciones ───────────────
userRouter.get('/notifications', async (req, res) => {
  const { unread } = parse(z.object({ unread: z.enum(['true', 'false']).optional() }), req.query);
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user!.id, isRead: unread === 'true' ? false : undefined },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
  ]);
  res.json({ items, unreadCount });
});

userRouter.get('/notifications/count', async (req, res) => {
  res.json({ unreadCount: await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }) });
});

userRouter.post('/notifications/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  res.json({ ok: true });
});

userRouter.post('/notifications/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: intParam(req.params.id), userId: req.user!.id }, data: { isRead: true } });
  res.json({ ok: true });
});

userRouter.delete('/notifications/:id', async (req, res) => {
  await prisma.notification.deleteMany({ where: { id: intParam(req.params.id), userId: req.user!.id } });
  res.json({ ok: true });
});

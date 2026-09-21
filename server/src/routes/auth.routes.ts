import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { parse } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import * as auth from '../services/auth.service';
import { crestSchema, emailSchema, managerNameSchema, passwordSchema, teamNameSchema } from './validators';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera unos minutos.' } },
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parse(
    z.object({
      email: emailSchema,
      password: passwordSchema,
      managerName: managerNameSchema,
      teamName: teamNameSchema.optional(),
      favoriteClubId: z.number().int().positive().nullish(),
      crest: crestSchema.optional(),
    }),
    req.body,
  );
  res.status(201).json(await auth.register(body));
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().min(1), password: z.string().min(1).max(200) }), req.body);
  res.json(await auth.login(body.email, body.password));
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: emailSchema }), req.body);
  await auth.requestPasswordReset(email);
  res.json({ message: 'Si el email está registrado, recibirás un enlace para restablecer la contraseña.' });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().length(64), password: passwordSchema }), req.body);
  res.json(await auth.resetPassword(body.token, body.password));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await auth.getMe(req.user!.id));
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
  res.json(await auth.changePassword(req.user!.id, body.currentPassword, body.newPassword));
});

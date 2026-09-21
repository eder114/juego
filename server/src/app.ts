import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env, isProd } from './config/env';
import { errorHandler, notFoundHandler } from './lib/http';
import { authRouter } from './routes/auth.routes';
import { catalogRouter } from './routes/catalog.routes';
import { gameRouter } from './routes/game.routes';
import { avatarHandler, userRouter } from './routes/user.routes';
import { adminRouter } from './routes/admin.routes';
import { economyRouter } from './routes/economy.routes';
import { adminEconomyRouter } from './routes/admin-economy.routes';
import { bootstrapState } from './services/bootstrap.service';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://resources.premierleague.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(cors({ origin: isProd ? env.CLIENT_URL : [env.CLIENT_URL, /localhost:\d+$/] }));
  app.use(express.json({ limit: '6mb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones, inténtalo en un momento' } },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', seeding: bootstrapState.seeding, bootstrapError: bootstrapState.error, time: new Date().toISOString() });
  });

  // Mientras se carga la temporada en una BD vacía, la API responde 503
  app.use('/api', (_req, res, next) => {
    if (!bootstrapState.seeding) return next();
    res.status(503).json({ error: { code: 'SEEDING', message: 'Estamos cargando los datos de la temporada. Vuelve a intentarlo en un minuto.' } });
  });

  app.get('/api/avatars/:userId', avatarHandler);
  app.use('/api/auth', authRouter);
  app.use('/api/admin/economy', adminEconomyRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', catalogRouter);
  app.use('/api', gameRouter);
  app.use('/api', economyRouter);
  app.use('/api', userRouter);
  app.use('/api', notFoundHandler);

  // En producción el backend sirve la página web compilada
  const clientDist = path.resolve('../client/dist');
  if (isProd && existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, filePath) => {
          const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
          res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

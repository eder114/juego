import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './lib/prisma';
import { startScheduler } from './services/scheduler';
import { bootstrapOnBoot } from './services/bootstrap.service';

const app = createApp();
let stopScheduler = () => {};

const server = app.listen(env.PORT, () => {
  console.log(`⚽ Premier Fantasy API escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
  // La carga inicial (si la BD está vacía) se hace con el servidor ya escuchando;
  // mientras tanto la API responde 503 y el scheduler espera a que termine.
  bootstrapOnBoot()
    .catch((err) => console.error('❌ Error al preparar la base de datos', err))
    .finally(() => {
      if (env.NODE_ENV !== 'test') stopScheduler = startScheduler();
    });
});

async function shutdown(signal: string) {
  console.log(`\n${signal} recibido, cerrando…`);
  stopScheduler();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

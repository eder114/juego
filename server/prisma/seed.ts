/** Carga de datos reales de la temporada (ver src/services/bootstrap.service.ts). */
import { prisma } from '../src/lib/prisma';
import { seedDatabase } from '../src/services/bootstrap.service';

seedDatabase()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

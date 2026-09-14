/** Datos de demostración opcionales (ver src/services/demo.service.ts). */
import { prisma } from '../src/lib/prisma';
import { seedDemo } from '../src/services/demo.service';

seedDemo()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

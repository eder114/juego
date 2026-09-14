import 'dotenv/config';
import { z } from 'zod';

const DEFAULT_ADMIN_PASSWORD = 'Admin12345!';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  // En Render se usa automáticamente la URL pública del servicio
  CLIENT_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ADMIN_EMAIL: z.string().email().default('admin@premierfantasy.local'),
  ADMIN_PASSWORD: z.string().min(8).default(DEFAULT_ADMIN_PASSWORD),
  DATA_DIR: z.string().default('data/season-2026-27'),
  /** Crea mánagers y ligas de demostración al cargar una base de datos vacía. */
  SEED_DEMO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Activa la sincronización automática con la API de FPL al cargar una base de datos vacía. */
  AUTO_SYNC: z.enum(['true', 'false']).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Premier Fantasy <no-reply@premierfantasy.local>'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

if (isProd && env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
  console.error('❌ En producción debes definir ADMIN_PASSWORD con una contraseña propia (no la de ejemplo).');
  process.exit(1);
}

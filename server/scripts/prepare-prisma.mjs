// Genera prisma/postgres/schema.prisma a partir del esquema principal (SQLite) para producción.
// Así existe una única fuente de verdad del modelo de datos.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('prisma/schema.prisma', 'utf8');
const postgres = source.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
if (postgres === source) throw new Error('No se encontró provider = "sqlite" en prisma/schema.prisma');

mkdirSync('prisma/postgres', { recursive: true });
writeFileSync('prisma/postgres/schema.prisma', `// GENERADO automáticamente desde prisma/schema.prisma — no editar\n${postgres}`);
console.log('✔ Esquema PostgreSQL generado en prisma/postgres/schema.prisma');

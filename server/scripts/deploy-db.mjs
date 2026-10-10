/**
 * Pone la base de datos al día antes de arrancar en producción (Render + Neon).
 *
 * Por qué no se usa `prisma db push` a secas:
 *  - Cuando el cambio incluye algo que Prisma marca como «aviso» (por ejemplo añadir un índice único a
 *    una tabla que ya tiene filas), `db push` pide confirmación. En Render no hay terminal interactiva,
 *    así que se rinde y exige `--accept-data-loss`. Poner esa bandera sería aceptar a ciegas cualquier
 *    borrado, presente o futuro, así que no se usa.
 *  - En su lugar se calcula el SQL exacto que le falta a la base REAL, se comprueba que no borra nada y
 *    se aplica. Si apareciera una operación destructiva, el despliegue se detiene y la imprime.
 *
 * Además, las bases gratuitas de Neon se duermen por inactividad y tardan unos segundos en despertar:
 * los fallos de conexión se reintentan con esperas crecientes en vez de tumbar el despliegue entero.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCHEMA = process.env.DB_PUSH_SCHEMA ?? 'prisma/postgres/schema.prisma';
const ATTEMPTS = Number(process.env.DB_PUSH_ATTEMPTS ?? 6);
const TIMEOUT_MS = Number(process.env.DB_PUSH_TIMEOUT_MS ?? 120_000);
const URL = process.env.DATABASE_URL ?? '';
const log = (msg) => console.log(`[deploy-db] ${msg}`);
const fail = (msg) => console.error(`[deploy-db] ${msg}`);

/** Fallos de conexión: se resuelven solos cuando la base termina de despertar. */
const TRANSIENT = ['P1001', 'P1002', 'P1008', 'P1017', "Can't reach database server", 'Timed out', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'Connection terminated'];

/** Fallos que exigen una acción humana: reintentar no sirve de nada. */
const FATAL = [
  { match: ['P1000', 'Authentication failed'], hint: 'La contraseña de DATABASE_URL no es válida. Vuelve a copiar la cadena de conexión de Neon en Render → Environment.' },
  { match: ['P1003', 'does not exist at'], hint: 'La base indicada en DATABASE_URL no existe. Revisa el nombre de la base en la cadena de conexión.' },
];

/** Sentencias que sí perderían datos. Si aparece alguna, el despliegue se para. */
const DESTRUCTIVE = [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bTRUNCATE\b/i, /\bDROP\s+SCHEMA\b/i, /\bDROP\s+DATABASE\b/i];

function run(args) {
  const r = spawnSync('npx', ['prisma', ...args], { encoding: 'utf8', timeout: TIMEOUT_MS, shell: process.platform === 'win32' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error?.code === 'ETIMEDOUT') return { ok: false, output: `${output}\nTimed out tras ${TIMEOUT_MS / 1000}s` };
  return { ok: r.status === 0, output };
}

function classify(output) {
  const fatal = FATAL.find((f) => f.match.some((m) => output.includes(m)));
  if (fatal) return { kind: 'fatal', hint: fatal.hint };
  return { kind: TRANSIENT.some((t) => output.includes(t)) ? 'transient' : 'unknown', hint: '' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEmptySql = (sql) => !sql || !sql.split('\n').some((l) => l.trim() && !l.trim().startsWith('--'));

/** Ejecuta un paso de Prisma con reintentos. Si no sale adelante, corta el despliegue. */
async function withRetries(label, args) {
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { ok, output } = run(args);
    if (ok) return output;
    last = output;
    const { kind, hint } = classify(output);
    if (kind === 'fatal') {
      fail(`ERROR QUE NO SE PUEDE REINTENTAR (${label})`);
      fail(hint);
      fail(output.trimEnd());
      process.exit(1);
    }
    if (attempt === ATTEMPTS) break;
    const wait = Math.min(30_000, 5_000 * attempt);
    log(kind === 'transient' ? `la base aún no responde; se reintenta en ${wait / 1000}s (suele ser Neon despertando)` : `${label} falló; se reintenta en ${wait / 1000}s`);
    await sleep(wait);
  }
  fail(`${label}: sin éxito tras ${ATTEMPTS} intentos. Último error:`);
  fail(last.trimEnd());
  process.exit(1);
}

if (!URL) {
  fail('DATABASE_URL no está definida.');
  process.exit(1);
}

// 1) Qué le falta a la base real para coincidir con el esquema del proyecto
log('comparando la base con el esquema del proyecto…');
const sql = await withRetries('comparar esquema', ['migrate', 'diff', '--from-url', URL, '--to-schema-datamodel', SCHEMA, '--script']);

if (isEmptySql(sql)) {
  log('la base ya está al día: no hay nada que aplicar');
  process.exit(0);
}

// 2) Nada que borre datos pasa de aquí
const destructive = sql.split('\n').filter((line) => DESTRUCTIVE.some((re) => re.test(line)));
if (destructive.length) {
  fail('DESPLIEGUE DETENIDO: el esquema nuevo borraría datos.');
  for (const line of destructive) fail(`  ${line.trim()}`);
  fail('Revisa el cambio de esquema; esto NO se aplica automáticamente.');
  process.exit(1);
}

log('cambios pendientes (ninguno destructivo):');
for (const line of sql.split('\n').filter((l) => l.trim().startsWith('--'))) log(`  ${line.replace(/^--\s*/, '').trim()}`);

// 3) Aplicarlos
const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-db-')), 'migracion.sql');
writeFileSync(file, sql, 'utf8');
log('aplicando los cambios…');
await withRetries('aplicar esquema', ['db', 'execute', '--url', URL, '--file', file]);

// 4) Confirmar que ya no queda diferencia
const left = await withRetries('verificar esquema', ['migrate', 'diff', '--from-url', URL, '--to-schema-datamodel', SCHEMA, '--script']);
if (!isEmptySql(left)) {
  fail('Tras aplicar los cambios la base sigue sin coincidir con el esquema:');
  fail(left.trimEnd());
  process.exit(1);
}
log('esquema aplicado: la base está al día');

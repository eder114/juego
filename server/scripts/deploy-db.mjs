/**
 * Prepara la base de datos antes de arrancar en producción (Render + Neon).
 *
 * Las bases gratuitas de Neon se duermen por inactividad y tardan unos segundos en despertar. Si
 * `prisma db push` se lanza justo en ese momento falla, y como es lo primero que corre el servicio, el
 * despliegue entero se cae y Render deja vivo el anterior. Aquí se reintenta con esperas crecientes y,
 * si acaba fallando de verdad, el motivo se imprime en claro en vez de quedar enterrado en el log de npm.
 */
import { spawnSync } from 'node:child_process';

const SCHEMA = process.env.DB_PUSH_SCHEMA ?? 'prisma/postgres/schema.prisma';
const ATTEMPTS = Number(process.env.DB_PUSH_ATTEMPTS ?? 6);
const ATTEMPT_TIMEOUT_MS = Number(process.env.DB_PUSH_TIMEOUT_MS ?? 120_000);
const log = (msg) => console.log(`[deploy-db] ${msg}`);

/** Errores que suelen resolverse solos cuando la base termina de despertar. */
const TRANSIENT = [
  'P1001', // no se puede alcanzar el servidor
  'P1002', // el servidor ha rechazado la conexión por tiempo de espera
  'P1008', // operaciones agotadas por tiempo
  'P1017', // el servidor ha cerrado la conexión
  'Can\'t reach database server',
  'Timed out',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'Connection terminated',
];

/** Fallos que no se arreglan reintentando: hace falta una acción humana. */
const FATAL = [
  { match: ['P1000', 'Authentication failed'], hint: 'La contraseña de DATABASE_URL no es válida. Copia de nuevo la cadena de conexión de Neon en Render → Environment.' },
  { match: ['P1003', 'does not exist at'], hint: 'La base indicada en DATABASE_URL no existe. Revisa el nombre de la base en la cadena de conexión.' },
  { match: ['cannot be executed', 'accept-data-loss'], hint: 'El esquema nuevo exige una operación que borraría datos. Revisa el cambio de esquema antes de desplegar; NO se aplica automáticamente.' },
];

function runPush() {
  const result = spawnSync('npx', ['prisma', 'db', 'push', '--schema', SCHEMA, '--skip-generate'], {
    encoding: 'utf8',
    timeout: ATTEMPT_TIMEOUT_MS,
    shell: process.platform === 'win32',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output.trim()) console.log(output.trimEnd());
  if (result.error?.code === 'ETIMEDOUT') return { ok: false, output: `${output}\nTimed out tras ${ATTEMPT_TIMEOUT_MS / 1000}s` };
  return { ok: result.status === 0, output };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = '';
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  log(`aplicando el esquema (intento ${attempt} de ${ATTEMPTS})…`);
  const { ok, output } = runPush();
  if (ok) {
    log('esquema aplicado: la base está al día');
    process.exit(0);
  }
  last = output;

  const fatal = FATAL.find((f) => f.match.some((m) => output.includes(m)));
  if (fatal) {
    console.error(`\n[deploy-db] ERROR QUE NO SE PUEDE REINTENTAR\n[deploy-db] ${fatal.hint}\n`);
    process.exit(1);
  }

  const transient = TRANSIENT.some((t) => output.includes(t));
  if (attempt === ATTEMPTS) break;
  const wait = transient ? Math.min(30_000, 5_000 * attempt) : 5_000;
  log(transient ? `la base aún no responde; se reintenta en ${wait / 1000}s (suele ser Neon despertando)` : `fallo al aplicar el esquema; se reintenta en ${wait / 1000}s`);
  await sleep(wait);
}

console.error(`\n[deploy-db] No se pudo preparar la base tras ${ATTEMPTS} intentos. Último error:\n${last.trimEnd()}\n`);
process.exit(1);

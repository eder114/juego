/**
 * Descarga los datos reales de la temporada desde la API pública de Fantasy Premier League
 * y los guarda en formato normalizado (JSON) en DATA_DIR.
 *
 *   npm run data:fetch                 → datos completos con historial por jugador
 *   npm run data:fetch -- --no-history → solo clubes, jugadores, jornadas y calendario
 *   npm run data:fetch -- --out data/season-2027-28
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchFplDataset } from '../src/providers/fpl.provider';
import { DATASET_FILES, datasetClubSchema } from '../src/providers/dataset';

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const outDir = path.resolve(outArg >= 0 ? args[outArg + 1] : process.env.DATA_DIR ?? 'data/season-2026-27');
const history = !args.includes('--no-history');

const clubsFile = path.join(outDir, DATASET_FILES.clubs);
const clubsMeta = datasetClubSchema.array().parse(JSON.parse(await readFile(clubsFile, 'utf8')));

const started = Date.now();
const dataset = await fetchFplDataset({ history, clubsMeta, onProgress: (m) => console.log(`  ${m}`) });

await mkdir(outDir, { recursive: true });
const write = (file: string, data: unknown) => writeFile(path.join(outDir, file), JSON.stringify(data, null, 1) + '\n');
await write(DATASET_FILES.meta, dataset.meta);
await write(DATASET_FILES.clubs, dataset.clubs);
await write(DATASET_FILES.players, dataset.players);
await write(DATASET_FILES.gameweeks, dataset.gameweeks);
await write(DATASET_FILES.fixtures, dataset.fixtures);
if (history) {
  await write(DATASET_FILES.stats, dataset.stats);
  await write(DATASET_FILES.prices, dataset.prices);
}

console.log(
  `✔ Temporada ${dataset.meta.season}: ${dataset.clubs.length} clubes, ${dataset.players.length} jugadores, ` +
    `${dataset.fixtures.length} partidos, ${dataset.stats.length} registros de estadísticas ` +
    `(${((Date.now() - started) / 1000).toFixed(1)}s) → ${outDir}`,
);

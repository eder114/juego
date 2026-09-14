import { z } from 'zod';
import { FIXTURE_STATUSES, PLAYER_STATUSES, POSITIONS } from '../domain/constants';

/**
 * Formato normalizado de datos de temporada. Es independiente de la fuente:
 * la API de FPL, archivos JSON/CSV o el panel de administración producen esta misma forma.
 * Los clubes se referencian por `shortName` (ARS, LIV...) para que los archivos sean legibles.
 */

const moneyTenths = z.coerce.number().int().min(1).max(1000);

export const datasetClubSchema = z.object({
  externalId: z.coerce.number().int().nullish(),
  code: z.coerce.number().int().nullish(),
  name: z.string().min(2),
  shortName: z.string().min(2).max(4).transform((s) => s.toUpperCase()),
  commonName: z.string().nullish(),
  city: z.string().min(1),
  stadium: z.string().min(1),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  crestUrl: z.string().url().nullish(),
});

export const datasetPlayerSchema = z.object({
  externalId: z.coerce.number().int().nullish(),
  code: z.coerce.number().int().nullish(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  position: z.enum(POSITIONS),
  club: z.string().min(2).transform((s) => s.toUpperCase()),
  birthDate: z.string().nullish(),
  nationality: z.string().nullish(),
  photoUrl: z.string().url().nullish(),
  squadNumber: z.coerce.number().int().nullish(),
  price: moneyTenths,
  status: z.enum(PLAYER_STATUSES).default('AVAILABLE'),
  chanceOfPlaying: z.coerce.number().int().min(0).max(100).nullish(),
  news: z.string().nullish(),
  isActive: z.boolean().default(true),
});

export const datasetGameweekSchema = z.object({
  number: z.number().int().min(1).max(60),
  name: z.string(),
  deadline: z.string(),
});

export const datasetFixtureSchema = z.object({
  externalId: z.number().int().nullish(),
  gameweek: z.number().int(),
  home: z.string(),
  away: z.string(),
  kickoff: z.string().nullish(),
  status: z.enum(FIXTURE_STATUSES),
  homeScore: z.number().int().nullish(),
  awayScore: z.number().int().nullish(),
  minute: z.number().int().default(0),
  homeDifficulty: z.number().int().nullish(),
  awayDifficulty: z.number().int().nullish(),
});

export const datasetStatSchema = z.object({
  player: z.number().int(), // externalId del jugador
  fixture: z.number().int(), // externalId del partido
  minutes: z.number().int().min(0),
  goals: z.number().int().min(0).default(0),
  assists: z.number().int().min(0).default(0),
  cleanSheet: z.boolean().default(false),
  goalsConceded: z.number().int().min(0).default(0),
  ownGoals: z.number().int().min(0).default(0),
  penaltiesSaved: z.number().int().min(0).default(0),
  penaltiesMissed: z.number().int().min(0).default(0),
  yellowCards: z.number().int().min(0).default(0),
  redCards: z.number().int().min(0).default(0),
  saves: z.number().int().min(0).default(0),
  bonus: z.number().int().min(0).default(0),
});

export const datasetPriceSchema = z.object({
  player: z.number().int(),
  gameweek: z.number().int(),
  price: z.number().int(),
});

export type DatasetClub = z.infer<typeof datasetClubSchema>;
export type DatasetPlayer = z.infer<typeof datasetPlayerSchema>;
export type DatasetGameweek = z.infer<typeof datasetGameweekSchema>;
export type DatasetFixture = z.infer<typeof datasetFixtureSchema>;
export type DatasetStat = z.infer<typeof datasetStatSchema>;
export type DatasetPrice = z.infer<typeof datasetPriceSchema>;

export interface SeasonDataset {
  meta: { season: string; source: string; fetchedAt: string };
  clubs: DatasetClub[];
  players: DatasetPlayer[];
  gameweeks: DatasetGameweek[];
  fixtures: DatasetFixture[];
  stats: DatasetStat[];
  prices: DatasetPrice[];
}

export const DATASET_FILES = {
  meta: 'meta.json',
  clubs: 'clubs.json',
  players: 'players.json',
  gameweeks: 'gameweeks.json',
  fixtures: 'fixtures.json',
  stats: 'player-stats.json',
  prices: 'price-history.json',
} as const;

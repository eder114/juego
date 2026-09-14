import type {
  DatasetClub,
  DatasetFixture,
  DatasetGameweek,
  DatasetPlayer,
  DatasetPrice,
  DatasetStat,
  SeasonDataset,
} from './dataset';
import type { PlayerStatus, Position } from '../domain/constants';

/**
 * Proveedor de datos reales: API pública de Fantasy Premier League.
 * Transforma las respuestas al formato normalizado `SeasonDataset`.
 */
const BASE = 'https://fantasy.premierleague.com/api';

export const crestUrl = (code: number) => `https://resources.premierleague.com/premierleague/badges/70/t${code}.png`;
export const photoUrl = (code: number) =>
  `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`;

const POSITION_MAP: Record<number, Position> = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const STATUS_MAP: Record<string, PlayerStatus> = {
  a: 'AVAILABLE',
  d: 'DOUBTFUL',
  i: 'INJURED',
  s: 'SUSPENDED',
  u: 'UNAVAILABLE',
  n: 'UNAVAILABLE',
};

async function getJson<T>(path: string, attempt = 1): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'PremierFantasy/1.0 (+data sync)', Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return getJson<T>(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`FPL API ${path} respondió ${res.status}`);
  return (await res.json()) as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface FetchOptions {
  /** Descarga el historial por jugador (precio por jornada y estadísticas exactas por partido). ~700 peticiones. */
  history: boolean;
  /** Si history=false: jornadas cuyas estadísticas se obtienen del endpoint "live". */
  liveGameweeks?: number[];
  clubsMeta: DatasetClub[];
  onProgress?: (msg: string) => void;
}

export async function fetchFplDataset(opts: FetchOptions): Promise<SeasonDataset> {
  const log = opts.onProgress ?? (() => {});
  log('Descargando bootstrap-static…');
  const [bootstrap, fixturesRaw, regions] = await Promise.all([
    getJson<Json>('/bootstrap-static/'),
    getJson<Json[]>('/fixtures/'),
    getJson<Json[]>('/regions/').catch(() => [] as Json[]),
  ]);

  const regionName = new Map<number, string>(regions.map((r: Json) => [r.id, r.name]));
  const teamShort = new Map<number, string>(bootstrap.teams.map((t: Json) => [t.id, t.short_name]));

  // Clubes: metadatos locales (ciudad, estadio, colores) + identificadores de la API
  const clubs: DatasetClub[] = bootstrap.teams.map((t: Json) => {
    const meta = opts.clubsMeta.find((c) => c.shortName === t.short_name);
    if (!meta) throw new Error(`Falta metadata para el club ${t.name} (${t.short_name}) en clubs.json`);
    return { ...meta, externalId: t.id, code: t.code, crestUrl: crestUrl(t.code) };
  });

  const players: DatasetPlayer[] = bootstrap.elements.map((e: Json) => ({
    externalId: e.id,
    code: e.code,
    firstName: e.first_name,
    lastName: e.second_name,
    displayName: e.known_name || e.web_name,
    position: POSITION_MAP[e.element_type],
    club: teamShort.get(e.team)!,
    birthDate: e.birth_date ?? null,
    nationality: regionName.get(e.region) ?? null,
    photoUrl: photoUrl(e.code),
    squadNumber: e.squad_number ?? null,
    price: e.now_cost,
    status: STATUS_MAP[e.status] ?? 'AVAILABLE',
    chanceOfPlaying: e.chance_of_playing_next_round ?? null,
    news: e.news || null,
    isActive: !e.removed && !(e.status === 'u' && e.can_select === false),
  }));

  const gameweeks: DatasetGameweek[] = bootstrap.events.map((ev: Json) => ({
    number: ev.id,
    name: `Jornada ${ev.id}`,
    deadline: ev.deadline_time,
  }));

  const fixtures: DatasetFixture[] = fixturesRaw
    .filter((f) => f.event != null)
    .map((f) => ({
      externalId: f.id,
      gameweek: f.event,
      home: teamShort.get(f.team_h)!,
      away: teamShort.get(f.team_a)!,
      kickoff: f.kickoff_time,
      status: f.finished || f.finished_provisional ? 'FINISHED' : f.started ? 'LIVE' : 'SCHEDULED',
      homeScore: f.team_h_score,
      awayScore: f.team_a_score,
      minute: f.minutes ?? 0,
      homeDifficulty: f.team_h_difficulty,
      awayDifficulty: f.team_a_difficulty,
    }));

  const stats: DatasetStat[] = [];
  const prices: DatasetPrice[] = [];

  if (opts.history) {
    const elements: Json[] = bootstrap.elements;
    let done = 0;
    const queue = [...elements];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift()!;
        const summary = await getJson<Json>(`/element-summary/${e.id}/`);
        let lastPrice: number | null = null;
        for (const h of summary.history as Json[]) {
          if (h.value !== lastPrice) {
            prices.push({ player: e.id, gameweek: h.round, price: h.value });
            lastPrice = h.value;
          }
          if (h.minutes > 0) stats.push(historyToStat(e.id, h));
        }
        if (lastPrice !== null && lastPrice !== e.now_cost) {
          const currentEvent = bootstrap.events.find((ev: Json) => ev.is_current)?.id ?? 1;
          prices.push({ player: e.id, gameweek: currentEvent, price: e.now_cost });
        }
        done += 1;
        if (done % 50 === 0) log(`Historial de jugadores: ${done}/${elements.length}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  } else if (opts.liveGameweeks?.length) {
    for (const gw of opts.liveGameweeks) {
      log(`Estadísticas en vivo de la jornada ${gw}…`);
      const live = await getJson<Json>(`/event/${gw}/live/`);
      stats.push(...liveToStats(live, fixturesRaw.filter((f) => f.event === gw), bootstrap.elements));
    }
  }

  const season = seasonFromDeadline(gameweeks[0]?.deadline);
  return {
    meta: { season, source: 'Fantasy Premier League API', fetchedAt: new Date().toISOString() },
    clubs,
    players,
    gameweeks,
    fixtures,
    stats,
    prices,
  };
}

function historyToStat(elementId: number, h: Json): DatasetStat {
  return {
    player: elementId,
    fixture: h.fixture,
    minutes: h.minutes,
    goals: h.goals_scored,
    assists: h.assists,
    cleanSheet: h.clean_sheets > 0,
    goalsConceded: h.goals_conceded,
    ownGoals: h.own_goals,
    penaltiesSaved: h.penalties_saved,
    penaltiesMissed: h.penalties_missed,
    yellowCards: h.yellow_cards,
    redCards: h.red_cards,
    saves: h.saves,
    bonus: h.bonus,
  };
}

/**
 * El endpoint live agrega por jornada. Para jornadas simples se asigna al único partido del club.
 * En dobles jornadas se reparte usando el desglose `explain` (las estadísticas sin puntos van al primer partido jugado).
 */
function liveToStats(live: Json, gwFixtures: Json[], elements: Json[]): DatasetStat[] {
  const teamOf = new Map<number, number>(elements.map((e: Json) => [e.id, e.team]));
  const out: DatasetStat[] = [];
  for (const el of live.elements as Json[]) {
    const s = el.stats;
    if (!s || s.minutes <= 0) continue;
    const team = teamOf.get(el.id);
    const clubFixtures = gwFixtures.filter((f) => (f.team_h === team || f.team_a === team) && f.started);
    if (clubFixtures.length === 0) continue;
    if (clubFixtures.length === 1) {
      out.push(historyToStat(el.id, { ...s, fixture: clubFixtures[0].id }));
      continue;
    }
    let first = true;
    for (const exp of el.explain as Json[]) {
      const v = (id: string) => exp.stats.find((x: Json) => x.identifier === id)?.value ?? 0;
      const minutes = v('minutes');
      if (minutes <= 0) continue;
      out.push({
        player: el.id,
        fixture: exp.fixture,
        minutes,
        goals: v('goals_scored'),
        assists: v('assists'),
        cleanSheet: v('clean_sheets') > 0,
        goalsConceded: first ? s.goals_conceded : v('goals_conceded'),
        ownGoals: v('own_goals'),
        penaltiesSaved: v('penalties_saved'),
        penaltiesMissed: v('penalties_missed'),
        yellowCards: v('yellow_cards'),
        redCards: v('red_cards'),
        saves: first ? s.saves : v('saves'),
        bonus: v('bonus'),
      });
      first = false;
    }
  }
  return out;
}

function seasonFromDeadline(deadline?: string): string {
  const d = deadline ? new Date(deadline) : new Date();
  const start = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type PlayerStatus = 'AVAILABLE' | 'DOUBTFUL' | 'INJURED' | 'SUSPENDED' | 'UNAVAILABLE';
export type Movement = 'up' | 'down' | 'same' | 'new';

export interface ClubLite {
  id: number;
  name: string;
  shortName: string;
  commonName: string | null;
  crestUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  stadium?: string;
}

export interface Club extends ClubLite {
  city: string;
  stadium: string;
  code: number | null;
  externalId: number | null;
  isActive: boolean;
}

export interface PlayerStats {
  totalPoints: number;
  lastPoints: number;
  form: number;
  goals: number;
  assists: number;
  minutes: number;
  appearances: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number;
  saves: number;
  bonus: number;
  weeklyChange: number;
  seasonChange: number;
  selectedBy: number;
  ownersCount: number;
  transfersIn: number;
  transfersOut: number;
}

export interface Player {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  position: Position;
  club: ClubLite;
  age: number | null;
  birthDate: string | null;
  nationality: string | null;
  photoUrl: string | null;
  squadNumber: number | null;
  price: number;
  status: PlayerStatus;
  chanceOfPlaying: number | null;
  news: string | null;
  isActive: boolean;
  /** Economía de liga: valor en miles de £ */
  marketValue: number | null;
  rarity: Rarity;
  stats: PlayerStats;
  inSquad?: boolean;
  isFavorite?: boolean;
}

export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'STAR';

export interface Crest {
  shape?: 'shield' | 'round' | 'classic' | 'diamond';
  pattern?: 'plain' | 'stripes' | 'hoops' | 'sash' | 'half' | 'chevron';
  primary?: string;
  secondary?: string;
  initials?: string;
}

export interface Me {
  id: string;
  email: string;
  managerName: string;
  role: 'USER' | 'ADMIN';
  avatarUrl: string | null;
  createdAt: string;
  favoriteClub: ClubLite | null;
  team: {
    id: number;
    name: string;
    crest: Crest;
    budget: number;
    totalPoints: number;
    createdAt: string;
    /** 1 = sistema clásico (décimas de millón) · 2 = economía de liga (miles de £) */
    economyVersion: 1 | 2;
    wallet: number;
    economyLeague: { id: number; name: string } | null;
  } | null;
}

export interface Coach {
  id: number;
  displayName: string;
  firstName: string;
  lastName: string;
  nationality: string | null;
  photoUrl: string | null;
  marketValue: number;
  rarity: Rarity;
  isActive: boolean;
  club: ClubLite | null;
}

export interface ValueTrend {
  change: number;
  variationBp: number;
  gameweekId?: number | null;
}

export interface MarketListing {
  id: number;
  assetType: 'PLAYER' | 'COACH';
  rarity: Rarity;
  listingPrice: number;
  slot: number;
  status: 'AVAILABLE' | 'SOLD' | 'UNAVAILABLE';
  soldAt: string | null;
  buyer: { teamName: string; managerName: string } | null;
  boughtByMe: boolean;
  canBuy: boolean;
  blockReason: string | null;
  player: Player | null;
  coach: Coach | null;
  trend: ValueTrend | null;
}

export type LeagueMarket =
  | { mode: 'CLASSIC' }
  | { mode: 'NO_LEAGUE'; wallet: number; eligibleLeagues: { id: number; name: string }[] }
  | {
      mode: 'LEAGUE';
      serverTime: string;
      league: { id: number; name: string; timezone: string; resetTime: string; participants: number; pityCounter: number };
      cycle: { id: number; cycleDate: string; startsAt: string; endsAt: string };
      wallet: number;
      marketOpen: boolean;
      squadCount: number;
      coachCount: number;
      limits: { maxSquad: number; perPosition: Record<Position, number>; maxPerClub: number; maxCoaches: number };
      players: MarketListing[];
      coaches: MarketListing[];
      pollSeconds: number;
    };

export interface EconomyTransaction {
  id: number;
  type: string;
  amount: number;
  balanceBefore: number | null;
  balanceAfter: number;
  currency: 'TENTHS' | 'K';
  description: string;
  reference: string | null;
  createdAt: string;
}

export interface PowerUpCard {
  id: number;
  code: string;
  name: string;
  description: string;
  effect: 'DOUBLE_POINTS' | 'WEAKEN';
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  effectValue: number;
  target: 'OWN_PLAYER' | 'RIVAL_PLAYER';
  isActive: boolean;
  obtainable: boolean;
  maxPerGameweek: number;
}

export type LetterState = 'correct' | 'present' | 'absent';

export interface WordleState {
  type: 'WORDLE';
  enabled: boolean;
  date: string;
  serverTime: string;
  nextResetAt: string;
  timezone: string;
  wordLength: number;
  maxAttempts: number;
  rewards: number[];
  rewardCurrency: 'K' | 'TENTHS';
  hasTeam: boolean;
  streak: { current: number; best: number; requiresWin: boolean };
  milestones: { days: number; money: number; card: string | null }[];
  attemptsUsed: number;
  guesses: { word: string; result: LetterState[] }[];
  completed: boolean;
  won: boolean;
  answer: string | null;
  reward: { amount: number; currency: 'K' | 'TENTHS'; streakBonus: number; streakDays: number; cardCode: string | null } | null;
}

export interface Fixture {
  id: number;
  gameweekId: number;
  homeClubId: number;
  awayClubId: number;
  kickoff: string | null;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED';
  homeScore: number | null;
  awayScore: number | null;
  minute: number;
  homeDifficulty: number | null;
  awayDifficulty: number | null;
  homeClub: ClubLite;
  awayClub: ClubLite;
}

export interface Gameweek {
  id: number;
  name: string;
  season: string;
  deadline: string;
  startsAt: string | null;
  endsAt: string | null;
  status: 'UPCOMING' | 'LIVE' | 'FINISHED';
  isProcessed: boolean;
  pricesUpdated: boolean;
  fixtures?: number;
}

export interface StandingRow {
  rank: number;
  previousRank: number | null;
  movement: Movement;
  teamId: number;
  teamName: string;
  crest: Crest;
  userId: string;
  managerName: string;
  avatarUrl: string | null;
  points: number;
  lastPoints: number;
  gameweeksPlayed: number;
  role?: string;
  isMe?: boolean;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface News {
  id: number;
  title: string;
  summary: string;
  content: string;
  category: string;
  imageUrl: string | null;
  createdAt: string;
  club: ClubLite | null;
  player?: { id: number; displayName: string; photoUrl: string | null } | null;
}

export interface SquadPlayer extends Player {
  purchasePrice: number;
  acquiredAt: string;
  priceDelta: number;
  salePrice: number;
}

export interface Squad {
  team: { id: number; name: string; crest: Crest; totalPoints: number };
  budget: number;
  teamValue: number;
  totalValue: number;
  players: SquadPlayer[];
  counts: Record<Position, number>;
  requirements: Record<Position, number>;
  squadSize: number;
  isComplete: boolean;
  maxPerClub: number;
  clubCounts: Record<string, number>;
  marketOpen: boolean;
  sellAtPurchasePrice: boolean;
  /** Solo en la economía de liga (importes en miles de £) */
  economy: SquadEconomy | null;
}

export interface SquadEconomy {
  wallet: number;
  league: { id: number; name: string } | null;
  squadValue: number;
  sellPercent: number;
  limits: { maxSquad: number; perPosition: Record<Position, number> };
  players: { playerId: number; marketValue: number; purchasePrice: number | null; source: 'STARTER' | 'MARKET' | null; saleValue: number; trend: ValueTrend | null }[];
  coach: (Coach & { purchasePrice: number; saleValue: number }) | null;
}

export interface LineupFixture {
  id: number;
  home: boolean;
  opponent: ClubLite;
  kickoff: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  difficulty: number | null;
}

export interface LineupEntry {
  player: Player;
  role: 'STARTER' | 'BENCH' | 'OUT';
  order: number;
  inSquad: boolean;
  locked: boolean;
  fixtures: LineupFixture[];
  minutes: number;
  points: number;
  multiplier: number;
  autoSubIn: boolean;
  autoSubOut: boolean;
  /** Cartas que afectan al jugador en la jornada y su efecto en puntos */
  cards: ('DOUBLE_POINTS' | 'WEAKEN')[];
  cardDelta: number;
}

export interface LineupView {
  teamId: number;
  isOwner: boolean;
  gameweek: { id: number; name: string; deadline: string; status: string; isProcessed: boolean };
  lockMode: string;
  editable: boolean;
  isSaved: boolean;
  isFinal: boolean;
  formation: string;
  captainId: number | null;
  viceCaptainId: number | null;
  activeCaptainId: number | null;
  points: number;
  benchPoints: number;
  cardPoints: number;
  coach: { id: number; displayName: string; photoUrl: string | null; club: { shortName: string; name: string; crestUrl: string | null } | null; points: number } | null;
  players: LineupEntry[];
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  gameweeks: { id: number; name: string; status: string; points: number | null }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

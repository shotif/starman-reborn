import type { FactionId, SystemId, Vec3Tuple } from '../data/types.ts';

/** Current save format version. Older saves are upgraded by src/app/save/migrate.ts. */
export const SAVE_VERSION = 2;

export type CommodityId = 'medical' | 'fabricators' | 'deuterium';
export type ShieldId = 'shield-mk1' | 'shield-mk2';
export type GunId = 'pulse-mk1' | 'pulse-mk2';

export type Cargo = Partial<Record<CommodityId, number>>;

export interface ShipState {
  hull: number;
  shield: number;
  shieldGenerator: ShieldId;
  gun: GunId;
  missiles: number;
  repairKits: number;
  /** Items held per commodity (each item occupies the commodity's unit size in the hold). */
  cargo: Cargo;
}

/** Where the player is when the game is saved. */
export interface PlayerLocation {
  systemId: SystemId;
  /** Location id when docked, otherwise null. */
  dockedAt: string | null;
  /** Ship pose when saved in flight (local scene units). */
  flight: { position: Vec3Tuple; quaternion: [number, number, number, number] } | null;
  /** Respawn dock after a lost fight. */
  lastDockId: string;
}

export interface PriceQuote {
  /** Price the player pays per item, or null when the station does not sell it. */
  buy: number | null;
  /** Price the player receives per item, or null when the station does not buy it. */
  sell: number | null;
}

/** Market data the player has actually seen (visited) or been told (contract briefing). */
export interface MarketObservation {
  source: 'visited' | 'briefing';
  /** Game-clock seconds when observed. */
  observedAt: number;
  prices: Partial<Record<CommodityId, PriceQuote>>;
}

export type JobStatus = 'active' | 'complete';

export interface JobProgress {
  status: JobStatus;
  /** Index of the first incomplete objective. */
  objectiveIndex: number;
  acceptedAt: number;
  completedAt?: number;
}

export type PirateOutcome = 'none' | 'destroyed' | 'bypassed' | 'escaped';

export interface LedgerEntry {
  /** Game-clock seconds. */
  t: number;
  kind: 'buy' | 'sell' | 'bounty' | 'reward' | 'repair' | 'fee' | 'equipment' | 'loot' | 'rescue';
  amount: number;
  note: string;
}

export interface GameState {
  version: typeof SAVE_VERSION;
  createdAt: string;
  savedAt: string;
  /** Seed for reproducible spawn positions and procedural details. */
  seed: number;
  /** Game-clock seconds of play. */
  clock: number;
  location: PlayerLocation;
  credits: number;
  ship: ShipState;
  visitedSystems: SystemId[];
  visitedLocations: string[];
  knownMarkets: Record<string, MarketObservation>;
  /** Confirmed-planet / body ids the player has scanned. */
  discoveredBodies: string[];
  jobs: Record<string, JobProgress>;
  /** Outcome of the Mars raider encounter for the first delivery. */
  pirateOutcome: PirateOutcome;
  reputation: Record<FactionId, number>;
  /** One-off flags: tutorial steps seen, clearance, story beats. */
  flags: Record<string, boolean>;
  ledger: LedgerEntry[];
  /** Game clock when the current voyage began (first launch with the delivery job); ledger entries after it form the voyage report. */
  voyageStartClock: number;
  stats: {
    kills: number;
    jumps: number;
    deliveries: number;
    deaths: number;
  };
}

export const STARTING_CREDITS = 800;
export const START_DOCK_ID = 'earth-port';
export const LEDGER_LIMIT = 80;

export function createNewGame(seed: number = Math.floor(Math.random() * 2 ** 31), now = new Date()): GameState {
  const iso = now.toISOString();
  return {
    version: SAVE_VERSION,
    createdAt: iso,
    savedAt: iso,
    seed,
    clock: 0,
    location: { systemId: 'sol', dockedAt: START_DOCK_ID, flight: null, lastDockId: START_DOCK_ID },
    credits: STARTING_CREDITS,
    ship: {
      hull: 100,
      shield: 60,
      shieldGenerator: 'shield-mk1',
      gun: 'pulse-mk1',
      missiles: 4,
      repairKits: 1,
      cargo: {},
    },
    visitedSystems: ['sol'],
    visitedLocations: [START_DOCK_ID],
    knownMarkets: {},
    discoveredBodies: [],
    jobs: {},
    pirateOutcome: 'none',
    reputation: { sta: 0, frontier: 0, 'hollow-wake': -50 },
    flags: {},
    ledger: [],
    voyageStartClock: 0,
    stats: { kills: 0, jumps: 0, deliveries: 0, deaths: 0 },
  };
}

export function addLedger(state: GameState, entry: Omit<LedgerEntry, 't'>): void {
  state.ledger.push({ t: state.clock, ...entry });
  if (state.ledger.length > LEDGER_LIMIT) state.ledger.splice(0, state.ledger.length - LEDGER_LIMIT);
}

/** Adjust credits and record why. Amount is signed. */
export function applyCredits(state: GameState, amount: number, kind: LedgerEntry['kind'], note: string): void {
  state.credits = Math.max(0, Math.round(state.credits + amount));
  addLedger(state, { kind, amount: Math.round(amount), note });
}

/** Totals of ledger entries since `sinceClock`, grouped for voyage reports. */
export function voyageTotals(state: GameState, sinceClock: number): {
  trade: number;
  bountiesAndSalvage: number;
  rewards: number;
  repairsAndRescue: number;
  fees: number;
  equipment: number;
  net: number;
} {
  const t = { trade: 0, bountiesAndSalvage: 0, rewards: 0, repairsAndRescue: 0, fees: 0, equipment: 0, net: 0 };
  for (const e of state.ledger) {
    if (e.t < sinceClock) continue;
    if (e.kind === 'buy' || e.kind === 'sell') t.trade += e.amount;
    else if (e.kind === 'bounty' || e.kind === 'loot') t.bountiesAndSalvage += e.amount;
    else if (e.kind === 'reward') t.rewards += e.amount;
    else if (e.kind === 'repair' || e.kind === 'rescue') t.repairsAndRescue += e.amount;
    else if (e.kind === 'fee') t.fees += e.amount;
    else if (e.kind === 'equipment') t.equipment += e.amount;
    t.net += e.amount;
  }
  return t;
}

export function markVisited(state: GameState, systemId: SystemId, locationId?: string): void {
  if (!state.visitedSystems.includes(systemId)) state.visitedSystems.push(systemId);
  if (locationId && !state.visitedLocations.includes(locationId)) state.visitedLocations.push(locationId);
}

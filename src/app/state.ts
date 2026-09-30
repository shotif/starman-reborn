import type { CommodityId } from '../content/economy/goods.ts';
import { STARTER_SHIP_ID } from '../content/rules/index.ts';
import type { JobDef } from '../economy/jobs.ts';
import type { FactionId, SystemId, Vec3Tuple } from '../data/types.ts';
import { newShipState } from '../economy/loadout.ts';

/** Current save format version. Older saves are upgraded by src/app/save/migrate.ts. */
export const SAVE_VERSION = 6;

export type { CommodityId };

export type Cargo = Partial<Record<CommodityId, number>>;

export interface ShipState {
  /** Catalogue ship model id (src/content), e.g. `ship.courier.1.halden`. */
  model: string;
  /** Slot id → fitted equipment id; empty slots are absent. */
  fittings: Record<string, string>;
  hull: number;
  shield: number;
  /** Launcher slot id → rounds carried. */
  ammo: Record<string, number>;
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

/** Stock the player has moved at one station: levels at game clock `t`, recovering toward normal after it. */
export interface MarketStock {
  t: number;
  stock: Partial<Record<CommodityId, number>>;
}

/** Station id → stock the player has moved there (untouched markets are absent). */
export type MarketState = Record<string, MarketStock>;

/** Market data the player has actually seen (visited) or been told (contract briefing). */
export interface MarketObservation {
  source: 'visited' | 'briefing';
  /** Game-clock seconds when observed. */
  observedAt: number;
  prices: Partial<Record<CommodityId, PriceQuote>>;
}

/**
 * `abandoned`: a generated contract the player gave up (its deposit is forfeit); `failed`: one that
 * went wrong (an escorted ship lost or left behind).
 */
export type JobStatus = 'active' | 'complete' | 'abandoned' | 'failed';

export interface JobProgress {
  status: JobStatus;
  /** Index of the first incomplete objective. */
  objectiveIndex: number;
  acceptedAt: number;
  completedAt?: number;
  /** Bounty contracts: raiders of the contract pack destroyed so far. */
  kills?: number;
  /** Escort contracts: the escorted ship docked at its destination. */
  escort?: 'arrived';
  /** Recovery contracts: the item is aboard. */
  recovered?: boolean;
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
  /** Stock the player's trades have moved (economy/markets.ts). */
  markets: MarketState;
  /** Generated contracts the player accepted, as posted (economy/contracts.ts). */
  contracts: Record<string, JobDef>;
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
    ship: starterShip(),
    visitedSystems: ['sol'],
    visitedLocations: [START_DOCK_ID],
    knownMarkets: {},
    markets: {},
    contracts: {},
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

/** The Halden courier Mk I as a new pilot receives it: four seekers and one repair kit. */
export function starterShip(): ShipState {
  const ship = newShipState(STARTER_SHIP_ID);
  for (const slot of Object.keys(ship.ammo)) ship.ammo[slot] = Math.min(ship.ammo[slot] ?? 0, 4);
  ship.repairKits = 1;
  return ship;
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

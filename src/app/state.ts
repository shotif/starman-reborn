import type { CommodityId } from '../content/economy/goods.ts';
import { STARTER_SHIP_ID } from '../content/rules/index.ts';
import type { MilestoneId } from '../content/progress/rules.ts';
import type { JobDef } from '../economy/jobs.ts';
import type { FactionId, SystemId, Vec3Tuple } from '../data/types.ts';
import { newShipState } from '../economy/loadout.ts';

/** Current save format version. Older saves are upgraded by src/app/save/migrate.ts. */
export const SAVE_VERSION = 10;

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
  /** Decoy flares against seekers (docs/PROCGEN.md §15). */
  decoys: number;
  /** Damage to the ship's systems, 0 (intact) to 1 (wrecked); dock repairs and repair kits clear it. */
  systems: ShipSystems;
  /** Items held per commodity (each item occupies the commodity's unit size in the hold). */
  cargo: Cargo;
}

export interface ShipSystems {
  engines: number;
  guns: number;
  shields: number;
}

/** A pilot flying on the player's wing for a fee per jump (docs/PROCGEN.md §15). */
export interface Wingman {
  id: string;
  name: string;
  /** Catalogue ship model. */
  model: string;
  /** Credits per jump. */
  fee: number;
  skill: 'steady' | 'sharp';
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

/**
 * Market data the player has actually seen (visited), been told (contract briefing, a rumour in a
 * bar) or had relayed by the price watch.
 */
export interface MarketObservation {
  source: 'visited' | 'briefing' | 'rumour' | 'watch';
  /** Game-clock seconds when observed. */
  observedAt: number;
  prices: Partial<Record<CommodityId, PriceQuote>>;
  /** Goods heard of later than `observedAt` (a rumour or the price watch): when, and how. */
  goodsAt?: Partial<Record<CommodityId, { t: number; via: 'rumour' | 'watch' }>>;
}

/** A crime seen at `systemId` whose news is still travelling (docs/PROCGEN.md §17). */
export interface CrimeRecord {
  faction: FactionId;
  amount: number;
  systemId: SystemId;
  /** Game-clock seconds. */
  at: number;
}

/** Something the player left adrift in a system: a pod of cargo, salvage or equipment. */
export interface LingeringPod {
  position: [number, number, number];
  value: number;
  cargo?: { commodity: CommodityId; qty: number };
  gear?: string;
}

/** What is still in a system when the player comes back (docs/PROCGEN.md §17). */
export interface Lingering {
  /** Game-clock seconds when the player left. */
  at: number;
  /** Raider packs that saw the player: their threat level, ships left and where they were. */
  packs: { level: 1 | 2 | 3; count: number; position: [number, number, number] }[];
  pods: LingeringPod[];
}

/**
 * A captain flying a parked ship on one of the player's routes (docs/PROCGEN.md §18). A run loads
 * at `route.from`, carries the cargo in the ship's hold to `route.to`, sells it there and flies home
 * empty; everything is worked out from the game clock (economy/fleet.ts settleFleet).
 */
export interface Hauler {
  captain: string;
  route: { from: string; to: string; commodity: CommodityId };
  insured: boolean;
  /** Game clock when the captain was hired (with the ship's id and the run, it keys each run's luck). */
  hired: number;
  /** `home`: at `route.from`, loading next; `out`: carrying the cargo to `route.to`; `back`: flying home empty. */
  leg: 'home' | 'out' | 'back';
  /** Game clock when the current run began (at home: when the captain next looks at the route). */
  since: number;
  /** What the run under way cost when it set out: the goods, both ways' jump fees and the captain's fee. */
  cost: number;
  /**
   * Why the captain waits at home (null: not waiting), and how many looks at the route in a row
   * found no run to make. A wait is reported once, when it outlasts the first look.
   */
  waiting: 'unprofitable' | 'credits' | null;
  waits: number;
  /** Called home: the ship parks at `route.from` when this run is done. */
  recalled: boolean;
  /** Runs finished (sold or raided). */
  runs: number;
  /** Net credits the hauler has made the player. */
  earned: number;
  /**
   * The player saw run `run` safely past its raid in `systemId` (docs/PROCGEN.md §18.6): guarded
   * through the ambush, or seen to its dock or the jump beacon. The raid does not strike.
   */
  sight?: { run: number; systemId: SystemId; at: number };
}

/** A ship the player owns besides the one they fly. */
export interface OwnedShip {
  id: string;
  ship: ShipState;
  /** Where it is parked (a hauler's ship: where its runs start). */
  locationId: string;
  hauler?: Hauler;
}

/** A stake in a station's trade. */
export interface Stake {
  locationId: string;
  /** Whole per-cent, 1 to FLEET.stakes.maxPercent. */
  percent: number;
  /** What the player paid for it. */
  paid: number;
  /** Game clock the dividends are settled to (whole hours from the purchase). */
  since: number;
  /** Dividends paid so far. */
  earned: number;
}

/** Something the fleet did while the player was away. */
export interface FleetReport {
  /** Game clock when it happened. */
  at: number;
  kind: 'run' | 'raid' | 'lost' | 'wait' | 'home';
  text: string;
  /** Credits it made (negative: cost) the player. */
  amount: number;
  /** The owned ship it concerns. */
  shipId?: string;
}

/** The player's fleet and holdings (docs/PROCGEN.md §18). */
export interface Fleet {
  ships: OwnedShip[];
  /** Leased storage: station id → what is stored there. */
  storage: Record<string, Cargo>;
  stakes: Stake[];
  /** What happened while the player was away, newest last. */
  reports: FleetReport[];
}

/** The player's mark on the world (docs/PROCGEN.md §17). */
export interface WorldLog {
  /** Units sold into a shortage, by event id. */
  relief: Record<string, number>;
  /** Raiders destroyed during a raid, by event id. */
  raidKills: Record<string, number>;
  /** Events the player ended early: event id → game clock. */
  ended: Record<string, number>;
  /** What is still out there, by system. */
  lingering: Record<SystemId, Lingering>;
  /**
   * The border war (docs/PROCGEN.md §20), by front: the player's deeds there ([game clock,
   * pressure], + for the law, − for the Wake; newest last), and how The Long Border ended there.
   */
  border: Record<string, BorderLog>;
  /** Lasting marks a story's ending left on a station (docs/PROCGEN.md §14.7): mark id → game clock. */
  marks?: Record<string, number>;
  /** What became of the hauls the player saw (docs/PROCGEN.md §21), by haul id; kept three hours. */
  hauls?: Record<string, HaulRecord>;
}

/** A haul the player saw: through a system `safe` (whatever a raid there would have done), or `lost` (destroyed). */
export interface HaulRecord {
  at: number;
  fate: 'safe' | 'lost';
  systemId: SystemId;
  /** Who destroyed it (lost hauls). */
  by?: 'raiders' | 'player';
}

export type BorderEnding = 'law' | 'wake' | 'truce';

export interface BorderLog {
  deeds: [number, number][];
  ending?: BorderEnding;
}

/** A price the player asked to watch (docs/PROCGEN.md §16). */
export interface PriceWatch {
  locationId: string;
  commodity: CommodityId;
}

/** Something heard in a bar (docs/PROCGEN.md §16). */
export interface HeardRumour {
  /** The person and time slot it came from (a person tells one thing a shift). */
  key: string;
  kind: 'price' | 'event' | 'den' | 'ace' | 'wreck' | 'story' | 'front';
  text: string;
  /** Game-clock seconds. */
  at: number;
  /** The bar it was heard in. */
  locationId: string;
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
  /**
   * Escorts across jumps: the system the escorted ships are in, once they have jumped with the
   * player (until then, the system they set off from).
   */
  escortAt?: SystemId;
  /** Recovery contracts: the item is aboard. */
  recovered?: boolean;
  /** Convoys: ships seen in, and ships lost. */
  escorted?: number;
  lost?: number;
  /** Den assaults: the den's reactor is down. */
  assault?: 'done';
  /** Mining claims: units of the good mined in the belt so far (docs/PROCGEN.md §19). */
  mined?: number;
  /** Rescues: the goods were handed over to the stranded ship. */
  rescued?: boolean;
}

export type PirateOutcome = 'none' | 'destroyed' | 'bypassed' | 'escaped';

export interface LedgerEntry {
  /** Game-clock seconds. */
  t: number;
  /** `fleet`: stakes bought and sold, storage leased (docs/PROCGEN.md §18). */
  kind: 'buy' | 'sell' | 'bounty' | 'reward' | 'repair' | 'fee' | 'equipment' | 'loot' | 'rescue' | 'fleet';
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
  /** Prices the player watches, and what was heard in the bars (newest last). */
  priceWatch: PriceWatch[];
  rumours: HeardRumour[];
  /** Stock the player's trades have moved (economy/markets.ts). */
  markets: MarketState;
  /** Generated contracts the player accepted, as posted (economy/contracts.ts). */
  contracts: Record<string, JobDef>;
  /** The law (docs/PROCGEN.md §12): fines owed to each lawful faction. */
  /**
   * Fines on record everywhere, crimes whose news is still travelling from where they were seen,
   * and when each faction last had a crime to its name (fines lapse without new ones).
   */
  law: { fines: Partial<Record<FactionId, number>>; pending: CrimeRecord[]; lastCrimeAt: Partial<Record<FactionId, number>> };
  /** What the player has done to the world (docs/PROCGEN.md §17). */
  world: WorldLog;
  /** Ships, haulers, storage and stakes (docs/PROCGEN.md §18). */
  fleet: Fleet;
  /** The codex of the real sky (docs/PROCGEN.md §13): catalogued stars and confirmed planets scanned. */
  codex: string[];
  /** Systems whose completed survey was sold to a research station. */
  surveysSold: SystemId[];
  /** Milestones earned, with the game clock when they were. */
  milestones: Partial<Record<MilestoneId, number>>;
  /** Story arcs (docs/PROCGEN.md §14): choices made (choice id → option id), and beats already told. */
  story: { choices: Record<string, string>; seen: string[] };
  /** Raider dens knocked out: den id → game clock when its reactor went down. */
  dens: Record<string, number>;
  /** Salvaged equipment aboard, not fitted (catalogue gear ids). */
  stash: string[];
  /** Wingmen on the player's pay. */
  crew: Wingman[];
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
    /** Credits taken for goods sold, and contract pay (with bonuses and survey sales): the trade rating. */
    sales: number;
    rewards: number;
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
    priceWatch: [],
    rumours: [],
    markets: {},
    contracts: {},
    law: { fines: {}, pending: [], lastCrimeAt: {} },
    world: { relief: {}, raidKills: {}, ended: {}, lingering: {}, border: {} },
    fleet: { ships: [], storage: {}, stakes: [], reports: [] },
    codex: [],
    surveysSold: [],
    milestones: {},
    story: { choices: {}, seen: [] },
    dens: {},
    stash: [],
    crew: [],
    discoveredBodies: [],
    jobs: {},
    pirateOutcome: 'none',
    reputation: { sta: 0, frontier: 0, 'hollow-wake': -50 },
    flags: {},
    ledger: [],
    voyageStartClock: 0,
    stats: { kills: 0, jumps: 0, deliveries: 0, deaths: 0, sales: 0, rewards: 0 },
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
  fleet: number;
  net: number;
} {
  const t = { trade: 0, bountiesAndSalvage: 0, rewards: 0, repairsAndRescue: 0, fees: 0, equipment: 0, fleet: 0, net: 0 };
  for (const e of state.ledger) {
    if (e.t < sinceClock) continue;
    if (e.kind === 'buy' || e.kind === 'sell') t.trade += e.amount;
    else if (e.kind === 'bounty' || e.kind === 'loot') t.bountiesAndSalvage += e.amount;
    else if (e.kind === 'reward') t.rewards += e.amount;
    else if (e.kind === 'repair' || e.kind === 'rescue') t.repairsAndRescue += e.amount;
    else if (e.kind === 'fee') t.fees += e.amount;
    else if (e.kind === 'equipment') t.equipment += e.amount;
    else if (e.kind === 'fleet') t.fleet += e.amount;
    t.net += e.amount;
  }
  return t;
}

export function markVisited(state: GameState, systemId: SystemId, locationId?: string): void {
  if (!state.visitedSystems.includes(systemId)) state.visitedSystems.push(systemId);
  if (locationId && !state.visitedLocations.includes(locationId)) state.visitedLocations.push(locationId);
}

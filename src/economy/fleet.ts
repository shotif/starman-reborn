import { applyCredits, type Cargo, type CommodityId, type FleetReport, type GameState, type Hauler, type OutpostRecord, type OwnedShip, type ShipState, type Stake } from '../app/state.ts';
import { shipModel, shipsForSale } from '../content/catalog.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { FLEET } from '../content/fleet/rules.ts';
import { FIRST_NAMES, LAST_NAMES } from '../content/people/lines.ts';
import { rng } from '../content/random.ts';
import type { ShipModel } from '../content/types.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, saveLocations, SYSTEMS, WORLD } from '../data/systems.ts';
import type { FactionId, SystemId } from '../data/types.ts';
import { findRoute } from '../galaxy/routing.ts';
import { addCargo, cargoCount, cargoUsed, itemsThatFit, removeCargo } from './cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from './commodities.ts';
import { routeFeeBetween } from './contracts.ts';
import { quartersBlock } from './crewQuarters.ts';
import { hasShipyard, shipStandingBlock, shipTradeIn, type Result } from './equipment.ts';
import { stationEventAt, systemEventAt, type WorldEvent } from './events.ts';
import { legsOf, type HaulLeg } from './hauls.ts';
import { outpostNext, payOldHours, payOutpostHour } from './outposts.ts';
import { nextRaid, outpostSystem, raidNote, settleRaid, skipQuietWindows, type RaidPlan } from './outpostRaids.ts';
import type { JobEvent } from './jobs.ts';
import { berthBlock } from './passengers.ts';
import { dockAccess } from './law.ts';
import { cargoCapacity, clampShip, newShipState, performanceOf, shieldCapacity } from './loadout.ts';
import { hasMarket, moveStock, orderTotal, quote, stockAvailable, type MarketContext } from './markets.ts';
import { barKind } from './people.ts';
import { knownAt, marketContext } from './trade.ts';
import { riskOf, security, type RouteRisk } from './tradeComputer.ts';
import { discounted, yardDiscount } from './ranks.ts';

/**
 * A fleet of your own (docs/PROCGEN.md §18): ships parked at stations, captains flying them on the
 * player's routes, leased storage and stakes in a station's trade. Rules in
 * src/content/fleet/rules.ts.
 *
 * Nothing runs in the background. `settleFleet` works out everything due since the last settle from
 * the game clock (when the player docks, jumps or loads a save, and in flight as steps fall due):
 * every hauler run and every hour of dividends, in time order, each run's luck drawn from a stream
 * keyed by the save's seed, the ship and the run. Settling often or seldom comes out the same, and
 * so does every device.
 *
 * Your captains on the lanes (§18.6): a run flies its route's systems in legs like a timetable
 * haul's, so FlightSession can show it where the player is (`captainsIn`). Raiders strike a run at
 * one place and time; in the player's sight that raid is flown, and what the player sees decides it
 * (`captainSeen`, `captainLost`).
 *
 * Haulers trade for real: a run's purchase drains the stock where it loads and its sale fills the
 * stock where it sells (moveStock, in time order), so a route worked hard flattens like one the
 * player works, and its neighbours feel it too (§17). Captains trade at the list price (without the
 * player's standing), carry lawful cargo only, and never deal at raider dens.
 */

const NEUTRAL: Record<FactionId, number> = { sta: 0, frontier: 0, 'hollow-wake': 0 };
const HOUR = 3_600;

const shipName = (ship: ShipState) => shipModel(ship.model).name;
const place = (id: string) => getLocation(id).name;
const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();
const signed = (n: number) => `${Math.round(n) > 0 ? '+' : ''}${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Why the player cannot do fleet business at this dock now (not docked there, or emergency docking only), or null. */
function dockBlock(state: GameState, locationId: string): string | null {
  if (state.location.dockedAt !== locationId) return 'Dock there first.';
  if (dockAccess(state, locationId) !== 'full') return 'Emergency docking only: no business here.';
  return null;
}

/** Credits change without a ledger line (the fleet keeps its own accounts); never below zero. */
function credit(state: GameState, amount: number): void {
  state.credits = Math.max(0, Math.round(state.credits + amount));
}

// ---------------------------------------------------------------- the hangar

/** Ships parked at a station (not out with a captain). */
export function parkedAt(state: GameState, locationId: string): OwnedShip[] {
  return state.fleet.ships.filter((o) => o.locationId === locationId && !o.hauler);
}

/** A new ship's id: never one a kept report still names (a lost or sold ship's). */
function nextShipId(state: GameState): string {
  let n = 0;
  for (const id of [...state.fleet.ships.map((o) => o.id), ...state.fleet.reports.map((r) => r.shipId)]) {
    const m = id ? /^ship-(\d+)$/.exec(id) : null;
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `ship-${n + 1}`;
}

export interface KeepOffer {
  model: ShipModel;
  /** The full price: nothing is traded in. */
  price: number;
  blocked: string | null;
  /** Your cargo moves across (it fits the new hold); otherwise it stays aboard the ship you park. */
  cargoMoves: boolean;
}

/** Buying a ship and keeping the one you fly (parked here) instead of trading it in. */
export function keepOffer(state: GameState, locationId: string, modelId: string): KeepOffer | null {
  const model = shipsForSale(locationId).find((m) => m.id === modelId);
  if (!model) return null;
  let blocked = shipStandingBlock(state, locationId, model);
  if (!blocked && state.fleet.ships.length >= FLEET.hangar.max) blocked = `Hangar full: you own ${FLEET.hangar.max} other ships`;
  // A rank's discount at the faction's own yard (docs/PROCGEN.md §32.3).
  const price = discounted(model.price, yardDiscount(state, locationId, model.maker));
  if (!blocked && price > state.credits) blocked = 'Not enough credits';
  if (!blocked) blocked = berthBlock(state, performanceOf({ model: model.id, fittings: model.stock }).berths);
  if (!blocked) blocked = quartersBlock(state, model.id);
  const cargoMoves = performanceOf({ model: model.id, fittings: model.stock }).cargo >= cargoUsed(state.ship.cargo);
  return { model, price, blocked, cargoMoves };
}

/**
 * Buys a ship at full price and parks the one you fly here, as it is: its fittings, rounds, repair
 * kits and decoys stay with it. Your cargo moves across when it fits the new hold.
 */
export function buyAndKeep(state: GameState, locationId: string, modelId: string): Result {
  const block = dockBlock(state, locationId);
  if (block) return { ok: false, message: block };
  const offer = keepOffer(state, locationId, modelId);
  if (!offer) return { ok: false, message: 'Not sold here.' };
  if (offer.blocked) return { ok: false, message: offer.blocked };
  const old = state.ship;
  const fresh = newShipState(offer.model.id);
  if (offer.cargoMoves) {
    fresh.cargo = old.cargo;
    old.cargo = {};
  }
  state.fleet.ships.push({ id: nextShipId(state), ship: old, locationId });
  state.ship = fresh;
  applyCredits(state, -offer.price, 'equipment', `Bought ${offer.model.name}`);
  return { ok: true, message: `The ${offer.model.name} is yours. Your ${shipName(old)} is parked here${offer.cargoMoves ? '' : ' with its cargo'}.` };
}

/** Switches to a ship parked here; the ship you flew is parked in its place. Each keeps its own cargo and gear. */
export function switchShip(state: GameState, shipId: string): Result {
  const here = state.location.dockedAt;
  const o = state.fleet.ships.find((x) => x.id === shipId);
  if (!here || !o || o.locationId !== here) return { ok: false, message: 'That ship is not parked here.' };
  const block = dockBlock(state, here);
  if (block) return { ok: false, message: block };
  if (o.hauler) return { ok: false, message: `${o.hauler.captain} has it on a route: recall the captain first.` };
  // Passengers aboard go with you, and need their berths in the ship you take (docs/PROCGEN.md §23).
  const berths = berthBlock(state, performanceOf(o.ship).berths);
  if (berths) return { ok: false, message: `${berths} in the ${shipName(o.ship)}.` };
  // So do the crew, who need quarters in it (docs/PROCGEN.md §30.3).
  const quarters = quartersBlock(state, o.ship.model);
  if (quarters) return { ok: false, message: `${quarters}.` };
  const flown = state.ship;
  state.ship = o.ship;
  o.ship = flown;
  // Docked: the shields charge, and nothing exceeds what the fittings allow.
  clampShip(state.ship);
  state.ship.shield = shieldCapacity(state.ship);
  return { ok: true, message: `You take the ${shipName(state.ship)}. Your ${shipName(flown)} is parked here${cargoUsed(flown.cargo) ? ' with its cargo' : ''}.` };
}

/** What a shipyard here pays for a parked ship (the trade-in rate), and why it cannot be sold now. */
export function sellOffer(state: GameState, o: OwnedShip): { value: number; blocked: string | null } {
  const value = shipTradeIn(o.ship);
  let blocked: string | null = null;
  if (o.hauler) blocked = 'Recall its captain first';
  else if (o.locationId !== state.location.dockedAt) blocked = 'Not parked here';
  else if (!hasShipyard(o.locationId)) blocked = 'Only a shipyard buys ships';
  else if (cargoUsed(o.ship.cargo) > 0) blocked = 'Empty its hold first';
  return { value, blocked };
}

export function sellShip(state: GameState, shipId: string): Result {
  const i = state.fleet.ships.findIndex((x) => x.id === shipId);
  const o = state.fleet.ships[i];
  if (!o) return { ok: false, message: 'No such ship.' };
  const block = dockBlock(state, o.locationId);
  if (block) return { ok: false, message: block };
  const offer = sellOffer(state, o);
  if (offer.blocked) return { ok: false, message: `${offer.blocked}.` };
  state.fleet.ships.splice(i, 1);
  applyCredits(state, offer.value, 'equipment', `Sold ${shipName(o.ship)}`);
  return { ok: true, message: `Sold your ${shipName(o.ship)} for ${offer.value} cr.` };
}

// ---------------------------------------------------------------- storage

export function storageAt(state: GameState, locationId: string): Cargo | undefined {
  return state.fleet.storage[locationId];
}

export function leaseStorage(state: GameState, locationId: string): Result {
  const block = dockBlock(state, locationId);
  if (block) return { ok: false, message: block };
  if (state.fleet.storage[locationId]) return { ok: false, message: 'You lease a hold here already.' };
  if (state.credits < FLEET.storage.lease) return { ok: false, message: 'Not enough credits.' };
  state.fleet.storage[locationId] = {};
  applyCredits(state, -FLEET.storage.lease, 'fleet', `Storage lease at ${place(locationId)}`);
  return { ok: true, message: `You lease a ${FLEET.storage.capacity}-unit hold at ${place(locationId)}.` };
}

/** How many of a good can go from the ship into storage here, and back. */
export function storageMoves(state: GameState, locationId: string, c: CommodityId): { store: number; take: number } {
  const hold = storageAt(state, locationId);
  if (!hold) return { store: 0, take: 0 };
  return {
    store: Math.min(cargoCount(state.ship.cargo, c), itemsThatFit(hold, c, FLEET.storage.capacity)),
    take: Math.min(cargoCount(hold, c), itemsThatFit(state.ship.cargo, c, cargoCapacity(state.ship))),
  };
}

/** Moves cargo between the ship and the hold leased here: `store` puts it in storage, `take` brings it aboard. */
export function moveCargo(state: GameState, locationId: string, c: CommodityId, qty: number, way: 'store' | 'take'): Result {
  const block = dockBlock(state, locationId);
  if (block) return { ok: false, message: block };
  const hold = storageAt(state, locationId);
  if (!hold) return { ok: false, message: 'Lease a hold here first.' };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: 'Choose at least one item.' };
  const [src, dst, room] = way === 'store' ? [state.ship.cargo, hold, FLEET.storage.capacity] : [hold, state.ship.cargo, cargoCapacity(state.ship)];
  if (qty > cargoCount(src, c)) return { ok: false, message: way === 'store' ? 'You do not carry that many.' : 'Not that many in storage.' };
  if (qty > itemsThatFit(dst, c, room)) return { ok: false, message: way === 'store' ? 'Not enough room in storage.' : 'Not enough room in your hold.' };
  removeCargo(src, c, qty);
  addCargo(dst, c, qty, room);
  return { ok: true, message: `${way === 'store' ? 'Stored' : 'Loaded'} ${qty} ${goodName(c)}.` };
}

// ---------------------------------------------------------------- stakes

/** What 1% of a station's trade costs (0: no stakes sold there). */
export function stakePrice(locationId: string): number {
  const loc = getLocation(locationId);
  if (loc.dockable === false || !hasMarket(locationId)) return 0;
  const kind = barKind(locationId);
  return kind ? FLEET.stakes.pricePerPercent[kind] : 0;
}

export function stakeAt(state: GameState, locationId: string): Stake | undefined {
  return state.fleet.stakes.find((k) => k.locationId === locationId);
}

/** A stake's current price (what dividends and the sell-back are reckoned on). */
export function stakeValue(k: Pick<Stake, 'locationId' | 'percent'>): number {
  return k.percent * stakePrice(k.locationId);
}

export interface StakeOffer {
  perPercent: number;
  held: number;
  /** Per-cent still for sale to the player here. */
  room: number;
  blocked: string | null;
}

export function stakeOffer(state: GameState, locationId: string): StakeOffer | null {
  const perPercent = stakePrice(locationId);
  if (perPercent <= 0) return null;
  const held = stakeAt(state, locationId)?.percent ?? 0;
  const room = FLEET.stakes.maxPercent - held;
  let blocked: string | null = null;
  if (room <= 0) blocked = `You hold the most anyone may: ${FLEET.stakes.maxPercent}%`;
  else if (!held && state.fleet.stakes.length >= FLEET.stakes.maxStations) blocked = `You hold stakes in ${FLEET.stakes.maxStations} stations already`;
  else if (state.credits < perPercent) blocked = 'Not enough credits';
  return { perPercent, held, room, blocked };
}

export function buyStake(state: GameState, locationId: string, percent: number): Result {
  const block = dockBlock(state, locationId);
  if (block) return { ok: false, message: block };
  const offer = stakeOffer(state, locationId);
  if (!offer) return { ok: false, message: 'Nobody sells a share of this station’s trade.' };
  if (offer.blocked && offer.room <= 0) return { ok: false, message: `${offer.blocked}.` };
  if (!Number.isInteger(percent) || percent < 1 || percent > offer.room) return { ok: false, message: `Choose 1 to ${offer.room}%.` };
  if (!offer.held && state.fleet.stakes.length >= FLEET.stakes.maxStations) return { ok: false, message: `${offer.blocked}.` };
  const cost = percent * offer.perPercent;
  if (cost > state.credits) return { ok: false, message: 'Not enough credits.' };
  const k = stakeAt(state, locationId);
  if (k) {
    // The hour under way pays for the stake as it was; the larger stake counts from now.
    payPartHour(state, k);
    k.percent += percent;
    k.paid += cost;
  } else {
    state.fleet.stakes.push({ locationId, percent, paid: cost, since: state.clock, earned: 0 });
  }
  applyCredits(state, -cost, 'fleet', `${percent}% of ${place(locationId)}’s trade`);
  return { ok: true, message: `You own ${stakeAt(state, locationId)!.percent}% of ${place(locationId)}’s trade.` };
}

export function sellStake(state: GameState, locationId: string): Result {
  const i = state.fleet.stakes.findIndex((k) => k.locationId === locationId);
  const k = state.fleet.stakes[i];
  if (!k) return { ok: false, message: 'You hold no stake there.' };
  payPartHour(state, k);
  const value = Math.round(stakeValue(k) * FLEET.stakes.sellBack);
  state.fleet.stakes.splice(i, 1);
  applyCredits(state, value, 'fleet', `Sold ${k.percent}% of ${place(locationId)}’s trade`);
  return { ok: true, message: `Sold your ${k.percent}% of ${place(locationId)}’s trade for ${value} cr.` };
}

/** How the station's fortunes move its dividends at a moment: its event, and a raid or sweep in its system. */
export function dividendFactor(locationId: string, clock: number): { factor: number; events: WorldEvent[] } {
  let factor = 1;
  const events: WorldEvent[] = [];
  for (const e of [stationEventAt(locationId, clock), systemEventAt(getLocation(locationId).systemId, clock)]) {
    if (!e) continue;
    factor *= FLEET.stakes.events[e.kind];
    events.push(e);
  }
  return { factor, events };
}

/** Dividends for an hour of a stake, the station's fortunes at `clock` included. */
export function dividendPerHour(locationId: string, percent: number, clock: number): number {
  return Math.round(FLEET.stakes.dividendPerHour * stakeValue({ locationId, percent }) * dividendFactor(locationId, clock).factor);
}

/**
 * Pays the part of the hour under way (the whole hours are settled on docking) before a stake
 * changes hands, and starts its hours again from now.
 */
function payPartHour(state: GameState, k: Stake): void {
  const part = Math.min(HOUR, Math.max(0, state.clock - k.since));
  const pay = Math.round((dividendPerHour(k.locationId, k.percent, k.since + part / 2) * part) / HOUR);
  k.since = state.clock;
  k.earned += pay;
  credit(state, pay);
}

// ---------------------------------------------------------------- haulers: routes

/** Captains carry lawful cargo only: no contraband, no small arms. */
export const lawfulCargo = (c: CommodityId): boolean => c !== 'weapons' && COMMODITIES[c].category !== 'contraband';

/** Docks a captain loads or sells at: an open market, never a raider den. */
export function haulDock(locationId: string): boolean {
  const loc = getLocation(locationId);
  return hasMarket(locationId) && loc.dockable !== false && loc.stationType !== 'pirate-den';
}

const pathCache = new Map<string, SystemId[]>();

/** Systems a run passes through, both ends included (the shortest route). */
export function routeSystems(a: SystemId, b: SystemId): SystemId[] {
  if (a === b) return [a];
  const key = `${a}|${b}`;
  let path = pathCache.get(key);
  if (!path) pathCache.set(key, (path = findRoute(SYSTEMS, a, b)?.path ?? [a, b]));
  return path;
}

export interface HaulRisk {
  /** The route's own danger, from its worst security. */
  base: RouteRisk;
  /** What a run setting out now meets: one level worse while raiders swarm a system on the route. */
  level: RouteRisk;
  raid: boolean;
  /** Chance of meeting raiders, and of losing the ship when they strike. */
  raided: number;
  shipLost: number;
}

const LEVELS: readonly RouteRisk[] = ['patrolled', 'thin', 'lawless'];

export function haulRisk(from: string, to: string, clock: number): HaulRisk {
  const systems = routeSystems(getLocation(from).systemId, getLocation(to).systemId);
  const base = riskOf(Math.min(...systems.map(security)));
  const raid = systems.some((s) => systemEventAt(s, clock)?.kind === 'raid');
  const level = raid ? LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(base) + 1)]! : base;
  return { base, level, raid, raided: FLEET.risk.raided[level], shipLost: FLEET.risk.shipLost };
}

const jumpCache = new Map<SystemId, Map<SystemId, number>>();
/** Jumps between two systems by the fewest lanes (a captain's drive reaches the frontier's long lanes). */
function jumpsBetween(a: SystemId, b: SystemId): number {
  let m = jumpCache.get(a);
  if (!m) jumpCache.set(a, (m = jumpsFrom(WORLD.links, a)));
  return m.get(b) ?? routeSystems(a, b).length - 1;
}

/**
 * The trip as the trade computer counts it for the player (out of the dock, each jump, into the
 * dock), between any two systems: the contract boards' count never sends a core pilot into the
 * frontier, but a captain flies wherever the player has been.
 */
function tripSeconds(a: SystemId, b: SystemId): number {
  const t = CONTRACTS.urgent.trip;
  return t.depart + jumpsBetween(a, b) * t.perJump + t.arrive;
}

/** A run's timing (game-clock seconds): loading, each way, and the whole run. */
export function haulTimes(from: string, to: string): { load: number; oneWay: number; run: number } {
  const load = FLEET.haulers.loadSeconds;
  const oneWay = Math.max(1, Math.round(tripSeconds(getLocation(from).systemId, getLocation(to).systemId) * FLEET.haulers.tripFactor));
  return { load, oneWay, run: load + 2 * oneWay };
}

/** A run's way there (`out`, with the cargo) and home (`back`, empty): the legs it flies in each system. */
export interface RunWay {
  out: HaulLeg[];
  back: HaulLeg[];
}

/**
 * The way of the run under way (docs/PROCGEN.md §18.6): the route's systems (the shortest route, as
 * its risk is reckoned), in legs like a timetable haul's (out of the dock to the jump beacon, across
 * each system on the way, in from the jump to the dock; between two docks of one system, one leg),
 * scaled to the run's time each way. The way out starts when the loading is done.
 */
export function runWay(h: Pick<Hauler, 'route' | 'since'>): RunWay {
  const { from, to } = h.route;
  const path = routeSystems(getLocation(from).systemId, getLocation(to).systemId);
  const { load, oneWay } = haulTimes(from, to);
  const depart = h.since + load;
  return { out: scaledLegs(path, depart, oneWay), back: scaledLegs([...path].reverse(), depart + oneWay, oneWay) };
}

function scaledLegs(path: readonly SystemId[], depart: number, seconds: number): HaulLeg[] {
  const legs = legsOf(path, 0);
  const natural = legs.at(-1)!.end;
  const at = (t: number) => depart + Math.round((t * seconds) / natural);
  return legs.map((l) => ({ ...l, start: at(l.start), end: at(l.end) }));
}

/** Jump fees for a run: there and back. */
export function haulFees(from: string, to: string): number {
  const a = getLocation(from).systemId;
  const b = getLocation(to).systemId;
  return routeFeeBetween(a, b) + routeFeeBetween(b, a);
}

/** The captain's wage and the insurance premium: shares of a run's profit (nothing on a loss). */
function cuts(profit: number, insured: boolean): { wage: number; premium: number } {
  const p = Math.max(0, profit);
  return { wage: Math.round(p * FLEET.haulers.wageShare), premium: insured ? Math.round(p * FLEET.risk.premium) : 0 };
}

/** Items a captain loads: within `holdShare` of the ship's hold. */
function loadOf(ship: ShipState, c: CommodityId): number {
  return Math.floor((cargoCapacity(ship) * FLEET.haulers.holdShare) / COMMODITIES[c].unitSize);
}

/** What a lost ship pays back when insured. */
export function insurancePayout(ship: ShipState): number {
  return Math.round(FLEET.risk.payout * shipModel(ship.model).price);
}

/** A run's luck: one draw for raiders, one for the ship, from a stream keyed by the save, the ship, the hire and the run. */
export function runLuck(seed: number, shipId: string, hired: number, run: number): { raid: number; loss: number } {
  const r = rng(seed, 'hauler', shipId, Math.round(hired), run);
  return { raid: r.next(), loss: r.next() };
}

/** Where and when raiders strike a run, and whether they take the ship too. */
export interface RunRaid {
  systemId: SystemId;
  at: number;
  shipLost: boolean;
  /** How dangerous the route was when the run set out (what an ambush in sight is made of). */
  level: RouteRisk;
}

/**
 * The raid the run under way meets, if its luck says so (docs/PROCGEN.md §18.6): on the way out, in
 * the first system of the way with a raid (§11) under way when it set out, else in the least
 * secure (the first, on ties), at the middle of the run's leg there.
 */
export function runRaid(seed: number, o: Pick<OwnedShip, 'id' | 'hauler'>): RunRaid | null {
  const h = o.hauler;
  if (!h || h.leg !== 'out') return null;
  const { from, to } = h.route;
  const setOff = h.since + FLEET.haulers.loadSeconds;
  const risk = haulRisk(from, to, setOff);
  const luck = runLuck(seed, o.id, h.hired, h.runs);
  if (luck.raid >= risk.raided) return null;
  const way = runWay(h).out;
  const systems = way.map((l) => l.systemId);
  const where = systems.find((sys) => systemEventAt(sys, setOff)?.kind === 'raid') ?? systems.reduce((worst, sys) => (security(sys) < security(worst) ? sys : worst));
  const leg = way.find((l) => l.systemId === where)!;
  return { systemId: where, at: (leg.start + leg.end) / 2, shipLost: luck.loss < risk.shipLost, level: risk.level };
}

/** The raid still ahead of a run: it has its cargo aboard, and the player did not see it safely past. */
export function raidAhead(seed: number, o: OwnedShip): RunRaid | null {
  const h = o.hauler;
  const raid = runRaid(seed, o);
  if (!h || !raid || cargoCount(o.ship.cargo, h.route.commodity) <= 0) return null;
  if (h.sight?.run === h.runs && h.sight.systemId === raid.systemId) return null;
  return raid;
}

/** A captain's name for this ship, today. */
export function captainFor(state: GameState, shipId: string): string {
  const r = rng(state.seed, 'captain', shipId, Math.round(state.clock));
  return `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
}

/** Why no captain can be hired for this ship now, or null. */
export function hireBlock(state: GameState, o: OwnedShip): string | null {
  if (o.hauler) return `${o.hauler.captain} has it on a route already`;
  if (state.location.dockedAt !== o.locationId) return 'Hire a captain where the ship is parked';
  if (!haulDock(o.locationId)) return 'Captains load only at a market';
  if (cargoUsed(o.ship.cargo) > 0) return 'Its hold must be empty: switch to it and sell or store the cargo';
  return null;
}

/**
 * Goods a captain can run from `from` to `to`: lawful goods sold at `from`, with a price you know
 * for them at `to`.
 */
export function haulGoods(state: GameState, from: string, to: string): CommodityId[] {
  const obs = state.knownMarkets[to];
  if (!obs || !haulDock(from) || !haulDock(to) || from === to) return [];
  const ctx = marketContext(state);
  return COMMODITY_IDS.filter((c) => lawfulCargo(c) && (obs.prices[c]?.sell ?? null) !== null && quote(from, c, NEUTRAL, ctx).buy !== null);
}

const OPEN = new Set(ALL_LOCATIONS.filter((l) => l.status === 'functional').map((l) => l.id));

/**
 * Where a captain will fly from `from`: docks you have docked at yourself (the captain goes on your
 * charts and your contacts), with a market whose prices you know.
 */
export function haulDestinations(state: GameState, from: string): string[] {
  // Your own outpost too, once it is open (docs/PROCGEN.md §22).
  const own = (id: string) => saveLocations().some((l) => l.id === id && l.services.includes('market'));
  return state.visitedLocations.filter((id) => (OPEN.has(id) || own(id)) && haulGoods(state, from, id).length > 0);
}

export interface HaulEstimate {
  from: string;
  to: string;
  commodity: CommodityId;
  /** Items a run carries. */
  qty: number;
  /** The goods here (live), and their average price. */
  goods: number;
  buy: number;
  /** The price you know at the far end, and how old it is (s). */
  sell: number;
  sellAge: number;
  /** What the load should fetch there (as the price slides with every unit sold). */
  sale: number;
  fees: number;
  fee: number;
  wage: number;
  premium: number;
  /** The sale less the goods, the fees and the captain's fee; and what is left after the cuts. */
  profit: number;
  net: number;
  times: { load: number; oneWay: number; run: number };
  risk: HaulRisk;
  /** What insurance pays if the ship is lost. */
  payout: number;
}

/**
 * What a run should make, as the player can tell: the live price here, and the last price they
 * had at the far end (the captain decides on the day, with the real prices).
 */
export function haulEstimate(state: GameState, o: OwnedShip, to: string, c: CommodityId, insured: boolean): HaulEstimate | null {
  const from = o.locationId;
  const obs = state.knownMarkets[to];
  const sell = obs?.prices[c]?.sell ?? null;
  if (!obs || sell === null) return null;
  const ctx = marketContext(state);
  const qty = Math.min(loadOf(o.ship, c), stockAvailable(from, c, ctx));
  const goods = qty > 0 ? orderTotal(from, c, qty, 'buy', NEUTRAL, ctx) : 0;
  if (goods === null) return null;
  // Selling a load moves the price as it goes: the same slide as at the far end's normal stock.
  const normal: MarketContext = { clock: state.clock, markets: {} };
  const unit = quote(to, c, NEUTRAL, normal).sell;
  const slide = unit && qty > 0 ? (orderTotal(to, c, qty, 'sell', NEUTRAL, normal) ?? 0) / (qty * unit) : 1;
  const sale = Math.round(sell * qty * slide);
  const fees = haulFees(from, to);
  const fee = FLEET.haulers.fee;
  const profit = sale - goods - fees - fee;
  const { wage, premium } = cuts(profit, insured);
  const net = profit - wage - premium;
  const times = haulTimes(from, to);
  return {
    from,
    to,
    commodity: c,
    qty,
    goods,
    buy: qty > 0 ? Math.round(goods / qty) : 0,
    sell,
    sellAge: Math.max(0, state.clock - knownAt(obs, c)),
    sale,
    fees,
    fee,
    wage,
    premium,
    profit,
    net,
    times,
    risk: haulRisk(from, to, state.clock),
    payout: insurancePayout(o.ship),
  };
}

/** Gives a parked ship a captain and a route from where it is parked; the first run sets out at once. */
export function hireHauler(state: GameState, shipId: string, to: string, c: CommodityId, insured: boolean): Result & { reports: FleetReport[] } {
  const o = state.fleet.ships.find((x) => x.id === shipId);
  const fail = (message: string) => ({ ok: false, message, reports: [] });
  if (!o) return fail('No such ship.');
  const block = dockBlock(state, o.locationId) ?? hireBlock(state, o);
  if (block) return fail(block.endsWith('.') ? block : `${block}.`);
  if (!haulDestinations(state, o.locationId).includes(to)) return fail('Captains fly only to docks you have been to, with prices you know.');
  if (!haulGoods(state, o.locationId, to).includes(c)) return fail(`${COMMODITIES[c].name} is not sold here, or not bought there.`);
  const est = haulEstimate(state, o, to, c, insured);
  if (!est || est.net < FLEET.haulers.minProfit) return fail(`No captain takes a run that pays under ${FLEET.haulers.minProfit} cr.`);
  const captain = captainFor(state, o.id);
  o.hauler = { captain, route: { from: o.locationId, to, commodity: c }, insured, hired: state.clock, leg: 'home', since: state.clock, cost: 0, waiting: null, waits: 0, recalled: false, runs: 0, earned: 0 };
  const { reports } = settleFleet(state);
  const h = o.hauler;
  const how =
    h.leg === 'out'
      ? `: loading ${cargoCount(o.ship.cargo, c)} ${goodName(c)} for ${place(to)}.`
      : h.waiting === 'credits'
        ? ', but waits: you cannot pay for a load yet.'
        : ', but waits: prices have moved since you saw them, and the run does not pay for now.';
  return { ok: true, message: `${captain} takes your ${shipName(o.ship)}${how}`, reports };
}

/** Calls a captain home: at home the ship parks at once; out on a run, when the run is done. */
export function recallHauler(state: GameState, shipId: string): Result {
  const o = state.fleet.ships.find((x) => x.id === shipId);
  const h = o?.hauler;
  if (!o || !h) return { ok: false, message: 'No captain flies that ship.' };
  if (h.leg === 'home') {
    delete o.hauler;
    return { ok: true, message: `${h.captain} parks your ${shipName(o.ship)} at ${place(o.locationId)} and signs off.` };
  }
  h.recalled = true;
  const minutes = Math.max(1, Math.round((h.since + haulTimes(h.route.from, h.route.to).run - state.clock) / 60));
  return { ok: true, message: `${h.captain} will bring your ${shipName(o.ship)} home to ${place(o.locationId)} after this run, in about ${minutes} min.` };
}

export function setInsured(state: GameState, shipId: string, insured: boolean): Result {
  const h = state.fleet.ships.find((x) => x.id === shipId)?.hauler;
  if (!h) return { ok: false, message: 'No captain flies that ship.' };
  h.insured = insured;
  return { ok: true, message: insured ? `Insured: ${Math.round(FLEET.risk.premium * 100)}% of each run’s profit.` : 'Insurance cancelled.' };
}

// ---------------------------------------------------------------- settling

export interface FleetSettlement {
  /** Reports made in this settle, in time order. */
  reports: FleetReport[];
  /** Runs finished (sold, or raided). */
  runs: number;
  /** What those runs made the player, all told (negative: lost). */
  hauled: number;
  dividends: number;
  /** Income from the player's outposts (docs/PROCGEN.md §22), and how many paid it (§36). */
  outpost: number;
  outposts?: number;
  /** Raids on the player's outpost settled (docs/PROCGEN.md §29): what is said of each, and the jobs they closed. */
  raids: { text: string; tone: 'good' | 'bad'; watch: string; speaker: string }[];
  raidJobs: JobEvent[];
  /** Steps worked out (loads, arrivals, homecomings, looks, hours of dividends): 0 when nothing was due. */
  steps: number;
}

/** How a settle in flight treats the player's own haulers in sight (docs/PROCGEN.md §18.6). */
export interface SettleOptions {
  /**
   * Owned ships flying in the player's sight: a raid due on one in the player's system waits for
   * the flight to decide it (and the rest of that run waits with it).
   */
  inSight?: ReadonlySet<string>;
}

/** When a hauler's leg ends: setting out (at home), arriving (out), or getting home (back). */
export function haulerNext(h: Hauler): number {
  if (h.leg === 'home') return h.since;
  const { load, oneWay } = haulTimes(h.route.from, h.route.to);
  return h.since + load + (h.leg === 'out' ? oneWay : 2 * oneWay);
}

function report(state: GameState, out: FleetSettlement, r: FleetReport): void {
  const list = state.fleet.reports;
  list.push(r);
  if (list.length > FLEET.reports) list.splice(0, list.length - FLEET.reports);
  out.reports.push(r);
}

/** Stock moves in time order; a market already moved later (traffic in flight) takes it at its own time. */
function moveStockAt(state: GameState, locationId: string, c: CommodityId, delta: number, t: number): void {
  moveStock(state.markets, locationId, c, delta, Math.max(t, state.markets[locationId]?.t ?? t));
}

interface Plan {
  qty: number;
  cost: number;
  net: number;
}

/** What the captain sees when it is time to load: the real prices at both ends now. */
function planAt(state: GameState, o: OwnedShip, h: Hauler, t: number): Plan | null {
  const { from, to, commodity: c } = h.route;
  const ctx: MarketContext = { clock: t, markets: state.markets };
  const qty = Math.min(loadOf(o.ship, c), stockAvailable(from, c, ctx));
  if (qty <= 0) return null;
  const goods = orderTotal(from, c, qty, 'buy', NEUTRAL, ctx);
  const sale = orderTotal(to, c, qty, 'sell', NEUTRAL, ctx);
  if (goods === null || sale === null) return null;
  const cost = goods + haulFees(from, to) + FLEET.haulers.fee;
  const { wage, premium } = cuts(sale - cost, h.insured);
  return { qty, cost, net: sale - cost - wage - premium };
}

function park(state: GameState, o: OwnedShip, h: Hauler, t: number, out: FleetSettlement): void {
  delete o.hauler;
  report(state, out, {
    at: t,
    kind: 'home',
    shipId: o.id,
    amount: 0,
    text: `${h.captain} brought your ${shipName(o.ship)} home to ${place(h.route.from)} and signed off after ${plural(h.runs, 'run')} (${signed(h.earned)} cr).`,
  });
}

/** At home: load and set out, or wait (the route does not pay, or the player cannot pay for a load). */
function setOut(state: GameState, o: OwnedShip, h: Hauler, t: number, out: FleetSettlement): void {
  // (Recalling a captain at home parks at once; a save may still hold one recalled here.)
  if (h.recalled) return park(state, o, h, t, out);
  const { from, to, commodity: c } = h.route;
  const plan = planAt(state, o, h, t);
  const why = !plan || plan.net < FLEET.haulers.minProfit ? 'unprofitable' : plan.cost > state.credits ? 'credits' : null;
  if (why) {
    h.waits = h.waiting === why ? h.waits + 1 : 1;
    h.waiting = why;
    h.since = t + FLEET.haulers.recheck;
    // A route worked hard often needs a look or two to recover; a longer wait is worth a report, once.
    if (h.waits === (why === 'credits' ? 1 : 1 + FLEET.haulers.reportAfter)) {
      const text =
        why === 'unprofitable'
          ? `${h.captain} waits at ${place(from)}: ${goodName(c)} to ${place(to)} does not pay ${FLEET.haulers.minProfit} cr a run for now.`
          : `${h.captain} waits at ${place(from)}: you cannot pay for a load of ${goodName(c)} (${plan!.cost} cr).`;
      report(state, out, { at: t, kind: 'wait', shipId: o.id, amount: 0, text });
    }
    return;
  }
  credit(state, -plan!.cost);
  moveStockAt(state, from, c, -plan!.qty, t);
  o.ship.cargo = { [c]: plan!.qty };
  h.cost = plan!.cost;
  h.leg = 'out';
  h.since = t;
  h.waiting = null;
  h.waits = 0;
}

const systemName = (id: SystemId) => getSystem(id).displayName;

/**
 * A ship lost on a run, at `t` in `systemId`: to raiders, or to the player's own guns. Whatever it
 * still carried is lost with it; insurance pays for a ship raiders destroyed, not one the player did.
 */
function wreck(state: GameState, o: OwnedShip, h: Hauler, t: number, systemId: SystemId, by: 'raiders' | 'player', qty: number, out: FleetSettlement): void {
  const { from, to, commodity: c } = h.route;
  const payout = h.insured && by === 'raiders' ? insurancePayout(o.ship) : 0;
  credit(state, payout);
  // What the run still had at stake (the goods and fees, until it sells) goes with the ship.
  const net = payout - h.cost;
  h.earned += net;
  out.hauled += net;
  // A run ended on its way out counts as a run; one on its way home was counted when it arrived.
  if (h.leg === 'out') out.runs += 1;
  o.ship.cargo = {};
  state.fleet.ships.splice(state.fleet.ships.indexOf(o), 1);
  const way = h.leg === 'out' ? `on the way to ${place(to)}` : `on the way home to ${place(from)}`;
  const aboard = qty > 0 ? `, with ${qty} ${goodName(c)}` : '';
  const who = by === 'raiders' ? 'Raiders destroyed' : 'Your own guns destroyed';
  const insured = payout ? ` Insurance paid ${payout} cr.` : by === 'player' && h.insured ? ' Insurance does not pay for that.' : '';
  report(state, out, {
    at: t,
    kind: 'lost',
    shipId: o.id,
    amount: net,
    text: `${who} your ${shipName(o.ship)} in ${systemName(systemId)} ${way}${aboard}. ${h.captain} got away in a pod.${insured}`,
  });
}

/** Raiders strike a run out of the player's sight: the cargo is lost, and perhaps the ship. */
function strike(state: GameState, o: OwnedShip, h: Hauler, raid: RunRaid, out: FleetSettlement): void {
  const { to, commodity: c } = h.route;
  const qty = cargoCount(o.ship.cargo, c);
  if (raid.shipLost) return wreck(state, o, h, raid.at, raid.systemId, 'raiders', qty, out);
  o.ship.cargo = {};
  const net = -h.cost;
  h.cost = 0;
  h.earned += net;
  out.hauled += net;
  report(state, out, { at: raid.at, kind: 'raid', shipId: o.id, amount: net, text: `Raiders took ${h.captain}’s ${qty} ${goodName(c)} in ${systemName(raid.systemId)}, on the way to ${place(to)} (${signed(net)} cr).` });
}

/** At the far end: the sale (a run robbed on the way flies on empty, and sells nothing). */
function arrive(state: GameState, o: OwnedShip, h: Hauler, t: number, out: FleetSettlement): void {
  const { to, commodity: c } = h.route;
  const qty = cargoCount(o.ship.cargo, c);
  h.runs += 1;
  out.runs += 1;
  h.leg = 'back';
  delete h.sight;
  if (qty <= 0) return;
  o.ship.cargo = {};
  const sale = orderTotal(to, c, qty, 'sell', NEUTRAL, { clock: t, markets: state.markets }) ?? 0;
  moveStockAt(state, to, c, qty, t);
  const profit = sale - h.cost;
  h.cost = 0;
  const { wage, premium } = cuts(profit, h.insured);
  credit(state, sale - wage - premium);
  const net = profit - wage - premium;
  h.earned += net;
  out.hauled += net;
  report(state, out, { at: t, kind: 'run', shipId: o.id, amount: net, text: `${h.captain} sold ${qty} ${goodName(c)} at ${place(to)}: ${signed(net)} cr.` });
}

function comeHome(state: GameState, o: OwnedShip, h: Hauler, t: number, out: FleetSettlement): void {
  if (h.recalled) return park(state, o, h, t, out);
  h.leg = 'home';
  h.since = t;
  h.cost = 0;
}

function payDividend(state: GameState, k: Stake, out: FleetSettlement): void {
  const pay = dividendPerHour(k.locationId, k.percent, k.since + HOUR / 2);
  k.since += HOUR;
  k.earned += pay;
  out.dividends += pay;
  credit(state, pay);
}

/**
 * Works out everything the fleet did since the last settle, up to the game clock: every hauler run
 * and every hour of dividends, in time order (so a dividend can pay for the next load). The same
 * clock gives the same result however often it is called, on every device.
 */
export function settleFleet(state: GameState, opts: SettleOptions = {}): FleetSettlement {
  const out: FleetSettlement = { reports: [], runs: 0, hauled: 0, dividends: 0, outpost: 0, steps: 0, raids: [], raidJobs: [] };
  const fleet = state.fleet;
  const posts = state.world.outposts ?? [];
  if (!fleet.stakes.length && !fleet.ships.some((o) => o.hauler) && !posts.some((p) => p.stage > 0)) return out;
  const now = state.clock;
  const paid = new Set<OutpostRecord>();
  for (const post of posts) {
    skipQuietWindows(state, post);
    const old = payOldHours(post, now);
    if (old.pay > 0) paid.add(post);
    out.outpost += old.pay;
    out.steps += old.hours;
    credit(state, old.pay);
  }
  // Away for very long: the oldest hours of dividends are paid at the plain rate, all at once.
  for (const k of fleet.stakes) {
    const old = Math.floor((now - k.since) / HOUR) - FLEET.stakes.maxHoursPerSettle;
    if (old <= 0) continue;
    const pay = old * Math.round(FLEET.stakes.dividendPerHour * stakeValue(k));
    k.since += old * HOUR;
    k.earned += pay;
    out.dividends += pay;
    out.steps += old;
    credit(state, pay);
  }
  const looks = new Map<OwnedShip, number>();
  const resting = new Set<OwnedShip>();
  // A raid due where the player watches the ship waits for the flight to decide it.
  const here = state.location.dockedAt ? null : state.location.systemId;
  for (;;) {
    let next: { t: number; ship?: OwnedShip; raid?: RunRaid; stake?: Stake; outpost?: OutpostRecord; outpostRaid?: RaidPlan } | null = null;
    // Raids on the outposts (docs/PROCGEN.md §29): with the player flying in its system, one waits for
    // the flight to decide it, and that outpost's hours after it wait with it.
    for (const post of posts) {
      const due = post.stage > 0 ? nextRaid(state, post) : null;
      const strikes = due && due.at <= now ? due : null;
      const held = !!strikes && here === outpostSystem(post);
      const t = outpostNext(post);
      if (t <= now && !(held && t > strikes!.at) && (!next || t < next.t)) next = { t, outpost: post };
      if (strikes && !held && (!next || strikes.at < next.t)) next = { t: strikes.at, outpost: post, outpostRaid: strikes };
    }
    for (const o of fleet.ships) {
      if (!o.hauler || resting.has(o)) continue;
      let t = haulerNext(o.hauler);
      const raid = o.hauler.leg === 'out' ? raidAhead(state.seed, o) : null;
      if (raid && raid.at <= t) {
        if (raid.at <= now && opts.inSight?.has(o.id) && raid.systemId === here) continue;
        t = raid.at;
      }
      if (t <= now && (!next || t < next.t)) next = { t, ship: o, ...(raid && t === raid.at ? { raid } : {}) };
    }
    for (const k of fleet.stakes) {
      const t = k.since + HOUR;
      if (t <= now && (!next || t < next.t)) next = { t, stake: k };
    }
    if (!next) break;
    out.steps += 1;
    if (next.outpostRaid) {
      const post = next.outpost!;
      const { raid, events } = settleRaid(state, post, next.outpostRaid, 'away');
      const note = raidNote(post, raid);
      out.raids.push({ ...note, speaker: `${post.name} watch` });
      out.raidJobs.push(...events);
      continue;
    }
    if (next.outpost) {
      const pay = payOutpostHour(next.outpost);
      if (pay > 0) paid.add(next.outpost);
      out.outpost += pay;
      credit(state, pay);
      continue;
    }
    if (next.stake) {
      payDividend(state, next.stake, out);
      continue;
    }
    const o = next.ship!;
    const h = o.hauler!;
    if (next.raid) {
      strike(state, o, h, next.raid, out);
    } else if (h.leg === 'home') {
      const n = (looks.get(o) ?? 0) + 1;
      if (n > FLEET.haulers.maxLooksPerSettle) {
        // Too long to work out every look and run: the captain rests until now.
        h.since = now;
        resting.add(o);
        continue;
      }
      looks.set(o, n);
      setOut(state, o, h, next.t, out);
    } else if (h.leg === 'out') {
      arrive(state, o, h, next.t, out);
    } else {
      comeHome(state, o, h, next.t, out);
    }
  }
  if (paid.size) out.outposts = paid.size;
  return out;
}

// ---------------------------------------------------------------- on the lanes, in the player's sight

/** One of the player's haulers flying in a system now (docs/PROCGEN.md §18.6). */
export interface CaptainHere {
  ship: OwnedShip;
  hauler: Hauler;
  /** Out with the cargo, or home empty. */
  way: 'out' | 'back';
  leg: HaulLeg;
  /** How far along its leg (0–1). */
  progress: number;
  /** What it carries (none on the way home, or robbed on the way). */
  qty: number;
  /** The run's raid, when it is due in this system and still ahead. */
  raid: RunRaid | null;
}

/** The leg a hauler flies at a moment, on the run under way. */
function legAt(h: Hauler, clock: number): { way: 'out' | 'back'; leg: HaulLeg } | null {
  if (h.leg === 'home') return null;
  const w = runWay(h);
  const legs = h.leg === 'out' ? w.out : w.back;
  const leg = legs.find((l) => clock >= l.start && clock < l.end);
  return leg ? { way: h.leg, leg } : null;
}

/** The player's haulers flying in a system at a moment, for the flight scene. */
export function captainsIn(state: GameState, systemId: SystemId, clock: number): CaptainHere[] {
  const out: CaptainHere[] = [];
  for (const o of state.fleet.ships) {
    const h = o.hauler;
    const at = h ? legAt(h, clock) : null;
    if (!h || !at || at.leg.systemId !== systemId) continue;
    const raid = at.way === 'out' ? raidAhead(state.seed, o) : null;
    out.push({
      ship: o,
      hauler: h,
      way: at.way,
      leg: at.leg,
      progress: (clock - at.leg.start) / (at.leg.end - at.leg.start),
      qty: cargoCount(o.ship.cargo, h.route.commodity),
      raid: raid?.systemId === systemId ? raid : null,
    });
  }
  return out;
}

/**
 * The player saw a hauler safely past its raid in the system they are in: guarded through the
 * ambush, or to its dock or the jump beacon. The raid does not strike (it is overridden, as the
 * world log does for the timetable's haulers). False when no raid was due there.
 */
export function captainSeen(state: GameState, shipId: string): boolean {
  const o = state.fleet.ships.find((x) => x.id === shipId);
  const h = o?.hauler;
  const raid = o ? raidAhead(state.seed, o) : null;
  if (!h || !raid || raid.systemId !== state.location.systemId) return false;
  h.sight = { run: h.runs, systemId: raid.systemId, at: state.clock };
  return true;
}

/**
 * A hauler destroyed in the player's sight, now, by raiders or the player's own guns: the fleet is
 * settled up to now first (with the ships in sight, this one among them, so its raid waits), then
 * the ship is lost with what it carries.
 */
export function captainLost(state: GameState, shipId: string, by: 'raiders' | 'player', inSight: ReadonlySet<string> = new Set()): FleetSettlement {
  const out = settleFleet(state, { inSight: new Set([...inSight, shipId]) });
  const o = state.fleet.ships.find((x) => x.id === shipId);
  const h = o?.hauler;
  if (!o || !h || h.leg === 'home') return out;
  out.steps += 1;
  wreck(state, o, h, state.clock, state.location.systemId, by, cargoCount(o.ship.cargo, h.route.commodity), out);
  return out;
}

// ---------------------------------------------------------------- what the player sees

/** Where on its way a hauler is now: the system it is crossing, or between two in a jump. */
function whereNow(state: GameState, h: Hauler): string {
  const at = legAt(h, state.clock);
  return at ? ` · now in ${systemName(at.leg.systemId)}` : ' · now in a jump';
}

/** Where a captain's ship is and what it is doing. */
export function haulerStatus(state: GameState, o: OwnedShip): string {
  const h = o.hauler;
  if (!h) return `Parked at ${place(o.locationId)}`;
  const { from, to, commodity: c } = h.route;
  const minutes = Math.max(1, Math.round((haulerNext(h) - state.clock) / 60));
  const recalled = h.recalled ? ' · recalled' : '';
  const loading = h.leg === 'out' && state.clock < h.since + FLEET.haulers.loadSeconds;
  if (loading) return `Loading ${cargoCount(o.ship.cargo, c)} ${goodName(c)} at ${place(from)} for ${place(to)}, there in ${minutes} min${recalled}`;
  const qty = cargoCount(o.ship.cargo, c);
  if (h.leg === 'out' && qty > 0) return `Carrying ${qty} ${goodName(c)} to ${place(to)}, there in ${minutes} min${whereNow(state, h)}${recalled}`;
  if (h.leg === 'out') return `Robbed on the way: flying on to ${place(to)} empty, there in ${minutes} min${whereNow(state, h)}${recalled}`;
  if (h.leg === 'back') return `Flying back to ${place(from)}, home in ${minutes} min${whereNow(state, h)}${recalled}`;
  if (h.waiting === 'credits') return `Waiting at ${place(from)}: not enough credits for a load (looks again in ${minutes} min)`;
  if (h.waiting === 'unprofitable') return `Waiting at ${place(from)} for prices to recover (looks again in ${minutes} min)`;
  return `Loading at ${place(from)}`;
}

/** The newest report about one ship, if any is still kept. */
export function lastReport(state: GameState, shipId: string): FleetReport | undefined {
  for (let i = state.fleet.reports.length - 1; i >= 0; i--) if (state.fleet.reports[i]!.shipId === shipId) return state.fleet.reports[i];
  return undefined;
}

/** Toast lines for a settle: a lost ship always, a few reports as they are, many as a summary; dividends. */
export function fleetNews(s: FleetSettlement): { text: string; tone: 'good' | 'bad' | 'info' }[] {
  const lines: { text: string; tone: 'good' | 'bad' | 'info' }[] = [];
  const tone = (r: FleetReport) => (r.kind === 'lost' || r.kind === 'raid' || r.amount < 0 ? 'bad' : r.kind === 'run' ? 'good' : 'info');
  for (const r of s.reports) if (r.kind === 'lost') lines.push({ text: r.text, tone: 'bad' });
  const rest = s.reports.filter((r) => r.kind !== 'lost');
  if (rest.length <= 2) {
    for (const r of rest) lines.push({ text: r.text, tone: tone(r) });
  } else {
    const runs = rest.filter((r) => r.kind === 'run' || r.kind === 'raid').length;
    const raids = rest.filter((r) => r.kind === 'raid').length;
    const waits = rest.filter((r) => r.kind === 'wait').length;
    const home = rest.filter((r) => r.kind === 'home').length;
    const net = rest.reduce((sum, r) => sum + r.amount, 0);
    const parts = [runs ? plural(runs, 'run') : '', raids ? plural(raids, 'raid') : '', waits ? `${waits} waiting` : '', home ? `${home} home` : ''].filter(Boolean);
    lines.push({ text: `Your haulers: ${parts.join(', ')} (${signed(net)} cr). The Fleet window on the deck has the reports.`, tone: net < 0 || raids ? 'bad' : 'good' });
  }
  if (s.dividends > 0) lines.push({ text: `Dividends from your stakes: +${s.dividends} cr.`, tone: 'good' });
  if (s.outpost > 0) lines.push({ text: `Income from your outpost${(s.outposts ?? 1) > 1 ? 's' : ''}: +${s.outpost} cr.`, tone: 'good' });
  return lines;
}

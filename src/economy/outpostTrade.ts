import { applyCredits, type CommodityId, type FormerOutpost, type GameState, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { CALLER_NAMES } from '../content/outposts/beltLines.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { outpostId, outpostSite } from '../content/outposts/sites.ts';
import { hashString, rng } from '../content/random.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { siteDock } from '../world/siteDock.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { cargoCount, removeCargo } from './cargo.ts';
import type { Result } from './equipment.ts';
import { refreshSaveStations } from './events.ts';
import { FACTIONS } from './factions.ts';
import { dockAccess } from './law.ts';
import { moveStock } from './markets.ts';
import { outpostAt, outpostsOf } from './outposts.ts';

/**
 * What a pilot does with an outpost besides building it (docs/PROCGEN.md §36; rules in OUTPOSTS):
 * a belt outpost refines the raw goods the pilot brings, so much an hour; any outpost can be sold
 * for half of what went into it, or abandoned; and haulers call at an open outpost every few hours.
 * Worked out from the game clock: nothing runs in the background.
 */

const HOUR = 3_600;
const R = OUTPOSTS.refining;
const goodName = (c: CommodityId) => COMMODITIES[c].name.toLowerCase();

// ---------------------------------------------------------------- refining (§36.3)

/** A raw good a belt outpost refines. */
export type RawGood = keyof typeof R.goods;
export const RAW_GOODS = Object.keys(R.goods) as RawGood[];
export const isRawGood = (c: CommodityId): c is RawGood => c in R.goods;

/** True for an outpost in a belt (a refinery of the pilot's own, §36.1). */
export const inBelt = (o: OutpostRecord): boolean => !!outpostSite(o.site)?.beltId;

/** The units a belt outpost takes an hour, by the stages done (none at a planet's, or before its frame is up). */
export function refineAllowance(o: OutpostRecord): number {
  return inBelt(o) && o.stage > 0 ? R.perHour[Math.min(o.stage, R.perHour.length) - 1]! : 0;
}

/** The units it has taken this hour of game clock. */
export function refinedThisHour(o: OutpostRecord, clock: number): number {
  return o.refined?.hour === Math.floor(clock / HOUR) ? o.refined.units : 0;
}

/**
 * Units it can still take in the hour of `clock`. An hour before the one it last refined in has
 * none left (a captain's step worked out late never undoes a later hour's record).
 */
export function refineRoom(o: OutpostRecord, clock: number): number {
  if ((o.refined?.hour ?? -Infinity) > Math.floor(clock / HOUR)) return 0;
  return Math.max(0, refineAllowance(o) - refinedThisHour(o, clock));
}

/** Records units refined in the hour of `clock`. */
function recordRefined(o: OutpostRecord, clock: number, units: number): void {
  o.refined = { hour: Math.floor(clock / HOUR), units: refinedThisHour(o, clock) + units };
}

/**
 * A mining captain's load handed over (docs/PROCGEN.md §37.2): the refinery takes what its hour's
 * room allows, good by good in the load's order, and its market gains the refined goods. Returns
 * what it took and what it pays (the captain's cut is the fleet's to take); the rest stays in `load`.
 */
export function takeLoad(state: GameState, o: OutpostRecord, load: Partial<Record<CommodityId, number>>, clock: number): { taken: Partial<Record<RawGood, number>>; pay: number } {
  const taken: Partial<Record<RawGood, number>> = {};
  let pay = 0;
  if (!inBelt(o) || o.stage <= 0) return { taken, pay };
  for (const c of RAW_GOODS) {
    const room = refineRoom(o, clock);
    const n = Math.min(room, load[c] ?? 0);
    if (n <= 0) continue;
    load[c] = (load[c] ?? 0) - n;
    if (!load[c]) delete load[c];
    recordRefined(o, clock, n);
    taken[c] = n;
    pay += n * refinePay(c);
    moveStock(state.markets, outpostId(o.site), R.goods[c], n / R.per, Math.max(clock, state.markets[outpostId(o.site)]?.t ?? clock));
  }
  return { taken, pay };
}

/** What one unit of a raw good fetches there. */
export const refinePay = (c: RawGood): number => Math.round(COMMODITIES[c].basePrice * R.pay);

/** When the hour's allowance starts afresh. */
export const nextRefineHour = (clock: number): number => (Math.floor(clock / HOUR) + 1) * HOUR;

/** How many of a raw good the pilot can hand over to be refined here now (docked at a belt outpost of theirs). */
export function refinable(state: GameState, c: CommodityId): number {
  const o = outpostAt(state, state.location.dockedAt);
  if (!o || !isRawGood(c)) return 0;
  return Math.max(0, Math.min(refineRoom(o, state.clock), cargoCount(state.ship.cargo, c)));
}

/** Refines raw goods from the hold: paid for now, and its market gains one refined unit for every two. */
export function refineAtOutpost(state: GameState, c: CommodityId, qty: number): Result & { paid?: number } {
  const o = outpostAt(state, state.location.dockedAt);
  if (!o || !inBelt(o)) return { ok: false, message: 'Dock at a belt outpost of yours first.' };
  if (o.stage <= 0) return { ok: false, message: `${o.name} refines once its frame is up.` };
  if (!isRawGood(c)) return { ok: false, message: `${o.name} refines metal ore, water ice and volatile gases.` };
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: 'Choose at least one unit.' };
  if (qty > refinable(state, c)) return { ok: false, message: refineRoom(o, state.clock) <= 0 ? `${o.name} has refined all it can this hour.` : 'More than it can take this hour, or than you carry.' };
  const paid = qty * refinePay(c);
  removeCargo(state.ship.cargo, c, qty);
  recordRefined(o, state.clock, qty);
  applyCredits(state, paid, 'sell', `Refining at ${o.name}`);
  const made = R.goods[c];
  moveStock(state.markets, outpostId(o.site), made, qty / R.per, state.clock);
  return { ok: true, paid, message: `${o.name} took ${qty} ${goodName(c)}: +${paid.toLocaleString('en-US')} cr, and ${qty / R.per} ${goodName(made)} for its market.` };
}

// ---------------------------------------------------------------- selling and abandoning (§36.4)

/** What went into an outpost: the charter, and every good handed over for its stages, at galaxy base prices. */
export function outpostCost(o: OutpostRecord): number {
  const worth = (needs: Partial<Record<CommodityId, number>>) => (Object.entries(needs) as [CommodityId, number][]).reduce((sum, [c, q]) => sum + q * COMMODITIES[c].basePrice, 0);
  const built = OUTPOSTS.stages.slice(0, Math.min(o.stage, OUTPOSTS.stages.length)).reduce((sum, s) => sum + worth(s.needs), 0);
  return OUTPOSTS.charter + built + worth(o.delivered);
}

/** What selling it fetches. */
export const saleValue = (o: OutpostRecord): number => Math.round(outpostCost(o) * OUTPOSTS.sale);

/** Who buys an outpost in a system: the faction that holds it, or an independent buyer. */
export function buyerOf(systemId: SystemId): string {
  const owner = WORLD.profiles.get(systemId)?.owner;
  return owner === 'sta' || owner === 'frontier' ? `the ${FACTIONS[owner].name}` : 'an independent buyer';
}

/** Why an outpost cannot be given up from here now (null: it can). */
export function giveUpBlock(state: GameState, o: OutpostRecord): string | null {
  const here = state.location.dockedAt;
  const site = outpostSite(o.site);
  if (!here || !site) return 'Dock first.';
  const id = outpostId(o.site);
  if (here !== id && (getLocation(here).systemId !== site.systemId || dockAccess(state, here) !== 'full')) return `Give it up at ${o.name}, or a station of its system where you can do business.`;
  if (Object.values(state.fleet.storage[id] ?? {}).some((q) => (q ?? 0) > 0)) return `Take what you stored at ${o.name} first.`;
  const run = state.fleet.ships.find((s) => s.hauler && s.hauler.leg !== 'home' && (s.hauler.route.to === id || s.hauler.route.from === id));
  if (run) return run.hauler!.work === 'mine' ? `Captain ${run.hauler!.captain} mines for it: recall them and let them fly home first.` : `Captain ${run.hauler!.captain} is on a run there: recall them and let the run end first.`;
  const job = Object.entries(state.contracts).find(([jobId, c]) => state.jobs[jobId]?.status === 'active' && !jobId.startsWith(`op.${o.site}.`) && JSON.stringify(c).includes(`"${id}"`));
  if (job) return `Finish or drop the job ${job[1].title} first.`;
  return null;
}

/** The open dock of the outpost's system nearest its site (where a pilot docked there goes). */
export function nearestDock(o: OutpostRecord): string {
  const site = outpostSite(o.site)!;
  const def = sceneDefFor(site.systemId);
  const at = siteDock(def, site)?.position;
  const open = ALL_LOCATIONS.filter((l) => l.systemId === site.systemId && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den' && l.services.includes('market'));
  const pos = (id: string) => def.stations.find((s) => s.locationId === id)?.position;
  const far = (id: string) => (at && pos(id) ? pos(id)!.distanceTo(at) : Infinity);
  return [...open].sort((a, b) => far(a.id) - far(b.id) || a.id.localeCompare(b.id))[0]!.id;
}

/**
 * Sells an outpost (to its system's faction, for half of what went into it) or abandons it (for
 * nothing): the site is free again; its guards, raids and storage go with it; a captain parked on a
 * route there is stood down; what the save says of its station now says the dock the pilot is at
 * (or the nearest open dock of its system), and its markets, board and history there are forgotten.
 * The journal keeps it among the outposts the pilot has had.
 */
export function giveUpOutpost(state: GameState, site: string, how: 'sold' | 'abandoned'): Result & { paid?: number; movedTo?: string } {
  const o = outpostsOf(state).find((x) => x.site === site);
  if (!o) return { ok: false, message: 'You have no outpost there.' };
  const block = giveUpBlock(state, o);
  if (block) return { ok: false, message: block };
  const id = outpostId(o.site);
  const systemId = outpostSite(o.site)!.systemId;
  const here = state.location.dockedAt!;
  const fallback = here !== id ? here : nearestDock(o);
  const paid = how === 'sold' ? saleValue(o) : 0;
  // Its raid jobs, and every other job of its board or bound for it (none active: they would block).
  for (const [jobId, c] of Object.entries(state.contracts)) {
    if (jobId.startsWith(`op.${o.site}.`) || JSON.stringify(c).includes(`"${id}"`)) {
      delete state.contracts[jobId];
      delete state.jobs[jobId];
    }
  }
  for (const jobId of Object.keys(state.jobs)) if (jobId.startsWith(`op.${o.site}.`)) delete state.jobs[jobId];
  // Captains parked on a route there are stood down at their ship's dock.
  for (const s of state.fleet.ships) if (s.hauler && (s.hauler.route.to === id || s.hauler.route.from === id)) delete s.hauler;
  delete state.fleet.storage[id];
  state.fleet.stakes = state.fleet.stakes.filter((k) => k.locationId !== id);
  state.visitedLocations = state.visitedLocations.filter((x) => x !== id);
  state.priceWatch = state.priceWatch.filter((w) => w.locationId !== id);
  delete state.knownMarkets[id];
  delete state.markets[id];
  state.world.outposts = outpostsOf(state).filter((x) => x !== o);
  // Whatever else names its station (where the pilot is docked, respawns, a rank was won, a crew member left) names the fallback dock.
  rename(state, id, fallback);
  const former: FormerOutpost = { site: o.site, name: o.name, kind: o.kind, stage: o.stage, founded: o.founded, ended: state.clock, how, paid };
  const list = (state.world.outpostsFormer ??= []);
  list.push(former);
  if (list.length > OUTPOSTS.former) list.splice(0, list.length - OUTPOSTS.former);
  if (paid) applyCredits(state, paid, 'sell', `Sale of ${o.name}`);
  refreshSaveStations();
  const moved = here === id ? ` You ride its last shuttle out to ${getLocation(fallback).name}.` : '';
  const message = how === 'sold' ? `${o.name} is sold to ${buyerOf(systemId)} for ${paid.toLocaleString('en-US')} cr.${moved}` : `You give up ${o.name}: its people pack up and the site is free.${moved}`;
  return { ok: true, message, ...(paid ? { paid } : {}), ...(here === id ? { movedTo: fallback } : {}) };
}

/** Every string in the save equal to `from` becomes `to` (record keys equal to it are dropped, as are list entries). */
function rename(node: unknown, from: string, to: string): void {
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      if (node[i] === from) node.splice(i, 1);
      else rename(node[i], from, to);
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (k === from) delete rec[k];
    else if (rec[k] === from) rec[k] = to;
    else rename(rec[k], from, to);
  }
}

// ---------------------------------------------------------------- haulers calling (§36.5)

const C = OUTPOSTS.calls;

/** When call `n` at a site comes (each site on its own beat, each call moved a little). */
export function callAt(site: string, n: number): number {
  const phase = hashString(`outpost-call|${site}`) % C.every;
  return Math.round(phase + n * C.every + (rng(WORLD_SEED, 'outpost-call', site, n).next() * 2 - 1) * C.spread);
}

/** The calls at an open outpost from `from` to `to` (game clock), in order. */
export function callsBetween(o: OutpostRecord, from: number, to: number): { n: number; at: number }[] {
  if (o.stage <= 0) return [];
  const start = Math.max(from, o.opened ?? o.founded);
  const out: { n: number; at: number }[] = [];
  // Calls keep their order (each moves less than half the gap between them).
  for (let n = Math.max(0, Math.floor((start - C.spread) / C.every) - 1); callAt(o.site, n) <= to; n++) {
    const at = callAt(o.site, n);
    if (at >= start) out.push({ n, at });
  }
  return out;
}

/** The next call at an open outpost after a moment (null while it is being built). */
export function nextCall(o: OutpostRecord, clock: number): { n: number; at: number } | null {
  if (o.stage <= 0) return null;
  return callsBetween(o, clock, clock + C.every + 2 * C.spread)[0] ?? null;
}

/** A call's hauler: an independent's ship and name, the same for every player. */
export function callHauler(site: string, n: number, models: readonly string[]): { name: string; model: string } {
  const r = rng(WORLD_SEED, 'outpost-caller', site, n);
  return { name: r.pick(CALLER_NAMES), model: r.pick(models) };
}

/** What the Outpost window says of the next call. */
export function callLine(o: OutpostRecord, clock: number): string {
  const next = nextCall(o, clock);
  if (!next) return '';
  const mins = Math.max(1, Math.round((next.at - clock) / 60));
  return `Haulers call about every ${Math.round(C.every / HOUR)} hours; the next is due in ${mins < 90 ? `${mins} min` : `about ${Math.round(mins / 60)} h`}.`;
}

import type { CommodityId, GameState } from '../app/state.ts';
import { PEOPLE } from '../content/people/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { COMMODITIES, COMMODITY_IDS } from './commodities.ts';
import { expectedTrip, routeFeeBetween } from './contracts.ts';
import { newsAt } from './events.ts';
import { cargoCapacity } from './loadout.ts';
import { knownAt, knownVia, learnPrice, liveQuote } from './trade.ts';

/**
 * The trade computer and the price watch (docs/PROCGEN.md §16). The computer ranks routes from
 * prices the player has had (seen, briefed, heard or watched), never the hidden market; the watch
 * brings a watched price along whenever the player docks within reach of it.
 */

export type RouteRisk = 'patrolled' | 'thin' | 'lawless';

export interface TradeRoute {
  commodity: CommodityId;
  from: string;
  to: string;
  buy: number;
  sell: number;
  /** Seconds since each price was had (0 for the live price where the player is docked). */
  buyAge: number;
  sellAge: number;
  /** Items for a full hold that the player can pay for. */
  items: number;
  fees: number;
  /** Net profit of one run (after jump fees on the way). */
  profit: number;
  /** Minutes of game time: getting to the buyer (when elsewhere) and the run itself. */
  minutes: number;
  perMinute: number;
  risk: RouteRisk;
  stale: boolean;
  /** News that bears on the route (a shortage at the buyer, a raid on the way). */
  notes: string[];
}

const security = (systemId: SystemId) => WORLD.profiles.get(systemId)?.security ?? 1;
const riskOf = (sec: number): RouteRisk => (sec < 0.35 ? 'lawless' : sec < 0.6 ? 'thin' : 'patrolled');

interface Known {
  locationId: string;
  price: number;
  age: number;
}

/** Known prices per good: where the player can buy it and where they can sell it. */
function knownPrices(state: GameState, here: string | null): { buys: Map<CommodityId, Known[]>; sells: Map<CommodityId, Known[]> } {
  const buys = new Map<CommodityId, Known[]>();
  const sells = new Map<CommodityId, Known[]>();
  const add = (map: Map<CommodityId, Known[]>, c: CommodityId, k: Known) => (map.get(c) ?? map.set(c, []).get(c)!).push(k);
  for (const [locationId, obs] of Object.entries(state.knownMarkets)) {
    if (locationId === here) continue;
    for (const c of COMMODITY_IDS) {
      const q = obs.prices[c];
      if (!q) continue;
      const age = Math.max(0, state.clock - knownAt(obs, c));
      if (q.buy !== null) add(buys, c, { locationId, price: q.buy, age });
      if (q.sell !== null) add(sells, c, { locationId, price: q.sell, age });
    }
  }
  if (here) {
    for (const c of COMMODITY_IDS) {
      const q = liveQuote(state, here, c);
      if (q.buy !== null) add(buys, c, { locationId: here, price: q.buy, age: 0 });
      if (q.sell !== null) add(sells, c, { locationId: here, price: q.sell, age: 0 });
    }
  }
  return { buys, sells };
}

/** What the news near the player says about a route: events at either end, raids on the way. */
function routeNotes(state: GameState, c: CommodityId, from: string, to: string): string[] {
  const at = state.location.systemId;
  const notes: string[] = [];
  const a = getLocation(from);
  const b = getLocation(to);
  for (const n of newsAt(at, state.clock)) {
    if (!n.active) continue;
    const e = n.event;
    if (e.locationId && (e.locationId === from || e.locationId === to) && e.goods.includes(c)) notes.push(e.headline);
    else if (!e.locationId && e.kind === 'raid' && (e.systemId === a.systemId || e.systemId === b.systemId)) notes.push(e.headline);
  }
  return notes;
}

/**
 * The best routes the player knows of, by profit per minute: buy at one known market, sell at
 * another. With `fromHere`, only routes that start where the player is docked.
 */
export function tradeRoutes(state: GameState, here: string | null, opts: { fromHere?: boolean; limit?: number } = {}): TradeRoute[] {
  const { buys, sells } = knownPrices(state, here);
  const hold = cargoCapacity(state.ship);
  const hereSystem = here ? getLocation(here).systemId : state.location.systemId;
  const out: TradeRoute[] = [];
  for (const c of COMMODITY_IDS) {
    const unit = COMMODITIES[c].unitSize;
    for (const b of buys.get(c) ?? []) {
      if (opts.fromHere && b.locationId !== here) continue;
      const items = Math.min(Math.floor(hold / unit), Math.floor(state.credits / Math.max(1, b.price)));
      if (items <= 0) continue;
      const from = getLocation(b.locationId);
      for (const s of sells.get(c) ?? []) {
        if (s.locationId === b.locationId || s.price <= b.price) continue;
        const to = getLocation(s.locationId);
        const fees = routeFeeBetween(from.systemId, to.systemId) + (b.locationId === here ? 0 : routeFeeBetween(hereSystem, from.systemId));
        const profit = items * (s.price - b.price) - fees;
        if (profit <= 0) continue;
        const seconds = expectedTrip(from.systemId, to.systemId) + (b.locationId === here ? 0 : expectedTrip(hereSystem, from.systemId));
        const minutes = Math.max(1, Math.round(seconds / 60));
        out.push({
          commodity: c,
          from: b.locationId,
          to: s.locationId,
          buy: b.price,
          sell: s.price,
          buyAge: b.age,
          sellAge: s.age,
          items,
          fees,
          profit,
          minutes,
          perMinute: Math.round(profit / minutes),
          risk: riskOf(Math.min(security(from.systemId), security(to.systemId))),
          stale: Math.max(b.age, s.age) > PEOPLE.computer.stale,
          notes: [],
        });
      }
    }
  }
  out.sort((x, y) => y.perMinute - x.perMinute || y.profit - x.profit);
  const top = out.slice(0, opts.limit ?? PEOPLE.computer.limit);
  for (const r of top) r.notes = routeNotes(state, r.commodity, r.from, r.to);
  return top;
}

// ---------------------------------------------------------------- the price watch

export function isWatched(state: GameState, locationId: string, commodity: CommodityId): boolean {
  return state.priceWatch.some((w) => w.locationId === locationId && w.commodity === commodity);
}

/** Starts or stops watching a price. */
export function toggleWatch(state: GameState, locationId: string, commodity: CommodityId): { ok: boolean; watching: boolean; message: string } {
  const i = state.priceWatch.findIndex((w) => w.locationId === locationId && w.commodity === commodity);
  const name = `${COMMODITIES[commodity].name} at ${getLocation(locationId).name}`;
  if (i >= 0) {
    state.priceWatch.splice(i, 1);
    return { ok: true, watching: false, message: `Stopped watching ${name}.` };
  }
  if (state.priceWatch.length >= PEOPLE.watch.max) return { ok: false, watching: false, message: `You watch ${PEOPLE.watch.max} prices already.` };
  state.priceWatch.push({ locationId, commodity });
  return { ok: true, watching: true, message: `Watching ${name}: docking within ${PEOPLE.watch.reach} jumps brings its price.` };
}

export interface WatchNote {
  locationId: string;
  commodity: CommodityId;
  text: string;
}

const moved = (before: number | null | undefined, now: number | null) =>
  before != null && now != null && before > 0 && Math.abs(now - before) / before >= PEOPLE.watch.notable;

/**
 * Docking brings the watched prices within reach up to date; a notable move is reported.
 * (The station the player docks at is recorded by the visit itself.)
 */
export function watchOnDock(state: GameState, dockedAt: string): WatchNote[] {
  const jumps = jumpsFrom(WORLD.links, getLocation(dockedAt).systemId);
  const notes: WatchNote[] = [];
  for (const w of state.priceWatch) {
    if (w.locationId === dockedAt) continue;
    const loc = getLocation(w.locationId);
    if ((jumps.get(loc.systemId) ?? 99) > PEOPLE.watch.reach) continue;
    const before = state.knownMarkets[w.locationId]?.prices[w.commodity];
    learnPrice(state, w.locationId, w.commodity, 'watch');
    const now = state.knownMarkets[w.locationId]?.prices[w.commodity];
    if (!now) continue;
    const parts: string[] = [];
    if (moved(before?.sell, now.sell)) parts.push(`buys at ${now.sell} cr (was ${before!.sell})`);
    if (moved(before?.buy, now.buy)) parts.push(`sells at ${now.buy} cr (was ${before!.buy})`);
    if (parts.length) notes.push({ locationId: w.locationId, commodity: w.commodity, text: `Price watch: ${loc.name} (${getSystem(loc.systemId).displayName}) ${parts.join(', ')} for ${COMMODITIES[w.commodity].name.toLowerCase()}.` });
  }
  return notes;
}

/** Whether a known price is from long ago. */
export function isStale(state: GameState, locationId: string, commodity: CommodityId): boolean {
  const obs = state.knownMarkets[locationId];
  return !obs || state.clock - knownAt(obs, commodity) > PEOPLE.computer.stale;
}

export { knownVia };

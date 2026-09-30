import type { CommodityId, MarketState, PriceQuote } from '../app/state.ts';
import { COMMODITIES, COMMODITY_IDS, PRICE_BAND } from '../content/economy/goods.ts';
import { buildMarkets, type MarketEntry, type StationMarket } from '../content/economy/markets.ts';
import { ECONOMY } from '../content/economy/rules.ts';
import { rng } from '../content/random.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import { marketEffect } from './events.ts';
import { standingPriceModifier } from './factions.ts';

/**
 * Live commodity prices (docs/PROCGEN.md §8). Each station's market table (what it makes, needs
 * and trades, at what equilibrium price) is built once from the rules and the world. On top of it:
 *
 * - **stock**: buying from a station lowers its stock and raises its price, selling to it does the
 *   opposite; every unit of an order is priced at the stock it leaves, so bulk orders move the
 *   price and no round trip at one dock makes money. Stock recovers toward normal over time.
 * - **drift**: every price wanders slowly (a few per cent over an hour or two of play).
 * - **standing** with the station's faction improves both prices, never below a minimum spread.
 * - **events** (economy/events.ts): a shortage, glut, boom or strike at the station changes the price
 *   and the normal stock of the goods concerned while it lasts.
 *
 * Only stock the player has moved is saved (`GameState.markets`); everything else is a pure
 * function of the game clock, so there is no background simulation to run or save.
 */

/** What quoting needs from the game: the clock and the stock the player has moved. */
export interface MarketContext {
  clock: number;
  markets: MarketState;
}

const AT_START: MarketContext = { clock: 0, markets: {} };

/** Buy and sell at one dock always differ by at least this fraction of the price. */
const MIN_SPREAD = 0.04;

let tables: Map<string, StationMarket> | null = null;

/** Market tables for every station with a market (built on first use). */
export function marketTables(): ReadonlyMap<string, StationMarket> {
  if (!tables) {
    // Open stations with a market, and the raider dens' black markets (open to pilots the Wake trusts).
    const stations = ALL_LOCATIONS.filter((l) => l.status === 'functional' && ((l.services.includes('market') && l.dockable !== false) || l.stationType === 'pirate-den')).map((l) => ({
      id: l.id,
      systemId: l.systemId,
      type: l.stationType ?? null,
      size: l.look?.size ?? 0.8,
      security: WORLD.profiles.get(l.systemId)?.security ?? 1,
    }));
    tables = buildMarkets(stations, WORLD.links, WORLD_SEED);
  }
  return tables;
}

export function hasMarket(locationId: string): boolean {
  return marketTables().has(locationId);
}

export function marketEntry(locationId: string, commodity: CommodityId): MarketEntry | undefined {
  return marketTables().get(locationId)?.entries.get(commodity);
}

export function dockFaction(locationId: string): FactionId | undefined {
  return getLocation(locationId).factionId;
}

/** Normal stock right now: the table's, moved by any event at the station. */
export function normalStock(locationId: string, entry: MarketEntry, clock: number): number {
  return entry.target * marketEffect(locationId, entry.commodity, clock).stock;
}

/** The station's own stock: what the player (or traffic) left it at, recovering toward normal. */
function ownStock(locationId: string, entry: MarketEntry, ctx: MarketContext): number {
  const target = normalStock(locationId, entry, ctx.clock);
  const saved = ctx.markets[locationId];
  const s = saved?.stock[entry.commodity];
  if (!saved || s === undefined) return target;
  const k = Math.exp(-Math.max(0, ctx.clock - saved.t) / ECONOMY.recoverySeconds);
  return target + (s - target) * k;
}

let neighbourCache: Map<string, Map<CommodityId, string[]>> | null = null;

/** Stations within reach of a dock that trade a good (where its surplus or shortfall drifts). */
export function spillNeighbours(locationId: string, commodity: CommodityId): string[] {
  neighbourCache ??= new Map();
  let byGood = neighbourCache.get(locationId);
  if (!byGood) {
    byGood = new Map();
    const from = getLocation(locationId).systemId;
    const near = new Set([from, ...(WORLD.links.get(from) ?? [])]);
    const reach = ECONOMY.spill.jumps >= 1 ? near : new Set([from]);
    const others = [...marketTables().entries()].filter(([id]) => id !== locationId && reach.has(getLocation(id).systemId));
    for (const c of COMMODITY_IDS) byGood.set(c, others.filter(([, t]) => t.entries.has(c)).map(([id]) => id));
    neighbourCache.set(locationId, byGood);
  }
  return byGood.get(commodity) ?? [];
}

/**
 * What drifts in from neighbours (docs/PROCGEN.md §17): as a neighbour recovers from what the
 * player left it at, a share of the difference travels on the lanes and arrives here, peaking a
 * recovery time after the trade and fading after. Negative when the neighbour was drained.
 */
function spillIn(locationId: string, entry: MarketEntry, ctx: MarketContext): number {
  let total = 0;
  const tau = ECONOMY.recoverySeconds;
  for (const n of spillNeighbours(locationId, entry.commodity)) {
    const saved = ctx.markets[n];
    const s = saved?.stock[entry.commodity];
    if (!saved || s === undefined) continue;
    const their = marketTables().get(n)?.entries.get(entry.commodity);
    if (!their) continue;
    const dt = Math.max(0, ctx.clock - saved.t) / tau;
    if (dt <= 0) continue;
    const left = s - normalStock(n, their, saved.t);
    total += (ECONOMY.spill.share * left * dt * Math.exp(-dt)) / spillNeighbours(n, entry.commodity).length;
  }
  return total;
}

/** Stock now: the station's own, plus what drifts in from its neighbours. */
export function stockNow(locationId: string, entry: MarketEntry, ctx: MarketContext): number {
  const own = ownStock(locationId, entry, ctx);
  const drift = spillIn(locationId, entry, ctx);
  return drift === 0 ? own : Math.max(0, own + drift);
}

function drift(entry: MarketEntry, clock: number): number {
  // Zero at the start of a game, so the opening prices are exactly the designed ones.
  return 1 + ECONOMY.drift.amplitude * (Math.sin((2 * Math.PI * clock) / entry.period + entry.phase) - Math.sin(entry.phase));
}

/** Price of one unit at a given stock (before spread and standing): scarcity against the table's normal stock, drift and events. */
function midAt(locationId: string, entry: MarketEntry, stock: number, clock: number): number {
  const [lo, hi] = ECONOMY.stockClamp;
  const scarcity = Math.min(hi, Math.max(lo, (entry.target / Math.max(1, stock)) ** ECONOMY.elasticity));
  return entry.mid * scarcity * drift(entry, clock) * marketEffect(locationId, entry.commodity, clock).price;
}

function unitQuote(locationId: string, entry: MarketEntry, stock: number, clock: number, reputation: Record<FactionId, number>, faction: FactionId | undefined): PriceQuote {
  const base = COMMODITIES[entry.commodity].basePrice;
  const lo = Math.ceil(base * PRICE_BAND[0]);
  const hi = Math.floor(base * PRICE_BAND[1]);
  const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  const mod = standingPriceModifier(faction ? (reputation[faction] ?? 0) : 0);
  const mid = midAt(locationId, entry, stock, clock);
  let buy = entry.role === 'consume' ? null : clamp(Math.round(mid * (1 + entry.spread / 2) * mod.buy), lo + 1, hi);
  let sell = clamp(Math.round(mid * (1 - entry.spread / 2) * mod.sell), lo, hi - 1);
  if (buy !== null) {
    // Good standing narrows the spread but never closes it (no same-dock arbitrage).
    sell = Math.max(lo, Math.min(sell, Math.floor(buy * (1 - MIN_SPREAD))));
    if (buy <= sell) buy = sell + 1;
  }
  return { buy, sell };
}

/** Current quote for one unit at a dock, including the player's standing with its faction. */
export function quote(locationId: string, commodity: CommodityId, reputation: Record<FactionId, number>, ctx: MarketContext = AT_START): PriceQuote {
  const entry = marketEntry(locationId, commodity);
  if (!entry) return { buy: null, sell: null };
  return unitQuote(locationId, entry, stockNow(locationId, entry, ctx), ctx.clock, reputation, dockFaction(locationId));
}

/** Designed opening quote (no standing, normal stock, start of the game), for tests and documentation. */
export function baseQuote(locationId: string, commodity: CommodityId): PriceQuote {
  return quote(locationId, commodity, { sta: 0, frontier: 0, 'hollow-wake': 0 });
}

export function allQuotes(locationId: string, reputation: Record<FactionId, number>, ctx: MarketContext = AT_START): Partial<Record<CommodityId, PriceQuote>> {
  const out: Partial<Record<CommodityId, PriceQuote>> = {};
  for (const id of COMMODITY_IDS) {
    const q = quote(locationId, id, reputation, ctx);
    if (q.buy !== null || q.sell !== null) out[id] = q;
  }
  return out;
}

/** How many units the station can sell right now (its stock). */
export function stockAvailable(locationId: string, commodity: CommodityId, ctx: MarketContext): number {
  const entry = marketEntry(locationId, commodity);
  if (!entry || entry.role === 'consume') return 0;
  return Math.max(0, Math.floor(stockNow(locationId, entry, ctx)));
}

/**
 * Total price of an order, every unit priced at the stock it leaves behind: buying drains stock
 * (each unit dearer), selling fills it (each unit cheaper). Null when the dock does not trade
 * that way.
 */
export function orderTotal(
  locationId: string,
  commodity: CommodityId,
  qty: number,
  side: 'buy' | 'sell',
  reputation: Record<FactionId, number>,
  ctx: MarketContext,
): number | null {
  const entry = marketEntry(locationId, commodity);
  if (!entry || (side === 'buy' && entry.role === 'consume')) return null;
  const faction = dockFaction(locationId);
  const start = stockNow(locationId, entry, ctx);
  let total = 0;
  for (let i = 0; i < qty; i++) {
    const q = unitQuote(locationId, entry, side === 'buy' ? start - i : start + i, ctx.clock, reputation, faction);
    total += side === 'buy' ? q.buy! : q.sell!;
  }
  return total;
}

/** Records an order in the saved market state: stock moves by `delta` (negative when the player buys). */
export function moveStock(markets: MarketState, locationId: string, commodity: CommodityId, delta: number, clock: number): void {
  const table = marketTables().get(locationId);
  const entry = table?.entries.get(commodity);
  if (!table || !entry) return;
  const ctx = { clock, markets };
  // Bring every moved stock up to now, forget what has fully recovered, then apply the order.
  // (The record keeps the station's own stock; what drifts in from neighbours is added on top.)
  const next: Partial<Record<CommodityId, number>> = {};
  for (const [id, e] of table.entries) {
    const now = ownStock(locationId, e, ctx);
    if (Math.abs(now - normalStock(locationId, e, clock)) >= 0.5) next[id] = Math.round(now * 100) / 100;
  }
  next[commodity] = Math.max(0, Math.round((ownStock(locationId, entry, ctx) + delta) * 100) / 100);
  markets[locationId] = { t: clock, stock: next };
}

/**
 * A trader docking in the player's system moves goods for real (docs/PROCGEN.md §11.2): a small
 * load of something its destination wants or trades, taken from its origin when it launched from a
 * station that makes it. Traders top short stock up and never flood a market or empty a maker.
 */
export function traderDelivery(from: string | null, to: string, shipKey: string, markets: MarketState, clock: number): { commodity: CommodityId; qty: number } | null {
  const dest = marketTables().get(to);
  if (!dest) return null;
  const origin = from ? marketTables().get(from) : undefined;
  const options = [...dest.entries.values()].filter((e) => e.role !== 'produce' && (!origin || origin.entries.get(e.commodity)?.role === 'produce'));
  if (!options.length) return null;
  const r = rng(WORLD_SEED, 'trader-cargo', to, shipKey, Math.floor(clock));
  const e = r.pick(options);
  const ctx = { clock, markets };
  const room = normalStock(to, e, clock) * 1.2 - stockNow(to, e, ctx);
  let qty = Math.min(r.int(6, 14), Math.floor(room));
  const made = origin?.entries.get(e.commodity);
  if (from && made) qty = Math.min(qty, Math.floor(stockNow(from, made, ctx) - normalStock(from, made, clock) * 0.8));
  return qty >= 1 ? { commodity: e.commodity, qty } : null;
}

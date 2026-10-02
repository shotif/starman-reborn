import { applyCredits, type CommodityId, type GameState, type MarketObservation } from '../app/state.ts';
import { getLocation } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { addCargo, cargoCount, itemsThatFit, removeCargo } from './cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from './commodities.ts';
import { cargoCapacity } from './loadout.ts';
import { allQuotes, moveStock, orderTotal, quote, stockAvailable, type MarketContext } from './markets.ts';
import { clearGlut, relieveShortage, type Answer } from './answers.ts';

export type TradeError =
  | 'invalid-quantity'
  | 'not-traded'
  | 'insufficient-credits'
  | 'insufficient-space'
  | 'insufficient-stock'
  | 'insufficient-cargo';

export type TradeResult =
  | { ok: true; qty: number; unitPrice: number; total: number; relief?: Answer | null }
  | { ok: false; error: TradeError; message: string };

function fail(error: TradeError, message: string): TradeResult {
  return { ok: false, error, message };
}

/** The live market as the player's save sees it. */
export function marketContext(state: GameState): MarketContext {
  return { clock: state.clock, markets: state.markets };
}

/** Quote for the next unit at a dock, as the player sees it now. */
export function liveQuote(state: GameState, locationId: string, commodity: CommodityId) {
  return quote(locationId, commodity, state.reputation, marketContext(state));
}

/** What an order of `qty` would cost (buy) or pay (sell) right now; null when not traded that way. */
export function orderPrice(state: GameState, locationId: string, commodity: CommodityId, qty: number, side: 'buy' | 'sell'): number | null {
  return orderTotal(locationId, commodity, qty, side, state.reputation, marketContext(state));
}

/** Largest quantity the player can buy right now: credits, hold space and the station's stock all limit it. */
export function maxBuyable(state: GameState, locationId: string, commodity: CommodityId): number {
  if (liveQuote(state, locationId, commodity).buy === null) return 0;
  const limit = Math.min(itemsThatFit(state.ship.cargo, commodity, cargoCapacity(state.ship)), stockAvailable(locationId, commodity, marketContext(state)));
  // Each unit costs a little more than the last, so search for the largest affordable order.
  let lo = 0;
  let hi = Math.max(0, limit);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((orderPrice(state, locationId, commodity, mid, 'buy') ?? Infinity) <= state.credits) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buyCommodity(state: GameState, locationId: string, commodity: CommodityId, qty: number): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return fail('invalid-quantity', 'Choose at least one item.');
  if (liveQuote(state, locationId, commodity).buy === null) return fail('not-traded', `${COMMODITIES[commodity].name} is not sold here.`);
  const capacity = cargoCapacity(state.ship);
  if (qty > itemsThatFit(state.ship.cargo, commodity, capacity)) {
    return fail('insufficient-space', 'Not enough cargo space.');
  }
  if (qty > stockAvailable(locationId, commodity, marketContext(state))) return fail('insufficient-stock', 'The station does not have that many.');
  const total = orderPrice(state, locationId, commodity, qty, 'buy')!;
  if (total > state.credits) return fail('insufficient-credits', 'Not enough credits.');
  addCargo(state.ship.cargo, commodity, qty, capacity);
  moveStock(state.markets, locationId, commodity, -qty, state.clock);
  applyCredits(state, -total, 'buy', `Bought ${qty} ${COMMODITIES[commodity].name}`);
  // Buying out of a glut helps clear it (docs/PROCGEN.md §21.6).
  const relief = clearGlut(state, locationId, commodity, qty);
  return { ok: true, qty, unitPrice: Math.round(total / qty), total, ...(relief ? { relief } : {}) };
}

export function sellCommodity(state: GameState, locationId: string, commodity: CommodityId, qty: number): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return fail('invalid-quantity', 'Choose at least one item.');
  if (liveQuote(state, locationId, commodity).sell === null) return fail('not-traded', `This dock does not buy ${COMMODITIES[commodity].name}.`);
  if (qty > cargoCount(state.ship.cargo, commodity)) return fail('insufficient-cargo', 'You do not carry that many.');
  const total = orderPrice(state, locationId, commodity, qty, 'sell')!;
  removeCargo(state.ship.cargo, commodity, qty);
  moveStock(state.markets, locationId, commodity, qty, state.clock);
  applyCredits(state, total, 'sell', `Sold ${qty} ${COMMODITIES[commodity].name}`);
  state.stats.sales += total;
  // Selling into a shortage helps end it (docs/PROCGEN.md §17).
  const relief = relieveShortage(state, locationId, commodity, qty);
  return { ok: true, qty, unitPrice: Math.round(total / qty), total, relief };
}

/** When the player last had word of a good's price at a known market (game-clock seconds). */
export function knownAt(obs: MarketObservation, commodity: CommodityId): number {
  return obs.goodsAt?.[commodity]?.t ?? obs.observedAt;
}

/** How the player came by that price. */
export function knownVia(obs: MarketObservation, commodity: CommodityId): MarketObservation['source'] {
  return obs.goodsAt?.[commodity]?.via ?? obs.source;
}

/**
 * Word of one good's price at a station (a rumour, the price watch): kept with its own time, so
 * the rest of what the player knows of that market keeps its age.
 */
export function learnPrice(state: GameState, locationId: string, commodity: CommodityId, source: 'rumour' | 'watch'): void {
  const prices = allQuotes(locationId, state.reputation, marketContext(state));
  const q = prices[commodity];
  if (!q) return;
  const obs = state.knownMarkets[locationId];
  if (!obs) {
    state.knownMarkets[locationId] = { source, observedAt: state.clock, prices: { [commodity]: q } };
    return;
  }
  obs.prices[commodity] = q;
  if (obs.observedAt !== state.clock) (obs.goodsAt ??= {})[commodity] = { t: state.clock, via: source };
}

/** Records the prices seen while docked, so the trade computer can use them later. */
export function recordMarketVisit(state: GameState, locationId: string): void {
  state.knownMarkets[locationId] = {
    source: 'visited',
    observedAt: state.clock,
    prices: allQuotes(locationId, state.reputation, marketContext(state)),
  };
}

export interface RouteOpportunity {
  commodity: CommodityId;
  buyPrice: number;
  destinationId: string;
  destinationSystemId: SystemId;
  sellPrice: number;
  source: MarketObservation['source'];
  observedAt: number;
  profitPerItem: number;
  /** Items affordable and fitting in the hold right now. */
  items: number;
  grossProfit: number;
  /** Jump fees to reach the destination system (0 in-system or when covered). */
  travelCost: number;
  netProfit: number;
}

/**
 * Expected returns for buying here and selling at markets the player knows about.
 * Only uses observed (visited) or briefed prices — never hidden economy data.
 */
export function routeOpportunities(
  state: GameState,
  hereLocationId: string,
  travelCost: (fromSystem: SystemId, toSystem: SystemId) => number,
): RouteOpportunity[] {
  const hereSystem = getLocation(hereLocationId).systemId;
  const out: RouteOpportunity[] = [];
  for (const commodity of COMMODITY_IDS) {
    const buyPrice = liveQuote(state, hereLocationId, commodity).buy;
    if (buyPrice === null) continue;
    for (const [destId, obs] of Object.entries(state.knownMarkets)) {
      if (destId === hereLocationId) continue;
      const sellPrice = obs.prices[commodity]?.sell ?? null;
      if (sellPrice === null || sellPrice <= buyPrice) continue;
      const destSystem = getLocation(destId).systemId;
      const items = maxBuyable(state, hereLocationId, commodity);
      const profitPerItem = sellPrice - buyPrice;
      const gross = profitPerItem * items;
      const cost = destSystem === hereSystem ? 0 : travelCost(hereSystem, destSystem);
      out.push({
        commodity,
        buyPrice,
        destinationId: destId,
        destinationSystemId: destSystem,
        sellPrice,
        source: knownVia(obs, commodity),
        observedAt: knownAt(obs, commodity),
        profitPerItem,
        items,
        grossProfit: gross,
        travelCost: cost,
        netProfit: gross - cost,
      });
    }
  }
  return out.sort((a, b) => b.netProfit - a.netProfit || b.profitPerItem - a.profitPerItem);
}

/** Best known place to sell each commodity currently in the hold (excluding here). */
export function bestKnownSale(
  state: GameState,
  commodity: CommodityId,
  excludeLocationId?: string,
): { locationId: string; price: number; source: MarketObservation['source'] } | null {
  let best: { locationId: string; price: number; source: MarketObservation['source'] } | null = null;
  for (const [id, obs] of Object.entries(state.knownMarkets)) {
    if (id === excludeLocationId) continue;
    const price = obs.prices[commodity]?.sell ?? null;
    if (price !== null && (!best || price > best.price)) best = { locationId: id, price, source: knownVia(obs, commodity) };
  }
  return best;
}

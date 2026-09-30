import { applyCredits, type CommodityId, type GameState } from '../app/state.ts';
import { getLocation } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { addCargo, cargoCount, itemsThatFit, removeCargo } from './cargo.ts';
import { COMMODITIES, COMMODITY_IDS } from './commodities.ts';
import { cargoCapacity } from './loadout.ts';
import { allQuotes, quote } from './markets.ts';

export type TradeError =
  | 'invalid-quantity'
  | 'not-traded'
  | 'insufficient-credits'
  | 'insufficient-space'
  | 'insufficient-cargo';

export type TradeResult =
  | { ok: true; qty: number; unitPrice: number; total: number }
  | { ok: false; error: TradeError; message: string };

function fail(error: TradeError, message: string): TradeResult {
  return { ok: false, error, message };
}

/** Largest quantity the player can buy right now (credits and hold space both limit it). */
export function maxBuyable(state: GameState, locationId: string, commodity: CommodityId): number {
  const price = quote(locationId, commodity, state.reputation).buy;
  if (price === null) return 0;
  return Math.max(0, Math.min(Math.floor(state.credits / price), itemsThatFit(state.ship.cargo, commodity, cargoCapacity(state.ship))));
}

export function buyCommodity(state: GameState, locationId: string, commodity: CommodityId, qty: number): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return fail('invalid-quantity', 'Choose at least one item.');
  const price = quote(locationId, commodity, state.reputation).buy;
  if (price === null) return fail('not-traded', `${COMMODITIES[commodity].name} is not sold here.`);
  const total = price * qty;
  if (total > state.credits) return fail('insufficient-credits', 'Not enough credits.');
  const capacity = cargoCapacity(state.ship);
  if (qty > itemsThatFit(state.ship.cargo, commodity, capacity)) {
    return fail('insufficient-space', 'Not enough cargo space.');
  }
  addCargo(state.ship.cargo, commodity, qty, capacity);
  applyCredits(state, -total, 'buy', `Bought ${qty} ${COMMODITIES[commodity].name}`);
  return { ok: true, qty, unitPrice: price, total };
}

export function sellCommodity(state: GameState, locationId: string, commodity: CommodityId, qty: number): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return fail('invalid-quantity', 'Choose at least one item.');
  const price = quote(locationId, commodity, state.reputation).sell;
  if (price === null) return fail('not-traded', `This dock does not buy ${COMMODITIES[commodity].name}.`);
  if (qty > cargoCount(state.ship.cargo, commodity)) return fail('insufficient-cargo', 'You do not carry that many.');
  removeCargo(state.ship.cargo, commodity, qty);
  const total = price * qty;
  applyCredits(state, total, 'sell', `Sold ${qty} ${COMMODITIES[commodity].name}`);
  return { ok: true, qty, unitPrice: price, total };
}

/** Records the prices seen while docked, so the trade computer can use them later. */
export function recordMarketVisit(state: GameState, locationId: string): void {
  state.knownMarkets[locationId] = {
    source: 'visited',
    observedAt: state.clock,
    prices: allQuotes(locationId, state.reputation),
  };
}

export interface RouteOpportunity {
  commodity: CommodityId;
  buyPrice: number;
  destinationId: string;
  destinationSystemId: SystemId;
  sellPrice: number;
  source: 'visited' | 'briefing';
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
    const buyPrice = quote(hereLocationId, commodity, state.reputation).buy;
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
        source: obs.source,
        observedAt: obs.observedAt,
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
): { locationId: string; price: number; source: 'visited' | 'briefing' } | null {
  let best: { locationId: string; price: number; source: 'visited' | 'briefing' } | null = null;
  for (const [id, obs] of Object.entries(state.knownMarkets)) {
    if (id === excludeLocationId) continue;
    const price = obs.prices[commodity]?.sell ?? null;
    if (price !== null && (!best || price > best.price)) best = { locationId: id, price, source: obs.source };
  }
  return best;
}

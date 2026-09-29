import type { CommodityId, PriceQuote } from '../app/state.ts';
import { getLocation } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import { COMMODITY_IDS } from './commodities.ts';
import { standingPriceModifier } from './factions.ts';

/**
 * Fixed base price tables per dock (fiction). `buy` is what the player pays, `sell` what the
 * player receives; null means the dock does not trade that direction.
 */
const BASE_PRICES: Record<string, Partial<Record<CommodityId, PriceQuote>>> = {
  'earth-port': {
    medical: { buy: 38, sell: 32 },
    fabricators: { buy: 150, sell: 128 },
    deuterium: { buy: null, sell: 98 },
  },
  'mars-depot': {
    medical: { buy: 60, sell: 54 },
    fabricators: { buy: null, sell: 176 },
    deuterium: { buy: 66, sell: 58 },
  },
  'meridian-outpost': {
    medical: { buy: null, sell: 96 },
    fabricators: { buy: null, sell: 238 },
    deuterium: { buy: null, sell: 118 },
  },
  'barnard-relay': {
    medical: { buy: null, sell: 78 },
    fabricators: { buy: null, sell: 205 },
    deuterium: { buy: null, sell: 124 },
  },
  'sirius-platform': {
    medical: { buy: null, sell: 88 },
    fabricators: { buy: 136, sell: 118 },
    deuterium: { buy: null, sell: 112 },
  },
  'eridani-hub': {
    medical: { buy: null, sell: 92 },
    fabricators: { buy: null, sell: 228 },
    deuterium: { buy: 48, sell: 40 },
  },
};

export function hasMarket(locationId: string): boolean {
  return locationId in BASE_PRICES;
}

/** Base (unmodified) quote, for tests and documentation. */
export function baseQuote(locationId: string, commodity: CommodityId): PriceQuote {
  return BASE_PRICES[locationId]?.[commodity] ?? { buy: null, sell: null };
}

export function dockFaction(locationId: string): FactionId | undefined {
  return getLocation(locationId).factionId;
}

/** Current quote at a dock including the player's standing with the dock's faction. */
export function quote(locationId: string, commodity: CommodityId, reputation: Record<FactionId, number>): PriceQuote {
  const base = baseQuote(locationId, commodity);
  const faction = dockFaction(locationId);
  const mod = standingPriceModifier(faction ? (reputation[faction] ?? 0) : 0);
  let buy = base.buy === null ? null : Math.max(1, Math.round(base.buy * mod.buy));
  const sell = base.sell === null ? null : Math.max(1, Math.round(base.sell * mod.sell));
  // Never let a dock buy back for more than it sells (no same-dock arbitrage).
  if (buy !== null && sell !== null && buy <= sell) buy = sell + 1;
  return { buy, sell };
}

export function allQuotes(
  locationId: string,
  reputation: Record<FactionId, number>,
): Partial<Record<CommodityId, PriceQuote>> {
  const out: Partial<Record<CommodityId, PriceQuote>> = {};
  for (const id of COMMODITY_IDS) {
    const q = quote(locationId, id, reputation);
    if (q.buy !== null || q.sell !== null) out[id] = q;
  }
  return out;
}

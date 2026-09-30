import { WORLD } from '../data/systems.ts';
import { buildCatalog } from './gen/catalog.ts';
import { CATALOG_SEED, RULES } from './rules/index.ts';
import type { Catalog, GearItem, ManufacturerId, ManufacturerRule, ShipClassRule, ShipModel, ShopRule, Tier } from './types.ts';

/**
 * Runtime queries over the ship and equipment catalogue. The catalogue is generated on first use
 * (a few milliseconds) and then cached; it is the same for every player.
 */

let cached: Catalog | null = null;

export function getCatalog(): Catalog {
  cached ??= buildCatalog(RULES, CATALOG_SEED);
  return cached;
}

export function findGear(id: string): GearItem | undefined {
  return getCatalog().gearById.get(id);
}

export function gearItem(id: string): GearItem {
  const item = findGear(id);
  if (!item) throw new Error(`Unknown equipment ${id}`);
  return item;
}

export function findShip(id: string): ShipModel | undefined {
  return getCatalog().shipById.get(id);
}

export function shipModel(id: string): ShipModel {
  const ship = findShip(id);
  if (!ship) throw new Error(`Unknown ship ${id}`);
  return ship;
}

export function maker(id: ManufacturerId): ManufacturerRule {
  return RULES.makers.find((m) => m.id === id)!;
}

export function shipClass(id: ShipModel['class']): ShipClassRule {
  return RULES.classes.find((c) => c.id === id)!;
}

let generatedShops: Map<string, ShopRule> | null = null;

/** The outfitter and shipyard at a station: hand-authored (rules/shops.ts) or from the world generator. */
export function shopRule(locationId: string): ShopRule | undefined {
  const authored = RULES.shops.find((s) => s.locationId === locationId);
  if (authored) return authored;
  generatedShops ??= new Map(WORLD.stations.flatMap((st) => (st.shop ? [[st.id, { locationId: st.id, ...st.shop }] as const] : [])));
  return generatedShops.get(locationId);
}

/** Equipment the outfitter at a station sells, by slot then family then class. */
export function gearForSale(locationId: string): GearItem[] {
  const shop = shopRule(locationId);
  if (!shop) return [];
  const order = RULES.families.map((f) => f.id);
  return getCatalog()
    .gear.filter((it) => shop.makers.includes(it.maker) && it.tier <= shop.maxClass)
    .sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family) || a.tier - b.tier || a.price - b.price);
}

/** Ships the shipyard at a station sells, by class then tier. */
export function shipsForSale(locationId: string): ShipModel[] {
  const shop = shopRule(locationId);
  if (!shop) return [];
  const order = RULES.classes.map((c) => c.id);
  return getCatalog()
    .ships.filter((s) => shop.makers.includes(s.maker) && shop.shipyard.includes(s.class) && s.tier <= shop.maxShipTier)
    .sort((a, b) => order.indexOf(a.class) - order.indexOf(b.class) || a.tier - b.tier || a.price - b.price);
}

/** Standing with the station's faction needed to buy equipment of this class / a ship of this tier. */
export function standingForGear(tier: Tier): number {
  return RULES.balance.standingForClass[tier];
}

export function standingForShip(tier: Tier): number {
  return RULES.balance.standingForShipTier[tier];
}

/** What a dealer pays for something it sold (ships and equipment alike). */
export function resaleValue(price: number): number {
  return Math.floor(price * RULES.balance.resale);
}

/**
 * Tradeable goods (docs/PROCGEN.md §8). All names, prices and descriptions are game fiction.
 * `basePrice` is a galaxy-wide reference; what a station pays depends on whether it makes or needs
 * the good, how far away the nearest maker is, its stock and a slow drift (economy/markets.ts).
 */

export type CommodityId =
  | 'water'
  | 'ore'
  | 'gases'
  | 'deuterium'
  | 'helium-3'
  | 'metals'
  | 'polymers'
  | 'food'
  | 'fine-food'
  | 'medical'
  | 'machinery'
  | 'electronics'
  | 'fabricators'
  | 'consumer-goods'
  | 'ship-parts'
  | 'habitat-modules'
  | 'research-samples'
  | 'data-cores'
  | 'luxuries'
  | 'weapons'
  | 'salvage';

export type CommodityCategory = 'raw' | 'fuel' | 'refined' | 'food' | 'manufactured' | 'science' | 'luxury' | 'restricted' | 'salvage';

export interface Commodity {
  id: CommodityId;
  name: string;
  category: CommodityCategory;
  /** Cargo-hold units occupied by one item. */
  unitSize: number;
  basePrice: number;
  description: string;
}

const goods: Commodity[] = [
  { id: 'water', name: 'Water ice', category: 'raw', unitSize: 3, basePrice: 16, description: 'Mined ice blocks: drinking water, oxygen and reaction mass for every habitat.' },
  { id: 'ore', name: 'Metal ore', category: 'raw', unitSize: 3, basePrice: 22, description: 'Crushed iron, nickel and titanium ore, straight from the diggings.' },
  { id: 'gases', name: 'Volatile gases', category: 'raw', unitSize: 2, basePrice: 28, description: 'Compressed nitrogen, ammonia and methane for air, fertiliser and chemistry.' },
  { id: 'deuterium', name: 'Deuterium fuel', category: 'fuel', unitSize: 3, basePrice: 90, description: 'Heavy-hydrogen fusion fuel in armoured canisters. Bulky but always in demand.' },
  { id: 'helium-3', name: 'Helium-3', category: 'fuel', unitSize: 2, basePrice: 150, description: 'Clean fusion fuel for research reactors and fabrication plants.' },
  { id: 'metals', name: 'Refined metals', category: 'refined', unitSize: 2, basePrice: 58, description: 'Steel, aluminium and titanium stock, cast and rolled for industry.' },
  { id: 'polymers', name: 'Polymers', category: 'refined', unitSize: 1, basePrice: 46, description: 'Resins and plastics feedstock for printers, seals and greenhouse film.' },
  { id: 'food', name: 'Staple food', category: 'food', unitSize: 2, basePrice: 32, description: 'Grain, protein and ration packs that keep stations fed.' },
  { id: 'fine-food', name: 'Fine food', category: 'food', unitSize: 1, basePrice: 96, description: 'Fresh fruit, real coffee and cheese: a taste of home far from any garden.' },
  { id: 'medical', name: 'Medical supplies', category: 'manufactured', unitSize: 1, basePrice: 60, description: 'Sterile kits, antivirals and clinic consumables. Light, valuable to remote outposts.' },
  { id: 'machinery', name: 'Machinery', category: 'manufactured', unitSize: 3, basePrice: 165, description: 'Pumps, drills and drive units for mines, refineries and farms.' },
  { id: 'electronics', name: 'Electronics', category: 'manufactured', unitSize: 1, basePrice: 128, description: 'Processors, sensors and control boards in shock-proof cases.' },
  { id: 'fabricators', name: 'Fabricator parts', category: 'manufactured', unitSize: 2, basePrice: 180, description: 'Printer heads and precision actuators that keep outpost workshops running.' },
  { id: 'consumer-goods', name: 'Consumer goods', category: 'manufactured', unitSize: 1, basePrice: 72, description: 'Clothes, tools, games and the hundred small things people buy.' },
  { id: 'ship-parts', name: 'Ship components', category: 'manufactured', unitSize: 2, basePrice: 215, description: 'Hull plates, drive coils and avionics for yards and patrol hangars.' },
  { id: 'habitat-modules', name: 'Habitat modules', category: 'manufactured', unitSize: 4, basePrice: 250, description: 'Flat-packed living quarters and airlocks for growing outposts.' },
  { id: 'research-samples', name: 'Research samples', category: 'science', unitSize: 1, basePrice: 150, description: 'Sealed cores, cultures and instrument logs bound for core-world labs.' },
  { id: 'data-cores', name: 'Survey data cores', category: 'science', unitSize: 1, basePrice: 185, description: 'Navigation and survey data, encrypted for the buyer.' },
  { id: 'luxuries', name: 'Luxury goods', category: 'luxury', unitSize: 1, basePrice: 270, description: 'Jewellery, art prints, fine textiles and vintage spirits.' },
  { id: 'weapons', name: 'Small arms', category: 'restricted', unitSize: 1, basePrice: 230, description: 'Sidearms and ammunition. Traded at military bases and, quietly, at free ports.' },
  { id: 'salvage', name: 'Salvage', category: 'salvage', unitSize: 2, basePrice: 42, description: 'Scrap plate, stripped wiring and parts recovered from wrecks.' },
];

export const COMMODITIES = Object.fromEntries(goods.map((g) => [g.id, g])) as Record<CommodityId, Commodity>;

/** Display order: raw materials first, then refined, food, manufactured, science and luxuries. */
export const COMMODITY_IDS: readonly CommodityId[] = goods.map((g) => g.id);

/** Price bands: whatever stock, drift or standing do, prices stay within these multiples of base. */
export const PRICE_BAND = [0.4, 2.2] as const;

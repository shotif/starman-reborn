import type { CommodityId } from '../app/state.ts';

/** Tradeable goods. All names, prices and descriptions are game fiction. */
export interface Commodity {
  id: CommodityId;
  name: string;
  /** Cargo-hold units occupied by one item. */
  unitSize: number;
  basePrice: number;
  description: string;
}

export const COMMODITIES: Record<CommodityId, Commodity> = {
  medical: {
    id: 'medical',
    name: 'Medical supplies',
    unitSize: 1,
    basePrice: 60,
    description: 'Sterile kits, antivirals and clinic consumables. Light, valuable to remote outposts.',
  },
  fabricators: {
    id: 'fabricators',
    name: 'Fabricator parts',
    unitSize: 2,
    basePrice: 180,
    description: 'Printer heads and precision actuators that keep outpost workshops running.',
  },
  deuterium: {
    id: 'deuterium',
    name: 'Deuterium fuel',
    unitSize: 3,
    basePrice: 90,
    description: 'Heavy-hydrogen fusion fuel in armoured canisters. Bulky but always in demand.',
  },
};

export const COMMODITY_IDS: readonly CommodityId[] = ['medical', 'fabricators', 'deuterium'];

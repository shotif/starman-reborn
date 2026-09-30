import type { Catalog, ContentRules } from '../types.ts';
import { generateGear } from './gear.ts';
import { generateShips } from './ships.ts';

/** Builds the whole ship and equipment catalogue: a pure function of the rules and the seed. */
export function buildCatalog(rules: ContentRules, seed: number): Catalog {
  const gear = generateGear(rules);
  const ships = generateShips(rules, gear, seed);
  return {
    seed,
    ships,
    gear,
    shipById: new Map(ships.map((s) => [s.id, s])),
    gearById: new Map(gear.map((g) => [g.id, g])),
  };
}

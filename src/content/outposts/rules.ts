import type { CommodityId } from '../economy/goods.ts';
import type { LocationService } from '../../data/types.ts';
import type { StationType } from '../world/types.ts';

/**
 * A station of your own (docs/PROCGEN.md §22): the player charters a site in orbit of a confirmed
 * planet, builds an outpost there by bringing the materials, stage by stage, and it pays an income
 * by the hour. The outpost, its name and its people are fiction; the planet is real. Worked out
 * from the game clock like the fleet (src/economy/outposts.ts): nothing runs in the background.
 */
export const OUTPOSTS = {
  /** Outposts a save can found. */
  max: 1,
  /** The charter for a site, paid at a station in its system (credits). */
  charter: 8_000,
  /**
   * What an outpost can be, as the world's own stations of that kind (§7.3): each only where the
   * system's security is within that kind's band, and a mine only round a small planet.
   */
  kinds: ['mining-outpost', 'refinery', 'factory', 'agri-station', 'research-station', 'relay', 'trade-port', 'freeport'] as const satisfies readonly StationType[],
  /** Where the outpost orbits its planet: distance from the surface and height (schematic units). */
  orbit: { distance: [1_600, 2_800] as const, height: [-450, 450] as const },
  /** While its frame goes up, the site looks like a shipyard's frames, small and new. */
  building: { look: 'shipyard' as StationType, size: 0.18 },
  /** A new outpost is clean; its look wears no further. */
  wear: 0.08,
  /**
   * The stages, in order: what the next one needs delivered (units), and what the outpost is once
   * it is done: its size (market stock, structure, crowd), its services and its income (credits an
   * hour of game time). The first stage opens it.
   */
  stages: [
    {
      id: 'frame',
      name: 'Frame',
      needs: { 'habitat-modules': 8, metals: 20, machinery: 6 } as Partial<Record<CommodityId, number>>,
      size: 0.3,
      services: ['market', 'repair'] as LocationService[],
      income: 300,
    },
    {
      id: 'station',
      name: 'Station',
      needs: { 'habitat-modules': 12, polymers: 30, electronics: 15, fabricators: 8 } as Partial<Record<CommodityId, number>>,
      size: 0.55,
      services: ['market', 'repair', 'contracts'] as LocationService[],
      income: 800,
    },
    {
      id: 'port',
      name: 'Port',
      needs: { 'habitat-modules': 16, 'ship-parts': 15, machinery: 15, electronics: 20 } as Partial<Record<CommodityId, number>>,
      size: 0.8,
      services: ['market', 'repair', 'contracts', 'equipment'] as LocationService[],
      income: 1_600,
    },
  ],
  /**
   * The port's outfitter sells consumables (repair kits, rounds, decoys), no maker's equipment, up
   * to this class.
   */
  shop: { maxClass: 2 as const },
  /** Income hours paid one by one at a settle; older hours are paid at the plain rate in one sum. */
  maxHoursPerSettle: 720,
  /** Name words for an outpost (fiction): three are offered with the noun of its kind. */
  nameWords: [
    'Lodestone', 'Hearthlight', 'Emberlight', 'Brightwater', 'Kindling', 'Firstlight', 'Tidewell', 'Harbourage', 'Cornerstone', 'Homefire',
    'Starward', 'Longreach', 'Fairhaven', 'Lanternlight', 'Seedfall', 'Keystone', 'Copperleaf', 'Wellspring', 'Northlight', 'Openhand',
  ] as readonly string[],
} as const;

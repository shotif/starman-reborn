import type { CommodityId } from '../economy/goods.ts';
import type { StationEventKind } from '../events/rules.ts';
import type { LocationService } from '../../data/types.ts';
import type { StationType } from '../world/types.ts';

/**
 * A station of your own (docs/PROCGEN.md §22): the player charters a site in orbit of a confirmed
 * planet, builds an outpost there by bringing the materials, stage by stage, and it pays an income
 * by the hour. The outpost, its name and its people are fiction; the planet is real. Worked out
 * from the game clock like the fleet (src/economy/outposts.ts): nothing runs in the background.
 */
export const OUTPOSTS = {
  /** Outposts a save can run at once (docs/PROCGEN.md §36.2), at most one in a system. */
  max: 3,
  /** The charter for a site, paid at a station in its system (credits). */
  charter: 8_000,
  /**
   * What an outpost can be, as the world's own stations of that kind (§7.3): each only where the
   * system's security is within that kind's band, and a mine only round a small planet.
   */
  kinds: ['mining-outpost', 'refinery', 'factory', 'agri-station', 'research-station', 'relay', 'trade-port', 'freeport'] as const satisfies readonly StationType[],
  /**
   * Outposts in the belts (docs/PROCGEN.md §36): always a refinery; where round its ring a site lies
   * when the angle drawn from its id would put it too near a station or body (degrees); how far it
   * keeps from them (and from lanes).
   */
  belts: {
    kinds: ['refinery'] as const satisfies readonly StationType[],
    angle: {} as Partial<Record<string, number>>,
    clear: { station: 3_000, body: 3_000, lane: 1_500 },
  },
  /**
   * A belt outpost refines what the pilot brings (§36.3): each raw good and what it is refined into;
   * the pay for a unit, as so many times the raw good's base price (the top of the price band, so
   * above what any market can pay for it raw); the units it takes in an hour of game clock by the
   * stages done (frame, station, port); and one refined unit for every `per` raw.
   */
  refining: {
    goods: { ore: 'metals', water: 'deuterium', gases: 'polymers' } as const satisfies Partial<Record<CommodityId, CommodityId>>,
    pay: 2.2,
    perHour: [40, 60, 80] as const,
    per: 2,
  },
  /** Outposts sold or abandoned that the journal keeps (§36.4), and the share of what went in that a sale fetches. */
  former: 6,
  sale: 0.5,
  /**
   * Outposts join the trade (docs/PROCGEN.md §38): the chance an open outpost sends a hauler out in
   * a time slot (HAULS.slotSeconds), and draws one in, by the stages done (frame, station, port);
   * the dock fee, a share of each hauler's cargo at galaxy base prices, paid with the hour's income;
   * how many hours back a settle counts the fees; and the work boards within `jumps` post to an
   * outpost: one a board in a time slot with `chance`, a `passage` share of them passages (the rest freight).
   */
  trade: {
    send: [0.04, 0.08, 0.12] as const,
    draw: [0.04, 0.08, 0.12] as const,
    fee: 0.03,
    feeHours: 72,
    board: { jumps: 2, chance: 0.35, passage: 0.4 },
  },
  /**
   * Outposts have news (docs/PROCGEN.md §39): while one of the world's events is under way at an
   * outpost, the hour's income is multiplied by its kind's factor; away for long, at most
   * `maxReports` of an outpost's events starting or ending are told in a settle (the latest).
   */
  news: {
    income: { shortage: 0.85, glut: 0.95, boom: 1.2, strike: 0.7, harvest: 1.1, survey: 1.1 } satisfies Record<StationEventKind, number>,
    maxReports: 3,
  },
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

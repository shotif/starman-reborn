import type { FactionId } from '../../data/types.ts';

/**
 * The station look descriptor the interior generator reads. These mirror `StationType`,
 * `STATION_TYPES`, `StationOwner` and `StationLook` in src/content/world/types.ts (the world
 * generator's contract) and are structurally identical, so a `StationLook` from there can be passed
 * straight to `generateInteriorStyle`. Once that module is on this branch, this file can simply
 * re-export its types.
 */

/** Kinds of station; each has its own interior character. */
export type StationType =
  | 'trade-port'
  | 'customs-depot'
  | 'shipyard'
  | 'mining-outpost'
  | 'refinery'
  | 'factory'
  | 'agri-station'
  | 'research-station'
  | 'relay'
  | 'military-base'
  | 'freeport'
  | 'pirate-den';

export const STATION_TYPES: readonly StationType[] = [
  'trade-port',
  'customs-depot',
  'shipyard',
  'mining-outpost',
  'refinery',
  'factory',
  'agri-station',
  'research-station',
  'relay',
  'military-base',
  'freeport',
  'pirate-den',
];

/** Who runs a station: a faction, or nobody in particular. */
export type StationOwner = FactionId | 'independent';

export const STATION_OWNERS: readonly StationOwner[] = ['sta', 'frontier', 'hollow-wake', 'independent'];

/** Everything the interior generator needs to build one station's rooms. */
export interface StationLook {
  type: StationType;
  /** Palette family and signage: Transit Authority white and blue, Frontier sand and teal, Hollow Wake soot and red, independents mixed neon. */
  owner: StationOwner;
  /** Stable per station; seeds every small variation. */
  seed: number;
  /** Colour of the local star (light through the bay and windows), sRGB hex. */
  starColor: string;
  /** 0 = small outpost … 1 = large port (how big and busy the place feels). */
  size: number;
  /** 0 = pristine … 1 = run-down (grime, clutter, dim and flickering lights). */
  wear: number;
}

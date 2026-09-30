import type { FactionId } from '../../../data/types.ts';

/**
 * The look descriptor generated station exteriors are built from. It mirrors `StationLook` of the
 * world content types (src/content/world/types.ts) field for field, so the world generator's
 * value can be passed straight in; once both live on one branch this file can simply re-export
 * those types.
 */

/** Kinds of station. Each has its own silhouette. */
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

export interface StationLook {
  type: StationType;
  /** Palette family: Transit Authority white and blue, Frontier sand and teal, Hollow Wake soot and red, independents mixed neon. */
  owner: StationOwner;
  /** Stable per station; seeds every small variation. */
  seed: number;
  /** Colour of the local star, sRGB hex; tints floodlights and bay glow a little. */
  starColor: string;
  /** 0 = small … 1 = large (scales the structure and how much of it there is). */
  size: number;
  /** 0 = pristine … 1 = run-down (grime, dents, missing panels, flickering or dark lights). */
  wear: number;
}

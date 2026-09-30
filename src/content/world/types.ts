import type { FactionId } from '../../data/types.ts';

/**
 * Types for the generated world (docs/PROCGEN.md §4.5): stations and the look the art generators
 * build them from. Stations are fiction attached to real, catalogued bodies.
 */

/** Kinds of station. Each has its own services, trade profile, exterior and interior. */
export type StationType =
  /** Large civilian port: market, outfitter, shipyard, busy concourse bar. */
  | 'trade-port'
  /** Customs and refit checkpoint: clearance, repairs, outfitter. */
  | 'customs-depot'
  /** Ship construction yard: hulls in scaffolds, cranes; sells ships. */
  | 'shipyard'
  /** Rugged habitat on a rock or moon: ore and ice out, supplies in. */
  | 'mining-outpost'
  /** Towers, tanks and radiators: ore and ice in, metals and fuel out. */
  | 'refinery'
  /** Modular fabrication blocks: metals in, machinery and electronics out. */
  | 'factory'
  /** Greenhouse rings and domes: food and water out. */
  | 'agri-station'
  /** Domes, dishes and sensor booms: science, samples and data. */
  | 'research-station'
  /** Small fuel and message relay on a route. */
  | 'relay'
  /** Armoured patrol base: hangars, turrets, faction colours. */
  | 'military-base'
  /** Independent free port of patched modules and neon: few questions asked. */
  | 'freeport'
  /** Raider hideout in rocks or wreckage: dark, red lights, jury-rigged. Hostile to lawful pilots. */
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

/** Everything the exterior and interior art generators need to build one station. */
export interface StationLook {
  type: StationType;
  /** Owner: sets the palette family and signage (Transit Authority white and blue, Frontier sand and teal, Hollow Wake soot and red, independents mixed neon). */
  owner: StationOwner;
  /** Stable per station; seeds every small variation. */
  seed: number;
  /** Colour of the local star (light through bays and windows), sRGB hex. */
  starColor: string;
  /** 0 = small outpost … 1 = large port (scales structure, traffic and crowd). */
  size: number;
  /** 0 = pristine … 1 = run-down (grime, clutter, flickering lights). */
  wear: number;
}

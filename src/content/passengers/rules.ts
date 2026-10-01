/**
 * Passengers and sightseers (docs/PROCGEN.md §23): fares between stations, and tours to the real
 * sky's sights, carried in passenger cabins (a utility fitting, src/content/rules/gearFamilies.ts).
 * The passengers, their names and their words are fiction; every sight is a body or belt the
 * archives list, and every number a sightseer says is printed from the catalogue (src/data/).
 */
export const PASSENGERS = {
  /** A passage: how many travel together, how far, and the fare (base, per jump, per passenger). */
  passage: { party: [1, 3] as const, maxJumps: 3, reward: { base: 140, perJump: 120, perPassenger: 90 } },
  /** A tour: how many sightseers, how far the sight may be, and the fare (by the sight's interest). */
  tour: { party: [1, 4] as const, maxJumps: 2, reward: { base: 220, perJump: 150, perPassenger: 110 } },
  /**
   * Passengers hate a fight: the fare falls by `perHull` for each share of the hull the ship loses
   * with them aboard (shields do not count), never below `floor` of it. Losing the ship loses them.
   */
  fright: { perHull: 1.5, floor: 0.4 },
  /**
   * How close sightseers must come for a good look (scene units): within this of a planet's or a
   * dwarf star's surface, or inside a belt's band (and this far above or below it at most).
   */
  sightRange: 9_000,
  /** What a sight is worth to sightseers (multiplies the varying part of a tour's fare). */
  interest: { planet: 1, giant: 1.15, 'white-dwarf': 1.4, 'brown-dwarf': 1.3, belt: 1.2 } as Record<SightKind, number>,
} as const;

export type SightKind = 'planet' | 'giant' | 'white-dwarf' | 'brown-dwarf' | 'belt';

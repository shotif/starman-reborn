/**
 * The large moons of the giant planets (docs/PROCGEN.md §48): how the game draws JPL's moons, and
 * what it says of them. The moons are JPL's (src/data/generated/moons.json); every number said comes
 * from them and the game's date.
 */
export const MOONS = {
  /**
   * In flight (§48.3): out from its planet's drawn centre by the planet's drawn radius × its real
   * distance in the planet's radii to the power `spread` (the planet's own), so the farther stay
   * farther but none flies off across the scene: Jupiter's system kept inside the gap between it and
   * the main belt's outpost site, Saturn's Titan outside the rings.
   */
  spread: { jupiter: 0.26, saturn: 0.32 },
  /** Kept at least this far clear of its planet's rings and of the next moon out (scene units, beyond both sizes). */
  clear: 100,
} as const;

/**
 * What is said of a moon: `{moon}` its name, `{planet}` its planet's, `{period}` how long it takes to
 * go round in days, `{distance}` its mean distance in km (to the thousand), `{radii}` in its planet's radii.
 */
export const MOON_LINES = {
  /** The science card's heading line. */
  headline: '{moon} goes round {planet} once every {period} days.',
  /** The target's subtitle in flight. */
  target: 'Moon of {planet} · real direction; schematic size and distance',
  scene: 'In flight it stands in its real direction from {planet} on the game’s date; its distance is compressed and its size drawn on the planets’ scale.',
  /** Where it is, on the game's date: on the side of its planet towards the Sun, away from it, or to one side. */
  sunward: 'On the side of {planet} facing the Sun',
  away: 'Beyond {planet}, away from the Sun',
  aside: 'To one side of {planet}, as seen from the Sun',
  distance: '{distance} km from {planet}’s centre ({radii} of its radii)',
} as const;

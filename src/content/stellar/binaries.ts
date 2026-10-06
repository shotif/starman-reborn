/**
 * Binary orbits (docs/PROCGEN.md §44): what the game does with the catalogued orbits of its pairs,
 * and what it says of them. The orbits are the catalogue's (src/data/generated/orbits.json); every
 * number said comes from them and the game's date.
 */
export const BINARIES = {
  /**
   * Measuring a pair (§44.5): research stations within `reach` jumps of a pair with a catalogued
   * orbit post, from a random stream of their own, a measurement in a time slot with these odds:
   * scan the secondary in its system within `window` of the posting, then back with the reading.
   */
  measure: { odds: 0.35, reach: 2, reward: 600, perJump: 300, window: 86_400 },
} as const;

/** The catalogue's grades, in words (its format notes). */
export const GRADE_WORD: Record<number, string> = { 1: 'definitive', 2: 'good', 3: 'reliable', 4: 'preliminary' };

/**
 * What is said of a pair: `{secondary}` and `{primary}` are its stars, `{system}` its system,
 * `{period}` its period in years, `{giver}` the station posting work.
 */
export const BINARY_LINES = {
  /** The science card's and the star map's heading line. */
  orbit: '{secondary} orbits {primary} once every {period} years.',
  /** In flight, the scene keeps the pair as it stood when the orbits were taken. */
  scene: 'In flight the pair stands as it did on {epoch}, its separation compressed.',
  measure: {
    title: 'Measure {secondary}',
    briefing:
      'Double stars are measured again and again over the years: the angle and distance of the fainter star from the brighter, set against the orbit to test it. {giver} wants a fresh measurement of {secondary} from {primary}, which orbits once every {period} years: scan {secondary} in {system} and bring the reading back.',
    objective: 'Scan {secondary} in {system}',
  },
} as const;

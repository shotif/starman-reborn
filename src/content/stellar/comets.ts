/**
 * Comets in Sol (docs/PROCGEN.md §45): what the game does with JPL's comets, and what it says of
 * them. The comets are JPL's (src/data/generated/comets.json); every number said comes from them
 * and the game's date.
 */
export const COMETS = {
  /** In flight (§45.3): the nucleus's drawn radius, base + perRootKm × √(diameter in km), larger than life. */
  nucleus: { base: 240, perRootKm: 45, unknownKm: 4 },
  /** Never drawn nearer the Sun than this (scene units): the Sun is drawn 4,000 across. */
  nearest: 9_000,
  /**
   * Activity (AU from the Sun): within `from`, where water ice starts to turn to gas, a coma and tails
   * grow, in full by `full`. At full, the coma is `coma` × the nucleus's radius and the tails `tail` long
   * (scene units); the dust tail bends back along its path by `dustBend`.
   */
  activity: { from: 4, full: 1, coma: 9, tail: 24_000, dustBend: 0.35 },
  /** What a comet in flight keeps clear of (scene units, beyond the thing's own size). */
  clear: { arrival: 10_000, station: 8_000, planet: 6_000, lane: 6_000 },
  /** How near a ship must come to read it (scene units). */
  scanRange: 9_000,
  /** The News (§45.4): a comet within `days` of perihelion, at Sol's stations and research stations within `reach` jumps. */
  news: { days: 60, reach: 2 },
  /** What it takes to see one from Earth: the faintest magnitude each shows. */
  sight: { nakedEye: 6, binoculars: 10, smallTelescope: 15 },
  /** Imaging a comet (§45.5): research stations within `reach` jumps of Sol, with these odds a time slot. */
  image: { odds: 0.35, reach: 2, reward: 700, perJump: 300, window: 86_400 },
} as const;

/** What it takes to see a comet, in words. */
export const COMET_SIGHT = {
  nakedEye: 'the naked eye',
  binoculars: 'binoculars',
  smallTelescope: 'a small telescope',
  largeTelescope: 'a large telescope',
} as const;

/**
 * What is said of a comet: `{comet}` is its name, `{class}` its orbit class, `{period}` its period in
 * years, `{date}` a perihelion's date, `{q}` its perihelion distance (AU), `{magnitude}` how bright it
 * looks from Earth, `{sight}` what it takes to see it, `{giver}` the station posting work.
 */
export const COMET_LINES = {
  /** The science card's heading line. */
  headline: '{comet} comes round once every {period} years.',
  /** In flight. */
  scene: 'In flight it is drawn far larger than life, where it stands on the game’s date.',
  /** The reckoning, far from the snapshot. */
  unsure: 'Reckoned as if only the Sun pulled on it: so far from when its elements were taken, it may be some way off.',
  /** Too far out for the brightness law. */
  faint: 'Far from the Sun and quiet: too faint for all but the largest telescopes.',
  bright: 'About magnitude {magnitude} from Earth: {sight} will show it.',
  /** The target's subtitle in flight. */
  target: '{class} · real object; drawn larger than life',
  news: {
    coming: '{comet} nears the Sun',
    passed: '{comet} has passed the Sun',
    comingDetail: '{comet} passes closest to the Sun on {date}, {q} AU from it.',
    passedDetail: '{comet} passed closest to the Sun on {date}, {q} AU from it, and is heading back out.',
  },
  image: {
    title: 'Image {comet}',
    briefing:
      'Comets are imaged again and again, to follow how they wake as they near the Sun and fade as they leave it. {giver} wants fresh images of {comet}, which comes round once every {period} years: scan it in Sol and bring the images back.',
    objective: 'Scan {comet} in Sol',
  },
} as const;

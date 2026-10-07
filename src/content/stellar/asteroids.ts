/**
 * Named asteroids in Sol (docs/PROCGEN.md §47): what the game does with JPL's asteroids, and what it
 * says of them. The asteroids are JPL's (src/data/generated/asteroids.json); every number said comes
 * from them and the game's date.
 */
export const ASTEROIDS = {
  /**
   * In flight (§47.3): the drawn radius, base + perRootKm × √(diameter in km), far larger than life
   * but never as large as the Moon is drawn; its shape in proportion to its measured extent, no axis
   * thinner than `flattest` of the longest.
   */
  size: { base: 240, perRootKm: 6, unknownKm: 1, flattest: 0.45 },
  /** Spun this many times faster than life, so a turn can be seen; their periods keep their order. */
  spinFaster: 240,
  /** What an asteroid in flight keeps clear of (scene units, beyond the thing's own size). */
  clear: { arrival: 3_000, station: 1_500, planet: 600, lane: 1_000 },
  /** How near a ship must come to read it (scene units). */
  scanRange: 6_000,
  /** The News (§47.4): a pass of Earth within `days`, at Sol's stations and research stations within `reach` jumps. */
  news: { days: 60, reach: 2 },
  /**
   * Tracking a near-Earth asteroid (§47.5): research stations within `reach` jumps of Sol, with these
   * odds a time slot; within `passDays` of a pass of Earth, the one passing.
   */
  track: { odds: 0.3, reach: 2, reward: 600, perJump: 300, window: 86_400, passDays: 60 },
  /** Potentially hazardous, as the Center for Near-Earth Object Studies defines it: an orbit within `moidAu` of Earth's, and absolute magnitude `h` or brighter. */
  hazard: { moidAu: 0.05, h: 22 },
} as const;

/** Orbit classes, in words (JPL's codes; the near-Earth ones as the Center for Near-Earth Object Studies defines them). */
export const ASTEROID_CLASSES = {
  MBA: 'Main-belt asteroid',
  AMO: 'Amor asteroid: near Earth, never crossing its orbit',
  APO: 'Apollo asteroid: near Earth, crossing its orbit from outside',
  ATE: 'Aten asteroid: near Earth, crossing its orbit from inside',
  IEO: 'Atira asteroid: wholly inside Earth’s orbit',
} as const;

/** Spectral types, by their first letter, in words: what the light it reflects says it is made of. */
export const ASTEROID_TYPES = {
  C: 'dark and carbon-rich',
  B: 'dark and carbon-rich',
  G: 'dark and carbon-rich',
  F: 'dark and carbon-rich',
  S: 'stony',
  Q: 'stony',
  V: 'basaltic, like Vesta’s crust',
  M: 'thought to be metal-rich',
  X: 'metal-rich or dark: its colour alone cannot say',
} as const;

/**
 * What is said of an asteroid: `{asteroid}` is its name, `{class}` its orbit class, `{period}` its
 * year in years, `{date}` a pass's date, `{distance}` how near it passes (in km, or in AU), `{speed}`
 * how fast (km/s), `{magnitude}` how bright it looks from Earth, `{sight}` what it takes to see it,
 * `{giver}` the station posting work, `{moid}` how near an orbit comes to Earth's to be hazardous (AU).
 */
export const ASTEROID_LINES = {
  /** The science card's heading line. */
  headline: '{asteroid} goes round the Sun once every {period} years.',
  /** In flight. */
  scene: 'In flight it is drawn far larger than life, where it stands on the game’s date, and spun faster.',
  /** Near Earth, in flight. */
  near: 'Passing Earth: drawn from Earth in its real direction, nearer the nearer it really is.',
  /** The reckoning, far from the snapshot. */
  unsure: 'Reckoned as if only the Sun pulled on it: so far from when its elements were taken, it may be some way off.',
  hazardous: 'Classed potentially hazardous: its orbit comes within {moid} AU of Earth’s, and it is large enough to matter. That marks it to be watched, not that it will hit.',
  bright: 'About magnitude {magnitude} from Earth: {sight} will show it.',
  faint: 'About magnitude {magnitude} from Earth: too faint for all but the largest telescopes.',
  /** After a pass that changed its orbit. */
  changed: 'Its pass of Earth on {date} changed its orbit: it is now an {class}.',
  /** Before such a pass. */
  willChange: 'Its pass of Earth on {date} will change its orbit: from then on it will be an {class}.',
  /** The target's subtitle in flight. */
  target: '{class} · real object; drawn larger than life',
  pass: '{date}: {distance} from Earth’s centre, at {speed} km/s',
  news: {
    coming: '{asteroid} passes Earth',
    passed: '{asteroid} has passed Earth',
    comingDetail: '{asteroid} passes {distance} from Earth’s centre on {date}, at {speed} km/s.',
    passedDetail: '{asteroid} passed {distance} from Earth’s centre on {date}, at {speed} km/s.',
  },
  track: {
    title: 'Track {asteroid}',
    briefing:
      'Near-Earth asteroids are tracked again and again: each new measurement of where one is sharpens its orbit, and with it every pass of Earth to come. {giver} wants fresh positions of {asteroid}: scan it in Sol and bring them back.',
    passBriefing:
      'Every telescope that can is on {asteroid}, which passes Earth on {date}: each measurement as it nears sharpens its orbit, and how the pass will bend it. {giver} wants fresh positions of it: scan it in Sol and bring them back.',
    objective: 'Scan {asteroid} in Sol',
  },
} as const;

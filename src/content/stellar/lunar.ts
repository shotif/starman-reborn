/**
 * Earth's Moon (docs/PROCGEN.md §51): how the game draws the Moon where it really is, and what it says
 * of it and of the eclipses NASA lists. The Moon is JPL Horizons' and the eclipses NASA's
 * (src/data/generated/lunar.json); every number said comes from them and the game's date.
 */
export const LUNAR = {
  /**
   * In flight (§51.3): the Moon stands in its real direction from Earth's centre on the game's date,
   * `distance` scene units out at its mean distance from Earth (NASA's 384,400 km) and nearer or
   * farther as it really is, drawn the size it always was.
   */
  drawn: { distance: 4_250 },
  /** What it keeps clear of (scene units, beyond both sizes): the arrival point and beacon, stations and sites, planets, the lane and the practice range. */
  clear: { arrival: 3_000, station: 1_500, planet: 600, lane: 1_000, practice: 1_500 },
  /** While it would crowd any of them it is moved out along its direction, by `stretch` at a time, at most `stretches` times; then turned along its orbit a degree at a time, at most `turnDeg` either way. */
  stretch: 1.05,
  stretches: 8,
  turnDeg: 90,
  /** A phase is called by its own name (new, first quarter, full, last quarter) within this many degrees of it: about half a day either side. */
  namedWithinDeg: 6,
  /** The News at Sol's stations tells of an eclipse coming within this many days. */
  newsDays: 90,
  /** The Moon's science card lists the eclipses within this many days of the game's date; the encyclopedia every one to come. */
  cardDays: 731,
} as const;

/** NASA's shorthand in its eclipse tables (Fred Espenak's key to them), said in full. */
export const ECLIPSE_PLACES = {
  /** A side of a place: `w Africa`, `w & s Asia`. */
  sides: { n: 'northern', s: 'southern', e: 'eastern', w: 'western', c: 'central', ne: 'north-eastern', nw: 'north-western', se: 'south-eastern', sw: 'south-western', 'n.': 'northern', 's.': 'southern' },
  /** Short names, whole or in part (the longest first). */
  names: {
    'E. Indies': 'East Indies',
    'Mid East': 'Middle East',
    'N.Z.': 'New Zealand',
    'N. Z.': 'New Zealand',
    'N.A.': 'North America',
    'Indian Oc.': 'Indian Ocean',
    'Dom.Rep.': 'Dominican Republic',
    'SE Asia': 'South-East Asia',
    // NASA's table spells it so.
    Scandanavia: 'Scandinavia',
    "Cote d'Ivoire": 'Côte d’Ivoire',
    US: 'United States',
    'N.': 'North',
    'S.': 'South',
    'C.': 'Central',
  },
  /** Places said with "the". */
  withThe: ['Americas', 'Pacific', 'Atlantic', 'Arctic', 'Middle East', 'United States', 'East Indies', 'Dominican Republic', 'Indian Ocean'],
} as const;

/**
 * What is said of the Moon: `{phase}` its phase, `{lit}` the percentage lit, `{distance}` km from
 * Earth's centre, `{date}` a date; and of an eclipse: `{date}`, `{regions}` where it is seen, `{path}`
 * the countries on a central eclipse's path, `{duration}` the longest central phase, `{partial}` and
 * `{total}` a lunar eclipse's partial phases and totality.
 */
export const LUNAR_LINES = {
  /** The science card's heading line. */
  headline: 'The Moon is {phase}, {lit}% lit.',
  phases: {
    new: 'new',
    'waxing crescent': 'a waxing crescent',
    'first quarter': 'at first quarter',
    'waxing gibbous': 'a waxing gibbous',
    full: 'full',
    'waning gibbous': 'a waning gibbous',
    'last quarter': 'at last quarter',
    'waning crescent': 'a waning crescent',
  },
  distance: '{distance} km from Earth’s centre',
  /** The target's subtitle in flight. */
  target: 'Earth’s natural satellite · real direction and phase; schematic size and distance',
  scene: 'In flight it stands in its real direction from Earth on the game’s date, lit by the Sun as it really is; its distance is compressed and its size drawn larger than life.',
  turned: 'The Moon is drawn turned along its orbit, clear of Earth Port and the lane to Mars; its card gives its true phase.',
  eclipse: {
    solar: {
      Total: 'A total eclipse of the Sun on {date}: seen whole along a path across {path}, for up to {duration}, and in part across {regions}.',
      Annular: 'An annular eclipse of the Sun on {date}: a ring of the Sun round the Moon along a path across {path}, for up to {duration}, and in part across {regions}.',
      Hybrid: 'A hybrid eclipse of the Sun on {date}, total in places and annular in others: along a path across {path}, for up to {duration}, and in part across {regions}.',
      Partial: 'A partial eclipse of the Sun on {date}, seen across {regions}.',
    },
    lunar: {
      Total: 'A total eclipse of the Moon on {date}, seen from {regions}: Earth’s shadow covers it whole for {total}.',
      Partial: 'A partial eclipse of the Moon on {date}, seen from {regions}: Earth’s shadow covers part of it for {partial}.',
      Penumbral: 'A penumbral eclipse of the Moon on {date}, seen from {regions}: it only dims a little, in Earth’s outer shadow.',
    },
  },
  /** Above the eclipses listed on the card (those within `LUNAR.cardDays`) and in the encyclopedia (every one to come). */
  comingHeading: 'Eclipses in the next two years, as NASA lists them:',
  allHeading: 'Eclipses to come, as NASA lists them:',
  nextEclipse: 'Next eclipse: ',
  /** When an eclipse in the News comes. */
  when: { today: 'today', tomorrow: 'tomorrow', days: 'in {n} days' },
} as const;

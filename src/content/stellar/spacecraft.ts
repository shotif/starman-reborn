/**
 * Spacecraft out in Sol (docs/PROCGEN.md §49): how the game draws JPL Horizons' spacecraft and what it
 * says of them. Where each craft is comes from Horizons (src/data/generated/spacecraft.json). Every
 * fact of a mission (craftStories.ts, fetched with Sol's sky: §50) is quoted from Horizons' record of
 * the craft or NASA's NSSDCA page on it, as the sky snapshot saved them; the guardrails check each
 * quotation is there word for word, that its date is in it, and that every figure a line gives is in
 * its quotation.
 */
export const SPACECRAFT = {
  /** Drawn this large (scene units), far larger than life, so a craft can be found and seen. */
  size: 70,
  /** Kept at least this far clear of the arrival point, stations and sites, planets and the lane (scene units, beyond both sizes). */
  clear: { arrival: 3_000, station: 1_500, planet: 600, lane: 1_000 },
  /** Scanned from this far (scene units). */
  scanRange: 6_000,
  /** A pass of Earth within `days` (on the game's date) is news at Sol's stations and research stations within `reach` jumps. */
  news: { days: 60, reach: 2 },
  /** How each is drawn: a schematic of its kind, not its true shape. */
  look: {
    'voyager-1': 'dish',
    'voyager-2': 'dish',
    'pioneer-10': 'dish',
    'pioneer-11': 'dish',
    'new-horizons': 'dish',
    'parker-solar-probe': 'shield',
    'james-webb-space-telescope': 'sunshield',
    lucy: 'discs',
    psyche: 'wings',
    'europa-clipper': 'wings',
    juice: 'wings',
  } as Record<string, CraftLook>,
} as const;

/** The schematic shapes a craft is drawn as: a dish on a body with booms, a heat shield, a telescope on its sunshield, round arrays, or long arrays. */
export type CraftLook = 'dish' | 'shield' | 'sunshield' | 'discs' | 'wings';

/**
 * What is said of a craft: `{craft}` its name, `{distance}` from the Sun, `{light}` how long light
 * takes from it to Earth, `{period}` how long its present path takes round the Sun, `{date}` and
 * `{near}` a pass of Earth (when, and how near its centre).
 */
export const CRAFT_LINES = {
  headline: '{craft} is {distance} from the Sun.',
  light: 'Light from {craft} takes {light} to reach Earth',
  leaving: 'Open: the Sun cannot hold it, and it is leaving the Solar System',
  bound: 'Round the Sun once every {period}, on its present path',
  pass: '{date}, {near} from Earth’s centre',
  target: 'Spacecraft · real direction; schematic size and distance',
  scene: 'In flight it stands in its real direction from the Sun on the game’s date (from Earth while near it); its distance is compressed and it is drawn far larger than life, as a schematic of its kind.',
  away: 'JPL Horizons has no place for it on this date.',
  planned: 'Planned, as JPL and NASA had it on {date}',
  /** The News: a pass of Earth to come, or just gone. */
  news: '{craft} passes Earth on {date}, {near} from its centre',
  newsPassed: '{craft} passed Earth on {date}, {near} from its centre',
} as const;

/** Where a fact is quoted from: Horizons' record of the craft, or NSSDCA's page on it. */
export type CraftSource = 'horizons' | 'nssdca';

/**
 * A fact of a mission: what the game says, the words it is quoted from and where, and for a dated
 * one its date (`YYYY-MM-DD`, or `YYYY-MM` where the source gives only the month).
 */
export interface CraftFact {
  on?: string;
  line: string;
  source: CraftSource;
  quote: string;
}

export interface CraftStory {
  /** Who flies it. */
  agency: CraftFact;
  /** What it is for. */
  summary: CraftFact;
  launched: CraftFact;
  /** What it has done and is planned to do, in order. */
  events: CraftFact[];
  /** Other facts of it, undated. */
  notes: CraftFact[];
}

/** The facts of each craft's mission: none until Sol's sky arrives (data/sky.ts, §50), then those in craftStories.ts. */
export let CRAFT_STORIES: Record<string, CraftStory> = {};

/** Puts the missions' facts in place when Sol's sky arrives. */
export function installCraftStories(stories: Record<string, CraftStory>): void {
  CRAFT_STORIES = stories;
}

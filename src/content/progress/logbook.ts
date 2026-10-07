/**
 * The pilot's logbook (docs/PROCGEN.md §46): what it keeps, the milestones drawn from it, and how
 * each entry is said. The words are filled in when an entry is shown, so they follow the game's names.
 */

export const LOG_KINDS = ['signed', 'begun', 'visit', 'ship', 'story', 'rank', 'milestone', 'race', 'outpost', 'towed', 'comet', 'planet', 'asteroid'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const LOGBOOK = {
  /** Entries kept; past that the oldest go, but never the first. */
  keep: 400,
  /** Entries the journal shows. */
  latest: 5,
  /**
   * The milestones drawn from it (§46.3): a single hop this long (ly), a real star this far from Sol
   * (ly), so many comets scanned, so many ships flown.
   */
  milestones: { jumpLy: 9, farLy: 25, comets: 5, ships: 5 },
} as const;

/**
 * How an entry is said: `{place}` where it happened, `{system}`, `{ship}`, `{arc}`, `{rank}`,
 * `{faction}`, `{milestone}`, `{course}`, `{station}`, `{comet}`, `{planet}`, `{asteroid}` what it is about, and
 * `{count}` (the systems visited before the logbook began).
 */
export const LOG_LINES = {
  signed: 'Signed on at {place}.',
  begun: 'The logbook begins, {count} systems already visited.',
  visit: 'First arrival in {system}.',
  ship: { traded: 'Took the {ship}, trading in the old ship.', kept: 'Bought the {ship}, and kept the old ship.' },
  story: 'Finished {arc}.',
  rank: 'Promoted to {rank} with {faction}.',
  milestone: 'Milestone: {milestone}.',
  race: { won: 'Won a race on {course}.', record: 'Set the course record on {course}.' },
  outpost: 'Chartered {station}.',
  towed: 'Ship lost in {system}; towed to {place}.',
  comet: 'First scan of {comet}.',
  planet: 'Discovered {planet}.',
  asteroid: 'First scan of {asteroid}.',
} as const;

/** The logbook's filters (§46.4): a label and the kinds each shows. */
export const LOG_FILTERS: readonly { id: string; label: string; kinds: readonly LogKind[] }[] = [
  { id: 'places', label: 'Places', kinds: ['signed', 'begun', 'visit', 'towed'] },
  { id: 'ships', label: 'Ships', kinds: ['ship'] },
  { id: 'stories', label: 'Stories and ranks', kinds: ['story', 'rank', 'outpost'] },
  { id: 'milestones', label: 'Milestones', kinds: ['milestone'] },
  { id: 'sky', label: 'The sky', kinds: ['comet', 'planet', 'asteroid'] },
  { id: 'races', label: 'Races', kinds: ['race'] },
];

/** The bests' headings. */
export const LOG_BESTS = {
  credits: 'Most credits held',
  jump: 'Longest jump',
  pay: 'Biggest pay',
  far: 'Farthest from Sol',
  systems: 'Systems visited',
  ships: 'Ships flown',
  comets: 'Comets scanned',
  asteroids: 'Asteroids scanned',
} as const;

import type { StationType } from '../world/types.ts';

/**
 * People and information (docs/PROCGEN.md §16): who sits in a station's bar, what a drink buys,
 * the price watch and the trade computer. The rules decide every fact; phrase pools
 * (lines.ts) only vary the wording.
 */

export type PersonRole = 'trader' | 'pilot' | 'fixer' | 'officer' | 'miner' | 'scientist' | 'colonist';

/** What a rumour is about. Every kind is drawn from the game's own state, never invented. */
export type RumourKind = 'price' | 'event' | 'den' | 'ace' | 'wreck' | 'story' | 'front';

export const PEOPLE = {
  /** Regulars in a bar by station type (besides the pilots for hire): who is likely to sit there. */
  regulars: {
    'trade-port': ['trader', 'trader', 'fixer', 'colonist'],
    'customs-depot': ['officer', 'trader', 'fixer'],
    shipyard: ['pilot', 'trader', 'miner'],
    'mining-outpost': ['miner', 'miner', 'trader'],
    refinery: ['miner', 'trader', 'colonist'],
    factory: ['trader', 'colonist', 'miner'],
    'agri-station': ['colonist', 'colonist', 'trader'],
    'research-station': ['scientist', 'scientist', 'trader'],
    relay: ['pilot', 'trader', 'officer'],
    'military-base': ['officer', 'officer', 'pilot'],
    freeport: ['fixer', 'trader', 'pilot', 'fixer'],
    'pirate-den': ['fixer', 'pilot', 'fixer'],
  } satisfies Record<StationType, PersonRole[]> as Record<StationType, PersonRole[]>,
  /** The hand-made stations, by the station type they are closest to. */
  curated: {
    'earth-port': 'trade-port',
    'mars-depot': 'customs-depot',
    'luna-freeport': 'freeport',
    'ganymede-yards': 'shipyard',
    'meridian-outpost': 'research-station',
    'toliman-survey': 'research-station',
    'barnard-relay': 'relay',
    'sirius-platform': 'research-station',
    'eridani-hub': 'trade-port',
  } as Record<string, StationType>,
  /** How many regulars sit in a bar at once (pilots for hire come on top). */
  count: [2, 3] as const,
  /** A regular keeps their seat this many job-board time slots. */
  shift: 2,
  /** What they talk about first, by role (the first kind with something true to tell wins). */
  talk: {
    trader: ['price', 'event', 'wreck'],
    pilot: ['den', 'ace', 'event', 'front'],
    fixer: ['ace', 'story', 'wreck', 'price'],
    officer: ['front', 'den', 'event', 'ace'],
    miner: ['event', 'price', 'wreck'],
    scientist: ['event', 'story', 'price'],
    colonist: ['event', 'price', 'story'],
  } satisfies Record<PersonRole, RumourKind[]> as Record<PersonRole, RumourKind[]>,
  /** A round for the table (credits). */
  drink: 30,
  rumour: {
    /** How far a rumour reaches (jumps from the bar). */
    reach: 2,
    /** Event tips look this far ahead on the game clock (s): news before it is news. */
    soon: 2_700,
    /** A price tip is only worth telling when a full hold on it pays at least this many drinks. */
    minTipDrinks: 4,
    /** Word of a border front (docs/PROCGEN.md §20) says where its tide takes it this far ahead (s). */
    frontAhead: 14_400,
  },
  /** Rumours kept in the journal. */
  keep: 12,
  watch: {
    /** Watched prices at once. */
    max: 6,
    /** Docking within this many jumps of a watched station brings its price. */
    reach: 2,
    /** A move this large (fraction) is worth a message. */
    notable: 0.05,
  },
  computer: {
    /** Prices older than this (game-clock seconds) are marked as old. */
    stale: 3_600,
    /** Routes shown. */
    limit: 8,
  },
} as const;

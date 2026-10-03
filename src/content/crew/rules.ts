import type { CommodityId } from '../economy/goods.ts';
import type { ShipClassId } from '../types.ts';
import type { StationType } from '../world/types.ts';

/**
 * Your crew (docs/PROCGEN.md §30): up to three people aboard the ship the player flies, an
 * engineer, a gunner and a navigator, hired at a bar's tables and paid by the hour of game clock.
 * Each makes a measured difference in flight, by their grade and their morale; morale follows what
 * the pilot does, as each one's heart sees it; each has one story of three beats. Fiction. Every
 * time is in game seconds, every wage and price in credits, every bonus a fraction.
 */

export type CrewRole = 'engineer' | 'gunner' | 'navigator';
export type CrewHeart = 'soft-hearted' | 'rule-bender' | 'ex-patrol';
/** What the pilot does that a heart cares about. */
export type CrewDeed = 'rescue' | 'adrift' | 'smuggle' | 'caught' | 'crime' | 'raider' | 'payoff';
export type CrewGrade = 1 | 2 | 3;
export type MoraleBand = 'low' | 'steady' | 'high';
/** What a favour asks: a letter carried, a sealed crate run, a raider pack broken. */
export type FavourKind = 'letter' | 'crate' | 'pack';

export const CREW_ROLES: readonly CrewRole[] = ['engineer', 'gunner', 'navigator'];
export const CREW_HEARTS: readonly CrewHeart[] = ['soft-hearted', 'rule-bender', 'ex-patrol'];
export const CREW_DEEDS: readonly CrewDeed[] = ['rescue', 'adrift', 'smuggle', 'caught', 'crime', 'raider', 'payoff'];

export const CREW = {
  /** At most one of each role aboard. */
  max: 3,
  /** Crew quarters aboard by ship class, never shared with passengers: fighters one, freighters and gunships three. */
  quarters: { 'light-fighter': 1, 'heavy-fighter': 1, courier: 2, surveyor: 2, gunship: 3, freighter: 3 } satisfies Record<ShipClassId, number> as Record<ShipClassId, number>,
  /** Wages a game hour, by grade; signing on costs this many hours' wages. */
  wage: { 1: 30, 2: 45, 3: 65 } as Record<CrewGrade, number>,
  signOnHours: 2,
  /**
   * Hands looking for a berth, at bars that give full service: the roles each station type offers
   * (`any`: one of any role), drawn per bar shift. Grades by their odds; the three hearts alike. A
   * raider den offers its one gunner, a rule-bender, only to a pilot the Wake trusts.
   */
  offers: {
    where: {
      shipyard: ['engineer', 'engineer'],
      'military-base': ['gunner', 'gunner'],
      relay: ['navigator'],
      'research-station': ['navigator'],
      'trade-port': ['any'],
      freeport: ['any'],
      'customs-depot': ['gunner'],
      'mining-outpost': ['engineer'],
      'pirate-den': ['gunner'],
    } as Partial<Record<StationType, readonly (CrewRole | 'any')[]>>,
    grade: [0.5, 0.35, 0.15] as const,
    denHeart: 'rule-bender' as CrewHeart,
  },
  /**
   * What each role does at each grade (green, seasoned, veteran), before morale. An engineer mends
   * each damaged system by `mend` points a minute while no hostile is within `quiet` metres, down to
   * `floor` (the rest needs a kit or a dock), and the shield recharges faster; a gunner's guns hit
   * harder and seekers lock on sooner; a navigator's jumps cost less and scans reach further.
   */
  effects: {
    engineer: { mend: [3, 5, 7] as const, floor: 20, quiet: 3_500, shieldRegen: [0.06, 0.09, 0.12] as const },
    gunner: { damage: [0.05, 0.08, 0.12] as const, lock: [0.2, 0.3, 0.4] as const },
    navigator: { fee: [0.08, 0.12, 0.16] as const, scan: [0.1, 0.15, 0.2] as const },
  },
  /** Morale, 0–100: Low under `low`, High from `high`; it scales every bonus by `factor`. */
  morale: {
    start: 55,
    low: 35,
    high: 75,
    factor: { low: 0.5, steady: 1, high: 1.25 } as Record<MoraleBand, number>,
    /** Each deed their heart likes or hates since the last dock, at most `cap` either way a dock. */
    liked: 6,
    hated: -8,
    cap: 15,
    /** A dock at least `after` seconds of clock since the last: rest, up to `upTo`. */
    rest: { after: 600, gain: 3, upTo: 65 },
    /** A round for the crew in the bar: a head, once a bar shift. */
    round: { price: 30, gain: 5 },
    treated: 5,
    hurt: -10,
    /** Each dock passed hurt and untreated. */
    untreated: -5,
    shipLost: -20,
    unpaid: -30,
    story: { told: 10, done: 20, failed: -20, lapsed: -10 },
  },
  /**
   * Hurt in a fight: a hull hit that damages a system may hurt whoever works it (the gunner the
   * guns, the engineer the engines or shield generator); one hit of `navigatorHit` of the hull or
   * more may hurt the navigator; the ship lost hurts everyone aboard. A hurt crew member's skill
   * does nothing until they mend, after `mend` seconds of clock or at once with a medic.
   */
  hurt: {
    odds: { gunner: 0.5, engineer: 0.35, navigator: 0.25 } as Record<CrewRole, number>,
    navigatorHit: 0.1,
    mend: 7_200,
    treat: 150,
  },
  /** What each heart likes and hates. */
  hearts: {
    'soft-hearted': { likes: ['rescue'], hates: ['adrift', 'crime'] },
    'rule-bender': { likes: ['smuggle'], hates: ['caught', 'crime'] },
    'ex-patrol': { likes: ['raider'], hates: ['payoff', 'smuggle'] },
  } as Record<CrewHeart, { likes: readonly CrewDeed[]; hates: readonly CrewDeed[] }>,
  /** Jobs done as deeds, by contract kind: a stranded hauler rescued, contraband run. */
  jobDeeds: { rescue: 'rescue', smuggle: 'smuggle' } as Record<string, CrewDeed>,
  /** Lane encounters (docs/PROCGEN.md §27) as deeds: the kind and the choice (or `lapsed`). */
  laneDeeds: {
    'mayday.pass': 'adrift',
    'mayday.lapsed': 'adrift',
    'lifepod.call': 'rescue',
    'lifepod.leave': 'adrift',
    'lifepod.lapsed': 'adrift',
    'scientist.berth': 'rescue',
    'scientist.tow': 'rescue',
    'toll.pay': 'payoff',
    'customs.bribe': 'payoff',
    'customs.declare': 'caught',
    'customs.dump': 'caught',
  } as Record<string, CrewDeed>,
  /**
   * Sites marked in flight (docs/PROCGEN.md §31) as deeds: a lifepod's survivor tractored in, and a ship
   * in distress or a lifepod left to lapse. A ship in distress reached pays through its job (a rescue).
   */
  siteDeeds: { 'lifepod.taken': 'rescue', 'ship.lapsed': 'adrift', 'lifepod.lapsed': 'adrift' } as Record<string, CrewDeed>,
  /**
   * Each crew member's story: their tale, told at the first dock after `tale` deeds their heart likes
   * with them aboard (`raiders` raiders for the ex-patrol); a favour asked at a dock at least
   * `favourAfter` on, with a place for it within `reach` jumps; open to take for `take` and to do in
   * `do`; done, a grade (a veteran keeps the pay and the cheer).
   */
  stories: {
    tale: 2,
    raiders: 3,
    favourAfter: 3_600,
    take: 10_800,
    do: 10_800,
    favours: {
      /** Their letter to the nearest farm or relay, which keep lists of the lanes' lost; the friend found, standing with its owner. */
      'soft-hearted': { kind: 'letter', to: ['agri-station', 'relay'], reach: 3, pay: 350, standing: 5 },
      /** A sealed crate run to the nearest free port: a scan will find it. */
      'rule-bender': { kind: 'crate', to: ['freeport'], reach: 3, pay: 600, cargo: { commodity: 'spoofers', qty: 2 } },
      /** The Wake pack their old wing never caught, lurking by a station of the nearest lawless system (asked where they are, paid by the job). */
      'ex-patrol': { kind: 'pack', to: [], reach: 2, pay: 650, count: 3, level: 2, lawless: 0.35 },
    } as Record<CrewHeart, { kind: FavourKind; to: readonly StationType[]; reach: number; pay: number; standing?: number; cargo?: { commodity: CommodityId; qty: number }; count?: number; level?: 1 | 2 | 3; lawless?: number }>,
  },
  /** Crew who left, kept for the journal. */
  former: 6,
} as const;

export type CrewRules = typeof CREW;

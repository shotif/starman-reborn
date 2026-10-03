import type { FactionId } from '../../data/types.ts';
import type { ContractKind } from '../contracts/rules.ts';
import type { RatingKind } from '../progress/rules.ts';

/**
 * Ranks that open doors (docs/PROCGEN.md §32): three ranks with each lawful faction and three with
 * the Hollow Wake, each earned by standing with the faction and a record in either of two ratings it
 * values (the owner's choice, 3 October 2026), promoted at the pilot's next dock of theirs. A rank
 * falls a step when standing drops `keepMargin` below what earned it (the owner's choice), and the
 * ladders are independent of one another (the owner's choice). The ranks' names are invented.
 */

export type RankLevel = 0 | 1 | 2 | 3;

export interface Ladder {
  /** Each rank's name, lowest first. */
  names: readonly [string, string, string];
  /** The standing each rank needs. */
  standing: readonly [number, number, number];
  /** The two ratings whose better record counts. */
  record: readonly [RatingKind, RatingKind];
}

export const RANKS = {
  ladders: {
    sta: { names: ['Bonded Carrier', 'Lane Officer', 'Lightkeeper'], standing: [15, 40, 70], record: ['trade', 'combat'] },
    frontier: { names: ['Field Hand', 'Shareholder', 'Elder'], standing: [15, 40, 70], record: ['exploration', 'trade'] },
    'hollow-wake': { names: ['Cold Hand', 'Pack Leader', 'Long Shadow'], standing: [20, 45, 75], record: ['combat', 'trade'] },
  } as Record<FactionId, Ladder>,
  /**
   * The better of the two ratings must reach this rank of its ladder (an index into RATINGS: 1 is
   * Blooded, Dealer or Drifter; 3 Hardened, Broker or Pathfinder; 4 Veteran, Magnate or Surveyor).
   */
  record: [1, 3, 4] as readonly [number, number, number],
  /** A rank holds while standing stays no more than this below what earned it. */
  keepMargin: 10,
  perks: {
    /** Off ships and equipment at the faction's own yards, by rank (the Wake: its own salvage gear and hulls, at free ports and dens). */
    yard: [0.04, 0.08, 0.12] as readonly [number, number, number],
    /** From this lawful rank, the faction's docks clear the pilot in with raiders near. */
    coverFrom: 2,
    /** From this Wake rank, raids on the pilot's outpost come this much less often. */
    outpost: { from: 2, odds: 0.5 },
    /** At this rank with any faction, one more contract in progress at once. */
    extraActive: { from: 3, slots: 1 },
  },
  /** Commissions: one on each of a faction's own boards, for its ranks only, better paid. */
  work: {
    kinds: {
      sta: ['escort', 'bounty', 'parcel', 'freight'],
      frontier: ['survey', 'supply', 'escort', 'recovery'],
      'hollow-wake': ['smuggle', 'piracy', 'parcel'],
    } as Record<FactionId, readonly ContractKind[]>,
    /** Times the pay such a contract would have, and standing on top of its own. */
    pay: 1.25,
    standing: 2,
    /** The rank a commission needs, by its difficulty (1, 2, 3). */
    rankFor: [1, 1, 2] as readonly [number, number, number],
  },
  /** A promotion is told in the News at stations this many jumps away or nearer, for this long. */
  news: { seconds: 7_200, jumps: 2 },
} as const;

export type RankRules = typeof RANKS;

import type { StationType } from '../world/types.ts';
import type { SiteKind } from './rules.ts';

/**
 * The short mysteries a wreck's or derelict's log may lead into (docs/PROCGEN.md §31.6). Each runs
 * from the site whose log began it, to a find one to three jumps on, to an ending at a station near
 * the find. Every place is worked out from the starting site; each is begun once a save, one at a
 * time. Fiction, every word of it.
 */

export type MysteryId = 'tender' | 'strongbox' | 'silence';
export const MYSTERY_IDS: readonly MysteryId[] = ['tender', 'strongbox', 'silence'];

export interface MysteryEnd {
  types: readonly StationType[];
  /** Within this many jumps of the find. */
  jumps: number;
  pay: number;
  /** Standing with the station's owner; or with the Hollow Wake (a fence). */
  standing?: number;
  wake?: number;
  /** The contract kind the ending pays as (the crew's hearts weigh it: docs/PROCGEN.md §30.4). */
  contract: 'rescue' | 'recovery' | 'smuggle';
}

export interface MysteryRule {
  /** The kinds of site whose log may lead into it. */
  from: readonly SiteKind[];
  /** The find: what kind of site, how many jumps on, what to take from it. */
  find: { kind: 'pod' | 'wreck' | 'derelict'; jumps: readonly [number, number]; item?: 'recorder' | 'strongbox'; below?: number; guard?: boolean };
  end: MysteryEnd;
  /** The strongbox's other ending (the owner's choice: the one mystery that ends in a choice). */
  fence?: MysteryEnd;
}

export const MYSTERIES: Record<MysteryId, MysteryRule> = {
  /** A research tender's crew took to their lifeboat: find its recorder, then find them. */
  tender: {
    from: ['wreck', 'derelict'],
    find: { kind: 'pod', item: 'recorder', jumps: [1, 2] },
    end: { types: ['research-station', 'relay'], jumps: 2, pay: 900, standing: 4, contract: 'rescue' },
  },
  /** A hauler robbed of its strongbox: take it back from the raiders who hold it, then choose. */
  strongbox: {
    from: ['wreck'],
    find: { kind: 'wreck', item: 'strongbox', jumps: [1, 2], below: 0.5, guard: true },
    end: { types: ['customs-depot', 'trade-port'], jumps: 3, pay: 1_200, standing: 5, contract: 'recovery' },
    fence: { types: ['freeport'], jumps: 3, pay: 1_800, wake: 6, contract: 'smuggle' },
  },
  /** An old survey hull's sister ship, and its data vault. */
  silence: {
    from: ['derelict'],
    find: { kind: 'derelict', jumps: [2, 3] },
    end: { types: ['research-station'], jumps: 3, pay: 1_500, standing: 5, contract: 'recovery' },
  },
};

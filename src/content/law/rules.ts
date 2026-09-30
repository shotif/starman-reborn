import type { CommodityId } from '../economy/goods.ts';

/**
 * Law rules (docs/PROCGEN.md §12): what the lawful factions (the Transit Authority and the
 * Frontier Cooperative) fine and how much standing it costs, where they scan cargo, when their
 * patrols turn on a pilot, and how a pilot gets back into their good books. The Hollow Wake has
 * no law, only memory.
 */

export const LAW = {
  /** Goods banned in claimed space (owned by a lawful faction). */
  contraband: ['stims', 'spoofers'] as readonly CommodityId[],
  crimes: {
    /** Opening fire on a lawful ship (once per ship). */
    attack: { fine: 500, standing: -8 },
    /** Destroying a lawful ship; the Hollow Wake approves. */
    destroy: { fine: 1_000, standing: -15, wake: 4 },
    /** Leaving a patrol's cargo scan before it finishes. */
    evade: { fine: 400, standing: -5 },
    /** Contraband found: it is confiscated and fined at this multiple of its base value. */
    contraband: { fineFactor: 2, standing: -3 },
  },
  scans: {
    /** Patrols scan in claimed space at or above this security. */
    security: 0.5,
    /** A patrol starts a scan within this range, and it takes this long; leave `escape` and it fails. */
    range: 1_200,
    seconds: 5,
    escape: 2_200,
    /** Pilots with nothing to hide are picked for a scan this often (always with contraband aboard). */
    cleanChance: 0.25,
    /** Station types whose customs scan every ship that docks. */
    docks: ['customs-depot', 'military-base'] as const,
  },
  /** Pardons (paying all fines at one of the faction's stations) lift standing to at least this. */
  pardonFloor: -10,
  /** A pardon also costs this much per point of standing below the floor (so Hostile pilots without fines have a way back). */
  pardonPerStanding: 50,
  /** A hostile or wanted pilot may still dock for repairs, at this surcharge. */
  emergencyRepairSurcharge: 0.5,
  /** Bounty hunters come for pilots owing this much in secure space. */
  hunters: { fines: 1_500, security: 0.6, delay: 45, count: 2, model: 'ship.light-fighter.2.horizon' },
  /** Standing with the Hollow Wake at which its raiders leave you be and its dens open. */
  wakeFriendly: 10,
};

export type CrimeKind = keyof typeof LAW.crimes;

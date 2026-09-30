import type { StationOwner } from '../../content/world/types.ts';
import type { FactionId } from '../../data/types.ts';

/**
 * Traffic rules (docs/PROCGEN.md §9): how many traders, patrols and raider packs a system has,
 * which ships they fly and what a raider is worth. Pure data and functions; FlightSession spawns
 * and flies them.
 */

export interface TrafficInput {
  security: number;
  owner: FactionId | null;
  /** Stations a trader can fly to. */
  openStations: number;
  hasDen: boolean;
  jumpsFromSol: number;
}

export interface TrafficPlan {
  /** Traders in flight at once. */
  traders: number;
  /** Seconds between trader launches while under the limit. */
  traderInterval: readonly [number, number];
  /** Patrol wings (of `wingSize` fighters) flying between stations. */
  patrolWings: number;
  wingSize: number;
  /** Raider packs: none in secure space. */
  packs: { max: number; level: 1 | 2 | 3; size: readonly [number, number]; firstDelay: number; interval: readonly [number, number] } | null;
}

export const TRAFFIC = {
  /** Traders per open station, scaled by security (lawless lanes are quiet), capped. */
  tradersPerStation: 1.1,
  maxTraders: 6,
  traderInterval: [10, 26] as const,
  /** Patrols fly in claimed space at or above this security; two wings in the core. */
  patrolSecurity: 0.4,
  twoWingsSecurity: 0.75,
  wingSize: 2,
  /** Raider packs appear below this security, never in Sol's neighbourhood (the opening raid is scripted). */
  packSecurity: 0.6,
  packMinJumps: 1,
  /** Grace period after arriving before the first pack, seconds. */
  packFirstDelay: 35,
  /** Seconds between packs, scaled by (0.6 + security). */
  packInterval: [60, 120] as const,
  /** Distance at which raiders notice the player, and how far they roam for traders. */
  detectRange: 4_500,
  huntRange: 9_000,
  /** Raiders give up after this long without a target, seconds. */
  packIdle: 240,
  /** Catalogue guns are balanced for the player; NPC guns deal this fraction (like the opening raider). */
  npcDamage: 0.25,
  /**
   * What the player leaves behind (docs/PROCGEN.md §17): raider packs that saw the player, and
   * pods adrift, are still there on a return within `seconds` of game time.
   */
  linger: { seconds: 1_800, maxPods: 8, maxSystems: 6 },
};

/** How much traffic a system gets, from its security, owner, stations and remoteness. */
export function trafficPlan(input: TrafficInput, qualityScale = 1): TrafficPlan {
  const { security, owner, openStations, hasDen, jumpsFromSol } = input;
  const traders = openStations > 0 ? Math.max(1, Math.min(TRAFFIC.maxTraders, Math.round((0.8 + openStations * TRAFFIC.tradersPerStation) * (0.35 + 0.65 * security) * qualityScale))) : 0;
  const patrolWings = owner && owner !== 'hollow-wake' && security >= TRAFFIC.patrolSecurity ? Math.min(qualityScale < 0.75 ? 1 : 2, security >= TRAFFIC.twoWingsSecurity ? 2 : 1) : 0;
  let packs: TrafficPlan['packs'] = null;
  if (security < TRAFFIC.packSecurity && jumpsFromSol >= TRAFFIC.packMinJumps) {
    let level: 1 | 2 | 3 = security < 0.25 ? 3 : security < 0.4 ? 2 : 1;
    if (jumpsFromSol >= 5 && level < 3) level = (level + 1) as 2 | 3;
    const size = level === 1 ? ([1, 2] as const) : level === 2 ? ([2, 3] as const) : ([2, 4] as const);
    const scale = 0.6 + security;
    packs = {
      max: hasDen && security < 0.3 ? 2 : 1,
      level,
      size,
      firstDelay: TRAFFIC.packFirstDelay,
      interval: [TRAFFIC.packInterval[0] * scale, TRAFFIC.packInterval[1] * scale],
    };
  }
  return { traders, traderInterval: TRAFFIC.traderInterval, patrolWings, wingSize: TRAFFIC.wingSize, packs };
}

/** Who flies what: haulers and patrol fighters by owner (catalogue ship ids). */
export const FLEETS: Record<StationOwner, { traders: readonly string[]; patrols: readonly string[] }> = {
  sta: {
    traders: ['ship.freighter.1.halden', 'ship.freighter.2.halden', 'ship.courier.1.halden', 'ship.freighter.2.ares'],
    patrols: ['ship.light-fighter.1.halden', 'ship.heavy-fighter.1.ares'],
  },
  frontier: {
    traders: ['ship.freighter.1.toliman', 'ship.freighter.2.eridani', 'ship.surveyor.1.toliman', 'ship.courier.2.eridani', 'ship.freighter.1.eridani'],
    patrols: ['ship.light-fighter.2.horizon', 'ship.light-fighter.1.toliman', 'ship.heavy-fighter.2.horizon'],
  },
  independent: {
    traders: ['ship.freighter.1.halden', 'ship.freighter.1.eridani', 'ship.courier.1.eridani', 'ship.courier.2.horizon', 'ship.freighter.1.toliman'],
    patrols: [],
  },
  'hollow-wake': { traders: [], patrols: [] },
};

/** Raider ships by pack level. */
export const RAIDERS: Record<1 | 2 | 3, readonly string[]> = {
  1: ['ship.light-fighter.1.wake'],
  2: ['ship.light-fighter.2.wake', 'ship.light-fighter.1.wake', 'ship.heavy-fighter.1.wake'],
  3: ['ship.heavy-fighter.1.wake', 'ship.heavy-fighter.2.wake', 'ship.light-fighter.2.wake'],
};

/** Bounty for a raider the player destroys: grows with tier, more for heavy fighters. */
export function bountyFor(modelId: string): number {
  const [, cls, tier] = modelId.split('.');
  return 150 + 110 * (Number(tier) - 1) + (cls === 'heavy-fighter' ? 80 : 0);
}

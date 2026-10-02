import type { CommodityId } from '../economy/goods.ts';

/**
 * Raids on the player's outpost (docs/PROCGEN.md §29). Like everything in the world they are worked
 * out, not rolled as the game runs: the outpost's time is cut into windows, and each window holds
 * at most one raid, decided by the save's seed, the site and the window, at odds set by how lawless
 * its system is and how big the outpost has grown. The player defends it with turrets built from
 * hauled materials, guards hired by the hour, or in person. The raiders, guards and their words are
 * fiction; the numbers are game balance.
 */

export type RaidBand = 'patrolled' | 'thin' | 'lawless';

export const OUTPOST_RAIDS = {
  /** A window of the outpost's time (game seconds), shifted by its site; a raid strikes within its middle half (`strike`). */
  window: 10_800,
  strike: [0.25, 0.75] as const,
  /** None until the outpost has been open this long. */
  grace: 10_800,
  /** None at this security or above (core space keeps raiders off). */
  maxSecurity: 0.75,
  /** The chance a window holds a raid, by its system's band (as the trade computer reckons routes). */
  odds: { patrolled: 0.1, thin: 0.3, lawless: 0.4 } satisfies Record<RaidBand, number> as Record<RaidBand, number>,
  /** The odds grow with the outpost: a frame, a station, a port. */
  stage: [0.5, 1, 1.25] as readonly number[],
  /** A raid under way in its system (§11): odds up by half (to at most `max`), and one threat higher. */
  raidEvent: { odds: 1.5, max: 0.9, threat: 1 },
  /** A pilot the Wake trusts is raided this much as often. */
  trusted: 0.25,
  /** The raiders' threat by band (a raid event one higher, at most 3; a frame one lower, at least 1); they come one more than their threat. */
  threat: { patrolled: 1, thin: 2, lawless: 2 } satisfies Record<RaidBand, 1 | 2 | 3> as Record<RaidBand, 1 | 2 | 3>,
  /** The outpost's people see them coming this long before (game seconds). */
  warning: 900,
  /**
   * The first raid is a probe: threat 1, seen 30 minutes off; in thin or lawless space the first
   * window once the grace is over always holds it.
   */
  probe: { warning: 1_800 },
  /**
   * Turrets: one for each stage built, three at most, each from materials hauled to the outpost
   * (`needs`, the next one's); they cost `upkeep` an hour each out of its income. One knocked out in
   * a raid is down for `downSeconds`, or repaired at the outpost for `repair`.
   */
  turrets: {
    needs: [
      { 'ship-parts': 4, machinery: 2, electronics: 3 },
      { 'ship-parts': 6, machinery: 3, electronics: 4, metals: 6 },
      { 'ship-parts': 8, machinery: 4, electronics: 6, metals: 8 },
    ] as readonly Partial<Record<CommodityId, number>>[],
    upkeep: 15,
    downSeconds: 21_600,
    repair: 350,
  },
  /**
   * Guards by the hour, hired at the outpost or from the Fleet window at any full-service dock: two
   * pilots a posting, at most two at once, for a term of hours, paid up front (no refund); they
   * take up their post `delay` after hiring. Nobody guards for a pilot bounty hunters are after.
   */
  guards: { offers: 2, max: 2, terms: [2, 4, 8] as readonly number[], perHour: { steady: 55, sharp: 70 } as Record<'steady' | 'sharp', number>, delay: 900 },
  /**
   * Holding a raid while away: the defence (`defence`: each turret up, each guard on post by skill,
   * each patrol wing of the system, friendly standing with its owner) against the raiders' strength
   * by threat (`strength`); the chance of holding by their ratio (`hold`, interpolated, at most 0.95).
   */
  defence: { turret: 2, guard: { steady: 1.5, sharp: 2 } as Record<'steady' | 'sharp', number>, patrolWing: 1.5, friendly: 1.5 },
  strength: { 1: 2, 2: 4.5, 3: 8.5 } as Record<1 | 2 | 3, number>,
  hold: [
    [0, 0],
    [0.5, 0.35],
    [1, 0.65],
    [1.5, 0.85],
    [2, 0.95],
  ] as readonly (readonly [number, number])[],
  /**
   * A raid lost: the income is cut (`income`) for some hours by threat (`hours`), the market short of
   * one good it trades (stock `stock`, price `price`) as long, a share of each good stored there
   * (`stored`) taken, and a turret knocked out. Never the player's credits.
   */
  lost: { income: 0.5, hours: { 1: 2, 2: 3, 3: 4 } as Record<1 | 2 | 3, number>, stock: 0.5, price: 1.2, stored: 0.25 },
  /**
   * In flight: the raiders come from this far out; half go for the outpost's stores (their hull by
   * stage), the rest for the defenders; turrets stand on a ring round the outpost; guards fly a
   * loop round it. Undecided after `cap`, the clock decides as if away.
   */
  fight: { from: 6_000, stores: [600, 900, 1_200] as readonly number[], ring: 260, turret: { hull: 300, shield: 120, range: 1_600 }, guardLoop: 2_500, cap: 1_800 },
  /** The last raids the outpost remembers. */
  keep: 8,
};

export type OutpostRaidRules = typeof OUTPOST_RAIDS;

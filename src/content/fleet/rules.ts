import type { EventKind } from '../events/rules.ts';
import type { StationType } from '../world/types.ts';

/** How dangerous a route is, from its worst security (as the trade computer says it). */
type Danger = 'patrolled' | 'thin' | 'lawless';

/**
 * A fleet of your own (docs/PROCGEN.md §18): ships parked at stations, haulers with hired captains
 * flying the player's routes (and met on the lanes), leased storage and stakes in a station's trade.
 * All of it is worked out from the game clock when the player docks, jumps or loads, and in flight as
 * its steps fall due (src/economy/fleet.ts): nothing runs in the background.
 */
export const FLEET = {
  hangar: {
    /** Ships the player can own besides the one they fly. */
    max: 4,
  },
  haulers: {
    /**
     * A captain takes this share of every run's profit (the sale less the goods, both ways' jump
     * fees and the captain's fee), and this fee for each run on top, paid when the run sets out.
     */
    wageShare: 0.3,
    fee: 40,
    /** Captains fly carefully: a run takes this many times the expected trip, both ways, plus loading. */
    tripFactor: 1.5,
    loadSeconds: 180,
    /** Hauled cargo is bought within this share of a full hold (captains keep a margin). */
    holdShare: 0.9,
    /** A captain refuses a route that no longer pays at least this much a run (after every cut). */
    minProfit: 50,
    /** A captain waiting at home (the route does not pay, or you cannot pay for a load) looks again this often (s). */
    recheck: 900,
    /**
     * A wait is reported once: a wait for credits at the first look, a wait for prices to recover
     * after this many more looks (an hour; a route worked hard often needs a look or two to recover).
     */
    reportAfter: 4,
    /**
     * At most this many looks at the route a hauler (every run begins with one; a waiting captain
     * looks every `recheck`) are worked out at once; past that the captain rests until the clock.
     */
    maxLooksPerSettle: 300,
  },
  risk: {
    /**
     * Chance a run meets raiders, by the route's worst security (a raid under way on the route: one
     * level worse). They strike in one system of the way out (one with a raid under way when the
     * run set out, else the least secure), at the middle of the run's leg there.
     */
    raided: { lawless: 0.08, thin: 0.03, patrolled: 0.008 },
    /** When raided: the cargo is lost; this share of the time, the ship too. */
    shipLost: 0.25,
    /**
     * Insurance: this share of each run's profit; a ship lost to raiders pays back this share of its
     * price (not one the player's own guns destroyed).
     */
    premium: 0.08,
    payout: 0.6,
  },
  /**
   * Your captains on the lanes (docs/PROCGEN.md §18.6): in the player's sight, a run's raid is
   * flown. Raiders of this threat level jump the captain (an escort's ambush, §10: one more ship
   * than the level), by how dangerous the route is.
   */
  lanes: {
    ambush: { patrolled: 1, thin: 1, lawless: 2 } satisfies Record<Danger, 1 | 2 | 3> as Record<Danger, 1 | 2 | 3>,
  },
  /**
   * Captains who work for the pilot's outposts (docs/PROCGEN.md §37). A supply captain takes `share`
   * of the goods it carries at their galaxy base prices; a mining captain `cut` of what the refinery
   * pays for each load. A mining captain flies `transit` seconds between its spot and the refinery
   * each way; its spot lies `spot` metres along the refinery's ring from it, at least `clear` from
   * every station. At most `maxSteps` of a mining captain's steps are worked out in one settle; past
   * that the captain rests until the clock.
   */
  work: { share: 0.1, cut: 0.3, transit: 60, spot: 3_000, clear: 2_000, maxSteps: 2_000 },
  storage: {
    /** A lease at one station (paid once, kept for good): its price and hold size (units). */
    lease: 400,
    capacity: 60,
  },
  stakes: {
    /** A share of a station's trade, by its type (credits per per-cent), and at most this many per-cent. */
    pricePerPercent: {
      'trade-port': 900,
      'customs-depot': 600,
      shipyard: 1_000,
      'mining-outpost': 500,
      refinery: 700,
      factory: 800,
      'agri-station': 550,
      'research-station': 650,
      relay: 400,
      'military-base': 0,
      freeport: 750,
      'pirate-den': 0,
    } satisfies Record<StationType, number> as Record<StationType, number>,
    maxPercent: 10,
    maxStations: 5,
    /** Dividends: this share of the stake's price per hour of game time, moved by the station's events. */
    dividendPerHour: 0.012,
    /**
     * What an event at the station, or a raid or sweep in its system, does to that hour's dividend
     * (looked up at the middle of the hour; both multiply when both happen).
     */
    events: { boom: 1.5, glut: 0.9, shortage: 0.7, strike: 0.4, raid: 0.6, sweep: 1, harvest: 1.2, survey: 1.3, stranded: 1 } satisfies Record<EventKind, number> as Record<EventKind, number>,
    /** Hours paid one by one at a settle; any older hours are paid at the plain rate. */
    maxHoursPerSettle: 720,
    /** Selling a stake back pays this share of its current price. */
    sellBack: 0.85,
  },
  /** Fleet reports kept. */
  reports: 20,
} as const;

import type { CommodityId } from '../economy/goods.ts';

/**
 * Wrecks to fly to (docs/PROCGEN.md §31): lane hails and scans mark a site in flight (a ship in
 * distress to fly alongside, pods to tractor in, a wreck to salvage, an old derelict to board), and a
 * wreck's or derelict's log may hold a lead into a short mystery across a few systems. Fiction: the
 * sites, ships, people and logs are invented, and a derelict may drift near a real body but says
 * nothing about it. Every time is in game seconds, every distance in metres, every pay in credits.
 */

export type SiteKind = 'ship' | 'pod' | 'wreck' | 'derelict';
/** What a pod holds: salvage (credits), cargo, a lifepod's survivor, a lifeboat's recorder, a strongbox. */
export type PodWhat = 'salvage' | 'cargo' | 'lifepod' | 'recorder' | 'strongbox';
export const SITE_KINDS: readonly SiteKind[] = ['ship', 'pod', 'wreck', 'derelict'];
export const POD_WHATS: readonly PodWhat[] = ['salvage', 'cargo', 'lifepod', 'recorder', 'strongbox'];

export const WRECKS = {
  /**
   * A marked site waits this long from when it was marked (a mystery's step from when it opened),
   * then is gone; never closed while the pilot flies in its system (the owner's choice, 2 October 2026).
   */
  open: { lane: 7_200, scan: 7_200, step: 10_800 },
  /** At most this many sites open at once (a hail's choice to go is closed beyond it). */
  maxOpen: 4,
  /**
   * Where sites lie: a hail's this far from the arrival point; a derelict or a scan's find this far
   * off its body's surface; always this far from any station and from any star's or planet's surface.
   */
  place: { fromArrival: [8_000, 18_000] as const, nearBody: [3_000, 6_000] as const, clearOfDocks: 6_000, clearOfBodies: 2_000 },
  /** A hull's log is read by a scan within this (times the scanner's reach, a navigator's share included). */
  scanRange: 3_000,
  /** Alongside a ship in distress. */
  reach: 400,
  /** Boarding a derelict: within `range` of its hull, slower than `maxSpeed`, for `seconds`, no hostile within `quiet`. */
  board: { range: 250, maxSpeed: 25, seconds: 8, quiet: 3_000 },
  /**
   * Dangers by security band (the lanes' bands): raiders picking a wreck over (seen; they hold their
   * spot), and raiders lying dark by a derelict, sprung within `spring` of it, or by a scan from
   * further out (the owner's choice), `darkSize` of them.
   */
  danger: {
    guard: { secure: 0, patrolled: 0.25, lawless: 0.55 },
    dark: { secure: 0, patrolled: 0.15, lawless: 0.35 },
    spring: 2_000,
    darkSize: [2, 3] as const,
  },
  /** Scan finds: each system's time is cut into slots; a slot may hold one, found by the first manual scan of a planet, star or belt in it. */
  scan: { slotSeconds: 1_200, chance: { secure: 0.15, patrolled: 0.25, lawless: 0.35 }, derelict: 0.35 },
  kinds: {
    /** Salvage pods round the hull (credits each), and sometimes a pod of cargo. */
    wreck: { pods: [2, 4] as const, value: [60, 180] as const, cargo: 0.35, cargoQty: [2, 5] as const, goods: ['salvage', 'ship-parts', 'electronics', 'machinery'] as readonly CommodityId[] },
    /** An old hull, a catalogue ship drawn a size up and dark; never within `minJumps` of Sol. */
    derelict: { minJumps: 2, hulls: ['ship.freighter.3.eridani', 'ship.gunship.3.ares', 'ship.surveyor.3.toliman'], scale: [1.8, 2.6] as const, salvage: [250, 600] as const, dataCore: 0.5 },
    /** Cargo adrift is split into this many pods. */
    pod: { cargoPods: [2, 3] as const },
  },
  /** One log in `chance` holds a lead to a mystery not yet begun; the first log a pilot reads always does. One mystery at a time, each once a save. */
  leads: { chance: 0.35 },
  /** Finished sites kept for the journal, none older than `seconds`. */
  keep: { sites: 24, seconds: 86_400 },
} as const;

export type WreckRules = typeof WRECKS;

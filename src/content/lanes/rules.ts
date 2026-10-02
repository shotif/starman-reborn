import type { CommodityId } from '../economy/goods.ts';

/**
 * Lane encounters (docs/PROCGEN.md §27): short choices that come up in flight, worked out from the
 * system and the clock like everything else in the world, and fiction like the people and ships of
 * the lanes. Each system's time is cut into slots; a slot may hold one encounter, whose kind fits the
 * system as it was when the slot began. A pilot flying quietly there meets it as a hail on the HUD,
 * answered or let go. Every time is in game seconds; every pay and price in credits.
 */
export const LANES = {
  /** Each system's time is cut into slots this long; each may hold one encounter. */
  slotSeconds: 540,
  /** The chance a slot holds one, by the system's security band. */
  chance: { secure: 0.45, patrolled: 0.55, lawless: 0.6 },
  /** Security bands: at or above `secure` a system is secure, below `lawless` lawless, patrolled between. */
  bands: { secure: 0.75, lawless: 0.35 },
  /** A pilot meets one at most this often: with the slots, about one every twenty minutes of flight. */
  cooldown: 900,
  /** A hail waits this long for an answer (seconds of flight with no hostiles near), then lapses. */
  hailSeconds: 45,
  /** No hail this soon after a launch or an arrival, with hostiles this near (m), or this near a dock (m). */
  grace: { afterLaunch: 20, afterArrival: 8 },
  quiet: { hostileRange: 6_000, dockClear: 4_000 },
  /** The save keeps this many encounters, none older than this. */
  keep: { records: 40, seconds: 86_400 },
  kinds: {
    /** A ship calls for help. Out in thinly patrolled or lawless space it is sometimes bait. */
    mayday: { weight: 3, bait: { secure: 0, patrolled: 0.25, lawless: 0.5 }, reward: [220, 520] as const, standing: 2 },
    /** A lifepod from a hauler raiders destroyed here lately: its survivor wants a berth to the nearest station. */
    lifepod: { weight: 4, within: 1_800, fare: [260, 420] as const, standing: 1 },
    /** The Hollow Wake stops ships at the jump beacon where its packs roam: pay, or fight. */
    toll: { weight: 3, toll: { 1: 150, 2: 300, 3: 500 } as Record<1 | 2 | 3, number> },
    /** A patrol hails a pilot with contraband aboard, in patrolled space. A bribe is sometimes a sting. */
    customs: { weight: 3, declare: 0.5, bribe: 0.35, sting: 0.2, stingFine: 600, stingStanding: -8, dumpStanding: -3 },
    /** A scientist stranded near a sight of the real sky wants a berth to a research station near by. */
    scientist: { weight: 2, maxJumps: 2, fare: 1.25, gift: { commodity: 'data-cores' as CommodityId, qty: 1 }, fuel: { commodity: 'helium-3' as CommodityId, price: 2 }, standing: 1 },
    /**
     * Cargo adrift from a hauler. Returned to its owner it pays this share of its base value and
     * standing with the owner's law (kept, it is worth its full price, and nothing more). In lawless
     * space it is sometimes bait.
     */
    cargo: { weight: 3, bait: { secure: 0, patrolled: 0.15, lawless: 0.4 }, qty: [2, 4] as const, returnShare: 0.6, returnStanding: 2 },
    /** A trader who has lost their way: share your charts for a price tip, or sell them a fix. */
    trader: { weight: 2, fix: 60 },
  },
} as const;

export type LaneKind = keyof typeof LANES.kinds;
export type LaneRules = typeof LANES;
export const LANE_KINDS = Object.keys(LANES.kinds) as LaneKind[];

/** Ships of the lanes' encounters (fiction), none of them a hauler's or a convoy's name. */
export const LANE_SHIPS: readonly string[] = [
  'Coltsfoot', 'Dunnock', 'Wagtail', 'Whinchat', 'Sorrel', 'Yarrow', 'Linnet', 'Chiffchaff',
  'Burdock', 'Goldcrest', 'Ragwort', 'Moorhen', 'Celandine', 'Shelduck', 'Campion', 'Plover',
];

/** Goods that may be found adrift (never contraband). */
export const ADRIFT_GOODS: readonly CommodityId[] = ['metals', 'electronics', 'medical', 'water', 'food', 'machinery'];

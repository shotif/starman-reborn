import type { BeltRecord } from '../../data/types.ts';
import type { CommodityId } from '../economy/goods.ts';

/**
 * Mining rules (docs/PROCGEN.md §19): what the rocks of each kind of belt hold, how the beam cuts,
 * where the cut goes, and the raiders who hunt miners. Mining happens only in the belts a cited
 * source reports (src/data/generated/belts.json); where a belt lies in flight is schematic, and the
 * rocks, their contents and everything else here are game fiction.
 */

/** The goods a mining laser cuts from rock. */
export type MinedGood = Extract<CommodityId, 'ore' | 'water' | 'gases'>;

export const MINED_GOODS: readonly MinedGood[] = ['ore', 'water', 'gases'];

export type BeltKind = BeltRecord['kind'];

/**
 * What the rocks of each kind of belt are made of: for each good a weight drawn per rock from this
 * range, then scaled so the shares add up to one. Main-belt rocks are mostly metal ore with some ice;
 * Kuiper Belt rocks are mostly water ice with volatiles; debris discs are mixed.
 */
export const COMPOSITION: Record<BeltKind, Partial<Record<MinedGood, readonly [number, number]>>> = {
  'asteroid-belt': { ore: [0.55, 0.85], water: [0.15, 0.45] },
  'kuiper-belt': { water: [0.5, 0.75], gases: [0.25, 0.5] },
  'debris-disc': { ore: [0.2, 0.6], water: [0.2, 0.6], gases: [0.1, 0.4] },
};

export const MINING = {
  /** The beam reaches a rock within this distance of its surface (metres). */
  range: 600,
  /**
   * Minable rocks: a few in every stretch of belt (`sectorArc` metres of the ring) near the player,
   * their radius (metres) and how much rock they hold (units). A spent rock comes back after
   * `regrowSeconds` of game clock; each rock keeps its own timing, and nothing runs in the background.
   */
  rocks: {
    perSector: 4,
    sectorArc: 8_000,
    radius: [26, 60] as const,
    amount: [40, 110] as const,
    regrowSeconds: 2_700,
    /** Rocks appear when the player is within this distance of the belt, and go when further. */
    spawnReach: 14_000,
    /** No minable rock within this distance of a station's, planet's or star's surface (metres). */
    clearance: 1_500,
    /** Where in the ring's width and thickness rocks sit (fractions of the half width and half thickness). */
    spread: { radial: 0.35, height: 0.3 },
  },
  /** Scanning a rock reads what it holds from this far (metres), times the scanner's range. */
  scanRange: 4_000,
  /** When the hold is full, each whole unit cut goes out in a cargo pod, up to this many adrift at once. */
  pods: 6,
  /**
   * Raiders who hunt miners: every `every` seconds of beam a pack may come, with this chance by the
   * belt's security (lawless below 0.35, thinly patrolled below 0.6, patrolled above), `level` its
   * threat when the system's own packs say nothing, `size` how many.
   */
  hunt: {
    every: 30,
    chance: { lawless: 0.25, thin: 0.08, patrolled: 0.01 },
    level: { lawless: 2, thin: 1, patrolled: 1 } as Record<'lawless' | 'thin' | 'patrolled', 1 | 2 | 3>,
    size: [1, 2] as const,
  },
  /** Income estimates: seconds to fly between a station and the rocks, each way (on top of the jump trip). */
  income: { transit: 60 },
};

/** The goods a belt of this kind yields. */
export function beltGoods(kind: BeltKind): MinedGood[] {
  return MINED_GOODS.filter((g) => COMPOSITION[kind][g] !== undefined);
}

/** Security bands, the same the contract notes and the trade computer use (lawless below 0.35, thinly patrolled below 0.6). */
export function securityBand(security: number): 'lawless' | 'thin' | 'patrolled' {
  return security < 0.35 ? 'lawless' : security < 0.6 ? 'thin' : 'patrolled';
}

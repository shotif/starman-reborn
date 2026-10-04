import { CREW } from '../crew/rules.ts';

/**
 * Wing command (docs/PROCGEN.md §34): the orders a hired wing takes, how its pilots grow with every
 * fight beside the pilot, how they come to trust (or not) the one who pays them, and how they are
 * hurt, picked up and treated. Nobody on the wing is lost for good (the owner's choice, 4 October
 * 2026). Fiction: the wingmen, their insurers and their words are invented. Every time is in game
 * seconds, every distance in metres, every pay in credits.
 */

/** The orders, in the card's order (keys 1–6). */
export type WingOrder = 'free' | 'attack' | 'defend' | 'cover' | 'hold' | 'form';
export const WING_ORDERS: readonly WingOrder[] = ['free', 'attack', 'defend', 'cover', 'hold', 'form'];
export type WingGrade = 1 | 2 | 3 | 4;
export type TrustBand = 'wary' | 'easy' | 'loyal';
/** What a wingman remembers last of flying with the pilot. */
export type WingMemory = 'fight' | 'treated' | 'untreated' | 'down' | 'unpaid' | 'raise' | 'credit';
export const WING_MEMORIES: readonly WingMemory[] = ['fight', 'treated', 'untreated', 'down', 'unpaid', 'raise', 'credit'];

export const WING = {
  /** A wingman left this far behind (a lane, a long cruise) catches up, unless holding or guarding. */
  catchUp: 6_000,
  orders: {
    /** At will: raiders within this of the pilot. */
    free: { range: 3_000 },
    /** Defend and cover: keep `station` off the ward; go for raiders after it within `prey`, and others within `range` of it; drop a chase beyond `leash` of it. */
    ward: { station: 220, range: 1_800, prey: 4_000, leash: 2_500 },
    /** Hold here: fight raiders within `range` of the point, or any going for them; drop a chase beyond `leash`. */
    hold: { range: 1_500, leash: 2_500 },
    /** Form up: back to their slots, boosting when further out than this. */
    form: { boost: 1_000 },
    /** Hold, defend and cover end when the pilot is this far from the point or the ward. */
    release: 8_000,
    /** A hauler sending a mayday is covered within this (inside `release`, so the guard holds). */
    mayday: 7_000,
  },
  /** Points (fights plus downs) for each grade; a sharp hire starts with `sharpStart`. */
  ladder: [0, 4, 12, 28] as const,
  sharpStart: 4,
  /** By grade: how hard their guns hit, how tightly they aim, seconds before they take on a new foe, the chance they jink when their shield fails. */
  skill: {
    damage: [0.3, 0.38, 0.41, 0.44] as const,
    accuracy: [0.6, 0.66, 0.72, 0.76] as const,
    react: [1.2, 0.9, 0.6, 0.4] as const,
    evade: [0.5, 0.6, 0.7, 0.75] as const,
  },
  /** A fight counts for a wingman who took on its pack and was within `near` of a raider as it went down; at most `fights` and `downs` a flight. */
  earn: { near: 3_000, fights: 2, downs: 2 },
  /** The fee per jump by grade (times the hire's base fee), and a loyal wingman's discount. */
  fee: { grade: [1, 1.25, 1.45, 1.7] as const, loyal: 0.1 },
  /** Trust, 0–100: where it starts, the bands, and what moves it. */
  trust: { start: 50, wary: 30, loyal: 70, fight: 3, treated: 5, untreated: -5, hit: -5, down: -10, credit: -15 },
  /**
   * Hurt: under `hull` of their hull a wingman holds back from fights, until they mend (the crew's
   * time) or a dock's medic treats them; shot down, they eject, are picked up and rejoin at the next
   * dock, longer to mend and dearer to treat.
   */
  hurt: { hull: 0.4, mend: CREW.hurt.mend, downMend: 2 * CREW.hurt.mend, treat: CREW.hurt.treat, downTreat: 2 * CREW.hurt.treat },
  /** Former wingmen the journal remembers. */
  former: 6,
} as const;

export type WingRules = typeof WING;

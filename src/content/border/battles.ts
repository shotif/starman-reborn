import { BORDER } from './rules.ts';

/**
 * The border in sight (docs/PROCGEN.md §35): clashes off the jump beacon while a front fights, and
 * turning battles at its exposed station as the station is about to fall or be retaken. The
 * battles, their ships and their words are fiction. Every time is in game seconds, every distance
 * in metres, every pay in credits.
 */

export type BattleKind = 'clash' | 'assault' | 'retake';
export const BATTLE_KINDS: readonly BattleKind[] = ['clash', 'assault', 'retake'];
export type BattleSide = 'law' | 'wake';

export const BATTLES = {
  clash: {
    /** The clock is cut into slots; each may hold one clash per system. */
    slotSeconds: 1_200,
    /** The chance of a clash in a slot, by the front's phase (in the systems where that phase fights). */
    chance: { skirmish: 0.6, blockade: 0.5, fallen: 0.4, pushedBack: 0.4 },
    /** Opens this long into its slot, and no sooner than `arrive` after the pilot arrives. */
    opens: 30,
    arrive: 20,
    /** Ships a side (Low preset: `low`), one more for the side the tide favours by `favour` or more. */
    ships: 3,
    low: 2,
    favour: 35,
    /** The Wake's raiders, matched to the front's faction's patrol fighters (the Authority flies Mk I, the Cooperative Mk II). */
    level: { sta: 1, frontier: 2 } as const,
    /** Undecided after this long, both sides pull back. */
    lasts: 360,
  },
  /** Where a clash is fought: this share of the way from the beacon, within `[min, max]` of it, `denClear` from a den. */
  line: { share: 0.35, min: 3_000, max: 6_000, denClear: 5_000 },
  turning: {
    /** Due while the pressure is this close to the fall, moving toward crossing it. */
    brink: 8,
    /** Attackers in waves (the next when the last is down to `next`); defenders hold by the station. */
    waves: 2,
    wave: 3,
    waveLow: 2,
    next: 1,
    defenders: 4,
    defendersLow: 3,
    /** The Wake's raiders in a turning battle, a level above a clash's. */
    level: { sta: 2, frontier: 3 } as const,
    /** Off the station's bay. */
    standOff: 2_000,
    /** Undecided after this long, the defenders hold. */
    lasts: 480,
  },
  /** Battle ships go for enemies within this, the pilot too when the pilot is their enemy, and chase none further than `leash` from the line. */
  reach: 4_000,
  leash: 4_500,
  /** How tightly battle ships aim at each other, both sides alike (at the pilot, raiders aim as the difficulty says). */
  aim: 0.7,
  /** What a battle won with the pilot's part weighs on its front (the owner's choice: a turning battle as a war contract, a clash a third). */
  deed: { turning: BORDER.deeds.warContract, clash: BORDER.deeds.warContract / 3 },
  /** The side's purse and standing for a battle won with the pilot. */
  purse: { turning: 900, clash: 300 },
  standing: { turning: 5, clash: 2 },
  /** Battles seen to an end kept per front, and how long the News tells a turning battle. */
  keep: 6,
  newsSeconds: 7_200,
  /** Clearance of a battle point from bodies (off the surface), stations and lanes. */
  clear: { surface: 1_500, station: 2_000, lane: 400 },
} as const;

export type BattleRules = typeof BATTLES;

import type { SourceRef } from '../../data/types.ts';

/**
 * Flare stars (docs/PROCGEN.md §43): ten real red dwarfs on the map that flare. That they flare is
 * real: each is a catalogued variable star of the flare kind, its variable-star name the one SIMBAD
 * lists (as the sky snapshot holds it). When each flares, how strongly, and what a flare does to a
 * ship are the game's fiction, labelled so wherever they show. Every time is in game seconds.
 */

export type FlareKind = 'flare' | 'strong' | 'superflare';

export interface FlareStar {
  /** The star's id in the archives (src/data/generated/astrometry.json). */
  star: string;
  /** Its name as a variable star (General Catalogue of Variable Stars), as SIMBAD lists it after `V* `. */
  variable: string;
}

/** The flare stars on the map, nearest first. */
export const FLARE_STARS: readonly FlareStar[] = [
  { star: 'proxima-centauri', variable: 'V645 Cen' },
  { star: 'wolf-359', variable: 'CN Leo' },
  { star: 'uv-ceti', variable: 'UV Cet' },
  { star: 'bl-ceti', variable: 'BL Cet' },
  { star: 'ross-154', variable: 'V1216 Sgr' },
  { star: 'dx-cancri', variable: 'DX Cnc' },
  { star: 'yz-ceti', variable: 'YZ Cet' },
  { star: 'ad-leonis', variable: 'AD Leo' },
  { star: 'ev-lacertae', variable: 'EV Lac' },
  { star: 'yz-canis-minoris', variable: 'YZ CMi' },
];

export const FLARES = {
  /**
   * Each flare star has one window after another, shifted by a phase of its own; in each, at most
   * one flare, with these odds, starting and ending on whole minutes inside it.
   */
  window: 7_200,
  odds: 0.5,
  /** None starts before this, a game's first hour: a new pilot learns to fly first. */
  quietUntil: 3_600,
  /** A flare rises over this long, then fades over the rest of it. */
  rise: 60,
  /**
   * The kinds: how often each comes (`share`), how long it lasts, and while it lasts, the share of
   * their rate shields recharge at and of their reach scanners keep in its system; `glow` is how
   * much the star brightens at its peak (artistic).
   */
  kinds: {
    flare: { share: 0.65, lasts: [600, 1_200], shields: 0.7, scanner: 0.8, glow: 0.45 },
    strong: { share: 0.28, lasts: [1_200, 2_100], shields: 0.45, scanner: 0.6, glow: 0.75 },
    superflare: { share: 0.07, lasts: [2_100, 3_000], shields: 0.2, scanner: 0.4, glow: 1 },
  } satisfies Record<FlareKind, { share: number; lasts: readonly [number, number]; shields: number; scanner: number; glow: number }>,
  /**
   * Flare watch (§43.5): research stations within `reach` jumps of a flaring star want it scanned
   * while it flares; pay by kind, and more for each jump.
   */
  watch: {
    reach: 2,
    reward: { flare: 700, strong: 1_100, superflare: 1_800 } satisfies Record<FlareKind, number>,
    perJump: 300,
  },
} as const;

/** When the sky snapshot whose SIMBAD identifiers name the flare stars was taken (data/snapshot/raw/<date>/). */
export const FLARE_NAMES_RETRIEVED = '2026-09-30';

/** Where what is real about flare stars comes from (docs/ASTRONOMY_SOURCES.md, *Flare stars*). */
export const FLARE_SOURCES = {
  /** Where variable-star names, and their kinds, are given. */
  gcvs: {
    label: 'Samus et al. 2017, General catalogue of variable stars: Version GCVS 5.1 (Astronomy Reports 61, 80)',
    url: 'https://ui.adsabs.harvard.edu/abs/2017ARep...61...80S',
    bibcode: '2017ARep...61...80S',
  },
  /** One of Proxima Centauri's flares, seen from millimetre waves to the far ultraviolet. */
  proxima: {
    label: 'MacGregor et al. 2021, an extremely short duration flare from Proxima Centauri (ApJL 911, L25)',
    url: 'https://ui.adsabs.harvard.edu/abs/2021ApJ...911L..25M',
    bibcode: '2021ApJ...911L..25M',
  },
} as const satisfies Record<string, SourceRef>;

/** A flare star's SIMBAD record, by its variable-star name (as the sky snapshot found it). */
export function variableSource(s: FlareStar): SourceRef {
  const id = `V* ${s.variable}`;
  return { label: 'SIMBAD', url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(id)}`, recordId: id, retrieved: FLARE_NAMES_RETRIEVED };
}

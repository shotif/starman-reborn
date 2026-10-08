import { headingOf, twoBodyAt, type OrbitElements, type OrbitPlace } from './kepler.ts';
import { hasSolarElements, heliocentric } from './solar.ts';
import type { SourceRef } from './types.ts';

/**
 * Comets in Sol (docs/PROCGEN.md §45): fourteen periodic comets as JPL gives them (read by
 * scripts/comets-process.ts from the sky snapshot), and the reckoning of where one stands on a
 * date: from its osculating elements on the snapshot's day, as if only the Sun pulled on it.
 */

/** A comet's osculating elements (§45.1). */
export type CometElements = OrbitElements;

export interface Comet {
  /** The game's id, e.g. `comet-1p`. */
  id: string;
  /** JPL's designation (`1P`) and full name (`1P/Halley`). */
  designation: string;
  name: string;
  /** JPL's orbit class, e.g. Jupiter-family comet. */
  orbitClass: string;
  /** Horizons' orbit solution the elements come from. */
  solution: string;
  elements: CometElements;
  /** The nucleus's effective diameter (km) where measured, and the reference JPL gives. */
  diameterKm: number | null;
  diameterRef: string | null;
  /** Total-magnitude parameters: m = M1 + 5 log Δ + K1 log r. */
  m1: number | null;
  k1: number | null;
}

export interface CometsDataset {
  generatedBy: string;
  retrieved: string;
  /** The day the elements are osculating on (Julian date). */
  epochJd: number;
  sources: { sbdb: SourceRef; horizons: SourceRef };
  description: string;
  comets: readonly Comet[];
}

/** The comets: none until Sol's sky arrives (data/sky.ts, docs/PROCGEN.md §50), then JPL's. */
export let COMET_DATA: CometsDataset = { generatedBy: '', retrieved: '', epochJd: 0, sources: { sbdb: { label: '', url: '' }, horizons: { label: '', url: '' } }, description: '', comets: [] };

let BY_ID = new Map<string, Comet>();

/** The day the elements were taken (Julian date). */
export let COMET_EPOCH_JD = 0;

/** Puts the comets in place when Sol's sky arrives. */
export function installComets(data: CometsDataset): void {
  COMET_DATA = data;
  COMET_EPOCH_JD = data.epochJd;
  BY_ID = new Map(data.comets.map((c) => [c.id, c]));
}

/** A comet by the game's id. */
export function cometOf(id: string): Comet | undefined {
  return BY_ID.get(id);
}

export type CometPlace = OrbitPlace;

/** Where a comet stands on a date: two-body, from the elements (§45.2). */
export function cometAt(comet: Comet, jd: number): CometPlace {
  return twoBodyAt(comet.elements, jd);
}

/** Which way a comet is moving on a date (a unit vector, J2000 ecliptic). */
export function cometHeading(comet: Comet, jd: number): [number, number, number] {
  return headingOf((t) => cometAt(comet, t), jd);
}

/** The comet's perihelion passages before and after a date (Julian dates). */
export function perihelia(comet: Comet, jd: number): { last: number; next: number } {
  const { perihelionJd: tp, periodDays: p } = comet.elements;
  const k = Math.floor((jd - tp) / p);
  return { last: tp + k * p, next: tp + (k + 1) * p };
}

/** Distance from Earth (au) on a date, when the planets' elements cover it. */
export function distanceFromEarth(comet: Comet, jd: number): number | null {
  if (!hasSolarElements(jd)) return null;
  const c = cometAt(comet, jd).xyz;
  const e = heliocentric('earth', jd);
  return Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]);
}

/** Total magnitude from Earth by the comet law (§45.2), or null without its parameters or Earth's place. */
export function cometMagnitude(comet: Comet, jd: number): number | null {
  const delta = distanceFromEarth(comet, jd);
  if (delta === null || comet.m1 === null || comet.k1 === null) return null;
  const r = cometAt(comet, jd).r;
  return comet.m1 + 5 * Math.log10(delta) + comet.k1 * Math.log10(r);
}

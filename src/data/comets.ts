import cometsFile from './generated/comets.json' with { type: 'json' };
import { hasSolarElements, heliocentric } from './solar.ts';
import type { SourceRef } from './types.ts';

/**
 * Comets in Sol (docs/PROCGEN.md §45): fourteen periodic comets as JPL gives them (read by
 * scripts/comets-process.ts from the sky snapshot), and the reckoning of where one stands on a
 * date: from its osculating elements on the snapshot's day, as if only the Sun pulled on it.
 */

export interface CometElements {
  e: number;
  /** Perihelion distance, semi-major axis (au). */
  qAu: number;
  aAu: number;
  inclinationDeg: number;
  nodeDeg: number;
  periDeg: number;
  /** Time of perihelion (Julian date) nearest the elements' day. */
  perihelionJd: number;
  motionDegPerDay: number;
  periodDays: number;
}

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

export const COMET_DATA = cometsFile as unknown as CometsDataset;

const BY_ID = new Map(COMET_DATA.comets.map((c) => [c.id, c]));

/** A comet by the game's id. */
export function cometOf(id: string): Comet | undefined {
  return BY_ID.get(id);
}

/** The day the elements were taken (Julian date). */
export const COMET_EPOCH_JD = COMET_DATA.epochJd;

const DEG = Math.PI / 180;

export interface CometPlace {
  /** Heliocentric position, J2000 ecliptic (au). */
  xyz: [number, number, number];
  /** Distance from the Sun (au). */
  r: number;
}

/** Where a comet stands on a date: two-body, from the elements (§45.2). */
export function cometAt(comet: Comet, jd: number): CometPlace {
  const el = comet.elements;
  const e = el.e;
  // Mean anomaly in (-π, π].
  let M = (el.motionDegPerDay * (jd - el.perihelionJd) * DEG) % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M <= -Math.PI) M += 2 * Math.PI;
  // Kepler's equation by Newton's method, from Danby's start (it converges for any eccentricity below one).
  let E = M + 0.85 * e * (Math.sin(M) < 0 ? -1 : 1);
  for (let i = 0; i < 60; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const a = el.aAu;
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = el.periDeg * DEG;
  const O = el.nodeDeg * DEG;
  const I = el.inclinationDeg * DEG;
  const [cw, sw, cO, sO, cI, sI] = [Math.cos(w), Math.sin(w), Math.cos(O), Math.sin(O), Math.cos(I), Math.sin(I)];
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = sw * sI * xp + cw * sI * yp;
  return { xyz: [x, y, z], r: Math.hypot(x, y, z) };
}

/** Which way a comet is moving on a date (a unit vector, J2000 ecliptic). */
export function cometHeading(comet: Comet, jd: number): [number, number, number] {
  const a = cometAt(comet, jd - 0.5).xyz;
  const b = cometAt(comet, jd + 0.5).xyz;
  const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = Math.hypot(...d) || 1;
  return [d[0] / n, d[1] / n, d[2] / n];
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

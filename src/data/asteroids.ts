import asteroidsFile from './generated/asteroids.json' with { type: 'json' };
import { headingOf, twoBodyAt, type OrbitElements, type OrbitPlace } from './kepler.ts';
import { hasSolarElements, heliocentric } from './solar.ts';
import type { SourceRef } from './types.ts';

/**
 * Named asteroids in Sol (docs/PROCGEN.md §47): fifteen asteroids as JPL gives them (read by
 * scripts/asteroids-process.ts from the sky snapshot), and the reckoning of where one stands on a
 * date: from its osculating elements, as if only the Sun pulled on it; after a close pass of Earth
 * that changes its orbit (Apophis's in April 2029), from Horizons' elements after it; and round a
 * pass nearer than 0.01 AU, from Horizons' own path past Earth.
 */

/** A pass of Earth within 0.05 AU, from JPL's close-approach data. */
export interface CloseApproach {
  /** When (Julian date, TDB), and JPL's own date and time of it. */
  jd: number;
  when: string;
  /** Nominal, least and greatest distance from Earth's centre (au), as the orbit's uncertainty allows. */
  distAu: number;
  distMinAu: number;
  distMaxAu: number;
  /** Speed relative to Earth (km/s). */
  vRelKms: number;
  /** For a pass nearer than 0.01 AU, Horizons' path from Earth's centre: [Julian date, x, y, z] (au, J2000 ecliptic). */
  path?: [number, number, number, number][];
}

export interface Asteroid {
  /** The game's id, e.g. `asteroid-99942`. */
  id: string;
  /** Its number, name and full designation (`99942`, `Apophis`, `99942 Apophis (2004 MN4)`). */
  number: string;
  name: string;
  fullname: string;
  /** JPL's orbit class on the snapshot's day (code and name, e.g. `ATE`, `Aten`). */
  orbitClass: { code: string; name: string };
  /** Near-Earth, and potentially hazardous (JPL's flags). */
  neo: boolean;
  pha: boolean;
  /** Horizons' orbit solution the elements come from. */
  solution: string;
  elements: OrbitElements;
  /** Elements after a close pass that changes the orbit, each from the pass on. */
  later: { fromJd: number; solution: string; elements: OrbitElements }[];
  /** What has been measured, with the reference JPL gives for the size. */
  diameterKm: number | null;
  diameterRef: string | null;
  /** Its extent along three axes (km), e.g. `569.24 × 554.48 × 452.66`. */
  extentKm: string | null;
  rotationHours: number | null;
  albedo: number | null;
  spectral: { tholen: string | null; smass: string | null };
  /** Magnitude parameters: absolute magnitude H and slope G. */
  h: number | null;
  g: number | null;
  approaches: CloseApproach[];
}

export interface AsteroidsDataset {
  generatedBy: string;
  retrieved: string;
  /** The day the elements are osculating on (Julian date). */
  epochJd: number;
  sources: { sbdb: SourceRef; horizons: SourceRef; cad: SourceRef };
  description: string;
  asteroids: readonly Asteroid[];
}

export const ASTEROID_DATA = asteroidsFile as unknown as AsteroidsDataset;

const BY_ID = new Map(ASTEROID_DATA.asteroids.map((a) => [a.id, a]));

/** An asteroid by the game's id. */
export function asteroidOf(id: string): Asteroid | undefined {
  return BY_ID.get(id);
}

/** The day the elements were taken (Julian date). */
export const ASTEROID_EPOCH_JD = ASTEROID_DATA.epochJd;

/** The elements that hold on a date: the snapshot's, or those after the latest pass that changed the orbit (§47.2). */
export function elementsOn(asteroid: Asteroid, jd: number): OrbitElements {
  return asteroid.later.filter((l) => l.fromJd <= jd).at(-1)?.elements ?? asteroid.elements;
}

/** Where an asteroid stands on a date: two-body, from the elements that hold then (§47.2). */
export function asteroidAt(asteroid: Asteroid, jd: number): OrbitPlace {
  return twoBodyAt(elementsOn(asteroid, jd), jd);
}

/** Which way an asteroid is moving on a date (a unit vector, J2000 ecliptic). */
export function asteroidHeading(asteroid: Asteroid, jd: number): [number, number, number] {
  return headingOf((t) => asteroidAt(asteroid, t), jd);
}

/** Where Horizons has it from Earth's centre on a date (au), if a pass's path covers the date. */
export function geocentricOnPath(asteroid: Asteroid, jd: number): [number, number, number] | null {
  for (const a of asteroid.approaches) {
    const p = a.path;
    if (!p?.length || jd < p[0]![0] || jd > p.at(-1)![0]) continue;
    const i = Math.max(1, p.findIndex((r) => r[0] >= jd));
    const [t0, x0, y0, z0] = p[i - 1]!;
    const [t1, x1, y1, z1] = p[i]!;
    const f = t1 > t0 ? (jd - t0) / (t1 - t0) : 0;
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f];
  }
  return null;
}

/** Where it is from Earth on a date (au, J2000 ecliptic): on a pass's path, else reckoned, when the planets' elements cover the date. */
export function fromEarth(asteroid: Asteroid, jd: number): [number, number, number] | null {
  const path = geocentricOnPath(asteroid, jd);
  if (path) return path;
  if (!hasSolarElements(jd)) return null;
  const a = asteroidAt(asteroid, jd).xyz;
  const e = heliocentric('earth', jd);
  return [a[0] - e[0], a[1] - e[1], a[2] - e[2]];
}

/** Distance from Earth (au) on a date. */
export function asteroidDistanceFromEarth(asteroid: Asteroid, jd: number): number | null {
  const d = fromEarth(asteroid, jd);
  return d ? Math.hypot(...d) : null;
}

/** Earth's equatorial radius and the Moon's mean distance (km), from NASA's Earth and Moon fact sheets. */
export const EARTH_RADIUS_KM = 6_378.137;
export const MOON_DISTANCE_KM = 384_400;
/** Kilometres in an astronomical unit (the IAU's definition). */
export const AU_KM = 149_597_870.7;

/** The slope parameter the Minor Planet Center takes where none has been measured. */
export const DEFAULT_SLOPE = 0.15;

/**
 * How bright it looks from Earth (§47.2), by the standard H, G law: V = H + 5 log(rΔ) − 2.5 log((1 − G)Φ1 + GΦ2),
 * with α the Sun–asteroid–Earth angle. Null without H or Earth's place.
 */
export function asteroidMagnitude(asteroid: Asteroid, jd: number): number | null {
  const geo = fromEarth(asteroid, jd);
  if (!geo || asteroid.h === null || !hasSolarElements(jd)) return null;
  const e = heliocentric('earth', jd);
  const sun = Math.hypot(...e);
  const delta = Math.hypot(...geo);
  const helio: [number, number, number] = [e[0] + geo[0], e[1] + geo[1], e[2] + geo[2]];
  const r = Math.hypot(...helio);
  const cosAlpha = Math.min(1, Math.max(-1, (r * r + delta * delta - sun * sun) / (2 * r * delta)));
  const t = Math.tan(Math.acos(cosAlpha) / 2);
  const g = asteroid.g ?? DEFAULT_SLOPE;
  const phi1 = Math.exp(-3.33 * t ** 0.63);
  const phi2 = Math.exp(-1.87 * t ** 1.22);
  return asteroid.h + 5 * Math.log10(r * delta) - 2.5 * Math.log10((1 - g) * phi1 + g * phi2);
}

/**
 * The near-Earth class of an orbit, by the Center for Near-Earth Object Studies' definitions (§47.2):
 * Atira wholly inside Earth's orbit, Aten crossing it from inside, Apollo crossing it from outside,
 * Amor approaching it from outside; null for one that comes no nearer the Sun than 1.3 AU.
 */
export function nearEarthClass(el: OrbitElements): 'IEO' | 'ATE' | 'APO' | 'AMO' | null {
  const Q = el.aAu * (1 + el.e);
  if (el.aAu < 1) return Q < 0.983 ? 'IEO' : 'ATE';
  if (el.qAu < 1.017) return 'APO';
  return el.qAu < 1.3 ? 'AMO' : null;
}

/** Its orbit class on a date: JPL's, or after a pass that changed the orbit, the near-Earth class of the new one. */
export function orbitClassOn(asteroid: Asteroid, jd: number): string {
  const el = elementsOn(asteroid, jd);
  return el === asteroid.elements ? asteroid.orbitClass.code : (nearEarthClass(el) ?? asteroid.orbitClass.code);
}

/** Its next pass of Earth within 0.05 AU from a date (or the one under way, within a day), if JPL lists one. */
export function nextApproach(asteroid: Asteroid, jd: number): CloseApproach | null {
  return asteroid.approaches.find((a) => a.jd >= jd - 1) ?? null;
}

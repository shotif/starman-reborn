import type { Vec3Tuple } from './types.ts';

/** Light-years per parsec (IAU parsec, Julian-year light-year). */
export const LY_PER_PARSEC = 3.261563777167433;

const DEG = Math.PI / 180;
const MAS_PER_DEG = 3_600_000;

/** Distance in light-years from a parallax in milliarcseconds. */
export function parallaxToLightYears(parallaxMas: number): number {
  if (!(parallaxMas > 0)) throw new RangeError(`parallax must be positive, got ${parallaxMas}`);
  return (1000 / parallaxMas) * LY_PER_PARSEC;
}

/** One-sigma distance uncertainty (light-years) propagated from a parallax error. */
export function parallaxErrorToLightYears(parallaxMas: number, errorMas: number): number {
  return (1000 * LY_PER_PARSEC * errorMas) / (parallaxMas * parallaxMas);
}

/**
 * Equatorial Cartesian coordinates in light-years with Sol at the origin.
 * x = d cos(dec) cos(ra), y = d cos(dec) sin(ra), z = d sin(dec).
 * All arithmetic stays in double precision.
 */
export function equatorialToCartesian(raDeg: number, decDeg: number, distanceLy: number): Vec3Tuple {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return [
    distanceLy * cosDec * Math.cos(ra),
    distanceLy * cosDec * Math.sin(ra),
    distanceLy * Math.sin(dec),
  ];
}

export function distance3(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Linear proper-motion propagation of an ICRS position between epochs.
 * `pmRaMasYr` is mu_alpha* (already multiplied by cos(dec)), as Gaia and Hipparcos publish it.
 * Radial velocity and perspective acceleration are ignored: for these stars the neglected terms
 * shift positions by far less than 0.001 light-years, well below map resolution.
 */
export function propagatePosition(
  raDeg: number,
  decDeg: number,
  pmRaMasYr: number,
  pmDecMasYr: number,
  fromEpoch: number,
  toEpoch: number,
): { raDeg: number; decDeg: number } {
  const dt = toEpoch - fromEpoch;
  const decOut = decDeg + (pmDecMasYr * dt) / MAS_PER_DEG;
  const cosDec = Math.cos(((decDeg + decOut) / 2) * DEG);
  let raOut = raDeg + (pmRaMasYr * dt) / MAS_PER_DEG / cosDec;
  raOut = ((raOut % 360) + 360) % 360;
  return { raDeg: raOut, decDeg: decOut };
}

/** Format a right ascension in degrees as "14h 29m 42.9s". */
export function formatRa(raDeg: number): string {
  const totalSeconds = (raDeg / 15) * 3600;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds - h * 3600) / 60);
  const s = totalSeconds - h * 3600 - m * 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}

/** Format a declination in degrees as "−62° 40′ 46″". */
export function formatDec(decDeg: number): string {
  const sign = decDeg < 0 ? '−' : '+';
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60);
  return `${sign}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

const OBLIQUITY = (23.4392911 * Math.PI) / 180;

/**
 * A vector in the map's equatorial frame (x toward RA 0, y toward RA 90°, z toward the north
 * celestial pole) turned into the flight scene's frame: the ecliptic, +x toward the March equinox,
 * +y toward the ecliptic's north (the frame Sol's planets are placed in, and every system's sky).
 */
export function equatorialToScene([x, y, z]: Vec3Tuple): Vec3Tuple {
  const ye = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
  const ze = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return [x, ze, -ye];
}

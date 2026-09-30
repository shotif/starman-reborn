import solarFile from './generated/solar-elements.json' with { type: 'json' };

/**
 * The Solar System on the real date (docs/ASTRONOMY_SOURCES.md): JPL's Keplerian elements for
 * 1800–2050 ("Approximate Positions of the Planets", Standish & Williams), fetched with the sky
 * snapshot and checked against JPL Horizons in tests/unit/solar.test.ts.
 */

export type SolarPlanetId = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

interface Elements {
  a: [number, number];
  e: [number, number];
  I: [number, number];
  L: [number, number];
  varpi: [number, number];
  Omega: [number, number];
}

interface SolarFile {
  elements: Record<SolarPlanetId, Elements> | null;
  validYears?: [number, number];
  source?: { label: string; url: string; retrieved?: string };
  accuracy?: Record<SolarPlanetId, { lonArcsec: number; latArcsec: number; distKm: number }>;
  checks?: { body: SolarPlanetId; jd: number; xyzAu: [number, number, number] }[];
}

export const SOLAR = solarFile as unknown as SolarFile;

/** Julian date of J2000.0 and of the Unix epoch. */
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const DEG = Math.PI / 180;

export function julianDate(ms: number): number {
  return UNIX_EPOCH_JD + ms / 86_400_000;
}

/** The game date as a Julian date: when the save began, plus the time played (the game clock). */
export function gameJulianDate(createdAt: string, clockSeconds: number): number | null {
  const start = Date.parse(createdAt);
  return Number.isFinite(start) ? julianDate(start + clockSeconds * 1000) : null;
}

/** True when JPL's elements are bundled and the date lies where they are valid (1800–2050). */
export function hasSolarElements(jd: number): boolean {
  if (!SOLAR.elements || !SOLAR.validYears) return false;
  const year = 2000 + (jd - J2000) / 365.25;
  return year >= SOLAR.validYears[0] && year <= SOLAR.validYears[1];
}

/**
 * Heliocentric position (au) in the J2000 ecliptic frame, x toward the equinox, by JPL's recipe:
 * elements at T centuries past J2000, Kepler's equation, then the rotation by ω, I and Ω.
 */
export function heliocentric(body: SolarPlanetId, jd: number): [number, number, number] {
  const el = SOLAR.elements?.[body];
  if (!el) throw new Error('No solar elements bundled');
  const T = (jd - J2000) / 36525;
  const at = (k: keyof Elements) => el[k][0] + el[k][1] * T;
  const a = at('a');
  const e = at('e');
  const I = at('I') * DEG;
  const L = at('L');
  const varpi = at('varpi');
  const Omega = at('Omega');
  const omega = (varpi - Omega) * DEG;
  // Mean anomaly in (-180°, 180°].
  let M = (((L - varpi) % 360) + 540) % 360 - 180;
  M *= DEG;
  // Kepler's equation, Newton's method.
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(Omega * DEG);
  const sO = Math.sin(Omega * DEG);
  const cI = Math.cos(I);
  const sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Heliocentric ecliptic longitude, degrees in [0, 360). */
export function eclipticLongitude(body: SolarPlanetId, jd: number): number {
  const [x, y] = heliocentric(body, jd);
  return ((Math.atan2(y, x) / DEG) % 360 + 360) % 360;
}

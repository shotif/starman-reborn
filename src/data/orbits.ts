import orbitsFile from './generated/orbits.json' with { type: 'json' };
import type { SourceRef } from './types.ts';

/**
 * Binary orbits (docs/PROCGEN.md §44): the orbits of the game's pairs as the Sixth Catalog of
 * Orbits of Visual Binary Stars (ORB6) gives them, read by scripts/orbits-process.ts from the sky
 * snapshot, and the standard reckoning of where the secondary stands relative to the primary at a
 * date: its position angle (from north through east) and separation on the sky, and how far apart
 * the two truly are.
 */

export interface BinaryOrbit {
  /** The game's stars: the secondary's place is reckoned relative to the primary. */
  primary: string;
  secondary: string;
  systemId: string;
  /** The game names the pair the other way round from the catalogue: its relative place is turned about. */
  flip?: true;
  /** The catalogue's WDS designation and name, and the reference it takes the orbit from. */
  wds: string;
  name: string;
  reference: string;
  /** 1 (definitive) to 4 (preliminary): the game takes no worse. */
  grade: number;
  periodYears: number;
  periodError: number | null;
  axisArcsec: number;
  axisError: number | null;
  inclinationDeg: number;
  inclinationError: number | null;
  nodeDeg: number;
  /** `*`: the ascending node is identified (else which side of the sky is nearer is unknown). */
  nodeFlag: string;
  nodeError: number | null;
  periastronJd: number;
  periastronError: number | null;
  eccentricity: number;
  eccentricityError: number | null;
  argumentDeg: number;
  argumentFlag: string;
  argumentError: number | null;
  lastObservation: number | null;
  /** The catalogue's own predictions, which the game's reckoning is tested against. */
  ephemeris: readonly { year: number; thetaDeg: number; rhoArcsec: number }[];
}

export interface OrbitsDataset {
  generatedBy: string;
  retrieved: string;
  source: SourceRef;
  description: string;
  pairs: readonly BinaryOrbit[];
  left: readonly { pair: string; why: string }[];
}

export const ORBITS = orbitsFile as unknown as OrbitsDataset;

const BY_STAR = new Map<string, BinaryOrbit>();
for (const p of ORBITS.pairs) {
  BY_STAR.set(p.primary, p);
  BY_STAR.set(p.secondary, p);
}

/** The catalogued orbit a star is part of (as primary or secondary), if any. */
export function orbitOf(starId: string): BinaryOrbit | undefined {
  return BY_STAR.get(starId);
}

/** The orbit of a system's pairs. */
export function orbitsIn(systemId: string): BinaryOrbit[] {
  return ORBITS.pairs.filter((p) => p.systemId === systemId);
}

/** The date the orbits were taken from the catalogue: in flight, each pair stands as it did then (§44.3). */
export const ORBIT_EPOCH_JD = Date.parse(`${ORBITS.retrieved}T00:00:00Z`) / 86_400_000 + 2_440_587.5;

const DEG = Math.PI / 180;
/** Julian date of a Besselian year (the catalogue's years). */
export const besselJd = (year: number) => 2415020.31352 + (year - 1900) * 365.242198781;
/** Besselian year of a Julian date. */
export const besselYear = (jd: number) => 1900 + (jd - 2415020.31352) / 365.242198781;

export interface PairPlace {
  /** Position angle of the secondary from the primary, degrees from north through east (0–360). */
  thetaDeg: number;
  /** Separation on the sky, arcseconds. */
  rhoArcsec: number;
  /** The true distance between them, in arcseconds (the orbit's radius vector) and in AU. */
  radiusArcsec: number;
  /** Along the line of sight, arcseconds, positive away from the Sun (by the catalogue's node; its sign unknown without one identified). */
  zArcsec: number;
  /** Mean anomaly (0–1 of an orbit since periastron). */
  phase: number;
}

/** Solves Kepler's equation for the eccentric anomaly. */
function eccentricAnomaly(meanAnomaly: number, e: number): number {
  let E = e < 0.8 ? meanAnomaly : Math.PI;
  for (let k = 0; k < 50; k++) {
    const d = (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/**
 * Where the secondary stands relative to the primary at a Julian date, by the standard reckoning for
 * a visual binary: the mean anomaly from the period and periastron, Kepler's equation, the true
 * anomaly and radius vector, then the projection by the inclination, node and periastron argument.
 */
export function pairAt(orbit: BinaryOrbit, jd: number): PairPlace {
  const years = besselYear(jd) - besselYear(orbit.periastronJd);
  const phase = (((years / orbit.periodYears) % 1) + 1) % 1;
  const e = orbit.eccentricity;
  const E = eccentricAnomaly(2 * Math.PI * phase, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = orbit.axisArcsec * (1 - e * Math.cos(E));
  const u = nu + orbit.argumentDeg * DEG;
  const i = orbit.inclinationDeg * DEG;
  const node = orbit.nodeDeg * DEG;
  // ρ cos(θ − Ω) = r cos u; ρ sin(θ − Ω) = r sin u cos i; z = r sin u sin i.
  let theta = node + Math.atan2(Math.sin(u) * Math.cos(i), Math.cos(u));
  const rho = r * Math.sqrt(Math.cos(u) ** 2 + (Math.sin(u) * Math.cos(i)) ** 2);
  let z = r * Math.sin(u) * Math.sin(i);
  if (orbit.flip) {
    theta += Math.PI;
    z = -z;
  }
  return { thetaDeg: ((theta / DEG) % 360 + 360) % 360, rhoArcsec: rho, radiusArcsec: r, zArcsec: z, phase };
}

/** The pair's total mass by Kepler's third law (solar masses), at a parallax in milliarcseconds. */
export function pairMass(orbit: BinaryOrbit, parallaxMas: number): number {
  return (orbit.axisArcsec / (parallaxMas / 1000)) ** 3 / orbit.periodYears ** 2;
}

/** Arcseconds at a parallax (milliarcseconds) to AU. */
export const arcsecToAu = (arcsec: number, parallaxMas: number) => arcsec / (parallaxMas / 1000);

/** The next periastron passage after a Julian date (a Julian date). */
export function nextPeriastron(orbit: BinaryOrbit, jd: number): number {
  const periods = Math.ceil((besselYear(jd) - besselYear(orbit.periastronJd)) / orbit.periodYears);
  return besselJd(besselYear(orbit.periastronJd) + periods * orbit.periodYears);
}

/**
 * The secondary's place relative to the primary in the map's frame (equatorial, light-years: x toward
 * RA 0, y toward RA 90°, z toward the north celestial pole), from its position angle and separation on
 * the sky at the primary's place and its distance along the line of sight. `distanceLy` is the pair's.
 */
export function relativeVectorLy(place: PairPlace, raDeg: number, decDeg: number, distanceLy: number): [number, number, number] {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  const east = [-Math.sin(a), Math.cos(a), 0];
  const north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const out = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const k = (distanceLy * Math.PI) / (180 * 3600);
  const n = place.rhoArcsec * Math.cos(place.thetaDeg * DEG) * k;
  const e = place.rhoArcsec * Math.sin(place.thetaDeg * DEG) * k;
  const z = place.zArcsec * k;
  return [0, 1, 2].map((j) => n * north[j]! + e * east[j]! + z * out[j]!) as [number, number, number];
}

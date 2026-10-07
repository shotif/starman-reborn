import moonsFile from './generated/moons.json' with { type: 'json' };
import type { SourceRef } from './types.ts';

/**
 * The large moons of the giant planets (docs/PROCGEN.md §48): Io, Europa, Ganymede and Callisto round
 * Jupiter, Titan round Saturn, as JPL Horizons gives them (read by scripts/moons-process.ts from the
 * sky snapshot), and where each stands round its planet on a date: from the motion reckoned from
 * Horizons' own positions of it, a turning circle with its orbit's eccentricity to first order.
 */

export interface MoonMotion {
  /** Unit vectors in the J2000 ecliptic: the normal of the plane it orbits in, and where longitudes count from. */
  normal: [number, number, number];
  from: [number, number, number];
  /** Mean distance from the planet's centre (km). */
  aKm: number;
  /** Mean longitude on the snapshot's day, and mean motion (degrees, degrees a day). */
  lambdaDeg: number;
  motionDegPerDay: number;
  periodDays: number;
  /** Eccentricity, and the longitude of its nearest point to the planet (degrees), to first order. */
  e: number;
  periDeg: number;
}

export interface Moon {
  /** The game's id (`io`), Horizons' (`501`), and its name. */
  id: string;
  horizonsId: string;
  name: string;
  /** The planet it orbits (the game's id), and that planet's equatorial radius (km). */
  planet: 'jupiter' | 'saturn';
  planetRadiusKm: number;
  radiusKm: number;
  densityGcm3: number | null;
  albedo: number | null;
  motion: MoonMotion;
}

export interface MoonsDataset {
  generatedBy: string;
  retrieved: string;
  /** The day the motion's longitudes are given for (Julian date). */
  epochJd: number;
  source: SourceRef;
  description: string;
  moons: readonly Moon[];
}

export const MOON_DATA = moonsFile as unknown as MoonsDataset;

const BY_ID = new Map(MOON_DATA.moons.map((m) => [m.id, m]));

/** A moon of the giant planets by the game's id. */
export function moonOf(id: string): Moon | undefined {
  return BY_ID.get(id);
}

/** The moons round a planet, nearest first. */
export function moonsOf(planet: string): Moon[] {
  return MOON_DATA.moons.filter((m) => m.planet === planet).sort((a, b) => a.motion.aKm - b.motion.aKm);
}

export const MOON_EPOCH_JD = MOON_DATA.epochJd;

/** Earth's Moon's mean radius (km), from NASA's Moon fact sheet: the giant planets' moons are drawn on the scale it is drawn. */
export const MOON_RADIUS_KM = 1_737.4;

/** The axis of a giant planet as its moons show it: the mean of the normals of the planes they orbit in (J2000 ecliptic), or null without moons. */
export function planetPole(planet: string): [number, number, number] | null {
  const ms = moonsOf(planet);
  if (!ms.length) return null;
  const s = ms.reduce<[number, number, number]>((a, m) => [a[0] + m.motion.normal[0], a[1] + m.motion.normal[1], a[2] + m.motion.normal[2]], [0, 0, 0]);
  const n = Math.hypot(...s);
  return [s[0] / n, s[1] / n, s[2] / n];
}

const DEG = Math.PI / 180;

/** Where a moon stands from its planet's centre on a date (km, J2000 ecliptic). */
export function moonAt(moon: Moon, jd: number): [number, number, number] {
  const m = moon.motion;
  const L = (m.lambdaDeg + m.motionDegPerDay * (jd - MOON_EPOCH_JD)) * DEG;
  const anomaly = L - m.periDeg * DEG;
  const theta = L + 2 * m.e * Math.sin(anomaly);
  const r = m.aKm * (1 - m.e * Math.cos(anomaly));
  const [n, u] = [m.normal, m.from];
  const w: [number, number, number] = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [r * (c * u[0] + s * w[0]), r * (c * u[1] + s * w[1]), r * (c * u[2] + s * w[2])];
}

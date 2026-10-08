import { AU_KM } from './asteroids.ts';
import { hasSolarElements, heliocentric } from './solar.ts';
import type { SourceRef } from './types.ts';

/**
 * Earth's Moon (docs/PROCGEN.md §51): where it is from Earth's centre on a date, reckoned from JPL
 * Horizons' positions of it (read by scripts/lunar-process.ts from the sky snapshot) as its mean
 * longitude and series of periodic terms in the four fundamental arguments; how much of it is lit and
 * when it is next new, at a quarter or full; and NASA's eclipses of the Sun and the Moon.
 */

/** A periodic term: the multiples of D, M, M′ and F its argument takes, then its sine and cosine. */
export type LunarTerm = [number, number, number, number, number, number];
/** A constant and a drift (per Julian century from the snapshot's day), and the periodic terms. */
export interface LunarSeries {
  mean: [number, number];
  terms: readonly LunarTerm[];
}

/** An eclipse as NASA's decade table gives it (dates and times are Terrestrial Dynamical Time). */
export interface Eclipse {
  kind: 'solar' | 'lunar';
  date: string;
  td: string;
  jd: number;
  /** Total, Annular, Hybrid or Partial (of the Sun); Total, Partial or Penumbral (of the Moon). */
  type: string;
  saros: number;
  magnitude: number;
  /** As the table writes it: `06m23s` (the Sun's central phase), `03h29m 01h11m` (the Moon's partial phases, then totality). */
  duration: string | null;
  regions: string;
  /** For a central eclipse of the Sun, the countries on its path (`Total: Mexico, c US, e Canada`). */
  path: string | null;
  source: string;
}

export interface LunarDataset {
  generatedBy: string;
  retrieved: string;
  epochJd: number;
  /** The first and last of Horizons' positions reckoned from (Julian dates, TDB). */
  span: [number, number];
  sources: { horizons: SourceRef; arguments: SourceRef; eclipses: SourceRef };
  description: string;
  earthMoonMassRatio: number;
  radiusKm: number;
  /** The fundamental arguments M′, M, F, D and Ω (arcseconds; polynomials in T, Julian centuries of TDB from J2000). */
  arguments: Record<'Mp' | 'M' | 'F' | 'D' | 'Omega', readonly number[]>;
  longitude: LunarSeries;
  latitude: LunarSeries;
  distance: LunarSeries;
  eclipses: readonly Eclipse[];
}

const NOWHERE: LunarSeries = { mean: [0, 0], terms: [] };
/** The Moon: none until Sol's sky arrives (data/sky.ts, docs/PROCGEN.md §50), then Horizons'. */
export let LUNAR_DATA: LunarDataset = {
  generatedBy: '',
  retrieved: '',
  epochJd: 0,
  span: [0, 0],
  sources: { horizons: { label: '', url: '' }, arguments: { label: '', url: '' }, eclipses: { label: '', url: '' } },
  description: '',
  earthMoonMassRatio: 0,
  radiusKm: 0,
  arguments: { Mp: [], M: [], F: [], D: [], Omega: [] },
  longitude: NOWHERE,
  latitude: NOWHERE,
  distance: NOWHERE,
  eclipses: [],
};

/** Puts the Moon in place when Sol's sky arrives. */
export function installLunar(data: LunarDataset): void {
  LUNAR_DATA = data;
}

/** Whether the Moon's motion is in place (Sol's sky has arrived). */
export function hasLunar(): boolean {
  return LUNAR_DATA.longitude.terms.length > 0;
}

const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;
const TURN = 1_296_000;
const J2000 = 2_451_545;
/** The mean synodic month (days), only to step towards a phase: each is then found exactly. */
const SYNODIC = 29.530589;

function argument(c: readonly number[], T: number): number {
  return ((c[0]! + T * (c[1]! + T * (c[2]! + T * (c[3]! + T * c[4]!)))) % TURN) * ARCSEC;
}

function sum(s: LunarSeries, t: number, a: { D: number; M: number; Mp: number; F: number }): number {
  let v = s.mean[0] + s.mean[1] * t;
  for (const [d, m, mp, f, sn, cs] of s.terms) {
    const th = d * a.D + m * a.M + mp * a.Mp + f * a.F;
    v += sn * Math.sin(th) + cs * Math.cos(th);
  }
  return v;
}

/** Where the Moon is from Earth's centre: ecliptic longitude and latitude (degrees, J2000), distance (km), and as a vector (km). */
export interface MoonPlace {
  lonDeg: number;
  latDeg: number;
  distKm: number;
  xyz: [number, number, number];
}

/** Where the Moon is on a date (Julian, TDB), or null before Sol's sky has arrived. */
export function moonPlace(jd: number): MoonPlace | null {
  if (!hasLunar()) return null;
  const T = (jd - J2000) / 36_525;
  const t = (jd - LUNAR_DATA.epochJd) / 36_525;
  const g = LUNAR_DATA.arguments;
  const a = { D: argument(g.D, T), M: argument(g.M, T), Mp: argument(g.Mp, T), F: argument(g.F, T) };
  const mean = (a.F + argument(g.Omega, T)) / DEG;
  const lonDeg = ((((mean + sum(LUNAR_DATA.longitude, t, a)) % 360) + 360) % 360);
  const latDeg = sum(LUNAR_DATA.latitude, t, a);
  const distKm = sum(LUNAR_DATA.distance, t, a);
  const cl = Math.cos(latDeg * DEG);
  return { lonDeg, latDeg, distKm, xyz: [distKm * cl * Math.cos(lonDeg * DEG), distKm * cl * Math.sin(lonDeg * DEG), distKm * Math.sin(latDeg * DEG)] };
}

/**
 * Where the Sun is from Earth's centre (km, J2000 ecliptic): from JPL's elements for the Earth–Moon
 * barycentre (data/solar.ts), less Earth's own swing round it opposite the Moon. Null outside the
 * elements' years or before Sol's sky has arrived.
 */
export function sunFromEarth(jd: number): [number, number, number] | null {
  const moon = moonPlace(jd);
  if (!moon || !hasSolarElements(jd)) return null;
  const bary = heliocentric('earth', jd);
  const share = 1 / (1 + LUNAR_DATA.earthMoonMassRatio);
  return [0, 1, 2].map((i) => -(bary[i]! * AU_KM - share * moon.xyz[i]!)) as [number, number, number];
}

/** The Moon's phase on a date. */
export interface MoonPhase {
  /** How far the Moon is ahead of the Sun in ecliptic longitude (degrees, 0 at new, 180 at full). */
  elongationDeg: number;
  /** The angle at the Moon between the Sun and Earth (degrees, 0 at full). */
  phaseAngleDeg: number;
  /** The fraction of its disc lit, seen from Earth's centre. */
  lit: number;
  waxing: boolean;
}

/** The Moon's phase on a date, or null where the Sun or the Moon cannot be reckoned. */
export function moonPhase(jd: number): MoonPhase | null {
  const moon = moonPlace(jd);
  const sun = sunFromEarth(jd);
  if (!moon || !sun) return null;
  const sunLon = Math.atan2(sun[1], sun[0]) / DEG;
  const elongationDeg = ((((moon.lonDeg - sunLon) % 360) + 360) % 360);
  // At the Moon: towards Earth is −m, towards the Sun is s − m.
  const m = moon.xyz;
  const toSun = [sun[0] - m[0], sun[1] - m[1], sun[2] - m[2]];
  const cos = -(m[0] * toSun[0]! + m[1] * toSun[1]! + m[2] * toSun[2]!) / (moon.distKm * Math.hypot(toSun[0]!, toSun[1]!, toSun[2]!));
  const phaseAngleDeg = Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
  return { elongationDeg, phaseAngleDeg, lit: (1 + cos) / 2, waxing: elongationDeg < 180 };
}

/** The four phases, by the Moon's elongation from the Sun (degrees). */
export type PhaseName = 'new' | 'first quarter' | 'full' | 'last quarter';
export const PHASE_ELONGATION: Record<PhaseName, number> = { new: 0, 'first quarter': 90, full: 180, 'last quarter': 270 };

/**
 * The first time after a date (Julian, TDB) the Moon reaches a phase: stepped to by the mean
 * synodic month, then found where its elongation from the Sun is exactly the phase's. Null where it
 * cannot be reckoned.
 */
export function nextPhase(jd: number, phase: PhaseName): number | null {
  const now = moonPhase(jd);
  if (!now) return null;
  const want = PHASE_ELONGATION[phase];
  let ahead = (((want - now.elongationDeg) % 360) + 360) % 360;
  if (ahead < 1e-9) ahead = 360;
  let at = jd + (ahead / 360) * SYNODIC;
  for (let i = 0; i < 20; i++) {
    const p = moonPhase(at);
    if (!p) return null;
    const off = ((((p.elongationDeg - want) % 360) + 540) % 360) - 180;
    // The elongation grows about 12.19° a day; a few steps find it to well under a second.
    const step = -off / 12.190749;
    at += step;
    if (Math.abs(step) < 1e-7) break;
  }
  return at > jd ? at : null;
}

/** The eclipses from a date on (Julian, TDB), soonest first: of one kind, or both. */
export function eclipsesFrom(jd: number, kind?: Eclipse['kind']): Eclipse[] {
  return LUNAR_DATA.eclipses.filter((e) => e.jd >= jd && (!kind || e.kind === kind));
}

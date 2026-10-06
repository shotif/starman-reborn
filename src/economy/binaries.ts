import { BINARIES, BINARY_LINES, GRADE_WORD } from '../content/stellar/binaries.ts';
import { rng } from '../content/random.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { arcsecToAu, besselYear, nextPeriastron, ORBIT_EPOCH_JD, ORBITS, pairAt, pairMass, type BinaryOrbit } from '../data/orbits.ts';
import { getComponent, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';

/**
 * Binary orbits (docs/PROCGEN.md §44): what the game says of its pairs with catalogued orbits, on
 * the game's date, and the measurements research stations near them post. Every number comes from
 * the catalogue's elements and the date.
 */

/** A number of years as said: two decimals under ten, one under a hundred, else whole (with thousands). */
export function yearsText(years: number): string {
  return years < 10 ? years.toFixed(2) : years < 100 ? years.toFixed(1) : Math.round(years).toLocaleString('en-GB');
}

/** Arcseconds as said: three decimals under one, else two. */
export const arcsecText = (a: number) => (a < 1 ? a.toFixed(3) : a.toFixed(2));
/** AU as said: one decimal under a hundred, else whole. */
export const auText = (au: number) => (au < 100 ? au.toFixed(1) : Math.round(au).toLocaleString('en-GB'));

/** A Julian date as a day of the year, e.g. 6 October 2026. */
export function dateText(jd: number): string {
  return new Date((jd - 2_440_587.5) * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface PairFacts {
  orbit: BinaryOrbit;
  primary: string;
  secondary: string;
  /** `{secondary} orbits {primary} once every {period} years.` */
  headline: string;
  period: string;
  /** Semi-major axis on the sky and in AU. */
  axis: string;
  eccentricity: string;
  inclination: string;
  /** The next periastron, as a year. */
  periastron: string;
  grade: string;
  /** Their total mass by Kepler's third law (solar masses). */
  mass: string;
  /** On the date asked: separation on the sky and position angle, and how far apart they truly are. */
  now: string;
  /** In flight, the pair stands as it did when the orbits were taken. */
  scene: string;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fills a line about a pair (`{primary}`, `{secondary}`, `{system}`, `{period}`, `{epoch}`, `{giver}`). */
export function fillPair(text: string, orbit: BinaryOrbit, giver = ''): string {
  const values: Record<string, string> = {
    primary: getComponent(orbit.primary)!.name,
    secondary: getComponent(orbit.secondary)!.name,
    system: getSystem(orbit.systemId as SystemId).displayName,
    period: yearsText(orbit.periodYears),
    epoch: dateText(ORBIT_EPOCH_JD),
    giver,
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** What is said of a pair on a date (a Julian date: the game's, or the orbits' epoch). */
export function pairFacts(orbit: BinaryOrbit, jd: number): PairFacts {
  const primary = getComponent(orbit.primary)!;
  const plx = primary.parallaxMas;
  const at = pairAt(orbit, jd);
  return {
    orbit,
    primary: primary.name,
    secondary: getComponent(orbit.secondary)!.name,
    headline: fillPair(BINARY_LINES.orbit, orbit),
    period: `${yearsText(orbit.periodYears)} years`,
    axis: `${arcsecText(orbit.axisArcsec)}″ (${auText(arcsecToAu(orbit.axisArcsec, plx))} AU)`,
    eccentricity: orbit.eccentricity.toFixed(2),
    inclination: `${orbit.inclinationDeg.toFixed(1)}°`,
    periastron: String(Math.floor(besselYear(nextPeriastron(orbit, jd)))),
    grade: `${capital(GRADE_WORD[orbit.grade] ?? 'graded')} (${orbit.grade} of 5; 1 is the best)`,
    mass: `${pairMass(orbit, plx).toFixed(2)} times the Sun’s`,
    now: `${arcsecText(at.rhoArcsec)}″ apart on the sky at position angle ${Math.round(at.thetaDeg)}°; ${auText(arcsecToAu(at.radiusArcsec, plx))} AU apart in truth`,
    scene: fillPair(BINARY_LINES.scene, orbit),
  };
}

/** The pairs of a system with catalogued orbits, said on a date. */
export function systemPairs(systemId: string, jd: number): PairFacts[] {
  return ORBITS.pairs.filter((p) => p.systemId === systemId).map((p) => pairFacts(p, jd));
}

// ---------------------------------------------------------------- measurements

const jumpCache = new Map<SystemId, Map<SystemId, number>>();
function jumpsOf(systemId: SystemId): Map<SystemId, number> {
  let j = jumpCache.get(systemId);
  if (!j) jumpCache.set(systemId, (j = jumpsFrom(WORLD.links, systemId)));
  return j;
}

/** The pairs a station could have measured: research stations, pairs within reach. */
export function pairsWithinReach(locationId: string): { orbit: BinaryOrbit; jumps: number }[] {
  const loc = getLocation(locationId);
  if (loc.stationType !== 'research-station' || loc.status !== 'functional' || loc.dockable === false) return [];
  const jumps = jumpsOf(loc.systemId);
  return ORBITS.pairs
    .map((orbit) => ({ orbit, jumps: jumps.get(orbit.systemId as SystemId) ?? Infinity }))
    .filter((x) => x.jumps <= BINARIES.measure.reach);
}

/** The measurement a station posts in a time slot, if any (§44.5): from its own random stream. */
export function measureOffer(locationId: string, epoch: number): { orbit: BinaryOrbit; jumps: number } | null {
  const near = pairsWithinReach(locationId);
  if (!near.length) return null;
  const r = rng(WORLD_SEED, 'binaries', 'measure', locationId, epoch);
  if (r.next() >= BINARIES.measure.odds) return null;
  return r.pick(near);
}

/** What a measurement pays, so many jumps off. */
export function measureReward(jumps: number): number {
  return BINARIES.measure.reward + BINARIES.measure.perJump * jumps;
}

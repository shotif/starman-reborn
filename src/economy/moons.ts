import { MOON_LINES } from '../content/stellar/moons.ts';
import { MOON_DATA, moonAt, type Moon } from '../data/moons.ts';
import { hasSolarElements, heliocentric, type SolarPlanetId } from '../data/solar.ts';

/**
 * The large moons of the giant planets (docs/PROCGEN.md §48.4): what the game says of each on a date.
 * Every number is JPL Horizons'.
 */

const planetName = (moon: Moon) => moon.planet.charAt(0).toUpperCase() + moon.planet.slice(1);

/** Fills a line about a moon (`{moon}`, `{planet}`, `{period}`, `{distance}`, `{radii}`). */
export function fillMoonLine(text: string, moon: Moon): string {
  const values: Record<string, string> = {
    moon: moon.name,
    planet: planetName(moon),
    period: moon.motion.periodDays.toFixed(2),
    distance: (Math.round(moon.motion.aKm / 1_000) * 1_000).toLocaleString('en-GB'),
    radii: (moon.motion.aKm / moon.planetRadiusKm).toFixed(1),
  };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** Which side of its planet a moon is on, seen from the Sun, on a date (null without the planets' places). */
export function moonSide(moon: Moon, jd: number): string | null {
  if (!hasSolarElements(jd)) return null;
  const p = heliocentric(moon.planet as SolarPlanetId, jd);
  const m = moonAt(moon, jd);
  const cos = -(p[0] * m[0] + p[1] * m[1] + p[2] * m[2]) / (Math.hypot(...p) * Math.hypot(...m));
  return fillMoonLine(cos > 0.5 ? MOON_LINES.sunward : cos < -0.5 ? MOON_LINES.away : MOON_LINES.aside, moon);
}

export interface MoonFacts {
  moon: Moon;
  /** `{moon} goes round {planet} once every {period} days.` */
  headline: string;
  kind: string;
  period: string;
  distance: string;
  size: string;
  density: string | null;
  albedo: string | null;
  /** Which side of its planet it is on, on the date. */
  side: string | null;
  scene: string;
}

/** What is said of a moon on a date. */
export function moonFacts(moon: Moon, jd: number): MoonFacts {
  const hours = moon.motion.periodDays * 24;
  return {
    moon,
    headline: fillMoonLine(MOON_LINES.headline, moon),
    kind: `Moon of ${planetName(moon)}`,
    period: hours < 48 ? `${moon.motion.periodDays.toFixed(2)} days (${Math.round(hours)} hours)` : `${moon.motion.periodDays.toFixed(2)} days`,
    distance: fillMoonLine(MOON_LINES.distance, moon),
    size: `${Math.round(moon.radiusKm * 2).toLocaleString('en-GB')} km across`,
    density: moon.densityGcm3 !== null ? `${moon.densityGcm3.toFixed(2)} g/cm³ (water is 1)` : null,
    albedo: moon.albedo !== null ? `Reflects ${Math.round(moon.albedo * 100)}% of the light that falls on it` : null,
    side: moonSide(moon, jd),
    scene: fillMoonLine(MOON_LINES.scene, moon),
  };
}

/** Every moon, said on a date. */
export function allMoonFacts(jd: number): MoonFacts[] {
  return MOON_DATA.moons.map((m) => moonFacts(m, jd));
}

import * as THREE from 'three';
import checksFile from '../data/generated/moon-checks.json' with { type: 'json' };
import { MOON_LINES, MOONS } from '../content/stellar/moons.ts';
import type { Issue } from '../content/validate.ts';
import { MOON_DATA, MOON_EPOCH_JD, moonAt, moonsOf, planetPole, type Moon } from '../data/moons.ts';
import { codexEntries } from './progress.ts';
import { eclipticToScene, moonDistance, moonRadius } from '../world/systems/sol.ts';
import { sceneDefFor } from '../world/systems/index.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type MoonRules = typeof MOONS;

/** Horizons' positions of each moon from its planet's centre (by Horizons id), not used in reckoning its motion: [Julian date, x, y, z] in km. */
export const MOON_CHECKS = (checksFile as unknown as { positions: Record<string, [number, number, number, number][]> }).positions;

/** How closely the reckoned motion must match those positions (§48.2): the angle (degrees) and the distance (fraction). */
export const MOON_TOLERANCE = { deg: 1.5, fraction: 0.02 } as const;

/** How far the reckoned motion is from Horizons' positions of a moon: the worst angle (degrees) and distance (fraction). */
export function moonMisses(moon: Moon): { deg: number; fraction: number; checked: number } {
  const out = { deg: 0, fraction: 0, checked: 0 };
  for (const [jd, x, y, z] of MOON_CHECKS[moon.horizonsId] ?? []) {
    const truth = new THREE.Vector3(x, y, z);
    const got = new THREE.Vector3(...moonAt(moon, jd));
    out.checked++;
    out.deg = Math.max(out.deg, (got.angleTo(truth) * 180) / Math.PI);
    out.fraction = Math.max(out.fraction, Math.abs(got.length() - truth.length()) / truth.length());
  }
  return out;
}

/** The dates a scene is checked on: every 10 days for two years either side of the snapshot. */
export function moonSceneDates(): number[] {
  return Array.from({ length: 147 }, (_, i) => MOON_EPOCH_JD - 730 + i * 10);
}

/**
 * Moon guardrails (docs/PROCGEN.md §48.6): each moon named once, round a giant planet, smaller than it
 * and beyond twice its radius, its size, density and albedo sensible, its motion a unit plane turning
 * the right way at a sensible rate; the motion matching Horizons' positions it was not reckoned from;
 * in the codex; as drawn, larger for a larger moon, in its real direction from its planet on every
 * date checked, at its compressed distance, clear of its planet, its rings and the moons either side,
 * in their real order, and the planet's axis the one its moons orbit round; and no line with a number
 * of its own or a field it cannot fill.
 */
export function validateMoonRules(moons: readonly Moon[] = MOON_DATA.moons, rules: MoonRules = MOONS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const seen = new Set<string>();
  for (const m of moons) {
    if (seen.has(m.id) || m.id !== m.name.toLowerCase()) report('moons', m.id, 'named twice, or not by its name');
    seen.add(m.id);
    if (m.planet !== 'jupiter' && m.planet !== 'saturn') report('moons', m.id, `round ${m.planet}, not a giant planet of these`);
    if (!(m.radiusKm > 100 && m.radiusKm < m.planetRadiusKm / 10)) report('moons', m.id, `${m.radiusKm} km in radius`);
    if (m.densityGcm3 !== null && !(m.densityGcm3 > 0.5 && m.densityGcm3 < 6)) report('moons', m.id, `a density of ${m.densityGcm3}`);
    if (m.albedo !== null && !(m.albedo > 0 && m.albedo < 1.5)) report('moons', m.id, `an albedo of ${m.albedo}`);
    const mo = m.motion;
    const n = new THREE.Vector3(...mo.normal);
    const u = new THREE.Vector3(...mo.from);
    if (Math.abs(n.length() - 1) > 1e-6 || Math.abs(u.length() - 1) > 1e-6 || Math.abs(n.dot(u)) > 1e-6) report('motion', m.id, 'its plane is not a plane');
    if (!(mo.aKm > 2 * m.planetRadiusKm && mo.motionDegPerDay > 0 && Math.abs(360 / mo.motionDegPerDay - mo.periodDays) < 1e-4 * mo.periodDays && mo.e >= 0 && mo.e < 0.1))
      report('motion', m.id, 'a distance, motion, period or eccentricity out of range');
    // The motion against Horizons' positions it was not reckoned from.
    const miss = moonMisses(m);
    if (miss.checked < 300) report('ephemeris', m.id, `only ${miss.checked} of Horizons' positions to test against`);
    if (miss.deg > MOON_TOLERANCE.deg || miss.fraction > MOON_TOLERANCE.fraction) report('ephemeris', m.id, `${miss.deg.toFixed(2)}° and ${(miss.fraction * 100).toFixed(1)}% from Horizons`);
    if (!codexEntries().some((e) => e.id === m.id && e.systemId === 'sol')) report('codex', m.id, 'not in the codex');
  }
  if (!(Object.values(rules.spread).every((s) => s > 0 && s <= 1) && rules.clear >= 0)) report('rules', 'spread', 'a spread or clearance out of range');

  // As drawn.
  const base = sceneDefFor('sol', MOON_EPOCH_JD);
  const earthsMoon = base.planets.find((p) => p.id === 'moon')!;
  const bySize = [...moons].sort((a, b) => a.radiusKm - b.radiusKm);
  for (const [i, m] of bySize.entries()) if (i > 0 && moonRadius(earthsMoon.radius, m) < moonRadius(earthsMoon.radius, bySize[i - 1]!)) report('size', m.id, 'drawn smaller than a smaller moon');
  for (const planetId of ['jupiter', 'saturn']) {
    const planet = base.planets.find((p) => p.id === planetId)!;
    const own = moonsOf(planetId).filter((m) => moons.includes(m));
    const pole = planetPole(planetId);
    for (const m of own) {
      if (pole && (new THREE.Vector3(...pole).angleTo(new THREE.Vector3(...m.motion.normal)) * 180) / Math.PI > 1) report('pole', m.id, `orbits more than a degree off ${planetId}'s axis`);
      const r = moonRadius(earthsMoon.radius, m);
      if (r >= planet.radius) report('size', m.id, `drawn as large as ${planetId}`);
      const d = moonDistance(planet.radius, m);
      if (d - r < planet.radius + rules.clear || (planet.rings && d - r < planet.rings.outer + rules.clear)) report('scene', m.id, `drawn within ${planetId} or its rings`);
    }
    for (let i = 1; i < own.length; i++) {
      const [a, b] = [own[i - 1]!, own[i]!];
      if (moonDistance(planet.radius, b) - moonDistance(planet.radius, a) < moonRadius(earthsMoon.radius, a) + moonRadius(earthsMoon.radius, b) + rules.clear) report('scene', b.id, `its orbit drawn too near ${a.name}'s`);
    }
  }
  for (const jd of moonSceneDates()) {
    const def = sceneDefFor('sol', jd);
    for (const m of moons) {
      const d = def.planets.find((p) => p.id === m.id);
      const planet = def.planets.find((p) => p.id === m.planet);
      if (!d || !planet) {
        report('scene', `${m.id}@${jd}`, 'not drawn');
        continue;
      }
      const off = d.position.clone().sub(planet.position);
      if (off.angleTo(eclipticToScene(moonAt(m, jd))) > 0.01) report('scene', `${m.id}@${jd}`, 'not in its real direction from its planet');
      if (Math.abs(off.length() - moonDistance(planet.radius, m)) > 1) report('scene', `${m.id}@${jd}`, 'not at its drawn distance');
    }
  }

  // The lines.
  const fields = ['moon', 'planet', 'period', 'distance', 'radii'];
  for (const [k, line] of Object.entries(MOON_LINES)) {
    if (/\d/.test(line)) report('lines', k, `a number written into the line: “${line}”`);
    for (const [, key] of line.matchAll(/\{(\w+)\}/g)) if (!fields.includes(key!)) report('lines', k, `{${key}} it cannot fill`);
  }
  return issues;
}

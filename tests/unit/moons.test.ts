import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../../src/app/state.ts';
import { MOON_LINES, MOONS } from '../../src/content/stellar/moons.ts';
import { MOON_DATA, MOON_EPOCH_JD, moonAt, moonOf, moonsOf, planetPole } from '../../src/data/moons.ts';
import { julianDate } from '../../src/data/solar.ts';
import { MOON_TOLERANCE, moonMisses, validateMoonRules, type MoonRules } from '../../src/economy/moonGuards.ts';
import { moonFacts } from '../../src/economy/moons.ts';
import { catalogue, codexEntries, codexProgress, systemSurveyed } from '../../src/economy/progress.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { eclipticToScene } from '../../src/world/systems/sol.ts';

/**
 * The large moons of the giant planets (docs/PROCGEN.md §48): Horizons' moons, their guardrails, the
 * motion reckoned from Horizons' own positions (tested against the half it was not reckoned from, and
 * against the Laplace resonance of Io, Europa and Ganymede), the moons in flight on the game's date,
 * what is said of them, and the codex.
 */

const io = moonOf('io')!;
const titan = moonOf('titan')!;

describe('the moons', () => {
  it('are Horizons’ five, with their sizes from its records', () => {
    expect(MOON_DATA.moons.map((m) => m.name)).toEqual(['Io', 'Europa', 'Ganymede', 'Callisto', 'Titan']);
    expect(moonsOf('jupiter').map((m) => m.id)).toEqual(['io', 'europa', 'ganymede', 'callisto']);
    expect(moonsOf('saturn').map((m) => m.id)).toEqual(['titan']);
    expect(MOON_EPOCH_JD).toBe(julianDate(Date.parse(`${MOON_DATA.retrieved}T00:00:00Z`)));
    const header = (JSON.parse(readFileSync(`data/snapshot/orbits/${MOON_DATA.retrieved}/jpl-horizons-moon-elements-501.json`, 'utf8')) as { result: string }).result;
    expect(header).toContain(`Mean radius (km)       = ${io.radiusKm}`);
    expect(io.planetRadiusKm).toBe(71_492);
    expect([io.densityGcm3, io.albedo]).toEqual([3.528, 0.63]);
    expect(titan.densityGcm3).toBe(1.88);
  });

  it('pass their guardrails', () => {
    expect(validateMoonRules()).toEqual([]);
  });

  it('catch broken ones: a motion off Horizons, an eccentric orbit, a spread out of range, a line with a number', () => {
    const one = (m: typeof io) => validateMoonRules([m]).map((i) => i.rule);
    expect(one({ ...io, motion: { ...io.motion, lambdaDeg: io.motion.lambdaDeg + 5 } })).toContain('ephemeris');
    expect(one({ ...io, motion: { ...io.motion, e: 0.3 } })).toContain('motion');
    const rules = structuredClone(MOONS) as unknown as { spread: { jupiter: number } };
    rules.spread.jupiter = 2;
    expect(validateMoonRules([io], rules as unknown as MoonRules).map((i) => i.rule)).toContain('rules');
    const lines = MOON_LINES as unknown as { headline: string };
    const was = lines.headline;
    try {
      lines.headline = '{moon} goes round {planet} once every 2 days.';
      expect(validateMoonRules([io]).map((i) => i.rule)).toContain('lines');
    } finally {
      lines.headline = was;
    }
  });
});

describe('the motion', () => {
  it('matches every one of Horizons’ positions it was not reckoned from, within a degree and a half', () => {
    for (const m of MOON_DATA.moons) {
      const miss = moonMisses(m);
      expect(miss.checked, m.name).toBeGreaterThan(300);
      expect(miss.deg, m.name).toBeLessThan(MOON_TOLERANCE.deg);
      expect(miss.fraction, m.name).toBeLessThan(MOON_TOLERANCE.fraction);
    }
  });

  it('keeps the real physics: Io in 1.77 days, Titan in 15.95 on an orbit of eccentricity 0.029, and the Laplace resonance', () => {
    expect(io.motion.periodDays).toBeCloseTo(1.769, 3);
    expect(titan.motion.periodDays).toBeCloseTo(15.945, 3);
    expect(titan.motion.e).toBeCloseTo(0.0288, 3);
    // Io, Europa and Ganymede: λ(Io) − 3λ(Europa) + 2λ(Ganymede) stays at 180°, and their motions balance.
    const [eu, ga] = [moonOf('europa')!, moonOf('ganymede')!];
    expect(Math.abs(io.motion.motionDegPerDay - 3 * eu.motion.motionDegPerDay + 2 * ga.motion.motionDegPerDay)).toBeLessThan(5e-4);
    const lon = (m: typeof io, jd: number) => {
      const p = moonAt(m, jd);
      return (Math.atan2(p[1], p[0]) * 180) / Math.PI;
    };
    for (const jd of [MOON_EPOCH_JD - 700, MOON_EPOCH_JD, MOON_EPOCH_JD + 1_400]) {
      const L = (((lon(io, jd) - 3 * lon(eu, jd) + 2 * lon(ga, jd)) % 360) + 360) % 360;
      expect(Math.abs(L - 180)).toBeLessThan(1);
    }
    // A whole period brings one back.
    const a = moonAt(titan, MOON_EPOCH_JD);
    const b = moonAt(titan, MOON_EPOCH_JD + titan.motion.periodDays);
    a.forEach((x, i) => expect(Math.abs(b[i]! - x)).toBeLessThan(1));
  });
});

describe('in flight', () => {
  it('each moon stands in its real direction from its planet, Jupiter and Saturn turned to the axis their moons orbit round', () => {
    for (const jd of [MOON_EPOCH_JD, MOON_EPOCH_JD + 3.3, MOON_EPOCH_JD + 600]) {
      const def = sceneDefFor('sol', jd);
      for (const m of MOON_DATA.moons) {
        const drawn = def.planets.find((p) => p.id === m.id)!;
        const planet = def.planets.find((p) => p.id === m.planet)!;
        expect(drawn.position.clone().sub(planet.position).angleTo(eclipticToScene(moonAt(m, jd))), m.id).toBeLessThan(0.01);
        expect(drawn.scannable).toBe(true);
      }
    }
    const def = sceneDefFor('sol', MOON_EPOCH_JD);
    const saturn = def.planets.find((p) => p.id === 'saturn')!;
    expect(saturn.pole!.angleTo(eclipticToScene(planetPole('saturn')!))).toBeLessThan(1e-9);
    const t = def.planets.find((p) => p.id === 'titan')!;
    // Titan orbits in the plane of Saturn's rings, outside them.
    expect(Math.abs(t.position.clone().sub(saturn.position).normalize().dot(saturn.pole!))).toBeLessThan(0.01);
    expect(t.position.distanceTo(saturn.position) - t.radius).toBeGreaterThan(saturn.rings!.outer);
    // Without a date, too.
    expect(sceneDefFor('sol').planets.some((p) => p.id === 'io')).toBe(true);
  });
});

describe('what is said', () => {
  it('gives each moon’s period, distance, size, density and albedo from Horizons, and its side of its planet on the date', () => {
    const f = moonFacts(io, MOON_EPOCH_JD);
    expect(f.headline).toBe('Io goes round Jupiter once every 1.77 days.');
    expect(f.kind).toBe('Moon of Jupiter');
    expect(f.period).toBe('1.77 days (42 hours)');
    expect(f.distance).toBe('422,000 km from Jupiter’s centre (5.9 of its radii)');
    expect(f.size).toBe('3,643 km across');
    expect(f.density).toBe('3.53 g/cm³ (water is 1)');
    expect(f.albedo).toBe('Reflects 63% of the light that falls on it');
    expect([MOON_LINES.sunward, MOON_LINES.away, MOON_LINES.aside].map((l) => l.replace('{planet}', 'Jupiter'))).toContain(f.side);
    expect(moonFacts(titan, MOON_EPOCH_JD).headline).toBe('Titan goes round Saturn once every 15.95 days.');
  });
});

describe('the codex', () => {
  it('holds the five moons, so a survey of Sol wants them scanned too', () => {
    const ids = codexEntries().filter((e) => e.systemId === 'sol').map((e) => e.id);
    for (const m of MOON_DATA.moons) expect(ids).toContain(m.id);
    const s = createNewGame(3);
    for (const id of ids.filter((x) => !MOON_DATA.moons.some((m) => m.id === x))) catalogue(s, id);
    expect(systemSurveyed(s, 'sol')).toBe(false);
    for (const m of MOON_DATA.moons) expect(catalogue(s, m.id)).toBe(true);
    expect(catalogue(s, 'io')).toBe(false);
    expect(systemSurveyed(s, 'sol')).toBe(true);
    expect(codexProgress(s).total).toBe(codexEntries().length);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  equatorialToCartesian,
  parallaxToLightYears,
  propagatePosition,
} from '../../src/data/coords.ts';
import { ASTROMETRY, EXOPLANETS, SYSTEMS, getSystem } from '../../src/data/systems.ts';
import { reachableSystems, validateDataset } from '../../src/data/validate.ts';
import { findRoute, jumpFee } from '../../src/galaxy/routing.ts';
import type { StarSystemRecord } from '../../src/data/types.ts';

describe('coordinate conversion', () => {
  it('maps RA/Dec/distance onto the documented equatorial axes', () => {
    const [x, y, z] = equatorialToCartesian(0, 0, 1);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
    const north = equatorialToCartesian(123, 90, 2);
    expect(north[2]).toBeCloseTo(2, 12);
    const ra90 = equatorialToCartesian(90, 0, 3);
    expect(ra90[1]).toBeCloseTo(3, 12);
  });

  it('converts parallax to light-years', () => {
    // 1000 mas = 1 parsec = 3.26156 ly
    expect(parallaxToLightYears(1000)).toBeCloseTo(3.261564, 5);
    expect(() => parallaxToLightYears(0)).toThrow();
  });

  it('propagates proper motion linearly', () => {
    const moved = propagatePosition(10, 0, 0, 3_600_000, 2000, 2001);
    expect(moved.decDeg).toBeCloseTo(1, 9);
    expect(moved.raDeg).toBeCloseTo(10, 9);
  });
});

describe('bundled dataset', () => {
  it('passes validation with no errors', () => {
    const issues = validateDataset({ systems: SYSTEMS, astrometry: ASTROMETRY, exoplanets: EXOPLANETS });
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('keeps the five hand-authored systems first and adds the catalogue systems, all reachable from Sol', () => {
    expect(SYSTEMS.slice(0, 5).map((s) => s.id)).toEqual(['sol', 'alpha-centauri', 'barnard', 'sirius', 'epsilon-eridani']);
    expect(SYSTEMS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SYSTEMS.map((s) => s.id)).size).toBe(SYSTEMS.length);
    for (const id of ['tau-ceti', '61-cygni', 'procyon', 'wolf-359', 'gliese-876', 'altair']) expect(SYSTEMS.some((s) => s.id === id)).toBe(true);
    expect(reachableSystems(SYSTEMS, 'sol').size).toBe(SYSTEMS.length);
  });

  it('checks every star and planet against the archives, and grows the map with the systems they add', () => {
    expect(ASTROMETRY.verification).toBe('snapshot');
    expect(ASTROMETRY.stars.every((s) => s.verification === 'snapshot' && s.astrometrySource.retrieved)).toBe(true);
    const tauCeti = getSystem('tau-ceti');
    expect(tauCeti.distanceLightYears).toBeCloseTo(11.9, 1);
    expect(tauCeti.confirmedBodies.length).toBeGreaterThanOrEqual(2);
    expect(tauCeti.confirmedBodies.every((p) => p.sourceUrl.startsWith('https://'))).toBe(true);
    const gliese876 = getSystem('gliese-876');
    expect(gliese876.confirmedBodies.map((p) => p.displayName)).toEqual(expect.arrayContaining(['Gliese 876 b', 'Gliese 876 c']));
    expect(getSystem('altair').confirmedBodies).toEqual([]);
    const van = ASTROMETRY.stars.find((s) => s.id === 'van-maanens-star')!;
    expect(van.spectralType).toMatch(/^D/);
    expect(van.catalogIds.gaiaDr3 ?? van.catalogIds.hip).toBeTruthy();
    // The sky snapshot adds real systems the first catalogue missed, near and far.
    for (const id of ['teegardens-star', 'luhman-16', 'gj-581', 'hd-219134', 'vega', 'fomalhaut']) expect(SYSTEMS.some((s) => s.id === id), id).toBe(true);
    expect(SYSTEMS.length).toBeGreaterThan(150);
    expect(Math.max(...SYSTEMS.map((s) => s.distanceLightYears))).toBeLessThan(27.5);
  });

  it('keeps distances within the familiar published approximations', () => {
    expect(getSystem('alpha-centauri').distanceLightYears).toBeGreaterThan(4.2);
    expect(getSystem('alpha-centauri').distanceLightYears).toBeLessThan(4.45);
    expect(getSystem('barnard').distanceLightYears).toBeCloseTo(6, 0);
    expect(getSystem('sirius').distanceLightYears).toBeCloseTo(8.6, 1);
    expect(getSystem('epsilon-eridani').distanceLightYears).toBeCloseTo(10.5, 1);
  });

  it('keeps Proxima distinct from the Alpha Centauri A/B pair', () => {
    const a = ASTROMETRY.stars.find((s) => s.id === 'alpha-centauri-a')!;
    const proxima = ASTROMETRY.stars.find((s) => s.id === 'proxima-centauri')!;
    const sep = Math.hypot(
      a.positionLy[0] - proxima.positionLy[0],
      a.positionLy[1] - proxima.positionLy[1],
      a.positionLy[2] - proxima.positionLy[2],
    );
    // Proxima lies roughly 0.2 ly (about 13,000 AU) from A/B.
    expect(sep).toBeGreaterThan(0.1);
    expect(sep).toBeLessThan(0.3);
    expect(proxima.parentId).toBe('alpha-centauri-a');
  });

  it('keeps every planet it had, marks contested ones, and confirms Proxima b', () => {
    const provisional = [
      ...(JSON.parse(readFileSync('data/provisional/exoplanets-input.json', 'utf8')) as { planets: { archiveName: string }[] }).planets,
      ...(JSON.parse(readFileSync('data/provisional/catalog-exoplanets-input.json', 'utf8')) as { planets: { archiveName: string }[] }).planets,
    ];
    const ids = new Set(EXOPLANETS.planets.map((p) => p.id));
    for (const p of provisional) expect(ids.has(p.archiveName.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')), p.archiveName).toBe(true);
    expect(EXOPLANETS.planets.find((p) => p.archiveName === 'Proxima Cen b')?.status).toBe('confirmed');
    for (const p of EXOPLANETS.planets.filter((x) => x.status !== 'confirmed')) expect(p.statusNote, p.archiveName).toMatch(/archive|Encyclopaedia/i);
    expect(EXOPLANETS.planets.find((p) => p.id === 'tau-ceti-e')?.status).toBe('contested');
    const alphaCen = getSystem('alpha-centauri');
    expect(alphaCen.confirmedBodies.filter((p) => p.status === 'confirmed').every((p) => p.hostId === 'proxima-centauri')).toBe(true);
    expect(getSystem('sirius').confirmedBodies).toEqual([]);
  });

  it('flags every game location as fiction and has a functional dock in every system', () => {
    for (const s of SYSTEMS) {
      expect(s.fictionalLocations.every((l) => l.fictional === true)).toBe(true);
      expect(s.fictionalLocations.some((l) => l.status === 'functional' && l.services.length > 0)).toBe(true);
    }
  });
});

describe('validation catches broken data', () => {
  const clone = <T>(v: T): T => structuredClone(v) as T;

  it('detects an unreachable system and an asymmetric link', () => {
    const systems = clone(SYSTEMS) as StarSystemRecord[];
    const eps = systems.find((s) => s.id === 'epsilon-eridani')!;
    const sirius = systems.find((s) => s.id === 'sirius')!;
    sirius.jumpLinks = sirius.jumpLinks.filter((l) => l !== 'epsilon-eridani');
    const codes = validateDataset({ systems, astrometry: ASTROMETRY, exoplanets: EXOPLANETS }).map((i) => i.code);
    expect(codes).toContain('jump-asymmetric');
    eps.jumpLinks = [];
    for (const s of systems) s.jumpLinks = s.jumpLinks.filter((l) => l !== 'epsilon-eridani');
    const codes2 = validateDataset({ systems, astrometry: ASTROMETRY, exoplanets: EXOPLANETS }).map((i) => i.code);
    expect(codes2).toContain('unreachable');
  });

  it('detects bad ranges, missing parents, duplicate ids and candidate planets', () => {
    const astrometry = clone(ASTROMETRY);
    astrometry.stars[0]!.decDegrees = 123;
    astrometry.stars[2]!.parentId = 'nope';
    astrometry.stars.push({ ...astrometry.stars[1]! });
    const exoplanets = clone(EXOPLANETS);
    (exoplanets.planets[0] as { status: string; statusNote?: string }).status = 'candidate';
    delete (exoplanets.planets[0] as { statusNote?: string }).statusNote;
    exoplanets.planets[1]!.sourceUrl = 'http://insecure.example';
    const codes = validateDataset({ systems: SYSTEMS, astrometry, exoplanets }).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(['dec-range', 'companion-parent', 'duplicate-id', 'planet-status', 'source-url']),
    );
  });
});

describe('jump routing', () => {
  it('finds the direct link to Alpha Centauri with distance-based fee', () => {
    const route = findRoute(SYSTEMS, 'sol', 'alpha-centauri')!;
    expect(route.path).toEqual(['sol', 'alpha-centauri']);
    expect(route.totalDistanceLy).toBeCloseTo(getSystem('alpha-centauri').distanceLightYears, 9);
    expect(route.totalFee).toBe(jumpFee(route.totalDistanceLy));
  });

  it('routes to Epsilon Eridani through Sirius', () => {
    const route = findRoute(SYSTEMS, 'sol', 'epsilon-eridani')!;
    expect(route.path).toEqual(['sol', 'sirius', 'epsilon-eridani']);
    expect(route.hops).toHaveLength(2);
    expect(route.totalFee).toBe(route.hops[0]!.fee + route.hops[1]!.fee);
  });

  it('returns a zero-hop route to the current system and fees grow with distance', () => {
    expect(findRoute(SYSTEMS, 'barnard', 'barnard')!.hops).toHaveLength(0);
    expect(jumpFee(8)).toBeGreaterThan(jumpFee(4));
  });
});

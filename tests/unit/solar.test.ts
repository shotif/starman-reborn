import { describe, expect, it } from 'vitest';
import { eclipticLongitude, gameJulianDate, hasSolarElements, heliocentric, SOLAR, type SolarPlanetId } from '../../src/data/solar.ts';

/** The Solar System on the real date: JPL's elements held to JPL Horizons within JPL's stated accuracy. */
describe('the planets on the real date', () => {
  it('bundles the elements and the Horizons positions to check them', () => {
    expect(SOLAR.elements).not.toBeNull();
    expect(Object.keys(SOLAR.elements!)).toHaveLength(8);
    expect(SOLAR.checks!.length).toBeGreaterThanOrEqual(16);
  });

  it('puts every planet where Horizons does, within the accuracy JPL states for 1800–2050', () => {
    for (const c of SOLAR.checks!) {
      const [x, y, z] = heliocentric(c.body, c.jd);
      const [hx, hy, hz] = c.xyzAu;
      const lon = Math.atan2(y, x);
      const hlon = Math.atan2(hy, hx);
      let dLon = Math.abs(lon - hlon);
      if (dLon > Math.PI) dLon = 2 * Math.PI - dLon;
      const arcsec = (dLon * 180 * 3600) / Math.PI;
      const acc = SOLAR.accuracy![c.body]!;
      // Horizons is geometric and the elements are fitted: allow the stated error, doubled, plus light time.
      expect(arcsec, `${c.body} at JD ${c.jd}`).toBeLessThan(acc.lonArcsec * 2 + 60);
      const r = Math.hypot(x, y, z);
      const hr = Math.hypot(hx, hy, hz);
      // Distances within the stated error plus the Sun's wobble about the barycentre (under 1.5 million km);
      // the game uses only the directions.
      expect(Math.abs(r - hr) * 149_597_870.7, `${c.body} distance at JD ${c.jd}`).toBeLessThan(acc.distKm * 2 + 1_500_000);
    }
  });

  it('reads the game date from when the save began and the time played', () => {
    const jd = gameJulianDate('2025-01-01T00:00:00.000Z', 86_400)!;
    expect(jd).toBeCloseTo(2460677.5, 6);
    expect(gameJulianDate('not a date', 0)).toBeNull();
    expect(hasSolarElements(jd)).toBe(true);
    expect(hasSolarElements(gameJulianDate('2150-01-01T00:00:00.000Z', 0)!)).toBe(false);
  });

  it('moves the planets the right way round, faster nearer the Sun', () => {
    const jd = 2460676.5;
    const step = (b: SolarPlanetId) => ((eclipticLongitude(b, jd + 10) - eclipticLongitude(b, jd) + 540) % 360) - 180;
    const rates = (['mercury', 'venus', 'earth', 'mars', 'jupiter'] as const).map(step);
    for (const r of rates) expect(r).toBeGreaterThan(0);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThan(rates[i - 1]!);
  });
});

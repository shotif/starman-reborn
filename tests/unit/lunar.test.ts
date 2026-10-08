import { describe, expect, it } from 'vitest';
import { LUNAR, LUNAR_LINES } from '../../src/content/stellar/lunar.ts';
import { installLunar, LUNAR_DATA, moonPhase, moonPlace, nextPhase, type LunarDataset } from '../../src/data/lunar.ts';
import { validateLunar } from '../../src/data/validate.ts';
import { durationText, eclipseLine, eclipseNews, lunarFacts, placesText } from '../../src/economy/lunar.ts';
import { LUNAR_CHECKS, LUNAR_TOLERANCE, eclipseApart, lunarMisses, validateLunarRules } from '../../src/economy/lunarGuards.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { eclipticToScene } from '../../src/world/systems/sol.ts';

/**
 * Earth's Moon for real (docs/PROCGEN.md §51): where JPL Horizons has it round Earth, lit as it is,
 * its phases when the US Naval Observatory has them, and NASA's eclipses said in plain words.
 */
const jdOf = (iso: string) => Date.parse(iso) / 86_400_000 + 2_440_587.5;
const eclipse = (kind: 'solar' | 'lunar', date: string) => LUNAR_DATA.eclipses.find((e) => e.kind === kind && e.date === date)!;

describe('Earth’s Moon', () => {
  it('is Horizons’ Moon, cited and dated, its first terms the ones its theory has always had first', () => {
    expect(validateLunar(LUNAR_DATA)).toEqual([]);
    expect(LUNAR_DATA.earthMoonMassRatio).toBe(81.3005690769);
    expect(LUNAR_DATA.radiusKm).toBe(1737.4);
    const first = (s: LunarDataset['longitude'], n: number) => s.terms.slice(0, n).map((t) => t.slice(0, 4).join(' '));
    // The equation of the centre, the evection, the variation, the annual equation, the reduction to the ecliptic.
    expect(first(LUNAR_DATA.longitude, 6)).toEqual(['0 0 1 0', '2 0 -1 0', '2 0 0 0', '0 0 2 0', '0 1 0 0', '0 0 0 2']);
    expect(first(LUNAR_DATA.latitude, 4)).toEqual(['0 0 0 1', '0 0 1 1', '0 0 1 -1', '2 0 0 -1']);
    // The mean distance over the span: 385,000 km, as its theory has it.
    expect(LUNAR_DATA.distance.mean[0]).toBeCloseTo(385_000, -1);
  });

  it('passes every guardrail', () => {
    expect(validateLunarRules()).toEqual([]);
  });

  it('is where Horizons has it, within the span and for ten years after', () => {
    const within = lunarMisses(LUNAR_CHECKS.positions);
    expect(within.checked).toBeGreaterThan(4_000);
    expect(within.deg).toBeLessThan(LUNAR_TOLERANCE.deg);
    expect(within.km).toBeLessThan(LUNAR_TOLERANCE.km);
    const beyond = lunarMisses(LUNAR_CHECKS.beyond);
    expect(beyond.checked).toBeGreaterThan(360);
    expect(beyond.deg).toBeLessThan(LUNAR_TOLERANCE.beyondDeg);
    expect(beyond.km).toBeLessThan(LUNAR_TOLERANCE.beyondKm);
  });

  it('is lit as Horizons has it, and is new and full when USNO says', () => {
    // On the snapshot's day, a thin waning crescent: Horizons has it 7.99% lit at midnight.
    const snapshot = moonPhase(jdOf('2026-10-08T00:00:00Z'))!;
    expect(snapshot.lit * 100).toBeCloseTo(7.99, 0);
    expect(snapshot.waxing).toBe(false);
    for (const [jd, name] of LUNAR_CHECKS.phases.slice(0, 40)) {
      const phase = ({ 'New Moon': 'new', 'First Quarter': 'first quarter', 'Full Moon': 'full', 'Last Quarter': 'last quarter' } as const)[name as 'New Moon']!;
      expect(Math.abs(nextPhase(jd - 1, phase)! - jd) * 1_440).toBeLessThan(LUNAR_TOLERANCE.phaseMinutes);
    }
    const facts = lunarFacts(jdOf('2026-10-08T00:00:00Z'))!;
    expect(facts.headline).toBe('The Moon is a waning crescent, 8% lit.');
  });

  it('has NASA’s eclipses at new and full Moons, and says them in plain words', () => {
    const august = eclipse('solar', '2027-08-02');
    expect(eclipseApart(august)!).toBeLessThan(0.5);
    expect(eclipseLine(august)).toBe(
      'A total eclipse of the Sun on 2 August 2027: seen whole along a path across Morocco, Spain, Algeria, Libya, Egypt, Saudi Arabia, Yemen and Somalia, for up to 6 minutes 23 seconds, and in part across Africa, Europe, the Middle East and western and southern Asia.',
    );
    const newYear = eclipse('lunar', '2028-12-31');
    expect(eclipseApart(newYear)!).toBeLessThan(0.55);
    expect(eclipseLine(newYear)).toBe('A total eclipse of the Moon on 31 December 2028, seen from Europe, Africa, Asia, Australia and the Pacific: Earth’s shadow covers it whole for 1 hour 11 minutes.');
    expect(eclipseLine(eclipse('lunar', '2027-02-20'))).toBe('A penumbral eclipse of the Moon on 20 February 2027, seen from the Americas, Europe, Africa and Asia: it only dims a little, in Earth’s outer shadow.');
    expect(eclipseLine(eclipse('solar', '2028-07-22'))).toContain('along a path across Australia and New Zealand, for up to 5 minutes 10 seconds, and in part across South-East Asia, the East Indies, Australia and New Zealand.');
  });

  it('spells out NASA’s shorthand', () => {
    expect(placesText('w & s Asia, c US, C. & S. America')).toBe('western and southern Asia, the central United States and Central and South America');
    expect(placesText('s Indian Oc., E. Indies, Mid East')).toBe('the southern Indian Ocean, the East Indies and the Middle East');
    // NASA's table has a doubled comma, and spells Scandinavia its own way.
    expect(placesText('Americas, Europe, Africa,, Asia')).toBe('the Americas, Europe, Africa and Asia');
    expect(placesText('Arctic, Scandanavia, Alaska')).toBe('the Arctic, Scandinavia and Alaska');
    expect(placesText('n. China, s. India, N. Z., Dom.Rep.')).toBe('northern China, southern India, New Zealand and the Dominican Republic');
    expect(durationText('00m22s')).toBe('22 seconds');
    expect(durationText('01h00m')).toBe('1 hour');
  });

  it('catches a broken motion, an eclipse off its day, a place it cannot spell out and a line with a number', () => {
    const real = LUNAR_DATA;
    const broken = (data: LunarDataset) => {
      installLunar(data);
      try {
        return validateLunarRules().map((i) => i.rule);
      } finally {
        installLunar(real);
      }
    };
    const copy = structuredClone(real) as LunarDataset;
    expect(broken({ ...copy, longitude: { ...copy.longitude, mean: [copy.longitude.mean[0] + 0.05, copy.longitude.mean[1]] } })).toContain('motion');
    const moved = copy.eclipses.map((e, i) => (i === 3 ? { ...e, jd: e.jd + 2 } : e));
    expect(broken({ ...copy, eclipses: moved })).toContain('eclipse');
    const unknown = copy.eclipses.map((e, i) => (i === 0 ? { ...e, regions: `${e.regions}, x Mars` } : e));
    expect(broken({ ...copy, eclipses: unknown })).toContain('eclipse');
    expect(validateLunarRules(LUNAR_CHECKS, { ...LUNAR })).toEqual([]);
  });

  it('stands in Sol in its real direction from Earth, at its compressed distance, and moves with the date', () => {
    const at = (iso: string) => {
      const def = sceneDefFor('sol', jdOf(iso));
      const earth = def.planets.find((p) => p.id === 'earth')!;
      const moon = def.planets.find((p) => p.id === 'moon')!;
      return { def, offset: moon.position.clone().sub(earth.position), moon };
    };
    const a = at('2026-10-08T00:00:00Z');
    const b = at('2026-10-15T00:00:00Z');
    const real = eclipticToScene(moonPlace(jdOf('2026-10-08T00:00:00Z'))!.xyz).normalize();
    if (!a.def.scaleNote.includes(LUNAR_LINES.turned)) expect(a.offset.angleTo(real)).toBeLessThan(0.01);
    expect(a.offset.length()).toBeGreaterThan(LUNAR.drawn.distance * 0.9);
    // A week on, a quarter of the way round.
    expect((a.offset.angleTo(b.offset) * 180) / Math.PI).toBeGreaterThan(60);
    expect(a.moon.subtitle).toBe(LUNAR_LINES.target);
  });

  it('tells of an eclipse coming in the News at Sol’s stations', () => {
    const news = eclipseNews(jdOf('2027-07-19T00:00:00Z'));
    expect(news.map((n) => [n.eclipse.date, n.when])).toEqual([['2027-08-02', 'in 14 days'], ['2027-08-17', 'in 29 days']]);
    expect(news[0]!.line).toContain('A total eclipse of the Sun on 2 August 2027');
    expect(eclipseNews(jdOf('2027-08-02T08:00:00Z'))[0]!.when).toBe('today');
    expect(eclipseNews(jdOf('2026-10-08T00:00:00Z'))).toEqual([]);
  });
});

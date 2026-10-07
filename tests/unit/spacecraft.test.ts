import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../../src/app/state.ts';
import { CRAFT_LINES, CRAFT_STORIES, SPACECRAFT, type CraftStory } from '../../src/content/stellar/spacecraft.ts';
import { AU_KM, EARTH_RADIUS_KM } from '../../src/data/asteroids.ts';
import { twoBodyAt } from '../../src/data/kepler.ts';
import { CRAFT_DATA, CRAFT_EPOCH_JD, LIGHT_KMS, arcElements, craftAt, craftFromEarth, craftLeaving, craftOf, craftOn, craftSpeedKms, type Spacecraft } from '../../src/data/spacecraft.ts';
import { julianDate } from '../../src/data/solar.ts';
import { CRAFT_TOLERANCE, craftMisses, dateWritings, pathMisses, validateCraftRules, type CraftRules } from '../../src/economy/craftGuards.ts';
import { logbookOf, logBests, logText, noteCraft } from '../../src/economy/logbook.ts';
import { craftFacts, craftNews, hearsOfCraft } from '../../src/economy/spacecraft.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Spacecraft out in Sol (docs/PROCGEN.md §49): JPL Horizons' craft, their guardrails, the reckoning
 * of where each is (two-body arcs from Horizons' own positions and velocities, tested against every
 * one of its places, and paths from Earth's centre), the real physics it keeps, the craft in flight
 * on the game's date, what is said of them (every fact of a mission quoted from its source), the
 * News of a pass of Earth, and the logbook.
 */

const voyager1 = craftOf('voyager-1')!;
const at = (c: Spacecraft) => craftAt(c, CRAFT_EPOCH_JD)!;

describe('the spacecraft', () => {
  it('are Horizons’ eleven, named as Horizons names them, from its records and NSSDCA’s pages', () => {
    expect(CRAFT_DATA.spacecraft.map((c) => c.name)).toEqual(['Voyager 1', 'Voyager 2', 'Pioneer 10', 'Pioneer 11', 'New Horizons', 'Parker Solar Probe', 'James Webb Space Telescope', 'Lucy', 'Psyche', 'Europa Clipper', 'JUICE']);
    expect(CRAFT_EPOCH_JD).toBe(julianDate(Date.parse(`${CRAFT_DATA.retrieved}T00:00:00Z`)));
    const dir = `data/snapshot/orbits/${CRAFT_DATA.retrieved}`;
    const sun = (JSON.parse(readFileSync(`${dir}/jpl-horizons-craft-sun-31.json`, 'utf8')) as { result: string }).result;
    expect(sun).toContain('Target body name: Voyager 1 (spacecraft) (-31)');
    expect(readFileSync(`${dir}/nssdca-1977-084A.html`, 'utf8')).toContain('Launch Date:');
    // NSSDCA has no page on Europa Clipper or JUICE: their facts are quoted from Horizons' records.
    expect(CRAFT_DATA.spacecraft.filter((c) => !c.nssdca).map((c) => c.id)).toEqual(['europa-clipper', 'juice']);
    expect(Object.keys(CRAFT_STORIES).sort()).toEqual(CRAFT_DATA.spacecraft.map((c) => c.id).sort());
  });

  it('pass their guardrails', () => {
    expect(validateCraftRules()).toEqual([]);
  });

  it('catch broken ones: an arc off Horizons, a quotation not in its source, a date or a figure not in its quotation, a plan told as done, rules and lines out of range', () => {
    const rules = (c: Spacecraft, stories?: Record<string, CraftStory>, r?: CraftRules) => validateCraftRules([c], r, stories ?? { [c.id]: CRAFT_STORIES[c.id]! }).map((i) => i.rule);
    const arcs = voyager1.arcs.map((a) => [...a] as typeof a);
    arcs[0]![5] += 2;
    expect(rules({ ...voyager1, arcs })).toContain('ephemeris');
    const story = structuredClone(CRAFT_STORIES['voyager-1']!);
    story.events[0]!.quote = 'Voyager 1 then proceeded to Jupiter (making its closest approach on 06 March 1979)';
    expect(rules(voyager1, { 'voyager-1': story })).toContain('story');
    const dated = structuredClone(CRAFT_STORIES['voyager-1']!);
    dated.events[0]!.on = '1979-03-06';
    expect(rules(voyager1, { 'voyager-1': dated })).toContain('story');
    const figure = structuredClone(CRAFT_STORIES['pioneer-11']!);
    figure.events[0]!.line = 'Flew past Jupiter, within 42,000 km of its cloud tops';
    const p11 = craftOf('pioneer-11')!;
    expect(rules(p11, { 'pioneer-11': figure })).toContain('story');
    const clipper = craftOf('europa-clipper')!;
    const told = structuredClone(CRAFT_STORIES['europa-clipper']!);
    told.events[1]!.line = 'Swung past Earth';
    expect(rules(clipper, { 'europa-clipper': told })).toContain('story');
    const broken = structuredClone(SPACECRAFT) as unknown as { size: number };
    broken.size = 0;
    expect(rules(voyager1, undefined, broken as unknown as CraftRules)).toContain('rules');
    const lines = CRAFT_LINES as unknown as { headline: string };
    const was = lines.headline;
    try {
      lines.headline = '{craft} is 172 AU from the Sun.';
      expect(rules(voyager1)).toContain('lines');
    } finally {
      lines.headline = was;
    }
  });

  it('read a date the ways its sources write it', () => {
    expect(dateWritings('1980-11-12')).toEqual(expect.arrayContaining(['1980-Nov-12', '12 Nov. 1980', 'November 12, 1980', '12 November 1980', '1980-11-12']));
    expect(dateWritings('2019-01-01')).toContain('2019-Jan-1');
    expect(dateWritings('2031-07')).toContain('July, 2031');
  });
});

describe('the reckoning', () => {
  it('stands every craft within 0.1° and 0.2% of every one of Horizons’ places from the Sun, four days apart over the six years, and on its paths near Earth', () => {
    for (const c of CRAFT_DATA.spacecraft) {
      const miss = craftMisses(c);
      if (c.arcs.length) expect(miss.checked, c.name).toBeGreaterThan(90);
      expect(miss.deg, c.name).toBeLessThan(CRAFT_TOLERANCE.deg);
      expect(miss.fraction, c.name).toBeLessThan(CRAFT_TOLERANCE.fraction);
      const path = pathMisses(c);
      expect(path.deg, c.name).toBeLessThan(c.arcs.length ? CRAFT_TOLERANCE.pathDeg : CRAFT_TOLERANCE.wholeDeg);
    }
    // The James Webb Space Telescope never leaves Earth's neighbourhood: it is placed by its path alone.
    expect(craftOf('james-webb-space-telescope')!.arcs).toEqual([]);
  });

  it('keeps the real physics: the five leaving on open paths, Voyager 1 at 172 AU and 17 km/s, Parker Solar Probe on its 88-day orbit, Webb about 1.5 million km out, and the flybys as near as Horizons says', () => {
    for (const id of ['voyager-1', 'voyager-2', 'pioneer-10', 'pioneer-11', 'new-horizons']) expect(craftLeaving(craftOf(id)!, CRAFT_EPOCH_JD), id).toBe(true);
    for (const id of ['parker-solar-probe', 'lucy', 'psyche', 'europa-clipper', 'juice']) expect(craftLeaving(craftOf(id)!, CRAFT_EPOCH_JD), id).toBe(false);
    expect(at(voyager1).r).toBeGreaterThan(171);
    expect(at(voyager1).r).toBeLessThan(173);
    expect(craftSpeedKms(voyager1, CRAFT_EPOCH_JD)).toBeCloseTo(16.9, 0);
    // Its light first takes a full day to reach Earth in mid-November 2026.
    const lightDays = (iso: string) => (Math.hypot(...craftFromEarth(voyager1, julianDate(Date.parse(iso)))!) * AU_KM) / LIGHT_KMS / 86_400;
    expect(lightDays('2026-11-10T00:00:00Z')).toBeLessThan(1);
    expect(lightDays('2026-11-20T00:00:00Z')).toBeGreaterThan(1);
    // A hyperbola reckoned forward and back stays on its arc: a year on, Voyager 1 is 3.6 AU farther out.
    const year = twoBodyAt(arcElements(voyager1.arcs[0]!), CRAFT_EPOCH_JD + 365.25).r - at(voyager1).r;
    expect(year).toBeCloseTo(3.56, 1);
    const parker = craftOf('parker-solar-probe')!;
    const el = arcElements(parker.arcs.at(-1)!);
    expect(el.periodDays).toBeCloseTo(88, 0);
    expect(el.qAu * AU_KM).toBeGreaterThan(6.8e6);
    expect(el.qAu * AU_KM).toBeLessThan(7.0e6);
    const webb = craftOf('james-webb-space-telescope')!;
    for (let jd = webb.from; jd <= webb.to; jd += 30) {
      const km = Math.hypot(...craftFromEarth(webb, jd)!) * AU_KM;
      expect(km).toBeGreaterThan(1.0e6);
      expect(km).toBeLessThan(2.0e6);
    }
    // Lucy's second pass of Earth, 356 km above it (Horizons' record), and JUICE's of September 2026, 15,018 km from its centre.
    const lucy = craftOf('lucy')!.passes[0]!;
    expect(lucy.au * AU_KM - EARTH_RADIUS_KM).toBeGreaterThan(330);
    expect(lucy.au * AU_KM - EARTH_RADIUS_KM).toBeLessThan(380);
    expect(Math.abs(craftOf('juice')!.passes[0]!.au * AU_KM - 15_018.3)).toBeLessThan(5);
    // Outside the span Horizons has a craft for, it is nowhere: Psyche's trajectory ends in February 2029.
    const psyche = craftOf('psyche')!;
    expect(craftOn(psyche, psyche.to + 10)).toBe(false);
    expect(craftAt(psyche, psyche.to + 10)).toBeNull();
  });
});

describe('in flight', () => {
  it('each craft Horizons has stands in Sol: Voyager 1 far beyond Neptune, Webb by Earth, and none where Horizons has no place for it', () => {
    const def = sceneDefFor('sol', CRAFT_EPOCH_JD);
    expect(def.craft!.map((c) => c.id)).toEqual(CRAFT_DATA.spacecraft.map((c) => c.id));
    const neptune = def.planets.find((p) => p.id === 'neptune')!;
    const v1 = def.craft!.find((c) => c.id === 'voyager-1')!;
    expect(v1.position.length()).toBeGreaterThan(neptune.position.length() * 1.4);
    const webb = def.craft!.find((c) => c.id === 'james-webb-space-telescope')!;
    const earth = def.planets.find((p) => p.id === 'earth')!;
    expect(webb.near).toBe(true);
    expect(webb.position.distanceTo(earth.position)).toBeLessThan(def.planets.find((p) => p.id === 'moon')!.position.distanceTo(earth.position) * 4);
    const later = sceneDefFor('sol', craftOf('psyche')!.to + 30);
    expect(later.craft!.some((c) => c.id === 'psyche')).toBe(false);
    expect(later.craft!.some((c) => c.id === 'voyager-1')).toBe(true);
    // Without a date, on the snapshot's day.
    expect(sceneDefFor('sol').craft!.length).toBe(CRAFT_DATA.spacecraft.length);
  });
});

describe('what is said', () => {
  it('gives where it is, how far light takes, its path and its next pass from Horizons, and its mission’s facts as its sources give them', () => {
    const f = craftFacts(voyager1, CRAFT_EPOCH_JD);
    expect(f.headline).toBe('Voyager 1 is 172 AU from the Sun.');
    expect(f.kind).toBe('Spacecraft · NASA');
    expect(f.launched).toBe('5 September 1977');
    expect(f.light).toMatch(/^Light from Voyager 1 takes 23 hours \d+ minutes to reach Earth$/);
    expect(f.path).toBe(CRAFT_LINES.leaving);
    expect(f.done.map((e) => `${e.date}: ${e.line}`)).toContain('5 March 1979: Flew past Jupiter');
    expect(f.done.find((e) => e.line.startsWith('Crossed the heliopause'))!.source).toBe('JPL Horizons');
    expect(f.planned).toEqual([]);
    const juice = craftFacts(craftOf('juice')!, CRAFT_EPOCH_JD);
    expect(juice.kind).toBe('Spacecraft · ESA');
    expect(juice.planned.map((e) => `${e.date}: ${e.line}`)).toContain('July 2031: To reach Jupiter');
    expect(juice.plannedHeading).toBe('Planned, as JPL and NASA had it on 7 October 2026');
    const clipper = craftFacts(craftOf('europa-clipper')!, CRAFT_EPOCH_JD);
    expect(clipper.nextPass).toBe('3 December 2026, 9,600 km from Earth’s centre');
    expect(craftFacts(craftOf('parker-solar-probe')!, CRAFT_EPOCH_JD).path).toBe('Round the Sun once every 88 days, on its present path');
    const webb = craftFacts(craftOf('james-webb-space-telescope')!, CRAFT_EPOCH_JD);
    expect(webb.fromEarth).toMatch(/^1\.\d\d million km$/);
    expect(webb.light).toMatch(/takes \d\.\d seconds to reach Earth$/);
    // Where Horizons has no place for it, the card says so.
    const gone = craftFacts(craftOf('psyche')!, craftOf('psyche')!.to + 30);
    expect(gone.headline).toBeNull();
    expect(gone.away).toBe(CRAFT_LINES.away);
  });

  it('puts a pass of Earth within 60 days in the News at Sol’s stations', () => {
    const news = craftNews(CRAFT_EPOCH_JD);
    expect(news.map((n) => n.line)).toEqual(['JUICE passed Earth on 28 September 2026, 15,000 km from its centre', 'Europa Clipper passes Earth on 3 December 2026, 9,600 km from its centre']);
    expect(hearsOfCraft('earth-port')).toBe(true);
    expect(craftNews(CRAFT_EPOCH_JD + 400)).toEqual([]);
  });
});

describe('the logbook', () => {
  it('writes a craft’s first scan, and counts them', () => {
    const s = createNewGame(3);
    expect(noteCraft(s, 'voyager-1')).toBe(true);
    expect(noteCraft(s, 'voyager-1')).toBe(false);
    expect(noteCraft(s, 'voyager-9')).toBe(false);
    const book = logbookOf(s);
    expect(book.craft).toEqual(['voyager-1']);
    expect(logText(book.entries.at(-1)!)).toBe('First scan of Voyager 1.');
    expect(logBests(s).find((b) => b.key === 'craft')?.value).toBe('1');
  });
});

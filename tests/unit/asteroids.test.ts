import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { ASTEROID_LINES, ASTEROIDS } from '../../src/content/stellar/asteroids.ts';
import {
  ASTEROID_DATA,
  ASTEROID_EPOCH_JD,
  asteroidAt,
  asteroidDistanceFromEarth,
  asteroidMagnitude,
  asteroidOf,
  AU_KM,
  elementsOn,
  geocentricOnPath,
  orbitClassOn,
} from '../../src/data/asteroids.ts';
import { julianDate } from '../../src/data/solar.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { asteroidFacts, asteroidNews, hearsOfAsteroids, trackingJumps, trackOffer, trackReward, useGameStart } from '../../src/economy/asteroids.ts';
import { ASTEROID_TOLERANCE, asteroidMisses, pathClosest, validateAsteroidRules, type AsteroidRules } from '../../src/economy/asteroidGuards.ts';
import { boardFor, postedContracts } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs, describeObjective } from '../../src/economy/jobs.ts';
import { logbookOf, logText, noteAsteroid } from '../../src/economy/logbook.ts';
import { recordObservation } from '../../src/economy/stellar.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { asteroidRadius, eclipticToScene } from '../../src/world/systems/sol.ts';

/**
 * Named asteroids in Sol (docs/PROCGEN.md §47): JPL's asteroids, their guardrails, the reckoning of
 * where each stands (against Horizons' own positions), Apophis's pass of Earth in April 2029 and the
 * orbit it leaves it on, the asteroids in flight on the game's date, what is said of them, the News of
 * a pass, the tracking research stations near Sol post, and first scans in the logbook.
 */

afterEach(() => {
  useWorldLog(null);
  useGameStart(null);
});

const vesta = asteroidOf('asteroid-4')!;
const apophis = asteroidOf('asteroid-99942')!;
const ryugu = asteroidOf('asteroid-162173')!;
const jdOf = (iso: string) => julianDate(Date.parse(`${iso}T00:00:00Z`));
const flyby = apophis.approaches[0]!;

function pilotAt(locationId: string, clock: number): GameState {
  const s = createNewGame(9);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 10_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

describe('the asteroids', () => {
  it('are JPL’s fifteen, with Horizons’ elements on the snapshot’s day, the Small-Body Database’s measurements and JPL’s close approaches', () => {
    expect(ASTEROID_DATA.asteroids.map((a) => a.number)).toEqual(['1', '2', '4', '10', '16', '21', '243', '433', '951', '3200', '25143', '65803', '99942', '101955', '162173']);
    expect(ASTEROID_EPOCH_JD).toBe(jdOf(ASTEROID_DATA.retrieved));
    const dir = `data/snapshot/orbits/${ASTEROID_DATA.retrieved}`;
    const sbdb = JSON.parse(readFileSync(`${dir}/jpl-sbdb-a99942.json`, 'utf8')) as { object: { fullname: string }; phys_par: { name: string; value: string }[] };
    expect(apophis.fullname).toBe(sbdb.object.fullname.trim());
    expect(apophis.name).toBe('Apophis');
    expect(apophis.diameterKm).toBe(Number(sbdb.phys_par.find((p) => p.name === 'diameter')!.value));
    expect(apophis.rotationHours).toBe(Number(sbdb.phys_par.find((p) => p.name === 'rot_per')!.value));
    const horizons = (JSON.parse(readFileSync(`${dir}/jpl-horizons-elements-a4.json`, 'utf8')) as { result: string }).result;
    const row = horizons.slice(horizons.indexOf('$$SOE') + 5).trim().split('\n')[0]!.split(',').map((x) => x.trim());
    expect(Number(row[0])).toBe(ASTEROID_EPOCH_JD);
    expect(vesta.elements.e).toBe(Number(row[2]));
    expect(vesta.elements.qAu).toBe(Number(row[3]));
    // The close approaches, as JPL gives them.
    const cad = JSON.parse(readFileSync(`${dir}/jpl-cad-a99942.json`, 'utf8')) as { data: string[][] };
    expect(apophis.approaches).toHaveLength(1);
    expect(flyby.when).toBe(cad.data[0]![3]);
    expect(flyby.when).toBe('2029-Apr-13 21:46');
    expect(flyby.distAu).toBe(Number(cad.data[0]![4]));
    expect(ryugu.approaches.map((p) => p.when.slice(0, 11))).toEqual(['2033-Dec-21']);
    expect(ryugu.approaches[0]!.path).toBeUndefined();
    // The classes and flags.
    expect(vesta.orbitClass.code).toBe('MBA');
    expect([apophis.orbitClass.code, apophis.neo, apophis.pha]).toEqual(['ATE', true, true]);
    expect(asteroidOf('asteroid-433')!.orbitClass.code).toBe('AMO');
  });

  it('pass their guardrails', () => {
    expect(validateAsteroidRules()).toEqual([]);
  });

  it('catch broken ones: an orbit not bound, a period that disagrees, elements that miss Horizons, a class that disagrees, a near pass without its path, pay above the ceiling, a line with a number', () => {
    const one = (a: typeof vesta) => validateAsteroidRules([a]).map((i) => i.rule);
    const el = (change: Partial<typeof vesta.elements>) => one({ ...vesta, elements: { ...vesta.elements, ...change } });
    expect(el({ e: 1.2 })).toContain('elements');
    expect(el({ periodDays: vesta.elements.periodDays * 1.1 })).toContain('elements');
    expect(el({ nodeDeg: vesta.elements.nodeDeg + 20 })).toContain('ephemeris');
    expect(one({ ...apophis, orbitClass: { code: 'APO', name: 'Apollo' } })).toContain('class');
    expect(one({ ...apophis, approaches: [{ ...flyby, path: undefined }] })).toContain('approaches');
    expect(one({ ...apophis, approaches: [{ ...flyby, distAu: flyby.distAu * 1.5, distMaxAu: 1 }] })).toContain('approaches');
    const rules = (change: (r: { track: { odds: number; reward: number } }) => void) => {
      const r = structuredClone(ASTEROIDS) as unknown as { track: { odds: number; reward: number } };
      change(r);
      return validateAsteroidRules([vesta], r as unknown as AsteroidRules).map((i) => i.rule);
    };
    expect(rules((r) => (r.track.reward = 5_000))).toContain('track');
    expect(rules((r) => (r.track.odds = 1))).toContain('track');
    const lines = ASTEROID_LINES as unknown as { headline: string };
    const was = lines.headline;
    try {
      lines.headline = '{asteroid} goes round the Sun once every 3 years.';
      expect(validateAsteroidRules([vesta]).map((i) => i.rule)).toContain('lines');
    } finally {
      lines.headline = was;
    }
  });
});

describe('the reckoning', () => {
  it('matches Horizons within a tenth of a degree for a year either side of the snapshot, and within a degree and a half over six years', () => {
    for (const a of ASTEROID_DATA.asteroids) {
      const m = asteroidMisses(a);
      expect(m.checked, a.name).toBeGreaterThan(70);
      expect(m.nearDeg, a.name).toBeLessThan(ASTEROID_TOLERANCE.nearDeg);
      expect(m.nearFraction, a.name).toBeLessThan(ASTEROID_TOLERANCE.nearFraction);
      expect(m.farDeg, a.name).toBeLessThan(ASTEROID_TOLERANCE.farDeg);
      expect(m.farFraction, a.name).toBeLessThan(ASTEROID_TOLERANCE.farFraction);
    }
  });

  it('follows Apophis past Earth on 13 April 2029, 38,000 km from its centre, and on the orbit the pass leaves it on', () => {
    const near = pathClosest(apophis, flyby.jd)!;
    expect(Math.round((near.au * AU_KM) / 1_000)).toBe(38);
    expect(Math.abs(near.jd - flyby.jd) * 24).toBeLessThan(0.1);
    expect(geocentricOnPath(apophis, flyby.jd - 30)).toBeNull();
    // Before the pass an Aten, a year of 324 days; after it an Apollo, a year of 423.
    expect(orbitClassOn(apophis, flyby.jd - 1)).toBe('ATE');
    expect(orbitClassOn(apophis, flyby.jd + 1)).toBe('APO');
    expect(Math.round(elementsOn(apophis, flyby.jd - 1).periodDays)).toBe(324);
    expect(Math.round(elementsOn(apophis, flyby.jd + 1).periodDays)).toBe(423);
    // Bright enough to see with the naked eye as it nears, far too faint for that now.
    expect(asteroidMagnitude(apophis, flyby.jd - 0.1)!).toBeLessThan(4);
    expect(asteroidMagnitude(apophis, ASTEROID_EPOCH_JD)!).toBeGreaterThan(19);
    expect(asteroidDistanceFromEarth(apophis, flyby.jd)! * AU_KM).toBeLessThan(39_000);
    // Vesta, the brightest of them, is in binoculars' reach.
    expect(asteroidMagnitude(vesta, ASTEROID_EPOCH_JD)!).toBeLessThan(8);
    // A whole year brings one back.
    const later = asteroidAt(vesta, ASTEROID_EPOCH_JD + vesta.elements.periodDays).xyz;
    asteroidAt(vesta, ASTEROID_EPOCH_JD).xyz.forEach((x, i) => expect(later[i]).toBeCloseTo(x, 6));
  });

  it('is said with every number from JPL’s records and the date', () => {
    const v = asteroidFacts(vesta, ASTEROID_EPOCH_JD);
    expect(v.headline).toBe('Vesta goes round the Sun once every 3.63 years.');
    expect(v.orbitClass).toBe('Main-belt asteroid');
    expect(v.size).toBe('About 523 km across');
    expect(v.shape).toBe('569.24 × 554.48 × 452.66 km');
    expect(v.spectral).toBe('Type V: basaltic, like Vesta’s crust');
    expect(v.rotation).toBe('Once every 5.3 hours');
    expect(v.hazardous).toBeNull();
    expect(v.nextPass).toBeNull();
    expect(v.now).toMatch(/^\d\.\d\d AU from the Sun; \d\.\d\d AU from Earth$/);
    const a = asteroidFacts(apophis, ASTEROID_EPOCH_JD);
    expect(a.size).toBe('About 340 m across');
    expect(a.nextPass).toBe('13 April 2029: 38,000 km from Earth’s centre, at 7.4 km/s');
    expect(a.change).toBe('Its pass of Earth on 13 April 2029 will change its orbit: from then on it will be an Apollo asteroid: near Earth, crossing its orbit from outside.');
    expect(a.hazardous).toContain('within 0.05 AU of Earth’s');
    const after = asteroidFacts(apophis, flyby.jd + 30);
    expect(after.change).toBe('Its pass of Earth on 13 April 2029 changed its orbit: it is now an Apollo asteroid: near Earth, crossing its orbit from outside.');
    expect(after.headline).toBe('Apophis goes round the Sun once every 1.16 years.');
    expect(after.nextPass).toBeNull();
    expect(asteroidFacts(apophis, flyby.jd - 0.1).now).toMatch(/AU from the Sun; [\d,]+ km from Earth$/);
    // On the pass's own path, and within two years of the elements after it, it is sure of where it is.
    expect(asteroidFacts(apophis, flyby.jd).unsure).toBeNull();
    expect(asteroidFacts(apophis, flyby.jd + 500).unsure).toBeNull();
    expect(asteroidFacts(apophis, flyby.jd - 10).unsure).toBe(ASTEROID_LINES.unsure);
    expect(asteroidFacts(vesta, ASTEROID_EPOCH_JD + 3_000).unsure).toBe(ASTEROID_LINES.unsure);
  });
});

describe('in flight', () => {
  it('each asteroid stands in its real direction from the Sun on the game’s date, drawn larger for a larger one, never as large as the Moon', () => {
    for (const jd of [ASTEROID_EPOCH_JD, ASTEROID_EPOCH_JD + 400, ASTEROID_EPOCH_JD + 900]) {
      const def = sceneDefFor('sol', jd);
      expect(def.asteroids).toHaveLength(ASTEROID_DATA.asteroids.length);
      for (const d of def.asteroids!) {
        expect(d.near, d.id).toBe(false);
        expect(d.position.angleTo(eclipticToScene(asteroidAt(asteroidOf(d.id)!, jd).xyz)), d.id).toBeLessThan(0.01);
      }
    }
    const moon = sceneDefFor('sol', ASTEROID_EPOCH_JD).planets.find((p) => p.id === 'moon')!;
    expect(asteroidRadius(asteroidOf('asteroid-1')!)).toBeLessThan(moon.radius);
    expect(asteroidRadius(vesta)).toBeGreaterThan(asteroidRadius(apophis));
  });

  it('Apophis passes Earth in its real direction from it, nearer than the Moon is drawn at its nearest', () => {
    const def = sceneDefFor('sol', flyby.jd);
    const earth = def.planets.find((p) => p.id === 'earth')!;
    const moon = def.planets.find((p) => p.id === 'moon')!;
    const d = def.asteroids!.find((a) => a.id === apophis.id)!;
    expect(d.near).toBe(true);
    expect(d.position.distanceTo(earth.position)).toBeLessThan(moon.position.distanceTo(earth.position));
    expect(d.position.distanceTo(earth.position)).toBeGreaterThan(earth.radius + d.radius);
    expect(d.position.clone().sub(earth.position).angleTo(eclipticToScene(geocentricOnPath(apophis, flyby.jd)!))).toBeLessThan(0.01);
    // A month on, back out among the planets.
    expect(sceneDefFor('sol', flyby.jd + 30).asteroids!.find((a) => a.id === apophis.id)!.near).toBe(false);
  });
});

describe('the News', () => {
  it('tells of a pass of Earth, only within its window, at Sol’s stations and research stations within reach', () => {
    expect(asteroidNews(ASTEROID_EPOCH_JD)).toEqual([]);
    const before = asteroidNews(jdOf('2029-03-20'));
    expect(before.map((n) => n.asteroid.id)).toEqual([apophis.id]);
    expect(before[0]!.passed).toBe(false);
    expect(before[0]!.detail).toBe('Apophis passes 38,000 km from Earth’s centre on 13 April 2029, at 7.4 km/s.');
    const after = asteroidNews(jdOf('2029-05-01'))[0]!;
    expect(after.passed).toBe(true);
    expect(after.headline).toBe('Apophis has passed Earth');
    expect(asteroidNews(jdOf('2029-01-01'))).toEqual([]);
    expect(asteroidNews(jdOf('2033-12-01')).map((n) => n.asteroid.id)).toEqual([ryugu.id]);
    expect(asteroidNews(jdOf('2033-12-01'))[0]!.detail).toContain('0.047 AU from Earth’s centre');
    expect(hearsOfAsteroids('earth-port')).toBe(true);
    expect(hearsOfAsteroids('ledger-institute')).toBe(true);
    const far = ALL_LOCATIONS.find((l) => l.systemId === 'procyon' && l.stationType !== 'research-station')!;
    expect(hearsOfAsteroids(far.id)).toBe(false);
  });
});

describe('tracking', () => {
  const research = ALL_LOCATIONS.filter((l) => trackingJumps(l.id) !== null);

  it('is posted by research stations near Sol, passes the contract guardrails, and pays for positions taken in Sol in time', () => {
    const giver = getLocation('ledger-institute');
    const epoch = Array.from({ length: 200 }, (_, i) => i + 3).find((e) => trackOffer(giver.id, e, null))!;
    const offer = trackOffer(giver.id, epoch, null)!;
    expect(offer.asteroid.neo).toBe(true);
    const clock = epoch * CONTRACTS.epochSeconds + 30;
    const s = pilotAt(giver.id, clock);
    const job = boardFor(giver.id, epoch).find((c) => c.contract?.asteroid === offer.asteroid.id)!;
    expect(job).toBeDefined();
    expect(job.title).toBe(`Track ${offer.asteroid.name}`);
    expect(job.reward).toBe(trackReward(offer.jumps));
    expect(contractIssues(job, clock)).toEqual([]);
    expect(postedContracts(s, giver.id).some((c) => c.id === job.id)).toBe(true);
    expect(acceptJob(s, job.id).ok).toBe(true);
    s.location = { ...s.location, dockedAt: null };
    recordObservation(s, offer.asteroid.id, 'wolf-359' as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: 'wolf-359' as SystemId })).toEqual([]);
    s.location = { ...s.location, systemId: 'sol' as SystemId };
    expect(describeObjective(s, job.id)).toMatchObject({ targetId: `asteroid:${offer.asteroid.id}` });
    recordObservation(s, offer.asteroid.id, 'sol' as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: 'sol' as SystemId }).map((e) => e.kind)).toEqual(['objective']);
    const credits = s.credits;
    s.location = { ...s.location, systemId: giver.systemId };
    expect(dockAt(s, giver.id).jobEvents.some((e) => e.kind === 'complete')).toBe(true);
    expect(s.credits - credits).toBe(job.reward);
    assertValidState(s);
  });

  it('near Apophis’s pass, every station that posts tracking wants Apophis, and says why', () => {
    // A save begun on 1 March 2029: its boards' slots fall in the weeks before the pass.
    useGameStart('2029-03-01T00:00:00.000Z');
    let seen = 0;
    for (const l of research)
      for (let epoch = 0; epoch < 60; epoch++) {
        const job = boardFor(l.id, epoch).find((c) => c.contract?.asteroid);
        if (!job) continue;
        seen++;
        expect(job.contract!.asteroid).toBe(apophis.id);
        expect(job.briefing).toContain('passes Earth on 13 April 2029');
        expect(contractIssues(job, epoch * CONTRACTS.epochSeconds), job.id).toEqual([]);
      }
    expect(seen).toBeGreaterThan(5);
  });

  it('comes about as often as the rules say, only at research stations within reach, every one sound', () => {
    expect(research.length).toBeGreaterThanOrEqual(3);
    let posted = 0;
    let slots = 0;
    for (const l of research)
      for (let epoch = 0; epoch < 120; epoch++) {
        slots++;
        const job = boardFor(l.id, epoch).find((c) => c.contract?.asteroid);
        if (!job) continue;
        posted++;
        expect(contractIssues(job, epoch * CONTRACTS.epochSeconds), job.id).toEqual([]);
      }
    expect(posted / slots).toBeGreaterThan(ASTEROIDS.track.odds - 0.08);
    expect(posted / slots).toBeLessThan(ASTEROIDS.track.odds + 0.08);
    expect(trackingJumps('earth-port')).toBeNull();
  });
});

describe('the logbook', () => {
  it('writes an asteroid’s first scan once, counts them in the bests, and a save with them stays sound', () => {
    const s = pilotAt('earth-port', 100);
    expect(noteAsteroid(s, apophis.id)).toBe(true);
    expect(noteAsteroid(s, apophis.id)).toBe(false);
    expect(noteAsteroid(s, 'asteroid-0')).toBe(false);
    const book = logbookOf(s);
    expect(book.asteroids).toEqual([apophis.id]);
    expect(logText(book.entries.at(-1)!)).toBe('First scan of 99942 Apophis.');
    assertValidState(s);
    book.asteroids!.push('asteroid-0');
    expect(() => assertValidState(s)).toThrow();
  });
});

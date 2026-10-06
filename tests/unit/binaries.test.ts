import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { BINARIES, BINARY_LINES } from '../../src/content/stellar/binaries.ts';
import { ALL_LOCATIONS, getComponent, getLocation } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { besselJd, besselYear, nextPeriastron, ORBIT_EPOCH_JD, ORBITS, orbitOf, orbitsIn, pairAt, pairMass } from '../../src/data/orbits.ts';
import { measureOffer, measureReward, pairFacts, pairsWithinReach } from '../../src/economy/binaries.ts';
import { validateBinaries, type BinaryRules } from '../../src/economy/binaryGuards.ts';
import { boardFor, postedContracts } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs, describeObjective } from '../../src/economy/jobs.ts';
import { recordObservation } from '../../src/economy/stellar.ts';
import { crowdedCompanions } from '../../src/world/systems/generated.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Binary orbits (docs/PROCGEN.md §44): the orbits taken from the Sixth Orbit Catalog, their
 * guardrails, the reckoning of where each pair stands (against the catalogue's own predictions), the
 * pairs in flight as they stood when the orbits were taken, what is said of them, and the
 * measurements research stations post.
 */

afterEach(() => useWorldLog(null));

const sirius = orbitOf('sirius-b')!;
const alphaCen = orbitOf('alpha-centauri-b')!;

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

describe('the orbits', () => {
  it('are the catalogue’s, for twenty-two of the game’s pairs, a pair whose elements no such stars could have left out', () => {
    expect(ORBITS.pairs).toHaveLength(22);
    expect(ORBITS.source.label).toBe('Sixth Catalog of Orbits of Visual Binary Stars (ORB6)');
    expect(ORBITS.left).toEqual([expect.objectContaining({ pair: 'gj-896-a/gj-896-b' })]);
    // The raw catalogue line, as fetched, gives Sirius's elements.
    const raw = readFileSync(`data/snapshot/orbits/${ORBITS.retrieved}/orb6-orbits.txt`, 'latin1').split(/\r?\n/).find((l) => l.slice(19, 29) === '06451-1643' && l.slice(30, 44).trimEnd() === 'AGC   1AB')!;
    expect(raw).toContain('50.1284');
    expect(raw).toContain('7.4957');
    expect(sirius).toMatchObject({ periodYears: 50.1284, axisArcsec: 7.4957, grade: 2, reference: 'BdH2017' });
    expect(orbitsIn('alpha-centauri').map((o) => o.secondary)).toEqual(['alpha-centauri-b']);
    // A pair the game names the other way round from the catalogue.
    expect(orbitOf('gj-66-b')?.flip).toBe(true);
  });

  it('pass their guardrails', () => {
    expect(validateBinaries()).toEqual([]);
  });

  it('catch broken ones: a poor grade, an impossible eccentricity, an orbit too wide for its stars, elements that miss the catalogue’s predictions, pay above the ceiling, a line with a number', () => {
    const rules = (change: (r: { -readonly [K in keyof BinaryRules['measure']]: number }) => void) => {
      const r = structuredClone(BINARIES) as unknown as { measure: { -readonly [K in keyof BinaryRules['measure']]: number } };
      change(r.measure);
      return validateBinaries(ORBITS.pairs, r as unknown as BinaryRules).map((i) => i.rule);
    };
    const pair = (change: Partial<typeof sirius>) => validateBinaries([{ ...sirius, ...change }]).map((i) => i.rule);
    expect(pair({ grade: 5 })).toContain('grade');
    expect(pair({ eccentricity: 1.2 })).toContain('elements');
    expect(pair({ axisArcsec: sirius.axisArcsec * 10 })).toContain('mass');
    expect(pair({ nodeDeg: sirius.nodeDeg + 20 })).toContain('ephemeris');
    expect(pair({ secondary: 'procyon-b' })).toContain('pairs');
    expect(rules((m) => (m.reward = 5_000))).toContain('measure');
    expect(rules((m) => (m.odds = 1))).toContain('measure');
    const lines = BINARY_LINES as unknown as { orbit: string };
    const was = lines.orbit;
    try {
      lines.orbit = '{secondary} orbits {primary} every 50 years.';
      expect(validateBinaries().map((i) => i.rule)).toContain('lines');
    } finally {
      lines.orbit = was;
    }
  });
});

describe('the reckoning', () => {
  it('matches the catalogue’s own predictions, and turns about for a pair named the other way', () => {
    const at = pairAt(sirius, besselJd(2026));
    expect(at.thetaDeg).toBeCloseTo(57.1, 0);
    expect(at.rhoArcsec).toBeCloseTo(11.163, 2);
    expect(pairAt(alphaCen, besselJd(2027)).rhoArcsec).toBeCloseTo(9.765, 2);
    const gj66 = orbitOf('gj-66-b')!;
    const asCatalogued = pairAt({ ...gj66, flip: undefined }, ORBIT_EPOCH_JD);
    const asGame = pairAt(gj66, ORBIT_EPOCH_JD);
    expect(asGame.rhoArcsec).toBeCloseTo(asCatalogued.rhoArcsec, 9);
    expect((asGame.thetaDeg - asCatalogued.thetaDeg + 360) % 360).toBeCloseTo(180, 6);
    expect(asGame.zArcsec).toBeCloseTo(-asCatalogued.zArcsec, 9);
  });

  it('gives the physics of real pairs: Alpha Centauri’s two Suns’ worth of mass and its next periastron in the 2030s', () => {
    const a = getComponent('alpha-centauri-a')!;
    expect(pairMass(alphaCen, a.parallaxMas)).toBeGreaterThan(1.8);
    expect(pairMass(alphaCen, a.parallaxMas)).toBeLessThan(2.3);
    const next = besselYear(nextPeriastron(alphaCen, ORBIT_EPOCH_JD));
    expect(next).toBeGreaterThan(2034);
    expect(next).toBeLessThan(2037);
    // Over a whole period the pair comes back where it was.
    const then = pairAt(sirius, ORBIT_EPOCH_JD);
    const later = pairAt(sirius, besselJd(besselYear(ORBIT_EPOCH_JD) + sirius.periodYears));
    expect(later.thetaDeg).toBeCloseTo(then.thetaDeg, 6);
    expect(later.rhoArcsec).toBeCloseTo(then.rhoArcsec, 6);
  });

  it('is said with every number from the elements and the date', () => {
    const f = pairFacts(sirius, besselJd(2026));
    expect(f.headline).toBe('Sirius B orbits Sirius A once every 50.1 years.');
    expect(f.now).toMatch(/^11\.16″ apart on the sky at position angle 57°; \d+\.\d AU apart in truth$/);
    expect(f.grade).toBe('Good (2 of 5; 1 is the best)');
    expect(f.scene).toBe('In flight the pair stands as it did on 6 October 2026, its separation compressed.');
  });
});

describe('in flight', () => {
  it('each secondary stands in its real direction as the orbits were taken, crowding nothing that is not its own', () => {
    for (const o of ORBITS.pairs) {
      const def = sceneDefFor(o.systemId as SystemId);
      expect(crowdedCompanions(def), o.systemId).toEqual([]);
    }
    // Alpha Centauri: B where its orbit had it; ships arrive clear of it, and the lane to Proxima too.
    const def = sceneDefFor('alpha-centauri');
    const b = def.stars.find((s) => s.id === 'alpha-centauri-b')!;
    expect(def.arrival.position.distanceTo(b.position) - b.radius).toBeGreaterThan(12_000);
    const lane = def.lanes[0]!;
    expect(new THREE.Line3(lane.from, lane.to).closestPointToPoint(b.position, true, new THREE.Vector3()).distanceTo(b.position)).toBeGreaterThan(b.radius * 3);
  });
});

describe('measurements', () => {
  const research = ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false);
  const giver = research.find((l) => pairsWithinReach(l.id).length > 0)!;

  it('are posted by research stations near a pair, now and then, pass the contract guardrails, and pay for a reading taken there in time', () => {
    const epoch = Array.from({ length: 200 }, (_, i) => i + 3).find((e) => measureOffer(giver.id, e))!;
    const offer = measureOffer(giver.id, epoch)!;
    const clock = epoch * CONTRACTS.epochSeconds + 30;
    const s = pilotAt(giver.id, clock);
    const job = boardFor(giver.id, epoch).find((c) => c.contract?.pair === offer.orbit.secondary)!;
    expect(job).toBeDefined();
    expect(job.title).toBe(`Measure ${getComponent(offer.orbit.secondary)!.name}`);
    expect(job.reward).toBe(measureReward(offer.jumps));
    expect(contractIssues(job, clock)).toEqual([]);
    expect(postedContracts(s, giver.id).some((c) => c.id === job.id)).toBe(true);
    expect(acceptJob(s, job.id).ok).toBe(true);
    s.location = { ...s.location, dockedAt: null };
    expect(describeObjective(s, job.id)).toMatchObject({ targetSystemId: offer.orbit.systemId });
    // Elsewhere, or too late, a reading counts for nothing.
    const other = offer.orbit.systemId === 'sol' ? 'alpha-centauri' : 'sol';
    recordObservation(s, offer.orbit.secondary, other as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: other as SystemId })).toEqual([]);
    recordObservation(s, offer.orbit.secondary, offer.orbit.systemId as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: offer.orbit.systemId as SystemId }).map((e) => e.kind)).toEqual(['objective']);
    const credits = s.credits;
    expect(dockAt(s, giver.id).jobEvents.some((e) => e.kind === 'complete')).toBe(true);
    expect(s.credits - credits).toBe(job.reward);
    assertValidState(s);
  });

  it('come about as often as the rules say, only at research stations within reach, every one sound', () => {
    let posted = 0;
    let slots = 0;
    for (const l of research) {
      if (!pairsWithinReach(l.id).length) continue;
      for (let epoch = 0; epoch < 120; epoch++) {
        slots++;
        const job = boardFor(l.id, epoch).find((c) => c.contract?.pair);
        if (!job) continue;
        posted++;
        expect(contractIssues(job, epoch * CONTRACTS.epochSeconds), job.id).toEqual([]);
      }
    }
    expect(posted / slots).toBeGreaterThan(BINARIES.measure.odds - 0.08);
    expect(posted / slots).toBeLessThan(BINARIES.measure.odds + 0.08);
    const port = ALL_LOCATIONS.find((l) => l.stationType === 'trade-port')!;
    expect(pairsWithinReach(port.id)).toEqual([]);
  });
});

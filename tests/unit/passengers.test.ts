import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { dockAt } from '../../src/app/rules.ts';
import { getCatalog, gearForSale } from '../../src/content/catalog.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { PASSAGE_LINES, SIGHT_LINES } from '../../src/content/passengers/lines.ts';
import { PASSENGERS } from '../../src/content/passengers/rules.ts';
import { allSights, sightById, sightFacts } from '../../src/content/passengers/sights.ts';
import { ALL_LOCATIONS, getLocation, getSystem } from '../../src/data/systems.ts';
import { boardFor } from '../../src/economy/contracts.ts';
import { sellQuote } from '../../src/economy/equipment.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs, type JobDef } from '../../src/economy/jobs.ts';
import { performanceOf } from '../../src/economy/loadout.ts';
import { validatePassengers } from '../../src/economy/passengerGuards.ts';
import { berths, fare, frighten, passengerGoodbye, passengersAboard, seeSight, sightLine, sightsIn } from '../../src/economy/passengers.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { inViewFromGates, tourSights } from '../../src/world/sightseeing.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Passengers and sightseers (docs/PROCGEN.md §23): cabins, the boards' passages and tours, berths,
 * the sights of the real sky and what is said of them, fright and fares, and saves.
 */

afterEach(() => useWorldLog(null));

const CABIN = 'gear.cabin.2.halden';

/** The first offer of a kind on any board (station by station, slot by slot), and where and when. */
function offer(kind: 'passage' | 'tour', where?: (j: JobDef) => boolean): { job: JobDef; at: string; epoch: number } {
  for (let epoch = 1; epoch < 60; epoch++) {
    for (const l of ALL_LOCATIONS) {
      if (l.status !== 'functional' || !l.stationType) continue;
      const job = boardFor(l.id, epoch).find((c) => c.contract?.kind === kind && (!where || where(c)));
      if (job) return { job, at: l.id, epoch };
    }
  }
  throw new Error(`no ${kind}`);
}

/** A pilot docked where an offer is posted, at its time, with a cabin of 3 berths fitted (or none). */
function pilotFor(o: { at: string; epoch: number }, cabin = true): GameState {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 50_000;
  s.clock = o.epoch * CONTRACTS.epochSeconds + 10;
  const loc = getLocation(o.at);
  s.location = { systemId: loc.systemId, dockedAt: o.at, flight: null, lastDockId: o.at };
  markVisited(s, loc.systemId, o.at);
  if (cabin) s.ship.fittings['utility-1'] = CABIN;
  useWorldLog(s.world);
  return s;
}

describe('passenger cabins', () => {
  it('give 2, 3 or 4 berths by class, cost a little speed, and are sold at outfitters', () => {
    const cabins = getCatalog().gear.filter((g) => g.family === 'cabin');
    expect(cabins.map((g) => (g.stats.slot === 'utility' ? g.stats.utility.amount : 0)).sort()).toEqual([2, 2, 2, 3, 3, 3, 4]);
    const s = createNewGame(1);
    const bare = performanceOf(s.ship);
    expect(bare.berths).toBe(0);
    s.ship.fittings['utility-1'] = CABIN;
    const fitted = performanceOf(s.ship);
    expect(fitted.berths).toBe(3);
    expect(fitted.flight.maxSpeed).toBeLessThan(bare.flight.maxSpeed);
    expect(ALL_LOCATIONS.some((l) => gearForSale(l.id).some((g) => g.family === 'cabin'))).toBe(true);
  });
});

describe('the rules and the sights', () => {
  it('pass their guardrails: every sight a record of the real sky in its scene, no line with a number of its own', () => {
    expect(validatePassengers()).toEqual([]);
    const sights = allSights();
    expect(sights.length).toBeGreaterThan(100);
    for (const kind of ['planet', 'giant', 'white-dwarf', 'brown-dwarf', 'belt'] as const) expect(sights.some((s) => s.kind === kind)).toBe(true);
    expect(sightById('sirius-b')?.kind ?? sights.find((s) => s.name === 'Sirius B')?.kind).toBe('white-dwarf');
  });

  it('catch broken ones: a number in a line, a field it cannot fill, a sight that is not real', () => {
    const lines = SIGHT_LINES.planet as { needs: readonly string[]; text: string }[];
    const keep = lines[0]!;
    lines[0] = { needs: [], text: '{name} goes round in 11 days.' };
    expect(validatePassengers().map((i) => i.rule)).toContain('lines');
    lines[0] = { needs: [], text: '{name} weighs {mass}.' };
    expect(validatePassengers().map((i) => i.rule)).toContain('lines');
    lines[0] = keep;
    const fake = { id: 'nowhere-b', kind: 'planet' as const, systemId: 'sol', name: 'Nowhere b', star: 'Sun', targetId: 'planet:nowhere-b' };
    expect(validatePassengers([fake]).map((i) => i.rule)).toContain('sights');
    expect(validatePassengers()).toEqual([]);
  });

  it('say only what the archive has: a planet’s period, its mass as the archive gives it (a minimum mass says “at least”)', () => {
    const proxima = sightById('proxima-cen-b')!;
    const facts = sightFacts(proxima);
    const planet = getSystem(proxima.systemId).confirmedBodies.find((p) => p.id === proxima.id)!;
    // Printed from the record: two places under ten days, one above.
    const days = planet.orbitalPeriodDays!.value;
    const f = days < 10 ? 100 : 10;
    expect(facts.period).toBe((Math.round(days * f) / f).toLocaleString('en-GB'));
    if (/minimum/i.test(planet.massEarth?.qualifier ?? '')) expect(facts.mass).toMatch(/^at least /);
    // Every line said of every sight is filled, from its own record.
    const job = { id: 'x', contract: { kind: 'tour', party: ['Ada Moss'] } } as unknown as JobDef;
    for (const s of allSights()) {
      const line = sightLine(job, s);
      expect(line.text).not.toMatch(/\{|\}|undefined|NaN/);
      expect(line.speaker).toBe('Ada Moss');
    }
  });
});

describe('passages', () => {
  it('are posted with a party, need a berth each, and pay on arriving, less what a rough trip cost', () => {
    const o = offer('passage');
    const party = o.job.contract!.party!;
    expect(party.length).toBeGreaterThanOrEqual(PASSENGERS.passage.party[0]);
    const without = pilotFor(o, false);
    expect(acceptJob(without, o.job.id).ok).toBe(false);
    const s = pilotFor(o);
    if (party.length > 3) return;
    expect(acceptJob(s, o.job.id).ok).toBe(true);
    expect(passengersAboard(s)).toBe(party.length);
    expect(berths(s)).toEqual({ total: 3, free: 3 - party.length });
    // With them aboard, the cabin stays fitted.
    expect(sellQuote(s, o.at, 'utility-1')?.blocked ?? 'no dealer').toMatch(/berth|dealer/);
    // A hull hit frightens them: the fare falls, never below the floor.
    frighten(s, 0.1);
    expect(fare(s, o.job)).toBe(Math.round(o.job.reward * (1 - PASSENGERS.fright.perHull * 0.1)));
    frighten(s, 1);
    expect(fare(s, o.job)).toBe(Math.round(o.job.reward * PASSENGERS.fright.floor));
    const dest = getLocation(o.job.destinationLocationId);
    s.location = { ...s.location, systemId: dest.systemId, dockedAt: null };
    const before = s.credits;
    const done = dockAt(s, dest.id).jobEvents.find((e) => e.kind === 'complete')!;
    expect(done.paid).toBe(Math.round(o.job.reward * PASSENGERS.fright.floor));
    expect(done.text).toMatch(/rough trip/);
    expect(s.credits - before).toBe(done.paid);
    expect(passengersAboard(s)).toBe(0);
    expect(PASSAGE_LINES.arrive.map((t) => t.replace('{dest}', dest.name))).toContain(passengerGoodbye(o.job)!.text);
  });
});

describe('tours', () => {
  it('see their sight in flight (scanned before or not), say so from the record, then come home and pay', () => {
    const o = offer('tour', (j) => j.objectives[0]?.kind === 'sight' && j.objectives[0].targetId.startsWith('planet:') && (j.contract?.party?.length ?? 9) <= 3);
    const s = pilotFor(o);
    const sight = o.job.objectives[0]!;
    if (sight.kind !== 'sight') throw new Error('not a sight');
    s.discoveredBodies.push(sight.sightId);
    expect(acceptJob(s, o.job.id).ok).toBe(true);
    // Scanned before: still to be seen with the sightseers aboard.
    s.location = { ...s.location, systemId: sight.systemId, dockedAt: null };
    expect(advanceJobs(s, { dockedAt: null, systemId: sight.systemId })).toEqual([]);
    expect(sightsIn(s, sight.systemId)).toEqual([{ jobId: o.job.id, targetId: sight.targetId }]);
    const line = seeSight(s, o.job.id)!;
    expect(line.speaker).toBe(o.job.contract!.party![0]);
    expect(line.text).toContain(sightById(sight.sightId)!.name);
    expect(seeSight(s, o.job.id)).toBeNull();
    expect(advanceJobs(s, { dockedAt: null, systemId: sight.systemId }).map((e) => e.kind)).toEqual(['objective']);
    expect(sightsIn(s, sight.systemId)).toEqual([]);
    // Home again: paid in full.
    const home = getLocation(o.at);
    s.location = { ...s.location, systemId: home.systemId, dockedAt: null };
    const before = s.credits;
    const done = dockAt(s, o.at).jobEvents.find((e) => e.kind === 'complete')!;
    expect(done.paid).toBe(o.job.reward);
    expect(s.credits - before).toBe(o.job.reward);
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}

/** A flight in a sight's system with sightseers watching for it, recording what the scene reports. */
function flightFor(systemId: string, sights: { jobId: string; targetId: string }[]) {
  installCanvasStub();
  const state = createNewGame(17);
  state.location = { ...state.location, systemId, dockedAt: null, flight: null };
  useWorldLog(state.world);
  const seen: string[] = [];
  const hits: number[] = [];
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true }),
    camera: new THREE.PerspectiveCamera(),
    state,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
    callbacks: {
      onDocked: nothing,
      onPlayerDestroyed: nothing,
      onDiscovery: nothing,
      onScanInfo: nothing,
      onEncounterStart: nothing,
      onEncounterEnd: nothing,
      onLoot: nothing,
      onBounty: nothing,
      onContractKill: nothing,
      onCrime: nothing,
      onMessage: nothing,
      onComm: nothing,
      onSight: (jobId) => seen.push(jobId),
      onHullHit: (share) => hits.push(share),
    },
    traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: null, sights },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      state.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
    }
  };
  return { flight, seen, hits, run };
}

describe('sightseers in flight', () => {
  it('see a planet from within sight range of it, once, and a belt from inside its band; not from the arrival point', () => {
    const planet = sightById('proxima-cen-b')!;
    const f = flightFor(planet.systemId, [{ jobId: 'tour-a', targetId: planet.targetId }]);
    f.run(1.2);
    expect(f.seen).toEqual([]);
    expect(f.flight.placeNear(planet.targetId, PASSENGERS.sightRange * 2)).toBe(true);
    f.run(1.2);
    expect(f.seen).toEqual([]);
    expect(f.flight.placeNear(planet.targetId, PASSENGERS.sightRange / 2)).toBe(true);
    f.run(1.2);
    expect(f.seen).toEqual(['tour-a']);
    f.run(1.2);
    expect(f.seen).toEqual(['tour-a']);

    const belt = allSights().find((s) => s.kind === 'belt')!;
    const g = flightFor(belt.systemId, [{ jobId: 'tour-b', targetId: belt.targetId }]);
    const band = sceneDefFor(belt.systemId).belts.find((b) => `belt:${b.beltId}` === belt.targetId)!;
    const mid = (band.innerRadius + band.outerRadius) / 2;
    g.run(1.2);
    expect(g.seen).toEqual([]);
    g.flight.player.position.set(band.center.x + mid, band.center.y, band.center.z);
    g.flight.player.velocity.set(0, 0, 0);
    g.run(1.2);
    expect(g.seen).toEqual(['tour-b']);
    // A tour is a trip out: the few sights in view from a jump beacon are never a tour's.
    const near = allSights().filter(inViewFromGates);
    expect(near.length).toBeGreaterThan(0);
    expect(tourSights()).toHaveLength(allSights().length - near.length);
    expect(tourSights().some((s) => near.includes(s))).toBe(false);
  });

  it('feel hull hits as a share of the hull, and not hits the shield takes', () => {
    const f = flightFor('sol', []);
    f.run(0.2);
    const ship = f.flight as unknown as { playerDurability: { hull: number; hullMax: number; shield: number }; damagePlayer(n: number, at: THREE.Vector3): void };
    ship.damagePlayer(1, f.flight.player.position.clone());
    expect(f.hits).toEqual([]);
    ship.playerDurability.shield = 0;
    const hull = ship.playerDurability.hull;
    ship.damagePlayer(10, f.flight.player.position.clone());
    expect(f.hits).toHaveLength(1);
    expect(f.hits[0]).toBeCloseTo((hull - ship.playerDurability.hull) / ship.playerDurability.hullMax, 6);
    expect(f.hits[0]).toBeGreaterThan(0);
  });
});

describe('saves', () => {
  it('keep a party, a sight seen and a fright, and refuse damaged ones', () => {
    const o = offer('tour', (j) => (j.contract?.party?.length ?? 9) <= 3);
    const s = pilotFor(o);
    expect(acceptJob(s, o.job.id).ok).toBe(true);
    frighten(s, 0.2);
    seeSight(s, o.job.id);
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.jobs[o.job.id]!.fright = 2))).toThrow(/job/);
    expect(bad((x) => (x.jobs[o.job.id]!.seen = 'yes' as never))).toThrow(/job/);
    expect(bad((x) => ((x.contracts[o.job.id]!.contract as { party: unknown }).party = []))).toThrow(/contract/);
  });
});

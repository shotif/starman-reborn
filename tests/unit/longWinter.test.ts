import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { dockAt, discoverBody } from '../../src/app/rules.ts';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { ARC_JOBS } from '../../src/content/story/arcs.ts';
import { STAND } from '../../src/content/story/stand.ts';
import { findBelt, getLocation } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { acceptJob, advanceJobs, currentObjective, deliverJob, escortArrived, escortLost, escortsIn, getJob, handOver, jobsAt, rescuesIn, standLost, standsIn, standWon } from '../../src/economy/jobs.ts';
import { checkMilestones } from '../../src/economy/progress.ts';
import { arcStatus, briefingFor, debriefFor, makeChoice, pendingBeats } from '../../src/economy/story.ts';
import { validateMarks, validateStory } from '../../src/economy/storyGuards.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';

/**
 * The Long Winter (docs/PROCGEN.md §40): Sol's belt crews' arc played through every way, its marks
 * on Deimos Depot, its new objectives (a belt scanned close, a rescue in a belt, a stand) in a real
 * FlightSession in node, and saves.
 */

function pilot(): GameState {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  return s;
}

function dock(s: GameState, locationId: string) {
  s.location.systemId = getLocation(locationId).systemId;
  return dockAt(s, locationId).jobEvents;
}

function inSpace(s: GameState, systemId: SystemId) {
  s.location.systemId = systemId;
  s.location.dockedAt = null;
  return advanceJobs(s, { dockedAt: null, systemId });
}

const done = (s: GameState, id: string) => s.jobs[id]?.status === 'complete';
const words = (s: GameState, inFlight = false) => pendingBeats(s, inFlight).flatMap((b) => b.lines.map((l) => l.text)).join(' ');

/** Through the third step, to the choice in hand at Deimos Depot. */
function toTheChoice(s: GameState) {
  dock(s, 'mars-depot');
  expect(jobsAt(s, 'mars-depot').map((o) => o.job.id)).toContain('arc.kuiper.1');
  expect(acceptJob(s, 'arc.kuiper.1').ok).toBe(true);
  // Gone quiet: the Kuiper Belt scanned close (a scan in range records the belt), then back to Rook.
  inSpace(s, 'sol');
  expect(currentObjective(s, 'arc.kuiper.1')?.kind).toBe('scan');
  discoverBody(s, 'sol-kuiper-belt');
  expect(words(s, true)).toMatch(/Drive dead, air for four days/);
  dock(s, 'mars-depot');
  expect(done(s, 'arc.kuiper.1')).toBe(true);
  // Under the ice: the parts handed over on acceptance, the Long Winter adrift in the belt itself.
  expect(acceptJob(s, 'arc.kuiper.2').ok).toBe(true);
  expect(cargoCount(s.ship.cargo, 'ship-parts')).toBe(3);
  inSpace(s, 'sol');
  expect(rescuesIn(s, 'sol')).toEqual([{ jobId: 'arc.kuiper.2', name: 'Long Winter', model: 'ship.freighter.1.halden', commodity: 'ship-parts', qty: 3, guard: 1, beltId: 'sol-kuiper-belt' }]);
  expect(handOver(s, 'arc.kuiper.2').missing).toBe(0);
  expect(words(s, true)).toMatch(/the coupling’s in and the drive’s turning/);
  dock(s, 'mars-depot');
  expect(done(s, 'arc.kuiper.2')).toBe(true);
  // The coupling: to Castell's lab at Halcyon Ring, and back.
  expect(acceptJob(s, 'arc.kuiper.3').ok).toBe(true);
  expect(cargoCount(s.ship.cargo, 'salvage')).toBe(1);
  dock(s, 'earth-port');
  expect(deliverJob(s, 'arc.kuiper.3', 'earth-port').ok).toBe(true);
  expect(words(s)).toMatch(/Hale Refits has fitted twelve of these/);
  dock(s, 'mars-depot');
  expect(done(s, 'arc.kuiper.3')).toBe(true);
  expect(acceptJob(s, 'arc.kuiper.4').ok).toBe(true);
}

describe('The Long Winter', () => {
  it('passes the story and mark guardrails', () => {
    expect(validateStory()).toEqual([]);
    expect(validateMarks()).toEqual([]);
  });

  it('catches a stand outside a finale, crews who cannot come through, and a belt not drawn there', () => {
    const broken = (edit: (jobs: (typeof ARC_JOBS)[number][]) => void) => {
      const jobs = structuredClone(ARC_JOBS) as (typeof ARC_JOBS)[number][];
      edit(jobs);
      return validateStory(jobs).map((i) => i.rule);
    };
    const stand = (jobs: (typeof ARC_JOBS)[number][]) => jobs.find((j) => j.id === 'arc.kuiper.5.crews')!.objectives[0] as Extract<(typeof ARC_JOBS)[number]['objectives'][number], { kind: 'stand' }>;
    expect(broken((jobs) => (stand(jobs).crews = { names: ['Long Winter'], need: 2 }))).toContain('stand');
    expect(broken((jobs) => (stand(jobs).waves = 4))).toContain('stand');
    expect(broken((jobs) => (stand(jobs).beltId = 'sol-main-belt-nowhere'))).toContain('belts');
    expect(broken((jobs) => ((jobs.find((j) => j.id === 'arc.kuiper.2')!.objectives[0] as { beltId: string }).beltId = 'tau-ceti-debris-disc'))).toContain('belts');
    expect(
      broken((jobs) => {
        const j = jobs.find((x) => x.id === 'arc.kuiper.3')!;
        j.objectives = [stand(jobs), ...j.objectives];
      }),
    ).toContain('finale');
  });

  it('is given by Tamsin Rook at Deimos Depot after the opening delivery, and asks nobody’s standing', () => {
    const fresh = createNewGame(17);
    fresh.location = { ...fresh.location, dockedAt: 'mars-depot' };
    expect(jobsAt(fresh, 'mars-depot').find((o) => o.job.id === 'arc.kuiper.1')?.status ?? 'locked').toBe('locked');
    const s = pilot();
    s.reputation = { sta: -40, frontier: -40, 'hollow-wake': -40 };
    dock(s, 'mars-depot');
    expect(jobsAt(s, 'mars-depot').find((o) => o.job.id === 'arc.kuiper.1')?.status).toBe('available');
    expect(findBelt('sol-kuiper-belt')?.systemId).toBe('sol');
  });

  it('Castell remembers what the pilot did in Clean Manifests', () => {
    for (const [answer, said] of [
      ['press', /gave the Vail papers to the Frontier press/],
      ['internal', /kept the Vail case inside the Authority/],
      ['bribe', /sold the Vail file back to him/],
    ] as const) {
      const s = pilot();
      s.story.choices['sta.vail'] = answer;
      expect(briefingFor(s, getJob('arc.kuiper.3', s))).toMatch(said);
    }
    expect(briefingFor(pilot(), getJob('arc.kuiper.3', pilot()))).not.toMatch(/Vail/);
  });

  it('the law’s way: a convoy across Sol to Halcyon Ring, and Deimos Depot’s refits inspected for good', () => {
    const s = pilot();
    toTheChoice(s);
    const sta = s.reputation.sta;
    expect(makeChoice(s, 'arc.kuiper.4', 'law').ok).toBe(true);
    expect(s.reputation.sta).toBe(sta + 6);
    expect(jobsAt(s, 'mars-depot').map((o) => o.job.id)).toContain('arc.kuiper.5.law');
    expect(jobsAt(s, 'mars-depot').map((o) => o.job.id)).not.toContain('arc.kuiper.5.crews');
    expect(acceptJob(s, 'arc.kuiper.5.law').ok).toBe(true);
    s.location.dockedAt = null;
    expect(escortsIn(s, 'sol')).toEqual([expect.objectContaining({ from: 'mars-depot', to: 'earth-port', convoy: { names: ['Long Winter', 'Hoarfrost', 'Meltwater'], waves: 1 } })]);
    escortArrived(s, 'arc.kuiper.5.law');
    escortLost(s, 'arc.kuiper.5.law');
    escortArrived(s, 'arc.kuiper.5.law');
    expect(done(s, 'arc.kuiper.5.law')).toBe(true);
    expect(arcStatus(s, 'kuiper').phase).toBe('complete');
    expect(s.world.marks?.['kuiper.law']).toBeDefined();
    expect(s.world.marks?.['kuiper.crews']).toBeUndefined();
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-kuiper');
    expect(debriefFor(s, getJob('arc.kuiper.5.law', s))[0]!.who).toBe('castell');
  });

  it('the crews’ way: a stand in the Kuiper Belt, lost and tried again, then won; the crews refit their own', () => {
    const s = pilot();
    toTheChoice(s);
    expect(makeChoice(s, 'arc.kuiper.4', 'crews').ok).toBe(true);
    expect(acceptJob(s, 'arc.kuiper.5.crews').ok).toBe(true);
    inSpace(s, 'sol');
    expect(standsIn(s, 'sol')).toEqual([{ jobId: 'arc.kuiper.5.crews', beltId: 'sol-kuiper-belt', crews: { names: ['Long Winter', 'Hoarfrost', 'Meltwater'], need: 2 }, waves: 2, ships: 5, level: 2 }]);
    // Lost: the mission goes back to Rook, to try again.
    expect(standLost(s, 'arc.kuiper.5.crews')[0]?.kind).toBe('failed');
    expect(s.jobs['arc.kuiper.5.crews']).toBeUndefined();
    dock(s, 'mars-depot');
    expect(acceptJob(s, 'arc.kuiper.5.crews').ok).toBe(true);
    inSpace(s, 'sol');
    standWon(s, 'arc.kuiper.5.crews');
    expect(done(s, 'arc.kuiper.5.crews')).toBe(true);
    expect(s.jobs['arc.kuiper.5.crews']!.stood).toBe(true);
    expect(s.world.marks?.['kuiper.crews']).toBeDefined();
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-kuiper');
    assertValidState(s);
    expect(migrateSave(structuredClone(s)).jobs['arc.kuiper.5.crews']!.stood).toBe(true);
    const bad = structuredClone(s);
    (bad.jobs['arc.kuiper.5.crews'] as { stood: unknown }).stood = 'yes';
    expect(() => assertValidState(bad)).toThrow();
  });

  it('Hale’s money ends the arc with cheap, unasked-about refits at Deimos', () => {
    const s = pilot();
    toTheChoice(s);
    const credits = s.credits;
    expect(makeChoice(s, 'arc.kuiper.4', 'bury').ok).toBe(true);
    expect(s.credits).toBe(credits + 3_000);
    expect(s.world.marks?.['kuiper.bury']).toBeDefined();
    expect(jobsAt(s, 'mars-depot').map((o) => o.job.id)).not.toContain('arc.kuiper.5.law');
    expect(jobsAt(s, 'mars-depot').map((o) => o.job.id)).not.toContain('arc.kuiper.5.crews');
    expect(checkMilestones(s).map((m) => m.id)).not.toContain('story-kuiper');
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }) };
}

const QUIET: TrafficPlan = { traders: 0, patrolWings: 0, wingSize: 2, packs: null };

interface Npc {
  name: string;
  cutter?: { jobId: string };
  jumper?: { jobId: string };
  miner?: { beam?: unknown };
  body: { position: THREE.Vector3 };
  durability: { hull: number };
  target: { id: string; name: string; hostile?: boolean };
}

function flightIn(traffic: Omit<TrafficSetup, 'plan' | 'owner'>) {
  const scene = new SystemScene(sceneDefFor('sol'), { quality: 'low', reducedMotion: true });
  const state = createNewGame(9);
  state.location = { systemId: 'sol', dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  const log: string[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const callbacks: FlightCallbacks = {
    onDocked: record('docked'),
    onPlayerDestroyed: record('destroyed'),
    onDiscovery: record('discovery'),
    onScanInfo: record('scanInfo'),
    onEncounterStart: record('encounterStart'),
    onEncounterEnd: record('encounterEnd'),
    onLoot: record('loot'),
    onBounty: record('bounty'),
    onContractKill: record('contractKill'),
    onStand: record('stand'),
    onCrime: record('crime'),
    onMessage: (text) => log.push(text),
  };
  const audio = { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine;
  const flight = new FlightSession({ system: scene, camera: new THREE.PerspectiveCamera(), state, settings: defaultSettings(), ctx: { quality: 'low', reducedMotion: true }, audio, callbacks, traffic: { plan: QUIET, owner: null, ...traffic } });
  flight.start({ kind: 'arrival' });
  const npcs = () => (flight as unknown as { npcs: Npc[] }).npcs.filter((n) => n.durability.hull > 0);
  const hit = (n: Npc) => (flight as unknown as { damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void }).damageNpc(n, 1e7, n.body.position.clone(), undefined, true);
  const player = (flight as unknown as { player: { position: THREE.Vector3; velocity: THREE.Vector3 } }).player;
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  const ring = scene.def.belts.find((b) => b.beltId === 'sol-kuiper-belt' && b.shape === 'ring')!;
  return { flight, state, calls, log, run, npcs, hit, player, ring };
}

const STAND_SETUP = { jobId: 'arc.kuiper.5.crews', beltId: 'sol-kuiper-belt', crews: { names: ['Long Winter', 'Hoarfrost', 'Meltwater'], need: 2 }, waves: 2, ships: 5, level: 2 as const };

describe('The Long Winter in flight', () => {
  beforeAll(installCanvasStub);

  it('the crews’ cutters work their rocks in the ring, and nothing comes until the pilot is near', () => {
    const f = flightIn({ stands: [STAND_SETUP] });
    f.run(3);
    const cutters = f.npcs().filter((n) => n.cutter);
    expect(cutters.map((n) => n.name)).toEqual(['Long Winter', 'Hoarfrost', 'Meltwater']);
    expect(cutters.every((n) => !!n.miner?.beam && !n.target.hostile)).toBe(true);
    expect(cutters[0]!.target.id).toBe('stand:arc.kuiper.5.crews');
    const status = f.flight.standStatus()!;
    const spot = new THREE.Vector3(...status.spot);
    const radial = Math.hypot(spot.x - f.ring.center.x, spot.z - f.ring.center.z);
    expect(radial).toBeGreaterThan(f.ring.innerRadius);
    expect(radial).toBeLessThan(f.ring.outerRadius);
    expect(f.run(20, () => f.npcs().some((n) => n.jumper))).toBe(false);
    expect(f.flight.standStatus()!.state).toBe('waiting');
  });

  it('won: two waves of claim-jumpers out of the dark, each once the one before is down to one', () => {
    const f = flightIn({ stands: [STAND_SETUP] });
    f.run(3);
    const spot = new THREE.Vector3(...f.flight.standStatus()!.spot);
    f.player.position.copy(spot).add(new THREE.Vector3(0, 400, STAND.range - 1_500));
    f.player.velocity.set(0, 0, 0);
    expect(f.run(STAND.waveDelay + 3, () => f.npcs().some((n) => n.jumper))).toBe(true);
    expect(f.flight.standStatus()!.state).toBe('on');
    const wave1 = f.npcs().filter((n) => n.jumper);
    expect(wave1).toHaveLength(3);
    expect(wave1.every((n) => n.target.hostile && n.body.position.distanceTo(spot) > STAND.from - 600)).toBe(true);
    expect(f.log.some((m) => m.includes('3 claim-jumpers out of the dark'))).toBe(true);
    f.hit(wave1[0]!);
    f.hit(wave1[1]!);
    expect(f.run(STAND.waveDelay + 3, () => f.npcs().filter((n) => n.jumper).length > 1)).toBe(true);
    expect(f.log.some((m) => m.includes('Another wave: 2 more'))).toBe(true);
    for (const n of f.npcs().filter((x) => x.jumper)) f.hit(n);
    expect(f.run(3, () => !!f.calls.stand)).toBe(true);
    expect(f.calls.stand).toEqual([['arc.kuiper.5.crews', 'won']]);
    expect(f.flight.standStatus()!.state).toBe('won');
  });

  it('lost: too few cutters left', () => {
    const f = flightIn({ stands: [STAND_SETUP] });
    f.run(3);
    const cutters = f.npcs().filter((n) => n.cutter);
    f.hit(cutters[0]!);
    f.hit(cutters[1]!);
    expect(f.run(2, () => !!f.calls.stand)).toBe(true);
    expect(f.calls.stand).toEqual([['arc.kuiper.5.crews', 'lost']]);
    expect(f.log.some((m) => m.includes('the crews pull back off the ice'))).toBe(true);
  });

  it('a rescue’s ship adrift in the belt lies in its ring, clear of stations; one without a belt, out in open space', () => {
    const f = flightIn({});
    const at = f.flight.strandedPosition('arc.kuiper.2', 'sol-kuiper-belt');
    const radial = Math.hypot(at.x - f.ring.center.x, at.z - f.ring.center.z);
    expect(radial).toBeGreaterThan(f.ring.innerRadius);
    expect(radial).toBeLessThan(f.ring.outerRadius);
    const plain = f.flight.strandedPosition('arc.kuiper.2');
    expect(plain.distanceTo(at)).toBeGreaterThan(1_000);
  });

  it('a belt scanned within range is on record', () => {
    const f = flightIn({});
    f.run(1);
    const spot = f.flight.beltSpot('sol-kuiper-belt', 'scan')!;
    f.player.position.copy(spot).add(new THREE.Vector3(0, 0, 4_000));
    f.run(1);
    f.flight.selectTarget('belt:sol-kuiper-belt');
    (f.flight as unknown as { manualScan(): void }).manualScan();
    expect(f.calls.discovery).toEqual([['sol-kuiper-belt']]);
    expect(f.calls.scanInfo?.length).toBe(1);
  });
});

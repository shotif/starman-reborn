import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState, migrateSave } from '../../src/app/save/migrate.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { ARC_JOBS } from '../../src/content/story/arcs.ts';
import { EMBERS } from '../../src/content/story/embers.ts';
import { DOOMED } from '../../src/content/stellar/doomed.ts';
import { getLocation } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { scheduleEdge } from '../../src/economy/doomed.ts';
import { observatoryStands, pyreArcOpen, pyreHeld } from '../../src/economy/embers.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import {
  acceptJob,
  advanceJobs,
  currentObjective,
  deliverJob,
  escortArrived,
  escortLost,
  escortsIn,
  getJob,
  handOver,
  jobsAt,
  lifeboatAboard,
  lifeboatsClear,
  lifeboatsIn,
  lifeboatsLapse,
  rescuesIn,
} from '../../src/economy/jobs.ts';
import { checkMilestones } from '../../src/economy/progress.ts';
import { skyTimeline } from '../../src/economy/stellar.ts';
import { arcStatus, makeChoice, pendingBeats } from '../../src/economy/story.ts';
import { validateMarks, validateStory } from '../../src/economy/storyGuards.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';

/**
 * Last Light at Pyre (docs/PROCGEN.md §42): offered only before Pyre warns, holding its warning,
 * starting it at the choice; played through every way, with its marks; its lifeboats gathered, got
 * clear and lapsed, in a real FlightSession too; and saves.
 */

/** A pilot past the opening, at the frontier, with Antares gone (§25) and Pyre not yet warned. */
function pilot(): GameState {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  s.world.sky = { from: 0 };
  s.clock = skyTimeline(0).bhGone + 600;
  s.milestones['frontier-first'] = s.clock - 300;
  useWorldLog(s.world);
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
const offered = (s: GameState, at: string) => jobsAt(s, at).map((o) => o.job.id);
const words = (s: GameState, inFlight = false) => pendingBeats(s, inFlight).flatMap((b) => b.lines.map((l) => l.text)).join(' ');

/** Through the third step, to the choice in hand at Pyre Observatory. */
function toTheChoice(s: GameState) {
  dock(s, 'gj-915-freeport');
  expect(offered(s, 'gj-915-freeport')).toContain('arc.embers.1');
  expect(acceptJob(s, 'arc.embers.1').ok).toBe(true);
  expect(cargoCount(s.ship.cargo, 'electronics')).toBe(3);
  dock(s, 'pyre-observatory');
  expect(deliverJob(s, 'arc.embers.1', 'pyre-observatory').ok).toBe(true);
  expect(done(s, 'arc.embers.1')).toBe(true);
  expect(words(s)).toMatch(/Sixty-two people live here/);
  expect(acceptJob(s, 'arc.embers.2').ok).toBe(true);
  s.ship.cargo.metals = 10;
  expect(deliverJob(s, 'arc.embers.2', 'pyre-observatory').ok).toBe(true);
  expect(done(s, 'arc.embers.2')).toBe(true);
  expect(acceptJob(s, 'arc.embers.3').ok).toBe(true);
  expect(cargoCount(s.ship.cargo, 'medical')).toBe(2);
  inSpace(s, 'pyre' as SystemId);
  expect(rescuesIn(s, 'pyre' as SystemId)).toEqual([expect.objectContaining({ jobId: 'arc.embers.3', name: 'Tinder', commodity: 'medical', qty: 2 })]);
  expect(handOver(s, 'arc.embers.3').missing).toBe(0);
  expect(words(s, true)).toMatch(/I will not look away at the end/);
  dock(s, 'pyre-observatory');
  expect(done(s, 'arc.embers.3')).toBe(true);
  expect(acceptJob(s, 'arc.embers.4').ok).toBe(true);
  // All this while, Pyre has not warned.
  expect(s.world.sky?.edge).toBeUndefined();
}

describe('Last Light at Pyre', () => {
  it('passes the story and mark guardrails', () => {
    expect(validateStory()).toEqual([]);
    expect(validateMarks()).toEqual([]);
  });

  it('catches lifeboats outside a finale or Pyre’s system, boats it cannot meet, and Pyre Observatory in an arc Pyre does not wait for', () => {
    const broken = (edit: (jobs: (typeof ARC_JOBS)[number][]) => void) => {
      const jobs = structuredClone(ARC_JOBS) as (typeof ARC_JOBS)[number][];
      edit(jobs);
      return validateStory(jobs).map((i) => i.rule);
    };
    type Boats = Extract<(typeof ARC_JOBS)[number]['objectives'][number], { kind: 'lifeboats' }>;
    const boats = (jobs: (typeof ARC_JOBS)[number][]) => jobs.find((j) => j.id === 'arc.embers.5.stay')!.objectives[0] as Boats;
    expect(broken((jobs) => (boats(jobs).systemId = 'gj-915' as SystemId))).toContain('lifeboats');
    expect(broken((jobs) => (boats(jobs).need = 7))).toContain('lifeboats');
    expect(broken((jobs) => (boats(jobs).count = 1))).toContain('lifeboats');
    expect(broken((jobs) => delete jobs.find((j) => j.id === 'arc.embers.5.stay')!.requires!.pyre)).toContain('lifeboats');
    expect(
      broken((jobs) => {
        const j = jobs.find((x) => x.id === 'arc.embers.3')!;
        j.objectives = [boats(jobs), ...j.objectives];
      }),
    ).toContain('finale');
    // Pyre Observatory, in an arc that does not hold Pyre, is no place for a story.
    expect(broken((jobs) => (jobs.find((j) => j.id === 'arc.embers.1')!.requires = { jobComplete: 'lifeline' }))).toContain('places');
  });

  it('is offered at GJ 915 Freeport only past the frontier and Antares, and only before Pyre warns', () => {
    const fresh = pilot();
    delete fresh.milestones['frontier-first'];
    expect(pyreArcOpen(fresh)).toBe(false);
    dock(fresh, 'gj-915-freeport');
    expect(offered(fresh, 'gj-915-freeport')).not.toContain('arc.embers.1');
    const s = pilot();
    expect(pyreArcOpen(s)).toBe(true);
    dock(s, 'gj-915-freeport');
    expect(jobsAt(s, 'gj-915-freeport').find((o) => o.job.id === 'arc.embers.1')?.status).toBe('available');
    // A warning set for later still lets it be offered; one come already does not.
    s.world.sky!.edge = s.clock + 3_600;
    expect(offered(s, 'gj-915-freeport')).toContain('arc.embers.1');
    s.world.sky!.edge = s.clock - 1;
    expect(offered(s, 'gj-915-freeport')).not.toContain('arc.embers.1');
  });

  it('taken, it holds Pyre’s warning until its choice; the choice made, the warning comes a minute later', () => {
    const s = pilot();
    s.world.sky!.edge = s.clock + 3_600;
    dock(s, 'gj-915-freeport');
    expect(acceptJob(s, 'arc.embers.1').ok).toBe(true);
    expect(s.world.sky!.edge).toBeUndefined();
    expect(pyreHeld(s)).toBe(true);
    s.clock += 10 * 3_600;
    expect(scheduleEdge(s)).toBe(false);
    expect(s.world.sky!.edge).toBeUndefined();
    expect(observatoryStands(s)).toBe(true);
  });

  it('the Authority’s lift: the cutter escorted to GJ 4274 Institute as Pyre dies, and its records there for good', () => {
    const s = pilot();
    toTheChoice(s);
    const sta = s.reputation.sta;
    expect(makeChoice(s, 'arc.embers.4', 'law').ok).toBe(true);
    expect(s.reputation.sta).toBe(sta + 5);
    expect(s.world.sky!.edge).toBe(s.clock + EMBERS.warnAfter);
    expect(pyreHeld(s)).toBe(false);
    expect(offered(s, 'gj-915-freeport')).toContain('arc.embers.5.law');
    expect(offered(s, 'gj-915-freeport')).not.toContain('arc.embers.5.coop');
    expect(offered(s, 'pyre-observatory')).not.toContain('arc.embers.5.stay');
    dock(s, 'gj-915-freeport');
    expect(acceptJob(s, 'arc.embers.5.law').ok).toBe(true);
    s.location.dockedAt = null;
    expect(escortsIn(s, 'gj-915' as SystemId)).toEqual([expect.objectContaining({ from: 'gj-915-freeport', to: 'gj-4274-institute' })]);
    escortArrived(s, 'arc.embers.5.law');
    expect(done(s, 'arc.embers.5.law')).toBe(true);
    expect(arcStatus(s, 'embers').phase).toBe('complete');
    expect(s.world.marks?.['embers.law']).toBeDefined();
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-embers');
  });

  it('the Co-op’s barges: two of three to Fomalhaut B Orchard, and Pyre’s people farming there for good', () => {
    const s = pilot();
    toTheChoice(s);
    expect(makeChoice(s, 'arc.embers.4', 'coop').ok).toBe(true);
    dock(s, 'gj-915-freeport');
    expect(acceptJob(s, 'arc.embers.5.coop').ok).toBe(true);
    s.location.dockedAt = null;
    expect(escortsIn(s, 'gj-915' as SystemId)).toEqual([expect.objectContaining({ to: 'fomalhaut-b-orchard', convoy: { names: ['Seedbank', 'Long Furrow', 'Hearthstone'], waves: 1 } })]);
    escortArrived(s, 'arc.embers.5.coop');
    escortLost(s, 'arc.embers.5.coop');
    escortArrived(s, 'arc.embers.5.coop');
    expect(done(s, 'arc.embers.5.coop')).toBe(true);
    expect(s.world.marks?.['embers.coop']).toBeDefined();
  });

  it('stay for the light: five lifeboats gathered and got clear through the lane before the collapse; the Pyre Archive for good', () => {
    const s = pilot();
    toTheChoice(s);
    expect(makeChoice(s, 'arc.embers.4', 'stay').ok).toBe(true);
    dock(s, 'pyre-observatory');
    expect(offered(s, 'pyre-observatory')).toContain('arc.embers.5.stay');
    expect(acceptJob(s, 'arc.embers.5.stay').ok).toBe(true);
    inSpace(s, 'pyre' as SystemId);
    const edge = s.world.sky!.edge!;
    expect(lifeboatsIn(s, 'pyre' as SystemId)).toEqual([{ jobId: 'arc.embers.5.stay', count: 6, need: 5, gathered: 0, launch: edge + EMBERS.launch, collapse: edge + DOOMED.timeline.collapseAfterWarning }]);
    s.clock = edge + EMBERS.launch + 300;
    for (let i = 0; i < 4; i++) lifeboatAboard(s, 'arc.embers.5.stay');
    // Four aboard: not enough to call it done.
    expect(lifeboatsClear(s, 'pyre' as SystemId)).toEqual([]);
    expect(lifeboatAboard(s, 'arc.embers.5.stay')).toBe(5);
    expect(currentObjective(s, 'arc.embers.5.stay')?.kind).toBe('lifeboats');
    lifeboatsClear(s, 'pyre' as SystemId);
    expect(done(s, 'arc.embers.5.stay')).toBe(true);
    expect(s.jobs['arc.embers.5.stay']).toMatchObject({ gathered: 5, clear: true });
    expect(s.world.marks?.['embers.stay']).toBeDefined();
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-embers');
    assertValidState(s);
    expect(migrateSave(structuredClone(s)).jobs['arc.embers.5.stay']).toMatchObject({ gathered: 5, clear: true });
    for (const bad of [{ gathered: 7 }, { gathered: 2.5 }, { clear: 'yes' }]) {
      const t = structuredClone(s);
      Object.assign(t.jobs['arc.embers.5.stay']!, bad);
      expect(() => assertValidState(t)).toThrow();
    }
    const t = structuredClone(s);
    t.jobs['arc.embers.1']!.gathered = 1;
    expect(() => assertValidState(t)).toThrow();
  });

  it('not clear by the collapse: it fails, and with the observatory gone it is never offered again', () => {
    const s = pilot();
    toTheChoice(s);
    makeChoice(s, 'arc.embers.4', 'stay');
    dock(s, 'pyre-observatory');
    acceptJob(s, 'arc.embers.5.stay');
    inSpace(s, 'pyre' as SystemId);
    const edge = s.world.sky!.edge!;
    lifeboatAboard(s, 'arc.embers.5.stay');
    s.clock = edge + DOOMED.timeline.collapseAfterWarning - 1;
    expect(lifeboatsLapse(s)).toEqual([]);
    s.clock += 1;
    expect(lifeboatsLapse(s)[0]?.kind).toBe('failed');
    expect(s.jobs['arc.embers.5.stay']).toBeUndefined();
    expect(observatoryStands(s)).toBe(false);
    expect(offered(s, 'pyre-observatory')).not.toContain('arc.embers.5.stay');
    expect(getJob('arc.embers.5.stay', s).requires?.pyre).toBe('observatory');
    expect(arcStatus(s, 'embers').phase).not.toBe('complete');
    expect(s.world.marks?.['embers.stay']).toBeUndefined();
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
  lifeboat?: { jobId: string; i: number };
  body: { position: THREE.Vector3 };
  target: { id: string; alive: boolean; hostile?: boolean };
}

/** A flight in Pyre's system, the warning given at clock 0 (its scene the living star's). */
function flightAtPyre(traffic: Omit<TrafficSetup, 'plan' | 'owner'>, clock: number) {
  const scene = new SystemScene(sceneDefFor('pyre' as SystemId, null, 0), { quality: 'low', reducedMotion: true });
  const state = createNewGame(9);
  state.world.sky = { from: -100_000, edge: 0 };
  state.clock = clock;
  state.location = { systemId: 'pyre' as SystemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  const log: string[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  let aboard = 0;
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
    onCrime: record('crime'),
    onLifeboat: (jobId) => {
      record('lifeboat')(jobId);
      return ++aboard;
    },
    onMessage: (text) => log.push(text),
  };
  const audio = { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine;
  const flight = new FlightSession({ system: scene, camera: new THREE.PerspectiveCamera(), state, settings: defaultSettings(), ctx: { quality: 'low', reducedMotion: true }, audio, callbacks, traffic: { plan: QUIET, owner: null, ...traffic } });
  flight.start({ kind: 'arrival' });
  const boats = () => (flight as unknown as { npcs: Npc[] }).npcs.filter((n) => n.lifeboat && n.target.alive);
  const player = (flight as unknown as { player: { position: THREE.Vector3; velocity: THREE.Vector3 } }).player;
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  return { flight, state, calls, log, run, boats, player, scene };
}

const BOATS = { jobId: 'arc.embers.5.stay', count: 6, need: 5, gathered: 0, launch: EMBERS.launch, collapse: DOOMED.timeline.collapseAfterWarning };

describe('Pyre’s lifeboats in flight', () => {
  beforeAll(installCanvasStub);

  it('none before the launch; at it, six leave the observatory on their own headings and drift out', () => {
    const before = flightAtPyre({ lifeboats: [BOATS] }, EMBERS.launch - 600);
    before.run(4);
    expect(before.boats()).toHaveLength(0);
    expect(before.flight.lifeboatStatus()).toMatchObject({ launched: false, out: 0 });
    const f = flightAtPyre({ lifeboats: [BOATS] }, EMBERS.launch + 60);
    f.run(4);
    const boats = f.boats();
    expect(boats.map((b) => b.target.id)).toEqual([0, 1, 2, 3, 4, 5].map((i) => `lifeboat:arc.embers.5.stay#${i}`));
    expect(boats.every((b) => !b.target.hostile)).toBe(true);
    const obs = f.scene.dock('pyre-observatory')!.def.position;
    const d = boats.map((b) => b.body.position.distanceTo(obs));
    expect(Math.min(...d)).toBeGreaterThan(EMBERS.start);
    // Each on its own heading: no two together.
    for (let i = 0; i < boats.length; i++) for (let j = i + 1; j < boats.length; j++) expect(boats[i]!.body.position.distanceTo(boats[j]!.body.position)).toBeGreaterThan(300);
    // They drift outward.
    const p = f.flight.lifeboatPosition(BOATS, 0, EMBERS.launch + 600)!;
    const q = f.flight.lifeboatPosition(BOATS, 0, EMBERS.launch + 1_200)!;
    expect(q.distanceTo(obs) - p.distanceTo(obs)).toBeCloseTo(EMBERS.drift * 600, 0);
  });

  it('flying close takes one aboard; those gathered before are not there again', () => {
    const f = flightAtPyre({ lifeboats: [BOATS] }, EMBERS.launch + 60);
    f.run(3);
    const first = f.boats()[0]!;
    f.player.position.copy(first.body.position).add(new THREE.Vector3(0, 0, EMBERS.pickup - 50));
    f.player.velocity.set(0, 0, 0);
    expect(f.run(2, () => !!f.calls.lifeboat)).toBe(true);
    expect(f.calls.lifeboat).toEqual([['arc.embers.5.stay']]);
    expect(f.boats()).toHaveLength(5);
    expect(f.log.some((l) => /Lifeboat 1 aboard/.test(l))).toBe(true);
    const again = flightAtPyre({ lifeboats: [{ ...BOATS, gathered: 4 }] }, EMBERS.launch + 60);
    again.run(3);
    expect(again.boats()).toHaveLength(2);
  });

  it('none after the collapse', () => {
    const f = flightAtPyre({ lifeboats: [BOATS] }, BOATS.collapse + 1);
    f.run(3);
    expect(f.boats()).toHaveLength(0);
  });
});

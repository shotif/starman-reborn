import * as THREE from 'three';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';
import { DOOMED, type DoomedRules } from '../../src/content/stellar/doomed.ts';
import { EDGE_NEWS } from '../../src/content/stellar/doomedLines.ts';
import { STELLAR } from '../../src/content/stellar/rules.ts';
import { ALL_LOCATIONS, getLocation, SYSTEMS } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import {
  apparentAt,
  edgeComm,
  edgeMoment,
  edgeNews,
  edgePrice,
  edgeTimeline,
  fadedIn,
  horizonKm,
  laneOpen,
  lightArrives,
  lyFromPyre,
  observatoryOpen,
  pyreAbsoluteMagnitude,
  pyreLook,
  pyrePosition,
  pyreRadiusSolar,
  pyreStage,
  remnantStationOpen,
  scheduleEdge,
  tidalLimitKm,
} from '../../src/economy/doomed.ts';
import { validateDoomed } from '../../src/economy/doomedGuards.ts';
import { skyTimeline } from '../../src/economy/stellar.ts';

/**
 * Stellar death II, a doomed star at the edge (docs/PROCGEN.md §26): Pyre, the one invented star,
 * kept apart from the real sky; its place, brightness and black hole worked out from the rules; its
 * timeline in a save, its light crossing the map, the News, the radio and prices.
 */

afterEach(() => useWorldLog(null));

const EDGE = 50_000;
const T = edgeTimeline(EDGE);
const RESEARCH = ALL_LOCATIONS.find((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false)!;

describe('Pyre, the invented star', () => {
  it('passes its guardrails: apart from everything real, beyond the census, a red supergiant', () => {
    expect(validateDoomed()).toEqual([]);
    const p = pyrePosition();
    expect(p[0]).toBeCloseTo(23.11, 2);
    expect(p[1]).toBeCloseTo(-1.01, 2);
    expect(p[2]).toBeCloseTo(-23.54, 2);
    expect(lyFromPyre('gj-915' as SystemId)).toBeCloseTo(6.06, 2);
    expect(Math.min(...SYSTEMS.map((s) => lyFromPyre(s.id)))).toBeCloseTo(6.06, 2);
    expect(Math.max(...SYSTEMS.map((s) => lyFromPyre(s.id)))).toBeCloseTo(59.2, 1);
  });

  it('is nowhere in the real sky’s data, and never given a source', () => {
    const root = resolve(__dirname, '../..');
    const files = ['src/data/generated', 'data/provisional', 'data/snapshot'].flatMap((dir) =>
      readdirSync(join(root, dir)).filter((f) => f.endsWith('.json')).map((f) => join(root, dir, f)),
    );
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8').toLowerCase()).not.toContain('pyre');
    expect(JSON.stringify(DOOMED)).not.toMatch(/https?:|bibcode/);
    expect(SYSTEMS.some((s) => s.id === DOOMED.star.id)).toBe(false);
  });

  it('is as bright and as big as the physics makes such a star, and its black hole as small', () => {
    expect(pyreAbsoluteMagnitude()).toBeCloseTo(-7.04, 2);
    // From Earth, brighter than Venus at its brightest; from GJ 915, brighter still.
    expect(apparentAt(pyreAbsoluteMagnitude(), DOOMED.star.distanceLy)).toBeCloseTo(-7.0, 1);
    expect(pyreLook('gj-915' as SystemId, 0, null).magnitude).toBeCloseTo(-10.7, 1);
    expect(apparentAt(STELLAR.supernova.peakAbsoluteMagnitude, DOOMED.star.distanceLy)).toBeCloseTo(-16.7, 1);
    expect(pyreRadiusSolar()).toBeGreaterThan(1_100);
    expect(pyreRadiusSolar()).toBeLessThan(1_250);
    expect(horizonKm()).toBeCloseTo(29.5, 1);
    expect(tidalLimitKm()).toBeGreaterThan(6_000);
    expect(tidalLimitKm()).toBeLessThan(7_000);
  });

  it('catches broken rules: inside the census, a catalogue-like name, the wrong anchor, a lane that opens too soon, a number in a line', () => {
    const broken = (patch: (r: DoomedRules) => void) => {
      const r = structuredClone(DOOMED) as DoomedRules;
      patch(r);
      return validateDoomed(r).map((i) => i.rule);
    };
    expect(broken((r) => ((r.star as { distanceLy: number }).distanceLy = 20))).toContain('place');
    expect(broken((r) => ((r.star as { name: string }).name = 'HD 1234'))).toContain('apart');
    expect(broken((r) => ((r.star as { name: string }).name = 'Fomalhaut'))).toContain('apart');
    expect(broken((r) => ((r.star as { anchor: string }).anchor = 'fomalhaut'))).toContain('place');
    expect(broken((r) => ((r.timeline as { laneOpensAfterBreakout: number }).laneOpensAfterBreakout = 60))).toContain('timeline');
    expect(broken((r) => ((r.star as { massSolar: number }).massSolar = 9))).toContain('physics');
    const keep = EDGE_NEWS.light.detail;
    (EDGE_NEWS.light as { detail: string }).detail = 'It is 33 light-years away.';
    expect(validateDoomed().map((i) => i.rule)).toContain('lines');
    (EDGE_NEWS.light as { detail: string }).detail = keep;
  });
});

describe('its timeline in a save', () => {
  it('is set once the far stars’ story is under way and the player has reached the frontier, and never moves', () => {
    const s = createNewGame(5);
    s.clock = 1_000;
    expect(scheduleEdge(s)).toBe(false);
    s.world.sky = { from: 10_000 };
    expect(scheduleEdge(s)).toBe(false);
    s.milestones['frontier-first'] = 40_000;
    expect(scheduleEdge(s)).toBe(true);
    const gone = skyTimeline(10_000).bhGone;
    expect(s.world.sky.edge).toBe(Math.max(gone + DOOMED.schedule.afterAntares, 40_000 + DOOMED.schedule.afterFrontier));
    s.clock = 99_999;
    expect(scheduleEdge(s)).toBe(false);
    // A save already past both gets its warning half an hour after loading.
    const old = createNewGame(6);
    old.world.sky = { from: 1_000 };
    old.milestones['frontier-first'] = 2_000;
    old.clock = 200_000;
    scheduleEdge(old);
    expect(old.world.sky.edge).toBe(200_000 + DOOMED.schedule.afterLoad);
  });

  it('runs forward: the warning, the collapse, the light leaving, its lane and its station opening; its light crosses the map a light-year a minute', () => {
    expect([T.warning, T.collapse, T.breakout, T.laneOpens, T.stationOpens]).toEqual([...[T.warning, T.collapse, T.breakout, T.laneOpens, T.stationOpens]].sort((a, b) => a - b));
    expect(lightArrives('pyre', EDGE)).toBe(T.breakout);
    expect(lightArrives('sol' as SystemId, EDGE)).toBeCloseTo(T.breakout + DOOMED.timeline.secondsPerLy * 33, 6);
    expect(lightArrives('gj-915' as SystemId, EDGE)).toBeLessThan(lightArrives('sol' as SystemId, EDGE));
    expect(pyreStage(EDGE - 1, EDGE)).toBe('alive');
    expect(pyreStage(EDGE + 1, EDGE)).toBe('warned');
    expect(pyreStage(T.collapse, EDGE)).toBe('collapsed');
    expect(pyreStage(T.breakout, EDGE)).toBe('gone');
    expect(laneOpen(T.collapse - 1, EDGE)).toBe(true);
    expect(laneOpen(T.collapse, EDGE)).toBe(false);
    expect(laneOpen(T.laneOpens, EDGE)).toBe(true);
    expect(observatoryOpen(T.collapse - 1, EDGE)).toBe(true);
    expect(observatoryOpen(T.collapse, EDGE)).toBe(false);
    expect(remnantStationOpen(T.stationOpens - 1, EDGE)).toBe(false);
    expect(remnantStationOpen(T.stationOpens, EDGE)).toBe(true);
    expect(laneOpen(0, null)).toBe(true);
  });

  it('changes how Pyre looks in each sky only once its light arrives there: the star, the supernova, its remnant', () => {
    const sol = 'sol' as SystemId;
    const arrive = lightArrives(sol, EDGE);
    expect(pyreLook(sol, arrive - 1, EDGE)).toMatchObject({ phase: 'alive', colour: DOOMED.star.colorHex });
    expect(pyreLook(sol, arrive + STELLAR.supernova.rise, EDGE).magnitude).toBeCloseTo(apparentAt(STELLAR.supernova.peakAbsoluteMagnitude, lyFromPyre(sol)), 6);
    expect(pyreLook(sol, fadedIn(sol, EDGE) + 1, EDGE)).toMatchObject({ phase: 'remnant', magnitude: apparentAt(DOOMED.timeline.remnantAbsoluteMagnitude, lyFromPyre(sol)) });
    // Nearer systems see it first.
    const near = 'gj-915' as SystemId;
    expect(pyreLook(near, arrive - 1, EDGE).phase).toBe('supernova');
  });
});

describe('the News, the radio and prices', () => {
  it('tell each moment in each system as it comes, from the rules’ numbers, and move on long after', () => {
    const sol = 'sol' as SystemId;
    expect(edgeNews(sol, EDGE - 1, EDGE)).toEqual([]);
    expect(edgeNews(sol, EDGE + 1, EDGE).map((n) => n.kind)).toEqual(['warning']);
    const later = edgeNews(sol, lightArrives(sol, EDGE) + 1, EDGE);
    expect(later.map((n) => n.kind)).toEqual(['light', 'lane', 'collapse', 'warning'].filter((k) => later.some((n) => n.kind === k)));
    expect(later[0]!.headline).toBe('The light of Pyre reaches Sol');
    expect(later[0]!.detail).toContain('magnitude −16.7');
    for (const n of edgeNews(sol, T.stationOpens + 1, EDGE)) expect(`${n.headline} ${n.detail}`).not.toMatch(/\{|\}/);
    expect(edgeNews(sol, T.stationOpens + 7 * 3_600, EDGE)).toEqual([]);
    expect(edgeMoment(sol, lightArrives(sol, EDGE), EDGE)).toBe('light');
    expect(edgeComm('warning', sol)!.text).toContain('Pyre Observatory');
    expect(edgeComm('fading', sol)).toBeNull();
  });

  it('pay more for data cores at research stations from the warning until Pyre has faded in their sky', () => {
    expect(edgePrice(RESEARCH.id, 'data-cores', EDGE - 1, EDGE)).toBe(1);
    expect(edgePrice(RESEARCH.id, 'data-cores', EDGE + 1, EDGE)).toBe(DOOMED.market.price);
    expect(edgePrice(RESEARCH.id, 'food', EDGE + 1, EDGE)).toBe(1);
    expect(edgePrice(RESEARCH.id, 'data-cores', fadedIn(getLocation(RESEARCH.id).systemId, EDGE), EDGE)).toBe(1);
    const port = ALL_LOCATIONS.find((l) => l.stationType === 'trade-port')!;
    expect(edgePrice(port.id, 'data-cores', EDGE + 1, EDGE)).toBe(1);
  });
});

describe('saves', () => {
  it('keep the warning, and refuse one before Antares has gone', () => {
    const s = createNewGame(8);
    s.world.sky = { from: 10_000, edge: skyTimeline(10_000).bhGone + 3_600 };
    assertValidState(s);
    const bad = structuredClone(s);
    bad.world.sky!.edge = 5;
    expect(() => assertValidState(bad)).toThrow(/world/);
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

/** A pilot in flight in a system (Pyre among them), the far stars' story set and Pyre's warning at EDGE. */
function flyIn(systemId: SystemId, clock: number): { s: GameState; flight: FlightSession; run: (seconds: number) => void } {
  installCanvasStub();
  const s = createNewGame(12);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.clock = clock;
  s.world.sky = { from: 1_000, edge: EDGE };
  s.location = { systemId, dockedAt: null, flight: null, lastDockId: 'earth-port' };
  useWorldLog(s.world);
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true }),
    camera: new THREE.PerspectiveCamera(),
    state: s,
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
      onMessage: nothing,
      onComm: nothing,
    },
    traffic: trafficFor(systemId, 'low', clock),
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      s.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
    }
  };
  return { s, flight, run };
}

describe('in flight', () => {
  it('flies at Pyre itself: its star marked as fiction, its observatory, and nobody else', () => {
    expect(skyTimeline(1_000).bhGone).toBeLessThan(EDGE);
    const { flight, run } = flyIn('pyre' as SystemId, EDGE - 600);
    run(1);
    const star = flight.allTargets().find((t) => t.id === 'star:pyre')!;
    expect(star).toBeDefined();
    expect(star.dataClass).toBe('fictional');
    expect(star.subtitle).toMatch(/^Invented/);
    expect(flight.allTargets().some((t) => t.id === `station:${DOOMED.stations.observatory.id}`)).toBe(true);
    expect(flight.allTargets().some((t) => t.kind === 'ship')).toBe(false);
    // Not in its own sky.
    expect(flight.allTargets().some((t) => t.id === 'sky:pyre')).toBe(false);
    flight.dispose();
  });

  it('shows Pyre in GJ 915’s sky from its warning, as fiction: counting down to its light, then the supernova', () => {
    const near = 'gj-915' as SystemId;
    const quiet = flyIn(near, EDGE - 60);
    quiet.run(0.6);
    expect(quiet.flight.allTargets().some((t) => t.id === 'sky:pyre')).toBe(false);
    quiet.flight.dispose();
    const { s, flight, run } = flyIn(near, T.breakout + 10);
    run(0.6);
    const pyre = flight.allTargets().find((t) => t.id === 'sky:pyre')!;
    expect(pyre).toBeDefined();
    expect(pyre.dataClass).toBe('fictional');
    expect(pyre.distanceLabel).toBe('6 ly');
    expect(pyre.subtitle).toMatch(/^Its light arrives in \d+:\d\d$/);
    s.clock = lightArrives(near, EDGE) + 5;
    run(0.6);
    expect(pyre.subtitle).toMatch(/^Supernova · magnitude −/);
    flight.dispose();
  });
});

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
import { dockAt, rescueAfterDefeat, rescueFromPyre, RESCUE_FEE } from '../../src/app/rules.ts';
import { markVisited } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { MAP_LINKS, PYRE_LOCATIONS } from '../../src/data/systems.ts';
import { boardEpoch, boardFor, postedContract, postedContracts } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { acceptJob, advanceJobs, describeObjective } from '../../src/economy/jobs.ts';
import { hasMarket, marketTables } from '../../src/economy/markets.ts';
import { observationsWanted, recordObservation, type ObserveObjective } from '../../src/economy/stellar.ts';
import type { FlightCallbacks } from '../../src/world/FlightSession.ts';
import {
  apparentAt,
  fallbackGlow,
  firstLightSeen,
  holeReadUntil,
  hopsToPyre,
  nearPyre,
  pyreStationsNow,
  pyreStatus,
  pyreWelcome,
  laneClosedReason,
  PYRE_HOLE_ID,
  pyreDockRefusal,
  pyreRefugeId,
  rescueDockId,
  tidalStrain,
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
    // Its work and its black hole: pay over the ceiling, a crowd of observers, first light nobody can outrun, gas that fades too soon, tides that do nothing.
    expect(broken((r) => ((r.jobs.record as { reward: number }).reward = 9_000))).toContain('jobs');
    expect(broken((r) => ((r.jobs.evacuate as { party: readonly number[] }).party = [2, 9]))).toContain('jobs');
    expect(broken((r) => ((r.jobs.twice as { aheadLy: number }).aheadLy = 40))).toContain('jobs');
    expect(broken((r) => ((r.jobs.hole as { glowAbove: number }).glowAbove = 0.5))).toContain('jobs');
    expect(broken((r) => ((r.blackHole as { hullStrainPerSecond: number }).hullStrainPerSecond = 0))).toContain('physics');
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
function flyIn(systemId: SystemId, clock: number, more: Partial<FlightCallbacks> = {}): { s: GameState; flight: FlightSession; run: (seconds: number) => void } {
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
    system: new SystemScene(sceneDefFor(systemId, null, clock), { quality: 'low', reducedMotion: true }),
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
      ...more,
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

// ---------------------------------------------------------------- its black hole

describe('its black hole', () => {
  it('is where Pyre was once its light has left: no star, the hole marked as fiction, its remnant station, and its tides an obstacle', () => {
    const save = createNewGame(5);
    save.world.sky = { from: 1_000, edge: EDGE };
    useWorldLog(save.world);
    expect(sceneDefFor('pyre' as SystemId, null, T.breakout - 1).blackHole).toBeUndefined();
    expect(sceneDefFor('pyre' as SystemId).blackHole).toBeUndefined();
    const gone = sceneDefFor('pyre' as SystemId, null, T.breakout + 1);
    expect(gone.blackHole?.id).toBe(PYRE_HOLE_ID);
    expect(gone.stars).toEqual([]);
    expect(gone.stations.map((st) => st.locationId)).toEqual([DOOMED.stations.remnant.id]);
    expect(gone.scaleNote).toMatch(/invented/);
    expect(gone.scaleNote).toContain(Math.round(tidalLimitKm()).toLocaleString('en-GB'));
    const b = gone.blackHole!;
    expect(b.shadow).toBeLessThan(b.disc[0]);
    expect(b.disc[1]).toBeLessThan(b.tidalRadius);
    // Its station well clear of the tides, and ships arriving outside them.
    expect(gone.stations[0]!.position.length()).toBeGreaterThan(b.tidalRadius * 3);
    expect(gone.arrival.position.length()).toBeGreaterThan(b.tidalRadius * 3);
    const scene = new SystemScene(gone, { quality: 'low', reducedMotion: true });
    const hole = scene.targets.find((t) => t.kind === 'hole')!;
    expect(hole.dataClass).toBe('fictional');
    expect(hole.subtitle).toMatch(/^Invented black hole/);
    expect(scene.obstacles(null).find((o) => o.id === hole.id)?.radius).toBe(b.tidalRadius);
    expect(scene.obstacles(hole.id).some((o) => o.id === hole.id)).toBe(false);
    scene.dispose();
    // Nothing real is called by its id.
    expect(ALL_LOCATIONS.some((l) => l.id === PYRE_HOLE_ID) || SYSTEMS.some((x) => x.id === PYRE_HOLE_ID)).toBe(false);
  });

  it('glows while the star’s gas falls back in, fading as the rules say', () => {
    expect(fallbackGlow(T.breakout - 1, EDGE)).toBe(0);
    expect(fallbackGlow(T.laneOpens, EDGE)).toBe(1);
    expect(fallbackGlow(T.breakout + 2 * DOOMED.timeline.laneOpensAfterBreakout, EDGE)).toBeCloseTo(0.5 ** DOOMED.blackHole.fallbackDecay, 6);
    expect(fallbackGlow(T.breakout + 40 * 3_600, EDGE)).toBeLessThan(0.02);
    expect(fallbackGlow(T.laneOpens, null)).toBe(0);
  });

  it('strains a hull inside the zone drawn for its tides, as the cube of how near, and nowhere outside it', () => {
    expect(tidalStrain(10_001, 10_000)).toBe(0);
    expect(tidalStrain(10_000 - 1e-6, 10_000)).toBeCloseTo(DOOMED.blackHole.hullStrainPerSecond, 4);
    expect(tidalStrain(5_000, 10_000)).toBeCloseTo(8 * DOOMED.blackHole.hullStrainPerSecond, 6);
    expect(tidalStrain(0, 10_000)).toBeLessThan(Infinity);
  });

  it('closes the lane to arrivals from the collapse until the debris has thinned, counting the time a jump takes', () => {
    const gj915 = 'gj-915' as SystemId;
    expect(hopsToPyre(gj915)).toBe(1);
    expect(hopsToPyre('sol')).toBeGreaterThan(2);
    expect(laneClosedReason(T.collapse - 3_600, 1, EDGE)).toBeNull();
    expect(laneClosedReason(T.collapse - 30, 1, EDGE)).toMatch(/closes before you would arrive/);
    expect(laneClosedReason(T.collapse + 10, 1, EDGE)).toMatch(/closed until the debris/);
    expect(laneClosedReason(T.laneOpens, 1, EDGE)).toBeNull();
    expect(laneClosedReason(T.collapse - 30, 1, null)).toBeNull();
  });

  it('takes rescued ships to its refuge when the last dock was one of its stations and is shut, and says why docking is refused', () => {
    expect(getLocation(pyreRefugeId()).systemId).toBe(DOOMED.star.anchor);
    const obs = DOOMED.stations.observatory.id;
    const rem = DOOMED.stations.remnant.id;
    expect(rescueDockId(obs, T.collapse - 1, EDGE)).toBe(obs);
    expect(rescueDockId(obs, T.collapse, EDGE)).toBe(pyreRefugeId());
    expect(rescueDockId(rem, T.stationOpens - 1, EDGE)).toBe(pyreRefugeId());
    expect(rescueDockId(rem, T.stationOpens, EDGE)).toBe(rem);
    expect(rescueDockId('earth-port', T.collapse, EDGE)).toBe('earth-port');
    expect(pyreDockRefusal(obs, T.collapse, EDGE)).toMatch(/evacuated/);
    expect(pyreDockRefusal(rem, T.laneOpens, EDGE)).toMatch(/not open yet/);
    expect(pyreDockRefusal(rem, T.stationOpens, EDGE)).toBeNull();

    // A pilot lost at the hole after its observatory was evacuated comes round at the refuge.
    const s = createNewGame(3);
    s.world.sky = { from: 1_000, edge: EDGE };
    s.clock = T.laneOpens + 100;
    s.location = { systemId: 'pyre' as SystemId, dockedAt: null, flight: null, lastDockId: obs };
    const r = rescueAfterDefeat(s);
    expect(r.dockId).toBe(pyreRefugeId());
    expect(s.location).toMatchObject({ systemId: DOOMED.star.anchor, dockedAt: pyreRefugeId(), lastDockId: pyreRefugeId() });
    expect(s.stats.deaths).toBe(1);
    assertValidState(s);

    // Caught at Pyre when it exploded: carried out, repaired, charged as a rescue, not counted as lost.
    const c = createNewGame(4);
    c.world.sky = { from: 1_000, edge: EDGE };
    c.clock = T.breakout + 1;
    c.location = { systemId: 'pyre' as SystemId, dockedAt: null, flight: null, lastDockId: obs };
    c.ship.hull = 10;
    const credits = c.credits;
    const out = rescueFromPyre(c);
    expect(out.fee).toBe(Math.min(credits, RESCUE_FEE));
    expect(c.credits).toBe(credits - out.fee);
    expect(c.location.dockedAt).toBe(pyreRefugeId());
    expect(c.ship.hull).toBeGreaterThan(10);
    expect(c.stats.deaths).toBe(0);
    assertValidState(c);
  });

  it('in flight: a ship still in Pyre’s system when its light leaves is carried out, once', () => {
    let caught = 0;
    const { flight, run } = flyIn('pyre' as SystemId, T.breakout - 2, { onPyreBreakout: () => caught++ });
    run(1);
    expect(caught).toBe(0);
    run(3);
    expect(caught).toBe(1);
    run(2);
    expect(caught).toBe(1);
    flight.dispose();
  });

  it('in flight: read from outside its tides; the autopilot stops short of them; inside them the hull strains, and the shadow takes the ship', () => {
    let lost = 0;
    const said: string[] = [];
    const { s, flight, run } = flyIn('pyre' as SystemId, T.laneOpens + 60, { onPlayerDestroyed: () => lost++, onMessage: (text: string) => said.push(text) });
    run(0.6);
    const hole = flight.allTargets().find((t) => t.kind === 'hole')!;
    const zone = sceneDefFor('pyre' as SystemId, null, s.clock).blackHole!.tidalRadius;
    flight.selectTarget(hole.id);
    expect(flight.contextAction()?.label).toBe('Scan');
    // Go to the hole: the ship stops outside its tides, its hull whole.
    const hull = flight.playerDurability.hull;
    flight.beginGoTo(hole.id, false);
    run(240);
    expect(flight.autopilotMode).toBe('none');
    const d = flight.player.position.distanceTo(hole.position);
    expect(d).toBeGreaterThan(zone);
    expect(d).toBeLessThan(zone + 2_000);
    expect(flight.playerDurability.hull).toBe(hull);
    // Inside the zone, the hull strains; nearer, faster.
    flight.placeNear(hole.id, zone - hole.radius - 200);
    run(2);
    const lostFar = hull - flight.playerDurability.hull;
    expect(lostFar).toBeGreaterThan(0);
    expect(said.some((t) => /Tidal zone/.test(t))).toBe(true);
    // At its shadow, the ship is lost.
    flight.placeNear(hole.id, 1);
    run(4);
    expect(flight.alive).toBe(false);
    expect(lost).toBe(1);
    flight.dispose();
  });
});

// ---------------------------------------------------------------- its work

describe('its work', () => {
  const INSTITUTES = ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false);
  const pyreWork = (s: GameState, id: string) => postedContracts(s, id).filter((c) => c.id.includes('.pyre-'));
  // Ids end `.pyre-<kind>` (Pyre's own stations' ids hold `pyre-` too).
  const kindOf = (id: string) => id.slice(id.lastIndexOf('.pyre-') + '.pyre-'.length);

  /** A pilot docked at a station at a moment, Pyre's warning at EDGE, a cabin of 3 berths fitted. */
  function pilot(locationId: string, clock: number): GameState {
    const s = createNewGame(21);
    s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
    s.flags.clearance = true;
    s.credits = 50_000;
    s.clock = clock;
    s.world.sky = { from: 1_000, edge: EDGE };
    const loc = getLocation(locationId);
    s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
    markVisited(s, loc.systemId, locationId);
    s.ship.fittings['utility-1'] = 'gear.cabin.2.halden';
    useWorldLog(s.world);
    return s;
  }

  it('is posted where and when the rules say, each piece sound by the contracts’ guardrails', () => {
    useWorldLog(pilot(RESEARCH.id, 0).world);
    const near = INSTITUTES.filter((l) => nearPyre(l.id));
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(INSTITUTES.length);
    const seen = new Map<string, Set<string>>();
    for (let epoch = boardEpoch(EDGE - 3_600); epoch <= boardEpoch(T.stationOpens + 3 * 3_600); epoch++) {
      for (const l of [...INSTITUTES, ...PYRE_LOCATIONS]) {
        for (const c of boardFor(l.id, epoch).filter((x) => x.id.includes('.pyre-'))) {
          const set = seen.get(kindOf(c.id)!) ?? new Set<string>();
          seen.set(kindOf(c.id)!, set.add(l.id));
          expect(contractIssues(c, epoch * CONTRACTS.epochSeconds)).toEqual([]);
          expect(c.contract!.posted!).toBeLessThan((epoch + 1) * CONTRACTS.epochSeconds);
          expect(c.contract!.until!).toBeGreaterThan(epoch * CONTRACTS.epochSeconds);
          expect(postedContract(c.id)?.id).toBe(c.id);
        }
      }
    }
    expect([...seen.get('evacuate')!]).toEqual([DOOMED.stations.observatory.id]);
    expect(seen.get('record')!.size).toBe(INSTITUTES.length);
    expect([...seen.get('twice')!].sort()).toEqual(near.map((l) => l.id).sort());
    expect([...seen.get('hole')!].sort()).toEqual([...near.map((l) => l.id), DOOMED.stations.remnant.id].sort());
    // Nothing before the warning; Pyre's stations post only Pyre's work.
    expect(boardFor(RESEARCH.id, boardEpoch(EDGE) - 2).some((c) => c.id.includes('.pyre-'))).toBe(false);
    for (const l of PYRE_LOCATIONS) for (let e = boardEpoch(EDGE - 7_200); e < boardEpoch(EDGE + 30_000); e++) expect(boardFor(l.id, e).every((c) => c.id.includes('.pyre-'))).toBe(true);
    // The hole's gas still glows when its station opens.
    expect(holeReadUntil(EDGE)).toBeGreaterThan(T.stationOpens);
  });

  it('shows each piece only from when it is posted until it lapses', () => {
    const s = pilot(RESEARCH.id, EDGE - 30);
    expect(pyreWork(s, RESEARCH.id)).toEqual([]);
    s.clock = EDGE + 30;
    expect(pyreWork(s, RESEARCH.id).map((c) => kindOf(c.id))).toContain('record');
    s.clock = T.breakout + 1;
    expect(pyreWork(s, RESEARCH.id).map((c) => kindOf(c.id))).not.toContain('record');
  });

  it('wants its last record from open space anywhere before it explodes, and pays for it back at the station', () => {
    const s = pilot(RESEARCH.id, EDGE + 60);
    const job = pyreWork(s, RESEARCH.id).find((c) => kindOf(c.id) === 'record')!;
    expect(acceptJob(s, job.id).ok).toBe(true);
    expect(observationsWanted(s, DOOMED.star.id)).toEqual([job.id]);
    s.location = { ...s.location, dockedAt: null };
    expect(recordObservation(s, DOOMED.star.id, RESEARCH.systemId)).toEqual([job.id]);
    advanceJobs(s, { dockedAt: null, systemId: RESEARCH.systemId });
    expect(s.jobs[job.id]!.objectiveIndex).toBe(1);
    const before = s.credits;
    expect(dockAt(s, RESEARCH.id).jobEvents.some((e) => e.jobId === job.id && e.kind === 'complete')).toBe(true);
    expect(s.credits - before).toBe(DOOMED.jobs.record.reward);
  });

  it('carries the last observers out to its refuge, even when the ship is caught by the explosion', () => {
    const obs = DOOMED.stations.observatory.id;
    const s = pilot(obs, EDGE + 60);
    const job = pyreWork(s, obs).find((c) => kindOf(c.id) === 'evacuate')!;
    const party = job.contract!.party!;
    expect(party.length).toBeGreaterThanOrEqual(DOOMED.jobs.evacuate.party[0]);
    expect(job.destinationLocationId).toBe(pyreRefugeId());
    expect(acceptJob(s, job.id).ok).toBe(true);
    s.location = { ...s.location, dockedAt: null };
    s.clock = T.breakout + 1;
    const r = rescueFromPyre(s);
    const done = advanceJobs(s, { dockedAt: r.dockId, systemId: getLocation(r.dockId).systemId });
    expect(done.some((e) => e.jobId === job.id && e.kind === 'complete')).toBe(true);
    // The observatory is shut after the collapse: nothing on its board.
    const late = pilot(obs, T.collapse + 1);
    expect(pyreWork(late, obs)).toEqual([]);
  });

  it('counts its first light only within minutes of arriving where it was seen, from two systems, the second farther out', () => {
    const o: ObserveObjective = { kind: 'observe', star: DOOMED.star.id, from: T.breakout, to: T.breakout + 7_200, firstLight: DOOMED.jobs.twice.firstLight, aheadLy: DOOMED.jobs.twice.aheadLy, text: '' };
    const a = DOOMED.star.anchor as SystemId;
    const b = MAP_LINKS.get(a)!.find((x) => x !== 'pyre' && lyFromPyre(x) - lyFromPyre(a) >= DOOMED.jobs.twice.aheadLy)!;
    expect(b).toBeDefined();
    const fresh = (id: SystemId, after = 30) => ({ at: lightArrives(id, EDGE) + after, systemId: id });
    expect(firstLightSeen(o, [fresh(a, -5)], EDGE)).toBe(0);
    expect(firstLightSeen(o, [fresh(a, DOOMED.jobs.twice.firstLight + 1)], EDGE)).toBe(0);
    expect(firstLightSeen(o, [fresh(a)], EDGE)).toBe(1);
    expect(firstLightSeen(o, [fresh(a), fresh(a, 90)], EDGE)).toBe(1);
    expect(firstLightSeen(o, [fresh(a), fresh(b)], EDGE)).toBe(2);
    // A pilot can do it: seen at the anchor, one jump on, and there before its light has been there long.
    expect(lightArrives(a, EDGE) + 30 + 120).toBeLessThan(lightArrives(b, EDGE) + DOOMED.jobs.twice.firstLight);
    // On the board, the objective says how many systems so far.
    const near = INSTITUTES.find((l) => nearPyre(l.id))!;
    const s = pilot(near.id, EDGE + 60);
    const job = pyreWork(s, near.id).find((c) => kindOf(c.id) === 'twice')!;
    expect(acceptJob(s, job.id).ok).toBe(true);
    expect(describeObjective(s, job.id)!.text).toMatch(/0 of 2 seen/);
    s.jobs[job.id]!.observed = [fresh(a), fresh(b)];
    s.location = { ...s.location, dockedAt: null };
    advanceJobs(s, { dockedAt: null, systemId: near.systemId });
    expect(s.jobs[job.id]!.objectiveIndex).toBe(1);
  });

  it('wants its black hole read where it is, and its stations have markets of their own, apart from the world’s', () => {
    const near = INSTITUTES.find((l) => nearPyre(l.id))!;
    const s = pilot(near.id, T.laneOpens + 60);
    const job = pyreWork(s, near.id).find((c) => kindOf(c.id) === 'hole')!;
    expect(acceptJob(s, job.id).ok).toBe(true);
    const d = describeObjective(s, job.id)!;
    expect(d.targetSystemId).toBe(DOOMED.star.id);
    expect(d.targetId).toBe(`hole:${PYRE_HOLE_ID}`);
    expect(recordObservation(s, PYRE_HOLE_ID, DOOMED.star.id as SystemId)).toEqual([job.id]);
    for (const l of PYRE_LOCATIONS) {
      expect(hasMarket(l.id)).toBe(true);
      expect([...marketTables().keys()]).not.toContain(l.id);
    }
  });

  it('says how things stand there, for the star map', () => {
    expect(pyreStatus(EDGE - 1, EDGE)).toMatch(/burns on/);
    expect(pyreStatus(EDGE + 1, EDGE)).toMatch(/evacuating/);
    expect(pyreStatus(T.collapse + 1, EDGE)).toMatch(/collapsed/);
    expect(pyreStatus(T.breakout + 1, EDGE)).toMatch(/lane is closed/);
    expect(pyreStatus(T.laneOpens + 1, EDGE)).toMatch(/black hole/);
    expect(pyreStatus(T.stationOpens + 1, EDGE)).toMatch(/Remnant Station is open/);
    // Its own News tells of no light arriving there.
    expect(edgeNews('pyre' as SystemId, T.stationOpens + 1, EDGE).map((n) => n.kind)).not.toContain('light');
    // The star map lists the station there now, and why it takes no ships.
    const obs = DOOMED.stations.observatory.id;
    const rem = DOOMED.stations.remnant.id;
    expect(pyreStationsNow(EDGE - 1, EDGE)).toEqual([{ id: obs, note: null }]);
    expect(pyreStationsNow(T.collapse + 1, EDGE)).toEqual([{ id: obs, note: 'Evacuated' }]);
    expect(pyreStationsNow(T.breakout + 1, EDGE)).toEqual([{ id: rem, note: 'Not open yet' }]);
    expect(pyreStationsNow(T.stationOpens, EDGE)).toEqual([{ id: rem, note: null }]);
    // Its stations greet a ship as its story stands.
    expect(pyreWelcome(DOOMED.stations.observatory.id, EDGE - 1, EDGE)).toMatch(/^Pyre Observatory: .*reddest light/);
    expect(pyreWelcome(DOOMED.stations.observatory.id, EDGE + 1, EDGE)).toMatch(/alarm is sounding/);
    expect(pyreWelcome(DOOMED.stations.remnant.id, T.stationOpens, EDGE)).toMatch(/well clear of the black hole where Pyre was/);
    expect(pyreWelcome('earth-port', EDGE, EDGE)).toBeNull();
  });
});

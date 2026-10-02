import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { SKY_NEWS } from '../../src/content/stellar/lines.ts';
import { STELLAR } from '../../src/content/stellar/rules.ts';
import { ALL_LOCATIONS, ASTROMETRY, FAR_STARS, getLocation, getSystem, SYSTEMS } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { validateFarStars } from '../../src/data/validate.ts';
import { boardEpoch, boardFor } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { marketEffect, useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs } from '../../src/economy/jobs.ts';
import {
  farStarLook,
  observationsWanted,
  observeDone,
  peakMagnitude,
  recordObservation,
  scheduleSky,
  skyComm,
  skyDirection,
  skyMoment,
  skyNews,
  skyPrice,
  skyTimeline,
  type ObserveObjective,
} from '../../src/economy/stellar.ts';
import { validateStellar, type StellarRules } from '../../src/economy/stellarGuards.ts';
import { emptyInput, type FlightAction } from '../../src/flight/input/types.ts';
import { farStarStyle } from '../../src/world/art/farStars.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Stellar death, as fiction (docs/PROCGEN.md §25): the far stars' data and guardrails, the
 * timeline each save gets once the opening is done, how the stars look and where they are in the
 * sky, the News and the stations' word, prices, observation contracts (a parallax among them),
 * saves, and the flight scene.
 */

afterEach(() => useWorldLog(null));

const FROM = 20_000;
const T = skyTimeline(FROM);
const research = ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false);
const RESEARCH = research[0]!;

/** A pilot past the opening, docked at a station, the far stars' timeline set, its world log in use. */
function pilotAt(locationId: string, clock: number, from: number | null = FROM): GameState {
  const s = createNewGame(9);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 10_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  if (from !== null) s.world.sky = { from };
  useWorldLog(s.world);
  return s;
}

const lyApart = (a: SystemId, b: SystemId) => {
  const [p, q] = [getSystem(a).positionLy, getSystem(b).positionLy];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

describe('the far stars', () => {
  it('are two real red supergiants far beyond the map, cited, provisional until a snapshot checks them', () => {
    expect(FAR_STARS.stars.map((f) => f.id)).toEqual(['betelgeuse', 'antares']);
    expect(validateFarStars(FAR_STARS, SYSTEMS, ASTROMETRY)).toEqual([]);
    const b = FAR_STARS.stars[0]!;
    expect(b.spectralType).toMatch(/^M/);
    expect(b.distanceLightYears).toBeGreaterThan(400);
    expect(b.verification).toBe('provisional');
    expect(b.astrometrySource.url).toMatch(/^https:/);
    // A far star placed among the map's stars is caught.
    const near = { ...FAR_STARS, stars: [{ ...b, parallaxMas: 500, distanceLightYears: 6.523127554, positionLy: [6.5, 0, 0] as [number, number, number] }] };
    expect(validateFarStars(near, SYSTEMS, ASTROMETRY).map((i) => i.code)).toEqual(expect.arrayContaining(['far-near']));
  });

  it('sit in every sky in their true direction: Betelgeuse 16° south of the ecliptic, Antares close to it, shifting by no more than their parallax', () => {
    const b = skyDirection('sol', 'betelgeuse');
    expect((Math.asin(b[1]) * 180) / Math.PI).toBeCloseTo(-16.03, 1);
    const a = skyDirection('sol', 'antares');
    expect((Math.asin(a[1]) * 180) / Math.PI).toBeCloseTo(-4.57, 1);
    const far = SYSTEMS.reduce((x, y) => (Math.hypot(...x.positionLy) > Math.hypot(...y.positionLy) ? x : y));
    const there = skyDirection(far.id, 'betelgeuse');
    const angle = Math.acos(b[0] * there[0] + b[1] * there[1] + b[2] * there[2]);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(Math.asin(Math.hypot(...far.positionLy) / FAR_STARS.stars[0]!.distanceLightYears) + 1e-6);
  });
});

describe('the rules', () => {
  it('pass their guardrails: a supernova outshining every star but not the Moon, from a typical peak at the real distance', () => {
    expect(validateStellar()).toEqual([]);
    const peak = peakMagnitude();
    expect(peak).toBeCloseTo(-10.83, 1);
    expect(peak).toBeLessThan(-1.46);
    expect(peak).toBeGreaterThan(-12.7);
  });

  it('catch broken ones: a peak brighter than the Moon, a timeline that runs back, Antares stirring before the peak, a line with a number, an unpaid observation', () => {
    const broken = (patch: (r: StellarRules) => void) => {
      const r = structuredClone(STELLAR) as StellarRules;
      patch(r);
      return validateStellar(r).map((i) => i.rule);
    };
    expect(broken((r) => ((r.supernova as { peakAbsoluteMagnitude: number }).peakAbsoluteMagnitude = -24))).toContain('brightness');
    expect(broken((r) => ((r.supernova as { rise: number }).rise = -5))).toContain('rules');
    expect(broken((r) => ((r.blackHole as { alertAfterSupernova: number }).alertAfterSupernova = 60))).toContain('rules');
    expect(broken((r) => ((r.observe.reward as { first: number }).first = 0))).toContain('observe');
    expect(broken((r) => ((r.observe as { baselineLy: number }).baselineLy = 2))).toContain('observe');
    const keep = SKY_NEWS.light.detail;
    (SKY_NEWS.light as { detail: string }).detail = 'It reached magnitude -11 in 3 days.';
    expect(validateStellar().map((i) => i.rule)).toContain('lines');
    (SKY_NEWS.light as { detail: string }).detail = keep;
  });
});

describe('the timeline', () => {
  it('is set once the opening delivery is done (or soon after loading an older save), and never moves', () => {
    const s = createNewGame(3);
    s.clock = 600;
    expect(scheduleSky(s)).toBe(false);
    s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 600 };
    expect(scheduleSky(s)).toBe(true);
    expect(s.world.sky).toEqual({ from: 600 + STELLAR.alertAfterOpening });
    s.clock = 9_999;
    expect(scheduleSky(s)).toBe(false);
    expect(s.world.sky!.from).toBe(600 + STELLAR.alertAfterOpening);
    const old = createNewGame(4);
    old.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 300 };
    old.clock = 50_000;
    scheduleSky(old);
    expect(old.world.sky).toEqual({ from: 50_000 + STELLAR.alertAfterLoad });
  });

  it('runs forward: the alert, the light, the peak, its end, the fading; then Antares stirs, flickers and goes out', () => {
    const order = [T.alert, T.light, T.peak, T.peakEnd, T.fadeEnd];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(T.bhAlert).toBeGreaterThan(T.peakEnd);
    expect([T.bhAlert, T.bhLight, T.bhHoldEnd, T.bhGone].every((t, i, l) => i === 0 || t > l[i - 1]!)).toBe(true);
  });

  it('changes how the stars look: the catalogue’s Betelgeuse until its light comes, then a supernova to a remnant; Antares brightens, then is gone', () => {
    const b = FAR_STARS.stars[0]!;
    const a = FAR_STARS.stars[1]!;
    expect(farStarLook('betelgeuse', T.light - 1, FROM)).toEqual({ magnitude: b.magnitudeV, colour: b.colorHex });
    expect(farStarLook('betelgeuse', T.peak, FROM)!.magnitude).toBeCloseTo(peakMagnitude(), 6);
    expect(farStarLook('betelgeuse', T.peakEnd - 1, FROM)!.magnitude).toBeLessThan(peakMagnitude() + 0.51);
    expect(farStarLook('betelgeuse', T.fadeEnd + 1, FROM)).toEqual({ magnitude: STELLAR.supernova.remnantMagnitude, colour: STELLAR.supernova.remnantColour });
    expect(farStarLook('antares', T.bhLight - 1, FROM)!.magnitude).toBe(a.magnitudeV);
    expect(farStarLook('antares', T.bhLight + 300, FROM)!.magnitude).toBeCloseTo(a.magnitudeV - STELLAR.blackHole.brighten, 6);
    expect(farStarLook('antares', T.bhGone + 1, FROM)!.magnitude).toBe(Infinity);
    // Without a timeline the sky is the catalogue's.
    expect(farStarLook('betelgeuse', T.peak, null)!.magnitude).toBe(b.magnitudeV);
    // Drawn as bright as it is: nothing past the naked eye, a halo only for a supernova.
    expect(farStarStyle(7).size).toBe(0);
    expect(farStarStyle(b.magnitudeV).halo).toBe(0);
    expect(farStarStyle(peakMagnitude()).halo).toBeGreaterThan(0.9);
  });
});

describe('the News and the stations’ word', () => {
  it('tell each moment as it comes, from the catalogue’s numbers, newest first, and the stations call the big ones', () => {
    expect(skyNews(T.alert - 1, FROM)).toEqual([]);
    expect(skyNews(T.alert + 1, FROM).map((n) => n.kind)).toEqual(['alert']);
    const later = skyNews(T.bhGone + 10, FROM);
    expect(later.map((n) => n.kind)).toEqual(['bh-gone', 'bh-light', 'bh-alert', 'remnant', 'fading', 'light', 'alert'].filter((k) => later.some((n) => n.kind === k)));
    const light = skyNews(T.light + 1, FROM)[0]!;
    expect(light.headline).toBe('Betelgeuse has exploded');
    expect(light.detail).toContain(`magnitude −${Math.abs(peakMagnitude()).toFixed(1)}`);
    for (const n of later) expect(`${n.headline} ${n.detail}`).not.toMatch(/\{|\}/);
    expect(skyMoment(T.light + 1, FROM)).toBe('light');
    expect(skyComm('alert')!.text).toContain('Betelgeuse');
    expect(skyComm('fading')).toBeNull();
    // Long after it is over, the News moves on.
    expect(skyNews(Math.max(T.fadeEnd, T.bhGone) + 7 * 3_600, FROM)).toEqual([]);
  });
});

describe('markets', () => {
  it('pay more for data cores at research stations while a star dies, and nowhere else or after', () => {
    const other = ALL_LOCATIONS.find((l) => l.stationType && l.stationType !== 'research-station' && l.status === 'functional')!;
    expect(skyPrice(RESEARCH.id, 'data-cores', T.light, FROM)).toBe(STELLAR.market.price);
    expect(skyPrice(RESEARCH.id, 'food', T.light, FROM)).toBe(1);
    expect(skyPrice(other.id, 'data-cores', T.light, FROM)).toBe(1);
    expect(skyPrice(RESEARCH.id, 'data-cores', T.alert - 1, FROM)).toBe(1);
    expect(skyPrice(RESEARCH.id, 'data-cores', T.fadeEnd + 1, FROM)).toBe(1);
    pilotAt(RESEARCH.id, T.light);
    expect(marketEffect(RESEARCH.id, 'data-cores', T.light).price).toBeCloseTo(STELLAR.market.price, 6);
  });
});

describe('observation contracts', () => {
  it('are posted at research stations while a star dies, pass the contract guardrails, and pay for readings taken in the window', () => {
    const s = pilotAt(RESEARCH.id, T.alert + 60);
    const epoch = boardEpoch(s.clock);
    const board = boardFor(RESEARCH.id, epoch);
    const first = board.find((c) => c.id.endsWith('.sky-first'))!;
    expect(first).toBeDefined();
    expect(board.some((c) => c.id.endsWith('.sky-parallax'))).toBe(true);
    expect(boardFor(ALL_LOCATIONS.find((l) => l.stationType === 'trade-port')!.id, epoch).some((c) => c.id.includes('.sky-'))).toBe(false);
    for (const c of board.filter((x) => x.id.includes('.sky-'))) expect(contractIssues(c, s.clock)).toEqual([]);
    expect(acceptJob(s, first.id).ok).toBe(true);
    // Before the light comes there is nothing to read.
    expect(observationsWanted(s, 'betelgeuse')).toEqual([]);
    s.clock = T.light + 30;
    s.location = { ...s.location, dockedAt: null };
    expect(observationsWanted(s, 'betelgeuse')).toEqual([first.id]);
    expect(recordObservation(s, 'betelgeuse', RESEARCH.systemId)).toEqual([first.id]);
    // A second reading from the same system a moment later still counts, but is not stored twice.
    expect(recordObservation(s, 'betelgeuse', RESEARCH.systemId)).toEqual([first.id]);
    expect(s.jobs[first.id]!.observed).toHaveLength(1);
    expect(advanceJobs(s, { dockedAt: null, systemId: RESEARCH.systemId }).map((e) => e.kind)).toEqual(['objective']);
    const before = s.credits;
    const done = dockAt(s, RESEARCH.id).jobEvents.find((e) => e.kind === 'complete')!;
    expect(done).toBeDefined();
    expect(s.credits - before).toBe(STELLAR.observe.reward.first);
    assertValidState(s);
  });

  it('measure a parallax only from two systems far enough apart, both in the window', () => {
    const o: ObserveObjective = { kind: 'observe', star: 'betelgeuse', from: T.light, to: T.fadeEnd, baselineLy: STELLAR.observe.baselineLy, text: '' };
    const here = RESEARCH.systemId;
    const far = SYSTEMS.find((x) => lyApart(here, x.id) >= STELLAR.observe.baselineLy)!.id;
    const near = SYSTEMS.find((x) => x.id !== here && lyApart(here, x.id) < STELLAR.observe.baselineLy / 2)!.id;
    expect(observeDone(o, [{ at: T.light + 10, systemId: here }])).toBe(false);
    expect(observeDone(o, [{ at: T.light + 10, systemId: here }, { at: T.light + 900, systemId: near }])).toBe(false);
    expect(observeDone(o, [{ at: T.light + 10, systemId: here }, { at: T.light + 900, systemId: far }])).toBe(true);
    expect(observeDone(o, [{ at: T.alert, systemId: here }, { at: T.light + 900, systemId: far }])).toBe(false);
  });

  it('keep to research stations in the epochs a star dies, and Antares has a watch of its own', () => {
    const s = pilotAt(RESEARCH.id, T.bhAlert + 30);
    const board = boardFor(RESEARCH.id, boardEpoch(s.clock));
    expect(board.some((c) => c.id.endsWith('.sky-vanish'))).toBe(true);
    pilotAt(RESEARCH.id, T.alert - 2 * CONTRACTS.epochSeconds);
    expect(boardFor(RESEARCH.id, boardEpoch(T.alert - 2 * CONTRACTS.epochSeconds)).some((c) => c.id.includes('.sky-'))).toBe(false);
  });
});

describe('saves', () => {
  it('keep the timeline and observations, and refuse damaged ones', () => {
    const s = pilotAt(RESEARCH.id, T.light);
    s.jobs['c.x'] = { status: 'active', objectiveIndex: 0, acceptedAt: 1, observed: [{ at: T.light, systemId: RESEARCH.systemId }] };
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.world.sky = { from: Number.NaN }))).toThrow(/world/);
    expect(bad((x) => (x.jobs['c.x']!.observed = [{ at: 1, systemId: 'nowhere' as SystemId }]))).toThrow(/job/);
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

describe('in flight', () => {
  it('shows a dying star as a target light-years away, observed from where the ship is (never flown to), when a contract wants it', () => {
    installCanvasStub();
    const s = pilotAt(RESEARCH.id, T.alert + 60);
    const first = boardFor(RESEARCH.id, boardEpoch(s.clock)).find((c) => c.id.endsWith('.sky-first'))!;
    expect(acceptJob(s, first.id).ok).toBe(true);
    s.clock = T.light + 60;
    s.location = { ...s.location, dockedAt: null, flight: null };
    const observed: string[] = [];
    const nothing = () => {};
    const flight = new FlightSession({
      system: new SystemScene(sceneDefFor(RESEARCH.systemId), { quality: 'low', reducedMotion: true }),
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
        onObserve: (star) => observed.push(star),
      },
      traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: null },
    });
    flight.start({ kind: 'arrival' });
    const run = (seconds: number, actions: FlightAction[] = []) => {
      for (let t = 0; t < seconds; t += 1 / 20) {
        const input = emptyInput();
        for (const a of actions) input.actions.add(a);
        actions = [];
        s.clock += 1 / 20;
        flight.update(1 / 20, input);
      }
    };
    run(1);
    const target = flight.allTargets().find((t) => t.id === 'sky:betelgeuse')!;
    expect(target).toBeDefined();
    expect(target.kind).toBe('sky');
    expect(target.distanceLabel).toMatch(/ly$/);
    expect(target.subtitle).toMatch(/^Supernova · magnitude −/);
    // The star is real; its death is fiction.
    expect(target.dataClass).toBe('fictional');
    expect(flight.allTargets().some((t) => t.id === 'sky:antares')).toBe(false);
    flight.selectTarget(target.id);
    expect(flight.contextAction()).toEqual({ label: 'Observe', action: 'scan', icon: 'scan' });
    run(0.2, ['scan']);
    expect(observed).toEqual(['betelgeuse']);
    // Never flown to: Go to does nothing.
    flight.beginGoTo(target.id, false);
    expect(flight.autopilotMode).not.toBe('goto');
    // Once it has faded, what is left is fiction too; before its light, the star was the catalogue's.
    s.clock = T.fadeEnd + 1;
    run(0.6);
    expect(target.dataClass).toBe('fictional');
    expect(target.subtitle).toBe(`Supernova remnant · magnitude ${STELLAR.supernova.remnantMagnitude.toFixed(1)}`);
    s.clock = T.alert;
    run(0.6);
    expect(target.dataClass).toBe('observed');
    expect(target.subtitle).toBe(`${FAR_STARS.stars[0]!.spectralType} · ${Math.round(FAR_STARS.stars[0]!.distanceLightYears)} ly`);
    flight.dispose();
  });
});

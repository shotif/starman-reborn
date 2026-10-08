import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { RACING } from '../../src/content/racing/rules.ts';
import { rng } from '../../src/content/random.ts';
import { ROSTER } from '../../src/content/rivals/rules.ts';
import { emptyInput, type FlightAction } from '../../src/flight/input/types.ts';
import { checkMilestones, rating } from '../../src/economy/progress.ts';
import {
  clubRecord,
  courseById,
  courseKey,
  endEntry,
  enterRace,
  entryBlock,
  entryHeat,
  feeOf,
  finishRace,
  gridOf,
  heatStart,
  lineUp,
  ownParRun,
  prizeFor,
  raceClass,
  racingLog,
  racingNews,
  racingScore,
  rivalsInHeat,
  settleRacing,
  venueAt,
  venues,
  type Standing,
} from '../../src/economy/racing.ts';
import { validateRacing } from '../../src/economy/racingGuards.ts';
import { shift } from '../../src/economy/rivals.ts';
import { bodyPosition, bodyTurn, courseIssues, crossesGate, layCourse, missedGate, placedLine, type RaceGate } from '../../src/world/courses.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { RaceRun, type RaceEvent, type RaceSetup } from '../../src/world/RaceRun.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

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

/** A pilot past the opening, with money, docked at Halcyon Ring's club. */
function pilot(): GameState {
  const s = createNewGame(1);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.credits = 5_000;
  s.clock = 10_000;
  return s;
}

const SPRINT = 'race.earth-port.sprint';

describe('races: rules and guardrails', () => {
  it('passes every guardrail', { timeout: 180_000 }, () => {
    expect(validateRacing()).toEqual([]);
  });

  it('catches broken rules', () => {
    const msgs = (patch: object) => validateRacing({ ...RACING, ...patch } as unknown as typeof RACING).map((i) => i.message);
    expect(msgs({ sprint: { ...RACING.sprint, gate: 40 } })).toContain('gates too narrow to thread on touch');
    expect(msgs({ pay: { ...RACING.pay, purse: { sprint: 450, run: 5_000 } } })).toContain('a purse over a quarter of the contracts’ ceiling');
    expect(msgs({ pay: { ...RACING.pay, fee: { sprint: 5, run: 120 } } })).toContain('a fee too small for its purse');
    expect(msgs({ heatSeconds: 300 })).toContain('a heat too short or too long');
    expect(msgs({ record: [0.8, 0.99] })).toContain('a record not a little better than the best racer');
  });
});

describe('races: clubs and courses', () => {
  it('holds clubs in well-policed space, Sol’s a novice club, the same every time', () => {
    const list = venues();
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(venueAt('earth-port')).toMatchObject({ systemId: 'sol', level: 1 });
    const again = layCourse({ id: SPRINT, kind: 'sprint', systemId: 'sol', hostId: 'earth-port' })!;
    expect(again.gates.map((g) => g.pos.toArray())).toEqual(courseById(SPRINT)!.line.gates.map((g) => g.pos.toArray()));
    expect(courseById(SPRINT)!.line.bodyId).toBe('moon');
  });

  it('keeps Sol’s Moon Loop clear at any date, the same shape round the Moon, turning with it as it keeps its face to Earth', () => {
    const line = courseById(SPRINT)!.line;
    for (let i = 0; i < 20; i++) {
      const def = sceneDefFor('sol', 2_461_000 + i * 41.3);
      expect(courseIssues(def, placedLine(def, line).gates, bodyPosition(def, 'moon')!, RACING.sprint)).toEqual([]);
    }
    // A week apart, the Moon a quarter of the way round Earth: the course turns with it, its shape the same.
    const [a, b] = [sceneDefFor('sol', 2_461_330), sceneDefFor('sol', 2_461_337)];
    const [ga, gb] = [placedLine(a, line).gates, placedLine(b, line).gates];
    expect((bodyTurn(a, 'moon').angleTo(bodyTurn(b, 'moon')) * 180) / Math.PI).toBeGreaterThan(60);
    expect(ga[0]!.pos.distanceTo(ga[3]!.pos)).toBeCloseTo(gb[0]!.pos.distanceTo(gb[3]!.pos), 6);
  });

  it('counts a gate only crossed the right way, inside it; a near miss is a miss', () => {
    const g: RaceGate = { pos: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(0, 0, 1), radius: 100 };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    expect(crossesGate(v(0, 0, -10), v(0, 0, 30), g)).toBeCloseTo(0.25);
    expect(crossesGate(v(0, 0, 30), v(0, 0, -10), g)).toBeNull();
    expect(crossesGate(v(150, 0, -10), v(150, 0, 10), g)).toBeNull();
    expect(missedGate(v(150, 0, -10), v(150, 0, 10), g)).toBe(true);
    expect(missedGate(v(500, 0, -10), v(500, 0, 10), g)).toBe(false);
    expect(crossesGate(v(0, 50, -5), v(0, 50, 5), g)).toBeCloseTo(0.5);
    expect(crossesGate(v(0, 0, 0.5), v(0, 0, 1), g)).toBeNull();
    // A fast step: 900 m in one go, through the middle.
    expect(crossesGate(v(10, 0, -300), v(10, 0, 600), g)).toBeCloseTo(1 / 3);
  });
});

describe('races: fields, par and records', () => {
  it('lines up the same field every time, rivals only of the class and never one out for the pilot', () => {
    const s = pilot();
    expect(lineUp(s, SPRINT, 'light', 40)).toEqual(lineUp(s, SPRINT, 'light', 40));
    expect(lineUp(s, SPRINT, 'light', 40).length).toBe(RACING.field.size);
    // A heat with a rival in it: they race in their own ship's class.
    const club = venueAt('regent-concourse')!;
    let found: { heat: number; id: string } | null = null;
    for (let h = 0; h < 400 && !found; h++) {
      const r = rivalsInHeat(s, club, 'heavy', h)[0];
      if (r) found = { heat: h, id: r.id };
    }
    expect(found).not.toBeNull();
    const field = lineUp(s, club.courses.sprint.id, 'heavy', found!.heat);
    expect(field.some((r) => r.rival === found!.id && raceClass(r.model) === 'heavy')).toBe(true);
    shift(s, found!.id, -60);
    expect(lineUp(s, club.courses.sprint.id, 'heavy', found!.heat).some((r) => r.rival === found!.id)).toBe(false);
    for (const r of ROSTER) expect(['light', 'heavy']).toContain(raceClass(r.ship));
  });

  it('works out par with a split at every gate, and a record no racer in a heat beats', () => {
    const s = pilot();
    const line = courseById(SPRINT)!.line;
    const par = ownParRun(line, s.ship)!;
    expect(par.splits.length).toBe(line.gates.length);
    expect(par.splits.at(-1)).toBeCloseTo(par.finish, 6);
    const rec = clubRecord(SPRINT, 'light')!;
    expect(rec.time).toBeGreaterThan(0);
    expect(rec.time).toBeLessThan(par.finish * 1.5);
  });
});

describe('races: in flight, the racers on their own clock', () => {
  installCanvasStub();

  function stage(): { run: RaceRun; setup: RaceSetup; box: THREE.Vector3 } {
    const s = pilot();
    const { venue, line } = courseById(SPRINT)!;
    const heat = 30;
    const racers = lineUp(s, SPRINT, 'light', heat);
    const setup: RaceSetup = { courseId: SPRINT, name: 'Moon Loop', club: venue.club, cls: 'light', closes: 1e9, racers, grid: gridOf(racers), par: ownParRun(line, s.ship), best: null, cutoff: 600 };
    const def = sceneDefFor('sol', null);
    const origin = bodyPosition(def, 'moon')!.clone();
    const run = new RaceRun(setup, placedLine(def, line), origin, new THREE.Scene(), { quality: 'low', reducedMotion: true }, []);
    const box = run.allTargets().find((t) => t.id === 'race-box')!.position.clone();
    return { run, setup, box };
  }

  /** Flies a staged race to the start and on for `seconds`, in frames from `frame()`; the pilot sits in the box. */
  function fly(frame: () => number, seconds: number) {
    const { run, box } = stage();
    const cam = new THREE.PerspectiveCamera();
    run.update(0.1, box, box, 0, 100, cam, 0);
    expect(run.canStart()).toBe(true);
    run.start();
    let t = 0;
    const events: RaceEvent[] = [];
    while (t < seconds) {
      const dt = frame();
      t += dt;
      events.push(...run.update(dt, box, box, 0, 100, cam, t));
    }
    return { run, events };
  }

  it('flies a heat the same at any frame rate, and the times worked out ahead come true', { timeout: 120_000 }, () => {
    const r = rng(7, 'frames');
    const runs = [() => 1 / 144, () => 1 / 24, () => r.range(0.004, 0.1), () => 0.8].map((f) => fly(f, 260).run.status().racers.map((x) => x.finish));
    for (const other of runs.slice(1)) expect(other).toEqual(runs[0]);
    expect(runs[0]!.every((x) => x !== null)).toBe(true);
    // Worked out early, from where they are: the same times.
    const early = fly(() => 1 / 30, 25).run.field().map((f) => f.time);
    expect(early).toEqual(runs[0]!.map((x) => Math.round(x! * 1000) / 1000));
  });

  it('stops a start from over the line', () => {
    const { run, box } = stage();
    const cam = new THREE.PerspectiveCamera();
    run.update(0.1, box, box, 0, 100, cam, 0);
    run.start();
    const over = run.gateAt(0)!.position.clone().addScaledVector(run.gateAt(0)!.normal, 50);
    expect(run.update(0.1, box, over, 20, 100, cam, 0.1)).toEqual([{ kind: 'false-start' }]);
    expect(run.phase).toBe('approach');
  });
});

describe('races: the pilot’s entries and results', () => {
  it('takes an entry only when the pilot can race, charges the fee, and lapses it unstarted', () => {
    const s = pilot();
    s.jobs.lifeline = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(entryBlock(s, SPRINT)).toMatch(/first delivery/);
    s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
    s.law.fines.sta = 200;
    expect(entryBlock(s, SPRINT)).toMatch(/fines/);
    s.law.fines = {};
    s.reputation.sta = -20;
    expect(entryBlock(s, SPRINT)).toMatch(/wary/);
    s.reputation.sta = 0;
    s.credits = 10;
    expect(entryBlock(s, SPRINT)).toMatch(/fee/);
    s.credits = 5_000;
    const venue = venueAt('earth-port')!;
    expect(enterRace(s, SPRINT).ok).toBe(true);
    expect(s.credits).toBe(5_000 - feeOf(venue, 'sprint'));
    expect(entryBlock(s, SPRINT)).toMatch(/entry already/);
    // Late in a heat, the entry is for the next.
    expect(entryHeat(heatStart(9) + RACING.heatSeconds - 100)).toBe(10);
    expect(settleRacing(s, false)).toBeNull();
    s.clock = heatStart(racingLog(s)!.entry!.heat + 1);
    expect(settleRacing(s, false)?.how).toBe('lapsed');
    // A new heat is open: the pilot may enter it.
    expect(entryBlock(s, SPRINT)).toBeNull();
  });

  it('places, pays, records and rates a finish; the record purse once; the save keeps it', () => {
    const s = pilot();
    enterRace(s, SPRINT);
    const venue = venueAt('earth-port')!;
    const rec = clubRecord(SPRINT, 'light')!;
    const field: Standing[] = [
      { id: 'a', name: 'A', model: 'ship.courier.1.halden', time: rec.time + 5 },
      { id: 'b', name: 'B', model: 'ship.courier.1.halden', time: rec.time + 9 },
    ];
    const before = s.credits;
    const card = finishRace(s, rec.time - 1, field)!;
    expect(card).toMatchObject({ place: 1, of: 3, prize: prizeFor(venue, 'sprint', 1), recordPrize: RACING.pay.record, best: true });
    expect(s.credits).toBe(before + prizeFor(venue, 'sprint', 1) + RACING.pay.record);
    const c = racingLog(s)!.courses[courseKey(SPRINT, 'light')]!;
    expect(c).toMatchObject({ runs: 1, finished: 1, podiums: 1, wins: 1 });
    expect(racingScore(s)).toBe(venue.level * (1 + 2 + 3 + 5));
    expect(rating(s, 'racing').rank).toBe('Rookie');
    expect(checkMilestones(s).map((m) => m.id)).toEqual(expect.arrayContaining(['race-won', 'course-record']));
    expect(racingNews(s, 'sol', s.clock)[0]?.headline).toMatch(/record/);
    // A later heat: second, no record purse again.
    s.clock = heatStart(racingLog(s)!.ran! + 1) + 10;
    enterRace(s, SPRINT);
    const second = finishRace(s, rec.time - 2, [{ id: 'x', name: 'X', model: 'ship.courier.1.halden', time: rec.time - 3 }])!;
    expect(second).toMatchObject({ place: 2, recordPrize: 0 });
    expect(() => assertValidState(s)).not.toThrow();
    // Retiring counts a run, no finish.
    s.clock = heatStart(racingLog(s)!.ran! + 1) + 10;
    enterRace(s, SPRINT);
    expect(endEntry(s, 'retired', 'x', 4)?.place).toBe(0);
    expect(racingLog(s)!.courses[courseKey(SPRINT, 'light')]!.runs).toBe(3);
    expect(() => assertValidState(s)).not.toThrow();
  });

  it('refuses a damaged racing log', () => {
    const s = pilot();
    enterRace(s, SPRINT);
    finishRace(s, 120, [])!;
    const refuse = (patch: (x: GameState) => void) => {
      const bad = structuredClone(s);
      patch(bad);
      expect(() => assertValidState(bad)).toThrow(/damaged/);
    };
    const key = courseKey(SPRINT, 'light');
    refuse((x) => (x.world.racing!.courses[key]!.wins = 5));
    refuse((x) => (x.world.racing!.courses[key]!.best!.raw = 1));
    refuse((x) => (x.world.racing!.courses['race.nowhere.sprint.light'] = { runs: 0, finished: 0, podiums: 0, wins: 0 }));
    refuse((x) => x.world.racing!.results.push({ ...x.world.racing!.results[0]! }));
    refuse((x) => ((x.world.racing!.results[0] as { cls: string }).cls = 'medium'));
    refuse((x) => (x.world.racing!.entry = { course: SPRINT, cls: 'light', heat: x.world.racing!.ran!, at: x.clock, fee: 30 }));
  });
});

describe('races: the flight', () => {
  installCanvasStub();

  it('starts from the box, seals cruise, guns and the autopilot, and retires a pilot held still', () => {
    const s = pilot();
    s.location.systemId = 'sol';
    s.location.dockedAt = null;
    enterRace(s, SPRINT);
    const e = racingLog(s)!.entry!;
    const { line } = courseById(SPRINT)!;
    const racers = lineUp(s, SPRINT, 'light', e.heat);
    const events: RaceEvent[] = [];
    const messages: string[] = [];
    const nothing = () => {};
    const flight = new FlightSession({
      system: new SystemScene(sceneDefFor('sol', null, s.clock), { quality: 'low', reducedMotion: true }),
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
        onMessage: (t) => messages.push(t),
        onRace: (ev) => events.push(ev),
      },
      lanes: false,
      traffic: {
        ...trafficFor('sol', 'low', s.clock),
        plan: { ...trafficFor('sol', 'low', s.clock).plan, packs: null, patrolWings: 0 },
        race: { courseId: SPRINT, name: 'Moon Loop', club: 'Tailwind Club', cls: 'light', closes: heatStart(e.heat + 1), racers, grid: gridOf(racers), par: ownParRun(line, s.ship), best: null, cutoff: 600 },
      },
    });
    flight.start({ kind: 'arrival' });
    const step = (seconds: number, action?: FlightAction) => {
      for (let t = 0; t < seconds; t += 0.1) {
        s.clock += 0.1;
        const input = emptyInput();
        if (action && t === 0) input.actions.add(action);
        flight.update(0.1, input);
      }
    };
    s.clock = Math.max(s.clock, heatStart(e.heat) + 1);
    expect(flight.raceStatus()?.phase).toBe('approach');
    flight.raceAt(-1);
    step(0.5);
    expect(flight.contextAction()?.label).toBe('Start');
    step(0.2, 'interact');
    expect(events.some((x) => x.kind === 'count')).toBe(true);
    step(3.5);
    expect(flight.raceStatus()?.phase).toBe('on');
    step(0.2, 'cruise');
    expect(messages).toContain('No cruise on a Sprint.');
    expect(flight.player.cruise).toBe('off');
    flight.beginGoTo('station:earth-port', true);
    expect(messages).toContain('Fly the course yourself.');
    expect(flight.autopilotMode).toBe('none');
    // Held still: Retire on the action, and it retires.
    flight.raceAt(-1);
    step(3.5);
    expect(flight.contextAction()?.label).toBe('Retire');
    step(0.2, 'interact');
    expect(events.some((x) => x.kind === 'retired')).toBe(true);
    expect(flight.raceStatus()?.phase).toBe('done');
    flight.dispose();
  });
});

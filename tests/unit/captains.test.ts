import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OwnedShip } from '../../src/app/state.ts';
import { shipModel } from '../../src/content/catalog.ts';
import { HAULS } from '../../src/content/economy/hauls.ts';
import { FLEET } from '../../src/content/fleet/rules.ts';
import { getLocation, isFrontier } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import {
  captainLost,
  captainSeen,
  captainsIn,
  haulerNext,
  haulerStatus,
  haulEstimate,
  haulGoods,
  haulRisk,
  haulTimes,
  hireHauler,
  insurancePayout,
  runLuck,
  runRaid,
  runWay,
  settleFleet,
} from '../../src/economy/fleet.ts';
import { sampleRuns, validateFleetLanes, type RunSample } from '../../src/economy/fleetGuards.ts';
import { newShipState } from '../../src/economy/loadout.ts';
import { hasMarket } from '../../src/economy/markets.ts';
import { recordMarketVisit } from '../../src/economy/trade.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Your captains on the lanes (docs/PROCGEN.md §18.6): a run's way and where raiders strike it, the
 * fleet settling in flight, and the player's own haulers in the flight scene: met, guarded through
 * a raid, or lost.
 */

afterEach(() => useWorldLog(null));

const FREIGHTER = 'ship.freighter.1.halden';
const SHIP = shipModel(FREIGHTER).name;
/** A lawless route (Ross 154 to Wolf 1061), and the hire times whose first run meets raiders: the ship kept, or lost. */
const LAWLESS = { from: 'regent-concourse', to: 'flotsam-diggings', good: 'consumer-goods' as const };

function dock(s: GameState, locationId: string): void {
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  if (hasMarket(locationId)) recordMarketVisit(s, locationId);
}

/** A pilot docked at `from` with a freighter parked there, who knows the prices at `to`. */
function withParked(from: string, to: string, clock = 0): { s: GameState; o: OwnedShip } {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 100_000;
  s.clock = clock;
  dock(s, to);
  dock(s, from);
  const o: OwnedShip = { id: 'ship-1', ship: newShipState(FREIGHTER), locationId: from };
  s.fleet.ships.push(o);
  return { s, o };
}

/** The first hire time on a route whose first run meets raiders, keeping the ship or losing it. */
function raidedHire(from: string, to: string, shipLost: boolean): number {
  const seed = createNewGame(17).seed;
  for (let hired = 0; hired < 40_000; hired++) {
    const luck = runLuck(seed, 'ship-1', hired, 0);
    const risk = haulRisk(from, to, hired + FLEET.haulers.loadSeconds);
    if (luck.raid < risk.raided && luck.loss < risk.shipLost === shipLost) return hired;
  }
  throw new Error('no raided run');
}

/** A captain on the lawless route, hired at `hired` (insured or not). */
function hired(hiredAt: number, insured = true): { s: GameState; o: OwnedShip } {
  const { s, o } = withParked(LAWLESS.from, LAWLESS.to, hiredAt);
  expect(hireHauler(s, o.id, LAWLESS.to, LAWLESS.good, insured).ok).toBe(true);
  return { s, o };
}

describe('a run’s way', () => {
  it('flies the route’s systems in legs like a timetable haul’s, scaled to the run’s time each way', () => {
    // Between two docks of one system: one leg each way.
    const local = runWay({ route: { from: 'earth-port', to: 'mars-depot', commodity: 'food' }, since: 1_000 });
    const t = haulTimes('earth-port', 'mars-depot');
    expect(local.out).toEqual([{ systemId: 'sol', kind: 'local', start: 1_000 + t.load, end: 1_000 + t.load + t.oneWay }]);
    expect(local.back).toEqual([{ systemId: 'sol', kind: 'local', start: 1_000 + t.load + t.oneWay, end: 1_000 + t.run }]);
    // One jump: out of the dock to the beacon, a jump, and in to the dock; home the same way back.
    const one = runWay({ route: { from: LAWLESS.from, to: LAWLESS.to, commodity: 'food' }, since: 0 });
    expect(one.out.map((l) => `${l.systemId}/${l.kind}`)).toEqual(['ross-154/out', 'wolf-1061/in']);
    expect(one.back.map((l) => `${l.systemId}/${l.kind}`)).toEqual(['wolf-1061/out', 'ross-154/in']);
    const u = haulTimes(LAWLESS.from, LAWLESS.to);
    expect(one.out[0]!.start).toBe(u.load);
    expect(one.out.at(-1)!.end).toBe(u.load + u.oneWay);
    expect(one.back.at(-1)!.end).toBe(u.run);
    expect(one.out[1]!.start).toBeGreaterThan(one.out[0]!.end);
  });

  it('passes its guardrails on every route a captain can fly, and broken ways are caught', () => {
    const samples = sampleRuns();
    expect(samples.length).toBeGreaterThan(2_000);
    expect(samples.some((r) => r.way.out.length >= 4)).toBe(true);
    expect(validateFleetLanes(samples)).toEqual([]);
    const r = samples.find((x) => x.way.out.length === 3 && x.raid && x.way.out[1]!.systemId !== x.raid.systemId)!;
    const rules = (x: RunSample) => validateFleetLanes([x]).map((i) => i.rule);
    const moved = (legs: RunSample['way']['out'], i: number, by: number) => legs.map((l, k) => (k === i ? { ...l, start: l.start + by } : l));
    expect(rules({ ...r, way: { ...r.way, out: moved(r.way.out, 1, 30) } })).toContain('timing');
    expect(rules({ ...r, way: { ...r.way, out: r.way.out.map((l, k) => (k === 1 ? { ...l, systemId: 'wise-0855-0714' as SystemId } : l)) } })).toContain('way');
    expect(rules({ ...r, way: { ...r.way, back: [...r.way.back].reverse() } })).toContain('way');
    expect(rules({ ...r, raid: { ...r.raid!, at: r.raid!.at + 20 } })).toContain('raid');
    expect(rules({ ...r, raid: { ...r.raid!, systemId: r.way.out[1]!.systemId } })).toContain('raid');
    expect(rules({ ...r, raid: { ...r.raid!, systemId: 'wise-0855-0714' as SystemId } })).toContain('raid');
  });

  it('takes a finite time to the frontier too, so a captain hired there gets in and home', () => {
    const far = 'seaglass-freeport';
    expect(isFrontier(getLocation(far).systemId)).toBe(true);
    const t = haulTimes('earth-port', far);
    expect(Number.isFinite(t.run)).toBe(true);
    expect(t.oneWay).toBe(haulTimes(far, 'earth-port').oneWay);
    const { s, o } = withParked('earth-port', far);
    const c = haulGoods(s, 'earth-port', far).sort((a, b) => (haulEstimate(s, o, far, b, false)?.net ?? 0) - (haulEstimate(s, o, far, a, false)?.net ?? 0))[0]!;
    expect(hireHauler(s, o.id, far, c, false)).toMatchObject({ ok: true });
    s.clock = t.run;
    settleFleet(s);
    expect(s.fleet.ships[0]?.hauler?.runs ?? 1).toBe(1);
  });
});

describe('where raiders strike', () => {
  it('meets the same runs as before, in the least secure system (or one under a raid) at the middle of its leg', () => {
    for (const shipLost of [false, true]) {
      const at = raidedHire(LAWLESS.from, LAWLESS.to, shipLost);
      const { s, o } = hired(at);
      const raid = runRaid(s.seed, o)!;
      expect(raid).toMatchObject({ systemId: 'wolf-1061', shipLost, level: 'lawless' });
      const leg = runWay(o.hauler!).out.find((l) => l.systemId === 'wolf-1061')!;
      expect(raid.at).toBe((leg.start + leg.end) / 2);
    }
    // A run its luck spares meets nobody.
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false) + 1);
    if (runLuck(s.seed, o.id, o.hauler!.hired, 0).raid >= haulRisk(LAWLESS.from, LAWLESS.to, o.hauler!.since + FLEET.haulers.loadSeconds).raided) expect(runRaid(s.seed, o)).toBeNull();
  });

  it('takes the cargo there and then, out of sight; the run flies on empty, sells nothing, and comes home', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false));
    const raid = runRaid(s.seed, o)!;
    const cost = o.hauler!.cost;
    s.clock = raid.at - 1;
    expect(settleFleet(s).reports).toEqual([]);
    s.clock = raid.at;
    const r = settleFleet(s);
    expect(r.reports).toEqual([expect.objectContaining({ at: raid.at, kind: 'raid', amount: -cost })]);
    expect(r.reports[0]!.text).toContain('in Wolf 1061');
    expect(o.ship.cargo).toEqual({});
    expect(haulerStatus(s, o)).toMatch(/^Robbed on the way: flying on to Flotsam Diggings empty/);
    s.clock = haulerNext(o.hauler!);
    const arrived = settleFleet(s);
    expect(arrived.reports).toEqual([]);
    expect(arrived.runs).toBe(1);
    expect(o.hauler).toMatchObject({ leg: 'back', runs: 1, earned: -cost });
  });

  it('a ship raiders destroy is lost at the raid, insured or not', () => {
    for (const insured of [false, true]) {
      const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, true), insured);
      const raid = runRaid(s.seed, o)!;
      const before = s.credits;
      const cost = o.hauler!.cost;
      s.clock = raid.at;
      const r = settleFleet(s);
      const payout = insured ? insurancePayout(o.ship) : 0;
      expect(r.reports).toEqual([expect.objectContaining({ at: raid.at, kind: 'lost', amount: payout - cost })]);
      expect(r.reports[0]!.text).toMatch(new RegExp(`^Raiders destroyed your ${SHIP} in Wolf 1061 on the way to Flotsam Diggings, with \\d+ consumer goods\\.`));
      expect(s.fleet.ships).toEqual([]);
      expect(s.credits).toBe(before + payout);
    }
  });
});

describe('a raid in the player’s sight', () => {
  it('waits while the ship is in sight where it is due, and strikes as its luck says once the player has gone', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false));
    const raid = runRaid(s.seed, o)!;
    s.location = { ...s.location, systemId: 'wolf-1061', dockedAt: null };
    s.clock = raid.at + 30;
    expect(settleFleet(s, { inSight: new Set([o.id]) }).reports).toEqual([]);
    expect(o.ship.cargo[LAWLESS.good]).toBeGreaterThan(0);
    // In sight elsewhere, it would not wait.
    const other = structuredClone(s);
    other.location.systemId = 'ross-154';
    expect(settleFleet(other, { inSight: new Set([o.id]) }).reports[0]).toMatchObject({ kind: 'raid', at: raid.at });
    // Out of sight now: the raid strikes, at its own time.
    expect(settleFleet(s).reports[0]).toMatchObject({ kind: 'raid', at: raid.at });
  });

  it('seen safely past (guarded, or to its dock or the beacon), it does not strike, and the run sells', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, true));
    const raid = runRaid(s.seed, o)!;
    s.location = { ...s.location, systemId: 'wolf-1061', dockedAt: null };
    s.clock = raid.at + 10;
    // Seen elsewhere it counts for nothing.
    const elsewhere = structuredClone(s);
    elsewhere.location.systemId = 'ross-154';
    expect(captainSeen(elsewhere, o.id)).toBe(false);
    expect(captainSeen(s, o.id)).toBe(true);
    expect(o.hauler!.sight).toEqual({ run: 0, systemId: 'wolf-1061', at: raid.at + 10 });
    // The save keeps it, and refuses a damaged one.
    assertValidState(s);
    for (const sight of [{ run: -1, systemId: 'wolf-1061', at: 0 }, { run: 0, systemId: 'nowhere', at: 0 }, { run: 0, systemId: 'wolf-1061', at: NaN }]) {
      const bad = structuredClone(s);
      bad.fleet.ships[0]!.hauler!.sight = sight as never;
      expect(() => assertValidState(bad)).toThrow(/hauler/);
    }
    s.clock = haulerNext(o.hauler!);
    const r = settleFleet(s);
    expect(r.reports).toEqual([expect.objectContaining({ kind: 'run' })]);
    expect(o.hauler!.sight).toBeUndefined();
    // Settling the same save once or in steps comes out the same.
    const { s: a, o: oa } = hired(raidedHire(LAWLESS.from, LAWLESS.to, true));
    a.location = { ...a.location, systemId: 'wolf-1061', dockedAt: null };
    a.clock = raid.at + 10;
    captainSeen(a, oa.id);
    const b = structuredClone(a);
    a.clock = 6_000;
    settleFleet(a);
    for (let t = b.clock; t <= 6_000; t += 37) {
      b.clock = t;
      settleFleet(b);
    }
    b.clock = 6_000;
    settleFleet(b);
    expect(b).toEqual(a);
  });

  it('destroyed in sight, the ship is lost there and then with its cargo; insurance pays for raiders, not the player’s own guns', () => {
    for (const by of ['raiders', 'player'] as const) {
      const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false), true);
      const raid = runRaid(s.seed, o)!;
      s.location = { ...s.location, systemId: 'wolf-1061', dockedAt: null };
      s.clock = raid.at + 5;
      const before = s.credits;
      const cost = o.hauler!.cost;
      const r = captainLost(s, o.id, by);
      const payout = by === 'raiders' ? insurancePayout(o.ship) : 0;
      expect(r.reports).toEqual([expect.objectContaining({ at: raid.at + 5, kind: 'lost', amount: payout - cost })]);
      expect(r.reports[0]!.text).toContain(by === 'raiders' ? `Raiders destroyed your ${SHIP} in Wolf 1061` : `Your own guns destroyed your ${SHIP} in Wolf 1061`);
      if (by === 'player') expect(r.reports[0]!.text).toContain('Insurance does not pay for that.');
      expect(s.fleet.ships).toEqual([]);
      expect(s.credits).toBe(before + payout);
    }
    // On its way home, only the ship is lost: the run had sold.
    const { s, o } = withParked('earth-port', 'mars-depot');
    expect(hireHauler(s, o.id, 'mars-depot', 'electronics', true).ok).toBe(true);
    s.location.dockedAt = null;
    s.clock = runWay(o.hauler!).back[0]!.start + 10;
    const r = captainLost(s, o.id, 'raiders');
    expect(r.reports.map((x) => x.kind)).toEqual(['run', 'lost']);
    expect(r.reports[1]).toMatchObject({ amount: insurancePayout(newShipState(FREIGHTER)) });
    expect(r.reports[1]!.text).toContain('on the way home to Halcyon Ring');
  });
});

describe('meeting your captains', () => {
  it('captainsIn: the leg each flies in a system now, how far along, what it carries and the raid due there', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false));
    const way = runWay(o.hauler!);
    const raid = runRaid(s.seed, o)!;
    expect(captainsIn(s, 'ross-154', o.hauler!.since + 10)).toEqual([]);
    const [here] = captainsIn(s, 'ross-154', way.out[0]!.start + 15);
    expect(here).toMatchObject({ way: 'out', leg: way.out[0], qty: o.ship.cargo[LAWLESS.good], raid: null });
    expect(here!.progress).toBeCloseTo(15 / (way.out[0]!.end - way.out[0]!.start));
    expect(captainsIn(s, 'wolf-1061', way.out[0]!.start + 15)).toEqual([]);
    expect(captainsIn(s, 'wolf-1061', way.out[1]!.start + 1)[0]).toMatchObject({ way: 'out', raid });
    // As the save is settled: robbed on the way, it flies home empty.
    s.clock = way.back[0]!.start + 1;
    settleFleet(s);
    expect(captainsIn(s, 'wolf-1061', s.clock)[0]).toMatchObject({ way: 'back', qty: 0, raid: null });
  });

  it('the Fleet window says where each one is now', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false) + 3);
    const way = runWay(o.hauler!);
    expect(haulerStatus(s, o)).toMatch(/^Loading \d+ consumer goods at Regent Concourse for Flotsam Diggings/);
    s.clock = way.out[0]!.start + 5;
    expect(haulerStatus(s, o)).toMatch(/· now in Ross 154$/);
    s.clock = way.out[0]!.end + 5;
    expect(haulerStatus(s, o)).toMatch(/· now in a jump$/);
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

interface Npc {
  id: string;
  name: string;
  side: 'lawful' | 'raider';
  pack?: number;
  captain?: { shipId: string; ambush?: number; settled?: boolean };
  body: { position: THREE.Vector3 };
  durability: { hull: number };
  target: { name: string; subtitle?: string; own?: boolean; cycle: boolean };
  trader?: { state: string; destination: { id: string; point: THREE.Vector3 } };
}

/** A flight in `systemId` with the save as it is, wired to the fleet as the game wires it. */
function flightWith(state: GameState, systemId: SystemId, clock: number, traders = 0) {
  installCanvasStub();
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  state.location = { ...state.location, systemId, dockedAt: null, flight: null };
  state.clock = clock;
  useWorldLog(state.world);
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const messages: string[] = [];
  const comms: string[] = [];
  const reports: string[] = [];
  let flight: FlightSession;
  const callbacks: FlightCallbacks = {
    onDocked: record('docked'),
    onPlayerDestroyed: record('destroyed'),
    onDiscovery: record('discovery'),
    onScanInfo: record('scan'),
    onEncounterStart: record('encounterStart'),
    onEncounterEnd: record('encounterEnd'),
    onLoot: record('loot'),
    onBounty: record('bounty'),
    onContractKill: record('contractKill'),
    onCrime: record('crime'),
    onMessage: (text) => messages.push(text),
    onComm: (speaker, text) => comms.push(`${speaker}: ${text}`),
    onCaptain: (shipId, fate, by) => {
      record('captain')(shipId, fate, by);
      if (fate === 'safe') captainSeen(state, shipId);
      else reports.push(...captainLost(state, shipId, by ?? 'raiders', new Set(flight.captainsInSight())).reports.map((r) => r.text));
    },
  };
  const audio = { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine;
  flight = new FlightSession({
    system: scene,
    camera: new THREE.PerspectiveCamera(),
    state,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio,
    callbacks,
    traffic: { plan: { traders, patrolWings: 0, wingSize: 2, packs: null }, owner: null },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      state.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  const npcs = () => (flight as unknown as { npcs: Npc[] }).npcs;
  const loot = () => (flight as unknown as { loot: { cargo?: { commodity: string; qty: number } }[] }).loot;
  return { flight, state, calls, messages, comms, reports, run, npcs, loot };
}

describe('your captains in flight', () => {
  it('fly where the player is, named as theirs with the captain, the cargo and where it is bound, whatever the timetable shows', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false) + 3);
    const leg = runWay(o.hauler!).out[0]!;
    const f = flightWith(s, 'ross-154', leg.start + (leg.end - leg.start) * 0.4);
    f.run(0.3);
    const n = f.npcs().find((x) => x.captain)!;
    expect(n).toBeDefined();
    expect(n.captain!.shipId).toBe(o.id);
    expect(n.target.name).toBe(`Your ${SHIP}`);
    expect(n.target.own).toBe(true);
    expect(n.target.cycle).toBe(true);
    expect(n.target.subtitle).toBe(`Captain ${o.hauler!.captain} · ${o.ship.cargo[LAWLESS.good]} consumer goods for Flotsam Diggings (Wolf 1061)`);
    expect(f.flight.captainsInSight()).toEqual([o.id]);
    expect(f.flight.debugNpcs().find((x) => x.captain === o.id)).toBeDefined();
    // It flies on to the jump beacon and leaves the scene; with no raid due here, nothing is recorded.
    n.body.position.copy(n.trader!.destination.point);
    expect(f.run(5, () => !f.npcs().includes(n))).toBe(true);
    expect(f.calls.captain).toBeUndefined();
  });

  it('one ship in the scene at a time: one flying behind its schedule is not doubled when its run turns for home', () => {
    const { s, o } = withParked('earth-port', 'mars-depot');
    expect(hireHauler(s, o.id, 'mars-depot', 'electronics', false).ok).toBe(true);
    const way = runWay(o.hauler!);
    const f = flightWith(s, 'sol', way.out[0]!.start + 20);
    f.run(0.3);
    expect(f.npcs().filter((n) => n.captain)).toHaveLength(1);
    // The run sells and turns for home on schedule while its ship is still on the way here.
    s.clock = way.back[0]!.start + 20;
    expect(settleFleet(s, { inSight: new Set(f.flight.captainsInSight()) }).reports.map((r) => r.kind)).toEqual(['run']);
    expect(captainsIn(s, 'sol', s.clock)).toHaveLength(1);
    f.run(3);
    expect(f.npcs().filter((n) => n.captain)).toHaveLength(1);
  });

  it('guarded through a raid: raiders jump the captain when it is due, and beaten off, the run gets through and sells', () => {
    const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, true));
    const raid = runRaid(s.seed, o)!;
    const f = flightWith(s, 'wolf-1061', raid.at - 6);
    f.run(3);
    const n = f.npcs().find((x) => x.captain)!;
    expect(n).toBeDefined();
    expect(f.npcs().some((x) => x.side === 'raider')).toBe(false);
    // The fleet holds the raid while the ship is in sight.
    expect(f.run(8, () => n.captain!.ambush !== undefined)).toBe(true);
    expect(settleFleet(s, { inSight: new Set(f.flight.captainsInSight()) }).reports).toEqual([]);
    expect(f.messages).toContain(`Ambush! Raiders are closing on your ${SHIP}.`);
    const ambush = f.npcs().filter((x) => x.pack === n.captain!.ambush);
    expect(ambush).toHaveLength(FLEET.lanes.ambush.lawless + 1);
    // The player beats them off.
    for (const r of ambush) f.flight.debugDestroy(r.id, true);
    expect(f.run(4, () => !!f.calls.captain)).toBe(true);
    expect(f.calls.captain![0]).toEqual([o.id, 'safe', undefined]);
    expect(f.comms.some((c) => c.startsWith(`${o.hauler!.captain}: They’re gone.`))).toBe(true);
    expect(o.hauler!.sight).toMatchObject({ run: 0, systemId: 'wolf-1061' });
    // Out of sight again, the run gets in and sells: the raid that would have taken the ship never struck.
    s.clock = haulerNext(o.hauler!);
    expect(settleFleet(s).reports.map((r) => r.kind)).toEqual(['run']);
    expect(s.fleet.ships).toHaveLength(1);
  });

  it('left to it, the raid takes its course; one that gets to its dock during the ambush got away', () => {
    const at = raidedHire(LAWLESS.from, LAWLESS.to, false);
    const { s, o } = hired(at);
    const raid = runRaid(s.seed, o)!;
    const f = flightWith(s, 'wolf-1061', raid.at - 4);
    expect(f.run(8, () => f.npcs().some((x) => x.captain?.ambush !== undefined))).toBe(true);
    // The player leaves: the raid strikes as its luck says, at its own time.
    expect(settleFleet(structuredClone(s)).reports[0]).toMatchObject({ kind: 'raid', at: raid.at });
    // Staying, the captain makes its dock with the raiders on it: it got away.
    const n = f.npcs().find((x) => x.captain)!;
    n.body.position.copy(n.trader!.destination.point);
    expect(f.run(5, () => !!f.calls.captain)).toBe(true);
    expect(f.calls.captain![0]).toEqual([o.id, 'safe', undefined]);
    expect(f.comms.some((c) => c.includes('Docked safe, cargo and all.'))).toBe(true);
    s.clock = haulerNext(o.hauler!);
    expect(settleFleet(s).reports.map((r) => r.kind)).toEqual(['run']);
  });

  it('destroyed in sight, it is lost there and then and spills half its cargo; the player’s own guns are no crime', () => {
    for (const byPlayer of [false, true]) {
      const { s, o } = hired(raidedHire(LAWLESS.from, LAWLESS.to, false) + 3);
      const leg = runWay(o.hauler!).out[0]!;
      const qty = o.ship.cargo[LAWLESS.good]!;
      const f = flightWith(s, 'ross-154', leg.start + (leg.end - leg.start) * 0.4);
      f.run(0.3);
      const n = f.npcs().find((x) => x.captain)!;
      // The player's guns: no crime, not even a warning.
      if (byPlayer) f.flight.debugDestroy(n.id, true);
      else f.flight.debugDestroy(n.id, false);
      expect(f.calls.captain).toEqual([[o.id, 'lost', byPlayer ? 'player' : 'raiders']]);
      expect(f.calls.crime).toBeUndefined();
      expect(s.fleet.ships).toEqual([]);
      expect(f.reports[0]).toMatch(new RegExp(`^${byPlayer ? 'Your own guns' : 'Raiders'} destroyed your ${SHIP} in Ross 154`));
      const pods = f.loot().filter((p) => p.cargo);
      expect(pods.every((p) => p.cargo!.commodity === LAWLESS.good)).toBe(true);
      expect(pods.reduce((a, p) => a + p.cargo!.qty, 0)).toBe(Math.round(qty * HAULS.spill.share));
    }
  });
});

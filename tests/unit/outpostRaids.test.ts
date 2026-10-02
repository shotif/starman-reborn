import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type OutpostRecord } from '../../src/app/state.ts';
import { RAID_WATCH } from '../../src/content/outposts/raidLines.ts';
import { OUTPOST_RAIDS, type OutpostRaidRules } from '../../src/content/outposts/raids.ts';
import { OUTPOSTS } from '../../src/content/outposts/rules.ts';
import { outpostId } from '../../src/content/outposts/sites.ts';
import { getLocation } from '../../src/data/systems.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { settleFleet } from '../../src/economy/fleet.ts';
import { describeObjective } from '../../src/economy/jobs.ts';
import { quote } from '../../src/economy/markets.ts';
import { raidBalance, validateOutpostRaids } from '../../src/economy/outpostRaidGuards.ts';
import {
  defenceAt,
  defenceOf,
  deliverForTurret,
  firstWindow,
  guardHireBlock,
  guardOffers,
  hireGuard,
  holdOdds,
  hurtFactor,
  nextRaid,
  oddsWord,
  raidIn,
  raidWarning,
  repairTurret,
  turretCap,
  turretNeeds,
  windowStart,
} from '../../src/economy/outpostRaids.ts';
import { charterOffers, charterOutpost, deliverToOutpost, incomeAt, stillNeeded } from '../../src/economy/outposts.ts';

/**
 * Raids on the player's outpost (docs/PROCGEN.md §29): their guardrails and balance; the windows and
 * the raids they hold; the watch's warning and the job; raids decided away (held, or lost and what
 * that takes) in time order with the income; turrets built from hauled materials, their upkeep and
 * repairs; guards hired by the hour; and saves.
 */

afterEach(() => useWorldLog(null));

const NEUTRAL = { sta: 0, frontier: 0, 'hollow-wake': 0 };
/** Lalande 21185 (thin space), and a research station there to charter from. */
const PLANET = 'gj-411-b';
const DOCK = 'wayfarer-array';
const HOUR = 3_600;

function pilotAt(locationId: string, seed = 17): GameState {
  const s = createNewGame(seed);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 200_000;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

/** A pilot whose outpost at PLANET is built to `stages`, docked there. */
function built(stages: number, seed = 17): { s: GameState; o: OutpostRecord } {
  const s = pilotAt(DOCK, seed);
  const offer = charterOffers(s).find((x) => x.site.planetId === PLANET)!;
  expect(charterOutpost(s, PLANET, offer.kinds[0]!.kind, offer.kinds[0]!.names[0]!).ok).toBe(true);
  dockAt(s, outpostId(PLANET));
  for (let i = 0; i < stages; i++) {
    for (const x of stillNeeded(s.world.outpost!)) {
      s.ship.cargo = { [x.commodity]: x.left };
      expect(deliverToOutpost(s, x.commodity, x.left).ok).toBe(true);
    }
  }
  return { s, o: s.world.outpost! };
}

/** The first raid from the outpost's first window on, and the window it is in. */
function firstRaid(s: GameState, o: OutpostRecord, from = firstWindow(o)) {
  for (let n = from; n < from + 200; n++) {
    const plan = raidIn(s, o, n);
    if (plan) return plan;
  }
  throw new Error('no raid');
}

describe('the rules', () => {
  it('pass their guardrails: raids hurt an undefended port without ruining it, and turrets pay for themselves', { timeout: 60_000 }, () => {
    expect(validateOutpostRaids()).toEqual([]);
    const b = raidBalance();
    expect(b.lost.lawless!).toBeGreaterThan(b.lost.thin!);
    expect(b.payback).toBeGreaterThanOrEqual(20);
    expect(b.payback).toBeLessThanOrEqual(60);
  });

  it('catch broken ones: odds falling with lawlessness, a hold table that dips, a loss that pays, a number in a line', { timeout: 60_000 }, () => {
    const broken = (patch: (r: OutpostRaidRules) => void) => {
      const r = structuredClone(OUTPOST_RAIDS);
      patch(r);
      return validateOutpostRaids(r).map((i) => i.rule);
    };
    expect(broken((r) => (r.odds.lawless = 0.05))).toContain('rules');
    expect(broken((r) => ((r.hold as [number, number][])[2] = [1, 0.1]))).toContain('rules');
    expect(broken((r) => (r.lost.income = 1.5))).toContain('rules');
    expect(broken((r) => (r.guards.delay = 3_000))).toContain('rules');
    const lines = RAID_WATCH.held as string[];
    const keep = lines[0]!;
    lines[0] = 'We held for 3 hours.';
    expect(validateOutpostRaids(OUTPOST_RAIDS, 30).map((i) => i.rule)).toContain('lines');
    lines[0] = keep;
  });

  it('weigh a defence against the raiders: the odds of holding climb with it, in words', () => {
    expect(holdOdds(0, 2)).toBe(0);
    expect(holdOdds(4.5, 2)).toBeCloseTo(0.65, 5);
    expect(holdOdds(9, 2)).toBeCloseTo(0.95, 5);
    expect(holdOdds(100, 3)).toBe(0.95);
    // Raiders the player downed before leaving count.
    expect(holdOdds(2, 2, 2, 3)).toBeGreaterThan(holdOdds(2, 2));
    expect(oddsWord(0.9)).toBe('Your defences should hold (90%).');
    expect(oddsWord(0)).toBe('Nothing defends it.');
  });
});

describe('the windows', () => {
  it('hold raids only once the outpost has been open a while, the first a probe; the same for the same save', () => {
    const { s, o } = built(1);
    expect(o.opened).toBe(s.clock);
    const first = firstWindow(o);
    expect(windowStart(o, first + 1)).toBeGreaterThan(o.opened! + OUTPOST_RAIDS.grace);
    for (let n = first - 3; n < first; n++) expect(raidIn(s, o, n)).toBeNull();
    // Thin space: the first window after the grace holds the probe.
    const probe = raidIn(s, o, first) ?? raidIn(s, o, first + 1);
    expect(probe).toMatchObject({ probe: true, threat: 1, ships: 2 });
    expect(probe!.warnAt).toBe(probe!.at - OUTPOST_RAIDS.probe.warning);
    expect(raidIn(s, o, probe!.window)).toEqual(probe);
    // However late in a window it opened, the probe comes in the first window whose strike is past the grace.
    const opened = o.opened!;
    for (let k = 0; k < 12; k++) {
      o.opened = opened + k * 900;
      const p = firstRaid(s, o);
      expect(p.probe).toBe(true);
      expect(p.at).toBeGreaterThanOrEqual(o.opened + OUTPOST_RAIDS.grace);
      expect(p.window).toBeLessThanOrEqual(firstWindow(o) + 1);
    }
    o.opened = opened;
    // Once one is met, the rest are full raids at the band's threat (a frame one lower).
    defenceOf(o).raids.push({ window: probe!.window, at: probe!.at, threat: 1, result: 'held', where: 'away' });
    const next = firstRaid(s, o, probe!.window + 1);
    expect(next.probe).toBe(false);
    expect(next.threat).toBe(OUTPOST_RAIDS.threat.thin - 1);
  });

  it('come more often as the outpost grows, and a quarter as often for a pilot the Wake trusts', () => {
    const count = (s: GameState, o: OutpostRecord) => {
      let n = 0;
      for (let w = firstWindow(o) + 1; w < firstWindow(o) + 300; w++) if (raidIn(s, o, w)) n++;
      return n;
    };
    const frame = built(1);
    defenceOf(frame.o).raids.push({ window: 0, at: 0, threat: 1, result: 'held', where: 'away' });
    const a = count(frame.s, frame.o);
    const port = built(3);
    defenceOf(port.o).raids.push({ window: 0, at: 0, threat: 1, result: 'held', where: 'away' });
    const b = count(port.s, port.o);
    expect(b).toBeGreaterThan(a);
    port.s.reputation['hollow-wake'] = 40;
    expect(count(port.s, port.o)).toBeLessThan(b / 2);
  });
});

describe('a raid', () => {
  it('is seen coming: the watch says so once, and a job asks the player to defend the outpost', () => {
    const { s, o } = built(2);
    const plan = nextRaid(s, o)!;
    s.clock = plan.warnAt - 1;
    expect(raidWarning(s, o)).toBeNull();
    s.clock = plan.warnAt + 1;
    const w = raidWarning(s, o)!;
    expect(w.speaker).toBe(`${o.name} watch`);
    expect(w.text).toMatch(new RegExp(`^Raiders are coming for ${o.name}: ${plan.ships} ships, in about \\d+ min\\. `));
    expect(raidWarning(s, o)).toBeNull();
    expect(s.jobs[w.jobId]?.status).toBe('active');
    expect(describeObjective(s, w.jobId)!.text).toMatch(/Defend .* against \d raiders \(\d+ min\)/);
  });

  it('decided away: held or lost by the defence it had; lost, it cuts the income, its market, its storage and a turret, never the credits', () => {
    const { s, o } = built(3);
    const d = defenceOf(o);
    d.raids.push({ window: 0, at: 0, threat: 1, result: 'held', where: 'away' });
    d.turrets = 1;
    s.location = { ...s.location, dockedAt: DOCK, systemId: getLocation(DOCK).systemId };
    // Barely defended (a patrol wing, its one turret down), raids in thin space mostly get through.
    let lost: { plan: ReturnType<typeof firstRaid>; out: ReturnType<typeof settleFleet>; credits: number } | null = null;
    for (let i = 0; i < 12 && !lost; i++) {
      const plan = firstRaid(s, o, d.settled);
      d.down[0] = plan.at + 10 * HOUR;
      s.fleet.storage[outpostId(PLANET)] = { machinery: 20, food: 9 };
      const credits = s.credits;
      s.clock = plan.at + 1;
      const out = settleFleet(s);
      expect(d.raids.at(-1)).toMatchObject({ window: plan.window, at: plan.at, where: 'away' });
      expect(s.credits - credits).toBe(out.outpost);
      if (d.raids.at(-1)!.result === 'lost') lost = { plan, out, credits };
    }
    expect(lost).not.toBeNull();
    const { plan, out } = lost!;
    expect(out.raids.at(-1)!.text).toMatch(/got into .*’s stores: its income is cut for \d h and its market is short of .*; they took 2 staple food, 5 machinery from your storage/);
    expect(d.hurt!.from).toBe(plan.at);
    expect(hurtFactor(o, plan.at + 60)).toBe(OUTPOST_RAIDS.lost.income);
    expect(hurtFactor(o, d.hurt!.until + 1)).toBe(1);
    expect(cargoCount(s.fleet.storage[outpostId(PLANET)]!, 'machinery')).toBe(15);
    // Its market is short of the good: dearer while the hurt lasts.
    const good = d.hurt!.good;
    const before = quote(outpostId(PLANET), good, NEUTRAL, { clock: plan.at - 60, markets: {} });
    const after = quote(outpostId(PLANET), good, NEUTRAL, { clock: plan.at + 60, markets: {} });
    expect((after.sell ?? 0) + (after.buy ?? 0)).toBeGreaterThan((before.sell ?? 0) + (before.buy ?? 0));
    // A strong defence holds most raids.
    d.turrets = 3;
    d.guards = [0, 1].map((i) => ({ id: `g${i}`, name: `Guard ${i}`, model: 'ship.light-fighter.1.halden', skill: 'sharp' as const, from: 0, until: 1e9 }));
    let held = 0;
    for (let i = 0; i < 8; i++) {
      d.down = [0, 0, 0];
      const next = firstRaid(s, o, d.settled);
      s.clock = next.at + 1;
      settleFleet(s);
      if (d.raids.at(-1)!.result === 'held') held++;
    }
    expect(held).toBeGreaterThanOrEqual(5);
    assertValidState(s);
  });

  it('waits for the flight to decide it while the player flies in its system, and the outpost’s hours with it', () => {
    const { s, o } = built(2);
    defenceOf(o).raids.push({ window: 0, at: 0, threat: 1, result: 'held', where: 'away' });
    const plan = firstRaid(s, o, firstWindow(o) + 1);
    s.location = { ...s.location, dockedAt: null };
    s.clock = plan.at + 2 * HOUR;
    const out = settleFleet(s);
    expect(out.raids).toEqual([]);
    expect(o.since).toBeLessThanOrEqual(plan.at);
    expect(nextRaid(s, o)?.window).toBe(plan.window);
  });
});

describe('turrets', () => {
  it('are built from materials hauled to the outpost, one for each stage, cost their upkeep, and are repaired when knocked out', () => {
    const { s, o } = built(1);
    expect(turretCap(o)).toBe(1);
    const income = incomeAt(o, s.clock);
    for (const x of turretNeeds(o)) {
      s.ship.cargo = { [x.commodity]: x.left };
      const r = deliverForTurret(s, x.commodity, x.left);
      expect(r.ok).toBe(true);
    }
    expect(o.defence!.turrets).toBe(1);
    expect(turretNeeds(o)).toEqual([]);
    expect(deliverForTurret(s, 'ship-parts', 1).message).toMatch(/until the outpost grows/);
    expect(incomeAt(o, s.clock)).toBe(income - OUTPOST_RAIDS.turrets.upkeep);
    o.defence!.down[0] = s.clock + HOUR;
    expect(defenceAt(s, o, s.clock).turrets).toBe(0);
    const credits = s.credits;
    expect(repairTurret(s, 0).ok).toBe(true);
    expect(s.credits).toBe(credits - OUTPOST_RAIDS.turrets.repair);
    expect(defenceAt(s, o, s.clock).turrets).toBe(1);
  });
});

describe('guards', () => {
  it('are hired by the hour at the outpost or a full-service dock, take up their post a quarter of an hour later, and count in the defence', () => {
    const { s, o } = built(2);
    const offers = guardOffers(s, o);
    expect(offers).toHaveLength(OUTPOST_RAIDS.guards.offers);
    expect(guardOffers(s, o)).toEqual(offers);
    const g = offers[0]!;
    const credits = s.credits;
    expect(hireGuard(s, g.id, 4).ok).toBe(true);
    expect(s.credits).toBe(credits - g.perHour * 4);
    expect(defenceAt(s, o, s.clock).guards).toEqual([]);
    expect(defenceAt(s, o, s.clock + OUTPOST_RAIDS.guards.delay).guards).toHaveLength(1);
    expect(defenceAt(s, o, s.clock + OUTPOST_RAIDS.guards.delay + 4 * HOUR).guards).toEqual([]);
    expect(hireGuard(s, g.id, 4).ok).toBe(false);
    expect(hireGuard(s, offers[1]!.id, 2).ok).toBe(true);
    expect(guardHireBlock(s, o)).toMatch(/all the guards it can use/);
    // Not from just any dock; never for a hunted pilot.
    s.clock += 6 * HOUR;
    s.location = { ...s.location, dockedAt: DOCK, systemId: getLocation(DOCK).systemId };
    expect(guardHireBlock(s, o)).toBeNull();
    s.law.fines.sta = 5_000;
    expect(guardHireBlock(s, o)).toMatch(/price on their head/);
  });
});

describe('saves', () => {
  it('keep an outpost’s defences and raids, and refuse damaged ones', () => {
    const { s, o } = built(2);
    const d = defenceOf(o);
    d.turrets = 2;
    d.down = [0, s.clock + HOUR];
    d.guards = [{ id: 'g', name: 'Guard', model: 'ship.light-fighter.1.halden', skill: 'steady', from: 10, until: 100 }];
    d.raids = [{ window: 3, at: 50, threat: 2, result: 'lost', where: 'away', took: '5 food' }];
    d.hurt = { from: 50, until: 500, good: 'food' };
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.world.outpost!.defence!.turrets = 3))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outpost!.defence!.raids[0]!.result = 'won' as never))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outpost!.defence!.guards[0]!.model = 'ship.nothing'))).toThrow(/outpost/);
    expect(bad((x) => (x.world.outpost!.defence!.hurt!.good = 'gold' as never))).toThrow(/outpost/);
    expect(OUTPOSTS.stages).toHaveLength(3);
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

/** A flight at the outpost (built to a port, in flight in its system) with its defences and a raid due in a few seconds. */
function raidFlight(raid = { window: 7, threat: 2 as const, ships: 3 }) {
  installCanvasStub();
  const { s, o } = built(3);
  const sys = getLocation(outpostId(PLANET)).systemId;
  s.location = { ...s.location, systemId: sys, dockedAt: null, flight: null };
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const nothing = () => {};
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(sys), { quality: 'low', reducedMotion: true }),
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
      onBounty: record('bounty'),
      onContractKill: nothing,
      onMessage: nothing,
      onComm: nothing,
      onOutpostRaid: record('raid'),
    },
    traffic: {
      plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null },
      owner: 'sta',
      outpost: { locationId: outpostId(PLANET), stage: 3, turrets: 2, guards: [{ id: 'g1', name: 'Signe Okoro', model: 'ship.light-fighter.1.halden', skill: 'sharp' }], raid: { ...raid, at: s.clock + 8 } },
    },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      s.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  const raw = (id: string) => (flight as unknown as { npcs: { id: string; body: { position: THREE.Vector3 }; brain: { state: string } }[] }).npcs.find((n) => n.id === id)!;
  return { s, o, flight, calls, run, raw, npcs: () => flight.debugNpcs() };
}

describe('in flight', () => {
  it('the outpost’s turrets and guards stand by it; a raid strikes at its time, half for the stores; downed to the last, it is held', () => {
    const f = raidFlight();
    f.run(4);
    const own = f.npcs().filter((n) => n.own);
    expect(own.filter((n) => n.own === 'turret')).toHaveLength(2);
    expect(own.find((n) => n.own === 'guard')).toMatchObject({ name: 'Signe Okoro', subtitle: 'Guarding your outpost' });
    expect(f.npcs().filter((n) => n.outpostRaid !== null)).toEqual([]);
    expect(f.run(8, () => !!f.calls.raid)).toBe(true);
    expect(f.calls.raid).toEqual([[7, 'struck', 0]]);
    const raiders = f.npcs().filter((n) => n.outpostRaid === 7);
    expect(raiders).toHaveLength(3);
    expect(raiders.filter((n) => n.prey === 'Stores')).toHaveLength(2);
    expect(f.npcs().find((n) => n.own === 'stores')).toMatchObject({ name: 'Stores', hull: OUTPOST_RAIDS.fight.stores[2] });
    expect(f.flight.outpostRaidStatus()).toEqual({ window: 7, state: 'on', downed: 0 });
    // A turret turns its guns on a raider in range.
    const turret = f.npcs().find((n) => n.own === 'turret')!;
    f.raw(raiders[1]!.id).body.position.copy(f.raw(turret.id).body.position).add(new THREE.Vector3(0, 0, -400));
    f.run(3);
    expect(f.npcs().find((n) => n.id === turret.id)!.shotsFired).toBeGreaterThan(0);
    for (const r of f.npcs().filter((n) => n.outpostRaid === 7)) f.flight.debugDestroy(r.id, true);
    f.run(0.5);
    expect(f.calls.raid!.at(-1)).toEqual([7, 'held', 3]);
    // Wake raiders: the player's kills pay their bounty.
    expect(f.calls.bounty?.length).toBeGreaterThan(0);
  });

  it('the stores broken open, the raid is lost and the raiders make off', () => {
    const f = raidFlight({ window: 9, threat: 2, ships: 3 });
    expect(f.run(14, () => !!f.calls.raid)).toBe(true);
    const stores = f.npcs().find((n) => n.own === 'stores')!;
    f.flight.debugDestroy(f.npcs().find((n) => n.outpostRaid === 9)!.id, false);
    f.flight.debugDestroy(stores.id, false);
    expect(f.calls.raid!.at(-1)).toEqual([9, 'lost', 1]);
    for (const n of f.npcs().filter((x) => x.outpostRaid === 9)) expect(f.raw(n.id).brain.state).toBe('flee');
    expect(f.flight.outpostRaidStatus()!.state).toBe('lost');
  });
});

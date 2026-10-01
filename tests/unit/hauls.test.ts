import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { HAULER_NAMES, HAULS } from '../../src/content/economy/hauls.ts';
import { EVENTS } from '../../src/content/events/rules.ts';
import { getLocation } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { relieveShortage } from '../../src/economy/answers.ts';
import { eventEnd, eventsAt, stationEventAt, systemEventAt, useWorldLog, type WorldEvent } from '../../src/economy/events.ts';
import { sampleHauls, validateHauls } from '../../src/economy/haulGuards.ts';
import { haulFate, haulsIn, haulsLostNear, haulStock, recordHaul, reliefDelivered, reliefEnd, reliefHauls, shortfall, tradeHaul, type Haul } from '../../src/economy/hauls.ts';
import { marketEntry, quote, stockNow } from '../../src/economy/markets.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/** Haulers on the lanes (docs/PROCGEN.md §21): the timetable, relief for shortages, raids, the markets and the flight scene. */

afterEach(() => useWorldLog(null));

const NEUTRAL = { sta: 0, frontier: 0, 'hollow-wake': 0 };
const log = (): GameState['world'] => ({ relief: {}, raidKills: {}, ended: {}, lingering: {}, border: {} });

/** The first shortage (searching hour by hour) whose relief all arrives, from two stations, with no raid in its way, and takes both to end it. */
function relievedShortage(): { e: WorldEvent; hauls: readonly Haul[] } {
  for (let clock = 3_600; clock < 200 * 3_600; clock += 3_600) {
    for (const e of eventsAt(clock)) {
      const hauls = reliefHauls(e);
      const both = Math.max(...hauls.map((h) => h.arrive));
      if (hauls.length === 2 && hauls.every((h) => haulFate(h).delivered) && reliefEnd(e) === both && both < e.end - 600 && hauls[0]!.arrive !== hauls[1]!.arrive) return { e, hauls };
    }
  }
  throw new Error('no relieved shortage');
}

/** The first trade haul (station by station, slot by slot) that a raid in its way loses. */
function raidedHaul(): Haul {
  for (const h of sampleHauls(72)) if (h.kind === 'trade' && !haulFate(h).delivered) return h;
  throw new Error('no haul lost to a raid');
}

describe('the haul timetable', () => {
  it('passes its guardrails, and broken hauls are caught', () => {
    expect(validateHauls()).toEqual([]);
    const h = sampleHauls(6).find((x) => x.kind === 'trade' && x.path.length === 2)!;
    const rules = (x: Haul) => validateHauls([x]).map((i) => i.rule);
    expect(rules({ ...h, to: 'maw-roost' })).toContain('places');
    expect(rules({ ...h, from: h.to })).toContain('places');
    expect(rules({ ...h, commodity: 'stims' })).toContain('cargo');
    expect(rules({ ...h, qty: 400 })).toContain('cargo');
    expect(rules({ ...h, path: [h.path[0]!, 'wise-0855-0714' as SystemId] })).toContain('way');
    expect(rules({ ...h, legs: h.legs.map((l, i) => (i === 1 ? { ...l, start: l.start + 50 } : l)) })).toContain('timetable');
    expect(rules({ ...h, name: 'Nobody' })).toContain('names');
    expect(rules({ ...h, model: 'ship.heavy-fighter.1.wake' })).toContain('ships');
    expect(new Set(HAULER_NAMES).size).toBe(HAULER_NAMES.length);
  });

  it('is the same on every device: a station’s haul in a slot never changes', () => {
    const h = sampleHauls(2)[0]!;
    const slot = Number(h.id.split('.').at(-1));
    expect(tradeHaul(h.from, slot)).toBe(h);
    expect(JSON.parse(JSON.stringify(tradeHaul(h.from, slot)))).toEqual(JSON.parse(JSON.stringify(h)));
    expect(h.depart).toBeGreaterThanOrEqual(slot * HAULS.slotSeconds);
    expect(h.depart).toBeLessThanOrEqual((slot + 1) * HAULS.slotSeconds);
  });

  it('puts haulers in the lanes of the core about as often as the old traffic did', () => {
    for (const s of ['sol', 'procyon', 'tau-ceti'] as SystemId[]) {
      let n = 0;
      let k = 0;
      for (let c = 20_000; c < 20_000 + 6 * 3_600; c += 600, k++) {
        const here = haulsIn(s, c);
        n += here.length;
        for (const x of here) {
          expect(x.leg.systemId).toBe(s);
          expect(x.progress).toBeGreaterThanOrEqual(0);
          expect(x.progress).toBeLessThan(1);
        }
      }
      expect(n / k, s).toBeGreaterThan(1);
    }
  });

  it('sends nobody into a raided system, or out of one', () => {
    for (const h of sampleHauls(48)) {
      if (h.kind !== 'trade') continue;
      for (const s of [h.path[0]!, h.path.at(-1)!]) expect(systemEventAt(s, h.depart)?.kind, h.id).not.toBe('raid');
    }
  });
});

describe('relief for a shortage', () => {
  it('comes from the nearest stations that make what it lacks, and all of it arriving relieves it', () => {
    useWorldLog(log());
    const { e, hauls } = relievedShortage();
    const lacks = shortfall(e);
    for (const h of hauls) {
      expect(h.to).toBe(e.locationId);
      expect(h.commodity).toBe(e.goods[0]);
      expect(h.relief).toBe(e.id);
      expect(h.depart - e.start).toBeGreaterThanOrEqual(HAULS.relief.dispatch[0]);
      expect(h.qty).toBe(Math.max(HAULS.load.min, Math.round(lacks * HAULS.relief.share)));
    }
    const last = Math.max(...hauls.map((h) => h.arrive));
    expect(reliefEnd(e)).toBeLessThanOrEqual(last);
    expect(eventEnd(e)).toBe(reliefEnd(e));
    expect(stationEventAt(e.locationId!, eventEnd(e) - 1)?.id).toBe(e.id);
    expect(stationEventAt(e.locationId!, eventEnd(e) + 1)?.id).not.toBe(e.id);
    expect(reliefDelivered(e, last)).toBe(hauls.reduce((a, h) => a + h.qty, 0));
  });

  it('fills the station’s stock as each hauler arrives, and eases its price', () => {
    useWorldLog(log());
    const { e, hauls } = relievedShortage();
    const first = hauls.reduce((a, b) => (a.arrive < b.arrive ? a : b));
    const c = e.goods[0]!;
    const at = e.locationId!;
    const price = (clock: number) => quote(at, c, NEUTRAL, { clock, markets: {} }).sell!;
    const stock = (clock: number) => stockNow(at, marketEntry(at, c)!, { clock, markets: {} });
    // (A shortage's price can sit at the top of its band, so the stock shows it first.)
    expect(stock(first.arrive + 1)).toBeGreaterThan(stock(first.arrive - 1) + first.qty * 0.9);
    expect(price(first.arrive + 1)).toBeLessThanOrEqual(price(first.arrive - 1));
    expect(haulStock(at, c, first.arrive + 1)).toBeGreaterThan(first.qty * 0.99);
    // Once all of it is in, the shortage is over and its normal stock back: the relief is part of that.
    expect(haulStock(at, c, reliefEnd(e) + 1)).toBeLessThanOrEqual(0);
    expect(stock(reliefEnd(e) + 1)).toBeCloseTo(marketEntry(at, c)!.target, 0);
    expect(haulStock(at, c, first.arrive - 1)).toBe(0);
  });

  it('counts with what the player sells: a pilot who brings the rest relieves it, and is paid for it', () => {
    const { e, hauls } = relievedShortage();
    const first = hauls.reduce((a, b) => (a.arrive < b.arrive ? a : b));
    const s = createNewGame(3);
    useWorldLog(s.world);
    s.clock = first.arrive + 5;
    const need = shortfall(e) * EVENTS.react.relief;
    const short = Math.ceil(need - first.qty);
    expect(relieveShortage(s, e.locationId!, e.goods[0]!, short - 1)).toBeNull();
    const answer = relieveShortage(s, e.locationId!, e.goods[0]!, 1);
    expect(answer?.paid).toBeGreaterThan(0);
    expect(s.world.ended[e.id]).toBe(s.clock);
  });
});

describe('raids and what the player saw', () => {
  it('lose some hauls in a raided system’s lanes, and the news within reach says so', () => {
    useWorldLog(log());
    const h = raidedHaul();
    const fate = haulFate(h);
    expect(fate).toMatchObject({ delivered: false, by: 'raiders' });
    const raid = eventsAt(fate.at).find((e) => e.kind === 'raid' && e.systemId === fate.lostIn);
    expect(raid).toBeDefined();
    // Gone from the lanes after it was lost, and missed where it was going.
    expect(haulsIn(fate.lostIn!, fate.at + 1).some((x) => x.haul.id === h.id)).toBe(false);
    expect(haulStock(h.to, h.commodity, h.arrive + 1)).toBeLessThan(0);
    expect(haulsLostNear(fate.lostIn!, fate.at + 60).some((x) => x.haul.id === h.id)).toBe(true);
  });

  it('a hauler the player saw through a raided system gets through; one destroyed is lost, whoever did it', () => {
    const world = log();
    useWorldLog(world);
    const h = raidedHaul();
    const fate = haulFate(h);
    recordHaul(world, h.id, { at: fate.at, fate: 'safe', systemId: fate.lostIn! });
    expect(haulFate(h).delivered).toBe(true);
    expect(haulStock(h.to, h.commodity, h.arrive + 1)).toBe(0);
    // A safe passage elsewhere does not cover this system.
    recordHaul(world, h.id, { at: fate.at, fate: 'safe', systemId: 'sol' });
    expect(haulFate(h).delivered).toBe(false);
    // Lost stays lost.
    const other = sampleHauls(2).find((x) => haulFate(x).delivered)!;
    recordHaul(world, other.id, { at: other.depart + 10, fate: 'lost', systemId: other.path[0]!, by: 'player' });
    recordHaul(world, other.id, { at: other.depart + 20, fate: 'safe', systemId: other.path[0]! });
    expect(haulFate(other)).toMatchObject({ delivered: false, at: other.depart + 10, by: 'player' });
  });

  it('a relief hauler destroyed leaves its shortage to run on', () => {
    const world = log();
    useWorldLog(world);
    const { e, hauls } = relievedShortage();
    recordHaul(world, hauls[0]!.id, { at: hauls[0]!.depart + 30, fate: 'lost', systemId: hauls[0]!.path[0]!, by: 'player' });
    expect(reliefEnd(e)).toBe(Infinity);
    expect(eventEnd(e)).toBe(e.end);
  });

  it('keeps three hours of records in the save, and refuses damaged ones', () => {
    const s = createNewGame(4);
    recordHaul(s.world, 'h.a.1', { at: 100, fate: 'safe', systemId: 'sol' });
    recordHaul(s.world, 'h.b.2', { at: 100 + HAULS.keepSeconds + 1, fate: 'lost', systemId: 'sol', by: 'raiders' });
    expect(Object.keys(s.world.hauls!)).toEqual(['h.b.2']);
    expect(migrateSave(structuredClone(s)).world.hauls).toEqual(s.world.hauls);
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, hauls: { x: { at: 1, fate: 'gone', systemId: 'sol' } } } })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, hauls: { x: { at: 1, fate: 'safe', systemId: 'nowhere' } } } })).toThrow();
    const { hauls: _h, ...older } = s.world;
    expect(migrateSave({ ...structuredClone(s), world: older }).world.hauls).toBeUndefined();
  });
});

// ---------------------------------------------------------------- in flight

/** Ship and station art paint plating on a 2D canvas, which node lacks: hand them a stub. */
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
  name: string;
  side: 'lawful' | 'raider';
  haul?: { haul: Haul };
  body: { position: THREE.Vector3 };
  durability: { hull: number };
  target: { name: string; subtitle?: string };
  trader?: { state: string; destination: { id: string; point: THREE.Vector3 } };
}

function flightAt(systemId: SystemId, clock: number, traders = 6) {
  installCanvasStub();
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  const state = createNewGame(7);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  state.clock = clock;
  useWorldLog(state.world);
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const messages: string[] = [];
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
    onMessage: (text) => messages.push(text),
    onHaul: (id, fate, by) => {
      record('haul')(id, fate, by);
      recordHaul(state.world, id, { at: state.clock, fate, systemId, ...(by ? { by } : {}) });
    },
    onHaulThanks: record('thanks'),
  };
  const audio = { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine;
  const flight = new FlightSession({
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
  const destroy = (n: Npc, byPlayer: boolean) =>
    (flight as unknown as { damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void }).damageNpc(n, 1e6, n.body.position.clone(), undefined, byPlayer);
  const loot = () => (flight as unknown as { loot: { cargo?: { commodity: string; qty: number } }[] }).loot;
  return { flight, state, calls, messages, run, npcs, destroy, loot };
}

/** A moment when Sol's lanes have a few of the timetable's haulers. */
function busySol(): number {
  for (let c = 30_000; c < 60_000; c += 120) if (haulsIn('sol', c).length >= 3) return c;
  throw new Error('Sol is never busy');
}

describe('haulers in flight', () => {
  it('are the timetable’s: named, with their cargo and where it is going', () => {
    const clock = busySol();
    const f = flightAt('sol', clock);
    f.run(0.2);
    const ships = f.npcs().filter((n) => n.haul);
    expect(ships.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(haulsIn('sol', clock).map((x) => x.haul.id));
    for (const n of ships) {
      const h = n.haul!.haul;
      expect(ids.has(h.id)).toBe(true);
      expect(n.target.name).toBe(`The ${h.name}`);
      expect(n.target.subtitle).toContain(`${h.qty} `);
      expect(n.target.subtitle).toContain(getLocation(h.to).name);
    }
    // The plan caps how many are shown at once.
    const few = flightAt('sol', clock, 1);
    few.run(0.2);
    expect(few.npcs().filter((n) => n.haul)).toHaveLength(1);
  });

  it('destroyed by the player, a hauler is lost and spills its real cargo', () => {
    const f = flightAt('sol', busySol());
    f.run(0.2);
    const n = f.npcs().find((x) => x.haul)!;
    const h = n.haul!.haul;
    f.destroy(n, true);
    expect(f.calls.haul).toContainEqual([h.id, 'lost', 'player']);
    expect(haulFate(h)).toMatchObject({ delivered: false, by: 'player' });
    const pods = f.loot().filter((p) => p.cargo);
    expect(pods.length).toBeGreaterThan(0);
    expect(pods.every((p) => p.cargo!.commodity === h.commodity)).toBe(true);
    expect(pods.reduce((a, p) => a + p.cargo!.qty, 0)).toBe(Math.round(h.qty * HAULS.spill.share));
    expect(f.messages.some((m) => m.startsWith(`The ${h.name} was destroyed`))).toBe(true);
  });

  it('flies its leg and leaves the scene, safe, at its dock or the jump beacon; more join as their legs begin', () => {
    const f = flightAt('sol', busySol());
    f.run(0.2);
    const first = new Set(f.npcs().filter((n) => n.haul).map((n) => n.haul!.haul.id));
    let left = false;
    f.run(900, () => {
      left = (f.calls.haul ?? []).some(([, fate]) => fate === 'safe');
      return left && f.npcs().some((n) => n.haul && !first.has(n.haul.haul.id));
    });
    expect(left).toBe(true);
    expect(f.npcs().some((n) => n.haul && !first.has(n.haul.haul.id))).toBe(true);
  });
});

describe('a hauler the player stands by', () => {
  it('kept alive through a raiders’ attack by the player’s guns, sends thanks when it gets away', () => {
    const f = flightAt('sol', busySol());
    f.run(0.2);
    const n = f.npcs().find((x) => x.haul)!;
    const priv = f.flight as unknown as {
      damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void;
      makeNpc(model: string, role: string, faction: string, p: THREE.Vector3, fwd: THREE.Vector3, sub: string): Npc & { id: string };
    };
    // Raiders hit it: it calls for help and runs for the nearest dock.
    priv.damageNpc(n, 5, n.body.position.clone(), undefined, false);
    f.run(0.1);
    expect(f.messages.some((m) => m.startsWith(`Mayday from the ${n.haul!.haul.name}`))).toBe(true);
    // Nobody helped yet: getting away pays nothing. The player downs a raider: now it does.
    const raider = priv.makeNpc('ship.light-fighter.1.wake', 'raider', 'hollow-wake', n.body.position.clone().add(new THREE.Vector3(800, 0, 0)), new THREE.Vector3(1, 0, 0), 'raider');
    f.flight.debugDestroy(raider.id, true);
    n.body.position.copy(n.trader!.destination.point);
    expect(f.run(5, () => !!f.calls.thanks)).toBe(true);
    expect((f.calls.thanks![0]![0] as Haul).id).toBe(n.haul!.haul.id);
    expect(f.calls.haul).toContainEqual([n.haul!.haul.id, 'safe', undefined]);
  });

  it('one the player fired on sends none', () => {
    const f = flightAt('sol', busySol());
    f.run(0.2);
    const n = f.npcs().find((x) => x.haul)!;
    const priv = f.flight as unknown as {
      damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void;
      makeNpc(model: string, role: string, faction: string, p: THREE.Vector3, fwd: THREE.Vector3, sub: string): Npc & { id: string };
    };
    priv.damageNpc(n, 5, n.body.position.clone(), undefined, true);
    f.run(0.1);
    const raider = priv.makeNpc('ship.light-fighter.1.wake', 'raider', 'hollow-wake', n.body.position.clone().add(new THREE.Vector3(800, 0, 0)), new THREE.Vector3(1, 0, 0), 'raider');
    f.flight.debugDestroy(raider.id, true);
    n.body.position.copy(n.trader!.destination.point);
    f.run(5, () => (f.calls.haul ?? []).some(([id]) => id === n.haul!.haul.id));
    expect(f.calls.thanks).toBeUndefined();
  });
});

describe('stock the hauls move', () => {
  it('stays within reason everywhere: never negative, and no more than a few hauls’ worth', () => {
    useWorldLog(log());
    for (const h of sampleHauls(4).slice(0, 60)) {
      const e = marketEntry(h.to, h.commodity)!;
      const now = stockNow(h.to, e, { clock: h.arrive + 1, markets: {} });
      expect(now).toBeGreaterThanOrEqual(0);
      expect(Math.abs(haulStock(h.to, h.commodity, h.arrive + 1))).toBeLessThan(HAULS.load.max * 6);
    }
  });
});

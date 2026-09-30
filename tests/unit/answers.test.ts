import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { ECONOMY } from '../../src/content/economy/rules.ts';
import { EVENTS } from '../../src/content/events/rules.ts';
import { LAW } from '../../src/content/law/rules.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../../src/data/systems.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { raidKill, relieveShortage, shortageDeficit } from '../../src/economy/answers.ts';
import { eventsAt, newsAt, stationEventAt, systemEventAt, useWorldLog, type WorldEvent } from '../../src/economy/events.ts';
import { commitCrime, dockAccess, fineOwed, settleLaw } from '../../src/economy/law.ts';
import { marketEntry, moveStock, normalStock, spillNeighbours, stockNow } from '../../src/economy/markets.ts';

/** A world that answers the player (docs/PROCGEN.md §17). */

function pilot(): GameState {
  const s = createNewGame(41);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.credits = 50_000;
  return s;
}

/** The first event of a kind found on the clock. */
function findEvent(kind: WorldEvent['kind']): WorldEvent {
  for (let t = 0; t < 400_000; t += 600) {
    const e = eventsAt(t).find((x) => x.kind === kind && (kind !== 'shortage' || shortageDeficit(x) > 0));
    if (e) return e;
  }
  throw new Error(`no ${kind}`);
}

afterEach(() => useWorldLog(null));

describe('events the player can end', () => {
  it('selling into a shortage relieves it: it ends early, pays a bonus and raises standing', () => {
    const s = pilot();
    useWorldLog(s.world);
    const e = findEvent('shortage');
    s.clock = e.start + 60;
    const loc = getLocation(e.locationId!);
    const good = e.goods[0]!;
    const standing = loc.factionId ? s.reputation[loc.factionId] : 0;
    const need = Math.ceil(shortageDeficit(e) * EVENTS.react.relief);
    expect(relieveShortage(s, loc.id, good, Math.max(1, need - 1))).toBeNull();
    expect(stationEventAt(loc.id, s.clock)?.id).toBe(e.id);
    const credits = s.credits;
    const r = relieveShortage(s, loc.id, good, 1);
    expect(r?.paid).toBeGreaterThan(0);
    expect(s.credits).toBe(credits + r!.paid);
    if (loc.factionId) expect(s.reputation[loc.factionId]).toBeGreaterThan(standing!);
    expect(stationEventAt(loc.id, s.clock)).toBeNull();
    const news = newsAt(loc.systemId, s.clock).find((n) => n.event.id === e.id)!;
    expect(news).toMatchObject({ active: false, endedEarly: true });
    // Without the world log (another save), the event runs its course.
    useWorldLog(null);
    expect(stationEventAt(loc.id, s.clock)?.id).toBe(e.id);
  });

  it('enough raiders destroyed breaks a raid', () => {
    const s = pilot();
    useWorldLog(s.world);
    const e = findEvent('raid');
    s.clock = e.start + 60;
    const needed = EVENTS.react.raidKills + (e.level ?? 1);
    for (let i = 1; i < needed; i++) expect(raidKill(s, e.systemId)).toBeNull();
    expect(raidKill(s, e.systemId)?.text).toMatch(/is broken/);
    expect(systemEventAt(e.systemId, s.clock)).toBeNull();
  });
});

describe('goods move out of sight', () => {
  it('a glut left at one dock drifts into its neighbours, peaks, and fades', () => {
    const s = pilot();
    const x = ALL_LOCATIONS.find((l) => l.status === 'functional' && marketEntry(l.id, 'water') && spillNeighbours(l.id, 'water').length > 0)!;
    const y = spillNeighbours(x.id, 'water')[0]!;
    const entry = marketEntry(y, 'water')!;
    const ctx = (clock: number) => ({ clock, markets: s.markets });
    expect(stockNow(y, entry, ctx(0))).toBeCloseTo(normalStock(y, entry, 0), 5);
    moveStock(s.markets, x.id, 'water', 300, 0);
    const tau = ECONOMY.recoverySeconds;
    const at = (k: number) => stockNow(y, entry, ctx(k * tau)) - normalStock(y, entry, k * tau);
    expect(at(0)).toBeCloseTo(0, 5);
    expect(at(1)).toBeGreaterThan(at(0.2));
    expect(at(1)).toBeGreaterThan(at(4));
    expect(at(1)).toBeGreaterThan(0);
    expect(at(12)).toBeLessThan(0.01 * 300);
  });
});

describe('witnesses', () => {
  it('a crime is known where it was seen, and the news travels a jump at a time', () => {
    const s = pilot();
    const here = 'sol';
    const jumps = jumpsFrom(WORLD.links, here);
    const far = [...jumps.entries()].find(([id, j]) => j === 2 && ALL_LOCATIONS.some((l) => l.systemId === id && l.factionId === 'sta' && l.status === 'functional' && l.dockable !== false))?.[0];
    expect(far).toBeDefined();
    const station = ALL_LOCATIONS.find((l) => l.systemId === far && l.factionId === 'sta' && l.status === 'functional' && l.dockable !== false)!;
    commitCrime(s, 'attack', 'sta', here);
    expect(fineOwed(s, 'sta', here)).toBe(LAW.crimes.attack.fine);
    expect(fineOwed(s, 'sta', far!)).toBe(0);
    expect(dockAccess(s, station.id)).toBe('full');
    s.clock += 2 * LAW.witness.perJump;
    expect(fineOwed(s, 'sta', far!)).toBe(LAW.crimes.attack.fine);
    expect(dockAccess(s, station.id)).toBe('emergency');
    // Once it has reached everywhere, it is on the record (well before it could lapse).
    const spread = Math.max(...jumps.values()) * LAW.witness.perJump;
    expect(spread).toBeLessThan(LAW.lapse);
    s.clock = spread;
    settleLaw(s);
    expect(s.law.pending).toEqual([]);
    expect(s.law.fines.sta).toBe(LAW.crimes.attack.fine);
  });

  it('fines lapse after a quiet spell, but not for a Hostile pilot', () => {
    const s = pilot();
    commitCrime(s, 'attack', 'sta', 'sol');
    s.clock += LAW.lapse - 1;
    expect(settleLaw(s)).toEqual([]);
    s.clock += 1;
    expect(settleLaw(s)[0]).toMatch(/lapsed/);
    expect(fineOwed(s, 'sta')).toBe(0);
    const h = pilot();
    h.reputation.sta = -80;
    commitCrime(h, 'destroy', 'sta', 'sol');
    h.clock += LAW.lapse * 3;
    settleLaw(h);
    expect(fineOwed(h, 'sta')).toBeGreaterThan(0);
  });
});

describe('saves', () => {
  it('a v9 save keeps its fines on record; damaged world logs are rejected', () => {
    const { world: _w, law: _l, ...rest } = createNewGame(6);
    const s = migrateSave({ ...structuredClone(rest), law: { fines: { sta: 300 } }, version: 9 });
    expect(s.law).toEqual({ fines: { sta: 300 }, pending: [], lastCrimeAt: { sta: s.clock } });
    expect(s.world).toEqual({ relief: {}, raidKills: {}, ended: {}, lingering: {}, border: {} });
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, lingering: { nowhere: { at: 0, packs: [], pods: [] } } } })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), law: { ...s.law, pending: [{ faction: 'sta', amount: 10, systemId: 'sol', at: 'yesterday' }] } })).toThrow();
  });
});

// ---------------------------------------------------------------- flight

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

describe('encounters that persist', () => {
  beforeAll(installCanvasStub);

  it('a pack that saw the player, and pods left adrift, are there on a return', async () => {
    const { FlightSession } = await import('../../src/world/FlightSession.ts');
    const { SystemScene } = await import('../../src/world/SystemScene.ts');
    const { sceneDefFor } = await import('../../src/world/systems/index.ts');
    const { defaultSettings } = await import('../../src/app/settings.ts');
    const { emptyInput } = await import('../../src/flight/input/types.ts');
    const make = (traffic: Record<string, unknown>) => {
      const state = createNewGame(12);
      state.location = { systemId: 'altair', dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
      const f = new FlightSession({
        system: new SystemScene(sceneDefFor('altair'), { quality: 'low', reducedMotion: true }),
        camera: new THREE.PerspectiveCamera(),
        state,
        settings: defaultSettings(),
        ctx: { quality: 'low', reducedMotion: true },
        audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as never,
        callbacks: { onDocked() {}, onPlayerDestroyed() {}, onDiscovery() {}, onScanInfo() {}, onEncounterStart() {}, onEncounterEnd() {}, onLoot() {}, onBounty() {}, onContractKill() {}, onMessage() {} },
        traffic: { plan: { traders: 0, traderInterval: [60, 60], patrolWings: 0, wingSize: 2, packs: null }, owner: null, ...traffic },
      });
      f.start({ kind: 'arrival' });
      return f;
    };
    const packs = { max: 1, level: 2 as const, size: [2, 2] as const, firstDelay: 1, interval: [999, 999] as const };
    const f = make({ plan: { traders: 0, traderInterval: [60, 60], patrolWings: 0, wingSize: 2, packs } });
    const inner = f as unknown as { npcs: { side: string; body: { position: THREE.Vector3 } }[]; spawnLoot(p: THREE.Vector3, v: number, x?: object): void };
    for (let t = 0; t < 3; t += 0.05) f.update(0.05, emptyInput());
    for (const n of inner.npcs.filter((x) => x.side === 'raider')) n.body.position.copy(f.player.position).add(new THREE.Vector3(800, 0, 0));
    for (let t = 0; t < 0.5; t += 0.05) f.update(0.05, emptyInput());
    inner.spawnLoot(f.player.position.clone().add(new THREE.Vector3(0, 0, 900)), 0, { cargo: { commodity: 'water', qty: 4 } });
    const left = f.lingering();
    expect(left.packs).toHaveLength(1);
    expect(left.packs[0]!.count).toBe(2);
    expect(left.pods).toHaveLength(1);
    const back = make({ lingering: left });
    for (let t = 0; t < 2.5; t += 0.05) back.update(0.05, emptyInput());
    const raiders = (back as unknown as typeof inner).npcs.filter((x) => x.side === 'raider');
    expect(raiders).toHaveLength(2);
    expect(raiders[0]!.body.position.distanceTo(new THREE.Vector3(...left.packs[0]!.position))).toBeLessThan(1_000);
    expect(back.allTargets().some((t) => t.name === 'Cargo pod')).toBe(true);
  });
});

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { LAW } from '../../src/content/law/rules.ts';
import { ALL_LOCATIONS } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { boltMayHit, FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';

/**
 * The law in flight (docs/PROCGEN.md §12): who the player's guns can hit, patrols turning on a
 * hunted pilot, cargo scans, bounty hunters, raiders sparing a pilot the Wake trusts, and the dens
 * opening to them. A real FlightSession in node, without rendering.
 */

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

const QUIET: TrafficPlan = { traders: 0, patrolWings: 0, wingSize: 2, packs: null };

interface Npc {
  id: string;
  side: 'lawful' | 'raider';
  role: string;
  hunter?: boolean;
  foe: unknown;
  body: { position: THREE.Vector3 };
  target: { id: string; name: string; hostile?: boolean };
}

function flightIn(systemId: SystemId, plan: Partial<TrafficPlan>, owner: TrafficSetup['owner'], setup: (s: GameState) => void = () => {}) {
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  const state = createNewGame(9);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  setup(state);
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
    onMessage: (text) => log.push(text),
    onCrime: record('crime'),
    onScan: record('scan'),
    onHunterDown: record('hunterDown'),
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
    traffic: { plan: { ...QUIET, ...plan }, owner },
  });
  flight.start({ kind: 'arrival' });
  const npcs = () => (flight as unknown as { npcs: Npc[] }).npcs;
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  return { flight, state, calls, log, run, npcs, scene };
}

describe('the law in flight', () => {
  beforeAll(installCanvasStub);

  it('the player’s bolts hit lawful ships only when they are the selected target', () => {
    expect(boltMayHit('player', 'raider', false)).toBe(true);
    expect(boltMayHit('player', 'lawful', false)).toBe(false);
    expect(boltMayHit('player', 'lawful', true)).toBe(true);
    expect(boltMayHit('lawful', 'lawful', true)).toBe(false);
    expect(boltMayHit('raider', 'raider', false)).toBe(false);
    expect(boltMayHit('raider', 'lawful', false)).toBe(true);
  });

  it('firing on a patrol is reported once and turns it on the player', () => {
    const { flight, calls, run, npcs } = flightIn('sol', { patrolWings: 1 }, 'sta');
    run(3);
    const patrol = npcs().find((n) => n.role === 'patrol')!;
    const hit = (flight as unknown as { damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void }).damageNpc.bind(flight);
    hit(patrol, 1, patrol.body.position.clone(), undefined, true);
    hit(patrol, 1, patrol.body.position.clone(), undefined, true);
    expect(calls.crime).toEqual([['attack', 'sta', expect.any(String), 'patrol']]);
    expect(patrol.foe).toBe('player');
  });

  it('patrols hunt a pilot who owes their faction fines', () => {
    const { flight, run, npcs } = flightIn('sol', { patrolWings: 1 }, 'sta', (s) => (s.law.fines.sta = 500));
    run(3);
    const patrol = npcs().find((n) => n.role === 'patrol')!;
    flight.player.position.copy(patrol.body.position).add(new THREE.Vector3(1_500, 0, 0));
    run(1);
    expect(patrol.foe).toBe('player');
    expect(patrol.target.hostile).toBe(true);
  });

  it('a passing patrol scans a hold with contraband; staying finishes it, fleeing is evasion', () => {
    const stay = flightIn('sol', { patrolWings: 1 }, 'sta', (s) => (s.ship.cargo = { stims: 3 }));
    stay.run(3);
    const p = stay.npcs().find((n) => n.role === 'patrol')!;
    stay.flight.player.position.copy(p.body.position).add(new THREE.Vector3(800, 0, 0));
    expect(stay.run(20, () => !!stay.calls.scan)).toBe(true);
    expect(stay.calls.scan).toEqual([['complete', 'sta']]);
    expect(stay.log.some((m) => m.includes('cargo scan'))).toBe(true);

    const flee = flightIn('sol', { patrolWings: 1 }, 'sta', (s) => (s.ship.cargo = { stims: 3 }));
    flee.run(3);
    const q = flee.npcs().find((n) => n.role === 'patrol')!;
    flee.flight.player.position.copy(q.body.position).add(new THREE.Vector3(800, 0, 0));
    flee.run(0.5);
    expect(flee.flight.scanStatus).not.toBeNull();
    flee.flight.player.position.add(new THREE.Vector3(LAW.scans.escape * 3, 0, 0));
    expect(flee.run(3, () => !!flee.calls.scan)).toBe(true);
    expect(flee.calls.scan).toEqual([['evaded', 'sta']]);
  });

  it('the autopilot holds for a cargo scan instead of carrying the pilot away from it', () => {
    const f = flightIn('sol', { patrolWings: 1 }, 'sta', (s) => (s.ship.cargo = { stims: 2 }));
    f.run(3);
    // Cruising on autopilot when a patrol comes alongside.
    f.flight.beginGoTo('station:mars-depot', true);
    expect(f.run(30, () => f.flight.player.speed > 450)).toBe(true);
    const p = f.npcs().find((n) => n.role === 'patrol')!;
    // It comes up from behind: an autopilot that kept cruising would leave it far behind.
    const ahead = f.flight.player.forward(new THREE.Vector3());
    p.body.position.copy(f.flight.player.position).addScaledVector(ahead, -900);
    expect(f.run(30, () => !!f.calls.scan)).toBe(true);
    expect(f.calls.scan).toEqual([['complete', 'sta']]);
    // Then it carries on.
    expect(f.flight.autopilotMode).toBe('goto');
  });

  it('bounty hunters come for a pilot owing big fines in secure space, and pay nothing when downed', () => {
    const { flight, run, npcs, log, calls } = flightIn('sol', {}, 'sta', (s) => (s.law.fines.sta = LAW.hunters.fines));
    expect(run(LAW.hunters.delay + 5, () => npcs().some((n) => n.hunter))).toBe(true);
    const hunters = npcs().filter((n) => n.hunter);
    expect(hunters).toHaveLength(LAW.hunters.count);
    expect(hunters.every((h) => h.target.name === 'Bounty hunter' && h.target.hostile)).toBe(true);
    expect(log.some((m) => m.includes('Bounty hunters'))).toBe(true);
    const hit = (flight as unknown as { damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void }).damageNpc.bind(flight);
    hit(hunters[0]!, 10_000, hunters[0]!.body.position.clone(), undefined, true);
    expect(calls.hunterDown).toHaveLength(1);
    expect(calls.bounty).toBeUndefined();
    expect(calls.crime).toBeUndefined();
  });

  it('raiders leave a pilot the Wake trusts alone until provoked', () => {
    const spec = { max: 1, level: 1 as const, size: [2, 2] as const, firstDelay: 1, interval: [999, 999] as const };
    const pack = (friendly: boolean) => {
      const f = flightIn('altair', { packs: spec }, null, (s) => (s.reputation['hollow-wake'] = friendly ? LAW.wakeFriendly : -50));
      f.run(3);
      for (const n of f.npcs().filter((x) => x.side === 'raider')) n.body.position.copy(f.flight.player.position).add(new THREE.Vector3(600, 0, 0));
      f.run(1);
      return f.npcs().filter((x) => x.side === 'raider');
    };
    expect(pack(false).some((n) => n.foe === 'player')).toBe(true);
    const spared = pack(true);
    expect(spared.length).toBeGreaterThan(0);
    expect(spared.every((n) => n.foe !== 'player' && !n.target.hostile)).toBe(true);
  });

  it('the raider dens take in a pilot the Wake trusts', () => {
    const den = ALL_LOCATIONS.find((l) => l.stationType === 'pirate-den' && l.status === 'functional')!;
    const canDock = (friendly: boolean) => {
      const f = flightIn(den.systemId, {}, null, (s) => (s.reputation['hollow-wake'] = friendly ? LAW.wakeFriendly : -50));
      const site = f.scene.dock(den.id)!;
      const target = f.flight.allTargets().find((t) => t.id === `station:${den.id}`)!;
      return { dock: (f.flight as unknown as { canDock(s: unknown): boolean }).canDock(site), hostile: target.hostile };
    };
    expect(canDock(false)).toEqual({ dock: false, hostile: true });
    expect(canDock(true)).toEqual({ dock: true, hostile: false });
  });
});

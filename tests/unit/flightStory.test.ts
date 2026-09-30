import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { DENS } from '../../src/content/dens/rules.ts';
import { LAW } from '../../src/content/law/rules.ts';
import type { SystemId } from '../../src/data/types.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { boltMayHit, FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';

/**
 * The finales in flight (docs/PROCGEN.md §14.3): a convoy under two waves of raiders, a den
 * assault (turrets before the reactor, a wing alongside) and a sweep coming for a den. A real
 * FlightSession in node, without rendering.
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

const QUIET: TrafficPlan = { traders: 0, traderInterval: [60, 60], patrolWings: 0, wingSize: 2, packs: null };

interface Npc {
  id: string;
  name: string;
  side: 'lawful' | 'raider';
  role: string;
  foe: unknown;
  prey?: unknown;
  den?: { locationId: string; part: 'turret' | 'reactor' };
  wingman?: unknown;
  sweep?: unknown;
  escort?: { jobId: string; convoy?: boolean };
  contract?: string;
  body: { position: THREE.Vector3 };
  durability: { hull: number; hullMax: number };
  trader?: { destination: { point: THREE.Vector3 } };
  target: { id: string; name: string; hostile?: boolean };
}

function flightIn(systemId: SystemId, traffic: Omit<TrafficSetup, 'plan' | 'owner'>, setup: (s: GameState) => void = () => {}) {
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
    onEscortArrived: record('escortArrived'),
    onEscortLost: record('escortLost'),
    onCrime: record('crime'),
    onDenDestroyed: record('denDestroyed'),
    onMessage: (text) => log.push(text),
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
    traffic: { plan: QUIET, owner: null, ...traffic },
  });
  flight.start({ kind: 'arrival' });
  const npcs = () => (flight as unknown as { npcs: Npc[] }).npcs;
  const hit = (n: Npc, amount: number) =>
    (flight as unknown as { damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void }).damageNpc(n, amount, n.body.position.clone(), undefined, true);
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  return { flight, state, calls, log, run, npcs, hit, scene };
}

describe('the finales in flight', () => {
  beforeAll(installCanvasStub);

  it('a convoy sets off together, and its ambushes come in waves along the route', () => {
    const f = flightIn('procyon', {
      escorts: [
        {
          jobId: 'arc.frontier.5',
          from: 'dawnfield-institute',
          to: 'stonecrop-gardens',
          model: 'ship.freighter.1.toliman',
          name: 'relief convoy',
          level: 2,
          convoy: { names: ['Sorrel', 'Tansy', 'Clover'], waves: 2 },
        },
      ],
    });
    f.run(3);
    const convoy = f.npcs().filter((n) => n.escort?.jobId === 'arc.frontier.5');
    expect(convoy.map((n) => n.name)).toEqual(['Sorrel', 'Tansy', 'Clover']);
    expect(convoy.every((n) => n.escort?.convoy)).toBe(true);
    expect(f.log.some((m) => m.includes('relief convoy (3 ships)'))).toBe(true);
    const raiders = () => f.npcs().filter((n) => n.side === 'raider').length;
    expect(raiders()).toBe(0);
    // Move the convoy (and the player with it) along its route: a wave at each mark.
    const along = (frac: number) => {
      for (const n of convoy) {
        const dest = n.trader!.destination.point;
        n.body.position.lerp(dest, frac);
      }
      f.flight.player.position.copy(convoy[0]!.body.position).add(new THREE.Vector3(0, 80, 0));
      f.run(0.5);
    };
    along(0.35);
    const first = raiders();
    expect(first).toBeGreaterThan(0);
    expect(f.npcs().some((n) => n.prey && convoy.includes(n.prey as Npc))).toBe(true);
    along(0.9);
    expect(raiders()).toBeGreaterThan(first);
    expect(f.log.filter((m) => m.startsWith('Ambush!'))).toHaveLength(2);
    // A lost ship is reported per ship.
    f.hit(convoy[2]!, 1e6);
    expect(f.calls.escortLost).toEqual([['arc.frontier.5']]);
  });

  it('a den assault: turrets first, then the reactor; a wing flies alongside', () => {
    const f = flightIn('wolf-1061', { assaults: [{ jobId: 'arc.sta.5', locationId: 'maw-roost', turretsLeft: DENS.turrets }] });
    f.run(3);
    const turrets = f.npcs().filter((n) => n.den?.part === 'turret');
    const reactor = f.npcs().find((n) => n.den?.part === 'reactor')!;
    const wing = f.npcs().filter((n) => n.wingman);
    expect(turrets).toHaveLength(DENS.turrets);
    expect(reactor).toBeDefined();
    expect(wing).toHaveLength(DENS.wing.count);
    expect(wing.every((w) => w.side === 'lawful')).toBe(true);
    expect(f.npcs().filter((n) => n.side === 'raider' && !n.den).length).toBe(DENS.guards.count);
    // The wing keeps station with the player.
    f.flight.player.position.add(new THREE.Vector3(0, 0, -600));
    f.run(8);
    for (const w of wing) if (!w.foe) expect(w.body.position.distanceTo(f.flight.player.position)).toBeLessThan(900);
    // Turrets fire on a pilot in range.
    const shots = () => f.flight.debugNpcs().filter((n) => n.id.startsWith('den-turret')).reduce((sum, n) => sum + n.shotsFired, 0);
    f.flight.player.position.copy(turrets[0]!.body.position).add(new THREE.Vector3(0, 0, 700));
    expect(f.run(8, () => shots() > 0)).toBe(true);
    // The reactor shrugs off hits while a turret stands.
    f.hit(reactor, 1e6);
    expect(reactor.durability.hull).toBe(reactor.durability.hullMax);
    expect(f.log.some((m) => m.includes('shielded'))).toBe(true);
    for (const t of turrets) f.hit(t, 1e6);
    expect(f.calls.contractKill).toEqual(turrets.map(() => ['arc.sta.5']));
    f.hit(reactor, 1e6);
    expect(f.calls.denDestroyed).toEqual([['maw-roost', 'arc.sta.5']]);
    const den = f.flight.allTargets().find((t) => t.id === 'station:maw-roost')!;
    expect(den.name).toMatch(/wrecked/);
    expect(den.hostile).toBe(false);
  });

  it('an assault after some turrets are down brings only the rest', () => {
    const f = flightIn('wolf-1061', { assaults: [{ jobId: 'arc.sta.5', locationId: 'maw-roost', turretsLeft: 1 }] });
    f.run(3);
    expect(f.npcs().filter((n) => n.den?.part === 'turret')).toHaveLength(1);
  });

  it('a knocked-out den is wrecked, silent and closed, even to Wake friends', () => {
    const f = flightIn('wolf-1061', { downDens: ['maw-roost'], assaults: [{ jobId: 'arc.sta.5', locationId: 'maw-roost', turretsLeft: 3 }] }, (s) => (s.reputation['hollow-wake'] = 40));
    f.run(3);
    expect(f.npcs().some((n) => n.den)).toBe(false);
    const den = f.flight.allTargets().find((t) => t.id === 'station:maw-roost')!;
    expect(den).toMatchObject({ hostile: false });
    expect(den.name).toMatch(/wrecked/);
    const site = f.scene.dock('maw-roost')!;
    expect((f.flight as unknown as { canDock(s: unknown): boolean }).canDock(site)).toBe(false);
  });

  it('a sweep comes for a den in waves; its ships can be hit without selecting them, and each kill counts (and is a crime)', () => {
    const f = flightIn('70-ophiuchi', { defences: [{ jobId: 'arc.wake.5', locationId: 'graveyard-nest', count: 4 }] }, (s) => (s.reputation['hollow-wake'] = LAW.wakeFriendly + 10));
    f.run(3);
    // The den's crews turn out, and spare a friend of the Wake.
    const crews = f.npcs().filter((n) => n.side === 'raider');
    expect(crews).toHaveLength(DENS.sweep.defenders);
    expect(f.run(10, () => f.npcs().some((n) => n.sweep))).toBe(true);
    const wave1 = f.npcs().filter((n) => n.sweep);
    expect(wave1).toHaveLength(3);
    expect(wave1.every((n) => n.side === 'lawful' && n.target.hostile)).toBe(true);
    expect(f.log.some((m) => m.includes('sweep ships inbound'))).toBe(true);
    // Hostile lawful ships take the player's bolts without being selected.
    expect(boltMayHit('player', 'lawful', false, true)).toBe(true);
    expect(boltMayHit('player', 'lawful', false, false)).toBe(false);
    f.hit(wave1[0]!, 1e6);
    f.hit(wave1[1]!, 1e6);
    expect(f.calls.contractKill).toEqual([['arc.wake.5'], ['arc.wake.5']]);
    expect(f.calls.crime?.length).toBe(2);
    // With one ship of the first wave left, the second wave comes.
    expect(f.run(12, () => f.npcs().filter((n) => n.sweep).length > 1)).toBe(true);
    expect(f.log.some((m) => m.includes('second wave'))).toBe(true);
  });
});

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { shipModel } from '../../src/content/catalog.ts';
import { ALL_LOCATIONS } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Contracts II in flight (docs/PROCGEN.md §10.2): escorted ships and their ambush, aces with guards
 * and loot, and wrecks to search, flown by a real FlightSession in node (no rendering).
 */

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

const QUIET = { traders: 0, traderInterval: [60, 60] as const, patrolWings: 0, wingSize: 2, packs: null };

function flightIn(systemId: SystemId, traffic: Omit<TrafficSetup, 'plan' | 'owner'>) {
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  const state = createNewGame(7);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
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
    onScanInfo: record('scan'),
    onEncounterStart: record('encounterStart'),
    onEncounterEnd: record('encounterEnd'),
    onLoot: record('loot'),
    onBounty: record('bounty'),
    onContractKill: record('contractKill'),
    onMessage: (text) => log.push(text),
    onEscortArrived: record('escortArrived'),
    onEscortLost: record('escortLost'),
    onRecovered: record('recovered'),
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
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  return { flight, calls, log, run, scene };
}

const stationsIn = (systemId: SystemId) => ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false);

describe('contracts in flight', () => {
  beforeAll(installCanvasStub);

  it('an escorted ship sets off with the player, is ambushed part-way, and ends docked or lost', () => {
    const [from, to] = stationsIn('tau-ceti');
    const { flight, calls, log, run } = flightIn('tau-ceti', {
      escorts: [{ jobId: 'c.test.0.0', from: from!.id, to: to!.id, model: 'ship.freighter.1.halden', name: 'Halden Petrel', level: 1 }],
    });
    run(3);
    expect(flight.allTargets().some((t) => t.name === 'Halden Petrel (escort)')).toBe(true);
    expect(log.some((m) => m.includes('setting off'))).toBe(true);
    const ended = run(400, () => !!calls.escortArrived || !!calls.escortLost);
    expect(ended).toBe(true);
    expect(log.some((m) => m.startsWith('Ambush!'))).toBe(true);
    expect([...(calls.escortArrived ?? []), ...(calls.escortLost ?? [])]).toEqual([['c.test.0.0']]);
  });

  it('an ace flies with guards, is tougher than its hull, and drops credits and a cargo pod', () => {
    const [near] = stationsIn('altair');
    const ace = { name: 'Rook “Old Teeth” Draygo', model: CONTRACTS.ace.model };
    const { flight, calls, run } = flightIn('altair', { contractPacks: [{ jobId: 'c.ace.0.0', locationId: near!.id, count: 1, level: 3, ace }] });
    run(3);
    const ships = flight.debugNpcs();
    expect(ships.filter((n) => n.role === 'raider')).toHaveLength(1 + CONTRACTS.ace.guards);
    const target = flight.allTargets().find((t) => t.name === ace.name)!;
    expect(target).toBeDefined();
    // Tougher than a guard in the same kind of ship.
    const npcs = (flight as unknown as { npcs: { name: string; target: { id: string }; durability: { hullMax: number } }[] }).npcs;
    const npc = npcs.find((n) => n.target.id === target.id)!;
    const twin = npcs.find((n) => n !== npc && n.name === shipModel(ace.model).name)!;
    expect(npc.durability.hullMax).toBeCloseTo(twin.durability.hullMax * CONTRACTS.ace.toughness, 5);
    // Knock it out and see what it leaves.
    (flight as unknown as { destroyNpc(n: unknown): void }).destroyNpc(npc);
    expect(calls.contractKill).toEqual([['c.ace.0.0']]);
    const loot = flight.allTargets().filter((t) => t.kind === 'loot');
    expect(loot.map((t) => t.name).sort()).toEqual(['Cargo pod', 'Salvage pod', 'Salvage pod']);
  });

  it('a wreck lies off a station, sometimes guarded, and its item is tractored in', () => {
    const [site] = stationsIn('ross-154');
    const { flight, calls, run } = flightIn('ross-154', { wrecks: [{ jobId: 'c.wreck.0.0', locationId: site!.id, item: 'flight recorder', guard: 1 }] });
    run(3);
    const pod = flight.allTargets().find((t) => t.id === 'wreck:c.wreck.0.0')!;
    expect(pod).toMatchObject({ name: 'Flight recorder', kind: 'loot' });
    expect(flight.debugNpcs().filter((n) => n.role === 'raider')).toHaveLength(1);
    // Fly up to it: the tractor beam pulls it in.
    flight.player.position.copy(pod.position).add(new THREE.Vector3(60, 0, 0));
    flight.player.velocity.set(0, 0, 0);
    expect(run(20, () => !!calls.recovered)).toBe(true);
    expect(calls.recovered).toEqual([['c.wreck.0.0']]);
    expect(calls.loot ?? []).toEqual([]);
  });
});

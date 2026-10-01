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
import { FlightSession, type FlightCallbacks, type SpawnSpec, type TrafficSetup } from '../../src/world/FlightSession.ts';
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

interface Npc {
  name: string;
  side: 'lawful' | 'raider';
  prey?: unknown;
  escort?: { jobId: string; follow?: unknown };
  trader?: unknown;
  body: { position: THREE.Vector3 };
  durability: { hull: number };
  target: { name: string; hostile?: boolean };
}

function flightIn(systemId: SystemId, traffic: Omit<TrafficSetup, 'plan' | 'owner'>, spawn: SpawnSpec = { kind: 'arrival' }) {
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
  flight.start(spawn);
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  const npcs = () => (flight as unknown as { npcs: Npc[] }).npcs;
  const hit = (n: Npc, amount: number) =>
    (flight as unknown as { damageNpc(n: unknown, a: number, at: THREE.Vector3, t: undefined, byPlayer: boolean): void }).damageNpc(n, amount, n.body.position.clone(), undefined, true);
  return { flight, calls, log, run, scene, npcs, hit };
}

const stationsIn = (systemId: SystemId) => ALL_LOCATIONS.filter((l) => l.systemId === systemId && l.status === 'functional' && l.dockable !== false);

/** An escort on its way from Ross 154 to Wolf 1061, met in Ross 154. */
const ACROSS = { jobId: 'c.across.0.0', from: 'regent-concourse', to: 'flotsam-diggings', model: 'ship.freighter.1.halden', name: 'Halden Petrel', level: 1 as const };

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

  it('an ace flies with guards, is tougher than its hull, and drops credits, a cargo pod and an equipment crate', () => {
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
    // Salvage, the ace's own credits, its hold, and (since combat depth) always an equipment crate.
    const names = loot.map((t) => t.name);
    expect(names.filter((n) => n === 'Salvage pod')).toHaveLength(2);
    expect(names).toContain('Cargo pod');
    expect(names).toContain('Equipment crate');
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
  it('an escort on its way to another system keeps with the player and waits for the jump until it is close', () => {
    const { flight, calls, log, run, npcs, hit } = flightIn('ross-154', { escorts: [{ ...ACROSS, follow: true }] }, { kind: 'undock', locationId: 'regent-concourse' });
    run(3);
    const ship = npcs().find((n) => n.escort?.jobId === ACROSS.jobId)!;
    expect(ship.name).toBe('Halden Petrel');
    expect(ship.escort?.follow).toBeTruthy();
    expect(ship.trader).toBeUndefined();
    expect(ship.target).toMatchObject({ name: 'Halden Petrel (escort)', hostile: false });
    expect(log.some((m) => m.includes('The Halden Petrel is with you, bound for Flotsam Diggings (Wolf 1061). Jump with it within 2.5 km.'))).toBe(true);
    // Out of a dock, nobody waits at the beacon.
    run(10);
    expect(npcs().some((n) => n.side === 'raider')).toBe(false);
    expect(log.some((m) => m.includes('beacon'))).toBe(false);
    // Close by, it does not hold the jump; left behind, it does, until it closes up.
    expect(ship.body.position.distanceTo(flight.player.position)).toBeLessThan(CONTRACTS.escort.keepUpM);
    expect(flight.escortBehind()).toBeNull();
    flight.player.position.add(new THREE.Vector3(0, 0, -4_000));
    expect(flight.escortBehind()).toBe('Halden Petrel');
    expect(run(120, () => flight.escortBehind() === null)).toBe(true);
    // Far behind (a lane, a long cruise), it catches up at once, as a wingman does.
    flight.player.position.add(new THREE.Vector3(0, 0, -20_000));
    run(0.2);
    expect(ship.body.position.distanceTo(flight.player.position)).toBeLessThan(1_000);
    // It never docks on the way; destroyed, the contract hears of it.
    expect(calls.escortArrived).toBeUndefined();
    hit(ship, 1e6);
    expect(calls.escortLost).toEqual([[ACROSS.jobId]]);
  });

  it('arriving through a jump with escorted ships, raiders are waiting at the beacon where there is something to fear', () => {
    const { log, run, npcs, flight } = flightIn('wolf-1061', { escorts: [{ ...ACROSS, beacon: true }] });
    run(2.5);
    const ship = npcs().find((n) => n.escort?.jobId === ACROSS.jobId)!;
    // In its destination's system, it heads for its dock.
    expect(ship.trader).toBeDefined();
    expect(log.some((m) => m.includes('The Halden Petrel is setting off for Flotsam Diggings'))).toBe(true);
    expect(run(6, () => npcs().some((n) => n.side === 'raider'))).toBe(true);
    expect(log.some((m) => m.includes('Raiders were waiting at the beacon! They are closing on the Halden Petrel.'))).toBe(true);
    const raiders = npcs().filter((n) => n.side === 'raider');
    expect(raiders).toHaveLength(ACROSS.level + 1);
    expect(raiders.some((n) => n.prey === ship)).toBe(true);
    // They come from ahead, a little way off, and hold the jump drive while they are near.
    const nearest = Math.min(...raiders.map((n) => n.body.position.distanceTo(flight.player.position)));
    expect(nearest).toBeGreaterThan(600);
    expect(run(60, () => flight.hostilesNearby())).toBe(true);
  });

  it('a convoy on its way keeps with the player, ship by ship, and the beacon ambush comes for one of them', () => {
    const convoy = { ...ACROSS, name: 'convoy from Regent Concourse', convoy: { names: ['Patience', 'Marigold', 'Juniper'], waves: 1 }, follow: true as const, beacon: true as const };
    const { log, run, npcs } = flightIn('ross-154', { escorts: [convoy] });
    expect(run(8, () => npcs().some((n) => n.side === 'raider'))).toBe(true);
    const ships = npcs().filter((n) => n.escort?.jobId === ACROSS.jobId);
    expect(ships.map((n) => n.name)).toEqual(['Patience', 'Marigold', 'Juniper']);
    expect(ships.every((n) => n.escort?.follow)).toBe(true);
    expect(log.some((m) => m.includes('The convoy from Regent Concourse (3 ships) is with you'))).toBe(true);
    expect(log.some((m) => m.includes('closing on the convoy from Regent Concourse'))).toBe(true);
    expect(npcs().filter((n) => n.side === 'raider').some((n) => ships.includes(n.prey as Npc))).toBe(true);
  });
});

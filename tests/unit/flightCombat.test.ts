import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { COMBAT } from '../../src/content/combat/rules.ts';
import { DENS } from '../../src/content/dens/rules.ts';
import type { SystemId } from '../../src/data/types.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';

/**
 * Combat depth in flight (docs/PROCGEN.md §15): damage to the ship's systems, seekers and decoys,
 * mines, hired wingmen, raider dens that defend themselves, and chatter. A real FlightSession in
 * node, without rendering.
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
  name: string;
  side: 'lawful' | 'raider';
  role: string;
  foe: unknown;
  den?: { locationId: string; part: 'turret' | 'reactor' };
  wingman?: { crewId?: string };
  seekerIn?: number;
  brain: { state: string };
  body: { position: THREE.Vector3; velocity: THREE.Vector3 };
  durability: { hull: number; hullMax: number; shield: number };
  target: { id: string; name: string; hostile?: boolean };
}

interface Internals {
  npcs: Npc[];
  mines: { position: THREE.Vector3; armIn: number }[];
  missiles: { target: { id: string } | null }[];
  playerDurability: { hull: number; hullMax: number; shield: number; shieldMax: number };
  damagePlayer(amount: number, at: THREE.Vector3, type?: string): void;
  damageNpc(n: unknown, amount: number, at: THREE.Vector3, type: undefined, byPlayer: boolean): void;
  spawnMine(at: THREE.Vector3, life?: number): void;
}

function flightIn(systemId: SystemId, traffic: Partial<TrafficSetup>, setup: (s: GameState) => void = () => {}) {
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  const state = createNewGame(11);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  setup(state);
  const log: string[] = [];
  const comms: string[] = [];
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
    onDenDestroyed: record('denDestroyed'),
    onWingmanLost: record('wingmanLost'),
    onWingOrders: record('wingOrders'),
    onCrime: record('crime'),
    onComm: (speaker, text) => comms.push(`${speaker}: ${text}`),
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
  const inner = flight as unknown as Internals;
  const run = (seconds: number, until?: () => boolean, actions: string[] = []) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      const input = emptyInput();
      for (const a of actions) input.actions.add(a as never);
      actions = [];
      flight.update(1 / 20, input);
      if (until?.()) return true;
    }
    return false;
  };
  return { flight, state, inner, calls, log, comms, run, scene };
}

describe('combat depth in flight', () => {
  beforeAll(installCanvasStub);

  it('hull hits damage the ship’s systems, which slow it and its guns; a repair kit patches them up', () => {
    const f = flightIn('sol', {});
    const baseSpeed = f.flight.player.params.maxSpeed;
    for (let i = 0; i < 300 && f.state.ship.systems.engines === 0; i++) {
      f.inner.playerDurability.shield = 0;
      f.inner.playerDurability.hull = f.inner.playerDurability.hullMax;
      f.inner.damagePlayer(20, f.flight.player.position.clone());
    }
    expect(f.state.ship.systems.engines).toBeGreaterThan(0);
    expect(f.flight.player.params.maxSpeed).toBeLessThan(baseSpeed);
    expect(f.log.some((m) => m.includes('Engines damaged'))).toBe(true);
    expect(f.flight.hud.warnings.join(' ')).toBe('');
    f.run(0.1);
    expect(f.flight.hud.warnings.join(' ')).toMatch(/Damaged: engines/);
    f.run(0.1, undefined, ['repair']);
    expect(f.state.ship.systems).toEqual({ engines: 0, guns: 0, shields: 0 });
    expect(f.flight.player.params.maxSpeed).toBeCloseTo(baseSpeed);
  });

  it('a hull hit flashes the screen’s edges, fading in under half a second whatever the frame rate', () => {
    const f = flightIn('sol', {});
    f.inner.playerDurability.shield = 0;
    f.inner.damagePlayer(10, f.flight.player.position.clone());
    f.run(0.05);
    expect(f.flight.hud.flash.hull).toBeGreaterThan(0);
    f.run(0.5);
    expect(f.flight.hud.flash.hull).toBe(0);
  });

  it('heavy raiders fire seekers at the player; a decoy draws them off', () => {
    const packs = { max: 1, level: 3 as const, size: [2, 2] as const, firstDelay: 1, interval: [999, 999] as const };
    const f = flightIn('altair', { plan: { ...QUIET, packs } });
    f.run(3);
    const heavy = f.inner.npcs.filter((n) => n.seekerIn !== undefined);
    expect(heavy.length).toBeGreaterThan(0);
    // Bring one ahead of the player, facing it, with its seeker ready.
    const h = heavy[0]!;
    h.seekerIn = 0;
    const seeker = () => f.inner.missiles.filter((m) => m.target?.id === 'player').length;
    expect(f.run(20, () => seeker() > 0)).toBe(true);
    expect(f.log.some((m) => m.startsWith('Seeker inbound'))).toBe(true);
    f.run(0.1);
    expect(f.flight.hud.incoming).toBeGreaterThan(0);
    const decoys = f.state.ship.decoys;
    f.run(0.1, undefined, ['decoy']);
    expect(f.state.ship.decoys).toBe(decoys - 1);
    const onDecoy = f.inner.missiles.filter((m) => m.target?.id.startsWith('decoy:')).length;
    expect(onDecoy + seeker()).toBeGreaterThan(0);
    expect(f.log.some((m) => m.startsWith('Decoy away'))).toBe(true);
  });

  it('mines arm, go off when a ship comes close and hurt it; a raider breaking off may drop one', () => {
    const f = flightIn('sol', {});
    const at = f.flight.player.position.clone().add(new THREE.Vector3(0, 0, -400));
    f.inner.spawnMine(at);
    expect(f.flight.allTargets().some((t) => t.name === 'Mine')).toBe(true);
    f.run(COMBAT.mines.arm + 0.5);
    const hull = f.inner.playerDurability.hull + f.inner.playerDurability.shield;
    f.flight.player.position.copy(at).add(new THREE.Vector3(0, 0, 40));
    f.run(0.2);
    expect(f.inner.mines).toHaveLength(0);
    expect(f.inner.playerDurability.hull + f.inner.playerDurability.shield).toBeLessThan(hull);
  });

  it('hired wingmen launch with the player, keep up, fight raiders, and are reported when lost', () => {
    const crew = [
      { id: 'w1', name: 'Maren Okoro', model: 'ship.light-fighter.1.halden', skill: 'sharp' as const },
      { id: 'w2', name: 'Tobin Sato', model: 'ship.light-fighter.1.halden', skill: 'steady' as const },
    ];
    const packs = { max: 1, level: 1 as const, size: [1, 1] as const, firstDelay: 999, interval: [999, 999] as const };
    const f = flightIn('altair', { plan: { ...QUIET, packs }, crew });
    f.run(3);
    const wing = f.inner.npcs.filter((n) => n.wingman?.crewId);
    expect(wing.map((n) => n.name)).toEqual(['Maren Okoro', 'Tobin Sato']);
    expect(wing.every((w) => w.side === 'lawful' && !w.target.hostile)).toBe(true);
    expect(f.comms.some((c) => c.startsWith('Maren Okoro'))).toBe(true);
    // Far behind (a lane, a long cruise), they catch up.
    f.flight.player.position.add(new THREE.Vector3(20_000, 0, 0));
    f.run(0.5);
    for (const w of wing) expect(w.body.position.distanceTo(f.flight.player.position)).toBeLessThan(1_000);
    f.inner.damageNpc(wing[0]!, 1e6, wing[0]!.body.position.clone(), undefined, false);
    expect(f.calls.wingmanLost).toEqual([['w1']]);
  });

  it('the wing takes orders: attack my target, form up, engage at will', () => {
    const crew = [{ id: 'w1', name: 'Maren Okoro', model: 'ship.light-fighter.1.halden', skill: 'sharp' as const }];
    const packs = { max: 1, level: 1 as const, size: [2, 2] as const, firstDelay: 1, interval: [999, 999] as const };
    const f = flightIn('altair', { plan: { ...QUIET, packs }, crew });
    f.run(2);
    const raiders = f.inner.npcs.filter((n) => n.side === 'raider');
    expect(raiders).toHaveLength(2);
    const wing = f.inner.npcs.find((n) => n.wingman?.crewId)!;
    // Both raiders close by; the player picks the farther one.
    raiders[0]!.body.position.copy(f.flight.player.position).add(new THREE.Vector3(500, 0, 0));
    raiders[1]!.body.position.copy(f.flight.player.position).add(new THREE.Vector3(-1_500, 0, 0));
    f.flight.selectTarget(raiders[1]!.target.id);
    // A sharp hire takes a moment to react to a new foe.
    f.run(1);
    expect(f.flight.hud.wing).toEqual({ count: 1, order: 'free', hurt: 0 });
    expect(wing.foe).toBe(raiders[0]);
    expect(f.flight.giveWingOrder('attack')).toEqual({ speaker: 'Maren Okoro', text: 'Copy, going for your target.' });
    f.run(0.1);
    expect(f.flight.hud.wing?.order).toBe('attack');
    f.run(1);
    expect(wing.foe).toBe(raiders[1]);
    f.flight.giveWingOrder('form');
    f.run(0.1);
    expect(f.flight.hud.wing?.order).toBe('form');
    expect(wing.foe).toBeNull();
    f.flight.giveWingOrder('free');
    f.run(1);
    expect(f.flight.hud.wing?.order).toBe('free');
    expect(wing.foe).not.toBeNull();
    // The key or the chip asks the game for the order card.
    f.run(0.1, undefined, ['wing-order']);
    expect(f.calls.wingOrders).toHaveLength(1);
  });

  it('a raider den wakes when a pilot it does not trust comes near, and knocking it out on your own pays', () => {
    const f = flightIn('wolf-1061', {});
    f.run(2);
    expect(f.inner.npcs.some((n) => n.den)).toBe(false);
    const den = f.flight.allTargets().find((t) => t.id === 'station:maw-roost')!;
    f.flight.player.position.copy(den.position).add(new THREE.Vector3(0, 0, DENS.alert - 500));
    f.run(0.5);
    const turrets = f.inner.npcs.filter((n) => n.den?.part === 'turret');
    const reactor = f.inner.npcs.find((n) => n.den?.part === 'reactor')!;
    expect(turrets).toHaveLength(DENS.turrets);
    expect(f.inner.mines.length).toBeGreaterThanOrEqual(COMBAT.mines.atDens);
    expect(f.inner.npcs.some((n) => n.wingman)).toBe(false);
    expect(f.log.some((m) => m.includes('defences are live'))).toBe(true);
    for (const t of turrets) f.inner.damageNpc(t, 1e6, t.body.position.clone(), undefined, true);
    expect(f.calls.bounty?.length).toBe(DENS.turrets);
    expect(f.calls.bounty?.every(([credits]) => credits === DENS.turretBounty)).toBe(true);
    f.inner.damageNpc(reactor, 1e6, reactor.body.position.clone(), undefined, true);
    expect(f.calls.denDestroyed).toEqual([['maw-roost', null]]);
  });

  it('an ace waiting by a den is hunted clear of the den’s guns', () => {
    const ace = { name: 'Vesk “Ember” Marlowe', model: 'ship.heavy-fighter.2.wake' };
    const f = flightIn('wolf-1061', { contractPacks: [{ jobId: 'c.test.ace', locationId: 'maw-roost', count: 1, level: 3, ace }] });
    f.run(3);
    const target = f.inner.npcs.find((n) => n.name === ace.name)!;
    expect(target).toBeDefined();
    const den = f.flight.allTargets().find((t) => t.id === 'station:maw-roost')!;
    expect(target.body.position.distanceTo(den.position)).toBeGreaterThan(DENS.alert);
    f.flight.player.position.copy(target.body.position).add(new THREE.Vector3(0, 0, 400));
    f.run(1);
    expect(f.inner.npcs.some((n) => n.den)).toBe(false);
  });

  it('a den stays quiet for a pilot the Wake trusts', () => {
    const f = flightIn('wolf-1061', {}, (s) => (s.reputation['hollow-wake'] = 30));
    f.run(1);
    const den = f.flight.allTargets().find((t) => t.id === 'station:maw-roost')!;
    f.flight.player.position.copy(den.position).add(new THREE.Vector3(0, 0, 2_000));
    f.run(1);
    expect(f.inner.npcs.some((n) => n.den)).toBe(false);
  });

  it('raiders have something to say when they find you', () => {
    const packs = { max: 1, level: 1 as const, size: [2, 2] as const, firstDelay: 1, interval: [999, 999] as const };
    const f = flightIn('altair', { plan: { ...QUIET, packs } });
    f.run(3);
    for (const n of f.inner.npcs.filter((x) => x.side === 'raider')) n.body.position.copy(f.flight.player.position).add(new THREE.Vector3(600, 0, 0));
    f.run(1);
    expect(f.comms.some((c) => c.startsWith('Wake raider:'))).toBe(true);
  });

  it('a patrol taking on raiders within radio range calls it; far away, nobody hears', () => {
    const packs = { max: 1, level: 1 as const, size: [1, 1] as const, firstDelay: 1, interval: [999, 999] as const };
    const setup = (gap: number) => {
      const f = flightIn('altair', { plan: { ...QUIET, patrolWings: 1, packs }, owner: 'sta' });
      f.run(3);
      const patrols = f.inner.npcs.filter((n) => n.role === 'patrol');
      const raider = f.inner.npcs.find((n) => n.side === 'raider')!;
      expect(patrols.length).toBeGreaterThan(0);
      // The raider is out of its own sight of the player; the patrol, not yet engaged, is between them.
      const p = f.flight.player.position;
      for (const n of patrols) {
        n.body.position.copy(p).add(new THREE.Vector3(gap, 0, 0));
        n.foe = null;
      }
      raider.body.position.copy(p).add(new THREE.Vector3(gap + 1_500, 0, 0));
      f.run(0.5);
      return f;
    };
    expect(setup(3_200).comms.some((c) => c.startsWith('Transit Authority patrol:'))).toBe(true);
    expect(setup(12_000).comms.some((c) => c.includes('patrol:'))).toBe(false);
  });
});

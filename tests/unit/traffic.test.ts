import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Durability } from '../../src/combat/damage.ts';
import { PatrolBrain, TraderBrain } from '../../src/combat/TrafficAI.ts';
import { findShip } from '../../src/content/catalog.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { SYSTEMS, WORLD } from '../../src/data/systems.ts';
import { neutralControls, PLAYER_SHIP, ShipBody } from '../../src/flight/ShipBody.ts';
import { bountyFor, FLEETS, RAIDERS, TRAFFIC, trafficPlan } from '../../src/world/traffic/plan.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

const durability = (): Durability => ({ hull: 100, hullMax: 100, shield: 50, shieldMax: 50, shieldRegen: 5, shieldDelay: 3, shieldType: 'balanced', sinceHit: 99 });

describe('traffic rules', () => {
  it('flies only ships that exist in the catalogue', () => {
    for (const fleet of Object.values(FLEETS)) for (const id of [...fleet.traders, ...fleet.patrols]) expect(findShip(id), id).toBeDefined();
    for (const list of Object.values(RAIDERS)) for (const id of list) expect(findShip(id)?.maker, id).toBe('wake');
  });

  it('keeps Sol busy and safe, and the lawless edge quiet and dangerous', () => {
    const sol = trafficFor('sol', 'high').plan;
    expect(sol.traders).toBeGreaterThanOrEqual(2);
    expect(sol.patrolWings).toBe(2);
    expect(sol.packs).toBeNull();
    const altair = trafficFor('altair', 'high').plan;
    expect(altair.patrolWings).toBe(0);
    expect(altair.packs?.level).toBe(3);
    expect(altair.traders).toBeLessThanOrEqual(sol.traders);
    // No raider packs anywhere next to Sol, and some wherever security is low.
    const jumps = jumpsFrom(WORLD.links, 'sol');
    for (const s of SYSTEMS) {
      const plan = trafficFor(s.id, 'high').plan;
      const p = WORLD.profiles.get(s.id)!;
      if ((jumps.get(s.id) ?? 0) === 0 || p.security >= TRAFFIC.packSecurity) expect(plan.packs, s.id).toBeNull();
      if (p.security < 0.35 && (jumps.get(s.id) ?? 0) >= 1) expect(plan.packs, s.id).not.toBeNull();
      expect(plan.traders).toBeLessThanOrEqual(TRAFFIC.maxTraders);
    }
  });

  it('scales down for phones and grows packs with danger and distance', () => {
    const input = { security: 0.8, owner: 'sta' as const, openStations: 3, hasDen: false, jumpsFromSol: 1 };
    expect(trafficPlan(input, 0.5).traders).toBeLessThan(trafficPlan(input, 1).traders);
    expect(trafficPlan(input, 0.5).patrolWings).toBeLessThanOrEqual(1);
    const border = trafficPlan({ ...input, security: 0.5, jumpsFromSol: 2 }).packs!;
    const lawless = trafficPlan({ ...input, security: 0.15, owner: null, hasDen: true, jumpsFromSol: 3 }).packs!;
    expect(border.level).toBe(1);
    expect(lawless.level).toBe(3);
    expect(lawless.max).toBe(2);
    expect(lawless.size[1]).toBeGreaterThan(border.size[1]);
    expect(lawless.interval[0]).toBeLessThan(border.interval[0]);
    expect(trafficPlan({ ...input, security: 0.5, jumpsFromSol: 6 }).packs!.level).toBe(2);
  });

  it('pays more for tougher raiders', () => {
    expect(bountyFor('ship.light-fighter.1.wake')).toBe(150);
    expect(bountyFor('ship.light-fighter.2.wake')).toBeGreaterThan(bountyFor('ship.light-fighter.1.wake'));
    expect(bountyFor('ship.heavy-fighter.2.wake')).toBeGreaterThan(bountyFor('ship.light-fighter.2.wake'));
  });
});

describe('traffic behaviour', () => {
  const fly = (body: ShipBody, controls: ReturnType<typeof neutralControls>, seconds: number, step: (t: number) => boolean | void) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      const cruise = step(t);
      body.requestCruise(!!cruise);
      body.step(controls, 1 / 30);
    }
  };

  it('a trader flies around a planet in its way and docks at its destination', () => {
    const body = new ShipBody(PLAYER_SHIP);
    const controls = neutralControls();
    body.lookAlong(new THREE.Vector3(1, 0, 0));
    const dest = { id: 'far-port', point: new THREE.Vector3(24_000, 0, 0) };
    const planet = { id: 'planet:rock', center: new THREE.Vector3(12_000, 0, 0), radius: 2_000 };
    const brain = new TraderBrain(dest, durability());
    let closest = Infinity;
    fly(body, controls, 400, () => {
      if (brain.state === 'arrived') return false;
      closest = Math.min(closest, body.position.distanceTo(planet.center));
      return brain.update(body, durability(), controls, [planet], () => null);
    });
    expect(brain.state).toBe('arrived');
    expect(closest).toBeGreaterThan(planet.radius);
  });

  it('a trader under fire turns for the nearest haven', () => {
    const body = new ShipBody(PLAYER_SHIP);
    const controls = neutralControls();
    const d = durability();
    const brain = new TraderBrain({ id: 'far-port', point: new THREE.Vector3(30_000, 0, 0) }, d);
    brain.update(body, d, controls, [], () => null);
    d.shield -= 20;
    const haven = { id: 'near-dock', point: new THREE.Vector3(-3_000, 0, 0) };
    brain.update(body, d, controls, [], () => haven);
    expect(brain.attacked).toBe(true);
    expect(brain.state).toBe('flee');
    expect(brain.destination.id).toBe('near-dock');
  });

  it('a patrol flies its loop of waypoints', () => {
    const body = new ShipBody(PLAYER_SHIP);
    const controls = neutralControls();
    const points = [new THREE.Vector3(0, 0, -6_000), new THREE.Vector3(6_000, 0, 0)];
    const brain = new PatrolBrain(points, 0);
    let reachedFirst = false;
    fly(body, controls, 200, () => {
      if (body.position.distanceTo(points[0]!) < 1_300) reachedFirst = true;
      return brain.update(body, controls, [], new THREE.Vector3());
    });
    expect(reachedFirst).toBe(true);
    expect(body.position.distanceTo(points[1]!)).toBeLessThan(body.position.distanceTo(new THREE.Vector3(0, 0, 0)) + 6_000);
  });
});

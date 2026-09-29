import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyDamage, regenerate, type Durability } from '../../src/combat/damage.ts';
import { clampToCone, interceptTime, leadPoint } from '../../src/combat/lead.ts';
import { Gun, GUN_ARC, ProjectileSystem, segmentHitsSphere } from '../../src/combat/weapons.ts';
import { flyTo } from '../../src/flight/autopilot.ts';
import { ChaseCamera } from '../../src/flight/ChaseCamera.ts';
import { TouchControlsModel, VirtualStick } from '../../src/flight/input/touchModel.ts';
import { shapeAxis } from '../../src/flight/input/types.ts';
import { neutralControls, PLAYER_SHIP, ShipBody, stepBounded } from '../../src/flight/ShipBody.ts';

describe('touch pointer ownership', () => {
  it('each stick only follows the pointer that claimed it', () => {
    const m = new TouchControlsModel(60, 60);
    expect(m.steer.down(1, 100, 300)).toBe(true);
    expect(m.aim.down(2, 700, 300)).toBe(true);
    // A third finger cannot steal either stick.
    expect(m.steer.down(3, 120, 320)).toBe(false);
    expect(m.steer.owner).toBe(1);
    m.steer.move(1, 160, 300);
    m.aim.move(2, 700, 240);
    // Moves from the wrong pointer are ignored.
    m.steer.move(2, 0, 0);
    m.aim.move(1, 999, 999);
    expect(m.steer.vector.x).toBeCloseTo(1, 5);
    expect(m.steer.vector.y).toBeCloseTo(0, 5);
    expect(m.aim.vector.y).toBeCloseTo(1, 5); // dragging up = positive
    expect(m.firing).toBe(true);
    // Releasing the steering finger leaves aim untouched.
    m.release(1);
    expect(m.steer.active).toBe(false);
    expect(m.aim.active).toBe(true);
    expect(m.aim.owner).toBe(2);
    m.release(2);
    expect(m.firing).toBe(false);
  });

  it('a cancelled pointer releases only what it owned and resets the vector', () => {
    const stick = new VirtualStick(50);
    stick.down(7, 0, 0);
    stick.move(7, 30, 0);
    expect(stick.release(8)).toBe(false);
    expect(stick.active).toBe(true);
    expect(stick.release(7)).toBe(true);
    expect(stick.vector).toEqual({ x: 0, y: 0 });
    expect(stick.knob).toEqual({ x: 0, y: 0 });
  });

  it('clamps travel to the radius and applies a dead zone', () => {
    const stick = new VirtualStick(50, 0.1);
    stick.down(1, 0, 0);
    stick.move(1, 3, 0); // inside dead zone
    expect(stick.vector).toEqual({ x: 0, y: 0 });
    stick.move(1, 500, 0);
    expect(stick.knob.x).toBe(50);
    expect(stick.vector.x).toBeCloseTo(1, 6);
  });

  it('boost is a hold button owned by one pointer', () => {
    const m = new TouchControlsModel();
    expect(m.boost.down(4)).toBe(true);
    expect(m.boost.down(5)).toBe(false);
    m.release(5);
    expect(m.boost.held).toBe(true);
    m.release(4);
    expect(m.boost.held).toBe(false);
  });
});

describe('flight model', () => {
  function simulate(dt: number, seconds: number) {
    const ship = new ShipBody(PLAYER_SHIP);
    const c = neutralControls();
    c.throttle = 1;
    c.steerX = 0.5;
    c.steerY = 0.25;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) ship.step(c, dt);
    return ship;
  }

  it('is frame-rate independent (30 Hz vs 120 Hz end within tolerance)', () => {
    const a = simulate(1 / 30, 4);
    const b = simulate(1 / 120, 4);
    expect(a.position.distanceTo(b.position)).toBeLessThan(12);
    expect(a.quaternion.angleTo(b.quaternion)).toBeLessThan(0.05);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(2);
  });

  it('approaches throttle speed and drifts with engines off', () => {
    const ship = new ShipBody(PLAYER_SHIP);
    const c = neutralControls();
    c.throttle = 1;
    for (let i = 0; i < 600; i++) ship.step(c, 1 / 60);
    expect(ship.speed).toBeCloseTo(PLAYER_SHIP.maxSpeed, 0);
    c.engineKill = true;
    c.throttle = 0;
    const v = ship.speed;
    for (let i = 0; i < 120; i++) ship.step(c, 1 / 60);
    expect(ship.speed).toBeCloseTo(v, 6);
  });

  it('boost drains energy and cruise spins up before engaging', () => {
    const ship = new ShipBody(PLAYER_SHIP);
    const c = neutralControls();
    c.throttle = 1;
    c.boost = true;
    for (let i = 0; i < 60; i++) ship.step(c, 1 / 60);
    expect(ship.energy).toBeLessThan(PLAYER_SHIP.energyMax - 5);
    c.boost = false;
    ship.requestCruise(true);
    ship.step(c, 0.5);
    expect(ship.cruise).toBe('charging');
    for (let i = 0; i < 120; i++) ship.step(c, 1 / 60);
    expect(ship.cruise).toBe('on');
    for (let i = 0; i < 600; i++) ship.step(c, 1 / 60);
    expect(ship.speed).toBeGreaterThan(PLAYER_SHIP.cruiseSpeed * 0.95);
  });

  it('lookAlong points the nose (-Z) along the requested direction', () => {
    const ship = new ShipBody(PLAYER_SHIP);
    for (const d of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.3, 0.2, 0.9).normalize(), new THREE.Vector3(0, 1, 0)]) {
      ship.lookAlong(d);
      expect(ship.forward().distanceTo(d)).toBeLessThan(1e-6);
    }
    ship.lookAlong(new THREE.Vector3(0, 0, 1));
    expect(ship.up().y).toBeGreaterThan(0.99);
  });

  it('chase camera widens the vertical FOV on portrait screens only', () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 10, 0.1, 1000);
    const chase = new ChaseCamera(cam);
    chase.snap(new ShipBody(PLAYER_SHIP));
    expect(cam.fov).toBeCloseTo(chase.baseFov, 6);
    for (const aspect of [390 / 844, 360 / 640, 768 / 1024]) {
      cam.aspect = aspect;
      chase.snap(new ShipBody(PLAYER_SHIP));
      expect(cam.fov).toBeGreaterThan(chase.baseFov);
      expect(cam.fov).toBeLessThanOrEqual(chase.maxFov);
      const horizontal = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * aspect));
      expect(horizontal).toBeGreaterThan(chase.minHorizontalFov - 20);
    }
  });

  it('bounded stepping splits a long frame into small steps', () => {
    const steps: number[] = [];
    stepBounded(0.1, 1 / 60, (h) => steps.push(h));
    expect(steps.length).toBe(6);
    expect(steps.every((h) => h <= 1 / 60 + 1e-9)).toBe(true);
    expect(steps.reduce((a, b) => a + b, 0)).toBeCloseTo(0.1, 9);
  });

  it('autopilot flies to a point and stops near it', () => {
    const ship = new ShipBody(PLAYER_SHIP);
    const target = new THREE.Vector3(800, 200, -1500);
    const c = neutralControls();
    let arrived = false;
    for (let i = 0; i < 60 * 60 && !arrived; i++) {
      const st = flyTo(ship, target, { arriveDistance: 100, allowCruise: false }, c);
      ship.step(c, 1 / 60);
      arrived = st.arrived;
    }
    expect(arrived).toBe(true);
    expect(ship.position.distanceTo(target)).toBeLessThan(160);
  });
});

describe('aiming, projectiles and damage', () => {
  it('intercept time solves a crossing target', () => {
    const r = new THREE.Vector3(0, 0, -500);
    const v = new THREE.Vector3(100, 0, 0);
    const t = interceptTime(r, v, 700)!;
    const hit = r.clone().addScaledVector(v, t);
    expect(hit.length()).toBeCloseTo(700 * t, 6);
    expect(interceptTime(new THREE.Vector3(0, 0, -100), new THREE.Vector3(0, 0, -900), 700)).toBeNull();
  });

  it('bolts fired at the lead point hit a moving target off the nose', () => {
    // Shooter moving; target crossing to the side, 25 degrees off the nose.
    const shooter = new ShipBody(PLAYER_SHIP);
    shooter.velocity.set(0, 0, -80);
    const targetPos = new THREE.Vector3(Math.sin(0.44) * 600, 0, -Math.cos(0.44) * 600);
    const targetVel = new THREE.Vector3(-60, 30, 0);
    const aim = new THREE.Vector3();
    leadPoint(shooter.position, shooter.velocity, targetPos, targetVel, 760, aim);
    const gun = new Gun({ damage: 9, shotsPerSecond: 5, projectileSpeed: 760, range: 2000, energyPerShot: 1, kind: 'player-pulse' });
    const bolts = new ProjectileSystem();
    const res = gun.fire(shooter, [new THREE.Vector3(0, 0, 0)], aim, bolts, 'player');
    expect(res.fired).toBe(true);
    expect(res.clamped).toBe(false);
    let hit = false;
    const pos = targetPos.clone();
    for (let i = 0; i < 240 && !hit; i++) {
      const dt = 1 / 120;
      pos.addScaledVector(targetVel, dt);
      bolts.update(dt, (_p, from, to) => {
        hit = segmentHitsSphere(from, to, pos, 6);
        return hit;
      });
    }
    expect(hit).toBe(true);
  });

  it('clamps fire direction to the gun arc', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    const dir = new THREE.Vector3(1, 0, 0);
    expect(clampToCone(dir, forward, GUN_ARC)).toBe(true);
    expect(dir.angleTo(forward)).toBeCloseTo(GUN_ARC, 5);
    const inside = new THREE.Vector3(0.1, 0, -1).normalize();
    expect(clampToCone(inside, forward, GUN_ARC)).toBe(false);
  });

  it('shields absorb first, hull does not regenerate, shields do after a delay', () => {
    const d: Durability = { hull: 100, hullMax: 100, shield: 20, shieldMax: 60, shieldRegen: 10, shieldDelay: 2, sinceHit: 0 };
    const r = applyDamage(d, 30);
    expect(r).toMatchObject({ absorbedByShield: 20, hullDamage: 10, shieldBroke: true, destroyed: false });
    expect(d.hull).toBe(90);
    regenerate(d, 1);
    expect(d.shield).toBe(0);
    regenerate(d, 2);
    expect(d.shield).toBeGreaterThan(0);
    expect(d.hull).toBe(90);
    expect(applyDamage(d, 500).destroyed).toBe(true);
  });

  it('shapes input axes with a dead zone', () => {
    expect(shapeAxis(0.05, 0.07)).toBe(0);
    expect(shapeAxis(1, 0.07)).toBe(1);
    expect(shapeAxis(-1, 0.07)).toBe(-1);
    expect(shapeAxis(0.5, 0.07)).toBeGreaterThan(0);
  });
});

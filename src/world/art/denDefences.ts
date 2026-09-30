import * as THREE from 'three';
import { Kit, latheZ } from './kit.ts';
import { createLightPoints } from './lights.ts';
import { standardSet } from './materials.ts';
import type { ShipArt } from './ships.ts';
import type { ArtContext } from './types.ts';
import { byQuality, disposeObject } from './util.ts';

/**
 * The defences of a raider den under assault (docs/PROCGEN.md §14.3): gun turrets on struts, and
 * the reactor pod whose loss puts the den out. Both behave as ships to the flight code (they are
 * hit, flash and fire the same way) but never move. Their guns face -Z.
 */

/** A shield flash: an additive shell that fades after each hit. */
function shieldShell(radius: number, color: string, ctx: ArtContext): { mesh: THREE.Mesh; flash(s: number): void; update(dt: number): void } {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, byQuality(ctx.quality, 14, 18, 24), byQuality(ctx.quality, 10, 12, 16)), mat);
  mesh.visible = false;
  mesh.renderOrder = 7;
  const peak = ctx.reducedMotion ? 0.25 : 0.45;
  return {
    mesh,
    flash(s) {
      mat.opacity = Math.max(mat.opacity, Math.max(0, Math.min(1, s)) * peak);
      mesh.visible = true;
    },
    update(dt) {
      if (!mesh.visible) return;
      mat.opacity = Math.max(0, mat.opacity - dt * 1.2);
      if (mat.opacity <= 0.005) mesh.visible = false;
    },
  };
}

/** A den gun turret: a squat mount on a strut, a turning head and twin barrels. */
export function createTurretArt(ctx: ArtContext): ShipArt {
  const group = new THREE.Group();
  group.name = 'den-turret';
  const kit = new Kit(2);
  const seg = byQuality(ctx.quality, 8, 10, 14);
  // Mount and strut (below the head: the head turns with the whole group).
  kit.add('metal', latheZ([[0.001, -9], [9, -8], [11, -2], [11, 2], [9, 8], [0.001, 9]], seg), { rotation: [Math.PI / 2, 0, 0], position: [0, -10, 0], color: '#3a3430' });
  kit.add('metal', new THREE.CylinderGeometry(3, 4, 30, seg), { position: [0, -30, 0], color: '#2b2724' });
  // Head.
  kit.add('hull', new THREE.BoxGeometry(18, 10, 20), { position: [0, 0, 0], color: '#6d2f28' });
  kit.add('hull', new THREE.BoxGeometry(14, 4, 14), { position: [0, 6, 2], color: '#4a221d' });
  // Barrels.
  for (const x of [-5, 5]) {
    kit.add('metal', latheZ([[1.8, 0], [1.6, -18], [1.2, -24]], seg), { position: [x, 1, -8], color: '#242424' });
    kit.add('emissive', new THREE.SphereGeometry(0.9, 6, 4), { position: [x, 1, -32.5], color: '#ff5a3c', intensity: 1.6 });
  }
  kit.add('glassRed', new THREE.BoxGeometry(8, 3, 1), { position: [0, 3, -10.2] });
  kit.build(group, standardSet(ctx.quality));
  const lights = createLightPoints(
    [
      { p: [0, 9, 4], color: '#ff4a3a', size: 6, intensity: 1.8, blink: 1.3, duty: 0.4, min: 0.2 },
      { p: [0, -46, 0], color: '#ff9a3a', size: 4, intensity: 1.2 },
    ],
    ctx,
    2.5,
  );
  group.add(lights.points);
  const shell = shieldShell(24, '#ff8a6a', ctx);
  group.add(shell.mesh);
  return {
    object: group,
    radius: 22,
    muzzles: [new THREE.Vector3(-5, 1, -33), new THREE.Vector3(5, 1, -33)],
    setThrottle() {},
    setBoost() {},
    setCruise() {},
    flashShield: (s) => shell.flash(s),
    update(dt, time) {
      lights.uniforms.uTime.value = time;
      shell.update(dt);
    },
    dispose: () => disposeObject(group),
  };
}

/** The den's reactor pod: a caged core that glows hotter as it takes damage. */
export function createReactorArt(ctx: ArtContext): ShipArt & { setHeat(v: number): void } {
  const group = new THREE.Group();
  group.name = 'den-reactor';
  const kit = new Kit(3);
  const seg = byQuality(ctx.quality, 10, 14, 18);
  kit.add('metal', latheZ([[0.001, -34], [16, -30], [22, -18], [22, 18], [16, 30], [0.001, 34]], seg), { color: '#3b3632' });
  for (const z of [-20, 0, 20]) kit.add('metal', new THREE.TorusGeometry(24, 2.2, 6, seg), { position: [0, 0, z], color: '#2a2622' });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kit.add('hull', new THREE.BoxGeometry(3, 3, 60), { position: [Math.cos(a) * 25, Math.sin(a) * 25, 0], color: i % 2 ? '#5a2a24' : '#2a2622' });
  }
  kit.build(group, standardSet(ctx.quality));
  const coreMat = new THREE.MeshBasicMaterial({ color: '#ffb35a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(14, seg, Math.max(8, seg - 4)), coreMat);
  group.add(core);
  const glow = createLightPoints([{ p: [0, 0, 0], color: '#ffae4a', size: 90, intensity: 1.4 }], ctx, 4);
  group.add(glow.points);
  const shell = shieldShell(40, '#7fd8ff', ctx);
  group.add(shell.mesh);
  const cool = new THREE.Color('#ffb35a');
  const hot = new THREE.Color('#ff4a2a');
  let heat = 0;
  return {
    object: group,
    radius: 38,
    muzzles: [],
    setThrottle() {},
    setBoost() {},
    setCruise() {},
    flashShield: (s) => shell.flash(s),
    setHeat(v) {
      heat = Math.max(0, Math.min(1, v));
    },
    update(dt, time) {
      const pulse = ctx.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * (2 + heat * 6));
      coreMat.color.copy(cool).lerp(hot, heat);
      core.scale.setScalar(pulse);
      glow.uniforms.uIntensity.value = (1.1 + heat * 1.4) * pulse;
      glow.uniforms.uTime.value = time;
      shell.update(dt);
    },
    dispose: () => disposeObject(group),
  };
}

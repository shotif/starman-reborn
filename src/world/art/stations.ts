import * as THREE from 'three';
import type { ArtContext, ArtObject } from './types.ts';
import { Kit, beam, latheZ, rod, tank, truss } from './kit.ts';
import type { PartOptions, V3 } from './kit.ts';
import { createLightPoints } from './lights.ts';
import type { LightPoints, LightSpec } from './lights.ts';
import { standardSet } from './materials.ts';
import { rockGeometry } from './rocks.ts';
import { byQuality, disposeObject, seededRandom } from './util.ts';

export type StationKind =
  | 'earth-port'
  | 'mars-depot'
  | 'proxima-outpost'
  | 'barnard-relay'
  | 'sirius-platform'
  | 'eridani-hub';

export interface StationArt extends ArtObject<THREE.Group> {
  /** Bounding radius (collision keep-out). */
  readonly radius: number;
  /** Station-local point just outside the docking bay where the ship finishes docking. */
  readonly dockPoint: THREE.Vector3;
  /** Station-local unit vector pointing out of the bay (ships approach along it). */
  readonly dockApproach: THREE.Vector3;
}

/* ------------------------------------------------------------------------------------------------
 * Build context: one kit + light list per rigid part (static body, rotating ring, dish...).
 * ---------------------------------------------------------------------------------------------- */

interface Part {
  group: THREE.Group;
  kit: Kit;
  lights: LightSpec[];
}

class StationBuilder {
  readonly root = new THREE.Group();
  readonly parts: Part[] = [];
  readonly lightSets: LightPoints[] = [];
  readonly ctx: ArtContext;
  readonly seg: number;
  readonly rand: () => number;

  constructor(name: string, ctx: ArtContext, seed: number) {
    this.root.name = name;
    this.ctx = ctx;
    this.seg = byQuality(ctx.quality, 10, 16, 22);
    this.rand = seededRandom(seed);
  }

  part(name: string, parent: THREE.Object3D = this.root, uv = 12): Part {
    const group = new THREE.Group();
    group.name = name;
    parent.add(group);
    const p = { group, kit: new Kit(uv), lights: [] };
    this.parts.push(p);
    return p;
  }

  finish(): void {
    const mats = standardSet(this.ctx.quality);
    for (const p of this.parts) {
      p.kit.build(p.group, mats);
      if (p.lights.length) {
        const lp = createLightPoints(p.lights, this.ctx);
        p.group.add(lp.points);
        this.lightSets.push(lp);
      }
    }
  }

  tick(time: number): void {
    for (const l of this.lightSets) l.uniforms.uTime.value = time;
  }
}

const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

/** Adds a part transformed by a local placement and then by `frame` (sub-assembly transform). */
function addIn(kit: Kit, frame: THREE.Matrix4, key: string, geo: THREE.BufferGeometry, opts: PartOptions = {}): void {
  tmpPos.set(...(opts.position ?? [0, 0, 0]));
  if (opts.quaternion) tmpQuat.copy(opts.quaternion);
  else tmpQuat.setFromEuler(tmpEuler.set(...(opts.rotation ?? [0, 0, 0])));
  const s = opts.scale ?? 1;
  if (typeof s === 'number') tmpScale.setScalar(s);
  else tmpScale.set(...s);
  geo.applyMatrix4(tmpMat.compose(tmpPos, tmpQuat, tmpScale));
  geo.applyMatrix4(frame);
  kit.add(key, geo, { color: opts.color, intensity: opts.intensity, uv: opts.uv });
}

function tp(frame: THREE.Matrix4, p: V3): V3 {
  const v = new THREE.Vector3(...p).applyMatrix4(frame);
  return [v.x, v.y, v.z];
}

function frameAt(pos: V3, dir: V3 = [0, 0, 1], up: V3 = [0, 1, 0]): THREE.Matrix4 {
  const z = new THREE.Vector3(...dir).normalize();
  const upV = new THREE.Vector3(...up);
  const x = new THREE.Vector3().crossVectors(upV, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...pos);
}

/* ------------------------------------------------------------------------------------------------
 * Common components.
 * ---------------------------------------------------------------------------------------------- */

const C = {
  hull: '#d9dcdf',
  hullWarm: '#d8d2c6',
  panel: '#b7bcc2',
  grey: '#8a9098',
  dark: '#3a3f46',
  metal: '#6c737c',
  hazard: '#e0a82e',
  orange: '#c46a2e',
  rust: '#9a5436',
  white: '#eceff1',
  blue: '#2f64c8',
  teal: '#2f8a86',
};

interface Dock {
  point: THREE.Vector3;
  approach: THREE.Vector3;
}

/**
 * Hangar-style docking bay with its opening facing local +Z of `frame`: lit interior strips, a
 * bright outline, port/starboard lights and chase lights along two approach booms.
 */
function dockBay(p: Part, frame: THREE.Matrix4, w: number, h: number, depth: number, hullColor: string = C.hull): Dock {
  const k = p.kit;
  const t = Math.max(2, w * 0.09);
  const zf = depth / 2;
  addIn(k, frame, 'hull', new THREE.BoxGeometry(w + 2 * t, t, depth), { position: [0, h / 2 + t / 2, 0], color: hullColor });
  addIn(k, frame, 'hull', new THREE.BoxGeometry(w + 2 * t, t, depth), { position: [0, -h / 2 - t / 2, 0], color: hullColor });
  addIn(k, frame, 'hull', new THREE.BoxGeometry(t, h, depth), { position: [w / 2 + t / 2, 0, 0], color: hullColor });
  addIn(k, frame, 'hull', new THREE.BoxGeometry(t, h, depth), { position: [-w / 2 - t / 2, 0, 0], color: hullColor });
  addIn(k, frame, 'hull', new THREE.BoxGeometry(w, h, t), { position: [0, 0, -zf + t / 2], color: C.dark });
  // Interior lining so the bay reads as a dark recess, with warm ceiling strips and a lit door seam.
  addIn(k, frame, 'dark', new THREE.BoxGeometry(w * 0.98, 0.3, depth * 0.96), { position: [0, h / 2 - 0.1, 0] });
  addIn(k, frame, 'dark', new THREE.BoxGeometry(w * 0.98, 0.3, depth * 0.96), { position: [0, -h / 2 + 0.1, 0] });
  addIn(k, frame, 'dark', new THREE.BoxGeometry(0.3, h * 0.98, depth * 0.96), { position: [w / 2 - 0.1, 0, 0] });
  addIn(k, frame, 'dark', new THREE.BoxGeometry(0.3, h * 0.98, depth * 0.96), { position: [-w / 2 + 0.1, 0, 0] });
  for (const x of [-w * 0.28, w * 0.28]) {
    addIn(k, frame, 'emissive', new THREE.BoxGeometry(w * 0.08, 0.2, depth * 0.85), { position: [x, h / 2 - 0.35, 0], color: '#ffe3b8', intensity: 1.1 });
  }
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w * 0.05, 0.12, depth * 0.9), { position: [0, -h / 2 + 0.3, 0], color: '#5dffb0', intensity: 0.9 });
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w * 0.7, h * 0.05, 0.3), { position: [0, 0, -zf + t + 0.2], color: '#8fd8ff', intensity: 0.9 });
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w * 0.03, h * 0.7, 0.3), { position: [0, 0, -zf + t + 0.2], color: '#8fd8ff', intensity: 0.6 });
  // Hazard-striped lip and bright outline around the mouth.
  const lip = t * 0.5;
  const n = Math.max(6, Math.round(w / 3));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 - t + ((i + 0.5) * (w + 2 * t)) / n;
    const col = i % 2 === 0 ? C.hazard : '#23262a';
    addIn(k, frame, 'hull', new THREE.BoxGeometry((w + 2 * t) / n, lip, 0.6), { position: [x, h / 2 + t - lip / 2, zf + 0.3], color: col });
    addIn(k, frame, 'hull', new THREE.BoxGeometry((w + 2 * t) / n, lip, 0.6), { position: [x, -h / 2 - t + lip / 2, zf + 0.3], color: col });
  }
  const glowW = 0.28;
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w, glowW, glowW), { position: [0, h / 2 + 0.2, zf + 0.25], color: '#bff0ff', intensity: 1.4 });
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w, glowW, glowW), { position: [0, -h / 2 - 0.2, zf + 0.25], color: '#bff0ff', intensity: 1.4 });
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(glowW, h, glowW), { position: [w / 2 + 0.2, 0, zf + 0.25], color: '#bff0ff', intensity: 1.4 });
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(glowW, h, glowW), { position: [-w / 2 - 0.2, 0, zf + 0.25], color: '#bff0ff', intensity: 1.4 });
  // Approach booms with chase lights running towards the mouth.
  const boomLen = Math.max(24, depth * 1.4);
  const lights = p.lights;
  for (const side of [-1, 1]) {
    const x = side * (w / 2 + t * 0.5);
    const y = -h / 2 - t;
    const a = tp(frame, [x, y, zf]);
    const bb = tp(frame, [x, y, zf + boomLen]);
    rod(k, 'metal', a, bb, Math.max(0.35, t * 0.18), C.metal, 6);
    const count = 6;
    for (let i = 0; i < count; i++) {
      const f = (i + 1) / count;
      lights.push({
        p: tp(frame, [x, y + 0.6, zf + boomLen * f]),
        color: '#ffd27a',
        size: Math.max(2, w * 0.1),
        intensity: 1.8,
        blink: 0.9,
        phase: f * 0.6,
        duty: 0.18,
        min: 0.12,
      });
    }
    lights.push({ p: tp(frame, [x, y + 0.6, zf + boomLen + 0.8]), color: side < 0 ? '#ff3020' : '#30ff70', size: Math.max(2.5, w * 0.13), intensity: 2 });
  }
  lights.push({ p: tp(frame, [-w / 2 - t, 0, zf + 0.6]), color: '#ff3020', size: Math.max(2, w * 0.1), intensity: 1.8 });
  lights.push({ p: tp(frame, [w / 2 + t, 0, zf + 0.6]), color: '#30ff70', size: Math.max(2, w * 0.1), intensity: 1.8 });
  lights.push({ p: tp(frame, [0, h / 2 + t + 0.6, zf]), color: '#ffffff', size: Math.max(2, w * 0.1), intensity: 1.6, blink: 0.5, duty: 0.5, min: 0.4 });
  // Soft interior glow, visible from far away.
  lights.push({ p: tp(frame, [0, 0, zf - depth * 0.3]), color: '#ffdcae', size: w * 0.6, intensity: 0.12 });
  const point = new THREE.Vector3(0, 0, zf + Math.max(8, w * 0.35)).applyMatrix4(frame);
  const approach = new THREE.Vector3(0, 0, 1).transformDirection(frame);
  return { point, approach };
}

/** Cylindrical band around Z (outer or inward-facing) with UVs along the arc. */
function band(radius: number, z0: number, z1: number, seg: number, inward: boolean, uvScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const circ = radius * Math.PI * 2;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const z of [z0, z1]) {
      pos.push(c * radius, s * radius, z);
      nrm.push(inward ? -c : c, inward ? -s : s, 0);
      uv.push(((i / seg) * circ) / uvScale, z / uvScale);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    if (inward) idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    else idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Flat annulus in a z = const plane facing +Z (dir 1) or -Z (dir -1). */
function annulus(r0: number, r1: number, z: number, seg: number, dir: 1 | -1, uvScale: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, seg, 1);
  if (dir < 0) g.rotateY(Math.PI);
  g.translate(0, 0, z);
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, (Math.atan2(y, x) * (r0 + r1)) / 2 / uvScale, Math.hypot(x, y) / uvScale);
  }
  return g;
}

/** Parabolic dish facing +Z, feed mast included. */
function dish(kit: Kit, frame: THREE.Matrix4, radius: number, depth: number, seg: number, color: string): void {
  const prof: [number, number][] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const r = (i / n) * radius;
    prof.push([Math.max(r, 0.001), depth * (r / radius) ** 2]);
  }
  // Front (concave) surface then the back skin, so both sides render.
  const front = latheZ(prof.slice().reverse(), seg);
  addIn(kit, frame, 'hull', front, { color });
  const back = latheZ(prof.map(([r, z]) => [r, z - depth * 0.08] as [number, number]), seg);
  addIn(kit, frame, 'metal', back, { color: C.grey });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    rod(kit, 'metal', tp(frame, [Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.92, depth * 0.95]), tp(frame, [0, 0, radius * 0.75]), radius * 0.025, C.grey, 5);
  }
  addIn(kit, frame, 'metal', new THREE.CylinderGeometry(radius * 0.08, radius * 0.1, radius * 0.2, 8), {
    position: [0, 0, radius * 0.78],
    rotation: [Math.PI / 2, 0, 0],
    color: C.dark,
  });
}

/** Solar wing: a row of cell panels along +X of `frame` on a truss. */
function solarWing(kit: Kit, frame: THREE.Matrix4, length: number, width: number, panels: number): void {
  const gap = length * 0.03;
  const pl = (length - gap * (panels + 1)) / panels;
  beam(kit, 'metal', tp(frame, [0, 0, 0]), tp(frame, [length, 0, 0]), Math.max(0.8, width * 0.04), C.metal);
  for (let i = 0; i < panels; i++) {
    const x = gap + pl / 2 + i * (pl + gap);
    addIn(kit, frame, 'solar', new THREE.BoxGeometry(pl, 0.4, width), { position: [x, 0, 0], uv: Math.max(4, width / 4) });
  }
}

/** Cylindrical pressurised module along +Z of `frame`, with window bands. */
function module(b: StationBuilder, kit: Kit, frame: THREE.Matrix4, radius: number, length: number, color: string, windows = true): void {
  const seg = b.seg;
  addIn(kit, frame, 'hull', latheZ([[radius * 0.7, 0], [radius, radius * 0.25], [radius, length - radius * 0.25], [radius * 0.7, length]], seg), { color });
  for (const z of [length * 0.18, length * 0.82]) {
    addIn(kit, frame, 'metal', new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, radius * 0.2, seg, 1, true), {
      position: [0, 0, z],
      rotation: [Math.PI / 2, 0, 0],
      color: C.dark,
    });
  }
  if (windows) {
    for (const a of [0.35, Math.PI + 0.35]) {
      addIn(kit, frame, 'windows', new THREE.BoxGeometry(radius * 0.12, radius * 0.22, length * 0.5), {
        position: [Math.cos(a) * radius * 1.0, Math.sin(a) * radius * 1.0, length * 0.5],
        rotation: [0, 0, a],
        uv: Math.max(6, radius * 2),
      });
    }
  }
}

function beacon(lights: LightSpec[], p: V3, color = '#ff3a2a', size = 5, blink = 0.7, phase = 0): void {
  lights.push({ p, color, size, intensity: 2.2, blink, phase, duty: 0.14, min: 0.05 });
}

/* ------------------------------------------------------------------------------------------------
 * Halcyon Ring: spun habitat ring, spokes, hub, docking section, solar arrays.
 * ---------------------------------------------------------------------------------------------- */

function earthPort(b: StationBuilder): { dock: Dock; radius: number; tick(time: number): void } {
  const body = b.part('hub');
  const k = body.kit;
  const seg = b.seg;
  // Hub.
  k.add('hull', latheZ([[4, -48], [11, -44], [16, -38], [18, -32], [18, 22], [16, 28], [13, 32]], seg + 6), { color: C.hull });
  for (const z of [-26, -8, 10]) {
    k.add('metal', new THREE.TorusGeometry(18.6, 1.4, 6, seg + 6), { position: [0, 0, z], color: C.dark });
  }
  // Non-rotating collar where the spokes meet the hub.
  k.add('hull', new THREE.CylinderGeometry(24, 24, 10, seg + 6), { rotation: [Math.PI / 2, 0, 0], color: C.panel });
  k.add('windows', band(24.05, -2.5, 2.5, seg + 6, false, 18), { uv: 0 });
  // Docking section on the +Z end.
  const dock = dockBay(body, frameAt([0, 0, 45]), 28, 16, 26);
  k.add('hull', new THREE.BoxGeometry(22, 14, 8), { position: [0, 0, 32], color: C.panel });
  // Solar arrays off the aft end, radiators near the front.
  for (const side of [1, -1]) {
    const f = frameAt([side * 18, 0, -40], [0, 0, 1]);
    f.multiply(new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI));
    solarWing(k, f, 82, 26, 3);
    k.add('radiator', new THREE.BoxGeometry(1, 26, 16), { position: [side * 13, 0, 20], uv: 10 });
  }
  // Antenna mast.
  rod(k, 'metal', [0, 18, -30], [0, 44, -30], 0.8, C.metal);
  dish(k, frameAt([0, 44, -30], [0.3, 0.6, 1]), 7, 2, seg, C.white);
  body.lights.push({ p: [0, 45, -30], color: '#ff3a2a', size: 4, intensity: 2, blink: 0.5, duty: 0.1 });
  for (const side of [1, -1]) beacon(body.lights, [side * 100, 0, -40], '#ffffff', 5, 0.9, side > 0 ? 0 : 0.5);

  // Rotating habitat ring.
  const ringPart = b.part('habitat-ring', body.group, 14);
  const rk = ringPart.kit;
  const R = 138;
  const halfW = 7;
  const halfD = 12;
  const rs = byQuality(b.ctx.quality, 48, 72, 96);
  rk.add('hull', band(R + halfW, -halfD, halfD, rs, false, 14), { uv: 0, color: C.hull });
  rk.add('hull', band(R - halfW, -halfD, halfD, rs, true, 14), { uv: 0, color: C.panel });
  rk.add('hull', annulus(R - halfW, R + halfW, halfD, rs, 1, 14), { uv: 0, color: C.hull });
  rk.add('hull', annulus(R - halfW, R + halfW, -halfD, rs, -1, 14), { uv: 0, color: C.hull });
  rk.add('windows', band(R - halfW - 0.05, -4, 4, rs, true, 20), { uv: 0 });
  rk.add('windows', band(R + halfW + 0.05, 3.5, 7.5, rs, false, 20), { uv: 0 });
  rk.add('windows', band(R + halfW + 0.05, -7.5, -3.5, rs, false, 20), { uv: 0 });
  rk.add('windows', annulus(R - 2.2, R + 2.2, halfD + 0.05, rs, 1, 20), { uv: 0 });
  rk.add('windows', annulus(R - 2.2, R + 2.2, -halfD - 0.05, rs, -1, 20), { uv: 0 });
  // Structural ribs.
  const ribs = 24;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    rk.add('metal', new THREE.BoxGeometry(2.5, halfW * 2 + 2, halfD * 2 + 2), {
      position: [Math.cos(a) * R, Math.sin(a) * R, 0],
      rotation: [0, 0, a],
      color: C.grey,
    });
  }
  // Spokes with elevator pods.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    rod(rk, 'metal', [c * 24, s * 24, 0], [c * (R - halfW), s * (R - halfW), 0], 3, C.grey, 10);
    rod(rk, 'metal', [c * 24, s * 24, 3.6], [c * (R - halfW), s * (R - halfW), 3.6], 0.6, C.dark, 6);
    rk.add('hull', new THREE.BoxGeometry(7, 7, 7), { position: [c * 70, s * 70, 0], rotation: [0, 0, a], color: C.white });
    rk.add('emissive', new THREE.BoxGeometry(7.2, 1.2, 7.2), { position: [c * 70, s * 70, 0], rotation: [0, 0, a], color: '#ffd9a0', intensity: 1.6 });
    beacon(ringPart.lights, [Math.cos(a + Math.PI / 4) * (R + halfW + 1), Math.sin(a + Math.PI / 4) * (R + halfW + 1), 0], '#ff3a2a', 6, 0.6, i * 0.25);
  }
  const ringSpeed = b.ctx.reducedMotion ? 0.035 : 0.05;
  return {
    dock,
    radius: R + halfW + 12,
    tick(time) {
      ringPart.group.rotation.z = time * ringSpeed;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Deimos Depot: industrial truss, fuel tanks, cargo racks, customs beacon.
 * ---------------------------------------------------------------------------------------------- */

function marsDepot(b: StationBuilder): { dock: Dock; radius: number; tick(time: number): void } {
  const body = b.part('depot');
  const k = body.kit;
  const seg = b.seg;
  const bays = byQuality(b.ctx.quality, 10, 16, 20);
  truss(k, 'metal', [-98, 0, 0], [98, 0, 0], 10, bays, C.metal, 0.9);
  // Central hangar block with the bay, command deck on top.
  k.add('hull', new THREE.BoxGeometry(40, 24, 30), { position: [0, 0, 0], color: C.hullWarm });
  k.add('hull', new THREE.BoxGeometry(44, 3, 34), { position: [0, 12, 0], color: C.panel });
  const dock = dockBay(body, frameAt([0, -1, 26]), 26, 14, 22, C.hullWarm);
  k.add('hull', new THREE.BoxGeometry(22, 10, 18), { position: [0, 19, -2], color: C.hullWarm });
  k.add('windows', new THREE.BoxGeometry(22.2, 2.4, 18.2), { position: [0, 20, -2], uv: 16 });
  k.add('hull', new THREE.BoxGeometry(10, 4, 10), { position: [0, 26, -2], color: C.panel });
  // Customs mast.
  truss(k, 'metal', [0, 28, -2], [0, 62, -2], 3, 6, C.grey, 0.4);
  // Fuel tanks (insulated orange / white) above and below the spine.
  const cols = [C.orange, C.white];
  let ci = 0;
  for (const x of [-86, -62, 62, 86]) {
    for (const y of [1, -1]) {
      const col = cols[ci++ % 2]!;
      tank(k, 'hull', [x, y * 17, 0], 'y', 9, 26, col, seg);
      for (const yy of [y * 11, y * 23]) {
        k.add('metal', new THREE.CylinderGeometry(9.3, 9.3, 1.2, seg, 1, true), { position: [x, yy, 0], color: C.dark });
      }
      rod(k, 'metal', [x, y * 5, 0], [x, y * 8, 0], 1.6, C.dark, 8);
    }
  }
  // Cargo racks.
  const cc = ['#b5562c', '#2e7d7a', '#8b949c', '#c9a13a', '#34507a', '#7a3b2e'];
  for (const x0 of [-38, 24]) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        for (const zs of [1, -1]) {
          if (b.rand() < 0.2) continue;
          k.add('hull', new THREE.BoxGeometry(10, 7, 7), {
            position: [x0 + i * 7.2 - 7, -3.5 + j * 7.6, zs * 10],
            rotation: [0, Math.PI / 2, 0],
            color: cc[Math.floor(b.rand() * cc.length)]!,
            uv: 5,
          });
        }
      }
    }
    k.add('metal', new THREE.BoxGeometry(24, 1, 30), { position: [x0, -8, 0], color: C.metal });
    k.add('metal', new THREE.BoxGeometry(24, 1, 30), { position: [x0, 8, 0], color: C.metal });
  }
  // Radiators on the aft side.
  for (const side of [1, -1]) {
    k.add('radiator', new THREE.BoxGeometry(1, 30, 22), { position: [side * 12, 0, -28], uv: 10 });
    k.add('metal', new THREE.BoxGeometry(2, 2, 14), { position: [side * 12, 0, -20], color: C.dark });
  }
  for (const x of [-98, 98]) beacon(body.lights, [x, 7, 0], '#ff3a2a', 6, 0.6, x > 0 ? 0.5 : 0);
  body.lights.push({ p: [0, 30, 14], color: '#ffffff', size: 3, intensity: 1.4 });

  // Rotating customs beacon head.
  const head = b.part('customs-beacon', body.group, 6);
  head.group.position.set(0, 64, -2);
  const hk = head.kit;
  hk.add('hull', new THREE.CylinderGeometry(4, 5, 4, seg), { color: C.hullWarm });
  hk.add('emissive', new THREE.CylinderGeometry(4.1, 4.1, 1.2, seg, 1, true), { color: '#ffb640', intensity: 1.6 });
  hk.add('metal', new THREE.BoxGeometry(16, 0.8, 1.6), { position: [0, 3, 0], color: C.grey });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    head.lights.push({ p: [Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6], color: i % 2 ? '#ffb640' : '#40ff90', size: 5, intensity: 2.2, blink: 0.4, phase: i / 4, duty: 0.3, min: 0.2 });
  }
  head.lights.push({ p: [8, 3.6, 0], color: '#ff3a2a', size: 3, intensity: 1.8 });
  const spin = b.ctx.reducedMotion ? 0.25 : 0.5;
  return {
    dock,
    radius: 112,
    tick(time) {
      head.group.rotation.y = time * spin;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Meridian Outpost: compact research modules, big radiators, scanning sensor dish.
 * ---------------------------------------------------------------------------------------------- */

function proximaOutpost(b: StationBuilder): { dock: Dock; radius: number; tick(time: number): void } {
  const body = b.part('outpost');
  const k = body.kit;
  const seg = b.seg;
  k.add('hull', new THREE.SphereGeometry(10, seg, Math.max(8, seg >> 1)), { color: C.hullWarm });
  const mods: [V3, number][] = [
    [[1, 0, 0], 34],
    [[-1, 0, 0], 28],
    [[0, 1, 0], 20],
    [[0, -1, 0], 18],
    [[0, 0, 1], 30],
  ];
  for (const [dir, len] of mods) {
    const d = new THREE.Vector3(...dir);
    const f = frameAt([d.x * 8, d.y * 8, d.z * 8], dir, Math.abs(dir[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0]);
    module(b, k, f, 6.5, len, C.hullWarm);
    const end = d.clone().multiplyScalar(8 + len + 3);
    k.add('hull', new THREE.SphereGeometry(6, seg, Math.max(8, seg >> 1)), { position: [end.x, end.y, end.z], color: C.panel });
  }
  // Cupola on the top module (warm glass).
  k.add('glassWarm', new THREE.SphereGeometry(5, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2), { position: [0, 38, 0] });
  body.lights.push({ p: [0, 40, 0], color: '#ffb060', size: 9, intensity: 0.8 });
  // Radiator boom and panels (aft).
  truss(k, 'metal', [0, 0, -10], [0, 0, -46], 5, 5, C.metal, 0.5);
  for (const side of [1, -1]) {
    beam(k, 'metal', [0, 0, -44], [side * 86, 0, -44], 2, C.metal);
    for (let i = 0; i < 3; i++) {
      k.add('radiator', new THREE.BoxGeometry(24, 0.8, 30), { position: [side * (14 + i * 25), 0, -44], uv: 12 });
    }
    beacon(body.lights, [side * 88, 1, -44], '#ffffff', 5, 0.8, side > 0 ? 0 : 0.5);
  }
  // Small solar wings on the top module.
  for (const side of [1, -1]) {
    const f = frameAt([0, 24, side * 7], [0, 0, 1]).multiply(new THREE.Matrix4().makeRotationY(side > 0 ? -Math.PI / 2 : Math.PI / 2));
    solarWing(k, f, 34, 12, 2);
  }
  // Warm interior glow strips on every module.
  for (const [dir, len] of mods) {
    const d = new THREE.Vector3(...dir);
    body.lights.push({ p: [d.x * (14 + len / 2), d.y * (14 + len / 2) + (dir[1] === 0 ? 7 : 0), d.z * (14 + len / 2)], color: '#ffb870', size: 6, intensity: 0.7 });
  }
  const dock = dockBay(body, frameAt([0, 0, 52]), 24, 14, 20, C.hullWarm);

  // Scanning sensor dish looking out along -X.
  const dishPart = b.part('sensor-dish', body.group, 8);
  dishPart.group.position.set(-50, 0, 0);
  rod(k, 'metal', [-44, 0, 0], [-50, 0, 0], 2.2, C.metal, 10);
  dish(dishPart.kit, frameAt([-6, 0, 0], [-1, 0, 0]), 20, 5, seg + 4, C.white);
  dishPart.kit.add('metal', new THREE.BoxGeometry(6, 6, 6), { color: C.dark });
  beacon(dishPart.lights, [-10, 20, 0], '#ff3a2a', 4, 0.5, 0.2);
  const scan = b.ctx.reducedMotion ? 0.12 : 0.2;
  return {
    dock,
    radius: 102,
    tick(time) {
      dishPart.group.rotation.y = Math.sin(time * scan) * 0.35;
      dishPart.group.rotation.z = Math.sin(time * scan * 0.7) * 0.15;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Barnard Transit Relay: lattice mast, antenna arrays, fuel spheres, small hab + bay.
 * ---------------------------------------------------------------------------------------------- */

function barnardRelay(b: StationBuilder): { dock: Dock; radius: number; tick(time: number): void } {
  const body = b.part('relay', b.root, 8);
  const k = body.kit;
  const seg = b.seg;
  truss(k, 'metal', [0, -58, 0], [0, 60, 0], 6, byQuality(b.ctx.quality, 10, 16, 20), C.metal, 0.55);
  // Hab module crossing the mast, bay on +Z.
  module(b, k, frameAt([0, 0, -12], [0, 0, 1]), 8, 30, C.hull);
  const dock = dockBay(body, frameAt([0, 0, 28]), 22, 13, 18);
  // Fuel spheres around the mast foot.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 13;
    const z = Math.sin(a) * 13;
    k.add('hull', new THREE.SphereGeometry(8, seg, Math.max(8, seg >> 1)), { position: [x, -42, z], color: i % 2 ? C.white : C.orange });
    k.add('metal', new THREE.TorusGeometry(8.1, 0.6, 5, seg), { position: [x, -42, z], rotation: [Math.PI / 2, 0, 0], color: C.dark });
    rod(k, 'metal', [x * 0.3, -42, z * 0.3], [x * 0.75, -42, z * 0.75], 1.2, C.dark, 6);
    body.lights.push({ p: [x * 1.62, -42, z * 1.62], color: '#ffb640', size: 3, intensity: 1.4, blink: 0.35, phase: i / 4, duty: 0.4, min: 0.25 });
  }
  // Panel antennas mid-mast.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.add('hull', new THREE.BoxGeometry(1, 16, 7), { position: [Math.cos(a) * 7, 30, Math.sin(a) * 7], rotation: [0, -a, 0], color: C.white });
  }
  const f1 = frameAt([4, -18, 0], [0, 0, 1]);
  solarWing(k, f1, 30, 11, 2);
  const f2 = frameAt([-4, -18, 0], [0, 0, 1]).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  solarWing(k, f2, 30, 11, 2);

  // Rotating antenna cluster.
  const top = b.part('antenna-cluster', body.group, 6);
  top.group.position.set(0, 60, 0);
  const tk = top.kit;
  tk.add('hull', new THREE.CylinderGeometry(4, 5, 6, seg), { color: C.hull });
  dish(tk, frameAt([6, 4, 0], [1, 0.35, 0.2]), 7, 2, seg, C.white);
  dish(tk, frameAt([-5, 3, 4], [-0.6, 0.5, 0.8]), 5, 1.4, seg, C.white);
  dish(tk, frameAt([-2, 5, -6], [-0.2, 0.7, -1]), 4, 1.2, seg, C.white);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    rod(tk, 'metal', [0, 3, 0], [Math.cos(a) * 18, 8 + (i % 2) * 6, Math.sin(a) * 18], 0.25, C.grey, 4);
  }
  rod(tk, 'metal', [0, 3, 0], [0, 26, 0], 0.4, C.grey, 5);
  beacon(top.lights, [0, 26.5, 0], '#ff3a2a', 5, 0.55);
  beacon(body.lights, [0, -59, 0], '#ff3a2a', 4, 0.55, 0.5);
  const spin = b.ctx.reducedMotion ? 0.06 : 0.1;
  return {
    dock,
    radius: 72,
    tick(time) {
      top.group.rotation.y = time * spin;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Horizon Platform: armoured shield plate facing +Z (towards Sirius B), body in its shadow,
 * observatory arms reaching past the shield edge. Dock on the shadowed -Z side.
 * ---------------------------------------------------------------------------------------------- */

function siriusPlatform(b: StationBuilder): { dock: Dock; radius: number; tick(time: number): void } {
  const body = b.part('platform', b.root, 14);
  const k = body.kit;
  const seg = b.seg;
  // Shield: layered hexagonal plates, thickest at the centre.
  const hex = (w: number, h: number): [number, number][] => [
    [0, h],
    [w * 0.62, h],
    [w, 0],
    [w * 0.62, -h],
    [0, -h],
    [-w * 0.62, -h],
    [-w, 0],
    [-w * 0.62, h],
  ];
  const layers: [number, number, number, number, string][] = [
    [96, 60, 30, 8, '#8d939b'],
    [88, 54, 38, 6, '#a7adb4'],
    [74, 44, 44, 4, '#c3c2b8'],
  ];
  for (const [w, h, z, th, col] of layers) {
    const shape = new THREE.Shape(hex(w, h).map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.2, bevelSegments: 1 });
    g.translate(0, 0, z - th / 2);
    k.add('hull', g, { color: col, uv: 16 });
  }
  // Armour tiles on the sunward face.
  for (let ix = -3; ix <= 3; ix++) {
    for (let iy = -2; iy <= 2; iy++) {
      if (Math.abs(ix) === 3 && Math.abs(iy) === 2) continue;
      k.add('hull', new THREE.BoxGeometry(17, 15, 1.6), {
        position: [ix * 19 + (iy % 2) * 4, iy * 17, 48.8],
        color: b.rand() < 0.5 ? '#d6d3c8' : '#bdbcb4',
        uv: 18,
      });
    }
  }
  // Station body in the shadow.
  k.add('hull', new THREE.BoxGeometry(56, 30, 36), { position: [0, 0, 6], color: C.hull });
  k.add('windows', new THREE.BoxGeometry(56.2, 3, 36.2), { position: [0, 7, 6], uv: 18 });
  k.add('windows', new THREE.BoxGeometry(56.2, 3, 36.2), { position: [0, -5, 6], uv: 18 });
  for (const side of [1, -1]) {
    module(b, k, frameAt([side * 28, 0, 0], [side, 0, 0], [0, 1, 0]), 8, 22, C.panel);
    k.add('radiator', new THREE.BoxGeometry(1, 22, 30), { position: [side * 20, 26, -2], uv: 10 });
  }
  const dock = dockBay(body, frameAt([0, -2, -24], [0, 0, -1]), 26, 14, 22);

  // Observatory arms with telescope pods that peek past the shield rim towards the star.
  const pods: Part[] = [];
  const arms: [V3, V3][] = [
    [[30, 0, 6], [112, 0, 40]],
    [[-30, 0, 6], [-112, 0, 40]],
    [[0, 16, 6], [0, 80, 42]],
  ];
  for (const [a, e] of arms) {
    truss(k, 'metal', a, e, 4, 8, C.metal, 0.45);
    const pod = b.part('telescope', body.group, 6);
    pod.group.position.set(...e);
    const pk = pod.kit;
    pk.add('hull', latheZ([[4, -6], [5, -4], [5, 12], [4.4, 14]], seg), { color: C.white });
    pk.add('dark', new THREE.CircleGeometry(4.2, seg), { position: [0, 0, 14.05] });
    pk.add('glass', new THREE.CircleGeometry(3.2, seg), { position: [0, 0, 14.1] });
    pk.add('metal', new THREE.BoxGeometry(7, 7, 6), { position: [0, 0, -7], color: C.dark });
    pod.lights.push({ p: [0, 5.6, -2], color: '#ff3a2a', size: 3, intensity: 1.8, blink: 0.45, duty: 0.2, phase: pods.length / 3 });
    pods.push(pod);
  }
  // Shield rim beacons on the shadow side and blue-white work lights.
  for (const [x, y] of [
    [96, 0],
    [-96, 0],
    [59, 60],
    [-59, 60],
    [59, -60],
    [-59, -60],
  ] as const) {
    beacon(body.lights, [x, y, 24], '#ff3a2a', 6, 0.5, (x + y) / 400);
  }
  for (const x of [-20, 20]) body.lights.push({ p: [x, 17, -12], color: '#cfe4ff', size: 6, intensity: 1.2 });
  const pan = b.ctx.reducedMotion ? 0.08 : 0.14;
  return {
    dock,
    radius: 124,
    tick(time) {
      for (let i = 0; i < pods.length; i++) {
        const g = pods[i]!.group;
        g.rotation.x = Math.sin(time * pan + i * 2.1) * 0.12;
        g.rotation.y = Math.sin(time * pan * 0.8 + i) * 0.1;
      }
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Eridani Mining Hub: rig anchored on a rock, ore silos, conveyor arms, spinning drill booms.
 * ---------------------------------------------------------------------------------------------- */

function eridaniHub(b: StationBuilder): { dock: Dock; radius: number; tick(time: number): void } {
  const body = b.part('mining-hub', b.root, 10);
  const k = body.kit;
  const seg = b.seg;
  const rock = rockGeometry(7, {
    detail: byQuality(b.ctx.quality, 2, 3, 3),
    rough: 0.38,
    craters: 7,
    ice: 0.2,
    stretch: [1.25, 0.8, 1.05],
    color: '#8c7a68',
  });
  k.add('rock', rock, { scale: 58, color: undefined });
  // Deck anchored on top of the rock with legs.
  k.add('hull', new THREE.BoxGeometry(76, 5, 54), { position: [0, 50, 0], color: C.hullWarm });
  k.add('metal', new THREE.BoxGeometry(80, 1.5, 58), { position: [0, 47, 0], color: C.metal });
  for (const [x, z] of [
    [30, 20],
    [-30, 20],
    [30, -20],
    [-30, -20],
  ] as const) {
    beam(k, 'metal', [x, 46, z], [x * 0.7, 20, z * 0.7], 3, C.dark);
  }
  // Ore silos.
  for (const [x, z] of [
    [-24, -12],
    [-10, -12],
    [-24, 4],
    [-10, 4],
  ] as const) {
    tank(k, 'hull', [x, 70, z], 'y', 6.5, 36, b.rand() < 0.5 ? '#b4764a' : '#9a9489', seg);
    k.add('metal', new THREE.CylinderGeometry(6.8, 6.8, 1.2, seg, 1, true), { position: [x, 62, z], color: C.dark });
    k.add('metal', new THREE.CylinderGeometry(6.8, 6.8, 1.2, seg, 1, true), { position: [x, 78, z], color: C.dark });
  }
  // Control tower.
  k.add('hull', new THREE.BoxGeometry(16, 22, 14), { position: [22, 63, -8], color: C.hull });
  k.add('windows', new THREE.BoxGeometry(16.2, 3.2, 14.2), { position: [22, 70, -8], uv: 14 });
  k.add('hull', new THREE.BoxGeometry(10, 4, 10), { position: [22, 76, -8], color: C.panel });
  beacon(body.lights, [22, 79, -8], '#ffb640', 6, 0.7);
  // Conveyor arms to processing pods.
  const conveyors: [V3, V3][] = [
    [[38, 50, 6], [122, 26, 24]],
    [[-38, 50, -6], [-112, 18, -34]],
  ];
  for (const [a, e] of conveyors) {
    truss(k, 'metal', a, e, 5, 8, C.metal, 0.5);
    k.add('hull', new THREE.BoxGeometry(14, 12, 14), { position: e, color: C.hullWarm });
    k.add('emissive', new THREE.BoxGeometry(14.2, 1, 14.2), { position: [e[0], e[1] + 3, e[2]], color: '#ffb070', intensity: 1.4 });
    beacon(body.lights, [e[0], e[1] + 7, e[2]], '#ffb640', 5, 0.6, e[0] > 0 ? 0.3 : 0.8);
  }
  const dock = dockBay(body, frameAt([6, 60, 34]), 24, 13, 20, C.hullWarm);
  // Floodlights over the rig and onto the rock face.
  for (const [x, z] of [
    [36, 26],
    [-36, 26],
    [-36, -26],
    [36, -26],
  ] as const) {
    body.lights.push({ p: [x, 54, z], color: '#ffd9a0', size: 8, intensity: 1.0 });
  }

  // Drill rigs on the rock flanks: boom + spinning drill head.
  const drills: THREE.Group[] = [];
  const dirs: V3[] = [
    [1, -0.35, 0.55],
    [-0.85, -0.45, -0.3],
    [0.15, -0.8, -0.7],
  ];
  for (const d of dirs) {
    const n = new THREE.Vector3(...d).normalize();
    const base = n.clone().multiplyScalar(56);
    const out = n.clone().multiplyScalar(80);
    const f = frameAt([out.x, out.y, out.z], [-n.x, -n.y, -n.z]);
    addIn(k, f, 'hull', new THREE.BoxGeometry(12, 8, 10), { color: C.hullWarm });
    beam(k, 'metal', [out.x, out.y, out.z], [base.x, base.y + 20, base.z], 2.5, C.dark);
    body.lights.push({ p: [out.x, out.y + 6, out.z], color: '#ffb640', size: 4, intensity: 1.8, blink: 0.8, duty: 0.3, min: 0.2 });
    const drill = b.part('drill', body.group, 4);
    const dg = drill.group;
    dg.position.copy(n.clone().multiplyScalar(66));
    dg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().negate());
    const dk = drill.kit;
    dk.add('metal', new THREE.CylinderGeometry(2.2, 2.2, 14, 8), { rotation: [Math.PI / 2, 0, 0], position: [0, 0, -4], color: C.grey });
    dk.add('metal', new THREE.ConeGeometry(3.5, 9, 8), { rotation: [Math.PI / 2, 0, 0], position: [0, 0, 7], color: '#8a6a4a' });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      dk.add('metal', new THREE.BoxGeometry(0.8, 1.6, 8), { position: [Math.cos(a) * 3, Math.sin(a) * 3, 5], rotation: [0, 0, a], color: C.dark });
    }
    drills.push(dg);
  }

  // Ore buckets riding the conveyors (one instanced draw call).
  const perArm = byQuality(b.ctx.quality, 4, 6, 8);
  const bucketGeo = new THREE.BoxGeometry(3, 3, 3);
  const bc = new Float32Array(bucketGeo.attributes.position!.count * 3).fill(0.55);
  bucketGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const buckets = new THREE.InstancedMesh(bucketGeo, standardSet(b.ctx.quality).metal!, perArm * conveyors.length);
  buckets.name = 'ore-buckets';
  buckets.frustumCulled = false;
  body.group.add(buckets);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const pA = conveyors.map(([a]) => new THREE.Vector3(...a));
  const pB = conveyors.map(([, e]) => new THREE.Vector3(...e));
  const pos = new THREE.Vector3();
  const drillSpin = b.ctx.reducedMotion ? 0.8 : 1.6;
  const beltSpeed = b.ctx.reducedMotion ? 0.02 : 0.035;
  return {
    dock,
    radius: 134,
    tick(time) {
      for (let i = 0; i < drills.length; i++) {
        const kids = drills[i]!.children;
        for (let j = 0; j < kids.length; j++) kids[j]!.rotation.z = time * drillSpin + i;
      }
      let idx = 0;
      for (let c = 0; c < conveyors.length; c++) {
        for (let i = 0; i < perArm; i++) {
          const t = (time * beltSpeed + i / perArm) % 1;
          pos.lerpVectors(pA[c]!, pB[c]!, t);
          pos.y += 3.2;
          m.compose(pos, q, s);
          buckets.setMatrixAt(idx++, m);
        }
      }
      buckets.instanceMatrix.needsUpdate = true;
    },
  };
}

/* ------------------------------------------------------------------------------------------------ */

const BUILDERS: Record<StationKind, (b: StationBuilder) => { dock: Dock; radius: number; tick(time: number): void }> = {
  'earth-port': earthPort,
  'mars-depot': marsDepot,
  'proxima-outpost': proximaOutpost,
  'barnard-relay': barnardRelay,
  'sirius-platform': siriusPlatform,
  'eridani-hub': eridaniHub,
};

const SEEDS: Record<StationKind, number> = {
  'earth-port': 11,
  'mars-depot': 23,
  'proxima-outpost': 31,
  'barnard-relay': 47,
  'sirius-platform': 59,
  'eridani-hub': 71,
};

/**
 * Procedural station. Every kind has a lit docking bay at `dockPoint` facing `dockApproach`,
 * blinking beacons, and gently moving parts. Note: 'sirius-platform' carries its radiation shield
 * on local +Z, so `object.lookAt(star)` turns the shield towards the star (dock on the shadow side).
 */
export function createStation(kind: StationKind, ctx: ArtContext): StationArt {
  const b = new StationBuilder(`station-${kind}`, ctx, SEEDS[kind]);
  const spec = BUILDERS[kind](b);
  b.finish();
  return {
    object: b.root,
    radius: spec.radius,
    dockPoint: spec.dock.point,
    dockApproach: spec.dock.approach.normalize(),
    update(_dt, time) {
      b.tick(time);
      spec.tick(time);
    },
    dispose: () => disposeObject(b.root),
  };
}

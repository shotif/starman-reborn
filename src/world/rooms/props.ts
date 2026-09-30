import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import type { RoomBuilder } from './builder.ts';
import { MOTION } from './motion.ts';
import type { Motion } from './motion.ts';

/**
 * Reusable props for the interiors, authored in a local frame (+Y up, facing +Z) and placed with a
 * position and yaw. Everything streams into the room's per-material meshes, so props add
 * triangles, not draw calls.
 */

const tmpV = new THREE.Vector3();
const tmpE = new THREE.Euler();

/** Local → world placement (position, yaw, uniform scale). */
export class Frame {
  readonly m = new THREE.Matrix4();
  readonly q = new THREE.Quaternion();
  readonly scale: number;
  readonly ry: number;

  constructor(pos: V3, ry = 0, scale = 1) {
    this.ry = ry;
    this.scale = scale;
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    this.m.compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(scale, scale, scale));
  }

  p(local: V3): V3 {
    tmpV.set(...local).applyMatrix4(this.m);
    return [tmpV.x, tmpV.y, tmpV.z];
  }

  rot(local?: V3): THREE.Quaternion {
    const q = this.q.clone();
    if (local) q.multiply(new THREE.Quaternion().setFromEuler(tmpE.set(...local)));
    return q;
  }

  /** A child frame. */
  sub(local: V3, ry = 0): Frame {
    return new Frame(this.p(local), this.ry + ry, this.scale);
  }
}

export interface PartStyle {
  rot?: V3;
  intensity?: number;
  uv?: number;
}

export function fbox(b: RoomBuilder, f: Frame, key: string, size: V3, local: V3, color: THREE.ColorRepresentation = '#ffffff', o: PartStyle = {}): void {
  const s = f.scale;
  b.boxQ(key, [size[0] * s, size[1] * s, size[2] * s], f.p(local), f.rot(o.rot), color, o.intensity ?? 1, o.uv ?? 4);
}

export function fcyl(
  b: RoomBuilder,
  f: Frame,
  key: string,
  r: number,
  h: number,
  local: V3,
  color: THREE.ColorRepresentation,
  o: PartStyle & { rTop?: number; seg?: number; open?: boolean } = {},
): void {
  const s = f.scale;
  b.cylinder(key, r * s, h * s, { position: f.p(local), quaternion: f.rot(o.rot), color, intensity: o.intensity, uv: o.uv, rTop: (o.rTop ?? r) * s, seg: o.seg, open: o.open });
}

/** Animated box/cylinder helpers. Motion pivots are given in the frame's local space. */
export function mbox(b: RoomBuilder, f: Frame, key: string, size: V3, local: V3, color: THREE.ColorRepresentation, a?: Motion, bm?: Motion, o: PartStyle = {}): void {
  const s = f.scale;
  const pa = a ? { ...a, pivot: f.p(a.pivot) } : undefined;
  const pb = bm ? { ...bm, pivot: f.p(bm.pivot) } : undefined;
  b.boxMotion(key, [size[0] * s, size[1] * s, size[2] * s], f.p(local), f.rot(o.rot), color, o.intensity ?? 1, pa, pb);
}

export function mcyl(
  b: RoomBuilder,
  f: Frame,
  key: string,
  r: number,
  h: number,
  local: V3,
  color: THREE.ColorRepresentation,
  a?: Motion,
  bm?: Motion,
  o: PartStyle & { rTop?: number; seg?: number } = {},
): void {
  const s = f.scale;
  b.cylinder(
    key,
    r * s,
    h * s,
    { position: f.p(local), quaternion: f.rot(o.rot), color, intensity: o.intensity, uv: o.uv, rTop: (o.rTop ?? r) * s, seg: o.seg },
    a ? { ...a, pivot: f.p(a.pivot) } : undefined,
    bm ? { ...bm, pivot: f.p(bm.pivot) } : undefined,
  );
}

/* ------------------------------------------------------------------------------------------------
 * Cargo.
 * ---------------------------------------------------------------------------------------------- */

export type Commodity = 'medical' | 'parts' | 'deuterium' | 'general';

export const COMMODITY_COLORS: Record<Commodity, { body: string; band: string; mark: string }> = {
  medical: { body: '#e6eaee', band: '#23a497', mark: '#23a497' },
  parts: { body: '#d2742c', band: '#3a3d42', mark: '#f0d24a' },
  deuterium: { body: '#2c62c6', band: '#e6ecf2', mark: '#9fd8ff' },
  general: { body: '#8a8f86', band: '#3a3d42', mark: '#d8d2c0' },
};

/** Cargo crate with two bands and a lid rim; size in metres. */
export function crate(b: RoomBuilder, pos: V3, size: V3, body: THREE.ColorRepresentation, band: THREE.ColorRepresentation, ry = 0): void {
  const f = new Frame(pos, ry);
  const [w, h, d] = size;
  fbox(b, f, 'hull', [w, h, d], [0, h / 2, 0], body, { uv: 2 });
  if (!b.low || w > 1.2) {
    fbox(b, f, 'hull', [w + 0.04, h * 0.12, d + 0.04], [0, h * 0.22, 0], band, { uv: 2 });
    fbox(b, f, 'hull', [w + 0.04, h * 0.12, d + 0.04], [0, h * 0.78, 0], band, { uv: 2 });
  }
}

/** Commodity pallet: a pallet stacked with colour-coded crates (or canisters for deuterium). */
export function commodityPallet(b: RoomBuilder, pos: V3, kind: Commodity, ry = 0, layers = 2): void {
  const f = new Frame(pos, ry);
  const col = COMMODITY_COLORS[kind];
  // Pallet.
  fbox(b, f, 'hull', [2.4, 0.14, 2.0], [0, 0.07, 0], '#6a5a44', { uv: 2 });
  for (const x of [-1.0, 0, 1.0]) fbox(b, f, 'hull', [0.2, 0.1, 2.0], [x, 0.19, 0], '#7a6a50', { uv: 2 });
  if (kind === 'deuterium') {
    // Pressure canisters in a frame.
    const n = b.low ? 2 : 3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const x = (i - (n - 1) / 2) * 0.72;
        const z = (j - 0.5) * 0.85;
        fcyl(b, f, 'hull', 0.3, 1.5, [x, 1.0, z], col.body, { seg: 10 });
        fcyl(b, f, 'metal', 0.18, 0.22, [x, 1.86, z], col.band, { seg: 8 });
        fcyl(b, f, 'hull', 0.31, 0.12, [x, 1.2, z], col.band, { seg: 10 });
      }
    }
    fbox(b, f, 'metal', [2.3, 0.1, 0.1], [0, 1.6, 1.0], '#3a3d42');
    fbox(b, f, 'metal', [2.3, 0.1, 0.1], [0, 1.6, -1.0], '#3a3d42');
    for (const x of [-1.12, 1.12]) for (const z of [-1.0, 1.0]) fbox(b, f, 'metal', [0.1, 1.5, 0.1], [x, 0.95, z], '#3a3d42');
    return;
  }
  let y = 0.24;
  for (let l = 0; l < layers; l++) {
    const h = kind === 'medical' ? 0.7 : 0.85;
    const cols = kind === 'medical' ? 3 : 2;
    const w = 2.3 / cols;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < 2; j++) {
        if (l === layers - 1 && b.rand() < 0.2) continue;
        const x = (i - (cols - 1) / 2) * w;
        const z = (j - 0.5) * 0.98;
        crate(b, f.p([x, y, z]), [w - 0.08, h, 0.9], col.body, col.band, ry + (b.rand() - 0.5) * 0.06);
      }
    }
    y += kind === 'medical' ? 0.7 : 0.85;
  }
  // Strapping.
  if (!b.low) {
    fbox(b, f, 'hull', [0.06, y - 0.2, 2.02], [0.35, (y + 0.2) / 2, 0], col.mark);
    fbox(b, f, 'hull', [0.06, y - 0.2, 2.02], [-0.35, (y + 0.2) / 2, 0], col.mark);
  }
}

/** Shipping container (length along local Z) with corrugated sides and door bars. */
export function container(b: RoomBuilder, pos: V3, color: THREE.ColorRepresentation, ry = 0, length = 6.1): void {
  const f = new Frame(pos, ry);
  const w = 2.45;
  const h = 2.6;
  const c = new THREE.Color(color);
  const dark = c.clone().multiplyScalar(0.6);
  fbox(b, f, 'hull', [w, h, length], [0, h / 2, 0], color, { uv: 3 });
  const ribs = b.low ? 4 : Math.round(length / 0.62);
  for (let i = 0; i < ribs; i++) {
    const z = -length / 2 + ((i + 0.5) * length) / ribs;
    for (const side of [-1, 1]) fbox(b, f, 'hull', [0.08, h * 0.88, 0.2], [side * (w / 2 + 0.03), h / 2, z], dark, { uv: 3 });
  }
  // Corner posts and rails.
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-length / 2, length / 2]) fbox(b, f, 'metal', [0.16, h, 0.16], [x, h / 2, z], '#2e3034');
    fbox(b, f, 'metal', [0.14, 0.16, length], [x, h - 0.08, 0], '#2e3034');
    fbox(b, f, 'metal', [0.14, 0.16, length], [x, 0.08, 0], '#2e3034');
  }
  // Door end with locking bars.
  if (!b.low) for (const x of [-0.7, -0.25, 0.25, 0.7]) fbox(b, f, 'metal', [0.05, h * 0.9, 0.06], [x, h / 2, length / 2 + 0.04], '#4a4d52');
}

export function drum(b: RoomBuilder, pos: V3, color: THREE.ColorRepresentation, tipped = false): void {
  const f = new Frame(pos, b.rand() * 6);
  const rot: V3 | undefined = tipped ? [Math.PI / 2, 0, 0] : undefined;
  const y = tipped ? 0.3 : 0.45;
  fcyl(b, f, 'hull', 0.3, 0.9, [0, y, 0], color, { seg: 10, rot });
  if (!b.low) {
    const c = new THREE.Color(color).multiplyScalar(0.7);
    for (const o of [-0.25, 0.25]) {
      const p: V3 = tipped ? [0, y, o] : [0, y + o, 0];
      fcyl(b, f, 'hull', 0.31, 0.05, p, c, { seg: 10, rot });
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Vehicles and machines.
 * ---------------------------------------------------------------------------------------------- */

/** Cargo loader (forklift type) facing local +Z, with a crate on its forks. */
export function loader(b: RoomBuilder, pos: V3, ry: number, paint: string, hazard: [string, string], lamp: string): void {
  const f = new Frame(pos, ry);
  const dark = '#2a2c30';
  fbox(b, f, 'hull', [2.1, 0.9, 3.2], [0, 0.95, -0.2], paint);
  fbox(b, f, 'hull', [2.0, 0.9, 0.8], [0, 1.2, -1.75], dark);
  for (let i = 0; i < 5; i++) fbox(b, f, 'paint', [0.4, 0.02, 0.2], [-0.8 + i * 0.4, 1.66, -1.75], hazard[i % 2]!, { rot: [0, 0.6, 0] });
  // Cab.
  for (const x of [-0.85, 0.85]) {
    for (const z of [-1.2, 0.6]) fbox(b, f, 'metal', [0.1, 1.6, 0.1], [x, 2.2, z], dark);
  }
  fbox(b, f, 'hull', [1.9, 0.12, 2.0], [0, 3.02, -0.3], paint);
  fbox(b, f, 'glass', [1.6, 1.1, 0.04], [0, 2.3, 0.6]);
  fbox(b, f, 'hull', [0.7, 0.8, 0.7], [0, 1.8, -0.6], dark);
  // Mast and forks.
  for (const x of [-0.55, 0.55]) fbox(b, f, 'metal', [0.14, 3.6, 0.18], [x, 1.9, 1.55], '#3a3d42');
  fbox(b, f, 'metal', [1.3, 0.12, 0.14], [0, 3.6, 1.55], '#3a3d42');
  fbox(b, f, 'metal', [1.2, 0.5, 0.1], [0, 1.1, 1.66], '#3a3d42');
  for (const x of [-0.4, 0.4]) fbox(b, f, 'metal', [0.12, 0.06, 1.3], [x, 0.9, 2.3], '#5a5d62');
  crate(b, f.p([0, 0.93, 2.35]), [1.3, 0.9, 1.2], '#d2742c', '#3a3d42', ry);
  // Wheels.
  for (const x of [-1.05, 1.05]) {
    for (const z of [-1.2, 0.9]) fcyl(b, f, 'metal', 0.45, 0.35, [x, 0.45, z], '#1e1f22', { rot: [0, 0, Math.PI / 2], seg: 10 });
  }
  // Beacon and headlights.
  fcyl(b, f, 'emissive', 0.12, 0.18, [0.6, 3.17, -0.9], '#ffb040', { intensity: 2 });
  b.light({ p: f.p([0.6, 3.25, -0.9]), color: '#ffa030', size: 0.9, intensity: 2.2, blink: 0.9, duty: 0.35, min: 0.15 });
  for (const x of [-0.8, 0.8]) {
    fbox(b, f, 'emissive', [0.28, 0.16, 0.04], [x, 1.25, 1.21], lamp, { intensity: 2.2 });
    b.light({ p: f.p([x, 1.25, 1.3]), color: lamp, size: 0.6, intensity: 1.2 });
  }
}

interface TurretPart {
  cyl?: boolean;
  size: V3;
  pos: V3;
  rot?: V3;
  col: string;
  key?: string;
  intensity?: number;
}

/** Armoured twin-barrel turret head (local frame, base at y = 0, barrels towards +Z). */
function turretHead(color: string, accent: string, glow: string): TurretPart[] {
  const dark = '#2c2e33';
  const mid = '#4a4d54';
  const parts: TurretPart[] = [
    // Rotating ring and yoke.
    { cyl: true, size: [0.78, 0.3, 0], pos: [0, 0.15, 0], col: dark },
    { size: [1.25, 0.28, 1.1], pos: [0, 0.42, -0.05], col: color },
    { size: [0.22, 0.85, 0.78], pos: [-0.62, 0.9, -0.05], rot: [0, 0, 0.12], col: color },
    { size: [0.22, 0.85, 0.78], pos: [0.62, 0.9, -0.05], rot: [0, 0, -0.12], col: color },
    // Head: body, sloped glacis, roof, cheek plates, rear bustle.
    { size: [0.98, 0.62, 1.15], pos: [0, 1.12, 0], col: color },
    { size: [0.94, 0.12, 0.62], pos: [0, 1.36, 0.63], rot: [0.55, 0, 0], col: color },
    { size: [0.8, 0.12, 0.95], pos: [0, 1.47, -0.08], col: mid },
    { size: [0.12, 0.5, 1.05], pos: [-0.52, 1.1, 0.02], rot: [0, 0.14, 0], col: accent },
    { size: [0.12, 0.5, 1.05], pos: [0.52, 1.1, 0.02], rot: [0, -0.14, 0], col: accent },
    { size: [0.8, 0.46, 0.45], pos: [0, 1.1, -0.72], col: dark },
    // Ammo box and sensor.
    { size: [0.3, 0.36, 0.5], pos: [0.72, 1.05, -0.25], col: mid },
    { cyl: true, size: [0.09, 0.08, 0], pos: [-0.3, 1.34, 0.72], rot: [Math.PI / 2, 0, 0], col: glow, key: 'emissive', intensity: 3 },
    { size: [0.03, 0.4, 0.03], pos: [0.25, 1.72, -0.45], col: dark },
  ];
  for (const x of [-0.2, 0.2]) {
    parts.push({ size: [0.24, 0.24, 0.5], pos: [x, 1.18, 0.78], col: dark });
    parts.push({ cyl: true, size: [0.07, 1.8, 0], pos: [x, 1.18, 1.75], rot: [Math.PI / 2, 0, 0], col: dark });
    for (const z of [1.15, 1.35, 1.55]) parts.push({ cyl: true, size: [0.11, 0.06, 0], pos: [x, 1.18, z], rot: [Math.PI / 2, 0, 0], col: mid });
    parts.push({ cyl: true, size: [0.1, 0.22, 0], pos: [x, 1.18, 2.65], rot: [Math.PI / 2, 0, 0], col: mid });
  }
  return parts;
}

function emitTurret(b: RoomBuilder, f: Frame, parts: TurretPart[], motion?: Motion): void {
  for (const p of parts) {
    const key = p.key ?? 'metal';
    if (motion) {
      const k = key === 'emissive' ? 'm:emissive' : 'm:metal';
      if (p.cyl) mcyl(b, f, k, p.size[0], p.size[1], p.pos, p.col, motion, undefined, { rot: p.rot, seg: 8, intensity: p.intensity });
      else mbox(b, f, k, p.size, p.pos, p.col, motion, undefined, { rot: p.rot, intensity: p.intensity });
    } else if (p.cyl) {
      fcyl(b, f, key, p.size[0], p.size[1], p.pos, p.col, { rot: p.rot, seg: 8, intensity: p.intensity });
    } else {
      fbox(b, f, key, p.size, p.pos, p.col, { rot: p.rot, intensity: p.intensity });
    }
  }
}

/**
 * Turret: optional plinth and an armoured twin-barrel head. `motion` animates the head
 * ('scan' swings it about its base, 'spin' turns it like a display turntable).
 */
export function turret(
  b: RoomBuilder,
  pos: V3,
  ry: number,
  color: string,
  accent: string,
  opts: { scale?: number; scan?: boolean; spin?: boolean; plinth?: boolean; glow?: string } = {},
): void {
  const s = opts.scale ?? 1;
  const f = new Frame(pos, ry, s);
  const dark = '#2c2e33';
  let y = 0;
  if (opts.plinth ?? true) {
    fcyl(b, f, 'metal', 0.9, 0.5, [0, 0.25, 0], dark, { rTop: 0.8, seg: 8 });
    fcyl(b, f, 'metal', 0.55, 0.5, [0, 0.75, 0], color, { seg: 8 });
    y = 1.0;
  }
  const head = f.sub([0, y, 0]);
  let motion: Motion | undefined;
  if (opts.scan) motion = { type: MOTION.swingY, pivot: [0, 0, 0], speed: 0.23 + b.rand() * 0.1, amp: 0.7, phase: b.rand() * 6 };
  if (opts.spin) motion = { type: MOTION.spin, pivot: [0, 0, 0], speed: 0.22, amp: 0, phase: pos[0] };
  emitTurret(b, head, turretHead(color, accent, opts.glow ?? '#9fe8ff'), motion);
}

/** Shield generator on a plinth: glowing core with counter-rotating rings. */
export function shieldGenerator(b: RoomBuilder, pos: V3, color: string, glow: string, scale = 1): void {
  const f = new Frame(pos, 0, scale);
  fcyl(b, f, 'metal', 0.9, 0.4, [0, 0.2, 0], '#2c2e33', { seg: 12 });
  fcyl(b, f, 'metal', 0.45, 1.6, [0, 1.2, 0], color, { rTop: 0.3, seg: 12 });
  fcyl(b, f, 'emissive', 0.22, 0.9, [0, 1.95, 0], glow, { seg: 12, intensity: 2.6 });
  fcyl(b, f, 'metal', 0.35, 0.2, [0, 2.5, 0], color, { seg: 12 });
  b.light({ p: f.p([0, 1.95, 0]), color: glow, size: 2.6 * scale, intensity: 1.2, blink: 0.25, duty: 0.6, min: 0.55 });
  const rings: [number, number, number, number][] = [
    [0.85, 1.7, 0.55, 0.35],
    [1.05, 2.1, -0.4, 0.6],
  ];
  for (const [r, y, speed, tilt] of rings) {
    const g = new THREE.TorusGeometry(r * scale, 0.05 * scale, 6, b.low ? 20 : 32);
    g.rotateX(Math.PI / 2 + tilt);
    b.addMotion('m:emissive', g, { position: f.p([0, y, 0]), color: glow, intensity: 1.6, a: { type: MOTION.spin, pivot: f.p([0, y, 0]), speed } });
    const g2 = new THREE.TorusGeometry(r * scale, 0.09 * scale, 6, b.low ? 20 : 32);
    g2.rotateX(Math.PI / 2 + tilt);
    b.addMotion('m:metal', g2, { position: f.p([0, y - 0.04, 0]), color: '#3a3d44', a: { type: MOTION.spin, pivot: f.p([0, y, 0]), speed } });
  }
}

/** Small hovering maintenance drone (animated). */
export function drone(b: RoomBuilder, pos: V3, body: string, light: string, phase: number): void {
  const f = new Frame(pos, phase * 2);
  const a: Motion = { type: MOTION.hover, pivot: [0, 0, 0], speed: 0.9 + phase * 0.13, amp: 0.28, phase };
  mbox(b, f, 'm:plain', [0.7, 0.28, 0.7], [0, 0, 0], body, a);
  mbox(b, f, 'm:plain', [0.36, 0.2, 0.36], [0, -0.22, 0], '#2a2c30', a);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(ang) * 0.62;
    const z = Math.sin(ang) * 0.62;
    mbox(b, f, 'm:plain', [0.5, 0.06, 0.08], [x * 0.6, 0.02, z * 0.6], '#3a3c40', a, undefined, { rot: [0, -ang, 0] });
    mcyl(b, f, 'm:emissive', 0.26, 0.03, [x, 0.08, z], light, a, undefined, { seg: 10, intensity: 0.5 });
  }
  mbox(b, f, 'm:emissive', [0.12, 0.08, 0.05], [0, -0.05, 0.36], light, a, undefined, { intensity: 3 });
}

/* ------------------------------------------------------------------------------------------------
 * Fixtures.
 * ---------------------------------------------------------------------------------------------- */

/** A lamp that works, stutters (worn tubes), or has died. */
export type LampState = 'on' | 'flicker' | 'dead';

/** Hanging ceiling lamp bar with its glow and a pool of light on the floor below. */
export function ceilingLamp(b: RoomBuilder, pos: V3, len: number, color: string, level: number, pool = true, ry = 0, floorY = 0, state: LampState = 'on'): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'metal', [len + 0.2, 0.35, 0.9], [0, 0.2, 0], '#2a2c30');
  fbox(b, f, 'emissive', [len, 0.08, 0.6], [0, 0.0, 0], color, { intensity: state === 'dead' ? level * 0.05 : level });
  if (state === 'dead') return;
  const n = Math.max(1, Math.round(len / 2.5));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (len / n);
    // Flickering tubes drop out briefly at uneven rates (two points per lamp beat against each other).
    const flick = state === 'flicker' ? { blink: 1.3 + i * 0.9 + b.rand() * 0.8, duty: 0.86, min: 0.12, phase: b.rand() } : {};
    b.light({ p: f.p([x, -0.15, 0]), color, size: 2.4, intensity: 0.55, ...flick });
  }
  if (pool) {
    const h = pos[1] - floorY;
    b.floorGlow(pos[0], pos[2], len + h * 0.35, h * 0.45, color, 0.05 * level, floorY + 0.03, ry);
  }
}

/** Railing along a straight run (posts, top and mid rails). */
export function railing(b: RoomBuilder, a: V3, c: V3, height: number, color: string, key = 'metal'): void {
  const dx = c[0] - a[0];
  const dz = c[2] - a[2];
  const len = Math.hypot(dx, dz);
  const ry = Math.atan2(dx, dz);
  const n = Math.max(1, Math.round(len / 2));
  const f = new Frame([(a[0] + c[0]) / 2, a[1], (a[2] + c[2]) / 2], ry);
  for (let i = 0; i <= n; i++) {
    const z = -len / 2 + (i * len) / n;
    fbox(b, f, key, [0.07, height, 0.07], [0, height / 2, z], color);
  }
  fbox(b, f, key, [0.08, 0.08, len], [0, height, 0], color);
  fbox(b, f, key, [0.05, 0.05, len], [0, height * 0.5, 0], color);
}

/**
 * Robotic tool arm on a floor base, reaching towards local +Z; the forearm works slowly. With
 * `sparks` the tool tip welds (blinking glows); otherwise it carries a small work light.
 */
export function toolArm(b: RoomBuilder, pos: V3, ry: number, color: string, accent: string, spark: string, opts: { scale?: number; sparks?: boolean } = {}): void {
  const f = new Frame(pos, ry, opts.scale ?? 1);
  const dark = '#2a2c30';
  fcyl(b, f, 'metal', 0.8, 0.5, [0, 0.25, 0], dark, { seg: 10 });
  const base: Motion = { type: MOTION.swingY, pivot: [0, 0, 0], speed: 0.21, amp: 0.25, phase: 0.4 };
  const elbow: Motion = { type: MOTION.swingX, pivot: [0, 3.0, 0.9], speed: 0.33, amp: 0.1, phase: 1.1 };
  mcyl(b, f, 'm:metal', 0.5, 0.6, [0, 0.8, 0], color, base, undefined, { seg: 10 });
  // Upper arm leaning forward.
  mbox(b, f, 'm:metal', [0.42, 2.6, 0.42], [0, 2.0, 0.45], color, base, undefined, { rot: [0.35, 0, 0] });
  mcyl(b, f, 'm:metal', 0.3, 0.6, [0, 3.0, 0.9], dark, base, undefined, { rot: [0, 0, Math.PI / 2], seg: 10 });
  // Forearm reaching down-forward.
  mbox(b, f, 'm:metal', [0.3, 0.3, 2.2], [0, 2.7, 1.9], color, base, elbow, { rot: [0.3, 0, 0] });
  mbox(b, f, 'm:metal', [0.22, 0.5, 0.22], [0, 2.2, 2.9], accent, base, elbow);
  mbox(b, f, 'm:emissive', [0.08, 0.08, 0.08], [0, 1.92, 2.92], spark, base, elbow, { intensity: 4 });
  if (opts.sparks === false) {
    b.light({ p: f.p([0, 1.9, 2.92]), color: spark, size: 0.5 * f.scale, intensity: 1.6 });
    return;
  }
  // Sparks at the tool tip (calm blinking under reduced motion via the light shader).
  for (let i = 0; i < (b.low ? 2 : 4); i++) {
    b.light({ p: f.p([(b.rand() - 0.5) * 0.3, 1.9 - b.rand() * 0.2, 2.92 + (b.rand() - 0.5) * 0.3]), color: spark, size: 0.5 + b.rand() * 0.5, intensity: 3, blink: 2.5 + b.rand() * 3, duty: 0.2, min: 0, phase: b.rand() });
  }
}

import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import { boulder } from './architecture.ts';
import type { RoomBuilder } from './builder.ts';
import { MOTION } from './motion.ts';
import type { Motion } from './motion.ts';
import { Frame, crate, drum, fbox, fcyl, mbox, mcyl } from './props.ts';
import type { HangarLook } from './styles.ts';

/**
 * Set pieces for the generated stations' dressing (dressing.ts): industrial kit, lab and farm
 * furniture, signage and scrap. Authored like props.ts in a local frame (+Y up, facing +Z) and
 * streamed into the room's per-material meshes, so they add triangles, not draw calls.
 */

const DARK = '#2a2c30';
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------------------------------------
 * Mining.
 * ---------------------------------------------------------------------------------------------- */

/** Rail track along Z (two rails on sleepers). */
export function rails(b: RoomBuilder, x: number, z0: number, z1: number, rail: string, sleeper: string): void {
  const len = z1 - z0;
  for (const dx of [-0.55, 0.55]) b.box('metal', [0.1, 0.12, len], [x + dx, 0.14, (z0 + z1) / 2], rail);
  const step = b.low ? 2 : 1.2;
  for (let z = z0 + 0.4; z < z1; z += step) b.box('hull', [1.6, 0.08, 0.26], [x, 0.04, z], sleeper, { uv: 2 });
}

/** Ore cart on the rails, heaped with ore; `glint` adds a few sparkles of crystal. */
export function oreCart(b: RoomBuilder, pos: V3, ry: number, body: string, oreDark: string, oreLight: string, glint?: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'metal', [1.0, 0.25, 1.9], [0, 0.42, 0], DARK);
  fbox(b, f, 'hull', [1.3, 0.8, 2.0], [0, 0.95, 0], body, { uv: 2 });
  for (const s of [-1, 1]) {
    fbox(b, f, 'hull', [0.12, 0.18, 2.1], [s * 0.7, 1.38, 0], body, { rot: [0, 0, s * -0.35] });
    fbox(b, f, 'hull', [1.5, 0.18, 0.12], [0, 1.38, s * 1.04], body, { rot: [s * 0.35, 0, 0] });
  }
  for (const z of [-0.6, 0.6]) for (const s of [-1, 1]) fcyl(b, f, 'metal', 0.26, 0.12, [s * 0.55, 0.3, z], '#1e1f22', { rot: [0, 0, Math.PI / 2], seg: 8 });
  const n = b.low ? 3 : 6;
  for (let i = 0; i < n; i++) {
    const s = 0.28 + b.rand() * 0.22;
    boulder(b, f.p([b.range(-0.4, 0.4), 1.25, b.range(-0.7, 0.7)]), [s, s * 0.8, s], oreDark, oreLight);
  }
  if (glint) {
    for (let i = 0; i < 2; i++) b.light({ p: f.p([b.range(-0.3, 0.3), 1.5, b.range(-0.6, 0.6)]), color: glint, size: 0.35, intensity: 2.2, blink: 0.3, phase: b.rand(), duty: 0.6, min: 0.4 });
  }
}

/** Tripod floodlight aimed along local +Z and down. */
export function workLight(b: RoomBuilder, pos: V3, ry: number, lamp: string, level: number, height = 4.2): void {
  const f = new Frame(pos, ry);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    b.rod('metal', f.p([0, height - 0.6, 0]), f.p([Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1]), 0.05, '#3a3d42', 4);
  }
  fcyl(b, f, 'metal', 0.07, height, [0, height / 2, 0], '#3a3d42', { seg: 6 });
  fbox(b, f, 'metal', [1.3, 0.8, 0.5], [0, height + 0.1, 0.1], DARK, { rot: [0.45, 0, 0] });
  fbox(b, f, 'emissive', [1.1, 0.6, 0.05], [0, height - 0.02, 0.36], lamp, { rot: [0.45, 0, 0], intensity: level * 1.4 });
  b.light({ p: f.p([0, height - 0.1, 0.55]), color: lamp, size: 3.4, intensity: 1.8 });
  const g = f.p([0, 0, height * 1.3]);
  b.floorGlow(g[0], g[2], 7, 9, lamp, 0.22, 0.03, ry);
}

/**
 * A cluster of harsh floodlights on a wall bracket (reaching `reach` back into the wall), aimed along
 * local +Z and down: a wash on the wall below, a cone of light and a pool on the floor.
 */
export function floodlights(b: RoomBuilder, pos: V3, ry: number, lamp: string, level: number, reach = 0.6, n = 3): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'metal', [n * 0.9 + 0.4, 0.22, 1.6 + reach], [0, 0.1, 0.8 - reach / 2], DARK);
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * 0.9;
    fbox(b, f, 'metal', [0.76, 0.6, 0.46], [x, -0.3, 1.2], DARK, { rot: [0.7, 0, 0] });
    fbox(b, f, 'emissive', [0.62, 0.46, 0.04], [x, -0.46, 1.42], lamp, { rot: [0.7, 0, 0], intensity: level * 1.6 });
  }
  b.light({ p: f.p([0, -0.5, 1.6]), color: lamp, size: 4.5, intensity: 2.2 });
  b.glow('pool', f.p([0, -2.6, 0.2]), 6, 6, f.rot(), lamp, 0.3);
  const floor = f.p([0, -pos[1], Math.min(9, pos[1] * 0.7)]);
  b.shaft(f.p([0, -0.6, 1.5]), [floor[0], 0.2, floor[2]], 3.4, lamp, 0.1);
  b.floorGlow(floor[0], floor[2], 8, 9, lamp, 0.22, 0.03, ry);
}

/* ------------------------------------------------------------------------------------------------
 * Refinery.
 * ---------------------------------------------------------------------------------------------- */

/** Vertical storage tank with a domed top, bands, a ladder and a lit gauge. */
export function tank(b: RoomBuilder, pos: V3, r: number, h: number, body: string, band: string, glow: string): void {
  const f = new Frame(pos, 0);
  const seg = b.low ? 10 : b.high ? 20 : 16;
  fcyl(b, f, 'hull', r, h, [0, h / 2 + 0.4, 0], body, { seg, uv: 3 });
  const dome = new THREE.SphereGeometry(r, seg, b.low ? 4 : 6, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add('hull', dome, { position: f.p([0, h + 0.4, 0]), color: body, uv: 3 });
  fcyl(b, f, 'metal', r + 0.25, 0.4, [0, 0.2, 0], DARK, { seg });
  for (const y of [h * 0.3, h * 0.72]) fcyl(b, f, 'metal', r + 0.06, 0.4, [0, y, 0], band, { seg });
  // Ladder up the front.
  for (const dx of [-0.3, 0.3]) fbox(b, f, 'metal', [0.06, h, 0.06], [dx, h / 2 + 0.4, r + 0.25], '#4a4d52');
  if (!b.low) for (let y = 1; y < h; y += 0.6) fbox(b, f, 'metal', [0.6, 0.04, 0.04], [0, y, r + 0.25], '#4a4d52');
  fcyl(b, f, 'emissive', 0.22, 0.05, [r * 0.55, 1.8, r * 0.84], glow, { rot: [Math.PI / 2, 0, 0.6], seg: 10, intensity: 1.8 });
  b.light({ p: f.p([r * 0.6, 1.8, r * 0.92]), color: glow, size: 0.6, intensity: 1.4 });
  b.light({ p: f.p([0, h + 0.4 + r, 0]), color: '#ff3a2a', size: 0.7, intensity: 2, blink: 0.4, duty: 0.25, min: 0.05, phase: pos[0] * 0.1 });
}

/** Horizontal tank along local Z on two saddles. */
export function hTank(b: RoomBuilder, pos: V3, ry: number, r: number, len: number, body: string, band: string): void {
  const f = new Frame(pos, ry);
  const seg = b.low ? 10 : 16;
  fcyl(b, f, 'hull', r, len, [0, r + 0.5, 0], body, { rot: [Math.PI / 2, 0, 0], seg, uv: 3 });
  for (const s of [-1, 1]) {
    const cap = new THREE.SphereGeometry(r, seg, b.low ? 3 : 5, 0, Math.PI * 2, 0, Math.PI / 2);
    b.add('hull', cap, { position: f.p([0, r + 0.5, (s * len) / 2]), quaternion: f.rot([(s * Math.PI) / 2, 0, 0]), color: body, uv: 3 });
    fbox(b, f, 'metal', [r * 1.6, r + 0.4, 0.5], [0, (r + 0.4) / 2, s * len * 0.3], DARK);
    fcyl(b, f, 'metal', r + 0.05, 0.3, [0, r + 0.5, s * len * 0.3], band, { rot: [Math.PI / 2, 0, 0], seg });
  }
}

/** Pipe between two points with flanges every `every` metres. */
export function pipe(b: RoomBuilder, a: V3, c: V3, r: number, color: string, flange: string, every = 5): void {
  b.rod('metal', a, c, r, color, b.low ? 6 : 10);
  const dir = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = dir.length();
  if (len < 0.01 || b.low) return;
  dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  for (let d = every / 2; d < len; d += every) {
    b.cylinder('metal', r * 1.35, 0.22, { position: [a[0] + dir.x * d, a[1] + dir.y * d, a[2] + dir.z * d], quaternion: q, color: flange, seg: b.low ? 6 : 10 });
  }
}

/** Valve hand wheel facing local +Z. */
export function valveWheel(b: RoomBuilder, pos: V3, ry: number, r: number, color: string): void {
  const f = new Frame(pos, ry);
  b.add('metal', new THREE.TorusGeometry(r, r * 0.12, 4, 12), { position: pos, quaternion: f.rot(), color });
  for (let k = 0; k < 3; k++) fbox(b, f, 'metal', [r * 2, 0.05, 0.05], [0, 0, 0], color, { rot: [0, 0, (k * Math.PI) / 3] });
}

/** Floor vent glowing from the heat below (grille bars over an emissive bed). */
export function hotVent(b: RoomBuilder, pos: V3, ry: number, w: number, d: number, heat: string, frame: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'emissive', [w, 0.05, d], [0, 0.03, 0], heat, { intensity: 1.6 });
  fbox(b, f, 'metal', [w + 0.4, 0.14, 0.2], [0, 0.07, d / 2 + 0.1], frame);
  fbox(b, f, 'metal', [w + 0.4, 0.14, 0.2], [0, 0.07, -d / 2 - 0.1], frame);
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.36) fbox(b, f, 'metal', [0.08, 0.1, d], [x, 0.08, 0], frame);
  b.floorGlow(pos[0], pos[2], w * 2.4, d * 2.8, heat, 0.3, 0.1, ry);
}

/* ------------------------------------------------------------------------------------------------
 * Factory.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Conveyor along Z from z0 to z1 at x: frame, belt and rollers, housings at both ends (the goods
 * vanish into them), and a stream of boxes riding the belt.
 */
export function conveyor(b: RoomBuilder, x: number, z0: number, z1: number, frame: string, housing: string, goods: string[], speed: number, lamp: string): void {
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  const top = 1.0;
  for (const dx of [-0.8, 0.8]) b.box('metal', [0.12, 0.32, len], [x + dx, top - 0.06, zc], frame);
  b.box('dark', [1.5, 0.08, len], [x, top - 0.02, zc]);
  for (let z = z0 + 1; z < z1; z += 2.5) {
    for (const dx of [-0.75, 0.75]) b.box('metal', [0.1, top - 0.2, 0.1], [x + dx, (top - 0.2) / 2, z], frame);
  }
  if (!b.low) for (let z = z0 + 0.3; z < z1; z += 0.7) b.cyl('metal', 0.07, 1.5, [x, top - 0.1, z], '#50545a', { rot: [0, 0, Math.PI / 2], seg: 6 });
  for (const [z, s] of [
    [z0, -1],
    [z1, 1],
  ] as const) {
    const f = new Frame([x, 0, z], 0);
    fbox(b, f, 'hull', [2.4, 2.8, 2.0], [0, 1.4, 0], housing, { uv: 2 });
    fbox(b, f, 'dark', [1.7, 1.1, 0.08], [0, 1.35, -s * 1.02], '#000');
    for (let i = 0; i < 6; i++) fbox(b, f, 'paint', [0.4, 0.22, 0.05], [-1.0 + i * 0.4, 2.1, -s * 1.03], i % 2 ? '#262b33' : '#e3b62e', { rot: [0, 0, 0.6] });
    fbox(b, f, 'emissive', [0.3, 0.12, 0.05], [0.8, 2.5, -s * 1.03], lamp, { intensity: 2.4 });
    b.light({ p: f.p([0.8, 2.5, -s * 1.15]), color: lamp, size: 0.5, intensity: 1.8, blink: 0.8, duty: 0.5, min: 0.3, phase: z * 0.1 });
  }
  const n = Math.max(3, Math.round(len / (b.low ? 3.2 : 2.2)));
  for (let i = 0; i < n; i++) {
    const a: Motion = { type: MOTION.conveyZ, pivot: [0, 0, 0], speed, amp: len, phase: (i / n) * len };
    const w = 0.7 + b.rand() * 0.4;
    const hh = 0.45 + b.rand() * 0.35;
    const f = new Frame([x, top + hh / 2 + 0.02, zc], b.range(-0.2, 0.2));
    mbox(b, f, 'm:matte', [w, hh, w], [0, 0, 0], b.pick(goods), a);
    mbox(b, f, 'm:matte', [w + 0.02, 0.08, w + 0.02], [0, hh * 0.2, 0], '#2e3034', a);
  }
}

/**
 * Overhead conveyor along Z: an I-beam rail hung from the roof, with crates and motor housings
 * riding past on hooks (they come round again at the far end).
 */
export function overheadConveyor(b: RoomBuilder, x: number, y: number, z0: number, z1: number, rail: string, goods: string[], speed: number, roof: number): void {
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  b.box('metal', [0.6, 0.14, len], [x, y + 0.34, zc], rail);
  b.box('metal', [0.14, 0.6, len], [x, y, zc], rail);
  b.box('metal', [0.6, 0.14, len], [x, y - 0.34, zc], rail);
  for (let z = z0 + 2; z < z1; z += 8) b.rod('metal', [x, y + 0.4, z], [x, roof, z], 0.06, rail, 4);
  const n = Math.max(4, Math.round(len / (b.low ? 6 : 4)));
  for (let i = 0; i < n; i++) {
    const a: Motion = { type: MOTION.conveyZ, pivot: [0, 0, 0], speed, amp: len, phase: (i / n) * len };
    const f = new Frame([x, y - 0.45, zc], 0);
    mbox(b, f, 'm:matte', [0.36, 0.22, 0.5], [0, 0, 0], DARK, a);
    mbox(b, f, 'm:matte', [0.07, 1.4, 0.07], [0, -0.8, 0], DARK, a);
    if (i % 2) {
      // A motor housing with its end cap.
      mcyl(b, f, 'm:matte', 0.45, 1.2, [0, -1.95, 0], b.pick(goods), a, undefined, { rot: [0, 0, Math.PI / 2], seg: 10 });
      mcyl(b, f, 'm:matte', 0.3, 0.2, [0.7, -1.95, 0], DARK, a, undefined, { rot: [0, 0, Math.PI / 2], seg: 10 });
    } else {
      const hh = 0.6 + b.rand() * 0.5;
      mbox(b, f, 'm:matte', [0.9 + b.rand() * 0.5, hh, 0.8 + b.rand() * 0.4], [0, -1.5 - hh / 2, 0], b.pick(goods), a);
    }
  }
}

/**
 * Safety railing box around a work cell (posts and rails, open on the x0 side); a tall one is a
 * cage, with bars all round.
 */
export function safetyCage(b: RoomBuilder, x0: number, z0: number, x1: number, z1: number, color: string, height = 1.1): void {
  const tall = height > 1.5;
  const post = (x: number, z: number): void => b.box('metal', [0.12, height, 0.12], [x, height / 2, z], color);
  const rail = (a: [number, number], c: [number, number]): void => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ry = Math.atan2(c[0] - a[0], c[1] - a[1]);
    for (const y of tall ? [0.12, height * 0.5, height - 0.05] : [0.55, 1.05]) b.box('metal', [0.06, 0.06, len], [(a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2], color, { ry });
    if (!tall) return;
    const n = Math.floor(len / (b.low ? 1.2 : 0.6));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      b.box('metal', [0.04, height - 0.1, 0.04], [a[0] + (c[0] - a[0]) * t, height / 2, a[1] + (c[1] - a[1]) * t], '#6a6e75');
    }
  };
  for (const [a, c] of [
    [
      [x0, z0],
      [x1, z0],
    ],
    [
      [x1, z0],
      [x1, z1],
    ],
    [
      [x1, z1],
      [x0, z1],
    ],
  ] as [number, number][][]) {
    rail(a!, c!);
    post(a![0], a![1]);
  }
  post(x0, z1);
}

/* ------------------------------------------------------------------------------------------------
 * Farms and labs.
 * ---------------------------------------------------------------------------------------------- */

const GREENS = ['#3f8a3a', '#5aa83a', '#2e6a32', '#7ab84a', '#4a9a5a'];
const FRUIT = ['#d8402a', '#f0a030', '#e8d040', '#b83a6a'];

/** Shelving of leafy greens under alternating green and magenta grow lights. */
export function hydroponicRack(b: RoomBuilder, h: HangarLook, x: number, z: number, ry: number): void {
  const f = new Frame([x, 0, z], ry);
  for (let lvl = 0; lvl < 4; lvl++) {
    const y = 0.6 + lvl * 1.35;
    fbox(b, f, 'metal', [5.6, 0.1, 1.2], [0, y, 0], h.trim);
    fbox(b, f, 'hull', [5.4, 0.25, 1.0], [0, y + 0.15, 0], '#3a3028');
    for (let p = 0; p < (b.low ? 5 : 7); p++) {
      const leaf = new THREE.IcosahedronGeometry(0.28 + b.rand() * 0.12, 0);
      b.add('plain', leaf, { position: f.p([-2.4 + p * (4.8 / (b.low ? 4 : 6)), y + 0.5, (b.rand() - 0.5) * 0.3]), color: b.pick(['#3f8a3a', '#5aa83a', '#2e6a32', '#7ab84a']), scale: [1, 0.8 + b.rand() * 0.6, 1] });
    }
    fbox(b, f, 'emissive', [5.4, 0.05, 0.2], [0, y + 1.15, 0], lvl % 2 ? '#e070ff' : '#7dffa6', { intensity: 2.2 });
  }
  for (const sx of [-2.8, 2.8]) fbox(b, f, 'metal', [0.12, 5.8, 0.12], [sx, 2.9, 0.55], h.trim);
  b.glow('pool', f.p([0, 3, 0.9]), 6, 6, f.rot(), '#9aff9a', 0.28);
  b.floorGlow(f.p([0, 0, 1.6])[0], f.p([0, 0, 1.6])[2], 6, 3, '#9aff9a', 0.3, 0.03, ry);
  b.light({ p: f.p([0, 3, 0.8]), color: '#b07aff', size: 2.2, intensity: 0.18 });
}

/** Raised planter bed along local Z with rows of crops and a grow-light bar above. */
export function planterBed(b: RoomBuilder, pos: V3, ry: number, len: number, box: string, light: string, fruit: boolean): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [1.9, 0.7, len], [0, 0.35, 0], box, { uv: 2 });
  fbox(b, f, 'plain', [1.7, 0.06, len - 0.2], [0, 0.71, 0], '#3a2a1e');
  const step = b.low ? 0.9 : 0.55;
  for (let z = -len / 2 + 0.35; z < len / 2 - 0.2; z += step) {
    for (const dx of [-0.45, 0.45]) {
      const s = 0.22 + b.rand() * 0.14;
      const leaf = new THREE.IcosahedronGeometry(s, 0);
      b.add('plain', leaf, { position: f.p([dx + b.range(-0.08, 0.08), 0.8 + s * 0.5, z]), color: b.pick(GREENS), scale: [1, 0.8 + b.rand() * 0.7, 1] });
      if (fruit && b.rand() < 0.35) {
        b.add('plain', new THREE.IcosahedronGeometry(0.09, 0), { position: f.p([dx + b.range(-0.15, 0.15), 0.95 + s, z + b.range(-0.1, 0.1)]), color: b.pick(FRUIT) });
      }
    }
  }
  // Grow-light bar on two posts.
  for (const s of [-1, 1]) fbox(b, f, 'metal', [0.08, 2.4, 0.08], [0.95, 1.2, (s * len) / 2 - s * 0.3], '#4a4d52');
  fbox(b, f, 'metal', [0.3, 0.12, len - 0.4], [0.5, 2.45, 0], '#3a3d42');
  fbox(b, f, 'emissive', [0.22, 0.05, len - 0.6], [0.5, 2.38, 0], light, { intensity: 2.4 });
  b.floorGlow(f.p([0, 0, 0])[0], f.p([0, 0, 0])[2], 2.6, len, light, 0.3, 0.76, ry);
  b.light({ p: f.p([0.5, 2.3, -len / 4]), color: light, size: 1.6, intensity: 0.6 });
  b.light({ p: f.p([0.5, 2.3, len / 4]), color: light, size: 1.6, intensity: 0.6 });
}

/** Lab bench with instruments, sample trays and a small angled display. */
export function labBench(b: RoomBuilder, pos: V3, ry: number, top: string, body: string, holo: string, glow: string, seed: number): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [2.6, 0.9, 0.9], [0, 0.45, 0], body, { uv: 2 });
  fbox(b, f, 'gloss', [2.8, 0.06, 1.0], [0, 0.93, 0], top);
  // Microscope, centrifuge, tube rack.
  fcyl(b, f, 'metal', 0.16, 0.08, [-0.9, 1.0, 0.1], DARK, { seg: 8 });
  fbox(b, f, 'metal', [0.08, 0.5, 0.12], [-0.9, 1.26, -0.05], '#d8dce2', { rot: [0.3, 0, 0] });
  fcyl(b, f, 'metal', 0.06, 0.26, [-0.9, 1.45, 0.08], DARK, { seg: 6, rot: [0.5, 0, 0] });
  fcyl(b, f, 'hull', 0.24, 0.26, [-0.25, 1.09, 0.15], '#e8ecf0', { seg: 10 });
  fcyl(b, f, 'emissive', 0.12, 0.02, [-0.25, 1.23, 0.15], glow, { seg: 10, intensity: 1.6 });
  fbox(b, f, 'metal', [0.6, 0.06, 0.25], [0.45, 1.0, 0.25], '#8a8f96');
  if (!b.low) for (let i = 0; i < 6; i++) fcyl(b, f, 'emissive', 0.025, 0.14, [0.22 + i * 0.09, 1.1, 0.25], i % 2 ? glow : '#9affc8', { seg: 5, intensity: 1.4 });
  // Angled display.
  fbox(b, f, 'metal', [0.06, 0.4, 0.06], [0.95, 1.15, -0.3], DARK);
  fbox(b, f, 'dark', [0.95, 0.6, 0.05], [0.95, 1.45, -0.3], '#000', { rot: [-0.25, 0, 0] });
  b.holo(seed % 2 ? 'chart' : 'scope', seed, f.p([0.95, 1.45, -0.26]), 0.88, 0.52, holo, 1.4, ry, -0.25);
  b.light({ p: f.p([0.95, 1.45, -0.1]), color: holo, size: 0.9, intensity: 0.5 });
}

/** Glass-fronted sample cabinet: shelves of glowing vials. */
export function sampleRack(b: RoomBuilder, pos: V3, ry: number, frame: string, vials: string[]): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [1.5, 2.5, 0.7], [0, 1.25, 0], frame, { uv: 2 });
  fbox(b, f, 'dark', [1.3, 2.2, 0.05], [0, 1.3, 0.31], '#000');
  for (let s = 0; s < 4; s++) {
    const y = 0.45 + s * 0.52;
    fbox(b, f, 'metal', [1.28, 0.03, 0.4], [0, y, 0.1], '#8a8f96');
    const n = b.low ? 4 : 7;
    for (let i = 0; i < n; i++) {
      if (b.rand() < 0.15) continue;
      fcyl(b, f, 'emissive', 0.045, 0.22, [-0.5 + (i * 1.0) / (n - 1), y + 0.13, 0.12], b.pick(vials), { seg: 5, intensity: 0.8 + b.rand() * 1.2 });
    }
  }
  fbox(b, f, 'glass', [1.34, 2.24, 0.03], [0, 1.3, 0.36]);
  fbox(b, f, 'emissive', [1.3, 0.05, 0.05], [0, 2.44, 0.36], vials[0]!, { intensity: 1.6 });
  b.light({ p: f.p([0, 1.4, 0.6]), color: vials[0]!, size: 1.8, intensity: 0.45 });
}

/** Cryo canister (white cylinder with a glowing band) standing on the floor. */
export function cryoCanister(b: RoomBuilder, pos: V3, r: number, body: string, glow: string): void {
  b.cyl('hull', r, 1.6, [pos[0], 0.8, pos[2]], body, { seg: b.low ? 8 : 12 });
  b.cyl('metal', r * 0.7, 0.25, [pos[0], 1.72, pos[2]], '#8a8f96', { seg: 8 });
  b.cyl('emissive', r + 0.01, 0.08, [pos[0], 1.1, pos[2]], glow, { seg: b.low ? 8 : 12, intensity: 1.8, open: true });
}

/* ------------------------------------------------------------------------------------------------
 * Relays and comms.
 * ---------------------------------------------------------------------------------------------- */

/** Tall comms/equipment rack with rows of blinking status lights. */
export function commsRack(b: RoomBuilder, pos: V3, ry: number, body: string, glow: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [1.0, 2.5, 0.9], [0, 1.25, 0], body, { uv: 2 });
  fbox(b, f, 'dark', [0.84, 2.2, 0.04], [0, 1.3, 0.46], '#000');
  for (let r = 0; r < 6; r++) {
    fbox(b, f, 'emissive', [0.6, 0.03, 0.02], [0, 0.45 + r * 0.36, 0.49], glow, { intensity: 0.8 });
    const cols = ['#4aff8a', '#ffb040', '#ff3a2a', glow];
    for (let k = 0; k < (b.low ? 1 : 2); k++) {
      b.light({ p: f.p([-0.3 + k * 0.25 + b.rand() * 0.1, 0.55 + r * 0.36, 0.52]), color: b.pick(cols), size: 0.18, intensity: 2.4, blink: 0.4 + b.rand() * 2.4, duty: 0.5, min: 0.1, phase: b.rand() });
    }
  }
  fcyl(b, f, 'metal', 0.12, 0.8, [0.3, 2.9, -0.2], '#1e1f22', { seg: 6 });
}

/* ------------------------------------------------------------------------------------------------
 * Military.
 * ---------------------------------------------------------------------------------------------- */

/** Hanging banner facing local +Z with a border and an emblem. */
export function banner(b: RoomBuilder, pos: V3, ry: number, w: number, h: number, field: string, trim: string, emblem: 'ring' | 'chevron' | 'wake' | 'star'): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'metal', [w + 0.6, 0.16, 0.16], [0, h / 2 + 0.1, 0], '#3a3d42');
  fbox(b, f, 'plain', [w, h, 0.05], [0, 0, 0], field, { uv: 2 });
  for (const s of [-1, 1]) fbox(b, f, 'plain', [0.2, h, 0.06], [s * (w / 2 - 0.2), 0, 0.01], trim);
  // Swallowtail at the foot.
  for (const s of [-1, 1]) fbox(b, f, 'plain', [w / 2, 0.9, 0.05], [(s * w) / 4, -h / 2 - 0.35, 0], field, { rot: [0, 0, s * 0.35] });
  const c = f.p([0, h * 0.12, 0.05]);
  const e = new Frame(c, ry);
  const s = Math.min(w, h) * 0.3;
  switch (emblem) {
    case 'ring':
      b.add('plain', new THREE.TorusGeometry(s, s * 0.16, 4, 20), { position: c, quaternion: e.rot(), color: trim });
      fbox(b, e, 'plain', [s * 2.6, s * 0.28, 0.03], [0, 0, 0.02], trim);
      break;
    case 'chevron':
      for (const k of [0, 1]) for (const d of [-1, 1]) fbox(b, e, 'plain', [s * 1.2, s * 0.28, 0.03], [d * s * 0.42, k * s * 0.7 - s * 0.3, 0.02], trim, { rot: [0, 0, d * 0.62] });
      break;
    case 'wake':
      for (let k = 0; k < 4; k++) fbox(b, e, 'plain', [s * 0.8, s * 0.22, 0.03], [(k - 1.5) * s * 0.52, (k % 2 ? 0.2 : -0.2) * s, 0.02], trim, { rot: [0, 0, k % 2 ? -0.75 : 0.75] });
      break;
    case 'star':
      for (let k = 0; k < 4; k++) fbox(b, e, 'plain', [s * 0.3, s * 1.9, 0.03], [0, 0, 0.02], trim, { rot: [0, 0, (k * Math.PI) / 4] });
      break;
  }
}

/** Wall rack of rifles over a locker. */
export function weaponRack(b: RoomBuilder, pos: V3, ry: number, frame: string, gun: string, accent: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [3.4, 1.0, 0.7], [0, 0.5, 0], frame, { uv: 2 });
  fbox(b, f, 'metal', [3.4, 2.2, 0.12], [0, 2.1, -0.28], frame);
  for (const y of [1.3, 2.9]) fbox(b, f, 'metal', [3.3, 0.1, 0.35], [0, y, -0.1], '#3a3d42');
  const guns = b.low ? 4 : 7;
  for (let i = 0; i < guns; i++) {
    const x = -1.35 + (i * 2.7) / (guns - 1);
    fbox(b, f, 'metal', [0.1, 1.5, 0.12], [x, 2.05, -0.05], gun);
    fbox(b, f, 'metal', [0.16, 0.45, 0.14], [x, 1.45, -0.05], gun);
    if (!b.low) fbox(b, f, 'metal', [0.12, 0.2, 0.14], [x, 2.35, 0.02], accent);
  }
  fbox(b, f, 'emissive', [0.3, 0.08, 0.04], [1.3, 0.8, 0.36], '#4aff8a', { intensity: 2 });
}

/** Missile on a two-saddle cradle, nose towards local +Z. */
export function missile(b: RoomBuilder, pos: V3, ry: number, body: string, band: string, len = 3.2, scale = 1): void {
  const f = new Frame(pos, ry, scale);
  for (const z of [-len * 0.3, len * 0.3]) fbox(b, f, 'metal', [0.9, 0.4, 0.3], [0, 0.2, z], DARK);
  const y = 0.62;
  fcyl(b, f, 'hull', 0.26, len, [0, y, 0], body, { rot: [Math.PI / 2, 0, 0], seg: 10 });
  fcyl(b, f, 'hull', 0.01, 0.7, [0, y, len / 2 + 0.35], body, { rot: [Math.PI / 2, 0, 0], rTop: 0.26, seg: 10 });
  fcyl(b, f, 'hull', 0.27, 0.2, [0, y, len * 0.18], band, { rot: [Math.PI / 2, 0, 0], seg: 10 });
  for (let k = 0; k < 4; k++) fbox(b, f, 'metal', [0.04, 0.7, 0.5], [0, y, -len / 2 + 0.3], DARK, { rot: [0, 0, (k * Math.PI) / 4 + Math.PI / 4] });
}

/* ------------------------------------------------------------------------------------------------
 * Freeports.
 * ---------------------------------------------------------------------------------------------- */

export type NeonShape = 'ring' | 'arrow' | 'bars' | 'zigzag' | 'cup' | 'star' | 'glyphs';

/** Neon tube sign facing local +Z, with a glow behind it; `flicker` makes it stutter. */
export function neonSign(b: RoomBuilder, shape: NeonShape, pos: V3, ry: number, size: number, color: string, flicker = false): void {
  const f = new Frame(pos, ry, size);
  const t = 0.07;
  const tube = (w: number, x: number, y: number, rz: number): void => fbox(b, f, 'emissive', [w, t, t], [x, y, 0.05], color, { rot: [0, 0, rz], intensity: 2.6 });
  switch (shape) {
    case 'ring':
      b.add('emissive', new THREE.TorusGeometry(size * 0.5, t * size * 0.6, 4, 24), { position: f.p([0, 0, 0.05]), quaternion: f.rot(), color, intensity: 2.6 });
      tube(0.5, 0, 0, 0);
      break;
    case 'arrow':
      tube(1.2, -0.1, 0, 0);
      tube(0.5, 0.35, 0.16, -0.75);
      tube(0.5, 0.35, -0.16, 0.75);
      break;
    case 'bars':
      for (let i = 0; i < 3; i++) tube(1.2 - i * 0.25, 0, (i - 1) * 0.3, 0);
      break;
    case 'zigzag':
      for (let i = 0; i < 4; i++) tube(0.45, (i - 1.5) * 0.32, 0, i % 2 ? -0.9 : 0.9);
      break;
    case 'cup':
      tube(0.6, 0, -0.35, 0);
      tube(0.7, -0.3, 0, Math.PI / 2);
      tube(0.7, 0.3, 0, Math.PI / 2);
      b.add('emissive', new THREE.TorusGeometry(size * 0.16, t * size * 0.5, 4, 10, Math.PI), { position: f.p([0.3, 0.05, 0.05]), quaternion: f.rot([0, 0, -Math.PI / 2]), color, intensity: 2.6 });
      break;
    case 'star':
      for (let k = 0; k < 4; k++) tube(1.0, 0, 0, (k * Math.PI) / 4);
      break;
    case 'glyphs':
      for (let i = 0; i < 5; i++) {
        tube(0.22, (i - 2) * 0.3, 0.14, Math.PI / 2);
        if (b.rand() < 0.7) tube(0.2, (i - 2) * 0.3 + 0.08, b.rand() < 0.5 ? 0.26 : 0, 0);
      }
      break;
  }
  const back = f.p([0, 0, -0.02]);
  b.glow('pool', back, size * 2.4, size * 1.8, f.rot(), color, 0.35);
  b.light({ p: f.p([0, 0, 0.3]), color, size: size * 1.4, intensity: 0.9, ...(flicker ? { blink: 2.3 + b.rand() * 2, duty: 0.88, min: 0.15, phase: b.rand() } : {}) });
}

/** Spray-painted tag on a wall facing local +Z: overlapping strokes and a bubble outline. */
export function graffiti(b: RoomBuilder, pos: V3, ry: number, size: number, colors: string[]): void {
  const f = new Frame(pos, ry, size);
  const fill = b.pick(colors);
  const line = b.pick(colors.filter((c) => c !== fill).concat(['#f0f0f0']));
  const n = b.low ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.42;
    fbox(b, f, 'paint', [0.34, 0.8 + b.rand() * 0.3, 0.02], [x, b.range(-0.08, 0.08), 0], fill, { rot: [0, 0, b.range(-0.3, 0.3)] });
    fbox(b, f, 'paint', [0.08, 0.95, 0.025], [x + 0.16, 0, 0.005], line, { rot: [0, 0, b.range(-0.4, 0.4)] });
  }
  fbox(b, f, 'paint', [n * 0.44 + 0.3, 0.1, 0.025], [0, -0.55, 0.004], line, { rot: [0, 0, b.range(-0.1, 0.1)] });
}

/** Market stall: counter, awning, goods, a hanging lamp. */
export function stall(b: RoomBuilder, pos: V3, ry: number, awning: string, counter: string, goods: string[], lamp: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [3.0, 1.0, 1.1], [0, 0.5, 0.2], counter, { uv: 2 });
  fbox(b, f, 'hull', [3.2, 0.06, 1.2], [0, 1.03, 0.2], '#8a6a4a', { uv: 2 });
  for (const sx of [-1.5, 1.5]) for (const sz of [-0.5, 0.9]) fbox(b, f, 'metal', [0.07, sz < 0 ? 2.8 : 2.4, 0.07], [sx, sz < 0 ? 1.4 : 1.2, sz], '#4a4d52');
  fbox(b, f, 'plain', [3.3, 0.06, 1.8], [0, 2.6, 0.25], awning, { rot: [-0.28, 0, 0] });
  for (let i = 0; i < 5; i++) fbox(b, f, 'plain', [0.62, 0.3, 0.04], [-1.3 + i * 0.65, 2.3, 1.13], i % 2 ? awning : '#e8e0d0', { rot: [-0.1, 0, 0] });
  for (let i = 0; i < (b.low ? 3 : 6); i++) {
    const s = 0.2 + b.rand() * 0.2;
    fbox(b, f, 'plain', [s, s, s], [-1.1 + i * 0.44, 1.06 + s / 2, 0.2 + b.range(-0.2, 0.2)], b.pick(goods), { rot: [0, b.rand(), 0] });
  }
  fcyl(b, f, 'emissive', 0.12, 0.2, [0, 2.2, 0.3], lamp, { seg: 8, intensity: 2.4 });
  b.light({ p: f.p([0, 2.1, 0.3]), color: lamp, size: 1.4, intensity: 1.2 });
  b.floorGlow(f.p([0, 0, 1])[0], f.p([0, 0, 1])[2], 3.6, 3, lamp, 0.25, 0.03, ry);
}

/** Sofa facing local +Z. */
export function sofa(b: RoomBuilder, pos: V3, ry: number, color: string, seats = 3): void {
  const f = new Frame(pos, ry);
  const w = seats * 0.7;
  fbox(b, f, 'fabric', [w, 0.42, 0.85], [0, 0.26, 0], color, { uv: 1 });
  fbox(b, f, 'fabric', [w, 0.6, 0.22], [0, 0.72, -0.34], color, { uv: 1 });
  for (const s of [-1, 1]) fbox(b, f, 'fabric', [0.2, 0.62, 0.85], [s * (w / 2 + 0.08), 0.33, 0], new THREE.Color(color).multiplyScalar(0.85), { uv: 1 });
}

/* ------------------------------------------------------------------------------------------------
 * Pirate dens.
 * ---------------------------------------------------------------------------------------------- */

/** A heap of scrap: plates, beams and pipe ends piled in a mound. */
export function scrapPile(b: RoomBuilder, pos: V3, radius: number, height: number, colors: string[]): void {
  const n = Math.round((b.low ? 8 : 16) * (radius / 2.5));
  for (let i = 0; i < n; i++) {
    const a = b.rand() * Math.PI * 2;
    const d = Math.sqrt(b.rand()) * radius;
    const y = Math.max(0.1, height * (1 - d / radius) * (0.4 + b.rand() * 0.6));
    const p: V3 = [pos[0] + Math.cos(a) * d, y * 0.6, pos[2] + Math.sin(a) * d];
    const c = b.pick(colors);
    if (b.rand() < 0.2) {
      b.cyl('metal', b.range(0.12, 0.3), b.range(0.8, 2), p, c, { rot: [b.rand() * 3, 0, b.rand() * 3], seg: 7 });
    } else {
      b.box(b.rand() < 0.5 ? 'hull' : 'metal', [b.range(0.5, 2.2), b.range(0.06, 0.5), b.range(0.4, 1.6)], p, c, { rot: [b.range(-0.8, 0.8), b.rand() * 3, b.range(-0.8, 0.8)], uv: 2 });
    }
  }
}

/** Oil drum burning inside: embers, flickering firelight and a warm pool on the floor. */
export function fireBarrel(b: RoomBuilder, pos: V3, body: string): void {
  drum(b, pos, body);
  const f = new Frame(pos, 0);
  fcyl(b, f, 'emissive', 0.27, 0.05, [0, 0.9, 0], '#ff6a1a', { seg: 10, intensity: 2.2 });
  for (let i = 0; i < (b.low ? 2 : 4); i++) {
    b.add('emissive', new THREE.IcosahedronGeometry(0.08 + b.rand() * 0.07, 0), { position: f.p([b.range(-0.15, 0.15), 0.96 + b.rand() * 0.1, b.range(-0.15, 0.15)]), color: b.pick(['#ffb040', '#ff7a2a', '#ffd070']), intensity: 2.4 });
  }
  b.glow('shaft', f.p([0, 1.5, 0]), 0.9, 1.3, [0, Math.PI / 4, Math.PI], '#ff8a3a', 0.5);
  b.glow('shaft', f.p([0, 1.5, 0]), 0.9, 1.3, [0, -Math.PI / 4, Math.PI], '#ff8a3a', 0.5);
  for (let i = 0; i < 3; i++) {
    b.light({ p: f.p([b.range(-0.1, 0.1), 1.2 + i * 0.25, b.range(-0.1, 0.1)]), color: i ? '#ff8a3a' : '#ffc060', size: 1.2 - i * 0.2, intensity: 2.2, blink: 2.1 + i * 1.7, duty: 0.7, min: 0.45, phase: b.rand() });
  }
  b.floorGlow(pos[0], pos[2], 5.5, 5.5, '#ff7a2a', 0.45);
}

/** Old tyre lying flat (makeshift seat). */
export function tyre(b: RoomBuilder, pos: V3, stacked = 1): void {
  for (let i = 0; i < stacked; i++) {
    const g = new THREE.TorusGeometry(0.42, 0.17, 5, 12);
    g.rotateX(Math.PI / 2);
    b.add('metal', g, { position: [pos[0], 0.17 + i * 0.32, pos[2]], color: '#1c1a19' });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Customs.
 * ---------------------------------------------------------------------------------------------- */

/** Walk-through scanner arch over a walkway, facing local ±Z, with a sweeping scan line. */
export function scannerArch(b: RoomBuilder, pos: V3, ry: number, w: number, h: number, frame: string, glow: string): void {
  const f = new Frame(pos, ry);
  for (const s of [-1, 1]) {
    fbox(b, f, 'hull', [0.6, h, 0.9], [s * (w / 2 + 0.3), h / 2, 0], frame, { uv: 2 });
    fbox(b, f, 'emissive', [0.06, h - 0.6, 0.5], [s * (w / 2 + 0.02), h / 2, 0], glow, { intensity: 2.2 });
  }
  fbox(b, f, 'hull', [w + 1.2, 0.7, 0.9], [0, h + 0.35, 0], frame, { uv: 2 });
  fbox(b, f, 'emissive', [w, 0.06, 0.5], [0, h - 0.02, 0], glow, { intensity: 2.2 });
  const a: Motion = { type: MOTION.bob, pivot: [0, 0, 0], speed: 1.1, amp: h / 2 - 0.4, phase: pos[2] };
  mbox(b, f, 'm:emissive', [w - 0.1, 0.05, 0.05], [0, h / 2, 0], glow, a, undefined, { intensity: 3 });
  b.holo('curtain', 0, f.p([0, h / 2, 0]), w, h - 0.2, glow, 0.3, ry);
  b.light({ p: f.p([w / 2 + 0.3, h + 0.85, 0]), color: '#4aff8a', size: 0.5, intensity: 2.2, blink: 0.5, duty: 0.7, min: 0.3 });
  b.light({ p: f.p([-w / 2 - 0.3, h + 0.85, 0]), color: '#ff3a2a', size: 0.5, intensity: 2.2, blink: 0.5, duty: 0.3, min: 0.1, phase: 0.5 });
}

/** Short bollard with a reflective band. */
export function bollard(b: RoomBuilder, pos: V3, color: string, band: string): void {
  b.cyl('metal', 0.14, 0.9, [pos[0], 0.45, pos[2]], color, { seg: 8 });
  b.cyl('metal', 0.145, 0.12, [pos[0], 0.7, pos[2]], band, { seg: 8 });
}

/* ------------------------------------------------------------------------------------------------
 * Shipyards.
 * ---------------------------------------------------------------------------------------------- */

/**
 * A hull section under construction lying along local X: exposed ribs and stringers at one end,
 * plating over the rest, and a dark interior.
 */
export function hullSection(b: RoomBuilder, pos: V3, ry: number, r: number, len: number, hull: string, rib: string, plated: number, floodlit = false): void {
  const f = new Frame(pos, ry);
  const seg = b.low ? 12 : 20;
  const ribs = b.low ? 6 : 10;
  // Big hulls get heavier frames, so the ribs still read from across the hall.
  const tube = Math.max(0.18, r * 0.045);
  for (let i = 0; i <= ribs; i++) {
    const x = -len / 2 + (i * len) / ribs;
    const g = new THREE.TorusGeometry(r, tube, 4, seg);
    g.rotateY(Math.PI / 2);
    b.add('metal', g, { position: f.p([x, 0, 0]), quaternion: f.rot(), color: rib });
  }
  for (let k = 0; k < (b.low ? 6 : 10); k++) {
    const a = (k / (b.low ? 6 : 10)) * Math.PI * 2;
    fbox(b, f, 'metal', [len, 0.16, 0.16], [0, Math.sin(a) * (r - 0.05), Math.cos(a) * (r - 0.05)], rib, { rot: [-a, 0, 0] });
  }
  // Plating: a shell over the first `plated` share of the length.
  const pl = len * plated;
  const shell = new THREE.CylinderGeometry(r + 0.12, r + 0.12, pl, seg, 1, true, 0, Math.PI * 2);
  shell.rotateZ(Math.PI / 2);
  litFromAbove(shell, hull);
  b.add(floodlit ? 'hullLit' : 'hull', shell, { position: f.p([-len / 2 + pl / 2, 0, 0]), quaternion: f.rot(), uv: 3 });
  const inner = new THREE.CylinderGeometry(r - 0.2, r - 0.2, len, seg, 1, true);
  inner.rotateZ(Math.PI / 2);
  inner.scale(1, -1, 1);
  b.add('dark', inner, { position: f.p([0, 0, 0]), quaternion: f.rot() });
}

/**
 * Paints `color` over a shape with the hall's overhead lamps baked in: bright on top, in shadow
 * underneath, so a big curved hull reads as round rather than as a flat block.
 */
function litFromAbove(g: THREE.BufferGeometry, color: string): void {
  const base = new THREE.Color(color);
  const n = g.attributes.normal!;
  const col = new Float32Array(n.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const up = 0.5 + 0.5 * n.getY(i);
    c.copy(base).multiplyScalar(0.15 + 1.1 * up * up);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Stand holding a curved hull plate for welding. */
export function plateJig(b: RoomBuilder, pos: V3, ry: number, frame: string, plate: string): void {
  const f = new Frame(pos, ry);
  for (const s of [-1, 1]) {
    fbox(b, f, 'metal', [0.15, 2.4, 0.15], [s * 1.4, 1.2, -0.5], frame, { rot: [0.25, 0, 0] });
    fbox(b, f, 'metal', [0.15, 2.4, 0.15], [s * 1.4, 1.2, 0.5], frame, { rot: [-0.25, 0, 0] });
  }
  fbox(b, f, 'metal', [3.2, 0.16, 0.16], [0, 2.3, 0], frame);
  const g = new THREE.CylinderGeometry(3, 3, 2.6, b.low ? 6 : 10, 1, true, -0.5, 1);
  g.rotateZ(Math.PI / 2);
  b.add('hull', g, { position: f.p([0, -0.2, 0.2]), quaternion: f.rot([0.15, 0, 0]), color: plate, uv: 3 });
}

/* ------------------------------------------------------------------------------------------------
 * General.
 * ---------------------------------------------------------------------------------------------- */

/** Planter box with a small tree (concourse greenery). */
export function pottedTree(b: RoomBuilder, pos: V3, pot: string, scale = 1): void {
  const f = new Frame(pos, b.rand() * 6, scale);
  fbox(b, f, 'hull', [1.3, 0.8, 1.3], [0, 0.4, 0], pot, { uv: 2 });
  fbox(b, f, 'plain', [1.1, 0.05, 1.1], [0, 0.81, 0], '#3a2a1e');
  fcyl(b, f, 'plain', 0.1, 1.8, [0, 1.7, 0], '#5a4030', { seg: 6 });
  for (let i = 0; i < (b.low ? 3 : 5); i++) {
    const s = (0.55 + b.rand() * 0.35) * scale;
    b.add('plain', new THREE.IcosahedronGeometry(s, 0), { position: f.p([b.range(-0.4, 0.4), 2.5 + b.rand() * 0.8, b.range(-0.4, 0.4)]), color: b.pick(GREENS) });
  }
}

/** Bench facing local +Z. */
export function bench(b: RoomBuilder, pos: V3, ry: number, seat: string, frame: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [2.4, 0.08, 0.5], [0, 0.46, 0], seat, { uv: 2 });
  fbox(b, f, 'hull', [2.4, 0.5, 0.08], [0, 0.8, -0.24], seat, { uv: 2 });
  for (const s of [-1, 1]) fbox(b, f, 'metal', [0.08, 0.46, 0.46], [s * 1.0, 0.23, 0], frame);
}

/** Cargo tug towing a flatbed of crates along local +Z; `motion` drives it up and down a lane. */
export function cargoTug(b: RoomBuilder, pos: V3, ry: number, paint: string, crates: string[], motion?: Motion): void {
  const f = new Frame(pos, ry);
  const box = (size: V3, local: V3, color: string, key = 'm:metal'): void => {
    if (motion) mbox(b, f, key, size, local, color, motion);
    else fbox(b, f, key.replace('m:', ''), size, local, color);
  };
  const wheel = (local: V3): void => {
    if (motion) mcyl(b, f, 'm:metal', 0.3, 0.22, local, '#1e1f22', motion, undefined, { rot: [0, 0, Math.PI / 2], seg: 8 });
    else fcyl(b, f, 'metal', 0.3, 0.22, local, '#1e1f22', { rot: [0, 0, Math.PI / 2], seg: 8 });
  };
  box([1.4, 0.7, 1.6], [0, 0.65, 1.6], paint);
  box([1.2, 0.8, 0.5], [0, 1.3, 1.25], DARK);
  box([1.3, 0.06, 1.0], [0, 1.95, 1.5], paint);
  box([0.3, 0.12, 0.04], [0, 0.8, 2.42], '#fff2c8', motion ? 'm:emissive' : 'emissive');
  for (const s of [-1, 1]) {
    wheel([s * 0.72, 0.3, 2.0]);
    wheel([s * 0.72, 0.3, 1.1]);
    wheel([s * 0.72, 0.3, -1.4]);
  }
  box([1.5, 0.2, 2.8], [0, 0.55, -1.0], '#3a3d42');
  for (let i = 0; i < 3; i++) box([0.7, 0.6, 0.7], [i % 2 ? 0.35 : -0.35, 0.95, -1.9 + i * 0.85], b.pick(crates), 'm:plain');
}

/** Open-topped produce crate, heaped. */
export function produceCrate(b: RoomBuilder, pos: V3, ry: number, wood: string, produce: string[]): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'hull', [1.1, 0.08, 0.8], [0, 0.04, 0], wood, { uv: 2 });
  for (const s of [-1, 1]) {
    fbox(b, f, 'hull', [1.1, 0.5, 0.06], [0, 0.29, s * 0.37], wood, { uv: 2 });
    fbox(b, f, 'hull', [0.06, 0.5, 0.8], [s * 0.52, 0.29, 0], wood, { uv: 2 });
  }
  const col = b.pick(produce);
  for (let i = 0; i < (b.low ? 3 : 7); i++) {
    b.add('plain', new THREE.IcosahedronGeometry(0.13 + b.rand() * 0.05, 0), { position: f.p([b.range(-0.38, 0.38), 0.5 + b.rand() * 0.12, b.range(-0.25, 0.25)]), color: col });
  }
}

/** A clutter of drums and crates around a point. */
export function clutterAt(b: RoomBuilder, pos: V3, spread: number, n: number, colors: string[], band: string): void {
  for (let i = 0; i < n; i++) {
    const p: V3 = [pos[0] + b.range(-spread, spread), 0, pos[2] + b.range(-spread, spread)];
    if (b.rand() < 0.5) drum(b, p, b.pick(colors), b.rand() < 0.15);
    else {
      const s = b.range(0.8, 1.5);
      crate(b, p, [s, s * 0.8, s], b.pick(colors), band, b.rand() * 3);
    }
  }
}

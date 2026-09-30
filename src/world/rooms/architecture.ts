import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import type { RoomBuilder } from './builder.ts';
import { hazardBand } from './builder.ts';
import { HALL } from './layout.ts';
import { MOTION } from './motion.ts';
import { Frame, ceilingLamp, fbox, fcyl, mbox } from './props.ts';
import type { HangarLook } from './styles.ts';

/**
 * Architecture variants for generated stations: wall finishes (raw rock, armour plate, clean lab
 * cladding, mismatched patches, welded scrap), a low ceiling of ducts for cramped stations, and
 * the extra pillar and bay-mouth kinds. The hand-built stations never reach this code, so their
 * rooms are unchanged.
 */

/* ------------------------------------------------------------------------------------------------
 * Noise and rock.
 * ---------------------------------------------------------------------------------------------- */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Three octaves of value noise, 0..1. */
export function fbm2(x: number, y: number, seed: number): number {
  return (noise2(x, y, seed) * 4 + noise2(x * 2.1, y * 2.1, seed + 7) * 2 + noise2(x * 4.3, y * 4.3, seed + 13)) / 7;
}

export interface RockFaceSpec {
  /** Corner of the face; `u` and `v` span it (unit vectors), displacement goes along `n`. */
  origin: V3;
  u: V3;
  v: V3;
  n: V3;
  w: number;
  h: number;
  /** Grid cell size (metres). */
  cell: number;
  /** Deepest bulge towards `n`. */
  depth: number;
  /** Dark (recesses) and light (bulges) rock colours. */
  dark: string;
  light: string;
  seed: number;
  /** Cells whose centre falls in one of these [u0, v0, u1, v1] rectangles are left out. */
  holes?: [number, number, number, number][];
  /** Multiplier on the depth at (u, v) (keep clear of pipes, doors). */
  depthAt?: (u: number, v: number) => number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/**
 * A faceted rock surface: a jittered grid pushed out by fractal noise, one colour per facet (darker
 * in the recesses, banded like strata). Flat-shaded by the rock material.
 */
export function rockFace(b: RoomBuilder, s: RockFaceSpec): void {
  const nu = Math.max(1, Math.round(s.w / s.cell));
  const nv = Math.max(1, Math.round(s.h / s.cell));
  const du = s.w / nu;
  const dv = s.h / nv;
  const pts: number[][] = [];
  const disp: number[][] = [];
  for (let i = 0; i <= nu; i++) {
    pts.push([]);
    disp.push([]);
    for (let j = 0; j <= nv; j++) {
      const edgeU = i === 0 || i === nu;
      const edgeV = j === 0 || j === nv;
      const ju = edgeU ? 0 : (hash2(i, j, s.seed + 3) - 0.5) * du * 0.6;
      const jv = edgeV ? 0 : (hash2(i, j, s.seed + 5) - 0.5) * dv * 0.6;
      const uu = i * du + ju;
      const vv = j * dv + jv;
      // Broad bulges plus a jagged per-vertex chip, so neighbouring facets tilt against each other.
      const f = fbm2(uu * 0.16, vv * 0.16, s.seed) * 0.7 + hash2(i, j, s.seed + 23) * 0.3;
      const k = s.depthAt ? s.depthAt(uu, vv) : 1;
      const d = s.depth * k * (0.08 + 0.92 * f) * (edgeU || edgeV ? 0.4 : 1);
      disp[i]!.push(d);
      pts[i]!.push(
        s.origin[0] + s.u[0] * uu + s.v[0] * vv + s.n[0] * d,
        s.origin[1] + s.u[1] * uu + s.v[1] * vv + s.n[1] * d,
        s.origin[2] + s.u[2] * uu + s.v[2] * vv + s.n[2] * d,
      );
    }
  }
  const dark = new THREE.Color(s.dark);
  const light = new THREE.Color(s.light);
  const col = new THREE.Color();
  // Baked light from above and in front of the face, so the facets read even in dim halls.
  const key = new THREE.Vector3(s.n[0] * 0.55, 0.8 + s.n[1] * 0.3, s.n[2] * 0.55).normalize();
  const pos: number[] = [];
  const nrm: number[] = [];
  const cols: number[] = [];
  const P = (i: number, j: number): [number, number, number] => {
    const a = pts[i]!;
    return [a[j * 3]!, a[j * 3 + 1]!, a[j * 3 + 2]!];
  };
  const tri = (a: [number, number, number], c: [number, number, number], e: [number, number, number], shade: number): void => {
    tmpA.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    tmpB.set(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
    tmpN.crossVectors(tmpA, tmpB).normalize();
    // Wind every facet to face along `n` (front faces are counter-clockwise).
    const flip = tmpN.x * s.n[0] + tmpN.y * s.n[1] + tmpN.z * s.n[2] < 0;
    if (flip) tmpN.negate();
    col.copy(dark).lerp(light, Math.max(0, Math.min(1, shade)));
    const lit = Math.max(0, tmpN.dot(key));
    col.multiplyScalar(0.3 + 1.25 * lit * lit);
    for (const p of flip ? [a, e, c] : [a, c, e]) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(tmpN.x, tmpN.y, tmpN.z);
      cols.push(col.r, col.g, col.b);
    }
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const cu = (i + 0.5) * du;
      const cv = (j + 0.5) * dv;
      if (s.holes?.some(([u0, v0, u1, v1]) => cu > u0 && cu < u1 && cv > v0 && cv < v1)) continue;
      const d = (disp[i]![j]! + disp[i + 1]![j]! + disp[i]![j + 1]! + disp[i + 1]![j + 1]!) / (4 * Math.max(0.01, s.depth));
      // Strata: bands by height along v, plus per-facet variation; recesses darker.
      const band = 0.5 + 0.5 * Math.sin(cv * 0.9 + noise2(cu * 0.05, cv * 0.2, s.seed + 11) * 5);
      const base = 0.1 + d * 0.75 + band * 0.2;
      tri(P(i, j), P(i + 1, j), P(i + 1, j + 1), base + (hash2(i, j, s.seed + 17) - 0.5) * 0.35);
      tri(P(i, j), P(i + 1, j + 1), P(i, j + 1), base + (hash2(i, j, s.seed + 19) - 0.5) * 0.35);
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  b.add('rock', g, { uv: 4 });
}

/** A boulder: a squashed, jittered icosahedron with per-facet colour. */
export function boulder(b: RoomBuilder, pos: V3, size: V3, dark: string, light: string, detail = 0): void {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position!;
  const seed = Math.floor(b.rand() * 1e6);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.78 + 0.44 * hash2(Math.round(x * 100), Math.round(y * 100) + Math.round(z * 37), seed);
    p.setXYZ(i, x * k * size[0], Math.max(-0.35, y) * k * size[1], z * k * size[2]);
  }
  g.computeVertexNormals();
  const c0 = new THREE.Color(dark);
  const c1 = new THREE.Color(light);
  const cols = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let f = 0; f < p.count; f += 3) {
    col.copy(c0).lerp(c1, 0.25 + b.rand() * 0.6);
    for (let k = 0; k < 3; k++) cols.set([col.r, col.g, col.b], (f + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  b.add('rock', g, { position: [pos[0], pos[1] + size[1] * 0.3, pos[2]], rotation: [0, b.rand() * 6.28, 0] });
}

/* ------------------------------------------------------------------------------------------------
 * Wall finishes.
 * ---------------------------------------------------------------------------------------------- */

/** Side doors (see buildWalls): [side, z, width, height]. */
const DOORS: [number, number, number, number][] = [
  [-1, 24, 9, 7.5],
  [1, 22, 11, 8],
];

/** Bays between the wall ribs: centre z of each clear panel (ribs sit every 8 m from back + 6). */
function wallBays(): number[] {
  const out: number[] = [];
  for (let z = HALL.back + 6; z < HALL.front - 1; z += 8) if (z + 4 < HALL.front - 1) out.push(z + 4);
  return out;
}

function nearDoor(side: number, z: number, margin: number): boolean {
  return DOORS.some(([s, dz, w]) => s === side && Math.abs(z - dz) < w / 2 + margin);
}

export function wallFinish(b: RoomBuilder, h: HangarLook): void {
  switch (h.walls) {
    case 'rock':
      rockWalls(b, h);
      break;
    case 'armour':
      armourWalls(b, h);
      break;
    case 'clean':
      cleanWalls(b, h);
      break;
    case 'patched':
      patchedWalls(b, h);
      break;
    case 'scrap':
      scrapWalls(b, h);
      break;
    default:
      break;
  }
}

function rockWalls(b: RoomBuilder, h: HangarLook): void {
  const { hw, back, front, ceil } = HALL;
  const [mx, mh] = h.mouth;
  const cell = b.low ? 2.6 : b.high ? 1.45 : 1.85;
  const light = new THREE.Color(h.wall).multiplyScalar(1.55);
  const lightHex = `#${light.getHexString()}`;
  const seed = Math.floor(b.rand() * 1000);
  // The rock bulges out around the bay, as if the opening were blasted through it.
  const nearMouth = (dist: number): number => 1 + 2.2 * Math.exp(-dist / 2.2);
  // Keep the pipe run clear, and the rock thin behind the catwalk.
  const sideDepth = (_u: number, v: number): number => (v > 2.8 && v < 5.4 ? 0.35 : v > 8 && v < 10 ? 0.6 : 1);
  for (const side of [-1, 1]) {
    const holes: [number, number, number, number][] = DOORS.filter(([s]) => s === side).map(([, z, w, hh]) => [z - back - w / 2 - 1.2, -1, z - back + w / 2 + 1.2, hh + 2.2]);
    rockFace(b, {
      origin: [side * (hw - 0.05), 0, back],
      u: [0, 0, 1],
      v: [0, 1, 0],
      n: [-side, 0, 0],
      w: front - back,
      h: ceil,
      cell,
      depth: 1.15,
      dark: h.wallDark,
      light: lightHex,
      seed: seed + side * 31,
      holes,
      depthAt: sideDepth,
    });
  }
  // Back wall either side of the mouth, and above it.
  for (const side of [-1, 1]) {
    const x0 = mx + 1.4;
    const w = hw - x0;
    rockFace(b, {
      origin: [side < 0 ? -hw : x0, 0, back + 0.05],
      u: [1, 0, 0],
      v: [0, 1, 0],
      n: [0, 0, 1],
      w,
      h: ceil,
      cell,
      depth: 0.85,
      dark: h.wallDark,
      light: lightHex,
      seed: seed + 50 + side,
      depthAt: (u) => nearMouth(side < 0 ? w - u : u),
    });
  }
  rockFace(b, {
    origin: [-mx - 1.4, mh + 1.6, back + 0.05],
    u: [1, 0, 0],
    v: [0, 1, 0],
    n: [0, 0, 1],
    w: 2 * mx + 2.8,
    h: ceil - mh - 1.6,
    cell,
    depth: 0.85,
    dark: h.wallDark,
    light: lightHex,
    seed: seed + 60,
    depthAt: (_u, v) => nearMouth(v),
  });
  // Work-lamp washes on the rock beside the ribs (the rib lamps light the stone around them).
  for (const side of [-1, 1]) {
    for (let x = mx + 5; x < hw - 1; x += 7) b.glow('pool', [side * x, 12, back + 1.9], 8, 11, [0, 0, 0], h.lamp, 0.16);
    for (let z = back + 6; z < front - 1; z += 8) b.glow('pool', [side * (hw - 1.4), 12.6, z], 7, 12, [0, (side * Math.PI) / -2, 0], h.lamp, 0.12);
  }
  // Rough rock overhead, above the trusses.
  rockFace(b, {
    origin: [-hw, ceil - 0.1, front],
    u: [1, 0, 0],
    v: [0, 0, -1],
    n: [0, -1, 0],
    w: 2 * hw,
    h: front - back,
    cell: cell * 2,
    depth: 1.6,
    dark: '#15120f',
    light: `#${new THREE.Color(h.wallDark).multiplyScalar(0.9).getHexString()}`,
    seed: seed + 70,
  });
  // Steel arches bolted to the rock between the ribs: a few horizontal ties and anchor plates.
  for (const side of [-1, 1]) {
    for (const z of wallBays()) {
      if (nearDoor(side, z, 3)) continue;
      b.box('metal', [0.3, 0.5, 6.4], [side * (hw - 1.25), 12.6, z], h.trim);
      if (b.rand() < 0.5) b.box('metal', [0.25, 1.2, 1.2], [side * (hw - 1.15), 6.4, z + b.range(-2, 2)], h.metal);
    }
  }
}

/** Big stencilled digit on a wall (a Frame facing local +Z), seven-segment style. */
export function wallDigit(b: RoomBuilder, f: Frame, digit: number, x: number, y: number, h: number, color: string): void {
  const SEG: Record<number, string> = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const w = h * 0.55;
  const t = h * 0.13;
  const segs: Record<string, [number, number, number, number]> = {
    a: [0, h / 2, w, t],
    g: [0, 0, w, t],
    d: [0, -h / 2, w, t],
    f: [-w / 2, h / 4, t, h / 2],
    b: [w / 2, h / 4, t, h / 2],
    e: [-w / 2, -h / 4, t, h / 2],
    c: [w / 2, -h / 4, t, h / 2],
  };
  for (const k of SEG[digit] ?? '') {
    const [sx, sy, sw, sh] = segs[k]!;
    fbox(b, f, 'paint', [sw, sh, 0.03], [x + sx, y + sy, 0], color);
  }
}

function armourWalls(b: RoomBuilder, h: HangarLook): void {
  const { hw, back, ceil } = HALL;
  const [mx] = h.mouth;
  const base = new THREE.Color(h.wall);
  const plate = (f: Frame, local: V3, size: [number, number]): void => {
    const tone = base.clone().multiplyScalar(0.84 + b.rand() * 0.18);
    fbox(b, f, 'hull', [size[0], size[1], 0.36], local, tone, { uv: 3 });
    if (!b.low) fbox(b, f, 'hull', [size[0] - 0.5, size[1] - 0.5, 0.2], [local[0], local[1], local[2] + 0.2], tone.clone().multiplyScalar(1.1), { uv: 3 });
  };
  // Side walls: heavy plates in two columns per bay from the floor to under the roof trim, a
  // sloped glacis at the foot with a chevron band.
  for (const side of [-1, 1]) {
    for (const z of wallBays()) {
      if (nearDoor(side, z, 1)) continue;
      const f = new Frame([side * (hw - 0.34), 0, z], (-side * Math.PI) / 2);
      for (const dx of [-1.55, 1.55]) {
        for (const y of b.low ? [2.6, 5.6] : [2.6, 5.6, 11.3, 14.3]) plate(f, [dx, y, 0], [2.9, 2.8]);
        fbox(b, f, 'hull', [2.9, 1.4, 0.3], [dx, 0.7, 0.45], base.clone().multiplyScalar(0.78), { rot: [-0.55, 0, 0], uv: 3 });
      }
      if (!b.low) for (let i = 0; i < 6; i++) fbox(b, f, 'paint', [0.95, 0.36, 0.04], [-2.6 + i * 1.04, 1.62, 0.33], h.hazard[i % 2]!, { rot: [0, 0, 0.6] });
    }
  }
  // Back wall either side of the mouth: plates to the roof, chevrons at the foot, a big bay number.
  for (const side of [-1, 1]) {
    const f = new Frame([0, 0, back + 0.3], 0);
    for (let x = mx + 3; x < hw - 1.8; x += 3.25) {
      for (let y = 2.2; y < (b.low ? 15 : ceil - 3); y += 3.1) plate(f, [side * x, y, 0], [3.0, 2.8]);
    }
    for (let i = 0; i < Math.floor((hw - mx - 2) / 1.1); i++) fbox(b, f, 'paint', [0.9, 0.34, 0.04], [side * (mx + 2.5 + i * 1.1), 0.55, 0.42], h.hazard[i % 2]!, { rot: [0, 0, 0.6 * side] });
    const digit = side < 0 ? 0 : 1 + Math.floor(b.rand() * 9);
    wallDigit(b, f, digit, side * (mx + 6.4), 9, 4.2, h.marking);
  }
}

function cleanWalls(b: RoomBuilder, h: HangarLook): void {
  const { hw, back } = HALL;
  const [mx] = h.mouth;
  const panel = new THREE.Color(h.wall);
  let screen = 0;
  for (const side of [-1, 1]) {
    for (const z of wallBays()) {
      if (nearDoor(side, z, 1)) continue;
      const f = new Frame([side * (hw - 0.22), 0, z], (-side * Math.PI) / 2);
      // Smooth panels from floor to roof (satin, so the key light does not flare off them), with light seams.
      for (const [y, hh] of [
        [3.9, 7.4],
        [12.4, 8.6],
        [19.6, 4.8],
      ] as const) {
        for (const dx of [-1.58, 1.58]) fbox(b, f, 'plain', [3.08, hh, 0.14], [dx, y, 0], panel.clone().multiplyScalar(0.95 + b.rand() * 0.06));
        fbox(b, f, 'emissive', [6.3, 0.07, 0.06], [0, y + hh / 2 + 0.05, 0.08], h.glow, { intensity: h.glowLevel * 0.7 });
      }
      fbox(b, f, 'emissive', [0.07, 7.4, 0.06], [0, 3.9, 0.08], h.glow, { intensity: h.glowLevel * 0.7 });
      // Every other bay: an instrument screen set into the cladding.
      if (screen++ % 2 === 0) {
        fbox(b, f, 'dark', [3.1, 1.9, 0.08], [0, 4.4, 0.1], '#000');
        b.holo(screen % 4 === 1 ? 'chart' : 'scope', 20 + screen, f.p([0, 4.4, 0.16]), 2.9, 1.7, h.holo, 1.3, f.ry);
      }
    }
  }
  for (const side of [-1, 1]) {
    const f = new Frame([0, 0, back + 0.14], 0);
    for (let x = mx + 3.2; x < hw - 1.8; x += 3.5) {
      for (const [y, hh] of [
        [4.6, 9],
        [14.2, 9.6],
      ] as const) fbox(b, f, 'plain', [3.4, hh, 0.14], [side * x, y, 0], panel.clone().multiplyScalar(0.95 + b.rand() * 0.06));
    }
    fbox(b, f, 'emissive', [hw - mx - 3, 0.07, 0.06], [(side * (hw + mx + 1.4)) / 2, 9.15, 0.1], h.glow, { intensity: h.glowLevel * 0.8 });
  }
}

function patchedWalls(b: RoomBuilder, h: HangarLook): void {
  const { hw, back } = HALL;
  const [mx] = h.mouth;
  const cols = [...h.containers, h.wall, h.wallDark, h.accent];
  const patch = (f: Frame, x: number, y: number, w: number, hh: number, dz: number): void => {
    const c = new THREE.Color(b.pick(cols)).multiplyScalar(0.6 + b.rand() * 0.35);
    fbox(b, f, 'hull', [w, hh, 0.12], [x, y, dz], c, { rot: [0, 0, (b.rand() - 0.5) * 0.08], uv: 2 });
  };
  for (const side of [-1, 1]) {
    for (const z of wallBays()) {
      if (nearDoor(side, z, 0.5)) continue;
      const f = new Frame([side * (hw - 0.22), 0, z], (-side * Math.PI) / 2);
      const n = b.low ? 3 : 7;
      for (let i = 0; i < n; i++) patch(f, b.range(-2.2, 2.2), b.range(1.4, 17), b.range(1.6, 3.4), b.range(1.4, 3.6), i * 0.03);
    }
  }
  for (const side of [-1, 1]) {
    const f = new Frame([0, 0, back + 0.15], 0);
    const n = b.low ? 6 : 16;
    for (let i = 0; i < n; i++) patch(f, side * b.range(mx + 3, hw - 2), b.range(1.2, 18), b.range(1.8, 4), b.range(1.4, 3.6), i * 0.025);
  }
}

function scrapWalls(b: RoomBuilder, h: HangarLook): void {
  const { hw, back } = HALL;
  const [mx] = h.mouth;
  const rusts = ['#5a3222', '#6a4030', '#3a2c26', '#4a3a30', '#704a2a', h.wallDark, h.wall];
  const sheet = (pos: V3, ry: number, w: number, hh: number): void => {
    const f = new Frame(pos, ry);
    const c = new THREE.Color(b.pick(rusts)).multiplyScalar(0.7 + b.rand() * 0.35);
    fbox(b, f, 'hull', [w, hh, 0.1], [0, 0, 0], c, { rot: [(b.rand() - 0.5) * 0.18, (b.rand() - 0.5) * 0.2, (b.rand() - 0.5) * 0.3], uv: 2 });
  };
  for (const side of [-1, 1]) {
    let k = 0;
    for (const z of wallBays()) {
      if (nearDoor(side, z, 0.5)) continue;
      const n = b.low ? 4 : 7;
      for (let i = 0; i < n; i++) sheet([side * (hw - 0.3 - b.rand() * 0.3), b.range(0.8, 13), z + b.range(-2.4, 2.4)], (side * Math.PI) / 2, b.range(1.2, 3), b.range(1, 3));
      // Holes torn in the cladding, and welded straps across.
      if (b.rand() < 0.6) b.box('dark', [0.1, b.range(0.8, 1.6), b.range(0.8, 2)], [side * (hw - 0.52), b.range(2, 9), z + b.range(-2, 2)]);
      b.box('metal', [0.14, 0.18, 5.6], [side * (hw - 0.55), b.range(3, 11), z], '#2a2422', { rot: [b.range(-0.3, 0.3), 0, 0] });
      // Caged red work lamp on every other bay.
      if (k++ % 2 === 0) {
        const p: V3 = [side * (hw - 0.9), 6.2, z];
        b.box('metal', [0.5, 0.6, 0.5], p, '#1e1a18');
        b.box('emissive', [0.34, 0.34, 0.34], [p[0] - side * 0.1, p[1], p[2]], '#ff3a24', { intensity: 2.2 });
        b.light({ p: [p[0] - side * 0.4, p[1], p[2]], color: '#ff3a24', size: 1.6, intensity: 1.4, blink: 0.3, duty: 0.8, min: 0.55, phase: z * 0.03 });
        b.glow('pool', [side * (hw - 0.45), 5.6, z], 5, 7, [0, (-side * Math.PI) / 2, 0], '#ff3a24', 0.25);
      }
    }
  }
  for (const side of [-1, 1]) {
    const n = b.low ? 8 : 16;
    for (let i = 0; i < n; i++) sheet([side * b.range(mx + 2.5, hw - 1.5), b.range(0.8, 15), back + 0.2 + b.rand() * 0.2], 0, b.range(1.5, 3.5), b.range(1, 3));
    // Caged red lamps washing the scrap beside the bay.
    for (let x = mx + 3.5; x < hw - 2; x += 6.5) {
      const p: V3 = [side * x, 5.8 + (x % 2), back + 0.7];
      b.box('metal', [0.6, 0.7, 0.5], p, '#1e1a18');
      b.box('emissive', [0.4, 0.4, 0.2], [p[0], p[1], p[2] + 0.2], '#ff3a24', { intensity: 2.4 });
      b.light({ p: [p[0], p[1], p[2] + 0.5], color: '#ff3a24', size: 2, intensity: 1.6, blink: 0.25, duty: 0.85, min: 0.55, phase: x * 0.07 });
      b.glow('pool', [p[0], p[1] - 0.8, back + 0.45], 7, 8, [0, 0, 0], '#ff3a24', 0.3);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Low ceiling of ducts (cramped stations): replaces the open roof trusses.
 * ---------------------------------------------------------------------------------------------- */

/** Height of the duct ceiling. */
export const DUCT_CEILING = 15.5;

export function ductCeiling(b: RoomBuilder, h: HangarLook): void {
  const { hw, back, front } = HALL;
  const y = DUCT_CEILING;
  const zc = (front + back) / 2;
  const len = front - back;
  b.box('dark', [2 * hw, 0.4, len], [0, y + 0.2, zc]);
  // Ceiling grid: beams across and along, grille panels between.
  for (let z = back + 4; z < front; z += 8) b.box('metal', [2 * hw, 0.7, 0.5], [0, y - 0.35, z], h.trim);
  for (const x of [-30, -15, 0, 15, 30]) b.box('metal', [0.5, 0.6, len], [x, y - 0.3, zc], h.trim);
  if (!b.low) {
    for (let z = back + 8; z < front - 4; z += 8) {
      for (const x of [-37.5, -22.5, 22.5, 37.5]) b.box('grate', [12, 0.1, 5.4], [x, y - 0.05, z], h.metal, { uv: 2 });
    }
  }
  // Big ducts and pipe runs hanging under the ceiling.
  for (const [x, r] of [
    [-24, 1.1],
    [-9, 0.75],
    [9, 0.75],
    [26, 1.1],
  ] as const) {
    b.rod('metal', [x, y - 1.6, back], [x, y - 1.6, front], r, h.metal, b.low ? 8 : 12);
    for (let z = back + 3; z < front; z += 6) b.cyl('metal', r + 0.08, 0.3, [x, y - 1.6, z], h.trim, { rot: [Math.PI / 2, 0, 0], seg: b.low ? 8 : 12 });
  }
  for (const [x, yy, r, c] of [
    [-16, y - 0.9, 0.22, h.accent],
    [-15.3, y - 0.9, 0.16, h.metal],
    [17, y - 1.0, 0.25, h.hazard[0]],
  ] as const) b.rod('metal', [x, yy, back], [x, yy, front], r, c, 6);
  // Lamps under the ducts: fewer and dimmer than an open roof.
  for (let z = back + 8; z < front; z += 12) {
    for (const x of [-17, 0, 17]) ceilingLamp(b, [x, y - 1.2, z], 4, h.lamp, h.lampLevel, true, 0);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Pillars.
 * ---------------------------------------------------------------------------------------------- */

export function extraPillar(b: RoomBuilder, h: HangarLook, x: number, z: number): void {
  const top = h.ceiling === 'ducts' ? DUCT_CEILING : HALL.ceil - 2;
  switch (h.pillarKind) {
    case 'rock': {
      // A column of living rock left standing, banded with steel.
      const light = `#${new THREE.Color(h.wall).multiplyScalar(1.15).getHexString()}`;
      const seed = Math.floor(b.rand() * 1000);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.3;
        const n: V3 = [Math.cos(a), 0, Math.sin(a)];
        const u: V3 = [-Math.sin(a), 0, Math.cos(a)];
        rockFace(b, {
          origin: [x + n[0] * 1.35 - u[0] * 1.35, 0, z + n[2] * 1.35 - u[2] * 1.35],
          u,
          v: [0, 1, 0],
          n,
          w: 2.7,
          h: top,
          cell: b.low ? 1.35 : 0.9,
          depth: 0.9,
          dark: h.wallDark,
          light,
          seed: seed + k * 7,
        });
      }
      for (const y of [0.5, 7.5]) b.box('metal', [3.2, 0.6, 3.2], [x, y, z], h.trim);
      const f = new Frame([x, 7.5, z], 0.4);
      fbox(b, f, 'metal', [0.7, 0.5, 0.5], [0, 0.6, 1.8], '#2a2c30');
      fbox(b, f, 'emissive', [0.55, 0.35, 0.06], [0, 0.6, 2.06], h.lamp, { intensity: h.lampLevel * 1.2 });
      b.light({ p: f.p([0, 0.6, 2.2]), color: h.lamp, size: 2.4, intensity: 1.2 });
      break;
    }
    case 'pipes': {
      // A bundle of process pipes rising to the roof, flanged, with a valve wheel.
      const f = new Frame([x, 0, z], 0);
      const cols = [h.metal, h.accent, h.metal, h.hazard[0]];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const r = k % 2 ? 0.34 : 0.5;
        const px = Math.cos(a) * 0.72;
        const pz = Math.sin(a) * 0.72;
        fcyl(b, f, 'metal', r, top, [px, top / 2, pz], cols[k]!, { seg: b.low ? 6 : 12 });
        for (let y = 2.5; y < top - 1; y += b.low ? 9 : 4.5) fcyl(b, f, 'metal', r + 0.1, 0.24, [px, y, pz], h.trim, { seg: b.low ? 6 : 12 });
      }
      fcyl(b, f, 'metal', 0.3, top, [0, top / 2, 0], h.trim, { seg: 6 });
      fbox(b, f, 'metal', [2.4, 0.6, 2.4], [0, 0.3, 0], h.wallDark);
      const wheel = new THREE.TorusGeometry(0.42, 0.05, 5, 14);
      b.add('metal', wheel, { position: f.p([0, 1.6, 1.05]), color: '#c83a2a' });
      for (let k = 0; k < 4; k++) fbox(b, f, 'metal', [0.04, 0.84, 0.04], [0, 1.6, 1.05], '#c83a2a', { rot: [0, 0, (k * Math.PI) / 4] });
      fcyl(b, f, 'emissive', 0.16, 0.04, [0.72, 2.2, 0.72], h.glow, { rot: [Math.PI / 2, 0, 0], intensity: 1.6 });
      b.light({ p: f.p([0.72, 2.2, 0.8]), color: h.glow, size: 0.5, intensity: 1.5 });
      break;
    }
    case 'armour': {
      const f = new Frame([x, 0, z], 0);
      fbox(b, f, 'hull', [2.8, top, 2.8], [0, top / 2, 0], h.pillar, { uv: 3 });
      fcyl(b, f, 'hull', 2.4, 1.6, [0, 0.8, 0], h.wallDark, { rTop: 1.8, seg: 4, rot: [0, Math.PI / 4, 0] });
      for (const s of [-1, 1]) {
        for (const t of [-1, 1]) fbox(b, f, 'hull', [0.5, top - 3, 0.5], [s * 1.35, top / 2 + 1, t * 1.35], h.trim);
      }
      for (let i = 0; i < 5; i++) fbox(b, f, 'paint', [2.84, 0.3, 0.05], [0, 2.2 + i * 0.4, 1.42], h.hazard[i % 2]!, { rot: [0, 0, 0.5] });
      fbox(b, f, 'emissive', [0.9, 0.3, 0.1], [0, 10.5, 1.46], h.lamp, { intensity: h.lampLevel });
      b.light({ p: f.p([0, 10.5, 1.7]), color: h.lamp, size: 2.4, intensity: 1.1 });
      b.light({ p: f.p([0, 12, 1.5]), color: '#ff3a2a', size: 0.6, intensity: 2, blink: 0.5, duty: 0.3, min: 0.1, phase: (x + z) * 0.02 });
      break;
    }
    case 'scrap': {
      // Welded girders and patch plates, a chain hanging off a bracket and a caged red lamp.
      const f = new Frame([x, 0, z], b.range(-0.3, 0.3));
      fbox(b, f, 'metal', [1.6, top, 0.3], [0, top / 2, 0.55], h.pillar);
      fbox(b, f, 'metal', [1.6, top, 0.3], [0, top / 2, -0.55], h.pillar);
      fbox(b, f, 'metal', [0.3, top, 0.9], [0, top / 2, 0], h.pillar);
      const rusts = ['#5a3222', '#6a4030', '#4a3a30', h.wallDark];
      for (let i = 0; i < (b.low ? 3 : 6); i++) {
        fbox(b, f, 'hull', [b.range(1.4, 2.2), b.range(1, 2.4), 0.08], [b.range(-0.3, 0.3), b.range(1, 14), b.rand() < 0.5 ? 0.75 : -0.75], b.pick(rusts), { rot: [0, 0, b.range(-0.3, 0.3)], uv: 2 });
      }
      fbox(b, f, 'metal', [2.6, 0.8, 2.2], [0, 0.4, 0], h.wallDark);
      fbox(b, f, 'metal', [0.5, 0.55, 0.5], [0, 8, 0.95], '#1e1a18');
      fbox(b, f, 'emissive', [0.34, 0.34, 0.1], [0, 8, 1.2], '#ff3a24', { intensity: 2.2 });
      b.light({ p: f.p([0, 8, 1.4]), color: '#ff3a24', size: 1.8, intensity: 1.4, blink: 0.25, duty: 0.8, min: 0.5, phase: x * 0.05 });
      b.rod('metal', f.p([0.9, 12, 0.9]), f.p([0.9, 6.5, 0.9]), 0.06, '#2a2624', 4);
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Bay mouths.
 * ---------------------------------------------------------------------------------------------- */

export function extraBay(b: RoomBuilder, h: HangarLook): void {
  const { back, ceil, wall } = HALL;
  const [mx, mh] = h.mouth;
  switch (h.bayKind) {
    case 'scanner': {
      // Customs scanner gate inside the mouth: heavy frame, emitter bars and a scan line sweeping
      // up and down over the traffic.
      const z = back + 2.2;
      for (const side of [-1, 1]) {
        b.box('hull', [1.6, mh, 1.4], [side * (mx - 0.6), mh / 2, z], h.wallDark, { uv: 3 });
        b.box('emissive', [0.12, mh - 1.4, 0.2], [side * (mx - 1.46), mh / 2, z], h.holo, { intensity: 2 });
        for (let i = 0; i < 6; i++) b.light({ p: [side * (mx - 1.5), 1.2 + i * ((mh - 2) / 5), z + 0.3], color: i % 2 ? h.holo : '#ffd23a', size: 0.5, intensity: 2, blink: 1.2, phase: i / 6 + (side > 0 ? 0.5 : 0), duty: 0.5, min: 0.3 });
      }
      b.box('hull', [2 * mx, 1.4, 1.4], [0, mh - 0.7, z], h.wallDark, { uv: 3 });
      b.box('emissive', [2 * mx - 3, 0.12, 0.2], [0, mh - 1.46, z], h.holo, { intensity: 2 });
      const scan = { type: MOTION.bob, pivot: [0, 0, 0] as V3, speed: 0.55, amp: mh / 2 - 1.2, phase: 0 };
      const f = new Frame([0, mh / 2, z], 0);
      mbox(b, f, 'm:emissive', [2 * mx - 3.2, 0.1, 0.1], [0, 0, 0.1], h.holo, scan, undefined, { intensity: 3 });
      b.holo('curtain', 0, [0, mh / 2, z + 0.05], 2 * mx - 3.2, mh - 1.5, h.holo, 0.35);
      hazardBand(b, [-mx + 1, z + 2.4], [mx - 1, z + 2.4], 0.8, h.hazard);
      break;
    }
    case 'rock': {
      // Rough rock rim around the opening, with a steel lip and hazard paint at the threshold.
      const seed = Math.floor(b.rand() * 1000);
      const light = `#${new THREE.Color(h.wall).multiplyScalar(1.1).getHexString()}`;
      for (const side of [-1, 1]) {
        rockFace(b, {
          origin: [side * (mx + 0.1), 0, back + 0.2],
          u: [0, 0, -1],
          v: [0, 1, 0],
          n: [-side, 0, 0],
          w: wall + 0.6,
          h: mh + 2,
          cell: b.low ? 1.2 : 0.8,
          depth: 1.6,
          dark: h.wallDark,
          light,
          seed: seed + side,
        });
      }
      rockFace(b, {
        origin: [-mx - 0.5, mh + 0.2, back + 0.2],
        u: [1, 0, 0],
        v: [0, 0, -1],
        n: [0, -1, 0],
        w: 2 * mx + 1,
        h: wall + 0.6,
        cell: b.low ? 1.4 : 0.9,
        depth: 1.4,
        dark: h.wallDark,
        light,
        seed: seed + 9,
      });
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) b.light({ p: [side * (mx - 0.9), 1 + i * 3.4, back + 0.6], color: '#ffc040', size: 0.7, intensity: 2, blink: 0.5, phase: i * 0.25, duty: 0.5, min: 0.25 });
      }
      break;
    }
    case 'scrap': {
      // Salvaged doors jammed half open: ragged plates hanging from the header, patched side slabs.
      const d = new THREE.Color(h.wallDark);
      const rusts = ['#5a3222', '#6a4030', '#3a2c26', '#704a2a'];
      for (const side of [-1, 1]) {
        b.box('hull', [4.5, mh, 1.2], [side * (mx - 2.25), mh / 2, back - wall - 0.4], d.clone().multiplyScalar(1.2), { uv: 3 });
        for (let i = 0; i < (b.low ? 3 : 6); i++) {
          b.box('hull', [b.range(1.2, 2.4), b.range(1, 2.5), 0.12], [side * (mx - b.range(0.8, 3.8)), b.range(1, mh - 1), back - wall + 0.3], b.pick(rusts), { rot: [0, 0, b.range(-0.4, 0.4)], uv: 2 });
        }
      }
      const n = Math.round(mx / 1.6);
      for (let i = 0; i < n; i++) {
        const x = -mx + (i + 0.5) * ((2 * mx) / n);
        const drop = b.range(1.2, 3.6) * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.7)));
        b.box('hull', [(2 * mx) / n - 0.1, drop, 0.14], [x, mh - drop / 2, back - wall + 0.1], b.pick(rusts), { rot: [0, 0, b.range(-0.12, 0.12)], uv: 2 });
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) b.light({ p: [side * (mx - 0.5), 2 + i * 4, back + 0.7], color: '#ff2a1a', size: 1.1, intensity: 2.4, blink: 0.35, phase: i * 0.3 + (side > 0 ? 0.5 : 0), duty: 0.5, min: 0.15 });
        b.rod('metal', [side * (mx - 1), mh + 0.5, back + 0.6], [side * (mx - 1.3), mh - 5, back + 0.6], 0.07, '#2a2624', 4);
      }
      break;
    }
    case 'gantry': {
      // Shipyard mouth: lattice towers either side carrying a crane girder across the opening.
      const y = Math.min(ceil - 3, mh + 3);
      for (const side of [-1, 1]) {
        b.truss('metal', [side * (mx + 3), 0, back + 1.6], [side * (mx + 3), y + 1, back + 1.6], 2.4, b.low ? 4 : 10, h.machine, 0.2);
        b.light({ p: [side * (mx + 3), y + 1.6, back + 1.6], color: '#ff3a2a', size: 0.9, intensity: 2.2, blink: 0.5, duty: 0.25, min: 0.05, phase: side > 0 ? 0.5 : 0 });
      }
      b.truss('metal', [-mx - 3, y, back + 1.6], [mx + 3, y, back + 1.6], 2, b.low ? 7 : 18, h.machine, 0.18);
      // Travelling trolley with a hook block.
      const a = { type: MOTION.slideX, pivot: [0, 0, 0] as V3, speed: 0.06, amp: mx * 0.55, phase: 0.8 };
      const f = new Frame([-mx * 0.2, y - 1.4, back + 1.6], 0);
      mbox(b, f, 'm:metal', [2.4, 1.2, 2.6], [0, 0, 0], h.machine, a);
      mbox(b, f, 'm:metal', [0.08, 6, 0.08], [-0.4, -3.6, 0], '#1e1f22', a);
      mbox(b, f, 'm:metal', [0.08, 6, 0.08], [0.4, -3.6, 0], '#1e1f22', a);
      mbox(b, f, 'm:metal', [1.2, 0.9, 1], [0, -7, 0], h.hazard[0], a);
      for (let i = 0; i < 8; i++) b.box('paint', [(2 * mx) / 8, 0.5, 0.05], [-mx + ((i + 0.5) * 2 * mx) / 8, mh - 0.5, back + 0.46], h.hazard[i % 2]!);
      break;
    }
    default:
      break;
  }
}

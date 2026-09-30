import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import type { ArtContext } from '../art/types.ts';
import { RoomBuilder } from './builder.ts';
import type { ViewShots } from './camera.ts';
import { addPerson } from './people.ts';
import type { PoseKind } from './people.ts';
import { Frame, fbox, fcyl } from './props.ts';
import type { Backdrop } from './space.ts';
import type { BarLook, InteriorStyle } from './styles.ts';

/**
 * The lounge: a separate room (the camera cuts to it) with a counter and back bar on the right,
 * booths on the left, high tables in the middle, a window onto space at the back, and people.
 * The layout is shared; materials, window type, furniture and decor vary per station.
 */

/** The lounge sits far below the hangar so neither room is ever seen from the other. */
export const BAR_ORIGIN: V3 = [0, -400, 0];
export const BAR = { hw: 8.6, back: -8, front: 9.5, ceil: 5.2 };

export interface LoungeBuild {
  readonly builder: RoomBuilder;
  readonly lights: THREE.Light[];
  readonly shots: ViewShots;
  readonly anchors: { id: string; label: string; position: THREE.Vector3 }[];
}

interface Slot {
  pose: PoseKind;
  pos: V3;
  yaw: number;
  seat?: number;
  surface?: number;
  reach?: number;
}

const COUNTER: [number, number][] = [
  [4.6, -7.2],
  [4.1, -4.4],
  [3.9, -1.4],
  [4.1, 1.6],
  [4.9, 4.2],
  [6.6, 6.2],
];
const COUNTER_TOP = 1.08;
const STOOL_SEAT = 0.78;

function counterRun(b: RoomBuilder, bar: BarLook): { stools: { pos: V3; yaw: number }[] } {
  const stools: { pos: V3; yaw: number }[] = [];
  const glowCol = new THREE.Color(bar.accent);
  for (let i = 0; i + 1 < COUNTER.length; i++) {
    const [x0, z0] = COUNTER[i]!;
    const [x1, z1] = COUNTER[i + 1]!;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz);
    const f = new Frame([(x0 + x1) / 2, 0, (z0 + z1) / 2], ry);
    // Body (front face towards the room = local -X).
    fbox(b, f, 'gloss', [0.75, COUNTER_TOP - 0.1, len + 0.05], [0.1, (COUNTER_TOP - 0.1) / 2, 0], bar.counter);
    fbox(b, f, 'gloss', [1.15, 0.08, len + 0.12], [0.02, COUNTER_TOP - 0.04, 0], bar.counterTop);
    fbox(b, f, 'emissive', [0.04, 0.05, len], [-0.29, COUNTER_TOP - 0.14, 0], glowCol, { intensity: 2.2 });
    fbox(b, f, 'emissive', [0.04, 0.04, len], [-0.29, 0.12, 0], glowCol, { intensity: 1.2 });
    fbox(b, f, 'metal', [0.06, 0.06, len], [-0.5, 0.28, 0], '#b8a888');
    // Glow washing down the counter front.
    b.glow('shaft', f.p([-0.3, (COUNTER_TOP - 0.2) / 2, 0]), len, COUNTER_TOP - 0.2, f.rot([0, -Math.PI / 2, 0]), bar.accent, 0.35);
    // Stools along the front.
    const n = Math.max(1, Math.round(len / 1.35));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p = f.p([-1.0, 0, -len / 2 + t * len]);
      // Face the counter (local +X), turned a little towards the room.
      stools.push({ pos: p, yaw: ry + Math.PI / 2 - 0.45 });
    }
  }
  return { stools };
}

function stool(b: RoomBuilder, pos: V3, bar: BarLook): void {
  const f = new Frame(pos, 0);
  fcyl(b, f, 'metal', 0.26, 0.05, [0, 0.025, 0], '#2a2c30', { seg: 10 });
  fcyl(b, f, 'metal', 0.045, STOOL_SEAT - 0.08, [0, STOOL_SEAT / 2, 0], '#8a8f96', { seg: 6 });
  fcyl(b, f, 'metal', 0.2, 0.03, [0, 0.32, 0], '#8a8f96', { seg: 10, open: true });
  fcyl(b, f, 'fabric', 0.22, 0.1, [0, STOOL_SEAT - 0.03, 0], bar.seat, { seg: 10, uv: 1 });
}

function booth(b: RoomBuilder, bar: BarLook, zc: number, slots: Slot[]): void {
  const hw = BAR.hw;
  const f = new Frame([-hw + 1.55, 0, zc], 0);
  // Two benches facing each other across a table, backs against partitions.
  for (const s of [-1, 1]) {
    fbox(b, f, 'fabric', [2.6, 0.45, 0.62], [0, 0.3, s * 1.25], bar.seat, { uv: 1 });
    fbox(b, f, 'fabric', [2.6, 0.75, 0.2], [0, 0.85, s * 1.6], bar.seat, { uv: 1 });
    fbox(b, f, 'wood', [2.8, 1.35, 0.1], [0, 0.68, s * 1.74], bar.table, { uv: 2 });
    fbox(b, f, 'metal', [2.8, 0.05, 0.12], [0, 1.37, s * 1.74], '#b8a888');
    slots.push({ pose: 'sitTable', pos: f.p([s > 0 ? -0.25 : 0.25, 0, s * 1.25]), yaw: s > 0 ? Math.PI : 0, seat: 0.53, surface: 0.78, reach: 0.72 });
  }
  fbox(b, f, 'gloss', [2.1, 0.07, 1.1], [0.1, 0.76, 0], bar.table);
  fcyl(b, f, 'metal', 0.07, 0.72, [0.1, 0.37, 0], '#6a6e75', { seg: 6 });
  // Table lamp and its pool of light.
  fcyl(b, f, 'emissive', 0.07, 0.16, [-0.55, 0.88, 0], bar.lamp, { seg: 8, intensity: 2.2 });
  b.light({ p: f.p([-0.55, 0.92, 0]), color: bar.lamp, size: 0.7, intensity: 1.2 });
  b.floorGlow(f.p([0, 0, 0])[0] + 0.1, zc, 2.2, 1.6, bar.lamp, 0.35, 0.8);
  // Drinks.
  for (let i = 0; i < 2; i++) fcyl(b, f, 'glassWarm', 0.04, 0.12, [0.3 + i * 0.3, 0.85, (i - 0.5) * 0.4], '#ffffff', { seg: 6 });
  // Sconce above.
  fbox(b, f, 'emissive', [0.12, 0.34, 0.5], [-1.3, 2.35, 0], bar.lamp, { intensity: 2.4 });
  b.light({ p: f.p([-1.2, 2.35, 0]), color: bar.lamp, size: 0.8, intensity: 1.1 });
  b.glow('pool', f.p([-1.33, 2.4, 0]), 2.4, 2.6, f.rot([0, Math.PI / 2, 0]), bar.lamp, 0.35);
}

function highTable(b: RoomBuilder, bar: BarLook, x: number, z: number): void {
  const f = new Frame([x, 0, z], 0);
  fcyl(b, f, 'metal', 0.32, 0.05, [0, 0.03, 0], '#2a2c30', { seg: 10 });
  fcyl(b, f, 'metal', 0.06, 1.05, [0, 0.55, 0], '#8a8f96', { seg: 6 });
  fcyl(b, f, 'gloss', 0.48, 0.06, [0, 1.08, 0], bar.table, { seg: 14 });
  fcyl(b, f, 'emissive', 0.49, 0.02, [0, 1.05, 0], bar.accent, { seg: 14, intensity: 1.4, open: true });
  fcyl(b, f, 'glassWarm', 0.04, 0.12, [0.15, 1.17, 0.1], '#ffffff', { seg: 6 });
}

function plant(b: RoomBuilder, pos: V3, scale: number, pot: string): void {
  const f = new Frame(pos, b.rand() * 6, scale);
  fcyl(b, f, 'plain', 0.32, 0.6, [0, 0.3, 0], pot, { rTop: 0.38, seg: 10 });
  fcyl(b, f, 'dark', 0.33, 0.04, [0, 0.6, 0], '#000', { seg: 10 });
  const greens = ['#3f8a3a', '#5aa83a', '#2e6a32', '#7ab84a', '#4a9a5a'];
  const n = b.low ? 5 : 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + b.rand();
    const tilt = 0.35 + b.rand() * 0.5;
    const len = 0.7 + b.rand() * 0.6;
    const leaf = new THREE.ConeGeometry(0.13, len, 4, 1);
    leaf.scale(1, 1, 0.35);
    leaf.translate(0, len / 2, 0);
    b.add('plain', leaf, {
      position: f.p([0, 0.58, 0]),
      quaternion: f.rot([Math.sin(a) * tilt, a, -Math.cos(a) * tilt]),
      color: b.pick(greens),
      scale: scale,
    });
  }
}

/** Back wall with the window cut out (per window type). */
function backWall(b: RoomBuilder, bar: BarLook, backdrop: Backdrop): void {
  const { hw, back, ceil } = BAR;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(hw, ceil);
  shape.lineTo(-hw, ceil);
  shape.closePath();
  const frames: (() => void)[] = [];
  const windowGlow = backdrop.starColor.clone().lerp(new THREE.Color(bar.accent), 0.3);
  switch (bar.window) {
    case 'panorama': {
      const x0 = -8.2;
      const x1 = 3.0;
      const y0 = 0.9;
      const y1 = 3.9;
      const hole = new THREE.Path();
      hole.moveTo(x0, y0);
      hole.lineTo(x0, y1);
      hole.lineTo(x1, y1);
      hole.lineTo(x1, y0);
      hole.closePath();
      shape.holes.push(hole);
      frames.push(() => {
        for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 4) b.box('metal', [0.12, y1 - y0, 0.3], [x, (y0 + y1) / 2, back], '#2a2e36');
        b.box('metal', [x1 - x0 + 0.2, 0.18, 0.5], [(x0 + x1) / 2, y0 - 0.05, back + 0.05], bar.wallTrim);
        b.box('metal', [x1 - x0 + 0.2, 0.14, 0.3], [(x0 + x1) / 2, y1 + 0.05, back], '#2a2e36');
        b.box('emissive', [x1 - x0, 0.04, 0.04], [(x0 + x1) / 2, y0 + 0.05, back + 0.28], bar.accent, { intensity: 1.8 });
        b.glow('streak', [(x0 + x1) / 2, (y0 + y1) / 2, back + 0.05], x1 - x0, y1 - y0, [0, 0, 0], windowGlow, 0.05);
        b.floorGlow((x0 + x1) / 2, back + 2.2, x1 - x0, 4, windowGlow, 0.12);
      });
      break;
    }
    case 'portholes':
    case 'band': {
      const band = bar.window === 'band';
      const xs = band ? [-6.9, -3.1, 0.7] : [-7.4, -4.8, -2.2, 0.4];
      for (const x of xs) {
        const hole = new THREE.Path();
        if (band) {
          hole.moveTo(x - 1.7, 1.5);
          hole.lineTo(x - 1.7, 3.3);
          hole.lineTo(x + 1.7, 3.3);
          hole.lineTo(x + 1.7, 1.5);
          hole.closePath();
        } else {
          hole.absarc(x, 2.3, 0.75, 0, Math.PI * 2, true);
        }
        shape.holes.push(hole);
        frames.push(() => {
          if (band) {
            b.box('metal', [3.6, 0.16, 0.45], [x, 1.45, back + 0.05], bar.wallTrim);
            b.box('metal', [3.6, 0.12, 0.3], [x, 3.35, back], '#2a2e36');
            for (const dx of [-1.75, 1.75]) b.box('metal', [0.12, 1.9, 0.3], [x + dx, 2.4, back], '#2a2e36');
          } else {
            const ring = new THREE.TorusGeometry(0.8, 0.1, 6, 20);
            b.add('metal', ring, { position: [x, 2.3, back + 0.12], color: bar.wallTrim });
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              b.box('metal', [0.08, 0.08, 0.08], [x + Math.cos(a) * 0.95, 2.3 + Math.sin(a) * 0.95, back + 0.22], '#8a8f96');
            }
          }
          b.floorGlow(x, back + 1.6, band ? 3.4 : 1.8, 3, windowGlow, 0.2);
        });
      }
      break;
    }
    case 'none':
      break;
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -0.3);
  b.add('hull', g, { position: [0, 0, back], color: bar.wall, uv: 3 });
  for (const fn of frames) fn();
}

export function buildLounge(ctx: ArtContext, style: InteriorStyle, seed: number, backdrop: Backdrop): LoungeBuild {
  const bar = style.bar;
  const b = new RoomBuilder('bar', seed * 131 + 71, ctx);
  b.group.position.set(...BAR_ORIGIN);
  const { hw, back, front, ceil } = BAR;
  const decor = bar.decor;

  // Shell.
  b.add('barFloor', (() => {
    const g = new THREE.PlaneGeometry(2 * hw, front - back);
    g.rotateX(-Math.PI / 2);
    return g;
  })(), { position: [0, 0, (front + back) / 2], color: bar.floor, uv: 4 });
  backWall(b, bar, backdrop);
  const wallKey = decor === 'lounge' || decor === 'market' || decor === 'mess' ? 'wood' : 'hull';
  for (const side of [-1, 1]) b.box(wallKey, [0.3, ceil, front - back], [side * (hw + 0.15), ceil / 2, (front + back) / 2], bar.wall, { uv: 3 });
  b.box('hull', [2 * hw, ceil, 0.3], [0, ceil / 2, front + 0.15], bar.wall, { uv: 3 });
  b.box('dark', [2 * hw + 1, 0.3, front - back + 1], [0, ceil + 0.15, (front + back) / 2]);
  // Skirting and trim lines.
  for (const side of [-1, 1]) {
    b.box('metal', [0.12, 0.18, front - back], [side * (hw - 0.05), 0.09, (front + back) / 2], bar.wallTrim);
    b.box('metal', [0.1, 0.1, front - back], [side * (hw - 0.05), 2.95, (front + back) / 2], bar.wallTrim);
  }
  b.box('metal', [2 * hw, 0.1, 0.1], [0, 2.95, back + 0.05], bar.wallTrim);

  // Ceiling: beams with pendant lamps; coves for the upscale lounge; pipes for the canteen.
  for (let z = back + 2; z < front; z += 3.4) b.box('metal', [2 * hw, 0.3, 0.3], [0, ceil - 0.15, z], decor === 'lounge' ? '#141a24' : '#2e2a27');
  if (decor === 'lounge' || decor === 'clinic') {
    for (let z = back + 3.7; z < front - 3; z += 3.4) b.box('emissive', [2 * hw - 1, 0.03, 0.05], [0, ceil - 0.31, z], bar.accent, { intensity: 0.45 });
  }
  if (decor === 'canteen' || decor === 'spare') {
    for (const [x, r] of [
      [-6, 0.16],
      [-5.5, 0.1],
      [2, 0.2],
    ] as const) b.rod('metal', [x, ceil - 0.5, back], [x, ceil - 0.5, front], r, '#6a5a4a', 8);
  }
  // Pendant lamps over the counter.
  for (const [x, z] of [
    [3.6, -5.5],
    [3.3, -1.5],
    [3.6, 2.5],
  ] as const) {
    b.rod('metal', [x, ceil, z], [x, 2.55, z], 0.015, '#2a2c30', 4);
    fcyl(b, new Frame([x, 2.4, z], 0), 'metal', 0.28, 0.3, [0, 0, 0], '#2a2c30', { rTop: 0.1, seg: 10 });
    fcyl(b, new Frame([x, 2.25, z], 0), 'emissive', 0.25, 0.03, [0, 0, 0], bar.lamp, { seg: 10, intensity: 3 });
    b.light({ p: [x, 2.2, z], color: bar.lamp, size: 0.7, intensity: 1.4 });
    b.floorGlow(x + 0.4, z, 2.4, 2.4, bar.lamp, 0.3, COUNTER_TOP + 0.01);
  }

  // Counter, stools, back bar.
  const { stools } = counterRun(b, bar);
  for (const s of stools) stool(b, s.pos, bar);
  const backBar = new Frame([hw - 0.45, 0, -1], -Math.PI / 2);
  fbox(b, backBar, 'gloss', [12, 1.0, 0.8], [0, 0.5, 0], bar.counter);
  fbox(b, backBar, 'gloss', [12.1, 0.06, 0.9], [0, 1.02, 0], bar.counterTop);
  fbox(b, backBar, 'emissive', [11.6, 2.2, 0.04], [0, 2.1, -0.36], bar.accent, { intensity: 0.28 });
  for (let lvl = 0; lvl < 3; lvl++) {
    const y = 1.3 + lvl * 0.62;
    fbox(b, backBar, 'glass', [11.6, 0.04, 0.4], [0, y, -0.2], '#ffffff');
    const n = b.low ? 16 : 26;
    for (let i = 0; i < n; i++) {
      if (b.rand() < 0.15) continue;
      const x = -5.6 + (i + 0.5) * (11.2 / n);
      const hgt = 0.26 + b.rand() * 0.18;
      const col = b.pick(bar.bottles);
      fcyl(b, backBar, 'emissive', 0.055, hgt, [x, y + 0.02 + hgt / 2, -0.2], col, { seg: 6, intensity: 0.9 + b.rand() * 1.2 });
      if (!b.low && i % 3 === 0) b.light({ p: backBar.p([x, y + hgt * 0.6, -0.1]), color: col, size: 0.45, intensity: 0.9 });
    }
  }
  b.glow('pool', backBar.p([0, 2.1, -0.3]), 12, 3, backBar.rot(), bar.accent, 0.3);
  // Screen above the back bar.
  const scr = backBar.p([-2.2, 3.55, -0.25]);
  b.box('metal', [0.1, 1.25, 2.3], [scr[0] + 0.06, scr[1], scr[2]], '#1a1c20');
  b.holo('news', (seed % 17) + 1, [scr[0] - 0.02, scr[1], scr[2]], 2.1, 1.1, '#ffffff', 1.1, -Math.PI / 2);
  // Taps.
  for (let i = 0; i < 4; i++) {
    const p = new Frame([4.25, COUNTER_TOP, -3.2 + i * 0.35], 0);
    fcyl(b, p, 'metal', 0.03, 0.4, [0, 0.2, 0], '#c8c0a8', { seg: 6 });
    fbox(b, p, 'hull', [0.05, 0.12, 0.05], [0, 0.44, 0], b.pick(bar.bottles), { intensity: 1.2 });
  }

  // Seating.
  const slots: Slot[] = [];
  const counterSlots: Slot[] = stools
    .filter((_, i) => i % 2 === 0)
    .map((s) => ({ pose: 'sitDrink' as PoseKind, pos: s.pos, yaw: s.yaw, seat: STOOL_SEAT, surface: COUNTER_TOP, reach: 0.72 }));
  const boothSlots: Slot[] = [];
  if (decor === 'canteen') {
    // Long mess tables with benches instead of booths.
    for (const z of [-5.5, -1.2, 3.1]) {
      const f = new Frame([-6.2, 0, z], 0);
      fbox(b, f, 'gloss', [5.2, 0.08, 1.1], [0, 0.78, 0], bar.table);
      for (const sx of [-2.2, 2.2]) fbox(b, f, 'metal', [0.1, 0.74, 0.9], [sx, 0.38, 0], '#4a4d52');
      for (const s of [-1, 1]) {
        fbox(b, f, 'metal', [5.2, 0.08, 0.45], [0, 0.48, s * 0.95], bar.seat);
        fbox(b, f, 'metal', [0.08, 0.46, 0.3], [-2, 0.24, s * 0.95], '#4a4d52');
        fbox(b, f, 'metal', [0.08, 0.46, 0.3], [2, 0.24, s * 0.95], '#4a4d52');
        boothSlots.push({ pose: 'sitTable', pos: f.p([b.range(-1.5, 1.5), 0, s * 0.95]), yaw: s > 0 ? Math.PI : 0, seat: 0.52, surface: 0.8, reach: 0.62 });
      }
      for (let i = 0; i < 3; i++) fbox(b, f, 'hull', [0.35, 0.05, 0.28], [-1.6 + i * 1.5, 0.84, (i % 2 ? 1 : -1) * 0.25], '#c8c8c0');
      b.floorGlow(-6.2, z, 5.5, 2.2, bar.lamp, 0.22, 0.83);
      fcyl(b, new Frame([-6.2, ceil - 0.9, z], 0), 'emissive', 0.3, 0.1, [0, 0, 0], bar.lamp, { seg: 10, intensity: 2.6 });
      b.rod('metal', [-6.2, ceil, z], [-6.2, ceil - 0.85, z], 0.02, '#2a2c30', 4);
      b.light({ p: [-6.2, ceil - 1.0, z], color: bar.lamp, size: 1.0, intensity: 1.2 });
    }
    // Vending machine.
    const vm = new Frame([-hw + 0.6, 0, 7.2], Math.PI / 2);
    fbox(b, vm, 'hull', [1.2, 2.1, 0.9], [0, 1.05, 0], '#8a3a22');
    fbox(b, vm, 'emissive', [0.9, 1.3, 0.04], [0, 1.25, 0.46], '#ffd89a', { intensity: 1.2 });
    b.light({ p: vm.p([0, 1.3, 0.7]), color: '#ffd89a', size: 1.6, intensity: 0.6 });
  } else {
    for (const z of [-5.6, -1.3, 3.0]) booth(b, bar, z, boothSlots);
  }
  const tables: [number, number][] = decor === 'spare' ? [[-1.0, -2.5]] : decor === 'market' ? [[-2.6, -4.6], [-0.6, 0.2], [-3.0, 4.4]] : [[-2.4, -4.3], [-0.8, 0.6]];
  const tableSlots: Slot[] = [];
  for (const [x, z] of tables) {
    highTable(b, bar, x, z);
    tableSlots.push({ pose: 'drink', pos: [x + 0.62, 0, z + 0.35], yaw: -2.1, surface: 1.1 });
    tableSlots.push({ pose: 'crossed', pos: [x - 0.66, 0, z - 0.2], yaw: 1.3 });
  }
  if (decor !== 'canteen' && decor !== 'spare' && decor !== 'market') {
    const rug = new THREE.Color(bar.seat).multiplyScalar(0.7);
    b.box('fabric', [5.6, 0.02, 9.2], [-1.6, 0.011, -1.6], rug, { uv: 1 });
    b.box('fabric', [5.2, 0.021, 8.8], [-1.6, 0.012, -1.6], new THREE.Color(bar.floor).lerp(rug, 0.5), { uv: 1 });
  }
  // Priority order of occupied places: counter, booths, tables, window. The first eight are all in
  // the desktop shot; the front booths at the left edge only fill up after them.
  const byWindow: Slot = { pose: 'hip', pos: [-3.6, 0, back + 1.5], yaw: Math.PI + 0.35 };
  const order: (Slot | undefined)[] = [
    counterSlots[1],
    boothSlots[0],
    tableSlots[2] ?? tableSlots[0],
    tableSlots[0],
    counterSlots[2],
    byWindow,
    tableSlots[1],
    tableSlots[3],
    boothSlots[1],
    counterSlots[3],
    boothSlots[3],
    boothSlots[4],
  ];
  for (const sl of order) if (sl && !slots.includes(sl)) slots.push(sl);

  // Plants.
  const plantSpots: V3[] = [
    [-hw + 0.7, 0, back + 0.8],
    [3.4, 0, back + 0.7],
    [-hw + 0.7, 0, front - 0.9],
    [-5.5, 0, back + 0.7],
    [hw - 0.8, 0, front - 1.2],
    [-hw + 0.7, 0, 5.4],
    [-hw + 0.7, 0, -3.4],
    [-hw + 0.7, 0, 1.0],
    [1.2, 0, back + 0.7],
    [-7.6, 0, back + 0.7],
  ];
  for (let i = 0; i < Math.min(bar.plants, plantSpots.length); i++) {
    plant(b, plantSpots[i]!, decor === 'mess' ? 1.1 : 0.9 + b.rand() * 0.3, decor === 'lounge' ? '#d8dee6' : decor === 'mess' ? '#8a6a4a' : '#6a6e75');
  }
  // Decor extras.
  if (decor === 'mess') {
    // Hydroponic planter shelf under the window band with grow light.
    fbox(b, new Frame([-3.9, 0, back + 0.55], 0), 'wood', [9.6, 0.9, 0.8], [0, 0.45, 0], bar.table);
    for (let i = 0; i < (b.low ? 10 : 16); i++) {
      const leaf = new THREE.IcosahedronGeometry(0.22 + b.rand() * 0.12, 0);
      b.add('plain', leaf, { position: [-8.3 + i * 0.58, 1.05, back + 0.55 + b.range(-0.2, 0.2)], color: b.pick(['#3f8a3a', '#5aa83a', '#7ab84a']), scale: [1, 1.2, 1] });
    }
    b.box('emissive', [9.6, 0.04, 0.12], [-3.9, 1.42, back + 0.55], '#ff7ad8', { intensity: 1.6 });
  }
  if (decor === 'market') {
    // Paper lanterns and a patterned rug.
    const cols = ['#ff5ab0', '#ffb45a', '#5affd8', '#ffe06a'];
    // Lanterns hang over the back half of the room, clear of the camera.
    for (let i = 0; i < 10; i++) {
      const x = -7.6 + (i % 5) * 2.6 + b.range(-0.4, 0.4);
      const z = -6.6 + Math.floor(i / 5) * 3.4 + b.range(-0.4, 0.4);
      const col = cols[i % cols.length]!;
      const y = ceil - 0.75 - b.range(0, 0.35);
      fcyl(b, new Frame([x, y, z], 0), 'emissive', 0.2, 0.36, [0, 0, 0], col, { seg: 8, intensity: 1.3 });
      b.rod('metal', [x, ceil, z], [x, y + 0.18, z], 0.01, '#2a2c30', 3);
      b.light({ p: [x, y, z], color: col, size: 1.1, intensity: 0.8 });
    }
    b.box('fabric', [5.5, 0.02, 7], [-2.5, 0.011, 0], '#8a2a3a', { uv: 1 });
    b.box('fabric', [5.0, 0.021, 6.5], [-2.5, 0.012, 0], '#c8782e', { uv: 1 });
    b.box('fabric', [4.4, 0.022, 5.9], [-2.5, 0.013, 0], '#5a2a4a', { uv: 1 });
  }
  if (decor === 'clinic' || bar.window === 'none') {
    // A viewscreen instead of a window: the star seen through filters.
    b.box('metal', [7.4, 3.0, 0.2], [-3.2, 2.4, back + 0.12], '#c8d0da');
    b.holo('scope', 13, [-3.2, 2.4, back + 0.25], 7, 2.6, bar.accent, 1.3);
  }
  if (decor === 'lounge') {
    // Low divider with a light edge between the booths and the floor.
    b.box('wood', [0.3, 0.95, 9.5], [-7.6, 0.475, -1.3], bar.table, { uv: 2 });
    b.box('emissive', [0.34, 0.04, 9.5], [-7.6, 0.97, -1.3], bar.accent, { intensity: 1.5 });
  }
  // Warm sconces on the back wall between the window and the door.
  for (const x of [4.1, 5.7]) {
    fbox(b, new Frame([x, 2.5, back + 0.2], 0), 'metal', [0.34, 0.5, 0.12], [0, 0, 0], '#2a2c30');
    fbox(b, new Frame([x, 2.5, back + 0.28], 0), 'emissive', [0.24, 0.4, 0.04], [0, 0, 0], bar.lamp, { intensity: 2.2 });
    b.glow('pool', [x, 2.6, back + 0.34], 1.6, 3.2, [0, 0, 0], bar.lamp, 0.4);
    b.light({ p: [x, 2.5, back + 0.45], color: bar.lamp, size: 0.6, intensity: 1.1 });
  }
  // Doorway at the back right.
  const door = new Frame([7.6, 0, back + 0.2], 0);
  fbox(b, door, 'dark', [2.2, 2.6, 0.1], [0, 1.3, 0.05], '#000');
  fbox(b, door, 'metal', [0.25, 2.8, 0.35], [-1.2, 1.4, 0.1], bar.wallTrim);
  fbox(b, door, 'metal', [0.25, 2.8, 0.35], [1.2, 1.4, 0.1], bar.wallTrim);
  fbox(b, door, 'metal', [2.65, 0.25, 0.35], [0, 2.85, 0.1], bar.wallTrim);
  fbox(b, door, 'emissive', [1.9, 0.06, 0.06], [0, 2.7, 0.2], bar.accent, { intensity: 2 });
  b.glow('shaft', door.p([0, 1.3, 0.2]), 2.2, 2.6, door.rot([0, 0, Math.PI]), bar.accent, 0.12);

  // People.
  const anchors: LoungeBuild['anchors'] = [];
  const bartenderPos: V3 = [5.25, 0, -1.2];
  anchors.push({
    id: 'bartender',
    label: bar.bartender.label === 'Bartender' ? 'Bartender' : bar.bartender.label,
    position: addPerson(b, { id: 'bartender', label: 'Bartender', outfit: bar.bartender, pos: bartenderPos, yaw: -Math.PI / 2 - 0.05, pose: 'bartender', surface: COUNTER_TOP, reach: 0.62, seed: seed * 17 + 3 }, style),
  });
  const n = Math.min(bar.patrons, slots.length);
  // Seeded shuffle of the station's regulars, cycled, so a busy bar mixes every role.
  const cast = style.crowd.slice();
  for (let i = cast.length - 1; i > 0; i--) {
    const j = Math.floor(b.rand() * (i + 1));
    [cast[i], cast[j]] = [cast[j]!, cast[i]!];
  }
  for (let i = 0; i < n; i++) {
    const s = slots[i]!;
    const outfit = cast[i % cast.length]!;
    const p = addPerson(b, { id: `patron-${i}`, label: outfit.label, outfit, pos: s.pos, yaw: s.yaw, pose: s.pose, seat: s.seat, surface: s.surface, reach: s.reach, seed: seed * 29 + i * 53 + 7 }, style);
    anchors.push({ id: `patron-${i}`, label: outfit.label, position: p });
  }

  // Lights: ambient, window spill, counter key, booth warmth, back-bar accent.
  const lights: THREE.Light[] = [];
  lights.push(new THREE.HemisphereLight(bar.hemiSky, bar.hemiGround, bar.hemi * 1.45));
  const spill = new THREE.SpotLight(backdrop.starColor.clone().lerp(new THREE.Color(style.outside.spillTint), 0.65), bar.window === 'none' ? 0.25 : style.outside.spill * 0.3, 0, 1.0, 1, 0);
  spill.position.set(-2.5, 6, back - 10);
  spill.target.position.set(-2.5, 0, back + 5);
  lights.push(spill);
  const key = new THREE.SpotLight(bar.key.color, bar.key.intensity, 14, 0.75, 0.7, 1.4);
  key.position.set(2.5, ceil - 0.2, -1);
  key.target.position.set(4.6, 0.8, -1);
  lights.push(key);
  const fa = new THREE.PointLight(bar.fillA.color, bar.fillA.intensity, 14, 1.4);
  fa.position.set(-3.8, 3.2, -1.2);
  lights.push(fa);
  const fb = new THREE.PointLight(bar.fillB.color, bar.fillB.intensity, 12, 1.4);
  fb.position.set(8.5, 2.6, -1);
  lights.push(fb);
  for (const l of lights) {
    b.group.add(l);
    if (l instanceof THREE.SpotLight) b.group.add(l.target);
  }

  const o = BAR_ORIGIN;
  const w = (p: V3): V3 => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  // Anchors are in room space: move them to world space.
  for (const a of anchors) a.position.add(new THREE.Vector3(...o));
  const shots: ViewShots = {
    wide: { pos: w([-1.4, 3.8, 8.2]), target: w([0.8, 1.05, -2.4]), fov: 52 },
    tall: { pos: w([1.2, 3.4, 6.4]), target: w([3.6, 1.2, -1.6]), fov: 62 },
    subject: { center: w([0.5, 1.2, -1.5]), radius: 7.5 },
    tallSubject: { center: w([3.8, 1.2, -1.3]), radius: 2.6 },
    maxPull: 1.08,
    drift: 0.6,
  };
  return { builder: b, lights, shots, anchors };
}

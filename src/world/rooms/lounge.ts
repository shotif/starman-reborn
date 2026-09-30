import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import type { ArtContext } from '../art/types.ts';
import { RoomBuilder } from './builder.ts';
import type { ViewShots } from './camera.ts';
import { addPerson } from './people.ts';
import type { PoseKind } from './people.ts';
import { Frame, crate, fbox, fcyl } from './props.ts';
import { banner, commsRack, fireBarrel, graffiti, missile, neonSign, sampleRack, sofa, tyre, valveWheel } from './setpieces.ts';
import type { NeonShape } from './setpieces.ts';
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

/* ------------------------------------------------------------------------------------------------
 * Generated stations' bars: café tables, dive-bar sofas, hangout crates, and their dressing.
 * ---------------------------------------------------------------------------------------------- */

/** Chair facing local +Z (the table). */
function chair(b: RoomBuilder, pos: V3, ry: number, seat: string, frame: string): void {
  const f = new Frame(pos, ry);
  fbox(b, f, 'fabric', [0.46, 0.08, 0.46], [0, 0.44, 0], seat, { uv: 1 });
  fbox(b, f, 'fabric', [0.46, 0.5, 0.07], [0, 0.73, -0.21], seat, { uv: 1 });
  for (const sx of [-0.19, 0.19]) for (const sz of [-0.19, 0.19]) fbox(b, f, 'metal', [0.04, 0.42, 0.04], [sx, 0.21, sz], frame);
}

/** Where the loose seating goes: tables down the left side, like the booths. */
const LOOSE: [number, number][] = [
  [-6.2, -5.4],
  [-6.0, -1.2],
  [-6.3, 3.0],
];

/**
 * Seating for the generated bars: café tables with chairs (concourse and lab cafés), mismatched
 * sofas round low tables (dive bar), crates and tyres round crate tables (pirate hangout).
 */
function looseSeating(b: RoomBuilder, style: InteriorStyle, slots: Slot[]): void {
  const bar = style.bar;
  const decor = bar.decor;
  const cols = [...(style.hangar.signs ?? []), ...style.hangar.containers];
  for (const [x, z] of LOOSE) {
    const f = new Frame([x, 0, z], 0);
    if (decor === 'cafe' || decor === 'labcafe') {
      fcyl(b, f, 'metal', 0.3, 0.04, [0, 0.02, 0], '#2a2c30', { seg: 10 });
      fcyl(b, f, 'metal', 0.05, 0.74, [0, 0.38, 0], '#8a8f96', { seg: 6 });
      fcyl(b, f, 'gloss', 0.55, 0.05, [0, 0.77, 0], bar.table, { seg: 16 });
      for (let i = 0; i < 2; i++) fcyl(b, f, 'glassWarm', 0.045, 0.1, [0.15 - i * 0.3, 0.85, (i - 0.5) * 0.2], '#ffffff', { seg: 6 });
      for (const [dx, dz] of [
        [-0.85, 0.15],
        [0.85, -0.1],
      ] as const) {
        const ry = Math.atan2(-dx, -dz);
        chair(b, [x + dx, 0, z + dz], ry, bar.seat, '#8a8f96');
        slots.push({ pose: 'sitTable', pos: [x + dx, 0, z + dz], yaw: ry, seat: 0.5, surface: 0.8, reach: 0.5 });
      }
      // Pendant over each table.
      b.rod('metal', [x, BAR.ceil, z], [x, BAR.ceil - 1.1, z], 0.015, '#2a2c30', 4);
      fcyl(b, new Frame([x, BAR.ceil - 1.25, z], 0), 'metal', 0.3, 0.26, [0, 0, 0], bar.counter, { rTop: 0.12, seg: 10 });
      fcyl(b, new Frame([x, BAR.ceil - 1.39, z], 0), 'emissive', 0.26, 0.03, [0, 0, 0], bar.lamp, { seg: 10, intensity: 2.6 });
      b.light({ p: [x, BAR.ceil - 1.45, z], color: bar.lamp, size: 0.9, intensity: 1.2 });
      b.floorGlow(x, z, 2.4, 2.4, bar.lamp, 0.3, 0.8);
    } else if (decor === 'dive') {
      // A sofa against the wall and a mismatched armchair across a low table.
      sofa(b, [x - 1.35, 0, z], Math.PI / 2, b.pick(cols), 3);
      sofa(b, [x + 1.25, 0, z + 0.2], -Math.PI / 2 - 0.3, b.pick(cols), 1);
      fbox(b, f, 'hull', [0.9, 0.42, 1.4], [0, 0.21, 0], '#3a2e28', { uv: 2 });
      for (let i = 0; i < 2; i++) fcyl(b, f, 'glassWarm', 0.045, 0.12, [0.1, 0.48, (i - 0.5) * 0.5], '#ffffff', { seg: 6 });
      slots.push({ pose: 'sitDrink', pos: [x - 1.25, 0, z - 0.35], yaw: Math.PI / 2, seat: 0.47 });
      slots.push({ pose: 'sitDrink', pos: [x + 1.2, 0, z + 0.2], yaw: -Math.PI / 2 - 0.3, seat: 0.47 });
      b.light({ p: f.p([0, 0.6, 0]), color: b.pick(cols), size: 1.2, intensity: 0.5 });
    } else {
      // Pirate hangout: a crate for a table, crates and tyres for seats.
      crate(b, [x, 0, z], [1.1, 0.78, 1.1], '#5a4432', '#2a2220', b.range(-0.2, 0.2));
      fcyl(b, f, 'glassWarm', 0.05, 0.14, [0.2, 0.86, 0.1], '#ffffff', { seg: 6 });
      crate(b, [x - 0.95, 0, z + 0.1], [0.62, 0.48, 0.62], b.pick(style.hangar.containers), '#2a2220', b.rand());
      tyre(b, [x + 0.95, 0, z - 0.1], 2);
      slots.push({ pose: 'sitTable', pos: [x - 0.95, 0, z + 0.1], yaw: Math.PI / 2, seat: 0.5, surface: 0.8, reach: 0.5 });
      slots.push({ pose: 'sitTable', pos: [x + 0.95, 0, z - 0.1], yaw: -Math.PI / 2, seat: 0.5, surface: 0.8, reach: 0.5 });
    }
  }
}

/**
 * What a generated station is proud of, on a lit shelf on the back wall of its canteen or mess
 * (clear of the long tables): ore crystals, a model hull, a valve wheel and gauge, seized goods, a
 * display arm, a missile.
 */
function trophy(b: RoomBuilder, style: InteriorStyle, x: number): void {
  const bar = style.bar;
  const h = style.hangar;
  const { back } = BAR;
  const top = 3.76;
  // A softly lit display board (the piece stands out against it), and the shelf on two brackets.
  const board = new Frame([x, 4.36, back + 0.06], 0);
  fbox(b, board, 'metal', [2.8, 1.36, 0.06], [0, 0, 0], bar.wallTrim);
  fbox(b, board, 'emissive', [2.64, 1.2, 0.02], [0, 0, 0.04], bar.lamp, { intensity: 0.45 });
  b.glow('pool', [x, 4.36, back + 0.12], 3.3, 1.8, [0, 0, 0], bar.lamp, 0.18);
  const shelf = new Frame([x, top, back + 0.45], 0);
  fbox(b, shelf, 'metal', [2.7, 0.08, 0.8], [0, -0.04, 0], bar.wallTrim);
  fbox(b, shelf, 'emissive', [2.7, 0.03, 0.03], [0, -0.07, 0.4], bar.accent, { intensity: 1.6 });
  for (const dx of [-1.0, 1.0]) fbox(b, shelf, 'metal', [0.06, 0.3, 0.6], [dx, -0.23, -0.1], '#2a2c30');
  const k = 1.25;
  const f = new Frame([x, top, back + 0.45], 0, k);
  switch (style.kind) {
    case 'mining-outpost': {
      for (let i = 0; i < 3; i++) b.add('plain', new THREE.IcosahedronGeometry(0.2 * k, 0), { position: f.p([-0.35 + i * 0.35, 0.12, b.range(-0.06, 0.06)]), color: '#4a423a' });
      for (let i = 0; i < 7; i++) {
        const g = new THREE.OctahedronGeometry((0.08 + b.rand() * 0.08) * k, 0);
        g.scale(1, 2.6, 1);
        b.add('emissive', g, { position: f.p([b.range(-0.5, 0.5), 0.36 + b.rand() * 0.2, b.range(-0.1, 0.1)]), rotation: [b.range(-0.5, 0.5), b.rand() * 3, b.range(-0.5, 0.5)], color: h.glow, intensity: 1.8 });
      }
      b.light({ p: f.p([0, 0.5, 0.3]), color: h.glow, size: 1.6, intensity: 0.9 });
      break;
    }
    case 'shipyard': {
      // A model hull on a stand.
      fbox(b, f, 'metal', [0.5, 0.04, 0.3], [0, 0.02, 0], '#3a3d42');
      fcyl(b, f, 'metal', 0.03, 0.34, [0, 0.19, 0], '#8a8f96', { seg: 5 });
      fcyl(b, f, 'hull', 0.16, 1.1, [0, 0.5, 0.05], h.pillar, { rot: [0, 0, Math.PI / 2], seg: 10 });
      fcyl(b, f, 'hull', 0.16, 0.4, [0.75, 0.5, 0.05], h.pillar, { rot: [0, 0, -Math.PI / 2], rTop: 0.01, seg: 10 });
      fbox(b, f, 'hull', [0.45, 0.03, 0.64], [-0.15, 0.46, 0.05], h.accent);
      fcyl(b, f, 'emissive', 0.11, 0.05, [-0.58, 0.5, 0.05], h.glow, { rot: [0, 0, Math.PI / 2], seg: 10, intensity: 2 });
      break;
    }
    case 'refinery': {
      // The first valve off the line, and its gauge, mounted on the board over a length of pipe.
      b.rod('metal', [x - 1.3, top + 0.14, back + 0.3], [x + 1.3, top + 0.14, back + 0.3], 0.09, h.metal, 8);
      fcyl(b, new Frame([x - 0.55, 4.4, back + 0.2], 0), 'metal', 0.09, 0.3, [0, 0, 0], h.metal, { rot: [Math.PI / 2, 0, 0], seg: 8 });
      valveWheel(b, [x - 0.55, 4.4, back + 0.38], 0, 0.5, '#c83a2a');
      const g = new Frame([x + 0.7, 4.36, back + 0.16], 0);
      fcyl(b, g, 'metal', 0.36, 0.12, [0, 0, 0], h.trim, { rot: [Math.PI / 2, 0, 0], seg: 12 });
      fcyl(b, g, 'emissive', 0.3, 0.02, [0, 0, 0.07], '#ffb040', { rot: [Math.PI / 2, 0, 0], seg: 12, intensity: 1.8 });
      fbox(b, g, 'dark', [0.035, 0.26, 0.02], [0.06, 0.07, 0.09], '#000', { rot: [0, 0, -0.6] });
      break;
    }
    case 'customs-depot': {
      // Seized goods behind a hazard rail, under a red seal.
      crate(b, f.p([-0.55, 0, -0.02]), [0.7 * k, 0.5 * k, 0.42 * k], h.containers[1] ?? h.accent, h.trim, 0.1);
      crate(b, f.p([0.3, 0, 0]), [0.55 * k, 0.4 * k, 0.4 * k], h.containers[2] ?? h.accent, h.trim, -0.15);
      crate(b, f.p([0.25, 0.4, 0]), [0.4 * k, 0.3 * k, 0.34 * k], h.containers[0] ?? h.accent, h.trim, 0.3);
      fbox(b, f, 'emissive', [0.46, 0.12, 0.02], [-0.55, 0.3, 0.2], '#ff3a2a', { intensity: 2 });
      for (const dx of [-1.05, 1.05]) fbox(b, f, 'metal', [0.05, 0.36, 0.05], [dx, 0.18, 0.24], h.hazard[0]);
      fbox(b, f, 'plain', [2.1, 0.06, 0.04], [0, 0.3, 0.24], h.hazard[0]);
      break;
    }
    case 'factory': {
      // A display arm reaching along the shelf, beside the works' cog.
      const a = new Frame(f.p([-0.5, 0, 0]), Math.PI / 2, 0.75 * k);
      fcyl(b, a, 'metal', 0.22, 0.3, [0, 0.15, 0], '#2a2c30', { seg: 10 });
      fbox(b, a, 'metal', [0.16, 0.9, 0.16], [0, 0.7, 0.12], h.hazard[0], { rot: [0.35, 0, 0] });
      fbox(b, a, 'metal', [0.12, 0.12, 0.7], [0, 1.1, 0.5], h.hazard[0], { rot: [0.3, 0, 0] });
      fbox(b, a, 'emissive', [0.06, 0.06, 0.06], [0, 0.97, 0.86], '#ffd89a', { intensity: 3 });
      b.add('metal', new THREE.TorusGeometry(0.3, 0.1, 4, 12), { position: [x + 0.95, 4.45, back + 0.18], color: h.hazard[0] });
      break;
    }
    case 'military-base':
      missile(b, f.p([-0.25, 0, 0.04]), Math.PI / 2, h.pillar, h.hazard[0], 1.8, 0.7 * k);
      break;
    default:
      break;
  }
}

/**
 * The generated bars' feature, on the back wall between the window and the door, over the
 * sconces, where the phone's narrow shot sees it too: the station's pride in canteens and messes,
 * a menu in cafés, an instrument screen in lab cafés, neon in dives, a daubed mark under a caged
 * lamp in pirate hangouts, a status screen by a relay's comms rack, a planter in a farm's mess.
 */
function featureWall(b: RoomBuilder, style: InteriorStyle): void {
  const bar = style.bar;
  const h = style.hangar;
  const { back } = BAR;
  const x = 4.75;
  const signs = h.signs && h.signs.length ? h.signs : [bar.accent];
  switch (bar.decor) {
    case 'canteen':
    case 'messhall':
      trophy(b, style, x);
      break;
    case 'cafe':
    case 'labcafe':
    case 'spare': {
      const f = new Frame([x, 4.05, back + 0.06], 0);
      fbox(b, f, 'metal', [2.7, 1.45, 0.08], [0, 0, 0], bar.decor === 'labcafe' ? '#c8d0da' : '#2a2c30');
      fbox(b, f, 'dark', [2.5, 1.25, 0.02], [0, 0, 0.05], '#000');
      const mode = bar.decor === 'cafe' ? 'board' : bar.decor === 'labcafe' ? 'chart' : 'scope';
      b.holo(mode, bar.decor === 'cafe' ? 25 : 31, f.p([0, 0, 0.07]), 2.4, 1.15, bar.decor === 'spare' ? h.glow : bar.accent, 1.3);
      if (bar.decor === 'spare') commsRack(b, [-5.4, 0, back + 0.62], 0, h.wallDark, h.glow);
      break;
    }
    case 'dive':
      neonSign(b, 'glyphs', [x, 4.35, back + 0.12], 0, 2.2, signs[1] ?? signs[0]!, true);
      neonSign(b, 'arrow', [x - 0.3, 3.6, back + 0.12], 0, 1.2, signs[0]!);
      b.glow('pool', [x, 4.0, back + 0.1], 3.2, 2, [0, 0, 0], signs[1] ?? signs[0]!, 0.25);
      break;
    case 'hangout': {
      graffiti(b, [x - 0.4, 4.1, back + 0.14], 0, 1.3, [bar.accent, '#f0f0f0', '#c83a2a']);
      const cage = new Frame([x + 1.05, 4.35, back + 0.3], 0);
      fcyl(b, cage, 'emissive', 0.14, 0.3, [0, 0, 0], '#ff3a24', { seg: 8, intensity: 2 });
      for (let k = 0; k < 4; k++) fbox(b, cage, 'metal', [0.03, 0.42, 0.03], [Math.cos((k * Math.PI) / 2) * 0.19, 0, Math.sin((k * Math.PI) / 2) * 0.19], '#2a2624');
      fbox(b, cage, 'metal', [0.06, 0.06, 0.3], [0, 0.22, -0.15], '#2a2624');
      b.glow('pool', [x + 1.05, 4.25, back + 0.1], 2.4, 2.4, [0, 0, 0], '#ff3a24', 0.35);
      b.light({ p: cage.p([0, 0, 0.1]), color: '#ff3a24', size: 1.2, intensity: 1, blink: 0.6, duty: 0.85, min: 0.4 });
      break;
    }
    case 'mess': {
      // A planter trough on brackets under a grow light, greenery trailing over its edge.
      const f = new Frame([x, 3.55, back + 0.35], 0);
      fbox(b, f, 'wood', [2.6, 0.4, 0.5], [0, 0, 0], bar.table, { uv: 2 });
      for (const dx of [-1, 1]) fbox(b, f, 'metal', [0.06, 0.4, 0.4], [dx, -0.35, -0.05], '#2a2c30');
      const greens = ['#3f8a3a', '#5aa83a', '#7ab84a'];
      const n = b.low ? 7 : 12;
      for (let i = 0; i < n; i++) {
        const leaf = new THREE.IcosahedronGeometry(0.18 + b.rand() * 0.1, 0);
        const t = i / (n - 1);
        const hang = b.rand() < 0.35 ? -b.range(0.3, 0.7) : b.range(0, 0.25);
        b.add('plain', leaf, { position: f.p([-1.15 + t * 2.3, 0.3 + hang, b.range(-0.1, 0.25)]), color: b.pick(greens), scale: [1, 1.3, 1] });
      }
      fbox(b, f, 'metal', [2.5, 0.08, 0.3], [0, 1.2, 0.05], '#3a3d42');
      fbox(b, f, 'emissive', [2.3, 0.04, 0.2], [0, 1.15, 0.05], '#ff7ad8', { intensity: 1.6 });
      b.glow('pool', f.p([0, 0.6, -0.2]), 3, 1.8, [0, 0, 0], '#ff7ad8', 0.22);
      break;
    }
    default:
      break;
  }
}

/** Extra dressing of the generated bars (the hand-built decors have theirs in buildLounge). */
function decorExtras(b: RoomBuilder, style: InteriorStyle): void {
  const bar = style.bar;
  const { hw, back, ceil } = BAR;
  const signs = style.hangar.signs && style.hangar.signs.length ? style.hangar.signs : [bar.accent];
  if (style.hangar.dressing) featureWall(b, style);
  switch (bar.decor) {
    case 'cafe': {
      // Menu boards on the left wall and hanging planters.
      for (const z of [-3.2, 1.8]) {
        const f = new Frame([-hw + 0.08, 2.1, z], Math.PI / 2);
        fbox(b, f, 'metal', [2.2, 1.3, 0.06], [0, 0, 0], '#2a2c30');
        b.holo('board', 21 + Math.round(z), f.p([0, 0, 0.05]), 2, 1.1, bar.accent, 1.1, f.ry);
      }
      for (let i = 0; i < (b.low ? 2 : 4); i++) {
        const x = -5 + i * 1.8;
        const z = -6.5 + (i % 2) * 1.2;
        b.rod('metal', [x, ceil, z], [x, ceil - 0.9, z], 0.01, '#2a2c30', 3);
        fcyl(b, new Frame([x, ceil - 1.05, z], 0), 'plain', 0.28, 0.3, [0, 0, 0], '#b8704a', { rTop: 0.34, seg: 8 });
        for (let k = 0; k < 4; k++) b.add('plain', new THREE.IcosahedronGeometry(0.16, 0), { position: [x + b.range(-0.25, 0.25), ceil - 1.2 - b.rand() * 0.3, z + b.range(-0.25, 0.25)], color: b.pick(['#3f8a3a', '#5aa83a', '#7ab84a']) });
      }
      break;
    }
    case 'labcafe': {
      // A sample fridge and an instrument screen at the far end of the left wall (in shot).
      sampleRack(b, [-hw + 0.45, 0, -6.6], Math.PI / 2, '#e8ecf0', [bar.accent, '#9affc8', '#ffd07a']);
      const f = new Frame([-hw + 0.08, 2.2, -3.6], Math.PI / 2);
      fbox(b, f, 'dark', [2.4, 1.3, 0.06], [0, 0, 0], '#000');
      b.holo('chart', 19, f.p([0, 0, 0.05]), 2.3, 1.2, bar.accent, 1.3, f.ry);
      break;
    }
    case 'messhall': {
      // Colours on the back wall, one over each window.
      const emblem = style.hangar.emblem ?? 'star';
      for (const x of [-6.9, -3.1, 0.7]) banner(b, [x, 4.45, back + 0.2], 0, 1.0, 0.9, signs[0]!, signs[1] ?? '#f0f0f0', emblem);
      // Notice board by the door.
      const f = new Frame([hw - 0.08, 2.2, 5.8], -Math.PI / 2);
      fbox(b, f, 'metal', [2.2, 1.4, 0.06], [0, 0, 0], '#2a2c30');
      b.holo('board', 27, f.p([0, 0, 0.05]), 2, 1.2, bar.accent, 1.1, f.ry);
      break;
    }
    case 'dive': {
      // Neon on the walls, tags, string lights and a jukebox.
      const shapes: NeonShape[] = ['cup', 'star', 'ring', 'zigzag', 'arrow'];
      neonSign(b, shapes[0]!, [-hw + 0.12, 2.3, -3.2], Math.PI / 2, 0.9, signs[0]!, true);
      neonSign(b, shapes[1]!, [-hw + 0.12, 2.4, 1.2], Math.PI / 2, 0.8, signs[1] ?? signs[0]!);
      neonSign(b, shapes[2]!, [-4.6, 3.6, back + 0.35], 0, 0.9, signs[2] ?? signs[0]!);
      graffiti(b, [-hw + 0.14, 1.1, 5.4], Math.PI / 2, 0.7, [...signs, '#f0f0f0']);
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        b.light({ p: [-hw + 0.6 + t * (2 * hw - 5), ceil - 0.5 - Math.sin(t * Math.PI * 3) * 0.2, back + 2 + t * 5], color: signs[i % signs.length]!, size: 0.3, intensity: 2.2, blink: 0.4, phase: i * 0.2, duty: 0.8, min: 0.5 });
      }
      const j = new Frame([-hw + 0.55, 0, 6.6], Math.PI / 2);
      fbox(b, j, 'hull', [1.1, 1.6, 0.7], [0, 0.8, 0], '#3a2a3a');
      fbox(b, j, 'emissive', [0.8, 0.5, 0.05], [0, 1.2, 0.36], signs[0]!, { intensity: 1.8 });
      fbox(b, j, 'emissive', [0.9, 0.06, 0.05], [0, 0.6, 0.36], signs[1] ?? signs[0]!, { intensity: 2 });
      b.light({ p: j.p([0, 1.2, 0.6]), color: signs[0]!, size: 1.4, intensity: 0.6 });
      break;
    }
    case 'hangout': {
      // A fire barrel, red lanterns, scrap on the walls and hanging chains.
      fireBarrel(b, [-3.3, 0, -0.9], '#4a3024');
      for (let i = 0; i < 6; i++) {
        const x = -7 + (i % 3) * 3.2;
        const z = -6.4 + Math.floor(i / 3) * 4;
        const y = ceil - 0.8 - b.range(0, 0.3);
        b.rod('metal', [x, ceil, z], [x, y + 0.2, z], 0.012, '#2a2624', 3);
        fcyl(b, new Frame([x, y, z], 0), 'emissive', 0.16, 0.3, [0, 0, 0], '#ff3a24', { seg: 8, intensity: 1.6 });
        b.light({ p: [x, y, z], color: '#ff3a24', size: 1, intensity: 0.8 });
      }
      const rusts = ['#5a3222', '#6a4030', '#3a2c26', '#704a2a'];
      for (let i = 0; i < (b.low ? 4 : 8); i++) {
        b.box('hull', [0.08, b.range(0.6, 1.3), b.range(0.7, 1.6)], [-hw + 0.08, b.range(1, 3.6), b.range(-7, 7)], b.pick(rusts), { rot: [b.range(-0.3, 0.3), 0, 0], uv: 2 });
      }
      for (let i = 0; i < 3; i++) b.rod('metal', [-1 + i * 1.8, ceil, -5 + i * 2], [-1 + i * 1.8, ceil - b.range(1, 1.8), -5 + i * 2], 0.04, '#26221f', 4);
      break;
    }
    default:
      break;
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
  const wallKey = decor === 'lounge' || decor === 'market' || decor === 'mess' || decor === 'cafe' ? 'wood' : 'hull';
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
  const beam = decor === 'lounge' ? '#141a24' : decor === 'labcafe' ? '#c8d0da' : decor === 'cafe' ? '#5a4a3e' : '#2e2a27';
  for (let z = back + 2; z < front; z += 3.4) b.box('metal', [2 * hw, 0.3, 0.3], [0, ceil - 0.15, z], beam);
  if (decor === 'lounge' || decor === 'clinic' || decor === 'labcafe' || decor === 'cafe') {
    for (let z = back + 3.7; z < front - 3; z += 3.4) b.box('emissive', [2 * hw - 1, 0.03, 0.05], [0, ceil - 0.31, z], bar.accent, { intensity: 0.45 });
  }
  if (decor === 'canteen' || decor === 'spare' || decor === 'messhall' || decor === 'hangout' || decor === 'dive') {
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
  if (decor === 'cafe' || decor === 'labcafe' || decor === 'dive' || decor === 'hangout') {
    looseSeating(b, style, boothSlots);
  } else if (decor === 'canteen' || decor === 'messhall') {
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
  const tables: [number, number][] =
    decor === 'spare' || decor === 'hangout'
      ? [[-1.0, -2.5]]
      : decor === 'market'
        ? [
            [-2.6, -4.6],
            [-0.6, 0.2],
            [-3.0, 4.4],
          ]
        : [
            [-2.4, -4.3],
            [-0.8, 0.6],
          ];
  const tableSlots: Slot[] = [];
  for (const [x, z] of tables) {
    highTable(b, bar, x, z);
    tableSlots.push({ pose: 'drink', pos: [x + 0.62, 0, z + 0.35], yaw: -2.1, surface: 1.1 });
    tableSlots.push({ pose: 'crossed', pos: [x - 0.66, 0, z - 0.2], yaw: 1.3 });
  }
  if (decor === 'lounge' || decor === 'mess' || decor === 'clinic' || decor === 'dive') {
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
  const pot = decor === 'lounge' || decor === 'labcafe' ? '#d8dee6' : decor === 'mess' ? '#8a6a4a' : decor === 'cafe' ? '#b8704a' : '#6a6e75';
  for (let i = 0; i < Math.min(bar.plants, plantSpots.length); i++) {
    plant(b, plantSpots[i]!, decor === 'mess' ? 1.1 : 0.9 + b.rand() * 0.3, pot);
  }
  decorExtras(b, style);
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
  const spill = new THREE.SpotLight(backdrop.starColor.clone().lerp(new THREE.Color(style.outside.spillTint), 0.65), bar.window === 'none' ? 0.25 : style.outside.spill * (bar.spill ?? 0.3), 0, 1.0, 1, 0);
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

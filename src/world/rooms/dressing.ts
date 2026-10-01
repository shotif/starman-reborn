import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import { boulder } from './architecture.ts';
import { floorDigit, hazardBand, paintStrip } from './builder.ts';
import type { RoomBuilder } from './builder.ts';
import { HALL, PAD } from './layout.ts';
import { MOTION } from './motion.ts';
import type { Motion } from './motion.ts';
import { Frame, commodityPallet, crate, drum, fbox, fcyl, loader, mbox, toolArm, turret } from './props.ts';
import {
  banner,
  bench,
  bollard,
  cargoTug,
  clutterAt,
  commsRack,
  conveyor,
  cryoCanister,
  fireBarrel,
  floodlights,
  graffiti,
  hTank,
  hotVent,
  hullSection,
  hydroponicRack,
  labBench,
  missile,
  neonSign,
  oreCart,
  overheadConveyor,
  pipe,
  planterBed,
  plateJig,
  pottedTree,
  produceCrate,
  rails,
  safetyCage,
  sampleRack,
  scannerArch,
  scrapPile,
  sofa,
  stall,
  tank,
  tyre,
  valveWheel,
  weaponRack,
  workLight,
} from './setpieces.ts';
import type { NeonShape } from './setpieces.ts';
import type { DressingKind, HangarLook } from './styles.ts';

/**
 * Set dressing for generated stations: each station type lists the modules that give it its
 * character (styles `hangar.dressing`), built in order into the hall's free zones:
 *
 * - the flanks between the pad plate and the pillars (x ≈ ±17, between the pillar rows at
 *   z -22 and 2), seen either side of the ship on the deck and at the edges of the side shots;
 * - the back corners beside the mouth, the walls, and overhead under the roof.
 *
 * The trader's floor holds the station's goods (`buildGoods`). Hand-built stations have their own
 * dressing in hangar.ts and never reach this module.
 */

/** Centre line of the flanks, and their clear run between the pillars. */
const FX = 17.2;
const FZ0 = -19;
const FZ1 = -1.5;

type Module = (b: RoomBuilder, h: HangarLook) => void;

const signs = (h: HangarLook): string[] => (h.signs && h.signs.length ? h.signs : [h.accent, h.marking, h.glow]);

/**
 * The clear stretch of back wall between two of its ribs (hangar.ts puts them every 7 m from the
 * mouth out) that is nearest to |x| = `want`: its centre |x| and usable width.
 */
function ribSlot(h: HangarLook, want: number): [number, number] | null {
  const edges: number[] = [];
  for (let x = h.mouth[0] + 5; x < HALL.hw - 1; x += 7) edges.push(x);
  edges.push(HALL.hw + 0.2);
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < edges.length; i++) {
    const c = (edges[i]! + edges[i + 1]!) / 2;
    const w = Math.min(7.2, edges[i + 1]! - edges[i]! - 1.6);
    if (w >= 4 && (!best || Math.abs(c - want) < Math.abs(best[0] - want))) best = [c, w];
  }
  return best;
}

/** Yaw that turns local +Z from (x, z) towards (tx, tz). */
const aim = (x: number, z: number, tx: number, tz: number): number => Math.atan2(tx - x, tz - z);

/** `color` with its lightness (HSL, as the eye sees it: sRGB) held between `least` and `most`. */
function lightness(color: string, least: number, most: number): string {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.l >= least && hsl.l <= most) return color;
  return `#${c.setHSL(hsl.h, hsl.s, Math.min(most, Math.max(least, hsl.l)), THREE.SRGBColorSpace).getHexString()}`;
}

/** A paint colour no paler than a light mid-tone, for goods that pass close under lamps. */
const muted = (color: string): string => lightness(color, 0, 0.6);

const MODULES: Record<DressingKind, Module> = {
  /* ---------------------------------------------------------------- Everyone: owner livery. */
  livery(b, h) {
    const [s0, s1] = signs(h);
    const { hw, back, front } = HALL;
    const [mx, mh] = h.mouth;
    for (const side of [-1, 1]) {
      b.box('paint', [0.06, 0.7, front - back], [side * (hw - 0.62), 10.6, (front + back) / 2], s0!);
      b.box('paint', [0.06, 0.22, front - back], [side * (hw - 0.62), 11.2, (front + back) / 2], s1!);
    }
    b.box('paint', [2 * mx + 2.6, 0.7, 0.06], [0, mh + 2.3, back + 0.45], s0!);
    b.box('paint', [2 * mx + 2.6, 0.22, 0.06], [0, mh + 2.95, back + 0.45], s1!);
  },

  /* ---------------------------------------------------------------- Trade port. */
  gallery(b, h) {
    // Control gallery overlooking the deck: a glass band with a warm interior on the left wall.
    const x = -HALL.hw;
    b.box('dark', [0.4, 3.4, 26], [x + 0.3, 13.2, -12]);
    b.box('glass', [0.1, 3.2, 25.6], [x + 0.62, 13.2, -12]);
    b.box('emissive', [0.1, 0.18, 25.6], [x + 0.5, 11.55, -12], '#ffd29a', { intensity: 1.6 });
    for (let z = -24; z <= 0; z += 3.2) b.box('metal', [0.3, 3.4, 0.25], [x + 0.7, 13.2, z], h.trim);
    b.glow('pool', [x + 0.8, 13.2, -12], 26, 5, [0, Math.PI / 2, 0], '#ffc88a', 0.35);
  },
  'guide-lights'(b, h) {
    for (let z = -26; z < 40; z += 3) {
      for (const s of [-1, 1]) b.light({ p: [s * 15.85, 0.08, z], color: h.glow, size: 0.35, intensity: 2, blink: 0.4, phase: z / 60, duty: 0.6, min: 0.4 });
    }
  },
  concourse(b, h) {
    const [s0, s1] = signs(h);
    const [mx, mh] = h.mouth;
    // A departures board over the bay.
    const dep = new Frame([0, Math.min(mh + 4, 20.6), HALL.back + 0.6], 0);
    fbox(b, dep, 'metal', [11, 3.4, 0.3], [0, 0, 0], h.trim);
    fbox(b, dep, 'dark', [10.6, 3, 0.05], [0, 0, 0.16]);
    b.holo('board', 29, dep.p([0, 0, 0.2]), 10.4, 2.8, h.holo, 1.3);
    fbox(b, dep, 'emissive', [11, 0.14, 0.14], [0, -1.78, 0.2], s0!, { intensity: 1.6 });
    // Holo signs hung over the walkways, facing the deck.
    for (const s of [-1, 1]) {
      for (const z of [-15, -3]) {
        const f = new Frame([s * 15.9, 11.5, z], 0);
        fbox(b, f, 'metal', [4.6, 2.8, 0.2], [0, 0, -0.12], h.trim);
        fbox(b, f, 'dark', [4.3, 2.5, 0.05], [0, 0, 0]);
        b.holo('board', 12 + z + s, f.p([0, 0, 0.04]), 4.2, 2.4, h.holo, 1.3);
        fbox(b, f, 'emissive', [4.6, 0.12, 0.1], [0, -1.46, 0], s0!, { intensity: h.glowLevel });
        for (const dx of [-1.8, 1.8]) b.rod('metal', f.p([dx, 1.4, 0]), f.p([dx, 9.8, 0]), 0.04, h.trim, 4);
      }
    }
    // Advertising screens on the back wall either side of the mouth.
    for (const s of [-1, 1]) {
      const x = s * (mx + 8.5);
      if (Math.abs(x) + 3 > HALL.hw - 1) continue;
      b.box('metal', [6, 3.6, 0.3], [x, 12, HALL.back + 0.3], h.trim);
      b.holo('news', 5 + s, [x, 12, HALL.back + 0.5], 5.6, 3.2, '#ffffff', 1.2);
      b.box('emissive', [6, 0.12, 0.12], [x, 10.1, HALL.back + 0.5], s1!, { intensity: 1.6 });
    }
    // Greenery and benches along the walkways.
    for (const [x, z] of [
      [-14.9, -17],
      [14.9, -17],
      [-14.9, -1],
      [14.9, 5.5],
    ] as const) {
      pottedTree(b, [x, 0, z], h.wallDark, 1);
    }
    for (const s of [-1, 1]) bench(b, [s * 15.1, 0, -9], (-s * Math.PI) / 2, h.accent, h.trim);
    // Info kiosk.
    const k = new Frame([-15.4, 0, 6], Math.PI / 2 + 0.3);
    fbox(b, k, 'hull', [0.8, 1.2, 0.6], [0, 0.6, 0], h.wallDark);
    fbox(b, k, 'dark', [1.2, 1.6, 0.1], [0, 2.1, 0], '#000');
    b.holo('board', 31, k.p([0, 2.1, 0.06]), 1.1, 1.5, h.holo, 1.4, k.ry);
    // Greenery in the workshop's corner too.
    pottedTree(b, [-43.2, 0, -26.4], h.wallDark, 1.1);
  },
  carts(b, h) {
    const lane: Motion = { type: MOTION.slideZ, pivot: [0, 0, 0], speed: 0.09, amp: 9, phase: 0.6 };
    cargoTug(b, [21.8, 0, -6], Math.PI, h.machine, h.containers, lane);
    cargoTug(b, [-21.6, 0, -9], 0.1, h.machine, h.containers);
  },

  /* ---------------------------------------------------------------- Customs depot. */
  'scanner-gates'(b, h) {
    for (const s of [-1, 1]) {
      scannerArch(b, [s * 15.85, 0, -8], 0, 2.4, 3.6, h.wallDark, h.holo);
      // Queue lane of bollards and belts ahead of the gate.
      for (const dx of [-1.25, 1.25]) {
        for (let i = 0; i < 3; i++) bollard(b, [s * 15.85 + dx, 0, -4.5 + i * 2.2], h.hazard[0], '#f2f2f2');
        b.box('plain', [0.04, 0.08, 4.4], [s * 15.85 + dx, 0.8, -2.3], h.accent);
      }
    }
  },
  'hazard-lanes'(b, h) {
    for (const s of [-1, 1]) {
      // A hazard-bordered holding bay on each flank, chevrons to the bay, numbered.
      const x0 = s * 14.5;
      const x1 = s * 20.6;
      hazardBand(b, [x0, FZ0 - 2], [x0, FZ1 + 1], 0.42, h.hazard);
      hazardBand(b, [x1, FZ0 - 2], [x1, FZ1 + 1], 0.42, h.hazard);
      hazardBand(b, [x0, FZ0 - 2], [x1, FZ0 - 2], 0.42, h.hazard);
      hazardBand(b, [x0, FZ1 + 1], [x1, FZ1 + 1], 0.42, h.hazard);
      for (let i = 0; i < 4; i++) {
        const z = FZ0 + 1.5 + i * 4.2;
        for (const d of [-1, 1]) b.decal('paint', [1.5, 0.02, 0.32], [s * FX + d * 0.55, 0.013, z], h.marking, d * 0.7);
      }
      floorDigit(b, s > 0 ? 3 : 1, s * FX - 0.5, FZ1 - 1.4, 1.5, h.marking, 0, 0.015);
      floorDigit(b, s > 0 ? 4 : 2, s * FX + 0.5, FZ1 - 1.4, 1.5, h.marking, 0, 0.015);
      for (let i = 0; i < 4; i++) bollard(b, [s * 14.2, 0, 8.5 + i * 1.4], h.hazard[0], '#f2f2f2');
    }
    // Stop line across the deck before the bay.
    paintStrip(b, 0, HALL.back + 9, 20, 0.5, h.marking);
    hazardBand(b, [-9, HALL.back + 8.2], [9, HALL.back + 8.2], 0.5, h.hazard);
  },
  inspection(b, h) {
    for (const [z, open] of [
      [-15.5, true],
      [-8.5, false],
    ] as const) {
      const f = new Frame([FX + 0.4, 0, z], -Math.PI / 2);
      fbox(b, f, 'hull', [2.6, 0.9, 1.3], [0, 0.45, 0], h.wallDark, { uv: 2 });
      fbox(b, f, 'metal', [2.8, 0.06, 1.4], [0, 0.93, 0], h.metal);
      crate(b, f.p([-0.5, 0.96, 0]), [1.1, 0.7, 0.9], h.containers[1] ?? h.accent, h.trim, f.ry);
      if (open) {
        fbox(b, f, 'hull', [1.1, 0.06, 0.9], [-0.5, 1.9, -0.55], h.containers[1] ?? h.accent, { rot: [1.1, 0, 0] });
        for (let i = 0; i < 3; i++) fbox(b, f, 'plain', [0.3, 0.2, 0.25], [0.5 + i * 0.25, 1.06, (i - 1) * 0.3], b.pick(h.containers));
      }
      // Scanner head hovering over the table.
      const a: Motion = { type: MOTION.hover, pivot: [0, 0, 0], speed: 0.8, amp: 0.12, phase: z };
      const hf = new Frame(f.p([-0.2, 2.6, 0]), f.ry);
      mbox(b, hf, 'm:plain', [0.8, 0.3, 0.6], [0, 0, 0], h.pillar, a);
      mbox(b, hf, 'm:emissive', [0.6, 0.05, 0.4], [0, -0.17, 0], h.holo, a, undefined, { intensity: 2.6 });
      b.glow('shaft', f.p([-0.2, 1.75, 0]), 1.2, 1.6, f.rot([0, 0, Math.PI]), h.holo, 0.4);
      b.floorGlow(f.p([0, 0, 0])[0], z, 3.4, 2.4, h.holo, 0.18);
    }
    hazardBand(b, [FX - 1.4, -18.5], [FX - 1.4, -5.5], 0.3, h.hazard);
    // Impound cage in the workshop's corner, holding seized cargo under a sealed notice.
    safetyCage(b, -44.6, -27.6, -37.2, -19.2, h.hazard[0], 2.6);
    b.cyl('emissive', 0.16, 0.3, [-37.2, 2.8, -27.6], '#ff3a2a', { seg: 8, intensity: 2.2 });
    b.light({ p: [-37.2, 2.95, -27.6], color: '#ff3a2a', size: 1.8, intensity: 2.6, blink: 0.9, duty: 0.35, min: 0.1 });
    const slot = ribSlot(h, 40.5);
    if (slot) {
      const hold = new Frame([-slot[0], 7.4, HALL.back + 0.35], 0);
      const n = Math.floor(slot[1] / 0.6);
      fbox(b, hold, 'metal', [n * 0.6, 2.7, 0.2], [0, 0, 0], '#1e2024');
      for (let i = 0; i < n; i++) {
        for (const y of [-1.2, 1.2]) fbox(b, hold, 'paint', [0.5, 0.2, 0.05], [(i - (n - 1) / 2) * 0.6, y, 0.12], i % 2 ? '#262b33' : h.hazard[0], { rot: [0, 0, 0.6] });
      }
      b.holo('board', 35, hold.p([0, 0, 0.14]), n * 0.6 - 0.8, 1.9, '#ff5a3a', 1.3);
      b.glow('pool', hold.p([0, 0, 0.25]), n * 0.6 + 2, 4.6, [0, 0, 0], '#ff3a2a', 0.2);
    }
    for (let i = 0; i < (b.low ? 2 : 4); i++) {
      crate(b, [-42.6 + (i % 2) * 1.9, (i >> 1) * 1.1, -25.6], [1.6, 1.1, 1.4], b.pick(h.containers), h.trim, b.range(-0.2, 0.2));
    }
    const seal = new Frame([-37.2, 0, -23.4], Math.PI / 2);
    fbox(b, seal, 'metal', [0.1, 2.2, 0.1], [0, 1.1, 0], h.trim);
    fbox(b, seal, 'dark', [1.3, 0.9, 0.06], [0, 2.4, 0], '#000');
    b.holo('board', 33, seal.p([0, 2.4, 0.05]), 1.2, 0.8, '#ff5a3a', 1.4, seal.ry);
  },

  /* ---------------------------------------------------------------- Shipyard. */
  'hull-dock'(b, h) {
    // A hull section in its build frame outside the bay, lit by floodlights.
    const pos: V3 = [-24, 1, -80];
    // Primer-pale plating under the frame's floodlights, and light frames: in dark paint, unlit out
    // here beyond the bay, it read as a flat block.
    hullSection(b, pos, 0.22, 6.5, 30, lightness(h.containers[1] ?? h.pillar, 0.64, 0.72), lightness(h.machine, 0.58, 0.68), 0.55, true);
    const f = new Frame(pos, 0.22);
    for (const x of [-16, -4, 8, 16]) {
      for (const s of [-1, 1]) b.beam('metal', f.p([x, -9, s * 8]), f.p([x, 9, s * 8]), 0.5, h.machine);
      b.beam('metal', f.p([x, 9, -8]), f.p([x, 9, 8]), 0.5, h.machine);
    }
    b.beam('metal', f.p([-16, 9, -8]), f.p([16, 9, -8]), 0.45, h.machine);
    b.beam('metal', f.p([-16, 9, 8]), f.p([16, 9, 8]), 0.45, h.machine);
    for (const x of [-16, 16]) for (const s of [-1, 1]) b.light({ p: f.p([x, 9.5, s * 8]), color: '#fff4d8', size: 3.5, intensity: 1.6 });
    for (let i = 0; i < 4; i++) b.light({ p: f.p([b.range(-12, 10), b.range(-5, 5), 6.8]), color: '#bfe6ff', size: 1.2, intensity: 2.5, blink: 3 + b.rand() * 3, duty: 0.2, min: 0, phase: b.rand() });
    // Inside: a fuselage section on jigs in the back-left corner.
    const inner: V3 = [-31, 4.4, -23];
    hullSection(b, inner, 0, 3.8, 11, h.containers[0] ?? h.pillar, h.trim, 0.4);
    for (const x of [-35, -27]) {
      const j = new Frame([x, 0, -23], 0);
      for (const s of [-1, 1]) fbox(b, j, 'metal', [0.3, 1.2, 0.3], [0, 0.6, s * 2.4], h.machine);
      fbox(b, j, 'metal', [0.5, 0.4, 5.2], [0, 1.2, 0], h.machine);
    }
  },
  'bridge-crane'(b, h) {
    const { hw } = HALL;
    const z = -13.5;
    const y = 19.5;
    for (const s of [-1, 1]) b.box('metal', [0.8, 0.6, HALL.front - HALL.back], [s * (hw - 1.6), y - 0.9, (HALL.front + HALL.back) / 2], h.trim);
    for (const dz of [-0.9, 0.9]) b.box('metal', [2 * hw - 2, 1.4, 0.7], [0, y, z + dz], h.machine);
    for (const s of [-1, 1]) b.box('metal', [2, 1.8, 3.2], [s * (hw - 2), y - 0.2, z], h.trim);
    for (let i = 0; i < 20; i++) b.box('paint', [4.4, 0.4, 0.05], [-hw + 2.2 + i * 4.6, y - 0.3, z + 1.27], h.hazard[i % 2]!);
    const a: Motion = { type: MOTION.slideX, pivot: [0, 0, 0], speed: 0.05, amp: 11, phase: 2.2 };
    const f = new Frame([-8, y + 0.4, z], 0);
    mbox(b, f, 'm:metal', [3, 1.4, 2.8], [0, 0.2, 0], h.trim, a);
    for (const dx of [-0.6, 0.6]) mbox(b, f, 'm:metal', [0.07, 8.8, 0.07], [dx, -4.6, 0], '#1e1f22', a);
    mbox(b, f, 'm:metal', [1.6, 0.8, 1.2], [0, -9.2, 0], h.hazard[0], a);
    const plate = new THREE.CylinderGeometry(4.2, 4.2, 3.2, 10, 1, true, -0.55, 1.1);
    plate.rotateZ(Math.PI / 2);
    b.addMotion('m:metal', plate, { position: f.p([0, -14.3, -0.5]), color: h.containers[1] ?? h.pillar, a });
    for (const dx of [-1.2, 1.2]) mbox(b, f, 'm:metal', [0.05, 1.6, 0.05], [dx, -10.2, 0], '#1e1f22', a);
    b.light({ p: f.p([0, -0.6, 1.5]), color: '#ffb040', size: 0.8, intensity: 2.2, blink: 0.9, duty: 0.4, min: 0.1 });
  },
  welders(b, h) {
    for (const [x, z] of [
      [-FX, -12],
      [FX, -9],
    ] as const) {
      const s = Math.sign(x);
      plateJig(b, [x, 0, z], Math.PI / 2, h.machine, h.containers[1] ?? h.pillar);
      toolArm(b, [x - s * 2.6, 0, z + 1.4], s > 0 ? Math.PI / 2 - 0.3 : -Math.PI / 2 + 0.3, h.machine, h.trim, '#bfe6ff');
      b.floorGlow(x, z, 5, 5, '#9fd8ff', 0.2);
    }
    for (const x of [-FX, FX]) {
      for (let i = 0; i < 4; i++) b.box('hull', [2.6, 0.12, 1.6], [x, 0.1 + i * 0.13, -4], i % 2 ? h.metal : h.pillar, { ry: b.range(-0.1, 0.1), uv: 2 });
    }
  },

  /* ---------------------------------------------------------------- Mining outpost. */
  'ore-carts'(b, h) {
    const paint = `#${new THREE.Color(h.machine).multiplyScalar(0.8).getHexString()}`;
    for (const s of [-1, 1]) {
      rails(b, s * 15.6, -29, 12, '#6a6e75', '#3a2e24');
      for (const z of s < 0 ? [-14, -5.5] : [-16, -3]) oreCart(b, [s * 15.6, 0.1, z], 0, paint, h.wallDark, h.wall, b.rand() < 0.6 ? h.glow : undefined);
    }
  },
  'work-lights'(b, h) {
    const white = new THREE.Color(h.lamp).lerp(new THREE.Color('#f4f8ff'), 0.6);
    const lamp = `#${white.getHexString()}`;
    for (const [x, z] of [
      [-14.6, 9],
      [14.8, 8],
      [-15.6, -21],
      [15.8, -22.5],
    ] as const) {
      workLight(b, [x, 0, z], aim(x, z, PAD.x, PAD.z), lamp, h.lampLevel);
    }
    // Floodlight clusters bolted into the rock over the bay and high in the back corners.
    const [mx, mh] = h.mouth;
    for (const s of [-1, 1]) floodlights(b, [s * mx * 0.5, mh + 0.9, HALL.back + 3.4], 0, lamp, h.lampLevel, 3.2);
    for (const s of [-1, 1]) floodlights(b, [s * (HALL.hw - 2), 11, -21], (-s * Math.PI) / 2, lamp, h.lampLevel, 1.8);
  },
  rubble(b, h) {
    const { hw, back } = HALL;
    const clusters: V3[] = [
      [-hw + 1.5, 0, -18],
      [-hw + 1.5, 0, 12],
      [hw - 1.6, 0, -27],
      [-(h.mouth[0] + 3), 0, back + 1.4],
      [h.mouth[0] + 3, 0, back + 1.4],
      [-21, 0, -27.5],
    ];
    for (const c of clusters) {
      for (let i = 0; i < (b.low ? 3 : 6); i++) {
        const s = b.range(0.35, 1.3);
        boulder(b, [c[0] + b.range(-1.6, 1.6), 0, c[2] + b.range(-1.6, 1.6)], [s, s * b.range(0.6, 1), s], h.wallDark, h.wall);
      }
    }
  },
  'ore-bins'(b, h) {
    for (const s of [-1, 1]) {
      const f = new Frame([s * (h.mouth[0] + 5), 0, HALL.back + 3.2], 0);
      fbox(b, f, 'hull', [4, 1.8, 3], [0, 0.9, 0], h.wallDark, { uv: 2 });
      for (let i = 0; i < 4; i++) fbox(b, f, 'paint', [0.8, 0.3, 0.05], [-1.5 + i, 1.5, 1.52], h.hazard[i % 2]!, { rot: [0, 0, 0.6] });
      for (let k = 0; k < (b.low ? 4 : 7); k++) boulder(b, f.p([b.range(-1.5, 1.5), 1.7, b.range(-1, 1)]), [0.5, 0.4, 0.5], h.wallDark, h.wall);
    }
  },

  /* ---------------------------------------------------------------- Refinery. */
  pipework(b, h) {
    const { hw, back, front } = HALL;
    const sg = signs(h);
    // Process lines along both walls (above the tanks) and racks crossing overhead.
    for (const s of [-1, 1]) {
      pipe(b, [s * (hw - 1.9), 5.7, back], [s * (hw - 1.9), 5.7, front], 0.55, h.accent, h.trim, 6);
      pipe(b, [s * (hw - 2.1), 6.8, back], [s * (hw - 2.1), 6.8, front], 0.35, h.metal, h.trim, 6);
      for (let z = back + 3; z < front; z += 6) b.box('metal', [1.6, 2.2, 0.3], [s * (hw - 1.4), 6.2, z], h.trim);
    }
    for (const z of [-17, 7]) {
      for (const [dy, r, c] of [
        [0, 0.5, h.metal],
        [0.9, 0.36, sg[0]!],
        [1.6, 0.3, h.accent],
      ] as const) pipe(b, [-hw, 16 + dy, z], [hw, 16 + dy, z], r, c, h.trim, 8);
      for (const x of [-30, -10, 10, 30]) b.rod('metal', [x, 15.4, z], [x, 22.8, z], 0.08, h.trim, 4);
    }
    // Risers down to valve stations at the flanks.
    for (const s of [-1, 1]) {
      const x = s * 15.3;
      pipe(b, [x, 16, -17], [x, 0.2, -17], 0.4, h.metal, h.trim, 4);
      b.box('metal', [1.3, 1.1, 1.3], [x, 0.55, -17], h.wallDark);
      valveWheel(b, [x - s * 0.72, 1.6, -17], (-s * Math.PI) / 2, 0.4, '#c83a2a');
    }
  },
  tanks(b, h) {
    const band = h.hazard[0];
    tank(b, [-(h.mouth[0] + 5.5), 0, -24.8], 2.8, 10, h.pillar, band, h.glow);
    tank(b, [21.3, 0, -26.8], 2.1, 8, h.pillar, band, h.glow);
    tank(b, [-FX, 0, -13.5], 1.6, 5.5, h.metal, band, h.glow);
    tank(b, [-FX, 0, -6.5], 1.6, 5.5, h.metal, band, h.glow);
    // Horizontal tanks along the trader's wall instead of containers.
    for (const z of [-24, -15, -6, 3]) hTank(b, [HALL.hw - 2.6, 0, z], 0, 1.4, 6.6, h.pillar, band);
  },
  heat(b, h) {
    const heat = '#ff6a1a';
    const vents: [number, number][] = [
      [FX, -15],
      [FX, -7],
      [-(h.mouth[0] + 5.5), -20.8],
    ];
    for (const [x, z] of vents) {
      hotVent(b, [x, 0, z], 0, 2.2, 1.4, heat, h.trim);
      // Heat shimmer rising off the vent, and embers.
      b.holo('curtain', 0, [x, 3, z], 2.6, 5.4, '#ff8a3a', 0.16, 0.35);
      for (let i = 0; i < 3; i++) b.light({ p: [x + b.range(-0.8, 0.8), 0.4 + b.rand() * 2.5, z + b.range(-0.4, 0.4)], color: '#ffa040', size: 0.25, intensity: 2.4, blink: 1.5 + b.rand() * 2, duty: 0.4, min: 0.1, phase: b.rand() });
    }
    // Furnace mouth in the back wall when there is room beside the bay.
    const x = -(h.mouth[0] + 4);
    if (-x + 2.4 < 29) {
      const f = new Frame([x, 0, HALL.back + 0.4], 0);
      fbox(b, f, 'metal', [4.6, 4.4, 0.8], [0, 2.2, 0], h.trim);
      fbox(b, f, 'emissive', [3.2, 2.4, 0.1], [0, 2.0, 0.42], heat, { intensity: 2.2 });
      b.glow('pool', f.p([0, 2.4, 0.6]), 7, 6, f.rot(), heat, 0.5);
      b.floorGlow(x, HALL.back + 3, 7, 6, heat, 0.5);
      b.light({ p: f.p([0, 2, 1.2]), color: heat, size: 4, intensity: 1.4, blink: 0.7, duty: 0.8, min: 0.7 });
    }
  },

  /* ---------------------------------------------------------------- Factory. */
  conveyors(b, h) {
    // Goods ride right under the work lamps: pale paint would glare white there, so it is toned down
    // (and matte: see the conveyors in setpieces.ts).
    const goods = [...h.containers.slice(0, 4), '#8a8f86'].map((c) => muted(c));
    for (const s of [-1, 1]) conveyor(b, s * FX, FZ0, FZ1, h.trim, h.machine, goods, s > 0 ? 0.9 : -0.9, h.glow);
    // Parts riding overhead lines past the pad and through the workshop.
    const parts = [h.machine, h.hazard[0], h.containers[1] ?? h.accent, '#6a6e75'].map((c) => muted(c));
    overheadConveyor(b, -8.6, 12.5, HALL.back + 3, 4, h.trim, parts, 1.1, HALL.ceil - 2.2);
    overheadConveyor(b, -36, 11.5, HALL.back + 2, 10, h.trim, parts, -0.8, HALL.ceil - 2.2);
  },
  'robot-arms'(b, h) {
    for (const s of [-1, 1]) {
      for (const z of [-14, -6.5]) toolArm(b, [s * 14.9, 0, z], (s * Math.PI) / 2, h.hazard[0], h.trim, '#ffd89a', { scale: 1.15 });
      b.light({ p: [s * 14.9, 3.4, -10.2], color: '#ffb040', size: 0.8, intensity: 2.2, blink: 0.9, duty: 0.4, min: 0.1 });
    }
    // An assembly cell in the workshop's corner: a caged arm welding a machine on a jig.
    safetyCage(b, -31, -27.4, -23.6, -20.6, h.hazard[0]);
    const cell = new Frame([-28.6, 0, -24], 0);
    fbox(b, cell, 'metal', [2.6, 0.6, 2], [0, 0.3, 0], h.trim);
    fbox(b, cell, 'hull', [1.8, 1.2, 1.4], [0, 1.2, 0], h.machine, { uv: 2 });
    fcyl(b, cell, 'metal', 0.5, 1.6, [0, 1.3, 0.8], h.metal, { rot: [Math.PI / 2, 0, 0], seg: 12 });
    toolArm(b, [-25.2, 0, -24], -Math.PI / 2, h.hazard[0], h.trim, '#ffd89a', { scale: 1.1 });
    b.floorGlow(-28, -24, 7, 6, '#ffc890', 0.2);
  },

  /* ---------------------------------------------------------------- Agricultural station. */
  planters(b, h) {
    const bed = h.wallDark;
    for (const s of [-1, 1]) {
      planterBed(b, [s * FX, 0, -13.8], s > 0 ? Math.PI : 0, 8.4, bed, '#ff6ad8', s > 0);
      planterBed(b, [s * FX, 0, -5.2], s > 0 ? Math.PI : 0, 6, bed, '#b07aff', s < 0);
      planterBed(b, [s * 16.4, 0, 8.5], s > 0 ? Math.PI : 0, 5, bed, '#ff6ad8', true);
    }
  },
  'grow-lights'(b) {
    for (const s of [-1, 1]) {
      for (const z of [-14, -4]) {
        b.box('metal', [2.4, 0.2, 7], [s * FX, 14.2, z], '#3a3d42');
        b.box('emissive', [2, 0.06, 6.6], [s * FX, 14.08, z], '#ff7ae0', { intensity: 1.6 });
        for (const dz of [-3, 3]) b.rod('metal', [s * FX, 14.3, z + dz], [s * FX, 22.8, z + dz], 0.04, '#3a3d42', 4);
        b.glow('pool', [s * FX, 13.8, z], 3, 7, [Math.PI / 2, 0, 0], '#ff7ae0', 0.3);
      }
    }
    for (const x of [-32, 32]) {
      b.box('emissive', [8, 0.06, 1.2], [x, 18.6, -12], '#c88aff', { intensity: 1.4 });
      b.light({ p: [x, 18.4, -12], color: '#c88aff', size: 4, intensity: 0.5 });
    }
  },
  hydroponics(b, h) {
    const racks: [number, number, number][] = [
      [HALL.hw - 2.4, -23, -Math.PI / 2],
      [HALL.hw - 2.4, -16.5, -Math.PI / 2],
      [HALL.hw - 2.4, -10, -Math.PI / 2],
      [HALL.hw - 2.4, -3.5, -Math.PI / 2],
    ];
    for (const [x, z, ry] of racks) hydroponicRack(b, h, x, z, ry);
    hydroponicRack(b, h, -(h.mouth[0] + 6), -26.2, 0);
  },

  /* ---------------------------------------------------------------- Research station. */
  'lab-benches'(b, h) {
    let k = 0;
    for (const s of [-1, 1]) {
      for (const z of [-15.5, -8]) labBench(b, [s * (FX - 0.2), 0, z], (-s * Math.PI) / 2, '#f2f4f6', h.pillar, h.holo, h.glow, 3 + k++);
      // Tall display stand.
      const f = new Frame([s * FX, 0, -2.6], (-s * Math.PI) / 2);
      fbox(b, f, 'hull', [0.8, 0.4, 0.8], [0, 0.2, 0], h.pillar);
      fbox(b, f, 'metal', [0.12, 2.6, 0.12], [0, 1.5, 0], h.trim);
      fbox(b, f, 'dark', [2.4, 1.4, 0.08], [0, 3.2, 0], '#000');
      b.holo('scope', 40 - k, f.p([0, 3.2, 0.06]), 2.3, 1.3, h.holo, 1.4, f.ry);
    }
  },
  'sample-racks'(b, h) {
    const vials = [h.glow, h.holo, '#9affc8', '#ffd07a'];
    const [mx] = h.mouth;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) sampleRack(b, [s * (mx + 3 + i * 1.7), 0, HALL.back + 0.8], 0, h.pillar, vials);
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) cryoCanister(b, [s * (15.4 + (i % 2) * 1.2), 0, 7 + i * 1.1], 0.42, '#eef0f2', h.glow);
    }
  },
  'floor-seams'(b, h) {
    for (let x = -40; x <= 40; x += 8) b.box('emissive', [0.06, 0.02, 60], [x, 0.011, 8], h.glow, { intensity: 0.9 });
    for (let z = -24; z <= 40; z += 8) b.box('emissive', [84, 0.02, 0.06], [0, 0.011, z], h.glow, { intensity: 0.9 });
  },

  /* ---------------------------------------------------------------- Relay. */
  'relay-racks'(b, h) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < (b.low ? 4 : 7); i++) commsRack(b, [s * (FX + 0.6), 0, FZ0 + 1 + i * 2.3], (-s * Math.PI) / 2, h.wallDark, h.glow);
      // Cable bundles snaking to the pad.
      for (let k = 0; k < 3; k++) b.rod('metal', [s * (FX - 0.8), 0.08, FZ0 + 2 + k * 5], [s * 13.8, 0.08, -8 + k * 2], 0.07, '#1c1d20', 4);
    }
    // A dish on a short mast in the back corner.
    const x = -(h.mouth[0] + 5);
    fbox(b, new Frame([x, 0, HALL.back + 3], 0), 'metal', [1.6, 0.6, 1.6], [0, 0.3, 0], h.trim);
    b.cyl('metal', 0.18, 5, [x, 2.8, HALL.back + 3], h.metal, { seg: 8 });
    const dish = new THREE.SphereGeometry(2.2, b.low ? 10 : 16, 5, 0, Math.PI * 2, 0, 0.9);
    b.add('hull', dish, { position: [x, 6.2, HALL.back + 3], rotation: [-1.1, 0.3, 0], color: h.pillar });
    b.light({ p: [x, 7.4, HALL.back + 4.2], color: '#ff3a2a', size: 0.8, intensity: 2.2, blink: 0.5, duty: 0.2, min: 0.05 });
  },
  'red-beacons'(b) {
    const { hw, back } = HALL;
    for (let z = back + 6; z < 40; z += 12) {
      for (const s of [-1, 1]) b.light({ p: [s * (hw - 1.5), 13.8, z], color: '#ff2a1a', size: 1.2, intensity: 2.2, blink: 0.4, duty: 0.25, phase: z / 50, min: 0.05 });
    }
    for (let i = 0; i < 5; i++) drum(b, [b.range(14, 19), 0, b.range(4, 11)], '#5a2a24');
  },

  /* ---------------------------------------------------------------- Military base. */
  banners(b, h) {
    const [s0, s1] = signs(h);
    const emblem = h.emblem ?? 'star';
    const [mx] = h.mouth;
    for (const s of [-1, 1]) {
      const x = s * (mx + 8.5);
      if (Math.abs(x) + 2.4 < HALL.hw - 1) banner(b, [x, 11, HALL.back + 0.9], 0, 4.4, 10, s0!, s1!, emblem);
      if (!b.low) for (const z of [-18, 2]) banner(b, [s * (HALL.hw - 1.1), 15.8, z], (-s * Math.PI) / 2, 3, 6.5, s0!, s1!, emblem);
    }
    // Colours hung from the roof over the deck, and the emblem over the bay.
    for (const [x, z] of [
      [-15.5, -12],
      [13.8, -13],
    ] as const) {
      banner(b, [x, 11.2, z], 0, 3.2, 6, s0!, s1!, emblem);
      for (const dx of [-1.5, 1.5]) b.rod('metal', [x + dx, 14.4, z], [x + dx, 22.6, z], 0.035, h.trim, 4);
    }
    banner(b, [0, Math.min(h.mouth[1] + 4.2, 19), HALL.back + 0.8], 0, 3.6, 3.6, s1!, s0!, emblem);
  },
  'weapon-racks'(b, h) {
    for (const z of [-17, -11, -5]) weaponRack(b, [-(FX + 1.2), 0, z], Math.PI / 2, h.wallDark, '#3a3d42', h.accent);
    weaponRack(b, [-(h.mouth[0] + 4.5), 0, HALL.back + 0.8], 0, h.wallDark, '#3a3d42', h.accent);
  },
  ordnance(b, h) {
    for (const [z, n] of [
      [-17.5, 2],
      [-12, 2],
      [-6.5, 1],
    ] as const) {
      for (let i = 0; i < n; i++) missile(b, [FX - 0.6 + i * 1.3, 0, z], 0, h.pillar, h.hazard[0]);
    }
    for (let i = 0; i < 4; i++) crate(b, [FX + b.range(-1.2, 1.2), (i % 2) * 0.9, -2.8 - (i >> 1) * 1.4], [1.3, 0.9, 1], '#4e5a3a', h.hazard[0], 0);
    loader(b, [22, 0, -12], Math.PI + 0.25, h.machine, h.hazard, h.lamp);
    turret(b, [-(h.mouth[0] + 7), 0, HALL.back + 6], Math.PI, h.metal, h.trim, { scan: true, scale: 1.3, glow: h.glow });
  },

  /* ---------------------------------------------------------------- Freeport. */
  neon(b, h) {
    const cols = signs(h);
    const shapes: NeonShape[] = ['ring', 'arrow', 'bars', 'zigzag', 'cup', 'star', 'glyphs'];
    const [mx] = h.mouth;
    let i = 0;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x = s * (mx + 4.5 + k * 5.2);
        if (Math.abs(x) > HALL.hw - 2.5) continue;
        neonSign(b, shapes[i % shapes.length]!, [x, 5.5 + ((k + (s > 0 ? 1 : 0)) % 2) * 6.5, HALL.back + 0.5], 0, 3 + (i % 3) * 0.6, cols[i % cols.length]!, i % 3 === 1);
        i++;
      }
      for (const z of [-18, -6, 6]) {
        neonSign(b, shapes[i % shapes.length]!, [s * (HALL.hw - 1.2), 5.5 + (i % 2) * 5, z], (-s * Math.PI) / 2, 2.6, cols[i % cols.length]!, i % 4 === 2);
        i++;
      }
    }
    // A sign over the bay, and neon rings and tubes on the pillars.
    neonSign(b, 'star', [-mx * 0.45, Math.min(h.mouth[1] + 3.6, 18.5), HALL.back + 0.6], 0, 2.6, cols[1] ?? cols[0]!);
    neonSign(b, 'glyphs', [mx * 0.3, Math.min(h.mouth[1] + 3.4, 18.4), HALL.back + 0.6], 0, 3.4, cols[2] ?? cols[0]!, true);
    for (const x of [-19, 19]) {
      for (const z of [-22, 2]) {
        const c = cols[Math.abs(x + z) % cols.length] ?? cols[0]!;
        const g = new THREE.TorusGeometry(2.2, 0.06, 4, 24);
        g.rotateX(Math.PI / 2);
        b.add('emissive', g, { position: [x, 0.3, z], color: c, intensity: 2.4 });
        b.box('emissive', [0.14, 9, 0.14], [x + (x < 0 ? 1.2 : -1.2), 7, z + 1.6], c, { intensity: 2.4 });
        b.light({ p: [x + (x < 0 ? 1.3 : -1.3), 7, z + 1.8], color: c, size: 3, intensity: 0.6 });
      }
    }
  },
  graffiti(b, h) {
    const cols = [...signs(h), '#f0f0f0'];
    const [mx] = h.mouth;
    for (const s of [-1, 1]) {
      for (let i = 0; i < (b.low ? 2 : 4); i++) graffiti(b, [s * b.range(mx + 3, HALL.hw - 3), b.range(1.4, 3.2), HALL.back + 0.45], 0, b.range(0.9, 1.6), cols);
      for (let i = 0; i < (b.low ? 1 : 3); i++) graffiti(b, [s * (HALL.hw - 0.42), b.range(1.4, 2.6), b.range(-26, 8)], (-s * Math.PI) / 2, b.range(1, 1.6), cols);
    }
    for (let i = 0; i < 3; i++) graffiti(b, [b.range(-12, 12), 0.02, b.range(4, 12)], 0, 1.4, cols);
  },
  stalls(b, h) {
    const cols = signs(h);
    const goods = h.containers;
    stall(b, [-FX - 0.3, 0, -14], Math.PI / 2, cols[0]!, h.wallDark, goods, h.lamp);
    stall(b, [-FX - 0.3, 0, -6.5], Math.PI / 2, cols[1] ?? cols[0]!, h.wallDark, goods, h.lamp);
    stall(b, [FX + 0.3, 0, -11], -Math.PI / 2, cols[2] ?? cols[0]!, h.wallDark, goods, h.lamp);
    // String lights between the stalls and the pillars.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const z = FZ0 + t * (FZ1 - FZ0);
        b.light({ p: [s * (FX + 1.5), 4.6 - Math.sin(t * Math.PI) * 0.8, z], color: cols[i % cols.length]!, size: 0.45, intensity: 2, blink: 0.3, phase: i * 0.21, duty: 0.8, min: 0.5 });
      }
    }
  },
  'lounge-furniture'(b, h) {
    const cols = [...h.containers, ...signs(h)];
    for (const s of [-1, 1]) {
      const x = s * 16.2;
      b.box('fabric', [4.2, 0.02, 3.4], [x, 0.012, 7.4], b.pick(cols), { uv: 1 });
      sofa(b, [x + s * 1.2, 0, 7.4], (-s * Math.PI) / 2, b.pick(cols));
      sofa(b, [x - s * 0.4, 0, 9.3], Math.PI, b.pick(cols), 2);
      b.box('hull', [1.2, 0.4, 0.7], [x - s * 0.4, 0.2, 7.4], '#6a4a30', { uv: 2 });
    }
  },
  pennants(b, h) {
    const cols = [...signs(h), h.accent, h.glow];
    for (let i = 0; i < (b.low ? 6 : 10); i++) {
      const x = -40 + i * 9 + b.range(-1, 1);
      const z = HALL.back + 8 + 12 * Math.floor(b.rand() * 4);
      b.box('plain', [2.2, 5.5, 0.05], [x, HALL.ceil - 6, z + 0.6], cols[i % cols.length]!, { uv: 2 });
      b.box('metal', [2.6, 0.12, 0.12], [x, HALL.ceil - 3.3, z + 0.6], h.trim);
    }
  },

  /* ---------------------------------------------------------------- Pirate den. */
  'scrap-piles'(b, h) {
    const rusts = ['#5a3222', '#6a4030', '#3a2c26', '#4a3a30', '#704a2a', h.metal, h.wallDark];
    const [mx] = h.mouth;
    scrapPile(b, [-(mx + 4), 0, HALL.back + 2.6], 3.2, 2.6, rusts);
    scrapPile(b, [mx + 4.5, 0, HALL.back + 3.2], 3, 2.2, rusts);
    scrapPile(b, [-FX - 0.6, 0, -10.5], 3, 2.4, rusts);
    scrapPile(b, [FX + 0.6, 0, -16.5], 2.2, 1.6, rusts);
    turret(b, [FX, 0, -8], 2.4, '#4a3a30', '#5a3222', { plinth: false, scale: 1.1, glow: '#ff3a24' });
  },
  'fire-barrels'(b, h) {
    for (const [x, z] of [
      [-15.8, -3.5],
      [15.6, -12.5],
      [-16, 8.5],
    ] as const) {
      fireBarrel(b, [x, 0, z], '#4a3024');
      // Makeshift seats round the fire: crates, tyres, a salvaged bench seat.
      tyre(b, [x + 1.3, 0, z + 0.4], 2);
      crate(b, [x - 1.2, 0, z + 0.8], [0.9, 0.6, 0.9], b.pick(h.containers), '#2a2422', b.rand());
      const f = new Frame([x + 0.2, 0, z - 1.5], 0.2);
      fbox(b, f, 'fabric', [1.4, 0.4, 0.6], [0, 0.35, 0], '#5a2a24', { uv: 1 });
      fbox(b, f, 'fabric', [1.4, 0.6, 0.18], [0, 0.75, -0.3], '#5a2a24', { rot: [-0.25, 0, 0], uv: 1 });
    }
  },
  wreck(b) {
    const pos: V3 = [-30.5, 2.8, -23.2];
    hullSection(b, pos, 0.25, 3.6, 10, '#4a3a30', '#3a2c26', 0.3);
    for (let i = 0; i < 5; i++) b.box('hull', [b.range(1, 2.4), 0.1, b.range(0.8, 1.8)], [pos[0] + b.range(-5, 5), b.range(0.1, 0.6), pos[2] + b.range(-3, 4)], b.pick(['#5a3222', '#4a3a30', '#6a4030']), { rot: [b.range(-0.4, 0.4), b.rand() * 3, b.range(-0.4, 0.4)], uv: 2 });
    fcyl(b, new Frame([pos[0] + 6.2, 2.2, pos[2] + 1], 0.25), 'metal', 1.8, 2.4, [0, 0, 0], '#2a2624', { rot: [0, 0, Math.PI / 2], rTop: 1.2, seg: 12 });
  },
  chains(b, h) {
    for (let i = 0; i < (b.low ? 5 : 9); i++) {
      const x = b.pick([-1, 1]) * b.range(8, 30);
      const z = b.range(-26, 6);
      const bottom = b.range(8, 15);
      b.rod('metal', [x, 22.6, z], [x, bottom, z], 0.07, '#26221f', 4);
      b.box('metal', [0.3, 0.5, 0.1], [x, bottom - 0.25, z], '#3a3230');
      if (b.rand() < 0.3) crate(b, [x, bottom - 1.6, z], [1, 1, 1], b.pick(h.containers), '#2a2422', b.rand());
    }
  },

  /* ---------------------------------------------------------------- Clutter (busy, run-down). */
  clutter(b, h) {
    const n = Math.round(3 + h.clutter * (b.low ? 4 : 8));
    clutterAt(b, [-19.5, 0, 9.5], 2.4, n, h.containers, h.trim);
    clutterAt(b, [20.5, 0, 10], 2.2, Math.round(n * 0.7), h.containers, h.trim);
    clutterAt(b, [h.mouth[0] + 3, 0, HALL.back + 2.6], 1.4, Math.round(n * 0.5), h.containers, h.trim);
  },
};

/** Builds the station type's set dressing (generated styles only). */
export function buildDressing(b: RoomBuilder, h: HangarLook): void {
  for (const d of h.dressing ?? []) MODULES[d](b, h);
}

/* ------------------------------------------------------------------------------------------------
 * Goods on the trader's floor.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Fills the trader's painted zone (3 × 3 cells) with the station's goods instead of the default
 * medical / parts / deuterium pallets.
 */
export function buildGoods(b: RoomBuilder, h: HangarLook): void {
  const cell = (i: number, j: number): V3 => [25.5 + i * 4, 0, -15 + j * 4.2];
  const skip = (): boolean => b.rand() < 0.35 * (1 - h.clutter);
  const ry = (): number => (b.rand() - 0.5) * 0.12;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (skip()) continue;
      const p = cell(i, j);
      switch (h.goods) {
        case 'ore': {
          if (i < 2) {
            const f = new Frame(p, ry());
            fbox(b, f, 'hull', [2.6, 1.1, 2.0], [0, 0.55, 0], h.wallDark, { uv: 2 });
            for (let k = 0; k < (b.low ? 3 : 6); k++) boulder(b, f.p([b.range(-0.9, 0.9), 1.0, b.range(-0.6, 0.6)]), [0.45, 0.35, 0.45], h.wallDark, h.wall);
          } else {
            // Ice blocks.
            for (let k = 0; k < 3; k++) b.box('plain', [1.1, 0.9, 1.1], [p[0] + (k % 2) * 1.15 - 0.55, 0.45 + (k >> 1) * 0.9, p[2]], '#bfe0f0', { ry: ry() });
          }
          break;
        }
        case 'fuel':
          if (i === 1) hTank(b, [p[0], 0, p[2]], ry(), 0.7, 2.6, h.pillar, h.hazard[0]);
          else commodityPallet(b, p, 'deuterium', ry(), 1);
          break;
        case 'crops':
          if (i < 2) {
            for (let k = 0; k < 4; k++) produceCrate(b, [p[0] + (k % 2) * 1.2 - 0.6, (k >> 1) * 0.58, p[2] + (k % 2 ? 0.3 : -0.3)], ry(), '#8a6a4a', ['#d8402a', '#f0a030', '#5aa83a', '#e8d040']);
          } else {
            b.cyl('glass', 0.8, 2.2, [p[0], 1.1, p[2]], '#ffffff', { seg: 12 });
            b.cyl('metal', 0.85, 0.2, [p[0], 2.2, p[2]], h.trim, { seg: 12 });
            b.cyl('emissive', 0.81, 0.06, [p[0], 0.6, p[2]], '#4ab8ff', { seg: 12, intensity: 1.4, open: true });
          }
          break;
        case 'samples':
          if (i === 0) commodityPallet(b, p, 'medical', ry(), 2);
          else for (let k = 0; k < 4; k++) cryoCanister(b, [p[0] + (k % 2) * 1 - 0.5, 0, p[2] + (k >> 1) * 1 - 0.5], 0.38, '#eef0f2', h.glow);
          break;
        case 'munitions':
          if (i === 0) {
            for (let k = 0; k < 4; k++) crate(b, [p[0] + (k % 2) * 1.3 - 0.65, (k >> 1) * 0.8, p[2]], [1.2, 0.8, 1.6], '#4e5a3a', h.hazard[0], ry());
          } else missile(b, [p[0], 0, p[2]], Math.PI / 2 + ry(), h.pillar, h.hazard[0], 2.8);
          break;
        case 'scrap':
          if (b.rand() < 0.5) scrapPile(b, p, 1.5, 1.2, ['#5a3222', '#6a4030', '#3a2c26', h.metal]);
          else crate(b, p, [1.4, 1.1, 1.4], b.pick(h.containers), '#2a2422', b.rand());
          break;
        case 'machinery':
          if (i === 1) {
            const f = new Frame(p, ry());
            for (const sx of [-1.1, 1.1]) fbox(b, f, 'metal', [0.25, 0.9, 1.4], [sx, 0.45, 0], h.trim);
            fcyl(b, f, 'metal', 0.8, 2.8, [0, 1.5, 0], h.metal, { rot: [0, 0, Math.PI / 2], seg: 12 });
            fcyl(b, f, 'metal', 0.62, 0.7, [1.7, 1.5, 0], '#3a3d42', { rot: [0, 0, Math.PI / 2], rTop: 0.8, seg: 12 });
          } else if (i === 2) {
            for (let k = 0; k < 3; k++) {
              b.box('hull', [1, 0.8, 1.2], [p[0] + (k - 1) * 1.05, 0.4, p[2]], '#2e3238', { uv: 2 });
              b.box('emissive', [0.6, 0.06, 0.02], [p[0] + (k - 1) * 1.05, 0.55, p[2] + 0.61], h.glow, { intensity: 1.6 });
            }
          } else commodityPallet(b, p, 'parts', ry(), 2);
          break;
        case 'seized': {
          // Impounded: every pallet tagged with a red seal on a post (the scanner takes one cell).
          if (i === 2 && j === 1) break;
          commodityPallet(b, p, (['medical', 'parts', 'deuterium'] as const)[(i + j) % 3]!, ry(), 1 + ((i + j) % 2));
          const tag = new Frame([p[0] - 0.9, 0, p[2] + 1.25], 0);
          fbox(b, tag, 'metal', [0.06, 1.3, 0.06], [0, 0.65, 0], h.trim);
          fbox(b, tag, 'emissive', [0.46, 0.28, 0.04], [0, 1.35, 0.04], '#ff3a2a', { intensity: 1.8 });
          b.light({ p: tag.p([0, 1.35, 0.1]), color: '#ff3a2a', size: 0.4, intensity: 2, blink: 0.8, duty: 0.5, min: 0.25, phase: i * 0.3 + j * 0.7 });
          break;
        }
        case 'bazaar': {
          // Mismatched crates piled any old how.
          const cols = [...h.containers, ...signs(h)];
          const f = new Frame(p, (b.rand() - 0.5) * 0.5);
          for (let k = 0; k < 4; k++) crate(b, f.p([(k % 2) * 1.25 - 0.62, 0, (k >> 1) * 1.1 - 0.55]), [1.1, 0.8, 1.0], b.pick(cols), '#2a2422', f.ry + (b.rand() - 0.5) * 0.3);
          if (b.rand() < 0.6) crate(b, f.p([b.range(-0.3, 0.3), 0.8, b.range(-0.2, 0.2)]), [0.9, 0.6, 0.8], b.pick(cols), '#2a2422', f.ry + b.rand());
          break;
        }
        case 'hull': {
          const f = new Frame(p, ry());
          fbox(b, f, 'hull', [2.4, 0.14, 2.0], [0, 0.07, 0], '#6a5a44', { uv: 2 });
          if (i < 2) {
            for (let k = 0; k < 5; k++) fbox(b, f, 'hull', [2.3, 0.1, 1.9], [0, 0.2 + k * 0.12, 0], k % 2 ? h.pillar : h.metal, { rot: [0, (b.rand() - 0.5) * 0.1, 0], uv: 2 });
          } else {
            for (let k = 0; k < 4; k++) fbox(b, f, 'metal', [0.3, 0.4, 2.2], [-0.6 + k * 0.4, 0.34 + (k % 2) * 0.4, 0], h.machine);
          }
          break;
        }
        default:
          commodityPallet(b, p, (['medical', 'parts', 'deuterium'] as const)[i]!, ry(), 1 + Math.floor(b.rand() * 2));
      }
    }
  }
  if (h.goods === 'seized') {
    // A pallet halfway through the cargo scanner.
    const p = cell(2, 1);
    scannerArch(b, p, 0, 2.6, 3.2, h.wallDark, h.holo);
    commodityPallet(b, [p[0], 0, p[2] - 0.3], 'parts', 0, 1);
  }
  if (h.goods === 'bazaar') {
    // A striped market awning on poles over the far row, hung with lights.
    const cols = signs(h);
    const [x, z0, z1] = [33.5, -17.4, -4.4];
    for (const z of [z0, z1]) {
      for (const dx of [-1.9, 1.9]) b.box('metal', [0.1, dx < 0 ? 3.2 : 3.8, 0.1], [x + dx, dx < 0 ? 1.6 : 1.9, z], h.trim);
    }
    const n = 6;
    for (let i = 0; i < n; i++) {
      const z = z0 + ((i + 0.5) * (z1 - z0)) / n;
      b.box('fabric', [4.1, 0.05, (z1 - z0) / n + 0.02], [x, 3.5, z], cols[i % 2]!, { rot: [0, 0, 0.15], uv: 1 });
    }
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      b.light({ p: [x - 2.05, 3.05 - Math.sin(t * Math.PI * 4) * 0.12, z0 + t * (z1 - z0)], color: cols[i % cols.length]!, size: 0.45, intensity: 2, blink: 0.3, phase: i * 0.21, duty: 0.8, min: 0.5 });
    }
  }
}

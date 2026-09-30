import * as THREE from 'three';
import type { V3 } from '../art/kit.ts';
import { createPlayerShip } from '../art/ships.ts';
import type { ShipArt } from '../art/ships.ts';
import type { ArtContext } from '../art/types.ts';
import { RoomBuilder, floorDigit, hazardBand, paintRing, paintStrip } from './builder.ts';
import type { ViewShots } from './camera.ts';
import { addPerson } from './people.ts';
import type { PoseKind } from './people.ts';
import {
  Frame,
  ceilingLamp,
  commodityPallet,
  container,
  crate,
  drone,
  drum,
  fbox,
  fcyl,
  loader,
  railing,
  shieldGenerator,
  toolArm,
  turret,
} from './props.ts';
import type { Commodity } from './props.ts';
import type { Backdrop } from './space.ts';
import type { HangarLook, InteriorStyle, Outfit } from './styles.ts';
import type { RoomView, StationInteriorOptions } from './types.ts';

/**
 * The hangar complex: one big hall open to space at the back (the bay mouth), with the player's
 * ship hovering over its pad in the middle, the trader's cargo floor on the right and the
 * outfitter's workshop on the left. The camera moves between the three areas.
 */

export const HALL = { hw: 46, back: -30, front: 46, ceil: 25, wall: 4 };
export const PAD = { x: 0, z: -6, r: 8, moat: 10.4, depth: 4.5 };
const SHIP_YAW = (Math.PI * 5) / 6;
const SHIP_Y = 2.35;
/** Longest ship the pad shows at full size (metres). */
const SHIP_FIT_LENGTH = 17;

export interface HangarBuild {
  readonly builder: RoomBuilder;
  readonly ship: ShipArt;
  readonly lights: THREE.Light[];
  readonly shots: Partial<Record<RoomView, ViewShots>>;
  readonly anchors: Partial<Record<RoomView, { id: string; label: string; position: THREE.Vector3 }[]>>;
  update(dt: number, time: number, camera: THREE.Camera): void;
}

/** Cylindrical band around +Y (inward or outward facing). */
function bandY(r: number, y0: number, y1: number, seg: number, inward: boolean, uvScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const circ = r * Math.PI * 2;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const y of [y0, y1]) {
      pos.push(c * r, y, s * r);
      nrm.push(inward ? -c : c, 0, inward ? -s : s);
      uv.push(((i / seg) * circ) / uvScale, y / uvScale);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    if (inward) idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
    else idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const FLOOR_UP: V3 = [-Math.PI / 2, 0, 0];

/* ------------------------------------------------------------------------------------------------
 * Shell: floor, walls, ceiling, mouth.
 * ---------------------------------------------------------------------------------------------- */

function buildFloor(b: RoomBuilder, h: HangarLook): void {
  const T = 4;
  const a = new THREE.Color(h.floor);
  const c2 = new THREE.Color(h.floorAlt);
  const { hw, back, front } = HALL;
  for (let x = -hw; x < hw; x += T) {
    for (let z = back; z < front; z += T) {
      const cx = x + T / 2;
      const cz = z + T / 2;
      if (Math.abs(cx - PAD.x) < 14 && Math.abs(cz - PAD.z) < 14) continue;
      const edge = Math.min(hw - Math.abs(cx), front - cz, cz - back + 8);
      const ao = 0.62 + 0.38 * THREE.MathUtils.smoothstep(edge, 0, 12);
      const col = (b.rand() < 0.55 ? a : c2).clone().multiplyScalar(ao * (0.93 + b.rand() * 0.14));
      b.quadUp('floor', cx, 0, cz, T, T, col, 8);
    }
  }
  // Plate around the pad with a round cut-out for the moat.
  const shape = new THREE.Shape();
  shape.moveTo(-14, -14);
  shape.lineTo(14, -14);
  shape.lineTo(14, 14);
  shape.lineTo(-14, 14);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, PAD.moat, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 40);
  g.rotateX(-Math.PI / 2);
  b.add('floor', g, { position: [PAD.x, 0, PAD.z], color: c2.clone().multiplyScalar(1.02), uv: 8 });
  // Apron outside the mouth.
  const [mx] = h.mouth;
  for (let x = -mx; x < mx; x += T) {
    for (let z = back - HALL.wall - 8; z < back - HALL.wall - 0.01; z += T) {
      const w = Math.min(T, mx - x);
      b.quadUp('floor', x + w / 2, 0, z + T / 2, w, T, c2.clone().multiplyScalar(0.9 + b.rand() * 0.12), 8);
    }
    b.quadUp('floor', x + Math.min(T, mx - x) / 2, 0, back - HALL.wall / 2, Math.min(T, mx - x), HALL.wall, a, 8);
  }
}

function buildPad(b: RoomBuilder, h: HangarLook, bayNumber: number): void {
  const { x: px, z: pz, r, moat, depth } = PAD;
  const seg = b.low ? 40 : 64;
  b.cyl('metal', r, 0.5, [px, 0, pz], h.metal, { seg });
  const top = new THREE.CircleGeometry(r - 0.15, seg);
  top.rotateX(-Math.PI / 2);
  b.add('floor', top, { position: [px, 0.252, pz], color: new THREE.Color(h.floorAlt).multiplyScalar(1.1), uv: 8 });
  const rim = new THREE.TorusGeometry(r - 0.08, 0.07, 4, seg);
  rim.rotateX(Math.PI / 2);
  b.add('emissive', rim, { position: [px, 0.26, pz], color: h.padGlow, intensity: 1.6 });
  // Pad paint: outer band, dashed ring, inner target ring and the bay number.
  const y = 0.262;
  paintRing(b, px, pz, r - 0.75, 0.32, h.marking, seg, y);
  paintRing(b, px, pz, r - 1.45, 0.12, h.marking2, seg, y, 3);
  paintRing(b, px, pz, 3.1, 0.22, h.marking, 40, y);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.decal('paint', [2.2, 0.02, 0.32], [px + Math.cos(a) * 4.8, y, pz + Math.sin(a) * 4.8], h.marking, -a);
    // Docking clamps on the rim.
    const f = new Frame([px + Math.cos(a) * (r - 0.9), 0.25, pz + Math.sin(a) * (r - 0.9)], -a + Math.PI / 2);
    fbox(b, f, 'metal', [1.4, 0.45, 0.9], [0, 0.22, 0], h.trim);
    fbox(b, f, 'hull', [1.0, 0.12, 0.7], [0, 0.5, 0], h.hazard[0]);
  }
  floorDigit(b, Math.floor(bayNumber / 10) % 10, px - 0.62, pz + 5.2, 1.2, h.marking, 0, y);
  floorDigit(b, bayNumber % 10, px + 0.62, pz + 5.2, 1.2, h.marking, 0, y);
  // Moat: outer and inner walls, floor, glowing strip at the bottom.
  b.add('hull', bandY(moat, -depth, 0, seg, true, 4), { position: [px, 0, pz], color: h.wallDark, uv: 0 });
  b.add('metal', bandY(r, -depth, -0.25, seg, false, 4), { position: [px, 0, pz], color: h.trim, uv: 0 });
  const bottom = new THREE.RingGeometry(r, moat, seg, 1);
  bottom.rotateX(-Math.PI / 2);
  b.add('dark', bottom, { position: [px, -depth, pz] });
  const strip = new THREE.TorusGeometry((r + moat) / 2, 0.08, 4, seg);
  strip.rotateX(Math.PI / 2);
  b.add('emissive', strip, { position: [px, -depth + 0.1, pz], color: h.glow, intensity: h.glowLevel });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = (r + moat) / 2;
    b.light({ p: [px + Math.cos(a) * rr, -depth + 0.4, pz + Math.sin(a) * rr], color: h.glow, size: 1.6, intensity: 0.8 });
    // Ribs on the moat wall.
    b.box('metal', [0.35, depth, 0.5], [px + Math.cos(a) * (moat - 0.2), -depth / 2, pz + Math.sin(a) * (moat - 0.2)], h.trim, { ry: -a });
  }
  // Hazard ring around the moat edge and grated bridges across it.
  const n = b.low ? 36 : 56;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const rr = moat + 0.45;
    b.decal('paint', [2 * rr * Math.sin(Math.PI / n) + 0.02, 0.02, 0.6], [px + Math.cos(a) * rr, 0.015, pz + Math.sin(a) * rr], h.hazard[i % 2]!, -a + Math.PI / 2);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const mid = (r + moat) / 2;
    b.box('grate', [moat - r + 0.8, 0.14, 1.8], [px + Math.cos(a) * mid, 0.03, pz + Math.sin(a) * mid], h.metal, { ry: -a, uv: 2 });
  }
  // Light chase around the pad rim.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    b.light({ p: [px + Math.cos(a) * (r - 0.1), 0.34, pz + Math.sin(a) * (r - 0.1)], color: h.padGlow, size: 0.55, intensity: 1.6, blink: 0.35, phase: i / 24, duty: 0.5, min: 0.35 });
  }
}

function buildWalls(b: RoomBuilder, h: HangarLook, style: InteriorStyle): void {
  const { hw, back, front, ceil } = HALL;
  const len = front - back;
  const zc = (front + back) / 2;
  const kind = style.kind;
  for (const side of [-1, 1]) {
    const x = side * hw;
    b.box('hull', [1, ceil, len], [x + side * 0.5, ceil / 2, zc], h.wall, { uv: 6 });
    b.box('hull', [0.5, 1.6, len], [x - side * 0.25, 0.8, zc], h.wallDark, { uv: 3 });
    b.box('metal', [0.9, 0.9, len], [x - side * 0.45, 8.4, zc], h.trim);
    b.box('metal', [0.9, 0.9, len], [x - side * 0.45, 18.2, zc], h.trim);
    // Accent light line along the wall.
    b.box('emissive', [0.1, 0.12, len], [x - side * 0.92, 8.4, zc], h.glow, { intensity: h.glowLevel });
    for (let z = back + 6; z < front - 1; z += 8) {
      b.box('metal', [1.6, ceil, 1.4], [x - side * 0.8, ceil / 2, z], h.trim);
      b.box('metal', [2.2, 1.2, 1.8], [x - side * 1.1, 0.6, z], h.wallDark);
      // Rib lamp and its wash on the wall.
      b.box('emissive', [0.14, 1.8, 0.5], [x - side * 1.64, 13.2, z], h.lamp, { intensity: h.lampLevel });
      b.light({ p: [x - side * 1.9, 13.2, z], color: h.lamp, size: 2.4, intensity: 0.9 });
      b.glow('pool', [x - side * 1.02, 12.6, z], 7, 12, [0, (side * Math.PI) / -2, 0], h.lamp, 0.1);
      // Panels between ribs: a recessed lower panel with a vent, an upper panel.
      const pz = z + 4;
      if (pz < front - 1) {
        const tone = new THREE.Color(h.wall).multiplyScalar(0.8 + b.rand() * 0.15);
        b.box('hull', [0.3, 5.6, 6.2], [x - side * 0.16, 4.6, pz], tone, { uv: 3 });
        if (b.rand() < 0.6) b.box('dark', [0.1, 1.2, 3.4], [x - side * 0.34, 2.8, pz]);
        if (b.rand() < 0.5) {
          b.box('hull', [0.35, 6, 6.2], [x - side * 0.18, 13.2, pz], tone.clone().multiplyScalar(1.08), { uv: 3 });
        }
      }
    }
    // Pipes with brackets.
    for (const [yy, r, col] of [
      [3.5, 0.24, h.metal],
      [4.2, 0.16, h.accent],
      [4.75, 0.12, h.metal],
    ] as const) {
      b.rod('metal', [x - side * 1.0, yy, back], [x - side * 1.0, yy, front], r, col, b.low ? 6 : 8);
    }
    for (let z = back + 2; z < front; z += 4) b.box('metal', [0.9, 1.8, 0.14], [x - side * 0.6, 4.1, z], h.trim);
    // Catwalk at mid height.
    const cw = 2.6;
    b.box('grate', [cw, 0.16, len], [x - side * (cw / 2 + 1.5), 9.1, zc], h.metal, { uv: 2 });
    b.box('metal', [0.2, 0.4, len], [x - side * (cw + 1.5), 8.9, zc], h.trim);
    if (!b.low) railing(b, [x - side * (cw + 1.55), 9.2, back], [x - side * (cw + 1.55), 9.2, front], 1.1, h.trim);
    for (let z = back + 4; z < front; z += 8) {
      b.box('metal', [0.2, 0.2, 3.6], [x - side * 2.4, 7.8, z], h.trim, { rot: [0, Math.PI / 2, side * 0.6] });
    }
  }
  // Big side doors (outfitter side: to the rest of the station; trader side: cargo lift).
  for (const [side, z, w, hh] of [
    [-1, 24, 9, 7.5],
    [1, 22, 11, 8],
  ] as const) {
    const x = side * hw;
    b.box('dark', [0.6, hh, w], [x - side * 0.1, hh / 2, z]);
    b.box('hull', [0.3, hh - 0.4, w / 2 - 0.1], [x - side * 0.4, hh / 2, z - w / 4], new THREE.Color(h.wallDark).multiplyScalar(1.4), { uv: 3 });
    b.box('hull', [0.3, hh - 0.4, w / 2 - 0.1], [x - side * 0.4, hh / 2, z + w / 4], new THREE.Color(h.wallDark).multiplyScalar(1.3), { uv: 3 });
    for (let i = 0; i < 8; i++) {
      b.box('paint', [0.1, 0.6, (w + 1.4) / 8], [x - side * 0.62, hh + 0.35, z - (w + 1.4) / 2 + ((i + 0.5) * (w + 1.4)) / 8], h.hazard[i % 2]!);
    }
    for (const dz of [-w / 2 - 0.4, w / 2 + 0.4]) b.box('metal', [0.9, hh + 0.8, 0.8], [x - side * 0.45, (hh + 0.8) / 2, z + dz], h.trim);
    b.box('emissive', [0.12, 0.35, 2.4], [x - side * 0.92, hh + 1.3, z], kind === 'barnard-relay' ? '#ff3a2a' : h.glow, { intensity: h.glowLevel });
    b.light({ p: [x - side * 1.1, hh + 1.3, z - 1.4], color: h.hazard[0], size: 0.9, intensity: 2, blink: 0.6, duty: 0.4, min: 0.1 });
    b.light({ p: [x - side * 1.1, hh + 1.3, z + 1.4], color: h.hazard[0], size: 0.9, intensity: 2, blink: 0.6, duty: 0.4, min: 0.1, phase: 0.5 });
  }
  // Front wall (behind the camera; closes reflections).
  b.box('hull', [2 * hw, ceil, 1], [0, ceil / 2, front + 0.5], h.wall, { uv: 6 });
}

function buildCeiling(b: RoomBuilder, h: HangarLook, style: InteriorStyle): void {
  const { hw, back, front, ceil } = HALL;
  b.box('dark', [2 * hw + 2, 0.6, front - back + 2], [0, ceil + 0.3, (front + back) / 2]);
  const spare = style.kind === 'barnard-relay';
  let row = 0;
  for (let z = back + 8; z < front; z += 12, row++) {
    if (b.low) {
      b.box('metal', [2 * hw, 1.8, 0.5], [0, ceil - 1.2, z], h.metal);
      b.box('metal', [2 * hw, 0.3, 1.2], [0, ceil - 2.1, z], h.trim);
    } else {
      b.truss('metal', [-hw, ceil - 1.8, z], [hw, ceil - 1.8, z], 2.4, 16, h.metal, 0.24);
    }
    for (const x of [-32, -12, 12, 32]) {
      if (spare && (row + Math.abs(x)) % 3 !== 0) continue;
      const pool = Math.abs(x) === 32 ? row % 2 === 1 : row === 1 || row === 2;
      ceilingLamp(b, [x, ceil - 3.6, z], 5.5, h.lamp, h.lampLevel, pool && (!spare || x === 12));
      b.rod('metal', [x - 2, ceil - 3.4, z], [x - 2, ceil - 2.6, z], 0.05, h.trim, 4);
      b.rod('metal', [x + 2, ceil - 3.4, z], [x + 2, ceil - 2.6, z], 0.05, h.trim, 4);
    }
  }
  // Longitudinal crane rails over both side areas.
  for (const x of [-38, -24, 24, 38]) b.box('metal', [0.8, 1.0, front - back], [x, ceil - 3.0, (front + back) / 2], h.trim);
}

/** The mouth of the bay, per station: frame, doors or shielding, curtain, apron lights. */
function buildMouth(b: RoomBuilder, h: HangarLook, backdrop: Backdrop): void {
  const { hw, back, ceil, wall } = HALL;
  const [mx, mh] = h.mouth;
  const zc = back - wall / 2;
  // Jambs and header.
  for (const side of [-1, 1]) {
    b.box('hull', [hw - mx, ceil, wall], [side * (mx + hw) / 2, ceil / 2, zc], h.wall, { uv: 6 });
    b.box('metal', [1.4, mh + 1.4, wall + 0.8], [side * (mx + 0.7), (mh + 1.4) / 2, zc], h.trim);
    // Hazard stripes up the inner edge of the frame.
    const n = Math.round(mh / 1.2);
    for (let i = 0; i < n; i++) {
      b.box('paint', [1.4, mh / n, 0.05], [side * (mx + 0.7), (i + 0.5) * (mh / n), back + 0.43], h.hazard[i % 2]!);
    }
    b.box('emissive', [0.14, mh, 0.14], [side * (mx + 0.02), mh / 2, back + 0.45], h.glow, { intensity: h.glowLevel * 1.2 });
    // Wall ribs on the back wall faces.
    for (let x = mx + 5; x < hw - 1; x += 7) {
      b.box('metal', [1.2, ceil, 1.0], [side * x, ceil / 2, back + 0.5], h.trim);
      b.box('emissive', [0.5, 1.6, 0.12], [side * x, 13, back + 1.05], h.lamp, { intensity: h.lampLevel });
      b.light({ p: [side * x, 13, back + 1.3], color: h.lamp, size: 2.2, intensity: 0.8 });
    }
  }
  b.box('hull', [2 * mx, ceil - mh, wall], [0, (ceil + mh) / 2, zc], h.wall, { uv: 6 });
  b.box('metal', [2 * mx + 2.8, 1.6, wall + 0.8], [0, mh + 0.8, zc], h.trim);
  b.box('emissive', [2 * mx, 0.14, 0.14], [0, mh - 0.02, back + 0.45], h.glow, { intensity: h.glowLevel * 1.2 });
  // Floodlights under the header, aimed at the apron.
  const lamps = Math.max(3, Math.round(mx / 5));
  for (let i = 0; i < lamps; i++) {
    const x = -mx + ((i + 0.5) * 2 * mx) / lamps;
    b.box('metal', [1.4, 0.6, 0.9], [x, mh - 0.3, back - 0.8], '#2a2c30');
    b.box('emissive', [1.1, 0.06, 0.6], [x, mh - 0.62, back - 0.8], h.lamp, { intensity: h.lampLevel * 1.2 });
    b.light({ p: [x, mh - 0.8, back - 0.8], color: h.lamp, size: 1.6, intensity: 1.1 });
  }
  // Apron: lip, hazard band, runway lights chasing outwards.
  const lip = back - wall - 8;
  b.box('metal', [2 * mx, 1.6, 0.8], [0, -0.8, lip - 0.4], h.trim);
  hazardBand(b, [-mx, lip + 0.5], [mx, lip + 0.5], 0.9, h.hazard);
  hazardBand(b, [-mx, back + 0.4], [mx, back + 0.4], 0.6, h.hazard);
  for (let i = 0; i < 7; i++) {
    const z = back - 1 - i * 1.7;
    for (const side of [-1, 1]) {
      b.light({ p: [side * (mx - 1.2), 0.12, z], color: side < 0 ? '#ff5040' : '#50ff90', size: 0.7, intensity: 2.2, blink: 0.8, phase: i / 7, duty: 0.25, min: 0.12 });
    }
    b.decal('paint', [0.3, 0.02, 1.0], [0, 0.013, z], h.marking);
  }
  // Atmosphere curtain across the mouth.
  const tint = new THREE.Color('#9fd8ff').lerp(backdrop.starColor, 0.3);
  b.holo('curtain', 0, [0, mh / 2, back + 0.1], 2 * mx, mh, tint, 0.07);

  switch (h.bayKind) {
    case 'blast': {
      // Heavy doors retracted into the frame: top door lowered partly, side door edges showing.
      const d = new THREE.Color(h.wallDark).multiplyScalar(1.3);
      b.box('hull', [2 * mx, 2.6, 1.2], [0, mh - 1.3, back - wall - 0.4], d, { uv: 3 });
      for (let i = 0; i < 12; i++) {
        b.box('paint', [(2 * mx) / 12, 0.5, 0.05], [-mx + ((i + 0.5) * 2 * mx) / 12, mh - 2.35, back - wall + 0.23], h.hazard[i % 2]!);
      }
      for (const side of [-1, 1]) {
        b.box('hull', [3.2, mh, 1.2], [side * (mx - 1.6), mh / 2, back - wall - 0.4], d, { uv: 3 });
        for (let i = 0; i < 8; i++) b.box('paint', [0.05, mh / 8, 0.5], [side * (mx - 3.22), ((i + 0.5) * mh) / 8, back - wall - 0.4], h.hazard[i % 2]!);
        // Hydraulic rams.
        b.rod('metal', [side * (mx + 1.6), 1.5, back + 1.2], [side * (mx + 1.6), mh - 1, back + 1.2], 0.3, '#8a8f96', 10);
        b.rod('metal', [side * (mx + 1.6), 1.5, back + 1.2], [side * (mx + 1.6), 6, back + 1.2], 0.45, h.trim, 10);
      }
      break;
    }
    case 'shielded': {
      // Radiation shielding: stepped frames deepening the aperture and louvers across the top.
      for (let k = 1; k <= 3; k++) {
        const g = k * 0.9;
        const dz = back - wall - k * 1.6;
        for (const side of [-1, 1]) b.box('hull', [1.6 + g, mh + 2 * g, 1.6], [side * (mx + 0.8 + g / 2 - g), (mh + 2 * g) / 2 - g, dz], k % 2 ? '#8e97a3' : '#c9ced6', { uv: 3 });
        b.box('hull', [2 * mx + 3 * g, 1.6 + g, 1.6], [0, mh - g / 2 + 0.8, dz], k % 2 ? '#8e97a3' : '#c9ced6', { uv: 3 });
      }
      const n = 4;
      for (let i = 0; i < n; i++) {
        b.box('hull', [2 * mx - 1, 0.16, 1.3], [0, mh - 0.7 - i * 1.05, back - 1.2], '#d8dde4', { rot: [1.15, 0, 0], uv: 3 });
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) b.light({ p: [side * (mx + 0.6), 1 + i * 2.2, back + 0.8], color: '#ffd23a', size: 0.7, intensity: 2, blink: 0.5, phase: i * 0.2, duty: 0.5, min: 0.3 });
      }
      break;
    }
    case 'modular': {
      for (const side of [-1, 1]) {
        for (let y = 1; y < mh; y += 2.4) {
          b.box('hull', [1.9, 2.1, wall + 1.2], [side * (mx + 1.0), y + 0.2, zc], y % 4.8 < 2.4 ? '#c9d0c6' : '#a9b3a8', { uv: 3 });
          b.light({ p: [side * (mx + 0.3), y + 0.9, back + 0.9], color: '#58f08e', size: 0.45, intensity: 2 });
        }
      }
      break;
    }
    case 'slot': {
      for (const side of [-1, 1]) {
        b.box('hull', [0.8, mh, 1.6], [side * (mx - 0.4), mh / 2, back - wall - 0.8], '#26272a');
        for (let i = 0; i < 4; i++) b.light({ p: [side * (mx + 0.3), 2 + i * 3, back + 0.8], color: '#ff2a1a', size: 1.0, intensity: 2.4, blink: 0.3, phase: i * 0.1 + (side > 0 ? 0.5 : 0), duty: 0.5, min: 0.2 });
      }
      break;
    }
    case 'market': {
      // String lights along the header and pennants.
      const n = b.low ? 16 : 28;
      const cols = [h.marking, h.glow, h.marking2, h.lamp];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = -mx + t * 2 * mx;
        const sag = Math.sin(t * Math.PI * 3) * 0.3 - 0.4 - Math.sin(t * Math.PI) * 0.6;
        b.light({ p: [x, mh + 0.2 + sag, back + 0.9], color: cols[i % cols.length]!, size: 0.55, intensity: 1.8, blink: 0.25, phase: i * 0.37, duty: 0.7, min: 0.55 });
        if (i % 2 === 0 && !b.low) {
          b.box('plain', [0.9, 0.9, 0.04], [x, mh - 0.6 + sag, back + 0.9], cols[(i >> 1) % cols.length]!, { rot: [0, 0, Math.PI / 4] });
        }
      }
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Pillars.
 * ---------------------------------------------------------------------------------------------- */

function pillar(b: RoomBuilder, h: HangarLook, x: number, z: number): void {
  const { ceil } = HALL;
  const H = ceil - 2;
  switch (h.pillarKind) {
    case 'round': {
      b.cyl('hull', 1.3, H, [x, H / 2, z], h.pillar, { seg: 20, uv: 3 });
      b.cyl('metal', 1.75, 1.2, [x, 0.6, z], h.trim, { seg: 20 });
      b.cyl('metal', 1.3, 1.6, [x, H - 0.4, z], h.trim, { rTop: 1.9, seg: 20 });
      for (const y of [3.2, 9.5, 15.8]) b.cyl('emissive', 1.33, 0.16, [x, y, z], h.glow, { seg: 20, intensity: h.glowLevel, open: true });
      b.light({ p: [x, 3.2, z + 1.4], color: h.glow, size: 1.2, intensity: 0.8 });
      break;
    }
    case 'ibeam': {
      const f = new Frame([x, 0, z], 0);
      fbox(b, f, 'metal', [2.0, H, 0.35], [0, H / 2, 0.7], h.pillar);
      fbox(b, f, 'metal', [2.0, H, 0.35], [0, H / 2, -0.7], h.pillar);
      fbox(b, f, 'metal', [0.35, H, 1.1], [0, H / 2, 0], h.pillar);
      fbox(b, f, 'metal', [3.0, 0.6, 2.6], [0, 0.3, 0], h.trim);
      for (let i = 0; i < 6; i++) {
        fbox(b, f, 'paint', [2.04, 0.34, 0.05], [0, 0.8 + i * 0.4, 0.9], h.hazard[i % 2]!, { rot: [0, 0, 0.5] });
      }
      // Knee braces to the truss.
      for (const s of [-1, 1]) b.rod('metal', [x, H - 5, z], [x + s * 5, H - 0.5, z], 0.2, h.trim, 6);
      fbox(b, f, 'emissive', [0.9, 0.3, 0.12], [0, 11, 0.9], h.lamp, { intensity: h.lampLevel });
      b.light({ p: [x, 11, z + 1.1], color: h.lamp, size: 2.6, intensity: 1.1 });
      break;
    }
    case 'modular': {
      const f = new Frame([x, 0, z], 0);
      for (const sx of [-0.7, 0.7]) for (const sz of [-0.7, 0.7]) fbox(b, f, 'metal', [0.34, H, 0.34], [sx, H / 2, sz], h.trim);
      for (let y = 2.5; y < H; y += 3) {
        fbox(b, f, 'hull', [1.9, 0.3, 1.9], [0, y, 0], h.pillar);
        if (y < 12) fbox(b, f, 'hull', [1.5, 2.2, 1.5], [0, y + 1.3, 0], new THREE.Color(h.pillar).multiplyScalar(0.8), { uv: 2 });
      }
      fbox(b, f, 'metal', [2.2, 0.8, 2.2], [0, 0.4, 0], h.wallDark);
      b.light({ p: [x + 0.9, 6, z + 0.9], color: h.glow, size: 0.5, intensity: 2.2 });
      b.light({ p: [x + 0.9, 6.4, z + 0.9], color: '#ffb040', size: 0.5, intensity: 2, blink: 0.4, duty: 0.5, min: 0.2 });
      break;
    }
    case 'lattice': {
      b.truss('metal', [x, 0, z], [x, H, z], 1.8, b.low ? 6 : 10, h.pillar, 0.18);
      b.box('metal', [2.4, 0.5, 2.4], [x, 0.25, z], h.trim);
      b.light({ p: [x, H - 1, z], color: '#ff2a1a', size: 1.2, intensity: 2.2, blink: 0.35, duty: 0.3, min: 0.05, phase: (x + z) * 0.013 });
      break;
    }
    case 'slab': {
      const f = new Frame([x, 0, z], 0);
      fbox(b, f, 'hull', [2.6, H, 1.4], [0, H / 2, 0], h.pillar, { uv: 3 });
      fbox(b, f, 'hull', [3.0, 1.0, 1.8], [0, 0.5, 0], h.wallDark);
      for (const s of [-1, 1]) fbox(b, f, 'emissive', [0.08, H - 3, 0.08], [s * 0.9, H / 2 + 0.5, 0.71], h.glow, { intensity: h.glowLevel });
      fbox(b, f, 'emissive', [2.0, 0.08, 0.08], [0, 2.2, 0.71], h.glow, { intensity: h.glowLevel });
      break;
    }
    case 'hex': {
      b.cyl('hull', 1.45, H, [x, H / 2, z], h.pillar, { seg: 6, uv: 3 });
      b.cyl('metal', 1.9, 1.4, [x, 0.7, z], h.trim, { seg: 6 });
      for (const y of [4.5, 11]) {
        b.cyl('metal', 1.6, 0.4, [x, y, z], h.trim, { seg: 6 });
        const f = new Frame([x, y, z], 0.3);
        fbox(b, f, 'emissive', [0.5, 0.5, 0.5], [0, 0.6, 1.6], h.lamp, { intensity: h.lampLevel });
        b.light({ p: f.p([0, 0.6, 1.7]), color: h.lamp, size: 2.2, intensity: 1.1 });
      }
      break;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Areas.
 * ---------------------------------------------------------------------------------------------- */

const CONTAINER_COLORS: Record<string, string[]> = {
  'earth-port': ['#e8ecf0', '#2f64c8', '#9aa4b0', '#dfe4ea', '#3a78d8'],
  'mars-depot': ['#a8502a', '#7a4a32', '#c8782e', '#5e4a3c', '#8a3a24'],
  'proxima-outpost': ['#2e8a78', '#c9d0c6', '#6e7e74', '#3fae6a', '#d8c880'],
  'barnard-relay': ['#4a4e55', '#5e2a24', '#3a3d42', '#6a6e75'],
  'sirius-platform': ['#eef1f5', '#c9d0d8', '#9fb4cc', '#e2e6ec'],
  'eridani-hub': ['#c8782e', '#2e8a8a', '#a8382a', '#d8a832', '#6a3a7a', '#3a78a8'],
};

function buildDeckDressing(b: RoomBuilder, h: HangarLook, style: InteriorStyle): void {
  const { x: px, z: pz } = PAD;
  // Taxi line from the pad to the mouth, and chevrons pointing out.
  for (let z = pz - PAD.moat - 2; z > HALL.back - 1; z -= 2.2) paintStrip(b, 0, z, 0.3, 1.2, h.marking2);
  for (let i = 0; i < 3; i++) {
    const z = HALL.back + 4 + i * 2.2;
    for (const s of [-1, 1]) b.decal('paint', [2.2, 0.02, 0.45], [s * 0.8, 0.013, z], h.marking, s * 0.6);
  }
  // Walkway lines around the deck.
  for (const s of [-1, 1]) {
    paintStrip(b, s * 15.5, 4, 0.22, 52, h.marking);
    paintStrip(b, s * 16.2, 4, 0.22, 52, h.marking);
  }
  paintStrip(b, 0, 13, 31, 0.22, h.marking);
  // Light towers at the back corners of the pad, floodlights aimed at the ship.
  for (const sx of [-1, 1]) {
    const f = new Frame([px + sx * 12.5, 0, pz - 9.5], sx * 0.6);
    fbox(b, f, 'metal', [1.4, 0.5, 1.4], [0, 0.25, 0], h.wallDark);
    fbox(b, f, 'metal', [0.45, 9, 0.45], [0, 4.6, 0], h.trim);
    fbox(b, f, 'metal', [2.6, 0.3, 0.5], [0, 9.1, 0], h.trim);
    for (const dx of [-0.8, 0.8]) {
      fbox(b, f, 'metal', [0.7, 0.55, 0.6], [dx, 8.7, 0.2], '#2a2c30', { rot: [0.5, 0, 0] });
      fbox(b, f, 'emissive', [0.55, 0.05, 0.45], [dx, 8.45, 0.42], h.lamp, { rot: [0.5, 0, 0], intensity: h.lampLevel * 1.3 });
      b.light({ p: f.p([dx, 8.4, 0.5]), color: h.lamp, size: 1.5, intensity: 1.3 });
    }
    b.light({ p: f.p([0, 9.4, 0]), color: '#ff3a2a', size: 0.7, intensity: 2, blink: 0.5, duty: 0.2, min: 0.05, phase: sx > 0 ? 0.5 : 0 });
  }
  // Tool cart and crates around the pad edge.
  const cart = new Frame([10.5, 0, pz + 7.5], -0.4);
  fbox(b, cart, 'metal', [1.6, 0.1, 0.9], [0, 0.95, 0], h.trim);
  fbox(b, cart, 'metal', [1.6, 0.1, 0.9], [0, 0.35, 0], h.trim);
  for (const sx of [-0.75, 0.75]) for (const sz of [-0.4, 0.4]) fbox(b, cart, 'metal', [0.06, 1.0, 0.06], [sx, 0.5, sz], h.metal);
  fbox(b, cart, 'hull', [0.5, 0.3, 0.35], [-0.35, 1.15, 0], h.accent);
  fbox(b, cart, 'hull', [0.4, 0.2, 0.3], [0.4, 1.1, 0.1], h.hazard[0]);
  crate(b, [12.5, 0, pz + 5.8], [1.2, 1.0, 1.2], h.accent, h.trim, 0.3);
  crate(b, [12.9, 1.0, pz + 5.9], [0.9, 0.7, 0.9], h.hazard[0], h.trim, 0.7);
  crate(b, [-12.4, 0, pz + 7.2], [1.4, 1.1, 1.0], '#8a8f86', h.trim, -0.2);
  if (h.clutter > 0.5) {
    drum(b, [-11.2, 0, pz + 8.6], h.accent);
    drum(b, [-10.5, 0, pz + 9.4], h.trim);
    drum(b, [11.0, 0, pz - 9.5], h.accent, true);
  }
  // Apron defence turrets at the mouth corners (slow scan).
  const [mx] = h.mouth;
  for (const s of [-1, 1]) turret(b, [s * (mx - 3.5), 0, HALL.back - HALL.wall - 5], Math.PI + s * 0.2, h.metal, h.trim, { scan: true, scale: 1.1, glow: h.glow });
  // Maintenance arm reaching in over the pad's rear edge.
  toolArm(b, [px - 9.2, 0, pz - 7.2], 0.85, h.machine, h.trim, h.lamp, { scale: 1.5, sparks: false });
  // Maintenance drones around the ship.
  if (style.kind !== 'barnard-relay') {
    drone(b, [px - 5.5, 5.2, pz + 2.5], h.pillar, h.glow, 0.3);
    if (!b.low) drone(b, [px + 6, 6.4, pz - 3.5], h.pillar, h.glow, 2.1);
  }
}

function buildTrader(b: RoomBuilder, h: HangarLook, style: InteriorStyle, active: boolean): void {
  const cols = CONTAINER_COLORS[style.kind]!;
  const stacks = active ? 1 : 0.6;
  // Containers along the right wall (two rows), stacked.
  const rows: [number, number][] = [
    [42.6, 1],
    [39.9, 0.6],
  ];
  for (const [x, fill] of rows) {
    // Meridian grows food along this wall instead (see the station extras).
    if (style.kind === 'proxima-outpost' && x > 42) continue;
    for (let z = HALL.back + 4; z < 14; z += 6.4) {
      if (b.rand() > fill * stacks * (0.35 + 0.65 * h.clutter) + 0.15) continue;
      const levels = 1 + Math.floor(b.rand() * (x > 41 ? 3 : 2));
      for (let l = 0; l < levels; l++) container(b, [x, l * 2.62, z], b.pick(cols), 0);
    }
  }
  // Back corner stack across the wall.
  for (let x = 26; x < 38; x += 2.6) {
    if (b.rand() < 0.3 + 0.4 * (1 - h.clutter)) continue;
    const levels = 1 + Math.floor(b.rand() * 2);
    for (let l = 0; l < levels; l++) container(b, [x, l * 2.62, HALL.back + 3.6], b.pick(cols), Math.PI / 2);
  }
  if (!active) return;
  // Commodity pallets in a painted zone, colour-coded (medical / fabricator parts / deuterium).
  const kinds: Commodity[] = ['medical', 'parts', 'deuterium'];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (b.rand() < 0.5 * (1 - h.clutter)) continue;
      commodityPallet(b, [25.5 + i * 4, 0, -15 + j * 4.2], kinds[i]!, (b.rand() - 0.5) * 0.1, 1 + Math.floor(b.rand() * 2));
    }
  }
  const zx0 = 22.8;
  const zx1 = 36.5;
  const zz0 = -18;
  const zz1 = -0.5;
  paintStrip(b, (zx0 + zx1) / 2, zz0, zx1 - zx0, 0.25, h.marking);
  paintStrip(b, (zx0 + zx1) / 2, zz1, zx1 - zx0, 0.25, h.marking);
  paintStrip(b, zx0, (zz0 + zz1) / 2, 0.25, zz1 - zz0, h.marking);
  paintStrip(b, zx1, (zz0 + zz1) / 2, 0.25, zz1 - zz0, h.marking);
  // Loader parked by the pallets.
  loader(b, [30.5, 0, 5.5], Math.PI - 0.25, h.machine, h.hazard, h.lamp);
  // Price board rig facing the trader camera.
  const rig = new Frame([30.5, 0, -22.5], -0.35);
  for (const sx of [-6.2, 6.2]) {
    fbox(b, rig, 'metal', [0.4, 10.5, 0.4], [sx, 5.25, 0], h.trim);
    fbox(b, rig, 'metal', [1.2, 0.4, 1.2], [sx, 0.2, 0], h.wallDark);
  }
  fbox(b, rig, 'metal', [13, 0.4, 0.5], [0, 10.4, 0], h.trim);
  fbox(b, rig, 'metal', [13, 0.25, 0.4], [0, 3.45, 0], h.trim);
  for (let i = 0; i < 3; i++) {
    const cx = -4.1 + i * 4.1;
    fbox(b, rig, 'dark', [3.9, 6.4, 0.1], [cx, 6.8, -0.12], '#000');
    const p = rig.p([cx, 6.8, 0.02]);
    b.holo(i === 1 ? 'board' : i === 0 ? 'board' : 'chart', 3 + i, p, 3.8, 6.2, h.holo, 1.6, rig.ry);
    b.light({ p: rig.p([cx, 10.1, 0.3]), color: h.holo, size: 1.2, intensity: 0.9 });
  }
  b.floorGlow(rig.p([0, 0, 2])[0], rig.p([0, 0, 2])[2], 14, 6, h.holo, 0.35);
  // Dealer's desk with a small chart.
  const desk = new Frame([29.2, 0, -17.6], -0.35);
  fbox(b, desk, 'hull', [3.2, 1.05, 0.9], [0, 0.525, 0], h.wallDark);
  fbox(b, desk, 'metal', [3.4, 0.08, 1.1], [0, 1.09, 0], h.trim);
  const dp = desk.p([0.6, 1.5, 0.1]);
  b.holo('chart', 7, dp, 1.1, 0.7, h.holo, 1.4, desk.ry - 0.3, -0.25);
  // Wall board above the containers.
  b.holo('board', 9, [HALL.hw - 1.2, 11.5, -8], 8, 4.4, h.holo, 1.3, -Math.PI / 2);
  // Gantry crane over the containers, carrying a load.
  const craneZ = -4;
  const craneA = { type: 8 as const, pivot: [0, 0, 0] as V3, speed: 0.07, amp: 5, phase: 0.3 };
  const cf = new Frame([31, HALL.ceil - 3.2, craneZ], 0);
  const big = style.kind === 'mars-depot';
  b.addMotion('m:metal', new THREE.BoxGeometry(16, big ? 1.6 : 1.1, big ? 1.8 : 1.2), { position: cf.p([0, -0.9, 0]), color: h.hazard[0], a: craneA });
  b.addMotion('m:metal', new THREE.BoxGeometry(2, 1.2, 2.2), { position: cf.p([2.5, -2.1, 0]), color: h.trim, a: craneA });
  for (const dx of [-0.4, 0.4]) {
    b.addMotion('m:metal', new THREE.CylinderGeometry(0.05, 0.05, 8.5, 4), { position: cf.p([2.5 + dx, -6.9, 0]), color: '#1e1f22', a: craneA });
  }
  b.addMotion('m:metal', new THREE.BoxGeometry(2.6, 0.5, 1.2), { position: cf.p([2.5, -11.3, 0]), color: h.trim, a: craneA });
  if (big) {
    const load = new THREE.BoxGeometry(2.45, 2.6, 6.1);
    b.addMotion('m:plain', load, { position: cf.p([2.5, -12.9, 0]), rotation: [0, Math.PI / 2, 0], color: '#a8502a', a: craneA });
  } else {
    b.addMotion('m:plain', new THREE.BoxGeometry(1.8, 1.4, 1.8), { position: cf.p([2.5, -12.3, 0]), color: b.pick(cols), a: craneA });
  }
}

function buildOutfitter(b: RoomBuilder, h: HangarLook, active: boolean): void {
  const hw = HALL.hw;
  // Workbench along the left wall with a tool wall and a diagnostic screen.
  const bench = new Frame([-hw + 1.6, 0, 1], Math.PI / 2);
  fbox(b, bench, 'metal', [12, 0.12, 1.3], [0, 0.98, 0], h.metal);
  for (const sx of [-5.8, 0, 5.8]) fbox(b, bench, 'metal', [0.12, 0.95, 1.2], [sx, 0.47, 0], h.trim);
  fbox(b, bench, 'hull', [3.2, 0.8, 1.1], [-3.5, 0.45, 0], h.wallDark);
  fbox(b, bench, 'hull', [3.2, 0.8, 1.1], [3.5, 0.45, 0], h.wallDark);
  for (let i = 0; i < 9; i++) {
    const x = -5.2 + i * 1.3 + (b.rand() - 0.5) * 0.4;
    fbox(b, bench, 'metal', [0.3 + b.rand() * 0.5, 0.1 + b.rand() * 0.3, 0.2 + b.rand() * 0.4], [x, 1.1, (b.rand() - 0.5) * 0.6], b.rand() < 0.3 ? h.accent : '#3a3d42');
  }
  fbox(b, bench, 'hull', [11, 3.4, 0.12], [0, 3.2, -0.8], new THREE.Color(h.wallDark).multiplyScalar(1.2), { uv: 2 });
  for (let i = 0; i < 16; i++) {
    const x = -5 + i * 0.66;
    fbox(b, bench, 'metal', [0.08 + b.rand() * 0.1, 0.5 + b.rand() * 0.7, 0.06], [x, 3.3 + (b.rand() - 0.5) * 0.8, -0.7], b.rand() < 0.25 ? h.accent : '#50545a');
  }
  b.holo('scope', 11, bench.p([0, 6.2, -0.6]), 5.5, 2.8, h.holo, 1.4, bench.ry);
  b.box('emissive', [0.1, 0.1, 11], [-hw + 1.2, 5.1, 1], h.lamp, { intensity: h.lampLevel });
  b.floorGlow(-hw + 3, 1, 5, 13, h.lamp, 0.22);
  // Weapon rack on the back wall.
  const rack = new Frame([-34, 0, HALL.back + 1.3], 0);
  fbox(b, rack, 'metal', [9, 0.2, 1.4], [0, 1.2, 0], h.trim);
  fbox(b, rack, 'metal', [9, 0.2, 1.4], [0, 3.0, 0], h.trim);
  for (let i = 0; i < 6; i++) {
    const x = -3.6 + i * 1.45;
    fcyl(b, rack, 'metal', 0.18, 1.3, [x, 1.95, 0.1], '#3a3d42', { rot: [Math.PI / 2, 0, 0], seg: 8 });
    fcyl(b, rack, 'hull', 0.12, 0.9, [x, 3.6, 0.1], i % 2 ? h.accent : h.hazard[0], { rot: [Math.PI / 2, 0, 0], seg: 8 });
  }
  if (!active) {
    crate(b, [-30, 0, -6], [1.6, 1.2, 1.6], '#6a6e75', h.trim, 0.2);
    crate(b, [-33, 0, 4], [1.4, 1.0, 1.4], '#6a6e75', h.trim, -0.3);
    return;
  }
  // Display turntables in a diagonal towards the camera: two turrets and a shield generator.
  const tables: [number, number, 'turret' | 'shield' | 'turret2', number][] = [
    [-30.2, -3.2, 'turret', 1.55],
    [-36.8, -8.2, 'shield', 1.25],
    [-34.2, 3.6, 'turret2', 1.2],
  ];
  for (const [x, z, what, scale] of tables) {
    b.cyl('metal', 2.5, 0.42, [x, 0.21, z], h.trim, { seg: 24 });
    b.cyl('metal', 2.2, 0.1, [x, 0.46, z], h.metal, { seg: 24 });
    b.cyl('emissive', 2.55, 0.07, [x, 0.36, z], h.glow, { seg: 24, intensity: h.glowLevel, open: true });
    b.floorGlow(x, z, 8, 8, h.glow, 0.3, 0.02);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.light({ p: [x + Math.cos(a) * 2.55, 0.38, z + Math.sin(a) * 2.55], color: h.glow, size: 0.5, intensity: 1.8, blink: 0.3, phase: k / 6, duty: 0.5, min: 0.4 });
    }
    if (what === 'shield') {
      shieldGenerator(b, [x, 0.5, z], h.metal, h.glow, scale);
    } else {
      turret(b, [x, 0.52, z], 0.4, what === 'turret2' ? h.accent : h.metal, what === 'turret2' ? h.metal : h.accent, { scale, spin: true, plinth: false, glow: h.glow });
    }
  }
  // Spec display next to the showroom.
  const spec = new Frame([-40.5, 0, -3], 0.9);
  fbox(b, spec, 'metal', [0.3, 5.2, 0.3], [-1.9, 2.6, 0], h.trim);
  fbox(b, spec, 'metal', [0.3, 5.2, 0.3], [1.9, 2.6, 0], h.trim);
  fbox(b, spec, 'dark', [3.6, 2.4, 0.08], [0, 3.6, -0.1]);
  b.holo('scope', 17, spec.p([0, 3.6, 0.02]), 3.4, 2.2, h.holo, 1.5, spec.ry);
  // A turret on a service cradle with a working tool arm and sparks.
  const cradle = new Frame([-28, 0, -14.5], 0.35);
  fbox(b, cradle, 'metal', [3, 0.6, 2.2], [0, 0.3, 0], h.trim);
  for (const sx of [-1.2, 1.2]) fbox(b, cradle, 'metal', [0.3, 1.2, 1.8], [sx, 1.0, 0], h.wallDark);
  turret(b, cradle.p([0, 0.9, 0]), cradle.ry + 0.4, h.metal, h.accent, { plinth: false, scale: 1.2, glow: h.glow });
  toolArm(b, cradle.p([0.2, 0, -3.3]), cradle.ry, h.machine, h.trim, '#ffd89a');
  b.floorGlow(-28, -14.5, 7, 6, '#ffc890', 0.25);
  // Engine block on a stand, tool carts, parts crates and coiled cables.
  const eng = new Frame([-40, 0, -14.5], 0.6);
  for (const sx of [-1.3, 1.3]) fbox(b, eng, 'metal', [0.25, 1.1, 1.6], [sx, 0.55, 0], h.trim);
  fcyl(b, eng, 'metal', 0.95, 3.2, [0, 1.75, 0], h.metal, { rot: [0, 0, Math.PI / 2], seg: 14 });
  fcyl(b, eng, 'metal', 0.75, 0.9, [1.95, 1.75, 0], '#3a3d42', { rot: [0, 0, Math.PI / 2], rTop: 0.95, seg: 14 });
  fcyl(b, eng, 'emissive', 0.6, 0.05, [2.42, 1.75, 0], h.glow, { rot: [0, 0, Math.PI / 2], seg: 14, intensity: 1.2 });
  for (let k = 0; k < 4; k++) fcyl(b, eng, 'metal', 1.0, 0.12, [-1.2 + k * 0.7, 1.75, 0], '#2c2e33', { rot: [0, 0, Math.PI / 2], seg: 14 });
  for (const [x, z, ry] of [
    [-26.5, -6.5, 0.4],
    [-38.5, 6.5, -0.3],
  ] as const) {
    const cart = new Frame([x, 0, z], ry);
    fbox(b, cart, 'metal', [1.4, 0.08, 0.8], [0, 0.9, 0], h.trim);
    fbox(b, cart, 'metal', [1.4, 0.08, 0.8], [0, 0.3, 0], h.trim);
    for (const sx of [-0.65, 0.65]) for (const sz of [-0.35, 0.35]) fbox(b, cart, 'metal', [0.05, 0.9, 0.05], [sx, 0.45, sz], h.metal);
    fbox(b, cart, 'hull', [0.5, 0.25, 0.3], [-0.3, 1.07, 0], h.accent);
    fbox(b, cart, 'metal', [0.3, 0.15, 0.4], [0.35, 1.02, 0.1], '#50545a');
  }
  crate(b, [-41.5, 0, -21], [1.6, 1.2, 1.6], h.accent, h.trim, 0.2);
  crate(b, [-41.7, 1.2, -21.1], [1.1, 0.8, 1.1], '#6a6e75', h.trim, 0.5);
  crate(b, [-39.2, 0, -22.5], [1.3, 1.0, 1.3], '#6a6e75', h.trim, -0.3);
  crate(b, [-42, 0, 10], [1.4, 1.0, 1.4], '#6a6e75', h.trim, -0.3);
  for (const [x, z] of [
    [-31.5, -12],
    [-24.5, -18],
  ] as const) {
    const coil = new THREE.TorusGeometry(0.55, 0.12, 6, 14);
    coil.rotateX(Math.PI / 2);
    b.add('metal', coil, { position: [x, 0.12, z], color: '#23252a' });
    const coil2 = new THREE.TorusGeometry(0.42, 0.12, 6, 14);
    coil2.rotateX(Math.PI / 2);
    b.add('metal', coil2, { position: [x, 0.34, z], color: h.hazard[0] });
  }
  // Hoist chain from the rail.
  b.box('metal', [1.2, 0.8, 1.6], [-38, HALL.ceil - 3.9, 6], h.trim);
  b.rod('metal', [-38, HALL.ceil - 4.3, 6], [-38, 4.5, 6], 0.06, '#2a2c30', 4);
  b.box('metal', [0.6, 0.4, 0.3], [-38, 4.3, 6], h.hazard[0]);
}

/** Shelving of leafy greens under alternating green and magenta grow lights. */
function hydroponicRack(b: RoomBuilder, h: HangarLook, x: number, z: number, ry: number): void {
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

/* ------------------------------------------------------------------------------------------------
 * Station-specific set dressing.
 * ---------------------------------------------------------------------------------------------- */

function buildExtras(b: RoomBuilder, h: HangarLook, style: InteriorStyle): void {
  const { hw, back, ceil } = HALL;
  switch (style.kind) {
    case 'earth-port': {
      // Control gallery overlooking the deck: glass band with a warm interior.
      for (const side of [-1]) {
        const x = side * hw;
        b.box('dark', [0.4, 3.4, 26], [x - side * 0.3, 13.2, -12]);
        b.box('glass', [0.1, 3.2, 25.6], [x - side * 0.62, 13.2, -12]);
        b.box('emissive', [0.1, 0.18, 25.6], [x - side * 0.5, 11.55, -12], '#ffd29a', { intensity: 1.6 });
        for (let z = -24; z <= 0; z += 3.2) b.box('metal', [0.3, 3.4, 0.25], [x - side * 0.7, 13.2, z], h.trim);
        b.glow('pool', [x - side * 0.8, 13.2, -12], 26, 5, [0, Math.PI / 2, 0], '#ffc88a', 0.35);
      }
      // Low blue guide lights along the walkways.
      for (let z = -26; z < 40; z += 3) {
        for (const s of [-1, 1]) b.light({ p: [s * 15.85, 0.08, z], color: h.glow, size: 0.35, intensity: 2, blink: 0.4, phase: z / 60, duty: 0.6, min: 0.4 });
      }
      break;
    }
    case 'mars-depot': {
      // Extra clutter: drums, stacked crates, hazard barriers.
      for (let i = 0; i < (b.low ? 6 : 12); i++) {
        drum(b, [b.range(14, 20), 0, b.range(-24, 20)], b.pick(['#b8502a', '#c89a32', '#5e4a3c']), b.rand() < 0.2);
      }
      for (let i = 0; i < 5; i++) {
        crate(b, [b.range(-18, -14), 0, b.range(-24, 18)], [1.4, 1.2, 1.4], b.pick(['#8a3a24', '#6a5446', '#c8782e']), '#2a221c', b.rand());
      }
      for (let i = 0; i < 6; i++) {
        const f = new Frame([-6 + i * 2.4, 0, 16], 0);
        fbox(b, f, 'hull', [2.0, 0.9, 0.3], [0, 0.45, 0], i % 2 ? h.hazard[0] : '#e8e4d8');
      }
      break;
    }
    case 'proxima-outpost': {
      // Hydroponic racks: along the trader's wall (in place of a container row) and a pair by the pad.
      const racks: [number, number, number][] = [
        [hw - 2.4, -23, -Math.PI / 2],
        [hw - 2.4, -16.5, -Math.PI / 2],
        [hw - 2.4, -10, -Math.PI / 2],
        [hw - 2.4, -3.5, -Math.PI / 2],
        [15.2, -21, -1.2],
        [16.4, -14.5, -1.35],
      ];
      for (const [x, z, ry] of racks) hydroponicRack(b, h, x, z, ry);
      // Lab gear: tanks and a sample centrifuge.
      for (let i = 0; i < 3; i++) {
        b.cyl('hull', 0.9, 3.2, [-16.5, 1.6, -20 + i * 2.4], '#c9d0c6', { seg: 14 });
        b.cyl('metal', 0.92, 0.2, [-16.5, 2.4, -20 + i * 2.4], h.accent, { seg: 14 });
        b.light({ p: [-16.5, 3.4, -19.1 + i * 2.4], color: '#58f08e', size: 0.4, intensity: 2.4 });
      }
      break;
    }
    case 'barnard-relay': {
      // Spare and dark: a few fuel drums, a lone cable reel, red beacons.
      for (let i = 0; i < 5; i++) drum(b, [b.range(14, 19), 0, b.range(-20, 10)], '#5a2a24');
      b.cyl('metal', 1.2, 1.6, [-14, 0.8, 10], '#3a3d42', { rot: [0, 0, Math.PI / 2], seg: 14 });
      for (let z = back + 6; z < 40; z += 12) {
        for (const s of [-1, 1]) b.light({ p: [s * (hw - 1.5), 20.5, z], color: '#ff2a1a', size: 1.2, intensity: 2.2, blink: 0.4, duty: 0.25, phase: z / 50, min: 0.05 });
      }
      break;
    }
    case 'sirius-platform': {
      // Light seams in the floor and lead-grey shield blocks stacked by the walls.
      for (let x = -40; x <= 40; x += 8) b.box('emissive', [0.06, 0.02, 60], [x, 0.011, 8], h.glow, { intensity: 0.9 });
      for (let z = -24; z <= 40; z += 8) b.box('emissive', [84, 0.02, 0.06], [0, 0.011, z], h.glow, { intensity: 0.9 });
      // Stacked either side of the mouth (clear of the trader's and outfitter's walls).
      const mx = h.mouth[0];
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const x = side * (mx + 2.9);
          const z = back + 1.7 + k * 2.6;
          b.box('hull', [2.2, 1.6, 2.4], [x, 0.8, z], '#6b7380', { uv: 2 });
          if (k === 0) b.box('hull', [2.2, 1.6, 2.4], [x, 2.4, z], '#7b8390', { uv: 2 });
        }
      }
      break;
    }
    case 'eridani-hub': {
      // Colourful banners from the trusses and extra freight everywhere.
      const cols = [h.marking, h.glow, h.marking2, h.accent, '#a8382a'];
      for (let i = 0; i < (b.low ? 6 : 10); i++) {
        const x = -40 + i * 9 + b.range(-1, 1);
        const z = back + 8 + 12 * Math.floor(b.rand() * 4);
        b.box('plain', [2.2, 5.5, 0.05], [x, ceil - 6, z + 0.6], cols[i % cols.length]!, { uv: 2 });
        b.box('metal', [2.6, 0.12, 0.12], [x, ceil - 3.3, z + 0.6], h.trim);
      }
      for (let i = 0; i < (b.low ? 10 : 20); i++) {
        const x = b.pick([b.range(-18, -14.5), b.range(14.5, 20)]);
        const z = b.range(-26, 24);
        const s = b.range(0.8, 1.6);
        crate(b, [x, 0, z], [s, s * 0.8, s], b.pick(['#c8782e', '#2e8a8a', '#a8382a', '#d8a832', '#6a3a7a']), '#2e2218', b.rand() * 3);
      }
      // Ore bins by the mouth.
      for (const s of [-1, 1]) {
        const f = new Frame([s * 18, 0, back + 6], 0);
        fbox(b, f, 'hull', [4, 1.8, 3], [0, 0.9, 0], '#5e4b36');
        for (let k = 0; k < 6; k++) {
          const rock = new THREE.IcosahedronGeometry(0.5 + b.rand() * 0.4, 0);
          b.add('hull', rock, { position: f.p([b.range(-1.5, 1.5), 1.9, b.range(-1, 1)]), color: b.pick(['#8c7a68', '#6e655c', '#9a8a70']), rotation: [b.rand(), b.rand(), b.rand()] });
        }
      }
      break;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * People and shots.
 * ---------------------------------------------------------------------------------------------- */

function pickOutfit(style: InteriorStyle, i: number): Outfit {
  return style.crowd[i % style.crowd.length]!;
}

function shotsFor(style: InteriorStyle): Partial<Record<RoomView, ViewShots>> {
  const { x: px, z: pz } = PAD;
  void style;
  return {
    deck: {
      wide: { pos: [7, 10.5, 23], target: [px - 1.5, 3.4, pz - 6], fov: 40 },
      tall: { pos: [7.5, 13, 25], target: [px - 0.5, 2.6, pz - 1], fov: 56 },
      subject: { center: [px, 2.4, pz], radius: 8.5 },
      maxPull: 1.3,
    },
    trader: {
      wide: { pos: [24.5, 8.6, 13.5], target: [33, 3.2, -11.5], fov: 44 },
      tall: { pos: [27, 9.4, 14.5], target: [32, 3.4, -11], fov: 60 },
      subject: { center: [31, 3, -11], radius: 8 },
      maxPull: 1.2,
    },
    outfitter: {
      wide: { pos: [-23, 7.4, 13], target: [-33.5, 2.2, -5], fov: 44 },
      tall: { pos: [-25, 8.2, 14], target: [-33, 2.4, -5], fov: 60 },
      subject: { center: [-33, 2, -5], radius: 7.5 },
      maxPull: 1.2,
    },
  };
}

export function buildHangar(
  ctx: ArtContext,
  style: InteriorStyle,
  rooms: readonly RoomView[],
  seed: number,
  backdrop: Backdrop,
  makeShip: StationInteriorOptions['ship'] = createPlayerShip,
): HangarBuild {
  const h = style.hangar;
  const b = new RoomBuilder('hangar', seed * 97 + 13, ctx);
  const hasTrader = rooms.includes('trader');
  const hasOutfitter = rooms.includes('outfitter');

  buildFloor(b, h);
  // Bay number on the pad: stable per station and seed, 01-24.
  let bayHash = Math.abs(seed | 0) * 101;
  for (const ch of style.kind) bayHash = (bayHash * 31 + ch.charCodeAt(0)) % 100_003;
  buildPad(b, h, 1 + (bayHash % 24));
  buildWalls(b, h, style);
  buildCeiling(b, h, style);
  buildMouth(b, h, backdrop);
  for (const x of [-19, 19]) for (const z of [-22, 2, 26]) pillar(b, h, x, z);
  buildDeckDressing(b, h, style);
  buildTrader(b, h, style, hasTrader);
  buildOutfitter(b, h, hasOutfitter);
  buildExtras(b, h, style);

  // Starlight spilling in through the mouth: a soft patch on the apron and a faint wash inside.
  const spill = backdrop.starColor.clone().lerp(new THREE.Color(style.outside.spillTint), style.outside.spillMix);
  const [mx] = h.mouth;
  b.floorGlow(0, HALL.back - HALL.wall - 3, mx * 2.1, 14, spill, 0.12 * style.outside.spill);
  b.floorGlow(-3, HALL.back + 9, mx * 1.5, 22, spill, 0.045 * style.outside.spill);
  // Light shafts through the bay (volumetric look); strongest where the star is harsh.
  if (style.outside.rays > 0 && !b.low) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x0 = -mx * 0.7 + (i + 0.5) * ((mx * 1.4) / n) + b.range(-1, 1);
      const top: V3 = [x0, h.mouth[1] - 1.5, HALL.back - 1];
      const bottom: V3 = [x0 * 0.8 - 3, 0.1, HALL.back + 14 + b.range(0, 6)];
      b.shaft(top, bottom, 3 + b.range(0, 3), spill, style.outside.rays * (0.7 + b.rand() * 0.6));
    }
  }

  // People working in the hangar.
  const anchors: HangarBuild['anchors'] = {};
  const place = (view: RoomView, id: string, label: string, p: THREE.Vector3): void => {
    (anchors[view] ??= []).push({ id, label, position: p });
  };
  interface Job {
    pose: PoseKind;
    pos: V3;
    yaw: number;
    view: RoomView | null;
    id: string;
  }
  // The dealer and the mechanic always staff their rooms; the rest of the crew depends on how busy
  // the station is.
  const staff: Job[] = [];
  if (hasTrader) staff.push({ pose: 'hip', pos: [28.2, 0, -16.2], yaw: 2.6, view: 'trader', id: 'dealer' });
  // The mechanic checks the showroom turret on a tablet: in the middle of both the wide and the
  // portrait outfitter shots (the wall bench is out of a phone's narrow frame).
  if (hasOutfitter) staff.push({ pose: 'tablet', pos: [-32.7, 0, -1.2], yaw: 2.25, view: 'outfitter', id: 'mechanic' });
  const crew: Job[] = [
    { pose: 'tablet', pos: [-11.2, 0, -2.5], yaw: 1.9, view: null, id: 'crew-1' },
    { pose: 'crossed', pos: [11.2, 0, -6.5], yaw: -1.3, view: null, id: 'crew-2' },
    { pose: 'stand', pos: [24, 0, 8.5], yaw: 1.2, view: null, id: 'crew-3' },
    { pose: 'tablet', pos: [-24.5, 0, -15], yaw: 2.4, view: null, id: 'crew-4' },
    { pose: 'drink', pos: [15.5, 0, -18], yaw: -1.1, view: null, id: 'crew-5' },
  ];
  const jobs = [...staff, ...crew.slice(0, Math.max(1, h.workers))];
  jobs.forEach((w, i) => {
    const outfit =
      w.id === 'dealer'
        ? (style.crowd.find((o) => /Trader|Merchant|Customs/.test(o.label)) ?? pickOutfit(style, i))
        : w.id === 'mechanic'
          ? (style.crowd.find((o) => /Mechanic|Engineer|technician/.test(o.label)) ?? pickOutfit(style, i))
          : pickOutfit(style, i + 1);
    const p = addPerson(b, { id: w.id, label: outfit.label, outfit, pos: w.pos, yaw: w.yaw, pose: w.pose, seed: seed * 13 + i * 101 }, style);
    if (w.view) place(w.view, w.id, w.id === 'dealer' ? 'Dealer' : 'Mechanic', p);
  });

  // Player ship hovering over the pad, engines idling. Big hulls are shown scaled to fit the pad.
  const ship = makeShip(ctx);
  const fit = Math.min(1, SHIP_FIT_LENGTH / (ship.length ?? SHIP_FIT_LENGTH));
  ship.object.scale.setScalar(fit);
  ship.object.position.set(PAD.x, SHIP_Y, PAD.z);
  ship.object.rotation.y = SHIP_YAW;
  ship.setThrottle(0);
  b.group.add(ship.object);
  place('deck', 'ship', 'Your ship', new THREE.Vector3(PAD.x, SHIP_Y + 0.6, PAD.z));
  // Hover glow on the pad under the ship.
  b.glow('pool', [PAD.x, 0.29, PAD.z], 8, 8, FLOOR_UP, h.padGlow, 0.3);
  b.holo('pad', 0, [PAD.x, 0.3, PAD.z], 10.5, 10.5, h.padGlow, 0.9, 0, -Math.PI / 2);
  b.light({ p: [PAD.x, 0.9, PAD.z], color: h.padGlow, size: 5, intensity: 0.18 });

  // Dynamic lights: ambient, starlight spill, key over the pad, two area fills.
  const lights: THREE.Light[] = [];
  const hemi = new THREE.HemisphereLight(h.hemiSky, h.hemiGround, h.hemi);
  lights.push(hemi);
  const spillLight = new THREE.SpotLight(spill, style.outside.spill, 0, 0.62, 0.65, 0);
  const sd = style.outside.spillDir ? new THREE.Vector3(...style.outside.spillDir).normalize() : backdrop.starDir;
  // Low and far out, so its mirror highlight on the floor falls beyond the apron instead of glaring
  // in the middle of the deck, trader and outfitter shots.
  spillLight.position.set(sd.x * 90, 9, HALL.back - HALL.wall + sd.z * 90);
  spillLight.target.position.set(-2, 0, PAD.z - 2);
  lights.push(spillLight);
  const key = new THREE.SpotLight(h.key.color, h.key.intensity, 70, 0.62, 0.75, 1.3);
  key.position.set(PAD.x + 3, HALL.ceil - 2, PAD.z + 6);
  key.target.position.set(PAD.x, 0, PAD.z);
  lights.push(key);
  const fillT = new THREE.PointLight(h.fillTrader.color, h.fillTrader.intensity, 60, 1.3);
  fillT.position.set(30, 13, -8);
  lights.push(fillT);
  const fillO = new THREE.PointLight(h.fillOutfitter.color, h.fillOutfitter.intensity, 60, 1.3);
  fillO.position.set(-31, 12, 0);
  lights.push(fillO);
  for (const l of lights) {
    b.group.add(l);
    if (l instanceof THREE.SpotLight) b.group.add(l.target);
  }

  const reduced = ctx.reducedMotion;
  return {
    builder: b,
    ship,
    lights,
    shots: shotsFor(style),
    anchors,
    update(dt, time, camera) {
      ship.object.position.y = SHIP_Y + Math.sin(time * 0.85) * (reduced ? 0.015 : 0.07);
      ship.object.rotation.z = Math.sin(time * 0.6 + 1) * (reduced ? 0.001 : 0.008);
      ship.object.rotation.x = Math.sin(time * 0.47) * (reduced ? 0.001 : 0.005);
      ship.update?.(dt, time, camera);
    },
  };
}


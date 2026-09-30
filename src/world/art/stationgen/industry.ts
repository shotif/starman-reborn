import * as THREE from 'three';
import { loft, rod } from '../kit.ts';
import type { LoftSection, V3 } from '../kit.ts';
import { rockGeometry } from '../rocks.ts';
import type { Rng } from '../shipgen/palette.ts';
import { byQuality } from '../util.ts';
import type { GenPart, StationGen } from './builder.ts';
import { addIn, boxIn, dist, frameAt, mix, norm, subFrame, surfaceAlong, surfaceZ, tp } from './geom.ts';
import {
  baySize,
  bayStyle,
  beacon,
  block,
  capsuleTank,
  containers,
  cylModule,
  hangarBlock,
  lamp,
  neonSign,
  radiator,
  sphereTank,
  truss,
} from './parts.ts';

/**
 * Industrial stations: the shipyard (open construction frames holding half-built hulls, gantry
 * cranes, welding sparks), the mining outpost (a habitat clamped to a rock, drill rigs, ore
 * conveyors, silos), the refinery (distillation towers on a pipe rack, spherical tank farms,
 * radiator fins, a flare stack) and the factory (stacked fabrication blocks on a conveyor spine,
 * containers riding the belt).
 */

const col = (c: THREE.ColorRepresentation): THREE.Color => new THREE.Color(c);

/* ------------------------------------------------------------------------------------------------
 * Shipyard.
 * ---------------------------------------------------------------------------------------------- */

/** Octagonal hull section: half width w, half height h, chamfer k. */
function octagon(w: number, h: number, k = 0.35): [number, number][] {
  const cw = w * k;
  const ch = h * k;
  return [
    [w - cw, h],
    [w, h - ch],
    [w, -h + ch],
    [w - cw, -h],
    [-w + cw, -h],
    [-w, -h + ch],
    [-w, h - ch],
    [-w + cw, h],
  ];
}

/** Open slipway frame (w x h cross-section, length l along Z of `frame`, centred). */
function slipwayFrame(b: StationGen, p: GenPart, frame: THREE.Matrix4, w: number, h: number, l: number, r: Rng): void {
  const k = p.kit;
  const m = Math.max(2.8, w * 0.045);
  const metal = b.pal.metal;
  const paint = b.paint(b.pal.hullAlt);
  for (const x of [-w / 2, w / 2]) {
    for (const y of [-h / 2, h / 2]) boxIn(k, frame, 'hull', [m, m, l], [x, y, 0], paint);
  }
  // Cradle floor with gantry rails.
  boxIn(k, frame, 'metal', [w - m, 0.8, l * 0.96], [0, -h / 2 + 0.2, 0], b.pal.metalDark);
  for (const x of [-w * 0.3, w * 0.3]) boxIn(k, frame, 'metal', [1.2, 1.4, l * 0.96], [x, -h / 2 + 1, 0], b.pal.metal);
  const ribs = Math.max(3, Math.round(l / (b.R * byQuality(b.quality, 0.2, 0.15, 0.12))));
  for (let i = 0; i <= ribs; i++) {
    const z = -l / 2 + (l * i) / ribs;
    const end = i === 0 || i === ribs;
    const mm = end ? m * 1.4 : m * 0.8;
    const c = end ? paint : metal;
    boxIn(k, frame, end ? 'hull' : 'metal', [w + mm, mm, mm], [0, h / 2, z], c);
    boxIn(k, frame, end ? 'hull' : 'metal', [w + mm, mm, mm], [0, -h / 2, z], c);
    boxIn(k, frame, end ? 'hull' : 'metal', [mm, h, mm], [w / 2, 0, z], c);
    boxIn(k, frame, end ? 'hull' : 'metal', [mm, h, mm], [-w / 2, 0, z], c);
    if (end) {
      // Hazard-striped end frames with floodlights aimed into the frame.
      boxIn(k, frame, 'hull', [w * 0.3, mm * 1.02, mm * 1.02], [0, h / 2, z], b.pal.hazard[0]);
      for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) lamp(b, p, tp(frame, [x * 0.92, y * 0.92, z * 0.97]), Math.max(8, w * 0.12), 0.9, '#dbe8ff');
    } else if (b.quality !== 'low' && i < ribs) {
      // Side diagonals.
      const z1 = -l / 2 + (l * (i + 1)) / ribs;
      for (const x of [-w / 2, w / 2]) {
        const a = tp(frame, [x, (i % 2 ? -1 : 1) * h * 0.5, z]);
        const e = tp(frame, [x, (i % 2 ? 1 : -1) * h * 0.5, z1]);
        rod(k, 'metal', a, e, m * 0.28, metal, 4);
      }
    }
  }
  beacon(b, p, tp(frame, [w / 2, h / 2 + m, l / 2]), '#ff3a2a', 5, 0.6, r.next());
  beacon(b, p, tp(frame, [-w / 2, h / 2 + m, -l / 2]), '#ff3a2a', 5, 0.6, r.next());
}

/** Half-built hull inside a slipway: plated forward part, bare ribs aft, welding sparks. */
function hullInProgress(b: StationGen, p: GenPart, frame: THREE.Matrix4, w: number, h: number, l: number, r: Rng): void {
  const k = p.kit;
  const done = r.range(0.35, 0.8);
  // Primer grey or red oxide, the owner's colour only on the finished nose.
  const primer = r.pick([b.pal.panel, col('#8a5a48'), col('#9aa0a6'), b.pal.hullAlt]);
  const stations: [number, number][] = [
    [l / 2, 0.25],
    [l * 0.36, 0.7],
    [l * 0.15, 1],
    [-l * 0.2, 1],
    [-l * 0.4, 0.88],
    [-l / 2, 0.7],
  ];
  const zCut = l / 2 - l * done;
  const sections: LoftSection[] = [];
  for (const [z, s] of stations) {
    if (z < zCut) break;
    sections.push({ z, pts: octagon(w * s, h * s) });
  }
  // Close the plated part at the cut with a bulkhead.
  const sAt = (z: number): number => {
    for (let i = 0; i + 1 < stations.length; i++) {
      const [z0, s0] = stations[i]!;
      const [z1, s1] = stations[i + 1]!;
      if (z <= z0 && z >= z1) return s0 + ((z0 - z) / (z0 - z1)) * (s1 - s0);
    }
    return stations[stations.length - 1]![1];
  };
  sections.push({ z: zCut, pts: octagon(w * sAt(zCut), h * sAt(zCut)) });
  const nose = b.paint(b.pal.hull);
  const shell = loft(sections, { capStart: true, capEnd: true, baseColor: b.paint(primer), faceColor: (s, e) => (s === 0 ? nose : s === 1 && (e === 7 || e === 3) ? b.pal.trim : null) });
  addIn(k, frame, 'hull', shell, { uv: 6 });
  // Bare ribs and a keel aft of the plating.
  const ribs = Math.max(2, Math.round((zCut + l / 2) / (l * 0.1)));
  for (let i = 1; i <= ribs; i++) {
    const z = zCut - ((zCut + l / 2) * i) / ribs;
    const s = sAt(z);
    const pts = octagon(w * s, h * s);
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j]!;
      const e = pts[(j + 1) % pts.length]!;
      rod(k, 'metal', tp(frame, [a[0], a[1], z]), tp(frame, [e[0], e[1], z]), Math.max(0.35, w * 0.025), b.pal.metal, 4);
    }
  }
  for (const [x, y] of [
    [0, -h * 0.95],
    [w * 0.9, 0],
    [-w * 0.9, 0],
  ] as const) {
    rod(k, 'metal', tp(frame, [x * sAt(zCut), y * sAt(zCut), zCut]), tp(frame, [x * 0.7, y * 0.7, -l / 2]), Math.max(0.4, w * 0.03), b.pal.metal, 4);
  }
  // Welding sparks along the plating edge.
  const sparks = 2 + r.int(1, 3);
  for (let i = 0; i < sparks; i++) {
    const a = r.range(0, Math.PI * 2);
    const s = sAt(zCut);
    b.light(p, {
      p: tp(frame, [Math.cos(a) * w * s * 0.95, Math.sin(a) * h * s * 0.95, zCut - 0.5]),
      color: '#cfeaff',
      size: Math.max(3, w * 0.08),
      intensity: 2.6,
      blink: r.range(5, 11),
      duty: 0.3,
      phase: r.next(),
      min: 0,
    });
  }
}

export function shipyard(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const bay = baySize(R);
  const admin: V3 = [Math.max(bay.w + 44, R * 0.26), Math.max(bay.h + 40, R * 0.24), R * 0.3];
  const zF = R * 0.1;
  const front = frameAt([0, 0, zF]);
  hangarBlock(b, body, front, admin, pal.hull, bayStyle(b), bay);
  block(b, body, subFrame(front, [0, admin[1] / 2 + 10, -admin[2] * 0.5]), [admin[0] * 0.7, 20, admin[2] * 0.62], { color: pal.hullAlt, windows: 1, roof: 0.6, trim: pal.trim }, rd);
  neonSign(b, body, subFrame(front, [0, admin[1] / 2 - bay.h * 0.22, 0.7]), bay.w * 1.05, bay.h * 0.36, pal.glow, rd, pal.glowAlt);
  containers(b, body, subFrame(front, [-admin[0] / 2 + 7, -admin[1] / 2 - 1.6 - 3.2, -admin[2] * 0.4]), Math.max(3, Math.floor((admin[0] - 2) / 12.6)), 2, rd, [12, 3, 3]);

  // Slipways round the admin block.
  const n = b.size < 0.3 ? 2 : b.size < 0.7 ? r.int(2, 3) : r.int(3, 4);
  const W = R * 0.25;
  const H = R * 0.21;
  const L = R * r.range(0.95, 1.12);
  const zc = zF - admin[2] / 2;
  const sx = admin[0] / 2 + W / 2 + R * 0.09;
  const slots: [number, number][] =
    n === 2
      ? [
          [-sx, 0],
          [sx, 0],
        ]
      : n === 3
        ? [
            [-sx, 0],
            [sx, 0],
            [0, admin[1] / 2 + 30 + H / 2],
          ]
        : [
            [-sx, -(H / 2 + 7)],
            [-sx, H / 2 + 7],
            [sx, -(H / 2 + 7)],
            [sx, H / 2 + 7],
          ];
  const cranes: { x: number; y: number; phase: number; speed: number }[] = [];
  for (const [x, y] of slots) {
    const f = frameAt([x, y, zc]);
    slipwayFrame(b, body, f, W, H, L, rd);
    if (r.next() < 0.92) hullInProgress(b, body, subFrame(f, [0, 0, r.range(-0.04, 0.04) * L]), W * 0.36, H * 0.34, L * 0.8, rd);
    cranes.push({ x, y: y + H / 2, phase: r.range(0, Math.PI * 2), speed: r.range(0.05, 0.09) });
    // Connector back to the admin block.
    if (Math.abs(x) > 1) {
      const s = Math.sign(x);
      truss(b, body, [s * admin[0] / 2, y * 0.8, zc], [x - s * W / 2, y, zc], Math.max(6, R * 0.03));
    } else {
      truss(b, body, [0, admin[1] / 2 + 20, zc], [0, y - H / 2, zc], Math.max(6, R * 0.03));
    }
  }

  // Gantry cranes riding the frame tops (one instanced mesh).
  const cw = W + 8;
  const craneCol = b.look.owner === 'hollow-wake' ? pal.trimAlt : pal.hazard[0];
  const craneGeo = b.moverGeometry((kit, key) => {
    kit.add(key, new THREE.BoxGeometry(cw, 3, 4), { position: [0, 10, 0], color: craneCol });
    for (const s of [-1, 1]) kit.add(key, new THREE.BoxGeometry(2.4, 10, 4), { position: [(s * cw) / 2 - s * 1.2, 5, 0], color: craneCol });
    kit.add(key, new THREE.BoxGeometry(5, 3.4, 5), { position: [W * 0.12, 8, 0], color: pal.metalDark });
    kit.add(key, new THREE.BoxGeometry(0.4, 12, 0.4), { position: [W * 0.12, 0.4, 0], color: pal.metal });
    kit.add(key, new THREE.BoxGeometry(3, 1.2, 3), { position: [W * 0.12, -5.6, 0], color: pal.metalDark });
  });
  const travel = L * 0.36;
  const reach = Math.max(...cranes.map((c) => Math.hypot(Math.abs(c.x) + cw / 2, Math.abs(c.y) + 14, Math.abs(zc) + travel + 3)));
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const calm = b.ctx.reducedMotion ? 0.5 : 1;
  b.mover('cranes', 'hull', craneGeo, cranes.length, reach, (i, time, out) => {
    const c = cranes[i]!;
    pos.set(c.x, c.y + 1.5, zc + Math.sin(time * c.speed * calm + c.phase) * travel);
    out.compose(pos, q, one);
  });
  beacon(b, body, tp(front, [0, admin[1] / 2 + 21, -admin[2] * 0.5]), pal.beacon, 6, 0.5, 0, true);
}

/* ------------------------------------------------------------------------------------------------
 * Mining outpost.
 * ---------------------------------------------------------------------------------------------- */

export function miningOutpost(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);

  // The rock.
  const rockR = R * 0.46;
  const rock = rockGeometry(r.int(1, 1_000_000), {
    detail: byQuality(b.quality, 3, 4, 5),
    rough: 0.34,
    craters: 6,
    ice: b.look.owner === 'hollow-wake' ? 0 : 0.05,
    stretch: [r.range(1.1, 1.3), r.range(0.78, 0.92), r.range(0.85, 1.0)],
    color: pal.rock,
  });
  rock.scale(rockR, rockR, rockR);
  /** Distance from the rock centre to its surface along a direction (the rock is star-shaped). */
  const surface = (dir: V3): number => surfaceAlong(rock, dir, rockR);
  /** Highest rock z inside an x/y footprint around (cx, cy). */
  const rockFront = (hx: number, hy: number, cx = 0, cy = 0): number => surfaceZ(rock, cx, cy, hx, hy, 0, 3);
  const head: V3 = [bay.w + 22, bay.h + 20, bay.depth + 12];
  const habR = Math.max(9, R * 0.065);
  const habY = head[1] / 2 + habR + 3;
  const spineW = Math.max(16, R * 0.12);
  const spineH = 2 * (habY + habR + 6);
  const hl = R * r.range(0.42, 0.56);
  // Front face of the rock behind the complex footprint, and behind the spine's middle.
  const zRock = rockFront(Math.max(head[0] / 2 + 62, hl / 2 + 6), spineH / 2 + 10);
  k.add('rock', rock, { color: undefined });

  // Habitat complex clamped to the rock face: a spine, hab cylinders across it, the dock in front.
  // The spine's back is sunk into the rock.
  const zS = zRock - 6;
  const spineD = 16;
  block(b, body, frameAt([0, 0, zS + spineD / 2 - 2]), [spineW, spineH, spineD], { color: pal.hull, windows: 1, windowFaces: ['+z', '+x', '-x'], trim: pal.trim }, rd);
  const zDock = zS + spineD + head[2] - 2;
  hangarBlock(b, body, frameAt([0, 0, zDock]), head, pal.hullAlt, bayStyle(b, { chase: '#ffb640' }), bay);
  for (const y of [habY, -habY]) {
    cylModule(b, body, frameAt([-hl / 2, y, zS + habR + 3], [1, 0, 0]), habR, hl, y > 0 ? pal.hull : pal.hullAlt, rd, { windows: 1, trim: pal.trim });
    for (const x of [-hl / 2, hl / 2]) beacon(b, body, [x + Math.sign(x) * 1.5, y, zS + habR + 3], x > 0 ? '#30ff70' : '#ff3020', 4, 0.7, y > 0 ? 0 : 0.5);
  }
  // Anchor struts from the spine and the hab ends into the rock.
  const strut = Math.max(1.6, R * 0.012);
  for (const [x, y] of [
    [spineW * 0.4, spineH * 0.45],
    [-spineW * 0.4, spineH * 0.45],
    [spineW * 0.4, -spineH * 0.45],
    [-spineW * 0.4, -spineH * 0.45],
    [hl * 0.45, habY],
    [-hl * 0.45, habY],
    [hl * 0.45, -habY],
    [-hl * 0.45, -habY],
  ] as const) {
    // Each strut ends a few metres inside the rock face behind it.
    const ex = x * 0.75;
    const ey = y * 0.8;
    const zIn = Math.min(zS, rockFront(8, 8, ex, ey)) - 6;
    rod(k, 'metal', [x, y, zS + 1], [ex, ey, zIn], strut, pal.metalDark, 6);
  }
  // Processing plant on top with a glowing furnace slit, ore silos and fuel spheres beside it.
  const plantY = spineH / 2 + 10;
  const plant: V3 = [R * 0.22, 20, R * 0.16];
  block(b, body, frameAt([0, plantY, zS + 4]), plant, { color: pal.hullAlt, band: pal.band, roof: 0.8 }, rd);
  boxIn(k, frameAt([0, plantY, zS + 4]), 'emissive', [plant[0] * 0.8, 1.6, plant[2] + 0.8], [0, 3, 0], col('#ff9a40').multiplyScalar(1.6));
  // Ore silos on one side of the dock head and fuel spheres on the other, between the habs.
  const siloSide = r.next() < 0.5 ? 1 : -1;
  const silos = r.int(2, 3);
  const siloR = Math.max(4, R * 0.03);
  const gapY = habY - habR - 3;
  for (let i = 0; i < silos; i++) {
    const x = siloSide * (head[0] / 2 + siloR + 5 + i * (siloR * 2 + 3));
    capsuleTank(b, body, frameAt([x, -gapY, zS + siloR + 3], [0, 1, 0], [0, 0, 1]), siloR, gapY * 2, r.pick(pal.tanks));
  }
  const spheres = r.int(2, 3);
  const sr = Math.min(gapY * 0.9, R * 0.05);
  for (let i = 0; i < spheres; i++) {
    sphereTank(b, body, [-siloSide * (head[0] / 2 + sr + 5 + i * (sr * 2 + 3)), 0, zS + sr + 3], sr, r.pick(pal.tanks));
  }

  // Drill rigs on the rock flanks feeding conveyors to the plant.
  const dirs: V3[] = [norm([1, r.range(-0.4, 0.1), r.range(-0.3, 0.2)]), norm([-1, r.range(-0.4, 0.1), r.range(-0.3, 0.2)]), norm([r.range(-0.3, 0.3), -1, r.range(-0.2, 0.2)])];
  const rigs = b.size > 0.4 ? 3 : 2;
  const drillAt: { pos: V3; dir: V3 }[] = [];
  const belts: { a: THREE.Vector3; e: THREE.Vector3 }[] = [];
  const plantIn: V3 = [0, plantY, zS + 4 - plant[2] / 2];
  for (let i = 0; i < rigs; i++) {
    const n = dirs[i]!;
    const s = surface(n);
    // Rigs on far-reaching bulges get shorter so the outpost keeps its size.
    const rig = Math.min(R * 0.16, R * 0.92 - s - 10);
    if (rig < 12) continue;
    const base: V3 = [n[0] * (s - 3), n[1] * (s - 3), n[2] * (s - 3)];
    const topP: V3 = [n[0] * (s + rig), n[1] * (s + rig), n[2] * (s + rig)];
    truss(b, body, base, topP, Math.max(5, R * 0.035));
    const f = frameAt(topP, n);
    boxIn(k, f, 'hull', [R * 0.07, R * 0.05, R * 0.06], [0, 0, 2], b.paint(pal.hullAlt));
    beacon(b, body, tp(f, [0, R * 0.03, R * 0.035]), '#ffb640', 5, 0.7, i * 0.3);
    lamp(b, body, [n[0] * (s + 8), n[1] * (s + 8), n[2] * (s + 8)], 10, 0.9);
    drillAt.push({ pos: [n[0] * (s - 1), n[1] * (s - 1), n[2] * (s - 1)], dir: n });
    // Enclosed conveyor from the rig head to the plant.
    const from: V3 = [n[0] * (s + rig * 0.88), n[1] * (s + rig * 0.88), n[2] * (s + rig * 0.88)];
    const mid: V3 = [from[0] * 0.55, Math.max(from[1], plantY) + 6, Math.min(from[2], zS - 6)];
    for (const [a, e] of [
      [from, mid],
      [mid, plantIn],
    ] as [V3, V3][]) {
      const d = dist(a, e);
      if (d < 2) continue;
      k.add('metal', new THREE.BoxGeometry(4.5, 4.5, d), { position: mix(a, e, 0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(e[0] - a[0], e[1] - a[1], e[2] - a[2]).normalize()), color: pal.metal });
      belts.push({ a: new THREE.Vector3(...a), e: new THREE.Vector3(...e) });
    }
  }
  // Spinning drill heads (one instanced mesh).
  const drillR = Math.max(3.5, R * 0.03);
  const drillGeo = b.moverGeometry((kit, key) => {
    kit.add(key, new THREE.CylinderGeometry(drillR * 0.6, drillR * 0.6, drillR * 3, 8), { rotation: [Math.PI / 2, 0, 0], position: [0, 0, -drillR * 1.5], color: pal.metal });
    kit.add(key, new THREE.ConeGeometry(drillR, drillR * 2.6, 8), { rotation: [-Math.PI / 2, 0, 0], position: [0, 0, drillR * 0.8], color: col('#8a6a4a') });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.add(key, new THREE.BoxGeometry(0.5, drillR * 0.5, drillR * 2.4), { position: [Math.cos(a) * drillR * 0.7, Math.sin(a) * drillR * 0.7, 0], rotation: [0, 0, a], color: pal.metalDark });
    }
  });
  const qBase = drillAt.map((d) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-d.dir[0], -d.dir[1], -d.dir[2])));
  const dPos = drillAt.map((d) => new THREE.Vector3(...d.pos));
  const qSpin = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const one = new THREE.Vector3(1, 1, 1);
  const spin = b.ctx.reducedMotion ? 0.8 : 1.6;
  b.mover('drills', 'metal', drillGeo, drillAt.length, b.spinReach(drillAt.map((d) => d.pos), drillGeo), (i, time, out) => {
    qSpin.setFromAxisAngle(zAxis, time * spin + i);
    q.copy(qBase[i]!).multiply(qSpin);
    out.compose(dPos[i]!, q, one);
  });
  // Ore buckets riding the conveyors (one instanced mesh).
  const per = byQuality(b.quality, 3, 5, 6);
  const bucketGeo = b.moverGeometry((kit, key) => kit.add(key, new THREE.BoxGeometry(3.4, 3.4, 3.4), { color: col('#9a8a74') }));
  const beltLen = belts.map((bt) => bt.a.distanceTo(bt.e));
  const bp = new THREE.Vector3();
  const nq = new THREE.Quaternion();
  const speed = (b.ctx.reducedMotion ? 5 : 9) / Math.max(...beltLen, 1);
  const bucketReach = Math.max(...belts.map((bt) => Math.max(bt.a.length(), bt.e.length()))) + 6;
  b.mover('ore-buckets', 'metal', bucketGeo, belts.length * per, bucketReach, (i, time, out) => {
    const bt = belts[Math.floor(i / per)]!;
    const t = (time * speed + (i % per) / per) % 1;
    bp.lerpVectors(bt.a, bt.e, t);
    bp.y += 3.4;
    out.compose(bp, nq, one);
  });
  // Floodlights on the rock face, beacons on the extremities.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const d = norm([Math.cos(a), Math.sin(a) * 0.6, 0.55]);
    const s = surface(d);
    lamp(b, body, [d[0] * (s + 4), d[1] * (s + 4), d[2] * (s + 4)], 12, 0.8);
  }
  beacon(b, body, [0, plantY + 14, zS + 4], pal.beacon, 6, 0.55, 0, true);
  beacon(b, body, [0, -spineH / 2 - 3, zS + 6], pal.beacon, 5, 0.55, 0.5);
}

/* ------------------------------------------------------------------------------------------------
 * Refinery.
 * ---------------------------------------------------------------------------------------------- */

/** Emissive flame cone pointing up from the origin, white-yellow at the root to red at the tip. */
function flameGeometry(radius: number, height: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, seg, 4, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const a = col('#fff2c0').multiplyScalar(2.6);
  const m = col('#ffae40').multiplyScalar(2.1);
  const e = col('#ff4a18').multiplyScalar(1.4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    if (t < 0.45) c.copy(a).lerp(m, t / 0.45);
    else c.copy(m).lerp(e, (t - 0.45) / 0.55);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function refinery(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  const halfL = R * 0.64;
  const zS = -R * 0.06;
  const spine: V3 = [halfL * 2, 12, 18];

  // Pipe rack spine with pipes along it.
  boxIn(k, frameAt([0, 0, zS]), 'hull', spine, [0, 0, 0], b.paint(pal.hullAlt));
  for (const [y, z, pr] of [
    [8.5, -5, 2.4],
    [8.5, 3, 1.8],
    [-8.5, -4, 2.8],
    [-8.5, 5, 1.6],
  ] as const) {
    rod(k, 'metal', [-halfL - 4, y, zS + z], [halfL + 4, y, zS + z], pr, r.next() < 0.5 ? pal.metal : col('#b07a3a'), b.segSmall);
  }
  for (let i = -3; i <= 3; i++) boxIn(k, frameAt([(i * halfL) / 3.4, 0, zS]), 'metal', [3, 20, 20], [0, 0, 0], pal.band);

  // Control and dock block in front of the middle of the spine.
  const head: V3 = [bay.w + 32, bay.h + 30, bay.depth + 18];
  const zF = zS + spine[2] / 2 + head[2] - 2;
  hangarBlock(b, body, frameAt([0, 0, zF]), head, pal.hull, bayStyle(b, { chase: '#ffb640' }), bay);
  block(b, body, frameAt([0, head[1] / 2 + 7, zF - head[2] * 0.55]), [head[0] * 0.6, 14, head[2] * 0.6], { color: pal.hull, windows: 1, windowFaces: ['+z', '+x', '-x'], trim: pal.trim }, rd);

  // Distillation towers rising from the rack; the tallest near the middle.
  const nT = Math.round(3 + b.size * 2 + r.int(0, 1));
  const towerCols = [pal.hull, ...pal.tanks];
  for (let i = 0; i < nT; i++) {
    const u = nT === 1 ? 0 : i / (nT - 1) - 0.5;
    const x = u * halfL * 1.7 + r.range(-0.03, 0.03) * R;
    const tr = R * r.range(0.035, 0.055);
    const th = R * (0.36 + 0.36 * (1 - Math.abs(u) * 1.6)) * r.range(0.8, 1.05);
    const z = zS - 1 + r.range(-2, 2);
    const seg = b.seg;
    const c = b.paint(r.pick(towerCols));
    k.add('hull', new THREE.CylinderGeometry(tr, tr * 1.08, th, seg), { position: [x, 6 + th / 2, z], color: c });
    k.add('hull', new THREE.SphereGeometry(tr, seg, Math.max(4, seg >> 2), 0, Math.PI * 2, 0, Math.PI / 2), { position: [x, 6 + th, z], color: c });
    const bands = Math.max(2, Math.round(th / 22));
    for (let j = 1; j <= bands; j++) {
      const y = 6 + (th * j) / (bands + 1);
      k.add('metal', new THREE.CylinderGeometry(tr * 1.12, tr * 1.12, 1.6, seg, 1, true), { position: [x, y, z], color: pal.band });
      if (j % 2 === 0 && b.room(300)) k.add('metal', new THREE.CylinderGeometry(tr * 1.5, tr * 1.5, 0.6, seg), { position: [x, y + 2, z], color: pal.metal });
    }
    // A glowing sight-glass slit and an aviation beacon on top.
    k.add('emissive', new THREE.BoxGeometry(1.2, th * 0.3, 1.2), { position: [x + tr * 0.96, 6 + th * 0.45, z], color: col('#ff9a40').multiplyScalar(1.5) });
    beacon(b, body, [x, 6 + th + tr + 1.5, z], pal.beacon, 5, 0.5, i * 0.17);
    // Riser pipe from the rack.
    rod(k, 'metal', [x + tr + 1.6, 8, z - 3], [x + tr + 1.6, 6 + th * 0.7, z - 3], 1.2, pal.metal, 6);
  }

  // Spherical tank farms hanging below the rack.
  const farms = b.size > 0.5 ? 3 : 2;
  for (let f = 0; f < farms; f++) {
    const cx = (f - (farms - 1) / 2) * halfL * 0.75 + r.range(-0.05, 0.05) * R;
    const count = r.int(2, 4);
    const tr = R * r.range(0.06, 0.085);
    const c = r.pick(pal.tanks);
    for (let i = 0; i < count; i++) {
      const x = cx + (i - (count - 1) / 2) * tr * 2.3;
      const y = -spine[1] / 2 - tr - 8 - (i % 2) * tr * 0.4;
      const z = zS + (i % 2 ? -1 : 1) * tr * 0.3;
      sphereTank(b, body, [x, y, z], tr, c);
      rod(k, 'metal', [x, -spine[1] / 2, z], [x, y + tr * 0.8, z], Math.max(1.2, tr * 0.1), pal.metalDark, 6);
    }
  }

  // Radiator fins behind the rack: a comb of panels.
  const fins = Math.round(4 + b.size * 4);
  for (let i = 0; i < fins; i++) {
    const x = (i / (fins - 1) - 0.5) * halfL * 1.6;
    // Panel frame: +X runs back from the rack, the thin axis across the rack, the width up/down.
    const f = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)).setPosition(x, 0, zS - spine[2] / 2 - 1);
    radiator(b, body, f, R * 0.22, R * 0.3);
  }

  // Flare stack at one end, its flame on its own flickering part.
  const side = r.next() < 0.5 ? 1 : -1;
  const fx = side * (halfL + R * 0.05);
  const fh = R * r.range(0.56, 0.66);
  truss(b, body, [fx, -spine[1] / 2, zS], [fx, fh, zS], Math.max(5, R * 0.03));
  boxIn(k, frameAt([fx - side * R * 0.03, 0, zS]), 'metal', [R * 0.06, 6, 6], [0, 0, 0], pal.metal);
  const tipR = Math.max(2.2, R * 0.014);
  k.add('metal', new THREE.CylinderGeometry(tipR, tipR * 1.3, 8, b.segSmall), { position: [fx, fh + 4, zS], color: pal.metalDark });
  const flame = b.part('flame', body.group, false, 8);
  flame.group.position.set(fx, fh + 8, zS);
  const fl = R * 0.1;
  flame.kit.add('emissive', flameGeometry(tipR * 2.4, fl, b.segSmall + 2), { color: undefined });
  flame.kit.add('emissive', flameGeometry(tipR * 1.3, fl * 0.62, b.segSmall), { color: undefined, rotation: [0, 0.5, 0] });
  for (let i = 0; i < 3; i++) {
    b.light(flame, { p: [0, fl * (0.15 + i * 0.3), 0], color: i === 0 ? '#ffe6a0' : i === 1 ? '#ffae40' : '#ff5a20', size: fl * (1.1 - i * 0.25), intensity: 1.6 - i * 0.35, blink: 7 + i * 3, duty: 0.8, min: 0.55, phase: i * 0.3 }, { essential: true });
  }
  const calm = b.ctx.reducedMotion ? 0.3 : 1;
  b.ticks.push((time) => {
    // Flicker by shrinking only, so the measured bounds always hold.
    const s = 1 - calm * (0.12 + 0.06 * Math.sin(time * 11.3) + 0.05 * Math.sin(time * 17.1 + 1.3));
    flame.group.scale.set(1 - calm * 0.05 * (1 + Math.sin(time * 9.1)), s, 1 - calm * 0.05 * (1 + Math.cos(time * 8.3)));
  });
  for (const s2 of [-1, 1]) beacon(b, body, [s2 * (halfL + 5), 8, zS], pal.beacon, 5, 0.6, s2 > 0 ? 0.5 : 0);
  for (let i = 0; i < 4; i++) lamp(b, body, [(i / 3 - 0.5) * halfL * 1.4, -spine[1] / 2 - 3, zS + 10], 12, 0.7);
}

/* ------------------------------------------------------------------------------------------------
 * Factory.
 * ---------------------------------------------------------------------------------------------- */

export function factory(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  const halfL = R * 0.74;
  const zS = -R * 0.04;
  const spine: V3 = [halfL * 2, 18, 18];

  // Conveyor spine: a box girder with pipe runs on top and a belt track on its back face.
  boxIn(k, frameAt([0, 0, zS]), 'hull', spine, [0, 0, 0], b.paint(pal.hullAlt));
  boxIn(k, frameAt([0, 0, zS]), 'metal', [spine[0] + 1, 2.4, spine[2] + 1], [0, spine[1] / 2 - 1.4, 0], pal.band);
  for (const [z, pr] of [
    [-5, 1.8],
    [5, 1.4],
  ] as const) {
    rod(k, 'metal', [-halfL, spine[1] / 2 + pr + 0.5, zS + z], [halfL, spine[1] / 2 + pr + 0.5, zS + z], pr, r.next() < 0.5 ? pal.metal : col('#b07a3a'), b.segSmall);
  }
  const trackZ = zS - spine[2] / 2 - 2.5;
  // Terminal blocks on both ends; the belt runs into them, so cargo appears and vanishes inside.
  for (const s of [-1, 1]) {
    const tf = frameAt([s * (halfL + 7), 0, (trackZ - 3.5 + zS + spine[2] / 2 + 3) / 2]);
    block(b, body, tf, [14, spine[1] + 8, spine[2] / 2 + 3 - (trackZ - 3.5 - zS)], { color: pal.hull, windows: 0, trim: pal.trim }, rd);
  }
  boxIn(k, frameAt([0, 0, trackZ]), 'metal', [spine[0] + 8, 1.2, 5], [0, -2.2, 0], pal.metalDark);
  for (const y of [1.6, -5.6]) boxIn(k, frameAt([0, 0, trackZ]), 'metal', [spine[0] + 8, 0.8, 0.8], [0, y, -2.4], pal.metal);
  // Dock block at the middle front.
  const head: V3 = [bay.w + 30, bay.h + 30, bay.depth + 16];
  const zF = zS + spine[2] / 2 + head[2] - 2;
  hangarBlock(b, body, frameAt([0, 0, zF]), head, pal.hull, bayStyle(b, { chase: '#ffb640' }), bay);
  neonSign(b, body, frameAt([0, head[1] / 2 - bay.h * 0.22, zF + 0.7]), bay.w * 1.05, bay.h * 0.36, pal.glow, rd, pal.glowAlt);

  // Stacks of fabrication modules along the spine, above and below it: the factory skyline.
  const stations = Math.round(6 + b.size * 4);
  const pitch = (halfL * 2) / stations;
  const cols = [pal.hull, pal.hull, pal.hullAlt, pal.panel, ...pal.patches.slice(0, 2)];
  const roofs: V3[] = [];
  for (let i = 0; i < stations; i++) {
    const x = -halfL + pitch * (i + 0.5);
    if (Math.abs(x) < head[0] / 2 + pitch * 0.3) continue;
    for (const up of [1, -1]) {
      if (r.next() < 0.12) continue;
      let y = (up * spine[1]) / 2;
      const levels = up > 0 ? r.int(1, 3) : r.int(1, 2);
      let w = pitch * r.range(0.74, 0.94);
      let d = R * r.range(0.16, 0.26);
      for (let j = 0; j < levels; j++) {
        const h = R * r.range(0.07, 0.12);
        const f = frameAt([x + r.range(-0.08, 0.08) * pitch, y + (up * h) / 2, zS + r.range(-0.03, 0.03) * R]);
        const furnace = r.next() < 0.3;
        block(b, body, f, [w, h, d], { color: r.pick(cols), windows: furnace ? 0 : 1, windowFaces: ['+z', '-z'], roof: up > 0 && j === levels - 1 ? 0.8 : 0, trim: r.next() < 0.3 ? pal.trim : null }, rd);
        if (furnace) {
          // Orange furnace slits on the front and back.
          for (const s of [1, -1]) boxIn(k, f, 'emissive', [w * 0.7, Math.max(1.2, h * 0.08), 0.8], [0, h * 0.18, (s * d) / 2 + s * 0.2], col('#ff8a30').multiplyScalar(1.7));
        }
        y += up * (h + 0.6);
        // Upper levels step in: stacked modules rather than one tall box.
        w *= r.range(0.7, 0.95);
        d *= r.range(0.75, 1);
      }
      if (up > 0) roofs.push([x, y, zS]);
    }
  }
  // Vent stacks with glowing mouths, or pairs of radiator fins, on the roofs.
  const finFrame = (x: number, y: number, z: number): THREE.Matrix4 =>
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)).setPosition(x, y, z);
  for (const [x, y, z] of roofs) {
    const pick = rd.next();
    if (pick < 0.5) {
      const vh = R * rd.range(0.08, 0.15);
      const vr = Math.max(2, R * 0.012);
      const vx = x + rd.range(-0.2, 0.2) * pitch;
      k.add('metal', new THREE.CylinderGeometry(vr, vr * 1.25, vh, b.segSmall), { position: [vx, y + vh / 2, z], color: pal.metal });
      k.add('emissive', new THREE.CylinderGeometry(vr * 1.02, vr * 1.02, 1.2, b.segSmall, 1, true), { position: [vx, y + vh - 1, z], color: col('#ff9a40').multiplyScalar(1.6) });
      beacon(b, body, [vx, y + vh + 1.5, z], '#ffb640', 4, 0.8, rd.next());
    } else if (pick < 0.8) {
      for (const s of [-1, 1]) radiator(b, body, finFrame(x + s * pitch * 0.16, y, z), R * 0.1, R * 0.12);
    }
  }
  // Container racks on the spine front, either side of the dock block.
  for (const s of [-1, 1]) {
    const x0 = s * (head[0] / 2 + 8);
    const n = Math.max(2, Math.floor((halfL - Math.abs(x0) - 10) / 12.6));
    const f = subFrame(frameAt([s > 0 ? x0 + 6 : x0 - 6 - (n - 1) * 12.6, -spine[1] / 2 + 1.5, zS + spine[2] / 2 + 2]), [0, 0, 0]);
    containers(b, body, f, n, 3, rd, [12, 3, 3]);
  }

  // Containers riding the belt behind the spine (one instanced mesh), wrapping at the ends.
  const count = byQuality(b.quality, 8, 12, 16);
  const cGeo = b.moverGeometry((kit, key) => {
    kit.add(key, new THREE.BoxGeometry(11, 3.2, 3.2), { color: col('#ffffff') });
  });
  const run = spine[0] + 14;
  const cargo = pal.cargo;
  const colorsAttr = new Float32Array(count * 3);
  const mv = b.mover('belt-cargo', 'hull', cGeo, count, Math.hypot(run / 2 + 6, 4, Math.abs(trackZ) + 2), (i, time, out) => {
    const t = (time * (b.ctx.reducedMotion ? 3 : 6) + (i * run) / count) % run;
    out.makeTranslation(-run / 2 + t, 0, trackZ);
  });
  for (let i = 0; i < count; i++) {
    const c = b.paint(cargo[i % cargo.length]!, 0.1);
    colorsAttr[i * 3] = c.r;
    colorsAttr[i * 3 + 1] = c.g;
    colorsAttr[i * 3 + 2] = c.b;
  }
  mv.mesh.instanceColor = new THREE.InstancedBufferAttribute(colorsAttr, 3);
  // Amber work beacons on the spine ends and floodlights under the blocks.
  for (const s of [-1, 1]) {
    beacon(b, body, [s * (halfL + 2), spine[1] / 2 + 2, zS], '#ffb640', 6, 0.9, s > 0 ? 0 : 0.5);
    lamp(b, body, [s * halfL * 0.5, -spine[1] / 2 - 4, zS + 12], 12, 0.7);
  }
  beacon(b, body, [0, head[1] / 2 + 3, zF - head[2] * 0.5], pal.beacon, 6, 0.55, 0, true);
}

import * as THREE from 'three';
import { loft, rod, slab } from '../kit.ts';
import type { LoftSection, V3 } from '../kit.ts';
import { rockGeometry } from '../rocks.ts';
import type { Rng } from '../shipgen/palette.ts';
import { byQuality } from '../util.ts';
import type { GenPart, StationGen } from './builder.ts';
import { addIn, add, boxIn, frameAt, len, norm, scale, subFrame, surfaceAlong, surfaceZ, tp, windowPlane } from './geom.ts';
import {
  antenna,
  baySize,
  bayStyle,
  beacon,
  block,
  cylModule,
  dish,
  hangarBlock,
  hangarDoor,
  lamp,
  lightRow,
  turretGeometry,
  truss,
} from './parts.ts';

/**
 * Hostile-looking stations: the military base (a layered armour wedge or a fortress of armour
 * blocks, turrets sweeping on every deck, bold faction stripes, a hangar block in the stern) and
 * the pirate den (a dark rock cluster or a broken wreck, jury-rigged modules, spiky masts,
 * red lights, a bunker bay).
 */

const col = (c: THREE.ColorRepresentation): THREE.Color => new THREE.Color(c);

interface TurretSpot {
  pos: V3;
  /** Up direction of the mount. */
  up: V3;
}

/** One instanced mesh of turrets sweeping slowly about their mounts. */
function turrets(b: StationGen, spots: TurretSpot[], size: number, color: THREE.Color, r: Rng): void {
  if (spots.length === 0) return;
  const geo = turretGeometry(b, size, color);
  const base = spots.map((s) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...s.up).normalize()));
  const pos = spots.map((s) => new THREE.Vector3(...s.pos));
  const phase = spots.map(() => r.range(0, Math.PI * 2));
  const rate = spots.map(() => r.range(0.12, 0.25) * (b.ctx.reducedMotion ? 0.5 : 1));
  const yAxis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const reach = b.spinReach(spots.map((s) => s.pos), geo);
  b.mover('turrets', 'hull', geo, spots.length, reach, (i, time, out) => {
    yaw.setFromAxisAngle(yAxis, Math.sin(time * rate[i]! + phase[i]!) * 1.4 + phase[i]!);
    q.copy(base[i]!).multiply(yaw);
    out.compose(pos[i]!, q, one);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Military base.
 * ---------------------------------------------------------------------------------------------- */

/** Scales a planform about its centroid. */
function shrink(pf: [number, number][], s: number, dz = 0): [number, number][] {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pf) {
    cx += x;
    cz += z;
  }
  cx /= pf.length;
  cz /= pf.length;
  return pf.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s + dz]);
}

/** Point-in-polygon for planforms. */
function inside(pf: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = pf.length - 1; i < pf.length; j = i++) {
    const [xi, zi] = pf[i]!;
    const [xj, zj] = pf[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function militaryBase(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  const armour = b.paint(pal.hull, 0.03);
  const armour2 = b.paint(pal.panel, 0.03);
  const spots: TurretSpot[] = [];
  const stripe = pal.trim;
  const head: V3 = [bay.w + 40, bay.h + 34, bay.depth + 24];

  if (r.next() < 0.6) {
    // Layered armour wedge, nose towards -Z, a hangar block set into the stern.
    const W = R * r.range(0.56, 0.66);
    const nose = -R * 0.92;
    const stern = R * 0.36;
    const pf: [number, number][] = [
      [0, nose],
      [W, R * 0.02],
      [W * 0.84, stern],
      [W * 0.3, stern],
      [W * 0.22, stern - R * 0.08],
      [-W * 0.22, stern - R * 0.08],
      [-W * 0.3, stern],
      [-W * 0.84, stern],
      [-W, R * 0.02],
    ];
    const T = Math.max(bay.h + 20, R * 0.13);
    const layers: [number, number, number, THREE.Color][] = [
      [1, T, 0, armour],
      // The middle deck carries the faction colour, big and bold.
      [0.8, T * 0.42, T / 2 + T * 0.21 - 0.5, pal.trim.clone().lerp(pal.hull, 0.28)],
      [0.56, T * 0.36, T / 2 + T * 0.42 + T * 0.18 - 1, armour],
      [0.82, T * 0.4, -T / 2 - T * 0.2 + 0.5, armour2],
    ];
    const tops: { pf: [number, number][]; y: number; bevel: number }[] = [];
    for (const [s, th, y, c] of layers) {
      const lp = shrink(pf, s, s < 1 ? R * 0.04 : 0);
      const bevel = Math.min(3, th * 0.12);
      addIn(k, frameAt([0, 0, 0]), 'hull', slab(lp, th, bevel), { position: [0, y, 0], color: c, uv: 24 });
      tops.push({ pf: lp, y: y + (y >= 0 ? th / 2 : -th / 2), bevel });
    }
    /** A flat stripe box from a to e (deck plan x/z) at height y. */
    const stripeBox = (a: [number, number], e: [number, number], y: number, w: number, h: number, out = 0): void => {
      const d = new THREE.Vector3(e[0] - a[0], 0, e[1] - a[1]);
      const l = d.length();
      d.normalize();
      k.add('hull', new THREE.BoxGeometry(w, h, l), {
        position: [(a[0] + e[0]) / 2 + d.z * out, y, (a[1] + e[1]) / 2 - d.x * out],
        quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d),
        color: stripe,
      });
    };
    // Rows of lit windows along the flanks of the main slab and the middle deck (outside the
    // bevel, on the straight part of each side wall), skipping the stern.
    for (const ti of [0, 1]) {
      const lp = tops[ti]!;
      const th = layers[ti]![1];
      // On the main slab the windows sit above the leading-edge stripe.
      const yMid = layers[ti]![2] + (ti === 0 ? th * 0.26 : 0);
      const rows = ti === 0 ? 1 : th - 2 * lp.bevel > b.win.row * 2.6 ? 2 : 1;
      if (th - 2 * lp.bevel < rows * b.win.row + 1) continue;
      for (let i = 0; i < lp.pf.length; i++) {
        const a = lp.pf[i]!;
        const e = lp.pf[(i + 1) % lp.pf.length]!;
        const dx = e[0] - a[0];
        const dz = e[1] - a[1];
        const l = Math.hypot(dx, dz);
        // Outward normal of a clockwise-in-XZ outline; skip stern-facing edges and short ones.
        const nx = dz / l;
        const nz = -dx / l;
        if (nz > 0.5 || l < 30) continue;
        // Right-handed: X along the edge, Y up, Z out of the flank.
        const f = new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
        f.setPosition((a[0] + e[0]) / 2 + nx * (lp.bevel + 0.35), yMid, (a[1] + e[1]) / 2 + nz * (lp.bevel + 0.35));
        addIn(k, f, 'windows', windowPlane(l * 0.8, rows, b.win, rd.next(), rd.int(0, 7)), { uv: 0 });
      }
    }
    // Faction chevrons on the top deck: nested Vs pointing at the nose.
    const top = tops[2]!;
    const tn = top.pf[0]!;
    const ts = top.pf[1]!;
    for (const [f, w] of [
      [0.3, R * 0.028],
      [0.5, R * 0.02],
    ] as const) {
      const apex: [number, number] = [tn[0], tn[1] + (ts[1] - tn[1]) * f];
      for (const sgn of [-1, 1]) {
        const arm: [number, number] = [sgn * ts[0] * 0.62, apex[1] + (ts[1] - tn[1]) * 0.34];
        if (inside(top.pf, arm[0], arm[1]) && inside(top.pf, apex[0], apex[1] + 2)) stripeBox(apex, arm, top.y + 0.3, w, 1.2);
      }
    }
    // Bands along the leading edges of the main slab (outside its bevel) and running lights.
    const main = tops[0]!;
    for (const sgn of [-1, 1]) {
      const n0 = main.pf[0]!;
      const s0 = main.pf[sgn > 0 ? 1 : main.pf.length - 1]!;
      // The stripe's own +X points out of the edge on the right side, into it on the left.
      stripeBox(n0, s0, 0, 3, T * 0.3, sgn * (main.bevel + 0.6));
      lightRow(b, body, [sgn * 4, T / 2 + 1, nose + 14], [sgn * (W - 10), T / 2 + 1, R * 0.02], 8, ['#ffffff'], 3, 0, 1.2);
    }
    // Hangar block in the stern notch with the main bay; closed hangars along the stern.
    const zH = stern + head[2] * 0.35;
    hangarBlock(b, body, frameAt([0, 0, zH]), head, armour, bayStyle(b, { lip: [pal.trim, pal.hazard[1]] }), bay);
    for (const sgn of [-1, 1]) {
      const x = sgn * W * 0.57;
      hangarDoor(b, body, frameAt([x, 0, stern + 0.1]), W * 0.38, T * 0.62, rd);
    }
    // Bridge tower on the top deck with sensor masts and a radar dish.
    const bz = R * 0.08;
    const bh = R * 0.1;
    block(b, body, frameAt([0, top.y + bh / 2, bz]), [R * 0.16, bh, R * 0.14], { color: armour, windows: 1, windowFaces: ['-z', '+x', '-x'], trim: stripe, roof: 0.6 }, rd);
    antenna(b, body, [R * 0.05, top.y + bh, bz], [R * 0.05, top.y + bh + R * 0.14, bz], 0.7, pal.beacon);
    antenna(b, body, [-R * 0.05, top.y + bh, bz + R * 0.04], [-R * 0.05, top.y + bh + R * 0.1, bz + R * 0.04], 0.6, '#ffffff', 0.9);
    dish(b, k, frameAt([0, top.y + bh + 6, bz - R * 0.04], [0, 0.7, -0.7]), R * 0.035, R * 0.012, pal.hull);
    // Turrets near the outline of the second deck and under the keel, one on the top deck.
    const tSize = Math.max(10, R * 0.055);
    for (const ti of [1, 2, 3]) {
      const lp = tops[ti]!;
      let cx = 0;
      let cz = 0;
      for (const [x, z] of lp.pf) {
        cx += x;
        cz += z;
      }
      cx /= lp.pf.length;
      cz /= lp.pf.length;
      // Shoulders, aft corners, and the forward edges halfway to the nose.
      const n0 = lp.pf[0]!;
      const picks: [number, number][] =
        ti === 2
          ? [lp.pf[2]!, lp.pf[7]!]
          : [lp.pf[1]!, lp.pf[8]!, lp.pf[2]!, lp.pf[7]!, [(n0[0] + lp.pf[1]![0]) / 2, (n0[1] + lp.pf[1]![1]) / 2], [(n0[0] + lp.pf[8]![0]) / 2, (n0[1] + lp.pf[8]![1]) / 2]];
      for (const [x, z] of picks) {
        const px = cx + (x - cx) * 0.78;
        const pz = cz + (z - cz) * 0.78;
        if (!inside(lp.pf, px, pz)) continue;
        spots.push({ pos: [px, lp.y, pz], up: lp.y > 0 ? [0, 1, 0] : [0, -1, 0] });
      }
    }
    spots.push({ pos: [top.pf[0]![0], top.y, top.pf[0]![1] * 0.55 + top.pf[1]![1] * 0.45], up: [0, 1, 0] });
    turrets(b, spots, tSize, armour2, rd);
    // Tip strobes, beacons and floodlights on the stern.
    beacon(b, body, [0, 0, nose - 2], '#ffffff', 7, 0.9, 0, true);
    for (const sgn of [-1, 1]) {
      beacon(b, body, [sgn * (W + 2), 0, R * 0.02], sgn > 0 ? '#30ff70' : '#ff3020', 6, 0.6, 0.5);
      lamp(b, body, [sgn * W * 0.5, -T / 2 - 4, stern + 6], 12, 0.8);
    }
  } else {
    // Fortress of armour blocks: a core block, wedge-fronted bastions round it, the hangar at +Z.
    const core: V3 = [R * 0.56, R * 0.28, R * 0.62];
    const hex: [number, number][] = (
      [
        [-1, -1],
        [1, -1],
        [1.15, 0],
        [1, 1],
        [-1, 1],
        [-1.15, 0],
      ] as const
    ).map(([x, z]) => [(x * core[0]) / 2, (z * core[2]) / 2]);
    addIn(k, frameAt([0, 0, -R * 0.06]), 'hull', slab(hex, core[1], 3), { color: armour, uv: 24 });
    // Faction band round the core, just outside its bevel.
    addIn(k, frameAt([0, 0, -R * 0.06]), 'hull', slab(shrink(hex, 1 + 8 / core[0]), core[1] * 0.12, 0), { position: [0, core[1] * 0.2, 0], color: stripe, uv: 24 });
    hangarBlock(b, body, frameAt([0, -R * 0.02, -R * 0.06 + core[2] / 2 + head[2] - 4]), head, armour2, bayStyle(b, { lip: [pal.trim, pal.hazard[1]] }), bay);
    const bastions = r.int(3, 4);
    for (let i = 0; i < bastions; i++) {
      const a = Math.PI + ((i - (bastions - 1) / 2) / bastions) * Math.PI * 1.5;
      const d: V3 = [Math.sin(a), 0, Math.cos(a)];
      const c: V3 = [d[0] * R * 0.6, (i % 2 ? 1 : -1) * R * 0.06, -R * 0.06 + d[2] * R * 0.56];
      const bw = R * r.range(0.2, 0.26);
      const bl = R * r.range(0.3, 0.38);
      const bpf: [number, number][] = [
        [-bw / 2, -bl / 2],
        [bw / 2, -bl / 2],
        [bw / 2, bl * 0.2],
        [0, bl / 2],
        [-bw / 2, bl * 0.2],
      ];
      const yaw = Math.atan2(d[0], d[2]);
      const f = frameAt(c, d);
      addIn(k, frameAt([0, 0, 0]), 'hull', slab(bpf, R * 0.16, 2.5), { position: c, rotation: [0, yaw, 0], color: i % 2 ? pal.trim.clone().lerp(pal.hull, 0.28) : armour2, uv: 24 });
      rod(k, 'metal', [d[0] * R * 0.25, c[1], -R * 0.06 + d[2] * R * 0.25], c, Math.max(4, R * 0.03), pal.metalDark, 8);
      boxIn(k, f, 'hull', [bw * 0.9, 1.2, R * 0.05], [0, R * 0.08 + 0.3, bl * 0.1], stripe);
      spots.push({ pos: tp(f, [0, R * 0.08, -bl * 0.1]), up: [0, 1, 0] });
      spots.push({ pos: tp(f, [0, -R * 0.08, -bl * 0.1]), up: [0, -1, 0] });
      beacon(b, body, tp(f, [0, 0, bl / 2 + 2]), pal.beacon, 5, 0.6, i / bastions);
    }
    const coreTop = core[1] / 2;
    spots.push({ pos: [core[0] * 0.3, coreTop, -R * 0.2], up: [0, 1, 0] }, { pos: [-core[0] * 0.3, coreTop, -R * 0.2], up: [0, 1, 0] });
    block(b, body, frameAt([0, coreTop + R * 0.05, R * 0.04]), [R * 0.14, R * 0.1, R * 0.12], { color: armour, windows: 1, windowFaces: ['+z', '+x', '-x'], trim: stripe }, rd);
    antenna(b, body, [0, coreTop + R * 0.1, R * 0.04], [0, coreTop + R * 0.26, R * 0.04], 0.8, pal.beacon);
    turrets(b, spots, Math.max(8, R * 0.045), armour2, rd);
    for (const sgn of [-1, 1]) lamp(b, body, [sgn * core[0] * 0.4, -core[1] / 2 - 4, R * 0.1], 12, 0.8);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Pirate den.
 * ---------------------------------------------------------------------------------------------- */

/** Scrap plates, a spiky mast and red lights stuck onto a surface point. */
function jury(b: StationGen, p: GenPart, at: V3, n: V3, r: Rng, big: number): void {
  const k = p.kit;
  const f = frameAt(at, n);
  const plates = r.int(1, 3);
  for (let i = 0; i < plates; i++) {
    addIn(k, f, 'hull', new THREE.BoxGeometry(r.range(0.3, 0.6) * big, r.range(0.25, 0.5) * big, 1.4), {
      position: [r.range(-0.3, 0.3) * big, r.range(-0.3, 0.3) * big, 0.8 + i * 0.5],
      rotation: [r.range(-0.2, 0.2), r.range(-0.2, 0.2), r.range(0, Math.PI)],
      color: b.paint(r.pick(b.pal.patches), 0.15),
    });
  }
  if (r.next() < 0.6) {
    const tip = tp(f, [r.range(-0.2, 0.2) * big, r.range(-0.2, 0.2) * big, big * r.range(0.8, 1.6)]);
    rod(k, 'metal', tp(f, [0, 0, 0]), tip, Math.max(0.5, big * 0.02), b.pal.metal, 4);
    beacon(b, p, tip, '#ff2a1a', Math.max(3, big * 0.12), r.range(0.4, 0.9), r.next());
  }
}

export function pirateDen(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  // Whoever claims it, a den is dark and red-lit: repaint the trims before anything is built.
  pal.trim = col('#7a2216');
  pal.trimAlt = col('#b8321f');
  pal.hazard = [col('#9a2a1a'), col('#141110')];
  pal.glow = col('#ff3a22').multiplyScalar(2);
  pal.bayGlow = col('#ff5a3c').multiplyScalar(1.7);
  pal.beacon = '#ff2a1a';
  // A hint of the owner's paint under the soot.
  const dark = pal.hull.clone().lerp(col('#1c1816'), 0.7);
  const rust = pal.hullAlt.clone().lerp(col('#40261a'), 0.5);
  const red = '#ff2a1a';
  const head: V3 = [bay.w + 24, bay.h + 22, bay.depth + 18];
  const tBay = Math.max(2, bay.w * 0.09);
  const spots: TurretSpot[] = [];
  /** Points on the structure (with their outward normals) where red work lights can hang. */
  const anchors: { at: V3; n: V3 }[] = [];
  const bayLook = bayStyle(b, {
    frame: dark,
    lip: [col('#b8321f'), col('#161312')],
    outline: col('#ff5a3c').multiplyScalar(1.7),
    ceiling: col('#ff9a6a').multiplyScalar(0.9),
    guide: col('#ff3a2a').multiplyScalar(0.9),
    chase: '#ff4a2a',
  });

  if (r.next() < 0.6) {
    // Rock cluster: a bunker bay in the main rock, satellite rocks cabled on.
    const rockR = R * 0.44;
    const tint = pal.rock.clone().lerp(col('#26221f'), 0.62);
    const main = rockGeometry(r.int(1, 1_000_000), { detail: byQuality(b.quality, 3, 4, 5), rough: 0.42, craters: 8, ice: 0, stretch: [r.range(1.05, 1.25), r.range(0.8, 0.95), r.range(0.9, 1.05)], color: tint });
    main.scale(rockR, rockR, rockR);
    // The bunker sits in the rock face with its bay tunnel clear of the rock in front of it.
    const zTunnel = surfaceZ(main, 0, 0, bay.w / 2 + tBay + 3, bay.h / 2 + tBay + 3, rockR);
    k.add('rock', main, { color: undefined });
    const zB = zTunnel + bay.depth + 3;
    hangarBlock(b, body, frameAt([0, 0, zB]), [head[0], head[1], bay.depth + 3 + rockR * 0.3], dark, bayLook, bay);
    // Armour plates bolted round the bunker face.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r.next() * 0.4;
      addIn(k, frameAt([Math.cos(a) * head[0] * 0.55, Math.sin(a) * head[1] * 0.6, zB - 3]), 'hull', new THREE.BoxGeometry(r.range(10, 18), r.range(6, 12), 3), {
        rotation: [r.range(-0.2, 0.2), r.range(-0.2, 0.2), a],
        color: b.paint(r.pick([rust, dark, ...pal.patches]), 0.15),
      });
    }
    const sats = 1 + Math.round(b.size * 2);
    for (let i = 0; i < sats; i++) {
      const a = (i / sats) * Math.PI * 2 + r.range(0, 1);
      const d = norm([Math.cos(a), Math.sin(a) * 0.7, r.range(-0.9, -0.2)]);
      const sr = R * r.range(0.14, 0.22);
      const c = scale(d, rockR * 0.9 + sr * 1.3);
      if (len(c) + sr * 1.35 > R * 0.95) continue;
      const g = rockGeometry(r.int(1, 1_000_000), { detail: byQuality(b.quality, 2, 3, 4), rough: 0.45, craters: 3, color: tint });
      k.add('rock', g, { position: c, scale: sr, color: undefined });
      for (let j = 0; j < 2; j++) {
        const off: V3 = [r.range(-0.3, 0.3) * sr, r.range(-0.3, 0.3) * sr, r.range(-0.3, 0.3) * sr];
        rod(k, 'metal', add(scale(d, rockR * 0.7), off), add(c, off), Math.max(0.8, R * 0.006), pal.metalDark, 5);
      }
      // A shack on each satellite rock.
      const sf = frameAt(add(c, scale(d, sr * 0.7)), d);
      block(b, body, subFrame(sf, [0, 0, 4]), [sr * 0.8, sr * 0.5, sr * 0.6], { color: r.pick([rust, dark]), windows: 0, band: pal.metalDark }, rd);
      boxIn(k, subFrame(sf, [0, 0, 4]), 'emissive', [sr * 0.5, 1.2, sr * 0.62], [0, sr * 0.1, 0], col('#ff7a3a').multiplyScalar(1.3));
      spots.push({ pos: add(c, scale([d[0], Math.abs(d[1]) + 0.5, d[2]], sr * 0.9)), up: norm([d[0], Math.abs(d[1]) + 0.5, d[2]]) });
      beacon(b, body, add(c, scale(d, sr * 1.12)), red, 5, 0.5, i / sats);
    }
    // Jury-rigged modules on the main rock.
    const mods = 3 + Math.round(b.size * 3);
    for (let i = 0; i < mods; i++) {
      const d = norm([r.range(-1, 1), r.range(-1, 1), r.range(-1, 0.25)]);
      const s = surfaceAlong(main, d, rockR) - 1;
      const at = scale(d, s);
      if (!b.clearOfCorridor(at, 30)) continue;
      const f = frameAt(at, d);
      if (r.next() < 0.5) cylModule(b, body, subFrame(f, [0, 0, -4]), R * r.range(0.04, 0.06), R * r.range(0.14, 0.24), r.pick([rust, dark]), rd, { windows: 0, capStart: false });
      else block(b, body, subFrame(f, [0, 0, R * 0.05]), [R * r.range(0.08, 0.14), R * r.range(0.06, 0.1), R * r.range(0.1, 0.16)], { color: r.pick([rust, dark, ...pal.patches]), band: pal.metalDark }, rd);
      jury(b, body, add(at, scale(d, R * 0.02)), d, rd, R * 0.1);
      anchors.push({ at: add(at, scale(d, R * 0.02)), n: d });
      if (i % 2 === 0) spots.push({ pos: add(at, scale(d, R * 0.02)), up: d });
    }
    // Scaffold and a mast above the bunker.
    truss(b, body, [head[0] * 0.3, head[1] / 2, zB - 6], [head[0] * 0.3, head[1] / 2 + R * 0.22, zB - 10], Math.max(4, R * 0.025));
    antenna(b, body, [head[0] * 0.3, head[1] / 2 + R * 0.22, zB - 10], [head[0] * 0.3, head[1] / 2 + R * 0.36, zB - 10], 0.6, red, 0.45);
    beacon(b, body, [head[0] * 0.3, head[1] / 2 + R * 0.36 + 2, zB - 10], red, 7, 0.4, 0, true);
  } else {
    // A broken wreck: the forward hull holds the bay, the aft section drifts on girders.
    const Lh = R * 1.3;
    const hw = R * 0.16;
    const hh = R * 0.14;
    const sec = (x: number, s: number, dy = 0): LoftSection => ({ z: x, pts: [[hw * s * 0.6, hh * s + dy], [hw * s, dy], [hw * s * 0.6, -hh * s + dy], [-hw * s * 0.6, -hh * s + dy], [-hw * s, dy], [-hw * s * 0.6, hh * s + dy]] });
    // Hull runs along X: build along Z in a frame turned onto X.
    const along = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    const fwd = loft([sec(Lh * 0.5, 0.2), sec(Lh * 0.38, 0.8), sec(Lh * 0.2, 1), sec(-Lh * 0.05, 1), sec(-Lh * 0.08, 0.92)], { capStart: true, capEnd: true, baseColor: dark, faceColor: (s, e) => (e === 1 && s < 2 ? pal.trim : s === 3 ? rust : null) });
    addIn(k, along, 'hull', fwd, { uv: 10 });
    const aftFrame = along.clone().multiply(new THREE.Matrix4().makeRotationY(r.range(0.12, 0.25)).setPosition(r.range(-8, 8), -R * 0.08, 0));
    const aft = loft([sec(-Lh * 0.2, 0.9), sec(-Lh * 0.24, 1), sec(-Lh * 0.42, 0.95), sec(-Lh * 0.5, 0.7)], { capStart: true, capEnd: true, baseColor: rust, faceColor: (_s, e) => (e === 4 ? dark : null) });
    addIn(k, aftFrame, 'hull', aft, { uv: 10 });
    // Engine bells on the aft section, dead.
    for (const y of [-hh * 0.4, hh * 0.4]) addIn(k, aftFrame, 'metal', new THREE.CylinderGeometry(hh * 0.28, hh * 0.4, hh * 0.5, b.segSmall + 2), { position: [0, y, -Lh * 0.52], rotation: [Math.PI / 2, 0, 0], color: pal.metalDark });
    // Exposed ribs across the break and girders holding the pieces together.
    for (let i = 0; i < 4; i++) {
      const x = -Lh * (0.09 + i * 0.028);
      const s = 0.95;
      const pts = sec(x, s).pts;
      for (let j = 0; j < pts.length; j++) {
        const a = pts[j]!;
        const e = pts[(j + 1) % pts.length]!;
        if ((i + j) % 3 === 0) continue;
        rod(k, 'metal', tp(along, [a[0], a[1], x]), tp(along, [e[0], e[1], x]), Math.max(0.6, R * 0.006), pal.metal, 4);
      }
    }
    for (const [y, z] of [
      [hh * 0.7, hw * 0.5],
      [-hh * 0.6, -hw * 0.4],
      [hh * 0.1, -hw * 0.9],
    ] as const) {
      truss(b, body, tp(along, [z, y, -Lh * 0.06]), tp(aftFrame, [z, y, -Lh * 0.22]), Math.max(3, R * 0.02));
    }
    // Bunker bay cut into the forward hull's side, facing +Z.
    const zB = hw + bay.depth + 3;
    hangarBlock(b, body, frameAt([Lh * 0.16, 0, zB]), [head[0], head[1], bay.depth + 3 + hw * 0.6], dark, bayLook, bay);
    // Holes, scorch marks and jury-rigged plates along the hull.
    for (let i = 0; i < 8; i++) {
      const x = r.range(-Lh * 0.45, Lh * 0.45);
      const side = r.next() < 0.5 ? 1 : -1;
      const at: V3 = [x, r.range(-0.25, 0.25) * hh, side * hw * 0.9];
      if (!b.clearOfCorridor(at, 20)) continue;
      addIn(k, frameAt(at, [0, 0, side]), r.next() < 0.5 ? 'dark' : 'hull', new THREE.BoxGeometry(r.range(6, 14), r.range(4, 10), 1.5), { color: b.paint(r.pick([rust, ...pal.patches]), 0.2), rotation: [0, 0, r.range(-0.4, 0.4)] });
    }
    for (let i = 0; i < 4 + Math.round(b.size * 3); i++) {
      const x = r.range(-Lh * 0.4, Lh * 0.4);
      const up = r.next() < 0.6 ? 1 : -1;
      const at: V3 = [x, up * hh * 0.9, r.range(-0.4, 0.4) * hw];
      jury(b, body, at, [0, up, 0], rd, R * 0.09);
      anchors.push({ at, n: [0, up, 0] });
      if (i % 2 === 0) spots.push({ pos: at, up: [0, up, 0] });
    }
    antenna(b, body, [Lh * 0.3, hh, 0], [Lh * 0.3, hh + R * 0.3, 0], 0.7, red, 0.45);
    beacon(b, body, [Lh * 0.3, hh + R * 0.3 + 2, 0], red, 7, 0.4, 0, true);
    lamp(b, body, [Lh * 0.1, -hh - 2, 0], 12, 0.6, '#ff7050');
  }
  turrets(b, spots, Math.max(7, R * 0.04), pal.metal.clone().lerp(col('#2a2624'), 0.3), rd);
  // Dim red work lights hung off the jury-rigged parts.
  for (const { at, n } of anchors) lamp(b, body, add(at, n, 4), R * 0.07, 0.3, '#ff5030');
}

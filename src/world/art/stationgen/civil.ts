import * as THREE from 'three';
import { latheZ, rod } from '../kit.ts';
import type { V3 } from '../kit.ts';
import type { StationGen } from './builder.ts';
import { add, addIn, band, boxIn, frameAt, len, norm, scale, subFrame, tp, windowBand } from './geom.ts';
import { SALVAGE, allNeons } from './palette.ts';
import {
  baySize,
  bayStyle,
  beacon,
  beaconHeadGeometry,
  block,
  capsuleTank,
  crossArm,
  cylModule,
  dish,
  dockBay,
  hangarBlock,
  hangarDoor,
  lamp,
  lightRow,
  neonSign,
  parkedShip,
  ring,
  scannerGate,
  solarWing,
  sphereTank,
  spokes,
  truss,
} from './parts.ts';

/**
 * Civil stations: the trade port (spun habitat ring on a spindle, docking arms with berthed ships),
 * the customs depot (hangar block, beacon towers, a tunnel of scanner gates on the approach), the
 * relay (small hub on a tall antenna mast, fuel tanks, a big beacon) and the freeport (a patched
 * cluster of mismatched modules grown around a core, neon signs, string lights).
 */

/* ------------------------------------------------------------------------------------------------
 * Trade port.
 * ---------------------------------------------------------------------------------------------- */

export function tradePort(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const hubR = Math.max(18, R * 0.085);
  const zFront = R * 0.14;
  const zBack = -R * 0.6;
  const zRing = -R * 0.12;
  const seg = b.seg + 6;

  // Spindle: long hub with a pointed tail, window rows and dark bands.
  k.add(
    'hull',
    latheZ(
      [
        [0.001, zBack - hubR * 0.7],
        [hubR * 0.4, zBack - hubR * 0.6],
        [hubR * 0.85, zBack - hubR * 0.15],
        [hubR, zBack + hubR * 0.3],
        [hubR, zFront],
        [0.001, zFront],
      ],
      seg,
    ),
    { color: b.paint(pal.hull, 0.03) },
  );
  const hubLen = zFront - zBack;
  for (let i = 1; i < 6; i++) {
    const z = zBack + (hubLen * i) / 6;
    if (Math.abs(z - zRing) < R * 0.1) continue;
    k.add('metal', band(hubR + 0.6, z - 1.5, z + 1.5, seg, false, 8), { uv: 0, color: pal.band });
  }
  for (let i = 0; i < 4; i++) {
    const z = zBack + hubLen * (0.14 + i * 0.2);
    if (Math.abs(z - zRing) < R * 0.12) continue;
    k.add('windows', windowBand(hubR + 0.35, z, 2, b.win, seg, false, 0, Math.PI * 2, rd.next(), rd.int(0, 7)), { uv: 0 });
  }
  // Core drum at the ring plane: the spokes turn on it.
  const coreR = Math.max(hubR * 1.8, R * 0.17);
  const coreL = R * 0.2;
  k.add('hull', latheZ([[hubR, zRing - coreL * 0.75], [coreR, zRing - coreL * 0.5], [coreR, zRing + coreL * 0.5], [hubR, zRing + coreL * 0.75]], seg), { color: b.paint(pal.hullAlt, 0.03) });
  k.add('windows', windowBand(coreR + 0.35, zRing - coreL * 0.22, 2, b.win, seg, false, 0, Math.PI * 2, rd.next(), 1), { uv: 0 });
  k.add('windows', windowBand(coreR + 0.35, zRing + coreL * 0.22, 2, b.win, seg, false, 0, Math.PI * 2, rd.next(), 5), { uv: 0 });

  // Docking head on the nose with the main bay, a sign and a traffic control deck.
  const bay = baySize(R);
  const head: V3 = [bay.w + 40, bay.h + 34, bay.depth + 20];
  const dockFrame = frameAt([0, 0, zFront + head[2]]);
  hangarBlock(b, body, dockFrame, head, pal.hull, bayStyle(b), bay);
  block(b, body, subFrame(dockFrame, [0, head[1] / 2 + 6, -head[2] * 0.5]), [head[0] * 0.62, 12, head[2] * 0.7], { color: pal.hullAlt, windows: 1, windowFaces: ['+x', '-x', '+z'], roof: 0.6 }, rd);
  neonSign(b, body, subFrame(dockFrame, [0, head[1] / 2 - bay.h * 0.2, 0.7]), bay.w * 0.9, bay.h * 0.34, pal.glow, rd, pal.glowAlt);
  rod(k, 'metal', tp(dockFrame, [0, head[1] / 2 + 12, -head[2] * 0.5]), tp(dockFrame, [0, head[1] / 2 + 12 + R * 0.12, -head[2] * 0.5]), 0.9, pal.metal, 6);
  beacon(b, body, tp(dockFrame, [0, head[1] / 2 + 13 + R * 0.12, -head[2] * 0.5]), pal.beacon, 6, 0.55, 0.2, true);
  for (const s of [-1, 1]) {
    beacon(b, body, tp(dockFrame, [s * head[0] * 0.5, head[1] * 0.5 + 1, -2]), pal.beacon, 5, 0.6, s > 0 ? 0.5 : 0);
    lamp(b, body, tp(dockFrame, [s * (bay.w * 0.5 + 9), -head[1] * 0.36, 3]), 10, 0.9);
  }

  // Docking arms with berths, just behind the head.
  const nArms = Math.min(6, r.int(3, 4) + (b.size > 0.45 ? r.int(0, 2) : 0));
  const armPhase = r.range(0, Math.PI / nArms);
  const zArm = zFront - R * 0.06;
  const armW = Math.max(10, R * 0.042);
  for (let i = 0; i < nArms; i++) {
    const a = armPhase + (i / nArms) * Math.PI * 2;
    const dir: V3 = [Math.cos(a), Math.sin(a), 0];
    const armLen = R * r.range(0.3, 0.42);
    const f = frameAt([dir[0] * hubR * 0.9, dir[1] * hubR * 0.9, zArm], dir, [0, 0, 1]);
    block(b, body, subFrame(f, [0, 0, armLen / 2]), [armW, armW, armLen], { color: pal.hullAlt, band: null, windows: 1, windowFaces: ['+x', '-x'] }, rd);
    // Berth at the tip; in the tip frame +Z runs radially out and +Y along the station axis.
    const tip = subFrame(f, [0, 0, armLen]);
    boxIn(k, tip, 'hull', [armW * 1.8, armW * 2.2, armW * 1.3], [0, 0, 0], pal.hull);
    boxIn(k, tip, 'hull', [armW * 1.84, armW * 0.4, armW * 1.34], [0, armW * 0.6, 0], pal.trim);
    const shipLen = r.range(30, 46);
    boxIn(k, tip, 'metal', [2.6, shipLen * 0.7, 2.6], [0, 0, armW * 0.65 + 1.3], pal.metal);
    if (r.next() < 0.7) {
      // Nose along the station axis, belly out.
      parkedShip(b, body, subFrame(tip, [0, shipLen * 0.05, armW * 0.65 + 2.6 + shipLen * 0.11], [-Math.PI / 2, 0, 0]), shipLen, r.pick([pal.hull, pal.hullAlt, pal.panel, ...pal.cargo]), rd);
    }
    beacon(b, body, tp(tip, [0, armW * 1.1, armW * 0.7]), i % 2 ? '#30ff70' : '#ff3020', 5, 0.8, i / nArms);
    lamp(b, body, tp(tip, [0, -armW * 1.3, armW * 0.8]), 9, 0.7);
  }

  // Aft power section: solar wings round the tail and an aft dish.
  const wings = r.pick([2, 3, 4]);
  const wingPhase = r.range(0, Math.PI);
  for (let i = 0; i < wings; i++) {
    // Wing frame: +X runs radially out, the cells lie in the plane of the station axis.
    const a = wingPhase + (i / wings) * Math.PI * 2;
    const wf = new THREE.Matrix4().makeRotationZ(a).setPosition(Math.cos(a) * hubR * 0.9, Math.sin(a) * hubR * 0.9, zBack + R * 0.07);
    solarWing(b, body, wf, R * 0.4, R * 0.1, 3);
  }
  if (r.next() < 0.6) {
    rod(k, 'metal', [0, 0, zBack - hubR * 0.6], [0, 0, zBack - hubR * 0.6 - R * 0.05], 1.2, pal.metal, 6);
    dish(b, k, frameAt([0, 0, zBack - hubR * 0.6 - R * 0.05], [0.3, 0.4, -1]), R * 0.055, R * 0.016, pal.hull);
  }
  beacon(b, body, [0, 0, zBack - hubR * 0.75], pal.beacon, 6, 0.5, 0, true);

  // Habitat ring(s) on their own spinning part.
  const rings = b.part('rings', b.root, true, 20);
  const hw = Math.max(10, R * 0.05);
  const hd = Math.max(14, R * 0.068);
  const Rr = R * 0.84 - hw;
  const rr = b.rng('rings');
  ring(b, rings, Rr, hw, hd, zRing, { outer: pal.hull, inner: pal.panel, sides: pal.hull, windows: 2, trim: pal.trim, ribs: Math.round(16 + b.detail * 12) }, rr);
  const nSpokes = r.pick([3, 4, 6]);
  const spokePhase = r.range(0, Math.PI);
  spokes(b, rings, nSpokes, coreR, Rr - hw, zRing, Math.max(3, R * 0.013), spokePhase);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + spokePhase;
    beacon(b, rings, [Math.cos(a) * (Rr + hw + 1), Math.sin(a) * (Rr + hw + 1), zRing + hd * 0.7], pal.beacon, 6, 0.6, i / 6);
    lamp(b, rings, [Math.cos(a + 0.5) * (Rr + hw + 3), Math.sin(a + 0.5) * (Rr + hw + 3), zRing], R * 0.1, 0.16);
  }
  // Running lights round both rims of the ring.
  const rim = Math.round(12 + b.detail * 12);
  for (let i = 0; i < rim; i++) {
    const a = ((i + 0.5) / rim) * Math.PI * 2 + spokePhase;
    for (const s of [-1, 1]) b.light(rings, { p: [Math.cos(a) * (Rr + hw * 0.7), Math.sin(a) * (Rr + hw * 0.7), zRing + s * (hd + 0.8)], color: i % 3 ? '#fff2d8' : '#9fd8ff', size: 3.2, intensity: 1.1 });
  }
  if (b.size > 0.4 && r.next() < 0.65) {
    const z2 = zRing - R * 0.27;
    const R2 = Rr * 0.7;
    k.add('hull', latheZ([[hubR, z2 - R * 0.05], [coreR * 0.75, z2 - R * 0.03], [coreR * 0.75, z2 + R * 0.03], [hubR, z2 + R * 0.05]], seg), { color: b.paint(pal.hullAlt, 0.03) });
    ring(b, rings, R2, hw * 0.8, hd * 0.8, z2, { outer: pal.hullAlt, inner: pal.panel, sides: pal.hull, windows: 2, trim: pal.trimAlt, ribs: Math.round(12 + b.detail * 8) }, rr);
    spokes(b, rings, 3, coreR * 0.75, R2 - hw * 0.8, z2, Math.max(2.4, R * 0.01), spokePhase + 0.4, false);
  }
  const spin = (b.ctx.reducedMotion ? 0.6 : 1) * 0.045 * (220 / Math.max(160, Rr));
  const dirSign = r.next() < 0.5 ? 1 : -1;
  b.ticks.push((t) => {
    rings.group.rotation.z = dirSign * t * spin;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Customs depot.
 * ---------------------------------------------------------------------------------------------- */

export function customsDepot(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  const L = R * r.range(0.85, 1.0);
  const H = Math.max(bay.h + 34, R * 0.27);
  const D = R * 0.36;
  const zF = R * 0.06;
  const t = Math.max(2, bay.w * 0.09);

  // Main hangar block: the bay in the middle, closed hangars either side.
  const front = frameAt([0, 0, zF]);
  hangarBlock(b, body, front, [L, H, D], pal.hull, bayStyle(b, { chase: '#ffb640' }), bay);
  const doorW = Math.min(R * 0.14, (L / 2 - bay.w / 2 - t - 10) / 2 - 4);
  const doorsPerSide = doorW > 16 && L / 2 - bay.w / 2 - t > doorW * 2 + 24 ? 2 : 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < doorsPerSide; i++) {
      const x = side * (bay.w / 2 + t + 8 + doorW / 2 + i * (doorW + 8));
      hangarDoor(b, body, subFrame(front, [x, -H * 0.08, 0]), doorW, H * 0.56, rd);
    }
  }
  // Belts and a trim stripe along the long block.
  for (const y of [H / 2 - 3, -H / 2 + 3]) boxIn(k, front, 'metal', [L + 0.8, 2.2, D + 0.8], [0, y, -D / 2], pal.band);
  // Offices, and a control tower on the other end.
  const end = r.next() < 0.5 ? 1 : -1;
  block(b, body, subFrame(front, [-end * L * 0.12, H / 2 + 9, -D * 0.55]), [L * 0.5, 18, D * 0.6], { color: pal.hullAlt, windows: 1, windowFaces: ['+z', '-z', '+x', '-x'], roof: 0.7 }, rd);
  const tx = end * L * 0.3;
  const towerH = R * 0.2;
  block(b, body, subFrame(front, [tx, H / 2 + towerH / 2, -D * 0.4]), [R * 0.1, towerH, R * 0.1], { color: pal.hull, trim: pal.trim, band: null }, rd);
  boxIn(k, subFrame(front, [tx, H / 2 + towerH + 5, -D * 0.4]), 'hull', [R * 0.16, 10, R * 0.14], [0, 0, 0], pal.hullAlt);
  addIn(k, subFrame(front, [tx, H / 2 + towerH + 5, -D * 0.4]), 'windows', new THREE.BoxGeometry(R * 0.162, 3.2, R * 0.142), { uv: 12 });
  neonSign(b, body, subFrame(front, [0, H / 2 - bay.h * 0.22 - 2, 0.7]), bay.w * 1.1, bay.h * 0.36, pal.glow, rd, pal.glowAlt);

  // Beacon towers on the block corners with rotating heads.
  const towers: V3[] = [];
  const four = b.size > 0.35;
  const mastH = R * r.range(0.3, 0.42);
  for (const sx of [-1, 1]) {
    towers.push([sx * (L / 2 - 6), H / 2, zF - D + 10]);
    if (four) towers.push([sx * (L / 2 - 6), -H / 2, zF - D + 10]);
  }
  const tips: V3[] = [];
  for (const base of towers) {
    const up = base[1] > 0 ? 1 : -1;
    const tip: V3 = [base[0], base[1] + up * mastH, base[2]];
    truss(b, body, base, tip, Math.max(4, R * 0.02));
    tips.push(tip);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.light(body, { p: [tip[0] + Math.cos(a) * 5, tip[1] + up * 4, tip[2] + Math.sin(a) * 5], color: i % 2 ? '#ffb640' : '#40ff90', size: 6, intensity: 2.2, blink: 0.4, phase: i / 4, duty: 0.3, min: 0.15 });
    }
    beacon(b, body, [tip[0], tip[1] + up * 9, tip[2]], pal.beacon, 7, 0.5, tips.length * 0.2, true);
  }
  const headSize = Math.max(7, R * 0.04);
  const headGeo = beaconHeadGeometry(b, headSize);
  const spin = b.ctx.reducedMotion ? 0.25 : 0.5;
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const pos = tips.map((t2) => new THREE.Vector3(...t2));
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const reach = b.spinReach(tips, headGeo);
  b.mover('beacon-heads', 'hull', headGeo, tips.length, reach, (i, time, out) => {
    q.setFromAxisAngle(yAxis, time * spin + i * 1.3);
    if (tips[i]![1] < 0) q.premultiply(flip);
    out.compose(pos[i]!, q, one);
  });

  // Scanner gates hung from a gantry along the approach.
  const nGates = b.size > 0.45 ? 3 : 2;
  const gw = 64;
  const gh = 44;
  const thick = 6;
  const spacing = R * (nGates === 3 ? 0.26 : 0.3);
  const z0 = zF + bay.depth * 0.1 + 36;
  for (let i = 0; i < nGates; i++) {
    scannerGate(b, body, frameAt([0, 0, z0 + i * spacing]), gw, gh, thick, nGates - 1 - i);
  }
  const zLast = z0 + (nGates - 1) * spacing;
  const gy = gh / 2 + thick * 1.5 + 3;
  truss(b, body, [0, gy, zF - 6], [0, gy, zLast + 3], 7);
  // Pylon from the block roof when the gantry runs above it.
  if (gy + 4 > H / 2) k.add('metal', new THREE.BoxGeometry(6, gy - H / 2 + 5, 8), { position: [0, (gy + H / 2) / 2, zF - 6], color: pal.metalDark });
  for (let i = 0; i < nGates; i++) {
    k.add('metal', new THREE.BoxGeometry(3, gy - gh / 2 - thick, 3), { position: [0, (gy + gh / 2 + thick) / 2, z0 + i * spacing], color: pal.metal });
    lamp(b, body, [0, gy + 5, z0 + i * spacing], 9, 0.9);
  }
  beacon(b, body, [0, gy + 5, zLast + 4], pal.beacon, 6, 0.6, 0.3, true);

  // Radiators on the back, an aft antenna.
  const back = frameAt([0, 0, zF - D]);
  for (const sx of [-1, 1]) {
    const f = subFrame(back, [sx * L * 0.2, 0, -1], [0, 0, Math.PI / 2]);
    boxIn(k, f, 'metal', [4, 4, 16], [0, 0, -8], pal.metalDark);
    addIn(k, subFrame(f, [0, 0, -16]), 'radiator', new THREE.BoxGeometry(H * 0.9, 0.8, R * 0.22), { position: [0, 0, -R * 0.11], uv: 10 });
  }
  for (const sx of [-1, 1]) beacon(b, body, [sx * (L / 2 + 1), 0, zF - D / 2], pal.beacon, 5, 0.6, sx > 0 ? 0.5 : 0);
}

/* ------------------------------------------------------------------------------------------------
 * Relay.
 * ---------------------------------------------------------------------------------------------- */

export function relay(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  // Hab module crossing the mast, the bay sticking out of its nose.
  const habR = Math.max(15, R * 0.15);
  const habL = R * 0.44;
  cylModule(b, body, frameAt([0, 0, -habL / 2]), habR, habL, pal.hullAlt, rd, { windows: 1, trim: pal.trim, capEnd: false });
  const t = Math.max(2, bay.w * 0.09);
  const collar: V3 = [bay.w + 2 * t + 6, bay.h + 2 * t + 6, 8];
  boxIn(k, frameAt([0, 0, habL / 2 + 2]), 'hull', collar, [0, 0, 0], b.paint(pal.hull));
  boxIn(k, frameAt([0, 0, habL / 2 + 2]), 'hull', [collar[0] + 0.8, 2, collar[2] + 0.8], [0, collar[1] / 2 - 2, 0], pal.trim);
  dockBay(b, body, frameAt([0, 0, habL / 2 + 6 + bay.depth / 2]), bay.w, bay.h, bay.depth, bayStyle(b));
  const zMast = 0;

  // Mast through the hab, top and bottom.
  const top = R * r.range(0.7, 0.82);
  const bottom = -R * r.range(0.55, 0.7);
  const mw = Math.max(4, R * 0.045);
  truss(b, body, [0, bottom, zMast], [0, top, zMast], mw);
  // Panel antennas round the upper mast and cross-arms with dipoles.
  const panels = r.int(2, 4);
  for (let i = 0; i < panels; i++) {
    const a = (i / panels) * Math.PI * 2 + r.next();
    boxIn(k, frameAt([Math.cos(a) * (mw * 0.9 + 1), top * 0.45, zMast + Math.sin(a) * (mw * 0.9 + 1)]), 'hull', [1, R * 0.16, R * 0.07], [0, 0, 0], pal.hull, { rotation: [0, -a, 0] });
  }
  for (const f of [0.3, 0.72]) crossArm(b, body, [0, habR + (top - habR) * f, zMast], R * r.range(0.28, 0.4), [0, 1, 0], 0.5);
  // Fuel tanks round the lower mast, hanging below the hab.
  const nTanks = r.int(4, 6);
  const tr = Math.max(6, R * 0.07);
  const ring0 = mw + tr + 2;
  const tankTop = -(habR + 5);
  const tankLen = Math.min(R * 0.26, -bottom - habR - 14);
  for (let i = 0; i < nTanks; i++) {
    const a = (i / nTanks) * Math.PI * 2 + Math.PI / nTanks;
    const x = Math.cos(a) * ring0;
    const z = zMast + Math.sin(a) * ring0;
    capsuleTank(b, body, frameAt([x, tankTop, z], [0, -1, 0], [0, 0, 1]), tr, tankLen, r.pick(pal.tanks));
    const py = tankTop - tankLen * 0.3;
    rod(k, 'metal', [x * 0.3, py, zMast + (z - zMast) * 0.3], [x * 0.8, py, zMast + (z - zMast) * 0.8], 0.8, pal.metalDark, 6);
  }
  // Solar wings off the hab.
  for (const sx of [-1, 1]) {
    const wf = new THREE.Matrix4().makeRotationY(sx > 0 ? 0 : Math.PI).setPosition(sx * habR * 0.9, 0, -habL * 0.28);
    solarWing(b, body, wf, R * 0.42, R * 0.11, 2);
  }
  // Beacon housing on the mast top: a lens between two caps, and a big slow beacon.
  const lensR = Math.max(2.6, R * 0.028);
  k.add('hull', new THREE.CylinderGeometry(lensR * 1.3, lensR * 1.6, lensR * 1.4, b.seg), { position: [0, top + lensR * 0.7, zMast], color: pal.hull });
  k.add('emissive', new THREE.CylinderGeometry(lensR * 0.9, lensR * 0.9, lensR * 1.2, b.seg), { position: [0, top + lensR * 2, zMast], color: new THREE.Color(pal.beacon).multiplyScalar(1.4) });
  k.add('hull', new THREE.ConeGeometry(lensR * 1.3, lensR * 1.2, b.seg), { position: [0, top + lensR * 3.2, zMast], color: pal.hull });
  b.light(body, { p: [0, top + lensR * 2, zMast], color: pal.beacon, size: R * 0.16, intensity: 2.4, blink: 0.35, duty: 0.3, min: 0.1 }, { essential: true });
  beacon(b, body, [0, bottom - 2, zMast], pal.beacon, 5, 0.55, 0.5);
  lamp(b, body, [0, habR + 2, habL * 0.2], R * 0.1, 0.22);

  // Rotating antenna cluster high on the mast.
  const cluster = b.part('antenna-cluster', body.group, true, 6);
  const cy = top * 0.9;
  cluster.group.position.set(0, cy, zMast);
  const ck = cluster.kit;
  ck.add('hull', new THREE.CylinderGeometry(mw * 0.9, mw * 0.9, 5, b.seg), { color: pal.hullAlt });
  dish(b, ck, frameAt([mw * 1.3, 1, 0], [1, 0.35, 0.2]), R * 0.09, R * 0.025, pal.hull);
  dish(b, ck, frameAt([-mw * 1.1, 2, mw * 0.6], [-0.6, 0.5, 0.8]), R * 0.06, R * 0.017, pal.hull);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    rod(ck, 'metal', [0, 2, 0], [Math.cos(a) * R * 0.18, 5 + (i % 2) * 6, Math.sin(a) * R * 0.18], 0.3, pal.metal, 4);
  }
  beacon(b, cluster, [R * 0.18, 5, 0], '#ffffff', 3.5, 0.9, 0.3);
  const spin = b.ctx.reducedMotion ? 0.06 : 0.1;
  b.ticks.push((time) => {
    cluster.group.rotation.y = time * spin;
  });
}

/* ------------------------------------------------------------------------------------------------
 * Freeport.
 * ---------------------------------------------------------------------------------------------- */

interface Socket {
  pos: V3;
  dir: V3;
}

interface Placed {
  c: V3;
  r: number;
}

/** A frame at `pos` pointing along `dir` with a stable up vector. */
function along(pos: V3, dir: V3): THREE.Matrix4 {
  return frameAt(pos, dir, Math.abs(dir[1]) > 0.8 ? [0, 0, 1] : [0, 1, 0]);
}

export function freeport(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const rc = b.rng('colours');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);

  // Core: a stubby vertical drum with a dome, the dock module in front.
  const coreR = R * 0.15;
  const coreH = R * 0.4;
  k.add('hull', latheZ([[0.001, -coreH / 2 - coreR * 0.3], [coreR * 0.7, -coreH / 2], [coreR, -coreH / 2 + coreR * 0.3], [coreR, coreH / 2 - coreR * 0.3], [coreR * 0.7, coreH / 2], [0.001, coreH / 2 + coreR * 0.3]], b.seg + 4), {
    rotation: [-Math.PI / 2, 0, 0],
    color: b.paint(pal.hull),
  });
  for (const y of [-coreH * 0.25, 0, coreH * 0.25]) {
    k.add('windows', windowBand(coreR + 0.35, y, 2, b.win, b.seg + 4, false, 0, Math.PI * 2, rd.next(), rd.int(0, 7)), { rotation: [-Math.PI / 2, 0, 0], uv: 0 });
  }
  const zF = coreR + bay.depth + 16;
  const head: V3 = [bay.w + 26, bay.h + 24, zF - coreR * 0.6];
  hangarBlock(b, body, frameAt([0, -coreH * 0.12, zF]), head, pal.hullAlt, bayStyle(b, { outline: pal.glow, chase: '#ff5ad8' }), bay);
  const neon = allNeons();
  neonSign(b, body, frameAt([0, -coreH * 0.12 + head[1] / 2 + bay.h * 0.35, zF - 4]), bay.w * 1.4, bay.h * 0.6, b.look.owner === 'independent' ? pal.glow : pal.glow.clone().lerp(rd.pick(neon), 0.3), rd, rd.pick(neon));

  // Grow a patched cluster of modules from sockets on the core and on each new module.
  const placed: Placed[] = [
    { c: [0, 0, 0], r: coreR * 1.1 },
    { c: [0, -coreH * 0.12, zF - head[2] / 2], r: Math.max(head[0], head[1]) * 0.55 },
  ];
  const sockets: Socket[] = [];
  const ringSockets = 6;
  for (let i = 0; i < ringSockets; i++) {
    const a = (i / ringSockets) * Math.PI * 2 + r.next() * 0.5;
    for (const y of [-coreH * 0.3, coreH * 0.28]) {
      const d: V3 = [Math.cos(a), 0, Math.sin(a)];
      sockets.push({ pos: [d[0] * coreR, y, d[2] * coreR], dir: d });
    }
  }
  sockets.push({ pos: [0, coreH / 2 + coreR * 0.3, 0], dir: [0, 1, 0] }, { pos: [0, -coreH / 2 - coreR * 0.3, 0], dir: [0, -1, 0] });
  const target = Math.round(18 + b.size * 16);
  const ms = R / 150;
  let built = 0;
  let signs = 0;
  for (let tries = 0; tries < target * 10 && built < target && sockets.length > 0; tries++) {
    // Grow in layers: of a few random sockets take the one nearest the core, so the cluster
    // stays roughly round instead of sprawling one way.
    // Now and then grow a spike off the far side instead, for a ragged outline.
    const spike = r.next() < 0.28;
    let si = r.int(0, sockets.length - 1);
    for (let j = 0; j < 2; j++) {
      const sj = r.int(0, sockets.length - 1);
      if (spike ? len(sockets[sj]!.pos) > len(sockets[si]!.pos) : len(sockets[sj]!.pos) < len(sockets[si]!.pos)) si = sj;
    }
    const s = sockets[si]!;
    const kind = r.pick(['cyl', 'cyl', 'cyl', 'box', 'box', 'box', 'sphere', 'drum', 'drum'] as const);
    const conn = r.range(3, 9) * ms;
    const dims =
      kind === 'cyl'
        ? [r.range(7, 13) * ms, r.range(26, 60) * ms]
        : kind === 'box'
          ? [r.range(16, 34) * ms, r.range(14, 28) * ms, r.range(18, 44) * ms]
          : kind === 'sphere'
            ? [r.range(9, 16) * ms]
            : [r.range(15, 24) * ms, r.range(10, 16) * ms];
    const extent = kind === 'cyl' ? dims[1]! : kind === 'box' ? dims[2]! : kind === 'sphere' ? dims[0]! * 2 : dims[1]!;
    const bound = kind === 'cyl' ? Math.hypot(dims[0]!, dims[1]! / 2) : kind === 'box' ? Math.hypot(dims[0]! / 2, dims[1]! / 2, dims[2]! / 2) : kind === 'sphere' ? dims[0]! : Math.hypot(dims[0]!, dims[1]! / 2);
    const center = add(s.pos, s.dir, conn + extent / 2);
    const ok =
      len(center) + bound < R * 0.94 &&
      b.clearOfCorridor(center, bound + 4) &&
      placed.every((p) => Math.hypot(p.c[0] - center[0], p.c[1] - center[1], p.c[2] - center[2]) > (p.r + bound) * 0.78);
    if (!ok) {
      if (r.next() < 0.25) sockets.splice(si, 1);
      continue;
    }
    sockets.splice(si, 1);
    placed.push({ c: center, r: bound });
    built++;
    rod(k, 'metal', s.pos, add(s.pos, s.dir, conn + 1), Math.max(2, Math.min(5, bound * 0.18)), pal.metal, b.segSmall);
    // Mismatched modules: the owner's paints, their patches and salvage from anywhere.
    const cr = rc.next();
    const color = cr < 0.3 ? pal.hull : cr < 0.5 ? pal.hullAlt : cr < 0.65 ? rc.pick(pal.patches) : rc.pick(SALVAGE);
    const f = along(add(s.pos, s.dir, conn), s.dir);
    if (kind === 'cyl') {
      cylModule(b, body, f, dims[0]!, dims[1]!, color, rd, { windows: 1, trim: rc.next() < 0.4 ? pal.trim : null, capStart: false });
    } else if (kind === 'box') {
      block(b, body, subFrame(f, [0, 0, dims[2]! / 2]), [dims[0]!, dims[1]!, dims[2]!], { color, windows: 1, roof: 0.5, trim: rc.next() < 0.3 ? pal.trimAlt : null }, rd);
    } else if (kind === 'sphere') {
      sphereTank(b, body, center, dims[0]!, color);
    } else {
      // Short fat drum, axis along the socket direction, with a window belt.
      addIn(k, f, 'hull', new THREE.CylinderGeometry(dims[0]!, dims[0]!, dims[1]!, b.seg + 2), { position: [0, 0, dims[1]! / 2], rotation: [Math.PI / 2, 0, 0], color: b.paint(color) });
      addIn(k, subFrame(f, [0, 0, 0]), 'windows', windowBand(dims[0]! + 0.35, dims[1]! / 2, 1, b.win, b.seg + 2, false, 0, Math.PI * 2, rd.next(), rd.int(0, 7)), { uv: 0 });
    }
    // Neon signs on some box modules, string lights and tip beacons on others.
    const tipPos = add(s.pos, s.dir, conn + extent + 1.5);
    if (kind === 'box' && signs < 2 + Math.round(b.size * 3) && rd.next() < 0.6) {
      signs++;
      const side = subFrame(f, [dims[0]! / 2 + 0.7, 0, dims[2]! / 2], [0, Math.PI / 2, 0]);
      neonSign(b, body, side, Math.min(dims[2]! * 0.8, 28), Math.min(dims[1]! * 0.6, 10), rd.pick(neon), rd, rd.pick(neon));
    }
    if (kind !== 'sphere' && rd.next() < 0.55) {
      // String lights just above the module's skin, on its own up side.
      const yAxis = new THREE.Vector3().setFromMatrixColumn(f, 1);
      const up: V3 = [yAxis.x, yAxis.y, yAxis.z];
      const surf = (kind === 'box' ? dims[1]! / 2 : dims[0]!) + 1.2;
      lightRow(b, body, add(add(s.pos, s.dir, conn), up, surf), add(add(s.pos, s.dir, conn + extent), up, surf), 7, [rd.pick(neon), '#ffe0a0'], 2.6, rd.next() < 0.5 ? 0.6 : 0, 1.2);
    }
    beacon(b, body, tipPos, rd.next() < 0.5 ? pal.beacon : '#ffffff', 4, 0.6 + rd.next() * 0.4, rd.next());
    // New sockets: the far end and the sides of the new module.
    sockets.push({ pos: add(s.pos, s.dir, conn + extent), dir: s.dir });
    const side = norm(Math.abs(s.dir[1]) > 0.8 ? [1, 0, 0] : [s.dir[2], 0, -s.dir[0]]);
    for (const sgn of [-1, 1]) {
      const sd = scale(side, sgn);
      const half = kind === 'cyl' || kind === 'drum' ? dims[0]! : kind === 'box' ? dims[0]! / 2 : dims[0]!;
      sockets.push({ pos: add(center, sd, half), dir: sd });
    }
  }

  // Parked ships on long rods from the core.
  const ships = 1 + Math.round(b.size * 2);
  for (let i = 0; i < ships; i++) {
    const a = r.range(0, Math.PI * 2);
    const y = r.range(-coreH * 0.3, coreH * 0.3);
    const d: V3 = [Math.cos(a), 0, Math.sin(a)];
    const lenShip = r.range(24, 36);
    const c = add([0, y, 0], d, coreR + 18 + lenShip * 0.3);
    if (!b.clearOfCorridor(c, lenShip) || placed.some((p) => Math.hypot(p.c[0] - c[0], p.c[1] - c[1], p.c[2] - c[2]) < p.r + lenShip * 0.6)) continue;
    rod(k, 'metal', add([0, y, 0], d, coreR - 1), add(c, d, -lenShip * 0.2), 1.4, pal.metal, 6);
    parkedShip(b, body, frameAt(add(c, [0, lenShip * 0.3, 0]), [0, 1, 0], d), lenShip, rc.pick(pal.patches), rd);
    placed.push({ c, r: lenShip * 0.6 });
  }
  // Lots of little lights on the core.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.light(body, { p: [Math.cos(a) * (coreR + 1), coreH * 0.42, Math.sin(a) * (coreR + 1)], color: rd.pick(neon), size: 3, intensity: 0.6, blink: 0.4, phase: i / 10, duty: 0.5, min: 0.3 });
  }
  beacon(b, body, [0, coreH / 2 + coreR * 0.35, 0], pal.beacon, 7, 0.5, 0, true);
}

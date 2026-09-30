import * as THREE from 'three';
import { latheZ, rod } from '../kit.ts';
import type { V3 } from '../kit.ts';
import type { GenPart, StationGen } from './builder.ts';
import { addIn, band, boxIn, frameAt, norm, subFrame, tp, windowBand } from './geom.ts';
import {
  baySize,
  bayStyle,
  beacon,
  cylModule,
  dish,
  dockBay,
  hangarBlock,
  lamp,
  ring,
  solarWing,
  sphereTank,
  spokes,
  truss,
} from './parts.ts';

/**
 * Science and life-support stations: the agri-station (a drum of spun greenhouse rings glowing
 * green, greenhouse domes and a flower of sun mirrors) and the research station (sphere
 * modules under observatory domes, a big turning dish, a telescope array and long sensor booms).
 */

const col = (c: THREE.ColorRepresentation): THREE.Color => new THREE.Color(c);

/** Greenhouse glow per owner: always green, the shade leaning towards the owner's palette. */
function greenhouseGlow(b: StationGen): THREE.Color {
  const hue: Record<string, string> = { sta: '#8dffa0', frontier: '#b6ff6a', 'hollow-wake': '#d2ff5a', independent: '#6affb4' };
  return col(hue[b.look.owner] ?? '#8dffa0').multiplyScalar(0.52 * (1 - b.wear * 0.3));
}

/** Greenhouse dome: glowing panes under a lattice of ribs, on +Z of `frame`. */
function greenDome(b: StationGen, p: GenPart, frame: THREE.Matrix4, radius: number, glow: THREE.Color): void {
  const seg = b.seg + 2;
  const k = p.kit;
  addIn(k, frame, 'emissive', new THREE.SphereGeometry(radius, seg, Math.max(4, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2), { rotation: [Math.PI / 2, 0, 0], color: glow });
  const ribs = b.quality === 'low' ? 4 : 6;
  for (let i = 0; i < ribs; i++) {
    addIn(k, frame, 'metal', new THREE.TorusGeometry(radius + 0.3, Math.max(0.35, radius * 0.025), 3, 12, Math.PI), {
      rotation: [0, 0, (i / ribs) * Math.PI],
      color: b.pal.metal,
    });
  }
  for (const f of [0.35, 0.7]) {
    const rr = radius * Math.cos(Math.asin(f));
    addIn(k, frame, 'metal', new THREE.TorusGeometry(rr + 0.3, Math.max(0.35, radius * 0.025), 3, seg), { position: [0, 0, radius * f], color: b.pal.metal });
  }
  addIn(k, frame, 'metal', new THREE.TorusGeometry(radius + 0.4, Math.max(0.6, radius * 0.05), 4, seg), { color: b.pal.band });
}

/* ------------------------------------------------------------------------------------------------
 * Agri-station.
 * ---------------------------------------------------------------------------------------------- */

export function agriStation(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  const glow = greenhouseGlow(b);
  const hubR = Math.max(16, R * 0.075);
  const zFront = R * 0.22;
  const zBack = -R * 0.46;
  const seg = b.seg + 6;

  // Hub spindle with the dock head on its nose.
  k.add('hull', latheZ([[hubR * 0.6, zBack - hubR * 0.3], [hubR, zBack], [hubR, zFront], [0.001, zFront]], seg), { color: b.paint(pal.hull, 0.03) });
  const head: V3 = [bay.w + 30, bay.h + 26, bay.depth + 14];
  hangarBlock(b, body, frameAt([0, 0, zFront + head[2]]), head, pal.hull, bayStyle(b, { guide: col('#8dff6a') }), bay);
  greenDome(b, body, frameAt([0, head[1] / 2 - 1, zFront + head[2] * 0.45], [0, 1, 0], [0, 0, 1]), Math.min(head[0], head[2]) * 0.32, glow);

  // Drum of spun greenhouse rings.
  const rings = b.part('greenhouses', b.root, true, 20);
  const n = b.size > 0.66 ? 4 : b.size > 0.33 ? 3 : 2;
  const Rr = R * r.range(0.56, 0.62);
  const hw = Math.max(9, R * 0.05);
  const span = R * 0.5;
  const hd = Math.min(R * 0.07, (span / n) * 0.36);
  const rr = b.rng('rings');
  const zs: number[] = [];
  for (let i = 0; i < n; i++) {
    const z = zFront - R * 0.14 - (span * (i + 0.5)) / n;
    zs.push(z);
    ring(b, rings, Rr, hw, hd, z, { outer: pal.hull, inner: pal.panel, sides: pal.hull, windows: 1, trim: pal.trim, ribs: Math.round(10 + b.detail * 8), panes: glow }, rr);
    spokes(b, rings, 4, hubR * 1.3, Rr - hw, z, Math.max(2.4, R * 0.011), i * 0.4, i === 0);
    k.add('hull', latheZ([[hubR, z - hd * 1.4], [hubR * 1.3, z - hd], [hubR * 1.3, z + hd], [hubR, z + hd * 1.4]], seg), { color: b.paint(pal.hullAlt, 0.03) });
  }
  // Longerons tying the rings into a drum.
  const bars = 6;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2 + 0.26;
    rod(rings.kit, 'metal', [Math.cos(a) * Rr, Math.sin(a) * Rr, zs[0]!], [Math.cos(a) * Rr, Math.sin(a) * Rr, zs[zs.length - 1]!], Math.max(1.2, R * 0.006), pal.metal, 5);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const z = zs[i % zs.length]!;
    lamp(b, rings, [Math.cos(a) * (Rr + hw + 6), Math.sin(a) * (Rr + hw + 6), z], R * 0.12, 0.22, '#9dff8a');
    beacon(b, rings, [Math.cos(a + 0.4) * (Rr + hw + 1), Math.sin(a + 0.4) * (Rr + hw + 1), z + hd + 1], pal.beacon, 4.5, 0.6, i / 8);
  }
  const spin = (b.ctx.reducedMotion ? 0.6 : 1) * 0.05 * (160 / Math.max(120, Rr));
  b.ticks.push((t) => {
    rings.group.rotation.z = t * spin;
  });

  // Big greenhouse dome on the tail and a flower of sun mirrors behind the drum.
  const tailR = hubR * 1.9;
  // Profile runs towards +Z so the faces point outwards.
  k.add('hull', latheZ([[hubR * 0.8, zBack - 10], [tailR, zBack - 8], [tailR, zBack - 2], [hubR, zBack + 4]], seg), { color: b.paint(pal.hullAlt, 0.03) });
  greenDome(b, body, frameAt([0, 0, zBack - 10], [0, 0, -1]), tailR * 0.95, glow);
  const petals = r.int(6, 8);
  const pl = R * r.range(0.3, 0.36);
  const pw = R * 0.14;
  const tilt = r.range(0.5, 0.75);
  const mirror = col('#e4ebf2');
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + Math.PI / petals;
    const dir: V3 = [Math.cos(a), Math.sin(a), 0];
    const root: V3 = [dir[0] * tailR, dir[1] * tailR, zBack - 4];
    // Petal frame: +X out along the petal, tilted back so the mirrors face the rings.
    const f = new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeRotationY(-tilt)).setPosition(...root);
    boxIn(k, f, 'metal', [pl, 1.6, 2.4], [pl / 2, 0, 0], pal.metal);
    boxIn(k, f, 'metal', [pl * 0.92, 0.8, pw], [pl * 0.54, 1.3, 0], mirror);
    boxIn(k, f, 'metal', [pl * 0.94, 1.2, 1.2], [pl * 0.54, 1.3, pw / 2], pal.metalDark);
    boxIn(k, f, 'metal', [pl * 0.94, 1.2, 1.2], [pl * 0.54, 1.3, -pw / 2], pal.metalDark);
    beacon(b, body, tp(f, [pl + 1, 1.5, 0]), '#ffffff', 4, 0.5, i / petals);
  }

  // Water and nutrient tanks round the hub between the dock head and the drum.
  const tanks = r.int(3, 5);
  for (let i = 0; i < tanks; i++) {
    const a = (i / tanks) * Math.PI * 2 + 0.3;
    const tr = R * 0.04;
    const z = zFront - R * 0.07;
    sphereTank(b, body, [Math.cos(a) * (hubR + tr + 2), Math.sin(a) * (hubR + tr + 2), z], tr, r.pick(pal.tanks));
  }
  beacon(b, body, [0, 0, zBack - 10 - tailR], pal.beacon, 6, 0.5, 0, true);
}

/* ------------------------------------------------------------------------------------------------
 * Research station.
 * ---------------------------------------------------------------------------------------------- */

/** Observatory dome: dark glass hemisphere with a slit, on +Z of `frame`. */
function glassDome(b: StationGen, p: GenPart, frame: THREE.Matrix4, radius: number): void {
  const seg = b.seg + 2;
  addIn(p.kit, frame, 'glass', new THREE.SphereGeometry(radius, seg, Math.max(4, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2), { rotation: [Math.PI / 2, 0, 0] });
  addIn(p.kit, frame, 'metal', new THREE.TorusGeometry(radius + 0.3, Math.max(0.5, radius * 0.06), 4, seg), { color: b.pal.band });
  addIn(p.kit, frame, 'emissive', new THREE.BoxGeometry(Math.max(0.5, radius * 0.08), radius * 1.6, 0.6), { position: [0, 0, radius * 0.98], color: col('#9fd8ff').multiplyScalar(1.1) });
}

export function researchStation(b: StationGen): void {
  const R = b.R;
  const pal = b.pal;
  const r = b.rng('layout');
  const rd = b.rng('detail');
  const body = b.body;
  const k = body.kit;
  const bay = baySize(R);
  const seg = b.seg + (b.quality === 'low' ? 0 : 4);

  // Core sphere with window belts and an observatory dome.
  const cR = Math.max(20, R * 0.17);
  k.add('hull', new THREE.SphereGeometry(cR, seg, Math.max(8, seg >> 1)), { color: b.paint(pal.hull) });
  for (const z of [-cR * 0.3, cR * 0.3]) {
    const rr = Math.sqrt(cR * cR - z * z) + 0.3;
    k.add('windows', windowBand(rr, z, 1, b.win, seg, false, 0, Math.PI * 2, rd.next(), rd.int(0, 7)), { rotation: [Math.PI / 2, 0, 0], uv: 0 });
  }
  k.add('metal', band(cR + 0.6, -1.5, 1.5, seg, false, 8), { rotation: [Math.PI / 2, 0, 0], uv: 0, color: pal.trim });
  glassDome(b, body, frameAt([0, cR * 0.86, 0], [0, 1, 0], [0, 0, 1]), cR * 0.45);

  // Side labs on tubes, each under its own dome.
  const labR = cR * 0.64;
  const labX = cR + R * 0.17;
  for (const s of [-1, 1]) {
    const x = s * labX;
    rod(k, 'hull', [s * cR * 0.8, 0, 0], [x - s * labR * 0.8, 0, 0], labR * 0.36, pal.hullAlt, b.seg);
    k.add('hull', new THREE.SphereGeometry(labR, seg, Math.max(6, seg >> 1)), { position: [x, 0, 0], color: b.paint(pal.hullAlt) });
    k.add('windows', windowBand(labR + 0.3, 0, 1, b.win, seg, false, 0, Math.PI * 2, rd.next(), rd.int(0, 7)), { rotation: [Math.PI / 2, 0, 0], position: [x, 0, 0], uv: 0 });
    glassDome(b, body, frameAt([x, labR * 0.8, 0], [0, 1, 0], [0, 0, 1]), labR * 0.5);
    // Solar wing off each lab.
    solarWing(b, body, new THREE.Matrix4().makeRotationY(s > 0 ? 0 : Math.PI).setPosition(x + s * labR * 0.9, 0, 0), R * 0.3, R * 0.1, 2);
  }

  // Dock module along +Z with the bay out of its nose.
  const modR = Math.max(12, R * 0.08);
  const modL = R * 0.22;
  cylModule(b, body, frameAt([0, 0, cR * 0.7]), modR, modL, pal.hull, rd, { windows: 1, trim: pal.trim, capEnd: false });
  const t = Math.max(2, bay.w * 0.09);
  const collar: V3 = [bay.w + 2 * t + 6, bay.h + 2 * t + 6, 8];
  const zc = cR * 0.7 + modL + 3;
  boxIn(k, frameAt([0, 0, zc]), 'hull', collar, [0, 0, 0], b.paint(pal.hull));
  dockBay(b, body, frameAt([0, 0, zc + 4 + bay.depth / 2]), bay.w, bay.h, bay.depth, bayStyle(b, { outline: col('#9fe0ff').multiplyScalar(1.6) }));

  // Telescope array under the core, all looking the same way.
  const scopes = r.int(3, 5);
  const tl = R * 0.26;
  const tRad = Math.max(3.5, R * 0.03);
  const look = norm([r.range(-0.3, 0.3), -0.55, -1]);
  const base: V3 = [0, -cR - tRad * 2 - 4, -cR * 0.2];
  boxIn(k, frameAt(base, look), 'metal', [tRad * (scopes * 2.6 + 1), tRad * 2, tRad * 3], [0, 0, 0], pal.metalDark);
  rod(k, 'metal', [0, -cR * 0.8, 0], base, tRad * 0.6, pal.metal, 6);
  for (let i = 0; i < scopes; i++) {
    const f = subFrame(frameAt(base, look), [(i - (scopes - 1) / 2) * tRad * 2.6, 0, 0]);
    addIn(k, f, 'hull', latheZ([[tRad * 0.8, -tl * 0.2], [tRad, -tl * 0.15], [tRad, tl * 0.7], [tRad * 1.15, tl * 0.75], [tRad * 1.15, tl * 0.8]], b.segSmall + 4), { color: b.paint(i % 2 ? pal.hull : pal.panel) });
    addIn(k, f, 'dark', new THREE.CircleGeometry(tRad * 1.05, b.segSmall + 4), { position: [0, 0, tl * 0.78] });
    addIn(k, f, 'glass', new THREE.CircleGeometry(tRad * 0.8, b.segSmall + 4), { position: [0, 0, tl * 0.79] });
  }

  // Long sensor booms with instrument pods.
  const booms = r.int(3, 5);
  const bl = R * r.range(0.5, 0.62);
  for (let i = 0; i < booms; i++) {
    // Spread over the back and sides, never forward along the dock axis.
    const a = (i / booms) * Math.PI * 2 + r.range(-0.3, 0.3);
    const d = norm([Math.cos(a), Math.sin(a) * 0.8, -0.35 - r.next() * 0.5]);
    const start: V3 = [d[0] * cR, d[1] * cR, d[2] * cR];
    const end: V3 = [d[0] * (cR + bl), d[1] * (cR + bl), d[2] * (cR + bl)];
    if (!b.clearOfCorridor(end, 12)) continue;
    truss(b, body, start, end, Math.max(2.4, R * 0.014));
    const pf = frameAt(end, d);
    boxIn(k, pf, 'hull', [6, 6, 9], [0, 0, 2], b.paint(pal.hullAlt));
    if (rd.next() < 0.6) dish(b, k, subFrame(pf, [0, 4, 4], [-0.8, 0, 0]), 6, 1.8, pal.hull);
    else rod(k, 'metal', tp(pf, [0, 0, 6]), tp(pf, [0, 0, 26]), 0.4, pal.metal, 4);
    beacon(b, body, tp(pf, [0, 3.5, 6.5]), i % 2 ? '#ffffff' : pal.beacon, 4, 0.8, i / booms);
  }

  // The big dish on a turning mount above and behind the core.
  const mountTop: V3 = [0, cR + R * 0.12, -cR - R * 0.1];
  truss(b, body, [0, cR * 0.5, -cR * 0.6], mountTop, Math.max(5, R * 0.03));
  const dishPart = b.part('main-dish', body.group, true, 10);
  dishPart.group.position.set(...mountTop);
  const dk = dishPart.kit;
  const dR = R * r.range(0.24, 0.3);
  dk.add('hull', new THREE.CylinderGeometry(6, 8, 6, b.seg), { position: [0, 3, 0], color: pal.hullAlt });
  rod(dk, 'metal', [0, 6, 0], [0, dR * 0.55, -dR * 0.2], 2, pal.metal, 6);
  const dishAxis = norm([0, 0.8, -0.6]);
  dish(b, dk, frameAt([0, dR * 0.55, -dR * 0.2], dishAxis), dR, dR * 0.3, pal.hull);
  // Beacon on the feed horn.
  beacon(b, dishPart, [dishAxis[0] * dR * 0.9, dR * 0.55 + dishAxis[1] * dR * 0.9, -dR * 0.2 + dishAxis[2] * dR * 0.9], pal.beacon, 5, 0.5, 0.2);
  const turn = b.ctx.reducedMotion ? 0.05 : 0.09;
  b.ticks.push((time) => {
    dishPart.group.rotation.y = Math.sin(time * turn) * 1.1;
  });
  for (const s of [-1, 1]) lamp(b, body, [s * labX, -labR - 4, 8], R * 0.08, 0.5, '#bfe4ff');
  beacon(b, body, [0, cR * 1.35, 0], pal.beacon, 6, 0.5, 0, true);
}

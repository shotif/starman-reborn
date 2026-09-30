import * as THREE from 'three';
import { beam, rod } from '../kit.ts';
import type { V3 } from '../kit.ts';
import { Body, Hull, TRIM_STRIPS } from './body.ts';
import type { HullShape, Slice, Station } from './body.ts';
import type { ShipBuilder } from './builder.ts';
import {
  antenna,
  canopy,
  capsule,
  chineStrips,
  container,
  cutTrap,
  dish,
  engine,
  engineLookOf,
  fin,
  finPlanform,
  flankPlates,
  fuselage,
  greebles,
  gun,
  hullPainter,
  launcherBay,
  leadAt,
  ringBand,
  shapeOf,
  turret,
  wingPanel,
  wingPoint,
} from './parts.ts';
import type { CanopyLook, EngineLook, PaintOptions, Trapezoid } from './parts.ts';

/**
 * Class layouts. The class decides proportions, where the cockpit, wings, engines and guns go and
 * which modules it carries (cargo, turrets, launcher bays, sensors); the maker's style decides how
 * each of those parts looks; the tier adds refinement on top of the same silhouette.
 */

const mirror = (p: V3): V3 => [-p[0], p[1], p[2]];
const deg = THREE.MathUtils.degToRad;

export function buildClass(b: ShipBuilder): void {
  switch (b.spec.shipClass) {
    case 'courier':
      courier(b);
      break;
    case 'light-fighter':
      lightFighter(b);
      break;
    case 'heavy-fighter':
      heavyFighter(b);
      break;
    case 'gunship':
      gunship(b);
      break;
    case 'freighter':
      freighter(b);
      break;
    case 'surveyor':
      surveyor(b);
      break;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Shared layout helpers.
 * ---------------------------------------------------------------------------------------------- */

function canopyLookOf(b: ShipBuilder): CanopyLook {
  const s = b.style.silhouette;
  return s === 'block' ? 'faceted' : s === 'blade' ? 'slit' : 'bubble';
}

/**
 * Fuselage paint: the maker's trim bands, a flank stripe (civilian makers from Mk I, sleek ones from
 * Mk II) and a spine stripe at Mk III. Plated and salvage hulls keep their trim to thin bands and
 * slashes.
 */
function paintFor(b: ShipBuilder): PaintOptions {
  const fam = b.style.silhouette;
  const plated = fam === 'block' || fam === 'splice';
  return {
    stripe: fam === 'wedge' || fam === 'pod' || (b.tier >= 2 && !plated) ? [0.2, 0.86] : undefined,
    topStripe: b.tier >= 3 && !plated ? [0.34, 0.92] : undefined,
    rings: fam === 'splice' ? undefined : TRIM_STRIPS[shapeOf(b)],
  };
}

interface WingSpec {
  /** Half-span in units of R. */
  span: number;
  /** Root leading edge and root chord as fractions of the hull length. */
  t0: number;
  chord: number;
  /** Wing plane height and thickness in units of R. */
  y: number;
  thickness: number;
  /** Fighters carry outer panels beyond twin booms. */
  outer?: boolean;
}

interface Booms {
  x: number;
  y: number;
  zf: number;
  zb: number;
  r: number;
}

interface WingInfo {
  /** Nav light positions (right, left). */
  tips: [V3, V3];
  /** Gun breech points on the wings (right, left). */
  mounts: [V3, V3];
  booms: Booms | null;
}

const BOOM: Station[] = [
  { t: 0, w: 0.3, top: 0.3, bot: 0.3 },
  { t: 0.06, w: 0.8, top: 0.8, bot: 0.8 },
  { t: 0.15, w: 1, top: 1, bot: 1 },
  { t: 0.86, w: 1, top: 1, bot: 1 },
  { t: 1, w: 0.78, top: 0.78, bot: 0.78 },
];

/** Wing arrangement from the maker's style, sized by the class. */
function wings(b: ShipBuilder, hull: Hull, spec: WingSpec): WingInfo {
  const p = b.pal;
  const R = b.R;
  const L = hull.length;
  const v = b.rng('wings');
  const span = spec.span * R * v.range(0.96, 1.04);
  const y = spec.y * R;
  const th = spec.thickness * R;
  const drop = th * 0.5 + R * 0.022;
  const zl0 = hull.z(spec.t0);
  const c0 = spec.chord * L;
  const x0 = hull.slice(spec.t0 + spec.chord * 0.4).w * 0.8;

  switch (b.style.wings) {
    case 'swept': {
      const lead1 = zl0 + (span - x0) * Math.tan(deg(v.range(36, 42)));
      const c1 = c0 * 0.36;
      const tr: Trapezoid = { x0, lead0: zl0, trail0: zl0 + c0, x1: span, lead1, trail1: lead1 + c1 };
      const dh = -0.05;
      const [inner, band] = cutTrap(tr, span - (span - x0) * 0.17);
      for (const side of [1, -1]) {
        wingPanel(b, inner, side, y, th, p.hull, dh);
        wingPanel(b, band, side, y, th, p.accent, dh);
        if (b.tier >= 2) {
          const tip = wingPoint(span, y, 0, side, dh);
          fin(b, finPlanform(lead1 + c1 * 0.1, c1 * 0.9, R * 0.09, 0.55, 0.45), tip[0], tip[1], th * 0.8, p.hullLight);
        }
      }
      const gx = x0 + (span - x0) * 0.38;
      const mount = wingPoint(gx, y - drop, leadAt(tr, gx) + c0 * 0.1, 1, dh);
      const tip = wingPoint(span, y, (lead1 + tr.trail1) / 2, 1, dh);
      return { tips: [tip, mirror(tip)], mounts: [mount, mirror(mount)], booms: null };
    }
    case 'delta': {
      const lead0 = hull.z(spec.t0 - 0.05);
      const trail0 = hull.z(Math.min(0.985, spec.t0 + spec.chord * 1.3));
      const cr = trail0 - lead0;
      const xr = hull.slice(Math.min(0.95, spec.t0 + spec.chord * 0.6)).w * 0.75;
      const trail1 = trail0 - cr * 0.06;
      const tr: Trapezoid = { x0: xr, lead0, trail0, x1: span, lead1: trail1 - cr * 0.13, trail1 };
      const [inner, rest] = cutTrap(tr, xr + (span - xr) * 0.4);
      const [inlay, tipPanel] = cutTrap(rest, xr + (span - xr) * 0.68);
      for (const side of [1, -1]) {
        wingPanel(b, inner, side, y, th, p.hull, 0);
        wingPanel(b, inlay, side, y, th, p.panel, 0);
        wingPanel(b, tipPanel, side, y, th, p.hull, 0);
        // Light strip just behind the leading edge.
        const xa = xr + (span - xr) * 0.08;
        const xb = xr + (span - xr) * 0.86;
        beam(
          b.kit,
          'emissive',
          [side * xa, y + th * 0.5, leadAt(tr, xa) + R * 0.03],
          [side * xb, y + th * 0.5, leadAt(tr, xb) + R * 0.03],
          R * 0.008,
          p.strip,
        );
      }
      const gx = xr + (span - xr) * 0.3;
      const mount: V3 = [gx, y - drop, leadAt(tr, gx) + R * 0.05];
      const tip: V3 = [span, y, (tr.lead1 + trail1) / 2];
      return { tips: [tip, mirror(tip)], mounts: [mount, mirror(mount)], booms: null };
    }
    case 'straight': {
      const c = c0 * 0.78;
      const lead0 = hull.z(spec.t0 + 0.04);
      const xs = hull.slice(spec.t0 + 0.12).w * 0.85;
      const x1 = span * 0.86;
      const lead1 = lead0 + (x1 - xs) * 0.1;
      const tr: Trapezoid = { x0: xs, lead0, trail0: lead0 + c, x1, lead1, trail1: lead1 + c * 0.84 };
      const th2 = th * 1.45;
      const [inner, outer] = cutTrap(tr, xs + (x1 - xs) * 0.58);
      const [band, outer2] = cutTrap(outer, xs + (x1 - xs) * 0.68);
      const plateH = th2 * 3.6;
      const plateZ = (lead1 + tr.trail1) / 2;
      const plateL = (tr.trail1 - lead1) * 1.12;
      for (const side of [1, -1]) {
        wingPanel(b, inner, side, y, th2, p.hull, 0);
        wingPanel(b, band, side, y, th2, p.accent, 0);
        wingPanel(b, outer2, side, y, th2, p.panelDark, 0);
        // End plates, the top third in hazard orange.
        b.box('hull', [th2 * 0.9, plateH, plateL], [side * (x1 + th2 * 0.42), y, plateZ], p.hullDark);
        b.box('hull', [th2 * 0.94, plateH * 0.3, plateL * 0.9], [side * (x1 + th2 * 0.42), y + plateH * 0.38, plateZ - plateL * 0.03], p.accent);
      }
      const gx = xs + (x1 - xs) * 0.46;
      const mount: V3 = [gx, y - th2 * 0.5 - R * 0.022, leadAt(tr, gx) + R * 0.04];
      const tip: V3 = [x1 + th2 * 0.45, y + plateH * 0.5, plateZ];
      return { tips: [tip, mirror(tip)], mounts: [mount, mirror(mount)], booms: null };
    }
    case 'twin-boom': {
      const c = c0 * 0.72;
      const br = R * 0.068;
      const bx = Math.max(x0 + br * 3, span * (spec.outer ? 0.56 : 0.8));
      const stub: Trapezoid = { x0, lead0: zl0, trail0: zl0 + c, x1: bx, lead1: zl0 + (bx - x0) * 0.1, trail1: zl0 + c };
      const zf = zl0 - c * 0.45;
      const zb = hull.z(1.05);
      const finH = R * 0.17;
      const finZ = zb - L * 0.15;
      for (const side of [1, -1]) {
        wingPanel(b, stub, side, y, th, p.hull, 0);
        const boom = new Body({ shape: 'pod', stations: BOOM, z0: zf, length: zb - zf, width: br, top: br, bottom: br, x: side * bx, y });
        b.add('hull', boom.geometry(hullPainter(b, { rings: [1], salt: 20 + side })));
        fin(b, finPlanform(finZ, L * 0.13, finH, 0.5, 0.45), side * bx, y + br * 0.7, th * 0.9, p.hull);
        if (b.tier >= 2) fin(b, finPlanform(finZ + L * 0.065, L * 0.065, finH * 0.3, 0.4, 0.6), side * bx, y + br * 0.7 + finH * 0.7, th, p.accent);
        if (spec.outer) {
          const ol = leadAt(stub, bx) + c * 0.08;
          const outer: Trapezoid = { x0: bx, lead0: ol, trail0: ol + c * 0.72, x1: span, lead1: ol + (span - bx) * 0.36, trail1: ol + (span - bx) * 0.36 + c * 0.34 };
          wingPanel(b, outer, side, y, th * 0.9, p.panel, 0);
        }
      }
      // Tailplane across the fin tops.
      const tz = finZ + L * 0.13 * 0.55;
      const tail: Trapezoid = { x0: -bx, lead0: tz, trail0: tz + L * 0.06, x1: bx, lead1: tz, trail1: tz + L * 0.06 };
      wingPanel(b, tail, 1, y + br * 0.7 + finH * 0.9, th * 0.8, p.hull, 0);
      const mount: V3 = [bx, y - br * 0.35, zf + br * 1.4];
      const tip: V3 = spec.outer ? [span, y, zl0 + c * 0.9] : [bx, y + br * 0.7 + finH, finZ + L * 0.1];
      return { tips: [tip, mirror(tip)], mounts: [mount, mirror(mount)], booms: { x: bx, y, zf, zb, r: br } };
    }
    case 'asymmetric': {
      // Right: a long swept wing with a drooping talon. Left: a short stub, a tall fin and a pod.
      const rs = span * 1.04;
      const rl1 = zl0 + (rs - x0) * Math.tan(deg(v.range(28, 34)));
      const right: Trapezoid = { x0, lead0: zl0, trail0: zl0 + c0, x1: rs, lead1: rl1, trail1: rl1 + c0 * 0.3 };
      const [r1, rest] = cutTrap(right, x0 + (rs - x0) * 0.5);
      const [slash, r2] = cutTrap(rest, x0 + (rs - x0) * 0.58);
      wingPanel(b, r1, 1, y, th, p.salvage[2]!, -0.04);
      wingPanel(b, slash, 1, y, th, p.accent, -0.04);
      wingPanel(b, r2, 1, y, th, p.panel, -0.04);
      const rt = wingPoint(rs, y, 0, 1, -0.04);
      fin(b, finPlanform(rl1 - c0 * 0.02, c0 * 0.34, R * 0.13, 0.35, 0.55), rt[0], rt[1], th, p.panel, 0.35, true);
      const ls = span * 0.6;
      const left: Trapezoid = { x0, lead0: zl0 + c0 * 0.12, trail0: zl0 + c0 * 0.86, x1: ls, lead1: zl0 + c0 * 0.2, trail1: zl0 + c0 * 0.76 };
      wingPanel(b, left, -1, y, th * 1.2, p.panelDark, 0);
      const finH = R * 0.2;
      fin(b, finPlanform(zl0 + c0 * 0.22, c0 * 0.56, finH, 0.62, 0.4), -ls, y, th, p.hull, -0.18);
      const podR = R * 0.045;
      const podL = c0 * 0.95;
      const podX = -ls * 0.66;
      const podY = y - th * 0.6 - podR * 1.1;
      const podZ = zl0 + c0 * 0.3;
      capsule(b, 'hull', [podX, podY, podZ], podR, podL, p.salvage[3]!);
      b.box('metal', [R * 0.02, podR * 1.4, podL * 0.4], [podX, y - th * 0.6 - podR * 0.2, podZ], p.trim);
      const gx = x0 + (rs - x0) * 0.34;
      const rMount = wingPoint(gx, y - drop, leadAt(right, gx) + c0 * 0.08, 1, -0.04);
      return {
        tips: [wingPoint(rs, y, (rl1 + right.trail1) / 2, 1, -0.04), [-ls, y + finH * 0.95, zl0 + c0 * 0.6]],
        mounts: [rMount, [podX, podY, podZ - podL * 0.5 + podR]],
        booms: null,
      };
    }
    default: {
      // No wings: gun sponsons low on the flanks.
      const s = hull.slice(0.34);
      const sx = s.x + s.w * 0.92 + R * 0.03;
      const sy = s.y - s.bot * 0.25;
      for (const side of [1, -1]) {
        b.box('hull', [R * 0.075, R * 0.07, L * 0.15], [s.x + side * (sx - s.x), sy, hull.z(0.4)], p.panel);
      }
      const w = hull.slice(0.62);
      const tip: V3 = [w.x + w.w, w.y, hull.z(0.62)];
      return { tips: [tip, [w.x - w.w, w.y, hull.z(0.62)]], mounts: [[sx, sy, hull.z(0.34)], [2 * s.x - sx, sy, hull.z(0.34)]], booms: null };
    }
  }
}

/** Guns under the hull sides at t. */
function rootPair(b: ShipBuilder, hull: Hull, t: number): V3[] {
  const s = hull.slice(t);
  const y = hull.botY(t, 0.9) - b.R * 0.014;
  return [
    [s.x + s.w * 0.9, y, hull.z(t)],
    [s.x - s.w * 0.9, y, hull.z(t)],
  ];
}

/** A single gun under the nose at t. */
function chin(b: ShipBuilder, hull: Hull, t: number): V3[] {
  const s = hull.slice(t);
  return [[s.x, hull.botY(t) - b.R * 0.018, hull.z(t)]];
}

/**
 * Places exactly `n` guns: mounts are taken in priority order (a pair is skipped for a later single
 * when only one gun is left); more guns than mounts double up beside the first ones.
 */
function mountGuns(b: ShipBuilder, mounts: V3[][], n: number, len: number, r: number): void {
  const chosen: V3[] = [];
  let left = n;
  mounts.forEach((m, i) => {
    if (left <= 0) return;
    if (m.length <= left) {
      chosen.push(...m);
      left -= m.length;
    } else if (!mounts.slice(i + 1).some((o) => o.length <= left)) {
      chosen.push(...m.slice(0, left));
      left = 0;
    }
  });
  for (let k = 0; left > 0 && chosen.length > 0; k++, left--) {
    const base = chosen[k % chosen.length]!;
    const out = base[0] >= 0 ? 1 : -1;
    chosen.push([base[0] + out * r * 3.6, base[1] - r * 1.2, base[2] + r * 2]);
  }
  for (const p of chosen) gun(b, p[0], p[1], p[2], len, r);
}

/** Engine positions in the tail cross-section. */
function tailLayout(count: number, s: Slice, r: number): [number, number][] {
  const ex = Math.max(r * 1.18, s.w * 0.52);
  const ey = Math.max(r * 1.12, (s.top + s.bot) * 0.26);
  switch (count) {
    case 1:
      return [[s.x, s.y]];
    case 2:
      return [
        [s.x + ex, s.y],
        [s.x - ex, s.y],
      ];
    case 3:
      return [
        [s.x, s.y + ey * 0.7],
        [s.x + ex, s.y - ey * 0.45],
        [s.x - ex, s.y - ey * 0.45],
      ];
    default:
      return [
        [s.x + ex, s.y + ey * 0.55],
        [s.x - ex, s.y + ey * 0.55],
        [s.x + ex, s.y - ey * 0.55],
        [s.x - ex, s.y - ey * 0.55],
      ];
  }
}

/** Engines clustered in the tail. */
function tailEngines(b: ShipBuilder, hull: Hull, count: number, r: number, look: EngineLook): void {
  const s = hull.slice(0.97);
  const zf = hull.z(0.84);
  const zb = hull.z(1) + r * 0.4;
  for (const [x, y] of tailLayout(count, s, r)) engine(b, look, x, y, zf, zb, r);
}

/** A nacelle on a short pylon beside each side of the rear hull. */
function nacelles(b: ShipBuilder, hull: Hull, r: number, look: EngineLook, t0 = 0.5, t1 = 0.99): void {
  const s = hull.slice(0.74);
  const x = s.w + r * 0.72;
  const y = s.y + s.top * 0.08;
  const zf = hull.z(t0);
  const zb = hull.z(t1);
  for (const side of [1, -1]) {
    engine(b, look, s.x + side * x, y, zf, zb, r);
    b.box('hull', [r * 1.2, r * 0.5, (zb - zf) * 0.4], [s.x + side * (x - r * 0.7), y, zf + (zb - zf) * 0.45], b.pal.hullDark);
  }
}

/** Spine-and-ring: a band around the hull at t carrying engine pods. */
function engineRing(b: ShipBuilder, hull: Hull, t: number, count: number, r: number): number {
  const s = hull.slice(t);
  const z = hull.z(t);
  const ringR = Math.max(s.w, s.top, s.bot) + r * 2.3;
  const p = b.pal;
  ringBand(b, 'hull', s.x, s.y, z, ringR + r * 0.34, ringR - r * 0.34, r * 1.7, p.panel);
  ringBand(b, 'hull', s.x, s.y, z - r * 0.95, ringR + r * 0.38, ringR - r * 0.3, r * 0.22, p.accent);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const c = Math.cos(a);
    const d = Math.sin(a);
    beam(b.kit, 'metal', [s.x + c * s.w * 0.6, s.y + d * s.top * 0.6, z], [s.x + c * (ringR - r * 0.3), s.y + d * (ringR - r * 0.3), z], r * 0.4, p.metalDark);
  }
  const angles = count === 3 ? [90, 210, 330] : count >= 4 ? [45, 135, 225, 315] : [0, 180];
  const len = r * 5.2;
  for (const a of angles) {
    const x = s.x + Math.cos(deg(a)) * ringR;
    const y = s.y + Math.sin(deg(a)) * ringR;
    engine(b, 'round', x, y, z - len * 0.5, z + len * 0.5, r);
  }
  return ringR + r;
}

/** Nav lights: starboard green, port red, a tail strobe; raiders run red-only. */
function navLights(b: ShipBuilder, tips: [V3, V3], tailTop: V3, tail: V3, nose: V3): void {
  const raider = b.style.silhouette === 'splice';
  b.light(tips[0], raider ? '#ff3a1a' : '#22ff5a', 0.11, { intensity: 1.6 });
  b.light(tips[1], raider ? '#ff3a1a' : '#ff2a20', 0.11, { intensity: 1.6 });
  b.light(tailTop, raider ? '#ff3a1a' : '#ffffff', 0.14, { blink: 1, duty: 0.08, intensity: 2.2 });
  b.light(tail, '#ffffff', 0.07, { intensity: 1 });
  for (const s of [1, -1]) b.light([nose[0] + s * b.R * 0.04, nose[1], nose[2]], raider ? '#ff4a2a' : '#dff1ff', 0.06, { intensity: 0.8 });
  if (b.tier >= 3) {
    for (const [i, t] of tips.entries()) b.light(t, '#ffffff', 0.06, { blink: 0.5, duty: 0.1, phase: i * 0.5, intensity: 1.2, min: 0 });
  }
}

/** Fins on the rear hull in the maker's style; returns the top of the tallest one. */
function tailFins(b: ShipBuilder, hull: Hull, height: number, twin = false): V3 {
  const p = b.pal;
  const R = b.R;
  const L = hull.length;
  const s = hull.slice(0.9);
  const top = hull.topY(0.9);
  const h = height * R;
  const th = R * 0.022;
  const chord = L * 0.24;
  const z = hull.z(0.72);
  switch (b.style.silhouette) {
    case 'blade': {
      const x = s.w * 0.55;
      for (const side of [1, -1]) {
        fin(b, finPlanform(z + chord * 0.1, chord * 0.9, h * 0.8, 0.7, 0.35), s.x + side * x, hull.topY(0.9, 0.55), th, p.hull, side * deg(24));
        fin(b, finPlanform(z + chord * 0.62, chord * 0.28, h * 0.12, 0.3, 0.7), s.x + side * (x + h * 0.8 * Math.sin(deg(24))), hull.topY(0.9, 0.55) + h * 0.8 * Math.cos(deg(24)) - R * 0.01, th * 1.1, p.panel, side * deg(24));
      }
      return [s.x, top + h * 0.75, z + chord * 0.8];
    }
    case 'block': {
      const x = s.w * 0.62;
      for (const side of [1, -1]) {
        const pf: [number, number][] = [
          [0, z + chord * 0.15],
          [0, z + chord],
          [h * 0.9, z + chord * 0.98],
          [h * 0.9, z + chord * 0.42],
        ];
        fin(b, pf, s.x + side * x, hull.topY(0.86, 0.62), th * 1.4, p.hull);
        b.box('hull', [th * 1.5, h * 0.22, chord * 0.5], [s.x + side * x, hull.topY(0.86, 0.62) + h * 0.8, z + chord * 0.72], p.accent);
      }
      return [s.x + x, top + h * 0.9, z + chord * 0.7];
    }
    case 'splice': {
      const x = -s.w * 0.3;
      fin(b, finPlanform(z, chord, h, 0.6, 0.4), s.x + x, hull.topY(0.86, 0.3), th, p.salvage[4]!, deg(-6));
      fin(b, finPlanform(z + chord * 0.3, chord * 0.6, h * 0.55, 0.4, 0.5), s.x + s.w * 0.4, hull.botY(0.86, 0.4), th, p.accent, deg(20), true);
      return [s.x + x, top + h, z + chord * 0.9];
    }
    case 'ring':
      fin(b, finPlanform(z + chord * 0.3, chord * 0.7, h * 0.55, 0.5, 0.45), s.x, top - R * 0.005, th, p.panel);
      return [s.x, top + h * 0.55, z + chord * 0.8];
    default: {
      if (twin) {
        const x = s.w * 0.45;
        for (const side of [1, -1]) {
          fin(b, finPlanform(z + chord * 0.08, chord * 0.92, h * 0.85, 0.62, 0.38), s.x + side * x, hull.topY(0.9, 0.45), th, p.hull, side * deg(16));
        }
        return [s.x, top + h * 0.8, z + chord * 0.8];
      }
      fin(b, finPlanform(z, chord, h, 0.62, 0.38), s.x, top - R * 0.005, th, p.hullLight);
      fin(b, finPlanform(z + chord * 0.62, chord * 0.38, h * 0.28, 0.5, 0.5), s.x, top + h * 0.72, th * 1.1, p.accent);
      return [s.x, top + h, z + chord * 0.95];
    }
  }
}

/**
 * Refinements every class shares: keel fins from Mk II; antennae at Mk III, plus light strips on
 * sleek hulls or rows of running lights on the rest.
 */
function refinements(b: ShipBuilder, hull: Hull): void {
  const R = b.R;
  const fam = b.style.silhouette;
  if (b.tier >= 2 && b.style.wings !== 'twin-boom') {
    const s = hull.slice(0.88);
    const bot = hull.botY(0.88, 0.5);
    const z = hull.z(0.74);
    const chord = hull.length * 0.2;
    for (const side of [1, -1]) {
      fin(b, finPlanform(z, chord, R * 0.07, 0.55, 0.4), s.x + side * s.w * 0.5, bot + R * 0.004, R * 0.018, b.pal.hullDark, side * deg(22), true);
    }
  }
  if (fam === 'splice') {
    // Red slits cut into the flanks, a different pattern on each side.
    const r = b.rng('slits');
    for (let i = 0; i < 2 + b.tier; i++) {
      const side = i % 2 ? 1 : -1;
      const t = r.range(0.3, 0.8);
      const s = hull.slice(t);
      b.glowBox([R * 0.006, R * 0.012, R * r.range(0.1, 0.2)], [s.x + side * (s.w + R * 0.002), s.y + s.top * r.range(-0.1, 0.3), hull.z(t)], b.pal.strip, [
        r.range(-0.5, 0.5),
        0,
        0,
      ]);
    }
  }
  if (b.tier >= 3) {
    const r = b.rng('antennae');
    for (const side of [1, -1]) {
      const t = 0.62 + r.range(0, 0.1);
      const s = hull.slice(t);
      const base: V3 = [s.x + side * s.w * 0.28, hull.topY(t, 0.28), hull.z(t)];
      const tip: V3 = [base[0] + side * R * 0.02, base[1] + R * r.range(0.1, 0.16), base[2] + R * 0.1];
      antenna(b, base, tip, R * 0.006, side > 0 ? '#9fdcff' : '#ffd27f');
    }
    if (fam === 'blade' || fam === 'wedge') chineStrips(b, hull, 0.3, 0.8, 3);
    else {
      for (let i = 0; i < 4; i++) {
        const t = 0.3 + i * 0.16;
        const s = hull.slice(t);
        for (const side of [1, -1]) {
          b.light([s.x + side * (s.w + R * 0.004), s.y, hull.z(t)], '#ffd9a0', 0.035, { blink: 0.4, phase: i * 0.12, duty: 0.3, min: 0.35, intensity: 1 });
        }
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Courier: sleek mid-size runner, single cockpit well forward, two guns, a small cargo pod.
 * ---------------------------------------------------------------------------------------------- */

function courier(b: ShipBuilder): void {
  const R = b.R;
  const p = b.pal;
  const fam = b.style.silhouette;
  const hull = fuselage(b, { length: 1.76, width: 0.2, top: 0.115, bottom: 0.08 }, paintFor(b));
  const cs = hull.slice(0.28);
  canopy(b, hull, 0.12, 0.4, cs.w * 0.42, cs.top * 0.66, canopyLookOf(b), fam === 'splice' ? cs.w * 0.2 : 0);
  const wing = wings(b, hull, { span: 0.8, t0: 0.46, chord: 0.4, y: -0.025, thickness: 0.028 });
  const r = R * (0.066 + 0.006 * (b.tier - 1));
  const look = engineLookOf(b);
  if (fam === 'ring') engineRing(b, hull, 0.82, 2, r);
  else if (fam === 'wedge') nacelles(b, hull, r, look);
  else if (fam === 'splice') nacelles(b, hull, r, 'round', 0.55);
  else tailEngines(b, hull, 2, r, look);
  mountGuns(b, [rootPair(b, hull, 0.34), chin(b, hull, 0.16)], b.spec.guns, R * 0.2, R * 0.011);
  // Cargo pod under the belly, hazard-banded.
  const pz0 = hull.z(0.54);
  const pz1 = hull.z(0.86);
  const ps = hull.slice(0.7);
  const ph = R * 0.075;
  const py = hull.botY(0.7, 0.3) - ph * 0.42;
  b.box('hull', [ps.w * 0.95, ph, pz1 - pz0], [ps.x, py, (pz0 + pz1) / 2], p.panelDark);
  for (const k of [0.18, 0.82]) b.box('hull', [ps.w * 0.97, ph * 1.04, R * 0.028], [ps.x, py, pz0 + (pz1 - pz0) * k], p.accent);
  const fin0 = tailFins(b, hull, 0.17);
  refinements(b, hull);
  greebles(b, hull, 0.44, 0.94, 4 + 10 * b.greeble, [0.1, 0.42]);
  navLights(b, wing.tips, fin0, [0, hull.slice(1).y, hull.z(1) + R * 0.02], [0, hull.botY(0.08), hull.z(0.06)]);
}

/* ------------------------------------------------------------------------------------------------
 * Light fighter: small and agile, big wings, two or three guns.
 * ---------------------------------------------------------------------------------------------- */

function lightFighter(b: ShipBuilder): void {
  const R = b.R;
  const fam = b.style.silhouette;
  const hull = fuselage(b, { length: 1.46, width: 0.16, top: 0.11, bottom: 0.075 }, paintFor(b));
  const cs = hull.slice(0.34);
  canopy(b, hull, 0.18, 0.48, cs.w * 0.5, cs.top * 0.78, canopyLookOf(b), fam === 'splice' ? -cs.w * 0.15 : 0);
  const wing = wings(b, hull, { span: 0.94, t0: 0.4, chord: 0.46, y: -0.01, thickness: 0.026, outer: true });
  const r = R * (0.062 + 0.006 * (b.tier - 1));
  const look = engineLookOf(b);
  if (fam === 'ring') engineRing(b, hull, 0.84, 2, r);
  else if (fam === 'pod') tailEngines(b, hull, 1, r * 1.3, look);
  else if (fam === 'splice') {
    tailEngines(b, hull, 1, r * 1.1, 'square');
    engine(b, 'round', hull.sideX(0.8) + r * 0.4, hull.slice(0.8).y + r * 0.6, hull.z(0.62), hull.z(0.98), r * 0.8);
  } else tailEngines(b, hull, 2, r, look);
  mountGuns(b, [[wing.mounts[0], wing.mounts[1]], chin(b, hull, 0.14), rootPair(b, hull, 0.32)], b.spec.guns, R * 0.19, R * 0.011);
  const top = wing.booms ? [0, wing.booms.y + R * 0.2, hull.z(0.95)] as V3 : tailFins(b, hull, 0.15, true);
  if (b.tier >= 3 && fam !== 'pod') {
    // Canards.
    const zc = hull.z(0.2);
    const xc = hull.slice(0.22).w * 0.8;
    const can: Trapezoid = { x0: xc, lead0: zc, trail0: zc + hull.length * 0.08, x1: xc + R * 0.14, lead1: zc + R * 0.08, trail1: zc + R * 0.11 };
    for (const side of [1, -1]) wingPanel(b, can, side, hull.slice(0.22).y, R * 0.016, b.pal.accent, 0.12);
  }
  refinements(b, hull);
  greebles(b, hull, 0.52, 0.94, 3 + 8 * b.greeble, [0.16, 0.5]);
  navLights(b, wing.tips, top, [0, hull.slice(1).y, hull.z(1) + R * 0.02], [0, hull.botY(0.08), hull.z(0.06)]);
}

/* ------------------------------------------------------------------------------------------------
 * Heavy fighter: bulky and armoured, four or five guns, big engines.
 * ---------------------------------------------------------------------------------------------- */

function heavyFighter(b: ShipBuilder): void {
  const R = b.R;
  const p = b.pal;
  const fam = b.style.silhouette;
  const hull = fuselage(b, { length: 1.58, width: 0.24, top: 0.15, bottom: 0.11 }, paintFor(b));
  const cs = hull.slice(0.26);
  canopy(b, hull, 0.12, 0.36, cs.w * 0.36, cs.top * 0.5, canopyLookOf(b), fam === 'splice' ? cs.w * 0.18 : 0);
  // Armour: flank plates, more with plating-heavy makers and higher tiers.
  flankPlates(b, hull, 0.3, 0.82, 2 + Math.round(b.greeble * 2) + (b.tier >= 2 ? 1 : 0), p.panelDark);
  const wing = wings(b, hull, { span: 0.76, t0: 0.44, chord: 0.36, y: -0.02, thickness: 0.042 });
  // Gun pods under the wing mounts.
  for (const m of wing.mounts) {
    const len = R * 0.26;
    b.box('hull', [R * 0.06, R * 0.05, len], [m[0], m[1] + R * 0.004, m[2] + len * 0.4], p.panel);
  }
  const r = R * (0.08 + 0.007 * (b.tier - 1));
  const look = engineLookOf(b);
  if (fam === 'ring') engineRing(b, hull, 0.8, 2, r);
  else if (fam === 'wedge') nacelles(b, hull, r, look, 0.46, 0.98);
  else if (fam === 'splice') {
    tailEngines(b, hull, 1, r * 1.05, 'square');
    engine(b, 'round', hull.sideX(0.78) + r * 0.3, hull.slice(0.78).y - r * 0.3, hull.z(0.56), hull.z(0.97), r * 0.9);
  } else tailEngines(b, hull, 2, r, look);
  // Nose cannon first when the gun count is odd.
  const nose = chin(b, hull, 0.12);
  const mounts = b.spec.guns % 2 === 1 ? [nose, rootPair(b, hull, 0.3), [wing.mounts[0], wing.mounts[1]]] : [rootPair(b, hull, 0.3), [wing.mounts[0], wing.mounts[1]], nose];
  mountGuns(b, mounts, b.spec.guns, R * 0.21, R * 0.014);
  const fin0 = tailFins(b, hull, 0.16, true);
  refinements(b, hull);
  greebles(b, hull, 0.4, 0.94, 5 + 12 * b.greeble, [0.1, 0.38]);
  navLights(b, wing.tips, fin0, [0, hull.slice(1).y, hull.z(1) + R * 0.02], [0, hull.botY(0.08), hull.z(0.06)]);
}

/* ------------------------------------------------------------------------------------------------
 * Gunship: large and broad, turret clusters, two launcher bays.
 * ---------------------------------------------------------------------------------------------- */

/** Barrels per turret for n guns (clusters of up to three). */
function clusters(n: number): number[] {
  if (n <= 3) return n > 0 ? [n] : [];
  if (n <= 6) return [Math.ceil(n / 2), Math.floor(n / 2)];
  const k = Math.ceil(n / 3);
  return [k, k, n - 2 * k].filter((c) => c > 0);
}

function gunship(b: ShipBuilder): void {
  const R = b.R;
  const p = b.pal;
  const fam = b.style.silhouette;
  const hull = fuselage(b, { length: 1.66, width: 0.32, top: 0.15, bottom: 0.125 }, paintFor(b));
  // Bridge tower aft of midships, glazed at the front.
  const bt0 = 0.5;
  const bt1 = 0.74;
  const bs = hull.slice((bt0 + bt1) / 2);
  const bw = bs.w * 0.5;
  const bh = hull.slice(0.6).top * 0.55;
  const by = hull.topY(0.62, 0.3) + bh * 0.55;
  const bridge = new Body({
    shape: fam === 'pod' ? 'pod' : fam === 'blade' ? 'blade' : 'block',
    stations: [
      { t: bt0, w: 0.72, top: 0.5, bot: 1 },
      { t: bt0 + 0.05, w: 1, top: 1, bot: 1 },
      { t: bt1 - 0.04, w: 1, top: 0.96, bot: 1 },
      { t: bt1, w: 0.8, top: 0.72, bot: 1 },
    ],
    z0: hull.z0,
    length: hull.length,
    width: bw,
    top: bh,
    bottom: bh,
    x: bs.x,
    y: by,
  });
  b.add('hull', bridge.geometry(hullPainter(b, { salt: 30, topStripe: b.tier >= 3 ? [0.6, 0.74] : undefined })));
  const tower = new Hull([bridge]);
  canopy(b, tower, bt0 + 0.012, bt0 + 0.13, bw * 0.7, bh * 0.8, canopyLookOf(b), bs.x);
  for (const side of [1, -1]) {
    b.glowBox([R * 0.006, R * 0.012, hull.length * 0.1], [bs.x + side * (bw + R * 0.002), by + bh * 0.3, hull.z(bt0 + 0.13)], new THREE.Color('#ffe2a8').multiplyScalar(1.6));
  }
  // Turret clusters on the forward deck: dorsal, ventral, then a second dorsal.
  const tr = R * 0.1;
  const spots: [number, number][] = [
    [0.24, 1],
    [0.3, -1],
    [0.4, 1],
  ];
  clusters(b.spec.guns).forEach((n, i) => {
    const [t, up] = spots[i % spots.length]!;
    const s = hull.slice(t);
    const y = up > 0 ? hull.topY(t, 0.1) - tr * 0.05 : hull.botY(t, 0.1) + tr * 0.05;
    turret(b, s.x, y, hull.z(t), n, tr, up);
  });
  // Launcher bays ride on stub sponsons, or on the engine ring of spine-and-ring hulls.
  const bayW = R * 0.12;
  const bayH = R * 0.1;
  const bayL = hull.length * 0.2;
  const r = R * (0.07 + 0.006 * (b.tier - 1));
  let tips: [V3, V3];
  if (fam === 'ring') {
    const t = 0.84;
    const ringR = engineRing(b, hull, t, 3, r * 1.1) - r * 1.1;
    const s = hull.slice(t);
    for (const side of [1, -1]) launcherBay(b, s.x + side * (ringR + bayW * 0.5), s.y, hull.z(t) - bayL * 0.1, bayW, bayH, bayL);
    tips = [
      [s.x + ringR + bayW, s.y + bayH * 0.6, hull.z(t)],
      [s.x - ringR - bayW, s.y + bayH * 0.6, hull.z(t)],
    ];
  } else {
    const wing = wings(b, hull, { span: 0.62, t0: 0.44, chord: 0.3, y: -0.01, thickness: 0.05 });
    for (const side of [0, 1]) {
      const m = wing.mounts[side]!;
      launcherBay(b, m[0], m[1] - bayH * 0.3, m[2] + bayL * 0.25, bayW, bayH, bayL);
    }
    tips = wing.tips;
    tailEngines(b, hull, 4, r, engineLookOf(b));
  }
  flankPlates(b, hull, 0.2, 0.78, 3 + Math.round(b.greeble * 2), p.panelDark);
  const fin0 = fam === 'ring' ? ([bs.x, by + bh, hull.z(bt1 - 0.02)] as V3) : tailFins(b, hull, 0.15, true);
  refinements(b, hull);
  if (b.tier >= 3) {
    antenna(b, [bs.x + bw * 0.5, by + bh * 0.95, hull.z(0.66)], [bs.x + bw * 0.6, by + bh + R * 0.18, hull.z(0.72)], R * 0.007, '#ffffff');
  }
  greebles(b, hull, 0.46, 0.96, 6 + 14 * b.greeble, [0.46, 0.76]);
  navLights(b, tips, fin0, [0, hull.slice(1).y, hull.z(1) + R * 0.02], [0, hull.botY(0.08), hull.z(0.06)]);
}

/* ------------------------------------------------------------------------------------------------
 * Freighter: small cab, long spine with cargo sections, engine block, one or two guns.
 * ---------------------------------------------------------------------------------------------- */

const CAB: Record<HullShape, Station[]> = {
  wedge: [
    { t: 0, w: 0.2, top: 0.22, bot: 0.3 },
    { t: 0.05, w: 0.7, top: 0.64, bot: 0.72 },
    { t: 0.11, w: 0.96, top: 0.92, bot: 0.96 },
    { t: 0.18, w: 1, top: 1, bot: 1 },
    { t: 0.21, w: 0.9, top: 0.9, bot: 0.9 },
  ],
  blade: [
    { t: 0, w: 0.06, top: 0.12, bot: 0.12 },
    { t: 0.08, w: 0.6, top: 0.6, bot: 0.55 },
    { t: 0.16, w: 0.95, top: 0.95, bot: 0.9 },
    { t: 0.21, w: 1, top: 1, bot: 1 },
  ],
  block: [
    { t: 0, w: 0.7, top: 0.6, bot: 0.7 },
    { t: 0.03, w: 0.92, top: 0.88, bot: 0.92 },
    { t: 0.19, w: 1, top: 1, bot: 1 },
    { t: 0.21, w: 0.9, top: 0.92, bot: 0.9 },
  ],
  pod: [
    { t: 0, w: 0.22, top: 0.22, bot: 0.22 },
    { t: 0.03, w: 0.66, top: 0.66, bot: 0.66 },
    { t: 0.08, w: 0.92, top: 0.92, bot: 0.92 },
    { t: 0.16, w: 1, top: 1, bot: 1 },
    { t: 0.21, w: 0.8, top: 0.8, bot: 0.8 },
  ],
  ring: [
    { t: 0, w: 0.45, top: 0.4, bot: 0.45 },
    { t: 0.04, w: 0.85, top: 0.8, bot: 0.85 },
    { t: 0.1, w: 1, top: 1, bot: 1 },
    { t: 0.18, w: 1, top: 1, bot: 1 },
    { t: 0.21, w: 0.8, top: 0.8, bot: 0.8 },
  ],
};

const ENGINE_BLOCK: Station[] = [
  { t: 0.79, w: 0.7, top: 0.7, bot: 0.7 },
  { t: 0.82, w: 1, top: 1, bot: 1 },
  { t: 0.97, w: 1, top: 1, bot: 1 },
  { t: 1, w: 0.9, top: 0.9, bot: 0.9 },
];

function freighter(b: ShipBuilder): void {
  const R = b.R;
  const p = b.pal;
  const fam = b.style.silhouette;
  const shape = shapeOf(b);
  const v = b.rng('hull');
  const L = 1.86 * R * v.range(0.97, 1.03);
  const z0 = -L / 2;
  const cabW = 0.17 * R * v.range(0.95, 1.05);
  const cabT = 0.15 * R;
  const cabB = 0.12 * R;
  const cab = new Body({ shape, stations: CAB[shape], z0, length: L, width: cabW, top: cabT, bottom: cabB });
  b.add('hull', cab.geometry(hullPainter(b, { stripe: [0.04, 0.2], salt: 1 })));
  const blockShape: HullShape = fam === 'splice' ? 'pod' : shape === 'wedge' ? 'block' : shape;
  const ebW = 0.2 * R * (fam === 'block' ? 1.1 : 1);
  const eng = new Body({ shape: blockShape, stations: ENGINE_BLOCK, z0, length: L, width: ebW, top: 0.16 * R, bottom: 0.16 * R, y: fam === 'splice' ? -0.03 * R : 0 });
  b.add('hull', eng.geometry(hullPainter(b, { rings: [1], salt: 2, base: fam === 'splice' ? p.salvage[3] : undefined })));
  const hull = new Hull([cab, eng]);
  // Cockpit glazing on the cab.
  canopy(b, hull, 0.035, 0.13, cabW * 0.5, cabT * 0.42, canopyLookOf(b));
  // Spine.
  const sw = R * 0.055;
  const zs0 = hull.z(0.19);
  const zs1 = hull.z(0.81);
  b.box('metal', [sw * 2, sw * 2, zs1 - zs0], [0, 0, (zs0 + zs1) / 2], p.metalDark);
  b.glowBox([R * 0.012, R * 0.012, (zs1 - zs0) * 0.96], [0, sw * 1.02, (zs0 + zs1) / 2], new THREE.Color('#ffb347').multiplyScalar(0.9));
  // Cargo sections.
  const sections = 4;
  const secL = (zs1 - zs0) / sections;
  const fill = [0.72, 0.86, 1][Math.min(2, b.tier - 1)]!;
  const cr = b.rng('cargo');
  const cargoCols = [p.hull, p.panel, p.hullLight, p.accent, p.panelDark, new THREE.Color('#8b949c'), new THREE.Color('#b5562c'), new THREE.Color('#2e7d7a')];
  let cargoR = 0.2 * R;
  for (let i = 0; i < sections; i++) {
    const zc = zs0 + secL * (i + 0.5);
    const len = secL * 0.9;
    // Frame between sections.
    b.box('metal', [R * 0.3, R * 0.02, R * 0.03], [0, 0, zs0 + secL * i + secL * 0.02], p.metal);
    switch (fam) {
      case 'block': {
        // One armoured cargo block per section with hazard ends.
        const w = R * 0.21;
        const h = R * 0.17;
        b.box('hull', [w * 2, h * 2, len], [0, 0, zc], i % 2 ? p.hull : p.hullDark);
        b.box('hull', [w * 2.03, h * 2.03, len * 0.08], [0, 0, zc - len * 0.42], p.accent);
        if (b.tier >= 2) for (const side of [1, -1]) b.box('hull', [R * 0.02, h * 1.3, len * 0.7], [side * (w + R * 0.008), 0, zc], p.panelDark);
        cargoR = Math.max(w, h);
        break;
      }
      case 'pod': {
        // Three cargo pods round the spine.
        const pr = R * 0.1;
        for (let k = 0; k < 3; k++) {
          if (cr.next() > fill) continue;
          const a = deg(90 + k * 120);
          capsule(b, 'hull', [Math.cos(a) * pr * 1.25, Math.sin(a) * pr * 1.25, zc], pr, len, cr.pick(cargoCols.slice(0, 5)), b.segPod);
        }
        cargoR = pr * 2.25;
        break;
      }
      case 'ring': {
        // A cargo ring: a band with six containers standing round the spine.
        const rr = R * 0.23;
        ringBand(b, 'hull', 0, 0, zc, rr, rr * 0.86, len * 0.16, i % 2 ? p.accent : p.panel);
        for (let k = 0; k < 6; k++) {
          if (cr.next() > fill) continue;
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const q: V3 = [0, 0, a - Math.PI / 2];
          b.box('hull', [R * 0.1, R * 0.12, len * 0.8], [Math.cos(a) * rr * 0.62, Math.sin(a) * rr * 0.62, zc], cr.pick(cargoCols), q);
        }
        cargoR = rr;
        break;
      }
      default: {
        // Containers stacked two by two round the spine.
        const c = R * 0.1;
        for (const [x, y] of [
          [1, 1],
          [-1, 1],
          [1, -1],
          [-1, -1],
        ] as const) {
          if (cr.next() > fill) continue;
          const jitter = fam === 'splice' ? cr.range(0.85, 1.12) : 1;
          const off = fam === 'splice' ? cr.range(-0.02, 0.02) * R : 0;
          container(b, [x * c * 1.02 + off, y * c * 1.02, zc], [c * 1.9 * jitter, c * 1.9 * jitter, len * (fam === 'splice' ? cr.range(0.7, 0.95) : 0.92)], cr.pick(cargoCols));
        }
        cargoR = c * 2.1;
      }
    }
  }
  // Engines.
  const r = R * (0.068 + 0.006 * (b.tier - 1));
  const es = eng.slice(0.95);
  const look = engineLookOf(b);
  const zf = hull.z(0.86);
  const zb = hull.z(1) + r * 0.4;
  let tips: [V3, V3];
  if (b.style.wings === 'twin-boom') {
    // Booms along both sides carry the aft engines and tail fins.
    const bx = Math.max(cargoR, ebW) + R * 0.1;
    const br = R * 0.06;
    const bz0 = hull.z(0.16);
    const bz1 = hull.z(1.0);
    for (const side of [1, -1]) {
      const boom = new Body({ shape: 'pod', stations: BOOM, z0: bz0, length: bz1 - bz0, width: br, top: br, bottom: br, x: side * bx, y: 0 });
      b.add('hull', boom.geometry(hullPainter(b, { rings: [1, 3], salt: 40 + side })));
      for (const t of [0.22, 0.5, 0.78]) beam(b.kit, 'metal', [side * sw, 0, hull.z(t)], [side * (bx - br * 0.8), 0, hull.z(t)], R * 0.022, p.metalDark);
      beam(b.kit, 'metal', [side * ebW * 0.8, 0, hull.z(0.9)], [side * (bx - br * 0.8), 0, hull.z(0.9)], R * 0.04, p.hullDark);
      fin(b, finPlanform(hull.z(0.84), L * 0.13, R * 0.2, 0.5, 0.45), side * bx, br * 0.7, R * 0.02, p.hull);
      engine(b, 'capsule', side * bx, 0, bz1 - L * 0.04, bz1 + r * 0.3, r);
    }
    for (const [x, y] of tailLayout(2, es, r)) engine(b, look, x, y, zf, zb, r);
    tips = [
      [bx + br, 0, hull.z(0.5)],
      [-bx - br, 0, hull.z(0.5)],
    ];
  } else {
    const count = fam === 'ring' ? 3 : 4;
    for (const [x, y] of tailLayout(count, es, r)) engine(b, look, x, y, zf, zb, r);
    // Stabilisers on the engine block.
    const span = ebW + R * 0.22;
    const lead = hull.z(0.83);
    const chord = L * 0.12;
    const kind = b.style.wings;
    if (kind === 'swept' || kind === 'delta' || kind === 'asymmetric') {
      const tr: Trapezoid = { x0: ebW * 0.8, lead0: lead, trail0: lead + chord, x1: span, lead1: lead + chord * 0.6, trail1: lead + chord * 0.98 };
      for (const side of kind === 'asymmetric' ? [1] : [1, -1]) wingPanel(b, tr, side, 0, R * 0.024, p.hull, -0.05);
      if (kind === 'asymmetric') fin(b, finPlanform(lead, chord, R * 0.2, 0.6, 0.4), -ebW, 0, R * 0.024, p.panel, -deg(40));
    } else if (kind === 'straight') {
      const tr: Trapezoid = { x0: ebW * 0.9, lead0: lead + chord * 0.1, trail0: lead + chord, x1: span, lead1: lead + chord * 0.16, trail1: lead + chord * 0.94 };
      for (const side of [1, -1]) {
        wingPanel(b, tr, side, 0, R * 0.036, p.hullDark, 0);
        b.box('hull', [R * 0.03, R * 0.16, chord * 0.9], [side * (span + R * 0.015), 0, lead + chord * 0.55], p.accent);
      }
    } else {
      // Radiator fins.
      for (const side of [1, -1]) b.box('metal', [R * 0.012, R * 0.2, chord * 0.8], [side * (ebW + R * 0.004), 0, lead + chord * 0.5], p.panelDark);
    }
    tips = [
      [span, 0, lead + chord * 0.8],
      [-span, 0, lead + chord * 0.8],
    ];
  }
  const tailTop: V3 = [0, eng.topY(0.9) + R * 0.02, hull.z(0.9)];
  if (b.style.silhouette !== 'ring') fin(b, finPlanform(hull.z(0.82), L * 0.15, R * 0.14, 0.6, 0.4), 0, eng.topY(0.88) - R * 0.005, R * 0.02, p.hull);
  // Gun turrets side by side on the cab roof.
  const turrets = clusters(b.spec.guns);
  turrets.forEach((n, i) => {
    const x = (i - (turrets.length - 1) / 2) * R * 0.13;
    turret(b, x, cab.topY(0.155, Math.abs(x) / cabW) - R * 0.004, hull.z(0.155), n, R * 0.055, 1);
  });
  // Refinements: tank pairs, antennae and more lights on bigger models.
  if (b.tier >= 2) {
    for (const side of [1, -1]) capsule(b, 'metal', [side * cabW * 0.95, -cabB * 0.4, hull.z(0.19)], R * 0.045, R * 0.3, p.metal);
  }
  if (b.tier >= 3) {
    antenna(b, [cabW * 0.4, cab.topY(0.12, 0.4), hull.z(0.12)], [cabW * 0.45, cab.topY(0.12, 0.4) + R * 0.16, hull.z(0.16)], R * 0.006, '#ffffff');
    chineStrips(b, new Hull([eng]), 0.83, 0.97, 2);
  }
  for (let i = 0; i < 5; i++) {
    b.light([0, sw * 1.1, zs0 + ((zs1 - zs0) * (i + 0.5)) / 5], '#ffb347', 0.07, { blink: 0.6, phase: i / 5, duty: 0.25, min: 0.2, intensity: 1.2 });
  }
  greebles(b, new Hull([eng]), 0.82, 0.98, 2 + 6 * b.greeble);
  navLights(b, tips, tailTop, [0, 0, hull.z(1) + R * 0.02], [0, cab.botY(0.03), hull.z(0.02)]);
}

/* ------------------------------------------------------------------------------------------------
 * Surveyor: sensor dish, booms and antennae, two guns.
 * ---------------------------------------------------------------------------------------------- */

function surveyor(b: ShipBuilder): void {
  const R = b.R;
  const p = b.pal;
  const fam = b.style.silhouette;
  const hull = fuselage(b, { length: 1.64, width: 0.19, top: 0.125, bottom: 0.095 }, paintFor(b));
  const cs = hull.slice(0.24);
  canopy(b, hull, 0.1, 0.34, cs.w * 0.44, cs.top * 0.62, canopyLookOf(b));
  const wing = wings(b, hull, { span: 0.62, t0: 0.5, chord: 0.3, y: -0.02, thickness: 0.026 });
  const r = R * (0.064 + 0.006 * (b.tier - 1));
  const look = engineLookOf(b);
  const bm = wing.booms;
  if (bm) {
    tailEngines(b, hull, 1, r * 1.2, look);
    for (const side of [1, -1]) {
      // Sensor pods on the boom noses.
      rod(b.kit, 'metal', [side * bm.x, bm.y, bm.zf], [side * bm.x, bm.y, bm.zf - R * 0.18], bm.r * 0.3, p.metal, b.segThin);
      b.box('hull', [bm.r * 1.2, bm.r * 1.2, R * 0.08], [side * bm.x, bm.y, bm.zf - R * 0.18], p.accent);
    }
  } else if (fam === 'ring') engineRing(b, hull, 0.84, 2, r);
  else tailEngines(b, hull, 2, r, look);
  mountGuns(b, [rootPair(b, hull, 0.22), chin(b, hull, 0.14)], b.spec.guns, R * 0.15, R * 0.01);
  // Dish on a dorsal mast, tilted up and forward.
  const dt = 0.54;
  const ds = hull.slice(dt);
  const mastTop: V3 = [ds.x, hull.topY(dt) + R * 0.12, hull.z(dt)];
  rod(b.kit, 'metal', [ds.x, hull.topY(dt) - R * 0.01, hull.z(dt)], mastTop, R * 0.02, p.metalDark, b.segThin);
  const dishR = R * (0.2 + 0.02 * (b.tier - 1));
  dish(b, [mastTop[0], mastTop[1] + R * 0.02, mastTop[2]], dishR, new THREE.Vector3(0, 0.62, -1), b.tier >= 2);
  // Sensor booms reaching forward from the hull sides, and antennae aft.
  const bt = 0.32;
  const bs = hull.slice(bt);
  for (const side of [1, -1]) {
    const base: V3 = [bs.x + side * bs.w * 0.9, bs.y, hull.z(bt)];
    const tip: V3 = [bs.x + side * (bs.w + R * 0.22), bs.y - R * 0.02, hull.z(0.02)];
    rod(b.kit, 'metal', base, tip, R * 0.012, p.metal, b.segThin);
    b.box('hull', [R * 0.04, R * 0.04, R * 0.1], tip, p.panel);
    b.light([tip[0], tip[1], tip[2] - R * 0.05], side > 0 ? '#22ff5a' : '#ff2a20', 0.05, { intensity: 1 });
  }
  const ar = b.rng('antennae-array');
  const count = 2 + b.tier;
  for (let i = 0; i < count; i++) {
    const t = 0.66 + (i / Math.max(1, count - 1)) * 0.24;
    const side = i % 2 ? 1 : -1;
    const s = hull.slice(t);
    const base: V3 = [s.x + side * s.w * 0.35, hull.topY(t, 0.35), hull.z(t)];
    antenna(b, base, [base[0] + side * R * 0.03, base[1] + R * ar.range(0.1, 0.2), base[2] + R * 0.06], R * 0.006, i === count - 1 ? '#ffffff' : undefined);
  }
  const fin0 = tailFins(b, hull, 0.13);
  refinements(b, hull);
  greebles(b, hull, 0.36, 0.64, 3 + 8 * b.greeble, [0.05, 0.36]);
  navLights(b, wing.tips, fin0, [0, hull.slice(1).y, hull.z(1) + R * 0.02], [0, hull.botY(0.06), hull.z(0.05)]);
}

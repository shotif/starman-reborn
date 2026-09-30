import * as THREE from 'three';
import { beam, latheZ, loft, rod, slab } from '../kit.ts';
import type { LoftSection, V3 } from '../kit.ts';
import { byQuality } from '../util.ts';
import { Body, FUSELAGE, Hull } from './body.ts';
import type { Band, HullShape, Painter, Station } from './body.ts';
import type { ShipBuilder } from './builder.ts';
import { hashText } from './palette.ts';
import type { ShipPalette } from './palette.ts';

/**
 * Building blocks shared by every ship class. Each takes the builder, adds merged-by-material
 * parts to its kit and registers anchors (nozzles, muzzles) where the part has them. Colours
 * come from the maker palette, shapes from the maker's silhouette family.
 */

type Planform = [number, number][];

/* ------------------------------------------------------------------------------------------------
 * Hull.
 * ---------------------------------------------------------------------------------------------- */

/** Outline family used for each silhouette's bodies (spliced hulls mix several). */
export function shapeOf(b: ShipBuilder): HullShape {
  const s = b.style.silhouette;
  return s === 'splice' ? 'wedge' : s;
}

interface Dims {
  length: number;
  width: number;
  top: number;
  bottom: number;
}

/** Silhouette-family proportions applied on top of each class's fuselage. */
const FAMILY_DIMS: Record<string, Dims> = {
  wedge: { length: 1, width: 1, top: 1, bottom: 1 },
  blade: { length: 1.1, width: 0.9, top: 0.72, bottom: 0.62 },
  block: { length: 0.94, width: 1.1, top: 1.18, bottom: 1.1 },
  pod: { length: 0.9, width: 1.08, top: 1.22, bottom: 1.2 },
  ring: { length: 1.02, width: 0.92, top: 1.02, bottom: 1.02 },
  splice: { length: 1, width: 1, top: 1.08, bottom: 1.02 },
};

/** Paint for a body: bands by silhouette family, accent stripes and rings, weathering. */
export interface PaintOptions {
  /** t-range of the flank accent stripe. */
  stripe?: [number, number];
  /** t-range of a stripe down the spine. */
  topStripe?: [number, number];
  /** Strips (by index) painted all round in the accent colour. */
  rings?: readonly number[];
  /** Base colour override (spliced sections). */
  base?: THREE.Color;
  /** Distinguishes bodies so their weathering differs. */
  salt?: number;
}

const BAND_INDEX: Record<Band, number> = { top: 0, shoulder: 1, flank: 2, lowerFlank: 3, lowerShoulder: 4, belly: 5, cap: 6 };

type PaletteKey = keyof Pick<ShipPalette, 'hull' | 'hullLight' | 'hullDark' | 'panel' | 'panelDark' | 'trim'>;

const SCHEMES: Record<string, Record<Band, PaletteKey>> = {
  wedge: { top: 'hullLight', shoulder: 'hull', flank: 'hull', lowerFlank: 'hullDark', lowerShoulder: 'panel', belly: 'panel', cap: 'trim' },
  blade: { top: 'hull', shoulder: 'hull', flank: 'hull', lowerFlank: 'hull', lowerShoulder: 'hullDark', belly: 'hullDark', cap: 'trim' },
  block: { top: 'hull', shoulder: 'hullDark', flank: 'hull', lowerFlank: 'panel', lowerShoulder: 'panelDark', belly: 'panel', cap: 'trim' },
  pod: { top: 'hullLight', shoulder: 'hull', flank: 'hull', lowerFlank: 'panel', lowerShoulder: 'panel', belly: 'panelDark', cap: 'trim' },
  ring: { top: 'hull', shoulder: 'panel', flank: 'hull', lowerFlank: 'hullDark', lowerShoulder: 'panelDark', belly: 'panelDark', cap: 'trim' },
  splice: { top: 'hull', shoulder: 'hull', flank: 'hull', lowerFlank: 'hullDark', lowerShoulder: 'hullDark', belly: 'panelDark', cap: 'trim' },
};

/** Stable pseudo-random value in [0, 1) for a face strip (mirrored strips share it). */
function strip01(id: string, salt: number, strip: number, band: number, side: number): number {
  return hashText(`${id}|${salt}|${strip}|${band}|${side}`) / 4294967296;
}

export function hullPainter(b: ShipBuilder, opts: PaintOptions = {}): Painter {
  const p = b.pal;
  const family = b.style.silhouette;
  const scheme = SCHEMES[family] ?? SCHEMES.wedge!;
  const weather = 0.03 + 0.08 * b.greeble;
  const salt = opts.salt ?? 0;
  const patchy = family === 'ring' || family === 'splice';
  return (t, band, side, strip) => {
    const bi = BAND_INDEX[band];
    // Symmetric hulls weather both sides alike.
    const s = b.symmetric ? 0 : side;
    let c: THREE.Color;
    if (opts.base && (band === 'top' || band === 'shoulder' || band === 'flank')) c = opts.base;
    else c = p[scheme[band]];
    if (band !== 'cap') {
      if (opts.rings?.includes(strip)) c = p.accent;
      else if (opts.stripe && band === 'flank' && t >= opts.stripe[0] && t <= opts.stripe[1]) c = p.accent;
      else if (opts.topStripe && band === 'top' && t >= opts.topStripe[0] && t <= opts.topStripe[1]) c = p.accent;
      else if (family === 'blade' && band === 'shoulder' && t > 0.3 && t < 0.86 && strip % 2 === 0) c = p.panel;
      // Salvage: red slashes on odd plates, never the same on both sides.
      else if (family === 'splice' && (band === 'flank' || band === 'shoulder') && strip01(b.spec.id, salt + 13, strip, bi, side) < 0.2) c = p.accent;
      else if (patchy && strip01(b.spec.id, salt + 7, strip, bi, s) < 0.16 + 0.12 * b.greeble) {
        c = strip01(b.spec.id, salt + 11, strip, bi, s) < 0.5 ? p.panel : p.hullDark;
      }
    }
    const k = 1 + (strip01(b.spec.id, salt, strip, bi, s) * 2 - 1) * weather;
    return c.clone().multiplyScalar(k);
  };
}

/** Main fuselage for the airframe classes; spliced hulls are three mismatched sections. */
export function fuselage(b: ShipBuilder, d: Dims, paint: PaintOptions = {}): Hull {
  const fam = FAMILY_DIMS[b.style.silhouette] ?? FAMILY_DIMS.wedge!;
  const v = b.rng('hull');
  const R = b.R;
  const L = d.length * fam.length * R * v.range(0.97, 1.03);
  const W = d.width * fam.width * R * v.range(0.96, 1.04);
  const T = d.top * fam.top * R * v.range(0.95, 1.05);
  const B = d.bottom * fam.bottom * R * v.range(0.95, 1.05);
  const z0 = -L / 2;
  if (b.style.silhouette !== 'splice') {
    const shape = shapeOf(b);
    const body = new Body({ shape, stations: FUSELAGE[shape], z0, length: L, width: W, top: T, bottom: B });
    b.add('hull', body.geometry(hullPainter(b, paint)));
    return new Hull([body]);
  }
  // Salvage: a pointed nose, a slab mid-section and a rounded engine can, welded off-axis.
  const sal = b.pal.salvage;
  const pick = b.rng('splice');
  const parts: { shape: HullShape; stations: Station[]; x: number; y: number }[] = [
    {
      shape: 'wedge',
      stations: [
        { t: 0, w: 0.05, top: 0.1, bot: 0.1 },
        { t: 0.1, w: 0.42, top: 0.44, bot: 0.44 },
        { t: 0.24, w: 0.74, top: 0.78, bot: 0.74 },
        { t: 0.37, w: 0.86, top: 0.9, bot: 0.86 },
      ],
      x: -0.04 * W,
      y: 0,
    },
    {
      shape: 'block',
      stations: [
        { t: 0.34, w: 0.9, top: 0.8, bot: 0.84 },
        { t: 0.42, w: 1, top: 0.94, bot: 0.96 },
        { t: 0.62, w: 1, top: 0.94, bot: 0.96 },
        { t: 0.7, w: 0.92, top: 0.86, bot: 0.9 },
      ],
      x: 0.1 * W,
      y: 0.06 * T,
    },
    {
      shape: 'pod',
      stations: [
        { t: 0.67, w: 0.8, top: 0.82, bot: 0.82 },
        { t: 0.75, w: 0.92, top: 0.94, bot: 0.94 },
        { t: 0.9, w: 0.88, top: 0.88, bot: 0.88 },
        { t: 1, w: 0.66, top: 0.62, bot: 0.62 },
      ],
      x: -0.07 * W,
      y: -0.08 * T,
    },
  ];
  const bodies = parts.map((part, i) => {
    const body = new Body({ ...part, z0, length: L, width: W, top: T, bottom: B });
    const base = i === 0 ? sal[0]! : pick.pick(sal.slice(1));
    b.add('hull', body.geometry(hullPainter(b, { ...paint, base, salt: i + 1 })));
    return body;
  });
  const hull = new Hull(bodies);
  // Weld collars where the sections meet.
  for (const t of [0.355, 0.685]) {
    const s = hull.slice(t);
    const r = Math.max(s.w, (s.top + s.bot) / 2) * 1.02;
    ringBand(b, 'metal', s.x, s.y, hull.z(t), r, r * 0.7, L * 0.018, b.pal.metalDark, 8);
  }
  return hull;
}

/* ------------------------------------------------------------------------------------------------
 * Small geometry helpers.
 * ---------------------------------------------------------------------------------------------- */

/** Relative luminance (linear). */
function luma(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function ellipse(n: number, w: number, h: number, cx = 0, cy = 0, phase = Math.PI / 2): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * w, cy + Math.sin(a) * h]);
  }
  return pts;
}

/** Rounded pod along Z centred on `pos` (cheaper than a capsule: smooth normals hide the facets). */
export function capsule(b: ShipBuilder, key: string, pos: V3, r: number, length: number, color: THREE.ColorRepresentation, seg = b.seg): void {
  const L = Math.max(length, r * 2.2);
  const profile: [number, number][] = [
    [0.001, 0],
    [r * 0.72, r * 0.26],
    [r, r],
    [r, L - r],
    [r * 0.72, L - r * 0.26],
    [0.001, L],
  ];
  b.add(key, latheZ(profile, seg), { position: [pos[0], pos[1], pos[2] - L / 2], color });
}

/** Mirror a planform across x = 0 (keeps the winding). */
function mirrorPlanform(pf: Planform): Planform {
  return pf.map(([x, z]) => [-x, z] as [number, number]).reverse();
}

/** Vertical fin from a (height, z) planform standing on +Y, thickness along X. */
function finGeometry(planform: Planform, thickness: number, bevel = 0.03): THREE.BufferGeometry {
  const g = slab(planform, thickness, bevel);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Closed band around Z (inner and outer walls, crisp edges). */
export function ringBand(
  b: ShipBuilder,
  key: string,
  x: number,
  y: number,
  z: number,
  rOut: number,
  rIn: number,
  width: number,
  color: THREE.ColorRepresentation,
  segments = b.segRing,
): void {
  const h = width / 2;
  const profile: [number, number][] = [
    [rOut, -h],
    [rOut, h],
    [rOut, h],
    [rIn, h],
    [rIn, h],
    [rIn, -h],
    [rIn, -h],
    [rOut, -h],
    [rOut, -h],
  ];
  b.add(key, latheZ(profile, segments), { position: [x, y, z], color });
}

/** A straight-edged wing panel: root chord at x0, tip chord at x1 (z grows towards the tail). */
export interface Trapezoid {
  x0: number;
  lead0: number;
  trail0: number;
  x1: number;
  lead1: number;
  trail1: number;
}

function trapPoints(tr: Trapezoid): Planform {
  return [
    [tr.x0, tr.lead0],
    [tr.x1, tr.lead1],
    [tr.x1, tr.trail1],
    [tr.x0, tr.trail0],
  ];
}

export function leadAt(tr: Trapezoid, x: number): number {
  const k = (x - tr.x0) / (tr.x1 - tr.x0);
  return tr.lead0 + (tr.lead1 - tr.lead0) * k;
}

function trailAt(tr: Trapezoid, x: number): number {
  const k = (x - tr.x0) / (tr.x1 - tr.x0);
  return tr.trail0 + (tr.trail1 - tr.trail0) * k;
}

/** Splits a panel spanwise at x (inner, outer); the pieces meet without overlapping. */
export function cutTrap(tr: Trapezoid, x: number): [Trapezoid, Trapezoid] {
  const lc = leadAt(tr, x);
  const tc = trailAt(tr, x);
  return [
    { x0: tr.x0, lead0: tr.lead0, trail0: tr.trail0, x1: x, lead1: lc, trail1: tc },
    { x0: x, lead0: lc, trail0: tc, x1: tr.x1, lead1: tr.lead1, trail1: tr.trail1 },
  ];
}

/** Adds one wing panel on one side (x mirrored for side -1), with dihedral about the ship axis. */
export function wingPanel(
  b: ShipBuilder,
  tr: Trapezoid,
  side: number,
  y: number,
  thickness: number,
  color: THREE.ColorRepresentation,
  dihedral = 0,
  key = 'hull',
): void {
  const pf = trapPoints(tr);
  const geo = slab(side > 0 ? pf : mirrorPlanform(pf), thickness, Math.min(thickness * 0.3, b.R * 0.012));
  b.add(key, geo, { position: [0, y, 0], rotation: [0, 0, side * dihedral], color });
}

/** Point on a wing panel (x along the span, on its mid-plane) after the dihedral rotation. */
export function wingPoint(x: number, y: number, z: number, side: number, dihedral: number): V3 {
  const a = side * dihedral;
  const px = side * x;
  return [px * Math.cos(a), y + px * Math.sin(a), z];
}

/* ------------------------------------------------------------------------------------------------
 * Cockpit.
 * ---------------------------------------------------------------------------------------------- */

export type CanopyLook = 'bubble' | 'faceted' | 'slit';

/** Canopy on the hull top between t0 and t1; `w` half-width and `h` height above the hull. */
export function canopy(b: ShipBuilder, hull: Hull, t0: number, t1: number, w: number, h: number, look: CanopyLook, x = 0): void {
  const n = look === 'faceted' ? 6 : look === 'slit' ? 8 : byQuality(b.quality, 10, 12, 16);
  const profile: [number, number, number][] =
    look === 'slit'
      ? [
          [0, 0.1, 0.1],
          [0.14, 0.6, 0.62],
          [0.4, 0.95, 1],
          [0.7, 1, 0.96],
          [0.9, 0.7, 0.62],
          [1, 0.16, 0.12],
        ]
      : [
          [0, 0.12, 0.1],
          [0.16, 0.66, 0.62],
          [0.4, 0.97, 0.96],
          [0.64, 1, 1],
          [0.84, 0.8, 0.76],
          [1, 0.22, 0.18],
        ];
  const sections: LoftSection[] = profile.map(([s, kw, kh]) => {
    const t = t0 + (t1 - t0) * s;
    const base = hull.topY(t, 0) - h * 0.32;
    return { z: hull.z(t), pts: ellipse(n, w * kw, h * kh * 1.32, x + hull.slice(t).x, base) };
  });
  b.add(b.pal.glass, loft(sections, { capStart: true, capEnd: true }));
  // Frame: a spine over the top and, on faceted canopies, two hoops.
  const top = (s: number): V3 => {
    const t = t0 + (t1 - t0) * s;
    const kh = s < 0.4 ? 0.62 + (s - 0.16) * 1.4 : s < 0.64 ? 1 : 1 - (s - 0.64) * 1.2;
    return [x + hull.slice(t).x, hull.topY(t, 0) - h * 0.32 + h * 1.32 * Math.max(0.2, kh), hull.z(t)];
  };
  beam(b.kit, 'metal', top(0.2), top(0.86), b.R * 0.012, b.pal.trim, b.R * 0.008);
  if (look === 'faceted') {
    for (const s of [0.38, 0.62]) {
      const p = top(s);
      b.box('metal', [w * 2.02, b.R * 0.008, b.R * 0.014], [p[0], p[1] - h * 0.02, p[2]], b.pal.trim);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Engines.
 * ---------------------------------------------------------------------------------------------- */

export type EngineLook = 'round' | 'square' | 'flat' | 'capsule';

export function engineLookOf(b: ShipBuilder): EngineLook {
  switch (b.style.silhouette) {
    case 'block':
      return 'square';
    case 'blade':
      return 'flat';
    case 'pod':
      return 'capsule';
    default:
      return 'round';
  }
}

/** Nozzle bell with a hot throat at z (exit behind it); registers the nozzle. */
function bell(b: ShipBuilder, x: number, y: number, z: number, r: number): void {
  const p: [number, number][] = [
    [r * 0.86, 0],
    [r * 0.8, r * 0.26],
    [r * 1.0, r * 1.0],
    [r * 1.07, r * 1.1],
    [r * 0.94, r * 1.1],
    [r * 0.62, r * 0.56],
  ];
  b.add('metal', latheZ(p, b.seg), { position: [x, y, z], color: b.pal.metal });
  b.add('emissive', new THREE.CircleGeometry(r * 0.66, b.seg), { position: [x, y, z + r * 0.54], color: b.pal.glow });
  b.nozzles.push([x, y, z + r * 1.1]);
  b.nozzleRadius = Math.max(b.nozzleRadius, r * 0.86);
}

/**
 * Engine housing from zf (front) to zb (back) with a nozzle bell behind it. Round nacelles and pods
 * carry a painted band, square housings a hazard band, flat ones light strips.
 */
export function engine(b: ShipBuilder, look: EngineLook, x: number, y: number, zf: number, zb: number, r: number): void {
  const p = b.pal;
  const len = zb - zf;
  const seg = b.seg;
  switch (look) {
    case 'round': {
      b.add('hull', latheZ([[0.001, 0], [r * 0.7, len * 0.05], [r * 0.95, len * 0.15], [r, len * 0.3], [r, len * 0.52]], seg), {
        position: [x, y, zf],
        color: p.hull,
      });
      b.add('hull', latheZ([[r, len * 0.52], [r, len * 0.62]], seg), { position: [x, y, zf], color: p.accent });
      b.add('hull', latheZ([[r, len * 0.62], [r, len * 0.9], [r * 0.9, len], [r * 0.9, len], [0.001, len]], seg), {
        position: [x, y, zf],
        color: p.hullDark,
      });
      break;
    }
    case 'capsule': {
      capsule(b, 'hull', [x, y, zf + len / 2], r, len, p.hull, seg);
      b.add('hull', latheZ([[r * 1.01, len * 0.4], [r * 1.01, len * 0.5]], seg), { position: [x, y, zf], color: p.panel });
      break;
    }
    case 'square': {
      const body = new Body({
        shape: 'block',
        stations: [
          { t: 0, w: 0.8, top: 0.8, bot: 0.8 },
          { t: 0.12, w: 1, top: 1, bot: 1 },
          { t: 1, w: 1, top: 1, bot: 1 },
        ],
        z0: zf,
        length: len,
        width: r * 1.12,
        top: r * 1.12,
        bottom: r * 1.12,
        x,
        y,
      });
      b.add('hull', body.geometry((t, band) => (band === 'cap' ? p.trim : t < 0.12 ? p.hullDark : t > 0.5 && t < 0.62 ? p.accent : p.hull)));
      break;
    }
    case 'flat': {
      const body = new Body({
        shape: 'blade',
        stations: [
          { t: 0, w: 0.1, top: 0.2, bot: 0.2 },
          { t: 0.3, w: 0.9, top: 0.9, bot: 0.9 },
          { t: 1, w: 1, top: 1, bot: 1 },
        ],
        z0: zf,
        length: len,
        width: r * 1.7,
        top: r * 1.12,
        bottom: r * 1.12,
        x,
        y,
      });
      b.add('hull', body.geometry((_t, band) => (band === 'cap' ? p.trim : band === 'shoulder' ? p.panel : p.hull)));
      b.glowBox([b.R * 0.01, b.R * 0.01, len * 0.6], [x + r * 1.72, y, zf + len * 0.55], p.strip);
      b.glowBox([b.R * 0.01, b.R * 0.01, len * 0.6], [x - r * 1.72, y, zf + len * 0.55], p.strip);
      break;
    }
  }
  bell(b, x, y, zb - r * 0.05, r * 0.82);
}

/* ------------------------------------------------------------------------------------------------
 * Weapons.
 * ---------------------------------------------------------------------------------------------- */

/** Open tube along Z between z0 and z1 (its ends sit inside other parts). */
function tube(b: ShipBuilder, key: string, x: number, y: number, z0: number, z1: number, r: number, color: THREE.ColorRepresentation): void {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), b.segThin, 1, true);
  g.rotateX(Math.PI / 2);
  b.add(key, g, { position: [x, y, (z0 + z1) / 2], color });
}

/** Gun barrel from the breech at z forward to z - len; registers the muzzle. */
export function gun(b: ShipBuilder, x: number, y: number, z: number, len: number, r: number, housing = true): void {
  const p = b.pal;
  if (housing) b.box('metal', [r * 3.4, r * 2.8, len * 0.46], [x, y, z + len * 0.12], p.trim);
  tube(b, 'metal', x, y, z, z - len * 0.99, r, p.metalDark);
  rod(b.kit, 'metal', [x, y, z - len * 0.8], [x, y, z - len * 0.97], r * 1.5, p.metal, b.segThin);
  rod(b.kit, 'emissive', [x, y, z - len], [x, y, z - len - r * 0.5], r * 0.75, p.glow.clone().multiplyScalar(0.8), b.segThin);
  b.muzzles.push([x, y, z - len - r * 0.5]);
}

/** Turret (dorsal up = 1, ventral up = -1) with a cluster of barrels facing forward. */
export function turret(b: ShipBuilder, x: number, y: number, z: number, barrels: number, r: number, up: number): void {
  const p = b.pal;
  const seg = b.seg;
  // Pedestal ring, painted collar, dome.
  b.add('metal', new THREE.CylinderGeometry(r * 1.02, r * 1.2, r * 0.4, seg), { position: [x, y + up * r * 0.18, z], color: p.metalDark });
  b.add('hull', new THREE.CylinderGeometry(r * 1.04, r * 1.04, r * 0.1, seg, 1, true), { position: [x, y + up * r * 0.36, z], color: p.accent });
  const dome = new THREE.LatheGeometry(
    [
      [r, 0],
      [r * 0.98, r * 0.26],
      [r * 0.82, r * 0.58],
      [r * 0.48, r * 0.8],
      [0.001, r * 0.86],
    ].map(([a, c]) => new THREE.Vector2(a, c)),
    seg,
  );
  b.add('hull', dome, { position: [x, y + up * r * 0.38, z], rotation: up > 0 ? [0, 0, 0] : [Math.PI, 0, 0], color: p.hullLight });
  const by = y + up * r * 0.72;
  const spread = r * 0.5;
  b.box('metal', [r * 0.9 + (barrels - 1) * spread, r * 0.66, r * 0.8], [x, by, z - r * 0.7], p.trim);
  for (let i = 0; i < barrels; i++) {
    gun(b, x + (i - (barrels - 1) / 2) * spread, by, z - r * 1.05, r * 2.9, r * 0.13, false);
  }
}

/** Launcher bay: a box pod whose front face carries a 2 x 2 rack of tube mouths with warheads. */
export function launcherBay(b: ShipBuilder, x: number, y: number, z: number, w: number, h: number, len: number): void {
  const p = b.pal;
  b.box('hull', [w, h, len], [x, y, z], p.panel);
  b.box('hull', [w * 1.03, h * 1.03, len * 0.12], [x, y, z - len * 0.28], p.accent);
  const tr = Math.min(w, h) * 0.17;
  const front = z - len / 2;
  const cone = new THREE.ConeGeometry(tr * 0.72, tr * 1.3, b.segThin + 2);
  cone.rotateX(-Math.PI / 2);
  for (const i of [-1, 1]) {
    for (const j of [-1, 1]) {
      const tx = x + i * w * 0.24;
      const ty = y + j * h * 0.24;
      rod(b.kit, 'metal', [tx, ty, front + len * 0.02], [tx, ty, front - tr * 0.5], tr * 1.3, p.metalDark, b.segThin + 2);
      const mouth = new THREE.CircleGeometry(tr, b.segThin + 2);
      mouth.rotateY(Math.PI);
      b.add('metal', mouth, { position: [tx, ty, front - tr * 0.52], color: p.hole });
      b.add('metal', cone.clone(), { position: [tx, ty, front - tr * 0.2], color: p.accent });
    }
  }
  cone.dispose();
}

/* ------------------------------------------------------------------------------------------------
 * Fins and wings.
 * ---------------------------------------------------------------------------------------------- */

/** Swept fin planform (height, z) of the given height and root chord starting at z. */
export function finPlanform(z: number, chord: number, height: number, rake = 0.55, tip = 0.35): Planform {
  return [
    [0, z],
    [0, z + chord],
    [height, z + chord * (rake + tip * 0.6)],
    [height, z + chord * rake],
  ];
}

/** Fin standing on the hull at (x, y), canted by `cant` radians (positive leans to +X). */
export function fin(b: ShipBuilder, pf: Planform, x: number, y: number, thickness: number, color: THREE.ColorRepresentation, cant = 0, down = false): void {
  b.add('hull', finGeometry(pf, thickness, thickness * 0.25), {
    position: [x, y, 0],
    rotation: [0, 0, down ? Math.PI + cant : -cant],
    color,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Sensors, cargo and greebles.
 * ---------------------------------------------------------------------------------------------- */

/** Parabolic dish facing `dir`, with a feed horn (and struts on refined models). */
export function dish(b: ShipBuilder, center: V3, radius: number, dir: THREE.Vector3, struts: boolean): void {
  const n = byQuality(b.quality, 4, 5, 7);
  const d = radius * 0.26;
  const th = radius * 0.05;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push([Math.max(0.001, radius * s), d * s * s - th]);
  }
  pts.push([radius, d - th]);
  for (let i = n; i >= 0; i--) {
    const s = i / n;
    pts.push([Math.max(0.001, radius * s), d * s * s]);
  }
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    b.segRing,
  );
  // Dishes take the lightest paint on the ship so they read against dark hulls.
  const face = luma(b.pal.panel) > luma(b.pal.hullLight) ? b.pal.panel : b.pal.hullLight;
  b.add('hull', g, { position: center, quaternion: q, color: face });
  const axis = dir.clone().normalize();
  const c = new THREE.Vector3(...center);
  const feed = c.clone().addScaledVector(axis, radius * 0.62);
  rod(b.kit, 'metal', center, [feed.x, feed.y, feed.z], radius * 0.035, b.pal.metal, b.segThin);
  b.add('metal', new THREE.BoxGeometry(radius * 0.12, radius * 0.12, radius * 0.12), {
    position: [feed.x, feed.y, feed.z],
    quaternion: q,
    color: b.pal.accent,
  });
  if (struts) {
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const w = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const rim = c
        .clone()
        .addScaledVector(axis, d)
        .addScaledVector(u, Math.cos(a) * radius * 0.96)
        .addScaledVector(w, Math.sin(a) * radius * 0.96);
      rod(b.kit, 'metal', [rim.x, rim.y, rim.z], [feed.x, feed.y, feed.z], radius * 0.018, b.pal.metal, 4);
    }
  }
}

/** Thin mast with a knuckle at the base and an optional blinking tip light. */
export function antenna(b: ShipBuilder, base: V3, tip: V3, r: number, light?: THREE.ColorRepresentation): void {
  rod(b.kit, 'metal', base, tip, r, b.pal.metal, Math.min(5, b.segThin));
  b.box('metal', [r * 3.2, r * 3.2, r * 3.2], base, b.pal.trim);
  if (light !== undefined) b.light(tip, light, 0.045, { blink: 0.6, duty: 0.25, min: 0.25, intensity: 1.1 });
}

/** Cargo container with slightly proud end frames. */
export function container(b: ShipBuilder, pos: V3, size: V3, color: THREE.ColorRepresentation): void {
  b.box('hull', size, pos, color);
  const [w, h, l] = size;
  for (const s of [-1, 1]) {
    b.box('metal', [w * 1.05, h * 1.05, l * 0.06], [pos[0], pos[1], pos[2] + s * l * 0.48], b.pal.trim);
  }
}

/** Emissive strip along the hull's widest line between t0 and t1 (both sides). */
export function chineStrips(b: ShipBuilder, hull: Hull, t0: number, t1: number, steps = 4): void {
  for (const side of [1, -1]) {
    let prev: V3 | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps;
      const s = hull.slice(t);
      const pt: V3 = [s.x + side * (s.w + b.R * 0.004), s.y + s.top * 0.02, hull.z(t)];
      if (prev) beam(b.kit, 'emissive', prev, pt, b.R * 0.009, b.pal.strip);
      prev = pt;
    }
  }
}

/** Plating boxes and vents scattered over the hull top (mirrored on symmetric hulls). */
export function greebles(b: ShipBuilder, hull: Hull, t0: number, t1: number, count: number, avoid: [number, number] | null = null): void {
  const r = b.rng('greebles');
  const n = Math.round(count * b.detail);
  // Clean makers get hatches in their own tones; heavily plated ones dark boxes and vents.
  const cols = b.greeble < 0.4 ? [b.pal.panel, b.pal.hullDark, b.pal.hullLight, b.pal.metal] : [b.pal.trim, b.pal.panelDark, b.pal.metal, b.pal.hullDark, b.pal.panel];
  for (let i = 0; i < n; i++) {
    const t = r.range(t0, t1);
    const u = r.range(0.14, 0.55);
    const w = r.range(0.035, 0.09) * b.R;
    const d = r.range(0.06, 0.2) * b.R;
    const h = r.range(0.015, 0.045) * b.R;
    const color = r.pick(cols);
    const flip = r.chance(0.5) ? 1 : -1;
    if (avoid && t > avoid[0] && t < avoid[1] && u < 0.5) continue;
    const s = hull.slice(t);
    const y = hull.topY(t, u) + h * 0.12;
    const z = hull.z(t);
    b.box('metal', [w, h, d], [s.x + flip * u * s.w, y, z], color);
    if (b.symmetric) b.box('metal', [w, h, d], [s.x - flip * u * s.w, y, z], color);
  }
}

/** Armour plates on the flanks between t0 and t1. */
export function flankPlates(b: ShipBuilder, hull: Hull, t0: number, t1: number, count: number, color: THREE.Color): void {
  const step = (t1 - t0) / count;
  for (let i = 0; i < count; i++) {
    const ta = t0 + step * i + step * 0.06;
    const tb = ta + step * 0.88;
    const tm = (ta + tb) / 2;
    const s = hull.slice(tm);
    const th = b.R * 0.018;
    const len = hull.z(tb) - hull.z(ta);
    const h = (s.top + s.bot) * 0.46;
    const y = s.y + (s.top - s.bot) * 0.2;
    for (const side of [1, -1]) {
      b.box('hull', [th, h, len], [s.x + side * (s.w + th * 0.3), y, hull.z(tm)], color);
    }
  }
}

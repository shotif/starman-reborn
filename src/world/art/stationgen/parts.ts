import * as THREE from 'three';
import { latheZ, rod } from '../kit.ts';
import type { Kit, V3 } from '../kit.ts';
import type { Rng } from '../shipgen/palette.ts';
import type { DockInfo, GenPart, StationGen } from './builder.ts';
import { addIn, annulus, band, boxIn, frameAt, lattice, subFrame, tp, windowBand, windowPlane } from './geom.ts';

/**
 * Station components shared by the archetypes: the docking bay (and a hangar block it can be set
 * into), plated blocks and pressurised modules with window rows, tanks, habitat rings, dishes,
 * solar wings and radiators, neon signs and light helpers. Every function paints with the
 * station palette and applies wear (grime, patches, missing plates, dead or flickering lights).
 */

const col = (c: THREE.ColorRepresentation): THREE.Color => new THREE.Color(c);

/* ------------------------------------------------------------------------------------------------
 * Lights.
 * ---------------------------------------------------------------------------------------------- */

export function beacon(b: StationGen, p: GenPart, pos: V3, color: string, size: number, blink = 0.6, phase = 0, essential = false): void {
  b.light(p, { p: pos, color, size, intensity: 2.2, blink, phase, duty: 0.14, min: 0.05 }, { essential });
}

/** Steady lamp (floodlight, window glow); `color` defaults to the star-tinted palette lamp. */
export function lamp(b: StationGen, p: GenPart, pos: V3, size: number, intensity = 1, color?: string): void {
  b.light(p, { p: pos, color: color ?? b.pal.lamp, size, intensity });
}

/** A row of small lights from a to b (running lights, string lights), optionally chasing. */
export function lightRow(
  b: StationGen,
  p: GenPart,
  a: V3,
  e: V3,
  n: number,
  colors: readonly THREE.ColorRepresentation[],
  size: number,
  chase = 0,
  intensity = 1.5,
): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const c = colors[i % colors.length]!;
    b.light(p, {
      p: [a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t, a[2] + (e[2] - a[2]) * t],
      color: c,
      size,
      intensity,
      ...(chase > 0 ? { blink: chase, phase: t * 0.8, duty: 0.25, min: 0.18 } : {}),
    });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Docking bay.
 * ---------------------------------------------------------------------------------------------- */

export interface BayStyle {
  /** Paint of the bay walls. */
  frame: THREE.Color;
  /** Hazard stripes along the mouth. */
  lip: [THREE.Color, THREE.Color];
  /** Mouth outline (HDR). */
  outline: THREE.Color;
  /** Ceiling strips (HDR). */
  ceiling: THREE.Color;
  /** Floor guide strip (HDR). */
  guide: THREE.Color;
  /** Chase lights along the approach booms. */
  chase: string;
  /** Approach booms with chase lights. */
  booms: boolean;
}

export function bayStyle(b: StationGen, overrides: Partial<BayStyle> = {}): BayStyle {
  const pal = b.pal;
  return {
    frame: pal.hull.clone(),
    lip: pal.hazard,
    outline: pal.bayGlow,
    ceiling: col(pal.lamp).multiplyScalar(1.15),
    guide: col('#5dffb0').multiplyScalar(0.9),
    chase: '#ffd27a',
    booms: true,
    ...overrides,
  };
}

/** Clearance between the bay mouth and the dock point. */
export function dockClearance(w: number): number {
  return Math.max(10, w * 0.35);
}

/**
 * Lit docking bay opening along +Z of `frame` (bay centred on the frame origin, mouth at
 * z = depth / 2). Registers the dock on the builder.
 */
export function dockBay(b: StationGen, p: GenPart, frame: THREE.Matrix4, w: number, h: number, depth: number, style: BayStyle): DockInfo {
  const k = p.kit;
  const t = Math.max(2, w * 0.09);
  const zf = depth / 2;
  const frameCol = style.frame;
  boxIn(k, frame, 'hull', [w + 2 * t, t, depth], [0, h / 2 + t / 2, 0], frameCol);
  boxIn(k, frame, 'hull', [w + 2 * t, t, depth], [0, -h / 2 - t / 2, 0], frameCol);
  boxIn(k, frame, 'hull', [t, h, depth], [w / 2 + t / 2, 0, 0], frameCol);
  boxIn(k, frame, 'hull', [t, h, depth], [-w / 2 - t / 2, 0, 0], frameCol);
  boxIn(k, frame, 'hull', [w, h, t], [0, 0, -zf + t / 2], b.pal.band);
  // Dark lining so the bay reads as a recess, warm ceiling strips, a floor guide and a lit door.
  boxIn(k, frame, 'dark', [w * 0.98, 0.4, depth * 0.96], [0, h / 2 - 0.15, 0], '#ffffff');
  boxIn(k, frame, 'dark', [w * 0.98, 0.4, depth * 0.96], [0, -h / 2 + 0.15, 0], '#ffffff');
  boxIn(k, frame, 'dark', [0.4, h * 0.98, depth * 0.96], [w / 2 - 0.15, 0, 0], '#ffffff');
  boxIn(k, frame, 'dark', [0.4, h * 0.98, depth * 0.96], [-w / 2 + 0.15, 0, 0], '#ffffff');
  for (const x of [-w * 0.28, w * 0.28]) boxIn(k, frame, 'emissive', [w * 0.08, 0.3, depth * 0.85], [x, h / 2 - 0.5, 0], style.ceiling);
  boxIn(k, frame, 'emissive', [w * 0.05, 0.2, depth * 0.9], [0, -h / 2 + 0.45, 0], style.guide);
  boxIn(k, frame, 'emissive', [w * 0.7, h * 0.05, 0.4], [0, 0, -zf + t + 0.3], style.outline, { intensity: 0.6 });
  boxIn(k, frame, 'emissive', [w * 0.03, h * 0.7, 0.4], [0, 0, -zf + t + 0.3], style.outline, { intensity: 0.45 });
  // Striped lip and bright outline around the mouth.
  const lip = t * 0.5;
  const n = Math.max(6, Math.round(w / 3));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 - t + ((i + 0.5) * (w + 2 * t)) / n;
    const c = style.lip[i % 2]!;
    boxIn(k, frame, 'hull', [(w + 2 * t) / n, lip, 0.8], [x, h / 2 + t - lip / 2, zf + 0.4], c);
    boxIn(k, frame, 'hull', [(w + 2 * t) / n, lip, 0.8], [x, -h / 2 - t + lip / 2, zf + 0.4], c);
  }
  const g = 0.35;
  boxIn(k, frame, 'emissive', [w, g, g], [0, h / 2 + 0.25, zf + 0.35], style.outline);
  boxIn(k, frame, 'emissive', [w, g, g], [0, -h / 2 - 0.25, zf + 0.35], style.outline);
  boxIn(k, frame, 'emissive', [g, h, g], [w / 2 + 0.25, 0, zf + 0.35], style.outline);
  boxIn(k, frame, 'emissive', [g, h, g], [-w / 2 - 0.25, 0, zf + 0.35], style.outline);
  // Approach booms with chase lights running towards the mouth.
  const boomLen = Math.max(24, depth * 1.2);
  if (style.booms) {
    for (const side of [-1, 1]) {
      const x = side * (w / 2 + t * 0.6);
      const y = -h / 2 - t * 0.6;
      rod(k, 'metal', tp(frame, [x, y, zf - 1]), tp(frame, [x, y, zf + boomLen]), Math.max(0.4, t * 0.16), b.pal.metal, 6);
      for (let i = 0; i < 6; i++) {
        const f = (i + 1) / 6;
        b.light(
          p,
          { p: tp(frame, [x, y + 0.7, zf + boomLen * f]), color: style.chase, size: Math.max(2, w * 0.09), intensity: 1.8, blink: 0.9, phase: f * 0.6, duty: 0.18, min: 0.12 },
          { essential: true },
        );
      }
      b.light(p, { p: tp(frame, [x, y + 0.7, zf + boomLen + 0.8]), color: side < 0 ? '#ff3020' : '#30ff70', size: Math.max(2.5, w * 0.12), intensity: 2 }, { essential: true });
    }
  }
  b.light(p, { p: tp(frame, [-w / 2 - t, 0, zf + 0.8]), color: '#ff3020', size: Math.max(2.5, w * 0.1), intensity: 1.8 }, { essential: true });
  b.light(p, { p: tp(frame, [w / 2 + t, 0, zf + 0.8]), color: '#30ff70', size: Math.max(2.5, w * 0.1), intensity: 1.8 }, { essential: true });
  b.light(p, { p: tp(frame, [0, h / 2 + t + 0.8, zf]), color: '#ffffff', size: Math.max(2.5, w * 0.1), intensity: 1.6, blink: 0.5, duty: 0.5, min: 0.4 }, { essential: true });
  // Soft interior glow, visible from far away.
  b.light(p, { p: tp(frame, [0, 0, zf - depth * 0.3]), color: b.pal.lamp, size: w * 0.7, intensity: 0.16 }, { essential: true });
  const point = new THREE.Vector3(0, 0, zf + dockClearance(w)).applyMatrix4(frame);
  const mouth = new THREE.Vector3(0, 0, zf).applyMatrix4(frame);
  const approach = new THREE.Vector3(0, 0, 1).transformDirection(frame).normalize();
  const dock: DockInfo = { point, approach, mouth, width: w, height: h, depth };
  b.dock = dock;
  return dock;
}

/** Bay proportions for a station of target radius R. */
export function baySize(R: number): { w: number; h: number; depth: number } {
  const w = Math.min(38, Math.max(30, 28 + R * 0.025));
  return { w, h: w * 0.58, depth: w * 0.8 };
}

/**
 * Hangar block with the docking bay set into its front face. `frame` sits at the centre of the
 * front face, +Z out of the bay; the block extends `size[2]` back along -Z.
 */
export function hangarBlock(b: StationGen, p: GenPart, frame: THREE.Matrix4, size: V3, color: THREE.Color, style: BayStyle, bay = baySize(b.R)): DockInfo {
  const k = p.kit;
  const [sx, sy, sz] = size;
  const { w, h, depth } = bay;
  const t = Math.max(2, w * 0.09);
  const hw = w / 2 + t;
  const hh = h / 2 + t;
  const d = depth + 0.6;
  const paint = b.paint(color);
  // Back of the block behind the bay, then four slabs around the bay tunnel.
  boxIn(k, frame, 'hull', [sx, sy, sz - d], [0, 0, -d - (sz - d) / 2], paint);
  boxIn(k, frame, 'hull', [sx, sy / 2 - hh, d], [0, (sy / 2 + hh) / 2, -d / 2], paint);
  boxIn(k, frame, 'hull', [sx, sy / 2 - hh, d], [0, -(sy / 2 + hh) / 2, -d / 2], paint);
  boxIn(k, frame, 'hull', [sx / 2 - hw, 2 * hh, d], [(sx / 2 + hw) / 2, 0, -d / 2], paint);
  boxIn(k, frame, 'hull', [sx / 2 - hw, 2 * hh, d], [-(sx / 2 + hw) / 2, 0, -d / 2], paint);
  // Frame band around the mouth so the bay reads from afar.
  boxIn(k, frame, 'hull', [2 * hw + 4, 1.6, 1.2], [0, hh + 0.8, 0.3], b.pal.trim);
  boxIn(k, frame, 'hull', [2 * hw + 4, 1.6, 1.2], [0, -hh - 0.8, 0.3], b.pal.trim);
  return dockBay(b, p, subFrame(frame, [0, 0, -depth / 2 + 0.3]), w, h, depth, style);
}

/* ------------------------------------------------------------------------------------------------
 * Blocks and modules.
 * ---------------------------------------------------------------------------------------------- */

export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** Frame on a face of a box of `size` (in `frame`): origin at the face centre, +Z out. */
export function faceFrame(frame: THREE.Matrix4, size: V3, face: Face): { f: THREE.Matrix4; w: number; h: number } {
  const [sx, sy, sz] = size;
  switch (face) {
    case '+x':
      return { f: subFrame(frame, [sx / 2, 0, 0], [0, Math.PI / 2, 0]), w: sz, h: sy };
    case '-x':
      return { f: subFrame(frame, [-sx / 2, 0, 0], [0, -Math.PI / 2, 0]), w: sz, h: sy };
    case '+y':
      return { f: subFrame(frame, [0, sy / 2, 0], [-Math.PI / 2, 0, 0]), w: sx, h: sz };
    case '-y':
      return { f: subFrame(frame, [0, -sy / 2, 0], [Math.PI / 2, 0, 0]), w: sx, h: sz };
    case '+z':
      return { f: subFrame(frame, [0, 0, sz / 2]), w: sx, h: sy };
    case '-z':
      return { f: subFrame(frame, [0, 0, -sz / 2], [0, Math.PI, 0]), w: sx, h: sy };
  }
}

/** Rows of windows on a face (strips stacked up the face). */
export function faceWindows(b: StationGen, p: GenPart, ff: { f: THREE.Matrix4; w: number; h: number }, rows: number, r: Rng, fill = 0.8): void {
  const ws = b.win;
  const stripH = rows * ws.row;
  const gap = ws.row * 1.2;
  const n = Math.max(1, Math.min(4, Math.floor((ff.h * 0.8 + gap) / (stripH + gap))));
  const total = n * stripH + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    // Worn stations have whole decks dark.
    if (b.wear > 0 && r.next() < b.wear * 0.45) continue;
    const y = -total / 2 + stripH / 2 + i * (stripH + gap);
    const w = ff.w * fill;
    addIn(p.kit, ff.f, 'windows', windowPlane(w, rows, ws, r.next(), r.int(0, 7)), { position: [0, y, 0.3], uv: 0 });
  }
}

const SOOT = new THREE.Color('#1e1a16');

/** Wear on a face: off-colour patches, missing plates (dark), dents and soot streaks. */
export function faceWear(b: StationGen, p: GenPart, ff: { f: THREE.Matrix4; w: number; h: number }, r: Rng): void {
  if (b.wear <= 0 || !b.room(300)) return;
  const area = ff.w * ff.h;
  const n = Math.min(9, Math.floor(b.wear * r.range(0.7, 1.3) * Math.sqrt(area) * 0.13));
  for (let i = 0; i < n; i++) {
    const pw = Math.min(ff.w * 0.45, r.range(4, 14));
    const ph = Math.min(ff.h * 0.45, r.range(4, 12));
    const x = r.range(-ff.w / 2 + pw / 2, ff.w / 2 - pw / 2);
    const y = r.range(-ff.h / 2 + ph / 2, ff.h / 2 - ph / 2);
    const tilt = (r.next() - 0.5) * 0.14 * b.wear;
    const kind = r.next();
    if (kind < 0.35) {
      // Missing plate: a dark hole.
      addIn(p.kit, ff.f, 'dark', new THREE.BoxGeometry(pw, ph, 0.8), { position: [x, y, 0.3] });
    } else if (kind < 0.55) {
      // Soot or rust streak running down from a vent or a leak.
      const sh = Math.min(ff.h * 0.8, ph * r.range(1.5, 3));
      const sy = Math.max(-ff.h / 2 + sh / 2, Math.min(ff.h / 2 - sh / 2, y - sh * 0.3));
      addIn(p.kit, ff.f, 'hull', new THREE.BoxGeometry(Math.max(1.2, pw * 0.3), sh, 0.8), { position: [x, sy, 0.4], color: SOOT.clone().lerp(b.pal.hullAlt, r.next() * 0.3) });
    } else {
      // A patch in whatever plating was at hand, slightly dented.
      const c = b.paint(r.pick(b.pal.patches), 0.15);
      addIn(p.kit, ff.f, 'hull', new THREE.BoxGeometry(pw, ph, 0.9), { position: [x, y, 0.45], rotation: [tilt, -tilt, tilt * 0.5], color: c });
    }
  }
}

export interface BlockStyle {
  color: THREE.Color;
  /** Belts around the block (default palette band colour); null for none. */
  band?: THREE.Color | null;
  /** Coloured stripe near the top; null for none. */
  trim?: THREE.Color | null;
  /** Window rows per strip (0 = none). */
  windows?: number;
  /** Faces that get windows. */
  windowFaces?: readonly Face[];
  /** Roof clutter density 0..1 (on +Y). */
  roof?: number;
  key?: string;
}

/** Plated box module in `frame` (centred), with belts, windows, roof clutter and wear. */
export function block(b: StationGen, p: GenPart, frame: THREE.Matrix4, size: V3, style: BlockStyle, r: Rng): void {
  const k = p.kit;
  const [sx, sy, sz] = size;
  const key = style.key ?? 'hull';
  boxIn(k, frame, key, size, [0, 0, 0], b.paint(style.color));
  const bandCol = style.band === undefined ? b.pal.band : style.band;
  if (bandCol && sy > 10) {
    const bh = Math.min(3, Math.max(1, sy * 0.05));
    const belts = sy > 36 ? 2 : 1;
    for (let i = 0; i < belts; i++) {
      const y = belts === 1 ? r.range(-0.15, 0.15) * sy : (i === 0 ? -0.22 : 0.22) * sy;
      boxIn(k, frame, 'metal', [sx + 0.8, bh, sz + 0.8], [0, y, 0], bandCol);
    }
  }
  if (style.trim && sy > 8) {
    const th = Math.min(2.5, Math.max(1, sy * 0.06));
    boxIn(k, frame, 'hull', [sx + 0.6, th, sz + 0.6], [0, sy / 2 - th * 1.6, 0], style.trim);
  }
  const rows = style.windows ?? 0;
  if (rows > 0) {
    for (const face of style.windowFaces ?? (['+x', '-x', '+z', '-z'] as const)) {
      const ff = faceFrame(frame, size, face);
      if (ff.w > 8 && ff.h > rows * b.win.row * 1.4) faceWindows(b, p, ff, rows, r);
    }
  }
  if (b.wear > 0) for (const face of ['+x', '-x', '+z', '+y'] as const) faceWear(b, p, faceFrame(frame, size, face), r);
  const roof = (style.roof ?? 0) * b.detail;
  if (roof > 0 && b.room(400)) {
    const top = faceFrame(frame, size, '+y');
    const n = Math.round(roof * Math.min(8, (sx * sz) / 250));
    for (let i = 0; i < n; i++) {
      const w = r.range(2, Math.min(10, sx * 0.3));
      const d = r.range(2, Math.min(10, sz * 0.3));
      const hgt = r.range(1.5, 5);
      const x = r.range(-sx / 2 + w / 2, sx / 2 - w / 2);
      const z = r.range(-sz / 2 + d / 2, sz / 2 - d / 2);
      if (r.next() < 0.3) {
        addIn(k, top.f, 'metal', new THREE.CylinderGeometry(w * 0.4, w * 0.4, hgt, b.segSmall), { position: [x, z, hgt / 2], rotation: [Math.PI / 2, 0, 0], color: b.pal.metal });
      } else {
        addIn(k, top.f, 'metal', new THREE.BoxGeometry(w, d, hgt), { position: [x, z, hgt / 2], color: r.next() < 0.5 ? b.pal.metal : b.pal.panel });
      }
    }
  }
}

/** Pressurised cylinder along +Z of `frame` from z = 0 to `length`, with window rows and bands. */
export function cylModule(
  b: StationGen,
  p: GenPart,
  frame: THREE.Matrix4,
  radius: number,
  length: number,
  color: THREE.Color,
  r: Rng,
  opts: { windows?: number; trim?: THREE.Color | null; capStart?: boolean; capEnd?: boolean } = {},
): void {
  const seg = b.seg;
  const k = p.kit;
  const e = Math.min(radius * 0.35, length * 0.2);
  const prof: [number, number][] = [];
  if (opts.capStart !== false) prof.push([0.001, 0], [radius * 0.62, 0]);
  else prof.push([radius, 0]);
  prof.push([radius, e], [radius, length - e]);
  if (opts.capEnd !== false) prof.push([radius * 0.62, length], [0.001, length]);
  else prof.push([radius, length]);
  addIn(k, frame, 'hull', latheZ(prof, seg), { color: b.paint(color) });
  for (const z of [e + radius * 0.12, length - e - radius * 0.12]) {
    addIn(k, frame, 'metal', band(radius + 0.5, z - radius * 0.1, z + radius * 0.1, seg, false, 8), { color: b.pal.band, uv: 0 });
  }
  if (opts.trim && length > radius * 2.5) {
    addIn(k, frame, 'hull', band(radius + 0.3, length * 0.5 - 1.2, length * 0.5 + 1.2, seg, false, 8), { color: opts.trim, uv: 0 });
  }
  const rows = opts.windows ?? 0;
  if (rows > 0 && length > radius * 1.5) {
    const span = length - 2 * e - radius * 0.6;
    const strip = rows * b.win.row;
    const n = Math.max(1, Math.min(3, Math.floor(span / (strip * 2.2))));
    for (let i = 0; i < n; i++) {
      if (b.wear > 0 && r.next() < b.wear * 0.45) continue;
      const zc = e + radius * 0.3 + (span * (i + 0.5)) / n;
      addIn(k, frame, 'windows', windowBand(radius + 0.35, zc, rows, b.win, seg, false, 0, Math.PI * 2, r.next(), r.int(0, 7)), { uv: 0 });
    }
  }
}

/** Spherical tank with a dark equator band. */
export function sphereTank(b: StationGen, p: GenPart, pos: V3, radius: number, color: THREE.Color): void {
  const seg = b.seg;
  p.kit.add('hull', new THREE.SphereGeometry(radius, seg, Math.max(6, seg >> 1)), { position: pos, color: b.paint(color) });
  p.kit.add('metal', new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, radius * 0.12, seg, 1, true), { position: pos, color: b.pal.band });
}

/** Capsule tank along an axis with two bands. */
export function capsuleTank(b: StationGen, p: GenPart, frame: THREE.Matrix4, radius: number, length: number, color: THREE.Color): void {
  const seg = b.seg;
  const h = Math.max(0, length - 2 * radius);
  addIn(p.kit, frame, 'hull', new THREE.CapsuleGeometry(radius, h, Math.max(2, seg >> 2), seg), { color: b.paint(color), rotation: [Math.PI / 2, 0, 0], position: [0, 0, length / 2] });
  for (const z of [length * 0.3, length * 0.7]) {
    addIn(p.kit, frame, 'metal', band(radius * 1.03, z - radius * 0.08, z + radius * 0.08, seg, false, 8), { color: b.pal.band, uv: 0 });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Rings (habitat, greenhouse, collars).
 * ---------------------------------------------------------------------------------------------- */

export interface RingStyle {
  outer: THREE.Color;
  inner: THREE.Color;
  sides: THREE.Color;
  /** Window rows on the outer face (0 = none). */
  windows: number;
  /** Stripe down the middle of the outer face. */
  trim?: THREE.Color | null;
  /** Structural ribs around the ring. */
  ribs: number;
  /** Emissive greenhouse panes instead of the outer hull (HDR colour). */
  panes?: THREE.Color;
}

/**
 * Rectangular-section ring around Z at z = zc: centre radius R, radial half-width hw, axial
 * half-depth hd.
 */
export function ring(b: StationGen, p: GenPart, R: number, hw: number, hd: number, zc: number, s: RingStyle, r: Rng): void {
  const k = p.kit;
  const seg = b.segRing;
  const ro = R + hw;
  const ri = R - hw;
  const uvs = Math.max(16, R * 0.1);
  if (s.panes) {
    // Greenhouse: glowing panes on the outer face and the sides, framed by mullions.
    k.add('emissive', band(ro, zc - hd, zc + hd, seg, false, 20), { uv: 0, color: s.panes });
    const mull = Math.max(24, Math.round(seg * 0.6));
    for (let i = 0; i < mull; i++) {
      const a = (i / mull) * Math.PI * 2;
      k.add('metal', new THREE.BoxGeometry(0.9, 1.2, hd * 2 + 0.6), { position: [Math.cos(a) * (ro + 0.3), Math.sin(a) * (ro + 0.3), zc], rotation: [0, 0, a], color: s.sides });
    }
    for (const z of [zc - hd * 0.34, zc + hd * 0.34]) {
      k.add('metal', band(ro + 0.35, z - 0.5, z + 0.5, seg, false, 8), { uv: 0, color: s.sides });
    }
  } else if (s.trim) {
    // Faction stripe round the outer face: separate strips, never a decal (no z-fighting far out).
    const st = Math.min(2.5, hd * 0.15);
    const outer = b.paint(s.outer, 0.03);
    k.add('hull', band(ro, zc - hd, zc - st, seg, false, uvs), { uv: 0, color: outer });
    k.add('hull', band(ro, zc - st, zc + st, seg, false, uvs), { uv: 0, color: s.trim });
    k.add('hull', band(ro, zc + st, zc + hd, seg, false, uvs), { uv: 0, color: outer });
  } else {
    k.add('hull', band(ro, zc - hd, zc + hd, seg, false, uvs), { uv: 0, color: b.paint(s.outer, 0.03) });
  }
  k.add('hull', band(ri, zc - hd, zc + hd, seg, true, uvs), { uv: 0, color: b.paint(s.inner, 0.03) });
  const sides = b.paint(s.sides, 0.03);
  if (s.panes) {
    // Greenhouse sides: a band of glowing panes between two structural rims, so the green reads
    // head-on too.
    const t0 = ri + (ro - ri) * 0.22;
    const t1 = ro - (ro - ri) * 0.3;
    const sideMull = Math.round(seg * 0.3);
    for (const [z, dir] of [[zc + hd, 1], [zc - hd, -1]] as const) {
      k.add('hull', annulus(ri, t0, z, seg, dir, uvs), { uv: 0, color: sides });
      k.add('emissive', annulus(t0, t1, z, seg, dir, uvs), { uv: 0, color: s.panes.clone().multiplyScalar(0.8) });
      k.add('hull', annulus(t1, ro, z, seg, dir, uvs), { uv: 0, color: s.trim ?? sides });
      for (let i = 0; i < sideMull; i++) {
        const a = (i / sideMull) * Math.PI * 2;
        const rm = (t0 + t1) / 2;
        k.add('metal', new THREE.BoxGeometry(t1 - t0, 0.9, 1), { position: [Math.cos(a) * rm, Math.sin(a) * rm, z + dir * 0.4], rotation: [0, 0, a], color: s.sides });
      }
    }
  } else if (s.trim) {
    // Stripes near the rim on both sides, again as their own strips.
    const tw = Math.max(1.5, hw * 0.28);
    const t0 = ro - tw * 1.6;
    const t1 = ro - tw * 0.6;
    for (const [z, dir] of [[zc + hd, 1], [zc - hd, -1]] as const) {
      k.add('hull', annulus(ri, t0, z, seg, dir, uvs), { uv: 0, color: sides });
      k.add('hull', annulus(t0, t1, z, seg, dir, uvs), { uv: 0, color: s.trim });
      k.add('hull', annulus(t1, ro, z, seg, dir, uvs), { uv: 0, color: sides });
    }
  } else {
    k.add('hull', annulus(ri, ro, zc + hd, seg, 1, uvs), { uv: 0, color: sides });
    k.add('hull', annulus(ri, ro, zc - hd, seg, -1, uvs), { uv: 0, color: sides });
  }
  if (s.windows > 0) {
    const ws = b.win;
    const strip = s.windows * ws.row;
    if (!s.panes && hd * 2 > strip * 2.6) {
      for (const z of [zc - hd * 0.5, zc + hd * 0.5]) {
        k.add('windows', windowBand(ro + 0.3, z, s.windows, ws, seg, false, 0, Math.PI * 2, r.next(), r.int(0, 7)), { uv: 0 });
      }
    } else if (!s.panes && hd * 2 > strip * 1.3) {
      k.add('windows', windowBand(ro + 0.3, zc, s.windows, ws, seg, false, 0, Math.PI * 2, r.next(), r.int(0, 7)), { uv: 0 });
    }
    if (hd * 2 > strip * 1.3) k.add('windows', windowBand(ri - 0.3, zc, s.windows, ws, seg, true, 0, Math.PI * 2, r.next(), r.int(0, 7)), { uv: 0 });
  }
  // Wear: dark holes (broken panes on greenhouses) and patches round the outer face.
  if (b.wear > 0) {
    const n = Math.round(b.wear * seg * 0.18);
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const w = r.range(6, 16);
      const h = Math.min(hd * 1.6, r.range(4, 10));
      const z = zc + r.range(-1, 1) * (hd - h / 2);
      const hole = r.next() < 0.5;
      k.add(hole ? 'dark' : 'hull', new THREE.BoxGeometry(0.9, w, h), {
        position: [Math.cos(a) * (ro + 0.4), Math.sin(a) * (ro + 0.4), z],
        rotation: [0, 0, a],
        ...(hole ? {} : { color: b.paint(r.pick(b.pal.patches), 0.15) }),
      });
    }
  }
  for (let i = 0; i < s.ribs; i++) {
    const a = (i / s.ribs) * Math.PI * 2;
    k.add('metal', new THREE.BoxGeometry(Math.max(2, hw * 0.25), hw * 2 + 1.6, hd * 2 + 1.6), {
      position: [Math.cos(a) * R, Math.sin(a) * R, zc],
      rotation: [0, 0, a],
      color: b.pal.metal,
    });
  }
}

/** Spokes from the hub (radius r0) to a ring (inner radius r1) in the plane z = zc. */
export function spokes(b: StationGen, p: GenPart, n: number, r0: number, r1: number, zc: number, thick: number, phase: number, pods = true): void {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    rod(p.kit, 'metal', [c * r0, s * r0, zc], [c * r1, s * r1, zc], thick, b.pal.metal, b.segSmall + 2);
    if (pods) {
      const m = (r0 + r1) * 0.5;
      p.kit.add('hull', new THREE.BoxGeometry(thick * 2.6, thick * 2.6, thick * 2.6), { position: [c * m, s * m, zc], rotation: [0, 0, a], color: b.pal.hull });
      p.kit.add('emissive', new THREE.BoxGeometry(thick * 2.7, thick * 0.5, thick * 2.7), { position: [c * m, s * m, zc], rotation: [0, 0, a], color: col(b.pal.lamp).multiplyScalar(1.5) });
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Machinery.
 * ---------------------------------------------------------------------------------------------- */

/** Parabolic dish facing +Z of `frame`, feed struts included (all into `kit`). */
export function dish(b: StationGen, kit: Kit, frame: THREE.Matrix4, radius: number, depth: number, color: THREE.Color, seg = b.seg + 4): void {
  const prof: [number, number][] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const rr = (i / n) * radius;
    prof.push([Math.max(rr, 0.001), depth * (rr / radius) ** 2]);
  }
  addIn(kit, frame, 'hull', latheZ(prof.slice().reverse(), seg), { color });
  addIn(kit, frame, 'metal', latheZ(prof.map(([rr, z]) => [rr, z - depth * 0.08] as [number, number]), seg), { color: b.pal.metal });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    rod(kit, 'metal', tp(frame, [Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.92, depth * 0.95]), tp(frame, [0, 0, radius * 0.75]), radius * 0.022, b.pal.metal, 5);
  }
  addIn(kit, frame, 'metal', new THREE.CylinderGeometry(radius * 0.08, radius * 0.1, radius * 0.2, 8), {
    position: [0, 0, radius * 0.78],
    rotation: [Math.PI / 2, 0, 0],
    color: b.pal.metalDark,
  });
}

/** Solar wing along +X of `frame`: a boom and a row of cell panels. */
export function solarWing(b: StationGen, p: GenPart, frame: THREE.Matrix4, length: number, width: number, panels: number): void {
  const gap = length * 0.03;
  const pl = (length - gap * (panels + 1)) / panels;
  const k = p.kit;
  addIn(k, frame, 'metal', new THREE.BoxGeometry(length, Math.max(1, width * 0.05), Math.max(1, width * 0.05)), { position: [length / 2, 0, 0], color: b.pal.metal });
  for (let i = 0; i < panels; i++) {
    const x = gap + pl / 2 + i * (pl + gap);
    addIn(k, frame, 'solar', new THREE.BoxGeometry(pl, 0.5, width), { position: [x, 0, 0], uv: Math.max(4, width / 4) });
  }
}

/** Radiator panel in the XZ plane of `frame`, extending along +X, framed by a metal edge. */
export function radiator(b: StationGen, p: GenPart, frame: THREE.Matrix4, length: number, width: number): void {
  addIn(p.kit, frame, 'radiator', new THREE.BoxGeometry(length, 0.7, width), { position: [length / 2, 0, 0], uv: Math.max(8, width / 2.5) });
  addIn(p.kit, frame, 'metal', new THREE.BoxGeometry(length, 1.2, 1.2), { position: [length / 2, 0, width / 2], color: b.pal.metalDark });
  addIn(p.kit, frame, 'metal', new THREE.BoxGeometry(length, 1.2, 1.2), { position: [length / 2, 0, -width / 2], color: b.pal.metalDark });
}

/**
 * Neon sign on a board facing +Z of `frame`: glyph-like strokes (no real script) with a tube
 * outline and a soft halo.
 */
export function neonSign(b: StationGen, p: GenPart, frame: THREE.Matrix4, w: number, h: number, color: THREE.Color, r: Rng, outline?: THREE.Color): void {
  const k = p.kit;
  addIn(k, frame, 'hull', new THREE.BoxGeometry(w, h, 1.2), { color: b.pal.metalDark });
  const edge = Math.max(0.35, h * 0.05);
  const oc = outline ?? color;
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w, edge, 0.5), { position: [0, h / 2 - edge, 0.7], color: oc });
  addIn(k, frame, 'emissive', new THREE.BoxGeometry(w, edge, 0.5), { position: [0, -h / 2 + edge, 0.7], color: oc });
  const glyphs = Math.max(2, Math.min(7, Math.floor(w / (h * 0.62))));
  const gw = (w * 0.86) / glyphs;
  const gh = h * 0.56;
  const s = Math.max(0.3, gh * 0.13);
  // Stroke set of a 7-segment cell plus two diagonals; each glyph lights a random subset.
  for (let i = 0; i < glyphs; i++) {
    const cx = -w * 0.43 + gw * (i + 0.5);
    const cw = gw * 0.62;
    const segs: [number, number, number, number, number][] = [
      [0, gh / 2, cw, s, 0],
      [0, 0, cw, s, 0],
      [0, -gh / 2, cw, s, 0],
      [-cw / 2, gh / 4, s, gh / 2, 0],
      [cw / 2, gh / 4, s, gh / 2, 0],
      [-cw / 2, -gh / 4, s, gh / 2, 0],
      [cw / 2, -gh / 4, s, gh / 2, 0],
      [0, gh / 4, s, gh * 0.58, 0.6],
      [0, -gh / 4, s, gh * 0.58, -0.6],
    ];
    let lit = 0;
    for (let j = 0; j < segs.length; j++) {
      const on = j < 7 ? r.next() < 0.55 : r.next() < 0.18;
      if (!on && !(j === 6 && lit < 2)) continue;
      lit++;
      const [x, y, sw, sh, rot] = segs[j]!;
      addIn(k, frame, 'emissive', new THREE.BoxGeometry(sw, sh, 0.5), { position: [cx + x, y, 0.75], rotation: [0, 0, rot], color });
    }
  }
  b.light(p, { p: tp(frame, [0, 0, 3]), color: `#${color.clone().multiplyScalar(0.45).getHexString()}`, size: w * 0.9, intensity: 0.35 });
}

/** Simple parked ship facing +Z of `frame` (nose along +Z), `len` long. */
export function parkedShip(b: StationGen, p: GenPart, frame: THREE.Matrix4, len: number, color: THREE.Color, r: Rng): void {
  const k = p.kit;
  const w = len * r.range(0.22, 0.32);
  const h = len * r.range(0.16, 0.22);
  addIn(k, frame, 'hull', new THREE.BoxGeometry(w, h, len * 0.62), { position: [0, 0, -len * 0.05], color: b.paint(color) });
  addIn(k, frame, 'hull', new THREE.ConeGeometry(w * 0.62, len * 0.3, 4), { position: [0, 0, len * 0.4], rotation: [Math.PI / 2, Math.PI / 4, 0], scale: [1, 1, h / w + 0.35], color: b.paint(color) });
  addIn(k, frame, 'hull', new THREE.BoxGeometry(len * r.range(0.55, 0.9), h * 0.18, len * 0.22), { position: [0, -h * 0.2, -len * 0.18], color: b.pal.panel });
  addIn(k, frame, 'metal', new THREE.BoxGeometry(w * 0.7, h * 0.7, len * 0.12), { position: [0, 0, -len * 0.4], color: b.pal.metalDark });
  b.light(p, { p: tp(frame, [0, 0, -len * 0.48]), color: '#8fd8ff', size: w * 0.8, intensity: 0.9 });
}

/** Turret for an instanced mover: base ring, housing and twin barrels along +Z (one geometry). */
export function turretGeometry(b: StationGen, size: number, color: THREE.Color): THREE.BufferGeometry {
  return b.moverGeometry((kit, key) => {
    kit.add(key, new THREE.CylinderGeometry(size * 0.55, size * 0.65, size * 0.3, b.segSmall + 2), { position: [0, size * 0.15, 0], color: b.pal.metalDark });
    kit.add(key, new THREE.BoxGeometry(size * 0.8, size * 0.42, size * 0.9), { position: [0, size * 0.48, 0], color });
    kit.add(key, new THREE.BoxGeometry(size * 0.84, size * 0.08, size * 0.5), { position: [0, size * 0.62, -size * 0.1], color: b.pal.trim });
    for (const x of [-size * 0.18, size * 0.18]) {
      kit.add(key, new THREE.CylinderGeometry(size * 0.06, size * 0.07, size * 1.1, 6), { position: [x, size * 0.5, size * 0.85], rotation: [Math.PI / 2, 0, 0], color: b.pal.metal });
    }
  });
}

/** Lattice mast from a to e with a beacon at the tip. */
export function antenna(b: StationGen, p: GenPart, a: V3, e: V3, r: number, color: string, blink = 0.55, phase = 0): void {
  rod(p.kit, 'metal', a, e, r, b.pal.metal, 5);
  beacon(b, p, e, color, Math.max(3, r * 6), blink, phase);
}

/** Cross-arm with dipole elements, perpendicular to `dir`, at `pos`. */
export function crossArm(b: StationGen, p: GenPart, pos: V3, span: number, dir: V3, r: number): void {
  const f = frameAt(pos, dir);
  rod(p.kit, 'metal', tp(f, [-span / 2, 0, 0]), tp(f, [span / 2, 0, 0]), r, b.pal.metal, 5);
  for (const x of [-span / 2, span / 2]) rod(p.kit, 'metal', tp(f, [x, -span * 0.12, 0]), tp(f, [x, span * 0.12, 0]), r * 0.7, b.pal.metal, 4);
}

/** Lattice truss whose bay count follows the quality. */
export function truss(b: StationGen, p: GenPart, a: V3, e: V3, width: number, color: THREE.Color = b.pal.metal): void {
  const bayLen = width * (b.quality === 'low' ? 2.4 : b.quality === 'medium' ? 1.7 : 1.25);
  lattice(p.kit, 'metal', a, e, width, color, bayLen, Math.max(0.35, width * 0.09));
}

/** Closed hangar door on a face (`frame` at the door centre, +Z out of the face). */
export function hangarDoor(b: StationGen, p: GenPart, frame: THREE.Matrix4, w: number, h: number, r: Rng): void {
  const k = p.kit;
  const e = Math.max(1.2, w * 0.06);
  boxIn(k, frame, 'hull', [w + 2 * e, e, 1.6], [0, h / 2 + e / 2, 0.4], b.pal.metalDark);
  boxIn(k, frame, 'hull', [w + 2 * e, e, 1.6], [0, -h / 2 - e / 2, 0.4], b.pal.metalDark);
  boxIn(k, frame, 'hull', [e, h, 1.6], [w / 2 + e / 2, 0, 0.4], b.pal.metalDark);
  boxIn(k, frame, 'hull', [e, h, 1.6], [-w / 2 - e / 2, 0, 0.4], b.pal.metalDark);
  const leaves = w > 24 ? 3 : 2;
  for (let i = 0; i < leaves; i++) {
    const lw = w / leaves;
    boxIn(k, frame, 'hull', [lw - 0.5, h - 0.4, 0.8], [-w / 2 + lw * (i + 0.5), 0, 0.2], b.paint(b.pal.panel, 0.08));
  }
  const stripes = Math.max(2, Math.round(h / 8));
  for (let i = 0; i < stripes; i++) {
    const y = -h / 2 + (h * (i + 0.5)) / stripes;
    if (i % 2 === 0) boxIn(k, frame, 'hull', [w - 0.6, Math.min(2.2, h * 0.08), 1], [0, y, 0.35], b.pal.trim);
  }
  boxIn(k, frame, 'emissive', [w * 0.9, 0.4, 0.5], [0, h / 2 + e + 0.3, 0.6], col(b.pal.lamp).multiplyScalar(1.3));
  for (const s of [-1, 1]) b.light(p, { p: tp(frame, [s * (w / 2 + e), h / 2 + e, 1.5]), color: '#ffb640', size: Math.max(2.5, w * 0.08), intensity: 1.6, blink: 0.5, phase: r.next(), duty: 0.3, min: 0.2 });
}

/**
 * Scanner gate around the approach: a chamfered frame (opening w x h) in the XY plane of `frame`,
 * glowing scanner strips inside, chase lights round the rim. `index` staggers the chase so pulses
 * run towards the bay.
 */
export function scannerGate(b: StationGen, p: GenPart, frame: THREE.Matrix4, w: number, h: number, thick: number, index: number): void {
  const k = p.kit;
  const c = Math.min(w, h) * 0.2;
  const d = thick * 1.3;
  const hull = b.paint(b.pal.hull);
  const rim: [V3, V3][] = [
    [[-w / 2 + c, h / 2 + thick / 2, 0], [w / 2 - c, h / 2 + thick / 2, 0]],
    [[w / 2 - c, h / 2 + thick / 2, 0], [w / 2 + thick / 2, h / 2 - c, 0]],
    [[w / 2 + thick / 2, h / 2 - c, 0], [w / 2 + thick / 2, -h / 2 + c, 0]],
    [[w / 2 + thick / 2, -h / 2 + c, 0], [w / 2 - c, -h / 2 - thick / 2, 0]],
    [[w / 2 - c, -h / 2 - thick / 2, 0], [-w / 2 + c, -h / 2 - thick / 2, 0]],
    [[-w / 2 + c, -h / 2 - thick / 2, 0], [-w / 2 - thick / 2, -h / 2 + c, 0]],
    [[-w / 2 - thick / 2, -h / 2 + c, 0], [-w / 2 - thick / 2, h / 2 - c, 0]],
    [[-w / 2 - thick / 2, h / 2 - c, 0], [-w / 2 + c, h / 2 + thick / 2, 0]],
  ];
  for (let i = 0; i < rim.length; i++) {
    const [a, e] = rim[i]!;
    const mid: V3 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2, 0];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]) + thick * 0.8;
    const ang = Math.atan2(e[1] - a[1], e[0] - a[0]);
    boxIn(k, frame, 'hull', [len, thick, d], mid, i % 2 ? b.pal.trim : hull, { rotation: [0, 0, ang] });
    // Scanner strip on the inner edge of the straight members.
    if (i % 2 === 0) {
      const inward: V3 = [-Math.sin(ang), Math.cos(ang), 0];
      const s = mid[0] * inward[0] + mid[1] * inward[1] > 0 ? -1 : 1;
      boxIn(k, frame, 'emissive', [len - thick * 2, 0.5, d * 0.35], [mid[0] + inward[0] * s * (thick / 2 + 0.2), mid[1] + inward[1] * s * (thick / 2 + 0.2), 0], b.pal.glow, {
        rotation: [0, 0, ang],
        intensity: 0.7,
      });
    }
    b.light(p, { p: tp(frame, [a[0] * 1.02, a[1] * 1.02, d / 2 + 0.8]), color: i % 2 ? '#ffb640' : b.pal.lamp, size: Math.max(3, thick * 0.9), intensity: 1.8, blink: 0.6, phase: i / 8 + index * 0.18, duty: 0.2, min: 0.15 }, { essential: true });
  }
}

/** Rotating beacon head for an instanced mover: base, housing with lens band and a scanner bar. */
export function beaconHeadGeometry(b: StationGen, size: number): THREE.BufferGeometry {
  return b.moverGeometry((kit, key) => {
    kit.add(key, new THREE.CylinderGeometry(size * 0.45, size * 0.55, size * 0.5, b.segSmall + 2), { position: [0, size * 0.25, 0], color: b.pal.hull });
    kit.add(key, new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.25, b.segSmall + 2), { position: [0, size * 0.62, 0], color: b.pal.trim });
    kit.add(key, new THREE.BoxGeometry(size * 1.9, size * 0.14, size * 0.3), { position: [0, size * 0.85, 0], color: b.pal.metal });
    kit.add(key, new THREE.BoxGeometry(size * 0.3, size * 0.5, size * 0.3), { position: [size * 0.9, size * 1.05, 0], color: b.pal.hullAlt });
  });
}

/** Row of shipping containers along +X of `frame`, stacked `tiers` high. */
export function containers(b: StationGen, p: GenPart, frame: THREE.Matrix4, count: number, tiers: number, r: Rng, size: V3 = [12, 2.8, 2.8]): void {
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < tiers; j++) {
      if (r.next() < 0.18 + b.wear * 0.2) continue;
      addIn(p.kit, frame, 'hull', new THREE.BoxGeometry(size[0], size[1], size[2]), {
        position: [i * (size[0] + 0.6), j * (size[1] + 0.2), 0],
        color: b.paint(r.pick(b.pal.cargo), 0.12),
        uv: 4,
      });
    }
  }
}

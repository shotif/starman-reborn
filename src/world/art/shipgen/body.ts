import type * as THREE from 'three';
import { loft } from '../kit.ts';
import type { LoftSection } from '../kit.ts';

/**
 * Lofted fuselage bodies. A body is a list of stations along the ship's length, each scaling one
 * cross-section outline; every outline has the same twelve points, so strips of faces line up
 * from nose to tail and can be painted by band (top, shoulder, flank, ...). Parts are placed on
 * the hull through the surface lookups (topY, botY, sideX).
 */

export type HullShape = 'wedge' | 'blade' | 'block' | 'pod' | 'ring';

/** Right half of each outline, top centre to bottom centre, in units of (half-width, top | bottom). */
const OUTLINE: Record<HullShape, readonly (readonly [number, number])[]> = {
  // Arrowhead: gently domed top, sharp side chine, flat belly.
  wedge: [[0, 1], [0.45, 0.92], [0.85, 0.45], [1, 0.05], [0.8, -0.55], [0.35, -1], [0, -1]],
  // Flattened diamond with knife-edge chines.
  blade: [[0, 1], [0.3, 0.88], [0.72, 0.36], [1, 0], [0.72, -0.36], [0.3, -0.88], [0, -1]],
  // Slab sides with chamfered edges.
  block: [[0, 1], [0.76, 1], [1, 0.74], [1, 0], [1, -0.74], [0.76, -1], [0, -1]],
  // Ellipse.
  pod: [[0, 1], [0.5, 0.87], [0.87, 0.5], [1, 0], [0.87, -0.5], [0.5, -0.87], [0, -1]],
  // Octagonal spine.
  ring: [[0, 1], [0.44, 1], [1, 0.44], [1, 0], [1, -0.44], [0.44, -1], [0, -1]],
};

/** Which strip of the outline an edge (0..11, right side first) belongs to. */
export type Band = 'top' | 'shoulder' | 'flank' | 'lowerFlank' | 'lowerShoulder' | 'belly' | 'cap';

const BANDS: readonly Band[] = ['top', 'shoulder', 'flank', 'lowerFlank', 'lowerShoulder', 'belly'];

/** Paints one face strip: `t` is the strip's middle along the ship, `side` +1 right / -1 left. */
export type Painter = (t: number, band: Band, side: number, strip: number) => THREE.Color;

export interface Station {
  /** Fraction of the ship's length from the nose (0) to the tail (1). */
  t: number;
  w: number;
  top: number;
  bot: number;
}

export interface Slice {
  z: number;
  x: number;
  y: number;
  w: number;
  top: number;
  bot: number;
}

/**
 * Stations of a full-length fuselage for each outline (multipliers of width, top and bottom).
 * Close pairs of stations make thin strips for painted bands (see TRIM_STRIPS).
 */
export const FUSELAGE: Record<HullShape, readonly Station[]> = {
  wedge: [
    { t: 0, w: 0.05, top: 0.1, bot: 0.1 },
    { t: 0.08, w: 0.32, top: 0.34, bot: 0.36 },
    { t: 0.2, w: 0.58, top: 0.64, bot: 0.62 },
    { t: 0.36, w: 0.8, top: 0.9, bot: 0.84 },
    { t: 0.52, w: 0.94, top: 1, bot: 0.96 },
    { t: 0.68, w: 1, top: 0.96, bot: 1 },
    { t: 0.84, w: 0.97, top: 0.86, bot: 0.94 },
    { t: 0.95, w: 0.88, top: 0.74, bot: 0.84 },
    { t: 1, w: 0.8, top: 0.64, bot: 0.76 },
  ],
  blade: [
    { t: 0, w: 0.03, top: 0.08, bot: 0.08 },
    { t: 0.12, w: 0.26, top: 0.34, bot: 0.3 },
    { t: 0.28, w: 0.5, top: 0.62, bot: 0.55 },
    { t: 0.45, w: 0.74, top: 0.86, bot: 0.78 },
    { t: 0.62, w: 0.92, top: 1, bot: 0.92 },
    { t: 0.78, w: 1, top: 0.98, bot: 0.95 },
    { t: 0.92, w: 0.98, top: 0.86, bot: 0.86 },
    { t: 1, w: 0.88, top: 0.72, bot: 0.74 },
  ],
  block: [
    { t: 0, w: 0.56, top: 0.4, bot: 0.52 },
    { t: 0.05, w: 0.78, top: 0.64, bot: 0.74 },
    { t: 0.14, w: 0.94, top: 0.86, bot: 0.92 },
    { t: 0.165, w: 0.955, top: 0.885, bot: 0.935 },
    { t: 0.3, w: 1, top: 1, bot: 1 },
    { t: 0.55, w: 1, top: 1, bot: 1 },
    { t: 0.8, w: 1, top: 0.98, bot: 1 },
    { t: 0.83, w: 0.995, top: 0.975, bot: 0.995 },
    { t: 0.94, w: 0.95, top: 0.92, bot: 0.95 },
    { t: 1, w: 0.9, top: 0.86, bot: 0.9 },
  ],
  pod: [
    { t: 0, w: 0.16, top: 0.16, bot: 0.16 },
    { t: 0.04, w: 0.5, top: 0.5, bot: 0.5 },
    { t: 0.1, w: 0.74, top: 0.74, bot: 0.74 },
    { t: 0.2, w: 0.9, top: 0.92, bot: 0.9 },
    { t: 0.34, w: 0.99, top: 1, bot: 0.98 },
    { t: 0.37, w: 0.995, top: 1, bot: 0.99 },
    { t: 0.52, w: 1, top: 1, bot: 1 },
    { t: 0.7, w: 0.95, top: 0.94, bot: 0.96 },
    { t: 0.85, w: 0.82, top: 0.8, bot: 0.84 },
    { t: 0.95, w: 0.64, top: 0.62, bot: 0.66 },
    { t: 1, w: 0.5, top: 0.48, bot: 0.52 },
  ],
  ring: [
    { t: 0, w: 0.4, top: 0.36, bot: 0.4 },
    { t: 0.05, w: 0.72, top: 0.7, bot: 0.72 },
    { t: 0.14, w: 0.95, top: 0.96, bot: 0.95 },
    { t: 0.26, w: 1, top: 1, bot: 1 },
    { t: 0.285, w: 0.99, top: 0.99, bot: 0.99 },
    { t: 0.36, w: 0.88, top: 0.86, bot: 0.88 },
    { t: 0.44, w: 0.62, top: 0.6, bot: 0.62 },
    { t: 0.75, w: 0.6, top: 0.58, bot: 0.6 },
    { t: 0.9, w: 0.66, top: 0.64, bot: 0.66 },
    { t: 0.93, w: 0.67, top: 0.65, bot: 0.67 },
    { t: 1, w: 0.7, top: 0.66, bot: 0.7 },
  ],
};

/** Thin strips of each fuselage table that carry the maker's painted trim bands. */
export const TRIM_STRIPS: Partial<Record<HullShape, readonly number[]>> = {
  block: [2, 6],
  pod: [4],
  ring: [3, 8],
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Interpolated outline height (in units of top or bottom) at lateral fraction `u` of the half-width. */
function outlineY(shape: HullShape, u: number, upper: boolean): number {
  const o = OUTLINE[shape];
  const seq = upper ? [o[0]!, o[1]!, o[2]!, o[3]!] : [o[6]!, o[5]!, o[4]!, o[3]!];
  const x = clamp01(u);
  for (let i = 0; i + 1 < seq.length; i++) {
    const [x0, y0] = seq[i]!;
    const [x1, y1] = seq[i + 1]!;
    if (x <= x1 || i + 2 === seq.length) {
      const k = x1 > x0 ? clamp01((x - x0) / (x1 - x0)) : 1;
      return y0 + (y1 - y0) * k;
    }
  }
  return 0;
}

export interface BodySpec {
  shape: HullShape;
  stations: readonly Station[];
  /** Nose z and length of the ship the stations' t refer to. */
  z0: number;
  length: number;
  width: number;
  top: number;
  bottom: number;
  /** Centreline offset (spliced sections sit off-axis). */
  x?: number;
  y?: number;
}

export class Body {
  readonly shape: HullShape;
  readonly z0: number;
  readonly length: number;
  readonly t0: number;
  readonly t1: number;
  private readonly spec: BodySpec;

  constructor(spec: BodySpec) {
    this.spec = spec;
    this.shape = spec.shape;
    this.z0 = spec.z0;
    this.length = spec.length;
    this.t0 = spec.stations[0]!.t;
    this.t1 = spec.stations[spec.stations.length - 1]!.t;
  }

  z(t: number): number {
    return this.z0 + t * this.length;
  }

  slice(t: number): Slice {
    const st = this.spec.stations;
    let i = 0;
    while (i + 2 < st.length && st[i + 1]!.t < t) i++;
    const a = st[i]!;
    const b = st[Math.min(i + 1, st.length - 1)]!;
    const k = b.t > a.t ? clamp01((t - a.t) / (b.t - a.t)) : 0;
    const s = this.spec;
    return {
      z: this.z(t),
      x: s.x ?? 0,
      y: s.y ?? 0,
      w: (a.w + (b.w - a.w) * k) * s.width,
      top: (a.top + (b.top - a.top) * k) * s.top,
      bot: (a.bot + (b.bot - a.bot) * k) * s.bottom,
    };
  }

  topY(t: number, u = 0): number {
    const s = this.slice(t);
    return s.y + s.top * outlineY(this.shape, u, true);
  }

  botY(t: number, u = 0): number {
    const s = this.slice(t);
    return s.y + s.bot * outlineY(this.shape, u, false);
  }

  /** Cross-section outline (12 points) at a station. */
  outline(s: Slice): [number, number][] {
    const o = OUTLINE[this.shape];
    const right = o.map(([nx, ny]) => [nx * s.w, ny >= 0 ? ny * s.top : ny * s.bot] as [number, number]);
    const pts: [number, number][] = [...right];
    for (let i = right.length - 2; i >= 1; i--) pts.push([-right[i]![0], right[i]![1]]);
    return pts.map(([x, y]) => [x + s.x, y + s.y]);
  }

  geometry(paint: Painter): THREE.BufferGeometry {
    const st = this.spec.stations;
    const sections: LoftSection[] = st.map((s) => ({ z: this.z(s.t), pts: this.outline(this.slice(s.t)) }));
    return loft(sections, {
      capStart: true,
      capEnd: true,
      faceColor: (seg, edge) => {
        const i = Math.max(0, Math.min(st.length - 2, seg));
        const tm = (st[i]!.t + st[i + 1]!.t) / 2;
        if (edge < 0) return paint(seg < 0 ? st[0]!.t : st[st.length - 1]!.t, 'cap', 1, seg);
        return paint(tm, BANDS[edge < 6 ? edge : 11 - edge]!, edge < 6 ? 1 : -1, i);
      },
    });
  }
}

/** One or more bodies along the ship (spliced hulls have several), with surface lookups. */
export class Hull {
  readonly bodies: readonly Body[];
  readonly z0: number;
  readonly length: number;

  constructor(bodies: readonly Body[]) {
    this.bodies = bodies;
    this.z0 = bodies[0]!.z0;
    this.length = bodies[0]!.length;
  }

  z(t: number): number {
    return this.z0 + t * this.length;
  }

  /** Fraction along the ship at z. */
  t(z: number): number {
    return (z - this.z0) / this.length;
  }

  body(t: number): Body {
    for (const b of this.bodies) if (t >= b.t0 && t <= b.t1) return b;
    let best = this.bodies[0]!;
    let dist = Infinity;
    for (const b of this.bodies) {
      const d = Math.min(Math.abs(t - b.t0), Math.abs(t - b.t1));
      if (d < dist) {
        dist = d;
        best = b;
      }
    }
    return best;
  }

  slice(t: number): Slice {
    return this.body(t).slice(t);
  }

  topY(t: number, u = 0): number {
    return this.body(t).topY(t, u);
  }

  botY(t: number, u = 0): number {
    return this.body(t).botY(t, u);
  }

  /** x of the widest point on the right (+1) or left (-1) side. */
  sideX(t: number, side = 1): number {
    const s = this.slice(t);
    return s.x + side * s.w;
  }
}

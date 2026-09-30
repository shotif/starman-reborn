import * as THREE from 'three';
import type { QualityLevel } from '../art/types.ts';
import { markShared, seededRandom } from '../art/util.ts';

/**
 * Procedural textures for the station interiors, rasterised straight into pixel buffers
 * (DataTexture): no canvas, no GPU read-backs, deterministic, and cheap enough to build on a phone.
 * The tileable surface textures are neutral grey (vertex colours tint them per station) and cached
 * per quality like the shared art textures; only the environment cube is owned by an interior.
 */

const cache = new Map<string, THREE.Texture>();

function sizeFor(quality: QualityLevel, high = 512): number {
  return quality === 'low' ? Math.min(256, high) : high;
}

/** Greyscale raster with wrapped (tileable) drawing primitives. Values are 0..255. */
class Raster {
  readonly w: number;
  readonly h: number;
  readonly v: Float32Array;

  constructor(w: number, h: number, fill = 0) {
    this.w = w;
    this.h = h;
    this.v = new Float32Array(w * h).fill(fill);
  }

  private idx(x: number, y: number): number {
    const xi = ((x % this.w) + this.w) % this.w;
    const yi = ((y % this.h) + this.h) % this.h;
    return yi * this.w + xi;
  }

  blend(x: number, y: number, val: number, a: number): void {
    if (a <= 0) return;
    const i = this.idx(x, y);
    this.v[i] = this.v[i]! + (val - this.v[i]!) * Math.min(1, a);
  }

  add(x: number, y: number, amount: number): void {
    const i = this.idx(x, y);
    this.v[i] = this.v[i]! + amount;
  }

  rect(x: number, y: number, w: number, h: number, val: number, a = 1): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, val, a);
  }

  /** Anti-aliased disc (or ring when `width` > 0). */
  disc(cx: number, cy: number, r: number, val: number, a = 1, width = 0): void {
    const R = r + 1;
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const cov = width > 0 ? Math.max(0, Math.min(1, width / 2 + 0.5 - Math.abs(d - r))) : Math.max(0, Math.min(1, r + 0.5 - d));
        if (cov > 0) this.blend(x, y, val, a * cov);
      }
    }
  }

  /** Anti-aliased capsule line. */
  line(x0: number, y0: number, x1: number, y1: number, width: number, val: number, a = 1): void {
    const hw = width / 2;
    const minX = Math.floor(Math.min(x0, x1) - hw - 1);
    const maxX = Math.ceil(Math.max(x0, x1) + hw + 1);
    const minY = Math.floor(Math.min(y0, y1) - hw - 1);
    const maxY = Math.ceil(Math.max(y0, y1) + hw + 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = Math.max(1e-6, dx * dx + dy * dy);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
        const d = Math.hypot(px - t * dx, py - t * dy);
        const cov = Math.max(0, Math.min(1, hw + 0.5 - d));
        if (cov > 0) this.blend(x, y, val, a * cov);
      }
    }
  }

  /** Soft round blob fading out to radius r. */
  blob(cx: number, cy: number, r: number, val: number, a: number): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d < 1) this.blend(x, y, val, a * (1 - d) * (1 - d));
      }
    }
  }

  grain(rand: () => number, amount: number): void {
    for (let i = 0; i < this.v.length; i++) this.v[i] = this.v[i]! + (rand() - 0.5) * amount;
  }
}

function toTexture(key: string, r: Raster, srgb: boolean): THREE.DataTexture {
  const data = new Uint8Array(r.w * r.h * 4);
  for (let i = 0; i < r.v.length; i++) {
    const c = Math.max(0, Math.min(255, Math.round(r.v[i]!)));
    data[i * 4] = c;
    data[i * 4 + 1] = c;
    data[i * 4 + 2] = c;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, r.w, r.h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.name = `room-${key}`;
  tex.needsUpdate = true;
  return tex;
}

function cached(key: string, size: number, draw: (r: Raster, s: number) => void, srgb = true): THREE.Texture {
  const k = `${key}:${size}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const r = new Raster(size, size);
  draw(r, size);
  const tex = markShared(toTexture(key, r, srgb));
  cache.set(k, tex);
  return tex;
}

function bolt(r: Raster, x: number, y: number, rad: number): void {
  r.disc(x, y, rad * 1.4, 70, 0.9);
  r.disc(x - rad * 0.15, y - rad * 0.15, rad, 205);
}

/**
 * Hangar deck plating: 4×4 plates per repeat (one repeat ≈ 8 m), some with tread, hatches, vents
 * or split sub-plates; seams, bolts, scuffs, tyre marks and stains.
 */
export function deckTexture(quality: QualityLevel): THREE.Texture {
  return cached('deck', sizeFor(quality), (r, s) => {
    const rand = seededRandom(9127);
    const u = s / 512;
    const n = 4;
    const c = s / n;
    const plates: [number, number, number, number][] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = i * c;
        const y = j * c;
        if (rand() < 0.2) {
          const h = c / 2;
          plates.push([x, y, h, h], [x + h, y, h, h], [x, y + h, h, h], [x + h, y + h, h, h]);
        } else if (rand() < 0.2) {
          plates.push([x, y, c, c / 2], [x, y + c / 2, c, c / 2]);
        } else plates.push([x, y, c, c]);
      }
    }
    for (const [x, y, w, h] of plates) {
      const base = 146 + rand() * 30;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) r.v[(y + yy) * s + x + xx] = base + 8 - (16 * (xx + yy)) / (w + h);
      }
      const t = rand();
      if (t < 0.22 && w > 60 * u) {
        const step = 14 * u;
        for (let yy = y + step * 0.5; yy < y + h - 4 * u; yy += step) {
          for (let xx = x + step * 0.5; xx < x + w - 4 * u; xx += step) {
            const flip = (Math.round((xx - x) / step) + Math.round((yy - y) / step)) % 2 === 0;
            r.line(xx - 3.5 * u, yy + (flip ? 3.5 : -3.5) * u, xx + 3.5 * u, yy + (flip ? -3.5 : 3.5) * u, 2.2 * u, base + 34, 0.55);
          }
        }
      } else if (t < 0.34 && w > 60 * u && h > 60 * u) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rr = Math.min(w, h) * 0.3;
        r.disc(cx, cy, rr, 70, 0.9, 3 * u);
        r.disc(cx, cy, rr - 3 * u, 210, 0.3, 1.5 * u);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.3;
          bolt(r, cx + Math.cos(a) * (rr - 8 * u), cy + Math.sin(a) * (rr - 8 * u), 2.4 * u);
        }
        r.rect(cx - rr * 0.45, cy - 2 * u, rr * 0.9, 4 * u, 95, 0.7);
      } else if (t < 0.46 && w > 50 * u) {
        const rows = 5 + Math.floor(rand() * 4);
        const vw = w * 0.56;
        const vx = x + (w - vw) / 2;
        for (let k = 0; k < rows; k++) {
          const vy = y + h * 0.22 + k * 7 * u;
          if (vy > y + h - 10 * u) break;
          r.rect(vx, vy, vw, 3.2 * u, 40, 0.9);
          r.rect(vx, vy + 3.2 * u, vw, u, 215, 0.35);
        }
      }
    }
    for (const [x, y, w, h] of plates) {
      r.rect(x, y, w, 2.4 * u, 58);
      r.rect(x, y, 2.4 * u, h, 58);
      r.rect(x + 2.4 * u, y + 2.4 * u, w - 2.4 * u, 1.2 * u, 235, 0.28);
      r.rect(x + 2.4 * u, y + 2.4 * u, 1.2 * u, h - 2.4 * u, 235, 0.28);
      r.rect(x, y + h - 2 * u, w, 2 * u, 0, 0.16);
      r.rect(x + w - 2 * u, y, 2 * u, h, 0, 0.16);
      bolt(r, x + 7 * u, y + 7 * u, 2.2 * u);
      bolt(r, x + w - 7 * u, y + 7 * u, 2.2 * u);
      bolt(r, x + 7 * u, y + h - 7 * u, 2.2 * u);
      bolt(r, x + w - 7 * u, y + h - 7 * u, 2.2 * u);
    }
    for (let i = 0; i < 90; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const a = rand() * Math.PI;
      const l = (10 + rand() * 60) * u;
      const light = rand() < 0.5;
      const alpha = 0.05 + rand() * 0.07;
      r.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, (0.8 + rand() * 1.6) * u, light ? 255 : 0, alpha);
    }
    for (let i = 0; i < 5; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const rad = (120 + rand() * 200) * u;
      const a0 = rand() * Math.PI * 2;
      const steps = 16;
      for (let k = 0; k < steps; k++) {
        const t0 = a0 + (k / steps) * 0.9;
        const t1 = a0 + ((k + 1) / steps) * 0.9;
        r.line(x + Math.cos(t0) * rad, y + Math.sin(t0) * rad, x + Math.cos(t1) * rad, y + Math.sin(t1) * rad, 9 * u, 0, 0.06);
      }
    }
    for (let i = 0; i < 9; i++) {
      const dark = rand() < 0.75;
      r.blob(rand() * s, rand() * s, (14 + rand() * 46) * u, dark ? 0 : 255, dark ? 0.22 : 0.1);
    }
    r.grain(rand, 12);
  });
}

/** Floor grating: bright bars over a dark sub-floor. One repeat ≈ 2 m. */
export function grateTexture(quality: QualityLevel): THREE.Texture {
  return cached('grate', sizeFor(quality, 256), (r, s) => {
    const rand = seededRandom(311);
    const u = s / 256;
    r.v.fill(26);
    const step = 16 * u;
    for (let y = 0; y < s; y += step) {
      r.rect(0, y, s, 4 * u, 150);
      r.rect(0, y, s, u, 210, 0.6);
      r.rect(0, y + 4 * u, s, 2 * u, 0, 0.5);
    }
    for (let x = 0; x < s; x += step * 4) {
      r.rect(x, 0, 3 * u, s, 125);
      r.rect(x, 0, u, s, 200, 0.5);
    }
    r.grain(rand, 14);
  });
}

/** Worn paint for floor markings: mostly white with chipped, scuffed patches. */
export function paintTexture(quality: QualityLevel): THREE.Texture {
  return cached('paint', sizeFor(quality, 256), (r, s) => {
    const rand = seededRandom(5171);
    const u = s / 256;
    r.v.fill(236);
    for (let i = 0; i < 160; i++) r.disc(rand() * s, rand() * s, (1 + rand() * 4) * u, 110 + rand() * 60, 0.5 + rand() * 0.4);
    for (let i = 0; i < 50; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const a = rand() * Math.PI;
      const l = (8 + rand() * 40) * u;
      r.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, (0.6 + rand()) * u, 90, 0.3);
    }
    r.grain(rand, 16);
  });
}

/** Wood planks with wavy grain along U; one repeat ≈ 2 m. */
export function woodTexture(quality: QualityLevel): THREE.Texture {
  return cached('wood', sizeFor(quality, 512), (r, s) => {
    const rand = seededRandom(733);
    const rows = 8;
    const rh = s / rows;
    for (let row = 0; row < rows; row++) {
      const base = 150 + rand() * 40;
      const f1 = 1 + Math.floor(rand() * 3);
      const f2 = 2 + Math.floor(rand() * 3);
      const ph1 = rand() * 6.28;
      const ph2 = rand() * 6.28;
      const dens = 0.35 + rand() * 0.25;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < s; x++) {
          const wob = Math.sin((x / s) * Math.PI * 2 * f1 + ph1) * 3 + Math.sin((x / s) * Math.PI * 2 * f2 + ph2) * 1.5;
          const g = Math.abs(Math.sin((y + wob) * dens));
          const streak = Math.pow(g, 18);
          r.v[(row * rh + y) * s + x] = base - 34 * streak - 8 * Math.pow(g, 3);
        }
      }
      const ends = 1 + Math.floor(rand() * 2);
      for (let e = 0; e < ends; e++) r.rect(rand() * s, row * rh, 2, rh, 40, 0.8);
      r.rect(0, row * rh, s, 2, 35, 0.9);
      r.rect(0, row * rh + 2, s, 1, 230, 0.15);
    }
    r.grain(rand, 8);
  });
}

/** Upholstery: fine weave with a tufted diamond quilt. One repeat ≈ 1 m. */
export function fabricTexture(quality: QualityLevel): THREE.Texture {
  return cached('fabric', sizeFor(quality, 256), (r, s) => {
    const rand = seededRandom(4409);
    const u = s / 256;
    r.v.fill(196);
    for (let y = 0; y < s; y += 2 * u) r.rect(0, y, s, u, 0, 0.05);
    const q = s / 4;
    for (let k = -4; k <= 4; k++) {
      r.line(k * q, 0, k * q + s, s, 2 * u, 90, 0.6);
      r.line(k * q, s, k * q + s, 0, 2 * u, 90, 0.6);
    }
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        const x = i * q + (j % 2 ? q / 2 : 0);
        const y = j * q;
        r.blob(x, y, q * 0.5, 0, 0.3);
        r.disc(x, y, 2.6 * u, 60);
      }
    }
    r.grain(rand, 10);
  });
}

/** Lounge floor tiles: 'tiles' (glazed squares) or 'terrazzo' (stone chips in large slabs). */
export function tileTexture(quality: QualityLevel, pattern: 'tiles' | 'terrazzo'): THREE.Texture {
  return cached(`tile-${pattern}`, sizeFor(quality, 512), (r, s) => {
    const rand = seededRandom(pattern === 'tiles' ? 61 : 67);
    const u = s / 512;
    if (pattern === 'tiles') {
      const n = 8;
      const c = s / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = 190 + rand() * 30 + ((i + j) % 2 === 0 ? 8 : -8);
          for (let yy = 0; yy < c; yy++) for (let xx = 0; xx < c; xx++) r.v[(j * c + yy) * s + i * c + xx] = v + 10 - (16 * (xx + yy)) / (2 * c);
        }
      }
      for (let k = 0; k < n; k++) {
        r.rect(k * c, 0, 2.5 * u, s, 95);
        r.rect(0, k * c, s, 2.5 * u, 95);
      }
    } else {
      r.v.fill(176);
      for (let i = 0; i < 2600; i++) {
        const v = rand();
        const val = v < 0.45 ? 90 + rand() * 40 : v < 0.8 ? 215 + rand() * 30 : 140 + rand() * 30;
        r.disc(rand() * s, rand() * s, (0.8 + rand() * rand() * 5) * u, val);
      }
      const c = s / 2;
      for (let k = 0; k < 2; k++) {
        r.rect(k * c, 0, 2 * u, s, 70, 0.8);
        r.rect(0, k * c, s, 2 * u, 70, 0.8);
      }
    }
    r.grain(rand, 8);
  });
}

export type GlowKind = 'pool' | 'shaft' | 'ring' | 'streak';

/** UV origin of each glow in the atlas (each cell is 0.5 × 0.5). */
export const GLOW_UV: Record<GlowKind, [number, number]> = {
  pool: [0, 0],
  shaft: [0.5, 0],
  ring: [0, 0.5],
  streak: [0.5, 0.5],
};

/**
 * Glow atlas (linear, additive): radial pool, vertical light shaft (bright at the top), soft ring
 * and horizontal streak, laid out as in GLOW_UV (data rows run bottom-up in texture v).
 */
export function glowAtlas(): THREE.Texture {
  return cached(
    'glow',
    256,
    (r, s) => {
      const h = s / 2;
      const smooth = (a: number, b: number, x: number): number => {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < h; x++) {
          const px = (x + 0.5) / h;
          const py = (y + 0.5) / h;
          const d = Math.hypot(px - 0.5, py - 0.5) * 2;
          // Pool.
          const pool = d < 0.96 ? Math.exp(-d * d * 3.2) * (1 - smooth(0.7, 0.96, d)) : 0;
          r.v[y * s + x] = 255 * pool;
          // Shaft: soft sides, bright at the top (high v), fading down.
          const side = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (px - 0.02) / 0.96))), 2.2);
          const along = smooth(0.0, 0.65, py) * (1 - smooth(0.97, 1.0, py));
          r.v[y * s + x + h] = 255 * side * (0.15 + 0.85 * along * along) * smooth(0.0, 0.08, py);
          // Ring.
          const ring = Math.exp(-Math.pow((d - 0.62) / 0.1, 2)) + 0.25 * Math.exp(-Math.pow((d - 0.62) / 0.25, 2));
          r.v[(y + h) * s + x] = d < 0.98 ? 255 * Math.min(1, ring) * (1 - smooth(0.85, 0.98, d)) : 0;
          // Streak.
          const sy = Math.exp(-Math.pow((py - 0.5) * 7, 2));
          const sx = 1 - smooth(0.25, 0.49, Math.abs(px - 0.5));
          r.v[(y + h) * s + x + h] = 255 * sy * sx;
        }
      }
    },
    false,
  );
}

export interface EnvLook {
  floor: string;
  wall: string;
  ceiling: string;
  lamp: string;
  accent: string;
  /** Light coming through the bay (on the -Z face). */
  bay: string;
  bayLevel: number;
}

/**
 * Small environment cube for image-based reflections and ambient: floor/wall gradient, ceiling
 * lamp panels, accent strips and a bright bay opening on -Z. Owned by the interior (disposed with it).
 */
export function environmentCube(look: EnvLook, quality: QualityLevel): THREE.CubeTexture {
  const size = quality === 'low' ? 16 : 32;
  // Colours are authored in sRGB and the cube is tagged sRGB, so write sRGB bytes (converted once).
  const srgb = (hex: string): [number, number, number] => {
    const c = new THREE.Color(hex).convertLinearToSRGB();
    return [c.r * 255, c.g * 255, c.b * 255];
  };
  const base: Record<string, [number, number, number]> = {};
  for (const key of ['floor', 'wall', 'ceiling', 'lamp', 'accent', 'bay'] as const) base[look[key]] ??= srgb(look[key]);
  const lin = (hex: string, k: number): [number, number, number] => {
    const c = base[hex]!;
    return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
  };
  const faces: THREE.DataTexture[] = [];
  // Order: +X, -X, +Y, -Y, +Z, -Z.
  for (let f = 0; f < 6; f++) {
    const data = new Uint8Array(size * size * 4);
    const put = (x: number, y: number, c: [number, number, number]): void => {
      const i = (y * size + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = (y + 0.5) / size;
        const u = (x + 0.5) / size;
        let c: [number, number, number];
        if (f === 2) {
          const lamp = Math.abs(((u * 3) % 1) - 0.5) < 0.18 && v > 0.2 && v < 0.8;
          c = lamp ? lin(look.lamp, 1) : lin(look.ceiling, 0.5);
        } else if (f === 3) {
          const d = Math.hypot(u - 0.5, v - 0.5);
          c = lin(look.floor, 0.85 - d * 0.7);
        } else {
          // Cube map side faces store their top row first (t = 1 at the top here).
          const t = 1 - v;
          const wall = t > 0.55 ? lin(look.ceiling, 0.45 + (1 - t) * 0.5) : t > 0.45 ? lin(look.wall, 0.7) : lin(look.floor, 0.4 + t * 0.6);
          c = wall;
          if (Math.abs(t - 0.7) < 0.02) c = lin(look.accent, 1);
          if (t > 0.84 && t < 0.9 && ((u * 4) % 1) < 0.4) c = lin(look.lamp, 0.9);
          if (f === 5 && u > 0.08 && u < 0.92 && t > 0.2 && t < 0.64) {
            const glow = Math.max(0, 1 - Math.hypot(u - 0.7, t - 0.55) / 0.35);
            const bay = lin(look.bay, look.bayLevel * glow);
            c = [2 + bay[0], 3 + bay[1], 6 + bay[2]];
          }
        }
        put(x, y, c);
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    faces.push(tex);
  }
  const cube = new THREE.CubeTexture(faces as unknown as HTMLImageElement[]);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.generateMipmaps = false;
  cube.minFilter = THREE.LinearFilter;
  cube.magFilter = THREE.LinearFilter;
  cube.needsUpdate = true;
  cube.name = 'room-env';
  return cube;
}
